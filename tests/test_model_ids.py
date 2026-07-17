"""モデル管理No（model_id）採番のテスト。

- 作成日時順で M0001 形式の連番を採番する
- 一度採番した番号は不変（再取得しても同じ）
- 削除しても番号を再利用しない
- プロジェクトをまたいでも一意（OCR Crafter内で一意）
- data/model_ids.json（テストでは一時領域）へ永続化する
"""

import json

from src.app.services.model_registry import list_model_infos


def _write_tess_model(models_dir, name: str, created_at: str) -> None:
    payload = {
        "created_at": created_at,
        "traineddata_path": "",
        "lang": "custom",
        "base_lang": "eng",
    }
    (models_dir / f"{name}.tess.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def _models_dir(temp_projects, project_id: str):
    d = temp_projects["projects_dir"] / project_id / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _id_map(project_id: str) -> dict:
    return {item["name"]: item["model_id"] for item in list_model_infos(project_id)}


def test_assigns_ids_in_created_at_order(temp_projects):
    models = _models_dir(temp_projects, "p1")
    # ファイル名順と作成日時順が食い違うように作る（採番は作成日時順であるべき）
    _write_tess_model(models, "b_newer", "2026-07-16T12:00:00")
    _write_tess_model(models, "a_older", "2026-07-15T09:00:00")
    ids = _id_map("p1")
    assert ids["a_older.tess.json"] == "M0001"
    assert ids["b_newer.tess.json"] == "M0002"


def test_ids_are_stable_across_calls(temp_projects):
    models = _models_dir(temp_projects, "p1")
    _write_tess_model(models, "m1", "2026-07-15T09:00:00")
    first = _id_map("p1")
    second = _id_map("p1")
    assert first == second


def test_deleted_ids_are_not_reused(temp_projects):
    models = _models_dir(temp_projects, "p1")
    _write_tess_model(models, "m1", "2026-07-15T09:00:00")
    assert _id_map("p1")["m1.tess.json"] == "M0001"
    (models / "m1.tess.json").unlink()
    _write_tess_model(models, "m2", "2026-07-16T09:00:00")
    # 削除済みの M0001 は再利用せず次番号を振る
    assert _id_map("p1")["m2.tess.json"] == "M0002"


def test_ids_unique_across_projects(temp_projects):
    _write_tess_model(_models_dir(temp_projects, "p1"), "m1", "2026-07-15T09:00:00")
    _write_tess_model(_models_dir(temp_projects, "p2"), "m1", "2026-07-16T09:00:00")
    id1 = _id_map("p1")["m1.tess.json"]
    id2 = _id_map("p2")["m1.tess.json"]
    assert id1 == "M0001"
    assert id2 == "M0002"
    assert id1 != id2


def test_registry_persisted_to_data_root(temp_projects):
    _write_tess_model(_models_dir(temp_projects, "p1"), "m1", "2026-07-15T09:00:00")
    list_model_infos("p1")
    registry_file = temp_projects["projects_dir"].parent / "model_ids.json"
    assert registry_file.is_file()
    data = json.loads(registry_file.read_text(encoding="utf-8"))
    assert data["counter"] == 1
    assert data["models"]["p1/m1.tess.json"] == "M0001"


def test_existing_models_bulk_assigned_by_created_at(temp_projects):
    """既存モデル（登録簿なし）が複数あるとき、作成日時順で一括採番される。"""
    models = _models_dir(temp_projects, "p1")
    _write_tess_model(models, "third", "2026-07-17T00:00:00")
    _write_tess_model(models, "first", "2026-07-15T00:00:00")
    _write_tess_model(models, "second", "2026-07-16T00:00:00")
    ids = _id_map("p1")
    assert ids["first.tess.json"] == "M0001"
    assert ids["second.tess.json"] == "M0002"
    assert ids["third.tess.json"] == "M0003"
