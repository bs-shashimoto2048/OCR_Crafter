import base64
import io
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ..project_paths import ensure_project_directories, get_project_paths

RESIZE_LONG_SIDE_OPTIONS = [640, 1280, 1536, 1920, 2048]


def _decode_image_bytes(image_bytes: bytes) -> Image.Image:
    with Image.open(io.BytesIO(image_bytes)) as img:
        return img.convert("RGB")


def _resize_by_long_side(img: Image.Image, long_side: int) -> Image.Image:
    if long_side not in RESIZE_LONG_SIDE_OPTIONS:
        raise ValueError(f"resize_long_side must be one of {RESIZE_LONG_SIDE_OPTIONS}")

    width, height = img.size
    if width <= 0 or height <= 0:
        raise ValueError("invalid image size")

    scale = float(long_side) / float(max(width, height))
    target_w = max(1, int(round(width * scale)))
    target_h = max(1, int(round(height * scale)))
    return img.resize((target_w, target_h), Image.Resampling.LANCZOS)


def _prepare_image(img: Image.Image, long_side: int, use_resize: bool) -> Image.Image:
    if not use_resize:
        return img.copy()
    return _resize_by_long_side(img, long_side)


def _image_to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _resolve_model_name(model_name: str, project_id: str) -> str:
    candidate = (model_name or "").strip()
    if not candidate:
        raise ValueError("model is required")

    if Path(candidate).exists():
        return str(Path(candidate).resolve())

    paths = get_project_paths(project_id)
    model_dir = paths.models / "yolo"
    model_path = model_dir / candidate
    if model_path.exists():
        return str(model_path.resolve())

    return candidate


def _load_ultralytics_yolo() -> Any:
    try:
        from ultralytics import YOLO  # type: ignore

        return YOLO
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            "ultralytics is not installed. Please run: pip install ultralytics"
        ) from e


def list_yolo_models(project_id: str) -> dict[str, Any]:
    paths = get_project_paths(project_id)
    yolo_dir = paths.models / "yolo"
    local_models = sorted([p.name for p in yolo_dir.glob("*.pt") if p.is_file()]) if yolo_dir.exists() else []
    builtins = ["yolo11n.pt", "yolov8n.pt", "yolov8s.pt"]

    return {
        "project_id": project_id,
        "local_dir": str(yolo_dir.resolve()),
        "builtin_models": builtins,
        "local_models": local_models,
        "items": builtins + local_models,
    }


def make_resize_preview(image_bytes: bytes, long_side: int, use_resize: bool = True) -> dict[str, Any]:
    original = _decode_image_bytes(image_bytes)
    resized = _prepare_image(original, long_side, use_resize)
    return {
        "use_resize": bool(use_resize),
        "resize_long_side": long_side,
        "original_size": [original.width, original.height],
        "resized_size": [resized.width, resized.height],
        "image_data_url": _image_to_data_url(resized),
    }


def detect_bboxes_with_yolo(
    image_bytes: bytes,
    long_side: int,
    use_resize: bool,
    model_name: str,
    conf_threshold: float,
    project_id: str,
) -> dict[str, Any]:
    if not (0.0 <= float(conf_threshold) <= 1.0):
        raise ValueError("conf_threshold must be between 0 and 1")

    original = _decode_image_bytes(image_bytes)
    resized = _prepare_image(original, long_side, use_resize)
    image_np = np.array(resized)

    # Keep ultralytics settings writable within the project workspace.
    paths = ensure_project_directories(project_id)
    yolo_config_dir = paths.outputs / "ultralytics"
    yolo_config_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_CONFIG_DIR", str(yolo_config_dir.resolve()))

    resolved_model = _resolve_model_name(model_name, project_id)
    YOLO = _load_ultralytics_yolo()
    model = YOLO(resolved_model)
    result = model.predict(source=image_np, conf=float(conf_threshold), verbose=False)[0]

    detections: list[dict[str, Any]] = []
    boxes = result.boxes
    names = result.names or {}
    if boxes is not None and len(boxes) > 0:
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        classes = boxes.cls.cpu().numpy() if boxes.cls is not None else np.zeros((len(xyxy),), dtype=float)
        for idx, (coords, conf, cls_id) in enumerate(zip(xyxy, confs, classes), start=1):
            x1, y1, x2, y2 = [float(v) for v in coords.tolist()]
            cls_int = int(cls_id)
            detections.append(
                {
                    "id": idx,
                    "x1": max(0.0, x1),
                    "y1": max(0.0, y1),
                    "x2": min(float(resized.width), x2),
                    "y2": min(float(resized.height), y2),
                    "width": max(0.0, x2 - x1),
                    "height": max(0.0, y2 - y1),
                    "confidence": round(float(conf), 4),
                    "label": str(names.get(cls_int, cls_int)),
                    "class_id": cls_int,
                    "selected": True,
                }
            )

    return {
        "use_resize": bool(use_resize),
        "resize_long_side": long_side,
        "model": model_name,
        "resolved_model": resolved_model,
        "conf_threshold": float(conf_threshold),
        "original_size": [original.width, original.height],
        "resized_size": [resized.width, resized.height],
        "image_data_url": _image_to_data_url(resized),
        "detections": detections,
        "count": len(detections),
    }


def _parse_boxes_json(boxes_json: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(boxes_json or "[]")
    except json.JSONDecodeError as e:
        raise ValueError("invalid boxes_json") from e
    if not isinstance(parsed, list):
        raise ValueError("boxes_json must be an array")
    boxes: list[dict[str, Any]] = []
    for row in parsed:
        if not isinstance(row, dict):
            continue
        boxes.append(row)
    return boxes


def _crop_and_resize(img: Image.Image, box: dict[str, Any], height: int) -> Image.Image:
    width, img_h = img.size
    x1 = int(max(0, round(float(box.get("x1", 0)))))
    y1 = int(max(0, round(float(box.get("y1", 0)))))
    x2 = int(min(width, round(float(box.get("x2", 0)))))
    y2 = int(min(img_h, round(float(box.get("y2", 0)))))
    if x2 <= x1 or y2 <= y1:
        raise ValueError("invalid bbox")

    crop = img.crop((x1, y1, x2, y2))
    c_w, c_h = crop.size
    target_h = max(1, int(height))
    target_w = max(1, int(round(c_w * (target_h / float(c_h)))))
    return crop.resize((target_w, target_h), Image.Resampling.LANCZOS)


def export_selected_crops(
    image_bytes: bytes,
    long_side: int,
    use_resize: bool,
    boxes_json: str,
    output_dir: str,
    crop_height: int = 32,
) -> dict[str, Any]:
    if crop_height <= 0:
        raise ValueError("crop_height must be positive")

    selected_boxes = _parse_boxes_json(boxes_json)
    if not selected_boxes:
        raise ValueError("no selected bbox")

    out_dir = Path(output_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    source = _decode_image_bytes(image_bytes)
    resized = _prepare_image(source, long_side, use_resize)

    total = len(selected_boxes)
    digits = len(str(total))
    outputs: list[str] = []
    for idx, box in enumerate(selected_boxes, start=1):
        cropped = _crop_and_resize(resized, box, crop_height)
        filename = f"{idx:0{digits}d}.png"
        target = out_dir / filename
        cropped.save(target, format="PNG")
        outputs.append(str(target.resolve()))

    return {
        "use_resize": bool(use_resize),
        "output_dir": str(out_dir.resolve()),
        "count": total,
        "digits": digits,
        "crop_height": int(crop_height),
        "resized_size": [resized.width, resized.height],
        "files": outputs,
    }
