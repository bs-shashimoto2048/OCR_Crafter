# 21. Operations Guide（運用ダッシュボード・ヘルスチェック）

社内運用時のシステム監視のためのガイド。実装は `src/app/services/operations.py`、画面は「運用 > システム状態」（`OperationsView.jsx`）。

## 1. 運用ダッシュボード（GET /api/operations/dashboard）

1画面で以下を確認できる:

| 項目 | 内容 | 情報源 |
|---|---|---|
| 実行中/待機中/失敗Job | システム全体のJob状況＋最近5件＋Worker稼働状態 | `data/jobs/jobs.json` |
| Production | 現Productionモデル（**0件または1件**）とVersion | `releases.json` |
| Release Gate状態 | ProductionモデルのGate判定（PASS等）＋不合格ルール | `release_gate.py` |
| 未評価Candidate | Candidateステータスだが実験カルテに評価がないモデル | `experiments.json` × `releases.json` |
| 最近のBenchmark | 最新Benchmarkの1位エンジンとCER | `benchmarks.json` |
| データ使用量 | 現プロジェクトの raw / processed / models / outputs / 合計（MB） | ファイルサイズ集計 |
| バックアップ状態 | 最新バックアップ（Phase 5のバックアップ機能の index.json）。未取得はnull | `data/backups/index.json` |

## 2. ヘルスチェック

| エンドポイント | 用途 | 内容 |
|---|---|---|
| GET `/health` | 死活監視 | `{status: "ok"}`（従来どおり・互換維持） |
| GET `/health/ready` | 受付可否 | データDir書き込み＋設定ファイル読込。`{ready, checks}` |
| GET `/health/details` | 管理者向け詳細 | 下記9項目。`{status: ok/degraded, problems[], checks{}}` |

`/health/details` の確認項目: Backend / データDir書き込み / 設定ファイル（settings.yaml） / Tesseract（実行ファイル解決） / PaddleOCR（import可否） / GPU（paddle判定・判定不能はnull） / Job Worker（スレッド稼働） / ディスク空き（1GB未満で警告） / プロジェクトDir。**取得不能な値はnull（推測しない）**。

## 3. バックアップ・復元（`services/backup_manager.py`）

- **モード選択**: `metadata_only`（annotations/実験・リリース・Benchmark記録・前処理設定/スナップショットmeta・モデルメタJSONのみ。画像・モデル実体は含めない）/ `full`（プロジェクトディレクトリ全体）
- 保存先: `data/backups/<BK-0001>_<pid>_<mode>_<日時>.zip` ＋ `index.json`（BK-0001形式で採番）
- **復元は既定で新しいProject IDへ**（`<元ID>_restored_<n>` を自動採番。明示指定IDも既存と衝突する場合はエラー=**既存プロジェクトを上書きしない**）
- 復元は監査ログ `backup_restore`（admin権限）へ、失敗は `restore_failed` へ記録される
- UI: システム状態画面の「バックアップ」カード（作成・一覧・新プロジェクトへ復元）

### manifest.json（v2）と整合性検証

各ZIPへ `backup_manifest.json` を同梱する: Backup ID / Created At / **App Version** / **Schema Version** / Project ID / Backup Mode / **File List（path・size・SHA-256）** / File Count / Total Size / **Required Components**（annotations等・復元に必須） / **Optional Components**。

- **Restore前に全ファイルのSHA-256を検証し、不一致・欠落・manifest未記載ファイルがあれば復元を開始しない**（error_code=BACKUP_VALIDATION_FAILED）
- **Restore後にも書き込んだファイルを再検証**する（不一致は復元先プロジェクトを削除してエラー=部分復元を残さない）
- 旧形式（v1・File Listなし）のバックアップは検証不能（valid=null）として扱い、推測で合格にしない
- GET `/api/backups/{id}/verify` で復元せずに検証だけ実行できる（Release Checklistの事前確認用）

| Method / Path | 概要 |
|---|---|
| GET `/api/backups` | 一覧（新しい順・project_id絞り込み可） |
| POST `/api/backups` | 作成（`{project_id, mode}`。監査 `backup_create`） |
| GET `/api/backups/{backup_id}/verify` | 整合性検証のみ（`{valid, mismatches, manifest_summary}`） |
| POST `/api/backups/{backup_id}/restore` | 復元（`{new_project_id?}`・既定=新ID自動採番・前後Hash検証） |

## 4. データ保持設定（Retention）

- 設定: `data/retention.json`（`job_retention_days` / `audit_retention_days`）。**未設定（null）=無期限保持（従来動作）**
- 適用（POST `/api/retention/apply`・admin権限）: 保持期間を過ぎた**終端状態（succeeded/failed/cancelled）のJob**（events/logsファイル含む）と古い監査ログ行を削除する。アクティブJobは削除しない
- **削除の事実は監査ログ `retention_cleanup` へ必ず記録**（削除0件でも適用実行を記録）
- UI: システム状態画面の「データ保持設定」カード（保存・今すぐ適用=確認ダイアログあり）

| Method / Path | 概要 |
|---|---|
| GET / PUT `/api/retention` | 保持設定の取得・保存 |
| POST `/api/retention/apply` | 適用（削除は監査記録） |

## 5. 運用の目安

- 失敗Jobが増えた → ジョブ管理画面でエラー要約を確認 → 詳細は `data/jobs/logs/JOB-xxxxxx.log`
- Gate判定がFAILのままProduction運用 → Override履歴（監査ログ・Release History）を確認
- ディスク警告 → データ使用量の内訳（raw/processed/outputs）から整理対象を判断（`external/` `models/` `outputs/` は削除・再生成しない方針に注意）
- Worker停止表示 → Job作成時に自動起動する。プロセス再起動後にrunningのまま残ったJobは再実行で復旧
