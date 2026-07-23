"""Job Management（バックグラウンドジョブ管理）のテスト。

- Job ID採番（JOB-000001形式・システム全体で一意）と保存項目
- 状態遷移の検証（不正遷移=succeeded→running等の拒否）
- 同時実行制御（学習=全体1件 / 前処理=同一プロジェクト1件 / 評価=同一モデル重複防止 /
  benchmark=設定可能な同時数）と重複時の既存Job返却（統一仕様）
- キャンセル（running→cancel_requested→cancelled。queuedは即時取消）
- 再実行（同一入力条件・retry_source_job_id保存）
- 実行（成功・失敗時の内部ログ・進捗イベント）
"""

import numpy as np
import pytest
from PIL import Image

from src.app.services.job_manager import (
    JOB_HANDLERS,
    JobCancelled,
    JobService,
    JobWorker,
)


@pytest.fixture()
def service(temp_projects):
    return JobService()


def test_job_id_sequence_and_fields(service):
    job1, dup1 = service.create_job("p1", "preprocess", {"project_id": "p1"}, requested_by="hashimoto")
    job2, _ = service.create_job("p2", "evaluation", {"project_id": "p2", "targets": [{"model": "m.tess.json"}]})
    assert job1["job_id"] == "JOB-000001"
    assert job2["job_id"] == "JOB-000002"  # プロジェクトをまたいでシステム全体で一意
    assert dup1 is False
    for key in [
        "project_id",
        "job_type",
        "status",
        "requested_by",
        "created_at",
        "started_at",
        "finished_at",
        "progress",
        "current_step",
        "message",
        "params",
        "result_summary",
        "error_summary",
        "related_experiment_id",
        "related_model_id",
        "related_benchmark_id",
        "retry_source_job_id",
        "cancellation_requested_at",
    ]:
        assert key in job1, f"保存項目 {key} がない"
    assert job1["status"] == "queued"
    assert job1["requested_by"] == "hashimoto"


def test_invalid_transitions_rejected(service):
    job, _ = service.create_job("p1", "preprocess", {})
    job_id = job["job_id"]
    service.transition(job_id, "running")
    service.transition(job_id, "succeeded")
    with pytest.raises(ValueError, match="invalid status transition"):
        service.transition(job_id, "running")  # succeeded→running は禁止
    with pytest.raises(ValueError, match="invalid status transition"):
        service.transition(job_id, "queued")


def test_concurrency_training_global_single(service):
    first, dup1 = service.create_job("p1", "training", {"dataset_dir": "x"})
    second, dup2 = service.create_job("p2", "training", {"dataset_dir": "y"})  # 別プロジェクトでも学習は全体1件
    assert dup1 is False
    assert dup2 is True
    assert second["job_id"] == first["job_id"]  # 既存Job IDを返す


def test_concurrency_preprocess_per_project(service):
    first, _ = service.create_job("p1", "preprocess", {})
    same_project, dup_same = service.create_job("p1", "preprocess", {})
    other_project, dup_other = service.create_job("p2", "preprocess", {})
    assert dup_same is True and same_project["job_id"] == first["job_id"]
    assert dup_other is False  # 別プロジェクトは並行可


def test_concurrency_evaluation_same_model(service):
    params = {"targets": [{"model": "a.tess.json"}, {"model": "eng"}]}
    first, _ = service.create_job("p1", "evaluation", dict(params))
    dup, is_dup = service.create_job("p1", "evaluation", {"targets": [{"model": "a.tess.json"}]})
    assert is_dup is True and dup["job_id"] == first["job_id"]  # 同一モデルの評価重複を防止
    other, is_dup2 = service.create_job("p1", "evaluation", {"targets": [{"model": "b.tess.json"}]})
    assert is_dup2 is False  # 別モデルは可


def test_cancel_flow(service):
    # queued: 即時取消（cancel_requested→cancelledまで完了）
    queued, _ = service.create_job("p1", "dataset_creation", {})
    cancelled = service.request_cancel(queued["job_id"])
    assert cancelled["status"] == "cancelled"
    # running: cancel_requestedで留まり、ハンドラのキャンセルポイントでcancelledへ
    running, _ = service.create_job("p1", "preprocess", {})
    service.transition(running["job_id"], "running")
    requested = service.request_cancel(running["job_id"])
    assert requested["status"] == "cancel_requested"
    assert requested["cancellation_requested_at"]
    done = service.transition(running["job_id"], "cancelled")
    assert done["status"] == "cancelled"
    with pytest.raises(ValueError):
        service.request_cancel(running["job_id"])  # 完了後はキャンセル不可


