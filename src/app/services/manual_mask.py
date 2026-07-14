"""OCR前処理: 手動マスク補正（画像単位）。

画像上の不要な黒塊・影領域を、矩形またはクリック点の黒連結領域として登録し、
白または周辺背景色で塗りつぶす。元画像ファイルは変更しない。
YOLO検出前処理（detection_preprocess.py）とは独立した機能。

保存形式（data/projects/<id>/annotations/manual_masks.json）:
{
  "01.png": {
    "manual_masks": [
      {"type": "rect", "x": 0.02, "y": 0.62, "width": 0.18, "height": 0.35, "enabled": true},
      {"type": "region", "rle": [[y, x1, x2], ...], "source_size": [w, h],
       "area_px": 2184, "enabled": true}
    ]
  }
}

region の座標は「行RLE」（各行の連結範囲 [y, x_start, x_end_exclusive]）で保存する。
可逆・実装が単純・影ブロック程度なら数KBに収まるため採用（要件11の選択肢2/3より軽実装）。
"""

import json
from pathlib import Path
from typing import Any, Optional

import numpy as np

from ..project_paths import ensure_project_directories

MANUAL_MASK_FILENAME = "manual_masks.json"
# ポイント指定でこの割合を超える領域は警告扱い（自動確定しない）
LARGE_REGION_RATIO = 0.25
# ノイズ除去: この画素数未満の領域は候補にしない
MIN_REGION_AREA_PX = 4


def _masks_path(project_id: Optional[str]) -> Path:
    paths = ensure_project_directories(project_id)
    return paths.annotations_dir / MANUAL_MASK_FILENAME


def load_manual_masks(project_id: Optional[str]) -> dict[str, Any]:
    path = _masks_path(project_id)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, ValueError):
        # 破損時は空として扱う（既存画像処理を止めない）
        return {}


def save_manual_masks_for_image(project_id: Optional[str], image_name: str, masks: list[dict]) -> dict[str, Any]:
    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise ValueError("invalid image name")
    data = load_manual_masks(project_id)
    if masks:
        data[safe_name] = {"manual_masks": masks}
    else:
        data.pop(safe_name, None)
    path = _masks_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return data


def _region_bool_mask(mask_entry: dict, height: int, width: int) -> np.ndarray:
    """行RLE を bool マスクへ展開（保存時サイズと異なる場合はスケール変換）。"""
    result = np.zeros((height, width), dtype=bool)
    rle = mask_entry.get("rle") or []
    source = mask_entry.get("source_size") or [width, height]
    src_w = max(1, int(source[0]))
    src_h = max(1, int(source[1]))
    scale_x = width / src_w
    scale_y = height / src_h
    for run in rle:
        if not isinstance(run, (list, tuple)) or len(run) != 3:
            continue
        y = int(round(int(run[0]) * scale_y))
        x1 = int(round(int(run[1]) * scale_x))
        x2 = int(round(int(run[2]) * scale_x))
        if 0 <= y < height:
            result[y, max(0, x1) : min(width, max(x1 + 1, x2))] = True
    return result


def _mask_bool_for_entry(entry: dict, height: int, width: int) -> Optional[np.ndarray]:
    kind = str(entry.get("type") or "")
    if kind == "rect":
        x1 = int(round(float(entry.get("x", 0)) * width))
        y1 = int(round(float(entry.get("y", 0)) * height))
        x2 = int(round((float(entry.get("x", 0)) + float(entry.get("width", 0))) * width))
        y2 = int(round((float(entry.get("y", 0)) + float(entry.get("height", 0))) * height))
        x1 = max(0, min(x1, width))
        x2 = max(0, min(x2, width))
        y1 = max(0, min(y1, height))
        y2 = max(0, min(y2, height))
        if x2 <= x1 or y2 <= y1:
            return None
        mask = np.zeros((height, width), dtype=bool)
        mask[y1:y2, x1:x2] = True
        return mask
    if kind == "region":
        mask = _region_bool_mask(entry, height, width)
        return mask if mask.any() else None
    return None


