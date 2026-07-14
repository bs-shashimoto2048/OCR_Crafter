"""OCR前処理: 手動マスク補正のテスト（矩形／ポイント指定／塗りつぶし／回帰）。"""

import numpy as np
import pytest

from src.app.services.manual_mask import (
    LARGE_REGION_RATIO,
    apply_manual_masks,
    extract_black_region,
    load_manual_masks,
    mask_to_rle,
    save_manual_masks_for_image,
)
from src.app.services.preprocess import _build_preprocess_config, _op_manual_mask_post


def make_image_with_block():
    """白背景 + 左下の黒ブロック + 独立した黒点 のグレースケール画像。"""
    image = np.full((100, 200), 240, dtype=np.uint8)
    image[60:95, 5:45] = 15  # 左下の黒ブロック（影想定）
    image[10:14, 150:154] = 10  # 独立した別の黒領域
    return image


# ---- 矩形マスク ----


def test_rect_mask_fills_only_target_area():
    image = make_image_with_block()
    masks = [{"type": "rect", "x": 5 / 200, "y": 60 / 100, "width": 40 / 200, "height": 35 / 100, "enabled": True}]
    result = apply_manual_masks(image, masks, fill_mode="white")
    assert (result[60:95, 5:45] == 255).all()
    # 範囲外は不変（独立黒点は残る）
    assert (result[10:14, 150:154] == 10).all()
    assert result[0, 0] == 240
    # 入力は変更されない
    assert image[70, 20] == 15


def test_rect_mask_clamped_to_bounds():
    image = make_image_with_block()
    masks = [{"type": "rect", "x": 0.9, "y": 0.9, "width": 0.5, "height": 0.5, "enabled": True}]
    result = apply_manual_masks(image, masks, fill_mode="white")
    assert result.shape == image.shape
    assert (result[95:, 190:] == 255).all()


def test_multiple_overlapping_rects():
    image = make_image_with_block()
    masks = [
        {"type": "rect", "x": 0.0, "y": 0.5, "width": 0.15, "height": 0.5, "enabled": True},
        {"type": "rect", "x": 0.1, "y": 0.5, "width": 0.15, "height": 0.5, "enabled": True},
    ]
    result = apply_manual_masks(image, masks, fill_mode="white")
    assert (result[60:95, 5:45] == 255).all()


