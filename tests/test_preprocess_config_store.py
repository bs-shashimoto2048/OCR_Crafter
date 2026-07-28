"""「前処理設定保存」（学習用確定設定・履歴）と推論使用モデル永続化のテスト。

- services/preprocess_config_store.py: 保存・履歴・同一Hash再保存の重複防止
- API: current-config拡張（saved_config/is_saved）・saved-config GET/POST・restore
- create_ocr_dataset: meta.jsonへのpreprocess_config_version/saved_atの記録条件
- services/inference_model.py + API: 推論使用モデルの保存・復元・削除時クリア
"""

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import src.app.main as main_module
from src.app.project_paths import ensure_project_directories
from src.app.schemas import InferenceModelSaveRequest, PreprocessSavedConfigRequest
from src.app.services.inference_model import clear_inference_model, load_inference_model, save_inference_model
from src.app.services.ocr_pipeline import create_ocr_dataset
from src.app.services.preprocess import run_preprocess
from src.app.services.preprocess_config_store import (
    list_preprocess_config_history,
    load_saved_preprocess_config,
    save_preprocess_config_version,
)


def _make_raw_project(temp_projects, project_id: str = "p1", count: int = 3) -> str:
    root = temp_projects["projects_dir"] / project_id
    raw = root / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        arr = np.full((32, 96), 200, dtype=np.uint8)
        arr[:, 10 + i * 5 : 14 + i * 5] = 30
        Image.fromarray(arr, mode="L").save(raw / f"img_{i:04d}.png")
    return project_id


