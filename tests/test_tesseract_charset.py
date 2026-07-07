"""Tesseract charset仕様（docs/12_TESSERACT_CHARSET_SPEC.md）の回帰テスト。

- 学習対象文字セット A-Z0-9klt、text_case=keep でラベル無改変
- charset外文字は「文字削除」ではなくサンプル除外
- 評価比較は case-sensitive
"""

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

CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt"


class TestCharsetConstants:
    def test_target_charset_value(self):
        assert TESSERACT_TARGET_CHARSET == CHARSET

    def test_whitelist_default_equals_target(self):
        assert TESSERACT_WHITELIST_DEFAULT == CHARSET


class TestDatasetLabelNormalization:
    def test_chybkt_not_modified(self):
        """CHYBkt が kt / chybkt / CHYBKT に改変されない（text_case=keep）。"""
        assert _sanitize_text("CHYBkt", CHARSET, 64, "keep") == "CHYBkt"

    def test_out_of_charset_excluded_not_stripped(self):
        """charset外文字を含むラベルは文字削除ではなくサンプル除外（空を返す）。"""
        assert _sanitize_text("kt-", CHARSET, 64, "keep") == ""
        assert _sanitize_text("cat", CHARSET, 64, "keep") == ""  # 'a' は対象外


class TestGenerateLstmf:
    def test_gt_matches_label_and_skips_out_of_charset(self, tmp_path, monkeypatch):
        """gt.txt がラベルと完全一致し、charset外サンプルはスキップ集計される。"""
        monkeypatch.setattr(tp, "_stream_command", lambda *a, **k: None)  # 外部tesseract無効化
        img = tmp_path / "sample.png"
        Image.new("L", (32, 32), 255).save(img)
        pairs = [(img, "CHYBkt"), (img, "kt-"), (img, "abc")]

        lstmf_paths, skipped = _generate_lstmf(
            pairs, tmp_path / "work", "tesseract", "eng", 7, CHARSET, {}, None
        )

        gt_files = sorted((tmp_path / "work").glob("*.gt.txt"))
        assert len(gt_files) == 1
        assert gt_files[0].read_text(encoding="utf-8") == "CHYBkt"
        assert skipped == 2

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
