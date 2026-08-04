"""Evaluation Runner（Issue #69、`src/app/services/evaluation_runner.py`）のテスト。

Mock PredictorとFake Clockのみを使用し、実OCR処理・モデルload・画像読込は一切行わない。
"""

from datetime import datetime, timezone

import pytest

from src.app.services.engine_capability import EngineCapability
from src.app.services.engine_registry import EngineDescriptor, EngineRegistry
from src.app.services.evaluation_dispatcher import (
    EvaluationDispatcher,
    UnknownEvaluationEngineError,
    UnsupportedEvaluationEngineError,
)
from src.app.services.evaluation_dispatcher import EvaluationDispatcherError
from src.app.services.evaluation_runner import EvaluationInputSample, EvaluationRunner, PredictionResult


class FakeClock:
    """`perf_counter`と`now`の両方を決定的に進める簡易Fake Clock。"""

    def __init__(self, start: float = 0.0, step: float = 0.01):
        self._counter = start
        self._step = step
        self._now = datetime(2026, 8, 4, 0, 0, 0, tzinfo=timezone.utc)

    def perf_counter(self) -> float:
        self._counter += self._step
        return self._counter

    def now(self) -> datetime:
        current = self._now
        self._now = current.replace(microsecond=current.microsecond)
        return current


class MockPredictor:
    """成功/失敗を差し替え可能なMock Predictor。呼び出し履歴を記録する。"""

    def __init__(self, engine_id: str = "tesseract", results=None, exceptions=None):
        self.engine_id = engine_id
        self._results = list(results) if results is not None else []
        self._exceptions = dict(exceptions) if exceptions is not None else {}
        self.calls: list[tuple[tuple, dict]] = []

    def recognize(self, *args, **kwargs):
        index = len(self.calls)
        self.calls.append((args, kwargs))
        if index in self._exceptions:
            raise self._exceptions[index]
        return self._results[index]


def _registry(engine_id: str = "tesseract", supports_evaluation: bool = True) -> EngineRegistry:
    registry = EngineRegistry()
    capability = EngineCapability(engine_id=engine_id, display_name=engine_id, supports_evaluation=supports_evaluation)
    registry.register(EngineDescriptor(engine_id=engine_id, display_name=engine_id, capability=capability, implemented=True))
    return registry


def _dispatcher_with_predictor(predictor: MockPredictor, supports_evaluation: bool = True) -> EvaluationDispatcher:
    dispatcher = EvaluationDispatcher(registry=_registry(predictor.engine_id, supports_evaluation))
    dispatcher.register(predictor.engine_id, predictor)
    return dispatcher


def _runner(dispatcher: EvaluationDispatcher, clock: FakeClock | None = None) -> EvaluationRunner:
    clock = clock or FakeClock()
    return EvaluationRunner(dispatcher, now=clock.now, perf_counter=clock.perf_counter)


# ---------------------------------------------------------------------------
# Empty Dataset
# ---------------------------------------------------------------------------


def test_empty_dataset_resolves_predictor_once_and_never_calls_recognize():
    predictor = MockPredictor(results=[])
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)

    result = runner.run(engine_id="tesseract", samples=[])

    assert len(predictor.calls) == 0
    assert result.sample_count == 0
    assert result.metrics.sample_count == 0
    assert result.metrics.exact_match_rate == 0.0
    assert result.metrics.cer is None
    assert result.metrics.character_accuracy is None
    assert result.samples == []
    assert result.confusions == []
    assert result.warnings == ["evaluation dataset was empty"]


def test_empty_dataset_records_timing():
    dispatcher = _dispatcher_with_predictor(MockPredictor(results=[]))
    runner = _runner(dispatcher)
    result = runner.run(engine_id="tesseract", samples=[])
    assert result.started_at is not None
    assert result.finished_at is not None
    assert result.duration_ms is not None and result.duration_ms >= 0.0


# ---------------------------------------------------------------------------
# Success
# ---------------------------------------------------------------------------


