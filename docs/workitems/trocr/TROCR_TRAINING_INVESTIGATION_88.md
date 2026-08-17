# TrOCR Training Backend & Artifact Contract Investigation

Related: Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Investigation [#88](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/88) / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure） / ADR [0001](../../adr/ADR-0001_Trocr_Architecture.md)（TrOCR Architecture） / ADR [0002](../../adr/ADR-0002_Unified_Model_Metadata.md)（Unified Model Metadata） / Refactor [#53](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/53)（TrainingView Migration） / Feature [#85](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/85)（TrOCR UI Integration） / [ISSUE_MAP.md](ISSUE_MAP.md)

**本ドキュメントは調査のみを対象とする。Productionコード変更は一切行わない。**

**状態**: Implemented, PR review pending。

## 1. 目的

Epic #27の次フェーズ（TrOCR Training Backend実装）に着手する前に、既存Training基盤・TrOCR既存コード・Dataset/Artifact/Model Metadata/Experiment/Lineage契約・Training UI前提を実コードから再調査し、実装Issueへ安全に分割できる状態にする。Epic #27本文には`services/trocr_pipeline.py`を前提とする記述が残っているが、mainには存在しないため、推測で実装へ進まず契約を確定する。

## 2. 既存Training Call Graph（実コード確認済み）

### 2.1 共通の起点（Frontend）

`frontend/src/views/TrainingView.jsx`自体はAPIを呼ばず、`frontend/src/App.jsx`の`startOcrTraining()`（`App.jsx:3174`）が`ocrEngine`で分岐する。

- `tesseract` → `startTesseractTraining()`（`App.jsx:3123`）→ `POST /api/tesseract/train/start`
- `paddleocr` → `startPaddleOcrTraining()`（`App.jsx:3198`）→ `POST /api/ocr/train/start`
- それ以外（`easyocr`含む）→ APIを呼ばず`notify("error", "EasyOCR は学習対象外です。...")`で拒否（`App.jsx:3188-3191`）

### 2.2 Tesseract経路

```
main.py:3204 api_tesseract_train_start()
  → ensure_tesseract_training_tools()（未導入なら400）
  → upsert_training_job()（training_jobsテーブルへqueued挿入）
  → _spawn_training_runner("tesseract", job_id) [main.py:869]
      → subprocess.Popen([sys.executable, "-m", "src.app.job_runner", "tesseract", job_id])
job_runner.py:17-18 main() → main.py:2693 _run_tesseract_training_job(job_id)
  → upsert_training_job(status="running")
  → services/tesseract_pipeline.py:554 run_tesseract_training(...)
      → resolve_base_traineddata() / _read_dataset_pairs() / _generate_lstmf()
      → subprocess: combine_tessdata -e（LSTM抽出）
      → subprocess: lstmtraining --continue_from ...（fine-tune本体）
      → subprocess: lstmtraining --stop_training（traineddata書き出し）
      → tesseract_pipeline.py:686 register_tesseract_model()（定義:363）
          → atomic_write_json()で`<lang>.tess.json`を書込
          → experiment_tracker.record_experiment()で実験カルテ記録
  → upsert_training_job(status="completed", model_path=...)
```

成果物: `data/projects/<p>/models/tesseract_runs/<job_id>/{train,eval,checkpoints}`（作業）→ `data/projects/<p>/models/tesseract/<lang>/<lang>.traineddata`（最終）。メタJSON: `data/projects/<p>/models/<lang>.tess.json`（`atomic_write_json`）。

### 2.3 PaddleOCR経路

```
main.py:3062 api_ocr_train_start()
  → engine != "paddleocr" なら400（EasyOCR拒否の実体）
  → upsert_training_job() / build_training_condition_snapshot()
  → _spawn_training_runner("ocr", job_id)
job_runner.py → main.py:2594 _run_ocr_training_job(job_id)
  → upsert_training_job(status="running")
  → services/ocr_pipeline.py:1832 run_paddleocr_training(...)
      → train.txt/val.txt/test.txt自動分割
      → save_model_dir = models/ocr_runs/<job_id>
      → _build_train_command()でPaddleOCR公式tools/train.py引数を構築
      → subprocess.Popen(...)（ログ読み取り・OOM検知・batch自動縮小リトライ）
      → export_paddleocr_model()（inference用モデル書き出し）
      → _register_ocr_model()（定義:1641）
          → `<name>.ocr.json`をwrite_text()で書込（atomic_writeではない通常write_text）
  → upsert_training_job(status="completed", model_path=...)
```

成果物: `data/projects/<p>/models/ocr_runs/<job_id>/`（チェックポイント一式）+ `inference/`（`inference.pdmodel`/`.pdiparams`/`.yml`）。メタJSON: `data/projects/<p>/models/ocr_<engine>_<timestamp>.ocr.json`。

**確認できた事実（重要）**: `ocr_pipeline.py`内に`experiment_tracker.record_experiment()`呼び出しは見つからない（grep 0件）。Tesseractは実験カルテ記録が学習完了処理内にあるが、PaddleOCRは本調査の範囲では確認できなかった（既存の非対称性。本Issueでは修正しない）。

### 2.4 EasyOCR（学習非対応の表現箇所）

- Frontend: `engineRegistry.js:58-71`の`trainingSupported: false`
- Frontend: `App.jsx:3188-3191`（APIを呼ばず拒否）
- Backend: `main.py:3067-3069`（`engine != "paddleocr"`なら400。実効的なガードはここ）
- 宣言的（未接続）: `engine_capability.py`の`_easyocr_capability()`は`supports_training`を指定せずデフォルト`False`のまま。`main.py`は`engine_capability.py`/`engine_registry.py`をインポートしていない（実行時判定には使われていない）。

### 2.5 Job Lifecycle

- 永続化テーブル: SQLite `training_jobs`（`src/app/db.py:25-`。多数の`ALTER TABLE ADD COLUMN`によるMigration列）
- 状態遷移: `queued → running → completed/failed/stopped`（`upsert_training_job()`は単純UPSERT、状態遷移バリデーションなし）
- 多重起動防止: `_reject_if_training_active()`（同一project×同一training_familyでアクティブジョブがあれば409）
- キャンセル: `POST /api/ocr/train/stop/{job_id}` → `_stop_training_worker()`（`os.killpg`でプロセスグループへSIGTERM。`_spawn_training_runner`が`start_new_session=True`のため可能）
- 進捗: 構造化カラムなし。`log_path`への生ログ書き出しをフロントが正規表現パース（`trainingLog.js:71-121`。TesseractとPaddleOCR/EasyOCR系で異なるパターンを使用、Engine固有）
- 復旧: `_reconcile_ocr_training_job()`（PaddleOCR専用、`main.py:826-828`でTesseractは対象外）

**別系統の存在に注意**: `services/job_manager.py`（`JOB_TYPES`, `data/jobs/jobs.json`永続化）という汎用Job基盤も別途存在し、`_handle_training()`がTesseractの`run_tesseract_training()`を同一プロセス内スレッドで呼べる実装を持つが、これは`TrainingView.jsx`が実際に叩く経路（`_spawn_training_runner`のサブプロセス方式）とは別物。TrOCR学習を追加する際はどちらの系統に乗せるか明確化が必要（本Issueでは`_spawn_training_runner`系統への追加を推奨、既存2Engineと同じ経路のため）。

## 3. TrOCR既存コードの実態

- `src/app/services/trocr_engine.py`: 推論専用（`load()`/`predict()`/`predict_file()`のみ）。モジュールdocstringに「Dataset管理・学習・評価・...は責務外」と明記。
- **`src/app/services/trocr_pipeline.py`は存在しない**（grep・ファイル一覧で確認済み）。Epic #27本文・ADR-0001・ARCHITECTURE_DRAFT.md等での言及は一貫して「新設予定」「未着手（⬜）」として扱われている（矛盾ではない）。
- `VisionEncoderDecoderModel`/`AutoProcessor`の使用は`trocr_engine.py`内の推論用`from_pretrained()`呼び出しのみ。`Seq2SeqTrainer`/`Trainer`（transformers由来）はsrc配下に1件も存在しない。
- `requirements.txt`/`requirements-ci.txt`: `torch`/`transformers`のみ。学習に通常必要な`datasets`・`accelerate`は**未導入**。
- `engine_capability.py`の`trocr.supports_training=True`は「設計時点の想定値」（モジュールdocstring・description文字列双方に明記）であり実装状況を表さない。`engineRegistry.js`の`trainingSupported: false`が実際の現状を表す（両者は意図的に区別されている）。
- device/オフライン方針: `_resolve_device()`はCPU/CUDA明示指定または自動判定を許容し、CUDA要求時に実際に使えなければ黙ってCPUへフォールバックせず例外を送出。`local_files_only`はオプション（既定False）。既存呼び出し元（`predict.py`）はデフォルト値のまま使用。

## 4. Dataset Contract

- 生成箇所: `services/ocr_pipeline.py::create_ocr_dataset()`（1089-1297行目）。出力: `outputs/ocr_dataset/<timestamp>/{train,val,test}/images/*.png` + `train.txt`/`val.txt`/`test.txt`（タブ区切り`path\ttext`）+ `charset.txt` + `meta.json`（作成条件・分割数・前処理/augmentationハッシュ）。
- split: 画像単位のみ（`meta.json["split_method"]=="image"`、Series/グループ単位は未実装）。
- charset: `charset.txt`（1文字1行）。Tesseract/PaddleOCRの`character_dict_path`として使われる文字辞書であり、TrOCR（トークナイザベース）にそのまま使う契約は無い。
- 前処理/augmentationメタ: `training_preprocess`（学習時前処理の確定スナップショット＋ハッシュ）、`augmentation`（設定＋ハッシュ）を`meta.json`へ記録。学習Job開始時に`build_training_condition_snapshot()`で固定化。
- Dataset Registry/lineage: `services/dataset_registry.py`が`outputs/ocr_dataset*`を走査しDataset IDを採番（`data/dataset_ids.json`）。既知Issue #8（`training_jobs`テーブル未初期化）とは無関係（ファイルベースのみ）。
- **TrOCR Processorとの互換性についての所見（要検証・断定しない）**:
  1. 画像は`preprocess_ocr_image()`により強制グレースケール→固定キャンバス（既定48x320）へレターボックス整形（`ocr_pipeline.py:340,371`）。channels=3指定でもグレースケール値の複製のみで実カラー情報を持たない。TrOCRの`ViTImageProcessor`は通常カラー画像・別解像度を前提とするため、このCRNN向け固定整形をそのまま流用するとTrOCR側の前処理と二重になる可能性がある。
  2. Multi-engine Evaluation API（Issue #79）は既にこの問題を評価経路で回避済み（非Tesseractエンジンには`preprocess_ocr_image()`を適用しない設計、`evaluation_multi_engine.py`モジュールdocstring参照）。学習でも同じ判断（原画像を直接TrOCR Processorへ渡す）が整合的と考えられる。
  3. `train.txt`はファイルパス参照でありインメモリPIL Imageではないため、HF `datasets.Dataset`/`Seq2SeqTrainer`へ渡す前に「パス→画像読込→Processor適用」という薄い変換層（Dataset Adapter）が別途必要。
  4. `meta.json`のスキーマ自体はEngine非依存（画像+テキストペア形式）であり、ADR-0001も「Dataset側の変更は不要」と明記（Compatibility節）。**Dataset schema自体の変更は不要**という判断は本Issueでも踏襲する。

## 5. Training Artifact Contract

| | Tesseract | PaddleOCR | TrOCR（候補・未実装） |
|---|---|---|---|
| 作業/チェックポイント | `models/tesseract_runs/<job_id>/{train,eval,checkpoints}` | `models/ocr_runs/<job_id>/`（`.pdparams`等+`config.yml`） | `models/trocr_runs/<job_id>/checkpoints/`（HF Trainerの周期`save_pretrained()`想定） |
| 最終成果物 | `models/tesseract/<lang>/<lang>.traineddata`（単一ファイル） | `models/ocr_runs/<job_id>/inference/`（ディレクトリ） | `models/trocr_runs/<job_id>/final/`（`save_pretrained()`出力ディレクトリ想定） |
| メタJSON | `models/<lang>.tess.json`（`atomic_write_json`） | `models/ocr_<engine>_<ts>.ocr.json`（`write_text`） | 未定（6章参照） |
| 成果物の型 | 単一ファイル | ディレクトリ | ディレクトリ（`engineRegistry.js`の`downloadType: "directory_or_ref"`と整合） |

**「Model Registry」の実態**: `model_registry.py`は読み取り専用カタログ（`*.pt`/`*.ocr.json`/`*.tess.json`を`glob`で走査するのみ）。実際の「登録」（メタJSON新規書込）は`ocr_pipeline.py`/`tesseract_pipeline.py`が学習完了時に直接行っており、`model_registry.py`の関数を呼ぶわけではない。

## 6. Model Metadata / Epic #28 境界

- `ModelMetadataFactory.create_from_training()`（`training_metadata_factory.py:46-105`）は`ModelMetadata`の**生成のみ**（保存・探索はしない）。`engine_id="trocr"`は`engine_registry.py::resolve_engine_id()`で既に解決可能（Registry登録済み）。
- `MetadataWriter`（`metadata_writer.py`）は`<モデルファイル名>.model_metadata.json`という**単一ファイルsidecar**を前提とし、`ModelCatalog._scan()`（`model_catalog.py:82-121`）も`entry.is_file()`前提でディレクトリ走査しており、**「モデル=1ディレクトリ」という成果物には未対応**（現状は「モデル=1ファイル」前提）。
- `ModelsAPI`は`main.py`から一切importされておらず、HTTPエンドポイントへの配線もconsumer（`ocr_pipeline.py`/`tesseract_pipeline.py`からの呼び出し）も**ゼロ**（ADR-0002 Phase2「新規モデルのみ書込」は部品はあるが運用開始していない）。
- **結論**: 新Model Metadata層（`ModelMetadataFactory`/`MetadataWriter`/`ModelCatalog`）はTrOCRのディレクトリ成果物にそのまま使うには追加設計（ディレクトリ対応）が必要であり、かつ現状PaddleOCR/Tesseractもこの層に移行していない。**Epic #28の責務を本Issueで前倒しせず**、既存踏襲パターン（`.tess.json`/`.ocr.json`と同様の`.trocr.json`sidecarを、成果物ディレクトリの隣または管理JSON内に`model_dir`パスとして記録する形）を実装Issueの既定方針として推奨する。新Model Metadata層への移行はEpic #28再開後のFuture Workとする。

## 7. Experiment / Lineage

- `experiment_tracker.record_experiment()`はTesseract側（`register_tesseract_model()`内）から呼ばれる実績があるが、PaddleOCR側の学習完了処理内では確認できなかった（既存の非対称性、本Issueでは不問）。
- `dataset_registry.py::resolve_dataset_id_safe()`はEngine非依存で再利用可能。
- `training_jobs`テーブルの`training_condition_snapshot`（前処理/augmentationスナップショットJSON）・`experiment_meta`（experiment_name/parent_model_id/training_note）列は既存カラムのままTrOCRでも再利用できると考えられる（Tesseract/PaddleOCR共通の枠組み）。

## 8. Training UI Preconditions

- `engineRegistry.js`の`trocr`エントリ: `trainingSupported: false`/`trainingSelectable: false`（コメント: 「TrOCR学習はBackend未実装のため現状false（Epic #27完了後に見直す）」）。
- `TrainingView.jsx`はこれらのフラグのみを参照し、OCRタイプ選択肢（`getTrainingSelectableEngines()`）・実行操作ブロックの表示（`isEngineTrainingSupported()`）・エンジン固有設定パネル（`getEngineTrainingPanel()`）のすべてがRegistry駆動のため、**Backend実装後はRegistry値を変更するだけでUI導線自体は自動的に有効化される設計になっている**（TrainingViewの構造自体を変更する必要はない）。
- 新設が必要になるのはTrOCR専用の設定パネル本体（`getEngineTrainingPanel()`が返す新しい`"trocr"`値に対応するJSXブロック）のみ。既存PaddleOCRパネルの構成から類推される入力項目候補（実装しない、列挙のみ）: Base Model/初期化方式、バッチサイズ・ワーカー数、AMP等の最適化フラグ、charset・max_text_length（要否は要検討）、画像形状、実験名・親モデル・学習メモ、実行プロファイル。

## 9. Architecture Questions（回答）

1. **既存`job_runner`へ追加できるか** — できる。`job_runner.py`へ`trocr`という第三の`job_type`分岐を追加し、`training_jobs`テーブル（`engine="trocr"`）・`_spawn_training_runner`・`_stop_training_worker`・ログポーリングUIをそのまま再利用できる。**ただし学習処理自体を独立したサブプロセスとして起動する設計が前提**（`os.killpg`によるキャンセルが機能するため。プロセス内スレッド実装だとSIGTERMが効かない）。
2. **新規`trocr_training.py`等の専用serviceが必要か** — 必要。既存の汎用Trainer抽象化は無く、PaddleOCR/Tesseractそれぞれが完全にEngine固有の実装（サブプロセスコマンド構築）を持つ。Epic #27本文が既に前提とする`services/trocr_pipeline.py`という名称をそのまま採用するのが自然。
3. **Dataset adapterは必要か** — 必要（Engine非依存のDataset schema自体の変更は不要）。`train.txt`/`val.txt`をパースし画像を読み込んでHF Processorへ渡す薄い変換層を新設する。画像前処理は既存のTesseract/PaddleOCR向け固定キャンバス（`preprocess_ocr_image()`）を経由せず、原画像を直接TrOCR Processorへ渡す方針を推奨（Issue #79の判断と整合）。
4. **Hugging Face Trainerを直接利用するか、独自loopが必要か** — 本Investigationでは未確定（実装Issューで判断）。`Seq2SeqTrainer`利用には`datasets`/`accelerate`という新規依存追加が必要（現状requirements.txtに無い。新規依存追加は原則避ける方針との兼ね合いを実装Issueで検討）。独自loopは依存追加を避けられるが実装・保守コストが増える。
5. **checkpoint/final modelの保存契約は何か** — 5章の表のとおり、`models/trocr_runs/<job_id>/{checkpoints,final}`という新規ディレクトリ契約を提案（PaddleOCRのディレクトリ成果物パターンを踏襲）。
6. **`ModelMetadataFactory`を利用可能か** — 生成だけなら可能だが、`MetadataWriter`/`ModelCatalog`はディレクトリ成果物に未対応のため、実装Issueでは新層を使わず既存`.tess.json`/`.ocr.json`踏襲パターン（`.trocr.json`sidecar）を推奨。新層への移行はEpic #28再開後のFuture Work。
7. **Experiment/Dataset lineageへ既存方式で記録可能か** — dataset lineageは既存関数（`resolve_dataset_id_safe()`）で可能。experiment記録はTesseractの`record_experiment()`呼び出しパターンを踏襲することを推奨（PaddleOCR側の欠落は本Issueでは不問・別途記録のみ）。
8. **training cancel/progressを既存job lifecycleで表現できるか** — できる。ただし学習をサブプロセスとして実装する場合に限る（Q1参照）。進捗はログのテキストパース方式（Engine固有正規表現）を踏襲する。
9. **Windows/CPU環境で最低限どこまで保証するか** — 本Investigationでは未回答（実学習・ベンチマークを伴うため対象外、Issueの制約どおり）。実装Issueで少量データでの実行時間計測を行い判断する必要がある（Risk参照）。
10. **Training UIを有効化するためのBackend completion条件は何か** — (a) Backend学習エンドポイント・job種別が実装され、start→progress→complete→artifact→metadata登録のフルサイクルが検証済み、(b) `TrainingView.jsx`にTrOCR専用設定パネルが実装済み、(c) 成果物のModel Registry登録方式（Q6）が実装され、他画面（ModelsView/InferenceView/OcrEvaluationView）から発見・利用可能、の3条件がすべて揃った時点で`engineRegistry.js`の`trainingSupported`/`trainingSelectable`を`true`へ変更する。

## 10. 実装Issue分割案（推奨順序）

「1 Issue = 1つの明確な完了条件」「調査と実装を混在させない」「共通基盤とTrOCR固有処理を区別する」という既存の分割ルール（ISSUE_MAP.md）に従い、以下の順序を提案する。

1. **Feature: TrOCR Training Dataset Adapter** — 既存Dataset出力（`train.txt`/`val.txt`+`meta.json`）からHF Processor消費可能な形式への変換ロジックのみ（job/Trainer配線なし）。画像前処理バイパス方針（Q3）をここで確定・実装
2. **Feature: TrOCR Training Backend Core（`services/trocr_pipeline.py`）** — Trainer方式（Q4）を決定し、fine-tuning本体を実装。まだjob_runner/DB/UIへは配線せず、単体でテスト可能なService関数として実装（Feature #16のTrOCR単画像推論コアと同じ段階分け）
3. **Feature: TrOCR Training Job Integration** — #2を`job_runner.py`/`main.py`へ配線（新規エンドポイント・DB engine="trocr"対応・キャンセル・ログ・復旧）
4. **Feature: TrOCR Training Artifact Registration** — 成果物のメタデータ登録方式（Q6の`.trocr.json`sidecar案）・Dataset/Experiment lineage記録（Q7）を実装
5. **Feature: TrOCR Training UI** — `engineRegistry.js`の`trainingSupported`/`trainingSelectable`を`true`化、`TrainingView.jsx`へTrOCR専用設定パネル追加（Q10の完了条件を満たした段階）

Benchmark Runner連携（ISSUE_MAP Phase6）は上記Trainingの完了を前提とする別トラックのため、この分割には含めない。

## 11. Risks / Dependencies

- **新規依存パッケージ**: `Seq2SeqTrainer`方式を選ぶ場合、`datasets`・`accelerate`の追加が必要（現状未導入）。「新規依存パッケージの追加は原則避ける」という既存方針との整合を実装Issueで明示的に判断する必要がある。
- **CPU学習の実用性**: Windows/CPU環境でのTrOCR fine-tuningは他エンジンより重い可能性が高い（未検証、本Investigationの対象外）。
- **画像前処理の二重適用**: 既存Dataset生成が行うCRNN向け固定グレースケール整形をそのまま使うと、TrOCR自身のProcessorの正規化と衝突する可能性がある（4章参照）。
- **Model Metadataのディレクトリ成果物未対応**: 新層（`ModelCatalog`等）を使う場合は追加設計が必要（6章参照）。
- **キャンセル機構の前提**: サブプロセス方式を採らない実装（プロセス内スレッド等）を選んだ場合、既存の`_stop_training_worker()`（killpg方式）がそのまま使えない。

## 12. Epic #27 / ISSUE_MAP更新内容

本Issueの完了に伴い、以下を更新する（Productionコード変更ではなくドキュメント更新のみ）。

- `docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`: Multi-engine API Integration（Feature #79）をCompleted、Evaluation UI Integration（Epic #46経由でFeature #83/#85完了）を反映、本Investigation（#88）の完了と実装Issue分割案を追記
- `docs/workitems/trocr/ISSUE_MAP.md`: Phase4「TrOCR Training」の行を本Investigationの結論（10章の分割案）へ更新、Investigation #88を「現在作成するIssue」へ追加

## Required Verification

Productionコード変更なし。既存testsは変更していないため実行不要（`git status`で`src/app/`・`frontend/src/`配下に差分が無いことで確認）。新しいTrainer/model download/GPU学習は実施していない。
