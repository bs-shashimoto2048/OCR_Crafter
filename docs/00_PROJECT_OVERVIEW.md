# 00. プロジェクト概要

## OCR Crafter とは

ローカル環境で完結する **OCR学習環境**（Webアプリ）。
画像の取り込み → 前処理 → ラベル付け → データセット作成 → OCRモデル学習 → 評価 → 推論・修正 までを1つのUIで行う。

- バックエンド: FastAPI（`src/app/`）
- フロントエンド: React + Vite（`frontend/`）
- データはプロジェクト単位（`data/projects/<project_id>/`）で分離管理

（出典: `readme.md`, `docs/usage.md`, `config/settings.yaml`）

## 解決する課題

コード・ドキュメントから確認できる用途:

- 大文字英数字＋小文字筆記体（k/l/t）を含む刻印文字列（例 `CHYBkt`）のOCR認識（`docs/12_TESSERACT_CHARSET_SPEC.md`, `settings.yaml tesseract.default_charset`）
- 1000枚超の画像を高速に確認・ラベル付け・修正する作業効率化（仮想スクロール、キーボード中心のOCR修正画面）
- OCRが完全一致しない場合の補助（候補辞書による近似候補提示、文字別確信度ヒートマップ）

## 主な機能

| 分類 | 機能 |
|---|---|
| データ管理 | プロジェクト作成/切替、画像取り込み（フォルダ選択）、画像回転（90°/180°）、サムネイル |
| 前処理 | 二値化・照明ムラ補正・手動マスク補正など多段パイプライン、リアルタイムプレビュー、プリセット保存 |
| ラベル | ラベル編集（OCR候補・辞書近似候補のクリック採用）、未編集フィルタ |
| 学習 | PaddleOCR認識モデル学習 / Tesseract LSTM fine-tune / 分類モデル学習（実験機能）— いずれも非同期ジョブ |
| 推論 | 単一推論・バッチ推論・YOLO検出+OCR複合推論。エンジン: custom / EasyOCR / PaddleOCR / Tesseract |
| 修正 | OCR修正画面（キーボード中心）、修正ログの保存とデータセット再生成 |
| 評価 | 分類モデル評価、OCRモデル評価（学習前後比較・CSV出力） |
| 学習画像作成 | YOLO検出 → BBox選択 → 元画像からのクロップ出力 → 評価用データ作成（5ステップ） |

## 使用技術（要約）

| 層 | 技術 |
|---|---|
| API | FastAPI 0.136 + uvicorn（port 8000） |
| OCR | EasyOCR 1.7.2 / PaddleOCR 3.5.0 / Tesseract（外部実行ファイル） |
| 学習 | PaddleOCR（`external/PaddleOCR`）, Tesseract lstmtraining, PyTorch 2.11（分類） |
| 検出 | ultralytics YOLO 8.4 |
| UI | React 18 + Vite 5 + Tailwind CSS 3（ダークテーマ、状態管理はReact標準hooksのみ） |
| 永続化 | SQLite（学習ジョブ）+ CSV/JSONファイル（ラベル・マスク・ログ）+ localStorage（UI設定） |

詳細は `docs/03_TECH_STACK.md` を参照。

## ディレクトリ概要

| パス | 内容 |
|---|---|
| `src/app/` | FastAPIバックエンド（main.py に全55エンドポイント） |
| `src/app/services/` | 前処理・OCRパイプライン・モデル管理などのドメインロジック |
| `frontend/` | React UI（views 12画面 / components / lib） |
| `config/settings.yaml` | 全設定（前処理・学習・Tesseract等） |
| `data/projects/<id>/` | プロジェクトデータ（gitignore対象） |
| `models/`, `outputs/`, `external/` | モデル・出力・外部リポジトリ（gitignore対象） |
| `tests/` | pytest テスト（10ファイル） |
| `docs/` | ドキュメント |

詳細は `docs/02_DIRECTORY_STRUCTURE.md` を参照。

## 実行方法

```bash
# バックエンド
uvicorn src.app.main:app --reload --port 8000

# フロントエンド
cd frontend && npm run dev    # http://localhost:5173
```

## ビルド方法

```bash
cd frontend && npm run build    # frontend/dist/ へ出力
```

バックエンドにビルド工程はない。

## テスト方法

```bash
python -m pytest -q      # バックエンド（tests/）
cd frontend && npm test  # フロントエンド（node:test）
```

詳細は `docs/04_BUILD_AND_RUN.md` を参照。

## 動作環境

- 開発の由来はmacOS（Apple Silicon）向け手順（`docs/usage.md`）だが、現行設定は Windows のTesseractパスを既定値に持つ（`config/settings.yaml`）
- Python: Pipfile は 3.9、usage.md は 3.11以上（記述間の不一致あり）
- 認証なし・ローカル実行前提（CORS許可はローカルのVite開発サーバーのみ）