def test_success_single_sample_exact_match():
    predictor = MockPredictor(results=[PredictionResult(text="ABC123", confidence=0.9)])
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)

    result = runner.run(
        engine_id="tesseract",
        samples=[EvaluationInputSample(image="a.png", ground_truth="ABC123")],
    )

    assert result.sample_count == 1
    sample = result.samples[0]
    assert sample.prediction == "ABC123"
    assert sample.exact_match is True
    assert sample.edit_distance == 0
    assert sample.confidence == 0.9
    assert sample.error is None


def test_success_multiple_samples_mismatch_and_confidence_none():
    predictor = MockPredictor(
        results=[
            PredictionResult(text="ABC123", confidence=0.9),
            PredictionResult(text="XYZ999", confidence=None),
        ]
    )
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)

    result = runner.run(
        engine_id="tesseract",
        samples=[
            EvaluationInputSample(image="a.png", ground_truth="ABC123"),
            EvaluationInputSample(image="b.png", ground_truth="ABC999"),
        ],
    )

    assert result.sample_count == 2
    assert result.samples[0].exact_match is True
    assert result.samples[1].exact_match is False
    assert result.samples[1].confidence is None
    assert "confidence was unavailable for 1 samples" in result.warnings


def test_success_records_duration_per_sample():
    predictor = MockPredictor(results=[PredictionResult(text="ABC", confidence=0.5)])
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    result = runner.run(engine_id="tesseract", samples=[EvaluationInputSample(image="a.png", ground_truth="ABC")])
    assert result.samples[0].duration_ms is not None and result.samples[0].duration_ms >= 0.0


def test_result_metadata_fields():
    predictor = MockPredictor(results=[PredictionResult(text="ABC", confidence=0.5)])
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    result = runner.run(
        engine_id="tesseract",
        samples=[EvaluationInputSample(image="a.png", ground_truth="ABC")],
        model_ref="latest",
        dataset_id="dataset-1",
    )
    assert result.engine_id == "tesseract"
    assert result.model_ref == "latest"
    assert result.dataset_id == "dataset-1"
    assert result.evaluation_id is not None and len(result.evaluation_id) > 0


# ---------------------------------------------------------------------------
# Predictor Reuse
# ---------------------------------------------------------------------------


def test_predictor_resolved_exactly_once_and_reused_across_samples():
    predictor = MockPredictor(
        results=[
            PredictionResult(text="A"),
            PredictionResult(text="B"),
            PredictionResult(text="C"),
        ]
    )
    dispatcher = _dispatcher_with_predictor(predictor)
    resolve_calls = []
    original_resolve = dispatcher.resolve

    def _counting_resolve(engine_id):
        resolve_calls.append(engine_id)
        return original_resolve(engine_id)

    dispatcher.resolve = _counting_resolve  # type: ignore[method-assign]
    runner = _runner(dispatcher)

    samples = [EvaluationInputSample(image=f"{i}.png", ground_truth="A") for i in range(3)]
    runner.run(engine_id="tesseract", samples=samples)

    assert len(resolve_calls) == 1
    assert len(predictor.calls) == 3


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


def test_unknown_engine_propagates_before_any_sample_processed():
    predictor = MockPredictor(results=[PredictionResult(text="A")])
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    with pytest.raises(UnknownEvaluationEngineError):
        runner.run(engine_id="does-not-exist", samples=[EvaluationInputSample(image="a.png", ground_truth="A")])
    assert len(predictor.calls) == 0


def test_unsupported_engine_propagates():
    predictor = MockPredictor(engine_id="paddleocr", results=[PredictionResult(text="A")])
    dispatcher = _dispatcher_with_predictor(predictor, supports_evaluation=False)
    runner = _runner(dispatcher)
    with pytest.raises(UnsupportedEvaluationEngineError):
        runner.run(engine_id="paddleocr", samples=[EvaluationInputSample(image="a.png", ground_truth="A")])
    assert len(predictor.calls) == 0


