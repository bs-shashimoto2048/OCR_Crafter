"""グローバルSQLite（outputs/app.db・data/jobs/job_manager.db）のOnline Restore（Issue #162）
のテスト。

本Issueの中心的発見: restore先に既存の`-wal`/`-shm`ファイルが残っている場合、単純な
main .dbファイルの置換だけでは、古い`-wal`が次回オープン時に誤って適用され、
復元したはずのデータではなく置換前の古いデータがそのまま見え続ける
（`PRAGMA integrity_check`は`ok`のまま、エラーも出ないsilent failure）。
`restore_sqlite_database()`がこれを検出・防止することを実DBを使わずtemp directoryの
SQLite DBで実証する。実`outputs/app.db`・実`data/projects/`へは一切触れない
（`isolated_test_db`/`temp_projects`フィクスチャで隔離）。
"""

import subprocess
import sys
import sqlite3
import time
from pathlib import Path

import pytest

from src.app.services.sqlite_backup import (
    SqliteRestoreError,
    backup_app_db,
    backup_job_manager_db,
    backup_sqlite_database,
    restore_app_db,
    restore_job_manager_db,
    restore_sqlite_database,
)

import src.app.db as db_module


def _make_simple_db(path: Path, *, journal_mode: str = "DELETE", value: str = "row1") -> None:
    conn = sqlite3.connect(path)
    conn.execute(f"PRAGMA journal_mode={journal_mode}")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO t (v) VALUES (?)", (value,))
    conn.commit()
    conn.close()


