# OCR Crafter ドキュメント案内

**OCR Crafter** は、ローカル環境で完結するOCRモデル開発プラットフォーム（Webアプリ）です。
画像の取り込み・前処理・ラベル付け・データセット作成・学習（Tesseract / PaddleOCR）・評価・モデル管理・リリース管理・レポート作成までを1つのUIで行います。

- 現在のバージョン: **v1.0.0**（`src/app/version.py` の `APP_VERSION` が単一情報源）
- 動作形態: ローカル実行（FastAPI port 8000 + React port 5173）。**外部Webサービスへデータを送信しません**

## 対象読者と最初に読む文書

| あなたは… | 最初に読む | 次に読む |
|---|---|---|
| 初めて利用する方 | [QUICK_START.md](QUICK_START.md) | [USER_GUIDE.md](USER_GUIDE.md) |
| 導入・環境構築を行う方 | [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) | [ADMIN_GUIDE.md](ADMIN_GUIDE.md) |
| 日常運用・保守を行う方 | [ADMIN_GUIDE.md](ADMIN_GUIDE.md) | [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) / [UPDATE_GUIDE.md](UPDATE_GUIDE.md) |
| 問題が発生した方 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | [FAQ.md](FAQ.md) |
| リリース・受入試験の担当者 | [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | [UAT_CHECKLIST.md](UAT_CHECKLIST.md) |
| 開発・保守担当者 | [09_AI_DEVELOPMENT_GUIDE.md](09_AI_DEVELOPMENT_GUIDE.md) | 下記「詳細仕様書」一覧 |

## 目的別ドキュメント一覧

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

## バージョン情報

- アプリバージョン: `src/app/version.py`（`APP_VERSION = "1.0.0"`）。FastAPIの表示・バックアップmanifestで共用
- 変更履歴: [15_CHANGELOG_AI.md](15_CHANGELOG_AI.md)（開発経緯）/ リポジトリ直下 `CHANGELOG.md`
- 更新手順: [UPDATE_GUIDE.md](UPDATE_GUIDE.md)
