"""EasyOCR Evaluation Predictor Adapter（Issue #75、
`src/app/services/easyocr_evaluation_predictor.py`）のテスト。

既存`_get_easyocr_reader`をmockし、実easyocrパッケージのダウンロード・network・GPUへ
依存しない。`_run_easyocr`自体はmockせず実関数を使う（Mock readerの`.readtext()`戻り値のみを
差し替えることで、既存のパース・「最大confidence採用」集約ルールを変更なく検証する）。
`_run_easyocr()`は内部で`Image.open()`により画像ファイルを実際に開くため、`tmp_path`で
実画像ファイルを用意する（`tests/test_easyocr_input.py`と同じ規約）。

**CI環境依存の回避（PaddleOCR Issue #73の教訓）**: 本Predictorは`_get_easyocr_reader()`
という単一の既存関数のみに依存し、独自の`import easyocr`を一切持たない。そのため
`_get_easyocr_reader()`をmockするだけで、`easyocr`パッケージの実インストール有無に
一切依存せずConstructor全体を検証できる（PaddleOCRのような`sys.modules["easyocr"]`への
module stubは不要）。
"""

from PIL import Image

import pytest

from src.app.services.easyocr_evaluation_predictor import EasyOCREvaluationPredictor
from src.app.services.engine_capability import EngineCapability
from src.app.services.engine_registry import EngineDescriptor, EngineRegistry
from src.app.services.evaluation_dispatcher import EvaluationDispatcher
from src.app.services.evaluation_runner import EvaluationInputSample, EvaluationRunner, PredictionResult

MODULE = "src.app.services.easyocr_evaluation_predictor"


class MockEasyOCRReader:
    """EasyOCR readerの`.readtext()`メソッドを模したテスト用ダブル（実`_run_easyocr`が解析する）。"""

    def __init__(self, raw_results=None, exceptions=None):
        # raw_resultsはcallごとに順に返す値のリスト（`_run_easyocr`が期待する生の形式:
        # (bbox, text, confidence)のタプル列）。
        self._raw_results = list(raw_results) if raw_results is not None else []
        self._exceptions = dict(exceptions) if exceptions is not None else {}
        self.calls: list[dict] = []

    def readtext(self, image, **kwargs):
        index = len(self.calls)
        self.calls.append({"image": image, "kwargs": kwargs})
        if index in self._exceptions:
            raise self._exceptions[index]
        return self._raw_results[index]


def _row(text: str, confidence: float):
    """easyocr `readtext(detail=1)`の1件分の生結果（bbox, text, confidence）。"""
    return ([[0, 0], [10, 0], [10, 10], [0, 10]], text, confidence)


def _make_image(tmp_path, name: str = "sample.png") -> str:
    path = tmp_path / name
    Image.new("L", (60, 20), 255).save(path)
    return str(path)


def _registry(supports_evaluation: bool = True) -> EngineRegistry:
    registry = EngineRegistry()
    capability = EngineCapability(engine_id="easyocr", display_name="EasyOCR", supports_evaluation=supports_evaluation)
    registry.register(EngineDescriptor(engine_id="easyocr", display_name="EasyOCR", capability=capability, implemented=True))
    return registry


# ---------------------------------------------------------------------------
# Basics
# ---------------------------------------------------------------------------


def test_engine_id_is_easyocr():
    assert EasyOCREvaluationPredictor.engine_id == "easyocr"


