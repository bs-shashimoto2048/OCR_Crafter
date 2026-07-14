"""EasyOCR/PaddleOCRの「小文字を出力に含める」制御のテスト。"""

from src.app.schemas import PreprocessPreviewRequest
from src.app.services.ocr_pipeline import OCR_CHARSET_DEFAULT, validate_ocr_result
from src.app.services.latin_case import (
    BASE_UPPERCASE_ALLOWLIST,
    build_latin_allowlist,
    is_latin_case_langs,
    normalize_latin_case,
)
from src.app.predict import _apply_latin_case_to_results, _resolve_latin_case_control


# ---- 共通: 正規化（小文字OFF=大文字へ統一。削除しない） ----


def test_normalize_keeps_text_when_lowercase_on():
    assert normalize_latin_case("CHYBkt", include_lowercase=True) == "CHYBkt"


def test_normalize_uppercases_when_lowercase_off():
    assert normalize_latin_case("CHYBkt", include_lowercase=False) == "CHYBKT"


def test_normalize_keeps_digits():
    assert normalize_latin_case("123kt", include_lowercase=False) == "123KT"


def test_normalize_keeps_symbols():
    assert normalize_latin_case("AB-kt", include_lowercase=False) == "AB-KT"


def test_normalize_preserves_length():
    text = "aB3-z9"
    assert len(normalize_latin_case(text, include_lowercase=False)) == len(text)


# ---- 許可文字の組み立て ----


def test_allowlist_none_when_on_without_base():
    # ONで許可文字指定なし → 制限しない（既存動作を変えない）
    assert build_latin_allowlist(include_lowercase=True) is None


def test_allowlist_uppercase_digits_when_off_without_base():
    allowlist = build_latin_allowlist(include_lowercase=False)
    assert allowlist == BASE_UPPERCASE_ALLOWLIST
    assert not any(ch.islower() for ch in allowlist)
    assert all(ch in allowlist for ch in "ABCXYZ0189")


def test_allowlist_off_removes_only_lowercase_from_base():
    # 既存許可文字（記号含む）から小文字だけを除外し、記号・大文字・数字は維持する
    allowlist = build_latin_allowlist(include_lowercase=False, base_allowlist="ABC-abc012")
    assert allowlist == "ABC-012"


def test_allowlist_on_adds_missing_lowercase_to_base():
    allowlist = build_latin_allowlist(include_lowercase=True, base_allowlist="ABC-012")
    assert allowlist.startswith("ABC-012")
    assert all(ch in allowlist for ch in "abcdefghijklmnopqrstuvwxyz")


# ---- 対象言語判定 ----


def test_latin_langs_english():
    assert is_latin_case_langs(["en"]) is True


def test_latin_langs_multiple_latin():
    assert is_latin_case_langs(["en", "fr", "de"]) is True


def test_latin_langs_paddle_codes():
    assert is_latin_case_langs(["latin"]) is True
    assert is_latin_case_langs(["german"]) is True


def test_non_latin_langs_excluded():
    for lang in ("ja", "ko", "ch_sim", "ch_tra", "ru", "japan", "korean", "ch"):
        assert is_latin_case_langs([lang]) is False, lang


def test_mixed_latin_and_non_latin_excluded():
    # 日本語が混ざる設定へ英数字allowlistを適用してはならない
    assert is_latin_case_langs(["en", "ja"]) is False


def test_empty_langs_excluded():
    assert is_latin_case_langs([]) is False
    assert is_latin_case_langs(None) is False


# ---- EasyOCR: allowlist決定 ----


def test_easyocr_allowlist_off_english():
    applied, allowlist = _resolve_latin_case_control(["en"], include_lowercase=False)
    assert applied is True
    assert allowlist == BASE_UPPERCASE_ALLOWLIST


def test_easyocr_allowlist_on_english_is_unrestricted():
    applied, allowlist = _resolve_latin_case_control(["en"], include_lowercase=True)
    assert applied is True
    assert allowlist is None


def test_easyocr_allowlist_not_applied_for_japanese():
    applied, allowlist = _resolve_latin_case_control(["ja"], include_lowercase=False)
    assert applied is False
    assert allowlist is None


def test_easyocr_allowlist_not_applied_for_mixed_langs():
    applied, allowlist = _resolve_latin_case_control(["en", "ja"], include_lowercase=False)
    assert applied is False
    assert allowlist is None


# ---- PaddleOCR: 出力後正規化 ----


def test_paddle_output_uppercased_when_off():
    prediction, results = _apply_latin_case_to_results(
        "CHYBkt",
        [{"text": "CHYBkt", "confidence": 0.9}, {"text": "ab-12", "confidence": 0.5}],
        ["en"],
        include_lowercase=False,
    )
    assert prediction == "CHYBKT"
    assert results[0]["text"] == "CHYBKT"
    assert results[1]["text"] == "AB-12"
    # Confidenceは変更しない
    assert results[0]["confidence"] == 0.9
    assert results[1]["confidence"] == 0.5


def test_paddle_output_kept_when_on():
    prediction, results = _apply_latin_case_to_results(
        "CHYBkt", [{"text": "CHYBkt", "confidence": 0.9}], ["en"], include_lowercase=True
    )
    assert prediction == "CHYBkt"
    assert results[0]["text"] == "CHYBkt"


def test_paddle_output_not_normalized_for_japanese():
    # 日本語等では不要な大文字化をしない
    prediction, results = _apply_latin_case_to_results(
        "あいうkt", [{"text": "あいうkt", "confidence": 0.9}], ["japan"], include_lowercase=False
    )
    assert prediction == "あいうkt"
    assert results[0]["text"] == "あいうkt"


# ---- 検証層: 小文字ON時は大小文字を保持する ----


def test_validation_keeps_case_with_keep_mode():
    charset = build_latin_allowlist(include_lowercase=True, base_allowlist=OCR_CHARSET_DEFAULT)
    result = validate_ocr_result("CHYBkt12", max_text_length=8, charset=charset, text_case="keep")
    assert result["text"] == "CHYBkt12"
    assert result["valid"] is True


def test_validation_default_still_uppercases():
    # 既定（text_case未指定）は従来どおり大文字化（後方互換）
    result = validate_ocr_result("CHYBkt12", max_text_length=8)
    assert result["text"] == "CHYBKT12"


# ---- API: 後方互換（未指定はtrue） ----


def test_api_default_include_lowercase_true():
    req = PreprocessPreviewRequest(image="01.png")
    assert req.include_lowercase is True


def test_api_accepts_explicit_values():
    assert PreprocessPreviewRequest(image="01.png", include_lowercase=False).include_lowercase is False
    assert PreprocessPreviewRequest(image="01.png", include_lowercase=True).include_lowercase is True
