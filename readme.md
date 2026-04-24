# OCR Crafter (ローカルOCR学習環境)

詳細な利用手順: [docs/usage.md](/Users/hashimoto/vscode/_app/ocr_crafter/docs/usage.md)

## 1. ディレクトリ初期化

```bash
python3 -m src.app.init_dirs
```

## 2. バックエンド起動（FastAPI）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.app.main:app --reload --port 8000
```

## 3. フロントエンド起動（React + Vite）

```bash
cd frontend
npm install
npm run dev
```

必要なら `frontend/.env` に以下を追加:

```bash
VITE_API_BASE=http://127.0.0.1:8000
```

## 4. 主要フロー（UI）

1. プロジェクト作成/選択  
2. 画像取り込み（取り込み時に前処理も自動実行）  
3. ラベル編集  
4. データセット作成  
5. 学習開始（非同期）  
6. 評価 / 推論

## 5. エンドポイント一覧

- `GET /health` : ヘルスチェック
- `GET /projects` : プロジェクト一覧
- `POST /projects` : プロジェクト作成
- `DELETE /projects/{project_id}` : プロジェクト削除
- `POST /dialogs/select-directory` : ローカルのフォルダ選択ダイアログを開いてパス取得
- `POST /images/import` : 外部ディレクトリから画像取り込み（`project_id` 指定）
- `GET /images?project_id=...` : 画像一覧取得（ラベル付き）
- `POST /images/{image_name}/rotate?project_id=...` : 画像回転（90度単位、右回転が正）
- `GET /images/{image_name}/processed?project_id=...` : 前処理済み画像取得
- `POST /preprocess/run` : 前処理実行（`project_id` + ON/OFF・パラメータ上書き）
- `GET /preprocess/preview` / `POST /preprocess/preview` : 前処理プレビュー + 推論
- `GET /labels?project_id=...` : ラベル一覧取得
- `PUT /labels/{image_name}?project_id=...` : ラベル更新
- `POST /dataset/build` : `train/val/test` 分割して `data/projects/{project_id}/dataset` へ出力
- `POST /train/start` : 非同期学習ジョブ開始（BackgroundTasks）
- `GET /train/{job_id}` : 学習ジョブ状態取得（SQLite）
- `POST /api/ocr/dataset/create` : OCR用 `path\ttext` データセット作成（PaddleOCR学習向け）
- `POST /api/ocr/train/start` : PaddleOCR 学習ジョブ開始
- `GET /api/ocr/train/status/{job_id}` : OCR学習状態取得
- `GET /api/ocr/train/log/{job_id}` : OCR学習ログ取得
- `POST /api/ocr/models/export-migrate` : 既存OCRモデルを推論用(inference)へ一括変換
- `GET /api/ocr/models/official` : 選択可能な公式PaddleOCR認識モデル一覧
- `GET /api/models/download/{model_name}?project_id=...` : モデルダウンロード（`.pt` 直取得 / `.ocr.json` は inference ZIP）
- `GET /models?project_id=...` : 保存済みモデル一覧
- `GET /models/latest?project_id=...&model_type=...` : 最新モデル参照（種別指定可）
- `GET /model-types?project_id=...` : モデル種別一覧
- `POST /predict` : 画像推論（`custom` / `easyocr` / `paddleocr`）
- `POST /evaluate` : 精度評価（accuracy、混同行列、誤認識ログ）
- `POST /ocr/tuning/export` : EasyOCR/PaddleOCR 学習用データをエクスポート
- `POST /system/shutdown` : フロント/バックエンド終了

## 6. 学習・推論CLI

```bash
python3 -m src.app.train --project-id default --model-type square --epochs 5 --batch-size 32
python3 -m src.app.predict path/to/image.png --project-id default --model-type square
python3 -m src.app.predict path/to/image.png --project-id default --engine paddleocr --easyocr-langs en
python3 -m src.app.ocr_tuning --project-id default --engine both --image-types wide --train-ratio 0.8 --val-ratio 0.1 --test-ratio 0.1
```

## 7. 設定

- `config/settings.yaml` で前処理・分割比率・学習デフォルト値を管理
- device は `mps` 利用可能なら自動で `mps`、不可なら `cpu`
- データは `data/projects/{project_id}/` 配下でプロジェクトごとに分離管理

## 8. OCRチューニング（EasyOCR / PaddleOCR）

補足:
- OCR学習完了時に、推論用 `inference` モデルを自動exportします。
- 推論では export済みモデルのみ使用します（未exportモデルはエラー）。
- `engine=paddleocr` で学習済みOCRモデルを指定した場合、認識モデルを直接利用します（推論時の追加公式モデル取得に依存しません）。

1. 追加依存をインストール（任意）

```bash
source .venv/bin/activate
pip install -r requirements-ocr-tuning.txt
```

2. 学習用データをエクスポート

```bash
python3 -m src.app.ocr_tuning \
  --project-id default \
  --engine both \
  --image-types wide \
  --train-ratio 0.8 \
  --val-ratio 0.1 \
  --test-ratio 0.1
```

出力先: `data/projects/<project_id>/outputs/ocr_tuning/<timestamp>/`

- EasyOCR: `easyocr/train_labels.txt`, `easyocr/val_labels.txt`, `easyocr/test_labels.txt`
- PaddleOCR: `paddleocr/rec/train.txt`, `paddleocr/rec/val.txt`, `paddleocr/rec/test.txt`, `paddleocr/rec/charset.txt`
- 共通メタ: `meta.json`

## 9. 旧データ移行（必要時）

旧構造（`data/raw` など）から新構造へ移す場合:

```bash
python3 -m src.app.migrate_legacy_data --project-id default
```
