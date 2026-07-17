"""EasyOCR入力方式の回帰テスト。

ultralytics（YOLO検出）はWindowsで cv2.imread をグローバルに差し替え、グレースケール
指定でも常に3次元 (H, W, 1) を返す。easyocr へパス文字列を渡すと内部の cv2.imread に
依存するため、YOLO実行後のEasyOCRが get_image_list の
`maximum_y, maximum_x = img.shape` で「too many values to unpack (expected 2)」で
必ず失敗していた。readtext へは自前で読み込んだ2次元numpy配列を渡すこと。
"""

import numpy as np
from PIL import Image

from src.app.predict import _run_easyocr


class _FakeReader:
    """readtextへ渡された入力を記録するダミーReader。"""

    def __init__(self):
        self.received = None
        self.kwargs = None

    def readtext(self, image, **kwargs):
        self.received = image
        self.kwargs = kwargs
        return [([[0, 0], [10, 0], [10, 10], [0, 10]], "AB1", 0.92)]


def test_run_easyocr_passes_numpy_grayscale_not_path(tmp_path):
    """readtextへはパスではなく2次元グレースケールnumpy配列を渡す（cv2.imread非依存）。"""
    img_path = tmp_path / "sample.png"
    Image.new("RGB", (60, 20), (255, 255, 255)).save(img_path)
    reader = _FakeReader()
    prediction, confidence, parsed = _run_easyocr(reader, str(img_path))
    assert isinstance(reader.received, np.ndarray)
    assert reader.received.ndim == 2
    assert reader.received.shape == (20, 60)
    assert prediction == "AB1"
    assert confidence == 0.92
    assert parsed == [{"text": "AB1", "confidence": 0.92}]


def test_run_easyocr_allowlist_passthrough(tmp_path):
    """小文字制御用のallowlistは従来どおりreadtextへ渡される。"""
    img_path = tmp_path / "sample.png"
    Image.new("L", (30, 10), 255).save(img_path)
    reader = _FakeReader()
    _run_easyocr(reader, str(img_path), allowlist="ABC123")
    assert reader.kwargs.get("allowlist") == "ABC123"
