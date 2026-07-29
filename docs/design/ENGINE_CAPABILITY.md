# Engine Capability 設計

Related: Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) / Parent Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) / [ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)（Status: Accepted）/ Feature [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)（実装済み）

## 実装済み（2026-07-29）

本ドキュメントのスキーマは `src/app/services/engine_capability.py` として実装済み（Feature [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)）。`EngineCapability`（frozen dataclass）と、既知4エンジン（tesseract/paddleocr/easyocr/trocr）分の`BUILTIN_CAPABILITIES`を定義している。**既存コード（`predict.py`等）からの参照・配線はまだ行っていない**（Engine Registry実装後に接続予定）。単体テストは`tests/test_engine_capability.py`。

実装レビューにより、以下2点は設計時点の`list[str]`から実装を精緻化した（本ドキュメントの型列も`tuple[str, ...]`へ更新済み）。

- リスト系フィールドは`tuple[str, ...]`（不変）で保持する。`frozen=True`はトップレベルの属性再代入のみを防ぎ、内部の`list`はその場で`.append()`等が可能なままのため、真に不変にするには要素型もtupleにする必要があった
- `BUILTIN_CAPABILITIES`は`types.MappingProxyType`で読み取り専用にした。プレーンな`dict`のままだと、外部から共有インスタンスへキーの追加・上書きができてしまうため

## 目的

OCRエンジンごとの機能差異を、コード中に散在する`if engine == "tesseract": ...`のような分岐ではなく、**宣言的なCapabilityデータ**として表現し、呼び出し側（Backend/Frontend双方）がCapabilityを参照するだけで正しく振る舞えるようにする。

## 設計方針（最重要）

**この設計はTrOCR専用ではない。** 現在のTesseract/PaddleOCR/EasyOCR/カスタム分類モデルに加え、将来追加され得る以下のエンジン群を具体的に想定して設計する。

| エンジン | 性質（設計上の想定） |
|---|---|
| Tesseract（既存） | 外部実行ファイル（`lstmtraining`）による学習、行認識、PSM/whitelist概念あり |
| PaddleOCR（既存） | 外部リポジトリ（`external/PaddleOCR`）のスクリプトをサブプロセス実行して学習、認識専用（検出はOCR Crafter側のYOLOで別途実施） |
| EasyOCR（既存） | 推論専用ライブラリ、学習機能なし、独自の検出+認識パイプラインを内包 |
| カスタム分類モデル（既存） | 文字1字ずつを画像分類として学習・推論する、他エンジンと方式が根本的に異なる |
| TrOCR | Hugging Face Transformers（`VisionEncoderDecoderModel`）、行認識専用、Seq2Seq生成、ビームサーチ |
| PARSeq / ABINet / ViTSTR / SVTR | PyTorchネイティブなScene Text Recognitionモデル群。多くは行認識専用（検出は別モデル前提）、モデルにより信頼度出力の粒度が異なる |
| Florence | Vision-Languageファウンデーションモデル。プロンプト（タスクトークン）でOCRを実行し、検出+認識+レイアウト解析を同一モデルで担える |
| Qwen-VL OCR | Vision-Languageモデル。ローカル推論とクラウドAPI利用の両方があり得るため、**オフライン運用可否がCapabilityとして重要な判別軸になる** |

上記のようにエンジンごとに「学習方式（外部プロセス／ライブラリ内蔵／存在しない）」「検出・認識・レイアウトの分担」「信頼度の粒度」「オフライン運用可否」が大きく異なる。Capabilityスキーマは、これらすべてを**強制的に同じ形へ押し込めるのではなく、該当しない項目は`false`/`null`で表現できる**ことを前提に設計する。

## Capability と Metadata の境界線（原則）

このIssue Mapでは以下の原則で切り分ける。

> **Capability = そのエンジン実装が「原理的に何をできるか」（静的・エンジン単位）**
> **Metadata = ある1つの学習済みモデルが「実際に何であるか」（動的・モデルインスタンス単位）**

