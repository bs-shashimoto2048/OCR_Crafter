from datetime import datetime
from pathlib import Path
from typing import Optional

import json
import logging
import shutil

import torch

from threading import Lock

from ..config import get_settings
from ..db import fetch_training_job
from ..project_paths import ensure_project_directories
from .. import project_paths as project_paths_module

logger = logging.getLogger(__name__)

PADDLE_INFERENCE_MARKERS = ("inference.yml", "inference.pdiparams", "inference.pdmodel", "inference.json")


def list_models(project_id: Optional[str] = None) -> list[str]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    files = [p.name for p in paths.models.glob("*.pt") if p.is_file()]
    files += [p.name for p in paths.models.glob("*.ocr.json") if p.is_file()]
    files += [p.name for p in paths.models.glob("*.tess.json") if p.is_file()]
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


def _is_paddle_inference_dir(path_value: object) -> bool:
    raw = str(path_value or "").strip()
    if not raw:
        return False
    path = Path(raw).expanduser()
    if not path.exists() or not path.is_dir():
        return False
    weights = path / "inference.pdiparams"
    graph_candidates = [path / "inference.pdmodel", path / "inference.json"]
    has_graph = any(item.exists() and item.is_file() for item in graph_candidates)
    return weights.exists() and weights.is_file() and has_graph


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


# 管理No（モデルID）: OCR Crafter全体で一意・作成順採番・削除しても番号を再利用しない。
# data/model_ids.json へ {"counter": n, "models": {"<project_id>/<モデル名>": "M0001"}} で永続化する
# （登録簿からは削除しないため、モデル削除後も同番号が別モデルへ振られることはない）
_MODEL_ID_LOCK = Lock()


def _model_id_file() -> Path:
    # PROJECTS_DIR（テストでは一時領域へ差し替えられる）の親=dataディレクトリへ保存する
    return Path(project_paths_module.PROJECTS_DIR).parent / "model_ids.json"


def _load_model_id_registry() -> dict:
    try:
        data = json.loads(_model_id_file().read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("models"), dict):
            return {"counter": int(data.get("counter") or 0), "models": dict(data["models"])}
    except (OSError, ValueError):
        pass
    return {"counter": 0, "models": {}}


def assign_model_ids(project_id: str, items: list[dict]) -> None:
    """モデル一覧へ管理No（`model_id`: M0001形式）を付与する。

    - 既登録モデルは登録済みの番号を返す（番号は不変）
    - 未登録モデルは**作成日時順（無ければ更新日時）**で一括採番
      （既存モデルの初回移行も同じ経路で作成順に振られる）
    - 採番はプロセス内Lock＋ファイル永続化。保存失敗時も表示は継続する
    """
    pid = str(project_id or "default")
    with _MODEL_ID_LOCK:
        registry = _load_model_id_registry()
        models = registry["models"]
        missing = [item for item in items if f"{pid}/{item.get('name')}" not in models]
        missing.sort(key=lambda item: (str(item.get("created_at") or item.get("modified_at") or ""), str(item.get("name"))))
        changed = False
        for item in missing:
            registry["counter"] = int(registry["counter"]) + 1
            models[f"{pid}/{item.get('name')}"] = f"M{registry['counter']:04d}"
            changed = True
        if changed:
            try:
                path = _model_id_file()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
            except OSError:
                logger.warning("model id registry save failed: %s", _model_id_file())
        for item in items:
            item["model_id"] = models.get(f"{pid}/{item.get('name')}", "")


def _file_size_mb(path_text: str) -> Optional[float]:
    """モデル実体ファイルのサイズ(MB)。存在しない・取得不能はNone（UIでは未記録表示）。"""
    text = str(path_text or "").strip()
    if not text:
        return None
    try:
        path = Path(text).expanduser()
        if path.is_file():
            return round(path.stat().st_size / (1024 * 1024), 2)
    except OSError:
        return None
    return None


