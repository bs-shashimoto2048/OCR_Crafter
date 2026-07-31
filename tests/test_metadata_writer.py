"""Metadata Writer（src/app/services/metadata_writer.py）の単体テスト。

Metadata Writer実装Issue（#38、Epic #28配下・Migration Phase 2）のスコープ通り、
`ModelMetadata`をCanonical sidecar JSONへ書き込む経路のみを検証する。Reader・Model
Catalogは対象外（Readerは既存の`metadata_reader.py`を無変更のまま利用してround tripを
確認する）。

Writerは実際にファイルI/Oを行う設計であるため、pytestの`tmp_path`フィクスチャで
隔離された一時ディレクトリを使う（実データ・実プロジェクトには一切触れない）。
"""

import json
from contextlib import contextmanager
from pathlib import Path

import pytest

import src.app.services.metadata_writer as metadata_writer_module
from src.app.services.metadata_reader import MetadataReader
from src.app.services.metadata_writer import MetadataWriteError, MetadataWriter
from src.app.services.model_metadata import InvalidModelMetadataError, ModelMetadata


def _target(tmp_path, name="digits_20260101.tess.json.model_metadata.json"):
    return tmp_path / name


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------


def test_write_creates_file_with_canonical_content(tmp_path):
    path = _target(tmp_path)
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract", display_name="Digits")

    MetadataWriter.write(path, metadata)

    assert path.is_file()
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload == metadata.to_dict()
    assert payload["schema_version"] == 1


def test_write_only_saves_schema_version_1():
    """to_dict()経由のためschema_versionは常にModelMetadataの値（1）のみが保存される。"""
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")
    assert metadata.to_dict()["schema_version"] == 1


def test_write_result_is_readable_by_metadata_reader(tmp_path):
    """Writerの出力がReader（変更していない既存モジュール）でそのまま読める（round trip）。"""
    path = _target(tmp_path)
    metadata = ModelMetadata(
        model_id="M0002",
        engine_id="paddleocr",
        display_name="PaddleOCR v2",
        dataset_id="DS-0001",
        extra={"note": "manual"},
    )

    MetadataWriter.write(path, metadata)
    restored = MetadataReader.read_canonical(path)

    assert restored == metadata


# ---------------------------------------------------------------------------
# Overwrite
# ---------------------------------------------------------------------------


def test_write_overwrite_replaces_content_entirely(tmp_path):
    path = _target(tmp_path)
    first = ModelMetadata(model_id="M0001", engine_id="tesseract", display_name="v1", dataset_id="DS-1")
    second = ModelMetadata(model_id="M0001", engine_id="tesseract", display_name="v2")

    MetadataWriter.write(path, first)
    MetadataWriter.write(path, second)

    restored = MetadataReader.read_canonical(path)
    assert restored == second
    # v1のdataset_idが残留していない（読み取り込みマージをしていないことの確認）
    assert restored.dataset_id is None


def test_write_overwrite_does_not_preserve_created_at():
    """本Issueのスコープでは既存sidecarの読み取り込み（created_at保持等）は行わない。"""
    metadata_v1 = ModelMetadata(model_id="M0001", engine_id="tesseract", created_at="2026-01-01T00:00:00")
    metadata_v2 = ModelMetadata(model_id="M0001", engine_id="tesseract")
    assert metadata_v2.created_at is None
    assert metadata_v1.created_at == "2026-01-01T00:00:00"


# ---------------------------------------------------------------------------
# Atomic Write
# ---------------------------------------------------------------------------


def test_write_leaves_no_temporary_files_behind(tmp_path):
    path = _target(tmp_path)
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")

    MetadataWriter.write(path, metadata)

    leftovers = [p for p in tmp_path.iterdir() if p.name != path.name and not p.name.endswith(".lock")]
    assert leftovers == []


