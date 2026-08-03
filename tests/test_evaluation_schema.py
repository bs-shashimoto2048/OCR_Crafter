"""Multi-engine Evaluation API共通Schema（Issue #63）のテスト。既存OcrEvaluateRequest/OcrEvalTargetの後方互換と、
新設OcrEvaluationMetrics/SampleResult/Confusion/Resultの検証を確認する。"""

import pytest
from pydantic import ValidationError

from src.app.schemas import (
    OcrEvalTarget,
    OcrEvaluateRequest,
    OcrEvaluationConfusion,
    OcrEvaluationMetrics,
    OcrEvaluationResult,
    OcrEvaluationSampleResult,
)


# ---------------------------------------------------------------------------
# Request: 既存OcrEvaluateRequest/OcrEvalTargetの後方互換拡張
# ---------------------------------------------------------------------------


def test_legacy_payload_without_options_parses_with_empty_options():
    """実際のFrontend Payload（App.jsx::runOcrEvaluation）相当。optionsキーを含まない。"""
    payload = {
        "project_id": "p1",
        "image_dir": "/data/eval",
        "gt_csv": "/data/eval/gt.csv",
        "targets": [
            {"engine": "tesseract", "model": "eng"},
            {"engine": "tesseract", "model": "latest"},
        ],
        "charset": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-",
        "psm": 7,
        "preprocess_mode": "none",
    }
    req = OcrEvaluateRequest(**payload)
    assert req.targets[0].options == {}
    assert req.targets[1].options == {}
    dumped = req.model_dump()
    # 既存フィールドが無修正のまま維持されている
    assert dumped["image_dir"] == "/data/eval"
    assert dumped["gt_csv"] == "/data/eval/gt.csv"
    assert dumped["charset"] == "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-"
    assert dumped["psm"] == 7
    assert dumped["targets"][0]["engine"] == "tesseract"
    assert dumped["targets"][0]["model"] == "eng"


def test_request_default_targets_unchanged():
    """targets省略時の既定値（学習前eng + latest）が変わっていない。"""
    req = OcrEvaluateRequest(image_dir="d", gt_csv="g")
    assert [t.model for t in req.targets] == ["eng", "latest"]
    assert all(t.engine == "tesseract" for t in req.targets)
    assert all(t.options == {} for t in req.targets)


def test_request_default_charset_and_psm_unchanged():
    req = OcrEvaluateRequest(image_dir="d", gt_csv="g")
    assert req.charset == "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-"
    assert req.psm == 7
    assert req.preprocess_source == "none"
    assert req.preprocess_mode is None


def test_target_options_extended_payload_with_per_target_options():
    payload = [
        {"engine": "tesseract", "model": "latest", "options": {"psm": 6, "charset": "ABC"}},
        {"engine": "trocr", "model": "microsoft/trocr-base-printed", "options": {"device": "cpu", "local_files_only": True}},
    ]
    targets = [OcrEvalTarget(**t) for t in payload]
    assert targets[0].options == {"psm": 6, "charset": "ABC"}
    assert targets[1].options == {"device": "cpu", "local_files_only": True}
    assert targets[1].engine == "trocr"


def test_target_options_unknown_keys_are_preserved():
    """未知のEngine固有option（将来のTrOCR用等）もそのまま保持し、拒否・検証しない。"""
    target = OcrEvalTarget(engine="trocr", model="m", options={"future_option": "value", "nested": {"a": 1}})
    assert target.options == {"future_option": "value", "nested": {"a": 1}}


def test_target_options_mutable_default_isolation():
    """2つのtarget間でoptions dictが共有されない（default_factory使用の確認）。"""
    t1 = OcrEvalTarget()
    t2 = OcrEvalTarget()
    t1.options["mutated"] = True
    assert t2.options == {}

    req = OcrEvaluateRequest(
        image_dir="d",
        gt_csv="g",
        targets=[{"engine": "tesseract", "model": "eng"}, {"engine": "tesseract", "model": "latest"}],
    )
    req.targets[0].options["x"] = 1
    assert req.targets[1].options == {}


