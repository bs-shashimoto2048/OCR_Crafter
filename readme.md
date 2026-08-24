# OCR Crafter（ローカルOCR学習環境）

ローカル環境で完結する **OCRモデル開発プラットフォーム**。
画像の取り込みからデータ作成・学習・CER評価・モデル管理/比較・推論・修正までを1つのWeb UIで行う。

- バックエンド: FastAPI（`src/app/`、port 8000、全142エンドポイント）
- フロントエンド: React 18 + Vite 5 + Tailwind（`frontend/`、port 5173）
- データはプロジェクト単位（`data/projects/<project_id>/`）で分離管理
- 軽量な識別のみ（SSO等は無し）・ローカル実行前提（外部通信なし）

ドキュメント案内: [docs/README.md](docs/README.md) ／ 初めての方: [docs/manual/01_はじめに.md](docs/manual/01_はじめに.md) ／ 操作しながら学ぶ: [docs/tutorial/01_Tesseractチュートリアル.md](docs/tutorial/01_Tesseractチュートリアル.md) ／ 全画面仕様: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)

---

# Quick Start

## 1. Clone

```bash
git clone <repository>
cd ocr_crafter
```

## 2. Backend

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt

uvicorn src.app.main:app --reload --port 8000
```

## 3. Frontend

```bash
cd frontend

npm install
npm run dev    # http://localhost:5173
```

必要なら `frontend/.env` に `VITE_API_BASE=http://127.0.0.1:8000` を設定する。

## 4. Build

```bash
cd frontend
npm run build    # frontend/dist/ へ出力（バックエンドにビルド工程はない）
```

## 5. Test

```bash
python -m pytest -q      # バックエンド（.venv経由・tests/ 87ファイル）

cd frontend
npm test                 # フロントエンド（node:test・依存追加不要・71ファイル）
```

Tesseractの学習には別途、学習ツール（`lstmtraining` を含むUB-Mannheimビルド等）が必要（[docs/11_TESSERACT_CHECKLIST.md](docs/11_TESSERACT_CHECKLIST.md)）。動作確認済み環境はWindows 11（[docs/INSTALLATION_GUIDE.md](docs/INSTALLATION_GUIDE.md)）。

---

## 対応OCRエンジン

| エンジン | 学習 | 推論 | 備考 |
|---|---|---|---|
| Tesseract | ○（LSTM fine-tune） | ○ | 学習対象文字 `A-Z0-9klt+-`（[docs/12](docs/12_TESSERACT_CHARSET_SPEC.md)） |
| PaddleOCR | ○（認識モデル） | ○ | `external/PaddleOCR` を使用。公式モデルでの推論も可 |
| TrOCR | ○（Hugging Face Transformers `VisionEncoderDecoderModel` fine-tune） | ○ | 学習→モデル管理→推論→評価→Benchmark→リリース管理までE2E検証済み（Issue #164）。confidence・PSM/Whitelistの概念は無し |
| EasyOCR | ×（推論のみ） | ○ | |
| custom（分類モデル） | ○（実験機能） | ○ | 文字分割ベースの分類学習 |

## 主な機能

### データ作成・学習

- **データ準備**: OCR画像作成（画像指定・リサイズ → YOLO検出 → BBox選択 → 元画像からのクロップ出力）、前処理パイプライン（二値化・照明ムラ補正・手動マスク補正等・リアルタイムプレビュー）、キーボード中心のラベル編集（OCR候補・辞書近似候補のクリック採用）
- **学習**: Tesseract LSTM fine-tune / PaddleOCR認識モデル / TrOCR（Hugging Face Transformers）fine-tune / 分類モデル（実験機能）。いずれも非同期ジョブ（ジョブ管理画面で進捗確認）。実験名・親モデル・学習メモをモデルメタへ保存可能
- **前処理の再現性**: 前処理実行時に実効パラメータを完全スナップショットとして保存し、データセット→モデル→比較まで引き継ぐ。前処理ハッシュで一致/差異/未記録を判定し、評価・推論で「学習時前処理」をそのまま再現できる