def test_predictor_not_registered_propagates():
    dispatcher = EvaluationDispatcher(registry=_registry("tesseract"))
    runner = _runner(dispatcher)
    with pytest.raises(EvaluationDispatcherError):
        runner.run(engine_id="tesseract", samples=[EvaluationInputSample(image="a.png", ground_truth="A")])


def test_sample_level_exception_recorded_as_failed_sample_not_raised():
    predictor = MockPredictor(results=[None], exceptions={0: RuntimeError("boom at /secret/path")})
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)

    result = runner.run(engine_id="tesseract", samples=[EvaluationInputSample(image="a.png", ground_truth="A")])

    sample = result.samples[0]
    assert sample.prediction is None
    assert sample.exact_match is None
    assert sample.edit_distance is None
    assert sample.cer is None
    assert sample.confidence is None
    assert sample.error == "RuntimeError"
    assert "/secret/path" not in (sample.error or "")


def test_one_of_multiple_samples_fails_others_still_processed():
    predictor = MockPredictor(
        results=[PredictionResult(text="A"), None, PredictionResult(text="C")],
        exceptions={1: ValueError("bad")},
    )
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)

    samples = [EvaluationInputSample(image=f"{i}.png", ground_truth="A") for i in range(3)]
    result = runner.run(engine_id="tesseract", samples=samples)

    assert result.sample_count == 3
    assert result.samples[0].error is None
    assert result.samples[1].error == "ValueError"
    assert result.samples[2].error is None
    assert "1 samples failed during inference" in result.warnings


def test_all_samples_fail():
    predictor = MockPredictor(results=[None, None], exceptions={0: RuntimeError(), 1: RuntimeError()})
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)

    samples = [EvaluationInputSample(image=f"{i}.png", ground_truth="A") for i in range(2)]
    result = runner.run(engine_id="tesseract", samples=samples)

    assert result.sample_count == 2
    assert all(s.error == "RuntimeError" for s in result.samples)
    assert "2 samples failed during inference" in result.warnings
    assert result.metrics.sample_count == 2
    assert result.metrics.cer is None


def test_error_message_never_contains_raw_exception_text():
    predictor = MockPredictor(
        results=[None],
        exceptions={0: RuntimeError("token=hf_ABC123 user=C:/Users/someone/secret")},
    )
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    result = runner.run(engine_id="tesseract", samples=[EvaluationInputSample(image="a.png", ground_truth="A")])
    assert result.samples[0].error == "RuntimeError"


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


def test_metrics_micro_cer_exact_match_rate_character_accuracy():
    predictor = MockPredictor(
        results=[
            PredictionResult(text="ABC"),
            PredictionResult(text="ABD"),
        ]
    )
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    samples = [
        EvaluationInputSample(image="a.png", ground_truth="ABC"),
        EvaluationInputSample(image="b.png", ground_truth="ABC"),
    ]
    result = runner.run(engine_id="tesseract", samples=samples)

    assert result.metrics.exact_match_count == 1
    assert result.metrics.exact_match_rate == 0.5
    # dist_total=1, ref_total=6 -> cer=1/6
    assert result.metrics.cer == pytest.approx(round(1 / 6, 4))
    assert result.metrics.character_accuracy == pytest.approx(round(1 - (1 / 6), 4))


def test_confusion_aggregated_from_successful_samples_only():
    predictor = MockPredictor(
        results=[PredictionResult(text="ABD"), None],
        exceptions={1: RuntimeError("boom")},
    )
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    samples = [
        EvaluationInputSample(image="a.png", ground_truth="ABC"),
        EvaluationInputSample(image="b.png", ground_truth="XYZ"),
    ]
    result = runner.run(engine_id="tesseract", samples=samples)

    assert len(result.confusions) == 1
    assert result.confusions[0].kind == "sub"
    assert result.confusions[0].expected == "C"
    assert result.confusions[0].predicted == "D"


