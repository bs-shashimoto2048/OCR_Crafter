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


def apply_detection_preprocess(image: Image.Image, settings: Optional[dict]) -> Image.Image:
    """回転 → トリミング → 明るさ → コントラスト → シャープ → リサイズ → グレースケール の順で適用。"""
    s = normalize_detection_preprocess(settings)
    result = image.convert("RGB")

    if s["rotation"]:
        # UI上の角度（時計回り）に合わせる。PIL.rotate は反時計回りのため負値で回転
        result = result.rotate(-s["rotation"], expand=True)

    width, height = result.size
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
    if (x1, y1, x2, y2) != (0, 0, width, height):
        result = result.crop((x1, y1, x2, y2))

    if abs(s["brightness"] - 1.0) > 1e-6:
        result = ImageEnhance.Brightness(result).enhance(s["brightness"])
    if abs(s["contrast"] - 1.0) > 1e-6:
        result = ImageEnhance.Contrast(result).enhance(s["contrast"])
    if s["sharpen"] and s["sharpen_strength"] > 0:
        result = ImageEnhance.Sharpness(result).enhance(1.0 + s["sharpen_strength"])

    target_w = s["resize_width"]
    target_h = s["resize_height"]
    if target_w or target_h:
        cur_w, cur_h = result.size
        if s["keep_aspect_ratio"]:
            if target_w and target_h:
                scale = min(target_w / cur_w, target_h / cur_h)
            elif target_w:
                scale = target_w / cur_w
            else:
                scale = target_h / cur_h
            new_size = (max(1, int(round(cur_w * scale))), max(1, int(round(cur_h * scale))))
        else:
            new_size = (max(1, int(target_w or cur_w)), max(1, int(target_h or cur_h)))
        if new_size != result.size:
            result = result.resize(new_size, Image.Resampling.LANCZOS)

    if s["grayscale"]:
        result = result.convert("L").convert("RGB")

    return result
