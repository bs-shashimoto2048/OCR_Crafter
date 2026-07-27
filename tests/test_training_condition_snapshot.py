"""学習前処理・オーグメンテーションの実効値スナップショットのテスト。

- build_effective_augmentation: weak/medium実効値・未設定はenabled=False
- compute_augmentation_hash: 安定性（同一設定=同一Hash・変更で別Hash）
- build_training_condition_snapshot: データセットmeta.jsonからのスナップショット組み立て
- Jobレコード（training_jobs）へのスナップショット保存・読み出しの往復
- register_tesseract_model: Jobスナップショット優先・無ければデータセットmeta.jsonへフォールバック
- api_tesseract_train_start / api_ocr_train_start: Job作成時点でのスナップショット確定保存
"""

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
from PIL import Image
from starlette.requests import Request as StarletteRequest

import src.app.main as main_module
from src.app import db as db_module
from src.app.schemas import OcrTrainStartRequest, TesseractTrainStartRequest
from src.app.services.ocr_pipeline import (
    build_effective_augmentation,
    build_training_condition_snapshot,
    compute_augmentation_hash,
    create_ocr_dataset,
    parse_augmentation_config,
)
from src.app.services.preprocess import run_preprocess
from src.app.services.tesseract_pipeline import register_tesseract_model


def _dummy_request():
    return StarletteRequest(
        {"type": "http", "method": "POST", "path": "/", "headers": [], "query_string": b"", "client": ("127.0.0.1", 0)}
    )


WEAK = {
    "preset": "weak",
    "multiplier": 1.5,
    "rotation": {"enabled": True, "max_degrees": 2.0, "probability": 0.3},
    "brightness": {"enabled": True, "range": 0.1, "probability": 0.3},
    "contrast": {"enabled": True, "range": 0.1, "probability": 0.3},
    "blur": {"enabled": True, "strength": "weak", "probability": 0.1},
    "noise": {"enabled": True, "strength": "weak", "probability": 0.1},
}


class TestBuildEffectiveAugmentation:
    def test_weak_effective_values(self):
        built = build_effective_augmentation(WEAK)
        assert built["enabled"] is True
        assert built["effective"]["rotation"] == {"minDegrees": -2.0, "maxDegrees": 2.0, "probability": 0.3}
        assert built["effective"]["blur"]["radiusMin"] == 0.3
        assert built["effective"]["blur"]["radiusMax"] == 0.6
        assert built["effective"]["noise"]["sigma"] == 3.0

    def test_medium_strength_effective_values(self):
        config = {**WEAK, "blur": {"enabled": True, "strength": "medium", "probability": 0.1}, "noise": {"enabled": True, "strength": "medium", "probability": 0.1}}
        built = build_effective_augmentation(config)
        assert built["effective"]["blur"]["radiusMin"] == 0.5
        assert built["effective"]["blur"]["radiusMax"] == 0.9
        assert built["effective"]["noise"]["sigma"] == 6.0

    def test_none_or_all_disabled_returns_disabled(self):
        assert build_effective_augmentation(None)["enabled"] is False
        disabled = {"preset": "custom", "rotation": {"enabled": False}, "brightness": {}, "contrast": {}, "blur": {}, "noise": {}}
        assert build_effective_augmentation(disabled)["enabled"] is False


class TestComputeAugmentationHash:
    def test_same_config_same_hash(self):
        a = compute_augmentation_hash(parse_augmentation_config(WEAK))
        b = compute_augmentation_hash(parse_augmentation_config(dict(WEAK)))
        assert a == b
        assert a.startswith("sha256:")

    def test_different_config_different_hash(self):
        a = compute_augmentation_hash(parse_augmentation_config(WEAK))
        changed = {**WEAK, "rotation": {"enabled": True, "max_degrees": 5.0, "probability": 0.3}}
        b = compute_augmentation_hash(parse_augmentation_config(changed))
        assert a != b

    def test_none_returns_none(self):
        assert compute_augmentation_hash(None) is None


