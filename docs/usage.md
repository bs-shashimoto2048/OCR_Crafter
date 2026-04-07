# OCR Crafter 利用ガイド

このドキュメントは、`ocr_crafter` の現在仕様に合わせた運用手順です。

## 1. 前提

- macOS（Apple Silicon）
- Python 3.11 以上
- Node.js / npm

確認コマンド:

```bash
python3.11 --version
node --version新選択時の種別
npm --version
```

## 2. 初回セットアップ

```bash
cd /Users/hashimoto/vscode/_app/ocr_crafter
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

```bash
cd frontend
npm install
```

## 3. 起動方法

### 3.1 バックエンド（FastAPI）

```bash
cd /Users/hashimoto/vscode/_app/ocr_crafter
source .venv/bin/activate
uvicorn src.app.main:app --reload --port 8000
```

ヘルスチェック:

```bash
curl http://127.0.0.1:8000/health
```

### 3.2 フロントエンド（React + Vite）

```bash
cd /Users/hashimoto/vscode/_app/ocr_crafter/frontend
echo 'VITE_API_BASE=http://127.0.0.1:8000' > .env
npm run dev
```

## 4. 学習の進め方（推奨手順）

1. プロジェクトを選択/作成  
データは `data/projects/<project_id>/` 単位で分離されます。

2. 画像取り込み（Images）  
`Import` 実行時に `raw` へコピー後、前処理パイプラインが自動実行されます。

3. ラベル編集（Labeling）  
ラベル入力して保存。  
保存先: `data/projects/<project_id>/annotations/master.csv`  
UIのプレビューは前処理後画像を表示します。

4. 前処理調整（Preprocess）  
必要に応じて前処理パラメータを調整し、プレビューで確認します。  
調整値はプロジェクトごとにUI側で保持されます。

5. データセット作成（Training）  
`データセット作成` を実行。  
`train/val/test` が `data/projects/<project_id>/dataset/` に出力されます。

6. 学習開始（Training）  
`モデル種別 / エポック / バッチサイズ / 学習率` を設定して `学習開始`。  
非同期ジョブで実行され、状態は `queued/running/completed/failed` で確認できます。

7. 評価（Evaluation）  
`val` または `test` に対して評価を実行。  
Accuracy、クラス別精度、混同行列、誤認識一覧を確認します。

8. 推論（Inference）  
カスタムモデルまたは EasyOCR で推論可能です。

## 5. 学習の詳細

### 5.1 モデル

- `torchvision.models.resnet18(weights=None)` をベースに最終全結合層を差し替え
- クラス数は `dataset/train` のフォルダ名から自動決定
- 保存形式は `.pt`（`state_dict`, `classes`, `image_size` などを含む）

### 5.2 デバイス

- `torch.backends.mps.is_available()` かつ `is_built()` のとき `mps`
- それ以外は `cpu`

### 5.3 学習パラメータ（M1 16GBの初期目安）

- エポック: 10
- バッチサイズ: 16（重ければ8）
- 学習率: 0.001（不安定なら0.0005）

### 5.4 画像サイズ

- `config/settings.yaml` の `training.models.<model_type>.image_size` に従います。

## 6. 前処理とデータ出力

前処理出力:

- `data/projects/<project_id>/interim/`
- `data/projects/<project_id>/processed/single/images/`
- `data/projects/<project_id>/processed/wide/images/`
- `data/projects/<project_id>/processed/meta/*.json`

補足:

- データセット作成時は `interim` を優先し、なければ `raw` を使います。
- 元画像（`raw`）は上書きしません（回転操作を除く明示操作時）。

## 7. API一覧（主要）

- `GET /health`
- `GET /projects`
- `POST /projects`
- `DELETE /projects/{project_id}`
- `POST /dialogs/select-directory`
- `POST /images/import`
- `GET /images`
- `GET /images/{image_name}/file`
- `GET /images/{image_name}/processed`
- `POST /images/{image_name}/rotate`
- `POST /preprocess/run`
- `GET /preprocess/preview`
- `POST /preprocess/preview`
- `GET /labels`
- `PUT /labels/{image_name}`
- `POST /dataset/build`
- `POST /train/start`
- `GET /train/{job_id}`
- `GET /models`
- `GET /models/latest`
- `GET /model-types`
- `POST /predict`（`engine=custom|easyocr`）
- `POST /evaluate`
- `POST /system/shutdown`

## 8. 生成物

- ラベルCSV: `data/projects/<project_id>/annotations/master.csv`
- 学習済みモデル: `data/projects/<project_id>/models/*.pt`
- 学習ログ: `data/projects/<project_id>/logs/train_*.json`
- 評価結果:
  - `data/projects/<project_id>/outputs/metrics/evaluation_*.json`
  - `data/projects/<project_id>/outputs/metrics/confusion_matrix.png`
  - `data/projects/<project_id>/outputs/errors/errors_*.json`
- 学習ジョブDB: `outputs/app.db`（SQLite）

## 9. トラブルシュート

- Python 3.9で `unsupported operand type(s) for |` が出る  
  Python 3.11以上で仮想環境を作り直してください。

- `mps_available=False`  
  次で確認してください:

```bash
source .venv/bin/activate
python - <<'PY'
import torch
print(torch.backends.mps.is_built(), torch.backends.mps.is_available())
PY
```

- ポート競合  
  `uvicorn ... --port 8001` のように変更してください。
