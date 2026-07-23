# 03. 技術スタック

バージョンは `requirements.txt`（ローカル全量スナップショット・UTF-16エンコード）、`requirements-ci.txt`、`frontend/package.json` から取得した実値。

## 言語・ランタイム

| 項目 | 内容 | 根拠 |
|---|---|---|
| バックエンド言語 | Python | `src/app/` 全体 |
| Pythonバージョン | Pipfile は 3.9 指定 / docs/INSTALLATION_GUIDE.md は 3.11以上を推奨（記述間の不一致あり。CI相当の固定はなし） | `Pipfile`, `docs/INSTALLATION_GUIDE.md` |
| フロントエンド言語 | JavaScript（JSX）。TypeScript 不使用 | `frontend/src/` |
| Node.js | バージョン固定なし（`engines` 指定なし） | `frontend/package.json` |

## バックエンド主要ライブラリ

| ライブラリ | バージョン | 用途 | 使用箇所 |
|---|---|---|---|
| fastapi | 0.136.1 | Web API フレームワーク | `src/app/main.py` |
| uvicorn | 0.46.0 | ASGIサーバ | 起動コマンド（README） |
| pydantic | 2.13.3 | リクエストスキーマ | `src/app/schemas.py` |
| python-multipart | 0.0.26 | multipart/form-data（ファイルアップロード） | `/predict` 等 |
| torch | 2.11.0 | 分類モデルの学習・推論 | `src/app/train.py`, `src/app/predict.py` |
| torchvision | 0.26.0 | 画像変換・モデル | `src/app/train.py`, `src/app/predict.py` |
| numpy | 2.2.6 | 画像配列処理 | `src/app/services/preprocess.py` ほか |
| pillow | 12.2.0 | 画像入出力 | 前処理・API全般 |
| scipy | 1.15.3 | 照明ムラ補正・手動マスクの連結成分抽出 | `services/preprocess.py`, `services/manual_mask.py` |
| PyYAML | 6.0.2 | `settings.yaml` 読込 | `src/app/config.py` |
| easyocr | 1.7.2 | OCRエンジン（遅延import） | `src/app/predict.py` |
| paddleocr | 3.5.0 | OCRエンジン（遅延import） | `src/app/predict.py` |
| paddlepaddle | 3.3.1（`paddlepaddle-gpu==2.6.2` も記載あり） | PaddleOCR ランタイム | OCR学習・推論 |
| paddlex | 3.5.2 | PaddleOCR 3.x 依存 | PaddleOCR経由 |
| ultralytics | 8.4.41 | YOLO 検出（データ作成 Step2） | `services/training_image_builder.py` |
| opencv-python | 4.13.0.92（contrib 4.10.0.84 / headless 併記） | 画像処理（requirementsに存在。CI用メモでは遅延import扱い） | `requirements.txt`, `requirements-ci.txt` コメント |
| scikit-learn | 1.7.2 | 評価指標 | `services/evaluation.py` |
| matplotlib | 3.10.9 | 評価グラフ（混同行列等） | `services/evaluation.py` |
| pandas | 2.3.3 | データ処理 | `requirements.txt` に記載 |
| RapidFuzz | 3.14.5 | 文字列類似（requirements に記載） | `requirements.txt` |

Tesseract は pip 依存ではなく**外部実行ファイル**（`config/settings.yaml` の `tesseract.tesseract_cmd` 等でパス指定）。

## フロントエンド

| ライブラリ | バージョン | 用途 | 使用箇所 |
|---|---|---|---|
| react | ^18.3.1 | UIフレームワーク | `frontend/src/` 全体 |
| react-dom | ^18.3.1 | DOM描画 | `frontend/src/main.jsx` |
| @tanstack/react-virtual | ^3.14.6 | 仮想スクロール（1000枚超の画像一覧） | `views/ImagesView.jsx` |
| vite | ^5.4.10 | ビルド/開発サーバ（port 5173） | `frontend/vite.config.js` |
| @vitejs/plugin-react | ^4.3.1 | Vite React プラグイン | `frontend/vite.config.js` |
| tailwindcss | ^3.4.17 | スタイリング（ダークテーマ） | `frontend/tailwind.config.js` |
| autoprefixer / postcss | ^10.4.27 / ^8.5.8 | CSS後処理 | `frontend/postcss.config.js` |

- 状態管理ライブラリ・ルーティングライブラリは不使用（React標準hooksのみ、画面遷移は `App.jsx` の `activeView` state）。
- テストは Node.js 組み込み `node:test`（外部テストランナー不使用）。

## 開発・テスト依存

| ファイル | 内容 |
|---|---|
| `requirements-dev.txt` | `pytest>=8` のみ |
| `requirements-ci.txt` | CI最小構成（fastapi, torch CPU版, numpy, pillow, matplotlib, scikit-learn, PyYAML 等）。paddle/easyocr/cv2/ultralytics は遅延importのため含まない |
| `requirements-ocr-tuning.txt` | OCRチューニング任意依存（easyocr, paddleocr, paddlepaddle, albumentations, lmdb, rapidfuzz） |

## 外部ツール・リポジトリ

| 項目 | 内容 | 根拠 |
|---|---|---|
| Tesseract OCR | `tesseract.exe` / `lstmtraining.exe` / `combine_tessdata.exe`（Windowsパスを settings.yaml に既定記載） | `config/settings.yaml` `tesseract:` |
| tessdata_best | `models/tessdata_best`（fine-tune ベース `eng.traineddata`） | `config/settings.yaml` |
| PaddleOCR リポジトリ | `external/PaddleOCR`（OCR学習で使用、gitignore対象） | `settings.yaml` `ocr_training.paddleocr_repo_dir` |
| YOLO モデル | ルートに `yolo11n.pt`、プロジェクト別 `models/yolo/` | リポジトリ直下, 検出API |

## Docker / CI

- Dockerfile・docker-compose: **このプロジェクトでは確認できない**
- GitHub Actions: `.github/` ディレクトリは存在するが**中身は空**（ワークフロー定義なし）
- `requirements-ci.txt` のコメントに CI 用途の記載があるが、CI 定義ファイル自体は不明
