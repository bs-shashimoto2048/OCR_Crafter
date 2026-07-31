"""Training Metadata Factory（src/app/services/training_metadata_factory.py）の単体テスト。

Training Metadata Factory実装Issue（#42、Epic #28配下・Migration Phase 4）のスコープ通り、
`ModelMetadataFactory.create_from_training()`が純粋に`ModelMetadata`を生成することのみを
検証する。Filesystemアクセス・Reader・Writer・Model Catalogは対象外（Factoryはこれらを
一切利用しない）。
"""

from datetime import datetime

import pytest

from src.app.services.model_metadata import (
    MODEL_METADATA_SCHEMA_VERSION,
    InvalidModelMetadataError,
    ModelMetadata,
)
from src.app.services.training_metadata_factory import (
    ModelMetadataFactory,
    TrainingMetadataFactoryError,
)

# ---------------------------------------------------------------------------
# Normal
# ---------------------------------------------------------------------------


def test_create_from_training_normal_returns_model_metadata():
    result = ModelMetadataFactory.create_from_training(
        model_id="ocr_paddleocr_20260101_090000",
        engine="paddleocr",
        model_name="PaddleOCR 2026-01-01",
        engine_version="2.7.0",
        task="text_recognition",
        created_at="2026-01-01T09:05:00",
        artifact_path="/data/projects/p1/models/ocr_paddleocr_20260101_090000_infer",
        dataset_id="ds_001",
    )

    assert isinstance(result, ModelMetadata)
    assert result.model_id == "ocr_paddleocr_20260101_090000"
    assert result.engine_id == "paddleocr"
    assert result.display_name == "PaddleOCR 2026-01-01"
    assert result.created_at == "2026-01-01T09:05:00"
    assert result.artifact_path == "/data/projects/p1/models/ocr_paddleocr_20260101_090000_infer"
    assert result.dataset_id == "ds_001"
    assert result.extra["engine_version"] == "2.7.0"
    assert result.extra["task"] == "text_recognition"


def test_create_from_training_normal_optional_fields_default_to_none():
    result = ModelMetadataFactory.create_from_training(model_id="m1", engine="tesseract")

    assert result.display_name is None
    assert result.model_type is None
    assert result.updated_at is None
    assert result.artifact_path is None
    assert result.dataset_id is None
    assert result.experiment_id is None
    assert result.preprocess_version is None
    assert result.extra == {}


# ---------------------------------------------------------------------------
# Missing Required Field
# ---------------------------------------------------------------------------


def test_create_from_training_missing_model_id_raises_invalid_model_metadata_error():
    with pytest.raises(TypeError):
        ModelMetadataFactory.create_from_training(engine="paddleocr")  # type: ignore[call-arg]


def test_create_from_training_missing_engine_raises_type_error():
    with pytest.raises(TypeError):
        ModelMetadataFactory.create_from_training(model_id="m1")  # type: ignore[call-arg]


def test_create_from_training_empty_model_id_raises_invalid_model_metadata_error():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadataFactory.create_from_training(model_id="", engine="paddleocr")


# ---------------------------------------------------------------------------
# Engine別（OCR/Tesseract/Inference）
# ---------------------------------------------------------------------------


def test_create_from_training_engine_paddleocr_ocr():
    result = ModelMetadataFactory.create_from_training(
        model_id="ocr_m1", engine="paddleocr", task="text_recognition"
    )
    assert result.engine_id == "paddleocr"
    assert result.extra["task"] == "text_recognition"


def test_create_from_training_engine_tesseract():
    result = ModelMetadataFactory.create_from_training(
        model_id="tess_m1", engine="tesseract", task="text_recognition"
    )
    assert result.engine_id == "tesseract"


def test_create_from_training_engine_easyocr_inference():
    result = ModelMetadataFactory.create_from_training(
        model_id="infer_m1", engine="easyocr", source="training"
    )
    assert result.engine_id == "easyocr"
    assert result.source == "training"


