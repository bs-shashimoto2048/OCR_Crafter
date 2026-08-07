"""PaddleOCR Evaluation Predictor Adapter（Issue #73、
`src/app/services/paddleocr_evaluation_predictor.py`）のテスト。

既存`_get_paddle_text_recognition_reader`/`_create_paddleocr_instance`/`resolve_ocr_model_meta`/
`_is_paddle_rec_inference_dir`をmockし、実PaddleOCRモデルのダウンロード・network・GPUへ
依存しない。`_run_paddleocr`自体はmockせず実関数を使う（Mock readerの`.ocr()`戻り値のみを
差し替えることで、既存のTSV/dict解析・「最大confidence採用」集約ルールを変更なく検証する）。
"""

import pytest

from src.app.services.engine_capability import EngineCapability
from src.app.services.engine_registry import EngineDescriptor, EngineRegistry
from src.app.services.evaluation_dispatcher import EvaluationDispatcher
from src.app.services.evaluation_runner import EvaluationInputSample, EvaluationRunner, PredictionResult
from src.app.services.paddleocr_evaluation_predictor import PaddleOCREvaluationPredictor

MODULE = "src.app.services.paddleocr_evaluation_predictor"


class MockPaddleReader:
    """PaddleOCR readerの`.ocr()`メソッドを模したテスト用ダブル（実`_run_paddleocr`が解析する）。"""

    def __init__(self, raw_results=None, exceptions=None):
        # raw_resultsはcallごとに順に返す値のリスト（`_run_paddleocr`が期待する生の形式）。
        self._raw_results = list(raw_results) if raw_results is not None else []
        self._exceptions = dict(exceptions) if exceptions is not None else {}
        self.calls: list[str] = []

    def ocr(self, image_path, cls=None):
        index = len(self.calls)
        self.calls.append(image_path)
        if index in self._exceptions:
            raise self._exceptions[index]
        return self._raw_results[index]


def _new_paddleocr_result(text: str, score: float):
    """PaddleOCR 3.x形式の1ブロック分の生結果（`_run_paddleocr`がパースする形式）。"""
    return [{"rec_texts": [text], "rec_scores": [score]}]


def _registry(supports_evaluation: bool = True) -> EngineRegistry:
    registry = EngineRegistry()
    capability = EngineCapability(engine_id="paddleocr", display_name="PaddleOCR", supports_evaluation=supports_evaluation)
    registry.register(EngineDescriptor(engine_id="paddleocr", display_name="PaddleOCR", capability=capability, implemented=True))
    return registry


# ---------------------------------------------------------------------------
# Basics
# ---------------------------------------------------------------------------


def test_engine_id_is_paddleocr():
    assert PaddleOCREvaluationPredictor.engine_id == "paddleocr"


def test_recognize_returns_prediction_result(monkeypatch):
    reader = MockPaddleReader(raw_results=[_new_paddleocr_result("HELLO", 0.9)])
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert isinstance(result, PredictionResult)
    assert result.text == "HELLO"
    assert result.confidence == 0.9


def test_confidence_none_is_preserved_if_underlying_returns_none(monkeypatch):
    """`_run_paddleocr`自体は常にfloatを返すが、Predictorはconfidenceを一切加工しないため、
    仮に将来Noneが渡ってきても捏造せずそのまま保持することを確認する（`_run_paddleocr`を
    直接mockして検証）。"""
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: MockPaddleReader())
    monkeypatch.setattr(f"{MODULE}._run_paddleocr", lambda reader, image, use_angle_cls: ("TEXT", None, []))
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert result.confidence is None


def test_confidence_zero_is_preserved_not_faked(monkeypatch):
    """検出0件時、既存_run_paddleocr()はconfidence=0.0を返す（Noneではない、既存の実際の契約）。
    Predictorはこれをそのまま保持し、捏造しない。"""
    reader = MockPaddleReader(raw_results=[[]])  # 空の検出結果
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert result.text == ""
    assert result.confidence == 0.0


def test_engine_details_is_always_none(monkeypatch):
    reader = MockPaddleReader(raw_results=[_new_paddleocr_result("A", 0.5)])
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert result.engine_details is None


# ---------------------------------------------------------------------------
# Resolution / Build
# ---------------------------------------------------------------------------


