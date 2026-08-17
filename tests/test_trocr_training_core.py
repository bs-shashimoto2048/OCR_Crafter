"""TrOCR Training Backend Core（Issue #92、`src/app/services/trocr_training_core.py`）のテスト。

実TrOCRモデル・Hugging Face network access・GPU/CUDA・大容量checkpointへ依存しない。
`transformers.AutoProcessor`/`VisionEncoderDecoderModel`の`from_pretrained`をfakeへ
差し替える（`tests/test_trocr_engine.py`と同じmonkeypatch規約）。Fake Modelのみ実際の
`torch.nn.Module`（学習可能なParameterを1つ持つ）として実装し、`loss.backward()`/
`optimizer.step()`が本物のPyTorch autogradで動作することを確認する（訓練ロジック自体を
モックで隠さない）。Dataset ReadはIssue #90の実Adapter（`load_trocr_training_samples`）を
そのまま使い、tmp_path上に手作りしたデータセットを読ませる。
"""

from __future__ import annotations

import types
from pathlib import Path

import pytest
import torch
from PIL import Image

from src.app.services.trocr_dataset_adapter import TrocrDatasetError
from src.app.services.trocr_engine import TrOCRDependencyError, TrOCRModelLoadError
from src.app.services.trocr_training_core import (
    TrocrTrainingConfig,
    TrocrTrainingResult,
    TrOCRTrainingRunError,
    TrOCRTrainingSaveError,
    run_trocr_training,
)

MODULE = "src.app.services.trocr_training_core"


# ---------------------------------------------------------------------------
# Dataset fixture（Issue #90の実Adapterが読む形式そのもの）
# ---------------------------------------------------------------------------


def _build_dataset(root: Path, pairs: list[tuple[str, str]]) -> None:
    lines = []
    for name, text in pairs:
        image_path = root / "train" / "images" / name
        image_path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("L", (8, 8), color=255).save(image_path)
        lines.append(f"train/images/{name}\t{text}")
    (root / "train.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (root / "val.txt").write_text("", encoding="utf-8")
    (root / "test.txt").write_text("", encoding="utf-8")


# ---------------------------------------------------------------------------
# Fake transformers（実モデル・ネットワーク不使用。FakeModelのみ本物のnn.Module）
# ---------------------------------------------------------------------------


class _FakeTokenizer:
    pad_token_id = 0

    def __init__(self):
        self.calls = []

    def __call__(self, text, padding, max_length, truncation):
        self.calls.append({"text": text, "padding": padding, "max_length": max_length, "truncation": truncation})
        # 決定的なtoken列: 先頭がtext長（padしない範囲）、残りはpad_token_id
        length = min(len(text), max_length)
        ids = [i + 1 for i in range(length)] + [self.pad_token_id] * (max_length - length)
        return types.SimpleNamespace(input_ids=ids)


class _FakeProcessor:
    def __init__(self, model_ref, local_files_only=False):
        self.model_ref = model_ref
        self.local_files_only = local_files_only
        self.tokenizer = _FakeTokenizer()
        self.call_images = []
        self.save_pretrained_calls = []
        self.call_should_raise = None
        self.save_should_raise = None

    def __call__(self, images, return_tensors):
        if self.call_should_raise is not None:
            raise self.call_should_raise
        self.call_images.append(images)
        return types.SimpleNamespace(pixel_values=torch.zeros(1, 3, 4, 4))

    def save_pretrained(self, path):
        if self.save_should_raise is not None:
            raise self.save_should_raise
        self.save_pretrained_calls.append(Path(path))


class _FakeTrainableModel(torch.nn.Module):
    """実際に学習可能な最小nn.Module。loss.backward()/optimizer.step()が本物のPyTorch
    autogradで動作することを確認するため、モックではなく本物のParameterを1つ持つ。"""

    def __init__(self, model_ref, local_files_only=False):
        super().__init__()
        self.model_ref = model_ref
        self.local_files_only = local_files_only
        self.weight = torch.nn.Parameter(torch.zeros(1))
        self.forward_calls = []
        self.save_pretrained_calls = []
        self.forward_should_raise = None
        self.save_should_raise = None

    def forward(self, pixel_values=None, labels=None):
        if self.forward_should_raise is not None:
            raise self.forward_should_raise
        self.forward_calls.append({"pixel_values": pixel_values, "labels": labels})
        # weightに依存する損失（backward()でweight.gradが実際に populate される）
        loss = self.weight.sum() + pixel_values.float().mean() * 0.0 + labels.float().mean() * 0.0
        return types.SimpleNamespace(loss=loss)

    def save_pretrained(self, path):
        if self.save_should_raise is not None:
            raise self.save_should_raise
        self.save_pretrained_calls.append(Path(path))


@pytest.fixture()
def fake_transformers(monkeypatch):
    import transformers

    processors: list[_FakeProcessor] = []
    models: list[_FakeTrainableModel] = []

    def _fake_processor_from_pretrained(model_ref, local_files_only=False):
        fake = _FakeProcessor(model_ref, local_files_only)
        processors.append(fake)
        return fake

    def _fake_model_from_pretrained(model_ref, local_files_only=False):
        fake = _FakeTrainableModel(model_ref, local_files_only)
        models.append(fake)
        return fake

    monkeypatch.setattr(transformers.AutoProcessor, "from_pretrained", _fake_processor_from_pretrained)
    monkeypatch.setattr(transformers.VisionEncoderDecoderModel, "from_pretrained", _fake_model_from_pretrained)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)

    return {"processors": processors, "models": models}


