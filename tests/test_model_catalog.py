"""Model Catalog（src/app/services/model_catalog.py）の単体テスト。

Model Catalog実装Issue（#40、Epic #28配下・Migration Phase 3）のスコープ通り、
ディレクトリ走査によるModelMetadata一覧提供のみを検証する。Metadata Reader・
Metadata Writerへの機能追加は行っていない（両モジュールは無変更のまま利用する）。

Catalogは実際にディレクトリを走査するため、pytestの`tmp_path`フィクスチャで
隔離された一時ディレクトリを使う（実データ・実プロジェクトには一切触れない）。
"""

import json

import pytest

from src.app.services.legacy_metadata_adapter import (
    LEGACY_FORMAT_OCR_JSON,
    LEGACY_FORMAT_TESS_JSON,
    LEGACY_FORMAT_TROCR_JSON,
)
from src.app.services.metadata_reader import MetadataReadError, MetadataReader
from src.app.services.metadata_writer import MetadataWriter
from src.app.services.model_catalog import ModelCatalog, ModelCatalogError
from src.app.services.model_metadata import InvalidModelMetadataError, ModelMetadata


def _write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Empty Directory
# ---------------------------------------------------------------------------


def test_list_returns_empty_for_empty_directory(tmp_path):
    catalog = ModelCatalog(tmp_path)
    assert catalog.list() == []


def test_list_ignores_unrelated_files(tmp_path):
    (tmp_path / "readme.txt").write_text("not a model", encoding="utf-8")
    (tmp_path / "model.pt").write_bytes(b"binary checkpoint, no adapter for .pt")
    catalog = ModelCatalog(tmp_path)
    assert catalog.list() == []


# ---------------------------------------------------------------------------
# Canonical Only
# ---------------------------------------------------------------------------


def test_list_returns_canonical_only_entry(tmp_path):
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract", display_name="Digits")
    MetadataWriter.write(tmp_path / "digits_20260101.tess.json.model_metadata.json", metadata)

    catalog = ModelCatalog(tmp_path)
    result = catalog.list()

    assert len(result) == 1
    assert result[0] == metadata


def test_list_supports_multiple_canonical_entries(tmp_path):
    m1 = ModelMetadata(model_id="M0001", engine_id="tesseract")
    m2 = ModelMetadata(model_id="M0002", engine_id="paddleocr")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", m1)
    MetadataWriter.write(tmp_path / "b.ocr.json.model_metadata.json", m2)

    catalog = ModelCatalog(tmp_path)
    result = {m.model_id: m for m in catalog.list()}

    assert result.keys() == {"M0001", "M0002"}


# ---------------------------------------------------------------------------
# Legacy Only
# ---------------------------------------------------------------------------


def test_list_returns_legacy_only_entry_with_filename_as_model_id(tmp_path):
    _write_json(
        tmp_path / "digits_20260101.tess.json",
        {"engine": "tesseract", "dataset_id": "DS-0001"},
    )

    catalog = ModelCatalog(tmp_path)
    result = catalog.list()

    assert len(result) == 1
    assert result[0].model_id == "digits_20260101.tess.json"
    assert result[0].engine_id == "tesseract"
    assert result[0].dataset_id == "DS-0001"
    # Reader経由のLegacy変換なのでsourceはbackfillが既定
    assert result[0].source == "backfill"


def test_list_returns_ocr_json_legacy_entry(tmp_path):
    _write_json(tmp_path / "ocr_paddleocr_x.ocr.json", {"engine": "paddleocr"})

    catalog = ModelCatalog(tmp_path)
    result = catalog.list()

    assert len(result) == 1
    assert result[0].model_id == "ocr_paddleocr_x.ocr.json"
    assert result[0].engine_id == "paddleocr"


def test_list_returns_trocr_json_legacy_entry(tmp_path):
    """Issue #110: `.trocr.json`もLegacy sidecarとして`.ocr.json`/`.tess.json`と同様に検出される。"""
    _write_json(
        tmp_path / "trocr_job-3.trocr.json",
        {"engine": "trocr", "model_dir": "/data/projects/p1/models/trocr_runs/job-3", "dataset_id": "DS-0003"},
    )

    catalog = ModelCatalog(tmp_path)
    result = catalog.list()

    assert len(result) == 1
    assert result[0].model_id == "trocr_job-3.trocr.json"
    assert result[0].engine_id == "trocr"
    assert result[0].artifact_path == "/data/projects/p1/models/trocr_runs/job-3"
    assert result[0].dataset_id == "DS-0003"
    assert result[0].source == "backfill"


