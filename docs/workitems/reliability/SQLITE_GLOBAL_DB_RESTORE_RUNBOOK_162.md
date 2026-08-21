# SQLite Global DB Restore Runbook & Verification 作業記録

Related: Reliability [#162](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/162) / Investigation [#160](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/160)（Post-Safety-Hardening Roadmap Refresh、本Issueの起点・Top Recommendation） / Feature [#147](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/147)（SQLite Online Backup、本Issueが前提とするbackup artifact contract） / Investigation [#143](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/143) / Feature [#127](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/127)（JobRepository SQLite移行、`job_manager.db`の作成元）

**状態**: Completed / Closed。PR [#163](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/163)、Squash Commit `f0c717b`でマージ済み。

## 目的

Investigation #160のTop Recommendation。Feature #147で`outputs/app.db`（Job System A）・`data/jobs/job_manager.db`（Job System B）のOnline Backup機構は導入済みだが、**取得したbackupを安全にrestoreする正式なrunbook・verification手順が存在しなかった**。本Issueは、誤操作やWAL不整合を避けながら復旧できる明示的・検証可能なRestore Runbookを確立する。Job Lifecycle統合やDB schema再設計は目的としない。

## Mandatory Investigation

### 1. Backup Artifact Contract（`services/sqlite_backup.py`）

- **naming**: `<logical_name>_<timestamp（マイクロ秒精度）>.db`（衝突時は連番suffix）
- **destination**: `data/backups/system/`（既定。`backup_sqlite_database()`の`destination_root`引数で上書き可能）
- **overwrite policy**: 既存の同名ファイルは上書きしない（衝突時は連番付与）。destination自体は同ディレクトリの一時ファイル（`.{filename}.tmp`）へ書込み後、整合性検証に通ってから`os.replace()`で原子的に確定する
- **SQLite header/integrity expectations**: `PRAGMA quick_check == ok`必須。加えて`expected_tables`指定時はそれらが`sqlite_master`に存在することを必須とする（`app.db`→`{"training_jobs"}`、`job_manager.db`→`{"job_manager_jobs"}`）
- **source DB不存在時のcontract**: `FileNotFoundError`（存在しないDBを空backupとして偽装しない）
- **WAL mode sourceから何がsnapshotへ含まれるか**: `sqlite3.Connection.backup()`（SQLite公式Online Backup API）を使うため、WAL未checkpointのコミット済みデータも正しくsnapshotへ含まれる（Investigation #143で実証済み、`test_wal_mode_backup_includes_uncheckpointed_committed_row`で回帰ガード済み）。単純な`shutil.copy`との差は`test_naive_file_copy_would_have_missed_the_wal_data_regression_guard`で固定化されている

manifestは`<filename>.manifest.json`として個別に添付され、backupの`sha256`・`size_bytes`・`sqlite_user_version`・`app_version`を記録する。project backupの`index.json`のような集約indexは無い（Feature #147で意図的に不採用、責務の混同を避けるため）。

### 2. DB Ownership / Lifecycle

| 項目 | `outputs/app.db` | `data/jobs/job_manager.db` |
|---|---|---|
| path解決 | `db.py::_db_path()` → `PROJECT_ROOT / settings["app"]["db_path"]`（既定`outputs/app.db`） | `job_manager.py::_jobs_root()` → `PROJECTS_DIR.parent / "jobs"`、`_JOB_MANAGER_DB_FILENAME = "job_manager.db"` |
| connection生成箇所 | `db.py::get_conn()`（呼び出しごとに新規`sqlite3.connect()`。永続共有コネクションなし） | `JobRepository._connect()`（同様に呼び出しごとに新規接続） |
| startup時のschema init | `init_db()`が明示的に呼ばれた時のみ`CREATE TABLE IF NOT EXISTS`実行 | `_connect()`実行毎に`_ensure_schema()`（`CREATE TABLE IF NOT EXISTS`）を実行 |
| WAL設定 | 既定（rollback journal。明示的なWAL設定なし） | `_connect()`で毎回`PRAGMA journal_mode=WAL`を設定 |
| Backend process/threadからの利用箇所 | 学習Job状態の読み書き（Job System A） | `JobService`経由のJob作成・状態遷移（Job System B） |
| restore中にconnectionが開いたままの場合の危険性 | Windowsでは開いたハンドルが`os.replace()`（ファイル置換）を`PermissionError`で失敗させることを直接probeで確認済み（下記Restore Safety Decision参照）。WALモードの`job_manager.db`は特に、開いたままの接続がstale `-wal`/`-shm`を生み、置換後もSQLiteが古いWALを誤って適用し続けるsilent failureを引き起こしうる | 同左 |

両DBとも「呼び出しごとに新規コネクションを開いて閉じる」設計であり、Backendプロセスが恒常的に単一の長寿命コネクションを保持し続けるわけではない。ただしBackendが稼働中である限り、Job実行中のリクエストが新規コネクションを開く可能性は排除できないため、**restore実行中はBackendプロセス自体を停止する**必要がある（後述Decision Record参照）。

### 3. Restore Safety Decision（Decision Record）

**比較した3案:**

| Option | 内容 | crash consistency | open connectionとの競合 | WAL/SHM handling | Windows file locking | implementation complexity | operator error risk |
|---|---|---|---|---|---|---|---|
| **A: Backend停止 + DB file replacement**（採用） | Backendを止めた上で、backup fileをtargetへ原子的に配置。事前に対象の`-wal`/`-shm`を削除 | 高（Backend停止済みのためconnectionが無い状態でreplace） | なし（Backend停止済み） | 明示的に削除してから配置するため安全 | 停止済みのため競合なし（直接probeで確認: 稼働中connectionが残っていると`os.replace()`が`PermissionError`で失敗することを確認済み） | 低（既存の`backup_sqlite_database()`の一時ファイル→原子的置換パターンを再利用） | 中（`-wal`/`-shm`削除を忘れると§中心的発見のsilent failureが起きうる。→helperで自動化し軽減） |
| **B: SQLite Online Backup APIを逆方向に使用してrestore** | Backend稼働中のまま、`sqlite3.Connection.backup()`を`target`方向へ実行 | 中（backup API自体はconsistentだが、稼働中の他コネクションとの書込み競合・スキーマ不整合のリスクが残る） | あり（稼働中のBackendが同時にtargetへ書込む可能性を排除できない） | 対象外（file replaceを伴わないためWAL自体は問題にならないが、稼働中writerとの整合性が別途課題になる） | 該当性低い（file replaceを伴わないため） | 中〜高（稼働中DBへの「上書き」は通常運用と衝突し得る取り扱いが必要） | 高（disaster recovery目的では「稼働中に上書き」という状況自体が想定外・危険） |
| **C: その他のSQLite-native方式（`.dump`/`.restore`等のSQL-level）** | backupをSQL textへdumpし、targetへ再importする | 高 | Backend停止前提なら同等 | 該当なし（SQL importのため） | 該当性低い | 高（テキストdump/import・型・制約の往復変換を新たに扱う必要） | 中（バイナリbackupが既に完全な有効SQLiteファイルであるため、SQL変換を経由する必要性そのものが薄い） |

**選択: Option A**。理由:

- backup artifact（Feature #147の`backup_sqlite_database()`出力）は既に完全な有効SQLiteファイルであり、Option Cのような変換は不要な複雑性を追加するだけ
- Option Bは「稼働中DBへの上書き」というdisaster recovery目的にそぐわない危険な状態を許容することになり、Issue本文の選定基準（operator error risk・open connectionとの競合）の観点で不利
- Option Aは最小の実装複雑度で、既存の`backup_sqlite_database()`の「一時ファイル書込み→検証→原子的置換」パターンをそのまま踏襲でき、既存コードとの一貫性も高い

**単純な`shutil.copy2()`（Backend停止済みかつWAL/SHM削除を伴わない場合）の危険性を直接probeで実証**（temp DBのみ使用。実`outputs/app.db`・実`data/jobs/job_manager.db`は一切使用していない）:

1. WALモードのDBを作成し、`'STALE-PRE-CRASH-DATA'`という行をコミット（`-wal`ファイルにデータが残った状態）
2. 別途作成した、`'row1'`を含む新しいbackup fileを、**`-wal`/`-shm`を削除せずに**単純コピーでtargetへ上書き
3. targetを再オープンすると、**`'row1'`ではなく`'STALE-PRE-CRASH-DATA'`が見える**（古い`-wal`が新しいmain .dbファイルに対して誤って適用されるため）。`PRAGMA integrity_check`は`ok`のままで、エラーは一切発生しない（silent failure）
4. `-wal`/`-shm`を削除してから同じコピーを行うと、正しく`'row1'`が見える

この結果は`tests/test_sqlite_restore.py::test_naive_copy_without_removing_stale_wal_would_show_old_data_regression_guard`（Backend停止を模した「クラッシュ後」のstale WALを、子プロセスをkillすることで再現）として固定化した。**単純な`shutil.copy*()`のみでは安全ではないことをここで実証しており、根拠なく採用していない**（Issue本文の明示的要求）。

また、稼働中のsqlite3接続が残ったままでは`os.replace()`自体がWindowsで`PermissionError`（アクセスが拒否されました）になることも直接probeで確認済み。これは「restore実行時にBackendを完全に停止する」という運用要件（Option A）を選んだもう一つの実証的根拠である。

## Scope Decision: Automated Helper（Required Scope C）

上記のとおり、**「`-wal`/`-shm`削除を忘れる」という非自明なステップを手動runbookのみに委ねた場合、operator error riskが高い**（見た目上のエラーが一切出ず、古いデータがそのまま見え続けるため、operatorが誤りに気づく手段がない）。この実証的発見に基づき、Issue本文の「手動runbookだけではoperator error riskが高い場合のみ、helperの追加を検討してよい」という条件を満たすと判断し、`services/sqlite_backup.py`へ**restore helper関数を追加した**（documentation-onlyでは不十分と判断）。

- `services/sqlite_backup.py`の責務は「グローバルSQLite DBのbackup/restore」のまま拡大していない（project backup `backup_manager.py`とは引き続き分離）
- public API/UIは追加していない（Python関数のみ、運用スクリプト/CLIから呼び出す想定）
- destructive operationである`restore_sqlite_database()`は、backup自体の検証（targetへ触れる前）・restore前のtarget保全（`keep_pre_restore_snapshot`既定True）・restore後の再検証・失敗時ロールバックを備える

## 実装内容（`src/app/services/sqlite_backup.py`）

### `SqliteRestoreError(Exception)`

restore対象（backupファイル自体、または復元後のtarget）の整合性検証失敗を表す専用例外。`rollback_performed: bool`属性で、失敗時にpre-restore snapshotへのロールバックが実施されたかどうかを判別できる。

### `_quick_check_and_tables(conn) -> tuple[bool, set[str]]`

`PRAGMA quick_check`結果と`sqlite_master`のテーブル名集合をまとめて返す内部ヘルパー（backup検証・restore検証の両方で使う共通ロジック）。

### `_remove_wal_sidecars(db_path) -> None`

`db_path`に隣接する`-wal`/`-shm`を削除する（存在しなくても何もしない）。本Issueの中心的発見への直接対応。

### `restore_sqlite_database(backup_path, target_path, *, expected_tables=None, keep_pre_restore_snapshot=True) -> dict`

Backend停止済みであることを前提とするrestoreコア関数。手順:

1. `backup_path`自体の整合性を検証する（quick_check・`expected_tables`）。**失敗時は`target_path`に一切触れない**
2. `target_path`が既存の場合、`keep_pre_restore_snapshot=True`（既定）なら`backup_sqlite_database()`を再利用し、復元前の状態を同ディレクトリへ`<target名>_pre_restore_<timestamp>.db`として保全する（targetがWALモードで稼働していた場合でもOnline Backup APIで一貫した状態を保全。単純ファイルコピーではない）
3. **`target_path`に隣接する既存の`-wal`/`-shm`を削除する**（中心的な安全対策）
4. `backup_path`を同ディレクトリの一時ファイルへコピーし、`os.replace()`で`target_path`へ原子的に配置する
5. 復元後の`target_path`を独立コネクションで開き直し、quick_check・`expected_tables`を再検証する。失敗した場合、手順2のpre-restore snapshotを使ってtargetを復元前の状態へロールバックしてから`SqliteRestoreError`を送出する（targetを壊れたまま・空のまま残さない）

### `restore_app_db(backup_path, *, keep_pre_restore_snapshot=True)` / `restore_job_manager_db(backup_path, *, keep_pre_restore_snapshot=True)`

`backup_app_db()`/`backup_job_manager_db()`と対称な薄いwrapper。それぞれ`db.py::_db_path()`/`job_manager.py::_jobs_root()`を再利用し、`expected_tables`は対応するbackup wrapperと同一（`{"training_jobs"}`/`{"job_manager_jobs"}`）。

`backup_sqlite_database()`・`backup_app_db()`・`backup_job_manager_db()`（Feature #147既存部分）は変更していない。

## Runbook（Restore手順）

対象: `outputs/app.db` / `data/jobs/job_manager.db`（Windows開発/運用環境を優先したコマンド例）。

### 1. Preflight

- 復元対象のbackup file（`data/backups/system/<logical_name>_<timestamp>.db`）とそのmanifest（`<filename>.manifest.json`）を確認し、`sha256`が期待どおりであることを確認する
- 復元理由（DB破損・誤操作・ディスク障害等）を記録する

### 2. Backend停止

- OCR CrafterのBackendプロセス（`uvicorn`/`main.py`起動プロセス）を停止する。**稼働中のままrestoreを実行しない**（Decision Record参照。開いたコネクションが残っているとWindowsでは`os.replace()`が`PermissionError`で失敗し、仮に成功したとしてもWAL不整合のリスクが残る）

### 3. 現行DBの退避（restore前バックアップ）

- `restore_sqlite_database()`は既定（`keep_pre_restore_snapshot=True`）で、target側に既存ファイルがある場合、復元前の状態を自動的に`<target名>_pre_restore_<timestamp>.db`として同ディレクトリへ保全する。手動でも同様に、`services/sqlite_backup.py::backup_app_db()`/`backup_job_manager_db()`を復元直前に実行し、二重に退避しておくことを推奨する

### 4. Backup artifactの検証

- `restore_sqlite_database()`の内部で、backup自体の`PRAGMA quick_check`・`expected_tables`検証が自動的に行われる（失敗時はtargetへ一切触れない）
- 手動で事前確認する場合: `sqlite3 <backup_path> "PRAGMA quick_check;"` / `sqlite3 <backup_path> ".tables"`

### 5. Restore操作

Pythonから直接呼び出す（運用スクリプト/CLIから実行する想定。UI/APIは追加していない）:

```python
from src.app.services.sqlite_backup import restore_app_db, restore_job_manager_db

# outputs/app.db の復元
restore_app_db(r"data\backups\system\app_20260821_120000_000000.db")

# data/jobs/job_manager.db の復元
restore_job_manager_db(r"data\backups\system\job_manager_20260821_120000_000000.db")
```

### 6. WAL/SHMの扱い

- `restore_sqlite_database()`が手順3として自動的に、target側の既存`-wal`/`-shm`を削除してから配置する。**手動で`shutil.copy`等を使う場合は、必ず先にtargetの`-wal`/`-shm`を削除すること**（本Issueの中心的発見。削除しないと、復元後も`PRAGMA integrity_check`は`ok`のまま、古いデータが見え続けるsilent failureになる）

### 7. Backend再起動

- restore成功（`integrity_check: "ok"`が返る）を確認した後にBackendを起動する

### 8. Post-restore verification

- `restore_sqlite_database()`が手順5として自動的に`PRAGMA quick_check`・`expected_tables`を再検証する（失敗時は自動ロールバック）
- 追加で以下を確認する:
  - `outputs/app.db`: `training_jobs`テーブルの代表的な行（直近のJob ID等）が期待どおり存在すること
  - `data/jobs/job_manager.db`: `job_manager_jobs`テーブルの代表的な行が期待どおり存在すること
  - application startup（Backend起動）がschema migration/initを壊さないこと（`init_db()`/`_ensure_schema()`が`CREATE TABLE IF NOT EXISTS`のため、復元済みテーブルに対しても正常に動作することを確認する）

### 9. Failure時のRollback

- `restore_sqlite_database()`は復元後検証に失敗した場合、pre-restore snapshotを使って**自動的に**targetを復元前の状態へロールバックしてから`SqliteRestoreError`を送出する（`rollback_performed`属性で実施有無を確認できる）
- 自動ロールバックの前提（`keep_pre_restore_snapshot=True`かつtargetが既存ファイルだった場合）が満たされない場合（例: target不在の新規restoreで失敗した場合）は、ロールバック対象がそもそも存在しないため、次回は改めてbackup artifactを検証してから再試行する

## Windows Considerations

- Windowsでは、DBファイルを開いたままの接続が残っていると`os.replace()`（ファイル置換）が`PermissionError`で失敗することを直接probeで確認済み。**restore前にBackendを完全に停止すること**が必須
- WALモードのDBで「クリーンな`close()`」は、それが最後の接続であれば自動的にcheckpointして`-wal`/`-shm`を削除する（本Issueのテストでは、真の「クラッシュ後にstale WALが残る」状態を再現するため、子プロセスを`kill()`する手法を用いた）
- restoreの一時ファイル（`.{name}.restoring.tmp`・`.{name}.rollback.tmp`）は正常系・異常系のいずれでも残らないことをテストで確認済み（`test_restore_does_not_leave_any_tmp_files_behind`）
- restore直後にtargetへの追加のファイルハンドルが残っていないこと（削除・再オープンが問題なくできること）をテストで確認済み（`test_restore_closes_all_connections_so_target_can_be_reopened_immediately`）

## Tests / Evidence

新規: `tests/test_sqlite_restore.py`（17件）。実`outputs/app.db`・実`data/projects/`は一切使用しない（`isolated_test_db`/`temp_projects`フィクスチャで隔離、または`tmp_path`のみ使用）。

- **正常系**: target未存在（disaster recovery、`pre_restore_snapshot: None`）／target既存（pre-restore snapshotが作成され、その内容が復元前のtargetと一致）
- **中心的発見の回帰ガード**: target側にstale `-wal`/`-shm`が残っていても（子プロセスをkillして「クラッシュ後」状態を再現）restore後に古いデータが復活しないこと。および、`restore_sqlite_database()`を使わず単純な`shutil.copy2`のみで置換した場合に古いデータがそのまま見え続けることを直接示す回帰ガード
- **WAL source/backupからのrestore**: WALモードのsourceから取ったbackupを復元し、未checkpointの行が正しく復元されること
- **expected_tables**: 一致時は成功、backup自体に期待テーブルが無い場合はrestore前にtargetへ一切触れないこと
- **エラー**: source backup不存在（`FileNotFoundError`）、破損backup（`sqlite3.DatabaseError`、既存targetは無変更）
- **失敗時のrollback**: コピー処理中に破損データが書き込まれるケース（`shutil.copy2`をmonkeypatchして模擬）でも、`rollback_performed=True`かつ元のtarget内容へロールバックされること
- **`keep_pre_restore_snapshot=False`**: snapshot作成をスキップできること
- **`restore_app_db()`/`restore_job_manager_db()`**: `isolated_test_db`/`temp_projects`フィクスチャで隔離したDBに対するbackup→変更→restoreの往復で、backup時点の状態へ戻ることを確認。source backup不存在時の`FileNotFoundError`
- **Windows file/open-handle semantics**: restore後に一時ファイルが残らないこと、targetへの追加ハンドルが残らず削除・再オープンが可能なこと

実行結果:

```
python -m pytest -q tests/test_sqlite_restore.py
# 17 passed

python -m pytest -q tests/test_sqlite_restore.py tests/test_sqlite_online_backup.py
# 32 passed

python -m pytest -q
# 1423 passed, 1 skipped, 10 failed, 93 errors
# 10 failed・93 errorsはIssue #141以降のbaselineと一致するローカルci_sim_venvの
# transformers/ultralytics完全欠落による既知の環境依存事象で、本Issueの変更とは無関係
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し不変（`e0535c72bfad6b5c64b719f0ee414e1c80cb45e1bf98a822d49dfe4d00635489`）であることを確認済み。Frontend diffは0（UI/API変更なしのため`npm test`はCIでのみ確認）。

## Documentation

- 本ファイル新規作成
- `docs/25_DISASTER_RECOVERY.md` §4: restoreが未実装であった記述を、`restore_app_db()`/`restore_job_manager_db()`実装済み・本Runbook参照への記述に更新
- `docs/BACKUP_AND_RESTORE.md`: グローバルSQLite DBのrestoreがrunbookとして確立されたことを追記
- `docs/workitems/roadmap/POST_SAFETY_HARDENING_ROADMAP_REFRESH_160.md`: Top Recommendation（本Issue）の状態を更新

## Scope外（Out of Scope、実施しなかったこと）

- Job System A/Bの統合
- jobs DB schema再設計
- `outputs/app.db` migration framework全面改修
- Project単位Backup/Restoreの再設計
- Backup UI/API追加
- scheduled backup
- cloud/NAS replication
- Epic #28 Consumer Migration
- application-wide transaction architecture変更

## Scope Discipline

調査中に別のReliability gapは新たに発見しなかった（本Issueは既存のFeature #147 backup機構に対するrestore手順の確立が目的であり、調査範囲は`sqlite_backup.py`・`db.py`・`job_manager.py`のownership/lifecycleに閉じた）。

## Future Work

- 将来UIからの手動トリガーが必要になった場合、本Issueの`restore_app_db()`/`restore_job_manager_db()`をそのまま呼ぶ薄いAPI endpointを追加するだけで済む設計にした（コア関数自体はUI非依存）
- 月次のリストア試験（`docs/RELEASE_CHECKLIST.md`）へ、グローバルSQLite DBのrestore試験も追加することを検討可能（現時点ではproject単位backupのリストア試験のみ記載）
