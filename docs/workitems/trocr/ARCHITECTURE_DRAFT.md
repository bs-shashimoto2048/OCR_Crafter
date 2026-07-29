# TrOCR統合 Architecture Draft

Related Issue: Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) / Parent Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

## Status

調査完了・設計確定済み（本実装は未着手）。詳細な決定根拠は [../../adr/ADR-0001_Trocr_Architecture.md](../../adr/ADR-0001_Trocr_Architecture.md)（Status: Accepted）を参照。

---

## 現状分析

コード調査（`src/app/main.py`・`src/app/predict.py`・`src/app/services/*.py`・`frontend/src/**`）に基づく。

### Backend: エンジン選択・分岐の実態

**エンジンの振り分けを行うFactory/Registryは存在しない。** 推論・学習・評価・モデル一覧という4つの独立した箇所が、それぞれ形の異なる`if/elif`分岐を個別に持っている。

| 箇所 | ファイル:行 | 分岐方式 |
|---|---|---|
| 推論 | `predict.py::predict_from_image()` L960-1027 | `if engine_name == "easyocr": ... if == "paddleocr": ... if == "tesseract": ...` で、`custom`（分類モデル）は分岐なしでそのまま約70行のインライン処理へフォールスルー |
| 評価 | `services/ocr_evaluation.py::build_recognizer()` L133-140 | `if engine == "tesseract": return ...` の1行のみ実装済み。`# 将来: elif engine == "paddleocr": ...`というコメントが次の分岐箇所として残るのみで、**PaddleOCR/EasyOCRはこのモデル評価画面では現状評価不可** |
| 学習ジョブ振り分け | `job_runner.py` + `main.py::_spawn_training_runner` | `job_type`（`classification`/`ocr`/`tesseract`）という、推論側の`engine`（`custom`/`easyocr`/`paddleocr`/`tesseract`）とは**別の語彙**で分岐。`ocr`は実質PaddleOCRだけを指す紛らわしい命名 |
| モデル一覧 | `services/model_registry.py::list_model_infos()` | ファイル拡張子（`*.pt`/`*.ocr.json`/`*.tess.json`）で`if/elif/else`分岐。出力は統一された`engine`フィールド付きdictだが、生成方法は3通りバラバラ |
| リリースGate | `services/release_gate.py::_model_engine()` L126-131 | **model_registry.pyとは独立した、もう1つのエンジン判定ロジック。** JSON内の`engine`フィールドを読まず、ファイル名の拡張子だけで`"tesseract"`/`"paddleocr"`/`""`を判定する。新エンジン追加時にここも見落とされやすい |

**唯一の例外**が `services/benchmark.py` の `ENGINE_BUILDERS`（L317-324）＋`ENGINE_CATALOG`（L44-85）で、コード中のコメントで明示的に "Adapter構造。新しいエンジンはこの辞書へbuilderを登録する" とされている。必要なインターフェースは最小限（`builder(project_id, spec) -> {"label": str, "recognize": Callable[[str], tuple[str, float]]}`）。ただしこのAdapterは**Benchmark Runner専用**で、`predict.py`や`ocr_evaluation.py`からは再利用されておらず、内部で類似ロジックを重複実装している。またEasyOCRは`ENGINE_CATALOG`に`"implemented": False`のプレースホルダーとしてのみ存在し、`ENGINE_BUILDERS`には未登録（Benchmark Runnerでも使えない）。

学習エンドポイントも3系統が完全に独立している（共通の基底スキーマなし）。

| エンジン | エンドポイント | リクエストスキーマ |
|---|---|---|
| 分類モデル | `POST /train/start` | `TrainRequest`（`engine`フィールド自体が無い） |
| PaddleOCR | `POST /api/ocr/train/start` | `OcrTrainStartRequest`（`engine`フィールドはあるが`"paddleocr"`以外は400で拒否） |
| Tesseract | `POST /api/tesseract/train/start` | `TesseractTrainStartRequest`（`engine`フィールド自体が無い） |

### Backend: モデル永続化とengineフィールド

