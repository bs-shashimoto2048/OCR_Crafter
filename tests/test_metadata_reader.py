"""Metadata Reader（src/app/services/metadata_reader.py）の単体テスト。

Metadata Reader実装Issue（#36、Epic #28配下・Migration Phase 2）のスコープ通り、
Canonical sidecarおよびLegacyファイル（.ocr.json/.tess.json/inference_model.json）を
1件読み込みModelMetadataを返す経路のみを検証する。Writer・Model Catalogは対象外。

Readerは実際にファイルI/Oを行う設計であるため、pytestの`tmp_path`フィクスチャで
隔離された一時ディレクトリを使う（実データ・実プロジェクトには一切触れない）。
"""

import json

import pytest

from src.app.services.legacy_metadata_adapter import (
    LEGACY_FORMAT_INFERENCE_MODEL_JSON,
    LEGACY_FORMAT_OCR_JSON,
    LEGACY_FORMAT_TESS_JSON,
    LEGACY_FORMAT_TROCR_JSON,
    UnsupportedLegacyMetadataError,
)
from src.app.services.metadata_reader import MetadataReadError, MetadataReader
from src.app.services.model_metadata import InvalidModelMetadataError, ModelMetadata


def _write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Canonical
# ---------------------------------------------------------------------------


def test_read_canonical_valid_schema_v1(tmp_path):
    path = _write_json(
        tmp_path / "digits_20260101.tess.json.model_metadata.json",
        {"schema_version": 1, "model_id": "M0001", "engine_id": "tesseract", "display_name": "Digits"},
    )
    result = MetadataReader.read_canonical(path)

    assert isinstance(result, ModelMetadata)
    assert result.model_id == "M0001"
    assert result.engine_id == "tesseract"
    assert result.display_name == "Digits"


def test_read_dispatches_to_canonical_by_filename_suffix(tmp_path):
    path = _write_json(
        tmp_path / "resnet_20260101.pt.model_metadata.json",
        {"schema_version": 1, "model_id": "M0005", "engine_id": "paddleocr"},
    )
    result = MetadataReader.read(path)
    assert result.model_id == "M0005"


def test_read_canonical_invalid_schema_version_raises_invalid_model_metadata_error(tmp_path):
    path = _write_json(
        tmp_path / "bad.model_metadata.json",
        {"schema_version": 999, "model_id": "M0001", "engine_id": "tesseract"},
    )
    with pytest.raises(InvalidModelMetadataError):
        MetadataReader.read_canonical(path)


def test_read_canonical_missing_required_field_raises_invalid_model_metadata_error(tmp_path):
    path = _write_json(tmp_path / "incomplete.model_metadata.json", {"model_id": "M0001"})
    with pytest.raises(InvalidModelMetadataError):
        MetadataReader.read_canonical(path)


# ---------------------------------------------------------------------------
# Legacy OCR（.ocr.json）
# ---------------------------------------------------------------------------


def test_read_legacy_ocr_via_explicit_method(tmp_path):
    path = _write_json(
        tmp_path / "ocr_paddleocr_20260101_090000.ocr.json",
        {
            "engine": "paddleocr",
            "model_type": "ocr",
            "created_at": "2026-01-01T09:00:00",
            "inference_dir": "/data/projects/p1/models/infer",
            "dataset_id": "DS-0001",
        },
    )
    result = MetadataReader.read_legacy(path, LEGACY_FORMAT_OCR_JSON, model_id="M0001")

    assert result.model_id == "M0001"
    assert result.engine_id == "paddleocr"
    assert result.artifact_path == "/data/projects/p1/models/infer"
    # Reader経由の変換はbackfillが既定（Adapter直接呼び出しのtrainingとは区別する）
    assert result.source == "backfill"


def test_read_dispatches_legacy_ocr_by_filename_suffix(tmp_path):
    path = _write_json(
        tmp_path / "ocr_paddleocr_20260101_090000.ocr.json",
        {"engine": "paddleocr", "created_at": "2026-01-01T09:00:00"},
    )
    result = MetadataReader.read(path, model_id="M0001")
    assert result.model_id == "M0001"
    assert result.engine_id == "paddleocr"
    assert result.source == "backfill"


def test_read_legacy_ocr_source_can_be_overridden(tmp_path):
    path = _write_json(tmp_path / "ocr_paddleocr_x.ocr.json", {"engine": "paddleocr"})
    result = MetadataReader.read_legacy(path, LEGACY_FORMAT_OCR_JSON, model_id="M0001", source="training")
    assert result.source == "training"


# ---------------------------------------------------------------------------
# Legacy Tesseract（.tess.json）
# ---------------------------------------------------------------------------


