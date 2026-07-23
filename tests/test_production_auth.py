"""本番認証制御（allow_unauthenticated_admin=false）・統一エラー形式・監査補完のテスト。"""

import pytest

from src.app.services.audit_log import (
    AuthenticationError,
    UserContext,
    allow_unauthenticated_admin,
    read_audit,
    require_role,
    resolve_user_context,
)


# ---------- §7 認証未設定モードの本番制御 ----------


def test_allow_unauthenticated_admin_env_override(monkeypatch):
    monkeypatch.setenv("OCRC_ALLOW_UNAUTHENTICATED_ADMIN", "false")
    assert allow_unauthenticated_admin() is False
    monkeypatch.setenv("OCRC_ALLOW_UNAUTHENTICATED_ADMIN", "true")
    assert allow_unauthenticated_admin() is True
    monkeypatch.delenv("OCRC_ALLOW_UNAUTHENTICATED_ADMIN")
    assert allow_unauthenticated_admin() is True  # settings.yaml既定=true（開発・移行用）


def test_strict_mode_requires_operator(monkeypatch):
    monkeypatch.setenv("OCRC_ALLOW_UNAUTHENTICATED_ADMIN", "false")
    # X-Operatorなし → 401相当（AuthenticationError）
    ctx = resolve_user_context({})
    assert ctx.strict is True
    with pytest.raises(AuthenticationError, match="X-Operator"):
        require_role(ctx, "preprocess_run")
    # 空のOperator名も禁止
    with pytest.raises(AuthenticationError):
        require_role(resolve_user_context({"x-operator": "   "}), "preprocess_run")
    # 不正なRoleは403相当（PermissionError）
    with pytest.raises(PermissionError, match="不正なロール"):
        require_role(resolve_user_context({"x-operator": "alice", "x-role": "superuser"}), "preprocess_run")
    # ロール未指定はviewer扱い（Admin互換にしない）→ 変更系は403
    ctx_no_role = resolve_user_context({"x-operator": "alice"})
    assert ctx_no_role.role == "viewer"
    with pytest.raises(PermissionError, match="operator 以上"):
        require_role(ctx_no_role, "preprocess_run")
    # 正しいロール指定は許可
    require_role(resolve_user_context({"x-operator": "alice", "x-role": "operator"}), "preprocess_run")
    # UI表示用: 本番モードを明示
    assert "本番認証モード" in ctx.to_dict()["auth_mode"]
    assert ctx.to_dict()["strict"] is True


def test_default_mode_keeps_admin_compat(monkeypatch):
    monkeypatch.delenv("OCRC_ALLOW_UNAUTHENTICATED_ADMIN", raising=False)
    ctx = resolve_user_context({})
    assert ctx.strict is False and ctx.role == "admin"
    require_role(ctx, "project_delete")  # Admin互換（従来動作を維持）


# ---------- §13 統一エラー形式（API層） ----------


@pytest.fixture()
def client(temp_projects):
    from fastapi.testclient import TestClient

    import src.app.main as main_module

    return TestClient(main_module.app, raise_server_exceptions=False)


def test_unified_error_format(client, monkeypatch):
    # Not found（related_id抽出）
    response = client.get("/api/jobs/JOB-999999")
    assert response.status_code == 404
    body = response.json()
    assert body["error_code"] == "NOT_FOUND"
    assert body["related_id"] == "JOB-999999"
    assert "message" in body and "details" in body
    assert "Traceback" not in body["message"]  # スタックトレースを画面へ出さない
    assert body["detail"] == body["message"]  # 旧クライアント互換

    # Validation error
    response = client.post("/api/jobs", json={"project_id": "p1", "job_type": "unknown_type"})
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"

    # Permission error（403）
    response = client.post(
        "/api/releases/status",
        json={"project_id": "p1", "model": "m.tess.json", "status": "Candidate"},
        headers={"X-Operator": "guest", "X-Role": "viewer"},
    )
    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"

    # 本番モード: X-Operatorなしは401 AUTH_REQUIRED
    monkeypatch.setenv("OCRC_ALLOW_UNAUTHENTICATED_ADMIN", "false")
    response = client.post("/preprocess/run", json={"project_id": "p1"})
    assert response.status_code == 401
    assert response.json()["error_code"] == "AUTH_REQUIRED"
    monkeypatch.delenv("OCRC_ALLOW_UNAUTHENTICATED_ADMIN")


