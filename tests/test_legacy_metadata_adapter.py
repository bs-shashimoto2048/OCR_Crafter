"""Legacy Metadata Adapter（src/app/services/legacy_metadata_adapter.py）の単体テスト。

Legacy Metadata Adapter実装Issue（#34、Epic #28配下・Migration Phase 1）のスコープ通り、
`.ocr.json`/`.tess.json`/`inference_model.json`相当のdictからModelMetadataへの変換のみを
検証する。Filesystemアクセス・Reader・Writer・Model Catalogは対象外（本モジュールは
まだ既存コードから参照されていない）。
"""

import pytest

from src.app.services.legacy_metadata_adapter import (
    LEGACY_FORMAT_INFERENCE_MODEL_JSON,
    LEGACY_FORMAT_OCR_JSON,
    LEGACY_FORMAT_TESS_JSON,
    LEGACY_FORMAT_TROCR_JSON,
    InferenceMetadataAdapter,
    LegacyMetadataAdapter,
    OCRMetadataAdapter,
    TesseractMetadataAdapter,
    TrOCRMetadataAdapter,
    UnsupportedLegacyMetadataError,
)
from src.app.services.model_metadata import InvalidModelMetadataError, ModelMetadata

# ---------------------------------------------------------------------------
# 代表的なLegacy Metadata（実コード調査に基づく実際のフィールド名）
# ---------------------------------------------------------------------------

# src/app/services/ocr_pipeline.py::_register_ocr_model() が書き込む .ocr.json 相当
OCR_JSON_SAMPLE = {
    "name": "ocr_paddleocr_20260101_090000",
    "training_family": "ocr",
    "engine": "paddleocr",
    "model_type": "ocr",
    "train_dir": "/data/projects/p1/models/ocr_paddleocr_20260101_090000_train",
    "infer_dir": "/data/projects/p1/models/ocr_paddleocr_20260101_090000_infer",
    "exported": True,
    "model_dir": "/data/projects/p1/models/ocr_paddleocr_20260101_090000_infer",
    "checkpoint_dir": "/data/projects/p1/models/ocr_paddleocr_20260101_090000_train",
    "inference_dir": "/data/projects/p1/models/ocr_paddleocr_20260101_090000_infer",
    "export_ready": True,
    "exported_at": "2026-01-01T09:05:00",
    "charset": "ABC",
    "max_text_length": 32,
    "image_shape": [3, 32, 320],
    "dataset_root": "/data/projects/p1/datasets/ds_a",
    "job_id": "job-1",
    "training_params": {"epochs": 10, "batch_size": 8, "learning_rate": 0.001},
    "dataset_split_ratio": {"train": 0.8, "val": 0.1, "test": 0.1},
    "dataset_split_counts": {"train": 80, "val": 10, "test": 10, "total": 100},
    "preprocess": {"image_shape": [3, 32, 320], "image_types": ["wide"], "charset": "ABC", "max_text_length": 32},
    "augmentation": {"enabled": True, "strength": 3},
    "dataset_id": "DS-0001",
    "dataset_name": "OCRDataset_v1",
    "dataset_created_at": "2026-01-01T00:00:00",
    "created_at": "2026-01-01T09:00:00",
}

# src/app/services/tesseract_pipeline.py::register_tesseract_model() が書き込む .tess.json 相当
TESS_JSON_SAMPLE = {
    "engine": "tesseract",
    "training_family": "tesseract",
    "model_type": "ocr",
    "lang": "digits",
    "traineddata_path": "/data/projects/p1/models/digits.traineddata",
    "tessdata_dir": "/data/projects/p1/models/digits_tessdata",
    "model_dir": "/data/projects/p1/models/digits_tessdata",
    "base_lang": "eng",
    "charset": "0123456789",
    "dataset_root": "/data/projects/p1/datasets/ds_b",
    "counts": {"train": 80, "val": 10, "test": 10},
    "job_id": "job-2",
    "max_iterations": 1000,
    "created_at": "2026-01-02T09:00:00",
    "dataset_id": "DS-0002",
    "dataset_name": "TessDataset_v1",
    "dataset_created_at": "2026-01-02T00:00:00",
}

