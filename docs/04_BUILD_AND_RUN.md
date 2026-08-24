# 04. ビルドと実行

リポジトリ内（README / package.json / docs/USER_GUIDE.md）で確認できたコマンドのみを記載する。

## セットアップ

### バックエンド（Python）

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

- 注意: `requirements.txt` は UTF-16 エンコードのため、環境によっては pip で直接読めない（`docs/13_QA_STATUS.md` 記載の既知課題）。
- OCRチューニングの追加依存（任意）: `pip install -r requirements-ocr-tuning.txt`
- テスト実行用: `pip install -r requirements-dev.txt`（pytest）

### ディレクトリ初期化

```bash
python3 -m src.app.init_dirs
```

### フロントエンド

```bash
cd frontend
npm install
```

## 実行

### バックエンド起動（FastAPI, port 8000）

```bash
uvicorn src.app.main:app --reload --port 8000
```

### フロントエンド起動（Vite dev server, port 5173）

```bash
cd frontend
npm run dev
```

- API接続先の変更: `frontend/.env` に `VITE_API_BASE=http://127.0.0.1:8000`（既定値と同じ。未設定でも動作）

## ビルド

```bash
cd frontend
npm run build      # vite build → frontend/dist/
npm run preview    # ビルド結果のプレビュー
```

バックエンドに独立したビルド工程はない（Pythonソースを直接実行）。

## テスト

### バックエンド（pytest）

```bash
python -m pytest -q          # リポジトリルートで実行（tests/ 87ファイル + conftest.py、.venv経由）
```

### フロントエンド（node:test）

```bash
cd frontend
npm test    # node --test で tests/ 配下71ファイルを実行（package.json scripts.testに列挙。依存追加不要）
```

## CLI（学習・推論・データ出力）

```bash
python3 -m src.app.train --project-id default --model-type square --epochs 5 --batch-size 32
python3 -m src.app.predict path/to/image.png --project-id default --model-type square
python3 -m src.app.predict path/to/image.png --project-id default --engine paddleocr --easyocr-langs en
python3 -m src.app.predict path/to/image.png --project-id default --engine trocr --model microsoft/trocr-base-printed
python3 -m src.app.ocr_tuning --project-id default --engine both --image-types wide --train-ratio 0.8 --val-ratio 0.1 --test-ratio 0.1
python3 -m src.app.migrate_legacy_data --project-id default   # 旧データ構造からの移行
```

- `predict.py`の`--engine`は`custom`/`easyocr`/`paddleocr`/`tesseract`/`trocr`に対応（`--model`はTrOCRの場合Hugging Face model IDまたはローカルの`model_dir`パス）

## Lint / フォーマット

- Lint・フォーマッタの設定ファイル（ruff / flake8 / eslint / prettier 等）は**このプロジェクトでは確認できない**。
  （`.gitignore` に `.ruff_cache/` の記載はあるが、ruff の設定ファイルは存在しない）

## Docker

- Dockerfile / docker-compose は**このプロジェクトでは確認できない**。
