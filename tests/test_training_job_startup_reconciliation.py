"""Training Job起動時reconciliation（Issue #125、Architecture Investigation #123）のテスト。

`_reconcile_stale_training_jobs_on_startup()`が、queued/runningのまま残った
Tesseract/PaddleOCR/TrOCR/Classification各engineのjobを、worker_pidの生死に基づき
安全にstaleと判断できることを検証する。実DB（outputs/app.db）へは一切触れない
（isolated_test_dbフィクスチャ、Issue #8）。
"""

import pytest

import src.app.main as main_module
from src.app import db as db_module


def _make_job(job_id, status, training_family="ocr", engine="tesseract", worker_pid=None, **overrides):
    now = "2026-08-18T10:00:00"
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
        "created_at": now,
        "updated_at": now,
    }
    job.update(overrides)
    return job


def _fetch(job_id):
    return db_module.fetch_training_job(job_id)


# ---- engine別のstale reconciliation（Tesseract/TrOCR/Classification: 既存のengine別
# reconciliationを持たないため、本関数が唯一のreconciliation経路） ----


@pytest.mark.parametrize(
    "training_family,engine",
    [
        ("ocr", "tesseract"),
        ("ocr", "trocr"),
        ("classification", "custom"),
    ],
)
def test_stale_running_job_marked_failed_when_worker_pid_dead(isolated_test_db, monkeypatch, training_family, engine):
    job_id = f"job-{engine}"
    db_module.upsert_training_job(
        _make_job(job_id, "running", training_family=training_family, engine=engine, worker_pid=99999)
    )
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: False)

    reconciled = main_module._reconcile_stale_training_jobs_on_startup()

    assert reconciled == [job_id]
    job = _fetch(job_id)
    assert job["status"] == "failed"
    assert "startup reconciliation" in job["message"]
    assert job["worker_pid"] is None


@pytest.mark.parametrize(
    "training_family,engine",
    [
        ("ocr", "tesseract"),
        ("ocr", "trocr"),
        ("classification", "custom"),
    ],
)
def test_missing_worker_pid_is_treated_as_stale(isolated_test_db, monkeypatch, training_family, engine):
    """spawn前にcrashした等でworker_pidが記録されていないqueued jobも安全にstale判定する。"""
    job_id = f"job-nopid-{engine}"
    db_module.upsert_training_job(
        _make_job(job_id, "queued", training_family=training_family, engine=engine, worker_pid=None)
    )
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: False)

    reconciled = main_module._reconcile_stale_training_jobs_on_startup()

    assert reconciled == [job_id]
    assert _fetch(job_id)["status"] == "failed"


@pytest.mark.parametrize(
    "training_family,engine",
    [
        ("ocr", "tesseract"),
        ("ocr", "trocr"),
        ("classification", "custom"),
    ],
)
def test_alive_worker_pid_is_left_running(isolated_test_db, monkeypatch, training_family, engine):
    """workerがサーバ再起動をまたいで実在する場合はstatusを変更しない。"""
    job_id = f"job-alive-{engine}"
    db_module.upsert_training_job(
        _make_job(job_id, "running", training_family=training_family, engine=engine, worker_pid=12345)
    )
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: pid == 12345)

    reconciled = main_module._reconcile_stale_training_jobs_on_startup()

    assert reconciled == []
    job = _fetch(job_id)
    assert job["status"] == "running"
    assert job["worker_pid"] == 12345


# ---- PaddleOCR既存挙動の無回帰 ----


def test_paddleocr_existing_reconciliation_is_reused_unchanged(isolated_test_db, monkeypatch):
    """PaddleOCR（training_family=ocr, engine!=tesseract/trocr）は既存の
    `_reconcile_ocr_training_job()`をそのまま先に適用する。exportが見つかれば
    completedへ確定し、本関数のfailedへの補正は発生しない。"""
    job_id = "job-paddleocr"
    db_module.upsert_training_job(
        _make_job(job_id, "running", training_family="ocr", engine="paddleocr", worker_pid=99999)
    )
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: False)
    monkeypatch.setattr(
        main_module,
        "_reconcile_ocr_training_job",
        lambda jid: {**_fetch(jid), "status": "completed", "message": "ocr training completed"},
    )

    reconciled = main_module._reconcile_stale_training_jobs_on_startup()

    assert reconciled == []  # 既存reconciliationで解決済み、本関数によるfailed補正は不要
    assert _fetch(job_id)["status"] == "running"  # モック内ではDBを更新していないため元の値のまま


def test_paddleocr_residual_gap_still_covered_by_fallback(isolated_test_db, monkeypatch):
    """既存の`_reconcile_ocr_training_job()`が非terminalのまま返す残余ケース
    （チェックポイント未生成のままworkerが死んだ場合等）でも、本関数のfallbackにより
    staleと判定できる（Issue #123で確認したreliability gapの解消）。"""
    job_id = "job-paddleocr-gap"
    db_module.upsert_training_job(
        _make_job(job_id, "running", training_family="ocr", engine="paddleocr", worker_pid=99999)
    )
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: False)
    monkeypatch.setattr(main_module, "_reconcile_ocr_training_job", lambda jid: _fetch(jid))

    reconciled = main_module._reconcile_stale_training_jobs_on_startup()

    assert reconciled == [job_id]
    assert _fetch(job_id)["status"] == "failed"