def _config(tmp_path, **overrides):
    defaults = dict(output_dir=tmp_path / "artifact")
    defaults.update(overrides)
    return TrocrTrainingConfig(**defaults)


# ---------------------------------------------------------------------------
# 正常系
# ---------------------------------------------------------------------------


def test_dataset_adapter_is_used_for_training_samples(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "ABC"), ("b.png", "XYZ")])
    result = run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))
    assert result.sample_count == 2


def test_processor_and_model_are_built_exactly_once_per_run(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "ABC"), ("b.png", "XYZ"), ("c.png", "KLM")])
    run_trocr_training(dataset_root, "dummy/model", _config(tmp_path, epochs=2, batch_size=1))
    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1


def test_model_ref_is_forwarded_to_existing_trocr_engine_load(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "ABC")])
    run_trocr_training(dataset_root, "my-org/my-model", _config(tmp_path))
    assert fake_transformers["processors"][0].model_ref == "my-org/my-model"
    assert fake_transformers["models"][0].model_ref == "my-org/my-model"


def test_local_files_only_is_forwarded(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "ABC")])
    run_trocr_training(dataset_root, "dummy/model", _config(tmp_path, local_files_only=True))
    assert fake_transformers["processors"][0].local_files_only is True
    assert fake_transformers["models"][0].local_files_only is True


def test_image_and_text_are_converted_to_processor_and_tokenizer_inputs(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "ABC")])
    run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))
    processor = fake_transformers["processors"][0]
    assert len(processor.call_images) == 1
    assert processor.call_images[0].mode == "RGB"  # grayscaleソースをRGBへ変換して渡す
    assert processor.tokenizer.calls[0]["text"] == "ABC"
    assert processor.tokenizer.calls[0]["max_length"] == 32  # config既定値


def test_padding_token_is_masked_to_minus_100(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])  # max_target_length未満のtext
    config = _config(tmp_path, max_target_length=5)
    run_trocr_training(dataset_root, "dummy/model", config)
    model = fake_transformers["models"][0]
    labels = model.forward_calls[0]["labels"][0].tolist()
    # tokenizerは"AB"に対し[1, 2, pad, pad, pad]を返す実装（テスト用fake）。
    # pad_token_id(0)の位置はすべて-100へmaskされる
    assert labels == [1, 2, -100, -100, -100]


def test_training_parameter_propagation(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB"), ("b.png", "CD"), ("c.png", "EF")])
    config = _config(tmp_path, epochs=3, batch_size=2)
    result = run_trocr_training(dataset_root, "dummy/model", config)
    model = fake_transformers["models"][0]
    # 3 sample / batch_size=2 → 1 epochあたり2 batch（サイズ2・1）。epochs=3 → forward呼び出し6回
    assert len(model.forward_calls) == 6
    assert result.epochs_completed == 3


def test_default_device_is_cpu(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])
    run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))
    model = fake_transformers["models"][0]
    assert str(next(model.parameters()).device) == "cpu"


def test_training_actually_updates_model_weight_via_real_autograd(tmp_path, fake_transformers):
    """loss.backward()/optimizer.step()がモックではなく本物のPyTorch autogradで
    動作し、実際にweightが更新されることを確認する（訓練ロジックの正しさの根拠）。"""
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])
    config = _config(tmp_path, epochs=5, learning_rate=0.1)
    run_trocr_training(dataset_root, "dummy/model", config)
    model = fake_transformers["models"][0]
    # weight初期値は0。loss=weight.sum()+...なのでbackward()によりweight.grad=1、
    # AdamW(lr=0.1)を5 step適用すればweightは0から動く
    assert model.weight.item() != 0.0