def _make_labeled_processed_project(temp_projects, project_id: str, count: int = 5) -> str:
    root = temp_projects["projects_dir"] / project_id
    images_dir = root / "processed" / "wide" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    lines = ["filename,label,type"]
    for i in range(count):
        name = f"img_{i:04d}.png"
        Image.fromarray(np.full((32, 96), 100, dtype=np.uint8), mode="L").save(images_dir / name)
        lines.append(f"{name},AB{i % 10},wide")
    annotations = root / "annotations"
    annotations.mkdir(parents=True, exist_ok=True)
    (annotations / "master.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return project_id


# ---------- services/preprocess_config_store.py（純粋な永続化ロジック） ----------


def test_save_preprocess_config_version_first_save_is_version_1(temp_projects):
    project_id = "p1"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    tp = {"steps": {"wide": [{"name": "grayscale", "enabled": True, "params": {}}]}}
    result = save_preprocess_config_version(root, tp, "sha256:aaa")
    assert result["created"] is True
    assert result["saved_config"]["version"] == 1
    assert result["saved_config"]["config_hash"] == "sha256:aaa"
    assert result["saved_config"]["saved_at"]

    loaded = load_saved_preprocess_config(root)
    assert loaded["version"] == 1
    assert loaded["training_preprocess"] == tp


def test_save_preprocess_config_version_same_hash_does_not_create_new_history(temp_projects):
    project_id = "p2"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    tp = {"steps": {}}
    first = save_preprocess_config_version(root, tp, "sha256:same")
    assert first["created"] is True
    second = save_preprocess_config_version(root, tp, "sha256:same")
    assert second["created"] is False
    assert second["saved_config"]["version"] == 1
    history = list_preprocess_config_history(root)
    assert len(history) == 1


def test_save_preprocess_config_version_different_hash_increments_version_and_keeps_history(temp_projects):
    project_id = "p3"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    save_preprocess_config_version(root, {"steps": {"a": 1}}, "sha256:v1")
    save_preprocess_config_version(root, {"steps": {"a": 2}}, "sha256:v2")
    result3 = save_preprocess_config_version(root, {"steps": {"a": 3}}, "sha256:v3")
    assert result3["created"] is True
    assert result3["saved_config"]["version"] == 3

    current = load_saved_preprocess_config(root)
    assert current["version"] == 3
    assert current["config_hash"] == "sha256:v3"

    history = list_preprocess_config_history(root)
    assert [h["version"] for h in history] == [3, 2, 1]
    assert [h["config_hash"] for h in history] == ["sha256:v3", "sha256:v2", "sha256:v1"]
    # 過去履歴が上書きされていないこと
    assert history[1]["training_preprocess"] == {"steps": {"a": 2}}


def test_load_saved_preprocess_config_none_when_missing(temp_projects):
    project_id = "p4"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    assert load_saved_preprocess_config(root) is None
    assert list_preprocess_config_history(root) == []


# ---------- API: current-config拡張・saved-config・restore ----------


def test_current_config_endpoint_reports_not_saved_when_never_saved(temp_projects):
    client = TestClient(main_module.app)
    resp = client.get("/api/ocr/preprocess/current-config", params={"project_id": "p_never_saved"})
    data = resp.json()
    assert data["saved_config"] is None
    assert data["is_saved"] is False


def test_saved_config_create_endpoint_creates_version_1_and_dedupes_resave(temp_projects):
    project_id = "p_save_api"
    client = TestClient(main_module.app)
    resp1 = client.post("/api/ocr/preprocess/saved-config", json={"project_id": project_id})
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["created"] is True
    assert data1["saved_config"]["version"] == 1

    # 同一設定を再保存しても履歴は増えず、既存の確定設定を返す
    resp2 = client.post("/api/ocr/preprocess/saved-config", json={"project_id": project_id})
    data2 = resp2.json()
    assert data2["created"] is False
    assert data2["saved_config"]["version"] == 1

    history_resp = client.get("/api/ocr/preprocess/saved-config", params={"project_id": project_id})
    assert len(history_resp.json()["history"]) == 1


def test_current_config_endpoint_reports_saved_after_save(temp_projects):
    project_id = "p_after_save"
    client = TestClient(main_module.app)
    client.post("/api/ocr/preprocess/saved-config", json={"project_id": project_id})
    resp = client.get("/api/ocr/preprocess/current-config", params={"project_id": project_id})
    data = resp.json()
    assert data["saved_config"] is not None
    assert data["saved_config"]["version"] == 1
    assert data["is_saved"] is True
    # overridesはtraining_preprocess_to_config形状（run_preprocessへ明示的に渡せる形）
    assert "operations" in data["saved_config"]["overrides"]


def test_current_config_endpoint_reports_unsaved_change_after_settings_diverge(temp_projects):
    project_id = "p_diverge"
    client = TestClient(main_module.app)
    client.post("/api/ocr/preprocess/saved-config", json={"project_id": project_id})
    # 保存後にプロジェクトの前処理設定を変更する（次回run_preprocess実行時の設定を変える）
    run_preprocess(project_id=project_id, overrides={"operations": {"threshold": {"type": "binary", "value": 77}}})
    resp = client.get("/api/ocr/preprocess/current-config", params={"project_id": project_id})
    data = resp.json()
    assert data["is_saved"] is False
    assert data["saved_config"]["version"] == 1


def test_saved_config_restore_endpoint_writes_active_project_overrides(temp_projects):
    from src.app.services.preprocess import load_project_preprocess_overrides

    project_id = "p_restore"
    client = TestClient(main_module.app)
    # 保存時点（既定値。threshold.value=128）を確定設定として保存する
    client.post("/api/ocr/preprocess/saved-config", json={"project_id": project_id})
    # 保存後に設定を変える（value: 128 → 77）
    run_preprocess(project_id=project_id, overrides={"operations": {"threshold": {"type": "binary", "value": 77}}})
    paths = ensure_project_directories(project_id)
    diverged = load_project_preprocess_overrides(paths.root)
    assert diverged["operations"]["threshold"]["value"] == 77

    resp = client.post("/api/ocr/preprocess/saved-config/restore", json={"project_id": project_id})
    assert resp.status_code == 200
    restored = load_project_preprocess_overrides(paths.root)
    # 復元後は保存時点の設定（既定値=128）へ戻っている
    assert restored["operations"]["threshold"]["value"] == 128

    after = client.get("/api/ocr/preprocess/current-config", params={"project_id": project_id}).json()
    assert after["is_saved"] is True


def test_saved_config_restore_endpoint_404_when_never_saved(temp_projects):
    client = TestClient(main_module.app)
    resp = client.post("/api/ocr/preprocess/saved-config/restore", json={"project_id": "p_no_saved"})
    assert resp.status_code == 404


# ---------- create_ocr_dataset: meta.jsonへのVersion/保存日時の記録 ----------


def test_create_ocr_dataset_records_preprocess_config_version_when_hash_matches(temp_projects):
    project_id = _make_labeled_processed_project(temp_projects, "p_ds_version")
    # 学習時前処理の実記録（processed/meta/preprocess_snapshot.json）を用意する。
    # run_preprocess・saved-config保存はいずれもプロジェクト保存値（未設定=settings.yaml既定）
    # から同一のcfgを解決するため、途中で設定を変更しない限りHashは一致する
    run_preprocess(project_id=project_id, overrides={})
    client = TestClient(main_module.app)
    save_resp = client.post("/api/ocr/preprocess/saved-config", json={"project_id": project_id}).json()
    saved_version = save_resp["saved_config"]["version"]
    saved_at = save_resp["saved_config"]["saved_at"]

    result = create_ocr_dataset(project_id=project_id, image_types=["wide"], seed=1)
    assert result["preprocess_config_version"] == saved_version
    assert result["preprocess_config_saved_at"] == saved_at

    # meta.jsonの内容も直接確認する（Dataset作成時に使用した保存済み設定と一致すること）
    from pathlib import Path

    meta_path = Path(result["dataset_root"]) / "meta.json"
    meta_json = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta_json["preprocess_config_version"] == saved_version
    assert meta_json["preprocess_config_saved_at"] == saved_at


def test_create_ocr_dataset_leaves_version_none_when_no_saved_config(temp_projects):
    project_id = _make_labeled_processed_project(temp_projects, "p_ds_no_saved")
    result = create_ocr_dataset(project_id=project_id, image_types=["wide"], seed=1)
    assert result["preprocess_config_version"] is None
    assert result["preprocess_config_saved_at"] is None


def test_create_ocr_dataset_leaves_version_none_when_saved_config_hash_mismatches(temp_projects):
    """保存済み設定はあるが、実際に使用された前処理（processed済み画像/未実行）のHashと
    一致しない場合は、過去の設定を推測してVersionを付けない。"""
    project_id = _make_labeled_processed_project(temp_projects, "p_ds_mismatch")
    client = TestClient(main_module.app)
    client.post("/api/ocr/preprocess/saved-config", json={"project_id": project_id})
    # このプロジェクトはprocessed画像が既存fixtureで直接配置されただけで、
    # run_preprocess由来のtraining_preprocess_hashは記録されていない（training_preprocess=None）
    result = create_ocr_dataset(project_id=project_id, image_types=["wide"], seed=1)
    assert result["training_preprocess_hash"] is None
    assert result["preprocess_config_version"] is None
    assert result["preprocess_config_saved_at"] is None


# ---------- services/inference_model.py + API ----------


def test_inference_model_store_roundtrip(temp_projects):
    project_id = "p_inf"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    assert load_inference_model(root) is None
    saved = save_inference_model(root, engine="paddleocr", model="custom_v3.ocr.json", model_id="M0012")
    assert saved["engine"] == "paddleocr"
    assert saved["model"] == "custom_v3.ocr.json"
    assert saved["inference_model_id"] == "M0012"
    assert saved["updated_at"]

    loaded = load_inference_model(root)
    assert loaded["model"] == "custom_v3.ocr.json"

    clear_inference_model(root)
    assert load_inference_model(root) is None


def test_inference_model_store_update_replaces_previous_value(temp_projects):
    """推論モデル切替不具合修正: 更新保存は置換であり、旧モデルの情報を残さない。"""
    project_id = "p_inf_update"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    save_inference_model(root, engine="tesseract", model="ModelA.tess.json", model_id="M0001")
    save_inference_model(root, engine="tesseract", model="ModelB.tess.json", model_id="M0002")

    loaded = load_inference_model(root)
    assert loaded["model"] == "ModelB.tess.json"
    assert loaded["inference_model_id"] == "M0002"
    assert "ModelA" not in json.dumps(loaded)


def test_inference_model_store_supports_three_or_more_updates(temp_projects):
    """推論モデル切替不具合修正: 3回以上の切替がすべて反映され、最後の選択だけが残る。"""
    project_id = "p_inf_multi"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    for name, model_id in [("ModelA", "M0001"), ("ModelB", "M0002"), ("ModelC", "M0003"), ("ModelD", "M0004")]:
        save_inference_model(root, engine="tesseract", model=f"{name}.tess.json", model_id=model_id)
        # 各更新の直後に、その時点の選択が正しく反映されていること（途中経過も検証）
        assert load_inference_model(root)["model"] == f"{name}.tess.json"

    final = load_inference_model(root)
    assert final["model"] == "ModelD.tess.json"
    assert final["inference_model_id"] == "M0004"


def test_inference_model_json_file_replaced_not_appended(temp_projects):
    """推論モデル切替不具合修正: 保存先ファイルは常に単一dict（置換）であり、追記された配列等にならない。"""
    project_id = "p_inf_replace"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    save_inference_model(root, engine="tesseract", model="ModelA.tess.json")
    save_inference_model(root, engine="tesseract", model="ModelB.tess.json")
    save_inference_model(root, engine="tesseract", model="ModelC.tess.json")

    raw = json.loads((root / "inference_model.json").read_text(encoding="utf-8"))
    assert isinstance(raw, dict)  # 配列（追記形式）ではなく単一dict
    assert raw["model"] == "ModelC.tess.json"


def test_inference_model_api_get_and_set(temp_projects):
    client = TestClient(main_module.app)
    empty = client.get("/api/ocr/inference/model", params={"project_id": "p_inf_api"}).json()
    assert empty["inference_model"] is None

    resp = client.post(
        "/api/ocr/inference/model",
        json={"project_id": "p_inf_api", "engine": "tesseract", "model": "eng.traineddata", "model_id": "M0003"},
    )
    assert resp.status_code == 200
    saved = client.get("/api/ocr/inference/model", params={"project_id": "p_inf_api"}).json()
    assert saved["inference_model"]["engine"] == "tesseract"
    assert saved["inference_model"]["model"] == "eng.traineddata"
    assert saved["inference_model"]["inference_model_id"] == "M0003"


def test_inference_model_api_supports_repeated_updates(temp_projects):
    """推論モデル切替不具合修正: APIレベルでもA→B→Cの切替がすべて正しく反映される
    （「未設定時のみ保存」のような分岐が無いことをAPI経由で確認）。"""
    client = TestClient(main_module.app)
    project_id = "p_inf_api_multi"

    resp_a = client.post(
        "/api/ocr/inference/model",
        json={"project_id": project_id, "engine": "tesseract", "model": "ModelA.tess.json", "model_id": "M0001"},
    )
    assert resp_a.status_code == 200
    assert client.get("/api/ocr/inference/model", params={"project_id": project_id}).json()["inference_model"]["model"] == "ModelA.tess.json"

    resp_b = client.post(
        "/api/ocr/inference/model",
        json={"project_id": project_id, "engine": "tesseract", "model": "ModelB.tess.json", "model_id": "M0002"},
    )
    assert resp_b.status_code == 200
    assert client.get("/api/ocr/inference/model", params={"project_id": project_id}).json()["inference_model"]["model"] == "ModelB.tess.json"

    resp_c = client.post(
        "/api/ocr/inference/model",
        json={"project_id": project_id, "engine": "tesseract", "model": "ModelC.tess.json", "model_id": "M0003"},
    )
    assert resp_c.status_code == 200
    final = client.get("/api/ocr/inference/model", params={"project_id": project_id}).json()["inference_model"]
    assert final["model"] == "ModelC.tess.json"
    assert final["inference_model_id"] == "M0003"


def test_inference_model_different_projects_are_independent(temp_projects):
    client = TestClient(main_module.app)
    client.post("/api/ocr/inference/model", json={"project_id": "proj_a", "engine": "custom", "model": "a.ocr.json"})
    client.post("/api/ocr/inference/model", json={"project_id": "proj_b", "engine": "custom", "model": "b.ocr.json"})
    a = client.get("/api/ocr/inference/model", params={"project_id": "proj_a"}).json()
    b = client.get("/api/ocr/inference/model", params={"project_id": "proj_b"}).json()
    assert a["inference_model"]["model"] == "a.ocr.json"
    assert b["inference_model"]["model"] == "b.ocr.json"


def test_delete_model_clears_matching_saved_inference_model(temp_projects, monkeypatch):
    from starlette.requests import Request as StarletteRequest

    def _dummy_request():
        return StarletteRequest(
            {"type": "http", "method": "DELETE", "path": "/", "headers": [], "query_string": b"", "client": ("127.0.0.1", 0)}
        )

    project_id = "p_del_inf"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    save_inference_model(root, engine="custom", model="target.ocr.json", model_id="M0009")

    models_dir = root / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    (models_dir / "target.ocr.json").write_text("{}", encoding="utf-8")

    main_module.delete_model_endpoint(model_name="target.ocr.json", request=_dummy_request(), project_id=project_id)
    assert load_inference_model(root) is None


def test_delete_model_keeps_saved_inference_model_when_different_model_deleted(temp_projects):
    from starlette.requests import Request as StarletteRequest

    def _dummy_request():
        return StarletteRequest(
            {"type": "http", "method": "DELETE", "path": "/", "headers": [], "query_string": b"", "client": ("127.0.0.1", 0)}
        )

    project_id = "p_del_other"
    root = temp_projects["projects_dir"] / project_id
    root.mkdir(parents=True, exist_ok=True)
    save_inference_model(root, engine="custom", model="keep.ocr.json", model_id="M0001")

    models_dir = root / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    (models_dir / "other.ocr.json").write_text("{}", encoding="utf-8")

    main_module.delete_model_endpoint(model_name="other.ocr.json", request=_dummy_request(), project_id=project_id)
    assert load_inference_model(root)["model"] == "keep.ocr.json"