def test_create_from_training_unregistered_engine_raises_invalid_model_metadata_error():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadataFactory.create_from_training(model_id="m1", engine="custom")


# ---------------------------------------------------------------------------
# created_at生成
# ---------------------------------------------------------------------------


def test_create_from_training_generates_created_at_when_omitted():
    before = datetime.now()
    result = ModelMetadataFactory.create_from_training(model_id="m1", engine="paddleocr")
    after = datetime.now()

    assert result.created_at is not None
    generated = datetime.fromisoformat(result.created_at)
    assert before <= generated <= after


def test_create_from_training_uses_caller_supplied_created_at_when_given():
    result = ModelMetadataFactory.create_from_training(
        model_id="m1", engine="paddleocr", created_at="2026-01-01T00:00:00"
    )
    assert result.created_at == "2026-01-01T00:00:00"


# ---------------------------------------------------------------------------
# schema_version設定
# ---------------------------------------------------------------------------


def test_create_from_training_result_serializes_with_schema_version():
    result = ModelMetadataFactory.create_from_training(model_id="m1", engine="paddleocr")
    assert result.to_dict()["schema_version"] == MODEL_METADATA_SCHEMA_VERSION


# ---------------------------------------------------------------------------
# source=training
# ---------------------------------------------------------------------------


def test_create_from_training_defaults_source_to_training():
    result = ModelMetadataFactory.create_from_training(model_id="m1", engine="paddleocr")
    assert result.source == "training"


def test_create_from_training_allows_overriding_source():
    result = ModelMetadataFactory.create_from_training(model_id="m1", engine="paddleocr", source="backfill")
    assert result.source == "backfill"


# ---------------------------------------------------------------------------
# Validation連携（Factory自身はValidationを行わず、ModelMetadata.from_dict()へ委譲）
# ---------------------------------------------------------------------------


def test_create_from_training_delegates_validation_to_model_metadata_from_dict():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadataFactory.create_from_training(model_id="   ", engine="paddleocr")


def test_create_from_training_non_string_model_id_raises_invalid_model_metadata_error():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadataFactory.create_from_training(model_id=123, engine="paddleocr")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# extra衝突（TrainingMetadataFactoryError、入力組み立てに関する例外）
# ---------------------------------------------------------------------------


def test_create_from_training_extra_collision_with_engine_version_raises_factory_error():
    with pytest.raises(TrainingMetadataFactoryError):
        ModelMetadataFactory.create_from_training(
            model_id="m1",
            engine="paddleocr",
            engine_version="2.7.0",
            extra={"engine_version": "should not be here"},
        )


def test_create_from_training_extra_collision_with_task_raises_factory_error():
    with pytest.raises(TrainingMetadataFactoryError):
        ModelMetadataFactory.create_from_training(
            model_id="m1",
            engine="paddleocr",
            task="text_recognition",
            extra={"task": "should not be here"},
        )


def test_create_from_training_extra_without_collision_is_merged():
    result = ModelMetadataFactory.create_from_training(
        model_id="m1",
        engine="paddleocr",
        engine_version="2.7.0",
        extra={"framework": "paddlepaddle"},
    )
    assert result.extra["engine_version"] == "2.7.0"
    assert result.extra["framework"] == "paddlepaddle"


# ---------------------------------------------------------------------------
# Regression（既存フィールドとの衝突検出はModelMetadata側の既存Validationのまま）
# ---------------------------------------------------------------------------


def test_create_from_training_extra_colliding_with_known_field_still_raises_invalid_model_metadata_error():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadataFactory.create_from_training(
            model_id="m1", engine="paddleocr", extra={"model_id": "duplicate"}
        )


def test_create_from_training_round_trip_via_to_dict_and_from_dict():
    result = ModelMetadataFactory.create_from_training(
        model_id="m1", engine="paddleocr", model_name="Display", engine_version="2.7.0", task="text_recognition"
    )
    rebuilt = ModelMetadata.from_dict(result.to_dict())
    assert rebuilt == result
