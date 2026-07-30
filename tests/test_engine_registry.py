"""Engine Registry（src/app/services/engine_registry.py）の単体テスト。

Engine Registry MVP実装Issueのスコープ通り、EngineDescriptor/EngineRegistryの
登録・取得・削除・存在確認と、状態分離のみを検証する。既存if/elif分岐・
Handler群（Training/Inference/Evaluation等）は対象外（本モジュールはまだ
既存コードから参照されていない）。
"""

import pytest

from src.app.services.engine_capability import (
    ENGINE_ID_EASYOCR,
    ENGINE_ID_PADDLEOCR,
    ENGINE_ID_TESSERACT,
    ENGINE_ID_TROCR,
    BUILTIN_CAPABILITIES,
    get_builtin_capability,
)
from src.app.services.engine_registry import (
    EngineAlreadyRegisteredError,
    EngineDescriptor,
    EngineNotFoundError,
    EngineRegistry,
    InvalidEngineDescriptorError,
    create_default_registry,
    resolve_engine_id,
)


def _dummy_capability(engine_id: str, display_name: str):
    """テスト専用の最小EngineCapability（本物のBUILTIN_CAPABILITIESは書き換えない）。"""
    capability_cls = get_builtin_capability(ENGINE_ID_TESSERACT).__class__
    return capability_cls(engine_id=engine_id, display_name=display_name)


def _dummy_descriptor(engine_id: str = "dummy", implemented: bool = True) -> EngineDescriptor:
    display_name = f"Dummy {engine_id}"
    return EngineDescriptor(
        engine_id=engine_id,
        display_name=display_name,
        capability=_dummy_capability(engine_id, display_name),
        implemented=implemented,
    )


# ---------------------------------------------------------------------------
# 正常系
# ---------------------------------------------------------------------------


def test_can_create_empty_registry():
    """空のRegistryを生成できる。"""
    registry = EngineRegistry()
    assert registry.list() == ()


def test_register_and_get_descriptor():
    """EngineDescriptorを登録し、getで取得できる。"""
    registry = EngineRegistry()
    descriptor = _dummy_descriptor("dummy1")

    registry.register(descriptor)

    assert registry.get("dummy1") is descriptor


def test_exists_reflects_registration_state():
    """existsが登録状態を正しく反映する。"""
    registry = EngineRegistry()
    assert registry.exists("dummy1") is False

    registry.register(_dummy_descriptor("dummy1"))
    assert registry.exists("dummy1") is True


def test_list_preserves_registration_order():
    """listが登録順を保持する。"""
    registry = EngineRegistry()
    registry.register(_dummy_descriptor("third"))
    registry.register(_dummy_descriptor("first"))
    registry.register(_dummy_descriptor("second"))

    assert [d.engine_id for d in registry.list()] == ["third", "first", "second"]


def test_unregister_removes_descriptor():
    """unregisterで登録済みDescriptorを削除できる。"""
    registry = EngineRegistry()
    registry.register(_dummy_descriptor("dummy1"))

    registry.unregister("dummy1")

    assert registry.exists("dummy1") is False
    assert registry.list() == ()


def test_default_registry_has_four_builtin_engines():
    """組み込みRegistryに4エンジン（tesseract/paddleocr/easyocr/trocr）が存在する。"""
    registry = create_default_registry()

    assert {d.engine_id for d in registry.list()} == {
        ENGINE_ID_TESSERACT,
        ENGINE_ID_PADDLEOCR,
        ENGINE_ID_EASYOCR,
        ENGINE_ID_TROCR,
    }
    assert len(registry.list()) == 4


def test_default_registry_capability_matches_builtin_capabilities():
    """組み込みDescriptorのCapabilityがBUILTIN_CAPABILITIESと一致する（重複定義していない）。"""
    registry = create_default_registry()

    for engine_id, expected_capability in BUILTIN_CAPABILITIES.items():
        assert registry.get(engine_id).capability == expected_capability


def test_default_registry_trocr_is_not_implemented():
    """TrOCRはimplemented=Falseとして登録されている（未実装であることが明確）。"""
    registry = create_default_registry()

    assert registry.get(ENGINE_ID_TROCR).implemented is False
    for engine_id in (ENGINE_ID_TESSERACT, ENGINE_ID_PADDLEOCR, ENGINE_ID_EASYOCR):
        assert registry.get(engine_id).implemented is True


def test_default_registry_version_is_none_for_all_builtin_engines():
    """組み込み4エンジンとも version は None（バージョン管理はRegistryの責務としない）。

    PaddleOCR/EasyOCRのrequirements.txt由来バージョンを一度は転記していたが、
    静的な文字列としてハードコードすると更新への追従が保証できず、実際の
    バージョンとずれても気づけない（Noneより悪い）ため、レビューで見直した。
    実際にインストールされたバージョンの解決はVersionResolver/MetadataProvider
    （いずれも将来実装）の責務とし、本Issueでは捏造も転記もしない。
    """
    registry = create_default_registry()

    for engine_id in (ENGINE_ID_TESSERACT, ENGINE_ID_PADDLEOCR, ENGINE_ID_EASYOCR, ENGINE_ID_TROCR):
        assert registry.get(engine_id).version is None


