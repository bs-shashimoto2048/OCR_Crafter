"""Tesseract Evaluation Predictor Adapter（Issue #71、
`src/app/services/tesseract_evaluation_predictor.py`）のテスト。

既存`ocr_evaluation.py::build_recognizer`をmockし、実Tesseractバイナリ・実モデルへ依存しない。
「テストを通すために既存期待値を変更する」ことはしない（既存`build_recognizer`契約をそのまま
前提とする）。
"""

import pytest

from src.app.services.engine_capability import EngineCapability
from src.app.services.engine_registry import EngineDescriptor, EngineRegistry
from src.app.services.evaluation_dispatcher import EvaluationDispatcher
from src.app.services.evaluation_runner import EvaluationInputSample, EvaluationRunner, PredictionResult
from src.app.services.tesseract_evaluation_predictor import TesseractEvaluationPredictor


def _fake_recognizer(
    calls,
    *,
    label="eng.traineddata（学習前）",
    model="eng",
    is_base=True,
    training_preprocess=None,
    training_preprocess_hash=None,
    responses=None,
    exceptions=None,
):
    """既存`build_recognizer()`が返す辞書と同形の値を生成するテスト用ダブル。"""
    responses = list(responses) if responses is not None else []
    exceptions = dict(exceptions) if exceptions is not None else {}
    state = {"i": 0}

    def recognize(image_path):
        calls.append(image_path)
        index = state["i"]
        state["i"] += 1
        if index in exceptions:
            raise exceptions[index]
        return responses[index]

    return {
        "label": label,
        "engine": "tesseract",
        "model": model,
        "is_base": is_base,
        "recognize": recognize,
        "training_preprocess": training_preprocess,
        "training_preprocess_hash": training_preprocess_hash,
    }


def _registry() -> EngineRegistry:
    registry = EngineRegistry()
    capability = EngineCapability(engine_id="tesseract", display_name="Tesseract", supports_evaluation=True)
    registry.register(EngineDescriptor(engine_id="tesseract", display_name="Tesseract", capability=capability, implemented=True))
    return registry


# ---------------------------------------------------------------------------
# Protocol / 基本契約
# ---------------------------------------------------------------------------


def test_engine_id_is_tesseract():
    assert TesseractEvaluationPredictor.engine_id == "tesseract"