| エンジン | 拡張子 | `engine`フィールドの実体 |
|---|---|---|
| 分類モデル | `*.pt` | `model_registry.py`が**ハードコードで**`"custom"`を返す（ファイル自体には保存されない） |
| Tesseract | `*.tess.json` | `tesseract_pipeline.py`が書込時にハードコードで`"engine": "tesseract"`。読込側もハードコード |
| PaddleOCR | `*.ocr.json` | **書込・読込ともJSON内の実フィールド**（`ocr_pipeline.py::_register_ocr_model()`で`engine`引数をそのまま格納）。未設定時のみ`"paddleocr"`にフォールバックする設計で、**他エンジン名を格納する前提が既にある唯一の場所** |

`resolve_ocr_model_meta(project_id, model, engine=None, ...)`・`list_ocr_model_meta_files(project_id, engine=None)` は任意の`engine`文字列でフィルタできる汎用実装だが、実際に呼ばれる箇所は現状すべて`engine="paddleocr"`固定（例: `benchmark.py:284`）。

### Backend: Dataset・Experiment・Benchmark Centerはengineを知らない

- **Dataset Registry**（`dataset_registry.py`）: `meta.json`に`engine`フィールドは存在しない。画像＋テキストのペア＋charset＋分割比率のみのengine非依存フォーマット。Tesseract学習は、この同じ汎用データセットを学習時に`.box`/`.lstmf`へその場で変換している（データセット自体は変換しない）
- **Experiment Tracker**（`experiment_tracker.py`）: `record_experiment()`はcaller側が渡したdictをほぼそのまま保存するのみ。現状`tesseract_pipeline.py`だけが呼んでおり、`training`サブオブジェクトには`optimizer`/`scheduler`/`loss`/`learning_rate`/`batch_size`という**未使用のまま予約されたフィールド**が既にある（Tesseractには存在しない概念のためnull）。エポック・loss推移という概念は現状どこにも無い
- **Evaluation Profile/Hash**: `psm`/`whitelist`が常にハッシュ対象に含まれる（Tesseract固有の概念だが全エンジン共通のフィールドとして存在）。CER自体は文字列編集距離ベースでengine非依存
- **Benchmark Center**（`benchmark_center.py`）: モジュールdocstringに明記のとおり**評価を一切実行せず**、`model_registry`が既に持つ`engine`文字列をフィルタに使うだけ。エンジン固有ロジックはゼロ

### Frontend: エンジン選択の実態

- `App.jsx`のstate（`ocrEngine`/`inferEngine`等）を各画面へpropsで配布する構成
- **`ocrEngine === "X"`のような比較箇所が111件（10ファイル）、`"tesseract"|"paddleocr"|"easyocr"`という文字列リテラルの出現は162件（16ファイル）**（grep実測）
- `InferenceView.jsx`・`OcrBatchView.jsx`・`RapidOCRView.jsx`の3画面が、ほぼ同一の「ドロップダウン＋if/else-ifチェーン」パターンを**それぞれ独立に**実装（共通コンポーネント化されていない）
- **既に実在する不具合パターン**: `ModelsView.jsx::engineLabelOf()`と`lib/inferenceModel.js::resolveInferenceEngine()`はどちらも「`training_family === "ocr"`かつ`engine !== "tesseract"`なら無条件に`"PaddleOCR"`」という**キャッチオール**を持つ。TrOCRを`training_family: "ocr", engine: "trocr"`で登録すると、この2箇所は**修正しない限りTrOCRモデルを誤って"PaddleOCR"と表示・誤ってPaddleOCR推論へルーティングする**（推測ではなく、既存コードの読解から確認した実際の欠陥）
- `services/ocr_evaluation.py`同様、`OcrEvaluationView.jsx`にも`engine`という概念自体が無い（grep 0件）＝Tesseract専用画面であることがFrontend側からも確認できる
- localStorageキー（`ocr_<用途>_v1`パターン）はengine名に依存しない汎用キーのみ。推論使用モデルの永続化はサーバー側（`GET/POST /api/ocr/inference/model`）で行われており、engine追加によるlocalStorage設計変更は不要

### requirements.txt・依存関係

