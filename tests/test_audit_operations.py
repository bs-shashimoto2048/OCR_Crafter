"""監査ログ・ユーザー識別/権限・運用ダッシュボード・ヘルスチェックのテスト。"""

import json

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.audit_log import (
    ACTION_MIN_ROLE,
    AUDIT_ACTIONS,
    UserContext,
    _sanitize,
    read_audit,
    record_audit,
    require_role,
    resolve_user_context,
)
from src.app.services.operations import build_dashboard, build_health_details, check_ready


def test_audit_actions_defined(temp_projects):
    # 基本13種＋バックアップ2種＋監査補完7種（job_finished/evaluation_run/experiment_update/
    # analysis_toggle/backup_create/deployment_export/restore_failed）=22種
    assert len(AUDIT_ACTIONS) == 22
    assert "backup_restore" in AUDIT_ACTIONS and "retention_cleanup" in AUDIT_ACTIONS
    for action in ["job_finished", "evaluation_run", "experiment_update", "analysis_toggle", "backup_create", "deployment_export", "restore_failed"]:
        assert action in AUDIT_ACTIONS, f"補完対象 {action} がない"
    assert set(ACTION_MIN_ROLE) == set(AUDIT_ACTIONS)


def test_record_audit_fields_and_sequence(temp_projects):
    first = record_audit(
        "release_promote",
        user=UserContext(operator="hashimoto", role="approver"),
        project_id="p1",
        target_type="model",
        target_id="m1.tess.json",
        before={"production": ""},
        after={"production": "m1.tess.json", "version": "1.0.0"},
        reason="初回リリース",
        job_id="JOB-000001",
        client={"ip": "127.0.0.1", "user_agent": "pytest"},
    )
    second = record_audit("job_cancel", user="alice", project_id="p1", target_id="JOB-000002")
    assert first["audit_id"] == "AUD-000001"
    assert second["audit_id"] == "AUD-000002"  # 全体一意・連番
    for key in [
        "audit_id", "timestamp", "user", "action", "project_id", "target_type",
        "target_id", "before", "after", "reason", "job_id", "client",
    ]:
        assert key in first, f"保存項目 {key} がない"
    assert first["user"] == "hashimoto" and first["role"] == "approver"
    assert first["client"]["ip"] == "127.0.0.1"
    with pytest.raises(ValueError, match="unknown audit action"):
        record_audit("login")  # 対象外の操作は記録しない


def test_sanitize_forbidden_keys_and_binary(temp_projects):
    cleaned = _sanitize(
        {
            "password": "secret123",
            "api_key": "sk-xxx",
            "Authorization": "Bearer xxx",
            "access_token": "t",
            "image_bytes": b"\x89PNG....",
            "note": "ok",
            "long": "x" * 5000,
            "nested": {"paSSword": "p", "keep": 1},
        }
    )
    # パスワード・トークン・APIキーは値ごと保存しない
    for forbidden in ["password", "api_key", "Authorization", "access_token"]:
        assert forbidden not in cleaned
    assert "paSSword" not in cleaned["nested"]
    assert cleaned["nested"]["keep"] == 1
    # 画像バイナリは保存しない・巨大値は切り詰め
    assert cleaned["image_bytes"] == "[バイナリは保存しません]"
    assert cleaned["long"].endswith("…[切り詰め]") and len(cleaned["long"]) < 2100
    assert cleaned["note"] == "ok"


def test_read_audit_filters_newest_first(temp_projects):
    record_audit("project_create", user="alice", project_id="p1", target_id="p1")
    record_audit("model_delete", user="bob", project_id="p2", target_id="m.tess.json")
    record_audit("project_create", user="alice", project_id="p2", target_id="p2")
    items = read_audit()
    assert [i["audit_id"] for i in items] == ["AUD-000003", "AUD-000002", "AUD-000001"]  # 新しい順
    assert len(read_audit(project_id="p2")) == 2
    assert len(read_audit(action="model_delete")) == 1
    assert len(read_audit(user="ali")) == 2
    assert len(read_audit(target_id="m.tess")) == 1
    assert len(read_audit(limit=1)) == 1


def test_user_context_and_roles(temp_projects):
    # 認証未設定モード: ヘッダなし=Admin互換（全操作許可）＋その旨をUIへ返す
    ctx = resolve_user_context({})
    assert ctx.role == "admin" and ctx.auth_configured is False
    assert "認証未設定モード" in ctx.to_dict()["auth_mode"]
    require_role(ctx, "project_delete")  # 例外なし
    # X-Roleを明示した場合はロール階層を強制
    viewer = resolve_user_context({"x-operator": "guest", "x-role": "viewer"})
    assert viewer.operator == "guest" and viewer.role == "viewer"
    with pytest.raises(PermissionError, match="operator 以上"):
        require_role(viewer, "preprocess_run")
    operator = UserContext(role="operator")
    require_role(operator, "preprocess_run")
    with pytest.raises(PermissionError):
        require_role(operator, "release_promote")  # promoteはapprover以上
    require_role(UserContext(role="approver"), "release_promote")
    with pytest.raises(PermissionError):
        require_role(UserContext(role="approver"), "release_policy_update")  # policyはadmin


def test_health_ready_and_details(temp_projects):
    ready = check_ready()
    assert ready["ready"] is True
    assert ready["checks"]["data_dir_writable"] is True
    details = build_health_details()
    for name in [
        "backend", "data_dir_writable", "settings", "tesseract", "paddleocr",
        "gpu", "job_worker", "disk", "projects_dir",
    ]:
        assert name in details["checks"], f"ヘルスチェック項目 {name} がない"
        assert "ok" in details["checks"][name] and "detail" in details["checks"][name]
    assert details["status"] in {"ok", "degraded"}


def test_operations_dashboard(temp_projects):
    from src.app.services.experiment_tracker import attach_evaluation, record_experiment
    from src.app.services.job_manager import JobService
    from src.app.services.release_manager import promote_model, set_model_status

    pid = "p_ops"
    paths = ensure_project_directories(pid)
    (paths.models / "prod.tess.json").write_text(json.dumps({"created_at": "t"}), encoding="utf-8")
    (paths.models / "cand.tess.json").write_text(json.dumps({"created_at": "t"}), encoding="utf-8")
    record_experiment(pid, {"models": ["prod.tess.json"]})
    attach_evaluation(pid, "prod.tess.json", {"cer": 0.03, "dataset_id": "d", "image_count": 10, "label_count": 10})
    promote_model(pid, "prod.tess.json", note="初回")
    set_model_status(pid, "cand.tess.json", "Candidate")  # 評価なしのCandidate
    JobService().create_job(pid, "preprocess", {"project_id": pid})

    dashboard = build_dashboard(pid)
    assert dashboard["jobs"]["queued"] == 1
    assert dashboard["production"]["model"] == "prod.tess.json"
    assert dashboard["production"]["gate_verdict"] in {"PASS", "CONDITIONAL_PASS", "FAIL", "NOT_EVALUATED"}
    assert dashboard["unevaluated_candidates"] == ["cand.tess.json"]
    assert dashboard["latest_benchmark"] is None
    assert "total_mb" in dashboard["data_usage"]
    assert dashboard["backup"] is None  # バックアップ未取得