例えば「Tesseractは多言語の`traineddata`を切り替えられる」はCapability（`supported_languages`が複数言語のリストになりうる）だが、「このモデルは実際に英語で学習された」はMetadata（[MODEL_METADATA.md](MODEL_METADATA.md)の`language`フィールド）である。この原則に基づき、後述の各カテゴリで判断に迷う項目には都度コメントを付す。

---

## スキーマ

以下、`型`はPython型注釈相当。`[既存4種の例]`列はTesseract(T) / PaddleOCR(P) / EasyOCR(E) / カスタム分類(C)の現状に基づく値、`[将来エンジンの想定]`列は前掲の想定エンジン群での値の傾向を示す（実装前の設計時点の想定であり確定ではない）。

### 基本情報

| フィールド | 型 | 説明 | 既存4種の例 | 将来エンジンの想定 |
|---|---|---|---|---|
| `engine_id` | `str` | 一意な識別子（内部キー。例: `"tesseract"`, `"trocr"`） | T=`tesseract` / P=`paddleocr` / E=`easyocr` / C=`custom` | `parseq`, `florence`, `qwen_vl_ocr` 等 |
| `display_name` | `str` | UI表示名 | `Tesseract` / `PaddleOCR` / `EasyOCR` / `カスタム` | 任意の表示名 |
| `description` | `str` | 一言説明（UIツールチップ用） | 各エンジンの短い説明文 | 同様 |
| `version` | `str` | エンジン実装（アダプタコード側）のバージョン。ライブラリ自体のバージョンとは区別する（後述） | `"1.0.0"`（新設） | 同様 |
| `framework` | `str` | 基盤ライブラリ・フレームワーク名 | T=`""`（外部バイナリ）/ P=`"paddlepaddle"` / E=`"pytorch"`(EasyOCR内部) / C=`"pytorch"` | `"transformers"`（TrOCR/Florence/Qwen-VL）, `"pytorch"`（PARSeq等） |
| `license` | `str` | エンジン実装（アダプタコードが依存するライブラリ）のライセンス種別 | T=`Apache-2.0`（Tesseract本体） / P=`Apache-2.0` / E=`Apache-2.0` | TrOCR=`MIT`、モデルによって異なる |
| `supported_platforms` | `tuple[str, ...]` | 動作確認済みOS（例: `["windows","linux"]`） | 全エンジンWindows動作確認済み | 未検証のものは空リストで明示（推測補完しない） |

**注記**: `license`はここでは「エンジン実装（コード）」のライセンスを指す。個別の**学習済みモデル（チェックポイント）**のライセンスは、モデルごとに異なりうる（例: TrOCRエンジン自体はMITだが、Hugging Face Hubから取得する第三者ファインチューン版チェックポイントは別ライセンスの場合がある）ため、モデル単位のライセンスは[MODEL_METADATA.md](MODEL_METADATA.md)の`license`フィールドで別途持つ。**この2つのライセンスフィールドは値が異なりうることを設計上明示しておく。**

### 学習

