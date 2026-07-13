"""物体検出（YOLO）専用の画像前処理。

OCR前処理（preprocess.py / ocr_pipeline.py）とは独立した設定・処理系。
学習画像作成と将来の本番推論で同じ設定dictと apply_detection_preprocess() を共通利用する。
"""

import json
from typing import Any, Optional

from PIL import Image, ImageEnhance

DETECTION_PREPROCESS_DEFAULTS: dict[str, Any] = {
    "rotation": 0,
    "crop_unit": "px",  # px | percent
    "crop_top": 0,
    "crop_bottom": 0,
    "crop_left": 0,
    "crop_right": 0,
    "brightness": 1.0,
    "contrast": 1.0,
    "sharpen": False,
    "sharpen_strength": 1.0,
    "resize_width": None,
    "resize_height": None,
    "keep_aspect_ratio": True,
    "grayscale": False,
}


def normalize_detection_preprocess(settings: Optional[dict]) -> dict[str, Any]:
    merged = {**DETECTION_PREPROCESS_DEFAULTS, **(settings or {})}
    rotation = int(merged.get("rotation") or 0) % 360
    if rotation not in (0, 90, 180, 270):
        rotation = 0
    merged["rotation"] = rotation
    merged["crop_unit"] = "percent" if str(merged.get("crop_unit")) == "percent" else "px"
    for key in ("crop_top", "crop_bottom", "crop_left", "crop_right"):
        merged[key] = max(0.0, float(merged.get(key) or 0))
    merged["brightness"] = max(0.05, float(merged.get("brightness") or 1.0))
    merged["contrast"] = max(0.05, float(merged.get("contrast") or 1.0))
    merged["sharpen"] = bool(merged.get("sharpen"))
    merged["sharpen_strength"] = max(0.0, float(merged.get("sharpen_strength") or 1.0))
    for key in ("resize_width", "resize_height"):
        value = merged.get(key)
        try:
            number = int(value) if value not in (None, "", 0, "0") else None
        except (TypeError, ValueError):
            number = None
        merged[key] = number if number and number > 0 else None
    merged["keep_aspect_ratio"] = bool(merged.get("keep_aspect_ratio", True))
    merged["grayscale"] = bool(merged.get("grayscale"))
    return merged


def is_detection_preprocess_noop(settings: Optional[dict]) -> bool:
    s = normalize_detection_preprocess(settings)
    return (
        s["rotation"] == 0
        and s["crop_top"] == 0
        and s["crop_bottom"] == 0
        and s["crop_left"] == 0
        and s["crop_right"] == 0
        and abs(s["brightness"] - 1.0) < 1e-6
        and abs(s["contrast"] - 1.0) < 1e-6
        and not s["sharpen"]
        and s["resize_width"] is None
        and s["resize_height"] is None
        and not s["grayscale"]
    )


def parse_detection_preprocess_json(raw: Optional[str]) -> Optional[dict[str, Any]]:
    """フォーム文字列から設定を復元。空・不正・無変換設定なら None（=従来どおり元画像を使用）。"""
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        payload = json.loads(text)
    except (TypeError, ValueError) as e:
        raise ValueError(f"invalid detect_preprocess_json: {e}") from e
    if not isinstance(payload, dict):
        raise ValueError("detect_preprocess_json must be an object")
    settings = normalize_detection_preprocess(payload)
    if is_detection_preprocess_noop(settings):
        return None
    return settings


def _crop_box_for(settings: dict, width: int, height: int) -> tuple[int, int, int, int]:
    """回転後サイズ (width, height) に対するトリミング範囲。apply と逆変換で同一計算を共有する。"""
    s = settings
    if s["crop_unit"] == "percent":
        left = int(width * s["crop_left"] / 100.0)
        right = int(width * s["crop_right"] / 100.0)
        top = int(height * s["crop_top"] / 100.0)
        bottom = int(height * s["crop_bottom"] / 100.0)
    else:
        left = int(s["crop_left"])
        right = int(s["crop_right"])
        top = int(s["crop_top"])
        bottom = int(s["crop_bottom"])
    x1 = min(left, max(0, width - 1))
    y1 = min(top, max(0, height - 1))
    x2 = max(x1 + 1, width - right)
    y2 = max(y1 + 1, height - bottom)
    return x1, y1, x2, y2


def _resize_size_for(settings: dict, width: int, height: int) -> tuple[int, int]:
    """トリミング後サイズ (width, height) に対するリサイズ後サイズ。指定なしなら同値。"""
    target_w = settings["resize_width"]
    target_h = settings["resize_height"]
    if not target_w and not target_h:
        return width, height
    if settings["keep_aspect_ratio"]:
        if target_w and target_h:
            scale = min(target_w / width, target_h / height)
        elif target_w:
            scale = target_w / width
        else:
            scale = target_h / height
        return max(1, int(round(width * scale))), max(1, int(round(height * scale)))
    return max(1, int(target_w or width)), max(1, int(target_h or height))


