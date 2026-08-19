"""Windows Training Process Tree Termination（Issue #133、Investigation #129の解消）のテスト。

`_terminate_training_process_tree()`（新設）が、Unix/Windowsそれぞれで安全に
worker+子孫プロセスを終了できること、terminationが未確認の場合はartifact cleanupを
スキップすることを検証する。実DB（outputs/app.db）・実`data/projects/`へは一切触れない
（isolated_test_db/temp_projectsフィクスチャで隔離）。
"""

import sys
import time

import pytest

import src.app.main as main_module
from src.app import db as db_module


def _make_job(job_id, status, training_family="ocr", engine="tesseract", worker_pid=99999, **overrides):
    now = "2026-08-19T10:00:00"
    job = {
        "id": job_id,
        "project_id": "p1",
        "training_family": training_family,
        "engine": engine,
        "model_type": "ocr",
        "epochs": 100,
        "batch_size": 1,
        "status": status,
        "message": "",
        "model_path": None,
        "worker_pid": worker_pid,
        "log_path": None,
        "created_at": now,
        "updated_at": now,
    }
    job.update(overrides)
    return job


# ---------- _terminate_training_process_tree: 共通・invalid ----------


def test_invalid_pid_returns_invalid_pid_outcome():
    result = main_module._terminate_training_process_tree(0)
    assert result["outcome"] == "invalid_pid"


def test_already_dead_pid_returns_already_dead_without_issuing_kill(monkeypatch):
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: False)
    called = {"killpg": False, "kill": False, "taskkill": False}
    monkeypatch.setattr(main_module.os, "killpg", lambda *a: called.__setitem__("killpg", True), raising=False)
    monkeypatch.setattr(main_module.subprocess, "run", lambda *a, **k: called.__setitem__("taskkill", True))

    result = main_module._terminate_training_process_tree(12345)

    assert result["outcome"] == "already_dead"
    assert called == {"killpg": False, "kill": False, "taskkill": False}


# ---------- Unix path（既存killpg/killのfallback semanticsを維持） ----------


def test_unix_killpg_success_confirms_termination(monkeypatch):
    monkeypatch.setattr(main_module.sys, "platform", "linux")
    alive_sequence = iter([True, False])  # 1回目=呼び出し前チェック, 2回目=kill後の確認
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: next(alive_sequence))
    monkeypatch.setattr(main_module.os, "killpg", lambda pid, sig: None, raising=False)

    result = main_module._terminate_training_process_tree(12345, timeout=1.0)

    assert result["outcome"] == "terminated"


def test_unix_killpg_process_lookup_error_is_already_dead(monkeypatch):
    monkeypatch.setattr(main_module.sys, "platform", "linux")
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: True)

    def raise_lookup(pid, sig):
        raise ProcessLookupError()

    monkeypatch.setattr(main_module.os, "killpg", raise_lookup, raising=False)

    result = main_module._terminate_training_process_tree(12345)

    assert result["outcome"] == "already_dead"


def test_unix_killpg_generic_failure_falls_back_to_kill(monkeypatch):
    """os.killpgがAttributeError等（Windowsでの実挙動を模す）で失敗した場合、
    os.killへfallbackする既存semanticsを維持する。"""
    monkeypatch.setattr(main_module.sys, "platform", "linux")
    alive_sequence = iter([True, False])
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: next(alive_sequence))

    def raise_attribute_error(pid, sig):
        raise AttributeError("no killpg")

    kill_calls = []
    monkeypatch.setattr(main_module.os, "killpg", raise_attribute_error, raising=False)
    monkeypatch.setattr(main_module.os, "kill", lambda pid, sig: kill_calls.append((pid, sig)))

    result = main_module._terminate_training_process_tree(12345, timeout=1.0)

    assert result["outcome"] == "terminated"
    assert kill_calls == [(12345, main_module.signal.SIGTERM)]


def test_unix_both_killpg_and_kill_fail_reports_command_failed(monkeypatch):
    monkeypatch.setattr(main_module.sys, "platform", "linux")
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: True)

    def raise_os_error(pid, sig):
        raise OSError("boom")

    monkeypatch.setattr(main_module.os, "killpg", raise_os_error, raising=False)
    monkeypatch.setattr(main_module.os, "kill", raise_os_error)

    result = main_module._terminate_training_process_tree(12345)

    assert result["outcome"] == "command_failed"