| フィールド | 型 | 説明 | 既存4種の例 | 将来エンジンの想定 |
|---|---|---|---|---|
| `supports_training` | `bool` | 学習機能を持つか | T/P/C=`true`、E=`false` | PARSeq系は`true`、Qwen-VL OCRがAPI提供のみの場合は`false` |
| `supports_resume_training` | `bool` | 中断学習の再開に対応するか | T/P/C=現状明示的な再開機能なし=`false`（要現状再確認。少なくとも公開APIレベルでは無い） | HF `Trainer`系（TrOCR/Florence）はcheckpoint再開に標準対応=`true`になりやすい |
| `supports_finetuning` | `bool` | 事前学習済みモデルからのfine-tuningに対応するか | T=`true`（`eng.traineddata`ベース）/ P=`true`（初期重み指定）/ C=`true`（`init_source_type`） | TrOCR/Florence等HF系は基本fine-tuning前提=`true` |
| `supports_custom_dataset` | `bool` | 独自データセットでの学習に対応するか | T/P/C=`true` | 想定エンジンは概ね`true`（の前提で追加検討する） |
| `supports_custom_charset` | `bool` | 学習対象文字セットの制限に対応するか | T=`true`（`charset`設定）/ P=`true` / C=`true`（クラス定義） | Seq2Seq系（TrOCR/Florence）はトークナイザ語彙の制約となり、Tesseract流の「文字集合フィルタ」とは実現方法が異なる点に注意（詳細は[MODEL_METADATA.md](MODEL_METADATA.md)の`charset`参照） |
| `supports_dictionary` | `bool` | 学習時に辞書（候補語彙）を利用できるか | 既存4種とも学習時の辞書機能は無し=`false`（候補辞書は推論後の補助としてのみ存在。[CLAUDE.md](../../CLAUDE.md)の「補助機能の分離」原則） | 同様に`false`が既定になりやすい。学習時辞書注入は既存の設計原則（推論後の補助であり学習・推論内部へ注入しない）と衝突するため、仮に技術的に可能でも既定は`false`として明示的opt-inにすべき |
| `supports_augmentation` | `bool` | オーグメンテーション機能を持つか | T/P/C=`true`（既存のオーグメンテーション設定UI経由） | 想定エンジンでも概ね対応可能 |
| `supports_mixed_precision` | `bool` | AMP等の混合精度学習に対応するか | P=`true`（`use_amp`設定）、T/C=非対応前提 | HF `Trainer`系は標準対応=`true` |
| `supports_distributed_training` | `bool` | 複数GPU/分散学習に対応するか | 既存4種とも単一プロセス・単一GPU/CPU前提=`false`（OCR Crafterはローカル単一マシン運用のため、この項目は「エンジン自体は対応していても、OCR Crafterとしては使わない」ケースがありうる。Capabilityは「エンジンの理論上の能力」であり、「OCR Crafterが実際に使うか」は別のConfiguration/運用判断） | TrOCR/Florenceの学習コードは複数GPU対応の場合があるが、ローカル単一マシン運用前提のOCR Crafterでは当面`false`扱いで統一してよい（意図的に使わない） |

### 推論

| フィールド | 型 | 説明 | 既存4種の例 | 将来エンジンの想定 |
|---|---|---|---|---|
| `supports_inference` | `bool` | 推論機能を持つか | 全エンジン`true` | 全エンジン`true`前提 |
| `supports_batch_inference` | `bool` | 複数画像の一括推論に対応するか | 全エンジン`true`（既存バッチ推論画面が4エンジン共通で対応） | 想定エンジンも概ね`true` |
| `supports_streaming` | `bool` | ストリーミング（逐次）出力に対応するか | 既存4種とも`false`（OCR Crafterに逐次出力UIが無い） | HF `generate(streamer=...)`のようにトークン単位ストリーミングが可能なエンジンもあるが、現状UI未対応のため当面全エンジン`false`運用 |
| `supports_beam_search` | `bool` | ビームサーチ等の複数候補生成に対応するか | 既存4種とも`false`（概念自体が無い） | TrOCR/Florence/PARSeq系は`true`になりうる。**この項目がTrOCR系エンジン追加で初めて意味を持つ新規Capability** |
| `supports_confidence` | `bool` | 文字/単語単位の信頼度スコアを返せるか | T/P/E=`true`、C=`true`（分類確率） | TrOCR標準の`generate()`は文字単位confidenceを直接返さない=`false`または要追加実装（[ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)の未解決事項）。Florence/Qwen-VLも同様に要確認 |
| `supports_dictionary_postprocess` | `bool` | 推論後の候補辞書補正に対応するか | 既存4種とも共通の候補辞書機能（`lib/candidateDictionary.js`）を推論後処理として利用可能=`true`（エンジン非依存の後処理のため、実質全エンジン`true`） | 同様に全エンジン`true`（後処理はエンジン内部と独立しているため） |
| `supports_orientation` | `bool` | 画像の回転・向き補正に対応するか | OCR Crafter側で90°回転操作として提供（エンジン非依存の前処理）=`true`扱い | 同様 |
| `supports_detection` | `bool` | 文字領域検出を内蔵するか | T=`false`（PSM7固定=単一行前提、検出はOCR Crafter側のYOLOで別実施）/ P=`false`（同様、認識専用として利用）/ E=`true`（内蔵検出+認識） | Florence/Qwen-VLは`true`（検出+認識を同一モデルで実施）になりやすい。PARSeq/ABINet/ViTSTR/SVTRは`false`（認識専用）が一般的 |
| `supports_recognition` | `bool` | 文字認識を行うか | 全エンジン`true` | 全エンジン`true`前提 |
| `supports_layout` | `bool` | 文書レイアウト解析（読み順・段組等）に対応するか | 既存4種とも`false` | Florence等の文書理解系ファウンデーションモデルは`true`になりうる。ただし[ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)のEpic対象外「文書レイアウト解析」に該当するため、**このCapabilityが`true`のエンジンを追加しても、OCR CrafterはさしあたりLayout機能を利用しない**（Capabilityとして持つことと、OCR Crafterが機能として提供することは別） |

