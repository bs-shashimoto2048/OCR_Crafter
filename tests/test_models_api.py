"""Models API（src/app/services/models_api.py）の単体テスト。

Models API実装Issue（#44、Epic #28配下・Migration Phase 5）のスコープ通り、
`ModelsAPI`がCatalog/Factory/Writerへの薄いFacadeとして機能することのみを検証する。
Metadata Reader・Metadata Writer・Model Catalog・Training Metadata Factoryへの
機能追加は行っていない（いずれも無変更のまま利用する）。

`ModelsAPI`は内部で`ModelCatalog`を介してディレクトリを走査するため、pytestの
`tmp_path`フィクスチャで隔離された一時ディレクトリを使う（実データ・実プロジェクトには
一切触れない）。
"""

import pytest

from src.app.services.metadata_reader import MetadataReader
from src.app.services.metadata_writer import MetadataWriter
from src.app.services.model_catalog import ModelCatalog, ModelCatalogError
from src.app.services.model_metadata import InvalidModelMetadataError, ModelMetadata
from src.app.services.models_api import ModelsAPI, ModelsAPIError
from src.app.services.training_metadata_factory import TrainingMetadataFactoryError

# ---------------------------------------------------------------------------
# list_models()
# ---------------------------------------------------------------------------


def test_list_models_returns_empty_for_empty_directory(tmp_path):
    api = ModelsAPI(tmp_path)
    assert api.list_models() == []


def test_list_models_returns_catalog_entries(tmp_path):
    m1 = ModelMetadata(model_id="M0001", engine_id="tesseract")
    m2 = ModelMetadata(model_id="M0002", engine_id="paddleocr")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", m1)
    MetadataWriter.write(tmp_path / "b.ocr.json.model_metadata.json", m2)

    api = ModelsAPI(tmp_path)
    result = {m.model_id: m for m in api.list_models()}

    assert result == {"M0001": m1, "M0002": m2}


# ---------------------------------------------------------------------------
# get_model()
# ---------------------------------------------------------------------------


def test_get_model_returns_matching_entry(tmp_path):
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract", display_name="Digits")
    MetadataWriter.write(tmp_path / "digits.tess.json.model_metadata.json", metadata)

    api = ModelsAPI(tmp_path)
    assert api.get_model("M0001") == metadata


def test_get_model_raises_model_catalog_error_when_not_found(tmp_path):
    api = ModelsAPI(tmp_path)
    with pytest.raises(ModelCatalogError):
        api.get_model("M9999")


# ---------------------------------------------------------------------------
# exists()
# ---------------------------------------------------------------------------


def test_exists_true_when_model_present(tmp_path):
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", metadata)

    api = ModelsAPI(tmp_path)
    assert api.exists("M0001") is True


def test_exists_false_when_model_absent(tmp_path):
    api = ModelsAPI(tmp_path)
    assert api.exists("M9999") is False


# ---------------------------------------------------------------------------
# create_metadata()
# ---------------------------------------------------------------------------


def test_create_metadata_delegates_to_factory(tmp_path):
    api = ModelsAPI(tmp_path)
    result = api.create_metadata(model_id="M0001", engine="paddleocr", model_name="PaddleOCR")

    assert isinstance(result, ModelMetadata)
    assert result.model_id == "M0001"
    assert result.engine_id == "paddleocr"
    assert result.display_name == "PaddleOCR"
    assert result.source == "training"


def test_create_metadata_missing_required_kwarg_raises_models_api_error(tmp_path):
    api = ModelsAPI(tmp_path)
    with pytest.raises(ModelsAPIError):
        api.create_metadata(engine="paddleocr")  # model_id欠損


def test_create_metadata_extra_collision_propagates_factory_error(tmp_path):
    api = ModelsAPI(tmp_path)
    with pytest.raises(TrainingMetadataFactoryError):
        api.create_metadata(
            model_id="M0001", engine="paddleocr", task="text_recognition", extra={"task": "dup"}
        )


