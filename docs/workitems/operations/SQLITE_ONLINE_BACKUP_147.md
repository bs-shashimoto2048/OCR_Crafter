# SQLite Online Backup for Global Job Databases 作業記録

Related: Feature [#147](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/147) / Investigation [#143](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/143)（Backup/Restore Investigation、本Issueの起点） / Bug [#145](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/145)（Restore Model Sidecar Path Rebase、Investigation #143推奨1件目・対応済み） / Feature [#127](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/127)（JobRepository SQLite移行、`job_manager.db`の作成元）

**状態**: Implemented, PR review pending。

## 目的

Investigation #143で推奨された2件目の実装Issue。`outputs/app.db`（Job System A）・`data/jobs/job_manager.db`（Job System B、Issue #127）はいずれもproject単位の`backup_manager.py`のバックアップ対象外であり、特に`job_manager.db`はWALモードのため単純なファイルコピーでは直近のコミット済みデータが欠落しうることをInvestigation #143で実証済みだった。本Issueでは`sqlite3.Connection.backup()`（Python標準ライブラリのOnline Backup API）を使い、Backend停止不要でtransactionally consistentなsnapshotを作成できるようにする。

## 実装前調査（Mandatory Investigation、Issue本文の11項目）

### 1. `db.py`のapp.db connection helper / path解決

`db.py::_db_path()` → `PROJECT_ROOT / settings["app"].get("db_path", "outputs/app.db")`。`get_conn()`は呼び出しごとに新しい`sqlite3.connect(path)`を返す（永続的な単一コネクションを保持しない）。

### 2. `job_manager.py`のjob_manager.db connection helper / path解決

`job_manager.py::_jobs_root()` → `Path(project_paths_module.PROJECTS_DIR).parent / "jobs"`。`JobRepository._path()` → `_jobs_root() / _JOB_MANAGER_DB_FILENAME`（`_JOB_MANAGER_DB_FILENAME = "job_manager.db"`）。`_connect()`は呼び出しごとに新しいコネクションを開き、`PRAGMA journal_mode=WAL`を都度設定する。

### 3. journal mode / WAL設定

`app.db`: 既定（rollback journal、PRAGMA未設定）。`job_manager.db`: 明示的にWAL。Investigation #143で実証済み: WALモードのDBを単純ファイルコピーすると、直近のコミット済みデータが`-wal`ファイル側に残ったまま欠落しうる（本Investigation #143のprobeで「テーブルすら存在しない」レベルの破損を確認済み）。

### 4. connection lifecycle

両DBとも「呼び出しごとに新規コネクションを開いて閉じる」設計（永続共有コネクション・コネクションプールは無い）。このためbackup処理も「都度新規コネクションを開いてbackup()を呼び、閉じる」という同じライフサイクルパターンを踏襲すれば既存設計と自然に整合する。

### 5. `sqlite3.Connection.backup()`を既存connection helperとどう組み合わせるか

`db.py::get_conn()`・`JobRepository._connect()`はいずれも「スキーマ初期化を伴う」設計（`get_conn()`自体はスキーマ初期化をしないが`init_db()`が別途必要、`_connect()`は`_ensure_schema()`を毎回実行）。バックアップは**読み取り専用の一時的なsnapshot取得**であり、スキーマ初期化を伴う既存helperをそのまま流用すると意図しないテーブル作成が起こりうるため、**バックアップ専用に軽量な`sqlite3.connect(path)`を直接使う**設計にした（`db_path`/`job_manager.db`のpath解決関数のみ既存のものを再利用し、コネクション取得自体は新規に行う）。

### 6. source DBが存在しない場合の現行policy

`db.py::get_conn()`は`path.parent.mkdir(parents=True, exist_ok=True)`のみ行い、DBファイル自体は`sqlite3.connect()`が初回接続時に遅延作成する。`init_db()`が呼ばれて初めてテーブルが作られる。バックアップ処理はこれとは独立して、**source DBファイルが存在しない場合は明確に`FileNotFoundError`を送出する**（存在しないDBを「空のバックアップ」として偽装しない）。

### 7. schema init前/後のbackup挙動

`CREATE TABLE IF NOT EXISTS`前（DBファイル自体が存在しない、または存在するが空）の状態でのbackupは、上記6の「ファイル不在」ケースか、あるいは「ファイルは存在するがテーブルが無い」ケースになりうる。後者は`expected_tables`検証（後述）で検出され、`SqliteBackupIntegrityError`として扱われる。

### 8. concurrent write中のbackup safety

`sqlite3.Connection.backup()`はSQLite公式のOnline Backup APIをラップしたものであり、journal modeに関わらず、稼働中の読み書きと安全に共存できるよう設計されている（内部でSQLITE_BUSY時にリトライ・sleepする）。本Investigationで実際にwriter threadが継続的にinsert+commitを行っている最中にbackupを実行し、成功すること・snapshotのintegrity checkが通ることをテストで確認した。

### 9. backup destination root / naming policy

`data/backups/system/`（project backupの`data/backups/`直下のZIP群とは別のsubdirectory、識別可能に分離）。ファイル名は`<logical_name>_<timestamp(マイクロ秒精度)>.db`（衝突時は連番suffixを付与）。

### 10. project backup index/manifestとの関係

project backup（`backup_manager.py`）の`index.json`（BK-0001形式の一覧採番）とは**意図的に統合しない**（Issue本文の「project backup機能とは責務を混同しない」という明示的要求）。かわりに各backupファイルに個別の`<filename>.manifest.json`サイドカーを添える、より単純な方式にした（一覧管理・UI/APIは本Issueのスコープ外のため、集約indexを設ける必要性が無い）。

### 11. existing disaster recovery docsとの整合

`docs/25_DISASTER_RECOVERY.md` §4は「`outputs/app.db`・`data/jobs/job_manager.db`はいずれもバックアップ対象外」「稼働中の単純ファイルコピーが安全でない」「`sqlite3.Connection.backup()`を使うこと」とすでに記述済み（Issue #143の是正で追記済み）。本Issueはこの記述が指す「今後実装すべき機能」を実際に実装するものであり、ドキュメントの記述内容自体とは矛盾しない。

## Scope Decision

**Option A（Internal service + explicit function）を採用**。UI/APIは追加しない（Issue本文の明示的指示）。新しいモジュール`src/app/services/sqlite_backup.py`を新設し、project単位の`backup_manager.py`とは責務を分離した（Issue本文の「project backup機能とは責務を混同しない」を反映）。

## 実装内容

### `src/app/services/sqlite_backup.py`（新規）

- `backup_sqlite_database(source, logical_name, *, destination_root=None, expected_tables=None) -> dict`: 汎用のOnline Backupコア関数。
  1. `source`が存在しなければ`FileNotFoundError`
  2. 一意な宛先ファイル名を決定（マイクロ秒精度タイムスタンプ＋衝突時連番）し、同ディレクトリの一時ファイル（`.{filename}.tmp`）へ`sqlite3.Connection.backup()`でsnapshotを作成
  3. 一時ファイルを独立したコネクションで開き直し、`PRAGMA quick_check`が`ok`であること、`expected_tables`指定時はそれらが`sqlite_master`に存在することを検証
  4. 検証成功時のみ`os.replace()`で正式パスへ原子的に配置。**失敗時（どの段階でも）は一時ファイルを削除し、例外を再送出する**（partial/corrupt backupを成功扱いにしない）
  5. 宛先ファイルのSHA-256・サイズ・`PRAGMA user_version`・App Versionを含むmanifest（`<filename>.manifest.json`）を`atomic_write_json`で書込み、返す
- `backup_app_db(destination_root=None)`: `db.py::_db_path()`を再利用する薄いwrapper。`expected_tables={"training_jobs"}`
- `backup_job_manager_db(destination_root=None)`: `job_manager.py::_jobs_root()`/`_JOB_MANAGER_DB_FILENAME`を再利用する薄いwrapper。`expected_tables={"job_manager_jobs"}`
- `SqliteBackupIntegrityError`: 整合性検証失敗を表す専用例外（`sqlite3.DatabaseError`等の低レベル例外と区別できるようにした）

source pathは`db.py`/`job_manager.py`の既存path resolverをそのまま再利用し、path文字列を新たにhardcodeしていない。

## Destination Layout

`data/backups/system/<logical_name>_<timestamp>.db` ＋ `<同名>.manifest.json`。project backupの`data/backups/`直下（ZIP＋`index.json`）とは`system/`subdirectoryで明確に分離される。

## Manifest / Metadata

各backupにつき以下を記録する: `logical_name` / `source_filename`（**絶対パスではなくファイル名のみ**。path portabilityを壊すabsolute pathは必須化しない、というIssue本文の明示的要求を反映） / `destination_filename` / `created_at` / `size_bytes` / `sha256` / `sqlite_user_version` / `app_version` / `integrity_check`。project backupのようなグローバル`index.json`（採番・一覧管理）は設けていない（§10参照、Scope外）。

## Integrity Verification

- `PRAGMA quick_check`が`ok`であることを必須とする
- `expected_tables`（wrapperがそれぞれ`{"training_jobs"}`/`{"job_manager_jobs"}`を指定）が`sqlite_master`に存在することを必須とする。コア関数自体はengine非依存（`expected_tables`未指定時はこのチェックをスキップする）汎用実装のため、「過剰にengine固有化しない」というIssue本文の要求を満たす
- いずれかの検証に失敗した場合は`SqliteBackupIntegrityError`を送出し、一時ファイルを削除する（正式パスへは一切昇格しない）

## Concurrent Write Verification

writer threadが継続的にinsert+commit（10ms間隔）している最中に`backup_sqlite_database()`を呼び出すテストで、backupが正常終了し、integrity checkが通り、snapshotが読み取り可能であることを確認した（`test_backup_succeeds_while_writer_thread_is_actively_committing`）。

## Restore Scope

本Issueではrestore Production機能は実装しない（Issue本文の明示的指示）。ただしbackupの実用性を証明するため、各テストでsnapshot DBを直接開いて期待する行が読めることまでを確認している（`app.db`の`training_jobs`行、`job_manager.db`の`job_manager_jobs`行）。

## Error Handling

| ケース | 挙動 |
|---|---|
| source DB missing | `FileNotFoundError` |
| destination exists（タイムスタンプ衝突） | 連番suffixを付与して回避（既存ファイルは上書きしない） |
| disk/write failure | 例外がそのまま送出され、一時ファイルは削除される |
| SQLite busy/locked | `PRAGMA busy_timeout=5000`を設定し、`backup()`自体の内部リトライ機構と合わせて一時的な競合を吸収する |
| malformed/corrupt source DB | `sqlite3.DatabaseError`（`sqlite3.connect()`/`backup()`実行時に送出される） |
| integrity check failure（quick_check不合格・期待テーブル欠落） | `SqliteBackupIntegrityError`。一時ファイルは削除され、正式パスへは昇格しない |

いずれの失敗パスでも一時ファイル（`.{filename}.tmp`）は`try/except`で確実に削除される（cleanup policy: 例外発生時は必ず削除、成功時は`os.replace()`で消費される）。

## Safety

- 実`outputs/app.db`・実`data/projects/`は一切変更しない（`isolated_test_db`/`temp_projects`フィクスチャで隔離）
- destructive restoreは実装していない（Restore Scope参照）
- テスト前後で`outputs/app.db`のsha256チェックサムが不変であることを確認済み

## Tests

新規: `tests/test_sqlite_online_backup.py`（15件）

- **Core backup helper**: 単純DBのdata/schema保持、destination整合性、source非変更、destinationの原子的確定（tmpファイル残存なし）、宛先ファイル名衝突の回避
- **WAL**: 未checkpointのコミット済み行が正しく含まれること、**単純な`shutil.copy`では同じ行が欠落する（`no such table`エラーになる）ことを示す直接的な回帰ガード**（Investigation #143の実証内容をテストとして固定化）
- **Concurrent writes**: writer threadが継続的にcommitしている最中でもbackupが成功し、snapshotのintegrityが保たれること
- **app.db wrapper**: `isolated_test_db`フィクスチャで隔離した一時DBに`training_jobs`行を作成し、`backup_app_db()`で正しく保持されることを確認。source欠落時の`FileNotFoundError`
- **job_manager.db wrapper**: `temp_projects`フィクスチャで隔離した一時jobs DBに`JobService.create_job()`で行を作成し、`backup_job_manager_db()`で正しく保持されることを確認。source欠落時の`FileNotFoundError`
- **Errors**: source欠落、破損source（`DatabaseError`）、期待テーブル欠落（`SqliteBackupIntegrityError`）のいずれも一時ファイルを残さないこと
- **manifestのpath portability**: `source_filename`が絶対パスではなくファイル名のみであること

実行結果:

```
python -m pytest -q tests/test_sqlite_online_backup.py
# 15 passed

python -m pytest -q tests/test_sqlite_online_backup.py tests/test_backup_retention.py \
  tests/test_restore_model_sidecar_path_rebase.py tests/test_job_manager.py \
  tests/test_job_repository_sqlite_migration.py tests/test_dataset_registry.py
# 80 passed

python -m pytest -q
# 1336 passed, 10 failed, 93 errors
# 10 failed・93 errorsはIssue #141/#143/#145時点のbaselineと一致するローカルci_sim_venvの
# transformers完全欠落による既知の環境依存事象で、本Issueの変更とは無関係
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し一致を確認済み。Frontend diffは0（`git diff --stat -- frontend/`で確認済み。UI/API変更なしのため`npm test`はCIでのみ確認）。

## Documentation

- 本ファイル新規作成
- `docs/BACKUP_AND_RESTORE.md` / `docs/25_DISASTER_RECOVERY.md`: 「今後sqlite3.Connection.backup()を使うこと」という記述を、実装済みの内部関数（`sqlite_backup.py::backup_app_db()`/`backup_job_manager_db()`）を指す記述へ更新
- `docs/workitems/operations/BACKUP_RESTORE_INVESTIGATION_143.md`: Next Issue Split 2件目を解決済みへ更新

## Scope外（Out of Scope、実施しなかったこと）

- project backup/restore全面再設計
- UI backup画面・API endpoint（Issue本文の明示的指示により追加していない）
- automatic scheduled backup
- cloud/object storage
- encryption/key management
- full-system restore automation（restore自体は実装していない。snapshotがopen・読取可能であることの確認に留める）
- `metadata_only`対象拡張（Investigation #143推奨3件目、別Issue）
- Epic #28 Consumer Migration

## Future Work

- Investigation #143推奨3件目（`metadata_only`バックアップへ`benchmark_center.json`・`inference_model.json`を追加）は未着手のまま
- 将来UIからの手動トリガーが必要になった場合、本Issueの`backup_app_db()`/`backup_job_manager_db()`をそのまま呼ぶ薄いAPI endpointを追加するだけで済む設計にした（コア関数自体はUI非依存）