def test_target_engine_field_name_and_type_unchanged():
    """既存Engine相当フィールド（engine: str）の名前・型を維持している。"""
    target = OcrEvalTarget()
    assert isinstance(target.engine, str)
    assert target.engine == "tesseract"


# ---------------------------------------------------------------------------
# Metrics: OcrEvaluationMetrics
# ---------------------------------------------------------------------------


def test_metrics_minimal_construction():
    m = OcrEvaluationMetrics()
    assert m.sample_count == 0
    assert m.exact_match_count == 0
    assert m.exact_match_rate is None
    assert m.cer is None
    assert m.character_accuracy is None


def test_metrics_full_construction():
    m = OcrEvaluationMetrics(sample_count=10, exact_match_count=8, exact_match_rate=0.8, cer=0.05, character_accuracy=0.95)
    assert m.sample_count == 10
    assert m.exact_match_rate == 0.8


def test_metrics_cer_may_exceed_one():
    """CERは編集距離/正解文字数のマイクロ平均であり、既存仕様上1を超えうる（上限を課さない）。"""
    m = OcrEvaluationMetrics(cer=2.5)
    assert m.cer == 2.5


def test_metrics_character_accuracy_may_be_negative():
    """character_accuracy=1-cerであり、cer>1のとき負値になりうる（下限を課さない）。"""
    m = OcrEvaluationMetrics(character_accuracy=-1.5)
    assert m.character_accuracy == -1.5


def test_metrics_exact_match_rate_bounds():
    OcrEvaluationMetrics(exact_match_rate=0.0)
    OcrEvaluationMetrics(exact_match_rate=1.0)
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(exact_match_rate=1.1)
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(exact_match_rate=-0.1)


def test_metrics_negative_counts_rejected():
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(sample_count=-1)
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(exact_match_count=-1)
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(cer=-0.1)


def test_metrics_bool_rejected_for_numeric_fields():
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(sample_count=True)
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(exact_match_count=False)
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(exact_match_rate=True)
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(cer=False)
    with pytest.raises(ValidationError):
        OcrEvaluationMetrics(character_accuracy=True)


# ---------------------------------------------------------------------------
# Sample: OcrEvaluationSampleResult
# ---------------------------------------------------------------------------


def test_sample_normal_construction():
    s = OcrEvaluationSampleResult(
        image="a.png",
        ground_truth="ABC",
        prediction="ABC",
        exact_match=True,
        edit_distance=0,
        cer=0.0,
        confidence=0.92,
        duration_ms=12.5,
    )
    assert s.exact_match is True
    assert s.confidence == 0.92


def test_sample_confidence_none_is_not_fabricated():
    """confidenceを取得できないEngine（TrOCR等）はNoneを許容し、0.0で補完しない。"""
    s = OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", prediction="ABC", confidence=None)
    assert s.confidence is None


def test_sample_confidence_zero_is_allowed_as_real_value():
    """実測confidence=0.0は正当な値として許可する。"""
    s = OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", confidence=0.0)
    assert s.confidence == 0.0


def test_sample_prediction_empty_string_is_valid_ocr_result():
    s = OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", prediction="")
    assert s.prediction == ""


def test_sample_prediction_none_on_inference_failure():
    s = OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", prediction=None, error="inference failed")
    assert s.prediction is None
    assert s.error == "inference failed"


def test_sample_ground_truth_allows_empty_string():
    s = OcrEvaluationSampleResult(image="a.png", ground_truth="")
    assert s.ground_truth == ""


def test_sample_error_field_holds_plain_string():
    s = OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", error="some error message")
    assert s.error == "some error message"


def test_sample_negative_edit_distance_rejected():
    with pytest.raises(ValidationError):
        OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", edit_distance=-1)


def test_sample_negative_duration_rejected():
    with pytest.raises(ValidationError):
        OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", duration_ms=-1.0)


def test_sample_bool_rejected_for_numeric_fields():
    with pytest.raises(ValidationError):
        OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", edit_distance=True)
    with pytest.raises(ValidationError):
        OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", duration_ms=True)
    with pytest.raises(ValidationError):
        OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", confidence=False)
    with pytest.raises(ValidationError):
        OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", cer=True)


