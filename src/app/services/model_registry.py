from datetime import datetime
from pathlib import Path
from typing import Optional

import torch

from ..config import get_settings
from ..project_paths import ensure_project_directories


def list_models(project_id: Optional[str] = None) -> list[str]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    files = [p.name for p in paths.models.glob("*.pt") if p.is_file()]
    return sorted(files)


def _safe_load_checkpoint(path: Path) -> dict:
    try:
        payload = torch.load(path, map_location="cpu")
        if isinstance(payload, dict):
            return payload
    except Exception:  # noqa: BLE001
        return {}
    return {}


def list_model_infos(project_id: Optional[str] = None) -> list[dict]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    files = [p for p in paths.models.glob("*.pt") if p.is_file()]
    items: list[dict] = []
    for path in sorted(files):
        checkpoint = _safe_load_checkpoint(path)
        st = path.stat()
        ratio = checkpoint.get("dataset_split_ratio") if isinstance(checkpoint.get("dataset_split_ratio"), dict) else {}
        counts = checkpoint.get("dataset_split_counts") if isinstance(checkpoint.get("dataset_split_counts"), dict) else {}
        items.append(
            {
                "name": path.name,
                "model_type": str(checkpoint.get("model_type") or model_type_from_name(path.name)),
                "created_at": str(checkpoint.get("created_at") or ""),
                "modified_at": datetime.fromtimestamp(st.st_mtime).isoformat(),
                "dataset_split_ratio": {
                    "train": float(ratio.get("train", 0.0)) if ratio else 0.0,
                    "val": float(ratio.get("val", 0.0)) if ratio else 0.0,
                    "test": float(ratio.get("test", 0.0)) if ratio else 0.0,
                },
                "dataset_split_counts": {
                    "train": int(counts.get("train", 0)) if counts else 0,
                    "val": int(counts.get("val", 0)) if counts else 0,
                    "test": int(counts.get("test", 0)) if counts else 0,
                },
            }
        )
    return items


def model_type_from_name(model_name: str) -> str:
    stem = Path(model_name).stem
    if "_" not in stem:
        return "unknown"
    return stem.split("_", 1)[0]


def list_model_types(project_id: Optional[str] = None) -> list[str]:
    settings = get_settings()
    training_cfg = settings.get("training", {}) or {}
    configured = list((training_cfg.get("models", {}) or {}).keys())
    mapped_types = list((training_cfg.get("image_type_to_model", {}) or {}).values())
    default_type = training_cfg.get("default_model_type")
    fallback_types = ["square", "wide"]
    from_files = sorted({model_type_from_name(name) for name in list_models(project_id) if model_type_from_name(name) != "unknown"})
    seen = set()
    merged: list[str] = []
    for item in configured + mapped_types + ([default_type] if default_type else []) + from_files + fallback_types:
        if not item:
            continue
        if item in seen:
            continue
        seen.add(item)
        merged.append(item)
    return merged


def latest_model(project_id: Optional[str] = None, model_type: Optional[str] = None) -> Optional[Path]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)

    if model_type:
        candidates = [p for p in paths.models.glob(f"{model_type}_*.pt") if p.is_file()]
    else:
        candidates = [p for p in paths.models.glob("*.pt") if p.is_file()]

    if not candidates:
        return None

    return max(candidates, key=lambda p: p.stat().st_mtime)


def resolve_model_path(
    project_id: Optional[str] = None,
    model: str = "latest",
    model_type: Optional[str] = None,
) -> Optional[Path]:
    normalized_model = (model or "latest").strip()
    if normalized_model in {"", "latest"}:
        return latest_model(project_id=project_id, model_type=model_type)

    paths = ensure_project_directories(project_id)
    candidate = paths.models / Path(normalized_model).name
    if not candidate.exists() or not candidate.is_file():
        return None
    return candidate


def delete_model(project_id: Optional[str], model_name: str) -> str:
    paths = ensure_project_directories(project_id)
    safe_name = Path(model_name).name
    if safe_name != model_name:
        raise ValueError("invalid model name")
    if Path(safe_name).suffix.lower() != ".pt":
        raise ValueError("only .pt model file can be deleted")

    target = paths.models / safe_name
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(f"model not found: {safe_name}")

    target.unlink()
    return safe_name
