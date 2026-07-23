"""再起動復旧（interrupted）・原子的書き込み・ID採番の競合安全性のテスト。"""

import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.atomic_io import atomic_write_json, file_lock
from src.app.services.job_manager import (
    JobService,
    JobWorker,
    recover_interrupted_jobs,
)


# ---------- §2 再起動復旧 ----------


def test_recover_interrupted_jobs_four_scenarios(temp_projects):
    """queued/running/cancel_requested/完了直後 の4状態での再起動復旧を検証する。"""
    service = JobService()
    queued, _ = service.create_job("p1", "preprocess", {})
    running, _ = service.create_job("p2", "dataset_creation", {})
    service.transition(running["job_id"], "running")
    cancel_req, _ = service.create_job("p1", "training", {})
    service.transition(cancel_req["job_id"], "running")
    service.request_cancel(cancel_req["job_id"])
    done, _ = service.create_job("p1", "evaluation", {"targets": [{"model": "m"}]})
    service.transition(done["job_id"], "running")
    service.transition(done["job_id"], "succeeded")

    # Backend再起動を模擬（新しいService=新プロセスで復旧処理を実行）
    recovered = recover_interrupted_jobs(JobService())
    assert set(recovered) == {running["job_id"], cancel_req["job_id"]}

    after = {j["job_id"]: j for j in JobService().repository.list()}
    assert after[queued["job_id"]]["status"] == "queued"  # queuedはWorker再開でそのまま実行される
    assert after[running["job_id"]]["status"] == "interrupted"  # 永続running表示のまま残らない
    assert after[cancel_req["job_id"]]["status"] == "interrupted"
    assert after[done["job_id"]]["status"] == "succeeded"  # 完了直後の再起動は影響なし
    assert "再実行で復旧" in after[running["job_id"]]["message"]
    # 冪等（2回目の復旧で対象なし）
    assert recover_interrupted_jobs(JobService()) == []


def test_interrupted_job_can_be_retried(temp_projects):
    service = JobService()
    job, _ = service.create_job("p1", "preprocess", {"project_id": "p1", "overrides": {"x": 1}})
    service.transition(job["job_id"], "running")
    recover_interrupted_jobs(service)
    interrupted = service.repository.get(job["job_id"])
    assert interrupted["status"] == "interrupted"
    # UIの再実行と同じ経路: 同一入力条件で新規Job
    retried, dup = service.retry_job(job["job_id"])
    assert dup is False
    assert retried["retry_source_job_id"] == job["job_id"]
    assert retried["params"] == job["params"]
    # interrupted は終端状態（キャンセル不可・再遷移不可）
    with pytest.raises(ValueError):
        service.request_cancel(job["job_id"])
    with pytest.raises(ValueError):
        service.transition(job["job_id"], "running")


def test_worker_start_triggers_recovery(temp_projects):
    service = JobService()
    job, _ = service.create_job("p1", "preprocess", {})
    service.transition(job["job_id"], "running")
    worker = JobWorker(service)
    worker.start()
    try:
        assert service.repository.get(job["job_id"])["status"] == "interrupted"
    finally:
        worker.stop()


# ---------- §3 原子的書き込み ----------


def test_atomic_write_json_no_partial_and_no_tmp_left(tmp_path):
    target = tmp_path / "registry.json"
    atomic_write_json(target, {"counter": 1, "items": [1, 2, 3]})
    assert json.loads(target.read_text(encoding="utf-8"))["counter"] == 1
    atomic_write_json(target, {"counter": 2, "items": []})
    assert json.loads(target.read_text(encoding="utf-8"))["counter"] == 2
    # 一時ファイルが残らない
    assert [p.name for p in tmp_path.iterdir()] == ["registry.json"]


def test_file_lock_reentrant_and_mutual_exclusion(tmp_path):
    target = tmp_path / "x.json"
    # 同一スレッドの再入（ネスト）でデッドロックしない
    with file_lock(target):
        with file_lock(target):
            atomic_write_json(target, {"ok": True})
    # 排他: 2スレッドで交互にカウントアップしてもロスト更新しない
    atomic_write_json(target, {"n": 0})

    def bump(_):
        with file_lock(target):
            data = json.loads(target.read_text(encoding="utf-8"))
            data["n"] += 1
            atomic_write_json(target, data)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(bump, range(50)))
    assert json.loads(target.read_text(encoding="utf-8"))["n"] == 50