def test_retry_creates_new_job_with_source(service):
    job, _ = service.create_job("p1", "preprocess", {"project_id": "p1", "overrides": {"x": 1}}, requested_by="a")
    service.transition(job["job_id"], "running")
    service.transition(job["job_id"], "failed", {"error_summary": "boom"})
    retried, dup = service.retry_job(job["job_id"], requested_by="b")
    assert dup is False
    assert retried["retry_source_job_id"] == job["job_id"]
    assert retried["params"] == job["params"]  # 同一入力条件
    assert retried["requested_by"] == "b"
    # 実行中Jobの再実行は拒否
    with pytest.raises(ValueError):
        service.retry_job(retried["job_id"])


def test_execute_success_failure_and_events(service, monkeypatch):
    calls = {}

    def fake_handler(params, ctx):
        calls["params"] = params
        ctx.update(50, "処理中", "半分")
        return {"ok": True}

    def failing_handler(params, ctx):
        raise RuntimeError("内部エラーの詳細")

    monkeypatch.setitem(JOB_HANDLERS, "preprocess", fake_handler)
    monkeypatch.setitem(JOB_HANDLERS, "dataset_creation", failing_handler)

    ok, _ = service.create_job("p1", "preprocess", {"a": 1})
    done = service.execute_job(ok["job_id"])
    assert done["status"] == "succeeded"
    assert done["progress"] == 100
    assert done["result_summary"] == {"ok": True}
    events = service.repository.read_events(ok["job_id"])
    assert any(e.get("type") == "progress" and e.get("step") == "処理中" for e in events)
    assert [e["status"] for e in events if e.get("type") == "status"] == ["queued", "running", "succeeded"]

    ng, _ = service.create_job("p1", "dataset_creation", {})
    failed = service.execute_job(ng["job_id"])
    assert failed["status"] == "failed"
    assert "内部エラーの詳細" in failed["error_summary"]
    # スタックトレースは内部ログへ（画面用フィールドには含めない）
    assert "Traceback" not in failed["error_summary"]


def test_cancel_during_execution(service, monkeypatch):
    def cancellable_handler(params, ctx):
        ctx.update(30, "工程1")
        # 工程間のキャンセルポイント（安全に中断できる区間）
        service.request_cancel(ctx.job_id)
        ctx.check_cancelled()
        return {"ok": True}

    monkeypatch.setitem(JOB_HANDLERS, "preprocess", cancellable_handler)
    job, _ = service.create_job("p1", "preprocess", {})
    done = service.execute_job(job["job_id"])
    assert done["status"] == "cancelled"


def test_worker_process_next_and_real_preprocess(temp_projects):
    """Workerが実ハンドラ（前処理）で完走する統合テスト。"""
    service = JobService()
    raw = temp_projects["projects_dir"] / "p_job" / "raw"
    raw.mkdir(parents=True)
    Image.fromarray(np.full((32, 96), 200, dtype=np.uint8), mode="L").save(raw / "img.png")
    job, _ = service.create_job("p_job", "preprocess", {"project_id": "p_job"})
    worker = JobWorker(service)
    assert worker.process_next() == job["job_id"]
    done = service.repository.get(job["job_id"])
    assert done["status"] == "succeeded"
    assert done["result_summary"]["processed_count"] == 1
    assert done["result_summary"]["preprocess_hash"].startswith("sha256:")
    assert worker.process_next() is None  # キューが空


def test_benchmark_concurrency_config(service):
    assert service.repository.get_config("benchmark_concurrency", 1) == 1
    service.repository.set_config("benchmark_concurrency", 2)
    assert service.repository.get_config("benchmark_concurrency", 1) == 2


def test_list_jobs_filters(service):
    a, _ = service.create_job("p1", "preprocess", {}, requested_by="alice")
    service.transition(a["job_id"], "running")
    service.transition(a["job_id"], "succeeded")
    service.create_job("p2", "training", {}, requested_by="bob")
    assert len(service.list_jobs()) == 2
    assert [j["job_id"] for j in service.list_jobs(project_id="p1")] == [a["job_id"]]
    assert len(service.list_jobs(job_type="training")) == 1
    assert len(service.list_jobs(status="succeeded")) == 1
    assert len(service.list_jobs(requested_by="ali")) == 1