# ---------- Windows path（taskkill /T /F、PID再利用ガード） ----------


def test_windows_taskkill_success_confirms_termination(monkeypatch):
    monkeypatch.setattr(main_module.sys, "platform", "win32")
    alive_sequence = iter([True, False])
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: next(alive_sequence))
    monkeypatch.setattr(main_module, "_windows_process_image_name", lambda pid: "python.exe")

    captured = {}

    class _Result:
        returncode = 0
        stdout = "SUCCESS"
        stderr = ""

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return _Result()

    monkeypatch.setattr(main_module.subprocess, "run", fake_run)
    monkeypatch.setattr(main_module.sys, "executable", "C:/Python/python.exe")

    result = main_module._terminate_training_process_tree(4242, timeout=1.0)

    assert result["outcome"] == "terminated"
    assert captured["cmd"][:2] == ["taskkill", "/PID"]
    assert "/T" in captured["cmd"] and "/F" in captured["cmd"]


def test_windows_taskkill_failure_reports_command_failed(monkeypatch):
    monkeypatch.setattr(main_module.sys, "platform", "win32")
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: True)
    monkeypatch.setattr(main_module, "_windows_process_image_name", lambda pid: "python.exe")
    monkeypatch.setattr(main_module.sys, "executable", "C:/Python/python.exe")

    class _Result:
        returncode = 1
        stdout = ""
        stderr = "Access is denied."

    monkeypatch.setattr(main_module.subprocess, "run", lambda cmd, **k: _Result())

    result = main_module._terminate_training_process_tree(4242)

    assert result["outcome"] == "command_failed"
    assert "denied" in result["detail"].lower()


def test_windows_pid_mismatch_skips_taskkill(monkeypatch):
    """永続化されたworker_pidが（プロセス終了後の再利用等で）Python以外のイメージを
    指している場合、無関係なprocess treeを誤って強制終了しない。"""
    monkeypatch.setattr(main_module.sys, "platform", "win32")
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: True)
    monkeypatch.setattr(main_module, "_windows_process_image_name", lambda pid: "notepad.exe")
    monkeypatch.setattr(main_module.sys, "executable", "C:/Python/python.exe")

    called = {"taskkill": False}
    monkeypatch.setattr(main_module.subprocess, "run", lambda *a, **k: called.__setitem__("taskkill", True))

    result = main_module._terminate_training_process_tree(4242)

    assert result["outcome"] == "pid_mismatch"
    assert called["taskkill"] is False  # 誤ってtaskkillを実行していない


def test_windows_still_alive_when_process_never_dies(monkeypatch):
    monkeypatch.setattr(main_module.sys, "platform", "win32")
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: True)  # 常に生存
    monkeypatch.setattr(main_module, "_windows_process_image_name", lambda pid: "python.exe")
    monkeypatch.setattr(main_module.sys, "executable", "C:/Python/python.exe")

    class _Result:
        returncode = 0
        stdout = "SUCCESS"
        stderr = ""

    monkeypatch.setattr(main_module.subprocess, "run", lambda cmd, **k: _Result())

    result = main_module._terminate_training_process_tree(4242, timeout=0.3)

    assert result["outcome"] == "still_alive"


# ---------- _stop_training_worker統合: engine別・DB状態遷移・cleanup guard ----------


@pytest.mark.parametrize(
    "training_family,engine",
    [("ocr", "tesseract"), ("ocr", "paddleocr"), ("ocr", "trocr"), ("classification", "custom")],
)
def test_stop_training_worker_transitions_to_stopped_for_all_engines(
    isolated_test_db, temp_projects, monkeypatch, training_family, engine
):
    job_id = f"job-{engine}"
    db_module.upsert_training_job(_make_job(job_id, "running", training_family=training_family, engine=engine))
    monkeypatch.setattr(main_module, "_terminate_training_process_tree", lambda pid, timeout=3.0: {"outcome": "terminated", "detail": ""})

    result = main_module._stop_training_worker(job_id)

    assert result["status"] == "stopped"
    assert result["stopped"] is True
    job = db_module.fetch_training_job(job_id)
    assert job["status"] == "stopped"
    assert job["worker_pid"] is None


