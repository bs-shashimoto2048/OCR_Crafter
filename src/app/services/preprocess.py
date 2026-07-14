import copy
import io
import json
import base64
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
from PIL import Image, ImageFilter, ImageOps

try:
    import cv2  # type: ignore
except Exception:  # noqa: BLE001
    cv2 = None

from ..config import get_settings
from ..paths import IMAGE_EXTENSIONS
from ..project_paths import ensure_project_directories
from .image_classifier import classify_image_type
from .labels import upsert_image_type

DEFAULT_PREPROCESS_CONFIG: dict[str, Any] = {
    "ratio_threshold": 1.6,
    "pipelines": {
        "single": [
            "grayscale",
            "illumination",
            "gamma",
            "local_contrast",
            "hist_equalize",
            "bilateral",
            "sharpen",
            "unsharp",
            "manual_mask_pre",
            "threshold",
            "manual_mask_post",
            "morph",
            "stroke_boost",
            "denoise",
            "crop_margin",
            "pad",
            "resize",
        ],
        "wide": [
            "grayscale",
            "illumination",
            "gamma",
            "clahe",
            "local_contrast",
            "hist_equalize",
            "bilateral",
            "sharpen",
            "unsharp",
            "manual_mask_pre",
            "threshold",
            "manual_mask_post",
            "morph",
            "stroke_boost",
            "deskew",
            "crop_margin",
            "resize",
            "denoise",
        ],
    },
    "operations": {
        "illumination": {"enabled": False, "method": "gaussian", "background_size": 81, "strength": 1.0},
        "manual_mask": {"enabled": False, "fill": "white", "timing": "post", "masks": []},
        "threshold": {"type": "binary", "value": 128, "block_size": 35, "c": 11},
        "clahe": {"clip_limit": 1.0, "tile_grid_size": 2},
        "sharpen": {"enabled": True, "amount": 0.2, "sigma": 0.5},
        "gamma": {"enabled": False, "value": 1.0},
        "morph": {"enabled": False, "method": "close", "ksize": 3, "iterations": 1},
        "unsharp": {"enabled": False, "amount": 0.8, "radius": 1.0, "threshold": 0},
        "bilateral": {"enabled": False, "diameter": 5, "sigma_color": 50, "sigma_space": 50},
        "local_contrast": {"enabled": False, "clip_limit": 2.0, "tile_grid_size": 8},
        "crop_margin": {"enabled": False, "threshold": 245, "margin": 2, "min_pixels": 10},
        "hist_equalize": {"enabled": False},
        "stroke_boost": {"enabled": True, "method": "close", "ksize": 1, "iterations": 1},
        "denoise": {"method": "gaussian", "ksize": 1},
        "pad": {"mode": "square", "fill": 255},
        "resize": {"single": 64, "wide_height": 48, "keep_ratio": True, "interpolation": "area"},
        "deskew": {"enabled": True, "min_foreground_pixels": 20, "border_value": 255, "max_abs_angle": 8.0},
        "normalize": {"enabled": False, "mean": 0.5, "std": 0.5},
    },
}


def _deep_update(dst: dict[str, Any], src: dict[str, Any]) -> dict[str, Any]:
    for key, value in src.items():
        if isinstance(value, dict) and isinstance(dst.get(key), dict):
            _deep_update(dst[key], value)
        else:
            dst[key] = value
    return dst


def _set_nested(cfg: dict[str, Any], keys: list[str], value: Any) -> None:
    cur = cfg
    for key in keys[:-1]:
        if key not in cur or not isinstance(cur[key], dict):
            cur[key] = {}
        cur = cur[key]
    cur[keys[-1]] = value


