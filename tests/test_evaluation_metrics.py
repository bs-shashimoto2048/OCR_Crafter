"""Common Evaluation Metric Calculator（Issue #65、`src/app/services/evaluation_metrics.py`）のテスト。

Engine非依存のexact_match/edit_distance/CER/confusion集計を検証する。既存
`ocr_evaluation.py`のTesseract評価結果・`tests/test_cer_metrics.py`のFixture値との
互換性（Compatibilityセクション）も直接比較する。
"""

import pytest
from pydantic import ValidationError

import src.app.services.ocr_evaluation as legacy_eval_mod
from src.app.schemas import OcrEvaluationSampleResult
from src.app.services.evaluation_metrics import (
    aggregate_confusions,
    calculate_evaluation_metrics,
    calculate_sample_metrics,
    levenshtein_ops,
    normalize_compare,
)


# ---------------------------------------------------------------------------
# Exact Match
# ---------------------------------------------------------------------------


def test_exact_match_true_when_identical():
    s = calculate_sample_metrics(image="a.png", ground_truth="ABC", prediction="ABC")
    assert s.exact_match is True


def test_exact_match_false_when_different():
    s = calculate_sample_metrics(image="a.png", ground_truth="ABC", prediction="ABD")
    assert s.exact_match is False


def test_exact_match_false_when_both_empty():
    """空文字列predictionは常に不一致（空正解との偶然一致を防ぐ、既存仕様）。"""
    s = calculate_sample_metrics(image="a.png", ground_truth="", prediction="")
    assert s.exact_match is False


def test_exact_match_false_when_prediction_empty_ground_truth_not():
    s = calculate_sample_metrics(image="a.png", ground_truth="ABC", prediction="")
    assert s.exact_match is False


# ---------------------------------------------------------------------------
# Edit Distance
# ---------------------------------------------------------------------------


def test_edit_distance_substitution():
    dist, ops = levenshtein_ops("CBCOM", "CBC0M")
    assert dist == 1
    assert ops == [("sub", "O", "0")]


def test_edit_distance_insertion():
    dist, ops = levenshtein_ops("AC", "ABC")
    assert dist == 1
    assert ops == [("ins", "", "B")]


def test_edit_distance_deletion():
    dist, ops = levenshtein_ops("ABC", "AC")
    assert dist == 1
    assert ops == [("del", "B", "")]


def test_edit_distance_multiple_edits():
    dist, ops = levenshtein_ops("", "AB")
    assert dist == 2
    assert all(op[0] == "ins" for op in ops)


def test_edit_distance_unicode():
    dist, ops = levenshtein_ops("é", "e")
    assert dist == 1


def test_edit_distance_case_sensitive():
    dist, ops = levenshtein_ops("kt", "KT")
    assert dist == 2
    assert all(op[0] == "sub" for op in ops)


def test_edit_distance_whitespace_counts_as_character():
    dist, _ops = levenshtein_ops("AB", "A B")
    assert dist == 1


def test_edit_distance_newline_counts_as_character():
    dist, _ops = levenshtein_ops("AB", "A\nB")
    assert dist == 1


def test_edit_distance_identical_is_zero():
    assert levenshtein_ops("SAME", "SAME") == (0, [])


# ---------------------------------------------------------------------------
# CER
# ---------------------------------------------------------------------------


def test_cer_exact_match_is_zero():
    s = calculate_sample_metrics(image="a.png", ground_truth="ABC", prediction="ABC")
    assert s.cer == 0.0


def test_cer_one_char_error():
    s = calculate_sample_metrics(image="a.png", ground_truth="CBCOM", prediction="CBC0M")
    assert s.cer == round(1 / 5, 4)


def test_cer_insertion():
    s = calculate_sample_metrics(image="a.png", ground_truth="AC", prediction="ABC")
    assert s.cer == round(1 / 2, 4)


