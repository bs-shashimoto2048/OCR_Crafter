# OCR Crafter 利用ガイド

このドキュメントは、`ocr_crafter` の現在仕様に合わせた運用手順です。

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
- OCR学習は `Mac Safe` / `RTX Train` プリセットを使用可能
- `device=auto` でもGPU検出時はGPU設定（auto batch/AMP/pin_memory/persistent_workers）を有効化
- OOM検出時は batch を半減して1回自動リトライ
- 学習ログに `metrics`（`batch_size`, `step_time`, `gpu_usage`, `vram_usage`）を定期記録

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
- `GET /api/system/check`（GPU可否 / PaddleGPU可否 / torch CUDA可否 / PaddleOCRパス / 推奨プロファイル）
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
- `GET /api/models/download/{model_name}`（`.pt`=直接 / `.ocr.json`=inference ZIP / `.tess.json`=`.traineddata` を直接取得）
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
8. `PaddleOCR リポジトリ` は `PADDLEOCR_PATH` または `config/settings.yaml` の `ocr_training.paddleocr_repo_dir` を使って解決されます。設定を確認して `OCR学習開始` を押す。
9. 学習ログが `completed` になれば、推論用 `inference` モデルが自動exportされ、`モデル作成 > モデル` に OCRモデルが追加される。
10. `3. 学習パラメータ` の `実行環境` 表示で、学習時設定を確認できる。
    - `GPU: <name> (<vram_gb>GB)`
    - `Batch: <size>（自動/手動）`
    - `Workers: train <n> / eval <n>`
    - `AMP: ON/OFF`

   - 補足: PaddleOCRパスは `PADDLEOCR_PATH`（環境変数）または `config/settings.yaml` の
     `ocr_training.paddleocr_repo_dir` で解決されます。
   - 学習前に `GET /api/system/check` を呼ぶと、`recommended_profile`（`Mac Safe` / `RTX Train`）を確認できます。

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
- OCR学習パラメータに `device(auto/cpu/gpu)`, `train_num_workers`, `eval_num_workers`, `save_epoch_step` を追加。
- Mac では `num_workers` が高いとメモリ逼迫しやすいため、`Mac Safe` プリセット（`cpu`, workers `0/0`）推奨。


## 12. Tesseract 学習（A-Z / 0-9 / 小文字筆記体 k,l,t）

OCRタイプに `Tesseract` を追加しました。公式 `eng.traineddata` をベースに LSTM を
fine-tune します。学習対象文字は `A-Z / 0-9 / 小文字筆記体 k,l,t`
（`ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt`）で、主な改善対象は筆記体の
`k/l/t` と `kt`/`lt` の組み合わせです。

> charset（学習対象文字セット）と whitelist（推論時の探索制約）は別概念です。
> whitelist は学習処理には結び付けず、推論・評価時のみ適用します（既定は学習対象と同値）。

### 12.1 前提ツール（重要）

Tesseract の学習は pip では完結しません。以下の外部ツールが必要です。

- `tesseract`（推論・lstmf生成に使用）
- `lstmtraining`（LSTM fine-tune 本体）
- `combine_tessdata`（ベースモデルからLSTM抽出）
- ベース `eng.traineddata`（tessdata_best 推奨）

Windows では通常インストーラに学習ツールが含まれないため、学習ツール入りビルドを導入してください。
`config/settings.yaml` の `tesseract` セクションで実行ファイルや `tessdata_dir` を指定できます（PATH 解決も可）。

```yaml
tesseract:
  tesseract_cmd: ""          # 空ならPATHから解決
  lstmtraining_cmd: ""
  combine_tessdata_cmd: ""
  tessdata_dir: ""           # eng.traineddata の格納フォルダ
  base_lang: eng
  default_charset: ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt
  default_max_iterations: 1000
  default_psm: 7
```

ツール未導入のまま学習を開始すると、導入手順つきのエラーになります（データは壊れません）。

### 12.2 手順（UI）

1. `モデル作成 > 学習` で `学習方式 = ocr`、`OCRタイプ = Tesseract` を選ぶ。
2. 学習対象文字セットは既定で `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt`（A-Z / 0-9 / 筆記体klt）。
3. `OCRデータ作成` を実行（ラベルは大小変換せずそのまま使用。charset外の文字を含むラベルはサンプル除外）。
4. `最大イテレーション` を設定し `OCR学習開始`。
5. 完了すると `models/tesseract/<name>/<name>.traineddata` が作られ、`<name>.tess.json` がモデル一覧に追加される。
6. `推論` 画面で `Tesseract` を選び、学習済みモデルで推論できる（whitelist 既定 `A-Z0-9klt`、単一行 `--psm 7`）。

### 12.3 CLI 推論

```bash
python3 -m src.app.predict path/to/image.png --project-id default --engine tesseract
```

### 12.4 補足・制約

