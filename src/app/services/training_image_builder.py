import base64
import io
import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Optional

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from ..paths import PROJECT_ROOT
from ..project_paths import ensure_project_directories, get_project_paths
from .detection_preprocess import (
    apply_detection_preprocess,
    invert_detection_bbox,
    is_detection_preprocess_noop,
)

# 全プロジェクト共通のYOLOモデル置き場（リポジトリ直下 models/yolo）。
# プロジェクト内 data/projects/<id>/models/yolo が優先され、ここは共通モデルの検索先として追加される
COMMON_YOLO_MODELS_DIR = PROJECT_ROOT / "models" / "yolo"

# Ultralytics標準モデルの保存先（明示ダウンロード専用。共通モデルとはメタデータ上も区別する）
BUILTIN_YOLO_MODELS_DIR = PROJECT_ROOT / "models" / "yolo" / "builtin"
# 取得を許可する標準モデル名（任意名・任意URLは受け付けない）
BUILTIN_YOLO_MODEL_NAMES = ["yolo11n.pt", "yolov8n.pt", "yolov8s.pt"]

# 標準モデルの二重ダウンロード防止（プロセス内ロック）
_builtin_download_lock = threading.Lock()
_builtin_downloads_in_progress: set[str] = set()


class BuiltinYoloModelNotDownloadedError(Exception):
    """標準モデルが未取得（検出APIは外部通信しないため409で返す）。"""


class BuiltinYoloDownloadInProgressError(Exception):
    """同じ標準モデルのダウンロードが進行中（二重取得防止）。"""


def _builtin_model_local_path(model_name: str) -> Optional[Path]:
    """取得済み標準モデルのローカルパス。未取得なら None。

    旧バージョンの自動ダウンロードでリポジトリ直下に置かれたファイルも取得済みとして扱う
    （再ダウンロード不要にするための読み取り専用の互換確認）。
    """
    target = BUILTIN_YOLO_MODELS_DIR / model_name
    if target.exists() and target.is_file():
        return target
    legacy = PROJECT_ROOT / model_name
    if legacy.exists() and legacy.is_file():
        return legacy
    return None

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
            # EXIF Orientation は読込時に1回だけ反映し、以降の全工程
            # （Step1プレビュー・Step2検出・Step3表示・Step4クロップ）で同じ向きを使用する。
            # ブラウザの<img>はEXIFを自動適用するため、ここで反映しないと
            # Step1（ブラウザ表示）とStep2以降（サーバー生成画像）で向きが90°ずれる
            oriented = ImageOps.exif_transpose(img)
            return oriented.convert("RGB")
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


def resolve_project_yolo_model(project_id: str, model_name: str) -> str:
    """プロジェクト専用モデルのみ解決（他の取得元へフォールバックしない）。"""
    paths = get_project_paths(project_id)
    model_path = paths.models / "yolo" / model_name
    if model_path.exists() and model_path.is_file():
        return str(model_path.resolve())
    raise FileNotFoundError(
        f"プロジェクトモデルが見つかりません: {model_name}"
        f"（data/projects/{project_id}/models/yolo/ に配置してください）"
    )


def resolve_common_yolo_model(model_name: str) -> str:
    """共通モデル（リポジトリ直下 models/yolo）のみ解決（他の取得元へフォールバックしない）。"""
    common_path = COMMON_YOLO_MODELS_DIR / model_name
    if common_path.exists() and common_path.is_file():
        return str(common_path.resolve())
    raise FileNotFoundError(
        f"共通モデルが見つかりません: {model_name}（models/yolo/ に配置してください）"
    )


def resolve_builtin_yolo_model(model_name: str) -> str:
    """取得済みのUltralytics標準モデルのみ解決。未取得なら専用エラー（自動ダウンロードしない）。"""
    if model_name not in BUILTIN_YOLO_MODEL_NAMES:
        raise ValueError(f"許可されていない標準モデル名です: {model_name}")
    local = _builtin_model_local_path(model_name)
    if local is not None:
        return str(local.resolve())
    raise BuiltinYoloModelNotDownloadedError(
        f"標準モデル {model_name} は未取得です。先にモデルを取得してください。"
    )


