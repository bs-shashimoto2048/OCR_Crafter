# OCR Crafter ドキュメント案内

**OCR Crafter** は、ローカル環境で完結するOCRモデル開発プラットフォーム（Webアプリ）です。
画像の取り込み・前処理・ラベル付け・データセット作成・学習（Tesseract / PaddleOCR）・評価・モデル管理・リリース管理・レポート作成までを1つのUIで行います。

- 現在のバージョン: **v1.0.0**（`src/app/version.py` の `APP_VERSION` が単一情報源）
- 動作形態: ローカル実行（FastAPI port 8000 + React port 5173）。**外部Webサービスへデータを送信しません**

## 対象読者と最初に読む文書

| あなたは… | 最初に読む | 次に読む |
|---|---|---|
| 初めて利用する方 | [QUICK_START.md](QUICK_START.md) | [manual/01_はじめに.md](manual/01_はじめに.md) → [USER_GUIDE.md](USER_GUIDE.md) |
| 操作しながら学びたい方 | [tutorial/01_Tesseractチュートリアル.md](tutorial/01_Tesseractチュートリアル.md) | [manual/](manual/01_はじめに.md) 各章 |
| 導入・環境構築を行う方 | [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) | [ADMIN_GUIDE.md](ADMIN_GUIDE.md) |
| 日常運用・保守を行う方 | [ADMIN_GUIDE.md](ADMIN_GUIDE.md) | [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) / [UPDATE_GUIDE.md](UPDATE_GUIDE.md) |
| 問題が発生した方 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | [FAQ.md](FAQ.md) |
| リリース・受入試験の担当者 | [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | [UAT_CHECKLIST.md](UAT_CHECKLIST.md) |
| 開発・保守担当者 | [09_AI_DEVELOPMENT_GUIDE.md](09_AI_DEVELOPMENT_GUIDE.md) | 下記「詳細仕様書」一覧 |
| 機能追加・不具合修正を行う方（人間・AIエージェント問わず） | [../CONTRIBUTING.md](../CONTRIBUTING.md) | [development/GITHUB_ISSUES_WORKFLOW.md](development/GITHUB_ISSUES_WORKFLOW.md) |

## 目的別ドキュメント一覧

### マニュアル（manual/）— 初めて使う方向けの教育コンテンツ

`USER_GUIDE.md`が全画面の網羅的な仕様説明であるのに対し、`manual/`は開発フロー（Dataset→Preprocess→Training→Experiment→Model→Evaluation→Benchmark）に沿って要点だけを説明する教育コンテンツです。実装済みの内容のみを記載しています。

| ドキュメント | 内容 |
|---|---|
| [manual/01_はじめに.md](manual/01_はじめに.md) | OCR Crafterとは・対応エンジン・出来ること・開発フロー全体図 |
| [manual/02_学習データ作成.md](manual/02_学習データ作成.md) | Dataset・Dataset Manager・作成手順・画像/ラベル形式 |
| [manual/03_評価データ作成.md](manual/03_評価データ作成.md) | 評価Datasetの作り方・学習Datasetとの違い |
| [manual/04_Tesseract学習.md](manual/04_Tesseract学習.md) | 学習画面の使い方・パラメータ・保存先 |
| [manual/05_モデル評価.md](manual/05_モデル評価.md) | 評価の実行方法・Benchmark Runner/Centerとの関係 |
| [manual/06_評価結果の見方.md](manual/06_評価結果の見方.md) | CER等の指標を初心者向けに概念で説明 |
| [manual/07_モデル管理.md](manual/07_モデル管理.md) | Model Manager・推論使用モデル・推論モデル切替 |
| [manual/08_FAQ.md](manual/08_FAQ.md) | よくあるトラブル（コードから確認できる内容のみ） |

### チュートリアル（tutorial/）— 操作しながら学ぶ

| ドキュメント | 内容 |
|---|---|
| [tutorial/01_Tesseractチュートリアル.md](tutorial/01_Tesseractチュートリアル.md) | サンプル画像で学習→評価→推論モデル登録まで操作する |
| [tutorial/02_PaddleOCRチュートリアル.md](tutorial/02_PaddleOCRチュートリアル.md) | 同上（PaddleOCR。モデル評価画面は現時点では未対応） |
| [tutorial/03_EasyOCRチュートリアル.md](tutorial/03_EasyOCRチュートリアル.md) | 推論のみ（学習は現時点では未実装） |

### サンプル（examples/）— データ構造の実例

実データは含まず、Markdownによる構造説明のみです。

| ドキュメント | 内容 |
|---|---|
| [examples/README.md](examples/README.md) | サンプル一覧の案内 |
| [examples/SampleDataset.md](examples/SampleDataset.md) | Datasetのフォルダ構成・meta.json項目 |
| [examples/SampleEvaluation.md](examples/SampleEvaluation.md) | 評価Datasetの構成・Evaluation Profile |
| [examples/SampleExperiment.md](examples/SampleExperiment.md) | 実験カルテの記録項目・Modelとの関連 |

### 利用者向け

| ドキュメント | 内容 |
|---|---|
| [QUICK_START.md](QUICK_START.md) | 10〜15分で最初のプロジェクトを作成し基本フローを理解する |
| [USER_GUIDE.md](USER_GUIDE.md) | 全画面の操作マニュアル（正式版） |
| [FAQ.md](FAQ.md) | よくある質問と短い回答 |
| [GLOSSARY.md](GLOSSARY.md) | 用語集（CER・Evaluation Hash・Release Gate等） |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 症状別のトラブルシューティング |

### 管理者・導入担当者向け

| ドキュメント | 内容 |
|---|---|
| [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) | 要件・インストール・GPU/CPU環境・本番配布 |
| [ADMIN_GUIDE.md](ADMIN_GUIDE.md) | 日常運用・権限・モデル/Job/レポート運用 |
| [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) | バックアップ・復元の手順と制約 |
| [UPDATE_GUIDE.md](UPDATE_GUIDE.md) | アプリ更新とロールバック |
| [SECURITY_AND_DATA_HANDLING.md](SECURITY_AND_DATA_HANDLING.md) | セキュリティ・データ取扱い |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | 本番リリース前チェックリスト |
| [UAT_CHECKLIST.md](UAT_CHECKLIST.md) | 受入試験（UAT）チェックリスト |

### 詳細仕様書（開発・保守担当者向け）

| ドキュメント | 内容 |
|---|---|
| [00_PROJECT_OVERVIEW.md](00_PROJECT_OVERVIEW.md) | プロジェクト概要・機能一覧・画面構成 |
| [01_ARCHITECTURE.md](01_ARCHITECTURE.md) / [02_DIRECTORY_STRUCTURE.md](02_DIRECTORY_STRUCTURE.md) / [03_TECH_STACK.md](03_TECH_STACK.md) | 構成・技術スタック |
| [04_BUILD_AND_RUN.md](04_BUILD_AND_RUN.md) / [05_CODING_CONVENTIONS.md](05_CODING_CONVENTIONS.md) | ビルド・実行・コーディング規約 |
| [06_API_REFERENCE.md](06_API_REFERENCE.md) | 全APIエンドポイント仕様 |
| [07_DATABASE.md](07_DATABASE.md) / [08_CONFIGURATION.md](08_CONFIGURATION.md) | 永続化・設定・localStorageキー |
| [16_SCREEN_SPEC.md](16_SCREEN_SPEC.md) | 画面仕様（全画面） |
| [17_DATAFLOW.md](17_DATAFLOW.md) | データフローと永続化ポイント |
| [18_JOB_MANAGEMENT.md](18_JOB_MANAGEMENT.md) | Job Management仕様 |
| [19_BENCHMARK_SPEC.md](19_BENCHMARK_SPEC.md) | Benchmark仕様 |
| [20_RELEASE_POLICY.md](20_RELEASE_POLICY.md) | Release Gate / Policy仕様 |
| [21_OPERATIONS_GUIDE.md](21_OPERATIONS_GUIDE.md) | 運用ダッシュボード・ヘルスチェック仕様 |
| [22_SECURITY_AND_AUDIT.md](22_SECURITY_AND_AUDIT.md) | 監査ログ・権限の実装仕様 |
| [24_DEPLOYMENT_GUIDE.md](24_DEPLOYMENT_GUIDE.md) | 社内配備手順（サービス化・リバースプロキシ） |
| [25_DISASTER_RECOVERY.md](25_DISASTER_RECOVERY.md) | 障害復旧手順 |
| [26_PERFORMANCE_LIMITS.md](26_PERFORMANCE_LIMITS.md) | 負荷試験結果と限界値 |
| [11_TESSERACT_CHECKLIST.md](11_TESSERACT_CHECKLIST.md) / [12_TESSERACT_CHARSET_SPEC.md](12_TESSERACT_CHARSET_SPEC.md) | Tesseract学習・charset仕様 |
| [15_CHANGELOG_AI.md](15_CHANGELOG_AI.md) | 開発履歴（仕様の理由の記録。**ユーザーガイドではありません**） |

### 開発に参加する方向け（GitHub Issues駆動開発）

| ドキュメント | 内容 |
|---|---|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Issue作成・ブランチ・Commit・PR・テストのルール |
| [development/GITHUB_ISSUES_WORKFLOW.md](development/GITHUB_ISSUES_WORKFLOW.md) | Issue駆動開発の全体フロー・Issueの状態・分割基準 |
| [development/ISSUE_WRITING_GUIDE.md](development/ISSUE_WRITING_GUIDE.md) | 良いIssueの書き方・受け入れ条件の書き方 |
| [development/AI_AGENT_WORKFLOW.md](development/AI_AGENT_WORKFLOW.md) | Claude Code・Codex等のAIコーディングエージェント向け運用ガイド |

## 開発中のWork Items

- [TrOCR対応](workitems/trocr/README.md)
- [Unified Model Metadata Infrastructure](workitems/model-metadata/README.md)
- [Next Development Roadmap（Investigation #115）](workitems/roadmap/NEXT_DEVELOPMENT_ROADMAP_115.md)
- [Model Card / Deployment Package Multi-engine Parity（Feature #117）](workitems/model-lifecycle/MODEL_CARD_DEPLOYMENT_MULTI_ENGINE_PARITY_117.md)
- [Training → Evaluation → Benchmark Workflow Handoff（Feature #119）](workitems/workflow/TRAINING_EVALUATION_BENCHMARK_HANDOFF_119.md)
- [TrOCR Evaluation Registered-model Selection（Bug #121）](workitems/trocr/TROCR_EVALUATION_REGISTERED_MODEL_SELECTION_121.md)
- [Job Lifecycle Unification Architecture Investigation（#123）](workitems/jobs/JOB_LIFECYCLE_UNIFICATION_ARCHITECTURE_123.md)
- [Training Job Startup Reconciliation Parity（Reliability #125）](workitems/jobs/TRAINING_JOB_STARTUP_RECONCILIATION_125.md)
- [JobRepository SQLite Migration（Feature #127）](workitems/jobs/JOB_REPOSITORY_SQLITE_MIGRATION_127.md)
- [Windows Training Process Termination Semantics Investigation（#129）](workitems/jobs/WINDOWS_TRAINING_PROCESS_TERMINATION_INVESTIGATION_129.md)
- [Frontend Job Display Contract Unification（Refactor #131）](workitems/jobs/FRONTEND_JOB_DISPLAY_CONTRACT_UNIFICATION_131.md)
- [Windows Training Process Tree Termination（Reliability #133）](workitems/jobs/WINDOWS_TRAINING_PROCESS_TREE_TERMINATION_133.md)

## バージョン情報

- アプリバージョン: `src/app/version.py`（`APP_VERSION = "1.0.0"`）。FastAPIの表示・バックアップmanifestで共用
- 変更履歴: [15_CHANGELOG_AI.md](15_CHANGELOG_AI.md)（開発経緯）/ リポジトリ直下 `CHANGELOG.md`
- 更新手順: [UPDATE_GUIDE.md](UPDATE_GUIDE.md)
