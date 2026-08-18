"""JobRepository SQLite移行（Issue #127、Architecture Investigation #123 Theme 3）のテスト。

`tests/test_job_manager.py`等の既存テスト（採番・状態遷移・並行実行制御・キャンセル・
再実行・実行・一覧フィルタ・retention連携）はSQLite移行後も無改修のまま全件パスする
（既存interfaceを維持したままRepositoryの永続化層のみ差し替えたことの回帰確認）。

本ファイルはSQLite移行そのものに関する項目（永続化の再構築確認・legacy jobs.json
importの各シナリオ・malformed入力耐性）を対象にする。実DB（outputs/app.db）・実
`data/jobs/`へは一切触れない（`temp_projects`フィクスチャがPROJECTS_DIR経由で
`_jobs_root()`を自動的に一時領域へ隔離する）。
"""

import json

import pytest

from src.app.services import job_manager as jm
from src.app.services.job_manager import JobRepository, JobService, migrate_legacy_jobs_json


def _legacy_job(job_id, project_id="p1", job_type="preprocess", status="queued", created_at="2026-08-01T00:00:00"):
    return {
        "job_id": job_id,
        "project_id": project_id,
        "job_type": job_type,
        "status": status,
        "created_at": created_at,
    }


# ---------- Repository: 永続化・部分入力耐性 ----------


def test_repository_persists_across_reinstantiation(temp_projects):
    """新しいJobRepositoryインスタンスを作っても、同一PROJECTS_DIR配下のDBファイルを
    読み書きするため、既に保存済みのJobが見える（実ファイルへの永続化を確認）。"""
    repo1 = JobRepository()
    repo1.insert(_legacy_job("JOB-000001"))

    repo2 = JobRepository()
    job = repo2.get("JOB-000001")
    assert job is not None
    assert job["project_id"] == "p1"
    assert job["status"] == "queued"


def test_repository_tolerates_partial_job_dict(temp_projects):
    """テストseedヘルパー等が使う最小限のキーのみのdictも保存・復元できる
    （欠落フィールドは型に応じた既定値になる）。"""
    repo = JobRepository()
    repo.insert(_legacy_job("JOB-000099", job_type="training", status="running"))

    job = repo.get("JOB-000099")
    assert job["job_id"] == "JOB-000099"
    assert job["progress"] == 0
    assert job["params"] == {}
    assert job["result_summary"] is None
    assert job["message"] == ""
    assert job["retry_source_job_id"] == ""


def test_repository_list_order_matches_insertion(temp_projects):
    repo = JobRepository()
    for i in range(1, 4):
        repo.insert(_legacy_job(f"JOB-{i:06d}"))

    ids = [j["job_id"] for j in repo.list()]
    assert ids == ["JOB-000001", "JOB-000002", "JOB-000003"]


def test_repository_update_preserves_untouched_fields(temp_projects):
    service = JobService()
    job, _ = service.create_job("p1", "preprocess", {"a": 1})

    updated = service.repository.update(job["job_id"], {"message": "hello"})

    assert updated["message"] == "hello"
    assert updated["params"] == {"a": 1}  # 更新対象外フィールドは維持される
    assert service.repository.get(job["job_id"])["params"] == {"a": 1}


def test_repository_update_missing_job_raises(temp_projects):
    repo = JobRepository()
    with pytest.raises(FileNotFoundError):
        repo.update("JOB-999999", {"status": "failed"})


def test_repository_result_summary_round_trips_none_and_dict(temp_projects):
    service = JobService()
    job, _ = service.create_job("p1", "preprocess", {})
    assert service.repository.get(job["job_id"])["result_summary"] is None

    service.repository.update(job["job_id"], {"result_summary": {"ok": True, "n": 3}})
    assert service.repository.get(job["job_id"])["result_summary"] == {"ok": True, "n": 3}


def test_repository_get_config_default_and_set_config_round_trip(temp_projects):
    repo = JobRepository()
    assert repo.get_config("benchmark_concurrency", 1) == 1
    repo.set_config("benchmark_concurrency", 4)
    assert repo.get_config("benchmark_concurrency", 1) == 4
    # 別インスタンスでも永続化された値が読める
    assert JobRepository().get_config("benchmark_concurrency", 1) == 4


# ---------- Migration: legacy jobs.json import ----------


def test_migration_noop_when_no_legacy_file(temp_projects):
    repo = JobRepository()
    result = migrate_legacy_jobs_json(repo)
    assert result["status"] == "no_legacy_file"
    assert repo.list() == []


