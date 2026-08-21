"""グローバルSQLite（`outputs/app.db`・`data/jobs/job_manager.db`）のOnline Backup /
Restore。

Investigation #143で確認したとおり、これら2つのSQLiteはproject単位の
`backup_manager.py`のバックアップ対象外である。特に`data/jobs/job_manager.db`は
WALモードで動作しており、稼働中の単純なファイルコピーでは直近のコミット済み
データが`-wal`ファイル側に残ったまま欠落しうることを同Investigationで実証済み
（Issue #147）。

Python標準ライブラリの`sqlite3.Connection.backup()`（SQLite公式のOnline Backup
API）を使い、journal mode（rollback/WAL）に依存せず、Backend停止不要で
transactionally consistentなsnapshotを作成する。新規の外部依存は追加しない。

Issue #162でrestore機能を追加した。**restore時の最重要の発見**: backup先の
main .dbファイルだけを単純に置き換えても、置き換え先に既存の`-wal`/`-shm`
ファイルが残っている場合、SQLiteは次回オープン時にその古い`-wal`を正規の
差分として適用し、**復元したはずのデータではなく置き換え前の古いデータが
そのまま見え続ける**（`PRAGMA integrity_check`は`ok`のまま、エラーも出ない
silent failure）ことをtemp DBのprobeで実証した。このため`restore_sqlite_database()`
は、置き換え前に対象パスの`-wal`/`-shm`を必ず削除してから復元する。

`backup_manager.py`（project directory配下のファイル群をZIP化する）とは責務を
分離する。保存先は`data/backups/system/`（project backupの`data/backups/`直下の
ZIP群とは別のsubdirectory）。UI/APIは追加しない（Issue #147/#162の明示的指示）。
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .. import project_paths as project_paths_module

# Online Backup中に他コネクションの一時的なlock競合があっても即座に失敗させず
# 短時間リトライさせる（backup()自体もSQLITE_BUSY時に内部でリトライ・sleepするが、
# PRAGMA実行等の周辺操作にも同じ猶予を持たせる）
_BUSY_TIMEOUT_MS = 5000


def _system_backups_root() -> Path:
    root = Path(project_paths_module.PROJECTS_DIR).parent / "backups" / "system"
    root.mkdir(parents=True, exist_ok=True)
    return root


class SqliteBackupIntegrityError(Exception):
    """backup直後の整合性検証（quick_check・期待テーブル確認）に失敗した。"""


class SqliteRestoreError(Exception):
    """restore対象（backupファイル自体、または復元後のtarget）の整合性検証に失敗した。

    backup自体の検証失敗時はtargetへ一切書込まれない。復元後検証の失敗時は
    可能な限り復元前のtarget状態へロールバックしてから送出する
    （`rollback_performed`属性でロールバック実施の有無を確認できる）。
    """

    def __init__(self, message: str, *, rollback_performed: bool = False) -> None:
        super().__init__(message)
        self.rollback_performed = rollback_performed


def _quick_check_and_tables(conn: sqlite3.Connection) -> tuple[bool, set[str]]:
    quick_check_rows = conn.execute("PRAGMA quick_check").fetchall()
    ok = len(quick_check_rows) == 1 and str(quick_check_rows[0][0]).lower() == "ok"
    tables = {str(row[0]) for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    return ok, tables


def _remove_wal_sidecars(db_path: Path) -> None:
    """`db_path`に隣接する`-wal`/`-shm`ファイルを削除する（存在しなくても何もしない）。

    restore時にこれを怠ると、古い`-wal`が復元後のmain .dbファイルに対して
    誤って適用され、復元したはずのデータではなく置き換え前の内容が見え続ける
    （本Issue #162の中心的発見。§モジュールdocstring参照）。
    """
    for suffix in ("-wal", "-shm"):
        Path(f"{db_path}{suffix}").unlink(missing_ok=True)


def backup_sqlite_database(
    source: Path | str,
    logical_name: str,
    *,
    destination_root: Optional[Path] = None,
    expected_tables: Optional[set[str]] = None,
) -> dict[str, Any]:
    """`source`のSQLite DBを、journal modeに依存せずconsistentなsnapshotとして
    `destination_root`（既定`data/backups/system/`）へ作成する。

    - `sqlite3.Connection.backup()`を使うため、source側の稼働中の読み書き
      （WAL未checkpointなコミット済みデータ含む）を正しく捕捉する
    - snapshotは同ディレクトリの一時ファイルへ書込み、整合性検証に通った後
      `os.replace()`で正式パスへ原子的に配置する（失敗時に壊れたファイルを
      正式な成果物として残さない）
    - 整合性検証: `PRAGMA quick_check` が `ok` であること、`expected_tables`
      指定時はそれらのテーブルが `sqlite_master` に存在すること
    - source DBは一切変更しない（読み取り専用の意図で使うのみ。書込みは
      destination側のみ）
    """
    source_path = Path(source)
    if not source_path.is_file():
        raise FileNotFoundError(f"source database not found: {source_path}")

    root = Path(destination_root) if destination_root is not None else _system_backups_root()
    root.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"{logical_name}_{stamp}.db"
    destination = root / filename
    suffix = 1
    while destination.exists():
        filename = f"{logical_name}_{stamp}_{suffix}.db"
        destination = root / filename
        suffix += 1
    tmp_destination = root / f".{filename}.tmp"
    tmp_destination.unlink(missing_ok=True)

    try:
        source_conn = sqlite3.connect(str(source_path))
        try:
            source_conn.execute(f"PRAGMA busy_timeout = {_BUSY_TIMEOUT_MS}")
            dest_conn = sqlite3.connect(str(tmp_destination))
            try:
                dest_conn.execute(f"PRAGMA busy_timeout = {_BUSY_TIMEOUT_MS}")
                source_conn.backup(dest_conn)
            finally:
                dest_conn.close()
        finally:
            source_conn.close()

        # 整合性検証（destinationを独立したコネクションで開き直して確認する。
        # 検証に失敗した場合はbackupを成功扱いにせず、tmpファイルを破棄する）
        verify_conn = sqlite3.connect(str(tmp_destination))
        try:
            quick_check_rows = verify_conn.execute("PRAGMA quick_check").fetchall()
            user_version = verify_conn.execute("PRAGMA user_version").fetchone()[0]
            existing_tables = {
                str(row[0])
                for row in verify_conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            }
        finally:
            verify_conn.close()

        quick_check_ok = len(quick_check_rows) == 1 and str(quick_check_rows[0][0]).lower() == "ok"
        if not quick_check_ok:
            raise SqliteBackupIntegrityError(
                f"backup integrity check (quick_check) failed for {logical_name!r}: {quick_check_rows}"
            )
        if expected_tables is not None:
            missing = expected_tables - existing_tables
            if missing:
                raise SqliteBackupIntegrityError(
                    f"backup for {logical_name!r} is missing expected tables: {sorted(missing)}"
                )

        os.replace(tmp_destination, destination)
    except Exception:
        tmp_destination.unlink(missing_ok=True)
        raise

    data = destination.read_bytes()
    from ..version import APP_VERSION
    from .atomic_io import atomic_write_json

    manifest = {
        "logical_name": logical_name,
        # portability維持のためsourceの絶対パスは記録せず、ファイル名のみ残す
        "source_filename": source_path.name,
        "destination_filename": filename,
        "created_at": datetime.now().isoformat(),
        "size_bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "sqlite_user_version": user_version,
        "app_version": APP_VERSION,
        "integrity_check": "ok",
    }
    atomic_write_json(root / f"{filename}.manifest.json", manifest)
    return manifest


def restore_sqlite_database(
    backup_path: Path | str,
    target_path: Path | str,
    *,
    expected_tables: Optional[set[str]] = None,
    keep_pre_restore_snapshot: bool = True,
) -> dict[str, Any]:
    """`backup_path`のSQLite snapshotを`target_path`へ安全に復元する（Issue #162）。

    Backend停止済みであることを前提とする（Decision Record参照。稼働中の
    復元は本関数のスコープ外）。手順:

    1. `backup_path`自体の整合性を検証する（quick_check・`expected_tables`）。
       ここで失敗した場合、`target_path`には一切触れない
    2. `target_path`が既に存在する場合、`keep_pre_restore_snapshot=True`
       （既定）なら復元前の状態を`sqlite3.Connection.backup()`で
       `<target名>_pre_restore_<timestamp>.db`として同ディレクトリへ退避する
       （target自体がWALモードで稼働中の書込みを持っていた場合でも、単純な
       ファイルコピーではなくOnline Backup APIで一貫した状態を保全する）
    3. **`target_path`に隣接する既存の`-wal`/`-shm`ファイルを削除する**
       （本Issueの中心的発見: これを怠ると、復元後に古い`-wal`が誤って適用され、
       復元したはずのデータではなく置き換え前の内容が見え続けるsilent failureが
       発生することをtemp DBのprobeで実証した）
    4. `backup_path`を同ディレクトリの一時ファイルへコピーし、`os.replace()`で
       `target_path`へ原子的に配置する
    5. 復元後の`target_path`を独立したコネクションで開き直し、quick_check・
       `expected_tables`を再検証する。失敗した場合、手順2で保全したpre-restore
       snapshotを使って`target_path`を復元前の状態へロールバックしてから
       `SqliteRestoreError`を送出する（`target_path`を壊れたまま・空のまま
       残さない）
    """
    backup_path = Path(backup_path)
    target_path = Path(target_path)

    if not backup_path.is_file():
        raise FileNotFoundError(f"backup file not found: {backup_path}")

    # 1. backup自体の整合性検証（targetへ触れる前）
    verify_conn = sqlite3.connect(str(backup_path))
    try:
        backup_ok, backup_tables = _quick_check_and_tables(verify_conn)
    finally:
        verify_conn.close()
    if not backup_ok:
        raise SqliteRestoreError(f"backup file failed integrity check (quick_check): {backup_path}")
    if expected_tables is not None:
        missing = expected_tables - backup_tables
        if missing:
            raise SqliteRestoreError(f"backup file is missing expected tables: {sorted(missing)}")

    target_path.parent.mkdir(parents=True, exist_ok=True)

    # 2. 復元前のtarget状態を保全する（存在する場合のみ）
    pre_restore_path: Optional[Path] = None
    if keep_pre_restore_snapshot and target_path.is_file():
        pre_restore_entry = backup_sqlite_database(
            target_path,
            f"{target_path.stem}_pre_restore",
            destination_root=target_path.parent,
        )
        pre_restore_path = target_path.parent / pre_restore_entry["destination_filename"]

    try:
        # 3. targetに隣接する既存の-wal/-shmを削除する（中心的な安全対策）
        _remove_wal_sidecars(target_path)

        # 4. backupをtargetへ原子的に配置する
        tmp_target = target_path.parent / f".{target_path.name}.restoring.tmp"
        tmp_target.unlink(missing_ok=True)
        try:
            shutil.copy2(backup_path, tmp_target)
            os.replace(tmp_target, target_path)
        finally:
            tmp_target.unlink(missing_ok=True)

        # 5. 復元後の検証
        post_conn = sqlite3.connect(str(target_path))
        try:
            post_ok, post_tables = _quick_check_and_tables(post_conn)
        finally:
            post_conn.close()
        if not post_ok:
            raise SqliteRestoreError(f"restored target failed integrity check (quick_check): {target_path}")
        if expected_tables is not None:
            missing_after = expected_tables - post_tables
            if missing_after:
                raise SqliteRestoreError(f"restored target is missing expected tables: {sorted(missing_after)}")
    except Exception as e:
        rollback_performed = False
        if pre_restore_path is not None and pre_restore_path.is_file():
            _remove_wal_sidecars(target_path)
            tmp_rollback = target_path.parent / f".{target_path.name}.rollback.tmp"
            tmp_rollback.unlink(missing_ok=True)
            try:
                shutil.copy2(pre_restore_path, tmp_rollback)
                os.replace(tmp_rollback, target_path)
                rollback_performed = True
            finally:
                tmp_rollback.unlink(missing_ok=True)
        if isinstance(e, SqliteRestoreError):
            e.rollback_performed = rollback_performed
            raise
        raise SqliteRestoreError(f"restore failed: {e}", rollback_performed=rollback_performed) from e

    return {
        "backup_path": str(backup_path),
        "target_path": str(target_path),
        "pre_restore_snapshot": str(pre_restore_path) if pre_restore_path is not None else None,
        "restored_at": datetime.now().isoformat(),
        "integrity_check": "ok",
    }


def backup_app_db(destination_root: Optional[Path] = None) -> dict[str, Any]:
    """`outputs/app.db`（Job System A、`training_jobs`テーブル）のonline backup。"""
    from .. import db as db_module

    return backup_sqlite_database(
        db_module._db_path(),  # noqa: SLF001 （db.py内部の既存path resolverをそのまま再利用する）
        "app",
        destination_root=destination_root,
        expected_tables={"training_jobs"},
    )


def backup_job_manager_db(destination_root: Optional[Path] = None) -> dict[str, Any]:
    """`data/jobs/job_manager.db`（Job System B、Issue #127）のonline backup。"""
    from .job_manager import _JOB_MANAGER_DB_FILENAME, _jobs_root

    source = _jobs_root() / _JOB_MANAGER_DB_FILENAME
    return backup_sqlite_database(
        source,
        "job_manager",
        destination_root=destination_root,
        expected_tables={"job_manager_jobs"},
    )


def restore_app_db(backup_path: Path | str, *, keep_pre_restore_snapshot: bool = True) -> dict[str, Any]:
    """`backup_path`（`backup_app_db()`が作成したsnapshot）を`outputs/app.db`へ復元する。

    Backend停止済みであることを前提とする（Decision Record参照）。
    """
    from .. import db as db_module

    return restore_sqlite_database(
        backup_path,
        db_module._db_path(),  # noqa: SLF001
        expected_tables={"training_jobs"},
        keep_pre_restore_snapshot=keep_pre_restore_snapshot,
    )


def restore_job_manager_db(backup_path: Path | str, *, keep_pre_restore_snapshot: bool = True) -> dict[str, Any]:
    """`backup_path`（`backup_job_manager_db()`が作成したsnapshot）を
    `data/jobs/job_manager.db`へ復元する。Backend停止済みであることを前提とする。
    """
    from .job_manager import _JOB_MANAGER_DB_FILENAME, _jobs_root

    target = _jobs_root() / _JOB_MANAGER_DB_FILENAME
    return restore_sqlite_database(
        backup_path,
        target,
        expected_tables={"job_manager_jobs"},
        keep_pre_restore_snapshot=keep_pre_restore_snapshot,
    )