# src/app/services/trocr_model_registry.py::register_trocr_model() が書き込む .trocr.json 相当（Issue #96）
TROCR_JSON_SAMPLE = {
    "name": "trocr_job-3.trocr.json",
    "engine": "trocr",
    "training_family": "ocr",
    "model_type": "ocr",
    "model_dir": "/data/projects/p1/models/trocr_runs/job-3",
    "base_model_ref": "microsoft/trocr-base-handwritten",
    "project_id": "p1",
    "job_id": "job-3",
    "dataset_root": "/data/projects/p1/datasets/ds_c",
    "dataset_id": "DS-0003",
    "epochs": 5,
    "batch_size": 4,
    "learning_rate": 0.0001,
    "final_loss": 0.123,
    "created_at": "2026-01-03T09:00:00",
}

# src/app/services/inference_model.py::save_inference_model() が書き込む inference_model.json 相当
INFERENCE_MODEL_JSON_SAMPLE = {
    "engine": "trocr",
    "model": "microsoft/trocr-base-handwritten",
    "inference_model_id": "M0009",
    "updated_at": "2026-01-03T09:00:00",
}


# ---------------------------------------------------------------------------
# OCR（.ocr.json）正常変換
# ---------------------------------------------------------------------------


def test_ocr_metadata_adapter_converts_to_model_metadata():
    result = OCRMetadataAdapter.adapt(OCR_JSON_SAMPLE, model_id="M0001")

    assert isinstance(result, ModelMetadata)
    assert result.model_id == "M0001"
    assert result.engine_id == "paddleocr"
    assert result.model_type == "ocr"
    assert result.created_at == "2026-01-01T09:00:00"
    assert result.artifact_path == "/data/projects/p1/models/ocr_paddleocr_20260101_090000_infer"
    assert result.dataset_id == "DS-0001"
    assert result.source == "training"


def test_ocr_metadata_adapter_falls_back_to_model_dir_when_inference_dir_missing():
    data = {k: v for k, v in OCR_JSON_SAMPLE.items() if k != "inference_dir"}
    result = OCRMetadataAdapter.adapt(data, model_id="M0001")
    assert result.artifact_path == data["model_dir"]


def test_legacy_metadata_adapter_dispatches_ocr_json():
    via_dispatch = LegacyMetadataAdapter.adapt(LEGACY_FORMAT_OCR_JSON, OCR_JSON_SAMPLE, model_id="M0001")
    via_direct = LegacyMetadataAdapter.from_ocr_json(OCR_JSON_SAMPLE, model_id="M0001")
    assert via_dispatch == via_direct == OCRMetadataAdapter.adapt(OCR_JSON_SAMPLE, model_id="M0001")


# ---------------------------------------------------------------------------
# Tesseract（.tess.json）正常変換
# ---------------------------------------------------------------------------


def test_tesseract_metadata_adapter_converts_to_model_metadata():
    result = TesseractMetadataAdapter.adapt(TESS_JSON_SAMPLE, model_id="M0002")

    assert isinstance(result, ModelMetadata)
    assert result.model_id == "M0002"
    assert result.engine_id == "tesseract"
    assert result.model_type == "ocr"
    assert result.created_at == "2026-01-02T09:00:00"
    assert result.artifact_path == "/data/projects/p1/models/digits_tessdata"
    assert result.dataset_id == "DS-0002"
    assert result.source == "training"


def test_tesseract_metadata_adapter_falls_back_to_model_dir_when_tessdata_dir_missing():
    data = {k: v for k, v in TESS_JSON_SAMPLE.items() if k != "tessdata_dir"}
    result = TesseractMetadataAdapter.adapt(data, model_id="M0002")
    assert result.artifact_path == data["model_dir"]


def test_legacy_metadata_adapter_dispatches_tess_json():
    via_dispatch = LegacyMetadataAdapter.adapt(LEGACY_FORMAT_TESS_JSON, TESS_JSON_SAMPLE, model_id="M0002")
    via_direct = LegacyMetadataAdapter.from_tess_json(TESS_JSON_SAMPLE, model_id="M0002")
    assert via_dispatch == via_direct == TesseractMetadataAdapter.adapt(TESS_JSON_SAMPLE, model_id="M0002")


# ---------------------------------------------------------------------------
# TrOCR（.trocr.json）正常変換（Issue #110）
# ---------------------------------------------------------------------------


def test_trocr_metadata_adapter_converts_to_model_metadata():
    result = TrOCRMetadataAdapter.adapt(TROCR_JSON_SAMPLE, model_id="M0003")

    assert isinstance(result, ModelMetadata)
    assert result.model_id == "M0003"
    assert result.engine_id == "trocr"
    assert result.model_type == "ocr"
    assert result.created_at == "2026-01-03T09:00:00"
    assert result.artifact_path == "/data/projects/p1/models/trocr_runs/job-3"
    assert result.dataset_id == "DS-0003"
    assert result.source == "training"


