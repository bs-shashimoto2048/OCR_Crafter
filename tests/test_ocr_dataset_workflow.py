"""学習データ作成フローの明確化: 対象/ラベル済み件数の内訳・最新データセット検出・
PaddleOCR train/start の dataset_dir 必須チェックのテスト。

分割計算・Split Seed・Dataset Formatは変更していないため、既存の
test_dataset_split_augmentation.py の分割系テストと重複しない観点のみを扱う。
"""

from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request as StarletteRequest

import numpy as np
import pytest
from PIL import Image

import src.app.main as main_module
from src.app import db as db_module
from src.app.schemas import OcrTrainStartRequest
from src.app.services.ocr_pipeline import create_ocr_dataset, find_latest_ocr_dataset, preview_ocr_dataset_split


def _dummy_request():
    return StarletteRequest(
        {"type": "http", "method": "POST", "path": "/", "headers": [], "query_string": b"", "client": ("127.0.0.1", 0)}
    )


def _setup_labeled_project(temp_projects, rows) -> str:
    """(filename, label) のリストからwide画像とmaster.csvを作る。labelが空文字の行はラベル未入力扱い。"""
    project_id = "p1"
    root = temp_projects["projects_dir"] / project_id
    images_dir = root / "processed" / "wide" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    lines = ["filename,label,type"]
    for i, (name, label) in enumerate(rows):
        arr = np.full((32, 96), 255, dtype=np.uint8)
        arr[:, (i * 3) % 90 : (i * 3) % 90 + 4] = 0
        Image.fromarray(arr, mode="L").save(images_dir / name)
        lines.append(f"{name},{label},wide")
    annotations = root / "annotations"
    annotations.mkdir(parents=True, exist_ok=True)
    (annotations / "master.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return project_id


# ---------- 対象画像数・ラベル済み件数・除外内訳（charset外を区別） ----------


def test_preview_reports_target_labeled_and_skip_breakdown(temp_projects):
    rows = [
        ("img_0000.png", "AB1"),  # 有効
        ("img_0001.png", "AB2"),  # 有効
        ("img_0002.png", ""),  # ラベル未入力（空）
        ("img_0003.png", "??9"),  # charset外
        ("img_0004.png", "AB0123456"),  # charset内だが長さ超過（9文字 > max_text_length=8）
    ]
    project_id = _setup_labeled_project(temp_projects, rows)

    preview = preview_ocr_dataset_split(
        project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1,
    )

    assert preview["input_count"] == 5
    assert preview["target_count"] == 5  # 全行がwide種別
    assert preview["labeled_count"] == 4  # ラベル入力済み（charset外・長さ超過も含む）
    assert preview["valid_count"] == 2  # 分割対象は従来どおり変更なし
    assert preview["skipped"]["empty_label"] == 1
    assert preview["skipped"]["charset_invalid"] == 1
    assert preview["skipped"]["length_exceeded"] == 1
    # 後方互換: 合算値は従来どおり3件（空+charset外+長さ超過）
    assert preview["skipped"]["invalid_label"] == 3


def test_preview_target_count_excludes_non_selected_image_type(temp_projects):
    project_id = "p1"
    root = temp_projects["projects_dir"] / project_id
    wide_dir = root / "processed" / "wide" / "images"
    single_dir = root / "processed" / "single" / "images"
    wide_dir.mkdir(parents=True, exist_ok=True)
    single_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.full((32, 96), 255, dtype=np.uint8), mode="L").save(wide_dir / "w0.png")
    Image.fromarray(np.full((32, 32), 255, dtype=np.uint8), mode="L").save(single_dir / "s0.png")
    annotations = root / "annotations"
    annotations.mkdir(parents=True, exist_ok=True)
    (annotations / "master.csv").write_text(
        "filename,label,type\nw0.png,AB1,wide\ns0.png,C,single\n", encoding="utf-8"
    )

    preview = preview_ocr_dataset_split(
        project_id=project_id, image_types=["wide"], charset="ABC0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1,
    )
    assert preview["input_count"] == 2
    assert preview["target_count"] == 1  # single行は対象外
    assert preview["labeled_count"] == 1


def test_preview_zero_images_reports_zero_counts(temp_projects):
    project_id = "p1"
    root = temp_projects["projects_dir"] / project_id
    (root / "annotations").mkdir(parents=True, exist_ok=True)
    (root / "annotations" / "master.csv").write_text("filename,label,type\n", encoding="utf-8")

    preview = preview_ocr_dataset_split(
        project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1,
    )
    assert preview["input_count"] == 0
    assert preview["target_count"] == 0
    assert preview["labeled_count"] == 0
    assert preview["valid_count"] == 0
    assert sum(preview["counts"].values()) == 0