def test_recognize_returns_prediction_result(monkeypatch, tmp_path):
    reader = MockEasyOCRReader(raw_results=[[_row("HELLO", 0.9)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    result = predictor.recognize(_make_image(tmp_path))
    assert isinstance(result, PredictionResult)
    assert result.text == "HELLO"
    assert result.confidence == 0.9


def test_confidence_zero_is_preserved_not_faked(monkeypatch, tmp_path):
    """検出0件時、既存_run_easyocr()はconfidence=0.0を返す（Noneではない、既存の実際の契約）。
    Predictorはこれをそのまま保持し、捏造しない。"""
    reader = MockEasyOCRReader(raw_results=[[]])  # 空の検出結果
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    result = predictor.recognize(_make_image(tmp_path))
    assert result.text == ""
    assert result.confidence == 0.0


def test_engine_details_is_always_none(monkeypatch, tmp_path):
    reader = MockEasyOCRReader(raw_results=[[_row("A", 0.5)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    result = predictor.recognize(_make_image(tmp_path))
    assert result.engine_details is None


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def test_languages_default_to_en(monkeypatch, tmp_path):
    captured = {}

    def fake_reader_getter(languages):
        captured["languages"] = languages
        return MockEasyOCRReader(raw_results=[[_row("A", 0.5)]]), False

    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", fake_reader_getter)
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    assert predictor.languages == ["en"]
    assert captured["languages"] == ["en"]


def test_languages_normalized_and_passed_through(monkeypatch, tmp_path):
    captured = {}

    def fake_reader_getter(languages):
        captured["languages"] = languages
        return MockEasyOCRReader(raw_results=[[_row("A", 0.5)]]), False

    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", fake_reader_getter)
    predictor = EasyOCREvaluationPredictor(project_id="p1", languages=[" ja ", "en", ""])
    assert predictor.languages == ["ja", "en"]
    assert captured["languages"] == ["ja", "en"]


def test_build_once_reader_constructed_exactly_once(monkeypatch, tmp_path):
    """heavy initializer（Reader構築）はconstructor時に1回のみ。recognize()では再構築しない。"""
    build_count = {"n": 0}

    def fake_reader_getter(languages):
        build_count["n"] += 1
        return (
            MockEasyOCRReader(raw_results=[[_row("A", 0.1)], [_row("B", 0.2)], [_row("C", 0.3)]]),
            False,
        )

    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", fake_reader_getter)
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    r1 = predictor.recognize(_make_image(tmp_path, "a.png"))
    r2 = predictor.recognize(_make_image(tmp_path, "b.png"))
    r3 = predictor.recognize(_make_image(tmp_path, "c.png"))

    assert build_count["n"] == 1
    assert [r1.text, r2.text, r3.text] == ["A", "B", "C"]


def test_cached_reader_is_reused_across_predictors(monkeypatch, tmp_path):
    """`_get_easyocr_reader()`自身のキャッシュ（languages/use_gpuキー）は既存の既定動作
    どおりそのまま尊重する。Predictor側はキャッシュの有無を意識せず、戻り値をそのまま
    保持するだけであることを確認する。"""
    shared_reader = MockEasyOCRReader(raw_results=[[_row("X", 0.5)], [_row("Y", 0.6)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (shared_reader, False))
    predictor1 = EasyOCREvaluationPredictor(project_id="p1")
    predictor2 = EasyOCREvaluationPredictor(project_id="p2")
    assert predictor1._reader is predictor2._reader is shared_reader


def test_constructor_failure_when_package_unavailable(monkeypatch):
    """`_get_easyocr_reader()`は`easyocr`パッケージ未インストール時に`RuntimeError`を送出する
    （既存契約）。本Predictorは独自のimportを持たないため、このmockだけでCI環境（実easyocr
    パッケージの有無）に一切依存せず検証できる。"""

    def fake_reader_getter(languages):
        raise RuntimeError("easyocr is not installed. Please run: pip install easyocr")

    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", fake_reader_getter)
    with pytest.raises(RuntimeError, match="easyocr is not installed"):
        EasyOCREvaluationPredictor(project_id="p1")


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def test_single_result(monkeypatch, tmp_path):
    reader = MockEasyOCRReader(raw_results=[[_row("SINGLE", 0.5)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    result = predictor.recognize(_make_image(tmp_path))
    assert result.text == "SINGLE"


def test_multi_result_aggregation_picks_max_confidence(monkeypatch, tmp_path):
    """既存_run_easyocr()の集約ルール（複数検出結果のうち最大confidenceの1件を採用）が
    Predictor経由でもそのまま維持されることを確認する（再実装しない）。"""
    raw = [_row("LOW", 0.1), _row("HIGH", 0.9), _row("MID", 0.5)]
    reader = MockEasyOCRReader(raw_results=[raw])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    result = predictor.recognize(_make_image(tmp_path))
    assert result.text == "HIGH"
    assert result.confidence == 0.9


def test_unicode_text_preserved(monkeypatch, tmp_path):
    reader = MockEasyOCRReader(raw_results=[[_row("こんにちは123", 0.8)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    result = predictor.recognize(_make_image(tmp_path))
    assert result.text == "こんにちは123"


def test_empty_result(monkeypatch, tmp_path):
    reader = MockEasyOCRReader(raw_results=[[]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    result = predictor.recognize(_make_image(tmp_path))
    assert result.text == ""
    assert result.confidence == 0.0


# ---------------------------------------------------------------------------
# Error
# ---------------------------------------------------------------------------


def test_recognize_failure_propagates_not_swallowed(monkeypatch, tmp_path):
    reader = MockEasyOCRReader(raw_results=[None], exceptions={0: RuntimeError("easyocr inference failed")})
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    with pytest.raises(RuntimeError):
        predictor.recognize(_make_image(tmp_path))


def test_malformed_underlying_result_does_not_crash(monkeypatch, tmp_path):
    """readerが想定外の形式（要素数不足のタプル）を返しても、既存_run_easyocr()の
    パース処理がその行をスキップし、Predictorはクラッシュせず空prediction/confidence=0.0を返す。"""
    reader = MockEasyOCRReader(raw_results=[[("bbox_only",)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    result = predictor.recognize(_make_image(tmp_path))
    assert result.text == ""
    assert result.confidence == 0.0


def test_image_read_failure_propagates(monkeypatch, tmp_path):
    """存在しない画像パスを渡すと、既存_run_easyocr()のImage.open()が例外を送出し、
    Predictorはそれを握りつぶさずそのまま伝播する。"""
    reader = MockEasyOCRReader(raw_results=[[_row("A", 0.5)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    with pytest.raises(Exception):
        predictor.recognize(str(tmp_path / "does_not_exist.png"))


# ---------------------------------------------------------------------------
# Integration（Dispatcher / Runner）
# ---------------------------------------------------------------------------


def test_register_to_dispatcher(monkeypatch, tmp_path):
    reader = MockEasyOCRReader(raw_results=[[_row("A", 0.5)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("easyocr", predictor)
    assert dispatcher.resolve("easyocr") is predictor


def test_runner_success_via_dispatcher(monkeypatch, tmp_path):
    reader = MockEasyOCRReader(raw_results=[[_row("ABC123", 0.9)], [_row("XYZ999", 0.8)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("easyocr", predictor)
    runner = EvaluationRunner(dispatcher)

    result = runner.run(
        engine_id="easyocr",
        samples=[
            EvaluationInputSample(image=_make_image(tmp_path, "a.png"), ground_truth="ABC123"),
            EvaluationInputSample(image=_make_image(tmp_path, "b.png"), ground_truth="ABC999"),
        ],
    )
    assert result.sample_count == 2
    assert result.samples[0].exact_match is True
    assert result.samples[1].exact_match is False


def test_runner_failure_via_dispatcher_isolated_by_sample_failure_boundary(monkeypatch, tmp_path):
    reader = MockEasyOCRReader(
        raw_results=[None, [_row("OK", 0.9)]],
        exceptions={0: RuntimeError("easyocr inference failed")},
    )
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("easyocr", predictor)
    runner = EvaluationRunner(dispatcher)

    result = runner.run(
        engine_id="easyocr",
        samples=[
            EvaluationInputSample(image=_make_image(tmp_path, "broken.png"), ground_truth="A"),
            EvaluationInputSample(image=_make_image(tmp_path, "ok.png"), ground_truth="OK"),
        ],
    )
    assert result.sample_count == 2
    assert result.samples[0].error == "RuntimeError"
    assert result.samples[1].error is None
    assert result.samples[1].prediction == "OK"


def test_predictor_reused_across_runner_samples(monkeypatch, tmp_path):
    build_count = {"n": 0}

    def fake_reader_getter(languages):
        build_count["n"] += 1
        return MockEasyOCRReader(raw_results=[[_row("A", 0.1)], [_row("B", 0.2)]]), False

    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", fake_reader_getter)
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("easyocr", predictor)
    runner = EvaluationRunner(dispatcher)

    resolve_calls = []
    original_resolve = dispatcher.resolve

    def _counting_resolve(engine_id):
        resolve_calls.append(engine_id)
        return original_resolve(engine_id)

    dispatcher.resolve = _counting_resolve  # type: ignore[method-assign]

    runner.run(
        engine_id="easyocr",
        samples=[
            EvaluationInputSample(image=_make_image(tmp_path, "a.png"), ground_truth="A"),
            EvaluationInputSample(image=_make_image(tmp_path, "b.png"), ground_truth="B"),
        ],
    )
    assert len(resolve_calls) == 1
    assert build_count["n"] == 1


# ---------------------------------------------------------------------------
# Capability
# ---------------------------------------------------------------------------


def test_capability_easyocr_supports_evaluation_true_with_real_default_registry(monkeypatch, tmp_path):
    """Issue #75でBackend既定Registryのeasyocr.supports_evaluationをTrueへ変更した。"""
    reader = MockEasyOCRReader(raw_results=[[_row("A", 0.5)]])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    dispatcher = EvaluationDispatcher()  # 既定のcreate_default_registry()を使用
    dispatcher.register("easyocr", predictor)
    dispatcher.resolve("easyocr")  # 例外なし


def test_capability_tesseract_and_paddleocr_still_true():
    dispatcher = EvaluationDispatcher()

    class DummyPredictor:
        def __init__(self, engine_id):
            self.engine_id = engine_id

        def recognize(self, *args, **kwargs):
            return PredictionResult(text="A")

    for engine_id in ("tesseract", "paddleocr"):
        dispatcher.register(engine_id, DummyPredictor(engine_id))
        dispatcher.resolve(engine_id)  # 例外なし


def test_capability_trocr_also_true():
    """trocrはIssue #77（TrOCR Evaluation Predictor）でsupports_evaluation=Trueへ変更されたため、
    このテストの対象からは除外していたUnsupported検証はもう成立しない（`tests/
    test_trocr_evaluation_predictor.py`側でTrueであることを検証する）。"""

    class DummyPredictor:
        engine_id = "trocr"

        def recognize(self, *args, **kwargs):
            return PredictionResult(text="A")

    dispatcher = EvaluationDispatcher()
    dispatcher.register("trocr", DummyPredictor())
    dispatcher.resolve("trocr")  # 例外なし


def test_capability_custom_still_unknown():
    from src.app.services.evaluation_dispatcher import UnknownEvaluationEngineError

    dispatcher = EvaluationDispatcher()
    with pytest.raises(UnknownEvaluationEngineError):
        dispatcher.resolve("custom")


# ---------------------------------------------------------------------------
# Regression（既存EasyOCR推論・他Predictorへの非影響）
# ---------------------------------------------------------------------------


def test_existing_run_easyocr_helper_untouched(monkeypatch, tmp_path):
    """既存_run_easyocr()を直接呼び出した場合と、Predictor経由で呼び出した場合とで、
    同じMock reader出力に対して同じ(text, confidence)を返すことを確認する
    （Predictorが既存ロジックを変更・再実装していないことの直接比較）。"""
    from src.app.predict import _run_easyocr

    raw = [_row("SAME", 0.42)]
    direct_reader = MockEasyOCRReader(raw_results=[raw])
    image_path = _make_image(tmp_path)
    direct_text, direct_confidence, _ = _run_easyocr(direct_reader, image_path)

    predictor_reader = MockEasyOCRReader(raw_results=[raw])
    monkeypatch.setattr(f"{MODULE}._get_easyocr_reader", lambda languages: (predictor_reader, False))
    predictor = EasyOCREvaluationPredictor(project_id="p1")
    result = predictor.recognize(image_path)

    assert result.text == direct_text == "SAME"
    assert result.confidence == direct_confidence == 0.42