def test_list_ignores_trocr_artifact_subdirectory_non_recursively(tmp_path):
    """TrOCRのartifact本体（save_pretrained()出力ディレクトリ）はCatalogの非再帰走査に
    現れず、sidecarファイルのみが1件として検出されること（ディレクトリ再帰スキャン不要の確認）。
    """
    artifact_dir = tmp_path / "trocr_runs" / "job-3"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "config.json").write_text("{}", encoding="utf-8")
    _write_json(
        tmp_path / "trocr_job-3.trocr.json",
        {"engine": "trocr", "model_dir": str(artifact_dir)},
    )

    catalog = ModelCatalog(tmp_path)
    result = catalog.list()

    assert len(result) == 1
    assert result[0].model_id == "trocr_job-3.trocr.json"


def test_list_ignores_inference_model_json_file(tmp_path):
    """inference_model.jsonはモデル成果物ではなく選択ポインタのため、対象外とする（スコープ決定）。"""
    _write_json(
        tmp_path / "inference_model.json",
        {"engine": "trocr", "model": "microsoft/trocr-base", "inference_model_id": "M0009"},
    )
    catalog = ModelCatalog(tmp_path)
    assert catalog.list() == []


# ---------------------------------------------------------------------------
# Canonical Preferred（同一baseにCanonical+Legacy両方存在）
# ---------------------------------------------------------------------------


def test_canonical_is_preferred_over_legacy_for_same_base_file(tmp_path):
    _write_json(
        tmp_path / "digits_20260101.tess.json",
        {"engine": "tesseract", "dataset_id": "DS-LEGACY"},
    )
    canonical = ModelMetadata(model_id="M-CANON", engine_id="tesseract", dataset_id="DS-CANONICAL")
    MetadataWriter.write(tmp_path / "digits_20260101.tess.json.model_metadata.json", canonical)

    catalog = ModelCatalog(tmp_path)
    result = catalog.list()

    assert len(result) == 1
    assert result[0] == canonical
    assert result[0].dataset_id == "DS-CANONICAL"
    # Legacy側の値がマージされて残っていないことの確認
    assert result[0].model_id != "digits_20260101.tess.json"


def test_canonical_is_preferred_over_trocr_legacy_for_same_base_file(tmp_path):
    _write_json(
        tmp_path / "trocr_job-3.trocr.json",
        {"engine": "trocr", "dataset_id": "DS-LEGACY"},
    )
    canonical = ModelMetadata(model_id="M-CANON-TROCR", engine_id="trocr", dataset_id="DS-CANONICAL")
    MetadataWriter.write(tmp_path / "trocr_job-3.trocr.json.model_metadata.json", canonical)

    catalog = ModelCatalog(tmp_path)
    result = catalog.list()

    assert len(result) == 1
    assert result[0] == canonical
    assert result[0].dataset_id == "DS-CANONICAL"


def test_canonical_and_legacy_coexist_across_engines_including_trocr(tmp_path):
    """Canonical + Tesseract Legacy + TrOCR Legacyが同一ディレクトリに共存しても
    互いに干渉しないこと（既存engineへの回帰が無いことの確認）。
    """
    canonical = ModelMetadata(model_id="M-CANON", engine_id="paddleocr")
    MetadataWriter.write(tmp_path / "a.ocr.json.model_metadata.json", canonical)
    _write_json(tmp_path / "digits_x.tess.json", {"engine": "tesseract"})
    _write_json(tmp_path / "trocr_job-9.trocr.json", {"engine": "trocr"})

    catalog = ModelCatalog(tmp_path)
    result = {m.model_id: m for m in catalog.list()}

    assert result.keys() == {"M-CANON", "digits_x.tess.json", "trocr_job-9.trocr.json"}
    assert result["trocr_job-9.trocr.json"].engine_id == "trocr"


def test_legacy_content_is_fully_ignored_when_canonical_present(tmp_path):
    """Legacyの値がCanonicalへ一部でも混入していないこと（マージしないことの確認）。"""
    _write_json(
        tmp_path / "x.ocr.json",
        {"engine": "paddleocr", "dataset_id": "DS-LEGACY-ONLY", "created_at": "2020-01-01T00:00:00"},
    )
    canonical = ModelMetadata(model_id="M-X", engine_id="paddleocr")  # dataset_id/created_at 未設定
    MetadataWriter.write(tmp_path / "x.ocr.json.model_metadata.json", canonical)

    catalog = ModelCatalog(tmp_path)
    result = catalog.find("M-X")

    assert result.dataset_id is None
    assert result.created_at is None


# ---------------------------------------------------------------------------
# Duplicate Removal
# ---------------------------------------------------------------------------


def test_duplicate_model_id_across_canonical_files_is_deduplicated(tmp_path):
    """異なるCanonicalファイルが同じmodel_idを持つ場合、1件のみ残る（走査順で先勝ち）。"""
    m1 = ModelMetadata(model_id="M-DUP", engine_id="tesseract", display_name="first")
    m2 = ModelMetadata(model_id="M-DUP", engine_id="tesseract", display_name="second")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", m1)
    MetadataWriter.write(tmp_path / "b.tess.json.model_metadata.json", m2)

    catalog = ModelCatalog(tmp_path)
    result = catalog.list()

    assert len(result) == 1
    # ファイル名の辞書順（a < b）で先に見つかった方が採用される
    assert result[0].display_name == "first"


