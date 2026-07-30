"""Model Metadata（src/app/services/model_metadata.py）の単体テスト。

共通Model Metadata実装Issue（#14）のスコープ通り、生成・シリアライズ/
デシリアライズ・バリデーション・不変性・状態分離のみを検証する。
既存処理（model_registry.py/ocr_pipeline.py等）への適用・Adapter・
TrOCR・Frontendは対象外（本モジュールはまだ既存コードから参照されていない）。
"""

import dataclasses

import pytest

from src.app.services.model_metadata import InvalidModelMetadataError, ModelMetadata


# ---------------------------------------------------------------------------
# 正常系
# ---------------------------------------------------------------------------


def test_can_create_with_minimum_required_fields():
    """必須フィールド（model_id/engine_id）のみで生成できる。他は既定でNone/空。"""
    m = ModelMetadata(model_id="M0001", engine_id="tesseract")

    assert m.model_id == "M0001"
    assert m.engine_id == "tesseract"
    assert m.display_name is None
    assert m.model_type is None
    assert m.created_at is None
    assert m.updated_at is None
    assert m.artifact_path is None
    assert m.dataset_id is None
    assert m.experiment_id is None
    assert m.preprocess_version is None
    assert m.source is None
    assert dict(m.extra) == {}


def test_can_create_with_all_optional_fields():
    """正常系: 全任意項目を指定して生成できる。"""
    m = ModelMetadata(
        model_id="M0002",
        engine_id="paddleocr",
        display_name="PaddleOCR v2",
        model_type="recognizer",
        created_at="2026-07-15T09:00:00",
        updated_at="2026-07-16T09:00:00",
        artifact_path="/data/projects/p1/models/m2",
        dataset_id="DS-0001",
        experiment_id="EXP-0001",
        preprocess_version="3",
        source="training",
        extra={"note": "manual entry"},
    )

    assert m.display_name == "PaddleOCR v2"
    assert m.model_type == "recognizer"
    assert m.created_at == "2026-07-15T09:00:00"
    assert m.updated_at == "2026-07-16T09:00:00"
    assert m.artifact_path == "/data/projects/p1/models/m2"
    assert m.dataset_id == "DS-0001"
    assert m.experiment_id == "EXP-0001"
    assert m.preprocess_version == "3"
    assert m.source == "training"
    assert dict(m.extra) == {"note": "manual entry"}


def test_to_dict_contains_all_fields_including_none():
    """to_dict()はNoneフィールドも含めて全キーを出力する。"""
    m = ModelMetadata(model_id="M0001", engine_id="tesseract")
    d = m.to_dict()

    assert d == {
        "model_id": "M0001",
        "engine_id": "tesseract",
        "display_name": None,
        "model_type": None,
        "created_at": None,
        "updated_at": None,
        "artifact_path": None,
        "dataset_id": None,
        "experiment_id": None,
        "preprocess_version": None,
        "source": None,
        "extra": {},
    }


def test_from_dict_basic():
    """from_dict()で辞書からModelMetadataを構築できる。"""
    m = ModelMetadata.from_dict({"model_id": "M0001", "engine_id": "easyocr"})
    assert m.model_id == "M0001"
    assert m.engine_id == "easyocr"


def test_round_trip_to_dict_from_dict():
    """to_dict() -> from_dict() で元と同じ内容へ復元できる（round trip）。"""
    original = ModelMetadata(
        model_id="M0003",
        engine_id="trocr",
        display_name="TrOCR test",
        extra={"a": 1, "b": [1, 2, 3]},
    )
    restored = ModelMetadata.from_dict(original.to_dict())

    assert restored == original
    assert restored is not original
    assert restored.to_dict() == original.to_dict()


@pytest.mark.parametrize("engine_id", ["tesseract", "paddleocr", "easyocr", "trocr"])
def test_all_four_registered_engines_are_accepted(engine_id):
    """正常系: 登録済み4エンジン（tesseract/paddleocr/easyocr/trocr）すべて受け付ける。"""
    m = ModelMetadata(model_id="M0001", engine_id=engine_id)
    assert m.engine_id == engine_id


