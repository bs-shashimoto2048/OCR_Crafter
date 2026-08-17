"""TrOCR Evaluation Predictor Adapter（Issue #77、
`src/app/services/trocr_evaluation_predictor.py`）のテスト。

実TrOCRモデル・Hugging Face network access・GPU/CUDA・大容量checkpointへ依存しない。
`transformers.AutoProcessor`/`VisionEncoderDecoderModel`の`from_pretrained`をfakeへ
差し替える（`tests/test_trocr_engine.py`と同じmonkeypatch規約。`transformers`パッケージ
自体はCIの必須依存として導入済み——`requirements-ci.txt`のコメント「transformers自体
（コードライブラリ）のみをCIへ導入し、from_pretrained()等はテスト側でmonkeypatchする」
参照。paddleocr/easyocrとは異なりPaddleOCR Issue #73型のCI環境依存は生じない）。
`TrOCREngine.load()`/`predict_file()`自体はmockせず実関数を使用し、fake transformers
クラスの戻り値のみを差し替えることで、既存のbuild-once・画像読込・generate/decode
ロジックを変更なく検証する。
"""

import sys

import pytest
import torch
from PIL import Image

from src.app.services.engine_capability import EngineCapability
from src.app.services.engine_registry import EngineDescriptor, EngineRegistry
from src.app.services.evaluation_dispatcher import EvaluationDispatcher
from src.app.services.evaluation_runner import EvaluationInputSample, EvaluationRunner, PredictionResult
from src.app.services.trocr_evaluation_predictor import TrOCREvaluationPredictor

MODULE = "src.app.services.trocr_evaluation_predictor"


# ---------------------------------------------------------------------------
# Fake transformers クラス（実モデル・ネットワーク不使用。tests/test_trocr_engine.py同様）
# ---------------------------------------------------------------------------


class _FakeTensor:
    def __init__(self, name="tensor"):
        self.name = name
        self.device_moved_to = None

    def to(self, device):
        self.device_moved_to = device
        return self


class _FakeProcessorOutput:
    def __init__(self, pixel_values):
        self.pixel_values = pixel_values


class _FakeProcessor:
    def __init__(self, model_ref, local_files_only):
        self.model_ref = model_ref
        self.local_files_only = local_files_only
        self.decode_return = ["recognized text"]
        self.call_should_raise = None
        self.decode_should_raise = None

    def __call__(self, images, return_tensors):
        if self.call_should_raise is not None:
            raise self.call_should_raise
        return _FakeProcessorOutput(_FakeTensor("pixel_values"))

    def batch_decode(self, generated_ids, skip_special_tokens):
        if self.decode_should_raise is not None:
            raise self.decode_should_raise
        return self.decode_return


class _FakeModel:
    def __init__(self, model_ref, local_files_only):
        self.model_ref = model_ref
        self.local_files_only = local_files_only
        self.generate_should_raise = None

    def to(self, device):
        return self

    def eval(self):
        pass

    def generate(self, pixel_values):
        if self.generate_should_raise is not None:
            raise self.generate_should_raise
        return "generated_ids_placeholder"


@pytest.fixture()
def fake_transformers(monkeypatch):
    """transformers.AutoProcessor/VisionEncoderDecoderModel.from_pretrained をfakeへ差し替える。

    `TrOCREngine.load()`が実行時に解決する実クラス自体はそのままに、`from_pretrained`
    属性だけを差し替える（`tests/test_trocr_engine.py::fake_transformers`と同じ理由）。
    """
    import transformers

    processors: list[_FakeProcessor] = []
    models: list[_FakeModel] = []

    def _fake_processor_from_pretrained(model_ref, local_files_only=False):
        fake = _FakeProcessor(model_ref, local_files_only)
        processors.append(fake)
        return fake

    def _fake_model_from_pretrained(model_ref, local_files_only=False):
        fake = _FakeModel(model_ref, local_files_only)
        models.append(fake)
        return fake

    monkeypatch.setattr(transformers.AutoProcessor, "from_pretrained", _fake_processor_from_pretrained)
    monkeypatch.setattr(
        transformers.VisionEncoderDecoderModel, "from_pretrained", _fake_model_from_pretrained
    )
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)  # 既定はCPU環境相当

    return {"processors": processors, "models": models}


