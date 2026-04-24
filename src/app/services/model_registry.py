from datetime import datetime
from pathlib import Path
from typing import Optional

import json
import torch

from ..config import get_settings
from ..db import fetch_training_job
from ..project_paths import ensure_project_directories


def list_models(project_id: Optional[str] = None) -> list[str]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    files = [p.name for p in paths.models.glob("*.pt") if p.is_file()]
    files += [p.name for p in paths.models.glob("*.ocr.json") if p.is_file()]
    return sorted(files)


def _safe_load_checkpoint(path: Path) -> dict:
    try:
        payload = torch.load(path, map_location="cpu")
        if isinstance(payload, dict):
            return payload
    except Exception:  # noqa: BLE001
        return {}
    return {}


def _safe_load_json(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:  # noqa: BLE001
        return {}
    return {}


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:  # noqa: BLE001
        return default


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:  # noqa: BLE001
        return default


def _normalize_int_list(value: object) -> list[int]:
    if not isinstance(value, (list, tuple)):
        return []
    normalized: list[int] = []
    for item in value:
        try:
            normalized.append(int(item))
        except Exception:  # noqa: BLE001
            continue
    return normalized


def _read_ocr_dataset_meta(dataset_root_value: str) -> dict:
    dataset_root_text = str(dataset_root_value or "").strip()
    if not dataset_root_text:
        return {}
    dataset_root = Path(dataset_root_text).expanduser()
    if not dataset_root.exists() or not dataset_root.is_dir():
        return {}
    return _safe_load_json(dataset_root / "meta.json")


def _ocr_counts_from_meta(meta: dict) -> dict[str, int]:
    counts = meta.get("counts")
    if isinstance(counts, dict):
        train = _safe_int(counts.get("train", 0))
        val = _safe_int(counts.get("val", 0))
        test = _safe_int(counts.get("test", 0))
        return {
            "train": train,
            "val": val,
            "test": test,
            "total": train + val + test,
        }
    total = _safe_int(meta.get("count", 0))
    return {"train": 0, "val": 0, "test": 0, "total": total}


def _ocr_ratio_from_meta(meta: dict) -> dict[str, float]:
    return {
        "train": _safe_float(meta.get("train_ratio", 0.0)),
        "val": _safe_float(meta.get("val_ratio", 0.0)),
        "test": _safe_float(meta.get("test_ratio", 0.0)),
    }


def list_model_infos(project_id: Optional[str] = None) -> list[dict]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    files = [p for p in paths.models.glob("*.pt") if p.is_file()]
    files += [p for p in paths.models.glob("*.ocr.json") if p.is_file()]
    items: list[dict] = []
    for path in sorted(files):
        st = path.stat()
        if path.name.endswith(".ocr.json"):
            payload = _safe_load_json(path)
            job_id = str(payload.get("job_id") or "").strip()
            job = fetch_training_job(job_id) if job_id else None
            dataset_root = str(payload.get("dataset_root") or (job or {}).get("dataset_dir") or "")
            dataset_meta = _read_ocr_dataset_meta(dataset_root)
            dataset_counts = _ocr_counts_from_meta(dataset_meta)
            if dataset_counts["total"] <= 0:
                payload_counts = payload.get("dataset_split_counts") if isinstance(payload.get("dataset_split_counts"), dict) else {}
                dataset_counts = {
                    "train": _safe_int(payload_counts.get("train", 0)),
                    "val": _safe_int(payload_counts.get("val", 0)),
                    "test": _safe_int(payload_counts.get("test", 0)),
                    "total": _safe_int(payload_counts.get("total", 0)),
                }
                if dataset_counts["total"] <= 0:
                    dataset_counts["total"] = dataset_counts["train"] + dataset_counts["val"] + dataset_counts["test"]
            dataset_ratio = _ocr_ratio_from_meta(dataset_meta)
            if dataset_ratio["train"] <= 0 and dataset_ratio["val"] <= 0 and dataset_ratio["test"] <= 0:
                payload_ratio = payload.get("dataset_split_ratio") if isinstance(payload.get("dataset_split_ratio"), dict) else {}
                dataset_ratio = {
                    "train": _safe_float(payload_ratio.get("train", 0.0)),
                    "val": _safe_float(payload_ratio.get("val", 0.0)),
                    "test": _safe_float(payload_ratio.get("test", 0.0)),
                }
            payload_preprocess = payload.get("preprocess") if isinstance(payload.get("preprocess"), dict) else {}
            payload_training = payload.get("training_params") if isinstance(payload.get("training_params"), dict) else {}
            payload_aug = payload.get("augmentation") if isinstance(payload.get("augmentation"), dict) else {}
            image_shape = _normalize_int_list(
                payload.get("image_shape")
                or payload_preprocess.get("image_shape")
                or dataset_meta.get("image_shape")
                or (job or {}).get("image_shape")
            )
            image_types = dataset_meta.get("image_types")
            if not isinstance(image_types, list):
                image_types = payload_preprocess.get("image_types") if isinstance(payload_preprocess.get("image_types"), list) else []
            augmentation_enabled = dataset_meta.get("use_augmentation")
            if augmentation_enabled is None and "enabled" in payload_aug:
                augmentation_enabled = payload_aug.get("enabled")
            augmentation_strength = dataset_meta.get("aug_strength")
            if augmentation_strength is None and "strength" in payload_aug:
                augmentation_strength = payload_aug.get("strength")
            items.append(
                {
                    "name": path.name,
                    "model_type": str(payload.get("model_type") or "ocr"),
                    "training_family": str(payload.get("training_family") or "ocr"),
                    "engine": str(payload.get("engine") or "paddleocr"),
                    "created_at": str(payload.get("created_at") or ""),
                    "modified_at": datetime.fromtimestamp(st.st_mtime).isoformat(),
                    "dataset_split_ratio": dataset_ratio,
                    "dataset_split_counts": {
                        "train": dataset_counts["train"],
                        "val": dataset_counts["val"],
                        "test": dataset_counts["test"],
                    },
                    "charset": str(payload.get("charset") or dataset_meta.get("charset") or (job or {}).get("charset") or ""),
                    "max_text_length": _safe_int(
                        payload.get("max_text_length")
                        or payload_preprocess.get("max_text_length")
                        or dataset_meta.get("max_text_length")
                        or (job or {}).get("max_text_length")
                    ),
                    "image_shape": image_shape,
                    "model_dir": str(payload.get("model_dir") or ""),
                    "ocr_dataset_root": dataset_root,
                    "ocr_dataset_counts": dataset_counts,
                    "ocr_dataset_meta_created_at": str(dataset_meta.get("created_at") or ""),
                    "ocr_preprocess": {
                        "image_shape": image_shape,
                        "image_types": image_types,
                        "charset": str(payload.get("charset") or dataset_meta.get("charset") or (job or {}).get("charset") or ""),
                        "max_text_length": _safe_int(
                            payload.get("max_text_length")
                            or payload_preprocess.get("max_text_length")
                            or dataset_meta.get("max_text_length")
                            or (job or {}).get("max_text_length")
                        ),
                    },
                    "ocr_training_params": {
                        "epochs": _safe_int((job or {}).get("epochs", payload_training.get("epochs", 0))),
                        "batch_size": _safe_int((job or {}).get("batch_size", payload_training.get("batch_size", 0))),
                        "learning_rate": _safe_float((job or {}).get("learning_rate", payload_training.get("learning_rate", 0.0))),
                    },
                    "ocr_augmentation": {
                        "enabled": bool(augmentation_enabled) if isinstance(augmentation_enabled, bool) else None,
                        "strength": _safe_int(augmentation_strength) if augmentation_strength is not None else None,
                    },
                }
            )
        else:
            checkpoint = _safe_load_checkpoint(path)
            ratio = checkpoint.get("dataset_split_ratio") if isinstance(checkpoint.get("dataset_split_ratio"), dict) else {}
            counts = checkpoint.get("dataset_split_counts") if isinstance(checkpoint.get("dataset_split_counts"), dict) else {}
            items.append(
                {
                    "name": path.name,
                    "model_type": str(checkpoint.get("model_type") or model_type_from_name(path.name)),
                    "training_family": "classification",
                    "engine": "custom",
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
                    "charset": "",
                    "max_text_length": 0,
                    "model_dir": "",
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
    from_files = sorted(
        {
            model_type_from_name(name)
            for name in list_models(project_id)
            if not str(name).endswith(".ocr.json") and model_type_from_name(name) != "unknown"
        }
    )
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
    suffixes = Path(safe_name).suffixes
    is_pt = Path(safe_name).suffix.lower() == ".pt"
    is_ocr_meta = len(suffixes) >= 2 and suffixes[-2:] == [".ocr", ".json"]
    if not is_pt and not is_ocr_meta:
        raise ValueError("only .pt and .ocr.json model files can be deleted")

    target = paths.models / safe_name
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(f"model not found: {safe_name}")

    if is_ocr_meta:
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
            model_dir = Path(str(payload.get("model_dir") or "")).expanduser()
            if model_dir.exists() and model_dir.is_dir():
                import shutil

                shutil.rmtree(model_dir, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass

    target.unlink()
    return safe_name


def list_ocr_model_meta_files(project_id: Optional[str], engine: Optional[str] = None) -> list[Path]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    files = [p for p in paths.models.glob("*.ocr.json") if p.is_file()]
    if engine:
        normalized = str(engine).strip().lower()
        filtered: list[Path] = []
        for path in files:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                continue
            if str(payload.get("engine") or "").strip().lower() == normalized:
                filtered.append(path)
        files = filtered
    return sorted(files)


def latest_ocr_model_meta(project_id: Optional[str], engine: Optional[str] = None) -> Optional[Path]:
    files = list_ocr_model_meta_files(project_id=project_id, engine=engine)
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


def resolve_ocr_model_meta(project_id: Optional[str], model: str = "latest", engine: Optional[str] = None) -> Optional[dict]:
    normalized_model = (model or "latest").strip()
    if normalized_model in {"", "latest"}:
        meta_file = latest_ocr_model_meta(project_id=project_id, engine=engine)
    else:
        paths = ensure_project_directories(project_id)
        candidate = paths.models / Path(normalized_model).name
        if not candidate.exists() or not candidate.is_file() or not str(candidate.name).endswith(".ocr.json"):
            return None
        meta_file = candidate
    if meta_file is None:
        return None
    try:
        payload = json.loads(meta_file.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            payload["meta_file"] = str(meta_file)
            return payload
    except Exception:  # noqa: BLE001
        return None
    return None