### Dataset Manager

学習データセットの資産管理画面（Dataset ID=`DS0001`形式・全プロジェクト共通の登録簿）。

- 一覧（作成日時降順・列ソート可能）、Dataset詳細（前処理Version/Hash・学習設定・使用モデル一覧）
- **Dataset⇔Model双方向リンク**（あるDatasetから作られたモデル一覧／あるモデルの学習元Datasetを相互に確認できる）
- コピー・削除（使用モデルがある場合は警告）、コメント編集
- Dataset名・コメント・Charset・前処理Versionでの検索

### Experiment Tracking（実験管理）

学習実行ごとに自動生成される実験カルテ（`EXP-0001`形式）。

- 学習条件・前処理ハッシュ・オーグメンテーション設定・評価結果・学習時間を1件にまとめて記録
- Experiment比較（条件差分の強調表示）、CER推移等のグラフ、簡易相関・ベスト条件・条件推薦
- タグ・★（お気に入り）・フィルタ・CSV出力
- モデルカルテ・Dataset Managerとの相互リンク（「このモデルを作成したExperiment」等）

### Benchmark Runner / Benchmark Center

2つの独立した比較ツールを提供する（コード・保存先・目的は完全に分離）。

| | Benchmark Runner（旧称「Benchmark」） | Benchmark Center |
|---|---|---|
| 性質 | OCRエンジンを**実際に実行**して精度・速度を公平比較する実行ツール | 既存のDataset/Experiment/Model/評価結果を**実行せず横断比較**するだけの参照ビュー |
| ID形式 | `BM-0001` | `BMC-0001` |
| 主な出力 | cold start/推論時間分離・Leaderboard・用途別ベスト・画像単位比較 | 比較表・🏆最良値・レーダーチャート・推移グラフ・モデル推薦 |
| 詳細 | [docs/19_BENCHMARK_SPEC.md](docs/19_BENCHMARK_SPEC.md) | [docs/16_SCREEN_SPEC.md](docs/16_SCREEN_SPEC.md) |

### モデル管理

- 管理No（`M0001`形式・全プロジェクト横断で一意・削除後も再利用しない）
- モデルカルテ（数字主体のダッシュボード・学習前処理の記録表示・コメント編集・「このモデルを作成したExperiment」リンク）
- **モデル比較**: 最大3モデルを固定色（ブルー/オレンジ/パープル）で比較。性能サマリー・改善悪化比較・学習条件比較・学習前処理比較（一致判定・差分）・条件差分・次回学習提案・混同比較
- **リリース管理**: モデルのライフサイクル（Draft→Validated→Candidate→Production→Archived。Productionは1つだけ）、Release Note必須の昇格・バージョン採番・Release History・Rollback、Release Policyに基づく昇格自動判定（PASS/CONDITIONAL_PASS/FAIL）、Model Card自動生成、Deployment Package（ZIP）Export。Tesseract/PaddleOCR/TrOCRのいずれのモデルも対象

### モデル評価

- 主指標は **CER**（全画像の編集距離総和 ÷ 正解文字数総和のマイクロ平均。評価はcase-sensitive完全一致）
- 文字正解率・完全一致率・改善/同等/悪化・混同TOP（置換/脱落/挿入）・CSV出力（前処理識別情報付き）・評価履歴
- 評価前処理モード = 学習時前処理（既定）／手動設定／前処理なし。学習時前処理との一致判定・不一致時の警告

### 推論モデル切替

- モデル管理画面の「推論に使用」ボタンから、OCR推論で使用するモデルをプロジェクト単位で明示的に切り替える
- 選択は`GET/POST /api/ocr/inference/model`（`data/projects/<id>/inference_model.json`）へ即時保存され、画面遷移・ブラウザ再読み込み・アプリ再起動をまたいで維持される
- 既に別モデルが設定されている状態からの切替時のみ確認ダイアログを表示（初回設定時は確認不要）。切替APIの通信中は一時的に無効化し、連打による重複リクエストを防止
- 保存された「現在の推論使用モデル」と、推論/バッチ推論画面で試し撃ち用に選ぶモデルの選択状態は独立している（試し撃ち画面で別モデルを選んでも、保存済みの推論使用モデルは変わらない）

