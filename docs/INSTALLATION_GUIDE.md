# OCR Crafter インストールガイド（v1.0.0）

導入担当者向けの環境構築手順です。日常運用は [ADMIN_GUIDE.md](ADMIN_GUIDE.md)、更新は [UPDATE_GUIDE.md](UPDATE_GUIDE.md) を参照してください。

## 1. 動作要件

### 対応OS

- **Windows 11（推奨・動作確認済み）**。PowerShellでの運用を前提とします
- macOS等でも動作する構成ですが、既定設定（Tesseractパス等）はWindows前提です

### 必要権限

- 通常のユーザー権限で動作します（インストール先とデータディレクトリへの書き込み権限が必要）
- Tesseract本体のインストールに管理者権限が必要な場合があります

### ハードウェア要件

| 項目 | 目安 |
|---|---|
| CPU | 特に指定なし（学習・Benchmarkはコア数が多いほど有利） |
| メモリ | PaddleOCR学習・推論を行う場合は余裕を持たせる（不足時はOOM→バッチ半減の自動リトライあり） |
| ストレージ | **ローカルSSD推奨**（負荷試験はローカルSSDで実測。NAS等では悪化し得る: [26_PERFORMANCE_LIMITS.md](26_PERFORMANCE_LIMITS.md)）。ディスク空きは10GB以上を推奨（1GB未満でヘルスチェック警告） |
| GPU | **任意**（なくても全機能が動作。学習速度に影響）。PyTorch / PaddlePaddleが対応するNVIDIA GPU＋CUDA環境で高速化。VRAMはバッチサイズに影響（不足時は自動バッチ半減） |

### ソフトウェア要件

| 項目 | 要件 |
|---|---|
| Python | **3.11以上を推奨**（`docs/USER_GUIDE.md` 旧版より。Pipfileには3.9の記載が残っていますが現行手順は3.11+） |
| Node.js / npm | Vite 5 が動作するLTS版（Node 18以上目安） |
| Tesseract | 推論に本体、**学習には学習ツール入りビルド**（`lstmtraining`・`combine_tessdata` 同梱。UB-Mannheimビルド等）＋ ベース `eng.traineddata`（tessdata_best推奨）。詳細: [11_TESSERACT_CHECKLIST.md](11_TESSERACT_CHECKLIST.md) |
| PaddleOCR | 学習には `external/PaddleOCR` リポジトリが必要（`PADDLEOCR_PATH` 環境変数または `settings.yaml` の `ocr_training.paddleocr_repo_dir` で解決） |
| その他 | Python依存は `requirements.txt`（FastAPI・PyTorch・PaddleOCR・EasyOCR・ultralytics・matplotlib等） |

## 2. インストール手順

```powershell
# 1) リポジトリ取得
git clone <社内リポジトリURL> ocr_crafter
cd ocr_crafter

# 2) Python仮想環境
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 3) Python依存関係
pip install -r requirements.txt

# 4) フロントエンド依存関係
cd frontend
npm install
cd ..
```

### 設定ファイル（config/settings.yaml）

- 全設定（前処理パイプライン・学習・Tesseract・CORS等）は `config/settings.yaml` にあります（[08_CONFIGURATION.md](08_CONFIGURATION.md)）
- 本番向けの雛形は `config/settings.production.example.yaml`、環境変数の雛形は `.env.example` を参照
- Tesseractの設定例:

```yaml
tesseract:
  tesseract_cmd: ""          # 空ならPATHから解決（既定インストール先: C:\Program Files\Tesseract-OCR\）
  lstmtraining_cmd: ""
  combine_tessdata_cmd: ""
  tessdata_dir: ""           # eng.traineddata の格納フォルダ（models/tessdata_best 等）
  base_lang: eng
```

### ディレクトリ

- `data/`（プロジェクト・jobs・audit・backups）は初回起動時に自動作成されます
- 推奨配置（本番）: [24_DEPLOYMENT_GUIDE.md](24_DEPLOYMENT_GUIDE.md) の構成図を参照

### GPU確認（GPU環境の場合のみ）

```powershell
# PyTorch（分類学習・EasyOCR）
.\.venv\Scripts\python.exe -c "import torch; print(torch.cuda.is_available())"

# 起動後にAPIで総合確認（GPU名・VRAM・Paddle GPU可否・推奨プロファイル）
curl http://127.0.0.1:8000/api/system/check
```

## 3. 起動と初回アクセス

