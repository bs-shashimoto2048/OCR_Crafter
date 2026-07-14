# ドキュメント生成レポート

生成日: 2026-07-14（同日「AIコーディング用ドキュメントの強化」で更新）。
リポジトリ全体（バックエンド31ファイル / フロントエンド32ファイル / テスト12ファイル / 設定・docs）を解析し、実在する情報のみを根拠に作成した。

## 作成したファイル一覧

| ファイル | 内容 |
|---|---|
| `docs/00_PROJECT_OVERVIEW.md` | プロジェクト概要・機能・技術・実行/ビルド/テスト方法 |
| `docs/01_ARCHITECTURE.md` | 全体構成・レイヤ・モジュール関係・データフロー（Mermaid図3点） |
| `docs/02_DIRECTORY_STRUCTURE.md` | ディレクトリツリーと各ファイルの役割 |
| `docs/03_TECH_STACK.md` | ライブラリ一覧（バージョン・用途・使用箇所） |
| `docs/04_BUILD_AND_RUN.md` | 実在するsetup/run/build/testコマンドのみ |
| `docs/05_CODING_CONVENTIONS.md` | コードから読み取った命名・配置・エラー処理等の実態 |
| `docs/06_API_REFERENCE.md` | 全55エンドポイント（メソッド/パス/リクエスト/レスポンス） |
| `docs/07_DATABASE.md` | SQLite（training_jobs）とファイルベース永続化 |
| `docs/08_CONFIGURATION.md` | settings.yaml・環境変数・localStorage・Feature Flag |
| `docs/09_AI_DEVELOPMENT_GUIDE.md` | AI開発向け: 編集可否・実装ルール・チェックリスト |
| `docs/10_KNOWN_LIMITATIONS.md` | 未実装・制約・QA既知課題 |
| `docs/15_CHANGELOG_AI.md` | **AI仕様変更履歴**（「なぜこの仕様か」を機能別に整理。2026-07の13仕様+補足） |
| `CLAUDE.md`（リポジトリ直下） | Claude Code専用ガイド + **「絶対に変更してはいけない仕様」章** |
| `docs/DOCUMENTATION_REPORT.md` | 本レポート |

- 既存の `docs/11〜14` と `docs/usage.md` は変更していない（番号衝突なし）。
- `CLAUDE.md` は指示上 docs/ 配下だが、Claude Code が自動読込する仕様に合わせ**リポジトリ直下**へ配置した。

## 強化タスクでの更新内容（2026-07-14）

| ファイル | 更新内容 |
|---|---|
| `docs/15_CHANGELOG_AI.md`（新規） | YOLO検出前処理 / 元画像クロップ / BBox Undo・Redo / BBox Tab移動 / BBox編集仕様変更 / OCR候補辞書 / OCR小文字制御 / 仮想スクロール / サムネイルAPI / 手動マスク補正 / 照明ムラ補正 / ダッシュボード刷新 / OCR修正画面改善 の13仕様＋補足6件。各仕様に「概要・変更理由・注意事項・影響範囲」を記載（根拠コミットハッシュ併記、Mermaidタイムライン付き） |
| `CLAUDE.md` | 「絶対に変更してはいけない仕様」章を追加（学習画像 / OCR前処理の独立 / Bounding Box / プロジェクト互換性 / UI / AI実装ルール / ドキュメント更新義務の7節） |
| `docs/09_AI_DEVELOPMENT_GUIDE.md` | 「AIへ実装依頼するときの推奨プロンプト」を追加（UI変更 / API追加 / OCR改善 / モデル追加 / 前処理追加 / パフォーマンス改善の6テンプレート＋共通の型のMermaid図。本リポジトリのtask.md実績に基づく） |
| `docs/16_SCREEN_SPEC.md`（新規） | 画面仕様書。全画面（ダッシュボード〜学習画像作成Step1-4・実験機能）の目的・表示内容・主操作・ショートカット・関連画面＋画面マップ（Mermaid）。ショートカットは各viewのkeydown実装から抽出 |
| `docs/17_DATAFLOW.md`（新規） | データフロー全体図（Mermaid）。元写真→検出前処理→YOLO→BBox→元画像クロップ→OCR前処理→OCR→辞書候補→ラベル→学習→評価の1枚図＋フロー上の不変条件表＋永続化ポイント図 |
| `CLAUDE.md`（追記2回目） | 「実装後の義務」章を追加（UI変更→16 / データ構造変更→17 / 設定追加→08 / API追加→06 / 画面追加→00+16 / 仕様変更→15 の更新義務） |