def test_cer_deletion():
    s = calculate_sample_metrics(image="a.png", ground_truth="ABC", prediction="AC")
    assert s.cer == round(1 / 3, 4)


def test_cer_greater_than_one():
    s = calculate_sample_metrics(image="a.png", ground_truth="A", prediction="XYZ")
    assert s.cer == 3.0


def test_cer_empty_ground_truth_is_none():
    """分母0（正解文字列が空）はNone。predが空でも非空でも同様（分母0の扱いを勝手に決めない）。"""
    s_empty_pred = calculate_sample_metrics(image="a.png", ground_truth="", prediction="")
    assert s_empty_pred.cer is None
    s_nonempty_pred = calculate_sample_metrics(image="b.png", ground_truth="", prediction="X")
    assert s_nonempty_pred.cer is None


def test_cer_empty_prediction_with_nonempty_ground_truth():
    s = calculate_sample_metrics(image="a.png", ground_truth="ABC", prediction="")
    assert s.edit_distance == 3
    assert s.cer == 1.0


def test_cer_does_not_apply_extra_normalization():
    """strip()/lower()/Unicode正規化(NFKC)/whitespace collapseを勝手に追加しない。"""
    s_case = calculate_sample_metrics(image="a.png", ground_truth="ABC", prediction="abc")
    assert s_case.exact_match is False
    assert s_case.cer > 0
    s_width = calculate_sample_metrics(image="b.png", ground_truth="0", prediction="０")  # 全角０
    assert s_width.exact_match is False
    assert s_width.cer == 1.0


# ---------------------------------------------------------------------------
# Aggregate
# ---------------------------------------------------------------------------


def test_aggregate_sample_count():
    samples = [calculate_sample_metrics(image=f"{i}.png", ground_truth="A", prediction="A") for i in range(3)]
    m = calculate_evaluation_metrics(samples)
    assert m.sample_count == 3


def test_aggregate_exact_match_count_and_rate():
    samples = [
        calculate_sample_metrics(image="1.png", ground_truth="A", prediction="A"),
        calculate_sample_metrics(image="2.png", ground_truth="B", prediction="X"),
    ]
    m = calculate_evaluation_metrics(samples)
    assert m.exact_match_count == 1
    assert m.exact_match_rate == 0.5


def test_aggregate_cer_is_micro_average_not_mean_of_sample_cer():
    """マイクロ平均（全edit distance合計/全正解文字数合計）であり、サンプルCER単純平均とは異なる。"""
    gts = ["CBCOM", "AB", "XY"]
    preds = ["CBC0M", "AB", "XYZ"]
    samples = [calculate_sample_metrics(image=f"{i}.png", ground_truth=g, prediction=p) for i, (g, p) in enumerate(zip(gts, preds))]
    m = calculate_evaluation_metrics(samples)
    assert m.cer == round(2 / 9, 4)  # マイクロ平均 (1+0+1)/(5+2+2)
    simple_mean = sum(s.cer for s in samples) / len(samples)
    assert m.cer != round(simple_mean, 4)


def test_aggregate_character_accuracy():
    samples = [calculate_sample_metrics(image="1.png", ground_truth="ABCOM", prediction="ABC0M")]
    m = calculate_evaluation_metrics(samples)
    assert m.character_accuracy == round(1.0 - m.cer, 4)


def test_aggregate_character_accuracy_negative_when_cer_over_one():
    samples = [calculate_sample_metrics(image="1.png", ground_truth="A", prediction="XYZ")]
    m = calculate_evaluation_metrics(samples)
    assert m.cer == 3.0
    assert m.character_accuracy == -2.0


def test_aggregate_empty_dataset():
    m = calculate_evaluation_metrics([])
    assert m.sample_count == 0
    assert m.exact_match_count == 0
    assert m.exact_match_rate == 0.0
    assert m.cer is None
    assert m.character_accuracy is None


