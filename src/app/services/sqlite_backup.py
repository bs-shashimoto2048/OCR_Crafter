"""グローバルSQLite（`outputs/app.db`・`data/jobs/job_manager.db`）のOnline Backup。

Investigation #143で確認したとおり、これら2つのSQLiteはproject単位の
`backup_manager.py`のバックアップ対象外である。特に`data/jobs/job_manager.db`は
WALモードで動作しており、稼働中の単純なファイルコピーでは直近のコミット済み
データが`-wal`ファイル側に残ったまま欠落しうることを同Investigationで実証済み
（本Issue #147）。

Python標準ライブラリの`sqlite3.Connection.backup()`（SQLite公式のOnline Backup
API）を使い、journal mode（rollback/WAL）に依存せず、Backend停止不要で
transactionally consistentなsnapshotを作成する。新規の外部依存は追加しない。

`backup_manager.py`（project directory配下のファイル群をZIP化する）とは責務を
分離する。保存先は`data/backups/system/`（project backupの`data/backups/`直下の
ZIP群とは別のsubdirectory）。UI/APIは追加しない（本Issueのスコープ外、Issue本文の
明示的指示）。
"""

from __future__ import annotations

import hashlib
import os
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
