"""Tesseract Confidence の抽出・集約・伝播のテスト。

背景: Tesseract 5.x の LSTM は tessedit_char_whitelist 指定時に信頼度を計算せず
conf=0.000000 を返す（実測: v5.3.3。whitelist無しでは 60.9 等の実値が返る）。
この「偽の0」を本当の0%と区別し、取得不能=None として扱う。
"""

from types import SimpleNamespace

from src.app.services.tesseract_pipeline import (
    aggregate_word_confidences,
    parse_tsv_words,
    recognize_line,
)
import src.app.predict as predict_module

TSV_HEADER = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"


def _tsv(*rows):
    return "\n".join([TSV_HEADER, *rows]) + "\n"


def _word_row(conf, text, level=5):
    return f"{level}\t1\t1\t1\t1\t1\t0\t0\t10\t10\t{conf}\t{text}"


# ---- TSV解析 ----


def test_parse_skips_header_and_structural_rows():
    stdout = _tsv(
        "1\t1\t0\t0\t0\t0\t0\t0\t320\t48\t-1\t",
        "4\t1\t1\t1\t1\t0\t36\t0\t247\t48\t-1\t",
        _word_row("84.217529", "L37kt"),
    )
    words = parse_tsv_words(stdout)
    assert words == [("L37kt", 84.217529)]


def test_parse_excludes_empty_text_rows():
    stdout = _tsv(_word_row("90.0", "   "), _word_row("84.2", "L37kt"))
    assert parse_tsv_words(stdout) == [("L37kt", 84.2)]


def test_parse_keeps_decimal_confidence():
    words = parse_tsv_words(_tsv(_word_row("60.909737", "ABC")))
    assert words[0][1] == 60.909737


def test_parse_non_numeric_conf_becomes_minus_one():
    words = parse_tsv_words(_tsv(_word_row("abc", "XYZ")))
    assert words == [("XYZ", -1.0)]


# ---- 集約（0〜100 → 0.0〜1.0） ----


def test_aggregate_single_word():
    assert abs(aggregate_word_confidences([("L37kt", 84.2)]) - 0.842) < 1e-9


def test_aggregate_multiple_words_weighted_by_char_count():
    # 文字数加重平均: (80*4 + 60*2) / 6 = 73.333...
    value = aggregate_word_confidences([("ABCD", 80.0), ("EF", 60.0)])
    assert abs(value - (80.0 * 4 + 60.0 * 2) / 6 / 100.0) < 1e-9


def test_aggregate_excludes_negative_conf_words():
    value = aggregate_word_confidences([("NOISE", -1.0), ("L37kt", 84.2)])
    assert abs(value - 0.842) < 1e-9


def test_aggregate_returns_none_when_no_valid_words():
    assert aggregate_word_confidences([]) is None
    assert aggregate_word_confidences([("ABC", -1.0)]) is None
    assert aggregate_word_confidences([("  ", 90.0)]) is None


def test_aggregate_zero_without_whitelist_is_real_zero():
    # whitelist未使用時の conf=0 は実測値として保持する（UIでは 0.0% 表示）
    assert aggregate_word_confidences([("ABC", 0.0)], whitelist_applied=False) == 0.0


def test_aggregate_all_zero_with_whitelist_is_unavailable():
    # whitelist指定時の全conf=0 はTesseract既知挙動（信頼度未計算）→ None
    assert aggregate_word_confidences([("L37kt", 0.0)], whitelist_applied=True) is None
    assert aggregate_word_confidences([("AB", 0.0), ("kt", 0.0)], whitelist_applied=True) is None


def test_aggregate_with_whitelist_keeps_positive_values():
    # whitelist指定でも実値が返る場合（将来のTesseract修正時）はそのまま集約する
    value = aggregate_word_confidences([("L37kt", 84.2)], whitelist_applied=True)
    assert abs(value - 0.842) < 1e-9


# ---- recognize_line（subprocessをモック） ----


def _mock_run(stdout):
    def fake_run(cmd, check, capture_output, text):  # noqa: ARG001
        return SimpleNamespace(returncode=0, stdout=stdout, stderr="")

    return fake_run


def test_recognize_line_with_whitelist_returns_none_confidence(monkeypatch):
    stdout = _tsv(
        "1\t1\t0\t0\t0\t0\t0\t0\t320\t48\t-1\t",
        _word_row("0.000000", "L37kt"),
    )
    monkeypatch.setattr("src.app.services.tesseract_pipeline.subprocess.run", _mock_run(stdout))
    text, conf = recognize_line("tesseract", "img.png", "tessdata", "eng", charset="ABC0123", psm=7)
    assert text == "L37kt"
    assert conf is None


def test_recognize_line_without_whitelist_returns_real_confidence(monkeypatch):
    stdout = _tsv(_word_row("60.909737", "LBOJRBPSDK"), _word_row("76.011024", "1."))
    monkeypatch.setattr("src.app.services.tesseract_pipeline.subprocess.run", _mock_run(stdout))
    text, conf = recognize_line("tesseract", "img.png", "tessdata", "eng", charset="", psm=7)
    assert text == "LBOJRBPSDK1."
    # 文字数加重平均: (60.909737*10 + 76.011024*2) / 12 / 100
    expected = (60.909737 * 10 + 76.011024 * 2) / 12 / 100.0
    assert abs(conf - expected) < 1e-9


def test_recognize_line_no_words_returns_none(monkeypatch):
    stdout = _tsv("1\t1\t0\t0\t0\t0\t0\t0\t320\t48\t-1\t")
    monkeypatch.setattr("src.app.services.tesseract_pipeline.subprocess.run", _mock_run(stdout))
    text, conf = recognize_line("tesseract", "img.png", "tessdata", "eng", charset="", psm=7)
    assert text == ""
    assert conf is None


# ---- predict経路への伝播（Tesseract本体は不要。依存をモック） ----


def _patch_tesseract_predict(monkeypatch, recognize_result):
    monkeypatch.setattr(predict_module, "ensure_tesseract_inference_tool", lambda: "tesseract")
    monkeypatch.setattr(
        predict_module, "resolve_base_traineddata", lambda lang, tesseract_cmd: ("tessdata", "eng.traineddata")
    )
    monkeypatch.setattr(predict_module, "recognize_line", lambda *args, **kwargs: recognize_result)


def test_predict_propagates_none_confidence(monkeypatch):
    _patch_tesseract_predict(monkeypatch, ("L37KT12X", None))
    result = predict_module._predict_with_tesseract("img.png", model="eng", apply_preprocess=False)
    assert result["prediction"] == "L37KT12X"
    assert result["confidence"] is None  # 0.0へ偽装しない
    assert result["char_scores"] == []


def test_predict_propagates_real_confidence(monkeypatch):
    _patch_tesseract_predict(monkeypatch, ("L37KT12X", 0.842))
    result = predict_module._predict_with_tesseract("img.png", model="eng", apply_preprocess=False)
    assert abs(result["confidence"] - 0.842) < 1e-9
    assert len(result["char_scores"]) == len("L37KT12X")