def test_construction_calls_existing_build_recognizer_with_expected_args(monkeypatch):
    """既存build_recognizer()へ project_id/target(engine,model)/charset/psm を正しく渡す。"""
    captured = {}

    def fake_build_recognizer(project_id, target, charset, psm):
        captured["project_id"] = project_id
        captured["target"] = target
        captured["charset"] = charset
        captured["psm"] = psm
        return _fake_recognizer([], responses=[("ABC", 0.9)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    TesseractEvaluationPredictor(project_id="p1", model="latest", charset="ABC0123", psm=8)

    assert captured["project_id"] == "p1"
    assert captured["target"] == {"engine": "tesseract", "model": "latest"}
    assert captured["charset"] == "ABC0123"
    assert captured["psm"] == 8


def test_recognize_returns_prediction_result(monkeypatch):
    calls = []

    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer(calls, responses=[("HELLO", 0.75)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1")
    result = predictor.recognize("image.png")

    assert isinstance(result, PredictionResult)
    assert result.text == "HELLO"
    assert result.confidence == 0.75


def test_confidence_none_is_preserved_not_faked_as_zero(monkeypatch):
    """既存仕様どおり、confidence取得不能はNoneのまま（0.0で捏造しない）。"""
    calls = []

    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer(calls, responses=[("L37KT", None)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1")
    result = predictor.recognize("image.png")

    assert result.confidence is None


def test_engine_details_is_always_none(monkeypatch):
    """engine_detailsは今回意図的に設定しない（EvaluationRunnerが統合しないため）。"""
    calls = []

    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer(calls, responses=[("ABC", 0.5)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1")
    result = predictor.recognize("image.png")
    assert result.engine_details is None


# ---------------------------------------------------------------------------
# PSM / whitelist伝播
# ---------------------------------------------------------------------------


def test_psm_propagated_to_build_recognizer(monkeypatch):
    captured = {}

    def fake_build_recognizer(project_id, target, charset, psm):
        captured["psm"] = psm
        return _fake_recognizer([], responses=[("A", 0.1)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    TesseractEvaluationPredictor(project_id="p1", psm=13)
    assert captured["psm"] == 13


def test_whitelist_charset_propagated_to_build_recognizer(monkeypatch):
    captured = {}

    def fake_build_recognizer(project_id, target, charset, psm):
        captured["charset"] = charset
        return _fake_recognizer([], responses=[("A", 0.1)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    TesseractEvaluationPredictor(project_id="p1", charset="XYZ")
    assert captured["charset"] == "XYZ"


def test_empty_charset_means_no_whitelist_propagated(monkeypatch):
    """空文字charset（whitelistなし）もそのまま伝播する（既存仕様: 暗黙のdefault復元をしない）。"""
    captured = {}

    def fake_build_recognizer(project_id, target, charset, psm):
        captured["charset"] = charset
        return _fake_recognizer([], responses=[("A", 0.1)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    TesseractEvaluationPredictor(project_id="p1", charset="")
    assert captured["charset"] == ""


# ---------------------------------------------------------------------------
# Model resolution（base / trained / エラー伝播）
# ---------------------------------------------------------------------------


def test_base_model_metadata_stored(monkeypatch):
    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer([], label="eng.traineddata（学習前）", model="eng", is_base=True, responses=[("A", 0.1)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1", model="eng")
    assert predictor.is_base is True
    assert predictor.model == "eng"


def test_trained_model_metadata_and_training_preprocess_stored(monkeypatch):
    tp = {"snapshot_id": "snap-1", "ocr_input_normalization": {"target_height": 48, "canvas_width": 320}}

    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer(
            [],
            label="model_a.tess.json（学習後）",
            model="model_a.tess.json",
            is_base=False,
            training_preprocess=tp,
            training_preprocess_hash="hash-1",
            responses=[("A", 0.1)],
        )

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1", model="model_a.tess.json")
    assert predictor.is_base is False
    assert predictor.training_preprocess == tp
    assert predictor.training_preprocess_hash == "hash-1"


def test_model_resolution_failure_propagates_from_constructor(monkeypatch):
    """モデル未検出等のbuild_recognizer()失敗は、Predictor construction時にそのまま伝播する
    （Run開始前エラー相当。Sample failureへは変換しない）。"""

    def fake_build_recognizer(project_id, target, charset, psm):
        raise FileNotFoundError("学習後モデルが見つかりません")

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    with pytest.raises(FileNotFoundError):
        TesseractEvaluationPredictor(project_id="p1", model="does-not-exist.tess.json")


# ---------------------------------------------------------------------------
# helper例外を握りつぶさない
# ---------------------------------------------------------------------------


def test_recognize_line_exception_propagates_not_swallowed(monkeypatch):
    calls = []

    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer(calls, responses=[None], exceptions={0: RuntimeError("tesseract recognition failed")})

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1")
    with pytest.raises(RuntimeError):
        predictor.recognize("image.png")


# ---------------------------------------------------------------------------
# 同一Predictorを複数Sampleで利用可能（build-once/reuse）
# ---------------------------------------------------------------------------


def test_same_predictor_used_across_multiple_recognize_calls(monkeypatch):
    calls = []
    build_call_count = {"n": 0}

    def fake_build_recognizer(project_id, target, charset, psm):
        build_call_count["n"] += 1
        return _fake_recognizer(calls, responses=[("A", 0.1), ("B", 0.2), ("C", 0.3)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1")
    r1 = predictor.recognize("a.png")
    r2 = predictor.recognize("b.png")
    r3 = predictor.recognize("c.png")

    assert build_call_count["n"] == 1  # build_recognizer（モデル解決）は1回のみ
    assert [r1.text, r2.text, r3.text] == ["A", "B", "C"]
    assert calls == ["a.png", "b.png", "c.png"]


# ---------------------------------------------------------------------------
# Dispatcherへregister可能・Runner経由で実行可能
# ---------------------------------------------------------------------------


def test_register_to_dispatcher(monkeypatch):
    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer([], responses=[("A", 0.1)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("tesseract", predictor)
    assert dispatcher.resolve("tesseract") is predictor


def test_runner_executes_via_dispatcher_end_to_end(monkeypatch):
    calls = []

    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer(calls, responses=[("ABC123", 0.9), ("XYZ999", 0.8)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("tesseract", predictor)
    runner = EvaluationRunner(dispatcher)

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
    assert calls == ["a.png", "b.png"]


def test_runner_sample_failure_boundary_isolates_recognize_line_exception(monkeypatch):
    """Predictorのrecognize_line()例外は、RunnerのSample Failure Boundaryで隔離される
    （Run全体は中断せず、後続Sampleも処理される）。"""
    calls = []

    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer(
            calls,
            responses=[None, ("OK", 0.9)],
            exceptions={0: RuntimeError("tesseract recognition failed (exit=1)")},
        )

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )
    predictor = TesseractEvaluationPredictor(project_id="p1")
    dispatcher = EvaluationDispatcher(registry=_registry())
    dispatcher.register("tesseract", predictor)
    runner = EvaluationRunner(dispatcher)

    result = runner.run(
        engine_id="tesseract",
        samples=[
            EvaluationInputSample(image="broken.png", ground_truth="A"),
            EvaluationInputSample(image="ok.png", ground_truth="OK"),
        ],
    )

    assert result.sample_count == 2
    assert result.samples[0].error == "RuntimeError"
    assert result.samples[0].prediction is None
    assert result.samples[1].error is None
    assert result.samples[1].prediction == "OK"
    assert len(calls) == 2


# ---------------------------------------------------------------------------
# 既存Tesseract挙動との互換
# ---------------------------------------------------------------------------


def test_adapter_output_matches_raw_build_recognizer_output(monkeypatch):
    """既存build_recognizer()の戻り値（recognize closure）とAdapter経由の結果が完全一致する
    （Adapterは純粋な橋渡しであり、値を変換・加工しないことの確認）。"""
    calls = []

    def fake_build_recognizer(project_id, target, charset, psm):
        return _fake_recognizer(calls, responses=[("SAMEVALUE", 0.6543)])

    monkeypatch.setattr(
        "src.app.services.tesseract_evaluation_predictor.build_recognizer", fake_build_recognizer
    )

    # 既存経路: build_recognizer()を直接呼び、recognizeクロージャを直接使う
    from src.app.services.tesseract_evaluation_predictor import build_recognizer as patched_build_recognizer

    raw = patched_build_recognizer("p1", {"engine": "tesseract", "model": "latest"}, "ABC", 7)
    expected_text, expected_confidence = raw["recognize"]("image.png")

    # Adapter経路
    predictor = TesseractEvaluationPredictor(project_id="p1", model="latest", charset="ABC", psm=7)
    result = predictor.recognize("image.png")

    assert result.text == expected_text
    assert result.confidence == expected_confidence