def resolve_yolo_model(*, project_id: str, model_name: str, model_source: str = "") -> tuple[str, str]:
    """取得元を明示してモデルを解決し (実パス, 取得元) を返す。

    model_source を無視した別種別への暗黙フォールバックは行わない。
    - "path": 明示された実在パスのみ
    - "project" / "common" / "builtin": 各取得元のみ
    - 未指定(""): 後方互換の従来順（パス実在→プロジェクト→共通→取得済み標準）。
      いずれも自動ダウンロードは行わない（検出API実行中に外部通信しない）
    """
    candidate = (model_name or "").strip()
    if not candidate:
        raise ValueError("model is required")
    source = (model_source or "").strip()

    if source == "path":
        if Path(candidate).exists():
            return str(Path(candidate).resolve()), "path"
        raise FileNotFoundError(f"モデルファイルが見つかりません: {candidate}")
    if source == "project":
        return resolve_project_yolo_model(project_id, candidate), "project"
    if source == "common":
        return resolve_common_yolo_model(candidate), "common"
    if source == "builtin":
        return resolve_builtin_yolo_model(candidate), "builtin"
    if source:
        raise ValueError(f"不明な model_source です: {source}")

    # 後方互換（model_source未指定）: 従来の探索順。ただし未取得標準モデルの自動ダウンロードはしない
    if Path(candidate).exists():
        return str(Path(candidate).resolve()), "path"
    paths = get_project_paths(project_id)
    model_path = paths.models / "yolo" / candidate
    if model_path.exists() and model_path.is_file():
        return str(model_path.resolve()), "project"
    common_path = COMMON_YOLO_MODELS_DIR / candidate
    if common_path.exists() and common_path.is_file():
        return str(common_path.resolve()), "common"
    if candidate in BUILTIN_YOLO_MODEL_NAMES:
        local = _builtin_model_local_path(candidate)
        if local is not None:
            return str(local.resolve()), "builtin"
        raise BuiltinYoloModelNotDownloadedError(
            f"標準モデル {candidate} は未取得です。先にモデルを取得してください。"
        )
    raise FileNotFoundError(
        f"YOLOモデルが見つかりません: {candidate}"
        f"（プロジェクト内 models/yolo・共通 models/yolo・取得済み標準モデルを検索しました）"
    )


def _resolve_model_with_source(model_name: str, project_id: str) -> tuple[str, str]:
    """後方互換用の旧エントリポイント（model_source未指定の従来順で解決）。"""
    return resolve_yolo_model(project_id=project_id, model_name=model_name, model_source="")


def _resolve_model_name(model_name: str, project_id: str) -> str:
    return _resolve_model_with_source(model_name, project_id)[0]