# ---------------------------------------------------------------------------
# 異常系
# ---------------------------------------------------------------------------


def test_register_rejects_duplicate_engine_id():
    """同じengine_idの重複登録を拒否する（暗黙の上書きをしない）。"""
    registry = EngineRegistry()
    registry.register(_dummy_descriptor("dummy1"))

    with pytest.raises(EngineAlreadyRegisteredError):
        registry.register(_dummy_descriptor("dummy1"))

    # 上書きされず、最初に登録したインスタンスのままである
    assert registry.get("dummy1").display_name == "Dummy dummy1"


def test_register_rejects_none():
    """Noneの登録を拒否する。"""
    registry = EngineRegistry()
    with pytest.raises(InvalidEngineDescriptorError):
        registry.register(None)


def test_register_rejects_non_descriptor_object():
    """EngineDescriptor以外（dict等）の登録を拒否する。"""
    registry = EngineRegistry()
    with pytest.raises(InvalidEngineDescriptorError):
        registry.register({"engine_id": "dummy1"})


def test_engine_descriptor_rejects_empty_engine_id():
    """空文字engine_idを拒否する。"""
    with pytest.raises(InvalidEngineDescriptorError):
        EngineDescriptor(
            engine_id="",
            display_name="Dummy",
            capability=_dummy_capability("", "Dummy"),
            implemented=True,
        )


def test_engine_descriptor_rejects_empty_display_name():
    """空文字display_nameを拒否する。"""
    capability = _dummy_capability("dummy1", "")
    with pytest.raises(InvalidEngineDescriptorError):
        EngineDescriptor(engine_id="dummy1", display_name="", capability=capability, implemented=True)


def test_engine_descriptor_rejects_non_capability_type():
    """capabilityがEngineCapability型以外の場合を拒否する。"""
    with pytest.raises(InvalidEngineDescriptorError):
        EngineDescriptor(engine_id="dummy1", display_name="Dummy", capability={"not": "a capability"}, implemented=True)


def test_engine_descriptor_rejects_uppercase_or_whitespace_engine_id():
    """大文字・前後空白を含むengine_idを拒否する（暗黙の正規化はしない）。"""
    for bad_id in ("Tesseract", "TESSERACT", " tesseract", "tesseract ", "PADDLE_OCR"):
        with pytest.raises(InvalidEngineDescriptorError):
            EngineDescriptor(
                engine_id=bad_id,
                display_name="Dummy",
                capability=_dummy_capability(bad_id, "Dummy"),
                implemented=True,
            )


def test_engine_descriptor_rejects_engine_id_capability_mismatch():
    """engine_idとcapability.engine_idが一致しない場合を拒否する。"""
    mismatched_capability = get_builtin_capability(ENGINE_ID_TESSERACT)  # engine_id="tesseract"
    with pytest.raises(InvalidEngineDescriptorError):
        EngineDescriptor(
            engine_id="dummy1",
            display_name="Dummy",
            capability=mismatched_capability,
            implemented=True,
        )


def test_get_unknown_engine_raises_not_found():
    """未登録IDのget時にEngineNotFoundErrorを送出する。"""
    registry = EngineRegistry()
    with pytest.raises(EngineNotFoundError):
        registry.get("unknown")


def test_unregister_unknown_engine_raises_not_found():
    """未登録IDのunregister時にEngineNotFoundErrorを送出する。"""
    registry = EngineRegistry()
    with pytest.raises(EngineNotFoundError):
        registry.unregister("unknown")


def test_list_return_value_does_not_expose_internal_state():
    """list()の戻り値（tuple）を変更しても、Registry内部の登録状態は変わらない。"""
    registry = EngineRegistry()
    registry.register(_dummy_descriptor("dummy1"))

    snapshot = registry.list()
    assert isinstance(snapshot, tuple)
    # tupleは要素追加できないため、内部dictへ影響を与える手段が無いことを構造的に保証する
    with pytest.raises(AttributeError):
        snapshot.append(_dummy_descriptor("dummy2"))  # type: ignore[attr-defined]

    assert len(registry.list()) == 1


def test_builtin_descriptors_cannot_be_mutated_externally():
    """組み込みDescriptor（frozen dataclass）を外部から変更できない。"""
    registry = create_default_registry()
    descriptor = registry.get(ENGINE_ID_TESSERACT)

    import dataclasses

    with pytest.raises(dataclasses.FrozenInstanceError):
        descriptor.display_name = "Hacked"

    assert registry.get(ENGINE_ID_TESSERACT).display_name == "Tesseract"


def test_case_and_alias_do_not_implicitly_match():
    """大文字・別表記のIDが暗黙に一致しない（完全一致のみ）。"""
    registry = create_default_registry()

    assert registry.exists("Tesseract") is False
    assert registry.exists("TESSERACT") is False
    assert registry.exists("paddle") is False
    assert registry.exists("paddle_ocr") is False

    with pytest.raises(EngineNotFoundError):
        registry.get("PaddleOCR")


