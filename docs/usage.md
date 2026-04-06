# OCR Crafter 利用ガイド

このドキュメントは、`ocr_crafter` のローカルOCR学習環境（数字認識）を動かすための手順書です。

## 1. 前提

- macOS（Apple Silicon）
- Python 3.11 以上
- Node.js / npm

確認コマンド:

```bash
python3.11 --version
node --version
npm --version
```

## 2. 初回セットアップ

プロジェクトルートで実行:

```bash
cd /Users/hashimoto/vscode/_app/ocr_crafter
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

フロントエンド依存:

```bash
cd frontend
npm install
```

## 3. 起動方法

### 3.1 バックエンド（FastAPI）

```bash
cd /Users/hashimoto/vscode/_app/ocr_crafter
source .venv/bin/activate
uvicorn src.app.main:app --reload --port 8011
```

ヘルスチェック:

```bash
curl http://127.0.0.1:8011/health
```

### 3.2 フロントエンド（React + Vite）

```bash
cd /Users/hashimoto/vscode/_app/ocr_crafter/frontend
echo 'VITE_API_BASE=http://127.0.0.1:8011' > .env
npm run dev
```

ブラウザで表示されたURL（通常 `http://127.0.0.1:5173`）を開きます。

## 4. 典型的な運用フロー

1. プロジェクト選択 / 作成 / 削除  
画面右上の `Project` セレクタで切替、`Create` で新規作成、`Delete` で削除します。  
データは `data/projects/<project_id>/` に分離保存されます。

2. 画像取り込み  
`Browse` でローカルのフォルダ選択ダイアログを開いてパスを入力欄に反映し、`Import` を実行します。  
画像は `data/projects/<project_id>/raw/` にコピーされます。

Images一覧では、プレビューがアスペクト比維持（全体表示）になっています。  
各画像カードの `Rotate L` / `Rotate R` で90度単位の回転が可能です。

3. ラベル編集  
画像一覧で各ファイルにラベル（数字）を入力し `Save`。  
保存先は `data/projects/<project_id>/annotations/master.csv`。

4. 前処理  
`Preprocess` を実行。  
出力:
- `data/projects/<project_id>/interim/`（前処理済み画像）
- `data/projects/<project_id>/processed/`（正規化済みテンソル `.pt`）

5. データセット生成  
`Build Dataset` を実行。  
`train/val/test` に分割して `data/projects/<project_id>/dataset/` に出力されます。

6. 学習  
`Model`（`square` / `wide`）、`Epochs`、`Batch` を設定し `Train`。  
非同期ジョブで実行され、状態は画面上の `status` に反映されます。

7. 推論  
学習後、API `POST /predict` で画像を送ると数字推論結果を返します。  
モデルは `data/projects/<project_id>/models/` の最新ファイルを自動利用します。

## 5. API一覧（主要）

- `GET /health`
- `GET /projects`
- `POST /projects`
- `DELETE /projects/{project_id}`
- `POST /dialogs/select-directory`
- `POST /images/import`（body: `project_id`）
- `GET /images?project_id=...`
- `POST /images/{image_name}/rotate?project_id=...`（body: `angle`）
- `POST /preprocess/run`（body: `project_id`）
- `GET /labels?project_id=...`
- `PUT /labels/{image_name}?project_id=...`
- `POST /dataset/build`（body: `project_id`）
- `POST /train/start`（body: `project_id`）
- `GET /train/{job_id}`
- `GET /models?project_id=...`
- `GET /models/latest?project_id=...&model_type=square|wide`
- `POST /predict`（form: `project_id`）

## 6. 設定ファイル

設定は `config/settings.yaml` で管理します。

主な設定項目:

- `preprocess.grayscale.enabled`
- `preprocess.resize.enabled`
- `preprocess.resize.width / height`
- `preprocess.padding.enabled`
- `preprocess.normalize.enabled`
- `training.default_epochs`
- `training.default_batch_size`
- `training.models.square.image_size`
- `training.models.wide.image_size`

## 7. 生成物

- ラベルCSV: `data/projects/<project_id>/annotations/master.csv`
- 学習済みモデル: `data/projects/<project_id>/models/*.pt`
- 学習ログ: `data/projects/<project_id>/logs/train_*.json`
- 学習ジョブDB: `outputs/app.db`（SQLite）

## 8. トラブルシュート

- 旧構造（`data/raw` など）から移行したい  
以下で `default` プロジェクトへ移行できます:

```bash
python3 -m src.app.migrate_legacy_data --project-id default
```

- `TypeError: unsupported operand type(s) for |` が出る  
Python 3.9 実行の可能性があります。`.venv` を Python 3.11+ で再作成してください。

- `mps_available=False`  
実行コンテキスト依存で false になる場合があります。実機ターミナルで以下を確認してください:

```bash
source .venv/bin/activate
python - <<'PY'
import torch
print(torch.backends.mps.is_built(), torch.backends.mps.is_available())
PY
```

- ポート競合で起動できない  
`--port 8011` など未使用ポートに変更してください。