def download_builtin_yolo_model(model_name: str) -> dict[str, Any]:
    """Ultralytics標準モデルを明示的に取得する（専用API用。検出APIからは呼ばない）。

    - 許可リスト外の名前は拒否（任意URL・任意ファイル名は受け付けない）
    - 取得済みなら再ダウンロードせずそのまま返す
    - 進行中の同名取得があれば専用エラー（二重ダウンロード防止）
    - 失敗時は不完全ファイルを残さない（一時ディレクトリへ取得後に移動）
    """
    name = (model_name or "").strip()
    if name not in BUILTIN_YOLO_MODEL_NAMES:
        raise ValueError(f"許可されていない標準モデル名です: {name or '(空)'}")

    existing = _builtin_model_local_path(name)
    if existing is not None:
        return {
            "model_name": name,
            "source": "builtin",
            "downloaded": True,
            "path": str(existing.resolve()),
            "size_bytes": existing.stat().st_size,
            "already_downloaded": True,
        }

    with _builtin_download_lock:
        if name in _builtin_downloads_in_progress:
            raise BuiltinYoloDownloadInProgressError(f"標準モデル {name} は取得中です。完了までお待ちください。")
        _builtin_downloads_in_progress.add(name)

    tmp_dir = BUILTIN_YOLO_MODELS_DIR / ".tmp"
    tmp_target = tmp_dir / name
    target = BUILTIN_YOLO_MODELS_DIR / name
    try:
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp_target.unlink(missing_ok=True)
        try:
            from ultralytics.utils.downloads import attempt_download_asset  # type: ignore

            downloaded = Path(str(attempt_download_asset(str(tmp_target))))
        except Exception as e:  # noqa: BLE001 ネットワーク不通・アセット不在等
            raise RuntimeError(
                f"標準モデルの取得に失敗しました（ネットワーク接続を確認してください）: {e}"
            ) from e
        if not downloaded.exists() or downloaded.stat().st_size <= 0:
            raise RuntimeError(f"標準モデルの取得に失敗しました: {name}")
        BUILTIN_YOLO_MODELS_DIR.mkdir(parents=True, exist_ok=True)
        shutil.move(str(downloaded), str(target))
        return {
            "model_name": name,
            "source": "builtin",
            "downloaded": True,
            "path": str(target.resolve()),
            "size_bytes": target.stat().st_size,
            "already_downloaded": False,
        }
    finally:
        tmp_target.unlink(missing_ok=True)
        with _builtin_download_lock:
            _builtin_downloads_in_progress.discard(name)


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
    # 共通モデル置き場（リポジトリ直下 models/yolo）も一覧へ含める。
    # ここに置いた学習済みモデルが一覧から消え、汎用ビルトインへ黙って置き換わる不具合の修正
    # 共通モデル一覧では標準モデル保存先（builtin/ サブディレクトリ）を混在させない
    common_models = (
        sorted([p.name for p in COMMON_YOLO_MODELS_DIR.glob("*.pt") if p.is_file()])
        if COMMON_YOLO_MODELS_DIR.exists()
        else []
    )
    builtins = list(BUILTIN_YOLO_MODEL_NAMES)

    def _relative_to_repo(path: Path) -> str:
        try:
            return path.resolve().relative_to(PROJECT_ROOT).as_posix()
        except ValueError:
            return str(path.resolve())

    # models: 取得元ごとの完全な一覧（project/common/builtin は独立。取得元間の暗黙統合はしない）。
    # builtin は取得済み状態（downloaded）を付与し、未取得はパスなし
    models: list[dict[str, Any]] = []
    for name in local_models:
        models.append(
            {
                "name": name,
                "source": "project",
                "downloaded": True,
                "path": _relative_to_repo(yolo_dir / name),
            }
        )
    for name in common_models:
        models.append(
            {
                "name": name,
                "source": "common",
                "downloaded": True,
                "path": _relative_to_repo(COMMON_YOLO_MODELS_DIR / name),
            }
        )
    for name in builtins:
        local = _builtin_model_local_path(name)
        models.append(
            {
                "name": name,
                "source": "builtin",
                "downloaded": local is not None,
                "path": _relative_to_repo(local) if local is not None else None,
            }
        )

    # items: 後方互換の平坦リスト（重複名は project 優先の先勝ち）
    items: list[str] = []
    seen: set[str] = set()
    for name in local_models + common_models + builtins:
        if name not in seen:
            seen.add(name)
            items.append(name)

    return {
        "project_id": project_id,
        "local_dir": str(yolo_dir.resolve()),
        "common_dir": str(COMMON_YOLO_MODELS_DIR.resolve()),
        "builtin_dir": str(BUILTIN_YOLO_MODELS_DIR.resolve()),
        "builtin_models": builtins,
        "local_models": local_models,
        "common_models": common_models,
        "items": items,
        "models": models,
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
    model_source: str = "",
) -> dict[str, Any]:
    if not (0.0 <= float(conf_threshold) <= 1.0):
        raise ValueError("conf_threshold must be between 0 and 1")
    if not (0.0 <= float(merge_iou_threshold) <= 1.0):
        raise ValueError("merge_iou_threshold must be between 0 and 1")

    # total_time_ms: 画像デコード・前処理・モデル読込・推論・レスポンス整形を含む全体時間
    total_started = time.perf_counter()

    original = _decode_image_bytes(image_bytes)
    # 検出前処理はリサイズ前に適用（プレビュー・出力と同一の座標系を保つ）。
    # preprocess_applied は「設定が存在するか」ではなく noop 判定で決める（無変換設定はOFF扱い）
    preprocess_applied = detect_preprocess is not None and not is_detection_preprocess_noop(detect_preprocess)
    if detect_preprocess:
        original = apply_detection_preprocess(original, detect_preprocess)
    resized = _prepare_image(original, long_side, use_resize, resize_axis)
    image_np = np.array(resized)

    # Keep ultralytics settings writable within the project workspace.
    paths = ensure_project_directories(project_id)
    yolo_config_dir = paths.outputs / "ultralytics"
    yolo_config_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_CONFIG_DIR", str(yolo_config_dir.resolve()))

    # 取得元を明示して解決（暗黙フォールバック・自動ダウンロードなし。未取得標準モデルはここで専用エラー）
    resolved_model, resolved_source = resolve_yolo_model(
        project_id=project_id, model_name=model_name, model_source=model_source
    )
    YOLO = _load_ultralytics_yolo()
    try:
        model = YOLO(resolved_model)
    except FileNotFoundError as e:
        # 「検出0件」と区別できる明示エラーにする（main.py で404へ変換）
        raise FileNotFoundError(
            f"YOLOモデルが見つかりません: {model_name}"
            f"（モデルファイルの配置またはカスタムパス指定を確認してください）"
        ) from e
    # inference_time_ms: model.predict（YOLO推論）のみの時間
    inference_started = time.perf_counter()
    result = model.predict(source=image_np, conf=float(conf_threshold), verbose=False)[0]
    inference_time_ms = int(round((time.perf_counter() - inference_started) * 1000))

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
        "model_name": model_name,
        # 取得元: path=明示パス / project=プロジェクト専用 / common=共通models/yolo / builtin=ultralytics標準
        "model_source": resolved_source,
        # 標準モデル使用時は取得済み（未取得なら実行前に専用エラーで弾かれている）。他取得元はnull
        "builtin_downloaded": True if resolved_source == "builtin" else None,
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
        "inference_time_ms": inference_time_ms,
        "total_time_ms": int(round((time.perf_counter() - total_started) * 1000)),
        "preprocess_applied": preprocess_applied,
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

    # 検出前処理は「YOLOがBBOXを見つけやすくするための一時処理」。
    # 学習用クロップは元画像の色・階調・画質を維持するため、前処理は画像へ適用せず
    # Step3座標（前処理+共通リサイズ後）を元画像座標へ逆変換してから元画像を切り出す。
    if detect_preprocess:
        preprocessed = apply_detection_preprocess(source, detect_preprocess)
        detect_input = _prepare_image(preprocessed, long_side, use_resize, resize_axis)
        # 共通リサイズ（_prepare_image）分の逆スケール
        scale_x = preprocessed.width / detect_input.width if detect_input.width else 1.0
        scale_y = preprocessed.height / detect_input.height if detect_input.height else 1.0
        crop_image = source
        reported_size = [detect_input.width, detect_input.height]
    else:
        resized = _prepare_image(source, long_side, use_resize, resize_axis)
        scale_x = 1.0
        scale_y = 1.0
        crop_image = resized
        reported_size = [resized.width, resized.height]

    total = len(selected_boxes)
    digits = len(str(total))
    outputs: list[str] = []
    skipped: list[int] = []
    for idx, box in enumerate(selected_boxes, start=1):
        target_box = box
        if detect_preprocess:
            inverted = invert_detection_bbox(
                (
                    float(box.get("x1", 0)) * scale_x,
                    float(box.get("y1", 0)) * scale_y,
                    float(box.get("x2", 0)) * scale_x,
                    float(box.get("y2", 0)) * scale_y,
                ),
                detect_preprocess,
                (source.width, source.height),
            )
            if inverted is None:
                # 逆変換後に有効範囲が残らないBBOXは黙って誤画像を出さずスキップとして報告
                skipped.append(int(box.get("id") or idx))
                continue
            target_box = {"x1": inverted[0], "y1": inverted[1], "x2": inverted[2], "y2": inverted[3]}
        cropped = _crop_and_resize(crop_image, target_box, crop_height)
        filename = f"{len(outputs) + 1:0{digits}d}.png"
        target = out_dir / filename
        cropped.save(target, format="PNG")
        outputs.append(str(target.resolve()))

    if not outputs:
        raise ValueError("すべてのBBOXが元画像範囲外のため出力できませんでした（逆変換スキップ）")

    return {
        "use_resize": bool(use_resize),
        "resize_axis": resize_axis,
        "output_dir": str(out_dir.resolve()),
        "count": len(outputs),
        "digits": digits,
        "crop_height": int(crop_height),
        "resized_size": reported_size,
        "crop_source": "original" if detect_preprocess else "resized",
        "skipped_invalid_bbox": skipped,
        "files": outputs,
    }
