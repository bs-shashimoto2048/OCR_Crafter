# Model Metadata 設計

Related: Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) / Parent Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) / [ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)（Status: Accepted）/ [ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](ENGINE_REGISTRY.md)

## 目的

学習済みOCRモデルの管理情報を、エンジン共通の1つのスキーマとして保持できるようにする。[ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)冒頭で定義したとおり、**Metadataは「ある1つの学習済みモデルが実際に何であるか」（動的・モデルインスタンス単位）を表す。**

**本設計もTrOCR専用ではない。** 既存4種（Tesseract/PaddleOCR/EasyOCR/カスタム分類）＋将来のPARSeq/ABINet/ViTSTR/SVTR/Florence/Qwen-VL OCR等を見据える。

## 設計方針：既存ファイル形式は変更しない

CLAUDE.mdの「プロジェクト互換性」原則（出力形式・プロジェクト構成の後方互換維持）に従い、**既存の`.pt`/`.ocr.json`/`.tess.json`のスキーマ・保存場所は本Issueでは一切変更しない。** 以下のスキーマは、①新規エンジン（TrOCR以降）が使う保存形式の設計、②将来的に既存3形式を包含する上位概念としての整理、の2つの目的を持つ設計であり、既存ファイルの移行（マイグレーション）は本Issueのスコープ外とする。

---

## スキーマ

| フィールド | 型 | 説明 |
|---|---|---|
| `engine` | `str` | [ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)の`engine_id`と一致する識別子 |
| `engine_version` | `str` | このモデルを生成した時点のエンジン実装（アダプタコード）バージョン |
| `framework` | `str` | 基盤フレームワーク名（`ENGINE_CAPABILITY.md`の`framework`と通常一致するが、将来同一エンジンが複数フレームワーク実装を持つ場合に備え、モデル単位でも保持する） |
| `architecture` | `str` | モデルアーキテクチャ名（例: `"vit-encoder+roberta-decoder"`, `"crnn"`, `"lstm"`） |
| `processor` | `dict \| None` | 画像前処理・トークナイズ処理の設定（HF系の`TrOCRProcessor`相当）。エンジンがこの概念を持たない場合は`null` |
| `tokenizer` | `dict \| None` | トークナイザ情報（語彙サイズ・特殊トークンID等）。文字ベース認識（Tesseract等）では`null` |
| `checkpoint` | `dict` | モデル実体への参照。`{"path": str, "format": str, "sha256": str \| None}` |
| `language` | `list[str]` | このモデルが実際に学習された言語（[ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)の`supported_languages`＝エンジンの理論的能力とは別） |
| `charset` | `str \| None` | このモデルの実際の学習対象文字集合 |
| `license` | `str \| None` | このモデル（チェックポイント）自体のライセンス（エンジン実装のライセンスとは別軸） |
| `training_config` | `dict` | 学習時の実際のパラメータ（イテレーション数/エポック数、学習率、バッチサイズ等。エンジンごとに項目が異なるため自由形式dict） |
| `dataset` | `dict` | `{"dataset_id": str, "dataset_name": str, "dataset_hash": str}`（既存のDataset Manager連携フィールドと同型） |
| `experiment` | `dict` | `{"experiment_id": str}`（既存のExperiment Tracker連携フィールドと同型） |
| `metrics` | `dict \| None` | 評価済みであれば最新の評価結果サマリー（CER等）。未評価なら`null`（推測補完しない） |
| `created_at` | `str` (ISO8601) | 作成日時 |
| `updated_at` | `str` (ISO8601) | 最終更新日時 |
| `ocr_version` | `str` | このメタデータレコードが準拠するスキーマバージョン（本設計自体のバージョニング用） |
| `export_format` | `str \| None` | エクスポート済みの場合の形式（[ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)の`supported_export_formats`のうち実際に使われたもの） |
| `model_format` | `str` | 保存ファイル形式（例: `"pytorch_pt"`, `"paddle_inference"`, `"tess_traineddata"`, `"safetensors"`） |