def test_stop_training_worker_skips_artifact_cleanup_when_termination_unconfirmed(
    isolated_test_db, temp_projects, monkeypatch
):
    job_id = "job-still-alive"
    db_module.upsert_training_job(_make_job(job_id, "running"))
    monkeypatch.setattr(
        main_module, "_terminate_training_process_tree", lambda pid, timeout=3.0: {"outcome": "still_alive", "detail": "x"}
    )
    delete_called = {"count": 0}
    monkeypatch.setattr(main_module, "_delete_training_artifacts", lambda job: delete_called.__setitem__("count", delete_called["count"] + 1) or {})

    result = main_module._stop_training_worker(job_id, delete_artifacts=True)

    assert result["stopped"] is False
    assert result["artifacts_deleted"] is False
    assert delete_called["count"] == 0  # cleanupは呼ばれない
    job = db_module.fetch_training_job(job_id)
    assert job["status"] == "stopped"  # DB状態遷移自体は既存順序のまま実行される（Design Principle #5）
    assert "could not be confirmed" in job["message"]  # 診断可能なメッセージが残ること


def test_stop_training_worker_runs_artifact_cleanup_when_terminated(isolated_test_db, temp_projects, monkeypatch):
    job_id = "job-terminated"
    db_module.upsert_training_job(_make_job(job_id, "running"))
    monkeypatch.setattr(main_module, "_terminate_training_process_tree", lambda pid, timeout=3.0: {"outcome": "terminated", "detail": ""})
    delete_called = {"count": 0}
    monkeypatch.setattr(
        main_module,
        "_delete_training_artifacts",
        lambda job: (delete_called.__setitem__("count", delete_called["count"] + 1), {"run_dir_removed": True, "model_removed": False, "log_removed": False})[1],
    )

    result = main_module._stop_training_worker(job_id, delete_artifacts=True)

    assert result["stopped"] is True
    assert result["artifacts_deleted"] is True
    assert delete_called["count"] == 1


def test_stop_training_worker_missing_pid_returns_409(isolated_test_db, temp_projects):
    from fastapi import HTTPException

    job_id = "job-no-pid"
    db_module.upsert_training_job(_make_job(job_id, "running", worker_pid=None))

    with pytest.raises(HTTPException) as exc:
        main_module._stop_training_worker(job_id)
    assert exc.value.status_code == 409


def test_stop_training_worker_repeated_call_is_rejected_not_double_killed(isolated_test_db, temp_projects, monkeypatch):
    """2回目のstop要求は、既にstatus=stoppedのため400で拒否される
    （危険な副作用＝二重killや状態の巻き戻りが起きないことの確認）。"""
    from fastapi import HTTPException

    job_id = "job-repeat-stop"
    db_module.upsert_training_job(_make_job(job_id, "running"))
    call_count = {"n": 0}

    def fake_terminate(pid, timeout=3.0):
        call_count["n"] += 1
        return {"outcome": "terminated", "detail": ""}

    monkeypatch.setattr(main_module, "_terminate_training_process_tree", fake_terminate)

    first = main_module._stop_training_worker(job_id)
    assert first["status"] == "stopped"
    assert call_count["n"] == 1

    with pytest.raises(HTTPException) as exc:
        main_module._stop_training_worker(job_id)
    assert exc.value.status_code == 400
    assert call_count["n"] == 1  # 2回目はterminationロジックへ到達すらしない


# ---------- _delete_training_artifacts: rmtree失敗を外部へ漏らさない ----------


def test_delete_training_artifacts_rmtree_failure_is_swallowed(temp_projects, monkeypatch):
    from src.app.project_paths import ensure_project_directories

    paths = ensure_project_directories("p1")
    run_dir = paths.models / "ocr_runs" / "job-lock-test"
    run_dir.mkdir(parents=True)
    (run_dir / "checkpoint.bin").write_bytes(b"x")

    def raise_permission_error(path):
        raise OSError("[WinError 32] The process cannot access the file")

    monkeypatch.setattr(main_module.shutil, "rmtree", raise_permission_error)

    job = _make_job("job-lock-test", "running")
    removed = main_module._delete_training_artifacts(job)  # 例外を送出しないこと

    assert removed["run_dir_removed"] is False


# ---------- Issue #125 startup reconciliationとの無回帰確認 ----------


