"""グローバルSQLite（outputs/app.db・data/jobs/job_manager.db）のOnline Backup（Issue #147）
のテスト。

Investigation #143で発見した「単純なファイルコピーはWALモードで欠落しうる」問題を
`sqlite3.Connection.backup()`で解決していることを実証する。実`outputs/app.db`・
実`data/projects/`へは一切触れない（`isolated_test_db`/`temp_projects`フィクスチャで隔離）。
"""

import shutil
import sqlite3
import threading
import time
from pathlib import Path

import pytest

from src.app.services.sqlite_backup import (
    SqliteBackupIntegrityError,
    backup_app_db,
    backup_job_manager_db,
    backup_sqlite_database,
)

import src.app.db as db_module


def _make_simple_db(path: Path, *, journal_mode: str = "DELETE") -> None:
    conn = sqlite3.connect(path)
    conn.execute(f"PRAGMA journal_mode={journal_mode}")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO t (v) VALUES ('row-1')")
    conn.execute("INSERT INTO t (v) VALUES ('row-2')")
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Core backup helper
# ---------------------------------------------------------------------------


def test_simple_db_backup_preserves_data_and_schema(tmp_path):
    source = tmp_path / "source.db"
    _make_simple_db(source)
    manifest = backup_sqlite_database(source, "simple", destination_root=tmp_path / "dest")

    dest_path = tmp_path / "dest" / manifest["destination_filename"]
    assert dest_path.is_file()
    conn = sqlite3.connect(dest_path)
    rows = conn.execute("SELECT v FROM t ORDER BY id").fetchall()
    assert rows == [("row-1",), ("row-2",)]
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "t" in tables
    conn.close()

    assert manifest["integrity_check"] == "ok"
    assert manifest["sha256"]
    assert manifest["size_bytes"] > 0


def test_source_db_unchanged_after_backup(tmp_path):
    source = tmp_path / "source.db"
    _make_simple_db(source)
    before = source.read_bytes()
    backup_sqlite_database(source, "simple", destination_root=tmp_path / "dest")
    assert source.read_bytes() == before


def test_destination_atomic_finalization_leaves_no_tmp_file(tmp_path):
    source = tmp_path / "source.db"
    _make_simple_db(source)
    manifest = backup_sqlite_database(source, "simple", destination_root=tmp_path / "dest")
    dest_root = tmp_path / "dest"
    tmp_leftovers = [p for p in dest_root.iterdir() if p.name.startswith(".") and p.name.endswith(".tmp")]
    assert tmp_leftovers == []
    assert (dest_root / f"{manifest['destination_filename']}.manifest.json").is_file()


def test_destination_filename_collision_is_avoided(tmp_path, monkeypatch):
    """同じタイムスタンプ（マイクロ秒精度）で衝突しても、既存ファイルを上書きしない。"""
    source = tmp_path / "source.db"
    _make_simple_db(source)
    dest_root = tmp_path / "dest"
    dest_root.mkdir()
    # 意図的に、次に生成されるファイル名と同じファイルを先に作っておく
    import src.app.services.sqlite_backup as sqlite_backup_module

    fixed_stamp = "20260101_000000_000000"

    class _FixedDatetime:
        @staticmethod
        def now():
            class _N:
                def strftime(self, _fmt):
                    return fixed_stamp

                def isoformat(self):
                    return "2026-01-01T00:00:00"

            return _N()

    monkeypatch.setattr(sqlite_backup_module, "datetime", _FixedDatetime)
    (dest_root / f"simple_{fixed_stamp}.db").write_bytes(b"pre-existing")
    manifest = backup_sqlite_database(source, "simple", destination_root=dest_root)
    assert manifest["destination_filename"] != f"simple_{fixed_stamp}.db"
    assert (dest_root / f"simple_{fixed_stamp}.db").read_bytes() == b"pre-existing"  # 既存ファイルは無変更


# ---------------------------------------------------------------------------
# WAL
# ---------------------------------------------------------------------------


def test_wal_mode_backup_includes_uncheckpointed_committed_row(tmp_path):
    """WALモードでコミット済みだがcheckpointされていない行を、backupが正しく含むこと
    （Investigation #143で実証した、単純ファイルコピーとの決定的な差）。"""
    source = tmp_path / "wal_source.db"
    conn = sqlite3.connect(source)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO t (v) VALUES ('committed-but-uncheckpointed')")
    conn.commit()
    assert (tmp_path / "wal_source.db-wal").exists()  # commit後もWALファイルにデータが残っている

    manifest = backup_sqlite_database(source, "wal", destination_root=tmp_path / "dest")
    conn.close()

    dest_path = tmp_path / "dest" / manifest["destination_filename"]
    dest_conn = sqlite3.connect(dest_path)
    rows = dest_conn.execute("SELECT v FROM t").fetchall()
    dest_conn.close()
    assert rows == [("committed-but-uncheckpointed",)]


def test_naive_file_copy_would_have_missed_the_wal_data_regression_guard(tmp_path):
    """単純な`shutil.copy`（backup_sqlite_databaseを使わない場合）はWALデータを
    欠落させることを直接示す回帰ガード（Investigation #143の実証内容の固定化）。"""
    source = tmp_path / "wal_source.db"
    conn = sqlite3.connect(source)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO t (v) VALUES ('committed-but-uncheckpointed')")
    conn.commit()

    naive_copy = tmp_path / "naive_copy.db"
    shutil.copy(source, naive_copy)
    naive_conn = sqlite3.connect(naive_copy)
    with pytest.raises(sqlite3.OperationalError, match="no such table"):
        naive_conn.execute("SELECT v FROM t").fetchall()
    naive_conn.close()
    conn.close()


