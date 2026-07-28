"""Dataset Manager / Model Lineage機能のテスト（services/dataset_registry.py）。

- Dataset一覧（作成日時降順・Dataset ID採番・使用モデル数のライブ集計）
- Dataset詳細（基本情報・前処理・学習設定・使用モデル一覧）
- Datasetコメント保存
- Datasetコピー（metadata複製・ID新規発行）
- Dataset削除影響確認・削除
- モデル登録時のdataset_id/dataset_name/dataset_created_at記録（Tesseract/PaddleOCR両エンジン）
"""

import json

from src.app.project_paths import ensure_project_directories
from src.app.services.dataset_registry import (
    check_dataset_delete_impact,
    copy_dataset,
    delete_dataset,
    get_dataset_detail,
    list_all_datasets,
    set_dataset_comment,
)
from src.app.services.model_registry import list_model_infos
from src.app.services.ocr_pipeline import _register_ocr_model
from src.app.services.tesseract_pipeline import register_tesseract_model


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
        "seed": 42,
        "preprocess_config_version": 3,
        "preprocess_config_saved_at": "2026-07-20T10:00:00",
        "training_preprocess_hash": "hash123",
        "skipped": {"no_label": 1, "too_long": 1},
    }
    if meta_overrides:
        meta.update(meta_overrides)
    (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return folder


def _write_tess_model(project_id: str, name: str, dataset_root, created_at: str = "2026-07-21T00:00:00"):
    models_dir = ensure_project_directories(project_id).models
    payload = {
        "created_at": created_at,
        "traineddata_path": "",
        "tessdata_dir": str(dataset_root),
        "model_dir": str(dataset_root),
        "lang": "custom",
        "base_lang": "eng",
        "dataset_root": str(dataset_root),
    }
    path = models_dir / f"{name}.tess.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def test_list_all_datasets_sorted_by_created_at_desc(temp_projects):
    _write_dataset("p1", "ds_old", "2026-07-01T00:00:00")
    _write_dataset("p1", "ds_new", "2026-07-15T00:00:00")
    items = list_all_datasets("p1")
    assert [item["folder_name"] for item in items] == ["ds_new", "ds_old"]


def test_list_all_datasets_fields_and_id_assignment(temp_projects):
    _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    items = list_all_datasets("p1")
    item = items[0]
    assert item["dataset_id"] == "DS0001"
    assert item["counts"] == {"train": 8, "val": 1, "test": 1}
    assert item["input_count"] == 12
    assert item["charset"] == "ABC"
    assert item["preprocess_config_version"] == 3
    assert item["training_preprocess_hash"] == "hash123"
    assert item["model_count"] == 0
    assert item["model_names"] == []


def test_dataset_id_stable_across_calls(temp_projects):
    _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    first = list_all_datasets("p1")[0]["dataset_id"]
    second = list_all_datasets("p1")[0]["dataset_id"]
    assert first == second == "DS0001"


def test_dataset_id_assigned_in_created_at_order(temp_projects):
    _write_dataset("p1", "ds_b_newer", "2026-07-16T00:00:00")
    _write_dataset("p1", "ds_a_older", "2026-07-15T00:00:00")
    ids = {item["folder_name"]: item["dataset_id"] for item in list_all_datasets("p1")}
    assert ids["ds_a_older"] == "DS0001"
    assert ids["ds_b_newer"] == "DS0002"


def test_list_all_datasets_model_count_cross_reference(temp_projects):
    folder = _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    _write_tess_model("p1", "m1", folder)
    _write_tess_model("p1", "m2", folder)
    item = list_all_datasets("p1")[0]
    assert item["model_count"] == 2
    assert sorted(item["model_names"]) == ["m1.tess.json", "m2.tess.json"]


def test_get_dataset_detail_full_fields(temp_projects):
    folder = _write_dataset(
        "p1", "ds_a", "2026-07-01T00:00:00",
        meta_overrides={"display_name": "OCRDataset_v3", "comment": "初期版"},
    )
    _write_tess_model("p1", "m1", folder)
    dataset_id = list_all_datasets("p1")[0]["dataset_id"]
    detail = get_dataset_detail("p1", dataset_id)
    assert detail["name"] == "OCRDataset_v3"
    assert detail["comment"] == "初期版"
    assert detail["preprocess"]["version"] == 3
    assert detail["preprocess"]["hash"] == "hash123"
    assert detail["training_settings"]["train_ratio"] == 0.7
    assert detail["training_settings"]["charset"] == "ABC"
    assert detail["training_settings"]["input_count"] == 12
    assert detail["training_settings"]["excluded_count"] == 2
    assert detail["training_settings"]["rotation"] == {"enabled": False, "max_degrees": None}
    assert detail["counts"] == {"train": 8, "val": 1, "test": 1}
    assert [m["name"] for m in detail["models"]] == ["m1.tess.json"]


def test_get_dataset_detail_returns_none_for_unknown_id(temp_projects):
    assert get_dataset_detail("p1", "DS9999") is None


def test_set_dataset_comment_supports_multiline(temp_projects):
    _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    dataset_id = list_all_datasets("p1")[0]["dataset_id"]
    comment = "CLAHE追加版\nノイズ画像追加\n文字数500→700へ増加"
    updated = set_dataset_comment("p1", dataset_id, comment)
    assert updated["comment"] == comment
    assert get_dataset_detail("p1", dataset_id)["comment"] == comment


def test_check_dataset_delete_impact_reports_linked_models(temp_projects):
    folder = _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    _write_tess_model("p1", "OCR_v2", folder)
    _write_tess_model("p1", "OCR_v4", folder)
    dataset_id = list_all_datasets("p1")[0]["dataset_id"]
    impact = check_dataset_delete_impact("p1", dataset_id)
    assert impact["model_count"] == 2
    assert sorted(impact["model_names"]) == ["OCR_v2.tess.json", "OCR_v4.tess.json"]


def test_delete_dataset_removes_folder(temp_projects):
    folder = _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    dataset_id = list_all_datasets("p1")[0]["dataset_id"]
    assert delete_dataset("p1", dataset_id) is True
    assert not folder.exists()
    assert get_dataset_detail("p1", dataset_id) is None


def test_copy_dataset_creates_new_folder_and_id(temp_projects):
    folder = _write_dataset(
        "p1", "OCRDataset_v3", "2026-07-01T00:00:00",
        meta_overrides={"display_name": "OCRDataset_v3"},
    )
    (folder / "dataset.txt").write_text("dummy", encoding="utf-8")
    original_id = list_all_datasets("p1")[0]["dataset_id"]

    copied = copy_dataset("p1", original_id)

    assert copied is not None
    assert copied["name"] == "OCRDataset_v3_Copy"
    assert copied["dataset_id"] != original_id
    assert copied["comment"] == ""
    all_items = list_all_datasets("p1")
    assert len(all_items) == 2
    copied_folder_item = next(item for item in all_items if item["dataset_id"] == copied["dataset_id"])
    copied_folder = folder.parent / copied_folder_item["folder_name"]
    assert (copied_folder / "dataset.txt").is_file()
    assert (copied_folder / "meta.json").is_file()
    copied_meta = json.loads((copied_folder / "meta.json").read_text(encoding="utf-8"))
    assert copied_meta["copied_from_dataset_folder"] == "OCRDataset_v3"
    # 元のDatasetは変更されない
    assert folder.exists()
    assert get_dataset_detail("p1", original_id)["name"] == "OCRDataset_v3"


def test_model_deletion_does_not_touch_dataset(temp_projects):
    """Model削除時はDataset側のリンクだけ解除される（Dataset自体は削除しない）。
    live cross-reference設計のため、モデルファイル削除だけでmodel_countが自動的に0へ戻る。"""
    from src.app.services.model_registry import delete_model

    folder = _write_dataset("p1", "ds_a", "2026-07-01T00:00:00")
    _write_tess_model("p1", "m1", folder)
    dataset_id = list_all_datasets("p1")[0]["dataset_id"]
    assert check_dataset_delete_impact("p1", dataset_id)["model_count"] == 1

    delete_model(project_id="p1", model_name="m1.tess.json")

    assert folder.exists()
    assert check_dataset_delete_impact("p1", dataset_id)["model_count"] == 0


def test_register_tesseract_model_records_dataset_lineage(temp_projects):
    folder = _write_dataset(
        "p1", "ds_a", "2026-07-01T00:00:00", meta_overrides={"display_name": "OCRDataset_v1"}
    )
    meta_path = register_tesseract_model(
        project_id="p1",
        lang="lineage_model",
        traineddata_path=folder / "lineage_model.traineddata",
        tessdata_dir=folder,
        base_lang="eng",
        charset="ABC",
        dataset_root=str(folder),
        counts={"train": 8, "val": 1, "test": 1},
        job_id="job-1",
        max_iterations=1000,
    )
    payload = json.loads(meta_path.read_text(encoding="utf-8"))
    assert payload["dataset_name"] == "OCRDataset_v1"
    assert payload["dataset_created_at"] == "2026-07-01T00:00:00"
    assert payload["dataset_id"] != ""

    info = {item["name"]: item for item in list_model_infos("p1")}["lineage_model.tess.json"]
    assert info["dataset_name"] == "OCRDataset_v1"
    assert info["dataset_id"] == payload["dataset_id"]


def test_register_ocr_model_records_dataset_lineage(temp_projects):
    folder = _write_dataset(
        "p1", "ds_b", "2026-07-02T00:00:00", meta_overrides={"display_name": "OCRDataset_v2"}
    )
    name = _register_ocr_model(
        project_id="p1",
        engine="paddleocr",
        checkpoint_dir=folder,
        inference_dir=folder,
        charset="ABC",
        max_text_length=32,
        image_shape=[3, 32, 320],
        dataset_root=folder,
        job_id="job-2",
        epochs=10,
        batch_size=8,
        learning_rate=0.001,
    )
    meta_path = ensure_project_directories("p1").models / name
    payload = json.loads(meta_path.read_text(encoding="utf-8"))
    assert payload["dataset_name"] == "OCRDataset_v2"
    assert payload["dataset_created_at"] == "2026-07-02T00:00:00"
    assert payload["dataset_id"] != ""

    info = {item["name"]: item for item in list_model_infos("p1")}[name]
    assert info["dataset_name"] == "OCRDataset_v2"
    assert info["dataset_id"] == payload["dataset_id"]


def test_register_tesseract_model_backward_compatible_without_dataset_meta(temp_projects):
    """Datasetのmeta.jsonが無い（旧データ・実験用パス）場合もエラーにせずフォルダ名/空値で記録する。"""
    paths = ensure_project_directories("p1")
    dataset_root = paths.outputs / "ocr_dataset" / "no_meta_dataset"
    dataset_root.mkdir(parents=True, exist_ok=True)
    meta_path = register_tesseract_model(
        project_id="p1",
        lang="plain_model",
        traineddata_path=dataset_root / "plain_model.traineddata",
        tessdata_dir=dataset_root,
        base_lang="eng",
        charset="ABC",
        dataset_root=str(dataset_root),
        counts={"train": 1, "val": 0, "test": 0},
        job_id="job-3",
        max_iterations=100,
    )
    payload = json.loads(meta_path.read_text(encoding="utf-8"))
    assert payload["dataset_name"] == "no_meta_dataset"
    assert payload["dataset_created_at"] == ""