def test_sample_exact_match_strict_bool_no_implicit_conversion():
    """exact_matchは文字列等を暗黙変換しない（strict bool）。"""
    with pytest.raises(ValidationError):
        OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", exact_match="true")
    with pytest.raises(ValidationError):
        OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", exact_match=1)
    s = OcrEvaluationSampleResult(image="a.png", ground_truth="ABC", exact_match=None)
    assert s.exact_match is None


# ---------------------------------------------------------------------------
# Confusion: OcrEvaluationConfusion
# ---------------------------------------------------------------------------


def test_confusion_substitution():
    c = OcrEvaluationConfusion(kind="sub", expected="O", predicted="0", count=1)
    assert c.kind == "sub"
    assert c.expected == "O"
    assert c.predicted == "0"


def test_confusion_insertion_has_empty_expected():
    c = OcrEvaluationConfusion(kind="ins", expected="", predicted="Z", count=1)
    assert c.expected == ""
    assert c.predicted == "Z"


def test_confusion_deletion_has_empty_predicted():
    c = OcrEvaluationConfusion(kind="del", expected="Y", predicted="", count=1)
    assert c.predicted == ""


def test_confusion_count_default_and_nonnegative():
    c = OcrEvaluationConfusion(kind="sub", expected="A", predicted="B")
    assert c.count == 0
    with pytest.raises(ValidationError):
        OcrEvaluationConfusion(kind="sub", expected="A", predicted="B", count=-1)


def test_confusion_bool_rejected_for_count():
    with pytest.raises(ValidationError):
        OcrEvaluationConfusion(kind="sub", expected="A", predicted="B", count=True)


# ---------------------------------------------------------------------------
# Result: OcrEvaluationResult
# ---------------------------------------------------------------------------


def test_result_minimal_construction_requires_only_engine_id():
    r = OcrEvaluationResult(engine_id="tesseract")
    assert r.engine_id == "tesseract"
    assert isinstance(r.metrics, OcrEvaluationMetrics)
    assert r.samples == []
    assert r.confusions == []
    assert r.warnings == []
    assert r.engine_details == {}


def test_result_full_construction():
    r = OcrEvaluationResult(
        evaluation_id="ev-1",
        engine_id="paddleocr",
        model_ref="official:en_PP-OCRv5_mobile_rec",
        dataset_id="ds-1",
        started_at="2026-08-03T00:00:00",
        finished_at="2026-08-03T00:01:00",
        duration_ms=60000.0,
        sample_count=2,
        metrics=OcrEvaluationMetrics(sample_count=2, exact_match_count=2, exact_match_rate=1.0, cer=0.0, character_accuracy=1.0),
        samples=[
            OcrEvaluationSampleResult(image="a.png", ground_truth="AB", prediction="AB", exact_match=True),
            OcrEvaluationSampleResult(image="b.png", ground_truth="CD", prediction="CD", exact_match=True),
        ],
        confusions=[OcrEvaluationConfusion(kind="sub", expected="A", predicted="4", count=1)],
        warnings=["some warning"],
        engine_details={"psm": 7},
    )
    assert len(r.samples) == 2
    assert r.confusions[0].kind == "sub"


def test_result_round_trip():
    r = OcrEvaluationResult(
        engine_id="trocr",
        model_ref="microsoft/trocr-base-printed",
        samples=[OcrEvaluationSampleResult(image="a.png", ground_truth="AB", prediction="AB", confidence=None)],
        confusions=[OcrEvaluationConfusion(kind="ins", expected="", predicted="Z", count=1)],
        warnings=["w1"],
        engine_details={"device": "cpu"},
    )
    dumped = r.model_dump()
    restored = OcrEvaluationResult(**dumped)
    assert restored == r
    assert restored.samples[0].confidence is None