def list_model_infos(project_id: Optional[str] = None) -> list[dict]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    files = [p for p in paths.models.glob("*.pt") if p.is_file()]
    files += [p for p in paths.models.glob("*.ocr.json") if p.is_file()]
    files += [p for p in paths.models.glob("*.tess.json") if p.is_file()]
    items: list[dict] = []
    for path in sorted(files):
        st = path.stat()
        if path.name.endswith(".tess.json"):
            payload = _safe_load_json(path)
            traineddata_path = str(payload.get("traineddata_path") or "")
            inference_ready = bool(traineddata_path) and Path(traineddata_path).expanduser().is_file()
            counts = payload.get("counts") if isinstance(payload.get("counts"), dict) else {}
            items.append(
                {
                    "name": path.name,
                    "model_type": "ocr",
                    "training_family": "tesseract",
                    "engine": "tesseract",
                    "created_at": str(payload.get("created_at") or ""),
                    "modified_at": datetime.fromtimestamp(st.st_mtime).isoformat(),
                    "charset": str(payload.get("charset") or ""),
                    "max_text_length": 0,
                    "model_dir": str(payload.get("model_dir") or payload.get("tessdata_dir") or ""),
                    "tessdata_dir": str(payload.get("tessdata_dir") or ""),
                    "traineddata_path": traineddata_path,
                    "lang": str(payload.get("lang") or ""),
                    "base_lang": str(payload.get("base_lang") or ""),
                    # モデルカルテ用: 学習済みtraineddataの実体サイズ（未Export等で無い場合はNone）
                    "model_size_mb": _file_size_mb(traineddata_path),
                    "ocr_inference_ready": bool(inference_ready),
                    "exported": bool(inference_ready),
                    "dataset_split_counts": {
                        "train": _safe_int(counts.get("train", 0)),
                        "val": _safe_int(counts.get("val", 0)),
                        "test": _safe_int(counts.get("test", 0)),
                    },
                    "ocr_dataset_root": str(payload.get("dataset_root") or ""),
                    "ocr_training_params": {
                        "max_iterations": _safe_int(payload.get("max_iterations", 0)),
                        "training_mode": "finetune",
                        "init_source_type": "tesseract_base",
                        "init_source_value": str(payload.get("base_lang") or ""),
                    },
                }
            )
        elif path.name.endswith(".ocr.json"):
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
            inference_dir = str(payload.get("inference_dir") or payload.get("model_dir") or "")
            checkpoint_dir = str(payload.get("checkpoint_dir") or payload.get("train_dir") or "")
            inference_ready = _is_paddle_inference_dir(inference_dir)
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
                    "train_dir": str(payload.get("train_dir") or checkpoint_dir),
                    "infer_dir": str(payload.get("infer_dir") or inference_dir),
                    "exported": bool(payload.get("exported", inference_ready)),
                    "ocr_inference_dir": inference_dir,
                    "ocr_checkpoint_dir": checkpoint_dir,
                    "ocr_inference_ready": bool(inference_ready),
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
                        "training_mode": str((job or {}).get("training_mode", payload_training.get("training_mode", "scratch"))),
                        "init_source_type": str((job or {}).get("init_source_type", payload_training.get("init_source_type", "scratch"))),
                        "init_source_value": str((job or {}).get("init_source_value", payload_training.get("init_source_value", ""))),
                        "device": str((job or {}).get("device", payload_training.get("device", "auto"))),
                        "resolved_device": str((job or {}).get("resolved_device", payload_training.get("resolved_device", ""))),
                        "train_num_workers": _safe_int(
                            (job or {}).get("train_num_workers", payload_training.get("train_num_workers", 0))
                        ),
                        "eval_num_workers": _safe_int(
                            (job or {}).get("eval_num_workers", payload_training.get("eval_num_workers", 0))
                        ),
                        "save_epoch_step": _safe_int(
                            (job or {}).get("save_epoch_step", payload_training.get("save_epoch_step", 10))
                        ),
                        "auto_batch_size": bool(
                            (job or {}).get("auto_batch_size", payload_training.get("auto_batch_size", False))
                        ),
                        "use_amp": bool((job or {}).get("use_amp", payload_training.get("use_amp", False))),
                        "pin_memory": bool((job or {}).get("pin_memory", payload_training.get("pin_memory", False))),
                        "persistent_workers": bool(
                            (job or {}).get("persistent_workers", payload_training.get("persistent_workers", False))
                        ),
                        "vram_gb": _safe_float((job or {}).get("vram_gb", payload_training.get("vram_gb", 0.0))),
                        "effective_train_batch": _safe_int(
                            (job or {}).get("effective_train_batch", payload_training.get("effective_train_batch", 0))
                        ),
                        "effective_eval_batch": _safe_int(
                            (job or {}).get("effective_eval_batch", payload_training.get("effective_eval_batch", 0))
                        ),
                        "oom_retry_count": _safe_int(
                            (job or {}).get("oom_retry_count", payload_training.get("oom_retry_count", 0))
                        ),
                        "avg_step_time": _safe_float(
                            (job or {}).get("avg_step_time", payload_training.get("avg_step_time", 0.0))
                        ),
                        "peak_gpu_usage": _safe_float(
                            (job or {}).get("peak_gpu_usage", payload_training.get("peak_gpu_usage", 0.0))
                        ),
                        "peak_vram_usage": _safe_float(
                            (job or {}).get("peak_vram_usage", payload_training.get("peak_vram_usage", 0.0))
                        ),
                        "metrics_samples": _safe_int(
                            (job or {}).get("metrics_samples", payload_training.get("metrics_samples", 0))
                        ),
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
                    # モデルカルテ用: .ptファイルの実体サイズ
                    "model_size_mb": round(st.st_size / (1024 * 1024), 2),
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
                    "training_mode": str(checkpoint.get("training_mode", "scratch")),
                    "init_source_type": str(checkpoint.get("init_source_type", "scratch")),
                    "init_source_value": str(checkpoint.get("init_source_value", "")),
                    "freeze_backbone_epochs": _safe_int(checkpoint.get("freeze_backbone_epochs", 0)),
                    "backbone_lr_scale": _safe_float(checkpoint.get("backbone_lr_scale", 1.0)),
                    "charset": "",
                    "max_text_length": 0,
                    "model_dir": "",
                }
            )
    assign_model_ids(paths.project_id, items)
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