def test_aggregate_excludes_none_edit_distance_from_cer_but_counts_sample():
    normal = calculate_sample_metrics(image="1.png", ground_truth="ABC", prediction="ABC")
    error_sample = OcrEvaluationSampleResult(image="2.png", ground_truth="XYZ", prediction=None, error="inference failed")
    m = calculate_evaluation_metrics([normal, error_sample])
    assert m.sample_count == 2
    assert m.cer == 0.0  # error_sampleのground_truth長は分母へ含まれない


# ---------------------------------------------------------------------------
# Confusion
# ---------------------------------------------------------------------------


def test_confusion_substitution():
    result = aggregate_confusions([("CBCOM", "CBC0M")])
    assert len(result) == 1
    assert result[0].kind == "sub"
    assert result[0].expected == "O"
    assert result[0].predicted == "0"
    assert result[0].count == 1


def test_confusion_insertion_empty_expected():
    result = aggregate_confusions([("AC", "ABC")])
    assert result[0].kind == "ins"
    assert result[0].expected == ""
    assert result[0].predicted == "B"


def test_confusion_deletion_empty_predicted():
    result = aggregate_confusions([("ABC", "AC")])
    assert result[0].kind == "del"
    assert result[0].expected == "B"
    assert result[0].predicted == ""


def test_confusion_aggregates_same_confusion_across_pairs():
    result = aggregate_confusions([("CBCOM", "CBC0M"), ("FOO", "F0O")])
    assert len(result) == 1
    assert result[0].kind == "sub"
    assert result[0].expected == "O"
    assert result[0].predicted == "0"
    assert result[0].count == 2


def test_confusion_multiple_kinds_sorted_by_count_desc():
    result = aggregate_confusions([("CBCOM", "CBC0M"), ("FOO", "F0O"), ("AC", "ABC")])
    counts = [c.count for c in result]
    assert counts == sorted(counts, reverse=True)
    assert result[0].count == 2  # sub(O->0) appears twice
    assert result[0].kind == "sub"


def test_confusion_deterministic_sort_order_for_ties():
    """同countのconfusionは決定的sort（kind→expected→predicted）で並ぶ。"""
    result = aggregate_confusions([("A", "B"), ("X", "Y")])
    assert len(result) == 2
    assert all(c.count == 1 for c in result)
    keys = [(c.kind, c.expected, c.predicted) for c in result]
    assert keys == sorted(keys)


def test_confusion_expected_predicted_mapping_matches_legacy_from_to():
    """legacy 'from'→'expected'、'to'→'predicted' の変換方針を確認する。"""
    _dist, legacy_ops = levenshtein_ops("CBCOM", "CBC0M")
    kind, frm, to = legacy_ops[0]
    result = aggregate_confusions([("CBCOM", "CBC0M")])
    assert result[0].kind == kind
    assert result[0].expected == frm
    assert result[0].predicted == to


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_calculate_sample_metrics_rejects_non_string_ground_truth():
    with pytest.raises(TypeError):
        calculate_sample_metrics(image="a.png", ground_truth=123, prediction="A")


def test_calculate_sample_metrics_rejects_non_string_prediction():
    with pytest.raises(TypeError):
        calculate_sample_metrics(image="a.png", ground_truth="A", prediction=None)


def test_calculate_evaluation_metrics_rejects_invalid_sample_list():
    with pytest.raises(TypeError):
        calculate_evaluation_metrics("not-a-list")
    with pytest.raises(TypeError):
        calculate_evaluation_metrics([{"not": "a sample result"}])


def test_aggregate_confusions_rejects_non_string_pair():
    with pytest.raises(TypeError):
        aggregate_confusions([(123, "A")])


def test_sample_metrics_mutable_default_isolation():
    s1 = calculate_sample_metrics(image="a.png", ground_truth="A", prediction="A")
    s2 = calculate_sample_metrics(image="b.png", ground_truth="B", prediction="B")
    assert s1.image != s2.image
    assert s1 is not s2