```powershell
# バックエンド
.\.venv\Scripts\Activate.ps1
uvicorn src.app.main:app --port 8000

# フロントエンド（別ターミナル）
cd frontend
npm run dev    # http://localhost:5173
```

- 必要なら `frontend/.env` に `VITE_API_BASE=http://127.0.0.1:8000` を設定
- ブラウザで `http://localhost:5173` を開くと**初回セットアップウィザード**が表示され、保存先・OCRエンジン・GPU・Python環境を画面上で確認できます

### 正常動作確認

| 確認 | 期待結果 |
|---|---|
| `curl http://127.0.0.1:8000/health` | `{"status":"ok"}` |
| `GET /health/details` | `status: ok`（Tesseract未導入等はdegradedで内訳表示） |
| UI表示 | サイドバーとダッシュボードが表示される |
| テスト（任意） | `.\.venv\Scripts\python.exe -m pytest -q` が全件PASS |

## 4. CPU環境（GPUなし）での利用範囲

GPUがなくても**全機能が利用できます**。

- Tesseract学習・推論: CPUのみで動作（GPU非対応のエンジンです）
- PaddleOCR / EasyOCR推論: CPUで動作（GPUより低速）
- PaddleOCR学習: `device=cpu`（`Mac Safe` プリセット相当）で動作。GPUに比べ時間がかかります
- 分類学習（実験機能）: CPUで動作

## 5. GPU環境の注意事項

- `device=auto` はCUDA検出時にGPUを使用し、auto batch / AMP / pin_memory / persistent_workers を自動有効化します
- OOM（VRAM不足）検出時はバッチサイズを半減して1回自動リトライします
- 学習ログに `batch_size` / `step_time` / `gpu_usage` / `vram_usage` が定期記録されます
- GPU名・VRAM・CUDA可否は `GET /api/system/check` または学習画面の「実行環境」表示で確認できます

## 6. Tesseract学習環境（学習を行う場合）

1. 学習ツール入りビルド（UB-Mannheim等）をインストール（既定: `C:\Program Files\Tesseract-OCR\`）
2. `tessdata_best` の `eng.traineddata` を配置（例: `models/tessdata_best/`）
3. `config/settings.yaml` の `tesseract` セクションでパスを設定（PATH解決も可）
4. ツール未導入のまま学習を開始すると、導入手順つきのエラーになります（データは壊れません）

チェックリスト: [11_TESSERACT_CHECKLIST.md](11_TESSERACT_CHECKLIST.md) / charset仕様: [12_TESSERACT_CHARSET_SPEC.md](12_TESSERACT_CHARSET_SPEC.md)

## 7. 本番配布手順

社内サーバー等への配備は [24_DEPLOYMENT_GUIDE.md](24_DEPLOYMENT_GUIDE.md)（推奨構成・NSSMサービス化・タスクスケジューラ・Linux systemd・nginxリバースプロキシ例）に従ってください。要点:

- **配布前チェック**: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) を全項目実施
- **設定ファイル**: `config/settings.production.example.yaml` と `.env.example` を元に本番値を作成。本番では `OCRC_ALLOW_UNAUTHENTICATED_ADMIN=false` を設定（[SECURITY_AND_DATA_HANDLING.md](SECURITY_AND_DATA_HANDLING.md)）
- **データ・ログ・バックアップ保存先**: `data/`（プロジェクト・jobs・audit・backups）と `outputs/` をローカルSSDへ。バックアップ保存先は `data/backups/`
- **ポート / Firewall**: バックエンド8000・フロントエンド5173（開発サーバー）。社内ネットワークへ公開する場合はリバースプロキシ経由とし、直接ポート公開はローカル利用に限定
- **ブラウザアクセス**: 利用者は社内ネットワークからブラウザでアクセス（フロントのビルド配信構成は24章参照）
- **自動起動**: OSの標準機能（NSSMサービス / タスクスケジューラ / systemd）で構成します。**アプリ内蔵の自動起動・自動更新機能はありません**
- **更新 / ロールバック**: [UPDATE_GUIDE.md](UPDATE_GUIDE.md)

> 注意: 認証基盤（SSO・パスワード認証）は未実装です。ユーザー識別はX-Operator/X-Roleヘッダによる運用で、本番ではリバースプロキシでの付与を推奨します（実装済みの範囲は [22_SECURITY_AND_AUDIT.md](22_SECURITY_AND_AUDIT.md)）。