_MODEL_DIR_META_KEYS = ("checkpoint_dir", "inference_dir", "tessdata_dir", "model_dir")


def _is_safe_model_artifact_dir(resolved: Path, models_root: Path) -> bool:
    """モデル削除で rmtree してよいディレクトリか検証する。

    許可するのは「models ディレクトリ配下の実在ディレクトリ」のみ。
    models ルート自身・CWD・プロジェクトルート・親ディレクトリ等は拒否する
    （空パスが Path(".") 化して CWD を再帰削除した事故の再発防止）。
    """
    try:
        root = models_root.resolve()
    except OSError:
        return False
    if resolved == root:
        return False
    if root not in resolved.parents:
        return False
    return resolved.exists() and resolved.is_dir()


def _resolve_safe_model_dirs(payload: dict, models_root: Path) -> list[Path]:
    """メタ情報から削除対象ディレクトリを抽出する。安全検証を通ったものだけ返す。"""
    dirs: list[Path] = []
    seen: set[str] = set()
    for key in _MODEL_DIR_META_KEYS:
        raw = str(payload.get(key) or "").strip()
        if not raw:
            # 空文字は Path("")（= CWD扱い）を生成する前に除外する
            continue
        try:
            resolved = Path(raw).expanduser().resolve()
        except (OSError, ValueError, RuntimeError):
            # ValueError: NULバイト等の不正文字 / RuntimeError: expanduser失敗
            logger.warning("delete_model: パス解決に失敗したためスキップ: %s=%r", key, raw)
            continue
        text = str(resolved)
        if text in seen:
            continue
        seen.add(text)
        if not _is_safe_model_artifact_dir(resolved, models_root):
            logger.warning(
                "delete_model: %s=%s は models ディレクトリ（%s）配下ではないため削除をスキップします。"
                "実体ディレクトリは残るため、不要な場合は手動で削除してください",
                key,
                resolved,
                models_root,
            )
            continue
        dirs.append(resolved)
    return dirs