def test_read_legacy_tesseract_via_explicit_method(tmp_path):
    path = _write_json(
        tmp_path / "digits_20260102.tess.json",
        {
            "engine": "tesseract",
            "model_type": "ocr",
            "created_at": "2026-01-02T09:00:00",
            "tessdata_dir": "/data/projects/p1/models/tessdata",
            "dataset_id": "DS-0002",
        },
    )
    result = MetadataReader.read_legacy(path, LEGACY_FORMAT_TESS_JSON, model_id="M0002")

    assert result.model_id == "M0002"
    assert result.engine_id == "tesseract"
    assert result.artifact_path == "/data/projects/p1/models/tessdata"
    assert result.source == "backfill"


def test_read_dispatches_legacy_tess_by_filename_suffix(tmp_path):
    path = _write_json(tmp_path / "digits_20260102.tess.json", {"engine": "tesseract"})
    result = MetadataReader.read(path, model_id="M0002")
    assert result.model_id == "M0002"
    assert result.engine_id == "tesseract"


# ---------------------------------------------------------------------------
# Legacy TrOCR（.trocr.json、Issue #110）
# ---------------------------------------------------------------------------


def test_read_legacy_trocr_via_explicit_method(tmp_path):
    path = _write_json(
        tmp_path / "trocr_job-3.trocr.json",
        {
            "engine": "trocr",
            "model_type": "ocr",
            "created_at": "2026-01-03T09:00:00",
            "model_dir": "/data/projects/p1/models/trocr_runs/job-3",
            "dataset_id": "DS-0003",
        },
    )
    result = MetadataReader.read_legacy(path, LEGACY_FORMAT_TROCR_JSON, model_id="M0003")

    assert result.model_id == "M0003"
    assert result.engine_id == "trocr"
    assert result.artifact_path == "/data/projects/p1/models/trocr_runs/job-3"
    # Reader経由の変換はbackfillが既定（.ocr.json/.tess.jsonと同じ扱い）
    assert result.source == "backfill"


def test_read_dispatches_legacy_trocr_by_filename_suffix(tmp_path):
    path = _write_json(
        tmp_path / "trocr_job-3.trocr.json",
        {"engine": "trocr", "created_at": "2026-01-03T09:00:00"},
    )
    result = MetadataReader.read(path, model_id="M0003")
    assert result.model_id == "M0003"
    assert result.engine_id == "trocr"
    assert result.source == "backfill"


def test_read_legacy_trocr_source_can_be_overridden(tmp_path):
    path = _write_json(tmp_path / "trocr_job-x.trocr.json", {"engine": "trocr"})
    result = MetadataReader.read_legacy(path, LEGACY_FORMAT_TROCR_JSON, model_id="M0003", source="training")
    assert result.source == "training"


def test_read_trocr_filename_does_not_collide_with_ocr_json_suffix(tmp_path):
    """`.trocr.json`は`.ocr.json`のsuffixとして誤判定されない（末尾一致確認の回帰）。"""
    path = _write_json(tmp_path / "trocr_job-y.trocr.json", {"engine": "trocr"})
    result = MetadataReader.read(path, model_id="M0003")
    assert result.engine_id == "trocr"


# ---------------------------------------------------------------------------
# Legacy Inference（inference_model.json）
# ---------------------------------------------------------------------------


def test_read_legacy_inference_via_explicit_method_with_caller_model_id(tmp_path):
    path = _write_json(
        tmp_path / "inference_model.json",
        {"engine": "trocr", "model": "microsoft/trocr-base-handwritten", "inference_model_id": "M0009", "updated_at": "2026-01-03T09:00:00"},
    )
    result = MetadataReader.read_legacy(path, LEGACY_FORMAT_INFERENCE_MODEL_JSON, model_id="M9999")

    # Design Decision: 呼び出し側が明示指定した場合はそちらを優先する
    assert result.model_id == "M9999"
    assert result.engine_id == "trocr"
    assert result.artifact_path == "microsoft/trocr-base-handwritten"


def test_read_legacy_inference_falls_back_to_inference_model_id_when_not_specified(tmp_path):
    path = _write_json(
        tmp_path / "inference_model.json",
        {"engine": "trocr", "model": "microsoft/trocr-base-handwritten", "inference_model_id": "M0009", "updated_at": "2026-01-03T09:00:00"},
    )
    result = MetadataReader.read_legacy(path, LEGACY_FORMAT_INFERENCE_MODEL_JSON)

    # Design Decision: 呼び出し側が指定しない場合のみ、ファイル内のinference_model_idへfallback
    assert result.model_id == "M0009"


def test_read_legacy_inference_via_read_auto_dispatch_by_exact_filename(tmp_path):
    path = _write_json(
        tmp_path / "inference_model.json",
        {"engine": "easyocr", "model": "some_model.ocr.json", "inference_model_id": "M0010", "updated_at": "2026-01-04T00:00:00"},
    )
    result = MetadataReader.read(path)
    assert result.model_id == "M0010"
    assert result.engine_id == "easyocr"