def test_result_nested_samples_preserved():
    r = OcrEvaluationResult(
        engine_id="easyocr",
        samples=[
            OcrEvaluationSampleResult(image="a.png", ground_truth="A", prediction="A"),
            OcrEvaluationSampleResult(image="b.png", ground_truth="B", prediction=None, error="failed"),
        ],
    )
    assert r.samples[1].error == "failed"
    assert r.samples[1].prediction is None


def test_result_mutable_default_isolation():
    r1 = OcrEvaluationResult(engine_id="tesseract")
    r2 = OcrEvaluationResult(engine_id="tesseract")
    r1.samples.append(OcrEvaluationSampleResult(image="a.png", ground_truth="A"))
    r1.confusions.append(OcrEvaluationConfusion(kind="sub", expected="A", predicted="B", count=1))
    r1.warnings.append("w")
    r1.engine_details["k"] = "v"
    assert r2.samples == []
    assert r2.confusions == []
    assert r2.warnings == []
    assert r2.engine_details == {}
    # metricsも独立したインスタンスであること
    r1.metrics.sample_count = 99
    assert r2.metrics.sample_count == 0


def test_result_unknown_engine_id_is_representable():
    """DispatcherがEngine対応可否を判定する責務であり、Schema自体は未知Engineの結果も表現できる。"""
    r = OcrEvaluationResult(engine_id="some-future-engine")
    assert r.engine_id == "some-future-engine"


def test_result_blank_engine_id_rejected():
    with pytest.raises(ValidationError):
        OcrEvaluationResult(engine_id="")
    with pytest.raises(ValidationError):
        OcrEvaluationResult(engine_id="   ")


def test_result_negative_duration_and_sample_count_rejected():
    with pytest.raises(ValidationError):
        OcrEvaluationResult(engine_id="tesseract", duration_ms=-1.0)
    with pytest.raises(ValidationError):
        OcrEvaluationResult(engine_id="tesseract", sample_count=-1)


def test_result_bool_rejected_for_numeric_fields():
    with pytest.raises(ValidationError):
        OcrEvaluationResult(engine_id="tesseract", duration_ms=True)
    with pytest.raises(ValidationError):
        OcrEvaluationResult(engine_id="tesseract", sample_count=True)


# ---------------------------------------------------------------------------
# Backward Compatibility
# ---------------------------------------------------------------------------


def test_existing_ocr_eval_target_fields_not_removed_or_renamed():
    target = OcrEvalTarget(engine="tesseract", model="latest")
    assert target.engine == "tesseract"
    assert target.model == "latest"


def test_existing_ocr_evaluate_request_import_and_fields_unchanged():
    """既存Schema import・既存Field名がそのまま利用できることを確認する。"""
    req = OcrEvaluateRequest(
        image_dir="d",
        gt_csv="g",
        targets=[OcrEvalTarget(engine="tesseract", model="eng"), OcrEvalTarget(engine="tesseract", model="latest")],
        charset="",
        psm=6,
        eval_preprocess={"grayscale": True},
        preprocess_source="step5",
        preprocess_mode="manual",
    )
    assert req.charset == ""
    assert req.psm == 6
    assert req.eval_preprocess == {"grayscale": True}
    assert req.preprocess_source == "step5"
    assert req.preprocess_mode == "manual"


def test_existing_api_payload_shape_from_frontend_still_parses():
    """frontend/src/App.jsx::runOcrEvaluation が実際に送信するpayload形状を再現する。"""
    payload = {
        "project_id": "proj1",
        "image_dir": "/data/eval_images",
        "gt_csv": "/data/eval_gt.csv",
        "targets": [{"engine": "tesseract", "model": "eng"}, {"engine": "tesseract", "model": "my_model.tess.json"}],
        "charset": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-",
        "psm": 7,
        "preprocess_mode": "none",
    }
    req = OcrEvaluateRequest(**payload)
    assert req.targets[1].model == "my_model.tess.json"
    # main.py::api_ocr_evaluate と同じ変換を行っても既存キー以外は無害に無視される
    dumped_targets = [t.model_dump() for t in req.targets]
    assert dumped_targets[0]["engine"] == "tesseract"
    assert "options" in dumped_targets[0]