- `学習 > OCR認識モデル` 配下の各画面（モデル管理 / 推論 / OCR修正 / バッチ推論 / モデル評価）でTesseractを選択できます。
  - **モデル管理**: `.tess.json`（Tesseractモデル）を一覧表示（traineddataパス・charset・学習条件）。削除、`.traineddata` のダウンロードに対応。最新表示は PaddleOCR / Tesseract を並記。
  - **バッチ推論 / OCR修正**: エンジンに `Tesseract` を追加。モデルは「最新（学習済み）」「Tesseract標準英語モデル eng.traineddata」「学習済みTesseractモデル一覧」から選択（学習済みが無い場合は eng.traineddata を選択）。推論時 whitelist は既定 `A-Z / 0-9 / 小文字筆記体 k,l,t`（学習済みモデルはメタの charset を継承）。
  - **バッチ推論の結果CSV出力**: 各行に engine / model を記録。Tesseract結果は大小文字を保持して出力。
- モデル削除は安全ガードつきです: 削除対象は `models` ディレクトリ配下に限定され、メタの関連パスが models 外・空の場合は実体を削除せずスキップ（警告ログ）または中止します。破損（JSONパース不能）メタはメタファイルのみ削除されます。

- 学習ジョブは `training_family=ocr, engine=tesseract` として既存のOCR学習の状態/ログ/停止APIを共用します。
- `新規作成（ラベルデータから）` `再学習作成（OCRログから）` の両方に対応します。Tesseract選択時はどちらも `text_case=keep`（大小変換なし）で、ラベルの表記をそのまま保持します（例: `CHYBkt` は `CHYBkt` のまま。`kt` が `KT` に改変されない）。charset外の文字を含むラベルは文字削除ではなくサンプルごと除外され、skipped として集計されます。
- 学習用の行画像は OCRデータ作成の出力（`image_shape` で高さ正規化・レターボックス）を使用します。
- この環境には学習ツールが未導入のため、エンドツーエンドの学習実行は未検証です（配線・事前チェック・小文字データ生成・推論経路は検証済み）。

### 12.5 モデル評価（学習前後の比較）

UI: `モデル作成 > 学習 > 6. モデル評価`（`ocr-eval`）。学習前モデル（`eng.traineddata`）と学習後モデルを
同一データで推論し、認識率・増減・改善率・誤認識一覧を表示する（API: `POST /api/ocr/evaluate`）。

- **学習前モデル (eng.traineddata)**: Tesseract 標準の英語モデル（未学習のベースライン）。
- **学習後モデル**: 本アプリで学習した `.tess.json`（`latest` または個別選択）。
- 表示項目: 認識率 / 増減（学習後−学習前）/ 改善率（増減÷学習前）/ 誤認識一覧 / CSV出力。

#### 正解CSVの形式

```csv
filename,text
sample_001.png,kt
sample_002.png,lt
sample_003.png,ct
```

- `filename` は評価用画像フォルダ内のファイル名と一致させる。
- `text` は実運用の表記どおりに記載する（例: `CHYBkt`）。比較は case-sensitive の完全一致で、`KT` と `kt` は別物として評価される。
- 評価時 whitelist は既定 `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt`（UIで「なし」「カスタム」へ切替可。APIでは `charset=""` が whitelist なし）。
- ヘッダ行あり推奨（先頭が `filename`/`image` 等なら自動スキップ）。
- 文字コードは UTF-8 推奨。

#### 評価結果CSV（CSV出力）

明細（1行＝画像×モデル）:

| 列 | 内容 |
|---|---|
| `filename` | 画像ファイル名 |
| `ground_truth` | 正解文字列（CSVの text） |
| `prediction` | モデルの認識結果 |
| `match` | 一致=`1` / 不一致=`0` |
| `model` | モデル表示名（例 `eng.traineddata（学習前）`） |

末尾にモデル別サマリ（accuracy summary）:

| 列 | 内容 |
|---|---|
| `model` | モデル表示名 |
| `total` | 評価画像数 |
| `correct` | 正解数 |
| `accuracy_percent` | 認識率(%) |
| `mismatch_count` | 誤認識数 |

#### エラー時の案内

| 症状 | 主なメッセージ / 原因 | 対処 |
|---|---|---|
| Tesseract 本体が未導入 | `tesseract 実行ファイルが見つかりません...` | Tesseract を導入し `tesseract.tesseract_cmd`/PATH を設定 |
| eng.traineddata が無い | `ベース traineddata (eng.traineddata) が見つかりません...` | tessdata_best を配置し `tessdata_dir` 指定（§12.1〜12.3） |
| 学習後モデルが未学習/未選択 | `学習後モデルが見つかりません（未学習、または選択したモデルが存在しません）...` | 先に学習を完了、または学習後モデルを選択 |
| 正解CSVが不正 | `正解CSVが見つかりません` / `正解CSVに有効な行がありません（形式: 画像名,正解文字列）` | パス・形式（filename,text）を確認 |
| 画像が見つからない | `評価対象の画像が見つかりませんでした...` | `filename` と画像フォルダ内のファイル名（拡張子含む）の一致を確認 |
| 一部画像のみ欠落 | 結果ヘッダの「画像未検出 N 件」に計上 | 欠落ファイル名を確認して補完 |

### Quick Start

>Backend

```bash
.\.venv\Scripts\Activate.ps1
uvicorn src.app.main:app --reload --port 8000
```

**Debug**

```bash
uvicorn src.app.main:app --reload --port 8000 --log-level debug
```


>Frontend
```bash
cd .\frontend
echo 'VITE_API_BASE=http://127.0.0.1:8000' > .env
npm run dev
```

---