def test_release_gate_failed_error_code(client, temp_projects):
    import json as json_module

    from src.app.project_paths import ensure_project_directories
    from src.app.services.experiment_tracker import attach_evaluation, record_experiment
    from src.app.services.release_manager import set_release_policy

    paths = ensure_project_directories("p_err")
    (paths.models / "bad.tess.json").write_text(json_module.dumps({"created_at": "t"}), encoding="utf-8")
    record_experiment("p_err", {"models": ["bad.tess.json"]})
    attach_evaluation("p_err", "bad.tess.json", {"cer": 0.9, "dataset_id": "d", "image_count": 10, "label_count": 10})
    set_release_policy("p_err", {"max_cer": 0.1})
    response = client.post(
        "/api/releases/promote",
        json={"project_id": "p_err", "model": "bad.tess.json", "note": "強行"},
    )
    assert response.status_code == 400
    assert response.json()["error_code"] == "RELEASE_GATE_FAILED"


# ---------- §10 監査補完 ----------


def test_job_finished_audit_recorded(temp_projects, monkeypatch):
    """Job完了（succeeded/failed）がService層で監査記録される（Worker/CLIでも同経路）。"""
    from src.app.services.job_manager import JOB_HANDLERS, JobService

    monkeypatch.setitem(JOB_HANDLERS, "preprocess", lambda params, ctx: {"ok": True})
    monkeypatch.setitem(JOB_HANDLERS, "dataset_creation", lambda params, ctx: (_ for _ in ()).throw(RuntimeError("boom")))
    service = JobService()
    ok, _ = service.create_job("p1", "preprocess", {}, requested_by="alice")
    service.execute_job(ok["job_id"])
    ng, _ = service.create_job("p1", "dataset_creation", {})
    service.execute_job(ng["job_id"])

    finished = read_audit(action="job_finished")
    assert len(finished) == 2
    by_job = {entry["job_id"]: entry for entry in finished}
    assert by_job[ok["job_id"]]["after"]["status"] == "succeeded"
    assert by_job[ok["job_id"]]["user"] == "alice"  # requested_by を引き継ぐ
    assert by_job[ng["job_id"]]["after"]["status"] == "failed"
    assert by_job[ng["job_id"]]["user"] == "system:worker"  # 実行者不明はWorker記録


def test_experiment_update_and_analysis_audit(client, temp_projects):
    from src.app.services.experiment_tracker import record_experiment

    record_experiment("default", {"models": ["m1.tess.json"]})
    response = client.patch(
        "/api/experiments/EXP-0001",
        json={"project_id": "default", "note": "調整メモ", "tags": ["baseline"]},
    )
    assert response.status_code == 200
    response = client.patch("/api/experiments/EXP-0001/analysis", json={"project_id": "default", "enabled": False})
    assert response.status_code == 200
    assert len(read_audit(action="experiment_update")) == 1
    toggles = read_audit(action="analysis_toggle")
    assert len(toggles) == 1 and toggles[0]["after"]["analysis_enabled"] is False


def test_backup_create_and_restore_failed_audit(client, temp_projects):
    response = client.post("/api/backups", json={"project_id": "default", "mode": "metadata_only"})
    assert response.status_code == 200
    assert len(read_audit(action="backup_create")) == 1
    # 存在しないバックアップの復元失敗も監査記録される
    response = client.post("/api/backups/BK-9999/restore", json={})
    assert response.status_code == 404
    failed = read_audit(action="restore_failed")
    assert len(failed) == 1 and failed[0]["target_id"] == "BK-9999"