def detection_preprocess_geometry(settings: Optional[dict], original_size: tuple[int, int]) -> dict[str, Any]:
    """座標に影響する工程（回転→トリミング→リサイズ）の幾何情報。"""
    s = normalize_detection_preprocess(settings)
    orig_w, orig_h = int(original_size[0]), int(original_size[1])
    rot_w, rot_h = (orig_h, orig_w) if s["rotation"] in (90, 270) else (orig_w, orig_h)
    crop_box = _crop_box_for(s, rot_w, rot_h)
    crop_w = crop_box[2] - crop_box[0]
    crop_h = crop_box[3] - crop_box[1]
    out_w, out_h = _resize_size_for(s, crop_w, crop_h)
    return {
        "settings": s,
        "original_size": (orig_w, orig_h),
        "rotated_size": (rot_w, rot_h),
        "crop_box": crop_box,
        "cropped_size": (crop_w, crop_h),
        "output_size": (out_w, out_h),
    }


def apply_detection_preprocess(image: Image.Image, settings: Optional[dict]) -> Image.Image:
    """回転 → トリミング → 明るさ → コントラスト → シャープ → リサイズ → グレースケール の順で適用。"""
    s = normalize_detection_preprocess(settings)
    geometry = detection_preprocess_geometry(s, image.size)
    result = image.convert("RGB")

    if s["rotation"]:
        # UI上の角度（時計回り）に合わせる。PIL.rotate は反時計回りのため負値で回転
        result = result.rotate(-s["rotation"], expand=True)

    crop_box = geometry["crop_box"]
    if crop_box != (0, 0, result.width, result.height):
        result = result.crop(crop_box)

    if abs(s["brightness"] - 1.0) > 1e-6:
        result = ImageEnhance.Brightness(result).enhance(s["brightness"])
    if abs(s["contrast"] - 1.0) > 1e-6:
        result = ImageEnhance.Contrast(result).enhance(s["contrast"])
    if s["sharpen"] and s["sharpen_strength"] > 0:
        result = ImageEnhance.Sharpness(result).enhance(1.0 + s["sharpen_strength"])

    output_size = geometry["output_size"]
    if output_size != result.size:
        result = result.resize(output_size, Image.Resampling.LANCZOS)

    if s["grayscale"]:
        result = result.convert("L").convert("RGB")

    return result


def invert_detection_bbox(
    bbox: tuple[float, float, float, float],
    settings: Optional[dict],
    original_size: tuple[int, int],
) -> Optional[tuple[float, float, float, float]]:
    """前処理後画像上のBBOXを元画像座標へ逆変換する（リサイズ逆→トリミング逆→回転逆）。

    元画像範囲へクランプし、有効な面積が残らない場合は None を返す（呼び出し側でスキップ扱い）。
    """
    geometry = detection_preprocess_geometry(settings, original_size)
    s = geometry["settings"]
    orig_w, orig_h = geometry["original_size"]
    crop_x1, crop_y1, _, _ = geometry["crop_box"]
    crop_w, crop_h = geometry["cropped_size"]
    out_w, out_h = geometry["output_size"]

    x1, y1, x2, y2 = [float(v) for v in bbox]

    # 1) リサイズの逆変換
    scale_x = out_w / crop_w if crop_w > 0 else 1.0
    scale_y = out_h / crop_h if crop_h > 0 else 1.0
    x1, x2 = x1 / scale_x, x2 / scale_x
    y1, y2 = y1 / scale_y, y2 / scale_y

    # 2) トリミングオフセットの復元（回転後座標系へ）
    x1 += crop_x1
    x2 += crop_x1
    y1 += crop_y1
    y2 += crop_y1

    # 3) 回転の逆変換（回転後座標系 → 元画像座標系）
    rotation = s["rotation"]

    def unrotate(px: float, py: float) -> tuple[float, float]:
        if rotation == 90:
            # 時計回り90: (x0, y0) -> (H0 - y0, x0) の逆
            return py, float(orig_h) - px
        if rotation == 180:
            return float(orig_w) - px, float(orig_h) - py
        if rotation == 270:
            # 時計回り270: (x0, y0) -> (y0, W0 - x0) の逆
            return float(orig_w) - py, px
        return px, py

    corners = [unrotate(x1, y1), unrotate(x2, y2)]
    x1 = min(c[0] for c in corners)
    x2 = max(c[0] for c in corners)
    y1 = min(c[1] for c in corners)
    y2 = max(c[1] for c in corners)

    # 4) 元画像範囲へクランプ
    x1 = max(0.0, min(x1, float(orig_w)))
    x2 = max(0.0, min(x2, float(orig_w)))
    y1 = max(0.0, min(y1, float(orig_h)))
    y2 = max(0.0, min(y2, float(orig_h)))
    if x2 - x1 < 1.0 or y2 - y1 < 1.0:
        return None
    return x1, y1, x2, y2