- `transformers`は現状**依存関係に存在しない**（`requirements.txt`・`requirements-ci.txt`とも0件、`pip show transformers`も未検出）。TrOCR統合には新規依存として追加が必須
- `huggingface_hub`・`safetensors`は既に間接依存として存在（`paddlex`/`paddleocr`経由）。`torch==2.11.0`は既存の直接依存であり、TrOCR（HF Transformers経由）はこの既存torchと共存できる
- 重量級OCRライブラリ（`easyocr`・`paddleocr`・`cv2`・`ultralytics`）は**遅延import**が既存の確立された慣習（`predict.py::_get_easyocr_reader()`等）。`transformers`もこの慣習に従い遅延importするのが自然
- `external/PaddleOCR`はgit submoduleではなく、`.gitignore`対象のローカルチェックアウト（`config/settings.yaml`の`ocr_training.paddleocr_repo_dir`で参照されるのみ）。TrOCRはHugging Face Hubからのモデルダウンロード方式となり、この「外部リポジトリのtools/train.pyをサブプロセス実行する」PaddleOCR方式とは根本的に異なる

---

## TrOCR特徴

Microsoft Research論文（Li et al., "TrOCR: Transformer-based Optical Character Recognition with Pre-trained Models", arXiv:2109.10282, AAAI 2023）およびHugging Face Transformers公式ドキュメント（`transformers.VisionEncoderDecoderModel`・`transformers.TrOCRProcessor`）を一次情報として確認した。

### アーキテクチャ

- **`VisionEncoderDecoderModel`**（画像エンコーダ + テキストデコーダのTransformer構成）としてHugging Face Transformersに統合されている。エンコーダはViT/DeiT/BEiT系の画像モデル、デコーダはRoBERTa/XLM-RoBERTaベースのTrOCR専用デコーダ
- **`TrOCRProcessor`**が画像前処理（`ViTImageProcessor`/`DeiTImageProcessor`）とトークナイザ（`RobertaTokenizer`/`XLMRobertaTokenizer`）を1つにラップする
- 既存3エンジン（Tesseract=LSTM、PaddleOCR=CNN+RNN系認識モデル、分類モデル=CNN分類器）とは異なり、**画像→テキストを1つのTransformerで直接生成するEnd-to-Endモデル**

### 学習方式（重要な発見）

**公式のMicrosoft `unilm/trocr`リポジトリ（GitHub）が提供する学習コードは`fairseq`ベースで、NVIDIA APEX・CUDA・8GPU前提のLinux/conda環境を要求する。** これはOCR CrafterのWindows・CPU可・オフライン運用という前提と適合しない。

**一方、Hugging Face Transformers経由の学習は標準的なPyTorchモデルとして扱える。** `model(pixel_values, labels=label_ids)`のforward呼び出しで通常のcross-entropy lossが返り、Hugging Face公式が案内する`Seq2SeqTrainer`/`Seq2SeqTrainingArguments`（コミュニティ制作だがHF公式ドキュメントからリンクされているノートブック"Fine_tune_TrOCR_on_IAM_Handwriting_Database_using_Seq2SeqTrainer"で実証済み）でfine-tuningできる。**この調査の結論として、TrOCR統合は公式`unilm/trocr`（fairseq）ではなく、Hugging Face Transformers経由（`VisionEncoderDecoderModel`+`Seq2SeqTrainer`）を採用すべきである。**

- 学習はエポック・step単位（PaddleOCRの`epochs`設定と概念的に近く、Tesseractの`max_iterations`＝LSTM反復回数とは異なる）
- チェックポイント形式: `model.safetensors`（またはpytorch_model.bin）+ `config.json`。Trainerでの再開には追加で`optimizer.pt`/`scheduler.pt`/`trainer_state.json`
- CPU学習は`TrainingArguments(use_cpu=True)`で可能だが**GPU比20〜100倍遅い**（Hugging Face公式ドキュメントに明記）。CPU推論はモデルサイズ次第で現実的（baseモデルで数百ms〜数秒/画像程度が一般的な目安。実測は本Investigationの対象外）

### 推論方式

