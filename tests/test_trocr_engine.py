"""TrOCR推論コア（src/app/services/trocr_engine.py）の単体テスト。

TrOCR Backend単画像推論コア実装Issueのスコープ通り、実モデル・ネットワークは
一切使用しない。transformers側のクラスメソッド（from_pretrained/generate/
batch_decode等）をmonkeypatchで差し替えて検証する（既存tests/test_benchmark.py
等と同じmonkeypatch慣習）。OCR Pipeline・API・Frontend・学習・評価への接続、
Engine Registry/Model Metadataとの実配線は対象外（本モジュールはまだ
既存コードから参照されていない）。
"""

import sys

import pytest
import torch
from PIL import Image

from src.app.services.trocr_engine import (
    TrOCRDependencyError,
    TrOCREngine,
    TrOCRInferenceError,
    TrOCRModelLoadError,
    TrOCRResult,
    _resolve_device,
)


# ---------------------------------------------------------------------------
# Fake transformers クラス（実モデル・ネットワーク不使用）
# ---------------------------------------------------------------------------


class _FakeTensor:
    """torch.Tensor相当。`.to(device)`呼び出しの記録だけを行うダミー。"""

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
        self.last_call_images = None
        self.last_return_tensors = None
        self.last_generated_ids = None
        self.last_skip_special_tokens = None
        self.decode_return = ["  recognized text  "]
        self.call_should_raise = None
        self.decode_should_raise = None

    def __call__(self, images, return_tensors):
        if self.call_should_raise is not None:
            raise self.call_should_raise
        self.last_call_images = images
        self.last_return_tensors = return_tensors
        return _FakeProcessorOutput(_FakeTensor("pixel_values"))

    def batch_decode(self, generated_ids, skip_special_tokens):
        if self.decode_should_raise is not None:
            raise self.decode_should_raise
        self.last_generated_ids = generated_ids
        self.last_skip_special_tokens = skip_special_tokens
        return self.decode_return


class _FakeModel:
    def __init__(self, model_ref, local_files_only):
        self.model_ref = model_ref
        self.local_files_only = local_files_only
        self.device_moved_to = None
        self.eval_called = False
        self.generate_called_with = None
        self.generate_return = "generated_ids_placeholder"
        self.inference_mode_used = None
        self.to_should_raise = None
        self.generate_should_raise = None

    def to(self, device):
        if self.to_should_raise is not None:
            raise self.to_should_raise
        self.device_moved_to = device
        return self

    def eval(self):
        self.eval_called = True

    def generate(self, pixel_values):
        if self.generate_should_raise is not None:
            raise self.generate_should_raise
        self.generate_called_with = pixel_values
        self.inference_mode_used = torch.is_inference_mode_enabled()
        return self.generate_return