def test_sample_count_sync_with_failed_samples():
    predictor = MockPredictor(results=[PredictionResult(text="A"), None], exceptions={1: RuntimeError()})
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    samples = [
        EvaluationInputSample(image="a.png", ground_truth="A"),
        EvaluationInputSample(image="b.png", ground_truth="A"),
    ]
    result = runner.run(engine_id="tesseract", samples=samples)
    assert result.sample_count == result.metrics.sample_count == 2


def test_empty_ground_truth_sample_cer_is_none_for_that_sample():
    predictor = MockPredictor(results=[PredictionResult(text="")])
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    result = runner.run(engine_id="tesseract", samples=[EvaluationInputSample(image="a.png", ground_truth="")])
    assert result.samples[0].cer is None


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


def test_result_contains_all_expected_fields():
    predictor = MockPredictor(results=[PredictionResult(text="A")])
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    result = runner.run(
        engine_id="tesseract",
        samples=[EvaluationInputSample(image="a.png", ground_truth="A")],
        model_ref="latest",
        dataset_id="ds-1",
    )
    assert result.evaluation_id
    assert result.engine_id == "tesseract"
    assert result.model_ref == "latest"
    assert result.dataset_id == "ds-1"
    assert result.started_at
    assert result.finished_at
    assert result.duration_ms is not None
    assert result.samples
    assert isinstance(result.warnings, list)
    assert result.engine_details == {}


# ---------------------------------------------------------------------------
# Immutability
# ---------------------------------------------------------------------------


def test_input_samples_not_mutated():
    predictor = MockPredictor(results=[PredictionResult(text="A")])
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    samples = [EvaluationInputSample(image="a.png", ground_truth="A")]
    samples_copy = list(samples)
    runner.run(engine_id="tesseract", samples=samples)
    assert samples == samples_copy


def test_predictor_args_not_mutated():
    predictor = MockPredictor(results=[PredictionResult(text="A")])
    dispatcher = _dispatcher_with_predictor(predictor)
    runner = _runner(dispatcher)
    predictor_args = {"psm": 7}
    runner.run(
        engine_id="tesseract",
        samples=[EvaluationInputSample(image="a.png", ground_truth="A")],
        predictor_args=predictor_args,
    )
    assert predictor_args == {"psm": 7}


def test_result_defaults_are_not_shared_between_runs():
    predictor1 = MockPredictor(results=[])
    predictor2 = MockPredictor(engine_id="tesseract2", results=[])
    dispatcher1 = _dispatcher_with_predictor(predictor1)
    dispatcher2 = EvaluationDispatcher(registry=_registry("tesseract2"))
    dispatcher2.register("tesseract2", predictor2)

    result1 = _runner(dispatcher1).run(engine_id="tesseract", samples=[])
    result1.warnings.append("mutated")
    result2 = _runner(dispatcher2).run(engine_id="tesseract2", samples=[])

    assert result2.warnings == ["evaluation dataset was empty"]


# ---------------------------------------------------------------------------
# Dispatcher整合性（Issue #69でDispatcher.register()へ追加した検証との連携）
# ---------------------------------------------------------------------------


def test_register_key_matching_predictor_engine_id_allows_runner_to_dispatch():
    predictor = MockPredictor(engine_id="tesseract", results=[PredictionResult(text="A")])
    dispatcher = EvaluationDispatcher(registry=_registry("tesseract"))
    dispatcher.register("tesseract", predictor)
    runner = _runner(dispatcher)
    result = runner.run(engine_id="tesseract", samples=[EvaluationInputSample(image="a.png", ground_truth="A")])
    assert result.samples[0].prediction == "A"


def test_register_key_mismatch_with_predictor_engine_id_raises_before_runner_runs():
    dispatcher = EvaluationDispatcher(registry=_registry("tesseract"))
    with pytest.raises(EvaluationDispatcherError):
        dispatcher.register("tesseract", MockPredictor(engine_id="paddleocr", results=[]))