# ---- Terminal state safety ----


@pytest.mark.parametrize("status", ["completed", "failed", "stopped"])
def test_terminal_jobs_are_untouched(isolated_test_db, monkeypatch, status):
    job_id = f"job-{status}"
    db_module.upsert_training_job(_make_job(job_id, status, worker_pid=99999))
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: False)

    reconciled = main_module._reconcile_stale_training_jobs_on_startup()

    assert reconciled == []
    job = _fetch(job_id)
    assert job["status"] == status
    assert job["worker_pid"] == 99999  # 変更されていないこと


# ---- Idempotency ----


def test_reconciliation_is_idempotent(isolated_test_db, monkeypatch):
    job_id = "job-idempotent"
    db_module.upsert_training_job(_make_job(job_id, "running", worker_pid=99999))
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: False)

    first = main_module._reconcile_stale_training_jobs_on_startup()
    second = main_module._reconcile_stale_training_jobs_on_startup()

    assert first == [job_id]
    assert second == []  # 既にfailedのため2回目は対象外
    assert _fetch(job_id)["status"] == "failed"


# ---- 無関係のjobは触らない ----


def test_unrelated_jobs_untouched(isolated_test_db, monkeypatch):
    stale_id = "job-stale"
    other_running_id = "job-other-running"
    completed_id = "job-other-completed"
    db_module.upsert_training_job(_make_job(stale_id, "running", worker_pid=99999))
    db_module.upsert_training_job(
        _make_job(other_running_id, "running", worker_pid=12345, project_id="p2", engine="paddleocr")
    )
    db_module.upsert_training_job(_make_job(completed_id, "completed", worker_pid=None, project_id="p3"))
    monkeypatch.setattr(main_module, "_is_pid_alive", lambda pid: pid == 12345)
    monkeypatch.setattr(main_module, "_reconcile_ocr_training_job", lambda jid: _fetch(jid))

    reconciled = main_module._reconcile_stale_training_jobs_on_startup()

    assert reconciled == [stale_id]
    assert _fetch(other_running_id)["status"] == "running"
    assert _fetch(completed_id)["status"] == "completed"


# ---- application startup統合 ----


def test_on_startup_invokes_reconciliation_when_worker_autostart_enabled(monkeypatch, tmp_path):
    """OCRC_DISABLE_WORKER_AUTOSTARTが未設定の場合、on_startup()が
    `_reconcile_stale_training_jobs_on_startup()`を呼び出すことを確認する
    （実データへは一切触れず、呼び出しの発生自体のみをモックで検証する）。"""
    monkeypatch.delenv("OCRC_DISABLE_WORKER_AUTOSTART", raising=False)
    monkeypatch.setattr(main_module, "ensure_directories", lambda: None)
    monkeypatch.setattr(main_module, "init_db", lambda: None)

    called = {"count": 0}
    monkeypatch.setattr(main_module, "_reconcile_stale_training_jobs_on_startup", lambda: (called.__setitem__("count", called["count"] + 1) or []))

    # System B（job_manager）側のWorker起動・復旧は本Issueのスコープ外のためno-op化する
    monkeypatch.setattr(main_module, "ensure_worker_started", lambda: None)
    import src.app.services.job_manager as job_manager_module

    monkeypatch.setattr(job_manager_module, "recover_interrupted_jobs", lambda: [])

    main_module.on_startup()

    assert called["count"] == 1


def test_on_startup_skips_reconciliation_when_worker_autostart_disabled(monkeypatch):
    """既存のテスト隔離規約（OCRC_DISABLE_WORKER_AUTOSTART=1）が設定されている場合、
    reconciliationは呼ばれない（conftest.pyの既存前提を壊さないことの回帰確認）。"""
    monkeypatch.setenv("OCRC_DISABLE_WORKER_AUTOSTART", "1")
    monkeypatch.setattr(main_module, "ensure_directories", lambda: None)
    monkeypatch.setattr(main_module, "init_db", lambda: None)

    called = {"count": 0}
    monkeypatch.setattr(main_module, "_reconcile_stale_training_jobs_on_startup", lambda: (called.__setitem__("count", called["count"] + 1) or []))

    main_module.on_startup()

    assert called["count"] == 0


# ---- list_active_training_jobs (db.py) ----


def test_list_active_training_jobs_spans_projects(isolated_test_db):
    db_module.upsert_training_job(_make_job("j1", "running", project_id="p1"))
    db_module.upsert_training_job(_make_job("j2", "queued", project_id="p2", engine="paddleocr"))
    db_module.upsert_training_job(_make_job("j3", "completed", project_id="p1"))
    db_module.upsert_training_job(_make_job("j4", "stopped", project_id="p3"))

    active_ids = sorted(job["id"] for job in db_module.list_active_training_jobs())

    assert active_ids == ["j1", "j2"]