# ---------- find_latest_ocr_dataset（読み取り専用・reload後の再検出） ----------


def _labeled_project_for_dataset(temp_projects, count: int = 10) -> str:
    rows = [(f"img_{i:04d}.png", f"AB{i % 10}") for i in range(count)]
    return _setup_labeled_project(temp_projects, rows)


def test_find_latest_ocr_dataset_none_when_not_created(temp_projects):
    project_id = _labeled_project_for_dataset(temp_projects)
    assert find_latest_ocr_dataset(project_id) is None


def test_find_latest_ocr_dataset_single(temp_projects):
    project_id = _labeled_project_for_dataset(temp_projects)
    result = create_ocr_dataset(
        project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=42,
    )
    latest = find_latest_ocr_dataset(project_id)
    assert latest is not None
    assert latest["dataset_root"] == str(__import__("pathlib").Path(result["dataset_root"]).resolve())
    assert latest["source"] == "new"
    assert latest["dataset_id"].startswith("DS-")
    assert latest["counts"] == result["counts"]
    assert latest["charset"] == "AB0123456789"
    assert latest["seed"] == 42


def test_find_latest_ocr_dataset_picks_most_recent_created_at(temp_projects):
    from pathlib import Path

    from src.app.project_paths import ensure_project_directories

    project_id = _labeled_project_for_dataset(temp_projects)
    outputs_dir = ensure_project_directories(project_id).outputs / "ocr_dataset"
    first = create_ocr_dataset(
        project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=1,
        output_dir=str(outputs_dir / "ds_first"),
    )
    second = create_ocr_dataset(
        project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=2,
        output_dir=str(outputs_dir / "ds_second"),
    )

    latest = find_latest_ocr_dataset(project_id)
    assert latest is not None
    assert latest["dataset_root"] == str(Path(second["dataset_root"]).resolve())
    assert latest["dataset_root"] != str(Path(first["dataset_root"]).resolve())
    assert latest["seed"] == 2


def test_api_ocr_dataset_latest_endpoint_wraps_find_latest(temp_projects):
    project_id = _labeled_project_for_dataset(temp_projects)
    empty = main_module.api_ocr_dataset_latest(project_id=project_id)
    assert empty["dataset"] is None

    create_ocr_dataset(
        project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=42,
    )
    data = main_module.api_ocr_dataset_latest(project_id=project_id)
    assert data["project_id"] == project_id
    assert data["dataset"] is not None
    assert data["dataset"]["dataset_id"].startswith("DS-")


# ---------- PaddleOCR train/start: dataset_dir 必須チェック（Tesseractと揃える） ----------


def test_ocr_train_start_rejects_empty_dataset_dir(temp_projects, monkeypatch):
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    req = OcrTrainStartRequest(project_id="p1", engine="paddleocr", dataset_dir="")
    with pytest.raises(HTTPException) as exc:
        main_module.api_ocr_train_start(req, BackgroundTasks(), _dummy_request())
    assert exc.value.status_code == 400
    assert "dataset_dir" in str(exc.value.detail)


def test_ocr_train_start_rejects_missing_dataset_dir(temp_projects, monkeypatch, tmp_path):
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    missing = tmp_path / "no_such_dataset_dir"
    req = OcrTrainStartRequest(project_id="p1", engine="paddleocr", dataset_dir=str(missing))
    with pytest.raises(HTTPException) as exc:
        main_module.api_ocr_train_start(req, BackgroundTasks(), _dummy_request())
    assert exc.value.status_code == 404


def test_ocr_train_start_job_references_validated_dataset_dir(temp_projects, monkeypatch, tmp_path):
    """学習Jobが、検証済み（strip後）のdataset_dirを正しく参照することを確認する。"""
    db_path = tmp_path / "app.db"
    monkeypatch.setattr(db_module, "_db_path", lambda: db_path)
    db_module.init_db()

    dataset_dir = tmp_path / "dataset_ok"
    dataset_dir.mkdir()

    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    monkeypatch.setattr(main_module, "_spawn_training_runner", lambda job_type, job_id: 4242)

    req = OcrTrainStartRequest(
        project_id="p1", engine="paddleocr", dataset_dir=f"  {dataset_dir}  ",  # 前後空白は strip される
    )
    result = main_module.api_ocr_train_start(req, BackgroundTasks(), _dummy_request())
    assert result["status"] == "queued"

    job = db_module.fetch_training_job(result["job_id"])
    assert job is not None
    assert job["dataset_dir"] == str(dataset_dir)