def _background_fill_value(image: np.ndarray, mask: np.ndarray) -> Any:
    """マスク外周（数px膨張した縁）の中央値で背景色を推定する。"""
    from scipy import ndimage

    ring = ndimage.binary_dilation(mask, iterations=3) & ~mask
    if not ring.any():
        ring = ~mask
    if not ring.any():
        return 255
    if image.ndim == 3:
        return [int(np.median(image[..., c][ring])) for c in range(image.shape[2])]
    return int(np.median(image[ring]))


def apply_manual_masks(image: np.ndarray, masks: list[dict], fill_mode: str = "white") -> np.ndarray:
    """有効なマスクを塗りつぶして返す（入力は変更しない）。グレー/RGB両対応。"""
    if not masks:
        return image
    result = np.array(image, copy=True)
    height, width = result.shape[:2]
    fill = str(fill_mode or "white")
    for entry in masks:
        if not isinstance(entry, dict) or entry.get("enabled") is False:
            continue
        mask = _mask_bool_for_entry(entry, height, width)
        if mask is None:
            continue
        if fill == "background":
            value = _background_fill_value(result, mask)
        else:
            value = [255] * result.shape[2] if result.ndim == 3 else 255
        result[mask] = value
    return result


def mask_to_rle(mask: np.ndarray) -> list[list[int]]:
    """bool マスク → 行RLE [[y, x_start, x_end_exclusive], ...]"""
    runs: list[list[int]] = []
    for y in range(mask.shape[0]):
        row = mask[y]
        if not row.any():
            continue
        diff = np.diff(row.astype(np.int8))
        starts = list(np.where(diff == 1)[0] + 1)
        ends = list(np.where(diff == -1)[0] + 1)
        if row[0]:
            starts.insert(0, 0)
        if row[-1]:
            ends.append(len(row))
        for x1, x2 in zip(starts, ends):
            runs.append([int(y), int(x1), int(x2)])
    return runs


def extract_black_region(
    gray: np.ndarray,
    x_norm: float,
    y_norm: float,
    threshold: int = 80,
) -> dict[str, Any]:
    """クリック点（正規化座標）が属する黒連結領域を8近傍で抽出する。

    黒判定は固定しきい値方式（画素値 <= threshold）。対象が「二値化後も黒く残る
    明確に暗いブロック」であり、スライダーで直感的に調整できるため採用。
    """
    from scipy import ndimage

    height, width = gray.shape[:2]
    x = int(x_norm * width)
    y = int(y_norm * height)
    if not (0 <= x < width and 0 <= y < height):
        return {"found": False, "reason": "画像外の位置です"}

    clicked_value = int(gray[y, x])
    if clicked_value > int(threshold):
        return {
            "found": False,
            "reason": f"クリック位置は黒判定しきい値({threshold})より明るい画素です（値: {clicked_value}）",
        }

    binary = gray <= int(threshold)
    labeled, _ = ndimage.label(binary, structure=np.ones((3, 3), dtype=int))  # 8近傍
    region_label = labeled[y, x]
    if region_label == 0:
        return {"found": False, "reason": "黒領域が見つかりませんでした"}

    mask = labeled == region_label
    area = int(mask.sum())
    if area < MIN_REGION_AREA_PX:
        return {"found": False, "reason": f"領域が小さすぎます（{area}px）"}

    ratio = area / float(height * width)
    ys, xs = np.nonzero(mask)
    return {
        "found": True,
        "rle": mask_to_rle(mask),
        "source_size": [width, height],
        "area_px": area,
        "area_ratio": round(ratio, 4),
        "bbox": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
        "too_large": ratio >= LARGE_REGION_RATIO,
        "touches_edge": bool(ys.min() == 0 or xs.min() == 0 or ys.max() == height - 1 or xs.max() == width - 1),
    }
