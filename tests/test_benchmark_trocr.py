"""TrOCR Benchmark Runner Integration（Issue #102）のテスト。

実TrOCRモデル・Hugging Face network access・GPU/CUDAへ依存しない。
`transformers.AutoProcessor`/`VisionEncoderDecoderModel`の`from_pretrained`を
fakeへ差し替える（`tests/test_trocr_evaluation_predictor.py`と同じmonkeypatch規約。
`TrOCREngine.load()`/`predict_file()`自体はmockせず実関数を使用し、既存の
build-once契約・画像読込・generate/decodeロジックを変更なく検証する）。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from src.app.services import benchmark as bm

# ---------------------------------------------------------------------------
# Fake transformers クラス（tests/test_trocr_evaluation_predictor.pyと同型）
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
        self.decode_return = ["TROCR_PRED"]

    def __call__(self, images, return_tensors):
        return _FakeProcessorOutput(_FakeTensor("pixel_values"))

    def batch_decode(self, generated_ids, skip_special_tokens):
        return self.decode_return


class _FakeModel:
    def __init__(self, model_ref, local_files_only):
        self.model_ref = model_ref
        self.local_files_only = local_files_only
        self.device_moved_to = None

    def to(self, device):
        self.device_moved_to = device
        return self

    def eval(self):
        pass

    def generate(self, pixel_values):
        return "generated_ids_placeholder"


@pytest.fixture()
def fake_transformers(monkeypatch):
    """transformers.AutoProcessor/VisionEncoderDecoderModel.from_pretrained をfakeへ差し替える。"""
    import torch
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
    monkeypatch.setattr(transformers.VisionEncoderDecoderModel, "from_pretrained", _fake_model_from_pretrained)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)  # 既定はCPU環境相当

    return {"processors": processors, "models": models}


def _make_image(path: Path, name: str = "a.png") -> Path:
    target = path / name
    Image.fromarray(np.full((32, 96), 220, dtype=np.uint8), mode="L").save(target)
    return target


# ---------------------------------------------------------------------------
# ENGINE_CATALOG / ENGINE_BUILDERS 登録
# ---------------------------------------------------------------------------


def test_trocr_catalog_entry_shape():
    catalog = {c["key"]: c for c in bm.ENGINE_CATALOG}
    assert "trocr" in catalog
    entry = catalog["trocr"]
    assert entry["implemented"] is True
    assert entry["requires_model"] is True
    assert set(entry["profile_keys"]) == {"device", "local_files_only"}


def test_trocr_builder_registered():
    assert "trocr" in bm.ENGINE_BUILDERS
    assert bm.ENGINE_BUILDERS["trocr"] is bm._build_trocr_runner  # noqa: SLF001


def test_trocr_availability_reflects_transformers_import(monkeypatch):
    import sys

    items = {i["key"]: i for i in bm.engine_catalog_with_availability()}
    assert items["trocr"]["available"] is True  # transformersはCI/開発環境に導入済み

    # transformers未インストール環境を模す（EasyOCR Predictor等と同じ既存の
    # sys.modules[name]=Noneトリック。import transformersがImportErrorになる）
    monkeypatch.setitem(sys.modules, "transformers", None)
    items2 = {i["key"]: i for i in bm.engine_catalog_with_availability()}
    assert items2["trocr"]["available"] is False
    assert "transformers" in items2["trocr"]["availability_note"]


# ---------------------------------------------------------------------------
# normalize_engine_spec()
# ---------------------------------------------------------------------------


def test_normalize_engine_spec_trocr_defaults():
    spec = bm.normalize_engine_spec({"engine": "trocr", "model": "microsoft/trocr-base-printed"})
    assert spec == {
        "engine": "trocr",
        "model": "microsoft/trocr-base-printed",
        "device": "auto",
        "local_files_only": False,
    }


def test_normalize_engine_spec_trocr_explicit_options():
    spec = bm.normalize_engine_spec(
        {"engine": "trocr", "model": "/data/models/trocr-a", "device": "CUDA", "local_files_only": True}
    )
    assert spec["device"] == "cuda"
    assert spec["local_files_only"] is True


def test_normalize_engine_spec_trocr_requires_model():
    with pytest.raises(ValueError, match="model の指定が必要"):
        bm.normalize_engine_spec({"engine": "trocr"})


# ---------------------------------------------------------------------------
# _build_trocr_runner(): load-once/predict-many・device変換・confidence・エラー伝播
# ---------------------------------------------------------------------------


def test_build_trocr_runner_requires_model():
    with pytest.raises(ValueError, match="model"):
        bm._build_trocr_runner("p1", {"engine": "trocr"})  # noqa: SLF001


def test_build_trocr_runner_loads_exactly_once(fake_transformers):
    runner = bm._build_trocr_runner("p1", {"engine": "trocr", "model": "microsoft/trocr-base-printed"})  # noqa: SLF001
    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1


def test_build_trocr_runner_reuses_same_engine_across_samples(tmp_path, fake_transformers):
    runner = bm._build_trocr_runner("p1", {"engine": "trocr", "model": "microsoft/trocr-base-printed"})  # noqa: SLF001
    img_a = _make_image(tmp_path, "a.png")
    img_b = _make_image(tmp_path, "b.png")
    runner["recognize"](str(img_a))
    runner["recognize"](str(img_b))
    # load-once/predict-many: 複数sampleを処理してもProcessor/Modelは1回しか構築されない
    assert len(fake_transformers["processors"]) == 1
    assert len(fake_transformers["models"]) == 1


def test_build_trocr_runner_recognize_returns_text_and_none_confidence(tmp_path, fake_transformers):
    runner = bm._build_trocr_runner("p1", {"engine": "trocr", "model": "microsoft/trocr-base-printed"})  # noqa: SLF001
    img = _make_image(tmp_path)
    text, confidence = runner["recognize"](str(img))
    assert text == "TROCR_PRED"
    assert confidence is None  # 捏造しない（既存TrOCR方針をそのまま維持）


def test_build_trocr_runner_device_auto_translates_to_none(fake_transformers):
    # device="auto"（またはspec省略時の既定）は_resolve_device()のNone分岐（自動解決）へ
    # 変換される。fake_transformersはtorch.cuda.is_available()=Falseにしているため"cpu"になる
    bm._build_trocr_runner("p1", {"engine": "trocr", "model": "m", "device": "auto"})  # noqa: SLF001
    assert fake_transformers["models"][0].device_moved_to == "cpu"


def test_build_trocr_runner_device_explicit_value_passed_through(fake_transformers):
    # 明示的な device=cpu はそのまま TrOCREngine.load(device="cpu") へ渡る（"auto"変換の対象外）
    bm._build_trocr_runner("p1", {"engine": "trocr", "model": "m", "device": "cpu"})  # noqa: SLF001
    assert fake_transformers["models"][0].device_moved_to == "cpu"


def test_build_trocr_runner_local_files_only_passed_through(fake_transformers):
    bm._build_trocr_runner("p1", {"engine": "trocr", "model": "m", "local_files_only": True})  # noqa: SLF001
    assert fake_transformers["processors"][0].local_files_only is True
    assert fake_transformers["models"][0].local_files_only is True


def test_build_trocr_runner_local_files_only_defaults_false(fake_transformers):
    bm._build_trocr_runner("p1", {"engine": "trocr", "model": "m"})  # noqa: SLF001
    assert fake_transformers["processors"][0].local_files_only is False


def test_build_trocr_runner_label_includes_model_ref(fake_transformers):
    runner = bm._build_trocr_runner("p1", {"engine": "trocr", "model": "microsoft/trocr-base-printed"})  # noqa: SLF001
    assert "microsoft/trocr-base-printed" in runner["label"]


def test_build_trocr_runner_propagates_load_errors(monkeypatch):
    """既存failure boundaryを維持する: TrOCR固有の握りつぶし処理を追加しない。"""
    from src.app.services.trocr_engine import TrOCRModelLoadError

    def fake_load(model_ref, *, device=None, local_files_only=False):
        raise TrOCRModelLoadError("boom")

    monkeypatch.setattr("src.app.services.trocr_engine.TrOCREngine.load", fake_load)
    with pytest.raises(TrOCRModelLoadError):
        bm._build_trocr_runner("p1", {"engine": "trocr", "model": "m"})  # noqa: SLF001


def test_build_trocr_runner_propagates_inference_errors(tmp_path, fake_transformers):
    """既存failure boundary: 推論失敗（generate例外）はrun_benchmark_job側のtry/exceptで
    1画像分の失敗として吸収される（builder自体は例外をそのまま伝播する）。"""

    runner = bm._build_trocr_runner("p1", {"engine": "trocr", "model": "m"})  # noqa: SLF001
    fake_transformers["models"][0].generate = lambda pixel_values: (_ for _ in ()).throw(RuntimeError("gpu oom"))
    img = _make_image(tmp_path)
    with pytest.raises(Exception, match="gpu oom"):
        runner["recognize"](str(img))


# ---------------------------------------------------------------------------
# run_benchmark_job()経由のエンドツーエンド統合
# ---------------------------------------------------------------------------


def test_run_benchmark_job_with_trocr_engine(temp_projects, tmp_path, fake_transformers):
    class FakeCtx:
        job_id = "JOB-000001"

        def update(self, progress, step, message=""):
            pass

        def check_cancelled(self):
            pass

    images_dir = tmp_path / "images"
    images_dir.mkdir()
    _make_image(images_dir, "a.png")
    gt_csv = tmp_path / "gt.csv"
    gt_csv.write_text("a.png,TROCR_PRED", encoding="utf-8")

    params = {
        "project_id": "p1",
        "name": "trocr-bench",
        "image_dir": str(images_dir),
        "gt_csv": str(gt_csv),
        "engines": [{"engine": "trocr", "model": "microsoft/trocr-base-printed"}],
        "warmup_runs": 0,
    }
    result = bm.run_benchmark_job(params, FakeCtx())
    detail = bm.get_benchmark("p1", result["benchmark_id"])
    row = detail["results"][0]
    assert row["engine"] == "trocr"
    assert row["engine_key"] == "trocr:microsoft/trocr-base-printed"
    assert row["label"] == "TrOCR（microsoft/trocr-base-printed）"
    assert row["cer"] == 0.0  # fakeの予測("TROCR_PRED")が正解と完全一致
    assert row["exact_match_rate"] == 1.0
    assert row["failed"] == 0
    # confidenceはBenchmark結果へ一切保存されない（既存契約。Investigation #100 §7）
    assert "confidence" not in row


def test_run_benchmark_job_trocr_alongside_existing_engines(temp_projects, tmp_path, fake_transformers, monkeypatch):
    """既存Tesseract/PaddleOCR系Benchmarkに回帰が無いことを、TrOCRとの混在実行で確認する。"""

    class FakeCtx:
        job_id = "JOB-000002"

        def update(self, progress, step, message=""):
            pass

        def check_cancelled(self):
            pass

    def build_fake_tesseract(project_id, spec):
        def recognize(path):
            return "TESS_PRED", 0.9

        return {"label": "fake-tesseract", "recognize": recognize}

    monkeypatch.setitem(bm.ENGINE_BUILDERS, "tesseract_base", build_fake_tesseract)

    images_dir = tmp_path / "images"
    images_dir.mkdir()
    _make_image(images_dir, "a.png")
    gt_csv = tmp_path / "gt.csv"
    gt_csv.write_text("a.png,TROCR_PRED", encoding="utf-8")

    params = {
        "project_id": "p1",
        "name": "mixed-bench",
        "image_dir": str(images_dir),
        "gt_csv": str(gt_csv),
        "engines": [
            {"engine": "trocr", "model": "microsoft/trocr-base-printed"},
            {"engine": "tesseract_base", "psm": 7},
        ],
        "warmup_runs": 0,
    }
    result = bm.run_benchmark_job(params, FakeCtx())
    assert result["engines"] == 2
    detail = bm.get_benchmark("p1", result["benchmark_id"])
    labels = {r["engine"] for r in detail["results"]}
    assert labels == {"trocr", "tesseract_base"}


def test_run_benchmark_job_trocr_load_failure_fails_whole_job(temp_projects, tmp_path, monkeypatch):
    """既存の設計（cold start失敗はJob全体を失敗させる）を変更しない（Investigation #100 §8）。"""
    from src.app.services.trocr_engine import TrOCRModelLoadError

    class FakeCtx:
        job_id = "JOB-000003"

        def update(self, progress, step, message=""):
            pass

        def check_cancelled(self):
            pass

    def fake_load(model_ref, *, device=None, local_files_only=False):
        raise TrOCRModelLoadError("model not found")

    monkeypatch.setattr("src.app.services.trocr_engine.TrOCREngine.load", fake_load)

    images_dir = tmp_path / "images"
    images_dir.mkdir()
    _make_image(images_dir, "a.png")
    gt_csv = tmp_path / "gt.csv"
    gt_csv.write_text("a.png,X", encoding="utf-8")

    params = {
        "project_id": "p1",
        "name": "fail-bench",
        "image_dir": str(images_dir),
        "gt_csv": str(gt_csv),
        "engines": [{"engine": "trocr", "model": "does-not-exist/model"}],
        "warmup_runs": 0,
    }
    with pytest.raises(TrOCRModelLoadError):
        bm.run_benchmark_job(params, FakeCtx())