def test_create_metadata_validation_violation_propagates_invalid_model_metadata_error(tmp_path):
    api = ModelsAPI(tmp_path)
    with pytest.raises(InvalidModelMetadataError):
        api.create_metadata(model_id="M0001", engine="custom")


# ---------------------------------------------------------------------------
# save_metadata()
# ---------------------------------------------------------------------------


def test_save_metadata_delegates_to_writer(tmp_path):
    api = ModelsAPI(tmp_path)
    metadata = ModelMetadata(model_id="M0001", engine_id="paddleocr")
    target = tmp_path / "m1.model_metadata.json"

    api.save_metadata(target, metadata)

    assert target.exists()
    assert MetadataReader.read_canonical(target) == metadata


def test_save_metadata_non_model_metadata_raises_invalid_model_metadata_error(tmp_path):
    api = ModelsAPI(tmp_path)
    with pytest.raises(InvalidModelMetadataError):
        api.save_metadata(tmp_path / "bad.model_metadata.json", {"not": "a ModelMetadata"})


# ---------------------------------------------------------------------------
# Catalog呼び出し（list_models/get_model/existsがCatalogへ委譲されていることの確認）
# ---------------------------------------------------------------------------


def test_list_models_reflects_files_written_directly_to_directory(tmp_path):
    api = ModelsAPI(tmp_path)
    assert api.list_models() == []

    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", metadata)

    assert api.list_models() == [metadata]
    assert ModelCatalog(tmp_path).list() == api.list_models()


def test_catalog_scan_error_propagates(tmp_path):
    api = ModelsAPI(tmp_path / "does_not_exist")
    with pytest.raises(ModelCatalogError):
        api.list_models()


# ---------------------------------------------------------------------------
# Factory呼び出し（create_from_trainingが実際に呼ばれていることの確認）
# ---------------------------------------------------------------------------


def test_create_metadata_generates_created_at_when_omitted(tmp_path):
    api = ModelsAPI(tmp_path)
    result = api.create_metadata(model_id="M0001", engine="paddleocr")
    assert result.created_at is not None


# ---------------------------------------------------------------------------
# Writer呼び出し（write()が実際に呼ばれ、Reader経由で往復できることの確認）
# ---------------------------------------------------------------------------


def test_create_metadata_then_save_metadata_round_trip(tmp_path):
    api = ModelsAPI(tmp_path)
    metadata = api.create_metadata(model_id="M0001", engine="paddleocr", model_name="PaddleOCR")
    target = tmp_path / "m0001.model_metadata.json"

    api.save_metadata(target, metadata)

    assert api.get_model("M0001") == metadata
    assert MetadataReader.read_canonical(target) == metadata


# ---------------------------------------------------------------------------
# Error Propagation
# ---------------------------------------------------------------------------


def test_constructor_rejects_non_path_like_directory():
    with pytest.raises(ModelsAPIError):
        ModelsAPI(12345)


def test_writer_io_error_propagates_as_metadata_write_error(tmp_path, monkeypatch):
    from src.app.services import metadata_writer

    def _boom(path, metadata):
        raise metadata_writer.MetadataWriteError("boom")

    monkeypatch.setattr(metadata_writer.MetadataWriter, "write", staticmethod(_boom))

    api = ModelsAPI(tmp_path)
    with pytest.raises(metadata_writer.MetadataWriteError):
        api.save_metadata(tmp_path / "x.model_metadata.json", ModelMetadata(model_id="M1", engine_id="tesseract"))


# ---------------------------------------------------------------------------
# Regression（既存レイヤーの直接呼び出しとの一致確認）
# ---------------------------------------------------------------------------


def test_models_api_list_matches_direct_catalog_usage(tmp_path):
    m1 = ModelMetadata(model_id="M0001", engine_id="tesseract")
    MetadataWriter.write(tmp_path / "a.tess.json.model_metadata.json", m1)

    api_result = ModelsAPI(tmp_path).list_models()
    direct_result = ModelCatalog(tmp_path).list()

    assert api_result == direct_result


def test_models_api_does_not_expose_metadata_reader_directly():
    import src.app.services.models_api as models_api_module

    assert not hasattr(models_api_module, "MetadataReader")
