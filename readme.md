# OCR Crafter（ローカルOCR学習環境）

ローカル環境で完結する **OCRモデル開発プラットフォーム**。
画像の取り込みからデータ作成・学習・CER評価・モデル管理/比較・推論・修正までを1つのWeb UIで行う。

- バックエンド: FastAPI（`src/app/`、port 8000）
- フロントエンド: React 18 + Vite 5 + Tailwind（`frontend/`、port 5173）
- データはプロジェクト単位（`data/projects/<project_id>/`）で分離管理

詳細な利用手順: [docs/usage.md](docs/usage.md) ／ ドキュメント一覧: [docs/](docs/)

## 対応OCRエンジン

| エンジン | 学習 | 推論 | 備考 |
|---|---|---|---|
| Tesseract | ○（LSTM fine-tune） | ○ | 学習対象文字 `A-Z0-9klt`（[docs/12](docs/12_TESSERACT_CHARSET_SPEC.md)） |
| PaddleOCR | ○（認識モデル） | ○ | `external/PaddleOCR` を使用 |
| EasyOCR | ×（推論のみ） | ○ | |
| custom（分類モデル） | ○（実験機能） | ○ | 文字分割ベースの分類学習 |

## 主要ワークフロー（サイドバー順）

サイドバーはOCRモデル開発の作業工程順に並んでいる（上から順に進めるとモデルが完成する）。

1. **プロジェクト** — ダッシュボードでプロジェクト概要・進行状況を確認
2. **データ作成** — 画像指定・リサイズ → YOLO検出 → Bounding Box選択 → クロップ出力
   → 画像 → 前処理設定 → ラベル編集 → 評価データ作成
3. **OCRモデル** — データ作成・学習 → モデル管理 → モデル評価 → 推論 → OCR修正 → バッチ推論
4. **実験機能** — 分類学習 / 分類モデル管理 / 分類推論 / 分類評価

## 主要機能

- **データ作成**: YOLO検出＋BBox選択による元画像からの学習画像クロップ、前処理パイプライン（二値化・照明ムラ補正・手動マスク等）、キーボード中心のラベル編集、評価データセット作成（Step5）
- **学習**: Tesseract LSTM fine-tune / PaddleOCR認識モデル / 分類モデル（いずれも非同期ジョブ）。実験名・親モデル・学習メモをモデルメタへ保存可能
- **CER評価**: 主指標=CER（全画像の編集距離総和÷正解文字数総和のマイクロ平均）。文字正解率・完全一致率・改善/同等/悪化・混同TOP（置換/脱落/挿入）・CSV出力・評価履歴
- **モデル管理**: 管理No（M0001形式・全プロジェクト横断で一意・削除後も再利用しない）、モデルカルテ（数字主体のダッシュボード）
- **モデル比較**: 最大3モデルを固定色（ブルー/オレンジ/パープル）で比較。性能サマリー・改善悪化比較・学習条件比較・条件差分・次回学習提案・混同比較・指標別結果
- **推論・修正**: 単一推論／バッチ推論／OCR修正（キーボード中心・修正ログからのデータセット再生成）

## セットアップ・起動（Windows PowerShell）

```powershell
# 初回のみ
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd frontend; npm install; cd ..

# バックエンド
uvicorn src.app.main:app --reload --port 8000

# フロントエンド（別ターミナル）
cd frontend
npm run dev    # http://localhost:5173
```

必要なら `frontend/.env` に `VITE_API_BASE=http://127.0.0.1:8000` を設定。
Tesseract学習にはUB-Mannheimビルド等の学習ツール（lstmtraining）が必要（[docs/11](docs/11_TESSERACT_CHECKLIST.md)）。

## テスト・ビルド

```powershell
python -m pytest -q            # バックエンド（.venv）
cd frontend; npm test          # フロントエンド（node:test）
cd frontend; npm run build     # フロントのビルド（バックエンドにビルド工程なし）
```

## 設定・データ

- `config/settings.yaml`: 前処理パイプライン・学習デフォルト・Tesseractパス等の全設定（[docs/08](docs/08_CONFIGURATION.md)）
- `data/projects/<project_id>/`: 画像・ラベル・モデル・出力（gitignore対象）
- `data/model_ids.json`: モデル管理Noの登録簿（全プロジェクト共通）

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/00_PROJECT_OVERVIEW.md](docs/00_PROJECT_OVERVIEW.md) | プロジェクト概要・画面構成 |
| [docs/04_BUILD_AND_RUN.md](docs/04_BUILD_AND_RUN.md) | ビルド・実行・テスト |
| [docs/06_API_REFERENCE.md](docs/06_API_REFERENCE.md) | API仕様（全エンドポイント） |
| [docs/11_TESSERACT_CHECKLIST.md](docs/11_TESSERACT_CHECKLIST.md) | Tesseract学習・推論・評価チェックリスト |
| [docs/12_TESSERACT_CHARSET_SPEC.md](docs/12_TESSERACT_CHARSET_SPEC.md) | charset / whitelist 確定仕様 |
| [docs/16_SCREEN_SPEC.md](docs/16_SCREEN_SPEC.md) | 画面仕様（UI） |
| [docs/17_DATAFLOW.md](docs/17_DATAFLOW.md) | 処理・保存フロー |
| [docs/15_CHANGELOG_AI.md](docs/15_CHANGELOG_AI.md) | 仕様変更の理由と履歴 |
| [CLAUDE.md](CLAUDE.md) | 開発ルール（AIエージェント向け） |
