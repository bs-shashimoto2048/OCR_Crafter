"""Engine Capability（src/app/services/engine_capability.py）の単体テスト。

Engine Capability実装Issueのスコープ通り、生成・シリアライズ/デシリアライズ・
比較・コピー（dataclasses.replace経由）・不変性のみを検証する。Registry連携・
既存if/elif分岐への影響は対象外（本モジュールは既存コードから参照されていない）。
"""

import dataclasses

import pytest

import src.app.services.engine_capability as engine_capability
from src.app.services.engine_capability import (
    BUILTIN_CAPABILITIES,
    ENGINE_ID_EASYOCR,
    ENGINE_ID_PADDLEOCR,
    ENGINE_ID_TESSERACT,
    ENGINE_ID_TROCR,
    KNOWN_ENGINE_IDS,
    EngineCapability,
    get_builtin_capability,
)


def test_engine_capability_generation_with_defaults():
    """必須フィールドのみ指定すれば、残りは安全なデフォルト値で生成できる。"""
    cap = EngineCapability(engine_id="dummy", display_name="Dummy Engine")

    assert cap.engine_id == "dummy"
    assert cap.display_name == "Dummy Engine"
    assert cap.version == "1.0.0"
    assert cap.supports_training is False
    assert cap.supports_inference is True
    assert cap.supported_languages == ()
    assert cap.minimum_vram is None
    assert cap.required_metadata == ()


def test_known_engine_ids_have_builtin_capability():
    """最低限tesseract/paddleocr/easyocr/trocrのCapabilityが定義されている。"""
    assert KNOWN_ENGINE_IDS == (
        ENGINE_ID_TESSERACT,
        ENGINE_ID_PADDLEOCR,
        ENGINE_ID_EASYOCR,
        ENGINE_ID_TROCR,
    )
    for engine_id in KNOWN_ENGINE_IDS:
        cap = get_builtin_capability(engine_id)
        assert cap.engine_id == engine_id
        assert isinstance(cap, EngineCapability)


def test_trocr_capability_defined_but_not_wired_elsewhere():
    """TrOCRは未実装だがCapabilityとしては定義されている（推測補完しない項目はFalse/空のまま）。"""
    cap = get_builtin_capability(ENGINE_ID_TROCR)

    assert cap.display_name == "TrOCR"
    assert cap.framework == "transformers"
    assert cap.supports_training is True
    assert cap.supported_languages == ("en",)
    # Windows実機検証は未実施のため、推測補完せず空のまま
    assert cap.supported_platforms == ()
    # 文字単位confidenceの算出方法は未解決事項（ARCHITECTURE_DRAFT.md参照）のためFalse
    assert cap.supports_confidence is False


def test_to_dict_and_from_dict_roundtrip():
    """シリアライズ（to_dict）→デシリアライズ（from_dict）で元と同じ内容へ復元できる。"""
    original = get_builtin_capability(ENGINE_ID_TESSERACT)

    as_dict = original.to_dict()
    assert isinstance(as_dict, dict)
    assert as_dict["engine_id"] == ENGINE_ID_TESSERACT

    restored = EngineCapability.from_dict(as_dict)
    assert restored == original
    assert restored is not original


def test_from_dict_ignores_unknown_keys():
    """未知キーが含まれていても無視して復元できる（将来のスキーマ拡張への耐性）。"""
    data = get_builtin_capability(ENGINE_ID_PADDLEOCR).to_dict()
    data["future_field_not_defined_yet"] = "value"

    restored = EngineCapability.from_dict(data)
    assert restored == get_builtin_capability(ENGINE_ID_PADDLEOCR)


def test_from_dict_coerces_json_lists_back_to_tuples():
    """JSON経由（json.loadsはtupleをlistへ変換する）で得たlist値もtupleへ矯正される。"""
    restored = EngineCapability.from_dict(
        {
            "engine_id": "dummy",
            "display_name": "Dummy",
            "supported_languages": ["en", "ja"],  # listのまま渡す（JSONデコード後を想定）
        }
    )

    assert isinstance(restored.supported_languages, tuple)
    assert restored.supported_languages == ("en", "ja")


def test_equality_compares_by_value():
    """同じ内容のCapabilityは等価、異なる内容は非等価と判定できる。"""
    a = EngineCapability(engine_id="x", display_name="X", version="1.0.0")
    b = EngineCapability(engine_id="x", display_name="X", version="1.0.0")
    c = EngineCapability(engine_id="x", display_name="X", version="2.0.0")

    assert a == b
    assert a != c
    assert get_builtin_capability(ENGINE_ID_TESSERACT) != get_builtin_capability(ENGINE_ID_PADDLEOCR)


def test_capability_is_immutable():
    """frozen dataclassのため、生成後にフィールドを直接書き換えることはできない。"""
    cap = get_builtin_capability(ENGINE_ID_TESSERACT)
    with pytest.raises(dataclasses.FrozenInstanceError):
        cap.display_name = "Changed"


def test_sequence_fields_are_tuples_not_mutable_lists():
    """list型のフィールドを持たない（frozenでも.append()等で変更できてしまう抜け道を作らない）。"""
    cap = get_builtin_capability(ENGINE_ID_TESSERACT)

    for name in (
        "supported_platforms",
        "supported_export_formats",
        "supported_languages",
        "accepted_dataset_types",
        "required_annotations",
        "required_image_format",
        "required_metadata",
        "optional_metadata",
    ):
        assert isinstance(getattr(cap, name), tuple), f"{name} should be a tuple, not a mutable list"


def test_copy_via_dataclasses_replace_changes_only_specified_fields():
    """frozen dataclassの複製は標準の dataclasses.replace() で行う（専用copy()は持たない）。"""
    original = get_builtin_capability(ENGINE_ID_PADDLEOCR)
    copied = dataclasses.replace(original, display_name="PaddleOCR (カスタムラベル)")

    assert copied.display_name == "PaddleOCR (カスタムラベル)"
    assert copied.engine_id == original.engine_id
    assert copied.framework == original.framework
    assert copied != original
    assert copied is not original


def test_builtin_capabilities_dict_matches_known_engine_ids():
    """BUILTIN_CAPABILITIESのキー集合がKNOWN_ENGINE_IDSと一致する。"""
    assert set(BUILTIN_CAPABILITIES.keys()) == set(KNOWN_ENGINE_IDS)


def test_builtin_capabilities_is_read_only():
    """BUILTIN_CAPABILITIESはMappingProxyTypeで、外部からキーの追加・上書きができない。"""
    with pytest.raises(TypeError):
        BUILTIN_CAPABILITIES["hacked"] = get_builtin_capability(ENGINE_ID_TESSERACT)


def test_get_builtin_capability_unknown_engine_raises_key_error():
    """未定義のengine_idを指定するとKeyErrorになる（無言のフォールバックをしない）。"""
    with pytest.raises(KeyError):
        get_builtin_capability("unknown_future_engine")


def test_module_does_not_import_heavy_dependencies():
    """本Issueのスコープ（Registry非依存・重量級ライブラリ非依存）を確認する。

    engine_capability.py はデータ定義のみで、paddleocr/easyocr/transformers等の
    重量級ライブラリに依存しない（遅延importの対象にすらならない、という設計）。
    """
    import sys

    module = sys.modules[engine_capability.__name__]
    source = module.__file__
    with open(source, encoding="utf-8") as f:
        content = f.read()

    for forbidden in ("import paddleocr", "import easyocr", "import transformers", "import torch"):
        assert forbidden not in content
