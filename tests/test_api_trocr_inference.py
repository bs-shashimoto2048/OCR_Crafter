"""既存OCR推論API（POST /predict）へのTrOCR統合テスト。

実transformers・実モデル・実ネットワークは使用しない。`predict_from_image()`を
main.py側でモック（Service境界）し、Routerのみを検証する。

- engine="trocr"を既存APIが受け付けること（resolve_engine_id()による正規化）
- model（model_ref）が推論Serviceへそのまま渡ること・必須検証
- アップロード画像が既存経路（一時ファイル）へ渡ること
- 既存レスポンス形状を維持しつつTrOCR結果が返ること（TrOCRResult型は露出しない）
- TrOCR固有の異常系がAPIの既存エラー変換方式（HTTPException 400）へ変換されること
- 既存エンジン（Tesseract/PaddleOCR/EasyOCR）に回帰がないこと
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

import src.app.main as main_mod


@pytest.fixture
def client(temp_projects):
    from fastapi.testclient import TestClient

    return TestClient(main_mod.app, raise_server_exceptions=False)


def _png_bytes(color=180):
    buf = io.BytesIO()
    Image.new("RGB", (64, 24), (color, color, color)).save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def _upload():
    return {"file": ("sample.png", _png_bytes(), "image/png")}


# ---- 正常系 ----


def test_predict_accepts_engine_trocr_and_returns_existing_response_shape(monkeypatch, client):
    import os

    recorded = {}

    def fake_predict_from_image(image_path, **kwargs):
        recorded["image_path"] = image_path
        recorded["image_path_existed_during_call"] = os.path.exists(image_path)
        recorded["engine"] = kwargs.get("engine")
        recorded["model"] = kwargs.get("model")
        return {
            "text": "ABC123",
            "prediction": "ABC123",
            "confidence": None,
            "engine": "trocr",
            "model_name": kwargs.get("model"),
            "model_type": "trocr",
            "valid": True,
            "validation": None,
            "char_scores": [],
            "char_confidence_normalized": [],
        }

    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict_from_image)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "model": "microsoft/trocr-base-printed", "apply_preprocess": "false"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["prediction"] == "ABC123"
    assert body["engine"] == "trocr"
    assert body["confidence"] is None
    assert body["char_scores"] == []
    # アップロード画像が既存の一時ファイル経路（実ファイル）で渡っていること
    assert recorded["image_path"] is not None
    assert recorded["image_path_existed_during_call"] is True
    # model_refがそのままServiceへ渡っていること（変換・書き換えなし）
    assert recorded["model"] == "microsoft/trocr-base-printed"
    assert recorded["engine"] == "trocr"
    # TrOCRResult型そのものではなく、既存の辞書形状であること
    assert isinstance(body, dict)
    assert "model_ref" not in body  # TrOCRResult固有フィールド名がそのまま露出していない


@pytest.mark.parametrize("raw_engine", ["trocr", "TrOCR", "  TrOCR  ", "TROCR"])
def test_predict_normalizes_engine_value_via_resolve_engine_id(monkeypatch, client, raw_engine):
    calls = []

    def fake_predict_from_image(image_path, **kwargs):  # noqa: ARG001
        calls.append(kwargs.get("engine"))
        return {"prediction": "X", "confidence": None, "engine": "trocr"}

    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict_from_image)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": raw_engine, "model": "some/model-ref", "apply_preprocess": "false"},
    )

    assert resp.status_code == 200
    # Routerは生のengine文字列をそのままpredict_from_image()へ渡す
    # （正規化はresolve_engine_id()を経由するpredict.py側の責務）
    assert calls == [raw_engine]


def test_predict_local_path_model_ref_is_accepted(monkeypatch, client):
    def fake_predict_from_image(image_path, **kwargs):  # noqa: ARG001
        return {"prediction": "L", "confidence": None, "engine": "trocr", "model_name": kwargs.get("model")}

    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict_from_image)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "model": "/opt/models/my-trocr-checkpoint", "apply_preprocess": "false"},
    )
    assert resp.status_code == 200
    assert resp.json()["model_name"] == "/opt/models/my-trocr-checkpoint"


def test_predict_latest_is_not_implicitly_rewritten_for_trocr(monkeypatch, client):
    """'latest' を別モデル名へ暗黙変換しない。Router検証もブロックしない
    （Pipeline側の既存仕様どおり、そのままServiceへ渡り、失敗するならService側で失敗する）。
    """
    recorded = {}

    def fake_predict_from_image(image_path, **kwargs):  # noqa: ARG001
        recorded["model"] = kwargs.get("model")
        return {"prediction": "", "confidence": None, "engine": "trocr"}

    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict_from_image)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "apply_preprocess": "false"},  # model省略 -> Form既定値"latest"
    )
    assert resp.status_code == 200
    assert recorded["model"] == "latest"


# ---- model_ref 検証 ----


@pytest.mark.parametrize("blank_model", ["", "   "])
def test_predict_rejects_blank_model_ref_for_trocr(monkeypatch, client, blank_model):
    def fail_if_called(*args, **kwargs):  # noqa: ARG001
        raise AssertionError("predict_from_image must not be called when model_ref is blank for trocr")

    monkeypatch.setattr(main_mod, "predict_from_image", fail_if_called)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "model": blank_model},
    )
    assert resp.status_code == 400
    assert "model" in resp.json()["detail"].lower()


def test_predict_does_not_require_model_ref_for_non_trocr_engines(monkeypatch, client):
    """model_ref必須検証はtrocr選択時のみ。既存Engineの挙動は変えない。"""

    def fake_predict_from_image(image_path, **kwargs):  # noqa: ARG001
        return {"prediction": "T", "confidence": 0.5, "engine": "tesseract"}

    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict_from_image)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "tesseract", "model": "", "apply_preprocess": "false"},
    )
    assert resp.status_code == 200


# ---- 異常系（Serviceからの例外変換） ----


def test_predict_converts_dependency_missing_like_runtime_error_to_400(monkeypatch, client):
    def failing_predict(image_path, **kwargs):  # noqa: ARG001
        raise RuntimeError("transformers is not installed. Please run: pip install transformers")

    monkeypatch.setattr(main_mod, "predict_from_image", failing_predict)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "model": "some/model-ref", "apply_preprocess": "false"},
    )
    assert resp.status_code == 400
    assert "transformers" in resp.json()["detail"]


def test_predict_converts_model_load_failure_like_runtime_error_to_400(monkeypatch, client):
    def failing_predict(image_path, **kwargs):  # noqa: ARG001
        raise RuntimeError("failed to load TrOCR processor for model_ref='bogus/ref': not found")

    monkeypatch.setattr(main_mod, "predict_from_image", failing_predict)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "model": "bogus/ref", "apply_preprocess": "false"},
    )
    assert resp.status_code == 400


def test_predict_converts_inference_failure_like_runtime_error_to_400(monkeypatch, client):
    def failing_predict(image_path, **kwargs):  # noqa: ARG001
        raise RuntimeError("failed to generate text for model_ref='some/ref': boom")

    monkeypatch.setattr(main_mod, "predict_from_image", failing_predict)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "model": "some/ref", "apply_preprocess": "false"},
    )
    assert resp.status_code == 400


def test_predict_invalid_image_service_value_error_converts_to_400(monkeypatch, client):
    def failing_predict(image_path, **kwargs):  # noqa: ARG001
        raise ValueError("failed to open image file: corrupted")

    monkeypatch.setattr(main_mod, "predict_from_image", failing_predict)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "model": "some/ref", "apply_preprocess": "false"},
    )
    assert resp.status_code == 400


def test_predict_unknown_engine_string_falls_through_without_calling_trocr(monkeypatch, client):
    calls = []

    def fake_predict_from_image(image_path, **kwargs):  # noqa: ARG001
        calls.append(kwargs.get("engine"))
        return {"prediction": "", "confidence": None, "engine": "custom"}

    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict_from_image)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "not_a_real_engine", "apply_preprocess": "false"},
    )
    # 未知engineの解決自体はpredict_from_image()（PR #19でresolve_engine_id()経由）の責務。
    # Routerはengine文字列をそのまま渡すのみで、trocr固有の必須検証を誤って適用しない。
    assert calls == ["not_a_real_engine"]
    assert resp.status_code == 200


# ---- セキュリティ ----


def test_predict_error_body_does_not_leak_stacktrace_or_internal_exception_name(monkeypatch, client):
    def failing_predict(image_path, **kwargs):  # noqa: ARG001
        raise RuntimeError("failed to load TrOCR model for model_ref='some/ref': timeout")

    monkeypatch.setattr(main_mod, "predict_from_image", failing_predict)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "model": "some/ref", "apply_preprocess": "false"},
    )
    detail = resp.json()["detail"]
    assert "Traceback" not in detail
    assert "site-packages" not in detail
    assert "RuntimeError" not in detail  # 例外型名をそのまま露出しない


def test_predict_error_body_for_blank_model_ref_has_no_local_path_leak(client):
    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": "trocr", "model": ""},
    )
    detail = resp.json()["detail"]
    assert "Traceback" not in detail
    assert ":\\" not in detail  # Windows絶対パスの痕跡がない
    assert "/tmp/" not in detail


# ---- 回帰確認（既存Engine） ----


@pytest.mark.parametrize("engine", ["tesseract", "paddleocr", "easyocr", "custom"])
def test_predict_existing_engines_are_not_affected(monkeypatch, client, engine):
    calls = []

    def fake_predict_from_image(image_path, **kwargs):  # noqa: ARG001
        calls.append(kwargs.get("engine"))
        return {"prediction": "OK", "confidence": 0.9, "engine": engine}

    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict_from_image)

    resp = client.post(
        "/predict",
        files=_upload(),
        data={"engine": engine, "model": "latest", "apply_preprocess": "false"},
    )
    assert resp.status_code == 200
    assert resp.json()["engine"] == engine
    assert calls == [engine]


# ---- OpenAPI Schema ----


def test_openapi_schema_is_generatable_and_mentions_trocr(client):
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    preview_schema = schema["components"]["schemas"]["PreprocessPreviewRequest"]
    assert "trocr" in preview_schema["properties"]["engine"]["description"]
    assert "trocr" in preview_schema["properties"]["model"]["description"]