---

## 既存4エンジンでの適用可能性比較

| フィールド | Tesseract | PaddleOCR | EasyOCR | カスタム分類 | 備考 |
|---|---|---|---|---|---|
| `engine` | ○（現状ハードコード`"tesseract"`） | ○（現状JSON内実フィールド） | −（学習なし、モデルファイル自体が存在しない） | ○（現状ハードコード`"custom"`） | 既存はハードコード/実フィールドが混在。本設計では全エンジンとも実フィールドとして持たせる方針 |
| `engine_version` | △（未実装。新規追加項目） | △（未実装） | − | △（未実装） | 既存にはこの概念が無い。追加してもデータ互換性は壊れない（新規フィールドの追加のみ） |
| `framework` | ○（`""`または`"tesseract-native"`） | ○（`"paddlepaddle"`） | − | ○（`"pytorch"`） | |
| `architecture` | ○（`"lstm"`） | ○（PaddleOCR側のモデル種別） | − | ○（`"cnn"`等、既存`model_type`相当） | |
| `processor` | −（概念なし。`null`） | −（`null`） | − | −（`null`） | **TrOCR/Florenceで初めて意味を持つフィールド** |
| `tokenizer` | −（`null`） | −（`null`） | − | −（`null`） | 同上 |
| `checkpoint` | ○（`traineddata_path`が相当） | ○（`inference_dir`/`model_dir`が相当） | −（固定の同梱モデルのため管理対象外） | ○（`.pt`ファイル自体） | 既存はフィールド名がバラバラ（`traineddata_path` vs `model_dir`）。本設計で統一名`checkpoint`に集約する提案 |
| `language` | ○（`base_lang`が相当） | △（現状明示的な言語フィールドは無く、charsetから間接的にしか分からない） | ○（起動時の言語リスト） | −（言語非依存） | |
| `charset` | ○（既存フィールドそのまま流用可） | ○（既存フィールドそのまま流用可） | − | −（分類ラベルであり文字集合の概念とは異なる） | |
| `license` | △（未実装。エンジン共通のためモデル単位では通常同一値） | △（未実装） | − | △（未実装） | 新規追加項目。**TrOCRのような第三者チェックポイント配布があるエンジンで初めて実用的に意味を持つ** |
| `training_config` | ○（`max_iterations`/`psm`等が相当） | ○（`ocr_training_params`が相当） | − | ○（`epochs`/`batch_size`等が相当） | 既存はフィールド名・構造がエンジンごとに異なる。本設計では自由形式dictのまま許容し、無理に統一スキーマへ押し込めない（[現状]参照） |
| `dataset` | ○（既存`dataset_id`/`dataset_name`） | ○（同左） | − | △（現状分類モデルはDataset Manager非連携。現状分析で確認） | |
| `experiment` | ○（既存Experiment Tracker連携） | △（現状Experiment Trackerへ記録しているのはTesseractのみ。Investigationで確認済み） | − | − | |
| `metrics` | ○（評価履歴と連携） | △（`ocr_evaluation.py`がTesseract専用のため、PaddleOCRは評価未対応＝`null`になりがち） | − | ○（分類の評価結果） | |
| `created_at`/`updated_at` | ○ | ○ | − | ○ | 既存も同等のタイムスタンプを持つ |
| `ocr_version` | −（未実装） | −（未実装） | − | −（未実装） | 新規追加項目 |
| `export_format` | −（Tesseractはtraineddata自体がそのままエクスポート形式のため概念上不要） | ○（`paddle_inference`） | − | −（エクスポート機能なし） | |
| `model_format` | ○（`"tess_traineddata"`相当） | ○（`"paddle_inference"`相当） | − | ○（`"pytorch_pt"`相当） | |

**凡例**: ○=既存に相当するフィールドがある（名称は異なりうる） / △=部分的・不完全 / −=概念自体が無い（該当なしとして`null`扱い）