### 推論・修正

- 単一推論／バッチ推論／YOLO検出+OCR複合推論。エンジン: custom / EasyOCR / PaddleOCR / Tesseract / TrOCR
- OCR修正画面（キーボード中心・修正ログからのデータセット再生成）

### その他の管理機能

- **ジョブ管理**: バックグラウンドジョブの統一管理（`JOB-000001`形式・状態遷移検証・同時実行制御・進捗0-100%＋イベント履歴・キャンセル/再実行）
- **レポート**: モデル開発レポート自動生成（単一モデル/比較/プロジェクト総括。Markdown/PDF、外部通信なし）
- **監査ログ・運用**: 追記型監査ログ（削除不可・Before/After差分）、運用ダッシュボード、ヘルスチェック、バックアップ（metadata_only/full）

## 最新画面構成（サイドバー・OCR開発フロー順）

```text
プロジェクト     … ダッシュボード
データ準備       … OCR画像作成（画像指定・リサイズ / YOLO検出 / Bounding Box選択 / クロップ出力）
                   / 学習データ（画像 / 前処理設定 / ラベル編集）
                   / 評価データ（データセット作成）  ※3つの折りたたみグループ
OCRモデル        … データ作成・学習 / モデル管理 / Dataset Manager / 実験管理 / リリース管理
                   / モデル評価 / 推論 / OCR修正 / バッチ推論
運用             … ジョブ管理 / Benchmark Runner / Benchmark Center / レポート / 監査ログ / システム状態
実験機能         … 分類学習 / 分類モデル管理 / 分類推論 / 分類評価
```

各画面の詳細仕様は [docs/16_SCREEN_SPEC.md](docs/16_SCREEN_SPEC.md) を参照。

## ディレクトリ構成

```text
ocr_crafter/
├── config/settings.yaml     # 全設定（前処理パイプライン・学習・Tesseract・CORS等）
├── src/app/
│   ├── main.py              # FastAPI本体（全142エンドポイント）
│   ├── schemas.py           # Pydanticリクエストスキーマ
│   ├── train.py / predict.py / job_runner.py / ocr_tuning.py  # CLIエントリ
│   └── services/            # 前処理・OCRパイプライン（Tesseract/PaddleOCR/TrOCR）・モデル管理等のドメインロジック（57モジュール）
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # 全状態管理・view切替
│   │   ├── views/           # 22画面
│   │   ├── components/      # 共通UI 20種
│   │   └── lib/             # 純粋ロジック（api.js 等 53種）
│   └── tests/                # node:test（71ファイル、依存追加不要）
├── tests/                    # pytest（87ファイル、temp_projectsフィクスチャで実データ隔離）
├── docs/                     # ドキュメント（本README・番号付き仕様書・利用者/管理者向けガイド）
├── data/projects/<id>/       # プロジェクトデータ（gitignore対象）
├── data/jobs/                # Job System B: job_manager.db（SQLite）・events/・logs/（gitignore対象）
├── data/backups/             # project単位ZIP backup・system/配下にGlobal SQLite backup（gitignore対象）
├── models/ / outputs/ / external/   # モデル・出力（outputs/app.db=Job System A）・外部リポジトリ（gitignore対象）
└── requirements.txt          # 全量スナップショット（UTF-16エンコード・既知課題）
```

詳細は [docs/02_DIRECTORY_STRUCTURE.md](docs/02_DIRECTORY_STRUCTURE.md) を参照。

## 開発環境

