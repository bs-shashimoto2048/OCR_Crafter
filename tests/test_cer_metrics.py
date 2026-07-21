"""CER主指標（マイクロ平均）・編集距離・混同集計・改善/悪化判定のテスト。

- CER = 全画像の編集距離総和 ÷ 全画像の正解文字数総和（画像ごとのCER平均は使わない）
- 混同はLevenshteinアラインメント（置換/脱落/挿入）から集計
- 改善/同等/悪化は画像単位の編集距離比較、完全一致の増減はmatchの遷移
- 既存フィールド（accuracy等）は後方互換
"""

import numpy as np
import pytest
from PIL import Image

import src.app.services.ocr_evaluation as eval_mod
from src.app.services.ocr_evaluation import levenshtein_ops


def test_levenshtein_ops_basic():
    """編集距離とアラインメント操作（置換/脱落/挿入・case-sensitive）。"""
    dist, ops = levenshtein_ops("CBCOM", "CBC0M")
    assert dist == 1
    assert ops == [("sub", "O", "0")]

    dist, ops = levenshtein_ops("ABC", "AC")
    assert dist == 1
    assert ops == [("del", "B", "")]

    dist, ops = levenshtein_ops("AC", "ABC")
    assert dist == 1
    assert ops == [("ins", "", "B")]

    dist, ops = levenshtein_ops("", "AB")
    assert dist == 2
    assert [op[0] for op in ops] == ["ins", "ins"]

    dist, ops = levenshtein_ops("kt", "KT")  # 大小は区別（case-sensitive）
    assert dist == 2
    assert all(op[0] == "sub" for op in ops)

    assert levenshtein_ops("SAME", "SAME") == (0, [])


def _setup_dataset(tmp_path):
    img_dir = tmp_path / "imgs"
    img_dir.mkdir()
    for name in ("a.png", "b.png", "c.png"):
        arr = np.full((20, 60, 3), 200, dtype=np.uint8)
        Image.fromarray(arr, mode="RGB").save(img_dir / name)
    gt_csv = tmp_path / "gt.csv"
    gt_csv.write_text("filename,text\na.png,CBCOM\nb.png,AB\nc.png,XY\n", encoding="utf-8")
    return str(img_dir), str(gt_csv)


@pytest.fixture
def cer_env(monkeypatch, tmp_path):
    """base/trained 2モデルの予測を画像順に固定したスタブ評価環境。"""
    predictions = {
        "eng": ["CBC0M", "AB", "XYZ"],  # dist: 1(sub O→0), 0, 1(ins Z) → 合計2 / ref合計9
        "trained": ["CBCOM", "AB", "X"],  # dist: 0, 0, 1(del Y) → 合計1
    }

    def fake_preprocess(image_source, image_shape=None, strong=False):
        return Image.new("L", (32, 32), 255)

    def fake_build_recognizer(project_id, target, charset, psm):
        model = str(target.get("model"))
        seq = list(predictions[model])
        state = {"i": 0}

        def recognize(path):
            value = seq[state["i"] % len(seq)]
            state["i"] += 1
            return value, 0.9

        return {
            "label": model,
            "engine": "tesseract",
            "model": model,
            "is_base": model == "eng",
            "recognize": recognize,
        }

    monkeypatch.setattr("src.app.services.ocr_pipeline.preprocess_ocr_image", fake_preprocess)
    monkeypatch.setattr(eval_mod, "build_recognizer", fake_build_recognizer)
    img_dir, gt_csv = _setup_dataset(tmp_path)
    return eval_mod.evaluate_ocr(
        project_id="p1",
        image_dir=img_dir,
        gt_csv=gt_csv,
        targets=[{"engine": "tesseract", "model": "eng"}, {"engine": "tesseract", "model": "trained"}],
    )


def test_cer_is_micro_average(cer_env):
    """CERは総和÷総和のマイクロ平均（画像ごとのCER平均=0.2333…とは異なる値になる）。"""
    base = next(t for t in cer_env["targets"] if t["is_base"])
    trained = next(t for t in cer_env["targets"] if not t["is_base"])
    assert base["edit_distance_total"] == 2
    assert base["ref_length_total"] == 9
    assert base["cer"] == round(2 / 9, 4)  # 0.2222（マイクロ平均）
    assert base["cer"] != round((1 / 5 + 0 / 2 + 1 / 2) / 3, 4)  # 画像平均(0.2333)ではない
    assert trained["cer"] == round(1 / 9, 4)
    assert trained["char_accuracy"] == round(1 - 1 / 9, 4)
    assert trained["cer_percent"] == round(100 / 9, 2)


