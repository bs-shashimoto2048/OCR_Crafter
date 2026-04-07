from pathlib import Path
from typing import Optional

from ..config import get_settings
from ..project_paths import ensure_project_directories


def list_models(project_id: Optional[str] = None) -> list[str]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    files = [p.name for p in paths.models.glob("*.pt") if p.is_file()]
    return sorted(files)


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