def test_trocr_metadata_adapter_specific_fields_not_modeled_are_ignored_not_leaked_into_extra():
    """既存precedent（.ocr.json/.tess.jsonのtraining_params等）と同じく、base_model_ref/
    project_id/job_id/epochs/batch_size/learning_rate/final_loss等はextraへ自動混入しない。
    """
    result = TrOCRMetadataAdapter.adapt(TROCR_JSON_SAMPLE, model_id="M0003")
    assert dict(result.extra) == {}


def test_legacy_metadata_adapter_dispatches_trocr_json():
    via_dispatch = LegacyMetadataAdapter.adapt(LEGACY_FORMAT_TROCR_JSON, TROCR_JSON_SAMPLE, model_id="M0003")
    via_direct = LegacyMetadataAdapter.from_trocr_json(TROCR_JSON_SAMPLE, model_id="M0003")
    assert via_dispatch == via_direct == TrOCRMetadataAdapter.adapt(TROCR_JSON_SAMPLE, model_id="M0003")


def test_trocr_metadata_adapter_works_purely_in_memory_without_any_file_on_disk():
    data = {**TROCR_JSON_SAMPLE, "model_dir": "/this/path/does/not/exist/anywhere"}
    result = TrOCRMetadataAdapter.adapt(data, model_id="M0003")
    assert result.artifact_path == "/this/path/does/not/exist/anywhere"


# ---------------------------------------------------------------------------
# Inference（inference_model.json）正常変換
# ---------------------------------------------------------------------------


def test_inference_metadata_adapter_converts_to_model_metadata():
    result = InferenceMetadataAdapter.adapt(INFERENCE_MODEL_JSON_SAMPLE, model_id="M0009")

    assert isinstance(result, ModelMetadata)
    assert result.model_id == "M0009"
    assert result.engine_id == "trocr"
    assert result.artifact_path == "microsoft/trocr-base-handwritten"
    assert result.updated_at == "2026-01-03T09:00:00"
    # inference_model.jsonは学習成果物レコードではないため、sourceは想像で補わずNoneのまま
    assert result.source is None


def test_legacy_metadata_adapter_dispatches_inference_model_json():
    via_dispatch = LegacyMetadataAdapter.adapt(
        LEGACY_FORMAT_INFERENCE_MODEL_JSON, INFERENCE_MODEL_JSON_SAMPLE, model_id="M0009"
    )
    via_direct = LegacyMetadataAdapter.from_inference_model_json(INFERENCE_MODEL_JSON_SAMPLE, model_id="M0009")
    assert via_dispatch == via_direct == InferenceMetadataAdapter.adapt(INFERENCE_MODEL_JSON_SAMPLE, model_id="M0009")


# ---------------------------------------------------------------------------
# Unknown Legacy Format（専用例外）
# ---------------------------------------------------------------------------


def test_unknown_legacy_format_raises_dedicated_exception():
    with pytest.raises(UnsupportedLegacyMetadataError):
        LegacyMetadataAdapter.adapt("some_future_format", {}, model_id="M0001")


def test_unknown_legacy_format_is_not_invalid_model_metadata_error():
    """未対応形式の例外は、Engine不正等のInvalidModelMetadataErrorとは異なる型である。"""
    with pytest.raises(UnsupportedLegacyMetadataError) as exc_info:
        LegacyMetadataAdapter.adapt("unknown", {"engine": "tesseract"}, model_id="M0001")
    assert not isinstance(exc_info.value, InvalidModelMetadataError)


def test_unsupported_legacy_metadata_error_message_lists_known_formats():
    with pytest.raises(UnsupportedLegacyMetadataError, match="ocr_json"):
        LegacyMetadataAdapter.adapt("xml_format", {}, model_id="M0001")


# ---------------------------------------------------------------------------
# Unknown Engine（InvalidModelMetadataError、resolve_engine_id()経由）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "adapter_cls,sample",
    [
        (OCRMetadataAdapter, OCR_JSON_SAMPLE),
        (TesseractMetadataAdapter, TESS_JSON_SAMPLE),
        (TrOCRMetadataAdapter, TROCR_JSON_SAMPLE),
        (InferenceMetadataAdapter, INFERENCE_MODEL_JSON_SAMPLE),
    ],
)
def test_unknown_engine_raises_invalid_model_metadata_error(adapter_cls, sample):
    """未知engineは、Adapter独自のチェックではなくModelMetadata.from_dict()経由で拒否される。"""
    data = {**sample, "engine": "not_a_real_engine"}
    with pytest.raises(InvalidModelMetadataError):
        adapter_cls.adapt(data, model_id="M0001")