## TrOCRで必要になる項目（新規性の高いもの）

- `processor`・`tokenizer`: TrOCRは`TrOCRProcessor`（画像プロセッサ＋トークナイザの合成）を持つため、既存4種の中で唯一これらのフィールドが実質的な値を持つ
- `license`: TrOCRエンジン自体はMIT（Microsoft `unilm`）だが、Hugging Face Hub上の個別チェックポイント（特に第三者ファインチューン版）はモデルごとに異なるライセンスを持ちうるため、モデル単位でのライセンス保持が初めて実用上重要になる
- `checkpoint.format`: `"safetensors"`または`"pytorch_bin"`という、既存3エンジンのいずれとも異なる形式が入る
- `language`: 公式チェックポイントは英語のみのため、当面`["en"]`固定になる想定（[ADR-0001](../adr/ADR-0001_Trocr_Architecture.md)の未解決事項「日本語対応方針」と連動）

---

## 現状

既存3エンジン（EasyOCRは学習しないため対象外）は、それぞれ独立したJSON/バイナリ形式でメタデータ相当の情報を保持しており、フィールド名・構造が統一されていない（例: モデル実体へのパスが`traineddata_path`（Tesseract）と`model_dir`/`inference_dir`（PaddleOCR）で別名）。

## 課題

- 新エンジン追加のたびに、そのエンジン固有のメタデータ形式を新設する必要がある
- `processor`/`tokenizer`のような、Transformer系エンジンで初めて必要になる概念の置き場所が既存スキーマに無い
- モデル単位のライセンス管理という概念が現状存在しない（既存3エンジンでは実務上問題にならなかったが、TrOCR以降は第三者配布チェックポイントを扱う可能性がありモデル単位のライセンス追跡が必要になる）

## 設計案

上記の統一スキーマを新規エンジン（TrOCR以降）向けの標準形式として採用し、既存3エンジンの実装（`.tess.json`/`.ocr.json`/`.pt`のメタデータ部分）はそのまま維持する。[ENGINE_REGISTRY.md](ENGINE_REGISTRY.md)の`MetadataProvider`が、エンジンごとに異なる実ファイル形式と、本スキーマとの変換（読込時のみ）を担う。

## メリット

- Model Manager UI等の共通表示ロジックが、エンジンごとの生データ形式を意識せず本スキーマだけを参照すればよくなる
- ライセンス・トークナイザ情報等、既存にない概念を持つ将来エンジンにも自然に対応できる
- `required_metadata`/`optional_metadata`（[ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md)参照）と組み合わせることで、モデルレコードの整合性を機械的に検証できる

## デメリット

- 既存3エンジンの実データを本スキーマへ変換するアダプタ層が必要になり、変換ミスによる表示不整合のリスクがある
- `training_config`のような自由形式dictを許容する部分は、統一の恩恵が限定的（結局エンジンごとに中身がバラバラ）
- スキーマのバージョニング（`ocr_version`）を今後どう運用するか（後方互換をどう保証するか）は本Issueで詳細を詰めきれていない

## 採用理由

CLAUDE.mdの「出力形式（master.csv・モデルメタ・CSVエクスポート等）の後方互換維持」という原則を守りながら、新規エンジンには統一的な形式を提供できる現実的な折衷案であるため。既存データへの移行を強制しない設計により、Investigationで確認した「既存プロジェクトを壊さない」という制約を最初から満たす。

## 将来影響

- 既存3エンジンをこのスキーマへ移行するかどうかは、実装Issue（[ISSUE_MAP.md](../workitems/trocr/ISSUE_MAP.md)のPhase2以降）で個別に判断する
- `license`・`processor`・`tokenizer`といった新規フィールドは、Model Manager UI（モデルカルテ）に表示欄を追加する際、既存フィールドが無いモデル（Tesseract/PaddleOCR/分類モデル）では「該当なし」として表示し、推測で埋めない設計にする必要がある