def delete_model(project_id: Optional[str], model_name: str) -> str:
    paths = ensure_project_directories(project_id)
    safe_name = Path(model_name).name
    if safe_name != model_name:
        raise ValueError("invalid model name")
    suffixes = Path(safe_name).suffixes
    is_pt = Path(safe_name).suffix.lower() == ".pt"
    is_ocr_meta = len(suffixes) >= 2 and suffixes[-2:] == [".ocr", ".json"]
    is_tess_meta = len(suffixes) >= 2 and suffixes[-2:] == [".tess", ".json"]
    if not is_pt and not is_ocr_meta and not is_tess_meta:
        raise ValueError("only .pt, .ocr.json and .tess.json model files can be deleted")

    target = paths.models / safe_name
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(f"model not found: {safe_name}")

    if is_ocr_meta or is_tess_meta:
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                payload = None
        except Exception:  # noqa: BLE001
            payload = None

        if is_tess_meta:
            if payload is None:
                # JSONパース不能な破損メタ: 関連ディレクトリを特定できないため
                # .traineddata 等の実体には一切触れず、メタファイルのみ削除する
                logger.warning("delete_model: 破損メタのため .tess.json のみ削除します（実体は削除しません）: %s", target)
                logger.info("delete_model: removing model meta: %s", target)
                target.unlink()
                return safe_name
            related = [str(payload.get(key) or "").strip() for key in ("tessdata_dir", "model_dir")]
            if not any(related):
                # 読み込めるが関連パスが欠落しているメタは削除対象を特定できないため中止する
                raise ValueError(
                    f"tesseract model meta is incomplete (missing tessdata_dir/model_dir); delete aborted: {safe_name}"
                )

        if payload:
            for model_dir in _resolve_safe_model_dirs(payload, paths.models):
                logger.info("delete_model: removing model dir: %s", model_dir)
                shutil.rmtree(model_dir, ignore_errors=True)

    logger.info("delete_model: removing model meta: %s", target)
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


def latest_ocr_model_meta(
    project_id: Optional[str],
    engine: Optional[str] = None,
    inference_ready_only: bool = False,
) -> Optional[Path]:
    files = list_ocr_model_meta_files(project_id=project_id, engine=engine)
    if inference_ready_only:
        ready_files: list[Path] = []
        for path in files:
            payload = _safe_load_json(path)
            inference_dir = str(payload.get("inference_dir") or payload.get("model_dir") or "")
            if _is_paddle_inference_dir(inference_dir):
                ready_files.append(path)
        files = ready_files
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


def resolve_ocr_model_meta(
    project_id: Optional[str],
    model: str = "latest",
    engine: Optional[str] = None,
    inference_ready_only: bool = False,
) -> Optional[dict]:
    normalized_model = (model or "latest").strip()
    if normalized_model in {"", "latest"}:
        meta_file = latest_ocr_model_meta(project_id=project_id, engine=engine, inference_ready_only=inference_ready_only)
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
            if inference_ready_only:
                inference_dir = str(payload.get("inference_dir") or payload.get("model_dir") or "")
                if not _is_paddle_inference_dir(inference_dir):
                    return None
            payload["meta_file"] = str(meta_file)
            return payload
    except Exception:  # noqa: BLE001
        return None
    return None


def _is_tesseract_model_ready(payload: dict) -> bool:
    traineddata = str(payload.get("traineddata_path") or "").strip()
    if not traineddata:
        return False
    return Path(traineddata).expanduser().is_file()


def list_tesseract_model_meta_files(project_id: Optional[str]) -> list[Path]:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    return sorted([p for p in paths.models.glob("*.tess.json") if p.is_file()])


def latest_tesseract_model_meta(project_id: Optional[str], ready_only: bool = True) -> Optional[Path]:
    files = list_tesseract_model_meta_files(project_id)
    if ready_only:
        files = [p for p in files if _is_tesseract_model_ready(_safe_load_json(p))]
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


def resolve_tesseract_model_meta(
    project_id: Optional[str],
    model: str = "latest",
    ready_only: bool = True,
) -> Optional[dict]:
    normalized_model = (model or "latest").strip()
    if normalized_model in {"", "latest"}:
        meta_file = latest_tesseract_model_meta(project_id=project_id, ready_only=ready_only)
    else:
        paths = ensure_project_directories(project_id)
        candidate = paths.models / Path(normalized_model).name
        if not candidate.exists() or not candidate.is_file() or not str(candidate.name).endswith(".tess.json"):
            return None
        meta_file = candidate
    if meta_file is None:
        return None
    payload = _safe_load_json(meta_file)
    if not payload:
        return None
    if ready_only and not _is_tesseract_model_ready(payload):
        return None
    payload["meta_file"] = str(meta_file)
    return payload