def test_final_model_and_processor_are_saved_to_artifact_dir(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])
    artifact_dir = tmp_path / "my_artifact"
    result = run_trocr_training(dataset_root, "dummy/model", _config(tmp_path, output_dir=artifact_dir))
    model = fake_transformers["models"][0]
    processor = fake_transformers["processors"][0]
    assert model.save_pretrained_calls == [artifact_dir.resolve()]
    assert processor.save_pretrained_calls == [artifact_dir.resolve()]
    assert result.artifact_dir == artifact_dir.resolve()
    assert artifact_dir.exists()


def test_result_contract(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB"), ("b.png", "CD")])
    result = run_trocr_training(dataset_root, "my-model", _config(tmp_path, epochs=2))
    assert isinstance(result, TrocrTrainingResult)
    assert result.model_ref == "my-model"
    assert result.sample_count == 2
    assert result.epochs_completed == 2
    assert result.final_loss is not None


def test_model_is_returned_to_eval_mode_after_training(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])
    run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))
    model = fake_transformers["models"][0]
    assert model.training is False


# ---------------------------------------------------------------------------
# 異常系: 伝播（握りつぶさない）
# ---------------------------------------------------------------------------


def test_dataset_adapter_failure_propagates_unwrapped(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    dataset_root.mkdir()  # train.txt無し
    with pytest.raises(FileNotFoundError):
        run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))
    assert len(fake_transformers["processors"]) == 0  # Dataset失敗時はモデル構築すら行わない


def test_dataset_adapter_malformed_dataset_propagates_unwrapped(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    dataset_root.mkdir()
    (dataset_root / "train.txt").write_text("malformed line without tab\n", encoding="utf-8")
    with pytest.raises(TrocrDatasetError):
        run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))


def test_dependency_error_propagates_unwrapped(tmp_path, monkeypatch):
    """transformers未導入相当（TrOCREngine.load()由来のTrOCRDependencyError）は
    ラップせずそのまま伝播する。"""
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])

    def _raise_dependency_error(model_ref, **kwargs):
        raise TrOCRDependencyError("transformers is not installed")

    monkeypatch.setattr(f"{MODULE}.TrOCREngine.load", _raise_dependency_error)
    with pytest.raises(TrOCRDependencyError):
        run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))


def test_model_load_error_propagates_unwrapped(tmp_path, monkeypatch):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])

    def _raise_load_error(model_ref, **kwargs):
        raise TrOCRModelLoadError("failed to load model")

    monkeypatch.setattr(f"{MODULE}.TrOCREngine.load", _raise_load_error)
    with pytest.raises(TrOCRModelLoadError):
        run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))


def test_training_forward_failure_is_wrapped_as_run_error(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])

    # from_pretrained呼び出し前にfake_transformersの差し替えは既に有効なので、
    # モデル構築後にforward_should_raiseを設定する経路として、事前にmodelを1つ作らせて
    # from_pretrainedの戻り値へ例外を仕込む
    import transformers

    def _raise_forward(model_ref, local_files_only=False):
        fake = _FakeTrainableModel(model_ref, local_files_only)
        fake.forward_should_raise = RuntimeError("boom")
        return fake

    transformers.VisionEncoderDecoderModel.from_pretrained = _raise_forward
    with pytest.raises(TrOCRTrainingRunError, match="training failed"):
        run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))


def test_save_failure_is_wrapped_as_save_error(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])

    import transformers

    def _raise_on_save(model_ref, local_files_only=False):
        fake = _FakeTrainableModel(model_ref, local_files_only)
        fake.save_should_raise = OSError("disk full")
        return fake

    transformers.VisionEncoderDecoderModel.from_pretrained = _raise_on_save
    with pytest.raises(TrOCRTrainingSaveError, match="failed to save"):
        run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))


def test_image_open_failure_is_wrapped_as_run_error(tmp_path, fake_transformers):
    dataset_root = tmp_path / "dataset"
    _build_dataset(dataset_root, [("a.png", "AB")])
    # 画像ファイルを壊す（PNGヘッダを無効化）
    (dataset_root / "train" / "images" / "a.png").write_bytes(b"not a real png")
    with pytest.raises(TrOCRTrainingRunError):
        run_trocr_training(dataset_root, "dummy/model", _config(tmp_path))


# ---------------------------------------------------------------------------
# Config validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"epochs": 0},
        {"batch_size": 0},
        {"learning_rate": 0.0},
        {"learning_rate": -1.0},
        {"max_target_length": 0},
    ],
)
def test_config_rejects_invalid_values(tmp_path, overrides):
    with pytest.raises(ValueError):
        _config(tmp_path, **overrides)
