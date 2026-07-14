# 07. データベース・永続化

## 概要

- RDB は **SQLite** のみ（学習ジョブ専用）。ORM・マイグレーションツールは不使用。
- それ以外のデータはすべて**ファイルベース**（CSV / JSON / JSONL / 画像）。

## SQLite

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
| 区別列 | `training_family`（classification / ocr）、`engine`（paddleocr / tesseract 等） |
| シリアライズ | `image_shape` 等の list/dict は JSON 文字列で格納し、読出時に復元 |

分類・PaddleOCR・Tesseract の全学習ジョブがこの1テーブルに保存される。

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
| データセットメタ | `dataset/build_meta.json` ほか | JSON | `services/dataset_builder.py` |
| サムネイルキャッシュ | （元画像mtimeキーのディスクキャッシュ） | PNG/JPEG | `main.py` サムネイルエンドポイント |

## ブラウザ側の保存

- localStorage / sessionStorage を UI設定・セッション状態に使用（一覧は `docs/08_CONFIGURATION.md` を参照）。
- OCR候補辞書の内容（テキストファイル全エントリ）も localStorage にプロジェクト別保存される。

## このプロジェクトで確認できないもの

- 外部RDB（PostgreSQL/MySQL等）、Redis、ORM（SQLAlchemy等）、Alembic等のマイグレーションツール
