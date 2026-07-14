"""OCR前処理: 照明ムラ補正の単体・効果テスト。"""

import numpy as np
import pytest

from src.app.services.preprocess import (
    _build_preprocess_config,
    _normalize_background_size,
    _op_illumination,
    apply_illumination_correction,
)

METHODS = ["gaussian", "rolling_ball", "retinex"]


def make_shaded_image():
    """白背景 + 黒文字（縦棒3本）+ 左下に向かって暗くなる影 の合成画像。"""
    height, width = 96, 240
    image = np.full((height, width), 235, dtype=np.float32)
    # 黒文字（縦棒）
    for x0 in (60, 110, 160):
        image[28:68, x0 : x0 + 10] = 20
    # 左下ほど暗い影（線形グラデーション）
    yy, xx = np.mgrid[0:height, 0:width]
    shade = (1.0 - 0.5 * ((height - 1 - yy) / (height - 1)) * ((width - 1 - xx) / (width - 1)) * 2.0).clip(0.45, 1.0)
    return np.clip(image * shade, 0, 255).astype(np.uint8)


def background_mask(image):
    return image > 120  # 文字（暗部）を除いた背景


def test_off_returns_identical_output():
    image = make_shaded_image()
    result = _op_illumination(image, "wide", {"illumination": {"enabled": False}})
    assert np.array_equal(result, image)


def test_pipeline_off_matches_legacy_config():
    # OFF時は追加前と同一設定になる（configにillumination項目が存在しenabled=False）
    cfg = _build_preprocess_config(None)
    assert cfg["operations"]["illumination"]["enabled"] is False
    assert "illumination" in cfg["pipelines"]["wide"]


@pytest.mark.parametrize("method", METHODS)
def test_output_shape_and_dtype(method):
    image = make_shaded_image()
    result = apply_illumination_correction(image, method, 81, 1.0)
    assert result.shape == image.shape
    assert result.dtype == np.uint8
    assert np.isfinite(result.astype(np.float64)).all()


def test_even_background_size_normalized_to_odd():
    assert _normalize_background_size(80, 200, 200) == 79
    assert _normalize_background_size(81, 200, 200) == 81


def test_background_size_clamped_to_image():
    # 画像短辺(96)を超える値は短辺以下の奇数へ
    assert _normalize_background_size(501, 96, 240) == 95
    # 下限15
    assert _normalize_background_size(3, 200, 200) == 15


@pytest.mark.parametrize("method", METHODS)
def test_strength_zero_returns_input(method):
    image = make_shaded_image()
    result = apply_illumination_correction(image, method, 81, 0.0)
    assert np.array_equal(result, image)


def test_strength_one_equals_full_correction():
    image = make_shaded_image()
    full = apply_illumination_correction(image, "gaussian", 81, 1.0)
    half = apply_illumination_correction(image, "gaussian", 81, 0.5)
    assert not np.array_equal(full, image)
    # 中間強度は元画像と補正画像の間に位置する
    assert np.abs(half.astype(int) - image.astype(int)).mean() < np.abs(full.astype(int) - image.astype(int)).mean()


@pytest.mark.parametrize("method", METHODS)
@pytest.mark.parametrize("fill", [0, 255])
def test_flat_images_do_not_crash(method, fill):
    image = np.full((48, 200), fill, dtype=np.uint8)
    result = apply_illumination_correction(image, method, 81, 1.0)
    assert result.shape == image.shape
    assert result.dtype == np.uint8


def test_invalid_method_raises_value_error():
    with pytest.raises(ValueError):
        apply_illumination_correction(make_shaded_image(), "unknown", 81, 1.0)


def test_rgb_input_supported():
    gray = make_shaded_image()
    rgb = np.stack([gray, gray, gray], axis=-1)
    result = apply_illumination_correction(rgb, "gaussian", 81, 1.0)
    assert result.shape == gray.shape


@pytest.mark.parametrize("method", METHODS)
def test_shading_is_reduced_and_text_contrast_kept(method):
    """効果確認: 背景の明度ばらつきが補正前より小さく、文字コントラストが維持される。"""
    image = make_shaded_image()
    result = apply_illumination_correction(image, method, 81, 1.0)

    mask = background_mask(image)
    before_std = float(image[mask].std())
    after_std = float(result[mask].std())
    assert after_std < before_std, f"{method}: background std {before_std:.1f} -> {after_std:.1f}"

    text_mask = image < 60
    contrast = float(result[mask].mean()) - float(result[text_mask].mean())
    assert contrast > 60, f"{method}: text contrast too low ({contrast:.1f})"