### 評価

| フィールド | 型 | 説明 | 既存4種の例 | 将来エンジンの想定 |
|---|---|---|---|---|
| `supports_evaluation` | `bool` | モデル評価機能（CER測定等）に対応するか | 現状`ocr_evaluation.py`はTesseractのみ実装（T=`true`、P/E/C=構造的に`false`＝Capabilityとしては対応可能でも実装が無い） | 新規エンジン追加時にEvaluationHandlerを実装すれば`true`にできる（[ENGINE_REGISTRY.md](ENGINE_REGISTRY.md)参照） |
| `supports_character_accuracy` | `bool` | 文字正解率を算出できるか | CERと表裏一体のため、`supports_evaluation`が`true`なら通常`true` | 同様 |
| `supports_word_accuracy` | `bool` | 単語正解率を算出できるか | 既存4種とも未実装（[06_評価結果の見方.md](../manual/06_評価結果の見方.md)で「現時点では未対応」と明記済み） | 実装すれば`true`にできるが、OCR Crafterは現状文字単位CER中心の設計方針のため、Capabilityとして`true`のエンジンが来ても既定では使わない可能性がある |
| `supports_cer` | `bool` | CER算出に対応するか | Tesseractのみ`true`（実装済み） | 新規Evaluation実装で対応可能 |
| `supports_wer` | `bool` | WER（単語誤り率）算出に対応するか | 既存4種とも未実装=`false`（[06_評価結果の見方.md](../manual/06_評価結果の見方.md)参照） | 同上 |
| `supports_confusion_matrix` | `bool` | 混同行列（分類モデル）または混同TOP（OCR）を算出できるか | T=`true`（混同TOP）、C=`true`（分類の混同行列。ただしOCRの混同TOPとは別概念点に注意） | 同様に実装依存 |

### Export

| フィールド | 型 | 説明 | 既存4種の例 | 将来エンジンの想定 |
|---|---|---|---|---|
| `supports_export` | `bool` | 推論用エクスポート機能を持つか | P=`true`（`export_model.py`による推論用ディレクトリ生成）、T=`true`（`.traineddata`自体がそのままエクスポート済み形式）、C=`false`（`.pt`をそのまま使用） | HF系（TrOCR/Florence）は`save_pretrained()`で常に可能=`true` |
| `supported_export_formats` | `tuple[str, ...]` | 対応するエクスポート形式 | P=`["paddle_inference"]`、T=`["traineddata"]`、C=`[]` | TrOCR=`["safetensors","pytorch_bin"]`等 |
| `supports_onnx` | `bool` | ONNX形式へのエクスポートに対応するか | 既存4種とも未対応=`false` | HF系は`optimum`等の追加ツールで対応可能な場合がある（現状OCR Crafterには未導入） |
| `supports_torchscript` | `bool` | TorchScript形式に対応するか | 既存4種とも未対応=`false` | PyTorchネイティブなPARSeq等では対応しやすい |
| `supports_quantization` | `bool` | 量子化に対応するか | 既存4種とも未対応=`false` | HF系は`bitsandbytes`等で対応可能（公式ドキュメントで確認済み。ただし追加依存が必要） |