def test_read_legacy_inference_without_model_id_anywhere_raises_invalid_model_metadata_error(tmp_path):
    """呼び出し側指定なし・inference_model_idも欠損の場合、model_id欠損としてfrom_dict()が拒否する。"""
    path = _write_json(tmp_path / "inference_model.json", {"engine": "trocr", "model": "x"})
    with pytest.raises(InvalidModelMetadataError):
        MetadataReader.read_legacy(path, LEGACY_FORMAT_INFERENCE_MODEL_JSON)


# ---------------------------------------------------------------------------
# Unknown Legacy Format
# ---------------------------------------------------------------------------


def test_read_unknown_file_name_raises_unsupported_legacy_metadata_error(tmp_path):
    path = _write_json(tmp_path / "weird_format.xml", {"anything": "here"})
    with pytest.raises(UnsupportedLegacyMetadataError):
        MetadataReader.read(path)


def test_read_legacy_with_explicit_unknown_format_raises_unsupported_legacy_metadata_error(tmp_path):
    path = _write_json(tmp_path / "something.json", {"engine": "tesseract"})
    with pytest.raises(UnsupportedLegacyMetadataError):
        MetadataReader.read_legacy(path, "some_future_format", model_id="M0001")


# ---------------------------------------------------------------------------
# Unknown Engine
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "filename,legacy_format",
    [
        ("ocr_x.ocr.json", LEGACY_FORMAT_OCR_JSON),
        ("tess_x.tess.json", LEGACY_FORMAT_TESS_JSON),
        ("trocr_x.trocr.json", LEGACY_FORMAT_TROCR_JSON),
        ("inference_model.json", LEGACY_FORMAT_INFERENCE_MODEL_JSON),
    ],
)
def test_read_legacy_unknown_engine_raises_invalid_model_metadata_error(tmp_path, filename, legacy_format):
    path = _write_json(tmp_path / filename, {"engine": "not_a_real_engine", "model": "x"})
    with pytest.raises(InvalidModelMetadataError):
        MetadataReader.read_legacy(path, legacy_format, model_id="M0001")


# ---------------------------------------------------------------------------
# Broken JSON
# ---------------------------------------------------------------------------


def test_read_broken_json_raises_metadata_read_error_for_canonical(tmp_path):
    path = tmp_path / "broken.model_metadata.json"
    path.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(MetadataReadError):
        MetadataReader.read(path)


def test_read_broken_json_raises_metadata_read_error_for_legacy(tmp_path):
    path = tmp_path / "broken.tess.json"
    path.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(MetadataReadError):
        MetadataReader.read(path, model_id="M0001")


# ---------------------------------------------------------------------------
# Missing File
# ---------------------------------------------------------------------------


def test_read_missing_canonical_file_raises_metadata_read_error(tmp_path):
    path = tmp_path / "does_not_exist.model_metadata.json"
    with pytest.raises(MetadataReadError):
        MetadataReader.read_canonical(path)


def test_read_missing_legacy_file_raises_metadata_read_error(tmp_path):
    path = tmp_path / "does_not_exist.tess.json"
    with pytest.raises(MetadataReadError):
        MetadataReader.read(path, model_id="M0001")


def test_metadata_read_error_preserves_original_exception_via_chaining(tmp_path):
    path = tmp_path / "does_not_exist.model_metadata.json"
    with pytest.raises(MetadataReadError) as exc_info:
        MetadataReader.read_canonical(path)
    assert isinstance(exc_info.value.__cause__, OSError)


# ---------------------------------------------------------------------------
# Invalid Schema（Canonicalとは別に、schema_versionの型不正も再確認）
# ---------------------------------------------------------------------------


def test_read_canonical_bool_schema_version_is_rejected(tmp_path):
    """model_metadata.pyのMajor #1修正（bool/float誤受理防止）がReader経由でも有効なことを確認する。"""
    path = _write_json(
        tmp_path / "bool_version.model_metadata.json",
        {"schema_version": True, "model_id": "M0001", "engine_id": "tesseract"},
    )
    with pytest.raises(InvalidModelMetadataError):
        MetadataReader.read_canonical(path)


# ---------------------------------------------------------------------------
# Regression（Adapter・Canonical Schemaを壊していないことの確認）
# ---------------------------------------------------------------------------


def test_reader_output_is_round_trippable_through_canonical_schema(tmp_path):
    path = _write_json(
        tmp_path / "ocr_x.ocr.json",
        {"engine": "paddleocr", "created_at": "2026-01-01T00:00:00", "dataset_id": "DS-0001"},
    )
    result = MetadataReader.read(path, model_id="M0001")
    restored = ModelMetadata.from_dict(result.to_dict())
    assert restored == result


def test_reader_does_not_mutate_input_types_or_leak_unknown_fields(tmp_path):
    path = _write_json(
        tmp_path / "ocr_x.ocr.json",
        {
            "engine": "paddleocr",
            "training_params": {"epochs": 10},  # .ocr.json固有・ModelMetadataに存在しないフィールド
        },
    )
    result = MetadataReader.read(path, model_id="M0001")
    assert dict(result.extra) == {}
