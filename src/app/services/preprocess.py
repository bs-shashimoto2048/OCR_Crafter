from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
from PIL import Image, ImageOps

from ..config import get_settings
from ..paths import IMAGE_EXTENSIONS
from ..project_paths import ensure_project_directories


def _merge_preprocess_config(overrides: Optional[dict[str, Any]]) -> dict[str, Any]:
    base = get_settings().get("preprocess", {})

    cfg = {
        "grayscale": dict(base.get("grayscale", {})),
        "resize": dict(base.get("resize", {})),
        "padding": dict(base.get("padding", {})),
        "normalize": dict(base.get("normalize", {})),
    }

    if not overrides:
        return cfg

    mapping = {
        "grayscale_enabled": ("grayscale", "enabled"),
        "resize_enabled": ("resize", "enabled"),
        "resize_width": ("resize", "width"),
        "resize_height": ("resize", "height"),
        "padding_enabled": ("padding", "enabled"),
        "padding_fill": ("padding", "fill"),
        "normalize_enabled": ("normalize", "enabled"),
        "normalize_mean": ("normalize", "mean"),
        "normalize_std": ("normalize", "std"),
    }

    for key, value in overrides.items():
        if value is None or key not in mapping:
            continue
        section, name = mapping[key]
        cfg[section][name] = value

    return cfg


def _pad_to_square(image: Image.Image, fill: int = 255) -> Image.Image:
    w, h = image.size
    if w == h:
        return image
    size = max(w, h)
    pad_left = (size - w) // 2
    pad_top = (size - h) // 2
    pad_right = size - w - pad_left
    pad_bottom = size - h - pad_top
    return ImageOps.expand(image, border=(pad_left, pad_top, pad_right, pad_bottom), fill=fill)


def _process_one(file_path: Path, interim_dir: Path, processed_dir: Path, cfg: dict[str, Any]) -> tuple[str, str]:
    image = Image.open(file_path)

    if cfg["grayscale"].get("enabled", True):
        image = image.convert("L")

    if cfg["padding"].get("enabled", True):
        fill = int(cfg["padding"].get("fill", 255))
        image = _pad_to_square(image, fill=fill)

    if cfg["resize"].get("enabled", True):
        width = int(cfg["resize"].get("width", 64))
        height = int(cfg["resize"].get("height", 64))
        image = image.resize((width, height))

    interim_dir.mkdir(parents=True, exist_ok=True)
    processed_dir.mkdir(parents=True, exist_ok=True)

    interim_path = interim_dir / f"{file_path.stem}.png"
    image.save(interim_path)

    arr = np.asarray(image).astype(np.float32) / 255.0
    if arr.ndim == 2:
        arr = arr[None, :, :]
    else:
        arr = arr.transpose(2, 0, 1)

    if cfg["normalize"].get("enabled", True):
        mean = float(cfg["normalize"].get("mean", 0.5))
        std = float(cfg["normalize"].get("std", 0.5))
        arr = (arr - mean) / max(std, 1e-6)

    tensor = torch.tensor(arr, dtype=torch.float32)
    processed_path = processed_dir / f"{file_path.stem}.pt"
    torch.save(tensor, processed_path)

    return interim_path.name, processed_path.name


def run_preprocess(project_id: Optional[str] = None, overrides: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    paths = ensure_project_directories(project_id)
    cfg = _merge_preprocess_config(overrides)
    paths.raw.mkdir(parents=True, exist_ok=True)

    raw_files = [p for p in sorted(paths.raw.iterdir()) if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS]
    results = []

    for file_path in raw_files:
        interim_name, processed_name = _process_one(file_path, paths.interim, paths.processed, cfg)
        results.append({"raw": file_path.name, "interim": interim_name, "processed": processed_name})

    return {"project_id": paths.project_id, "count": len(results), "config": cfg, "files": results}