`processor(image, return_tensors="pt").pixel_values` → `model.generate(pixel_values)` → `processor.batch_decode(generated_ids)` という3ステップ。Tesseract/PaddleOCRのようなPSM・whitelist・confidence-per-characterという概念は無く、代わりにビームサーチ等の生成パラメータ（`num_beams`等）を持つ。

### チェックポイント・ライセンス

- 公式チェックポイント: `microsoft/trocr-{small,base,large}-{printed,handwritten,stage1,str}`。baseモデルは約0.3B（3億）パラメータ
- ライセンス: `microsoft/unilm`リポジトリ（TrOCR原著コード）は**MITライセンス**（GitHub上のLICENSEファイルで確認）。`transformers`ライブラリ自体はApache License 2.0（Hugging Face公式・広く知られた事実）
- 学習データ: 公式チェックポイントは**IAM（英語手書き）・SROIE（英語印刷・レシート）・各種STR（Scene Text Recognition）ベンチマークで学習・評価**されている。いずれも英語・ラテン文字

### 日本語対応（重要な制約・未解決事項）

**公式のMicrosoft TrOCRチェックポイントに日本語対応モデルは存在しない。** Hugging Face Hub検索の結果、日本語向けは`nakamura196/trocr-small-ndl`という**非公式・コミュニティ発**のsmallモデル1件のみ確認できた（国立国会図書館の古典籍OCRプロジェクトに由来すると推測されるが、保守状況・精度は未検証）。OCR Crafterには「日本語OCR」「手書きOCR」というプロジェクトテンプレートが既に存在するため、**TrOCRで日本語をサポートするには非公式チェックポイントの採用、またはXLM-RoBERTaベースの新規語彙でのゼロからの学習に近い作業が必要**という制約がある。英数字OCR・銘板OCR（英数字中心）用途であれば公式`trocr-{base,large}-printed`が直接使える可能性が高い。

---

## OCR Crafterとの違い

| 観点 | 既存3エンジン | TrOCR |
|---|---|---|
| 学習主体 | 外部プロセス（Tesseract=`lstmtraining`実行ファイル、PaddleOCR=`external/PaddleOCR/tools/train.py`をサブプロセス実行） | **Python内で完結**（`transformers`をimportし、同一プロセス内でモデルオブジェクトを扱う） |
| 学習進捗の単位 | Tesseract=iteration、PaddleOCR=epoch | epoch/step（PaddleOCR寄り） |
| 入力表現 | 文字ごとの認識（Tesseract）／行認識＋CTC系（PaddleOCR） | 画像全体からトークン列を生成するSeq2Seq |
| モデル取得元 | Tesseractはtraineddataファイル配置、PaddleOCRは`external/PaddleOCR`のローカルチェックアウト | Hugging Face Hubからのモデルダウンロード（`from_pretrained()`） |
| PSM/Whitelist概念 | Tesseractのみ持つ | 概念自体が無い（ビームサーチ等の生成パラメータに置き換わる） |
| 信頼度（confidence） | 文字単位で取得可能（Tesseract/PaddleOCR） | 標準の`generate()`では文字単位confidenceは直接得られない（別途スコア計算の要検討＝未解決事項） |
| 多言語対応 | Tesseractは`base_lang`で切替可能 | 公式チェックポイントは英語のみ。日本語は非公式・未検証 |

---

## 各案比較

### A. 既存条件分岐拡張

`predict.py`・`ocr_evaluation.py`・学習ジョブ振り分け・`model_registry.py`・`release_gate.py`の5箇所それぞれへ、既存の`if/elif`パターンを踏襲して`trocr`分岐を追加する。Frontendも同様に、`InferenceView.jsx`等の既存ドロップダウン＋分岐へ選択肢を追加する。

### B. Recognizer Adapter導入

`predict.py`・`ocr_evaluation.py`・学習ジョブ振り分けを含む全経路を、共通の`Recognizer`インターフェース（例: `train()`/`recognize()`/`evaluate()`を持つ抽象クラスまたはProtocol）へ**リファクタリング**し、TrOCRを含む全4エンジンをこのAdapter経由に統一する。

### C. Engine Capability導入 + 限定Adapter