**注記**: 「エンジンがサポートするか」（Capability）と「この特定モデルが実際にエクスポート済みか」（Metadata、既存の`ocr_inference_ready`相当）は明確に別軸。既存コードの`exportReady()`/`ocr_inference_ready`はMetadata側の概念であり、本表の`supports_export`はエンジン実装側の能力を指す。

### Hardware

| フィールド | 型 | 説明 | 既存4種の例 | 将来エンジンの想定 |
|---|---|---|---|---|
| `supports_cpu` | `bool` | CPU実行に対応するか | 全エンジン`true`（Tesseractは常にCPU、他もCPUモード有り） | HF系はCPU動作可能だが学習は非現実的に遅い（[ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)調査結果）。**「対応するか」と「実用的か」を区別するため、後述`recommended_vram`等と併用して判断する** |
| `supports_cuda` | `bool` | NVIDIA CUDA GPUに対応するか | P=`true`、T=`false`（CPU固定）、E/C=`true` | 想定エンジンの多くは`true` |
| `supports_mps` | `bool` | Apple Silicon（Metal）に対応するか | 既存4種とも未検証=`false`（推測補完しない。`settings.yaml`のプリセット名`mac_safe`はCPUモードを指しMPS対応ではない点に注意） | HF系はPyTorchのMPSバックエンドで理論上対応しうるが未検証 |
| `supports_directml` | `bool` | Windows DirectML（非NVIDIA GPU）に対応するか | 既存4種とも未対応=`false` | 未検証 |
| `minimum_vram` | `int \| None` | 最低限必要なVRAM（MB）。CPU実行のみのエンジンは`null` | 既存4種とも未計測=`null` | **注記参照** |
| `recommended_vram` | `int \| None` | 推奨VRAM（MB） | 同上 | 同上 |

**注記（重要な設計上の指摘）**: `minimum_vram`/`recommended_vram`は、実際には「エンジン」単位ではなく**「モデルサイズ・バリアント」単位**で異なる値になる（例: TrOCR-small/base/largeでVRAM要件が数倍異なる）。エンジン単位のCapabilityとして1つの値を持たせると、複数バリアントを持つエンジン（TrOCR、Florence、Qwen-VL等）で不正確になる。**設計案**: `minimum_vram`/`recommended_vram`はEngine Capability側には「代表値（最小バリアントの値、またはレンジの下限）」として置き、個別モデルの実際のVRAM要件は[MODEL_METADATA.md](MODEL_METADATA.md)側にモデルサイズ情報とセットで持たせるか、Capability側を`vram_by_variant: dict[str, int]`のようなバリアント別マップにする案も検討する（本ドキュメントでは単純化のため代表値方式を採用するが、実装Issueで再検討可）。

### Language

| フィールド | 型 | 説明 | 既存4種の例 | 将来エンジンの想定 |
|---|---|---|---|---|
| `supported_languages` | `tuple[str, ...]` | エンジンが理論上サポートしうる言語（ISO 639-1等）のリスト | T=多数（`traineddata`次第、理論上100+言語）、P=多数、E=多数、C=言語非依存（文字分類のため） | TrOCR公式チェックポイントは英語のみ確認（[ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)調査結果）。日本語は非公式チェックポイントのみ＝`supported_languages`に`"ja"`を含めるかは公式/非公式の別を明示した上で慎重に判断する（推測で含めない） |
| `supports_multilingual` | `bool` | 単一モデルで複数言語混在に対応するか | E=`true`（複数言語同時指定可）、T/P=モデル切替方式のため単一モデル内混在は`false`扱い | XLM-RoBERTaベースのTrOCR/Florenceは理論上多言語対応だが、公式チェックポイントの学習データが英語中心のため実用上の多言語性は別途検証が必要 |
| `supports_unicode` | `bool` | Unicode全般（絵文字・特殊記号含む）に対応するか | 既存4種ともASCII+一部拡張が中心。完全なUnicode対応は未検証=`false`扱いが安全 | 同様に要検証 |
| `supports_vertical_text` | `bool` | 縦書きに対応するか | 既存4種とも未対応=`false` | 日本語OCR用途で将来的に重要になりうるが、現時点で対応を明言できるエンジンは無い |
| `supports_handwriting` | `bool` | 手書き文字認識に対応するか | T=`true`（筆記体一部文字`klt`のcharset拡張あり）、P=モデル次第、E=`true`、C=学習データ次第で理論上可能 | TrOCRは`trocr-*-handwritten`という手書き専用チェックポイントが公式に存在=`true`が明確 |