def test_extra_is_preserved():
    """正常系: extraに渡した値が保持される。"""
    m = ModelMetadata(model_id="M0001", engine_id="tesseract", extra={"psm": 7, "whitelist": "ABC"})
    assert m.extra["psm"] == 7
    assert m.extra["whitelist"] == "ABC"


def test_instance_is_immutable():
    """immutable性: frozen dataclassのため生成後にフィールドを直接書き換えられない。"""
    m = ModelMetadata(model_id="M0001", engine_id="tesseract")
    with pytest.raises(dataclasses.FrozenInstanceError):
        m.model_id = "M0002"


def test_independent_instances_do_not_share_state():
    """独立インスタンス間で状態を共有しない。"""
    m1 = ModelMetadata(model_id="M0001", engine_id="tesseract", extra={"x": [1]})
    m2 = ModelMetadata(model_id="M0002", engine_id="paddleocr", extra={"x": [2]})

    assert m1.model_id != m2.model_id
    assert m1.extra["x"] == [1]
    assert m2.extra["x"] == [2]


def test_extra_mutation_of_original_input_after_construction_does_not_leak():
    """extraはdeep copyされるため、構築後に呼び出し元の元dictを変更しても内部状態は影響を受けない。"""
    original_extra = {"nested": [1, 2]}
    m = ModelMetadata(model_id="M0001", engine_id="tesseract", extra=original_extra)

    original_extra["nested"].append(3)
    original_extra["new_key"] = "leaked?"

    assert dict(m.extra) == {"nested": [1, 2]}


def test_to_dict_output_mutation_does_not_affect_original():
    """to_dict()の戻り値（extra含む）を変更しても元オブジェクトへ影響しない。"""
    m = ModelMetadata(model_id="M0001", engine_id="tesseract", extra={"nested": [1, 2]})
    d = m.to_dict()

    d["model_id"] = "hacked"
    d["extra"]["nested"].append(999)

    assert m.model_id == "M0001"
    assert dict(m.extra) == {"nested": [1, 2]}


def test_extra_is_read_only_mapping():
    """extraはMappingProxyTypeで、外部からキーの追加・削除ができない。"""
    m = ModelMetadata(model_id="M0001", engine_id="tesseract", extra={"a": 1})
    with pytest.raises(TypeError):
        m.extra["b"] = 2


# ---------------------------------------------------------------------------
# 異常系
# ---------------------------------------------------------------------------


def test_model_id_none_is_rejected():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id=None, engine_id="tesseract")


def test_model_id_empty_string_is_rejected():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="", engine_id="tesseract")


def test_model_id_whitespace_only_is_rejected():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="   ", engine_id="tesseract")


def test_model_id_with_leading_or_trailing_whitespace_is_rejected():
    """model_idは前後空白を暗黙にトリムせず、明示的に拒否する。"""
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id=" M0001", engine_id="tesseract")
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001 ", engine_id="tesseract")


def test_model_id_preserves_case():
    """model_idは大文字小文字を保持する（正規化しない）。"""
    m = ModelMetadata(model_id="M0001", engine_id="tesseract")
    assert m.model_id == "M0001"


def test_engine_id_none_is_rejected():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001", engine_id=None)


def test_engine_id_empty_string_is_rejected():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001", engine_id="")


def test_unknown_engine_is_rejected_not_fallback_to_paddleocr():
    """未知engineは拒否する。暗黙にpaddleocrへフォールバックしない。"""
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001", engine_id="unknown_future_engine")

    # カスタム分類モデルのengine="custom"もEngine Registry未登録のため現時点では拒否される
    # （既知の制約。詳細はFEATURE_MODEL_METADATA.md参照）
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001", engine_id="custom")


def test_engine_id_case_and_whitespace_are_normalized_via_resolve_engine_id():
    """engine_idはresolve_engine_id()経由で正規化される（別ロジックを複製していない）。"""
    m = ModelMetadata(model_id="M0001", engine_id="  Tesseract  ")
    assert m.engine_id == "tesseract"