# ---------------------------------------------------------------------------
# 状態分離
# ---------------------------------------------------------------------------


def test_two_registry_instances_do_not_share_state():
    """2つのRegistryインスタンスが登録状態を共有しない。"""
    registry_a = EngineRegistry()
    registry_b = EngineRegistry()

    registry_a.register(_dummy_descriptor("only_in_a"))

    assert registry_a.exists("only_in_a") is True
    assert registry_b.exists("only_in_a") is False
    assert registry_b.list() == ()


def test_default_registry_calls_are_independent():
    """create_default_registry()の各呼び出しは独立したインスタンスを返す。"""
    registry_1 = create_default_registry()
    registry_2 = create_default_registry()

    registry_1.unregister(ENGINE_ID_TROCR)

    assert registry_1.exists(ENGINE_ID_TROCR) is False
    assert registry_2.exists(ENGINE_ID_TROCR) is True


def test_register_unregister_in_one_test_does_not_leak_to_module_state():
    """register/unregisterは呼び出したインスタンスのみに影響し、グローバル状態を持たない。

    engine_registry.py はモジュールレベルの共有Registryを持たない設計であるため、
    そもそも「モジュールを跨いで状態が漏れる」余地が構造的に存在しないことを確認する。
    """
    import src.app.services.engine_registry as engine_registry_module

    assert not hasattr(engine_registry_module, "_ENGINE_REGISTRY")
    assert not hasattr(engine_registry_module, "DEFAULT_REGISTRY")

    registry = create_default_registry()
    registry.unregister(ENGINE_ID_TESSERACT)
    # 新しく作った別インスタンスは影響を受けない
    assert create_default_registry().exists(ENGINE_ID_TESSERACT) is True


# ---------------------------------------------------------------------------
# resolve_engine_id（Engine判定ロジック統一の中核ヘルパー）
# ---------------------------------------------------------------------------


def test_resolve_engine_id_accepts_known_engines():
    """正常系: tesseract/paddleocr/easyocrはそのままengine_idとして解決される。"""
    registry = create_default_registry()

    assert resolve_engine_id(ENGINE_ID_TESSERACT, registry=registry) == ENGINE_ID_TESSERACT
    assert resolve_engine_id(ENGINE_ID_PADDLEOCR, registry=registry) == ENGINE_ID_PADDLEOCR
    assert resolve_engine_id(ENGINE_ID_EASYOCR, registry=registry) == ENGINE_ID_EASYOCR


def test_resolve_engine_id_normalizes_case_and_whitespace():
    """大文字・前後空白は正規化した上で判定する（別名変換ではなく単純な正規化）。"""
    registry = create_default_registry()

    assert resolve_engine_id("Tesseract", registry=registry) == ENGINE_ID_TESSERACT
    assert resolve_engine_id("PADDLEOCR", registry=registry) == ENGINE_ID_PADDLEOCR
    assert resolve_engine_id("  easyocr  ", registry=registry) == ENGINE_ID_EASYOCR


def test_resolve_engine_id_unknown_engine_returns_none():
    """異常系: 未登録のengine文字列はNone（不明）。暗黙のpaddleocrフォールバックはしない。"""
    registry = create_default_registry()

    assert resolve_engine_id("unknown_future_engine", registry=registry) is None
    assert resolve_engine_id("paddle", registry=registry) is None  # aliasを追加していない
    assert resolve_engine_id("paddle_ocr", registry=registry) is None


def test_resolve_engine_id_none_returns_none():
    """異常系: Noneはそのまま不明として扱う。"""
    registry = create_default_registry()
    assert resolve_engine_id(None, registry=registry) is None


def test_resolve_engine_id_empty_string_returns_none():
    """異常系: 空文字・空白のみの文字列は不明として扱う。"""
    registry = create_default_registry()

    assert resolve_engine_id("", registry=registry) is None
    assert resolve_engine_id("   ", registry=registry) is None


def test_resolve_engine_id_invalid_type_like_values_return_none():
    """異常系: 数値や記号だけの不正なIDも、登録が無ければ不明として扱う。"""
    registry = create_default_registry()

    assert resolve_engine_id("12345", registry=registry) is None
    assert resolve_engine_id("!!!", registry=registry) is None


def test_resolve_engine_id_without_explicit_registry_uses_default():
    """registry省略時はcreate_default_registry()相当の既知4エンジンで判定できる。"""
    assert resolve_engine_id("tesseract") == "tesseract"
    assert resolve_engine_id("not_a_real_engine") is None


def test_resolve_engine_id_never_falls_back_to_paddleocr():
    """回帰確認: どんな不明値を渡しても、暗黙にpaddleocrへフォールバックしない。"""
    registry = create_default_registry()

    for bad_value in (None, "", "  ", "Tesseract_typo", "paddleocr2", "EASY-OCR"):
        result = resolve_engine_id(bad_value, registry=registry)
        assert result != ENGINE_ID_PADDLEOCR
        assert result is None
