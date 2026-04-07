from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageFilter, ImageOps

try:
    import cv2  # type: ignore
except Exception:  # noqa: BLE001
    cv2 = None


@dataclass
class PreprocessResult:
    interim: Image.Image
    processed: Image.Image


def _to_gray_np(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("L"), dtype=np.uint8)


def _otsu_threshold(gray: np.ndarray) -> np.ndarray:
    if cv2 is not None:
        _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return th

    # numpy fallback for Otsu threshold
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


def _median_blur(gray: np.ndarray, ksize: int = 3) -> np.ndarray:
    if cv2 is not None:
        return cv2.medianBlur(gray, ksize)
    pil = Image.fromarray(gray, mode="L").filter(ImageFilter.MedianFilter(size=ksize))
    return np.asarray(pil, dtype=np.uint8)


def _clahe(gray: np.ndarray) -> np.ndarray:
    if cv2 is not None:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        return clahe.apply(gray)
    pil = Image.fromarray(gray, mode="L")
    return np.asarray(ImageOps.autocontrast(pil), dtype=np.uint8)


def _deskew(binary: np.ndarray) -> np.ndarray:
    if cv2 is None:
        return binary

    fg = np.column_stack(np.where(binary < 250))
    if fg.shape[0] < 20:
        return binary

    rect = cv2.minAreaRect(fg.astype(np.float32))
    angle = rect[-1]
    if angle < -45:
        angle = 90 + angle
    if abs(angle) < 0.1:
        return binary

    h, w = binary.shape[:2]
    center = (w / 2.0, h / 2.0)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(
        binary,
        matrix,
        (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=255,
    )


def _pad_to_square(gray: np.ndarray, fill: int = 255) -> np.ndarray:
    h, w = gray.shape[:2]
    size = max(h, w)
    out = np.full((size, size), fill, dtype=np.uint8)
    y = (size - h) // 2
    x = (size - w) // 2
    out[y : y + h, x : x + w] = gray
    return out


def _resize(gray: np.ndarray, width: int, height: int) -> np.ndarray:
    if cv2 is not None:
        return cv2.resize(gray, (width, height), interpolation=cv2.INTER_AREA)
    return np.asarray(Image.fromarray(gray, mode="L").resize((width, height), Image.Resampling.LANCZOS), dtype=np.uint8)


def _normalize_to_uint8(gray: np.ndarray) -> np.ndarray:
    normalized = gray.astype(np.float32) / 255.0
    return np.clip(normalized * 255.0, 0, 255).astype(np.uint8)


def preprocess_single_image(img: Image.Image, size: int = 64) -> PreprocessResult:
    gray = _to_gray_np(img)
    th = _otsu_threshold(gray)
    denoised = _median_blur(th, ksize=3)
    squared = _pad_to_square(denoised, fill=255)
    resized = _resize(squared, size, size)
    normalized = _normalize_to_uint8(resized)

    return PreprocessResult(interim=Image.fromarray(resized, mode="L"), processed=Image.fromarray(normalized, mode="L"))


def preprocess_wide_image(img: Image.Image, height: int = 32, keep_ratio: bool = True) -> PreprocessResult:
    gray = _to_gray_np(img)
    enhanced = _clahe(gray)
    th = _otsu_threshold(enhanced)
    corrected = _deskew(th)

    src_h, src_w = corrected.shape[:2]
    target_h = max(1, int(height))
    if keep_ratio:
        target_w = max(1, int(round(src_w * (target_h / max(src_h, 1)))))
    else:
        target_w = max(1, int(src_w))

    resized = _resize(corrected, target_w, target_h)
    denoised = _median_blur(resized, ksize=3)

    return PreprocessResult(
        interim=Image.fromarray(corrected, mode="L"),
        processed=Image.fromarray(denoised, mode="L"),
    )