def _build_preprocess_config(overrides: Optional[dict[str, Any]]) -> dict[str, Any]:
    cfg = copy.deepcopy(DEFAULT_PREPROCESS_CONFIG)
    base = get_settings().get("preprocess", {})
    if isinstance(base, dict):
        _deep_update(cfg, base)

    if overrides:
        # Nested config override.
        if isinstance(overrides.get("preprocess"), dict):
            _deep_update(cfg, overrides["preprocess"])
        else:
            _deep_update(cfg, {k: v for k, v in overrides.items() if k not in {"project_id"}})

        # Backward-compatible flat override keys.
        legacy_map = {
            "single_size": ["operations", "resize", "single"],
            "wide_height": ["operations", "resize", "wide_height"],
            "wide_keep_ratio": ["operations", "resize", "keep_ratio"],
            "ratio_threshold": ["ratio_threshold"],
            "blur_size": ["operations", "denoise", "ksize"],
            "threshold_type": ["operations", "threshold", "type"],
            "clahe_clip_limit": ["operations", "clahe", "clip_limit"],
            "clahe_tile_grid_size": ["operations", "clahe", "tile_grid_size"],
            "sharpen_enabled": ["operations", "sharpen", "enabled"],
            "sharpen_amount": ["operations", "sharpen", "amount"],
            "sharpen_sigma": ["operations", "sharpen", "sigma"],
            "resize_size": ["operations", "resize", "single"],
            "stroke_boost_enabled": ["operations", "stroke_boost", "enabled"],
            "stroke_boost_method": ["operations", "stroke_boost", "method"],
            "stroke_boost_ksize": ["operations", "stroke_boost", "ksize"],
            "stroke_boost_iterations": ["operations", "stroke_boost", "iterations"],
            "gamma_enabled": ["operations", "gamma", "enabled"],
            "gamma_value": ["operations", "gamma", "value"],
            "morph_enabled": ["operations", "morph", "enabled"],
            "morph_method": ["operations", "morph", "method"],
            "morph_ksize": ["operations", "morph", "ksize"],
            "morph_iterations": ["operations", "morph", "iterations"],
            "unsharp_enabled": ["operations", "unsharp", "enabled"],
            "unsharp_amount": ["operations", "unsharp", "amount"],
            "unsharp_radius": ["operations", "unsharp", "radius"],
            "unsharp_threshold": ["operations", "unsharp", "threshold"],
            "bilateral_enabled": ["operations", "bilateral", "enabled"],
            "bilateral_diameter": ["operations", "bilateral", "diameter"],
            "bilateral_sigma_color": ["operations", "bilateral", "sigma_color"],
            "bilateral_sigma_space": ["operations", "bilateral", "sigma_space"],
            "local_contrast_enabled": ["operations", "local_contrast", "enabled"],
            "local_contrast_clip_limit": ["operations", "local_contrast", "clip_limit"],
            "local_contrast_tile_grid_size": ["operations", "local_contrast", "tile_grid_size"],
            "crop_margin_enabled": ["operations", "crop_margin", "enabled"],
            "crop_margin_threshold": ["operations", "crop_margin", "threshold"],
            "crop_margin_margin": ["operations", "crop_margin", "margin"],
            "hist_equalize_enabled": ["operations", "hist_equalize", "enabled"],
        }
        for key, path in legacy_map.items():
            if key in overrides and overrides[key] is not None:
                _set_nested(cfg, path, overrides[key])

    return cfg