### Dataset

| フィールド | 型 | 説明 | 既存4種の例 | 将来エンジンの想定 |
|---|---|---|---|---|
| `accepted_dataset_types` | `tuple[str, ...]` | 受け入れ可能なデータセット形式（例: `["line_image_text_pair"]`） | T/P=`["line_image_text_pair"]`（既存の汎用Dataset形式そのまま）、C=`["classification_image"]` | TrOCR/Florence/PARSeq等も基本`line_image_text_pair`で流用可能（Investigationで確認済み：既存Dataset形式はengine非依存で変更不要） |
| `required_annotations` | `tuple[str, ...]` | 必要なアノテーション種別（例: `["text"]`, `["text","bbox"]`） | T/P=`["text"]`（行画像+テキストのみ）、C=`["class_label"]` | Florence等、検出も同時に行うモデルを学習する場合は`["text","bbox"]`が必要になりうるが、OCR Crafterの既存Dataset形式にbboxは無いため、**この種のエンジンを学習対応させる場合は別途Dataset拡張の実装Issueが必要になる**（本設計では現状のDataset形式を変更しないことを優先し、bbox必須のエンジンは当面「推論専用」として導入する選択肢を残す） |
| `required_image_format` | `tuple[str, ...]` | 必要な画像形式（例: `["png","jpg"]`） | 既存4種とも共通の前処理パイプライン経由でPNG統一 | 同様 |

### Metadata（Engine Capabilityが宣言する、Model Metadataとの連携フィールド）

| フィールド | 型 | 説明 |
|---|---|---|
| `required_metadata` | `tuple[str, ...]` | このエンジンのモデルが**必ず**持つべき[MODEL_METADATA.md](MODEL_METADATA.md)のフィールド名リスト（例: Tesseractなら`["engine","charset","checkpoint"]`等） |
| `optional_metadata` | `tuple[str, ...]` | 持っていてもよいが必須ではないフィールド名リスト |

この2フィールドが、[ENGINE_REGISTRY.md](ENGINE_REGISTRY.md)の`Validator`が「このモデルのMetadataは、そのengineが要求する必須フィールドを満たしているか」を検証する際の参照元になる。**これがEngine CapabilityとModel Metadataを繋ぐ唯一の連携ポイントであり、両者の責務を明確に分離する設計上の要とする。**

---

## Capabilityではなく Metadata に持つべきと判断した項目・理由

作業指示にある項目のうち、以下はCapabilityではなくMetadata（[MODEL_METADATA.md](MODEL_METADATA.md)）側に置くべきと判断した。

