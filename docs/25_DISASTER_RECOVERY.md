# 25. Disaster Recovery（障害復旧手順）

## 1. 障害タイプ別の一次対応

| 障害 | 症状 | 一次対応 |
|---|---|---|
| Backendクラッシュ/再起動 | Jobがrunningのまま | サービス再起動 → 起動時に**interrupted自動回収**＋queued再開（docs/18）。ジョブ管理画面で「中断（再起動）」を確認し**再実行** |
| レジストリJSON破損疑い | 一覧が空/エラー | 原子的書き込みのため通常発生しない。発生時は `.tmp` 残骸を確認→直近バックアップからRestore |
| プロジェクト誤削除/破損 | データ欠損 | 最新バックアップを**新Project IDへRestore**（上書きしないため安全に比較できる） |
| ディスク障害 | /health/details のdisk警告 | データ保持設定の適用・outputs整理→復旧後にバックアップからRestore |
| 誤ったProduction昇格 | 本番モデル不良 | リリース管理→Release Historyから**Rollback**（Version維持・新Release ID・監査記録） |

## 2. 再起動復旧の仕様（自動）

1. Backend起動時に `recover_interrupted_jobs` が running / cancel_requested のJobを `interrupted` へ回収（**永続running表示は残らない**）
2. queued のJobはWorker再開でそのまま実行
3. `interrupted` のJobはUIの「再実行」で同一入力条件の新Jobとして復旧（`retry_source_job_id` で追跡）
4. 成果物は原子的書き込みのため、中断時に不完全な正式成果物は残らない（docs/18 §3b）

試験根拠: `tests/test_recovery_atomicity.py`（queued/running/cancel_requested/完了直後の4シナリオ）。

## 3. バックアップからの復元手順

1. **検証**: `GET /api/backups/{BK-ID}/verify` → `valid=true` を確認（SHA-256全ファイル照合）
2. **復元**: `POST /api/backups/{BK-ID}/restore`（既定=新Project ID `<元ID>_restored_<n>`）
   - 復元前検証で不一致があれば**復元は開始されない**（BACKUP_VALIDATION_FAILED）
   - 復元後にも再検証され、不一致時は復元先が自動削除される（部分復元なし）
3. **確認**: 復元プロジェクトで モデル一覧 / 実験 / リリース状況 / 画像 を確認
4. **切替**: 問題なければ運用プロジェクトとして利用開始（旧プロジェクトは残置または削除）
5. 全操作は監査ログ（backup_restore / restore_failed）に記録される

復元されたTesseract/PaddleOCR/TrOCRモデルのsidecar（`.tess.json`/`.ocr.json`/`.trocr.json`）が内部に保持する絶対パス（`model_dir`/`tessdata_dir`/`inference_dir`/`traineddata_path`）は、復元処理が**復元先プロジェクトを指すよう自動的に書き換える**（Investigation #143で発見・Bug #145で修正済み）。書き換え結果（`rebased`/`unrebased`）は復元APIレスポンスの`model_path_rebase`と監査ログ`backup_restore`で確認できる。`metadata_only`モード復元はartifact本体（traineddata等）自体を含まないため、当該モデルは`unrebased`として報告される（想定どおり）。詳細は`docs/workitems/operations/BACKUP_RESTORE_INVESTIGATION_143.md` §6・`docs/workitems/operations/RESTORE_MODEL_SIDECAR_PATH_REBASE_145.md`を参照。

## 4. サーバー全損からの復旧（フル手順）

1. docs/24 に従い新サーバーへアプリ配備（リポジトリ＋.venv＋Tesseract＋tessdata＋PaddleOCR）
2. NAS等から `data/backups/` を新サーバーの `data/backups/` へ配置（`index.json` 含む）
3. Backend起動 → プロジェクトごとに §3 の復元手順を実施
4. `data/jobs/`（`job_manager.db`含む） `data/audit/` `outputs/app.db`（Job System Aのtraining_jobsテーブル） `data/model_ids.json` `data/dataset_ids.json` はいずれもproject単位バックアップ（`backup_manager.py`）の対象外（project横断のグローバルデータ。Investigation #143で棚卸し済み）。**`outputs/app.db`・`data/jobs/job_manager.db`は稼働中の単純ファイルコピーが安全でない**（`job_manager.db`はWALモードのため特に、直近のコミットが`-wal`ファイル側にのみ存在し欠落しうる）。両DBとも`services/sqlite_backup.py::backup_app_db()`/`backup_job_manager_db()`（`sqlite3.Connection.backup()`＝標準ライブラリのOnline Backup APIを使用、Backend停止不要、Issue #147）でBackend停止不要のconsistentなsnapshotを作成できる（`data/backups/system/`配下、UI/APIは無し・運用スクリプト/CLIから呼び出す想定）。`data/model_ids.json`・`data/dataset_ids.json`・`data/audit/`は引き続きファイルコピーで別途保全すること
5. Release Checklist（`docs/RELEASE_CHECKLIST.md`）で復旧後の健全性を確認

## 5. リストア試験（月次推奨）

1. 最新のfullバックアップで `verify` → `restore`（新Project ID）
2. 復元プロジェクトの モデル評価を1回実行し、既知のCERと一致することを確認
3. 試験用の復元プロジェクトを削除（監査記録される）
4. 結果を `docs/RELEASE_CHECKLIST.md` のチェックリストへ記録
