import base64
import io
import json
import os
from pathlib import Path
from typing import Any, Optional

import numpy as np
from PIL import Image, UnidentifiedImageError

from ..project_paths import ensure_project_directories, get_project_paths
from .detection_preprocess import apply_detection_preprocess

RESIZE_LONG_SIDE_OPTIONS = [640, 1280, 1536, 1920, 2048]
RESIZE_AXES = {"long", "width", "height"}
HEIF_DECODER_READY = False

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIF_DECODER_READY = True
except Exception:
    HEIF_DECODER_READY = False


def _decode_image_bytes(image_bytes: bytes) -> Image.Image:
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            return img.convert("RGB")
    except UnidentifiedImageError as e:
        hint = ""
        if not HEIF_DECODER_READY:
            hint = " (HEIC/HEIFを使う場合は pillow-heif の導入が必要です)"
        raise ValueError(f"unsupported or unreadable image format{hint}") from e


def _resize_by_axis(img: Image.Image, target_size: int, resize_axis: str) -> Image.Image:
    if target_size not in RESIZE_LONG_SIDE_OPTIONS:
        raise ValueError(f"resize_long_side must be one of {RESIZE_LONG_SIDE_OPTIONS}")
    if resize_axis not in RESIZE_AXES:
        raise ValueError("resize_axis must be one of: long, width, height")

    width, height = img.size
    if width <= 0 or height <= 0:
        raise ValueError("invalid image size")

    if resize_axis == "width":
        scale = float(target_size) / float(width)
    elif resize_axis == "height":
        scale = float(target_size) / float(height)
    else:
        scale = float(target_size) / float(max(width, height))
    target_w = max(1, int(round(width * scale)))
    target_h = max(1, int(round(height * scale)))
    return img.resize((target_w, target_h), Image.Resampling.LANCZOS)


def _prepare_image(img: Image.Image, long_side: int, use_resize: bool, resize_axis: str) -> Image.Image:
    if not use_resize:
        return img.copy()
    return _resize_by_axis(img, long_side, resize_axis)


def _image_to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _bbox_iou(a: dict[str, Any], b: dict[str, Any]) -> float:
    ax1, ay1, ax2, ay2 = float(a["x1"]), float(a["y1"]), float(a["x2"]), float(a["y2"])
    bx1, by1, bx2, by2 = float(b["x1"]), float(b["y1"]), float(b["x2"]), float(b["y2"])

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter = inter_w * inter_h
    if inter <= 0.0:
        return 0.0

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    denom = area_a + area_b - inter
    if denom <= 0.0:
        return 0.0
    return inter / denom


def _merge_overlapping_detections(
    detections: list[dict[str, Any]],
    iou_threshold: float,
    image_width: float,
    image_height: float,
) -> list[dict[str, Any]]:
    if not detections:
        return []
    if iou_threshold <= 0.0:
        return detections

    n = len(detections)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        for j in range(i + 1, n):
            if int(detections[i].get("class_id", -1)) != int(detections[j].get("class_id", -2)):
                continue
            if _bbox_iou(detections[i], detections[j]) >= iou_threshold:
                union(i, j)

    groups: dict[int, list[dict[str, Any]]] = {}
    for idx, det in enumerate(detections):
        root = find(idx)
        groups.setdefault(root, []).append(det)

    merged: list[dict[str, Any]] = []
    for group in groups.values():
        x1 = max(0.0, min(float(item["x1"]) for item in group))
        y1 = max(0.0, min(float(item["y1"]) for item in group))
        x2 = min(float(image_width), max(float(item["x2"]) for item in group))
        y2 = min(float(image_height), max(float(item["y2"]) for item in group))
        conf = max(float(item.get("confidence", 0.0)) for item in group)
        first = group[0]
        merged.append(
            {
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "width": max(0.0, x2 - x1),
                "height": max(0.0, y2 - y1),
                "confidence": round(conf, 4),
                "label": str(first.get("label", "")),
                "class_id": int(first.get("class_id", 0)),
                "selected": True,
            }
        )

    merged.sort(key=lambda row: (float(row.get("y1", 0.0)), float(row.get("x1", 0.0))))
    for idx, row in enumerate(merged, start=1):
        row["id"] = idx
    return merged


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


def make_resize_preview(
    image_bytes: bytes,
    long_side: int,
    use_resize: bool = True,
    resize_axis: str = "long",
    detect_preprocess: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    original = _decode_image_bytes(image_bytes)
    if detect_preprocess:
        original = apply_detection_preprocess(original, detect_preprocess)
    resized = _prepare_image(original, long_side, use_resize, resize_axis)
    return {
        "use_resize": bool(use_resize),
        "resize_long_side": long_side,
        "resize_axis": resize_axis,
        "original_size": [original.width, original.height],
        "resized_size": [resized.width, resized.height],
        "image_data_url": _image_to_data_url(resized),
    }


def detect_bboxes_with_yolo(
    image_bytes: bytes,
    long_side: int,
    use_resize: bool,
    resize_axis: str,
    model_name: str,
    conf_threshold: float,
    merge_overlaps: bool,
    merge_iou_threshold: float,
    project_id: str,
    detect_preprocess: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    if not (0.0 <= float(conf_threshold) <= 1.0):
        raise ValueError("conf_threshold must be between 0 and 1")
    if not (0.0 <= float(merge_iou_threshold) <= 1.0):
        raise ValueError("merge_iou_threshold must be between 0 and 1")

    original = _decode_image_bytes(image_bytes)
    # 検出前処理はリサイズ前に適用（プレビュー・出力と同一の座標系を保つ）
    if detect_preprocess:
        original = apply_detection_preprocess(original, detect_preprocess)
    resized = _prepare_image(original, long_side, use_resize, resize_axis)
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

    raw_count = len(detections)
    if merge_overlaps:
        detections = _merge_overlapping_detections(
            detections,
            iou_threshold=float(merge_iou_threshold),
            image_width=float(resized.width),
            image_height=float(resized.height),
        )
    merged_count = len(detections)

    return {
        "use_resize": bool(use_resize),
        "resize_long_side": long_side,
        "resize_axis": resize_axis,
        "model": model_name,
        "resolved_model": resolved_model,
        "conf_threshold": float(conf_threshold),
        "merge_overlaps": bool(merge_overlaps),
        "merge_iou_threshold": float(merge_iou_threshold),
        "original_size": [original.width, original.height],
        "resized_size": [resized.width, resized.height],
        "image_data_url": _image_to_data_url(resized),
        "raw_count": raw_count,
        "merged_count": merged_count,
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
    resize_axis: str,
    boxes_json: str,
    output_dir: str,
    crop_height: int = 32,
    detect_preprocess: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    if crop_height <= 0:
        raise ValueError("crop_height must be positive")

    selected_boxes = _parse_boxes_json(boxes_json)
    if not selected_boxes:
        raise ValueError("no selected bbox")

    out_dir = Path(output_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    source = _decode_image_bytes(image_bytes)
    # 検出時と同じ前処理を適用してBBOX座標系を一致させる（クロップ処理自体は従来どおり）
    if detect_preprocess:
        source = apply_detection_preprocess(source, detect_preprocess)
    resized = _prepare_image(source, long_side, use_resize, resize_axis)

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
        "resize_axis": resize_axis,
        "output_dir": str(out_dir.resolve()),
        "count": total,
        "digits": digits,
        "crop_height": int(crop_height),
        "resized_size": [resized.width, resized.height],
        "files": outputs,
    }