`benchmark.py`の`ENGINE_BUILDERS`/`ENGINE_CATALOG`と同型の「Engine Capability」テーブル（宣言的メタデータ: 学習可否・PSM/whitelist要否・チェックポイント形式等）を新設し、**既存3エンジンの`if/elif`は書き換えない**。TrOCR固有の学習・推論処理は`services/trocr_pipeline.py`（`tesseract_pipeline.py`と対になる新規モジュール）として独立実装し、推論（`recognize(image) -> (text, confidence)`という既存Benchmark Runner互換の最小インターフェース）だけを共通Adapter経由にする。あわせて`engineLabelOf()`/`resolveInferenceEngine()`/`_model_engine()`という**既存の3箇所のキャッチオール実装**を、この新しいCapabilityテーブル参照に置き換えて修正する（この修正は新エンジン追加以前から潜在していた欠陥の是正であり、TrOCR以外の既存エンジン表示にも安全側の効果がある）。

### D. TrOCR専用Backend

`predict.py`・`ocr_evaluation.py`等の既存コードには一切触れず、TrOCR用の完全に独立したエンドポイント・サービス・UI選択肢を新設する。共通化は将来の別Issueへ持ち越す。

E/F案: 現状分析の結果、A〜D以外に本質的に異なる統合方式は見当たらなかったため追加しない。ただし「学習経路をHugging Face Transformers経由にする」という決定（TrOCR特徴の節を参照）は、A〜Dいずれの案を選んでも共通して従うべき前提であり、案の軸とは別次元の決定事項として整理した。

## 比較表

| 観点 | A. 既存分岐拡張 | B. Recognizer Adapter | C. Capability + 限定Adapter | D. 専用Backend |
|---|---|---|---|---|
| 変更量 | 小（5箇所に分岐追加） | 大（既存3エンジンの動作経路を含む全面書き換え） | 中（新規モジュール追加＋3箇所のキャッチオール修正、既存分岐は不変） | 中〜大（新規モジュール一式だが既存コード非改変） |
| 回帰リスク | 中（分岐追加自体は小さいが、5箇所すべてに漏れなく追加する必要があり、抜け漏れリスクが実際に存在する＝release_gate.pyのような見落とされやすい箇所が現に存在した） | **高**（既存3エンジンが依存する`predict.py`等の動作経路そのものを変更するため、Tesseract/PaddleOCR/分類モデルへの回帰リスクが最大） | 低（既存分岐は無変更。新規追加分のみがリスク対象） | **最小**（既存コードに一切触れない） |
| 将来拡張性 | 低（同じパターンの重複がさらに増える） | 高（真に統一されたインターフェース） | 中〜高（Capabilityテーブルは他エンジンにも展開可能。ただし推論以外はAdapter化しない） | 低（TrOCR自体も次のエンジン追加時に同じ「専用Backend」を再度作ることになる） |
| 学習対応 | 可能（Trainerベースの新規コードを`if`節内に書く） | 可能（Adapter内に統一） | 可能（`trocr_pipeline.py`に閉じ込める） | 可能（専用モジュール） |
| 推論対応 | 可能 | 可能 | 可能（Benchmark Runner同型のAdapterを再利用） | 可能 |
| 評価対応 | `ocr_evaluation.py`へのTesseract専用ロジック解除が必要（現状PaddleOCRも未対応のため、TrOCR単独では解決しない構造的課題） | 同左（Adapter化すれば解決するが影響範囲が広い） | 同左（Capabilityで「評価対応エンジン」を宣言できるようにする程度に留め、`ocr_evaluation.py`の本格改修は別Issue） | 同左（専用評価経路を新設すれば解決するが既存評価との一貫性は無い） |
| Dataset/Experiment/Benchmark Center互換性 | 変更不要（いずれの案でも同じ。§現状分析のとおりこれらはengine非依存） | 同左 | 同左 | 同左 |
| Frontend分岐量 | 増加（3画面の重複パターンがさらに増える） | 減少（共通化すれば理論上は減る） | 現状維持〜微減（キャッチオール2箇所の修正のみ、UIの選択肢追加自体は他案と同程度必要） | 増加（4つ目の独立UIブロックが追加される） |
| テスト容易性 | 中 | 高（インターフェースが単純になるため） | 中〜高（`trocr_pipeline.py`単体でテスト可能） | 中（独立しているためテストしやすいが、他画面との整合性テストは別途必要） |
| 開発コスト（初期） | 低 | 高 | 中 | 中 |
| 開発コスト（TrOCR後にさらにエンジンを追加する場合） | 増加し続ける | 一定 | 緩やかに増加 | 増加し続ける |
| CLAUDE.mdの方針適合 | 適合（既存パターン踏襲を推奨する記述と一致） | **不適合**（「無関係なリファクタリングをしない」「大規模な変更では既存コードを流用できる部分を優先」という明文規定、およびEpicの対象外「既存OCRエンジンの全面置換」に抵触しうる） | 適合（既存分岐を保ったまま、実証済みの`ENGINE_BUILDERS`パターンを部分適用） | 適合（既存コード非改変という点で最も安全） |

