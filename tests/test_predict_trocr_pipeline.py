"""OCR PipelineへのTrOCR統合テスト（predict.py::predict_from_image() 経路）。

実モデル・実transformersは使用しない。TrOCREngineをフェイクへ差し替え、
- resolve_engine_id()経由でtrocrへ分岐すること
- TrOCRResult -> 既存OCRResult(dict)への変換が行われること
- TrOCR固有例外がRuntimeErrorへ変換されること
- 既存エンジン（EasyOCR/PaddleOCR/Tesseract）の分岐に回帰がないこと
を確認する。
"""

from __future__ import annotations

from PIL import Image

import src.app.predict as predict_module
from src.app.services.trocr_engine import (
    TrOCRDependencyError,
    TrOCRInferenceError,
    TrOCRModelLoadError,
    TrOCRResult,
)


def _install_fake_trocr_engine(monkeypatch, *, text="ABC123", model_ref="dummy-ref", load_error=None, predict_error=None):
    calls = {"load_model_ref": None, "predict_called": False, "predict_file_called": False}

    class _FakeEngine:
        def predict(self, image):  # noqa: ARG002
            calls["predict_called"] = True
            if predict_error is not None:
                raise predict_error
            return TrOCRResult(text=text, model_ref=model_ref)

        def predict_file(self, path):  # noqa: ARG002
            calls["predict_file_called"] = True
            if predict_error is not None:
                raise predict_error
            return TrOCRResult(text=text, model_ref=model_ref)

    class _FakeTrOCREngine:
        @classmethod
        def load(cls, ref, **kwargs):  # noqa: ARG003
            calls["load_model_ref"] = ref
            if load_error is not None:
                raise load_error
            return _FakeEngine()

    monkeypatch.setattr(predict_module, "TrOCREngine", _FakeTrOCREngine)
    return calls


# ---- _predict_with_trocr（単体） ----


def test_predict_with_trocr_normal_via_path(monkeypatch):
    calls = _install_fake_trocr_engine(monkeypatch, text="L37KT", model_ref="microsoft/trocr-base-printed")
    result = predict_module._predict_with_trocr("img.png", "microsoft/trocr-base-printed")

    assert calls["load_model_ref"] == "microsoft/trocr-base-printed"
    assert calls["predict_file_called"] is True
    assert calls["predict_called"] is False
    assert result["text"] == "L37KT"
    assert result["prediction"] == "L37KT"
    assert result["engine"] == "trocr"
    assert result["model_name"] == "microsoft/trocr-base-printed"
    assert result["model_type"] == "trocr"
    assert result["confidence"] is None
    assert result["valid"] is True
    assert result["char_scores"] == []
    assert result["char_confidence_normalized"] == []


def test_predict_with_trocr_normal_via_pil_image(monkeypatch):
    calls = _install_fake_trocr_engine(monkeypatch, text="XYZ")
    image = Image.new("L", (16, 16))
    result = predict_module._predict_with_trocr(image, "some/model-ref")

    assert calls["predict_called"] is True
    assert calls["predict_file_called"] is False
    assert result["text"] == "XYZ"


def test_predict_with_trocr_wraps_dependency_error(monkeypatch):
    _install_fake_trocr_engine(
        monkeypatch, load_error=TrOCRDependencyError("transformers is not installed")
    )
    try:
        predict_module._predict_with_trocr("img.png", "some/model-ref")
        assert False, "expected RuntimeError"
    except TrOCRDependencyError:
        assert False, "TrOCRDependencyError must not leak out of predict.py"
    except RuntimeError as e:
        assert "transformers is not installed" in str(e)


def test_predict_with_trocr_wraps_model_load_error(monkeypatch):
    _install_fake_trocr_engine(monkeypatch, load_error=TrOCRModelLoadError("failed to load"))
    try:
        predict_module._predict_with_trocr("img.png", "some/model-ref")
        assert False, "expected RuntimeError"
    except TrOCRModelLoadError:
        assert False, "TrOCRModelLoadError must not leak out of predict.py"
    except RuntimeError as e:
        assert "failed to load" in str(e)


def test_predict_with_trocr_wraps_inference_error(monkeypatch):
    _install_fake_trocr_engine(monkeypatch, predict_error=TrOCRInferenceError("generate failed"))
    try:
        predict_module._predict_with_trocr("img.png", "some/model-ref")
        assert False, "expected RuntimeError"
    except TrOCRInferenceError:
        assert False, "TrOCRInferenceError must not leak out of predict.py"
    except RuntimeError as e:
        assert "generate failed" in str(e)