def test_official_model_resolution(monkeypatch):
    captured = {}

    def fake_reader_getter(*, model_dir=None, model_name=None):
        captured["model_dir"] = model_dir
        captured["model_name"] = model_name
        return MockPaddleReader(raw_results=[_new_paddleocr_result("A", 0.5)])

    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", fake_reader_getter)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    assert predictor.is_official is True
    assert predictor.model == "en_PP-OCRv5_mobile_rec"
    assert captured["model_name"] == "en_PP-OCRv5_mobile_rec"
    assert captured["model_dir"] is None


def test_custom_trained_model_resolution(monkeypatch, tmp_path):
    model_dir = tmp_path / "exported_model"
    model_dir.mkdir()
    captured = {}

    def fake_resolve_ocr_model_meta(*, project_id, model, engine, inference_ready_only):
        assert engine == "paddleocr"
        assert inference_ready_only is True
        return {"model_dir": str(model_dir), "name": "my_model.ocr.json"}

    def fake_is_inference_dir(path):
        return str(path) == str(model_dir)

    def fake_reader_getter(*, model_dir=None, model_name=None):
        captured["model_dir"] = model_dir
        captured["model_name"] = model_name
        return MockPaddleReader(raw_results=[_new_paddleocr_result("B", 0.7)])

    monkeypatch.setattr(f"{MODULE}.resolve_ocr_model_meta", fake_resolve_ocr_model_meta)
    monkeypatch.setattr(f"{MODULE}._is_paddle_rec_inference_dir", fake_is_inference_dir)
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", fake_reader_getter)

    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="my_model.ocr.json")
    assert predictor.is_official is False
    assert predictor.model == "my_model.ocr.json"
    assert str(captured["model_dir"]) == str(model_dir)
    assert captured["model_name"] is None


def test_custom_model_not_found_raises_file_not_found(monkeypatch):
    monkeypatch.setattr(f"{MODULE}.resolve_ocr_model_meta", lambda **kwargs: None)
    with pytest.raises(FileNotFoundError):
        PaddleOCREvaluationPredictor(project_id="p1", model="does-not-exist.ocr.json")


def test_custom_model_missing_inference_dir_raises_runtime_error(monkeypatch):
    monkeypatch.setattr(
        f"{MODULE}.resolve_ocr_model_meta",
        lambda **kwargs: {"model_dir": "", "name": "x"},
    )
    with pytest.raises(RuntimeError, match="inference directory"):
        PaddleOCREvaluationPredictor(project_id="p1", model="x.ocr.json")


def test_custom_model_not_exported_raises_runtime_error(monkeypatch, tmp_path):
    model_dir = tmp_path / "not_exported"
    model_dir.mkdir()
    monkeypatch.setattr(
        f"{MODULE}.resolve_ocr_model_meta",
        lambda **kwargs: {"model_dir": str(model_dir), "name": "x"},
    )
    monkeypatch.setattr(f"{MODULE}._is_paddle_rec_inference_dir", lambda path: False)
    with pytest.raises(RuntimeError, match="not inference-exported"):
        PaddleOCREvaluationPredictor(project_id="p1", model="x.ocr.json")


def test_latest_without_custom_model_falls_back_to_official(monkeypatch):
    """既存_predict_with_paddleocr()と同じフォールバック: model='latest'かつ自作モデルが
    見つからない場合、公式モデルの先頭へフォールバックする。"""
    monkeypatch.setattr(f"{MODULE}.resolve_ocr_model_meta", lambda **kwargs: None)
    captured = {}

    def fake_reader_getter(*, model_dir=None, model_name=None):
        captured["model_name"] = model_name
        return MockPaddleReader(raw_results=[_new_paddleocr_result("A", 0.1)])

    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", fake_reader_getter)
    from src.app.services.paddleocr_evaluation_predictor import OFFICIAL_PADDLEOCR_REC_MODELS

    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="latest")
    assert predictor.is_official is True
    assert predictor.model == OFFICIAL_PADDLEOCR_REC_MODELS[0]
    assert captured["model_name"] == OFFICIAL_PADDLEOCR_REC_MODELS[0]