---

## 推奨案

**案C（Engine Capability導入 + 限定Adapter）を推奨する。**

## 推奨しない案

- **案B**は不採用。既存3エンジンの動作経路そのものを書き換えるため回帰リスクが最も高く、Epicの対象外「既存OCRエンジンの全面置換」やCLAUDE.mdの「無関係なリファクタリングをしない」という明文規定と衝突する
- **案A**は不採用（次点）。初期コストは最小だが、5箇所すべてに追加が必要という構造自体が、今回の調査で実際に見つかった`release_gate.py`の独立した判定ロジックのような「見落とし」を将来また生む。加えて`engineLabelOf()`/`resolveInferenceEngine()`の既存キャッチオール欠陥を放置したままTrOCRを追加すると、**確実に**誤表示・誤ルーティングが発生する（推測ではなく確認済みの欠陥）
- **案D**は次点採用候補として残す。回帰リスクが最小という利点は大きいが、将来的なエンジン追加のたびに同じ重複が増える点で案Cに劣る。ただし、Investigation後の実装フェーズで「案Cのモジュール分割が難航する」場合の代替案として温存する

## 理由

1. **既存の実証済みパターン（`ENGINE_BUILDERS`）を転用でき、ゼロから設計しない** — CLAUDE.mdの「大規模な変更では、既存コードを流用できる部分を優先する」に最も忠実
2. **既存3エンジンの動作コードに触れないため、Epicの完了条件「既存OCRエンジンへ回帰がない」を構造的に満たしやすい**
3. **今回の調査で発見した既存の欠陥（PaddleOCRキャッチオール）を、TrOCR追加のついでではなく、Capability導入という土台の中で正面から修正できる** — これは新機能追加ではなく、既存機能の潜在バグ修正であるため、Epicの対象外「既存OCRエンジンの全面置換」には該当しない
4. **TrOCRの学習方式は他エンジンと本質的に異なる（外部プロセスではなくPython内Transformers呼び出し）ため、無理に共通Recognizerクラスへ押し込めるより、専用モジュール（`trocr_pipeline.py`）として独立させる方が「TrOCR固有仕様を既存エンジンへ押し付けない」というWork Itemの制約に合致する**

## 未解決事項

- TrOCR推論結果の文字単位confidence（既存UIのヒートマップ表示が前提とする情報）をどう算出するか（`generate()`のスコア出力から近似する等の追加調査が必要）
- 評価（`ocr_evaluation.py`）をTrOCR対応させるか、当面Benchmark Runner経由の比較のみに留めるか（PaddleOCRも同じ制約を抱えており、TrOCR固有の課題ではない）
- 日本語（および英数字以外）のTrOCR運用方針（非公式チェックポイントの採用可否、または見送り）
- Experiment Trackingの`training`サブオブジェクトに、epoch/loss推移など既存の予約フィールドで表現しきれない項目が必要か
- Windows環境での`transformers`＋モデルダウンロードの実地検証（本Investigationでは一次資料の確認のみで、実機検証は行っていない）
- モデルファイルサイズ（base=約0.3B params、safetensors形式）が`data/projects/<id>/models/`配下のディスク使用量・バックアップ運用に与える影響
- ライセンス表記の実務対応（MIT表示義務をどこに記載するか。配布Package（Deployment Package）に含める場合の要否）