## 根拠にしたファイル一覧

| 分類 | ファイル |
|---|---|
| ソース（バックエンド） | `src/app/*.py` 14ファイル、`src/app/services/*.py` 17ファイル |
| ソース（フロントエンド） | `frontend/src/App.jsx`、`views/` 12、`components/` 14、`lib/` 5、`main.jsx`、`index.css` |
| テスト | `tests/` 11ファイル（conftest.py含む）、`frontend/tests/` 2ファイル |
| 設定 | `config/settings.yaml`、`frontend/vite.config.js`、`frontend/tailwind.config.js`、`frontend/postcss.config.js`、`frontend/package.json`、`.gitignore` |
| 依存定義 | `requirements.txt`（UTF-16）、`requirements-ci.txt`、`requirements-dev.txt`、`requirements-ocr-tuning.txt`、`Pipfile` |
| ドキュメント | `readme.md`、`CHANGELOG.md`、`docs/usage.md`、`docs/11_TESSERACT_CHECKLIST.md`、`docs/12_TESSERACT_CHARSET_SPEC.md`、`docs/13_QA_STATUS.md`、`docs/14_RELEASE_CHECKLIST.md` |
| その他 | `.github/`（空であることを確認）、git log（コミット形式の確認） |

## 情報不足だった項目

| 項目 | 状況 |
|---|---|
| CI/CD | `.github/` が空。`requirements-ci.txt` は存在するが、参照するワークフロー定義が存在しない |
| Docker | Dockerfile / docker-compose が存在しない |
| Pythonバージョン | Pipfile=3.9 / docs/usage.md=3.11+ で記述が不一致（正は不明のため両論併記） |
| Lint / フォーマッタ | 設定ファイルなし（`.gitignore` に `.ruff_cache/` の記載のみ） |
| ライセンス | LICENSE ファイルが存在しない（GitHub公開時に要追加） |
| `main.py` の一部 | 約2460行のうち学習ジョブ実装後半は関数シグネチャ・呼び出し関係までの確認（エンドポイント自体は全数確認済み） |

## 推測せず省略した項目

- パフォーマンス数値・スケーラビリティの一般論（コードに実測記録がないため）
- デプロイ手順（ローカル起動以外の手順が存在しないため）
- ブランチ戦略・レビュー体制（リポジトリから確認できないため）
- EasyOCRのファインチューニング手順（データエクスポート機能はあるが学習コード自体は存在しないため、エクスポートのみ記載）
- `paddlepaddle` と `paddlepaddle-gpu` が requirements.txt に併記されている理由（事実のみ記載し解釈は省略）

## 今後追加すると良いドキュメント

| 候補 | 理由 |
|---|---|
| LICENSE | GitHub公開の前提。現状ライセンス不明 |
| CONTRIBUTING.md | コミット形式・検証手順は確立しているため文書化コストが低い |
| GitHub Actions ワークフロー + そのドキュメント | `requirements-ci.txt` が既に用意されている（pytest実行のCI化） |
| 前処理パイプライン仕様書 | `_op_*` 各工程のパラメータと効果の一覧（settings.yaml と preprocess.py に分散） |
| 学習運用ガイドの更新 | `docs/usage.md` が旧macOS環境前提のため、Windows環境の現行手順への更新 |
| データ移行・バックアップ手順 | `data/projects/` の資産保護（QA既知課題にデータ消失の記録あり） |