def test_no_non_finite_values_are_ever_generated():
    """distance/ref_lenが共に非負の有限整数のため、cerは常に有限（NaN/Infinityを生成しない）。"""
    import math

    samples = [
        calculate_sample_metrics(image="a.png", ground_truth="A", prediction="XYZ"),
        calculate_sample_metrics(image="b.png", ground_truth="", prediction=""),
    ]
    for s in samples:
        if s.cer is not None:
            assert math.isfinite(s.cer)
    m = calculate_evaluation_metrics(samples)
    if m.cer is not None:
        assert math.isfinite(m.cer)
    if m.character_accuracy is not None:
        assert math.isfinite(m.character_accuracy)


# ---------------------------------------------------------------------------
# Compatibility（既存test_cer_metrics.py・既存Tesseract評価Fixtureとの一致）
# ---------------------------------------------------------------------------


def test_compatibility_normalize_compare_matches_legacy():
    for text in ["CBCOM", "  CBCOM  ", "abc", "ABC", "0", "０", "0", "O", "1", "I", "é", "é", ""]:
        assert normalize_compare(text) == legacy_eval_mod._normalize_compare(text)


def test_compatibility_levenshtein_ops_matches_legacy():
    pairs = [("CBCOM", "CBC0M"), ("ABC", "AC"), ("AC", "ABC"), ("", "AB"), ("kt", "KT"), ("SAME", "SAME")]
    for a, b in pairs:
        assert levenshtein_ops(a, b) == legacy_eval_mod.levenshtein_ops(a, b)


def test_compatibility_cer_micro_average_matches_test_cer_metrics_fixture():
    """tests/test_cer_metrics.py::cer_env と同じFixture値で、baseのCERが既存テストの期待値(2/9)と一致する。"""
    gts = ["CBCOM", "AB", "XY"]
    base_preds = ["CBC0M", "AB", "XYZ"]
    trained_preds = ["CBCOM", "AB", "X"]

    base_samples = [calculate_sample_metrics(image=f"{i}.png", ground_truth=g, prediction=p) for i, (g, p) in enumerate(zip(gts, base_preds))]
    trained_samples = [
        calculate_sample_metrics(image=f"{i}.png", ground_truth=g, prediction=p) for i, (g, p) in enumerate(zip(gts, trained_preds))
    ]

    base_metrics = calculate_evaluation_metrics(base_samples)
    trained_metrics = calculate_evaluation_metrics(trained_samples)

    assert base_metrics.cer == round(2 / 9, 4)
    assert trained_metrics.cer == round(1 / 9, 4)
    assert base_metrics.character_accuracy == round(1 - 2 / 9, 4)


def test_compatibility_confusions_match_test_cer_metrics_fixture():
    """cer_env Fixtureの既知confusion（base: sub(O->0)・ins(""->Z)、trained: del(Y->"")）と一致する。"""
    gts = ["CBCOM", "AB", "XY"]
    base_preds = ["CBC0M", "AB", "XYZ"]
    trained_preds = ["CBCOM", "AB", "X"]

    base_confusions = {(c.kind, c.expected, c.predicted): c.count for c in aggregate_confusions(list(zip(gts, base_preds)))}
    trained_confusions = {(c.kind, c.expected, c.predicted): c.count for c in aggregate_confusions(list(zip(gts, trained_preds)))}

    assert base_confusions[("sub", "O", "0")] == 1
    assert base_confusions[("ins", "", "Z")] == 1
    assert trained_confusions[("del", "Y", "")] == 1


def test_compatibility_legacy_confusion_dict_structure_reproducible():
    """旧confusion構造（kind/from/to/count dict）へ戻した場合も同値であることを確認する。"""
    result = aggregate_confusions([("CBCOM", "CBC0M")])
    legacy_style = [{"kind": c.kind, "from": c.expected, "to": c.predicted, "count": c.count} for c in result]
    assert legacy_style == [{"kind": "sub", "from": "O", "to": "0", "count": 1}]