def test_build_once_reader_constructed_exactly_once(monkeypatch):
    """heavy initializer（reader構築）はconstructor時に1回のみ。recognize()では再構築しない。"""
    build_count = {"n": 0}

    def fake_reader_getter(*, model_dir=None, model_name=None):
        build_count["n"] += 1
        return MockPaddleReader(
            raw_results=[
                _new_paddleocr_result("A", 0.1),
                _new_paddleocr_result("B", 0.2),
                _new_paddleocr_result("C", 0.3),
            ]
        )

    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", fake_reader_getter)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    r1 = predictor.recognize("a.png")
    r2 = predictor.recognize("b.png")
    r3 = predictor.recognize("c.png")

    assert build_count["n"] == 1
    assert [r1.text, r2.text, r3.text] == ["A", "B", "C"]


def test_fallback_reader_construction_when_cached_reader_is_none(monkeypatch):
    """`_get_paddle_text_recognition_reader`がNoneを返す場合、`_create_paddleocr_instance`
    経由のフォールバック構築が呼ばれる（既存benchmark.pyの`_build_paddleocr_runner`と同じ引数）。"""
    captured = {}

    def fake_create_instance(paddleocr_cls, **kwargs):
        captured.update(kwargs)
        return MockPaddleReader(raw_results=[_new_paddleocr_result("A", 0.5)])

    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: None)
    monkeypatch.setattr(f"{MODULE}._create_paddleocr_instance", fake_create_instance)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert result.text == "A"
    assert captured.get("text_recognition_model_name") == "en_PP-OCRv5_mobile_rec"
    assert "rec_model_dir" not in captured


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def test_single_result(monkeypatch):
    reader = MockPaddleReader(raw_results=[_new_paddleocr_result("SINGLE", 0.5)])
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert result.text == "SINGLE"


def test_multi_result_aggregation_picks_max_confidence(monkeypatch):
    """既存_run_paddleocr()の集約ルール（複数検出結果のうち最大confidenceの1件を採用）が
    Predictor経由でもそのまま維持されることを確認する（再実装しない）。"""
    raw = [{"rec_texts": ["LOW", "HIGH", "MID"], "rec_scores": [0.1, 0.9, 0.5]}]
    reader = MockPaddleReader(raw_results=[raw])
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert result.text == "HIGH"
    assert result.confidence == 0.9


def test_unicode_text_preserved(monkeypatch):
    reader = MockPaddleReader(raw_results=[_new_paddleocr_result("こんにちは123", 0.8)])
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert result.text == "こんにちは123"


def test_empty_result(monkeypatch):
    reader = MockPaddleReader(raw_results=[[]])
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert result.text == ""
    assert result.confidence == 0.0


# ---------------------------------------------------------------------------
# Error
# ---------------------------------------------------------------------------


def test_recognize_failure_propagates_not_swallowed(monkeypatch):
    reader = MockPaddleReader(raw_results=[None], exceptions={0: RuntimeError("paddleocr inference failed")})
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    with pytest.raises(RuntimeError):
        predictor.recognize("image.png")


def test_malformed_underlying_result_does_not_crash(monkeypatch):
    """readerが想定外の形式（欠損キーを持つdict）を返しても、既存_run_paddleocr()の
    パース処理が空結果として扱い、Predictorはクラッシュせず空prediction/confidence=0.0を返す。"""
    reader = MockPaddleReader(raw_results=[[{"unexpected_key": "value"}]])
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    result = predictor.recognize("image.png")
    assert result.text == ""
    assert result.confidence == 0.0


def test_paddleocr_not_installed_raises_runtime_error(monkeypatch):
    """readerがNoneかつpaddleocrパッケージ自体が無い場合、明確なRuntimeErrorを送出する
    （空文字へフォールバックしない）。"""
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: None)
    monkeypatch.setitem(__import__("sys").modules, "paddleocr", None)
    with pytest.raises(RuntimeError, match="paddleocr is not installed"):
        PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")


# ---------------------------------------------------------------------------
# Integration（Dispatcher / Runner）
# ---------------------------------------------------------------------------


def test_register_to_dispatcher(monkeypatch):
    reader = MockPaddleReader(raw_results=[_new_paddleocr_result("A", 0.5)])
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("paddleocr", predictor)
    assert dispatcher.resolve("paddleocr") is predictor


