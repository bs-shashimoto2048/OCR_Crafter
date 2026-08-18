"""TrOCR Training Artifact Registration（Issue #96、`src/app/services/trocr_model_registry.py`）
のテスト。実モデルダウンロード・GPU・ネットワークに依存しない。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.trocr_model_registry import (
    TrocrModelRecord,
    TrocrRegistrationError,
    list_trocr_models,
    register_trocr_model,
)
from src.app.services.trocr_engine import TrOCREngine
from src.app.services.trocr_evaluation_predictor import TrOCREvaluationPredictor


def _make_artifact_dir(tmp_path: Path, name: str = "artifact") -> Path:
    artifact_dir = tmp_path / name
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "config.json").write_text("{}", encoding="utf-8")
    return artifact_dir


# ---------------------------------------------------------------------------
# register_trocr_model(): 正常系
# ---------------------------------------------------------------------------


def test_register_creates_sidecar_with_expected_fields(temp_projects, tmp_path):
    artifact_dir = _make_artifact_dir(tmp_path)
    record = register_trocr_model(
        "p1",
        job_id="job-1",
        model_dir=artifact_dir,
        base_model_ref="microsoft/trocr-base-printed",
        dataset_dir=str(tmp_path / "dataset"),
        epochs=3,
        batch_size=2,
        learning_rate=5e-5,
        final_loss=0.1234,
    )
    assert isinstance(record, TrocrModelRecord)
    assert record.name == "trocr_job-1.trocr.json"
    assert record.engine == "trocr"
    assert record.model_dir == artifact_dir.resolve()
    assert record.base_model_ref == "microsoft/trocr-base-printed"
    assert record.job_id == "job-1"
    assert record.epochs == 3
    assert record.batch_size == 2
    assert record.learning_rate == 5e-5
    assert record.final_loss == 0.1234

    paths = ensure_project_directories("p1")
    sidecar_path = paths.models / "trocr_job-1.trocr.json"
    assert sidecar_path.exists()
    payload = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert payload["engine"] == "trocr"
    assert payload["model_dir"] == str(artifact_dir.resolve())
    assert payload["job_id"] == "job-1"
    assert payload["base_model_ref"] == "microsoft/trocr-base-printed"
    assert payload["epochs"] == 3
    assert payload["created_at"]


def test_register_without_final_loss_stores_none(temp_projects, tmp_path):
    artifact_dir = _make_artifact_dir(tmp_path)
    record = register_trocr_model(
        "p1", job_id="job-2", model_dir=artifact_dir, base_model_ref="m", dataset_dir="",
        epochs=1, batch_size=1, learning_rate=1e-4,
    )
    assert record.final_loss is None
    assert record.dataset_id == ""  # dataset_dir未指定時はdataset_id解決も行わない


# ---------------------------------------------------------------------------
# register_trocr_model(): 異常系
# ---------------------------------------------------------------------------


def test_register_missing_job_id_raises(temp_projects, tmp_path):
    artifact_dir = _make_artifact_dir(tmp_path)
    with pytest.raises(TrocrRegistrationError, match="job_id is required"):
        register_trocr_model(
            "p1", job_id="   ", model_dir=artifact_dir, base_model_ref="m", dataset_dir="",
            epochs=1, batch_size=1, learning_rate=1e-4,
        )


def test_register_missing_artifact_dir_raises(temp_projects, tmp_path):
    with pytest.raises(TrocrRegistrationError, match="artifact directory not found"):
        register_trocr_model(
            "p1", job_id="job-3", model_dir=tmp_path / "does_not_exist", base_model_ref="m", dataset_dir="",
            epochs=1, batch_size=1, learning_rate=1e-4,
        )


def test_register_incomplete_artifact_missing_config_json_raises(temp_projects, tmp_path):
    incomplete_dir = tmp_path / "incomplete"
    incomplete_dir.mkdir()
    # config.jsonを書かない = 不完全なsave_pretrained()出力を模す
    with pytest.raises(TrocrRegistrationError, match="missing required file"):
        register_trocr_model(
            "p1", job_id="job-4", model_dir=incomplete_dir, base_model_ref="m", dataset_dir="",
            epochs=1, batch_size=1, learning_rate=1e-4,
        )


def test_register_duplicate_job_id_raises(temp_projects, tmp_path):
    artifact_dir = _make_artifact_dir(tmp_path)
    register_trocr_model(
        "p1", job_id="job-5", model_dir=artifact_dir, base_model_ref="m", dataset_dir="",
        epochs=1, batch_size=1, learning_rate=1e-4,
    )
    with pytest.raises(TrocrRegistrationError, match="already registered"):
        register_trocr_model(
            "p1", job_id="job-5", model_dir=artifact_dir, base_model_ref="m", dataset_dir="",
            epochs=1, batch_size=1, learning_rate=1e-4,
        )


def test_register_sidecar_write_failure_raises(temp_projects, tmp_path, monkeypatch):
    artifact_dir = _make_artifact_dir(tmp_path)

    def _raise(path, payload, indent=2):
        raise OSError("disk full")

    monkeypatch.setattr("src.app.services.trocr_model_registry.atomic_write_json", _raise)
    with pytest.raises(TrocrRegistrationError, match="failed to write model metadata"):
        register_trocr_model(
            "p1", job_id="job-6", model_dir=artifact_dir, base_model_ref="m", dataset_dir="",
            epochs=1, batch_size=1, learning_rate=1e-4,
        )


# ---------------------------------------------------------------------------
# Experiment Tracking（best-effort。失敗しても登録自体は成功する）
# ---------------------------------------------------------------------------


def test_experiment_recording_failure_does_not_fail_registration(temp_projects, tmp_path, monkeypatch):
    artifact_dir = _make_artifact_dir(tmp_path)

    def _raise(*args, **kwargs):
        raise RuntimeError("experiment tracker boom")

    monkeypatch.setattr("src.app.services.experiment_tracker.record_experiment", _raise)
    # 例外を送出せず正常に登録が完了すること
    record = register_trocr_model(
        "p1", job_id="job-7", model_dir=artifact_dir, base_model_ref="m", dataset_dir="",
        epochs=1, batch_size=1, learning_rate=1e-4,
    )
    assert record.job_id == "job-7"


def test_experiment_recording_receives_expected_payload(temp_projects, tmp_path, monkeypatch):
    artifact_dir = _make_artifact_dir(tmp_path)
    captured = {}

    def _fake_record_experiment(project_id, payload):
        captured["project_id"] = project_id
        captured["payload"] = payload
        return {}

    monkeypatch.setattr("src.app.services.experiment_tracker.record_experiment", _fake_record_experiment)
    register_trocr_model(
        "p1", job_id="job-8", model_dir=artifact_dir, base_model_ref="m", dataset_dir="",
        epochs=4, batch_size=8, learning_rate=2e-5, final_loss=0.5,
    )
    assert captured["project_id"] == "p1"
    payload = captured["payload"]
    assert payload["models"] == ["trocr_job-8.trocr.json"]
    assert payload["model_engine"] == "trocr"
    assert payload["training"]["epochs"] == 4
    assert payload["training"]["batch_size"] == 8
    assert payload["training"]["learning_rate"] == 2e-5
    assert payload["training"]["loss"] == 0.5
    assert payload["training"]["optimizer"] == "AdamW"


# ---------------------------------------------------------------------------
# list_trocr_models()
# ---------------------------------------------------------------------------


def test_list_trocr_models_empty_when_none_registered(temp_projects):
    assert list_trocr_models("p1") == []


def test_list_trocr_models_returns_registered_entries(temp_projects, tmp_path):
    artifact_dir = _make_artifact_dir(tmp_path)
    register_trocr_model(
        "p1", job_id="job-9", model_dir=artifact_dir, base_model_ref="m", dataset_dir="",
        epochs=1, batch_size=1, learning_rate=1e-4,
    )
    models = list_trocr_models("p1")
    assert len(models) == 1
    assert models[0]["job_id"] == "job-9"


def test_list_trocr_models_skips_malformed_json(temp_projects, tmp_path):
    paths = ensure_project_directories("p1")
    (paths.models / "trocr_broken.trocr.json").write_text("{not valid json", encoding="utf-8")
    assert list_trocr_models("p1") == []


def test_list_trocr_models_scoped_per_project(temp_projects, tmp_path):
    artifact_dir = _make_artifact_dir(tmp_path)
    register_trocr_model(
        "p1", job_id="job-10", model_dir=artifact_dir, base_model_ref="m", dataset_dir="",
        epochs=1, batch_size=1, learning_rate=1e-4,
    )
    assert list_trocr_models("p2") == []


# ---------------------------------------------------------------------------
# Inference / Evaluation Compatibility（Issue #96 Goals #6/#7）:
# 登録済みmodel_dirがそのまま既存TrOCREngine.load()/TrOCREvaluationPredictorの
# model_refとして渡せることを確認する。新しい解決層は存在しない（モジュールdocstring
# 参照）ため、fakeのfrom_pretrained()がmodel_dir文字列をそのまま受け取れることのみを
# 検証すれば契約として十分（実transformers/ネットワーク不使用、
# tests/test_trocr_engine.pyと同じmonkeypatch規約）。
# ---------------------------------------------------------------------------


class _FakeProcessor:
    def __init__(self, model_ref, local_files_only=False):
        self.model_ref = model_ref
        self.local_files_only = local_files_only


class _FakeModel:
    def __init__(self, model_ref, local_files_only=False):
        self.model_ref = model_ref
        self.local_files_only = local_files_only

    def to(self, device):
        return self

    def eval(self):
        pass


@pytest.fixture()
def fake_transformers(monkeypatch):
    import torch
    import transformers

    processors = []
    models = []

    def _fake_processor_from_pretrained(model_ref, local_files_only=False):
        fake = _FakeProcessor(model_ref, local_files_only)
        processors.append(fake)
        return fake

    def _fake_model_from_pretrained(model_ref, local_files_only=False):
        fake = _FakeModel(model_ref, local_files_only)
        models.append(fake)
        return fake

    monkeypatch.setattr(transformers.AutoProcessor, "from_pretrained", _fake_processor_from_pretrained)
    monkeypatch.setattr(transformers.VisionEncoderDecoderModel, "from_pretrained", _fake_model_from_pretrained)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    return {"processors": processors, "models": models}


def test_registered_model_dir_can_be_loaded_by_trocr_engine(temp_projects, tmp_path, fake_transformers):
    artifact_dir = _make_artifact_dir(tmp_path)
    record = register_trocr_model(
        "p1", job_id="job-11", model_dir=artifact_dir, base_model_ref="microsoft/trocr-base-printed",
        dataset_dir="", epochs=1, batch_size=1, learning_rate=1e-4,
    )
    engine = TrOCREngine.load(str(record.model_dir), local_files_only=True)
    assert engine.model_ref == str(record.model_dir)
    assert fake_transformers["processors"][0].model_ref == str(record.model_dir)
    assert fake_transformers["processors"][0].local_files_only is True


def test_registered_model_dir_can_be_used_by_evaluation_predictor(temp_projects, tmp_path, fake_transformers):
    artifact_dir = _make_artifact_dir(tmp_path)
    record = register_trocr_model(
        "p1", job_id="job-12", model_dir=artifact_dir, base_model_ref="microsoft/trocr-base-printed",
        dataset_dir="", epochs=1, batch_size=1, learning_rate=1e-4,
    )
    predictor = TrOCREvaluationPredictor(project_id="p1", model=str(record.model_dir), local_files_only=True)
    assert predictor.engine_id == "trocr"
    assert fake_transformers["models"][0].model_ref == str(record.model_dir)