# ---- predict_from_image()（Engine Resolution経由の分岐） ----


def test_predict_from_image_dispatches_to_trocr_via_resolve_engine_id(monkeypatch, temp_projects):
    recorded = {}

    def fake_predict_with_trocr(image_source, model_ref):
        recorded["image_source"] = image_source
        recorded["model_ref"] = model_ref
        return {
            "text": "ABC",
            "prediction": "ABC",
            "confidence": None,
            "engine": "trocr",
            "model_name": model_ref,
            "model_type": "trocr",
            "valid": True,
            "validation": None,
            "char_scores": [],
            "char_confidence_normalized": [],
        }

    monkeypatch.setattr(predict_module, "_predict_with_trocr", fake_predict_with_trocr)

    # 大文字混在・前後空白: 文字列比較ではなくresolve_engine_id()の正規化で解決されることを確認
    result = predict_module.predict_from_image(
        "img.png",
        project_id="default",
        model="microsoft/trocr-base-printed",
        engine="  TrOCR  ",
        apply_preprocess=False,
    )

    assert recorded["image_source"] == "img.png"
    assert recorded["model_ref"] == "microsoft/trocr-base-printed"
    assert result["engine"] == "trocr"
    assert result["prediction"] == "ABC"
    assert result["preprocess_applied"] is False
    assert result["preprocess_image_type"] == ""
    assert result["preprocess_pipeline"] == []


def test_predict_from_image_unknown_engine_does_not_dispatch_to_trocr(monkeypatch, temp_projects):
    def fail_if_called(*args, **kwargs):  # noqa: ARG001
        raise AssertionError("_predict_with_trocr must not be called for an unregistered engine")

    monkeypatch.setattr(predict_module, "_predict_with_trocr", fail_if_called)

    try:
        predict_module.predict_from_image(
            "img.png",
            project_id="default",
            engine="not_a_real_engine",
            apply_preprocess=False,
        )
    except AssertionError:
        raise
    except Exception:
        # プロジェクトにチェックポイントが無いため分類フォールバック経路は失敗するが、
        # ここで確認したいのは「trocrへは分岐しない」ことのみ
        pass


def test_predict_from_image_easyocr_still_dispatches_via_resolve_engine_id(monkeypatch, temp_projects):
    trocr_calls = []
    monkeypatch.setattr(predict_module, "_predict_with_trocr", lambda *a, **k: trocr_calls.append(1))

    def fake_easyocr(image_source, **kwargs):  # noqa: ARG001
        return {"text": "E", "prediction": "E", "confidence": 0.9, "engine": "easyocr"}

    monkeypatch.setattr(predict_module, "_predict_with_easyocr", fake_easyocr)

    result = predict_module.predict_from_image(
        "img.png",
        project_id="default",
        engine="easyocr",
        apply_preprocess=False,
    )

    assert result["engine"] == "easyocr"
    assert trocr_calls == []


def test_predict_from_image_tesseract_still_dispatches_via_resolve_engine_id(monkeypatch, temp_projects):
    trocr_calls = []
    monkeypatch.setattr(predict_module, "_predict_with_trocr", lambda *a, **k: trocr_calls.append(1))

    def fake_tesseract(image_source, **kwargs):  # noqa: ARG001
        return {"text": "T", "prediction": "T", "confidence": 0.5, "engine": "tesseract"}

    monkeypatch.setattr(predict_module, "_predict_with_tesseract", fake_tesseract)

    result = predict_module.predict_from_image(
        "img.png",
        project_id="default",
        engine="tesseract",
        apply_preprocess=False,
    )

    assert result["engine"] == "tesseract"
    assert trocr_calls == []


def test_predict_from_image_paddleocr_still_dispatches_via_resolve_engine_id(monkeypatch, temp_projects):
    trocr_calls = []
    monkeypatch.setattr(predict_module, "_predict_with_trocr", lambda *a, **k: trocr_calls.append(1))

    def fake_paddleocr(image_source, **kwargs):  # noqa: ARG001
        return {"text": "P", "prediction": "P", "confidence": 0.7, "engine": "paddleocr"}

    monkeypatch.setattr(predict_module, "_predict_with_paddleocr", fake_paddleocr)

    result = predict_module.predict_from_image(
        "img.png",
        project_id="default",
        engine="paddleocr",
        apply_preprocess=False,
    )

    assert result["engine"] == "paddleocr"
    assert trocr_calls == []