def _make_image(tmp_path, name="sample.png", mode="RGB", color=(255, 0, 0)) -> str:
    path = tmp_path / name
    Image.new(mode, (10, 10), color).save(path)
    return str(path)


def _registry(supports_evaluation: bool = True) -> EngineRegistry:
    registry = EngineRegistry()
    capability = EngineCapability(engine_id="trocr", display_name="TrOCR", supports_evaluation=supports_evaluation)
    registry.register(EngineDescriptor(engine_id="trocr", display_name="TrOCR", capability=capability, implemented=True))
    return registry


# ---------------------------------------------------------------------------
# Basics
# ---------------------------------------------------------------------------


def test_engine_id_is_trocr():
    assert TrOCREvaluationPredictor.engine_id == "trocr"


def test_recognize_returns_prediction_result(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    result = predictor.recognize(_make_image(tmp_path))
    assert isinstance(result, PredictionResult)
    assert result.text == "recognized text"


def test_confidence_is_always_none(fake_transformers, tmp_path):
    """TrOCRResultはconfidence属性を持たないため、Predictorは常にNoneを返す（捏造しない）。"""
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    result = predictor.recognize(_make_image(tmp_path))
    assert result.confidence is None


def test_engine_details_is_always_none(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    result = predictor.recognize(_make_image(tmp_path))
    assert result.engine_details is None


# ---------------------------------------------------------------------------
# Model resolution / Build
# ---------------------------------------------------------------------------


def test_model_ref_is_passed_through_to_engine_load(fake_transformers, tmp_path):
    TrOCREvaluationPredictor(project_id="p1", model="my-org/my-trocr-model")
    assert fake_transformers["processors"][0].model_ref == "my-org/my-trocr-model"
    assert fake_transformers["models"][0].model_ref == "my-org/my-trocr-model"


def test_local_files_only_is_passed_through(fake_transformers):
    TrOCREvaluationPredictor(project_id="p1", model="dummy/model", local_files_only=True)
    assert fake_transformers["processors"][0].local_files_only is True
    assert fake_transformers["models"][0].local_files_only is True


def test_device_is_passed_through(fake_transformers):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model", device="cpu")
    assert predictor._engine.device == "cpu"


def test_empty_model_ref_raises_value_error(fake_transformers):
    """TrOCRには"latest"等のフォールバックが存在しないため、空文字はTrOCREngine.load()の
    既存ValueErrorをそのまま伝播させる（Predictorが独自のフォールバックを発明しない）。"""
    with pytest.raises(ValueError):
        TrOCREvaluationPredictor(project_id="p1", model="")


def test_none_model_ref_raises_value_error(fake_transformers):
    with pytest.raises(ValueError):
        TrOCREvaluationPredictor(project_id="p1", model=None)


def test_no_custom_model_registry_resolution_involved(fake_transformers, tmp_path):
    """model_registry.pyのresolve系関数を一切呼ばないことを、model_refがそのまま
    fromPretrainedへ渡ることで間接的に確認する（TrOCRにはcustom model解決が存在しない）。"""
    TrOCREvaluationPredictor(project_id="p1", model="plain-model-ref")
    assert fake_transformers["processors"][0].model_ref == "plain-model-ref"


# ---------------------------------------------------------------------------
# Build-once（最重要）
# ---------------------------------------------------------------------------


def test_load_exactly_once_on_construction(fake_transformers):
    TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1


def test_multiple_recognize_does_not_reload(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1

    predictor.recognize(_make_image(tmp_path, "a.png"))
    predictor.recognize(_make_image(tmp_path, "b.png"))
    predictor.recognize(_make_image(tmp_path, "c.png"))

    # 複数回recognizeしても、from_pretrained経由の新規ロードは増えない
    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1


def test_runner_multiple_samples_does_not_reload(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("trocr", predictor)
    runner = EvaluationRunner(dispatcher)

    runner.run(
        engine_id="trocr",
        samples=[
            EvaluationInputSample(image=_make_image(tmp_path, "a.png"), ground_truth="A"),
            EvaluationInputSample(image=_make_image(tmp_path, "b.png"), ground_truth="B"),
            EvaluationInputSample(image=_make_image(tmp_path, "c.png"), ground_truth="C"),
        ],
    )

    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1


# ---------------------------------------------------------------------------
# Image handling / generate / decode（既存TrOCREngineの意味論をそのまま利用）
# ---------------------------------------------------------------------------


def test_image_is_read_from_path_and_converted_to_rgb(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    path = _make_image(tmp_path, mode="L", color=128)
    predictor.recognize(path)
    # TrOCREngine.predict()内でRGB変換される（fake processorが呼ばれたことのみ確認）
    assert len(fake_transformers["processors"]) == 1


def test_unicode_text_preserved(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    fake_transformers["processors"][0].decode_return = ["こんにちは123"]
    result = predictor.recognize(_make_image(tmp_path))
    assert result.text == "こんにちは123"


def test_result_text_is_stripped(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    fake_transformers["processors"][0].decode_return = ["  padded  "]
    result = predictor.recognize(_make_image(tmp_path))
    assert result.text == "padded"


def test_empty_result_is_not_an_error(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    fake_transformers["processors"][0].decode_return = [""]
    result = predictor.recognize(_make_image(tmp_path))
    assert result.text == ""
    assert result.confidence is None


# ---------------------------------------------------------------------------
# Error
# ---------------------------------------------------------------------------


def test_construction_failure_when_transformers_not_installed(monkeypatch):
    monkeypatch.setitem(sys.modules, "transformers", None)
    with pytest.raises(RuntimeError):
        TrOCREvaluationPredictor(project_id="p1", model="dummy/model")


def test_construction_failure_when_processor_load_fails(monkeypatch):
    import transformers

    def _failing(model_ref, local_files_only=False):
        raise OSError("network unreachable")

    monkeypatch.setattr(transformers.AutoProcessor, "from_pretrained", _failing)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)

    with pytest.raises(RuntimeError):
        TrOCREvaluationPredictor(project_id="p1", model="dummy/model")


def test_construction_failure_when_model_load_fails(fake_transformers, monkeypatch):
    import transformers

    def _failing(model_ref, local_files_only=False):
        raise OSError("checkpoint not found")

    monkeypatch.setattr(transformers.VisionEncoderDecoderModel, "from_pretrained", _failing)

    with pytest.raises(RuntimeError):
        TrOCREvaluationPredictor(project_id="p1", model="dummy/model")


def test_recognize_image_read_failure_propagates(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    with pytest.raises(Exception):
        predictor.recognize(str(tmp_path / "does_not_exist.png"))


def test_recognize_processor_failure_propagates(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    fake_transformers["processors"][0].call_should_raise = RuntimeError("preprocess failed")
    with pytest.raises(RuntimeError):
        predictor.recognize(_make_image(tmp_path))


def test_recognize_generate_failure_propagates(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    fake_transformers["models"][0].generate_should_raise = RuntimeError("generation failed")
    with pytest.raises(RuntimeError):
        predictor.recognize(_make_image(tmp_path))


def test_recognize_decode_failure_propagates(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    fake_transformers["processors"][0].decode_should_raise = RuntimeError("decode failed")
    with pytest.raises(RuntimeError):
        predictor.recognize(_make_image(tmp_path))


# ---------------------------------------------------------------------------
# Integration（Dispatcher / Runner）
# ---------------------------------------------------------------------------


def test_register_to_dispatcher(fake_transformers):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("trocr", predictor)
    assert dispatcher.resolve("trocr") is predictor


def test_runner_success_via_dispatcher(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    fake_transformers["processors"][0].decode_return = ["ABC123"]
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("trocr", predictor)
    runner = EvaluationRunner(dispatcher)

    result = runner.run(
        engine_id="trocr",
        samples=[
            EvaluationInputSample(image=_make_image(tmp_path, "a.png"), ground_truth="ABC123"),
        ],
    )
    assert result.sample_count == 1
    assert result.samples[0].exact_match is True
    assert result.samples[0].confidence is None


def test_runner_failure_isolated_by_sample_failure_boundary(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("trocr", predictor)
    runner = EvaluationRunner(dispatcher)

    broken_path = str(tmp_path / "does_not_exist.png")
    result = runner.run(
        engine_id="trocr",
        samples=[
            EvaluationInputSample(image=broken_path, ground_truth="A"),
            EvaluationInputSample(image=_make_image(tmp_path, "ok.png"), ground_truth="recognized text"),
        ],
    )
    assert result.sample_count == 2
    assert result.samples[0].error is not None
    assert result.samples[1].error is None
    assert result.samples[1].exact_match is True


def test_runner_emits_warning_when_confidence_unavailable(fake_transformers, tmp_path):
    """confidenceが常にNoneのTrOCRでは、既存Runnerのconfidence欠損warningが機能することを確認する
    （Runner側のロジックは無変更、既存の`_build_warnings()`をそのまま利用）。"""
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("trocr", predictor)
    runner = EvaluationRunner(dispatcher)

    result = runner.run(
        engine_id="trocr",
        samples=[
            EvaluationInputSample(image=_make_image(tmp_path, "a.png"), ground_truth="X"),
        ],
    )
    assert any("confidence was unavailable" in w for w in result.warnings)


def test_predictor_reused_across_runner_samples(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("trocr", predictor)
    runner = EvaluationRunner(dispatcher)

    resolve_calls = []
    original_resolve = dispatcher.resolve

    def _counting_resolve(engine_id):
        resolve_calls.append(engine_id)
        return original_resolve(engine_id)

    dispatcher.resolve = _counting_resolve  # type: ignore[method-assign]

    runner.run(
        engine_id="trocr",
        samples=[
            EvaluationInputSample(image=_make_image(tmp_path, "a.png"), ground_truth="A"),
            EvaluationInputSample(image=_make_image(tmp_path, "b.png"), ground_truth="B"),
        ],
    )
    assert len(resolve_calls) == 1
    assert len(fake_transformers["processors"]) == 1


def test_sample_count_matches_metrics_sample_count(fake_transformers, tmp_path):
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("trocr", predictor)
    runner = EvaluationRunner(dispatcher)

    result = runner.run(
        engine_id="trocr",
        samples=[
            EvaluationInputSample(image=_make_image(tmp_path, "a.png"), ground_truth="A"),
            EvaluationInputSample(image=str(tmp_path / "missing.png"), ground_truth="B"),
        ],
    )
    assert result.sample_count == result.metrics.sample_count == 2


# ---------------------------------------------------------------------------
# Capability
# ---------------------------------------------------------------------------


def test_capability_trocr_supports_evaluation_true_with_real_default_registry(fake_transformers):
    """Issue #77でBackend既定Registryのtrocr.supports_evaluationをTrueへ変更した。"""
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    dispatcher = EvaluationDispatcher()  # 既定のcreate_default_registry()を使用
    dispatcher.register("trocr", predictor)
    dispatcher.resolve("trocr")  # 例外なし


def test_capability_tesseract_paddleocr_easyocr_still_true():
    dispatcher = EvaluationDispatcher()

    class DummyPredictor:
        def __init__(self, engine_id):
            self.engine_id = engine_id

        def recognize(self, *args, **kwargs):
            return PredictionResult(text="A")

    for engine_id in ("tesseract", "paddleocr", "easyocr"):
        dispatcher.register(engine_id, DummyPredictor(engine_id))
        dispatcher.resolve(engine_id)  # 例外なし


def test_capability_custom_still_unknown():
    from src.app.services.evaluation_dispatcher import UnknownEvaluationEngineError

    dispatcher = EvaluationDispatcher()
    with pytest.raises(UnknownEvaluationEngineError):
        dispatcher.resolve("custom")


# ---------------------------------------------------------------------------
# Regression（既存TrOCR推論・他Predictorへの非影響）
# ---------------------------------------------------------------------------


def test_no_network_or_model_download_dependency(fake_transformers, tmp_path):
    """fake_transformersのみでconstructor/recognizeが完結し、実ネットワーク・実modelの
    ダウンロードが一切発生しないことを、fakeの呼び出し回数のみで確認する。"""
    predictor = TrOCREvaluationPredictor(project_id="p1", model="dummy/model")
    predictor.recognize(_make_image(tmp_path))
    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1