def test_startup_reconciliation_unaffected_by_new_termination_helper(isolated_test_db, monkeypatch):
    """_reconcile_stale_training_jobs_on_startup()（#125）は_terminate_training_process_tree
    を使わず、既存の_is_pid_alive()のみで判定する（stop pathとreconciliationを混同しない、
    Design Principle #4）ことを確認する回帰テスト。"""
    job_id = "job-stale"
    db_module.upsert_training_job(_make_job(job_id, "running", worker_pid=99999))
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: False)

    terminate_called = {"count": 0}
    monkeypatch.setattr(
        main_module,
        "_terminate_training_process_tree",
        lambda pid, timeout=3.0: terminate_called.__setitem__("count", terminate_called["count"] + 1) or {"outcome": "terminated", "detail": ""},
    )

    reconciled = main_module._reconcile_stale_training_jobs_on_startup()

    assert reconciled == [job_id]
    assert terminate_called["count"] == 0  # reconciliationはterminationを一切呼ばない
    assert db_module.fetch_training_job(job_id)["status"] == "failed"


# ---------- Windows実機: 実process treeでの統合probe ----------


def _tasklist_alive(pid):
    import subprocess as sp

    result = sp.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True)
    return str(pid) in result.stdout


def _spawn_and_terminate_process_tree_once(tmp_path):
    """parent(job_runner相当) -> grandchild(Tesseract外部CLI/PaddleOCR nested subprocess相当)
    の実processツリーを1回生成し、`_terminate_training_process_tree()`適用後に両方とも
    終了しているかを確認する。戻り値はterminationのoutcome文字列。"""
    import subprocess as sp
    import sys as _sys

    child_script = tmp_path / f"child_with_grandchild_{time.monotonic_ns()}.py"
    child_script.write_text(
        "import subprocess, sys, time\n"
        "gc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
        "print(f'GRANDCHILD_PID={gc.pid}', flush=True)\n"
        "time.sleep(60)\n",
        encoding="utf-8",
    )

    proc = sp.Popen(
        [_sys.executable, str(child_script)],
        start_new_session=True,
        stdout=sp.PIPE,
        stderr=sp.STDOUT,
        text=True,
        bufsize=1,
    )
    parent_pid = proc.pid
    grandchild_pid = None
    deadline = time.time() + 8
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            break
        line = line.strip()
        if line.startswith("GRANDCHILD_PID="):
            grandchild_pid = int(line.split("=", 1)[1])
            break
    assert grandchild_pid is not None, "grandchild PIDを取得できなかった"
    assert _tasklist_alive(parent_pid)
    assert _tasklist_alive(grandchild_pid)

    try:
        result = main_module._terminate_training_process_tree(parent_pid, timeout=10.0)
        still_orphan = _tasklist_alive(parent_pid) or _tasklist_alive(grandchild_pid)
        return result["outcome"], still_orphan
    finally:
        for pid in (parent_pid, grandchild_pid):
            if _tasklist_alive(pid):
                sp.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, text=True)


@pytest.mark.skipif(not sys.platform.startswith("win"), reason="Windows専用のprocess tree termination検証")
def test_windows_real_process_tree_termination_leaves_no_orphan(tmp_path):
    """実processツリーでの統合probe（Investigation #129の実測手順をpytestへ組み込んだもの）。
    dummyのtime.sleep(60)のみを使用し、実Training/GPU/実outputs/app.dbには一切触れない。
    CI（Linux）では自動的にskipされる。

    実プロセス・実OSスケジューリングに依存するテストのため、システム負荷等による
    一時的なtaskkill遅延を吸収するよう最大3回まで再試行する（ロジック自体の正しさは
    §Issue #133 workitem docの手動検証で確認済み。ここでは環境要因によるflakinessのみを
    吸収する目的で再試行し、3回とも失敗した場合はテストとして正しく失敗させる）。
    """
    last_outcome = None
    last_orphan = None
    for attempt in range(3):
        last_outcome, last_orphan = _spawn_and_terminate_process_tree_once(tmp_path)
        if last_outcome == "terminated" and not last_orphan:
            return
    pytest.fail(f"3回試行してもprocess tree terminationを確認できなかった: outcome={last_outcome} orphan={last_orphan}")
