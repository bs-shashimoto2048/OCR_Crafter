"""Dataset Manager APIのテスト（一覧・詳細・コメント・コピー・削除・Modelコメント・Version使用数）。"""

import json

from fastapi.testclient import TestClient

import src.app.main as main_module
from src.app.project_paths import ensure_project_directories
from src.app.services.preprocess_config_store import save_preprocess_config_version

client = TestClient(main_module.app, raise_server_exceptions=False)


def _write_dataset(project_id: str, folder_name: str, created_at: str, meta_overrides: dict | None = None):
    paths = ensure_project_directories(project_id)
    folder = paths.outputs / "ocr_dataset" / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    meta = {
        "created_at": created_at,
        "counts": {"train": 8, "val": 1, "test": 1},
        "input_count": 12,
        "charset": "ABC",
        "train_ratio": 0.7,
        "val_ratio": 0.2,
        "test_ratio": 0.1,
        "preprocess_config_version": 1,
        "training_preprocess_hash": "hash-abc",
    }
    if meta_overrides:
        meta.update(meta_overrides)
    (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return folder


def _write_tess_model(
    project_id: str, name: str, dataset_root, created_at: str = "2026-07-21T00:00:00",
    training_preprocess_hash: str = "hash-abc",
):
    models_dir = ensure_project_directories(project_id).models
    payload = {
        "created_at": created_at,
        "traineddata_path": "",
        "tessdata_dir": str(dataset_root),
        "model_dir": str(dataset_root),
        "lang": "custom",
        "base_lang": "eng",
        "dataset_root": str(dataset_root),
        "training_preprocess_hash": training_preprocess_hash,
    }
    path = models_dir / f"{name}.tess.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def test_list_datasets_endpoint(temp_projects):
    _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    resp = client.get("/api/ocr/datasets", params={"project_id": "p1"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["folder_name"] == "ds_a"


def test_dataset_detail_endpoint_and_404(temp_projects):
    _write_dataset("p1", "ds_a", "2026-07-01T00:00:00", meta_overrides={"display_name": "OCRDataset_v1"})
    dataset_id = client.get("/api/ocr/datasets", params={"project_id": "p1"}).json()["items"][0]["dataset_id"]

    resp = client.get(f"/api/ocr/datasets/{dataset_id}", params={"project_id": "p1"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "OCRDataset_v1"

    assert client.get("/api/ocr/datasets/DS9999", params={"project_id": "p1"}).status_code == 404


def test_dataset_delete_impact_endpoint(temp_projects):
    folder = _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    _write_tess_model("p1", "OCR_v2", folder)
    dataset_id = client.get("/api/ocr/datasets", params={"project_id": "p1"}).json()["items"][0]["dataset_id"]

    resp = client.get(f"/api/ocr/datasets/{dataset_id}/delete-impact", params={"project_id": "p1"})
    assert resp.status_code == 200
    assert resp.json()["model_count"] == 1
    assert resp.json()["model_names"] == ["OCR_v2.tess.json"]


def test_dataset_comment_endpoint(temp_projects):
    _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    dataset_id = client.get("/api/ocr/datasets", params={"project_id": "p1"}).json()["items"][0]["dataset_id"]

    resp = client.post(
        f"/api/ocr/datasets/{dataset_id}/comment",
        json={"project_id": "p1", "comment": "CLAHE追加版\nノイズ画像追加"},
    )
    assert resp.status_code == 200
    assert resp.json()["comment"] == "CLAHE追加版\nノイズ画像追加"


def test_dataset_copy_endpoint(temp_projects):
    _write_dataset("p1", "OCRDataset_v3", "2026-07-01T00:00:00", meta_overrides={"display_name": "OCRDataset_v3"})
    dataset_id = client.get("/api/ocr/datasets", params={"project_id": "p1"}).json()["items"][0]["dataset_id"]

    resp = client.post(f"/api/ocr/datasets/{dataset_id}/copy", json={"project_id": "p1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "OCRDataset_v3_Copy"
    assert body["dataset_id"] != dataset_id

    listed = client.get("/api/ocr/datasets", params={"project_id": "p1"}).json()["items"]
    assert len(listed) == 2


def test_dataset_delete_endpoint(temp_projects):
    _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    dataset_id = client.get("/api/ocr/datasets", params={"project_id": "p1"}).json()["items"][0]["dataset_id"]

    resp = client.delete(f"/api/ocr/datasets/{dataset_id}", params={"project_id": "p1"})
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    assert client.get(f"/api/ocr/datasets/{dataset_id}", params={"project_id": "p1"}).status_code == 404


def test_dataset_delete_endpoint_404_for_unknown(temp_projects):
    resp = client.delete("/api/ocr/datasets/DS9999", params={"project_id": "p1"})
    assert resp.status_code == 404


def test_model_comment_endpoint(temp_projects):
    folder = _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    _write_tess_model("p1", "OCR_v2", folder)

    resp = client.post(
        "/api/models/OCR_v2.tess.json/comment",
        json={"project_id": "p1", "comment": "認識率95%\n高圧VT向け"},
    )
    assert resp.status_code == 200
    info = {item["name"]: item for item in client.get("/models/info", params={"project_id": "p1"}).json()["items"]}
    assert info["OCR_v2.tess.json"]["comment"] == "認識率95%\n高圧VT向け"


def test_model_comment_endpoint_404_for_unknown_model(temp_projects):
    resp = client.post("/api/models/unknown.tess.json/comment", json={"project_id": "p1", "comment": "x"})
    assert resp.status_code == 404


def test_preprocess_saved_config_usage_counts(temp_projects):
    project_id = "p1"
    paths = ensure_project_directories(project_id)
    result = save_preprocess_config_version(paths.root, {"grayscale": True}, "hash-v1")
    version = result["saved_config"]["version"]

    folder = _write_dataset(
        project_id, "ds_a", "2026-07-01T00:00:00",
        meta_overrides={"preprocess_config_version": version, "training_preprocess_hash": "hash-v1"},
    )
    _write_tess_model(project_id, "OCR_v2", folder, training_preprocess_hash="hash-v1")

    resp = client.get("/api/ocr/preprocess/saved-config", params={"project_id": project_id})
    assert resp.status_code == 200
    saved = resp.json()["saved_config"]
    assert saved["dataset_usage_count"] == 1
    assert saved["model_usage_count"] == 1