# ---------------------------------------------------------------------------
# Concurrent writes
# ---------------------------------------------------------------------------


def test_backup_succeeds_while_writer_thread_is_actively_committing(tmp_path):
    source = tmp_path / "concurrent.db"
    _make_simple_db(source, journal_mode="WAL")

    stop = threading.Event()
    errors: list[Exception] = []

    def _writer():
        conn = sqlite3.connect(source, timeout=5.0)
        try:
            i = 0
            while not stop.is_set():
                conn.execute("INSERT INTO t (v) VALUES (?)", (f"writer-{i}",))
                conn.commit()
                i += 1
                time.sleep(0.01)
        except Exception as e:  # noqa: BLE001
            errors.append(e)
        finally:
            conn.close()

    thread = threading.Thread(target=_writer, daemon=True)
    thread.start()
    time.sleep(0.05)  # writerが動き出すのを少し待つ
    try:
        manifest = backup_sqlite_database(source, "concurrent", destination_root=tmp_path / "dest")
    finally:
        stop.set()
        thread.join(timeout=5.0)

    assert not errors, f"writer thread failed unexpectedly: {errors}"
    assert manifest["integrity_check"] == "ok"
    dest_path = tmp_path / "dest" / manifest["destination_filename"]
    dest_conn = sqlite3.connect(dest_path)
    count = dest_conn.execute("SELECT COUNT(*) FROM t").fetchone()[0]
    dest_conn.close()
    assert count >= 2  # 最低でも_make_simple_dbの初期2行は一貫して含まれる


# ---------------------------------------------------------------------------
# app.db wrapper
# ---------------------------------------------------------------------------


def test_backup_app_db_preserves_training_jobs_row(isolated_test_db, tmp_path):
    db_module.upsert_training_job(
        {
            "id": "job-backup-probe-1",
            "project_id": "p1",
            "model_type": "ocr",
            "epochs": 3,
            "batch_size": 2,
            "status": "completed",
            "created_at": "2026-08-01T00:00:00",
            "updated_at": "2026-08-01T00:10:00",
        }
    )
    manifest = backup_app_db(destination_root=tmp_path / "dest")
    assert manifest["logical_name"] == "app"
    dest_path = tmp_path / "dest" / manifest["destination_filename"]
    conn = sqlite3.connect(dest_path)
    row = conn.execute("SELECT id, status FROM training_jobs WHERE id = ?", ("job-backup-probe-1",)).fetchone()
    conn.close()
    assert row == ("job-backup-probe-1", "completed")


def test_backup_app_db_missing_source_raises(tmp_path, monkeypatch):
    missing_path = tmp_path / "does_not_exist_app.db"
    monkeypatch.setattr(db_module, "_db_path", lambda: missing_path)
    with pytest.raises(FileNotFoundError):
        backup_app_db(destination_root=tmp_path / "dest")


# ---------------------------------------------------------------------------
# job_manager.db wrapper
# ---------------------------------------------------------------------------


def test_backup_job_manager_db_preserves_job_row(temp_projects, tmp_path):
    from src.app.services.job_manager import JobService

    service = JobService()
    job, _ = service.create_job("p1", "preprocess", {})
    manifest = backup_job_manager_db(destination_root=tmp_path / "dest")
    assert manifest["logical_name"] == "job_manager"
    dest_path = tmp_path / "dest" / manifest["destination_filename"]
    conn = sqlite3.connect(dest_path)
    row = conn.execute(
        "SELECT job_id, job_type FROM job_manager_jobs WHERE job_id = ?", (job["job_id"],)
    ).fetchone()
    conn.close()
    assert row == (job["job_id"], "preprocess")


def test_backup_job_manager_db_missing_source_raises(temp_projects, tmp_path):
    with pytest.raises(FileNotFoundError):
        backup_job_manager_db(destination_root=tmp_path / "dest")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


def test_missing_source_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        backup_sqlite_database(tmp_path / "nope.db", "x", destination_root=tmp_path / "dest")


def test_corrupt_source_raises_and_leaves_no_partial_destination(tmp_path):
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"not a real sqlite database file at all")
    dest_root = tmp_path / "dest"
    with pytest.raises(sqlite3.DatabaseError):
        backup_sqlite_database(corrupt, "corrupt", destination_root=dest_root)
    assert not dest_root.exists() or list(dest_root.iterdir()) == []


def test_missing_expected_table_raises_integrity_error_and_cleans_up(tmp_path):
    source = tmp_path / "plain.db"
    conn = sqlite3.connect(source)
    conn.execute("CREATE TABLE unrelated (id INTEGER)")
    conn.commit()
    conn.close()
    dest_root = tmp_path / "dest"
    with pytest.raises(SqliteBackupIntegrityError):
        backup_sqlite_database(source, "plain", destination_root=dest_root, expected_tables={"training_jobs"})
    assert not dest_root.exists() or list(dest_root.iterdir()) == []


def test_manifest_does_not_contain_absolute_source_path(tmp_path):
    """path portabilityを壊すabsolute pathをmanifestへ必須化しない（Issue本文の明示的要求）。"""
    source = tmp_path / "source.db"
    _make_simple_db(source)
    manifest = backup_sqlite_database(source, "simple", destination_root=tmp_path / "dest")
    assert str(tmp_path) not in str(manifest.get("source_filename", ""))
    assert manifest["source_filename"] == "source.db"