def _setup_labeled_project(temp_projects, count: int, project_id: str = "p1") -> str:
    root = temp_projects["projects_dir"] / project_id
    images_dir = root / "processed" / "wide" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    lines = ["filename,label,type"]
    for i in range(count):
        name = f"img_{i:04d}.png"
        arr = np.full((32, 96), 255, dtype=np.uint8)
        arr[:, (i * 3) % 90 : (i * 3) % 90 + 4] = 0
        Image.fromarray(arr, mode="L").save(images_dir / name)
        lines.append(f"{name},AB{i % 10},wide")
    annotations = root / "annotations"
    annotations.mkdir(parents=True, exist_ok=True)
    (annotations / "master.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return project_id


class TestBuildTrainingConditionSnapshot:
    def test_snapshot_from_dataset_with_preprocess_and_augmentation(self, temp_projects):
        project_id = _setup_labeled_project(temp_projects, 20)
        # 前処理スナップショットを保存済みにしておく（training_preprocessが記録される条件）
        run_preprocess(project_id=project_id, overrides={})
        result = create_ocr_dataset(
            project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
            train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=42,
            augmentation=WEAK,
        )
        snapshot = build_training_condition_snapshot(result["dataset_root"])
        assert snapshot is not None
        assert snapshot["trainingPreprocess"]["hash"] is not None
        assert snapshot["trainingPreprocess"]["display"] is not None
        assert snapshot["augmentation"]["hash"] is not None
        assert snapshot["augmentation"]["effective"]["noise"]["sigma"] == 3.0
        assert snapshot["trainingInputPipelineHash"] is not None

    def test_snapshot_none_without_dataset(self, temp_projects):
        assert build_training_condition_snapshot(str(temp_projects["tmp"] / "no_such_dir")) is None

    def test_snapshot_without_augmentation_has_null_augmentation_fields(self, temp_projects):
        project_id = _setup_labeled_project(temp_projects, 10, project_id="p2")
        result = create_ocr_dataset(
            project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
            train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=42,
        )
        snapshot = build_training_condition_snapshot(result["dataset_root"])
        assert snapshot is not None
        assert snapshot["augmentation"]["display"] is None
        assert snapshot["augmentation"]["hash"] is None


class TestJobSnapshotRoundTrip:
    def test_upsert_and_fetch_preserve_snapshot(self, monkeypatch, tmp_path):
        monkeypatch.setattr(db_module, "_db_path", lambda: tmp_path / "app.db")
        db_module.init_db()
        snapshot = {
            "trainingPreprocess": {"display": {"steps": {}}, "effective": {"channels": 3}, "hash": "sha256:aaa"},
            "augmentation": {"display": WEAK, "effective": {"noise": {"sigma": 3.0}}, "hash": "sha256:bbb"},
            "trainingInputPipelineHash": "sha256:ccc",
        }
        db_module.upsert_training_job(
            {
                "id": "job-snap-1",
                "project_id": "p1",
                "model_type": "ocr",
                "epochs": 1,
                "batch_size": 1,
                "status": "queued",
                "training_condition_snapshot": snapshot,
                "created_at": "2026-07-24T10:00:00",
                "updated_at": "2026-07-24T10:00:00",
            }
        )
        fetched = db_module.fetch_training_job("job-snap-1")
        assert fetched["training_condition_snapshot"] == snapshot

    def test_status_update_preserves_snapshot(self, monkeypatch, tmp_path):
        """既存の {**job, ...} 更新パターンで、途中のstatus更新がスナップショットを消さないこと。"""
        monkeypatch.setattr(db_module, "_db_path", lambda: tmp_path / "app.db")
        db_module.init_db()
        snapshot = {"trainingPreprocess": {"hash": "sha256:xyz"}, "augmentation": {"hash": None}, "trainingInputPipelineHash": None}
        db_module.upsert_training_job(
            {
                "id": "job-snap-2",
                "project_id": "p1",
                "model_type": "ocr",
                "epochs": 1,
                "batch_size": 1,
                "status": "queued",
                "training_condition_snapshot": snapshot,
                "created_at": "2026-07-24T10:00:00",
                "updated_at": "2026-07-24T10:00:00",
            }
        )
        current = db_module.fetch_training_job("job-snap-2")
        db_module.upsert_training_job({**current, "status": "running", "updated_at": "2026-07-24T10:05:00"})
        after = db_module.fetch_training_job("job-snap-2")
        assert after["training_condition_snapshot"] == snapshot
        assert after["status"] == "running"

    def test_no_snapshot_returns_none(self, monkeypatch, tmp_path):
        monkeypatch.setattr(db_module, "_db_path", lambda: tmp_path / "app.db")
        db_module.init_db()
        db_module.upsert_training_job(
            {
                "id": "job-no-snap",
                "project_id": "p1",
                "model_type": "ocr",
                "epochs": 1,
                "batch_size": 1,
                "status": "queued",
                "created_at": "2026-07-24T10:00:00",
                "updated_at": "2026-07-24T10:00:00",
            }
        )
        fetched = db_module.fetch_training_job("job-no-snap")
        assert fetched["training_condition_snapshot"] is None


class TestRegisterTesseractModelUsesJobSnapshot:
    def _make_dataset(self, temp_projects, project_id="p1", count=10):
        _setup_labeled_project(temp_projects, count, project_id=project_id)
        run_preprocess(project_id=project_id, overrides={})
        result = create_ocr_dataset(
            project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
            train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=42, augmentation=WEAK,
        )
        return result["dataset_root"]

    def test_prefers_job_snapshot_over_dataset_meta(self, temp_projects, monkeypatch, tmp_path):
        monkeypatch.setattr(db_module, "_db_path", lambda: tmp_path / "app.db")
        db_module.init_db()
        dataset_root = self._make_dataset(temp_projects)

        # Jobには、データセット自体のmeta.jsonとは明確に異なる（見分けが付く）スナップショットを保存しておく
        distinct_snapshot = {
            "trainingPreprocess": {"display": {"marker": "from-job"}, "effective": {}, "hash": "sha256:job-preprocess-hash"},
            "augmentation": {"display": {"marker": "from-job"}, "effective": {}, "hash": "sha256:job-aug-hash"},
            "trainingInputPipelineHash": "sha256:job-combined-hash",
        }
        db_module.upsert_training_job(
            {
                "id": "job-priority-1",
                "project_id": "p1",
                "model_type": "ocr",
                "epochs": 1,
                "batch_size": 1,
                "status": "running",
                "training_condition_snapshot": distinct_snapshot,
                "created_at": "2026-07-24T10:00:00",
                "updated_at": "2026-07-24T10:00:00",
            }
        )

        meta_path = register_tesseract_model(
            project_id="p1",
            lang="testlang",
            traineddata_path=Path(dataset_root) / "fake.traineddata",
            tessdata_dir=Path(dataset_root),
            base_lang="eng",
            charset="AB0123456789",
            dataset_root=dataset_root,
            counts={"train": 8, "val": 1, "test": 1},
            job_id="job-priority-1",
            max_iterations=100,
        )
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        assert meta["training_preprocess_hash"] == "sha256:job-preprocess-hash"
        assert meta["augmentation_hash"] == "sha256:job-aug-hash"
        assert meta["training_input_pipeline_hash"] == "sha256:job-combined-hash"
        assert meta["training_preprocess"] == {"marker": "from-job"}
        assert meta["augmentation_config"] == {"marker": "from-job"}

    def test_falls_back_to_dataset_meta_when_no_job_snapshot(self, temp_projects, monkeypatch, tmp_path):
        monkeypatch.setattr(db_module, "_db_path", lambda: tmp_path / "app.db")
        db_module.init_db()
        dataset_root = self._make_dataset(temp_projects, project_id="p3")
        dataset_meta = json.loads((Path(dataset_root) / "meta.json").read_text(encoding="utf-8"))

        # job_idに対応するJobレコードが存在しない（旧フロー・job_manager経由等を模す）
        meta_path = register_tesseract_model(
            project_id="p3",
            lang="testlang2",
            traineddata_path=Path(dataset_root) / "fake.traineddata",
            tessdata_dir=Path(dataset_root),
            base_lang="eng",
            charset="AB0123456789",
            dataset_root=dataset_root,
            counts={"train": 8, "val": 1, "test": 1},
            job_id="job-does-not-exist",
            max_iterations=100,
        )
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        assert meta["training_preprocess_hash"] == dataset_meta["training_preprocess_hash"]
        assert meta["augmentation_hash"] == dataset_meta["augmentation_hash"]
        assert meta["training_input_pipeline_hash"] == dataset_meta["training_input_pipeline_hash"]


class TestTrainingPreprocessCurrentEndpoint:
    def test_returns_none_when_never_preprocessed(self, temp_projects):
        client = TestClient(main_module.app)
        resp = client.get("/api/ocr/training-preprocess/current", params={"project_id": "p_never_run"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["training_preprocess"] is None
        assert data["training_preprocess_hash"] is None

    def test_returns_snapshot_after_preprocess_run(self, temp_projects):
        project_id = _setup_labeled_project(temp_projects, 5, project_id="p_current")
        run_preprocess(project_id=project_id, overrides={})
        client = TestClient(main_module.app)
        resp = client.get("/api/ocr/training-preprocess/current", params={"project_id": project_id})
        data = resp.json()
        assert data["training_preprocess"] is not None
        assert data["training_preprocess_hash"] is not None


class TestTrainStartCapturesSnapshotAtCreation:
    def test_tesseract_train_start_stores_snapshot_on_job(self, temp_projects, monkeypatch, tmp_path):
        monkeypatch.setattr(db_module, "_db_path", lambda: tmp_path / "app.db")
        db_module.init_db()
        project_id = _setup_labeled_project(temp_projects, 10)
        run_preprocess(project_id=project_id, overrides={})
        result = create_ocr_dataset(
            project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
            train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=42, augmentation=WEAK,
        )
        monkeypatch.setattr(main_module, "ensure_tesseract_training_tools", lambda: None)
        monkeypatch.setattr(main_module, "_spawn_training_runner", lambda job_type, job_id: 4242)
        monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
        req = TesseractTrainStartRequest(project_id=project_id, dataset_dir=result["dataset_root"], max_iterations=10)
        resp = main_module.api_tesseract_train_start(req, _dummy_request())
        job = db_module.fetch_training_job(resp["job_id"])
        assert job["training_condition_snapshot"] is not None
        assert job["training_condition_snapshot"]["trainingPreprocess"]["hash"] is not None
        assert job["training_condition_snapshot"]["augmentation"]["hash"] is not None

    def test_ocr_train_start_stores_snapshot_on_job(self, temp_projects, monkeypatch, tmp_path):
        monkeypatch.setattr(db_module, "_db_path", lambda: tmp_path / "app.db")
        db_module.init_db()
        project_id = _setup_labeled_project(temp_projects, 10, project_id="p_paddle")
        run_preprocess(project_id=project_id, overrides={})
        result = create_ocr_dataset(
            project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
            train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=42,
        )
        monkeypatch.setattr(main_module, "_resolve_paddleocr_repo_dir", lambda v: str(temp_projects["tmp"] / "paddle_repo"))
        monkeypatch.setattr(main_module, "_spawn_training_runner", lambda job_type, job_id: 4343)
        monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
        monkeypatch.setattr(main_module, "_system_check_snapshot", lambda: {"paddle_gpu_available": False, "gpu_available": False})
        req = OcrTrainStartRequest(
            project_id=project_id, engine="paddleocr", dataset_dir=result["dataset_root"],
            charset="AB0123456789", max_text_length=8, image_shape=[3, 48, 320], epochs=1, batch_size=1,
        )
        resp = main_module.api_ocr_train_start(req, BackgroundTasks(), _dummy_request())
        job = db_module.fetch_training_job(resp["job_id"])
        assert job["training_condition_snapshot"] is not None
        assert job["training_condition_snapshot"]["trainingPreprocess"]["hash"] is not None