| 項目 | 理由 |
|---|---|
| 実際の学習済み言語（`language`） | `supported_languages`（エンジンが理論上サポートしうる言語一覧）とは別に、**個々のモデルが実際にどの言語で学習されたか**はモデルインスタンスごとに異なる。TrOCRエンジンの`supported_languages`が将来`["en","ja"]`になっても、ある1つのモデルは`language: "en"`のみ、という状況が普通に起こる |
| 実際の学習対象文字集合（`charset`） | 同様に、`supports_custom_charset`（エンジンがcharset制限に対応するか）はCapabilityだが、「このモデルの実際のcharsetは何か」はMetadata。既存の`.tess.json`/`.ocr.json`も両方ともモデル単位でcharsetを保持している現行設計と一致する |
| モデルの実際のライセンス | 上述のとおり、エンジン実装のライセンスとモデルチェックポイントのライセンスは別軸になりうる |
| 「エクスポート済みかどうか」「エクスポート先パス」 | `supports_export`（能力）と、既存の`ocr_inference_ready`/`export_dir`相当（実際にエクスポートされたか）は別軸。後者はMetadata |
| 実際に使用したVRAM量・実行速度の実測値 | Capabilityの`minimum_vram`/`recommended_vram`はあくまで設計時の目安。実測値はBenchmark Runnerの実行結果（既存の`benchmarks.json`）が担う領域であり、Model MetadataにもEngine Capabilityにも含めない（Benchmarkの責務） |
| 学習に使用した実際のDataset/Experiment ID | `accepted_dataset_types`（エンジンが受け入れ可能な形式）はCapabilityだが、「実際にどのDatasetを使ったか」は既存の`dataset_id`/`experiment_id`と同様、明確にMetadata（かつ既存のDataset Manager/Experiment Trackerとの連携情報） |

---

## 現状

上記スキーマに相当する情報は、現在コード中に散在している。近い概念として`services/benchmark.py`の`ENGINE_CATALOG`（`key`/`label`/`implemented`/`requires_model`/`profile_keys`の4フィールドのみ）が存在するが、Benchmark Runner専用であり、学習・評価・Hardware・Languageといった観点は一切扱っていない。

## 課題

- エンジンの能力差異が`if/elif`という手続き的コードに埋め込まれており、新エンジン追加のたびに複数箇所（本Investigationで確認した5箇所＋Frontend）を漏れなく修正する必要がある
- `engineLabelOf()`等の既存キャッチオール実装は、実質的に「Capability情報が存在しないために発生している」欠陥である
- Capability（能力）とMetadata（実体）の区別が現状の設計に存在せず、両者の情報が混在しがち

## 設計案

上記のスキーマを、Python側では`dataclass`（またはPydanticモデル）として`src/app/services/engine_capability.py`（新設想定）に定義し、各エンジンの実装モジュールが自身のCapabilityインスタンスを1つ持つ。詳細な配線方法は[ENGINE_REGISTRY.md](ENGINE_REGISTRY.md)を参照。

## メリット

- 新エンジン追加時に「このエンジンは何ができないか」を宣言するだけで済み、呼び出し側のコード修正箇所が減る
- UIの表示切替（例: 学習不可なエンジンはUI上グレーアウト）がCapability参照だけで実現でき、`engineLabelOf()`のような個別のハードコードが不要になる
- 将来のPARSeq/ABINet/ViTSTR/SVTR/Florence/Qwen-VL OCR追加時、既存4エンジンとの共通点・相違点がスキーマ上明示される

## デメリット

- スキーマ設計・初期データ投入（既存4エンジン分のCapabilityを正確に埋める作業）に一定の工数がかかる
- Capabilityフィールドが多いため、将来的にフィールドの陳腐化・形骸化（実際には参照されないフィールドが残る）のリスクがある。運用上、未使用フィールドの定期的な見直しが必要
- Hardware系フィールド（VRAM等）は前述のとおりモデルバリアント単位との齟齬があり、今後の再設計余地を残したまま初版とする

## 採用理由

CLAUDE.mdの「新設定は『未設定=従来動作』となるデフォルトを必ず持たせる」という既存原則と親和性が高い（Capabilityの各フィールドに適切なデフォルト値を設定すれば、既存3エンジンの挙動を変えずに新しい参照経路を追加できる）。また、本Investigationで発見した具体的な欠陥（PaddleOCRキャッチオール）の直接的な解消手段になる。

## 将来影響

- Engine Capabilityが確定すれば、[ENGINE_REGISTRY.md](ENGINE_REGISTRY.md)のFactory/Validatorの実装が可能になる
- Frontendの`engineLabelOf()`等は、将来的にBackendから配信されるCapability情報（例: `GET /api/engines`のような新規エンドポイント、本Issueでは未設計）を参照する形へ移行できる可能性があるが、これは実装Issueでの検討事項とする
