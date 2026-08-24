# 07. データベース・永続化

## 概要

- RDB は **SQLite 2種類**（Job System A: `outputs/app.db`／Job System B: `data/jobs/job_manager.db`）。両者は意図的に別ファイル・別テーブルへ分離されている（Job Lifecycle Unification Architecture Investigation #123〜#135の結論。詳細は `docs/01_ARCHITECTURE.md`・`docs/18_JOB_MANAGEMENT.md`）。ORM・マイグレーションツールは不使用。
- それ以外のデータはすべて**ファイルベース**（CSV / JSON / JSONL / 画像）。

## SQLite: Job System A（`outputs/app.db`）

| 項目 | 内容 |
|---|---|
| ファイル | `outputs/app.db`（`settings.yaml` の `app.db_path`） |
| 接続 | `src/app/db.py` の `get_conn()`（`sqlite3` 標準ライブラリ直接使用） |
| 初期化 | `init_db()`（FastAPI startup で実行） |
| ORM | 不使用（素のSQL） |
| マイグレーション | ツール不使用。`init_db()` 内の `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` による後方互換的な列追加 |

### テーブル: `training_jobs`（唯一のテーブル）

| 特徴 | 内容 |
|---|---|
| 主キー | `id`（ジョブID） |
| 書込 | `upsert_training_job()`（`INSERT ... ON CONFLICT(id) DO UPDATE`） |
| 読出 | `fetch_training_job(job_id)` |
| 削除 | `delete_training_jobs_by_project(project_id)`（プロジェクト削除時） |
| 区別列 | `training_family`（classification / ocr）、`engine`（paddleocr / tesseract / trocr 等） |
| シリアライズ | `image_shape` 等の list/dict は JSON 文字列で格納し、読出時に復元 |
| 実験情報 | `experiment_meta`（JSON文字列・NULL可）: Tesseract学習開始時の `experiment_name` / `parent_model_id` / `training_note` を保持し、ジョブ完了時にモデルメタ（`.tess.json`）へ引き継ぐ |
| 学習前処理・オーグメンテーションのスナップショット（v1.0.0で追加） | `training_condition_snapshot`（JSON文字列・NULL可）: `/api/tesseract/train/start`・`/api/ocr/train/start` が**Job作成時点**でデータセットのmeta.jsonから組み立てて保存する（`{trainingPreprocess: {display, effective, hash}, augmentation: {display, effective, hash}, trainingInputPipelineHash}`）。学習中の設定変更・失敗Jobでも当時の実行条件を追跡できるようにするための列で、学習完了時にモデルメタ（`.tess.json`）へそのまま引き継ぐ（Jobレコードが無い/未記録の場合はデータセットmeta.jsonから直接導出するフォールバックあり） |

分類・PaddleOCR・Tesseract・TrOCR の全学習ジョブがこの1テーブルに保存される（`python -m src.app.job_runner <classification|ocr|tesseract|trocr> <job_id>` が別プロセスとしてこのDBを更新する）。

### startup reconciliation

FastAPI起動時に、Backend異常終了等で`running`のまま残ったJobを走査し、実プロセス（`worker_pid`）が生存しているか確認する。生存していなければ`interrupted`（UI表示「中断（再起動）」）へ回収し、`running`のまま永続表示され続けることを防ぐ（Tesseract/PaddleOCR/TrOCR/分類のいずれの`training_family`/`engine`も対象。詳細: `docs/workitems/jobs/TRAINING_JOB_STARTUP_RECONCILIATION_125.md`）。

## SQLite: Job System B（`data/jobs/job_manager.db`）

| 項目 | 内容 |
|---|---|
| ファイル | `data/jobs/job_manager.db`（Feature #127で`data/jobs/jobs.json`から移行済み。旧JSON実装は移行importにのみ残る） |
| journal mode | **WAL**（`JobRepository._connect()`が毎回`PRAGMA journal_mode=WAL`を設定） |
| 接続 | `src/app/services/job_manager.py`の`JobRepository`（呼び出しごとに新規`sqlite3.connect()`。永続共有コネクションは持たない） |
| テーブル | `job_manager_jobs`（Job本体）・`job_manager_counter`（採番カウンタ、旧`jobs.json`の`counter`は初回起動時に一度だけimport）・`job_manager_config` |
| 対象job_type | `preprocess` / `dataset_creation` / `training` / `evaluation` / `benchmark` / `deployment_export` / `report_generate`（`POST /api/jobs`経由。詳細: `docs/18_JOB_MANAGEMENT.md`） |
| 実行方式 | Backend内のバックグラウンドスレッド（`JobManager`/`JobWorker`）。Job System Aのような別プロセス（`Popen`）ではない |
| 排他制御 | プロセス内RLock＋プロセス間ファイルロック（`atomic_io.file_lock`、`job_manager.db.lock`） |

