# リリースチェックリスト（v1.0.0）

本番リリース前にリリース担当者が確認する項目です。上から順に確認し、全項目✓で配備してください。
コマンドはリポジトリルート・Windows PowerShell前提（バックエンドは `.\.venv\Scripts\python.exe`、APIは `http://127.0.0.1:8000`）。

## 1. コード

- [ ] **mainがクリーン**: `git status --short` が空（意図しない未コミットが無い）
- [ ] **対象コミット確認**: リリース対象のコミットハッシュを控え、CHANGELOGと一致している
- [ ] **バージョン更新**: `src/app/version.py` の `APP_VERSION` がリリース版へ更新済み（FastAPI表示・バックアップmanifestへ記録される）
- [ ] **デバッグコードなし**: TEMP-DEBUG等の一時コードが残っていない（`git grep "TEMP-DEBUG" -- frontend src` が空）
- [ ] **TODO確認**: 重要なTODO/FIXMEが未解決のまま残っていない（`git grep -n "TODO\|FIXME" -- src frontend/src` を確認）
- [ ] **Git管理対象の健全性**: `git ls-files data models outputs .venv frontend/node_modules` の出力が空（大容量・実データが追跡されていない）

## 2. テスト

- [ ] **Backend全件通過**: `.\.venv\Scripts\python.exe -m pytest -q` が fail 0
- [ ] **Frontend全件通過**: `cd frontend; npm test` が fail 0
- [ ] **build成功**: `cd frontend; npm run build` が成功
- [ ] **E2E**: `tests/test_e2e_uat.py`（19工程）がPASS（[UAT_CHECKLIST.md](UAT_CHECKLIST.md)）
- [ ] **負荷試験**: 大規模データでの性能が許容範囲（実測値と限界: [26_PERFORMANCE_LIMITS.md](26_PERFORMANCE_LIMITS.md)。Job保持設定の運用前提を確認）
- [ ] **再起動試験**: 実行中Jobがある状態でBackend再起動 → runningが残らず「中断（再起動）」→ 再実行で復旧
- [ ] **バックアップ検証**: `GET /api/backups/{BK-ID}/verify` で全バックアップ valid=true。最新fullを新Project IDへRestoreできる
- [ ] **PDF生成**: レポート（PDF形式）が生成でき、**日本語が文字化けなく表示**される
- [ ] **推論3エンジン**: PaddleOCR / EasyOCR / Tesseract の推論が動作（Tesseract未導入環境では導入案内つきエラーでクラッシュしない）
- [ ] **安全ガードテスト**: モデル削除（models配下限定）・出力削除（outputs配下限定）・charset仕様（`CHYBkt`非改変・case-sensitive）の各テストがPASS（pytest全件に含まれる）

## 3. 設定

- [ ] **settings.yaml**: 本番値を確認（`config/settings.production.example.yaml` と差分確認。CORS許可オリジン・Tesseractパス）
- [ ] **保存先**: `data/`（プロジェクト・jobs・audit・backups）・`outputs/` がローカルSSD上にあり、書き込み可能（`GET /health/ready`）
- [ ] **Tesseract**: 実行ファイル解決OK（`GET /health/details` の tesseract）。学習運用ならlstmtraining・tessdata_bestも確認
- [ ] **PaddleOCR**: import可（`GET /health/details`）。学習運用なら `external/PaddleOCR` のパス解決を確認
- [ ] **GPU**: GPU運用時は `GET /api/system/check` でCUDA検出・GPU名・VRAMを確認（CPU運用ならスキップ）
- [ ] **Backup**: バックアップスケジュール（metadata=毎日 / full=毎週）が構成済み（[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)）
- [ ] **Logs**: `data/jobs/logs/` の場所を運用者が把握。データ保持設定（Job/監査の保持日数）が方針どおり
- [ ] **Reports**: レポート生成（Markdown+PDF）が本番環境で動作し、`data/reports/` へ保存される
- [ ] **認証モード**: 本番は `OCRC_ALLOW_UNAUTHENTICATED_ADMIN=false` を設定し、`GET /api/auth/context` が本番認証モード・X-Operatorなしの変更系が401になることを確認

## 4. 運用

- [ ] **管理者決定**: アプリ管理者（admin権限の運用者）が決まっている
- [ ] **Backup担当**: バックアップの実施・検証担当が決まっている
- [ ] **障害連絡先**: 障害時の連絡先・エスカレーション先が周知されている（[25_DISASTER_RECOVERY.md](25_DISASTER_RECOVERY.md)）
- [ ] **更新担当**: アプリ更新の担当と手順（[UPDATE_GUIDE.md](UPDATE_GUIDE.md)）が確認されている
- [ ] **Productionモデル確認**: 各プロジェクトの `GET /api/releases` でproductionが0件または1件（2件以上が存在しない）
- [ ] **Release Gate確認**: Release Policy（Max CER・必須文字・Critical Confusions等）が運用基準どおり設定され、Gate判定が動作（FAILモデルはOverrideなしで昇格不可）
- [ ] **Migration確認**: 既存プロジェクトで `GET /api/releases`（schema_version=2・Release IDバックフィル）・`GET /api/experiments` がエラーなく返る
- [ ] **Worker状態**: `GET /health/details` の job_worker / `GET /api/jobs` の worker_alive（またはJob作成で自動起動を確認）
- [ ] **ディスク空き容量**: `GET /health/details` の disk が10GB以上
- [ ] **監査ログ確認**: 直近のリリース作業（昇格/Policy変更/Backup）が操作者名つきで記録され、削除ボタンが存在しない
- [ ] **Deployment Package検証**: `GET /api/releases/deployment_package` のZIPに traineddata / model_config.json / MODEL_CARD.md / RELEASE_NOTE.md が揃う
- [ ] **Rollback試験**: ステージングでPromote→Rollback→Release History確認（Version維持・新Release ID・監査記録）

## 5. ドキュメント

- [ ] **User Guide**: [USER_GUIDE.md](USER_GUIDE.md) が現行画面と一致
- [ ] **Admin Guide**: [ADMIN_GUIDE.md](ADMIN_GUIDE.md) が現行運用と一致
- [ ] **Installation Guide**: [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) の手順で新規環境が構築できる
- [ ] **Troubleshooting / FAQ**: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) / [FAQ.md](FAQ.md) が最新
- [ ] **UAT結果**: [UAT_CHECKLIST.md](UAT_CHECKLIST.md) の実施記録が記入済み
- [ ] **Release Notes**: `CHANGELOG.md` にバージョン・日付・変更点を記入

## 6. 配布

- [ ] **バージョンタグ**: `git tag v1.0.0 && git push origin v1.0.0`
- [ ] **配布物**: 配布形態（リポジトリ取得 or アーカイブ）と対象コミットが確定している
- [ ] **ハッシュ**: 配布アーカイブを作る場合はSHA-256を記録して受け渡す
- [ ] **リリースノート**: 利用者向けの変更点サマリを周知
- [ ] **ロールバック手順**: 更新失敗時に戻すコミット・手順が確認済み（[UPDATE_GUIDE.md](UPDATE_GUIDE.md#5-ロールバック更新の取り消し)）

## 実施記録

| 日付 | 実施者 | バージョン | 結果 | 備考 |
|---|---|---|---|---|
| 2026-07-23 | （自動E2E: tests/test_e2e_uat.py） | 1.0.0 | 19工程 全PASS | [UAT_CHECKLIST.md](UAT_CHECKLIST.md) 参照 |