@pytest.fixture()
def fake_transformers(monkeypatch):
    """transformers.AutoProcessor/VisionEncoderDecoderModel.from_pretrained をfakeへ差し替える。

    transformersのモジュールは`_LazyModule`であり、`monkeypatch.setattr(transformers,
    "AutoProcessor", ...)`のようにモジュール属性そのものを差し替えても、
    `from transformers import AutoProcessor`（本体コードが実行時に使う形）は
    実クラスを解決してしまい差し替えが反映されない。そのため、実クラス
    （`transformers.AutoProcessor`/`transformers.VisionEncoderDecoderModel`）
    自体はそのままに、その`from_pretrained`属性だけを差し替える。
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


def _load_engine(fake_transformers, model_ref="dummy/model", **kwargs):
    return TrOCREngine.load(model_ref, **kwargs)


# ---------------------------------------------------------------------------
# 正常系
# ---------------------------------------------------------------------------


def test_processor_is_loaded_from_model_ref(fake_transformers):
    engine = _load_engine(fake_transformers, model_ref="my-org/my-trocr-model")
    assert fake_transformers["processors"][0].model_ref == "my-org/my-trocr-model"
    assert engine.model_ref == "my-org/my-trocr-model"


def test_model_is_loaded_from_same_model_ref_as_processor(fake_transformers):
    _load_engine(fake_transformers, model_ref="my-org/my-trocr-model")
    assert fake_transformers["models"][0].model_ref == "my-org/my-trocr-model"


def test_local_files_only_is_passed_to_both_processor_and_model(fake_transformers):
    _load_engine(fake_transformers, local_files_only=True)
    assert fake_transformers["processors"][0].local_files_only is True
    assert fake_transformers["models"][0].local_files_only is True


def test_model_is_moved_to_device_and_set_to_eval(fake_transformers):
    engine = _load_engine(fake_transformers, device="cpu")
    fake_model = fake_transformers["models"][0]
    assert fake_model.device_moved_to == "cpu"
    assert fake_model.eval_called is True
    assert engine.device == "cpu"


def test_model_ref_leading_trailing_whitespace_is_stripped(fake_transformers):
    engine = _load_engine(fake_transformers, model_ref="  my-org/my-model  ")
    assert engine.model_ref == "my-org/my-model"
    assert fake_transformers["processors"][0].model_ref == "my-org/my-model"


def test_predict_converts_image_to_rgb(fake_transformers):
    engine = _load_engine(fake_transformers)
    grayscale_image = Image.new("L", (10, 10), color=128)

    engine.predict(grayscale_image)

    fake_processor = fake_transformers["processors"][0]
    assert fake_processor.last_call_images.mode == "RGB"


def test_predict_does_not_mutate_original_image(fake_transformers):
    engine = _load_engine(fake_transformers)
    original = Image.new("L", (10, 10), color=128)

    engine.predict(original)

    assert original.mode == "L"  # 元画像は変更されない


def test_predict_moves_pixel_values_to_device(fake_transformers):
    engine = _load_engine(fake_transformers, device="cpu")
    image = Image.new("RGB", (10, 10))

    engine.predict(image)

    fake_model = fake_transformers["models"][0]
    assert fake_model.generate_called_with.device_moved_to == "cpu"


def test_predict_calls_generate_inside_inference_mode(fake_transformers):
    engine = _load_engine(fake_transformers)
    image = Image.new("RGB", (10, 10))

    engine.predict(image)

    fake_model = fake_transformers["models"][0]
    assert fake_model.inference_mode_used is True


def test_predict_decodes_with_skip_special_tokens_true(fake_transformers):
    engine = _load_engine(fake_transformers)
    image = Image.new("RGB", (10, 10))

    engine.predict(image)

    fake_processor = fake_transformers["processors"][0]
    assert fake_processor.last_skip_special_tokens is True


def test_predict_returns_expected_text(fake_transformers):
    engine = _load_engine(fake_transformers)
    fake_transformers["processors"][0].decode_return = ["hello world"]
    image = Image.new("RGB", (10, 10))

    result = engine.predict(image)

    assert isinstance(result, TrOCRResult)
    assert result.text == "hello world"


def test_result_engine_id_is_trocr(fake_transformers):
    engine = _load_engine(fake_transformers)
    result = engine.predict(Image.new("RGB", (10, 10)))
    assert result.engine_id == "trocr"


def test_same_engine_instance_does_not_reload_on_repeated_predict(fake_transformers):
    engine = _load_engine(fake_transformers)
    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1

    engine.predict(Image.new("RGB", (10, 10)))
    engine.predict(Image.new("RGB", (10, 10)))
    engine.predict(Image.new("RGB", (10, 10)))

    # 複数回predictしても、from_pretrained経由の新規ロードは増えない
    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1


def test_predict_file_reads_image_from_disk(fake_transformers, tmp_path):
    engine = _load_engine(fake_transformers)
    fake_transformers["processors"][0].decode_return = ["from file"]

    image_path = tmp_path / "sample.png"
    Image.new("RGB", (10, 10), color=(255, 0, 0)).save(image_path)

    result = engine.predict_file(image_path)

    assert result.text == "from file"


def test_predict_file_accepts_string_path(fake_transformers, tmp_path):
    engine = _load_engine(fake_transformers)
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (10, 10)).save(image_path)

    result = engine.predict_file(str(image_path))

    assert isinstance(result, TrOCRResult)


# ---------------------------------------------------------------------------
# 入力異常
# ---------------------------------------------------------------------------


def test_load_rejects_none_model_ref():
    with pytest.raises(ValueError):
        TrOCREngine.load(None)


def test_load_rejects_empty_model_ref():
    with pytest.raises(ValueError):
        TrOCREngine.load("")


def test_load_rejects_whitespace_only_model_ref():
    with pytest.raises(ValueError):
        TrOCREngine.load("   ")


def test_predict_rejects_none_image(fake_transformers):
    engine = _load_engine(fake_transformers)
    with pytest.raises(ValueError):
        engine.predict(None)


def test_predict_rejects_non_pil_image_type(fake_transformers):
    engine = _load_engine(fake_transformers)
    with pytest.raises(ValueError):
        engine.predict("not an image")
    with pytest.raises(ValueError):
        engine.predict(b"raw bytes")


def test_predict_file_rejects_none_path(fake_transformers):
    engine = _load_engine(fake_transformers)
    with pytest.raises(ValueError):
        engine.predict_file(None)


def test_predict_file_rejects_nonexistent_file(fake_transformers, tmp_path):
    engine = _load_engine(fake_transformers)
    with pytest.raises(FileNotFoundError):
        engine.predict_file(tmp_path / "does_not_exist.png")


def test_predict_file_rejects_directory(fake_transformers, tmp_path):
    engine = _load_engine(fake_transformers)
    a_directory = tmp_path / "some_dir"
    a_directory.mkdir()
    with pytest.raises(ValueError):
        engine.predict_file(a_directory)


def test_predict_file_rejects_corrupted_image(fake_transformers, tmp_path):
    engine = _load_engine(fake_transformers)
    broken_path = tmp_path / "broken.png"
    broken_path.write_bytes(b"this is not a valid png file at all")

    with pytest.raises(ValueError):
        engine.predict_file(broken_path)


# ---------------------------------------------------------------------------
# 依存・ロード異常
# ---------------------------------------------------------------------------


def test_load_raises_dependency_error_when_transformers_not_installed(monkeypatch):
    monkeypatch.setitem(sys.modules, "transformers", None)
    with pytest.raises(TrOCRDependencyError):
        TrOCREngine.load("dummy/model")


def test_load_raises_model_load_error_when_processor_load_fails(monkeypatch):
    import transformers

    def _failing_from_pretrained(model_ref, local_files_only=False):
        raise OSError("network unreachable")

    monkeypatch.setattr(transformers.AutoProcessor, "from_pretrained", _failing_from_pretrained)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)

    with pytest.raises(TrOCRModelLoadError):
        TrOCREngine.load("dummy/model")


def test_load_raises_model_load_error_when_model_load_fails(fake_transformers, monkeypatch):
    import transformers

    def _failing_from_pretrained(model_ref, local_files_only=False):
        raise OSError("checkpoint not found")

    monkeypatch.setattr(
        transformers.VisionEncoderDecoderModel, "from_pretrained", _failing_from_pretrained
    )

    with pytest.raises(TrOCRModelLoadError):
        TrOCREngine.load("dummy/model")


def test_load_raises_model_load_error_when_device_move_fails(fake_transformers, monkeypatch):
    import transformers

    class _ToFailingModel(_FakeModel):
        def to(self, device):
            raise RuntimeError("out of memory")

    def _failing_model_from_pretrained(model_ref, local_files_only=False):
        return _ToFailingModel(model_ref, local_files_only)

    monkeypatch.setattr(
        transformers.VisionEncoderDecoderModel, "from_pretrained", _failing_model_from_pretrained
    )

    with pytest.raises(TrOCRModelLoadError):
        TrOCREngine.load("dummy/model")


def test_predict_raises_inference_error_when_generate_fails(fake_transformers):
    engine = _load_engine(fake_transformers)
    fake_transformers["models"][0].generate_should_raise = RuntimeError("generation failed")

    with pytest.raises(TrOCRInferenceError):
        engine.predict(Image.new("RGB", (10, 10)))


def test_predict_raises_inference_error_when_decode_fails(fake_transformers):
    engine = _load_engine(fake_transformers)
    fake_transformers["processors"][0].decode_should_raise = RuntimeError("decode failed")

    with pytest.raises(TrOCRInferenceError):
        engine.predict(Image.new("RGB", (10, 10)))


def test_predict_raises_inference_error_when_preprocess_fails(fake_transformers):
    engine = _load_engine(fake_transformers)
    fake_transformers["processors"][0].call_should_raise = RuntimeError("preprocess failed")

    with pytest.raises(TrOCRInferenceError):
        engine.predict(Image.new("RGB", (10, 10)))


def test_predict_raises_inference_error_on_malformed_decode_result(fake_transformers):
    """不正なdecode結果（空リスト）はInferenceErrorとして扱う（IndexErrorを生で漏らさない）。"""
    engine = _load_engine(fake_transformers)
    fake_transformers["processors"][0].decode_return = []

    with pytest.raises(TrOCRInferenceError):
        engine.predict(Image.new("RGB", (10, 10)))


# ---------------------------------------------------------------------------
# device
# ---------------------------------------------------------------------------


def test_resolve_device_auto_selects_cuda_when_available(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    assert _resolve_device(None) == "cuda"


def test_resolve_device_auto_selects_cpu_when_cuda_unavailable(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert _resolve_device(None) == "cpu"


def test_resolve_device_explicit_cpu(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    assert _resolve_device("cpu") == "cpu"


def test_resolve_device_explicit_cuda_when_available(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    assert _resolve_device("cuda") == "cuda"
    assert _resolve_device("cuda:0") == "cuda:0"


def test_resolve_device_explicit_cuda_when_unavailable_raises_not_silently_falls_back(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    with pytest.raises(TrOCRModelLoadError):
        _resolve_device("cuda")


def test_resolve_device_rejects_invalid_device_string(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    with pytest.raises(ValueError):
        _resolve_device("gpu")
    with pytest.raises(ValueError):
        _resolve_device("tpu")
    with pytest.raises(ValueError):
        _resolve_device("")


def test_resolve_device_case_and_whitespace_normalized(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert _resolve_device("  CPU  ") == "cpu"


# ---------------------------------------------------------------------------
# 結果
# ---------------------------------------------------------------------------


def test_result_strips_leading_and_trailing_whitespace(fake_transformers):
    engine = _load_engine(fake_transformers)
    fake_transformers["processors"][0].decode_return = ["  padded text  "]

    result = engine.predict(Image.new("RGB", (10, 10)))

    assert result.text == "padded text"


def test_result_empty_string_is_valid_not_an_error(fake_transformers):
    """空文字は捏造せず、そのまま正常な結果として返す。"""
    engine = _load_engine(fake_transformers)
    fake_transformers["processors"][0].decode_return = [""]

    result = engine.predict(Image.new("RGB", (10, 10)))

    assert result.text == ""


def test_result_has_no_confidence_attribute(fake_transformers):
    """TrOCRResultはconfidenceを持たない（捏造しない）。"""
    engine = _load_engine(fake_transformers)
    result = engine.predict(Image.new("RGB", (10, 10)))

    assert not hasattr(result, "confidence")
    assert not hasattr(result, "bbox")


def test_result_is_immutable(fake_transformers):
    engine = _load_engine(fake_transformers)
    result = engine.predict(Image.new("RGB", (10, 10)))

    import dataclasses

    with pytest.raises(dataclasses.FrozenInstanceError):
        result.text = "hacked"


# ---------------------------------------------------------------------------
# Engine Registryとの整合（既存の定義・仕様は変更しない。確認のみ）
# ---------------------------------------------------------------------------


def test_resolve_engine_id_trocr_is_unchanged():
    """trocrは既にEngine Registryへ組み込み登録済みであることの確認のみ（定義は変更しない）。"""
    from src.app.services.engine_registry import resolve_engine_id

    assert resolve_engine_id("trocr") == "trocr"