Training Job（`training_jobs`テーブル・`outputs/app.db`・Job System A）とは**意図的に別のSQLiteファイル**へ分離されている（Architecture Investigation #123で指摘された誤統合リスクを避けるため）。統一Facadeへの移行は行わない（Issue #135の結論、詳細は`docs/workitems/jobs/SHARED_JOB_FACADE_READINESS_135.md`）。

## Global SQLite Online Backup / Restore（`services/sqlite_backup.py`）

project単位のバックアップ（`backup_manager.py`、後述）とは別に、上記2つのGlobal SQLite（`outputs/app.db`・`data/jobs/job_manager.db`）専用のOnline Backup/Restore機構がある（Issue #147/#162）。UI/APIは無く、Python関数として運用スクリプト/CLIから呼び出す想定。

| 関数 | 内容 |
|---|---|
| `backup_app_db()` / `backup_job_manager_db()` | `sqlite3.Connection.backup()`（SQLite公式Online Backup API）を使用。**Backend稼働中でも安全**（WALモードの`job_manager.db`で、単純なファイルコピーでは直近のコミット済みデータが`-wal`ファイル側に残ったまま欠落しうることをInvestigation #143で実証済み。このAPIはjournal modeに関わらず一貫したsnapshotを取得できる）。保存先は`data/backups/system/` |
| `restore_app_db()` / `restore_job_manager_db()` | **Backend停止済みであることが前提**（Issue #162）。復元先に既存の`-wal`/`-shm`が残っていると、単純なファイル置換だけでは古いWALが誤って適用され復元データが見えないsilent failureになることを実証済みのため、置換前に対象の`-wal`/`-shm`を削除し、復元前のtarget状態を自動保全した上で、復元後の`PRAGMA quick_check`・期待テーブル存在確認に失敗した場合は自動的にロールバックする |

手順の詳細（preflight・Backend停止要否・WAL/SHM handling・post-restore verification・failure時のrollback）は `docs/BACKUP_AND_RESTORE.md`・`docs/25_DISASTER_RECOVERY.md`・`docs/workitems/reliability/SQLITE_GLOBAL_DB_RESTORE_RUNBOOK_162.md` を参照。

### その他の全体共有ファイル

| ファイル | 内容 |
|---|---|
| `data/model_ids.json` | モデル管理Noの登録簿（`{"counter": n, "models": {"<project_id>/<モデル名>": "M0001"}}`。全プロジェクト共通・削除後も番号を再利用しない） |
| `data/dataset_ids.json` | Dataset管理Noの登録簿（`DS0001`形式。全プロジェクト共通・削除後も再利用しない） |

## ファイルベースの永続化

すべて `data/projects/<project_id>/` 配下（プロジェクト単位で分離）:

| データ | ファイル | 形式 | 読み書き |
|---|---|---|---|
| ラベル | `annotations/master.csv` | CSV（`filename,label,type`） | `services/labels.py` |
| 手動マスク | `annotations/manual_masks.json` | JSON（画像名→マスク配列。矩形=正規化座標、領域=行RLE） | `services/manual_mask.py` |
| OCR推論ログ | `outputs/ocr_logs/predictions.jsonl` | JSONL | `services/ocr_pipeline.py`（`save_ocr_prediction_log`） |
| 分類モデル | `models/<type>_<timestamp>.pt` | PyTorch checkpoint（state_dict + classes + メタ） | `train.py` |
| PaddleOCRモデル | `models/*.ocr.json` + `models/ocr_runs/<job_id>/inference/` | メタJSON + inferenceモデル | `services/ocr_pipeline.py` |
| Tesseractモデル | `models/<lang>.tess.json` + traineddata | メタJSON + traineddata | `services/tesseract_pipeline.py` |
| TrOCRモデル | `models/*.trocr.json` + `models/trocr_runs/<job_id>/`（`save_pretrained()`一式） | メタJSON + モデルディレクトリ | `services/trocr_model_registry.py`・`services/trocr_training_core.py` |
| データセットメタ | `dataset/build_meta.json` ほか | JSON | `services/dataset_builder.py` |
| サムネイルキャッシュ | （元画像mtimeキーのディスクキャッシュ） | PNG/JPEG | `main.py` サムネイルエンドポイント |

## ブラウザ側の保存

- localStorage / sessionStorage を UI設定・セッション状態に使用（一覧は `docs/08_CONFIGURATION.md` を参照）。
- OCR候補辞書の内容（テキストファイル全エントリ）も localStorage にプロジェクト別保存される。

## このプロジェクトで確認できないもの

- 外部RDB（PostgreSQL/MySQL等）、Redis、ORM（SQLAlchemy等）、Alembic等のマイグレーションツール
