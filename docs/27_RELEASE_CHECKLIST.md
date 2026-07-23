# 27. Release Checklist（本番リリース前チェックリスト）

リリース担当者は以下を上から順に確認し、全項目✓で配備する。判定根拠のコマンド・画面を併記。

| # | 項目 | 確認方法 | 合格基準 |
|---|---|---|---|
| 1 | **全テスト通過** | `python -m pytest -q` / `cd frontend && npm run build && npm test` | バックエンド・フロントとも fail 0 |
| 2 | **Migration確認** | 既存プロジェクトで `GET /api/releases`（schema_version=2・Release IDバックフィル）・`GET /api/experiments`（バックフィル）がエラーなく返る | 既存データが破壊されずID付与済み |
| 3 | **Backup取得** | システム状態画面→バックアップ作成（full）または `POST /api/backups` | 全運用プロジェクトのBK-IDが記録される |
| 4 | **Backup検証** | `GET /api/backups/{BK-ID}/verify` | 全バックアップ valid=true |
| 5 | **Restore試験** | 最新fullバックアップを新Project IDへRestore→モデル・ラベルを確認→試験プロジェクト削除 | 復元成功・verified_files=file_count |
| 6 | **Worker状態** | `GET /health/details` の job_worker / `GET /api/jobs` の worker_alive | 稼働中（またはJob作成で自動起動を確認） |
| 7 | **再起動復旧試験** | 実行中Jobがある状態でBackend再起動→ジョブ管理画面 | runningが残らず「中断（再起動）」→再実行で復旧 |
| 8 | **Production一意性** | 各プロジェクトの `GET /api/releases` | productionが0件または1件（2件以上が存在しない） |
| 9 | **Gate設定** | リリース管理→Release Policy（Max CER・必須文字・Critical Confusions等） | 運用基準が設定済み・Gate判定が動作（FAILモデルはOverrideなしで昇格不可） |
| 10 | **Admin互換無効化** | `OCRC_ALLOW_UNAUTHENTICATED_ADMIN=false` を設定し `GET /api/auth/context` | auth_mode=本番認証モード・X-Operatorなしの変更系が401 |
| 11 | **ディスク空き容量** | `GET /health/details` の disk | 空き ≥ 10GB（1GB未満は警告） |
| 12 | **Deployment Package検証** | `GET /api/releases/deployment_package` をダウンロード→ZIP展開 | traineddata / model_config.json / MODEL_CARD.md / RELEASE_NOTE.md が揃う |
| 13 | **Rollback試験** | ステージングでPromote→Rollback→Release History確認 | Version維持・新Release ID・監査記録 |
| 14 | **監査ログ確認** | 監査ログ画面（フィルタ: 直近のリリース作業） | 昇格/Policy変更/Backup等が操作者名つきで記録・削除ボタンが存在しない |
| 15 | データ保持設定 | システム状態画面→データ保持設定 | Job/監査の保持日数が運用方針どおり（docs/26 §4） |
| 16 | バージョン更新 | `src/app/version.py` の APP_VERSION | リリース版へ更新済み（バックアップmanifestへ記録される） |

## 実施記録

| 日付 | 実施者 | バージョン | 結果 | 備考 |
|---|---|---|---|---|
| 2026-07-23 | （自動E2E: tests/test_e2e_uat.py） | 1.0.0 | 19工程 全PASS | docs/23参照 |