def test_unknown_engine_is_not_guessed_or_silently_changed():
    """Engine推測フォールバック禁止: 未知engineをpaddleocr等へ暗黙変換しない。"""
    data = {**OCR_JSON_SAMPLE, "engine": "totally_unknown_engine"}
    with pytest.raises(InvalidModelMetadataError):
        OCRMetadataAdapter.adapt(data, model_id="M0001")


def test_missing_engine_field_raises_invalid_model_metadata_error():
    data = {k: v for k, v in TESS_JSON_SAMPLE.items() if k != "engine"}
    with pytest.raises(InvalidModelMetadataError):
        TesseractMetadataAdapter.adapt(data, model_id="M0002")


def test_trocr_missing_engine_field_raises_invalid_model_metadata_error():
    data = {k: v for k, v in TROCR_JSON_SAMPLE.items() if k != "engine"}
    with pytest.raises(InvalidModelMetadataError):
        TrOCRMetadataAdapter.adapt(data, model_id="M0003")


# ---------------------------------------------------------------------------
# Missing Required（model_id、InvalidModelMetadataError）
# ---------------------------------------------------------------------------


def test_missing_model_id_raises_invalid_model_metadata_error():
    with pytest.raises(InvalidModelMetadataError):
        OCRMetadataAdapter.adapt(OCR_JSON_SAMPLE, model_id="")


def test_whitespace_model_id_raises_invalid_model_metadata_error():
    with pytest.raises(InvalidModelMetadataError):
        TesseractMetadataAdapter.adapt(TESS_JSON_SAMPLE, model_id="   ")


def test_trocr_missing_model_id_raises_invalid_model_metadata_error():
    with pytest.raises(InvalidModelMetadataError):
        TrOCRMetadataAdapter.adapt(TROCR_JSON_SAMPLE, model_id="")


# ---------------------------------------------------------------------------
# Adapter内で独自Validationを書いていないことの確認（from_dict()への委譲確認）
# ---------------------------------------------------------------------------


def test_adapter_does_not_reject_non_mapping_itself_delegates_to_from_dict():
    """Adapterは非Mapping入力を自前でチェックせず、ModelMetadata.from_dict()の
    Validationがそのまま働く（同じInvalidModelMetadataErrorが送出される）。
    """
    with pytest.raises(InvalidModelMetadataError):
        OCRMetadataAdapter.adapt(["not", "a", "mapping"], model_id="M0001")  # type: ignore[arg-type]


def test_adapter_output_is_a_valid_model_metadata_round_trippable():
    result = OCRMetadataAdapter.adapt(OCR_JSON_SAMPLE, model_id="M0001")
    restored = ModelMetadata.from_dict(result.to_dict())
    assert restored == result


def test_trocr_adapter_does_not_reject_non_mapping_itself_delegates_to_from_dict():
    with pytest.raises(InvalidModelMetadataError):
        TrOCRMetadataAdapter.adapt(["not", "a", "mapping"], model_id="M0003")  # type: ignore[arg-type]


def test_trocr_adapter_output_is_a_valid_model_metadata_round_trippable():
    result = TrOCRMetadataAdapter.adapt(TROCR_JSON_SAMPLE, model_id="M0003")
    restored = ModelMetadata.from_dict(result.to_dict())
    assert restored == result


# ---------------------------------------------------------------------------
# 未知フィールドの扱い（extraへ自動混入しない、from_dict()の既存方針を継承）
# ---------------------------------------------------------------------------


def test_ocr_specific_fields_not_modeled_are_ignored_not_leaked_into_extra():
    """.ocr.json固有の多数のフィールド（training_params等）はextraへ自動混入しない。"""
    result = OCRMetadataAdapter.adapt(OCR_JSON_SAMPLE, model_id="M0001")
    assert dict(result.extra) == {}


# ---------------------------------------------------------------------------
# Filesystem非依存の確認（本テストファイル自体がFilesystemに触れていないことの確認）
# ---------------------------------------------------------------------------


def test_adapters_work_purely_in_memory_without_any_file_on_disk():
    """存在しないパスを含むdictでも、Adapterはパスの実在確認を行わずに変換できる。"""
    data = {**OCR_JSON_SAMPLE, "inference_dir": "/this/path/does/not/exist/anywhere"}
    result = OCRMetadataAdapter.adapt(data, model_id="M0001")
    assert result.artifact_path == "/this/path/does/not/exist/anywhere"