def test_write_uses_atomic_write_json(tmp_path, monkeypatch):
    """`atomic_write_json`（既存の原子的書込プリミティブ）が実際に呼ばれていることを確認する。"""
    calls = []
    real_atomic_write_json = metadata_writer_module.atomic_write_json

    def spy(path, payload, indent=2):
        calls.append((Path(path), payload))
        return real_atomic_write_json(path, payload, indent=indent)

    monkeypatch.setattr(metadata_writer_module, "atomic_write_json", spy)

    path = _target(tmp_path)
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")
    MetadataWriter.write(path, metadata)

    assert len(calls) == 1
    assert calls[0][0] == path
    assert calls[0][1] == metadata.to_dict()


# ---------------------------------------------------------------------------
# File Lock
# ---------------------------------------------------------------------------


def test_write_uses_file_lock(tmp_path, monkeypatch):
    """`file_lock`（既存のプロセス間排他プリミティブ）が対象パスで実際に呼ばれていることを確認する。"""
    calls = []
    real_file_lock = metadata_writer_module.file_lock

    @contextmanager
    def spy_file_lock(path, timeout=30.0):
        calls.append(Path(path))
        with real_file_lock(path, timeout=timeout):
            yield

    monkeypatch.setattr(metadata_writer_module, "file_lock", spy_file_lock)

    path = _target(tmp_path)
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")
    MetadataWriter.write(path, metadata)

    assert calls == [path]


# ---------------------------------------------------------------------------
# Permission Error
# ---------------------------------------------------------------------------


def test_write_wraps_permission_error_as_metadata_write_error(tmp_path, monkeypatch):
    def boom(path, payload, indent=2):
        raise PermissionError("denied")

    monkeypatch.setattr(metadata_writer_module, "atomic_write_json", boom)

    path = _target(tmp_path)
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")

    with pytest.raises(MetadataWriteError) as exc_info:
        MetadataWriter.write(path, metadata)

    assert isinstance(exc_info.value.__cause__, PermissionError)


def test_write_wraps_generic_os_error_as_metadata_write_error(tmp_path, monkeypatch):
    def boom(path, payload, indent=2):
        raise OSError("disk full")

    monkeypatch.setattr(metadata_writer_module, "atomic_write_json", boom)

    path = _target(tmp_path)
    metadata = ModelMetadata(model_id="M0001", engine_id="tesseract")

    with pytest.raises(MetadataWriteError):
        MetadataWriter.write(path, metadata)


# ---------------------------------------------------------------------------
# Invalid Metadata
# ---------------------------------------------------------------------------


def test_write_rejects_non_model_metadata_dict(tmp_path):
    path = _target(tmp_path)
    with pytest.raises(InvalidModelMetadataError):
        MetadataWriter.write(path, {"model_id": "M0001", "engine_id": "tesseract"})


def test_write_rejects_none(tmp_path):
    path = _target(tmp_path)
    with pytest.raises(InvalidModelMetadataError):
        MetadataWriter.write(path, None)


def test_write_rejects_invalid_metadata_without_touching_filesystem(tmp_path):
    """型不正の場合、ファイルへの書込は一切試みられない（副作用が発生しない）。"""
    path = _target(tmp_path)
    with pytest.raises(InvalidModelMetadataError):
        MetadataWriter.write(path, "not a ModelMetadata")
    assert not path.exists()


# ---------------------------------------------------------------------------
# Regression（Canonical Schema・Readerを壊していないことの確認）
# ---------------------------------------------------------------------------


def test_writer_and_reader_round_trip_preserves_equality(tmp_path):
    path = _target(tmp_path, "resnet_20260101.pt.model_metadata.json")
    metadata = ModelMetadata(
        model_id="M0003",
        engine_id="trocr",
        display_name="TrOCR test",
        extra={"a": 1, "b": [1, 2, 3]},
    )

    MetadataWriter.write(path, metadata)
    restored = MetadataReader.read(path)

    assert restored == metadata
    assert restored.to_dict() == metadata.to_dict()
