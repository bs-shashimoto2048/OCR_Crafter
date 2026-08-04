"""Evaluation Dispatcher（Issue #67、`src/app/services/evaluation_dispatcher.py`）のテスト。

Mock Predictorのみを使用し、実OCR処理・モデルload・画像読込は一切行わない。
"""

import pytest

from src.app.services.engine_capability import ENGINE_ID_TESSERACT, EngineCapability
from src.app.services.engine_registry import EngineDescriptor, EngineRegistry
from src.app.services.evaluation_dispatcher import (
    EnginePredictor,
    EvaluationDispatcher,
    EvaluationDispatcherError,
    UnknownEvaluationEngineError,
    UnsupportedEvaluationEngineError,
)


class MockPredictor:
    """OCR処理を一切行わないMock Predictor。呼び出し履歴だけを記録する。"""

    def __init__(self, engine_id: str = "mock", return_value=("mock-text", 0.9)):
        self.engine_id = engine_id
        self.return_value = return_value
        self.calls: list[tuple[tuple, dict]] = []

    def recognize(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.return_value


def _supported_registry(engine_id: str = "tesseract") -> EngineRegistry:
    """`supports_evaluation=True`のみを持つ最小Registry（テスト用の合成Registry）。"""
    registry = EngineRegistry()
    capability = EngineCapability(engine_id=engine_id, display_name=engine_id, supports_evaluation=True)
    registry.register(EngineDescriptor(engine_id=engine_id, display_name=engine_id, capability=capability, implemented=True))
    return registry


def _unsupported_registry(engine_id: str = "paddleocr") -> EngineRegistry:
    """`supports_evaluation=False`のみを持つ最小Registry。"""
    registry = EngineRegistry()
    capability = EngineCapability(engine_id=engine_id, display_name=engine_id, supports_evaluation=False)
    registry.register(EngineDescriptor(engine_id=engine_id, display_name=engine_id, capability=capability, implemented=True))
    return registry


# ---------------------------------------------------------------------------
# register
# ---------------------------------------------------------------------------


def test_register_success():
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    predictor = MockPredictor(engine_id="tesseract")
    dispatcher.register("tesseract", predictor)
    assert dispatcher.resolve("tesseract") is predictor


def test_register_duplicate_rejected():
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    dispatcher.register("tesseract", MockPredictor(engine_id="tesseract"))
    with pytest.raises(EvaluationDispatcherError):
        dispatcher.register("tesseract", MockPredictor(engine_id="tesseract"))


def test_register_duplicate_rejected_case_insensitive():
    """register時のキー正規化（trim+小文字化）により、大小文字違いも重複として扱う。"""
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    dispatcher.register("Tesseract", MockPredictor(engine_id="tesseract"))
    with pytest.raises(EvaluationDispatcherError):
        dispatcher.register("TESSERACT", MockPredictor(engine_id="tesseract"))


def test_register_engine_id_matches_key_succeeds():
    """register keyとpredictor.engine_id（大小文字違いを含む）が一致すれば登録できる。"""
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    predictor = MockPredictor(engine_id="Tesseract")
    dispatcher.register("tesseract", predictor)
    assert dispatcher.resolve("tesseract") is predictor


def test_register_engine_id_mismatch_rejected():
    """register keyとpredictor.engine_idが食い違う場合はEvaluationDispatcherError（Issue #69で追加）。"""
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    with pytest.raises(EvaluationDispatcherError):
        dispatcher.register("tesseract", MockPredictor(engine_id="paddleocr"))


# ---------------------------------------------------------------------------
# resolve
# ---------------------------------------------------------------------------


def test_resolve_known_engine_returns_registered_predictor():
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    predictor = MockPredictor(engine_id="tesseract")
    dispatcher.register("tesseract", predictor)
    assert dispatcher.resolve("tesseract") is predictor


def test_resolve_unknown_engine_raises():
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    with pytest.raises(UnknownEvaluationEngineError):
        dispatcher.resolve("nonexistent-engine")


def test_resolve_unknown_engine_with_real_default_registry_custom():
    """Backend既定Registryには'custom'が登録されていないため、Unknownとして扱われる。"""
    dispatcher = EvaluationDispatcher()  # 既定のcreate_default_registry()を使用
    with pytest.raises(UnknownEvaluationEngineError):
        dispatcher.resolve("custom")


# ---------------------------------------------------------------------------
# capability
# ---------------------------------------------------------------------------


def test_capability_supported_allows_resolve():
    dispatcher = EvaluationDispatcher(registry=_supported_registry("tesseract"))
    dispatcher.register("tesseract", MockPredictor(engine_id="tesseract"))
    # 例外を送出しないことを確認する
    dispatcher.resolve("tesseract")


def test_capability_unsupported_raises():
    dispatcher = EvaluationDispatcher(registry=_unsupported_registry("paddleocr"))
    dispatcher.register("paddleocr", MockPredictor(engine_id="paddleocr"))
    with pytest.raises(UnsupportedEvaluationEngineError):
        dispatcher.resolve("paddleocr")


def test_capability_unsupported_with_real_default_registry():
    """Backend既定Registryでは現状 paddleocr/easyocr/trocr が supports_evaluation=False。"""
    dispatcher = EvaluationDispatcher()
    for engine_id in ("paddleocr", "easyocr", "trocr"):
        dispatcher.register(engine_id, MockPredictor(engine_id=engine_id))
        with pytest.raises(UnsupportedEvaluationEngineError):
            dispatcher.resolve(engine_id)


def test_capability_supported_with_real_default_registry_tesseract():
    """Backend既定Registryでは現状 tesseract のみ supports_evaluation=True。"""
    dispatcher = EvaluationDispatcher()
    dispatcher.register("tesseract", MockPredictor(engine_id="tesseract"))
    dispatcher.resolve("tesseract")  # 例外なし


# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------


def test_dispatch_calls_predictor_recognize():
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    predictor = MockPredictor(engine_id="tesseract", return_value=("hello", 0.75))
    dispatcher.register("tesseract", predictor)
    result = dispatcher.dispatch("tesseract", "image.png")
    assert result == ("hello", 0.75)


def test_dispatch_recognize_called_exactly_once():
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    predictor = MockPredictor(engine_id="tesseract")
    dispatcher.register("tesseract", predictor)
    dispatcher.dispatch("tesseract", "image.png")
    assert len(predictor.calls) == 1


def test_dispatch_forwards_args_unchanged():
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    predictor = MockPredictor(engine_id="tesseract")
    dispatcher.register("tesseract", predictor)
    dispatcher.dispatch("tesseract", "image.png", "extra_positional", option="value", another=42)
    args, kwargs = predictor.calls[0]
    assert args == ("image.png", "extra_positional")
    assert kwargs == {"option": "value", "another": 42}


def test_dispatch_unknown_engine_does_not_call_any_predictor():
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    predictor = MockPredictor(engine_id="tesseract")
    dispatcher.register("tesseract", predictor)
    with pytest.raises(UnknownEvaluationEngineError):
        dispatcher.dispatch("unknown-engine", "image.png")
    assert len(predictor.calls) == 0


# ---------------------------------------------------------------------------
# exception
# ---------------------------------------------------------------------------


def test_exception_unknown_engine_type():
    dispatcher = EvaluationDispatcher(registry=_supported_registry())
    with pytest.raises(UnknownEvaluationEngineError):
        dispatcher.resolve("does-not-exist")


def test_exception_unsupported_engine_type():
    dispatcher = EvaluationDispatcher(registry=_unsupported_registry())
    dispatcher.register("paddleocr", MockPredictor(engine_id="paddleocr"))
    with pytest.raises(UnsupportedEvaluationEngineError):
        dispatcher.resolve("paddleocr")


def test_exception_hierarchy_both_subclass_dispatcher_error():
    assert issubclass(UnknownEvaluationEngineError, EvaluationDispatcherError)
    assert issubclass(UnsupportedEvaluationEngineError, EvaluationDispatcherError)


def test_exception_no_predictor_registered_is_dispatcher_error_not_unknown():
    """Backend Registry上は既知・評価対応でも register() 未実施の場合は
    EvaluationDispatcherError（UnknownEvaluationEngineErrorではない）。"""
    dispatcher = EvaluationDispatcher(registry=_supported_registry("tesseract"))
    with pytest.raises(EvaluationDispatcherError) as exc_info:
        dispatcher.resolve("tesseract")
    assert not isinstance(exc_info.value, UnknownEvaluationEngineError)
    assert not isinstance(exc_info.value, UnsupportedEvaluationEngineError)


# ---------------------------------------------------------------------------
# Predictor Protocol
# ---------------------------------------------------------------------------


def test_engine_predictor_protocol_only_requires_recognize():
    """EnginePredictorはrecognize()のみを要求する最小Interfaceである。"""

    class MinimalPredictor:
        engine_id = "minimal"

        def recognize(self, *args, **kwargs):
            return "ok"

    predictor: EnginePredictor = MinimalPredictor()
    assert predictor.recognize() == "ok"


# ---------------------------------------------------------------------------
# Dependency（Backend Engine Registry / Capability以外への依存がないこと）
# ---------------------------------------------------------------------------


def test_dispatcher_module_has_no_ocr_engine_dependencies():
    """evaluation_dispatcher.pyがTesseract/PaddleOCR/EasyOCR/TrOCR固有コード・
    ocr_evaluation.py・benchmark.pyをimportしていないことを確認する。"""
    import src.app.services.evaluation_dispatcher as mod

    source = open(mod.__file__, encoding="utf-8").read()
    forbidden = [
        "tesseract_pipeline",
        "ocr_evaluation",
        "benchmark",
        "trocr_engine",
        "predict",
        "model_registry",
        "job_runner",
    ]
    for name in forbidden:
        assert f"import {name}" not in source and f"from .{name}" not in source, f"unexpected dependency: {name}"