- 動作確認済みOS: Windows 11（PowerShell）。`config/settings.yaml`の既定値もWindows前提
- Python 3.10（CI・実運用venvで使用しているバージョン。Pipfileには3.9の記載が残る既知の不一致あり）
- Node.js（`frontend/package.json`のscripts: dev/build/preview/test）
- 状態管理はReact標準hooksのみ（Redux等の追加ライブラリ不使用）、TypeScript不使用
- Tesseract本体は別途インストールが必要（既定パス `C:\Program Files\Tesseract-OCR\`、`config/settings.yaml`で変更可）

## 設定・データ

- `config/settings.yaml`: 前処理パイプライン・学習デフォルト・Tesseractパス等の全設定（[docs/08](docs/08_CONFIGURATION.md)）
- `data/projects/<project_id>/`: 画像・ラベル・モデル・出力（gitignore対象）
- `data/model_ids.json` / `data/dataset_ids.json`: モデル管理No／Dataset管理Noの登録簿（全プロジェクト共通）

## ドキュメント

入口: [docs/README.md](docs/README.md)（対象読者別の案内）。初めての方は [docs/manual/](docs/manual/01_はじめに.md)（教育コンテンツ）・[docs/tutorial/](docs/tutorial/01_Tesseractチュートリアル.md)（操作しながら学ぶ）・[docs/examples/](docs/examples/README.md)（データ構造の実例）。利用者向けは [USER_GUIDE](docs/USER_GUIDE.md) / [FAQ](docs/FAQ.md)、管理者向けは [ADMIN_GUIDE](docs/ADMIN_GUIDE.md) / [INSTALLATION_GUIDE](docs/INSTALLATION_GUIDE.md) / [BACKUP_AND_RESTORE](docs/BACKUP_AND_RESTORE.md)。

| 詳細仕様書 | 内容 |
|---|---|
| [docs/00_PROJECT_OVERVIEW.md](docs/00_PROJECT_OVERVIEW.md) | プロジェクト概要・画面構成 |
| [docs/04_BUILD_AND_RUN.md](docs/04_BUILD_AND_RUN.md) | ビルド・実行・テスト |
| [docs/06_API_REFERENCE.md](docs/06_API_REFERENCE.md) | API仕様（全エンドポイント） |
| [docs/11_TESSERACT_CHECKLIST.md](docs/11_TESSERACT_CHECKLIST.md) | Tesseract学習・推論・評価チェックリスト |
| [docs/12_TESSERACT_CHARSET_SPEC.md](docs/12_TESSERACT_CHARSET_SPEC.md) | charset / whitelist 確定仕様 |
| [docs/16_SCREEN_SPEC.md](docs/16_SCREEN_SPEC.md) | 画面仕様（UI・全画面） |
| [docs/17_DATAFLOW.md](docs/17_DATAFLOW.md) | 処理・保存フロー |
| [docs/18_JOB_MANAGEMENT.md](docs/18_JOB_MANAGEMENT.md) | ジョブ管理仕様 |
| [docs/19_BENCHMARK_SPEC.md](docs/19_BENCHMARK_SPEC.md) | Benchmark Runner仕様 |
| [docs/20_RELEASE_POLICY.md](docs/20_RELEASE_POLICY.md) | リリース判定ポリシー |
| [docs/15_CHANGELOG_AI.md](docs/15_CHANGELOG_AI.md) | 仕様変更の理由と履歴 |
| [CLAUDE.md](CLAUDE.md) | 開発ルール（AIエージェント向け） |

## 開発に参加する（GitHub Issues駆動開発）

機能追加・不具合修正は、GitHub Issueを起点に進めます。詳細は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

- [CONTRIBUTING.md](CONTRIBUTING.md) — Issue作成・ブランチ・Commit・PR・テストのルール
- [docs/development/GITHUB_ISSUES_WORKFLOW.md](docs/development/GITHUB_ISSUES_WORKFLOW.md) — Issue駆動開発の全体フロー
- [docs/development/ISSUE_WRITING_GUIDE.md](docs/development/ISSUE_WRITING_GUIDE.md) — Issueの書き方
- [docs/development/AI_AGENT_WORKFLOW.md](docs/development/AI_AGENT_WORKFLOW.md) — AIコーディングエージェント向け運用ガイド