def test_migration_imports_valid_jobs_json(temp_projects):
    jobs_root = jm._jobs_root()
    legacy = {
        "counter": 2,
        "items": [
            _legacy_job("JOB-000001", status="succeeded"),
            _legacy_job("JOB-000002", project_id="p2", job_type="training", status="running", created_at="2026-08-02T00:00:00"),
        ],
        "config": {"benchmark_concurrency": 3},
    }
    (jobs_root / "jobs.json").write_text(json.dumps(legacy), encoding="utf-8")

    repo = JobRepository()
    result = migrate_legacy_jobs_json(repo)

    assert result["status"] == "migrated"
    assert result["imported"] == 2
    assert result["skipped_duplicate"] == 0
    assert repo.get("JOB-000001")["status"] == "succeeded"
    assert repo.get("JOB-000002")["project_id"] == "p2"
    assert repo.get_config("benchmark_concurrency") == 3
    # legacy fileは削除ではなくリネームされる（データ消失防止）
    assert not (jobs_root / "jobs.json").exists()
    assert list(jobs_root.glob("jobs.json.migrated.*"))
    # counterが継承され、次回採番がlegacy counterの続きから始まる（ID衝突防止）
    assert repo.next_id() == "JOB-000003"


def test_migration_idempotent_rerun_does_not_duplicate(temp_projects):
    jobs_root = jm._jobs_root()
    legacy = {"counter": 1, "items": [_legacy_job("JOB-000001")], "config": {}}
    (jobs_root / "jobs.json").write_text(json.dumps(legacy), encoding="utf-8")

    repo = JobRepository()
    first = migrate_legacy_jobs_json(repo)
    assert first["status"] == "migrated"
    assert first["imported"] == 1

    # legacy fileは既にrenameされているため、2回目の起動相当はno-op
    second = migrate_legacy_jobs_json(repo)
    assert second["status"] == "no_legacy_file"
    assert len(repo.list()) == 1


def test_migration_duplicate_job_id_is_skipped_not_overwritten(temp_projects):
    """SQLite側に既に同じjob_idが存在する場合、legacy側の内容で上書きしない
    （重複は既存データを正としてスキップする＝冪等かつ決定的）。"""
    repo = JobRepository()
    repo.insert(_legacy_job("JOB-000001", project_id="p_new", status="succeeded", created_at="2026-08-10T00:00:00"))

    jobs_root = jm._jobs_root()
    legacy = {
        "counter": 1,
        "items": [_legacy_job("JOB-000001", project_id="p_old_should_not_apply", status="queued")],
        "config": {},
    }
    (jobs_root / "jobs.json").write_text(json.dumps(legacy), encoding="utf-8")

    result = migrate_legacy_jobs_json(repo)

    assert result["imported"] == 0
    assert result["skipped_duplicate"] == 1
    assert repo.get("JOB-000001")["project_id"] == "p_new"  # 上書きされていない


def test_migration_malformed_jobs_json_is_backed_up_not_lost(temp_projects):
    jobs_root = jm._jobs_root()
    (jobs_root / "jobs.json").write_text("{not valid json", encoding="utf-8")

    repo = JobRepository()
    result = migrate_legacy_jobs_json(repo)

    assert result["status"] == "malformed_legacy_file_backed_up"
    assert not (jobs_root / "jobs.json").exists()
    backups = list(jobs_root.glob("jobs.json.malformed.*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "{not valid json"  # 内容は無変更のまま保全
    assert repo.list() == []  # データを捏造して取り込まない


def test_migration_empty_items_list_is_valid(temp_projects):
    jobs_root = jm._jobs_root()
    (jobs_root / "jobs.json").write_text(json.dumps({"counter": 0, "items": [], "config": {}}), encoding="utf-8")

    repo = JobRepository()
    result = migrate_legacy_jobs_json(repo)

    assert result["status"] == "migrated"
    assert result["imported"] == 0
    assert repo.list() == []


def test_migration_partially_valid_entries_skips_invalid_shapes(temp_projects):
    """items内に文字列やjob_id欠落等の不正な要素が混在していても、正常な要素だけ取り込む。"""
    jobs_root = jm._jobs_root()
    legacy = {
        "counter": 1,
        "items": [
            "not-a-dict",
            {"project_id": "p1", "job_type": "preprocess", "status": "queued"},  # job_id欠落
            _legacy_job("JOB-000001"),
        ],
        "config": {},
    }
    (jobs_root / "jobs.json").write_text(json.dumps(legacy), encoding="utf-8")

    repo = JobRepository()
    result = migrate_legacy_jobs_json(repo)

    assert result["imported"] == 1
    assert repo.get("JOB-000001") is not None


# ---------- JobWorker.start()経由の統合確認 ----------


def test_worker_start_triggers_migration(temp_projects):
    jobs_root = jm._jobs_root()
    legacy = {"counter": 1, "items": [_legacy_job("JOB-000001", status="succeeded")], "config": {}}
    (jobs_root / "jobs.json").write_text(json.dumps(legacy), encoding="utf-8")

    service = JobService()
    worker = jm.JobWorker(service)
    worker.start()
    try:
        assert service.repository.get("JOB-000001") is not None
        assert not (jobs_root / "jobs.json").exists()
    finally:
        worker.stop()
