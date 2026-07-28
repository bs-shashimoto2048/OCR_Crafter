"""Benchmark Center（既存資産の横断比較ビュー）のテスト。

- 比較可能モデル一覧（Model Manager×Experiment Trackingのクロス参照。新規評価は実行しない）
- 評価未実施モデルの検出（missing-evaluations）
- 比較条件の保存・履歴（BMC-0001形式。評価結果自体は保存しない）
- Dataset/Model/Experimentへの参加件数
- API層（Dataset詳細・Experiment一覧へのbenchmark_center_count合成）
"""

import json

from fastapi.testclient import TestClient

import src.app.main as main_module
from src.app.project_paths import ensure_project_directories
from src.app.services.benchmark_center import (
    build_dataset_participation_counts,
    build_experiment_participation_counts,
    build_model_participation_counts,
    check_missing_evaluations,
    count_comparisons_for_dataset,
    count_comparisons_for_experiment,
    count_comparisons_for_model,
    get_comparison,
    list_comparable_models,
    list_comparisons,
    save_comparison,
)
from src.app.services.experiment_tracker import attach_evaluation, list_experiments
from src.app.services.tesseract_pipeline import register_tesseract_model

client = TestClient(main_module.app, raise_server_exceptions=False)


def _write_dataset(project_id: str, folder_name: str, created_at: str, meta_overrides: dict | None = None):
    paths = ensure_project_directories(project_id)
    folder = paths.outputs / "ocr_dataset" / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    meta = {
        "display_name": folder_name,
        "created_at": created_at,
        "counts": {"train": 8, "val": 1, "test": 1},
        "preprocess_config_version": 3,
        "training_preprocess_hash": "sha256:preprocess",
    }
    if meta_overrides:
        meta.update(meta_overrides)
    (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return folder


def _register_model_with_dataset(project_id, lang, dataset_folder):
    paths = ensure_project_directories(project_id)
    return register_tesseract_model(
        project_id=project_id,
        lang=lang,
        traineddata_path=paths.models / f"{lang}.traineddata",
        tessdata_dir=dataset_folder,
        base_lang="eng",
        charset="AB",
        dataset_root=str(dataset_folder),
        counts={"train": 8, "val": 1},
        job_id=f"job-{lang}",
        max_iterations=1000,
    )


def test_list_comparable_models_cross_references_experiment_and_evaluation(temp_projects):
    project_id = "p1"
    folder = _write_dataset(project_id, "ds_a", "2026-07-01T00:00:00")
    _register_model_with_dataset(project_id, "ocr_v1", folder)
    attach_evaluation(project_id, "ocr_v1.tess.json", {"cer": 0.05, "char_accuracy": 0.95, "accuracy_percent": 90.0, "dataset": "ds_a"})

    rows = list_comparable_models(project_id)
    assert len(rows) == 1
    row = rows[0]
    assert row["model_name"] == "ocr_v1.tess.json"
    assert row["engine"] == "tesseract"
    assert row["dataset_name"] == "ds_a"
    assert row["preprocess_version"] == 3
    assert row["experiment_id"].startswith("EXP-")
    assert row["evaluation"]["cer"] == 0.05
    assert row["evaluation"]["accuracy_percent"] == 90.0


def test_list_comparable_models_without_evaluation_has_none(temp_projects):
    project_id = "p1"
    folder = _write_dataset(project_id, "ds_a", "2026-07-01T00:00:00")
    _register_model_with_dataset(project_id, "ocr_v1", folder)
    rows = list_comparable_models(project_id)
    assert rows[0]["evaluation"] is None


def test_list_comparable_models_filters_by_dataset_engine_query(temp_projects):
    project_id = "p1"
    folder_a = _write_dataset(project_id, "ds_a", "2026-07-01T00:00:00")
    folder_b = _write_dataset(project_id, "ds_b", "2026-07-02T00:00:00")
    _register_model_with_dataset(project_id, "ocr_v1", folder_a)
    _register_model_with_dataset(project_id, "ocr_v2", folder_b)

    all_rows = list_comparable_models(project_id)
    dataset_a_id = next(row["dataset_id"] for row in all_rows if row["model_name"] == "ocr_v1.tess.json")
    by_dataset_a = list_comparable_models(project_id, dataset_id=dataset_a_id)
    assert len(by_dataset_a) == 1
    assert by_dataset_a[0]["model_name"] == "ocr_v1.tess.json"

    by_engine = list_comparable_models(project_id, engine="tesseract")
    assert len(by_engine) == 2
    by_engine_none = list_comparable_models(project_id, engine="paddleocr")
    assert by_engine_none == []

    by_query = list_comparable_models(project_id, query="ocr_v1")
    assert len(by_query) == 1 and by_query[0]["model_name"] == "ocr_v1.tess.json"


def test_check_missing_evaluations(temp_projects):
    project_id = "p1"
    folder = _write_dataset(project_id, "ds_a", "2026-07-01T00:00:00")
    _register_model_with_dataset(project_id, "ocr_v1", folder)
    _register_model_with_dataset(project_id, "ocr_v2", folder)
    attach_evaluation(project_id, "ocr_v1.tess.json", {"cer": 0.05, "accuracy_percent": 90.0})

    missing = check_missing_evaluations(project_id, ["ocr_v1.tess.json", "ocr_v2.tess.json"])
    assert missing == ["ocr_v2.tess.json"]


def test_save_comparison_assigns_sequential_bmc_ids(temp_projects):
    first = save_comparison("p1", {"dataset_ids": ["DS0001"], "model_names": ["a.tess.json"]})
    second = save_comparison("p1", {"dataset_ids": ["DS0002"], "model_names": ["b.tess.json"]})
    other_project = save_comparison("p2", {"dataset_ids": ["DS0001"]})
    assert first["comparison_id"] == "BMC-0001"
    assert second["comparison_id"] == "BMC-0002"
    assert other_project["comparison_id"] == "BMC-0001"  # プロジェクト単位で独立採番
    # 評価結果自体は保存しない（比較条件のみ）
    assert "evaluation" not in first
    assert "cer" not in first


def test_list_comparisons_sorted_desc_and_get_by_id(temp_projects):
    save_comparison("p1", {"name": "first", "dataset_ids": ["DS0001"]})
    save_comparison("p1", {"name": "second", "dataset_ids": ["DS0002"]})
    items = list_comparisons("p1")
    assert [i["name"] for i in items] == ["second", "first"]
    found = get_comparison("p1", "BMC-0001")
    assert found["name"] == "first"
    assert get_comparison("p1", "BMC-9999") is None


def test_participation_counts_for_model_dataset_experiment(temp_projects):
    save_comparison(
        "p1",
        {
            "dataset_ids": ["DS0001", "DS0002"],
            "model_names": ["a.tess.json", "b.tess.json"],
            "experiment_ids": ["EXP-0001"],
        },
    )
    save_comparison("p1", {"dataset_ids": ["DS0001"], "model_names": ["a.tess.json"], "experiment_ids": ["EXP-0001"]})

    assert count_comparisons_for_dataset("p1", "DS0001") == 2
    assert count_comparisons_for_dataset("p1", "DS0002") == 1
    assert count_comparisons_for_model("p1", "a.tess.json") == 2
    assert count_comparisons_for_model("p1", "b.tess.json") == 1
    assert count_comparisons_for_experiment("p1", "EXP-0001") == 2
    assert build_dataset_participation_counts("p1") == {"DS0001": 2, "DS0002": 1}
    assert build_model_participation_counts("p1") == {"a.tess.json": 2, "b.tess.json": 1}
    assert build_experiment_participation_counts("p1") == {"EXP-0001": 2}


def test_api_benchmark_center_models_endpoint(temp_projects):
    project_id = "p1"
    folder = _write_dataset(project_id, "ds_a", "2026-07-01T00:00:00")
    _register_model_with_dataset(project_id, "ocr_v1", folder)
    resp = client.get("/api/benchmark-center/models", params={"project_id": project_id})
    assert resp.status_code == 200
    assert resp.json()["items"][0]["model_name"] == "ocr_v1.tess.json"


def test_api_benchmark_center_missing_evaluations_endpoint(temp_projects):
    project_id = "p1"
    folder = _write_dataset(project_id, "ds_a", "2026-07-01T00:00:00")
    _register_model_with_dataset(project_id, "ocr_v1", folder)
    resp = client.get(
        "/api/benchmark-center/missing-evaluations",
        params={"project_id": project_id, "model_names": "ocr_v1.tess.json"},
    )
    assert resp.status_code == 200
    assert resp.json()["missing"] == ["ocr_v1.tess.json"]


def test_api_benchmark_center_comparisons_create_and_list(temp_projects):
    project_id = "p1"
    resp = client.post(
        "/api/benchmark-center/comparisons",
        json={"project_id": project_id, "name": "比較A", "dataset_ids": ["DS0001"], "model_names": ["a.tess.json"]},
    )
    assert resp.status_code == 200
    comparison_id = resp.json()["item"]["comparison_id"]
    assert comparison_id == "BMC-0001"

    listed = client.get("/api/benchmark-center/comparisons", params={"project_id": project_id})
    assert len(listed.json()["items"]) == 1

    detail = client.get(f"/api/benchmark-center/comparisons/{comparison_id}", params={"project_id": project_id})
    assert detail.status_code == 200
    assert detail.json()["item"]["name"] == "比較A"

    assert client.get("/api/benchmark-center/comparisons/BMC-9999", params={"project_id": project_id}).status_code == 404


def test_api_benchmark_center_participation_endpoint(temp_projects):
    project_id = "p1"
    save_comparison(project_id, {"model_names": ["a.tess.json"]})
    resp = client.get(
        "/api/benchmark-center/participation", params={"project_id": project_id, "model_name": "a.tess.json"}
    )
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_dataset_detail_api_includes_benchmark_center_count(temp_projects):
    project_id = "p1"
    _write_dataset(project_id, "ds_a", "2026-07-01T00:00:00")
    dataset_id = client.get("/api/ocr/datasets", params={"project_id": project_id}).json()["items"][0]["dataset_id"]
    save_comparison(project_id, {"dataset_ids": [dataset_id]})

    resp = client.get(f"/api/ocr/datasets/{dataset_id}", params={"project_id": project_id})
    assert resp.status_code == 200
    assert resp.json()["benchmark_center_count"] == 1


def test_experiments_list_api_includes_benchmark_center_count(temp_projects):
    from src.app.services.experiment_tracker import record_experiment

    project_id = "p1"
    exp = record_experiment(project_id, {"models": ["a.tess.json"]})
    save_comparison(project_id, {"experiment_ids": [exp["experiment_id"]]})

    resp = client.get("/api/experiments", params={"project_id": project_id})
    assert resp.status_code == 200
    items = {row["experiment_id"]: row for row in resp.json()["items"]}
    assert items[exp["experiment_id"]]["benchmark_center_count"] == 1
