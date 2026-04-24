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

補足（新仕様）:

- 学習方式 `classification` / `ocr` を選択可能
- `ocr` では `PaddleOCR` のみ学習可能
- `EasyOCR` は推論専用（学習UIは非表示）

7. 評価（Evaluation）  
`val` または `test` に対して評価を実行。  
Accuracy、クラス別精度、混同行列、誤認識一覧を確認します。

8. 推論（Inference）  
カスタムモデル / EasyOCR / PaddleOCR で推論可能です。

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
- `POST /api/ocr/dataset/create`
- `POST /api/ocr/train/start`
- `GET /api/ocr/train/status/{job_id}`
- `GET /api/ocr/train/log/{job_id}`
- `GET /models`
- `GET /api/models/download/{model_name}`（OCRモデルは inference ZIP で取得）
- `GET /api/ocr/models/official`（PaddleOCR公式認識モデル一覧）
- `GET /models/latest`
- `GET /model-types`
- `POST /predict`（`engine=custom|easyocr|paddleocr`）
- `POST /evaluate`
- `POST /ocr/tuning/export`
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

## 9. 特殊フォント向けOCRチューニング（EasyOCR / PaddleOCR）

### 9.1 追加依存（任意）

```bash
source .venv/bin/activate
pip install -r requirements-ocr-tuning.txt
```

### 9.2 学習用データをエクスポート

```bash
cd /Users/hashimoto/vscode/_app/ocr_crafter
source .venv/bin/activate
python -m src.app.ocr_tuning \
  --project-id default \
  --engine both \
  --image-types wide \
  --train-ratio 0.8 \
  --val-ratio 0.1 \
  --test-ratio 0.1
```

出力先（既定）:

- `data/projects/<project_id>/outputs/ocr_tuning/<timestamp>/easyocr/`
- `data/projects/<project_id>/outputs/ocr_tuning/<timestamp>/paddleocr/rec/`
- `data/projects/<project_id>/outputs/ocr_tuning/<timestamp>/meta.json`

主なファイル:

- EasyOCR: `train_labels.txt`, `val_labels.txt`, `test_labels.txt`
- PaddleOCR: `train.txt`, `val.txt`, `test.txt`, `charset.txt`, `rec_train_config.yaml`

注意:

- ラベルは `annotations/master.csv` の `label` を使用します。
- 画像は `processed/<type>/images` を優先し、なければ `interim` / `raw` を参照します。
- `--image-types wide` を推奨（複数文字列OCR向け）。

## 10. トラブルシュート

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

## 11. OCR作業手順（今日追加分）

### A. 初回モデル作成（最短）

1. `モデル作成 > ダッシュボード` でプロジェクトを選択/作成する。
2. `モデル作成 > 画像` で学習画像を取り込む。
3. `モデル作成 > ラベル編集` で文字列ラベルを保存する。
4. `モデル作成 > 学習` を開き、`学習方式 = ocr`、`OCRタイプ = PaddleOCR` を選ぶ。
5. `charset`、`max_text_length`、`image_shape(3,48,320)` を確認する。
6. `Augmentationを使用` と `Aug強度(1-3)` を必要に応じて設定する。
   - 適用処理（ランダム）: コントラスト変化、軽微ガウシアンブラー、ガウシアンノイズ、微小回転（±1〜2度）
   - 強度1〜3で適用確率と強さが上がる
7. `OCRデータ作成` を実行する。
8. `PaddleOCR リポジトリ` は固定パス（`/Users/hashimoto/vscode/_app/ocr_crafter/external/PaddleOCR`）を使用し、`OCR学習開始` を押す。
9. 学習ログが `completed` になれば、推論用 `inference` モデルが自動exportされ、`モデル作成 > モデル` に OCRモデルが追加される。

補足:
- 推論で使用できるのは export済みOCRモデルのみです（未exportはエラー）。
- 既存モデルを一括変換する場合は `POST /api/ocr/models/export-migrate` を実行します。
- `engine=paddleocr` で export済みOCRモデルを指定した推論は、学習済み認識モデルを直接使用します（推論時に追加の公式モデル取得は不要）。

### B. 今日追加した強化機能を使った再学習ループ（推奨）

1. `モデル作成 > 高速OCR修正` を開く。
2. OCR結果を確認し、ヒートマップの赤/黄文字をクリックして1文字修正する。
3. `Enter` で確定して次へ、`Shift+Enter` で保留する。
4. 修正結果は OCRログに保存される。
5. `モデル作成 > 学習` に戻り、`ログ再学習データ作成` を実行する。
6. `invalidのみ対象 / correctedを優先` を必要に応じて切替える。
7. 生成された再学習データで再度 `OCR学習開始` を実行する。

### C. 補足（今日の追加で有効）

- 推論は内部でマルチOCR（複数前処理）＋多数決で安定化。
- 結果に `char_scores` と `char_confidence_normalized` が付き、文字単位の怪しさを可視化。
- 業務ルール（`^[A-Z0-9]{8}$`、禁止パターン）で `valid/invalid` 判定。
- `image_shape` は `1,48,320`（グレースケール）または `3,48,320`（RGB）を使用可能。