def test_confusions_aggregated_from_alignment(cer_env):
    """混同集計: baseは置換(O→0)と挿入(∅→Z)、trainedは脱落(Y→∅)。"""
    base = next(t for t in cer_env["targets"] if t["is_base"])
    kinds = {(c["kind"], c["from"], c["to"]): c["count"] for c in base["confusions"]}
    assert kinds[("sub", "O", "0")] == 1
    assert kinds[("ins", "", "Z")] == 1
    trained = next(t for t in cer_env["targets"] if not t["is_base"])
    kinds_t = {(c["kind"], c["from"], c["to"]): c["count"] for c in trained["confusions"]}
    assert kinds_t[("del", "Y", "")] == 1


def test_comparison_cer_and_transition_counts(cer_env):
    """CER差/相対改善率と 改善/同等/悪化・完全一致の増減 の判定。"""
    comp = cer_env["comparison"]
    assert comp["base_cer"] == round(2 / 9, 4)
    assert comp["trained_cer"] == round(1 / 9, 4)
    assert comp["cer_delta"] == round(1 / 9 - 2 / 9, 4)  # 負=改善
    assert comp["cer_relative_improvement"] == round((2 / 9 - 1 / 9) / (2 / 9), 4)  # 0.5
    # a: 1→0=改善 / b: 0→0=同等 / c: 1→1=同等
    assert comp["improved"] == 1
    assert comp["unchanged"] == 2
    assert comp["regressed"] == 0
    # a: 不一致→一致=完全一致へ改善1件。悪化なし
    assert comp["perfect_fixed"] == 1
    assert comp["perfect_regressed"] == 0


def test_rows_include_edit_distance_and_backward_compat(cer_env):
    """行別に編集距離・置換/脱落/挿入件数を含み、既存フィールドは後方互換。"""
    row = cer_env["rows"][0]  # a.png
    base_res = next(r for r in row["results"] if r["model_label"] == "eng")
    assert base_res["edit_distance"] == 1
    assert base_res["sub_count"] == 1 and base_res["del_count"] == 0 and base_res["ins_count"] == 0
    # 既存フィールドの互換
    trained = next(t for t in cer_env["targets"] if not t["is_base"])
    assert trained["accuracy_percent"] == round(2 / 3 * 100, 2)
    assert trained["correct"] == 2 and trained["total"] == 3 and trained["mismatch_count"] == 1
    assert cer_env["comparison"]["correct_delta"] == 1


def test_normalize_compare_nfc_only():
    """Unicode正規化はNFCのみ: 合成/結合の表記ゆれは同一視するが、
    大小文字・半角/全角・0とO等は同一視しない（評価仕様）。"""
    from src.app.services.ocr_evaluation import _normalize_compare

    # NFD（e + 結合アクセント）とNFC（合成済みé）は同一視する
    assert _normalize_compare("é") == _normalize_compare("é")
    # 大小文字は同一視しない（case-sensitive維持）
    assert _normalize_compare("abc") != _normalize_compare("ABC")
    # 半角/全角は同一視しない（NFKCを使わない）
    assert _normalize_compare("0") != _normalize_compare("０")
    # 0とO・1とIは同一視しない
    assert _normalize_compare("0") != _normalize_compare("O")
    assert _normalize_compare("1") != _normalize_compare("I")
    # ASCII charsetでは無変化（trimのみ）
    assert _normalize_compare("  CBCOM  ") == "CBCOM"


def test_normalize_compare_logs_replacement_char(caplog):
    """U+FFFD（置換文字）を含む場合は復元不能である旨をログへ記録する。"""
    import logging

    from src.app.services.ocr_evaluation import _normalize_compare

    with caplog.at_level(logging.WARNING, logger="src.app.services.ocr_evaluation"):
        result = _normalize_compare("AB�C")
    assert result == "AB�C"  # データ自体は変更しない
    assert any("U+FFFD" in rec.message for rec in caplog.records)
