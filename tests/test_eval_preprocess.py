"""Step5専用OCR前処理（apply_eval_preprocess）とスロット別PSM/whitelistのテスト。

- 前処理はOCR候補生成用の推論入力にのみ適用するアダプター（既存 _op_grayscale / _op_threshold を再利用）
- 両設定OFF時は入力をそのまま返す（従来動作・バイト不変）
- PSM/whitelist は Tesseract推論へ、whitelist は EasyOCRのallowlistへ、未指定=従来動作
"""

import numpy as np
import pytest
from PIL import Image

import src.app.predict as predict_mod
from src.app.services.preprocess import apply_eval_preprocess, parse_eval_preprocess


def _color_image(width=60, height=20):
    """左半分が暗く右半分が明るいRGB画像（二値化のしきい値検証用）。"""
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[:, : width // 2] = 40
    arr[:, width // 2 :] = 220
    return Image.fromarray(arr, mode="RGB")


def test_parse_eval_preprocess_defaults_and_validation():
    assert parse_eval_preprocess(None) == {
        "grayscale": False,
        "binarize": False,
        "binarize_method": "otsu",
        "threshold": 127,
    }
    with pytest.raises(ValueError):
        parse_eval_preprocess({"binarize_method": "adaptive"})
    with pytest.raises(ValueError):
        parse_eval_preprocess({"threshold": 300})
    with pytest.raises(ValueError):
        parse_eval_preprocess({"threshold": "abc"})


def test_apply_eval_preprocess_off_returns_input_unchanged():
    """両設定OFFは入力オブジェクトをそのまま返す（画素変化なし=従来動作）。"""
    img = _color_image()
    out = apply_eval_preprocess(img, {"grayscale": False, "binarize": False})
    assert out is img


def test_apply_eval_preprocess_grayscale():
    """グレースケールONで彩度が消える（R=G=B）。サイズは不変。"""
    out = apply_eval_preprocess(_color_image(), {"grayscale": True})
    arr = np.asarray(out)
    assert out.size == (60, 20)
    assert np.array_equal(arr[:, :, 0], arr[:, :, 1])
    assert np.array_equal(arr[:, :, 1], arr[:, :, 2])
    # 二値化はしていない（0/255以外の階調が残る）
    assert len(np.unique(arr[:, :, 0])) >= 2


def test_apply_eval_preprocess_fixed_threshold():
    """固定しきい値: しきい値を挟んで0/255に分かれる。"""
    out = apply_eval_preprocess(
        _color_image(), {"binarize": True, "binarize_method": "fixed", "threshold": 127}
    )
    arr = np.asarray(out)[:, :, 0]
    assert set(np.unique(arr)) <= {0, 255}
    assert arr[0, 0] == 0  # 暗部（40 < 127）
    assert arr[0, 59] == 255  # 明部（220 > 127）
    # しきい値250なら明部も0になる
    out2 = apply_eval_preprocess(
        _color_image(), {"binarize": True, "binarize_method": "fixed", "threshold": 250}
    )
    assert np.asarray(out2)[0, 59, 0] == 0


def test_apply_eval_preprocess_otsu():
    """大津の二値化: 2クラス画像が0/255へ分離される（グレースケールOFFでも内部変換）。"""
    out = apply_eval_preprocess(_color_image(), {"binarize": True, "binarize_method": "otsu", "grayscale": False})
    arr = np.asarray(out)[:, :, 0]
    assert set(np.unique(arr)) == {0, 255}
    assert arr[0, 0] == 0
    assert arr[0, 59] == 255


class _CaptureTesseract:
    """recognize_line の呼び出し引数（charset/psm）を記録するスタブ。"""

    def __init__(self):
        self.calls = []

    def __call__(self, cmd, input_path, tessdata_dir, lang, charset, psm=7):
        self.calls.append({"charset": charset, "psm": psm})
        return "AB1", 0.9


def test_tesseract_psm_and_whitelist_passthrough(tmp_path, monkeypatch):
    """PSM/whitelist指定はrecognize_lineへ伝播し、未指定は従来（psm=7・モデル既定charset）。"""
    capture = _CaptureTesseract()
    monkeypatch.setattr(predict_mod, "ensure_tesseract_inference_tool", lambda: "tesseract")
    monkeypatch.setattr(predict_mod, "resolve_base_traineddata", lambda lang, tesseract_cmd=None: (tmp_path, "eng"))
    monkeypatch.setattr(predict_mod, "recognize_line", capture)

    img_path = tmp_path / "x.png"
    Image.new("L", (30, 10), 255).save(img_path)

    # 未指定=従来動作（psm=7・既定charset）
    predict_mod._predict_with_tesseract(str(img_path), model="eng", apply_preprocess=False)
    assert capture.calls[-1]["psm"] == 7
    default_charset = capture.calls[-1]["charset"]
    assert default_charset  # モデル既定charsetが渡る

    # PSM・whitelist指定は伝播し、検証charsetもwhitelistへ追従する
    result = predict_mod._predict_with_tesseract(
        str(img_path), model="eng", apply_preprocess=False, psm=6, whitelist="AB1"
    )
    assert capture.calls[-1]["psm"] == 6
    assert capture.calls[-1]["charset"] == "AB1"
    assert result["valid"] is True  # "AB1" は whitelist 内

    # 空文字whitelistは未指定と同じ（従来charset）
    predict_mod._predict_with_tesseract(str(img_path), model="eng", apply_preprocess=False, whitelist="  ")
    assert capture.calls[-1]["charset"] == default_charset


def test_easyocr_allowlist_override_passthrough(tmp_path, monkeypatch):
    """whitelist指定はEasyOCRのreadtext allowlistとして伝播する（未指定=小文字制御由来の従来動作）。"""

    class _FakeReader:
        def __init__(self):
            self.allowlists = []

        def readtext(self, image, **kwargs):
            self.allowlists.append(kwargs.get("allowlist"))
            return [([[0, 0], [1, 0], [1, 1], [0, 1]], "AB", 0.9)]

    reader = _FakeReader()
    monkeypatch.setattr(predict_mod, "_get_easyocr_reader", lambda langs: (reader, False))

    img_path = tmp_path / "y.png"
    Image.new("L", (30, 10), 255).save(img_path)

    # 未指定: 小文字ON×enでは allowlist なし（従来動作）
    predict_mod._predict_with_easyocr(str(img_path), languages=["en"], apply_preprocess=False, include_lowercase=True)
    assert reader.allowlists[-1] is None

    # override指定: readtextのallowlistへそのまま伝播
    predict_mod._predict_with_easyocr(
        str(img_path), languages=["en"], apply_preprocess=False, include_lowercase=True, allowlist_override="kt123"
    )
    assert reader.allowlists[-1] == "kt123"