# ---------- §5 ID採番の競合安全性 ----------


def test_concurrent_id_allocation_unique(temp_projects):
    """JOB / EXP / BM(カウンタ) / REL / AUD / 管理No を同時採番して一意性を確認する。"""
    from src.app.services.audit_log import record_audit
    from src.app.services.backup_manager import create_backup
    from src.app.services.experiment_tracker import record_experiment
    from src.app.services.model_registry import assign_model_ids
    from src.app.services.release_manager import promote_model

    paths = ensure_project_directories("p_ids")
    service = JobService()

    # JOB: 種別・プロジェクトを分けて重複排除に該当しない20件を同時作成
    def make_job(i):
        return service.create_job(f"pj{i}", "preprocess", {"i": i})[0]["job_id"]

    with ThreadPoolExecutor(max_workers=8) as pool:
        job_ids = list(pool.map(make_job, range(20)))
    assert len(set(job_ids)) == 20

    # EXP
    def make_exp(i):
        return record_experiment("p_ids", {"models": [f"m{i}.tess.json"]})["experiment_id"]

    with ThreadPoolExecutor(max_workers=8) as pool:
        exp_ids = list(pool.map(make_exp, range(20)))
    assert len(set(exp_ids)) == 20

    # AUD
    def make_aud(i):
        return record_audit("project_create", user=f"u{i}", project_id="p_ids", target_id=f"t{i}")["audit_id"]

    with ThreadPoolExecutor(max_workers=8) as pool:
        aud_ids = list(pool.map(make_aud, range(20)))
    assert len(set(aud_ids)) == 20

    # REL: モデルを用意して同時promote（release_id一意＋Productionは1件のみ）
    for i in range(6):
        (paths.models / f"rel{i}.tess.json").write_text("{}", encoding="utf-8")

    def do_promote(i):
        return promote_model("p_ids", f"rel{i}.tess.json", note=f"r{i}")["entry"]["release_id"]

    with ThreadPoolExecutor(max_workers=6) as pool:
        rel_ids = list(pool.map(do_promote, range(6)))
    assert len(set(rel_ids)) == 6
    from src.app.services.release_manager import list_releases

    statuses = list_releases("p_ids")["statuses"]
    assert sum(1 for r in statuses.values() if r["status"] == "Production") == 1  # Production複数化しない

    # BK（バックアップID）
    def make_backup(_):
        return create_backup("p_ids", mode="metadata_only")["backup_id"]

    with ThreadPoolExecutor(max_workers=4) as pool:
        bk_ids = list(pool.map(make_backup, range(6)))
    assert len(set(bk_ids)) == 6

    # 管理No: 同時assignでも同一モデルへ同一番号・番号重複なし
    items = [{"name": f"m{i}.tess.json", "created_at": f"2026-07-0{i % 9 + 1}"} for i in range(10)]

    def assign(_):
        local = [dict(item) for item in items]
        assign_model_ids("p_ids", local)
        return [row["model_id"] for row in local]

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(assign, range(6)))
    first = results[0]
    assert len(set(first)) == 10
    assert all(r == first for r in results)  # 全スレッドで同一の割当


# ---------- §4 二重実行・競合 ----------


def test_concurrent_duplicate_job_creation(temp_projects):
    """同一プロジェクト前処理の連続クリック相当: 新規Jobは1件のみ。"""
    service = JobService()
    results = []
    barrier = threading.Barrier(8)

    def create(_):
        barrier.wait()
        job, dedup = service.create_job("p1", "preprocess", {"project_id": "p1"})
        results.append((job["job_id"], dedup))

    threads = [threading.Thread(target=create, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    unique_ids = {job_id for job_id, _ in results}
    assert len(unique_ids) == 1  # 全員が同じJob IDを受け取る（二重採番なし）
    assert sum(1 for _, dedup in results if not dedup) == 1  # 新規作成は1件だけ


def test_concurrent_evaluation_same_model(temp_projects):
    service = JobService()
    params = {"targets": [{"model": "a.tess.json"}]}
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: service.create_job("p1", "evaluation", dict(params)), range(6)))
    assert len({job["job_id"] for job, _ in results}) == 1
    assert sum(1 for _, dedup in results if not dedup) == 1