def _leave_stale_wal_via_crashed_process(path: Path, tmp_path: Path, *, value: str) -> None:
    """`path`をWALモードで書込み・commitした直後にプロセスをkillし、`-wal`/`-shm`が
    checkpointされず残った「クラッシュ後」の状態を再現する。

    通常の`conn.close()`は（最後の接続の場合）SQLiteが自動checkpointして`-wal`を
    削除してしまうため、それでは本Issueが対象とする「stale `-wal`が残っている」
    状況を再現できない（直接probeで確認済み）。子プロセスをkillすることで、
    クリーンな切断を経ない実際のクラッシュに近い状態を作る。
    """
    child_script = tmp_path / "_write_wal_then_hang.py"
    child_script.write_text(
        "import sqlite3, sys, time\n"
        "conn = sqlite3.connect(sys.argv[1])\n"
        "conn.execute('PRAGMA journal_mode=WAL')\n"
        "conn.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')\n"
        "conn.execute('INSERT INTO t (v) VALUES (?)', (sys.argv[2],))\n"
        "conn.commit()\n"
        "print('written', flush=True)\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    proc = subprocess.Popen(
        [sys.executable, str(child_script), str(path), value],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        line = proc.stdout.readline()
        assert line.strip() == "written"
        time.sleep(0.2)
    finally:
        proc.kill()
        proc.wait(timeout=5)


# ---------------------------------------------------------------------------
# Core restore: normal cases
# ---------------------------------------------------------------------------


def test_restore_into_fresh_target_with_no_pre_existing_file(tmp_path):
    """target側にファイルが元々存在しない（disaster-recovery）場合、
    pre_restore_snapshotはNoneのまま正しくrestoreできる。"""
    source = tmp_path / "source.db"
    _make_simple_db(source, value="backed-up-value")
    manifest = backup_sqlite_database(source, "app", destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target" / "app.db"
    result = restore_sqlite_database(backup_path, target)

    assert result["pre_restore_snapshot"] is None
    assert result["integrity_check"] == "ok"
    conn = sqlite3.connect(target)
    rows = conn.execute("SELECT v FROM t").fetchall()
    conn.close()
    assert rows == [("backed-up-value",)]


def test_restore_replaces_existing_target_and_creates_pre_restore_snapshot(tmp_path):
    source = tmp_path / "source.db"
    _make_simple_db(source, value="backed-up-value")
    manifest = backup_sqlite_database(source, "app", destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target" / "app.db"
    target.parent.mkdir(parents=True)
    _make_simple_db(target, value="pre-existing-value")

    result = restore_sqlite_database(backup_path, target)

    assert result["pre_restore_snapshot"] is not None
    pre_restore_path = Path(result["pre_restore_snapshot"])
    assert pre_restore_path.is_file()
    pre_conn = sqlite3.connect(pre_restore_path)
    pre_rows = pre_conn.execute("SELECT v FROM t").fetchall()
    pre_conn.close()
    assert pre_rows == [("pre-existing-value",)]  # 復元前のtarget内容がsnapshotへ保全されている

    conn = sqlite3.connect(target)
    rows = conn.execute("SELECT v FROM t").fetchall()
    conn.close()
    assert rows == [("backed-up-value",)]


# ---------------------------------------------------------------------------
# The Issue's central finding: stale WAL/SHM at target must not resurrect old data
# ---------------------------------------------------------------------------


def test_restore_removes_stale_wal_so_old_target_data_does_not_resurface(tmp_path):
    """本Issue #162の中心的発見の回帰ガード: target側に古い`-wal`/`-shm`が残っていても、
    restore後に古いデータが復活しないこと（restoreがこれを怠ると、backupの内容ではなく
    古い`-wal`が指すpre-restoreの内容が見え続けるsilent failureになる）。"""
    source = tmp_path / "source.db"
    _make_simple_db(source, value="backed-up-value")
    manifest = backup_sqlite_database(source, "app", destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target" / "app.db"
    target.parent.mkdir(parents=True)
    _leave_stale_wal_via_crashed_process(target, tmp_path, value="stale-pre-crash-data")
    assert (tmp_path / "target" / "app.db-wal").exists()  # 古いWALが残存している前提を確認

    result = restore_sqlite_database(backup_path, target)

    assert result["integrity_check"] == "ok"
    assert not (tmp_path / "target" / "app.db-wal").exists()
    assert not (tmp_path / "target" / "app.db-shm").exists()
    conn = sqlite3.connect(target)
    rows = conn.execute("SELECT v FROM t").fetchall()
    conn.close()
    assert rows == [("backed-up-value",)]  # 古いWALの内容ではなく、backupの内容が見える


def test_naive_copy_without_removing_stale_wal_would_show_old_data_regression_guard(tmp_path):
    """`restore_sqlite_database()`を使わず単純な`shutil.copy2`だけで置換した場合、
    stale `-wal`のせいで復元後も古いデータが見え続けることを直接示す回帰ガード
    （Issue #162の実証内容の固定化。§モジュールdocstring参照）。"""
    import shutil

    source = tmp_path / "source.db"
    _make_simple_db(source, value="backed-up-value")

    target = tmp_path / "target.db"
    _leave_stale_wal_via_crashed_process(target, tmp_path, value="stale-pre-crash-data")
    assert (tmp_path / "target.db-wal").exists()

    shutil.copy2(source, target)  # -walを消さない単純なコピー

    conn = sqlite3.connect(target)
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    rows = conn.execute("SELECT v FROM t").fetchall()
    conn.close()
    assert integrity == "ok"  # エラーは出ない
    assert rows == [("stale-pre-crash-data",)]  # だが古いデータのまま（backed-up-valueではない）


# ---------------------------------------------------------------------------
# WAL source/backup round-trip
# ---------------------------------------------------------------------------


def test_restore_of_a_backup_taken_from_a_wal_mode_source_preserves_uncheckpointed_row(tmp_path):
    source = tmp_path / "wal_source.db"
    conn = sqlite3.connect(source)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO t (v) VALUES ('committed-but-uncheckpointed')")
    conn.commit()
    manifest = backup_sqlite_database(source, "wal", destination_root=tmp_path / "dest")
    conn.close()
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target" / "restored.db"
    result = restore_sqlite_database(backup_path, target)

    assert result["integrity_check"] == "ok"
    restored_conn = sqlite3.connect(target)
    rows = restored_conn.execute("SELECT v FROM t").fetchall()
    restored_conn.close()
    assert rows == [("committed-but-uncheckpointed",)]


# ---------------------------------------------------------------------------
# expected_tables
# ---------------------------------------------------------------------------


def test_restore_with_matching_expected_tables_succeeds(tmp_path):
    source = tmp_path / "source.db"
    _make_simple_db(source)
    manifest = backup_sqlite_database(source, "app", destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target.db"
    result = restore_sqlite_database(backup_path, target, expected_tables={"t"})
    assert result["integrity_check"] == "ok"


def test_restore_rejects_backup_missing_expected_table_before_touching_target(tmp_path):
    """backup自体に期待テーブルが無い場合、target（既存ファイル）には一切触れないこと。"""
    source = tmp_path / "source.db"
    _make_simple_db(source)
    manifest = backup_sqlite_database(source, "app", destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target.db"
    _make_simple_db(target, value="must-not-change")

    with pytest.raises(SqliteRestoreError):
        restore_sqlite_database(backup_path, target, expected_tables={"nonexistent_table"})

    conn = sqlite3.connect(target)
    rows = conn.execute("SELECT v FROM t").fetchall()
    conn.close()
    assert rows == [("must-not-change",)]  # targetは復元試行前のまま


# ---------------------------------------------------------------------------
# Errors / missing backup
# ---------------------------------------------------------------------------


def test_restore_missing_backup_file_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        restore_sqlite_database(tmp_path / "nope.db", tmp_path / "target.db")


def test_restore_corrupt_backup_raises_and_leaves_existing_target_untouched(tmp_path):
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"not a real sqlite database file at all")

    target = tmp_path / "target.db"
    _make_simple_db(target, value="must-not-change")
    before = target.read_bytes()

    with pytest.raises(sqlite3.DatabaseError):
        restore_sqlite_database(corrupt, target)

    assert target.read_bytes() == before


# ---------------------------------------------------------------------------
# Rollback on post-restore verification failure
# ---------------------------------------------------------------------------


def test_restore_failure_during_copy_rolls_back_to_pre_restore_snapshot(tmp_path, monkeypatch):
    """コピー処理そのものが壊れたデータを書き込んだ場合（post-restore検証で発覚する
    ケースの模擬）でも、元のtargetを失わずロールバックされること。"""
    import src.app.services.sqlite_backup as sqlite_backup_module

    source = tmp_path / "source.db"
    _make_simple_db(source, value="backed-up-value")
    manifest = backup_sqlite_database(source, "app", destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target.db"
    _make_simple_db(target, value="original-value")

    real_copy2 = sqlite_backup_module.shutil.copy2

    def _corrupting_copy2(src_arg, dst_arg, *args, **kwargs):
        # backup_path -> tmp_targetへのコピー（復元コピー）だけを、壊れた内容へ
        # すり替える。ロールバック時のコピー（pre_restore_path -> tmp_rollback）は
        # 通常どおり動作させ、ロールバック自体が壊れないようにする
        if Path(src_arg) == backup_path:
            Path(dst_arg).write_bytes(b"corrupted during copy, not a valid sqlite file")
            return None
        return real_copy2(src_arg, dst_arg, *args, **kwargs)

    monkeypatch.setattr(sqlite_backup_module.shutil, "copy2", _corrupting_copy2)

    with pytest.raises(SqliteRestoreError) as excinfo:
        restore_sqlite_database(backup_path, target)

    assert excinfo.value.rollback_performed is True

    conn = sqlite3.connect(target)
    rows = conn.execute("SELECT v FROM t").fetchall()
    conn.close()
    assert rows == [("original-value",)]  # 破損した内容ではなく、元のtargetへロールバックされている


# ---------------------------------------------------------------------------
# keep_pre_restore_snapshot=False
# ---------------------------------------------------------------------------


def test_keep_pre_restore_snapshot_false_skips_snapshot_creation(tmp_path):
    source = tmp_path / "source.db"
    _make_simple_db(source, value="backed-up-value")
    manifest = backup_sqlite_database(source, "app", destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target.db"
    _make_simple_db(target, value="pre-existing-value")

    result = restore_sqlite_database(backup_path, target, keep_pre_restore_snapshot=False)
    assert result["pre_restore_snapshot"] is None


# ---------------------------------------------------------------------------
# app.db / job_manager.db wrappers
# ---------------------------------------------------------------------------


def test_restore_app_db_round_trip_via_backup_and_restore(isolated_test_db, tmp_path):
    db_module.upsert_training_job(
        {
            "id": "job-restore-probe-1",
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
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    # backup後にtraining_jobsが変わった状態を作り、restoreで元に戻ることを確認する
    db_module.upsert_training_job(
        {
            "id": "job-restore-probe-1",
            "project_id": "p1",
            "model_type": "ocr",
            "epochs": 3,
            "batch_size": 2,
            "status": "failed",
            "created_at": "2026-08-01T00:00:00",
            "updated_at": "2026-08-01T00:20:00",
        }
    )

    result = restore_app_db(backup_path)
    assert result["integrity_check"] == "ok"

    conn = sqlite3.connect(db_module._db_path())  # noqa: SLF001
    row = conn.execute(
        "SELECT id, status FROM training_jobs WHERE id = ?", ("job-restore-probe-1",)
    ).fetchone()
    conn.close()
    assert row == ("job-restore-probe-1", "completed")  # backup時点の状態へ復元されている


def test_restore_app_db_missing_backup_raises(isolated_test_db, tmp_path):
    with pytest.raises(FileNotFoundError):
        restore_app_db(tmp_path / "does_not_exist.db")


def test_restore_job_manager_db_round_trip_via_backup_and_restore(temp_projects, tmp_path):
    from src.app.services.job_manager import JobService, _JOB_MANAGER_DB_FILENAME, _jobs_root

    service = JobService()
    job, _ = service.create_job("p1", "preprocess", {})
    manifest = backup_job_manager_db(destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    # backup後に別のjobが追加された状態を作る（同一job_type/paramsだとdedupされるため
    # paramsを変えて別Jobとして登録させる）
    service.create_job("p1", "preprocess", {"variant": "post-backup"})

    result = restore_job_manager_db(backup_path)
    assert result["integrity_check"] == "ok"

    target = _jobs_root() / _JOB_MANAGER_DB_FILENAME
    conn = sqlite3.connect(target)
    rows = conn.execute("SELECT job_id, job_type FROM job_manager_jobs").fetchall()
    conn.close()
    assert rows == [(job["job_id"], "preprocess")]  # backup時点の1件のみへ復元されている


def test_restore_job_manager_db_missing_backup_raises(temp_projects, tmp_path):
    with pytest.raises(FileNotFoundError):
        restore_job_manager_db(tmp_path / "does_not_exist.db")


# ---------------------------------------------------------------------------
# Windows file/open-handle semantics
# ---------------------------------------------------------------------------


def test_restore_does_not_leave_any_tmp_files_behind(tmp_path):
    """restore/rollbackの一時ファイル（`.{name}.restoring.tmp`等）が正常系終了後に
    残らないこと（Windowsでの後始末漏れ検出）。"""
    source = tmp_path / "source.db"
    _make_simple_db(source, value="backed-up-value")
    manifest = backup_sqlite_database(source, "app", destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target" / "app.db"
    target.parent.mkdir(parents=True)
    _make_simple_db(target, value="pre-existing-value")

    restore_sqlite_database(backup_path, target)

    tmp_leftovers = [
        p for p in target.parent.iterdir() if p.name.startswith(".") and p.name.endswith(".tmp")
    ]
    assert tmp_leftovers == []


def test_restore_closes_all_connections_so_target_can_be_reopened_immediately(tmp_path):
    """restore直後、target DBへのファイルハンドルが残っていないこと（Windowsでは
    開いたままのハンドルが後続の削除・再オープンを阻害しうるため明示的に確認する）。"""
    source = tmp_path / "source.db"
    _make_simple_db(source, value="backed-up-value")
    manifest = backup_sqlite_database(source, "app", destination_root=tmp_path / "dest")
    backup_path = tmp_path / "dest" / manifest["destination_filename"]

    target = tmp_path / "target.db"
    restore_sqlite_database(backup_path, target)

    # Windowsでは他プロセス/自プロセスが元ファイルを開いたままだと削除やrenameが失敗する。
    # restore後にtargetの削除・再作成が問題なくできることで、ハンドルが残っていないことを示す。
    target.unlink()
    _make_simple_db(target, value="reused-path-after-restore")
    conn = sqlite3.connect(target)
    rows = conn.execute("SELECT v FROM t").fetchall()
    conn.close()
    assert rows == [("reused-path-after-restore",)]