def test_invalid_type_for_model_id_is_rejected():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id=12345, engine_id="tesseract")


def test_invalid_type_for_optional_string_field_is_rejected():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001", engine_id="tesseract", created_at=20260715)


def test_missing_required_field_via_from_dict_raises_clear_error():
    """必須フィールド欠損時、from_dict()はKeyError/TypeErrorではなくInvalidModelMetadataErrorを送出する。"""
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata.from_dict({"engine_id": "tesseract"})  # model_id欠損

    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata.from_dict({"model_id": "M0001"})  # engine_id欠損


def test_extra_non_mapping_is_rejected():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001", engine_id="tesseract", extra=["not", "a", "dict"])

    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001", engine_id="tesseract", extra="also not a dict")


def test_extra_colliding_with_common_field_is_rejected():
    """共通フィールドと同名のキーをextraへ入れると衝突として拒否される。"""
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001", engine_id="tesseract", extra={"engine_id": "paddleocr"})

    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata(model_id="M0001", engine_id="tesseract", extra={"model_id": "override"})


def test_from_dict_ignores_unknown_fields_without_error():
    """from_dict()は未知フィールドを無視する（extraへ自動混入もしない）。"""
    m = ModelMetadata.from_dict(
        {
            "model_id": "M0001",
            "engine_id": "tesseract",
            "some_future_field_not_modeled_yet": "value",
        }
    )
    assert m.model_id == "M0001"
    assert dict(m.extra) == {}  # 未知フィールドはextraへ混入されない


def test_from_dict_rejects_non_mapping_input():
    with pytest.raises(InvalidModelMetadataError):
        ModelMetadata.from_dict(["not", "a", "mapping"])


# ---------------------------------------------------------------------------
# 互換性（既存メタデータ代表例）
# ---------------------------------------------------------------------------


def test_from_dict_with_ocr_json_like_representative_sample():
    """互換性: .ocr.json相当の代表的なフィールド一部を使ってfrom_dict()できる。

    .ocr.json自体の全フィールド（training_params等）は本Issueではモデル化しない。
    共通フィールドに該当する部分のみ抽出してfrom_dict()へ渡す想定を確認する。
    """
    ocr_json_like = {
        "engine": "paddleocr",  # 実際のキー名は"engine"だが、ModelMetadataは"engine_id"を使う
        "created_at": "2026-07-15T09:00:00",
        "dataset_id": "DS-0001",
    }
    # 実際のAdapterは後続Issue。ここでは共通フィールド名へ詰め替えた入力を検証する
    m = ModelMetadata.from_dict(
        {
            "model_id": "m1.ocr.json",
            "engine_id": ocr_json_like["engine"],
            "created_at": ocr_json_like["created_at"],
            "dataset_id": ocr_json_like["dataset_id"],
        }
    )
    assert m.engine_id == "paddleocr"
    assert m.created_at == "2026-07-15T09:00:00"


def test_from_dict_with_none_optional_fields_like_legacy_tess_json():
    """互換性: 旧.tess.json相当（多数の任意項目がNone）でも構築できる。"""
    legacy_like = {
        "model_id": "legacy_model.tess.json",
        "engine_id": "tesseract",
        "created_at": "2026-01-01T00:00:00",
        "dataset_id": None,
        "experiment_id": None,
        "preprocess_version": None,
    }
    m = ModelMetadata.from_dict(legacy_like)
    assert m.dataset_id is None
    assert m.experiment_id is None
    assert m.preprocess_version is None


def test_from_dict_with_minimal_legacy_input_only_required_fields():
    """互換性: 旧データ相当の最小入力（model_id/engine_idのみ）でも構築できる。"""
    m = ModelMetadata.from_dict({"model_id": "old_model", "engine_id": "easyocr"})
    assert m.model_id == "old_model"
    assert m.engine_id == "easyocr"
    assert dict(m.extra) == {}
