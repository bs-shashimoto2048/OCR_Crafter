"""POST /api/ocr/evaluate のMulti-engine Evaluation API Integration（Issue #79）テスト。

Router層のみを検証する。`evaluate_ocr()`（legacy）・`run_multi_engine_evaluation()`
（新経路）はいずれもmonkeypatchで差し替え、実OCRエンジン・実画像・実CSVへ依存しない。
既存Tesseract-onlyリクエストは無条件に`evaluate_ocr()`（無変更のlegacy実装）へ
ルーティングされることを重点的に検証する（Legacy Tesseract compatibility）。
"""

from __future__ import annotations

import pytest

import src.app.main as main_mod
from src.app.services.evaluation_dispatcher import UnknownEvaluationEngineError


@pytest.fixture
def client(temp_projects):
    from fastapi.testclient import TestClient

    return TestClient(main_mod.app, raise_server_exceptions=False)


def _base_payload(**overrides):
    payload = {
        "project_id": "p1",
        "image_dir": "/tmp/some_dir",
        "gt_csv": "/tmp/gt.csv",
        "targets": [{"engine": "tesseract", "model": "eng"}],
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# Legacy Tesseract compatibility（既存経路への完全な後方互換）
# ---------------------------------------------------------------------------


def test_all_tesseract_targets_route_to_legacy_evaluate_ocr(monkeypatch, client):
    """全targetがtesseractの場合、既存evaluate_ocr()がそのまま呼ばれる（引数もそのまま）。"""
    captured = {}

    def fake_evaluate_ocr(**kwargs):
        captured.update(kwargs)
        return {"targets": [], "count": 0, "rows": []}

    called_new_path = {"called": False}

    def fake_run_multi_engine_evaluation(**kwargs):
        called_new_path["called"] = True
        return {}

    monkeypatch.setattr(main_mod, "evaluate_ocr", fake_evaluate_ocr)
    monkeypatch.setattr(main_mod, "run_multi_engine_evaluation", fake_run_multi_engine_evaluation)

    resp = client.post(
        "/api/ocr/evaluate",
        json=_base_payload(targets=[{"engine": "tesseract", "model": "eng"}, {"engine": "tesseract", "model": "latest"}]),
    )
    assert resp.status_code == 200
    assert called_new_path["called"] is False
    assert captured["project_id"] == "p1"
    assert captured["image_dir"] == "/tmp/some_dir"


def test_default_targets_are_tesseract_only_and_use_legacy_path(monkeypatch, client):
    """targets省略時（既存デフォルト=tesseract 2件）も、legacy経路のまま。"""
    called = {"legacy": False, "new": False}

    def fake_evaluate_ocr(**kwargs):
        called["legacy"] = True
        return {"targets": [], "count": 0, "rows": []}

    def fake_run_multi_engine_evaluation(**kwargs):
        called["new"] = True
        return {}

    monkeypatch.setattr(main_mod, "evaluate_ocr", fake_evaluate_ocr)
    monkeypatch.setattr(main_mod, "run_multi_engine_evaluation", fake_run_multi_engine_evaluation)

    resp = client.post(
        "/api/ocr/evaluate",
        json={"project_id": "p1", "image_dir": "/tmp/some_dir", "gt_csv": "/tmp/gt.csv"},
    )
    assert resp.status_code == 200
    assert called["legacy"] is True
    assert called["new"] is False


# ---------------------------------------------------------------------------
# 新エンジン選択（Dispatcher/Runner経由の新経路）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("engine", ["paddleocr", "easyocr", "trocr"])
def test_non_tesseract_engine_routes_to_new_path(monkeypatch, client, engine):
    called = {"legacy": False, "new": False}
    captured = {}

    def fake_evaluate_ocr(**kwargs):
        called["legacy"] = True
        return {"targets": [], "count": 0, "rows": []}

    def fake_run_multi_engine_evaluation(**kwargs):
        called["new"] = True
        captured.update(kwargs)
        return {"targets": [{"engine": engine, "model": "x"}], "count": 1, "rows": []}

    monkeypatch.setattr(main_mod, "evaluate_ocr", fake_evaluate_ocr)
    monkeypatch.setattr(main_mod, "run_multi_engine_evaluation", fake_run_multi_engine_evaluation)

    resp = client.post(
        "/api/ocr/evaluate",
        json=_base_payload(targets=[{"engine": engine, "model": "x"}]),
    )
    assert resp.status_code == 200
    assert called["new"] is True
    assert called["legacy"] is False
    assert captured["targets"] == [{"engine": engine, "model": "x", "options": {}}]


def test_mixed_tesseract_and_non_tesseract_routes_to_new_path(monkeypatch, client):
    called = {"legacy": False, "new": False}

    def fake_evaluate_ocr(**kwargs):
        called["legacy"] = True
        return {"targets": [], "count": 0, "rows": []}

    def fake_run_multi_engine_evaluation(**kwargs):
        called["new"] = True
        return {"targets": [], "count": 0, "rows": []}

    monkeypatch.setattr(main_mod, "evaluate_ocr", fake_evaluate_ocr)
    monkeypatch.setattr(main_mod, "run_multi_engine_evaluation", fake_run_multi_engine_evaluation)

    resp = client.post(
        "/api/ocr/evaluate",
        json=_base_payload(
            targets=[{"engine": "tesseract", "model": "eng"}, {"engine": "paddleocr", "model": "official"}]
        ),
    )
    assert resp.status_code == 200
    assert called["new"] is True
    assert called["legacy"] is False


def test_mixed_engine_request_forwards_falsy_tesseract_options_unmodified(monkeypatch, client):
    """マージ前レビューMajor #1の回帰防止（API層）: mixed-engineリクエストのTesseract targetに
    psm=0/charset=""を指定した場合、API層（main.py）がそれらの値を一切加工せず
    run_multi_engine_evaluation()（延いてはbuild_predictor()）へそのまま渡すことを確認する
    （API層自身がfalsy値を書き換える別の不具合が無いことの確認）。"""
    captured = {}

    def fake_evaluate_ocr(**kwargs):
        raise AssertionError("legacy経路が呼ばれるべきではない")

    def fake_run_multi_engine_evaluation(**kwargs):
        captured.update(kwargs)
        return {"targets": [], "count": 0, "rows": []}

    monkeypatch.setattr(main_mod, "evaluate_ocr", fake_evaluate_ocr)
    monkeypatch.setattr(main_mod, "run_multi_engine_evaluation", fake_run_multi_engine_evaluation)

    resp = client.post(
        "/api/ocr/evaluate",
        json=_base_payload(
            targets=[
                {"engine": "tesseract", "model": "eng", "options": {"psm": 0, "charset": ""}},
                {"engine": "paddleocr", "model": "official"},
            ]
        ),
    )
    assert resp.status_code == 200
    tesseract_target = next(t for t in captured["targets"] if t["engine"] == "tesseract")
    assert tesseract_target["options"] == {"psm": 0, "charset": ""}


def test_mixed_engine_request_falsy_tesseract_options_reach_build_predictor(monkeypatch, client, tmp_path):
    """API → run_multi_engine_evaluation()（実関数）→ build_predictor()まで、mixed-engine
    リクエストのTesseract target psm=0/charset=""が実際に正しく届くことをend-to-endで確認する
    （main.pyはmock解除・evaluation_multi_engine.pyの実オーケストレーションを通す。4 Predictor
    クラスのみfakeへ差し替え、実OCRエンジン・実モデル・network・GPUに依存しない）。"""
    import src.app.services.evaluation_multi_engine as multi_engine_mod
    from src.app.services.evaluation_types import PredictionResult

    image_dir = tmp_path / "images"
    image_dir.mkdir()
    from PIL import Image

    Image.new("RGB", (20, 10), (255, 255, 255)).save(image_dir / "a.png")
    gt_csv = tmp_path / "gt.csv"
    gt_csv.write_text("image,expected\na.png,ABC\n", encoding="utf-8")

    captured_tesseract_kwargs = {}

    class _FakeTesseractPredictor:
        engine_id = "tesseract"

        def __init__(self, project_id, model="latest", charset="", psm=7):
            captured_tesseract_kwargs["charset"] = charset
            captured_tesseract_kwargs["psm"] = psm

        def recognize(self, image, **kwargs):
            return PredictionResult(text="ABC", confidence=0.9)

    class _FakePaddlePredictor:
        engine_id = "paddleocr"

        def __init__(self, **kwargs):
            pass

        def recognize(self, image, **kwargs):
            return PredictionResult(text="ABC", confidence=0.9)

    monkeypatch.setattr(multi_engine_mod, "TesseractEvaluationPredictor", _FakeTesseractPredictor)
    monkeypatch.setattr(multi_engine_mod, "PaddleOCREvaluationPredictor", _FakePaddlePredictor)

    resp = client.post(
        "/api/ocr/evaluate",
        json={
            "project_id": "p1",
            "image_dir": str(image_dir),
            "gt_csv": str(gt_csv),
            "targets": [
                {"engine": "tesseract", "model": "eng", "options": {"psm": 0, "charset": ""}},
                {"engine": "paddleocr", "model": "official"},
            ],
        },
    )
    assert resp.status_code == 200
    assert captured_tesseract_kwargs == {"charset": "", "psm": 0}


# ---------------------------------------------------------------------------
# Error mapping
# ---------------------------------------------------------------------------


def test_unknown_engine_error_maps_to_400(monkeypatch, client):
    def fake_run_multi_engine_evaluation(**kwargs):
        raise UnknownEvaluationEngineError("unknown evaluation engine: 'custom'")

    monkeypatch.setattr(main_mod, "run_multi_engine_evaluation", fake_run_multi_engine_evaluation)

    resp = client.post(
        "/api/ocr/evaluate",
        json=_base_payload(targets=[{"engine": "custom", "model": "x"}]),
    )
    assert resp.status_code == 400
    assert "custom" in resp.json()["message"] or "custom" in str(resp.json())


def test_new_path_value_error_maps_to_400(monkeypatch, client):
    def fake_run_multi_engine_evaluation(**kwargs):
        raise ValueError("評価対象の画像が見つかりませんでした")

    monkeypatch.setattr(main_mod, "run_multi_engine_evaluation", fake_run_multi_engine_evaluation)

    resp = client.post(
        "/api/ocr/evaluate",
        json=_base_payload(targets=[{"engine": "paddleocr", "model": "x"}]),
    )
    assert resp.status_code == 400


def test_new_path_file_not_found_maps_to_404(monkeypatch, client):
    def fake_run_multi_engine_evaluation(**kwargs):
        raise FileNotFoundError("評価用画像フォルダが見つかりません")

    monkeypatch.setattr(main_mod, "run_multi_engine_evaluation", fake_run_multi_engine_evaluation)

    resp = client.post(
        "/api/ocr/evaluate",
        json=_base_payload(targets=[{"engine": "paddleocr", "model": "x"}]),
    )
    assert resp.status_code == 404


def test_legacy_path_error_mapping_unchanged(monkeypatch, client):
    """legacy経路（全tesseract）のエラー変換（FileNotFoundError→404等）が既存のまま働くこと。"""

    def fake_evaluate_ocr(**kwargs):
        raise FileNotFoundError("評価用画像フォルダが見つかりません")

    monkeypatch.setattr(main_mod, "evaluate_ocr", fake_evaluate_ocr)

    resp = client.post("/api/ocr/evaluate", json=_base_payload())
    assert resp.status_code == 404