def test_runner_success_via_dispatcher(monkeypatch):
    reader = MockPaddleReader(
        raw_results=[_new_paddleocr_result("ABC123", 0.9), _new_paddleocr_result("XYZ999", 0.8)]
    )
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("paddleocr", predictor)
    runner = EvaluationRunner(dispatcher)

    result = runner.run(
        engine_id="paddleocr",
        samples=[
            EvaluationInputSample(image="a.png", ground_truth="ABC123"),
            EvaluationInputSample(image="b.png", ground_truth="ABC999"),
        ],
    )
    assert result.sample_count == 2
    assert result.samples[0].exact_match is True
    assert result.samples[1].exact_match is False


def test_runner_failure_via_dispatcher_isolated_by_sample_failure_boundary(monkeypatch):
    reader = MockPaddleReader(
        raw_results=[None, _new_paddleocr_result("OK", 0.9)],
        exceptions={0: RuntimeError("paddleocr inference failed")},
    )
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("paddleocr", predictor)
    runner = EvaluationRunner(dispatcher)

    result = runner.run(
        engine_id="paddleocr",
        samples=[
            EvaluationInputSample(image="broken.png", ground_truth="A"),
            EvaluationInputSample(image="ok.png", ground_truth="OK"),
        ],
    )
    assert result.sample_count == 2
    assert result.samples[0].error == "RuntimeError"
    assert result.samples[1].error is None
    assert result.samples[1].prediction == "OK"


def test_predictor_reused_across_runner_samples(monkeypatch):
    build_count = {"n": 0}

    def fake_reader_getter(*, model_dir=None, model_name=None):
        build_count["n"] += 1
        return MockPaddleReader(
            raw_results=[_new_paddleocr_result("A", 0.1), _new_paddleocr_result("B", 0.2)]
        )

    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", fake_reader_getter)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("paddleocr", predictor)
    runner = EvaluationRunner(dispatcher)

    resolve_calls = []
    original_resolve = dispatcher.resolve

    def _counting_resolve(engine_id):
        resolve_calls.append(engine_id)
        return original_resolve(engine_id)

    dispatcher.resolve = _counting_resolve  # type: ignore[method-assign]

    runner.run(
        engine_id="paddleocr",
        samples=[
            EvaluationInputSample(image="a.png", ground_truth="A"),
            EvaluationInputSample(image="b.png", ground_truth="B"),
        ],
    )
    assert len(resolve_calls) == 1
    assert build_count["n"] == 1


# ---------------------------------------------------------------------------
# Capability
# ---------------------------------------------------------------------------


def test_capability_paddleocr_supports_evaluation_true_with_real_default_registry(monkeypatch):
    """Issue #73でBackend既定Registryのpaddleocr.supports_evaluationをTrueへ変更した。"""
    reader = MockPaddleReader(raw_results=[_new_paddleocr_result("A", 0.5)])
    monkeypatch.setattr(f"{MODULE}._get_paddle_text_recognition_reader", lambda **kwargs: reader)
    predictor = PaddleOCREvaluationPredictor(project_id="p1", model="en_PP-OCRv5_mobile_rec")
    dispatcher = EvaluationDispatcher()  # 既定のcreate_default_registry()を使用
    dispatcher.register("paddleocr", predictor)
    dispatcher.resolve("paddleocr")  # 例外なし


def test_capability_tesseract_still_true(monkeypatch):
    from src.app.services.evaluation_dispatcher import EnginePredictor

    class DummyTesseractPredictor:
        engine_id = "tesseract"

        def recognize(self, *args, **kwargs):
            return PredictionResult(text="A")

    dispatcher = EvaluationDispatcher()
    dispatcher.register("tesseract", DummyTesseractPredictor())
    dispatcher.resolve("tesseract")  # 例外なし


def test_capability_easyocr_trocr_still_false():
    from src.app.services.evaluation_dispatcher import UnsupportedEvaluationEngineError

    class DummyPredictor:
        def __init__(self, engine_id):
            self.engine_id = engine_id

        def recognize(self, *args, **kwargs):
            return PredictionResult(text="A")

    dispatcher = EvaluationDispatcher()
    for engine_id in ("easyocr", "trocr"):
        dispatcher.register(engine_id, DummyPredictor(engine_id))
        with pytest.raises(UnsupportedEvaluationEngineError):
            dispatcher.resolve(engine_id)


def test_capability_custom_still_unknown():
    from src.app.services.evaluation_dispatcher import UnknownEvaluationEngineError

    dispatcher = EvaluationDispatcher()
    with pytest.raises(UnknownEvaluationEngineError):
        dispatcher.resolve("custom")
