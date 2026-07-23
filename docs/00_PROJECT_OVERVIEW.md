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
| データ作成 | 画像指定・リサイズ → YOLO検出 → BBox選択 → 元画像からのクロップ出力（Step1〜4）＋ 評価データセット作成（Step5） |
| 前処理 | 二値化・照明ムラ補正・手動マスク補正など多段パイプライン、リアルタイムプレビュー、プリセット保存 |
| ラベル | ラベル編集（OCR候補・辞書近似候補のクリック採用）、未編集フィルタ |
| 学習 | PaddleOCR認識モデル学習 / Tesseract LSTM fine-tune / 分類モデル学習（実験機能）— いずれも非同期ジョブ。実験名・親モデル・学習メモをモデルメタへ保存可能 |
| 評価 | OCRモデル評価（主指標=**CER**のマイクロ平均。文字正解率・完全一致率・改善/同等/悪化・混同TOP・CSV出力・評価履歴・学習データ重複チェック）、分類モデル評価 |
| モデル管理 | 管理No（M0001形式・全プロジェクト横断で一意・削除後も再利用しない）、モデルカルテ、**モデル比較**（最大3件・固定色・性能サマリー/学習条件比較/条件差分/次回学習提案） |
| 実験管理 | 学習実行ごとの実験カルテ（EXP-0001形式・学習条件/前処理ハッシュ/Aug/評価/学習時間）、Experiment比較（条件差分の強調表示）、CER推移等のグラフ、簡易相関・ベスト条件・条件推薦、タグ・★・フィルタ・CSV出力、モデルカルテとの相互リンク |
| リリース管理 | モデルのライフサイクル（Draft→Validated→Candidate→Production→Archived・Productionは1つだけ）、Release Note必須の昇格・バージョン採番・Release History・Rollback・本番比較・安全性警告、Model Card自動生成、Deployment Package（ZIP）Export |
| 推論 | 単一推論・バッチ推論・YOLO検出+OCR複合推論。エンジン: custom / EasyOCR / PaddleOCR / Tesseract |
| 修正 | OCR修正画面（キーボード中心）、修正ログの保存とデータセット再生成 |
| ジョブ管理 | バックグラウンドジョブの統一管理（JOB-000001形式・全体一意、状態遷移検証、同時実行制御、進捗0-100%＋イベント履歴、キャンセル・再実行）。詳細は `docs/18_JOB_MANAGEMENT.md` |
| Benchmark | 複数OCRエンジンの公平比較（BM-0001形式、Profile Hash、cold start/推論時間分離、Leaderboard、用途別ベスト＋バランス式、画像単位比較、CSV3種）。詳細は `docs/19_BENCHMARK_SPEC.md` |
| Release Gate | Release Policy（プロジェクト毎12項目）に基づく昇格自動判定（PASS/CONDITIONAL_PASS/FAIL/NOT_EVALUATED）、FAILは例外承認必須、Release ID（REL-0001）。詳細は `docs/20_RELEASE_POLICY.md` |
| 監査・運用 | 監査ログ（13操作・追記型・削除不可・Before/After差分）、ユーザー識別（X-Operator/X-Role・認証未設定モード明示）、運用ダッシュボード、ヘルスチェック3段階。詳細は `docs/21_OPERATIONS_GUIDE.md` / `22_SECURITY_AND_AUDIT.md` |

## 画面構成（サイドバー・OCR開発フロー順）

```text
プロジェクト     … ダッシュボード
データ作成       … 画像指定・リサイズ / YOLO検出 / Bounding Box選択 / クロップ出力
                   / 画像 / 前処理設定 / ラベル編集 / 評価データ作成
OCRモデル        … データ作成・学習 / モデル管理 / 実験管理 / リリース管理 / モデル評価 / 推論 / OCR修正 / バッチ推論
運用             … ジョブ管理 / Benchmark / 監査ログ / システム状態
実験機能         … 分類学習 / 分類モデル管理 / 分類推論 / 分類評価
```

各画面の仕様は `docs/16_SCREEN_SPEC.md` を参照。

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
| `src/app/` | FastAPIバックエンド（main.py に全71エンドポイント） |
| `src/app/services/` | 前処理・OCRパイプライン・モデル管理などのドメインロジック |
| `frontend/` | React UI（views 13画面 / components / lib） |
| `config/settings.yaml` | 全設定（前処理・学習・Tesseract等） |
| `data/projects/<id>/` | プロジェクトデータ（gitignore対象）。`data/model_ids.json`=モデル管理No登録簿（全プロジェクト共通） |
| `models/`, `outputs/`, `external/` | モデル・出力・外部リポジトリ（gitignore対象） |
| `tests/` | pytest テスト（21ファイル） |
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