def build_preprocess_config(overrides: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    return _build_preprocess_config(overrides)


def _ensure_gray_uint8(value: Any) -> np.ndarray:
    if isinstance(value, Image.Image):
        arr = np.asarray(value.convert("L"))
    else:
        arr = np.asarray(value)
    if arr.ndim == 3:
        arr = np.asarray(Image.fromarray(arr.astype(np.uint8)).convert("L"))
    if arr.dtype != np.uint8:
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    return arr


def _otsu_threshold_np(gray: np.ndarray) -> np.ndarray:
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = gray.size
    sum_total = np.dot(np.arange(256), hist)
    sum_b = 0.0
    weight_b = 0.0
    best_var = -1.0
    threshold = 0
    for t in range(256):
        weight_b += hist[t]
        if weight_b == 0:
            continue
        weight_f = total - weight_b
        if weight_f == 0:
            break
        sum_b += t * hist[t]
        mean_b = sum_b / weight_b
        mean_f = (sum_total - sum_b) / weight_f
        var_between = weight_b * weight_f * (mean_b - mean_f) ** 2
        if var_between > best_var:
            best_var = var_between
            threshold = t
    return np.where(gray > threshold, 255, 0).astype(np.uint8)


def _resize_gray(gray: np.ndarray, width: int, height: int, interpolation: str) -> np.ndarray:
    interpolation = str(interpolation).lower()
    if cv2 is not None:
        interp_map = {
            "nearest": cv2.INTER_NEAREST,
            "linear": cv2.INTER_LINEAR,
            "cubic": cv2.INTER_CUBIC,
            "area": cv2.INTER_AREA,
        }
        interp = interp_map.get(interpolation, cv2.INTER_AREA)
        return cv2.resize(gray, (width, height), interpolation=interp)

    pil_interpolation = {
        "nearest": Image.Resampling.NEAREST,
        "linear": Image.Resampling.BILINEAR,
        "cubic": Image.Resampling.BICUBIC,
        "area": Image.Resampling.LANCZOS,
    }.get(interpolation, Image.Resampling.LANCZOS)
    return np.asarray(Image.fromarray(gray, mode="L").resize((width, height), pil_interpolation), dtype=np.uint8)


def _op_grayscale(value: Any, _: str, __: dict[str, Any]) -> np.ndarray:
    return _ensure_gray_uint8(value)


ILLUMINATION_METHODS = ("gaussian", "rolling_ball", "retinex")


def _normalize_background_size(background_size: int, height: int, width: int) -> int:
    """背景サイズを 下限15 / 画像短辺以下 / 奇数 に正規化する。"""
    short_side = max(3, min(int(height), int(width)))
    size = max(15, int(background_size))
    size = min(size, short_side)
    if size % 2 == 0:
        size -= 1
    return max(3, size)


def apply_illumination_correction(
    image: Any,
    method: str,
    background_size: int,
    strength: float,
) -> np.ndarray:
    """照明ムラ補正（OCR前処理専用）。暗文字/明背景を前提に背景を推定して均一化する。

    - gaussian: 大きなGaussianで背景推定し、元画像を背景で除算して正規化（高速・標準）
    - rolling_ball: 形態学的Closing（明背景の中の暗文字を除去した背景推定）による近似
    - retinex: Single Scale Retinex（log差分）を0-255へ正規化
    出力は入力と同サイズのuint8グレースケール。strengthで元画像とブレンドする。
    """
    from scipy import ndimage

    method_key = str(method or "gaussian").strip().lower()
    if method_key not in ILLUMINATION_METHODS:
        raise ValueError(f"照明ムラ補正の方式が不正です: {method}（gaussian / rolling_ball / retinex）")

    gray = _ensure_gray_uint8(image)
    height, width = gray.shape[:2]
    size = _normalize_background_size(background_size, height, width)
    blend = min(1.0, max(0.0, float(strength)))

    src = gray.astype(np.float32)
    if method_key == "gaussian":
        sigma = max(1.0, size / 6.0)
        background = ndimage.gaussian_filter(src, sigma=sigma)
        corrected = src / np.maximum(background, 1.0) * 255.0
    elif method_key == "rolling_ball":
        # 明背景・暗文字では Closing(膨張→収縮) が文字を除去した背景を推定する
        background = ndimage.minimum_filter(ndimage.maximum_filter(src, size=size), size=size)
        corrected = src / np.maximum(background, 1.0) * 255.0
    else:  # retinex
        sigma = max(1.0, size / 6.0)
        blurred = ndimage.gaussian_filter(src + 1.0, sigma=sigma)
        retinex = np.log(src + 1.0) - np.log(np.maximum(blurred, 1e-6))
        retinex = np.nan_to_num(retinex, nan=0.0, posinf=0.0, neginf=0.0)
        r_min = float(retinex.min())
        r_max = float(retinex.max())
        if r_max - r_min < 1e-9:
            # 完全に平坦な画像（全黒/全白など）は補正対象がないため元画像を返す
            corrected = src
        else:
            corrected = (retinex - r_min) / (r_max - r_min) * 255.0

    corrected = np.clip(np.nan_to_num(corrected, nan=0.0, posinf=255.0, neginf=0.0), 0.0, 255.0)
    if blend >= 1.0:
        result = corrected
    elif blend <= 0.0:
        result = src
    else:
        result = src * (1.0 - blend) + corrected * blend
    return np.clip(result, 0.0, 255.0).astype(np.uint8)


def _apply_manual_mask_stage(value: Any, operations: dict[str, Any], stage: str) -> np.ndarray:
    """手動マスク補正（画像単位）。timing が一致する段階でのみ適用する。"""
    from .manual_mask import apply_manual_masks

    cfg = operations.get("manual_mask", {})
    gray_or_current = _ensure_gray_uint8(value)
    if not cfg.get("enabled", False):
        return gray_or_current
    if str(cfg.get("timing", "post")) != stage:
        return gray_or_current
    masks = cfg.get("masks") or []
    if not masks:
        return gray_or_current
    return apply_manual_masks(gray_or_current, masks, fill_mode=str(cfg.get("fill", "white")))


def _op_manual_mask_pre(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    return _apply_manual_mask_stage(value, operations, "pre")


def _op_manual_mask_post(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    return _apply_manual_mask_stage(value, operations, "post")


def attach_manual_masks_to_config(cfg: dict[str, Any], project_id: Optional[str], image_name: str) -> dict[str, Any]:
    """画像単位で保存された手動マスクを前処理設定へ注入する（有効時のみ読み込み）。"""
    from .manual_mask import load_manual_masks

    op_cfg = cfg.get("operations", {}).get("manual_mask")
    if not isinstance(op_cfg, dict) or not op_cfg.get("enabled", False):
        return cfg
    record = load_manual_masks(project_id).get(Path(image_name).name) or {}
    op_cfg["masks"] = record.get("manual_masks") or []
    return cfg


def _op_illumination(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    cfg = operations.get("illumination", {})
    if not cfg.get("enabled", False):
        # OFF時は完全に従来どおり（グレースケールのみ保証）
        return _ensure_gray_uint8(value)
    return apply_illumination_correction(
        value,
        method=str(cfg.get("method", "gaussian")),
        background_size=int(cfg.get("background_size", 81) or 81),
        strength=float(cfg.get("strength", 1.0) if cfg.get("strength") is not None else 1.0),
    )


def _op_threshold(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("threshold", {})
    mode = str(cfg.get("type", "otsu")).lower()

    if mode == "otsu":
        if cv2 is not None:
            _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            return th
        return _otsu_threshold_np(gray)

    if mode == "adaptive":
        block_size = int(cfg.get("block_size", 35))
        c = int(cfg.get("c", 11))
        if block_size % 2 == 0:
            block_size += 1
        if cv2 is not None:
            return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block_size, c)
        # Fallback when cv2 is unavailable.
        value = int(cfg.get("value", 127))
        return np.where(gray > value, 255, 0).astype(np.uint8)

    # fixed/binary fallback
    fixed = int(cfg.get("value", 127))
    return np.where(gray > fixed, 255, 0).astype(np.uint8)


def _op_denoise(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("denoise", {})
    method = str(cfg.get("method", "median")).lower()
    ksize = max(1, int(cfg.get("ksize", 3)))
    if ksize % 2 == 0:
        ksize += 1

    if method == "none":
        return gray

    if method == "gaussian":
        if cv2 is not None:
            return cv2.GaussianBlur(gray, (ksize, ksize), 0)
        return np.asarray(Image.fromarray(gray, mode="L").filter(ImageFilter.GaussianBlur(radius=max(1, ksize // 2))))

    # median default
    if cv2 is not None:
        return cv2.medianBlur(gray, ksize)
    return np.asarray(Image.fromarray(gray, mode="L").filter(ImageFilter.MedianFilter(size=ksize)))


def _op_pad(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("pad", {})
    mode = str(cfg.get("mode", "square")).lower()
    fill = int(cfg.get("fill", 255))

    if mode != "square":
        return gray

    h, w = gray.shape[:2]
    if h == w:
        return gray
    size = max(h, w)
    out = np.full((size, size), fill, dtype=np.uint8)
    y = (size - h) // 2
    x = (size - w) // 2
    out[y : y + h, x : x + w] = gray
    return out


def _op_resize(value: Any, image_type: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("resize", {})
    interpolation = str(cfg.get("interpolation", "area"))

    if image_type == "wide":
        target_h = max(1, int(cfg.get("wide_height", 32)))
        keep_ratio = bool(cfg.get("keep_ratio", True))
        if keep_ratio:
            h, w = gray.shape[:2]
            target_w = max(1, int(round(w * (target_h / max(h, 1)))))
        else:
            target_w = max(1, int(cfg.get("wide_width", gray.shape[1])))
        return _resize_gray(gray, target_w, target_h, interpolation)

    # single
    size = max(1, int(cfg.get("single", 64)))
    return _resize_gray(gray, size, size, interpolation)


def _op_clahe(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("clahe", {})
    clip_limit = float(cfg.get("clip_limit", 2.0))
    tile = max(2, int(cfg.get("tile_grid_size", 8)))

    if cv2 is not None:
        clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
        return clahe.apply(gray)

    return np.asarray(ImageOps.autocontrast(Image.fromarray(gray, mode="L")), dtype=np.uint8)


def _op_sharpen(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("sharpen", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    amount = float(cfg.get("amount", 1.0))
    sigma = max(0.1, float(cfg.get("sigma", 1.0)))

    if cv2 is not None:
        blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma, sigmaY=sigma)
        sharpened = cv2.addWeighted(gray, 1.0 + amount, blurred, -amount, 0)
        return np.clip(sharpened, 0, 255).astype(np.uint8)

    radius = max(1, int(round(sigma)))
    percent = int(max(0.1, amount) * 100)
    image = Image.fromarray(gray, mode="L").filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=0))
    return np.asarray(image, dtype=np.uint8)


def _op_gamma(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("gamma", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    gamma = float(cfg.get("value", 1.0))
    gamma = max(0.1, gamma)
    inv_gamma = 1.0 / gamma
    lut = np.array([((i / 255.0) ** inv_gamma) * 255.0 for i in range(256)], dtype=np.float32)
    lut = np.clip(lut, 0, 255).astype(np.uint8)
    if cv2 is not None:
        return cv2.LUT(gray, lut)
    return lut[gray]


def _op_morph(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("morph", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    method = str(cfg.get("method", "close")).lower()
    ksize = max(1, int(cfg.get("ksize", 3)))
    if ksize % 2 == 0:
        ksize += 1
    iterations = max(1, int(cfg.get("iterations", 1)))

    if cv2 is not None:
        kernel = np.ones((ksize, ksize), dtype=np.uint8)
        if method == "open":
            return cv2.morphologyEx(gray, cv2.MORPH_OPEN, kernel, iterations=iterations)
        return cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel, iterations=iterations)

    result = gray
    for _ in range(iterations):
        image = Image.fromarray(result, mode="L")
        if method == "open":
            eroded = image.filter(ImageFilter.MinFilter(size=ksize))
            result = np.asarray(eroded.filter(ImageFilter.MaxFilter(size=ksize)), dtype=np.uint8)
        else:
            dilated = image.filter(ImageFilter.MaxFilter(size=ksize))
            result = np.asarray(dilated.filter(ImageFilter.MinFilter(size=ksize)), dtype=np.uint8)
    return result


def _op_unsharp(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("unsharp", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    amount = float(cfg.get("amount", 0.8))
    radius = max(0.1, float(cfg.get("radius", 1.0)))
    threshold = max(0, int(cfg.get("threshold", 0)))

    if cv2 is not None:
        blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=radius, sigmaY=radius)
        sharpened = cv2.addWeighted(gray, 1.0 + amount, blurred, -amount, 0)
        if threshold > 0:
            diff = cv2.absdiff(gray, blurred)
            mask = diff >= threshold
            out = gray.copy()
            out[mask] = sharpened[mask]
            return np.clip(out, 0, 255).astype(np.uint8)
        return np.clip(sharpened, 0, 255).astype(np.uint8)

    pil = Image.fromarray(gray, mode="L").filter(
        ImageFilter.UnsharpMask(
            radius=max(1, int(round(radius))),
            percent=int(max(0.1, amount) * 100),
            threshold=threshold,
        )
    )
    return np.asarray(pil, dtype=np.uint8)


def _op_bilateral(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("bilateral", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    diameter = max(1, int(cfg.get("diameter", 5)))
    sigma_color = max(1.0, float(cfg.get("sigma_color", 50)))
    sigma_space = max(1.0, float(cfg.get("sigma_space", 50)))

    if cv2 is not None:
        return cv2.bilateralFilter(gray, d=diameter, sigmaColor=sigma_color, sigmaSpace=sigma_space)

    # fallback
    return np.asarray(Image.fromarray(gray, mode="L").filter(ImageFilter.MedianFilter(size=3)), dtype=np.uint8)


def _op_local_contrast(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("local_contrast", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    clip_limit = float(cfg.get("clip_limit", 2.0))
    tile = max(2, int(cfg.get("tile_grid_size", 8)))
    if cv2 is not None:
        clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
        return clahe.apply(gray)
    return np.asarray(ImageOps.autocontrast(Image.fromarray(gray, mode="L")), dtype=np.uint8)


def _op_crop_margin(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("crop_margin", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    threshold = int(cfg.get("threshold", 245))
    margin = max(0, int(cfg.get("margin", 2)))
    min_pixels = max(1, int(cfg.get("min_pixels", 10)))

    mask_dark = gray < threshold
    mask_light = gray > (255 - threshold)
    dark_count = int(mask_dark.sum())
    light_count = int(mask_light.sum())

    mask = mask_dark
    if dark_count < min_pixels and light_count >= min_pixels:
        mask = mask_light
    elif light_count >= min_pixels and dark_count >= min_pixels and light_count < dark_count:
        mask = mask_light

    ys, xs = np.where(mask)
    if ys.size < min_pixels or xs.size < min_pixels:
        return gray

    y0 = max(0, int(ys.min()) - margin)
    y1 = min(gray.shape[0], int(ys.max()) + margin + 1)
    x0 = max(0, int(xs.min()) - margin)
    x1 = min(gray.shape[1], int(xs.max()) + margin + 1)
    if y1 <= y0 or x1 <= x0:
        return gray
    return gray[y0:y1, x0:x1]


def _op_hist_equalize(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("hist_equalize", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    if cv2 is not None:
        return cv2.equalizeHist(gray)
    return np.asarray(ImageOps.equalize(Image.fromarray(gray, mode="L")), dtype=np.uint8)


def _to_binary_ink(gray: np.ndarray) -> tuple[np.ndarray, bool]:
    """
    Convert image to a binary "ink mask" (ink=255, background=0).
    Returns (ink_mask, dark_is_ink).
    """
    binary = np.where(gray > 127, 255, 0).astype(np.uint8)
    dark_count = int(np.count_nonzero(binary == 0))
    light_count = int(binary.size - dark_count)
    dark_is_ink = dark_count <= light_count
    if dark_is_ink:
        ink = np.where(binary == 0, 255, 0).astype(np.uint8)
    else:
        ink = np.where(binary == 255, 255, 0).astype(np.uint8)
    return ink, dark_is_ink


def _op_stroke_boost(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("stroke_boost", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    method = str(cfg.get("method", "close")).lower()
    ksize = max(1, int(cfg.get("ksize", 3)))
    if ksize % 2 == 0:
        ksize += 1
    iterations = max(1, int(cfg.get("iterations", 1)))

    # Apply morphology on foreground (ink), auto-detecting polarity per image.
    # This avoids targeting background when text polarity is reversed.
    ink, dark_is_ink = _to_binary_ink(gray)

    if cv2 is not None:
        kernel = np.ones((ksize, ksize), dtype=np.uint8)
        if method == "dilate":
            out_ink = cv2.dilate(ink, kernel, iterations=iterations)
        elif method == "erode":
            out_ink = cv2.erode(ink, kernel, iterations=iterations)
        elif method == "open":
            out_ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel, iterations=iterations)
        else:
            out_ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, kernel, iterations=iterations)
        if dark_is_ink:
            return np.where(out_ink > 127, 0, 255).astype(np.uint8)
        return np.where(out_ink > 127, 255, 0).astype(np.uint8)

    # PIL fallback
    result = ink
    for _ in range(iterations):
        image = Image.fromarray(result, mode="L")
        if method == "dilate":
            result = np.asarray(image.filter(ImageFilter.MaxFilter(size=ksize)), dtype=np.uint8)
        elif method == "erode":
            result = np.asarray(image.filter(ImageFilter.MinFilter(size=ksize)), dtype=np.uint8)
        elif method == "open":
            eroded = image.filter(ImageFilter.MinFilter(size=ksize))
            result = np.asarray(eroded.filter(ImageFilter.MaxFilter(size=ksize)), dtype=np.uint8)
        else:
            dilated = image.filter(ImageFilter.MaxFilter(size=ksize))
            result = np.asarray(dilated.filter(ImageFilter.MinFilter(size=ksize)), dtype=np.uint8)
    if dark_is_ink:
        return np.where(result > 127, 0, 255).astype(np.uint8)
    return np.where(result > 127, 255, 0).astype(np.uint8)


def _op_deskew(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("deskew", {})
    if not bool(cfg.get("enabled", True)):
        return gray
    if cv2 is None:
        return gray

    min_fg = int(cfg.get("min_foreground_pixels", 20))
    border_value = int(cfg.get("border_value", 255))
    max_abs_angle = float(cfg.get("max_abs_angle", 8.0))
    fg = np.column_stack(np.where(gray < 250))
    if fg.shape[0] < min_fg:
        return gray

    rect = cv2.minAreaRect(fg.astype(np.float32))
    angle = rect[-1]
    if angle < -45:
        angle = 90 + angle
    elif angle > 45:
        angle = angle - 90
    # Prevent accidental 90-degree flips from unstable angle estimation.
    if abs(angle) > max_abs_angle:
        return gray
    if abs(angle) < 0.1:
        return gray

    h, w = gray.shape[:2]
    center = (w / 2.0, h / 2.0)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(
        gray,
        matrix,
        (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=border_value,
    )


def _op_normalize(value: Any, _: str, operations: dict[str, Any]) -> np.ndarray:
    gray = _ensure_gray_uint8(value)
    cfg = operations.get("normalize", {})
    if not bool(cfg.get("enabled", False)):
        return gray

    mean = float(cfg.get("mean", 0.5))
    std = max(float(cfg.get("std", 0.5)), 1e-6)
    normalized = (gray.astype(np.float32) / 255.0 - mean) / std
    # Keep output image-compatible while applying normalization effect.
    vis = np.clip((normalized + 3.0) / 6.0, 0.0, 1.0)
    return (vis * 255.0).astype(np.uint8)


OPERATIONS: dict[str, Callable[[Any, str, dict[str, Any]], np.ndarray]] = {
    "grayscale": _op_grayscale,
    "illumination": _op_illumination,
    "manual_mask_pre": _op_manual_mask_pre,
    "manual_mask_post": _op_manual_mask_post,
    "gamma": _op_gamma,
    "local_contrast": _op_local_contrast,
    "hist_equalize": _op_hist_equalize,
    "bilateral": _op_bilateral,
    "sharpen": _op_sharpen,
    "unsharp": _op_unsharp,
    "threshold": _op_threshold,
    "morph": _op_morph,
    "stroke_boost": _op_stroke_boost,
    "denoise": _op_denoise,
    "crop_margin": _op_crop_margin,
    "pad": _op_pad,
    "resize": _op_resize,
    "clahe": _op_clahe,
    "deskew": _op_deskew,
    "normalize": _op_normalize,
}


def _run_pipeline(
    img: Image.Image,
    image_type: str,
    pipeline: list[str],
    operations_cfg: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray]:
    current: Any = img
    interim_snapshot: Optional[np.ndarray] = None

    for op_name in pipeline:
        fn = OPERATIONS.get(op_name)
        if fn is None:
            raise ValueError(f"unsupported preprocess operation: {op_name}")
        before = _ensure_gray_uint8(current)
        current = fn(current, image_type, operations_cfg)
        if op_name == "normalize" and interim_snapshot is None:
            interim_snapshot = before

    processed = _ensure_gray_uint8(current)
    if interim_snapshot is None:
        interim_snapshot = processed
    return interim_snapshot, processed


def _save_meta(meta_dir: Path, file_stem: str, payload: dict[str, Any]) -> str:
    meta_dir.mkdir(parents=True, exist_ok=True)
    meta_path = meta_dir / f"{file_stem}.json"
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return str(meta_path)


def _to_data_url(gray: np.ndarray) -> str:
    image = Image.fromarray(gray, mode="L")
    with io.BytesIO() as buf:
        image.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _process_image(img: Image.Image, cfg: dict[str, Any]) -> tuple[str, np.ndarray, np.ndarray, list[str], float]:
    w, h = img.size
    ratio = (w / h) if h else 1.0
    ratio_threshold = float(cfg.get("ratio_threshold", 1.6))
    image_type = classify_image_type(img, ratio_threshold=ratio_threshold)
    pipelines = cfg.get("pipelines", {})
    pipeline = list(pipelines.get(image_type, []))
    if not pipeline:
        raise ValueError(f"pipeline is empty for type={image_type}")

    operations_cfg = cfg.get("operations", {})
    interim, processed = _run_pipeline(img, image_type, pipeline, operations_cfg)
    return image_type, interim, processed, pipeline, ratio


def preprocess_image_for_model(
    image_path: str | Path,
    overrides: Optional[dict[str, Any]] = None,
    config: Optional[dict[str, Any]] = None,
    force_image_type: Optional[str] = None,
) -> dict[str, Any]:
    cfg = copy.deepcopy(config) if isinstance(config, dict) else _build_preprocess_config(overrides)
    with Image.open(image_path) as opened:
        img = ImageOps.exif_transpose(opened)
        if force_image_type:
            forced = str(force_image_type).strip().lower()
            pipelines = cfg.get("pipelines", {})
            if forced not in pipelines:
                raise ValueError(f"invalid force_image_type: {force_image_type}")
            w, h = img.size
            ratio = (w / h) if h else 1.0
            pipeline = list(pipelines.get(forced, []))
            if not pipeline:
                raise ValueError(f"pipeline is empty for type={forced}")
            operations_cfg = cfg.get("operations", {})
            interim_arr, processed_arr = _run_pipeline(img, forced, pipeline, operations_cfg)
            image_type = forced
        else:
            image_type, interim_arr, processed_arr, pipeline, ratio = _process_image(img, cfg)
    return {
        "type": image_type,
        "ratio": ratio,
        "pipeline": pipeline,
        "interim": interim_arr,
        "processed": processed_arr,
        "config": cfg,
    }


def _process_one(file_path: Path, paths: Any, cfg: dict[str, Any]) -> dict[str, Any]:
    with Image.open(file_path) as opened:
        img = ImageOps.exif_transpose(opened)
        width, height = img.size
        image_type, interim_arr, processed_arr, pipeline, ratio = _process_image(img, cfg)

    paths.interim.mkdir(parents=True, exist_ok=True)
    processed_dir = paths.processed / image_type / "images"
    processed_dir.mkdir(parents=True, exist_ok=True)

    interim_path = paths.interim / f"{file_path.stem}.png"
    processed_path = processed_dir / f"{file_path.stem}.png"
    Image.fromarray(interim_arr, mode="L").save(interim_path)
    Image.fromarray(processed_arr, mode="L").save(processed_path)

    # If image type changed compared to past runs, remove stale processed output
    # from the opposite type to avoid confusing UI/serving paths.
    for other_type in ("single", "wide"):
        if other_type == image_type:
            continue
        stale_path = paths.processed / other_type / "images" / f"{file_path.stem}.png"
        if stale_path.exists():
            stale_path.unlink()

    meta_path = _save_meta(
        paths.processed / "meta",
        file_path.stem,
        {
            "type": image_type,
            "original_size": [width, height],
            "ratio": round(ratio, 4),
            "pipeline": pipeline,
        },
    )

    upsert_image_type(file_path.name, image_type, project_id=paths.project_id)

    return {
        "raw": file_path.name,
        "type": image_type,
        "ratio": ratio,
        "pipeline": pipeline,
        "interim": str(interim_path.relative_to(paths.root)),
        "processed": str(processed_path.relative_to(paths.root)),
        "meta": str(Path(meta_path).relative_to(paths.root)),
    }


def run_preprocess(
    project_id: Optional[str] = None,
    overrides: Optional[dict[str, Any]] = None,
    only_files: Optional[list[str]] = None,
) -> dict[str, Any]:
    paths = ensure_project_directories(project_id)
    cfg = _build_preprocess_config(overrides)
    paths.raw.mkdir(parents=True, exist_ok=True)
    include = set(only_files) if only_files is not None else None

    raw_files = []
    for path in sorted(paths.raw.iterdir()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if include is not None and path.name not in include:
            continue
        raw_files.append(path)

    results = []
    for file_path in raw_files:
        # 手動マスクは画像単位のため、1枚ごとに設定へ注入してから処理する
        attach_manual_masks_to_config(cfg, paths.project_id, file_path.name)
        results.append(_process_one(file_path, paths, cfg))

    type_counts = {"single": 0, "wide": 0}
    for row in results:
        row_type = row.get("type")
        if row_type in type_counts:
            type_counts[row_type] += 1

    return {
        "project_id": paths.project_id,
        "count": len(results),
        "type_counts": type_counts,
        "config": cfg,
        "files": results,
    }


def preview_preprocess(
    image_name: str,
    project_id: Optional[str] = None,
    overrides: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    paths = ensure_project_directories(project_id)
    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise ValueError("invalid image name")

    src = paths.raw / safe_name
    if not src.exists() or not src.is_file():
        raise FileNotFoundError(f"image not found: {safe_name}")

    cfg = _build_preprocess_config(overrides)
    attach_manual_masks_to_config(cfg, paths.project_id, safe_name)
    with Image.open(src) as opened:
        img = ImageOps.exif_transpose(opened)
        width, height = img.size
        image_type, interim_arr, processed_arr, pipeline, ratio = _process_image(img, cfg)

    preview_dir = paths.outputs / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(safe_name).stem
    interim_preview = preview_dir / f"{stem}_{image_type}_interim.png"
    processed_preview = preview_dir / f"{stem}_{image_type}_processed.png"
    Image.fromarray(interim_arr, mode="L").save(interim_preview)
    Image.fromarray(processed_arr, mode="L").save(processed_preview)

    return {
        "project_id": paths.project_id,
        "image": safe_name,
        "type": image_type,
        "original_size": [width, height],
        "ratio": round(ratio, 4),
        "pipeline": pipeline,
        "interim_preview": str(interim_preview.relative_to(paths.root)),
        "processed_preview": str(processed_preview.relative_to(paths.root)),
        "interim_data_url": _to_data_url(interim_arr),
        "processed_data_url": _to_data_url(processed_arr),
    }
