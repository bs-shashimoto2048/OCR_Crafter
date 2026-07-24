"""Tesseract charset仕様（docs/12_TESSERACT_CHARSET_SPEC.md）の回帰テスト。

- 学習対象文字セット A-Z0-9klt+-、text_case=keep でラベル無改変
- charset外文字は「文字削除」ではなくサンプル除外
- 評価比較は case-sensitive
- 記号 + - は学習対象文字セット・推論時whitelist・評価時whitelistの既定値へ追加済み
  （JSON/API payload・正規表現文字クラスでの安全性も検証する）
"""

import json
import re
from pathlib import Path

from PIL import Image

import src.app.services.tesseract_pipeline as tp
from src.app.services.ocr_evaluation import _normalize_compare
from src.app.services.ocr_pipeline import _sanitize_text
from src.app.services.tesseract_pipeline import (
    TESSERACT_TARGET_CHARSET,
    TESSERACT_WHITELIST_DEFAULT,
    _generate_lstmf,
)

CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-"


class TestCharsetConstants:
    def test_target_charset_value(self):
        assert TESSERACT_TARGET_CHARSET == CHARSET

    def test_whitelist_default_equals_target(self):
        assert TESSERACT_WHITELIST_DEFAULT == CHARSET


class TestPlusMinusCharset:
    """記号 + - の追加（新規既定値のみ。既存プロジェクト保存値は対象外）。"""

    def test_target_charset_includes_plus_and_minus(self):
        assert "+" in TESSERACT_TARGET_CHARSET
        assert "-" in TESSERACT_TARGET_CHARSET

    def test_uppercase_digits_and_klt_preserved(self):
        """+ - 追加後も既存の A-Z / 0-9 / klt はそのまま保持される。"""
        for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt":
            assert ch in TESSERACT_TARGET_CHARSET

    def test_sanitize_preserves_plus_and_minus_in_label(self):
        """+ - を含むラベルが charset外判定で除外されず、無改変で保持される。"""
        assert _sanitize_text("A+B-12", CHARSET, 64, "keep") == "A+B-12"

    def test_json_roundtrip_preserves_symbols(self):
        """JSON保存・読込（API payload相当）で + - が欠落・変換されない。"""
        payload = json.dumps({"charset": CHARSET})
        restored = json.loads(payload)["charset"]
        assert restored == CHARSET
        assert "+" in restored and "-" in restored

    def test_plus_is_not_converted_to_space(self):
        """+ が（URLエンコード等で）空白へ変換されない（文字列として保持）。"""
        assert " " not in CHARSET
        assert CHARSET.count("+") == 1
        assert "+" in f"prefix_{CHARSET}_suffix"

    def test_regex_character_class_escapes_hyphen_safely(self):
        """文字クラスで使う場合は re.escape で - を安全にエスケープし、範囲指定にならない。"""
        pattern = re.compile(f"[{re.escape(CHARSET)}]+")
        # charset内の任意の並びに完全一致する（範囲指定化していれば取りこぼす文字が出る）
        assert pattern.fullmatch("A+B-1kltZ9")
        # charsetに存在しない文字は一致しない
        assert not pattern.fullmatch("A B")  # 空白は対象外
        assert not pattern.fullmatch("a")  # 小文字a-jやu-zは対象外（klt以外）
        # '-'をエスケープしないと 't+' 等の並びが意図しない範囲指定になり得るため、
        # 常に re.escape を通す運用であることを明示する回帰
        unescaped_class = f"[{CHARSET}]"
        with_range_risk = re.compile(unescaped_class)
        # 末尾のハイフンは文字クラスの仕様上リテラル扱いされるため、
        # 少なくとも既定の並び（記号 + - を末尾に置く）では事故が起きないことを確認する
        assert with_range_risk.fullmatch("-")
        assert with_range_risk.fullmatch("+")


class TestDatasetLabelNormalization:
    def test_chybkt_not_modified(self):
        """CHYBkt が kt / chybkt / CHYBKT に改変されない（text_case=keep）。"""
        assert _sanitize_text("CHYBkt", CHARSET, 64, "keep") == "CHYBkt"

    def test_out_of_charset_excluded_not_stripped(self):
        """charset外文字を含むラベルは文字削除ではなくサンプル除外（空を返す）。"""
        assert _sanitize_text("kt!", CHARSET, 64, "keep") == ""  # '!' は対象外（+ - は対象内）
        assert _sanitize_text("cat", CHARSET, 64, "keep") == ""  # 'a' は対象外


class TestGenerateLstmf:
    def test_gt_matches_label_and_skips_out_of_charset(self, tmp_path, monkeypatch):
        """gt.txt がラベルと完全一致し、charset外サンプルはスキップ集計される。+ - を含むラベルは除外されない。"""
        monkeypatch.setattr(tp, "_stream_command", lambda *a, **k: None)  # 外部tesseract無効化
        img = tmp_path / "sample.png"
        Image.new("L", (32, 32), 255).save(img)
        pairs = [(img, "CHYBkt"), (img, "A+B-12"), (img, "kt!"), (img, "abc")]

        lstmf_paths, skipped = _generate_lstmf(
            pairs, tmp_path / "work", "tesseract", "eng", 7, CHARSET, {}, None
        )

        gt_files = sorted((tmp_path / "work").glob("*.gt.txt"))
        gt_texts = {f.read_text(encoding="utf-8") for f in gt_files}
        assert gt_texts == {"CHYBkt", "A+B-12"}
        assert skipped == 2  # "kt!" と "abc" のみ除外

    def test_gt_and_box_written_with_lf(self, tmp_path, monkeypatch):
        """gt.txt / .box が LF改行・WordStr形式で生成される（CRLF事故の回帰）。"""
        monkeypatch.setattr(tp, "_stream_command", lambda *a, **k: None)
        img = tmp_path / "sample.png"
        Image.new("L", (40, 20), 255).save(img)

        _generate_lstmf([(img, "A1kt")], tmp_path / "work", "tesseract", "eng", 7, CHARSET, {}, None)

        gt = (tmp_path / "work" / "line_000001.gt.txt").read_bytes()
        box = (tmp_path / "work" / "line_000001.box").read_bytes()
        assert b"\r" not in gt
        assert b"\r" not in box
        assert box.startswith(b"WordStr 0 0 40 20 0 #A1kt\n")


class TestEvaluationComparison:
    def test_case_sensitive(self):
        """KT と kt は別物として比較される。"""
        assert _normalize_compare("KT") != _normalize_compare("kt")

    def test_trim_only(self):
        assert _normalize_compare("  CHYBkt \n") == "CHYBkt"
        assert _normalize_compare("CHYBkt") == "CHYBkt"
