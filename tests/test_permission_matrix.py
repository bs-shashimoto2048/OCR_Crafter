"""権限受入試験（Viewer / Operator / Approver / Admin × 全監査対象操作のマトリクス）。

仕様確定事項（docs/23_UAT_CHECKLIST.md）:
- Viewer: 閲覧・CSV Export・Model Card表示は可（GET系は権限強制なし）。
  **Deployment Package ExportはOperator以上**（配布物の持ち出しは操作扱い）
- Operator: 前処理/データセット/学習/評価/Benchmark実行可。**Candidate化（release_status_change）も可**
- Approver: Production昇格・Override承認・Rollback
- Admin: Policy変更・Project削除・Model削除・Backup復元・Retention実行
"""

import pytest

from src.app.services.audit_log import ACTION_MIN_ROLE, ROLES, UserContext, require_role

# 期待マトリクス（操作→許可される最低ロール）。仕様確定の根拠として明示的に列挙する
EXPECTED_MATRIX = {
    # Operator以上
    "project_create": "operator",
    "preprocess_run": "operator",
    "dataset_create": "operator",
    "training_start": "operator",
    "evaluation_run": "operator",
    "benchmark_run": "operator",
    "release_status_change": "operator",  # Candidate化はOperator可（仕様確定）
    "job_cancel": "operator",
    "job_retry": "operator",
    "job_finished": "operator",  # システム記録用
    "experiment_update": "operator",
    "analysis_toggle": "operator",
    "backup_create": "operator",
    "deployment_export": "operator",  # ViewerはExport不可（仕様確定）
    "report_generate": "operator",  # レポート生成
    "report_delete": "operator",  # レポート削除
    # Approver以上
    "release_promote": "approver",
    "release_rollback": "approver",
    # Adminのみ
    "project_delete": "admin",
    "model_delete": "admin",
    "release_policy_update": "admin",
    "backup_restore": "admin",
    "retention_cleanup": "admin",
    "restore_failed": "admin",
}


def test_matrix_matches_implementation():
    assert EXPECTED_MATRIX == ACTION_MIN_ROLE, "権限マトリクスの仕様と実装が一致しない"


@pytest.mark.parametrize("role", ROLES)
def test_role_permission_matrix(role):
    """各ロールで全操作を試行し、期待どおりの許可/403（PermissionError）を検証する。"""
    ctx = UserContext(operator="tester", role=role, strict=False)
    for action, minimum in EXPECTED_MATRIX.items():
        allowed = ROLES.index(role) >= ROLES.index(minimum)
        if allowed:
            require_role(ctx, action)  # 例外が出ないこと
        else:
            with pytest.raises(PermissionError):
                require_role(ctx, action)


def test_viewer_cannot_mutate_anything():
    """Viewerは全監査対象操作（変更系）を実行できない（閲覧・CSV Export・Model Card表示のみ）。"""
    ctx = UserContext(operator="viewer-user", role="viewer", strict=False)
    for action in EXPECTED_MATRIX:
        with pytest.raises(PermissionError):
            require_role(ctx, action)


def test_api_level_matrix(temp_projects):
    """API層での権限強制を代表操作で確認する（403の統一エラー形式込み）。"""
    from fastapi.testclient import TestClient

    import src.app.main as main_module

    client = TestClient(main_module.app, raise_server_exceptions=False)

    def as_role(role):
        return {"X-Operator": "tester", "X-Role": role}

    # Viewer: 閲覧は可・変更は403
    assert client.get("/api/jobs", headers=as_role("viewer")).status_code == 200
    assert client.get("/api/audit", headers=as_role("viewer")).status_code == 200
    response = client.post("/projects", json={"project_id": "pm"}, headers=as_role("viewer"))
    assert response.status_code == 403 and response.json()["error_code"] == "PERMISSION_DENIED"
    assert client.get("/api/releases/deployment_package?project_id=pm", headers=as_role("viewer")).status_code == 403

    # Operator: 作成系は可・昇格/削除は403
    assert client.post("/projects", json={"project_id": "pm"}, headers=as_role("operator")).status_code == 200
    assert (
        client.post("/api/releases/promote", json={"project_id": "pm", "model": "x.tess.json", "note": "n"}, headers=as_role("operator")).status_code
        == 403
    )
    assert client.delete("/projects/pm2", headers=as_role("operator")).status_code == 403

    # Approver: 昇格は権限通過（対象モデルなしで404まで到達）・Policy変更は403
    assert (
        client.post("/api/releases/promote", json={"project_id": "pm", "model": "x.tess.json", "note": "n"}, headers=as_role("approver")).status_code
        == 404
    )
    assert client.put("/api/releases/policy", json={"project_id": "pm", "policy": {}}, headers=as_role("approver")).status_code == 403

    # Admin: Policy変更・Retention適用まで可
    assert client.put("/api/releases/policy", json={"project_id": "pm", "policy": {"max_cer": 0.1}}, headers=as_role("admin")).status_code == 200
    assert client.post("/api/retention/apply", headers=as_role("admin")).status_code == 200
