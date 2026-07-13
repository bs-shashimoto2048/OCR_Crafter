"""YOLO検出前処理の座標逆変換と、学習用クロップの元画像出力の回帰テスト。"""

import io
import json

from PIL import Image

from src.app.services.detection_preprocess import (
    apply_detection_preprocess,
    detection_preprocess_geometry,
    invert_detection_bbox,
)
from src.app.services.training_image_builder import export_selected_crops

ORIGINAL_SIZE = (200, 100)


def approx_box(actual, expected, tol=1e-6):
    assert actual is not None, f"expected {expected}, got None"
    for a, e in zip(actual, expected):
        assert abs(a - e) <= tol, f"expected {expected}, got {actual}"


def test_invert_noop():
    approx_box(invert_detection_bbox((10, 20, 50, 60), {}, ORIGINAL_SIZE), (10, 20, 50, 60))


def test_invert_resize():
    # 200x100 -> resize_width=100（等比0.5倍）
    settings = {"resize_width": 100}
    geometry = detection_preprocess_geometry(settings, ORIGINAL_SIZE)
    assert geometry["output_size"] == (100, 50)
    approx_box(invert_detection_bbox((10, 10, 40, 25), settings, ORIGINAL_SIZE), (20, 20, 80, 50))


def test_invert_crop():
    settings = {"crop_left": 20, "crop_top": 10}
    approx_box(invert_detection_bbox((0, 0, 50, 40), settings, ORIGINAL_SIZE), (20, 10, 70, 50))


def test_invert_rotation_90():
    # 時計回り90: 元(10,20,50,60) -> 回転後(40,10,80,50)
    approx_box(invert_detection_bbox((40, 10, 80, 50), {"rotation": 90}, ORIGINAL_SIZE), (10, 20, 50, 60))


def test_invert_rotation_180():
    approx_box(invert_detection_bbox((150, 40, 190, 80), {"rotation": 180}, ORIGINAL_SIZE), (10, 20, 50, 60))


def test_invert_rotation_270():
    # 時計回り270: 元(10,20,50,60) -> 回転後(20,150,60,190)
    approx_box(invert_detection_bbox((20, 150, 60, 190), {"rotation": 270}, ORIGINAL_SIZE), (10, 20, 50, 60))


def test_invert_crop_and_resize():
    # crop(左20,上10) -> 180x90 -> resize_width=90（0.5倍）
    settings = {"crop_left": 20, "crop_top": 10, "resize_width": 90}
    geometry = detection_preprocess_geometry(settings, ORIGINAL_SIZE)
    assert geometry["cropped_size"] == (180, 90)
    assert geometry["output_size"] == (90, 45)
    approx_box(invert_detection_bbox((5, 5, 25, 25), settings, ORIGINAL_SIZE), (30, 20, 70, 60))


def test_invert_rotation_crop_resize():
    # rot90(200x100 -> 100x200) -> crop_left=10(90x200) -> resize_width=45（0.5倍）
    settings = {"rotation": 90, "crop_left": 10, "resize_width": 45}
    geometry = detection_preprocess_geometry(settings, ORIGINAL_SIZE)
    assert geometry["rotated_size"] == (100, 200)
    assert geometry["cropped_size"] == (90, 200)
    assert geometry["output_size"] == (45, 100)
    approx_box(invert_detection_bbox((15, 5, 35, 25), settings, ORIGINAL_SIZE), (10, 20, 50, 60))


def test_invert_clamps_to_original_bounds():
    approx_box(invert_detection_bbox((-10, -10, 300, 200), {}, ORIGINAL_SIZE), (0, 0, 200, 100))


def test_invert_returns_none_for_degenerate_bbox():
    assert invert_detection_bbox((0, 0, 0.5, 0.5), {}, ORIGINAL_SIZE) is None


def test_apply_matches_geometry_output_size():
    # apply と幾何計算のサイズが常に一致すること（逆変換の前提）
    img = Image.new("RGB", ORIGINAL_SIZE, (120, 130, 140))
    settings = {"rotation": 90, "crop_left": 10, "crop_top": 4, "resize_width": 45, "grayscale": True}
    out = apply_detection_preprocess(img, settings)
    geometry = detection_preprocess_geometry(settings, ORIGINAL_SIZE)
    assert (out.width, out.height) == geometry["output_size"]


def test_export_keeps_original_colors_when_grayscale_detection(tmp_path):
    # 左半分=赤 / 右半分=青 のカラー画像。グレースケール検出でも出力クロップはカラーを維持する
    img = Image.new("RGB", ORIGINAL_SIZE, (255, 0, 0))
    for x in range(100, 200):
        for y in range(100):
            img.putpixel((x, y), (0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    boxes = [{"id": 1, "x1": 10, "y1": 10, "x2": 60, "y2": 40, "selected": True}]
    result = export_selected_crops(
        image_bytes=buf.getvalue(),
        long_side=640,
        use_resize=False,
        resize_axis="long",
        boxes_json=json.dumps(boxes),
        output_dir=str(tmp_path),
        crop_height=30,
        detect_preprocess={"grayscale": True},
    )
    assert result["count"] == 1
    assert result["crop_source"] == "original"
    assert result["skipped_invalid_bbox"] == []
    with Image.open(result["files"][0]) as out:
        r, g, b = out.convert("RGB").getpixel((out.width // 2, out.height // 2))
    # グレースケール化されていれば r==g==b になる。カラー維持なら赤が残る
    assert r > 200 and g < 60 and b < 60, (r, g, b)


def test_export_skips_out_of_range_bbox(tmp_path):
    img = Image.new("RGB", ORIGINAL_SIZE, (255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    # rot90後の座標系(100x200)。2件目は逆変換後に幅が残らない退化BBOX
    boxes = [
        {"id": 1, "x1": 40, "y1": 10, "x2": 80, "y2": 50, "selected": True},
        {"id": 2, "x1": 0, "y1": 0, "x2": 0.4, "y2": 0.4, "selected": True},
    ]
    result = export_selected_crops(
        image_bytes=buf.getvalue(),
        long_side=640,
        use_resize=False,
        resize_axis="long",
        boxes_json=json.dumps(boxes),
        output_dir=str(tmp_path),
        crop_height=30,
        detect_preprocess={"rotation": 90},
    )
    assert result["count"] == 1
    assert result["skipped_invalid_bbox"] == [2]


def test_export_without_preprocess_unchanged(tmp_path):
    # 前処理なしは従来どおり（共通リサイズ画像からのクロップ・スキップなし）
    img = Image.new("RGB", ORIGINAL_SIZE, (0, 255, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    boxes = [{"id": 1, "x1": 10, "y1": 10, "x2": 60, "y2": 40, "selected": True}]
    result = export_selected_crops(
        image_bytes=buf.getvalue(),
        long_side=640,
        use_resize=False,
        resize_axis="long",
        boxes_json=json.dumps(boxes),
        output_dir=str(tmp_path),
        crop_height=30,
    )
    assert result["count"] == 1
    assert result["crop_source"] == "resized"
    with Image.open(result["files"][0]) as out:
        r, g, b = out.convert("RGB").getpixel((out.width // 2, out.height // 2))
    assert g > 200 and r < 60 and b < 60