def test_list_returns_no_duplicate_model_ids(tmp_path):
    m1 = ModelMetadata(model_id="M0001", engine_id="tesseract")
    m2 = ModelMetadata(model_id="M0002", engine_id="tesseract")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", m1)
    MetadataWriter.write(tmp_path / "b.tess.json.model_metadata.json", m2)

    catalog = ModelCatalog(tmp_path)
    model_ids = [m.model_id for m in catalog.list()]
    assert len(model_ids) == len(set(model_ids))


# ---------------------------------------------------------------------------
# find() / load() / exists()
# ---------------------------------------------------------------------------


def test_find_returns_matching_metadata(tmp_path):
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", metadata)

    catalog = ModelCatalog(tmp_path)
    assert catalog.find("M0001") == metadata


def test_find_returns_none_when_not_found(tmp_path):
    catalog = ModelCatalog(tmp_path)
    assert catalog.find("does-not-exist") is None


def test_load_returns_matching_metadata(tmp_path):
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", metadata)

    catalog = ModelCatalog(tmp_path)
    assert catalog.load("M0001") == metadata


def test_load_raises_model_catalog_error_when_not_found(tmp_path):
    catalog = ModelCatalog(tmp_path)
    with pytest.raises(ModelCatalogError):
        catalog.load("does-not-exist")


def test_exists_true_and_false(tmp_path):
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", metadata)

    catalog = ModelCatalog(tmp_path)
    assert catalog.exists("M0001") is True
    assert catalog.exists("nope") is False


# ---------------------------------------------------------------------------
# Directory Scan（Catalogのみが行う。存在しないディレクトリ等）
# ---------------------------------------------------------------------------


def test_list_raises_model_catalog_error_for_missing_directory(tmp_path):
    catalog = ModelCatalog(tmp_path / "does_not_exist")
    with pytest.raises(ModelCatalogError):
        catalog.list()


def test_find_raises_model_catalog_error_for_missing_directory(tmp_path):
    catalog = ModelCatalog(tmp_path / "does_not_exist")
    with pytest.raises(ModelCatalogError):
        catalog.find("M0001")


# ---------------------------------------------------------------------------
# Reader Error Propagation（握りつぶさず伝播する）
# ---------------------------------------------------------------------------


def test_broken_json_error_propagates_as_metadata_read_error(tmp_path):
    (tmp_path / "broken.tess.json").write_text("{not valid json", encoding="utf-8")
    catalog = ModelCatalog(tmp_path)
    with pytest.raises(MetadataReadError):
        catalog.list()


def test_unknown_engine_error_propagates_as_invalid_model_metadata_error(tmp_path):
    _write_json(tmp_path / "bad.ocr.json", {"engine": "not_a_real_engine"})
    catalog = ModelCatalog(tmp_path)
    with pytest.raises(InvalidModelMetadataError):
        catalog.list()


def test_unknown_engine_error_propagates_for_trocr_json(tmp_path):
    _write_json(tmp_path / "bad.trocr.json", {"engine": "not_a_real_engine"})
    catalog = ModelCatalog(tmp_path)
    with pytest.raises(InvalidModelMetadataError):
        catalog.list()


def test_broken_canonical_sidecar_error_propagates(tmp_path):
    (tmp_path / "x.tess.json.model_metadata.json").write_text("{not valid json", encoding="utf-8")
    catalog = ModelCatalog(tmp_path)
    with pytest.raises(MetadataReadError):
        catalog.list()


# ---------------------------------------------------------------------------
# 依存確認: CatalogがReader/Writerを直接壊していないこと
# ---------------------------------------------------------------------------


def test_catalog_uses_metadata_reader_read_legacy_directly(tmp_path):
    """Catalogが渡すのはPathのみで、legacy_formatはCatalog自身がファイル名から決定する。"""
    path = _write_json(tmp_path / "x.ocr.json", {"engine": "paddleocr"})
    direct = MetadataReader.read_legacy(path, LEGACY_FORMAT_OCR_JSON, model_id=path.name)

    catalog = ModelCatalog(tmp_path)
    via_catalog = catalog.find(path.name)

    assert via_catalog == direct


# ---------------------------------------------------------------------------
# Regression（Reader/Writer/Adapter/Canonical Schemaを壊していないことの確認）
# ---------------------------------------------------------------------------


def test_catalog_entries_round_trip_through_canonical_schema(tmp_path):
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract", extra={"a": 1})
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", metadata)

    catalog = ModelCatalog(tmp_path)
    result = catalog.find("M0001")
    restored = ModelMetadata.from_dict(result.to_dict())

    assert restored == result == metadata