def test_disabled_mask_is_ignored():
    image = make_image_with_block()
    masks = [{"type": "rect", "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "enabled": False}]
    result = apply_manual_masks(image, masks, fill_mode="white")
    assert np.array_equal(result, image)


# ---- ポイント指定（黒連結領域） ----


def test_extract_black_region_selects_clicked_component_only():
    image = make_image_with_block()
    result = extract_black_region(image, x_norm=20 / 200, y_norm=75 / 100, threshold=80)
    assert result["found"] is True
    assert result["area_px"] == 35 * 40
    assert result["bbox"] == [5, 60, 45, 95]
    # 別の黒領域（黒点）は含まれない
    mask = np.zeros_like(image, dtype=bool)
    for y, x1, x2 in result["rle"]:
        mask[y, x1:x2] = True
    assert not mask[10:14, 150:154].any()


def test_extract_black_region_8_connectivity():
    image = np.full((20, 20), 240, dtype=np.uint8)
    image[4:6, 4:6] = 10  # 2x2ブロック
    image[6:8, 6:8] = 10  # 斜め（角のみ）で接続する別ブロック
    result = extract_black_region(image, 4 / 20, 4 / 20, threshold=80)
    assert result["found"] is True
    # 8近傍なら両ブロックが同一領域として抽出される
    assert result["area_px"] == 8


def test_extract_on_white_pixel_returns_not_found():
    image = make_image_with_block()
    result = extract_black_region(image, x_norm=0.5, y_norm=0.1, threshold=80)
    assert result["found"] is False
    assert "明るい" in result["reason"]


def test_extract_large_region_flagged():
    image = np.full((100, 100), 10, dtype=np.uint8)  # ほぼ全面が黒
    result = extract_black_region(image, 0.5, 0.5, threshold=80)
    assert result["found"] is True
    assert result["area_ratio"] >= LARGE_REGION_RATIO
    assert result["too_large"] is True


def test_extract_tiny_region_ignored():
    image = np.full((50, 50), 240, dtype=np.uint8)
    image[10, 10] = 10  # 1px
    result = extract_black_region(image, 10 / 50, 10 / 50, threshold=80)
    assert result["found"] is False


def test_region_mask_roundtrip_via_rle():
    image = make_image_with_block()
    region = extract_black_region(image, 20 / 200, 75 / 100, threshold=80)
    entry = {"type": "region", "rle": region["rle"], "source_size": region["source_size"], "enabled": True}
    result = apply_manual_masks(image, [entry], fill_mode="white")
    assert (result[60:95, 5:45] == 255).all()
    assert (result[10:14, 150:154] == 10).all()


# ---- 塗りつぶし方式 ----


def test_background_fill_uses_surrounding_median():
    image = np.full((100, 200), 200, dtype=np.uint8)
    image[40:60, 40:80] = 10
    masks = [{"type": "rect", "x": 40 / 200, "y": 40 / 100, "width": 40 / 200, "height": 20 / 100, "enabled": True}]
    result = apply_manual_masks(image, masks, fill_mode="background")
    assert (result[40:60, 40:80] == 200).all()


def test_rgb_image_supported():
    gray = make_image_with_block()
    rgb = np.stack([gray, gray, gray], axis=-1)
    masks = [{"type": "rect", "x": 0.0, "y": 0.5, "width": 0.25, "height": 0.5, "enabled": True}]
    result = apply_manual_masks(rgb, masks, fill_mode="white")
    assert result.shape == rgb.shape
    assert result.dtype == rgb.dtype
    assert (result[60:95, 5:45] == 255).all()


def test_mask_to_rle_roundtrip():
    mask = np.zeros((10, 10), dtype=bool)
    mask[2, 3:7] = True
    mask[3, 0:2] = True
    mask[3, 5:10] = True
    rle = mask_to_rle(mask)
    assert [2, 3, 7] in rle and [3, 0, 2] in rle and [3, 5, 10] in rle


# ---- 保存（画像単位） ----


def test_save_and_load_masks_per_image(temp_projects):
    masks = [{"type": "rect", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4, "enabled": True}]
    save_manual_masks_for_image("maskproj", "01.png", masks)
    save_manual_masks_for_image("maskproj", "02.png", [])
    data = load_manual_masks("maskproj")
    assert data["01.png"]["manual_masks"] == masks
    assert "02.png" not in data
    # 別プロジェクトとは分離される
    assert load_manual_masks("otherproj") == {}


# ---- 回帰（OFF時は従来出力と一致） ----


def test_pipeline_off_is_noop():
    image = make_image_with_block()
    cfg = _build_preprocess_config(None)
    assert cfg["operations"]["manual_mask"]["enabled"] is False
    result = _op_manual_mask_post(image, "wide", cfg["operations"])
    assert np.array_equal(result, image)


def test_enabled_without_masks_is_noop():
    image = make_image_with_block()
    operations = {"manual_mask": {"enabled": True, "fill": "white", "timing": "post", "masks": []}}
    result = _op_manual_mask_post(image, "wide", operations)
    assert np.array_equal(result, image)


def test_timing_mismatch_is_noop():
    image = make_image_with_block()
    operations = {
        "manual_mask": {
            "enabled": True,
            "fill": "white",
            "timing": "pre",
            "masks": [{"type": "rect", "x": 0, "y": 0, "width": 1, "height": 1, "enabled": True}],
        }
    }
    result = _op_manual_mask_post(image, "wide", operations)
    assert np.array_equal(result, image)


def test_broken_masks_file_returns_empty(temp_projects):
    from src.app.services.manual_mask import _masks_path

    path = _masks_path("brokenproj")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{ broken json", encoding="utf-8")
    assert load_manual_masks("brokenproj") == {}
