import random
import shutil
import json
from datetime import datetime
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

from ..config import get_settings
from ..project_paths import ensure_project_directories
from .labels import read_labels


def _clear_split_dirs(dataset_dir: Path) -> None:
    for split in ("train", "val", "test"):
        target = dataset_dir / split
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True, exist_ok=True)


def _clear_typed_split_dirs(dataset_dir: Path) -> None:
    for image_type in ("single", "wide"):
        for split in ("train", "val", "test"):
            target = dataset_dir / image_type / split
            if target.exists():
                shutil.rmtree(target)
            target.mkdir(parents=True, exist_ok=True)


def _resolve_image(image_name: str, image_type: str, processed_dir: Path, interim_dir: Path, raw_dir: Path) -> Optional[Path]:
    stem = Path(image_name).stem
    normalized_type = (image_type or "").strip().lower()
    candidates: list[Path] = []

    if normalized_type in {"single", "wide"}:
        candidates.append(processed_dir / normalized_type / "images" / f"{stem}.png")
    else:
        candidates.append(processed_dir / "single" / "images" / f"{stem}.png")
        candidates.append(processed_dir / "wide" / "images" / f"{stem}.png")

    for candidate in candidates:
        if candidate.exists():
            return candidate

    interim_candidate = interim_dir / f"{Path(image_name).stem}.png"
    if interim_candidate.exists():
        return interim_candidate

    raw_candidate = raw_dir / image_name
    if raw_candidate.exists():
        return raw_candidate

    return None


def _split_counts_for_class(n: int, train_ratio: float, val_ratio: float, test_ratio: float) -> tuple[int, int, int]:
    if n <= 0:
        return 0, 0, 0
    if n == 1:
        return 1, 0, 0
    if n == 2:
        # Keep one sample for train, and allocate the other to the larger eval split.
        if val_ratio >= test_ratio:
            return 1, 1, 0
        return 1, 0, 1

    if n == 3:
        # Ensure all splits are represented when possible.
        return 1, 1, 1

    # n >= 4: guarantee each split has at least one sample, then distribute the rest
    # by largest remainder to approximate the requested ratios.
    counts = [1, 1, 1]  # train, val, test
    remain = n - 3
    targets = [n * train_ratio, n * val_ratio, n * test_ratio]
    desired = [max(0.0, targets[i] - counts[i]) for i in range(3)]
    base_extra = [int(x) for x in desired]
    allocated = sum(base_extra)

    for i in range(3):
        counts[i] += base_extra[i]

    remain -= allocated
    if remain > 0:
        remainders = sorted(
            ((desired[i] - base_extra[i], i) for i in range(3)),
            key=lambda x: x[0],
            reverse=True,
        )
        idx = 0
        while remain > 0:
            counts[remainders[idx % 3][1]] += 1
            remain -= 1
            idx += 1

    n_train, n_val, n_test = counts[0], counts[1], counts[2]
    # Safety guard: every class used for dataset generation must appear in train.
    if n > 0 and n_train <= 0:
        n_train = 1
        if n_val > 0:
            n_val -= 1
        elif n_test > 0:
            n_test -= 1
    # Keep total fixed to n.
    current_total = n_train + n_val + n_test
    if current_total < n:
        n_train += n - current_total
    elif current_total > n:
        overflow = current_total - n
        take_from_val = min(overflow, n_val)
        n_val -= take_from_val
        overflow -= take_from_val
        if overflow > 0:
            take_from_test = min(overflow, n_test)
            n_test -= take_from_test
            overflow -= take_from_test
        if overflow > 0:
            n_train = max(1, n_train - overflow)

    return n_train, n_val, n_test


def build_dataset(
    project_id: Optional[str],
    train_ratio: float,
    val_ratio: float,
    test_ratio: float,
    seed: int = 42,
) -> dict[str, Any]:
    paths = ensure_project_directories(project_id)
    total = train_ratio + val_ratio + test_ratio
    if abs(total - 1.0) > 1e-6:
        raise ValueError("train/val/test ratio must sum to 1.0")

    all_rows = read_labels(paths.project_id)
    labels = [row for row in all_rows if str(row.get("label") or "").strip() != ""]
    total_rows = len(all_rows)
    labeled_rows = len(labels)
    unlabeled_rows = max(total_rows - labeled_rows, 0)
    buckets_by_type: dict[str, dict[str, list[Path]]] = {
        "single": defaultdict(list),
        "wide": defaultdict(list),
    }
    unknown_type_rows = 0

    for row in labels:
        image_name = row.get("filename") or row.get("image")
        if not image_name:
            continue
        image_type = str(row.get("type", "")).strip().lower()
        if image_type not in {"single", "wide"}:
            unknown_type_rows += 1
            continue
        path = _resolve_image(image_name, image_type, paths.processed, paths.interim, paths.raw)
        if path is None:
            continue
        buckets_by_type[image_type][row["label"]].append(path)

    _clear_split_dirs(paths.dataset)
    _clear_typed_split_dirs(paths.dataset)
    rng = random.Random(seed)

    counts = {"train": 0, "val": 0, "test": 0}
    counts_by_type = {
        "single": {"train": 0, "val": 0, "test": 0},
        "wide": {"train": 0, "val": 0, "test": 0},
    }
    labels_by_type = {"single": [], "wide": []}
    train_label_set: set[str] = set()

    for image_type in ("single", "wide"):
        buckets = buckets_by_type[image_type]
        labels_by_type[image_type] = sorted(buckets.keys())

        for label, image_paths in buckets.items():
            rng.shuffle(image_paths)
            n = len(image_paths)
            if n <= 0:
                continue

            n_train, n_val, n_test = _split_counts_for_class(n, train_ratio, val_ratio, test_ratio)

            split_map = {
                "train": image_paths[:n_train],
                "val": image_paths[n_train : n_train + n_val],
                "test": image_paths[n_train + n_val : n_train + n_val + n_test],
            }

            for split, split_paths in split_map.items():
                if not split_paths:
                    continue

                # Backward-compatible aggregate dataset tree.
                label_dir = paths.dataset / split / str(label)
                label_dir.mkdir(parents=True, exist_ok=True)

                # Type-separated dataset tree used by training/evaluation.
                typed_label_dir = paths.dataset / image_type / split / str(label)
                typed_label_dir.mkdir(parents=True, exist_ok=True)

                for src in split_paths:
                    dst = label_dir / src.name
                    shutil.copy2(src, dst)
                    typed_dst = typed_label_dir / src.name
                    shutil.copy2(src, typed_dst)
                    counts[split] += 1
                    counts_by_type[image_type][split] += 1
                if split == "train":
                    train_label_set.add(str(label))

    all_labels = sorted(set(labels_by_type["single"] + labels_by_type["wide"]))
    missing_train_labels = [label for label in all_labels if label not in train_label_set]

    build_meta = {
        "project_id": paths.project_id,
        "train_ratio": train_ratio,
        "val_ratio": val_ratio,
        "test_ratio": test_ratio,
        "seed": seed,
        "total_images": total_rows,
        "labeled_images": labeled_rows,
        "unlabeled_images": unlabeled_rows,
        "counts": counts,
        "counts_by_type": counts_by_type,
        "created_at": datetime.now().isoformat(),
    }
    meta_path = paths.dataset / "build_meta.json"
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(build_meta, f, ensure_ascii=False, indent=2)

    return {
        "project_id": paths.project_id,
        "total_images": total_rows,
        "labeled_images": labeled_rows,
        "unlabeled_images": unlabeled_rows,
        "labels": all_labels,
        "labels_by_type": labels_by_type,
        "counts": counts,
        "counts_by_type": counts_by_type,
        "missing_train_labels": missing_train_labels,
        "unknown_type_rows": unknown_type_rows,
        "dataset_dir": str(paths.dataset),
        "build_meta_path": str(meta_path),
    }


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except Exception:  # noqa: BLE001
        return 0


def _scan_counts_by_type(dataset_dir: Path) -> dict[str, dict[str, int]]:
    counts_by_type = {
        "single": {"train": 0, "val": 0, "test": 0},
        "wide": {"train": 0, "val": 0, "test": 0},
    }
    for image_type in ("single", "wide"):
        for split in ("train", "val", "test"):
            split_dir = dataset_dir / image_type / split
            if not split_dir.exists():
                continue
            counts_by_type[image_type][split] = sum(1 for p in split_dir.rglob("*") if p.is_file())
    return counts_by_type


def read_dataset_meta(project_id: Optional[str]) -> dict[str, Any]:
    paths = ensure_project_directories(project_id)
    meta_path = paths.dataset / "build_meta.json"
    payload: dict[str, Any] = {}
    if meta_path.exists() and meta_path.is_file():
        try:
            with meta_path.open("r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                payload = loaded
        except Exception:  # noqa: BLE001
            payload = {}

    counts_by_type = payload.get("counts_by_type")
    if not isinstance(counts_by_type, dict):
        counts_by_type = _scan_counts_by_type(paths.dataset)
    normalized_counts_by_type = {
        "single": {
            "train": _safe_int((counts_by_type.get("single") or {}).get("train")),
            "val": _safe_int((counts_by_type.get("single") or {}).get("val")),
            "test": _safe_int((counts_by_type.get("single") or {}).get("test")),
        },
        "wide": {
            "train": _safe_int((counts_by_type.get("wide") or {}).get("train")),
            "val": _safe_int((counts_by_type.get("wide") or {}).get("val")),
            "test": _safe_int((counts_by_type.get("wide") or {}).get("test")),
        },
    }
    normalized_counts = {
        "train": _safe_int(normalized_counts_by_type["single"]["train"]) + _safe_int(normalized_counts_by_type["wide"]["train"]),
        "val": _safe_int(normalized_counts_by_type["single"]["val"]) + _safe_int(normalized_counts_by_type["wide"]["val"]),
        "test": _safe_int(normalized_counts_by_type["single"]["test"]) + _safe_int(normalized_counts_by_type["wide"]["test"]),
    }

    settings = get_settings()
    training_cfg = settings.get("training", {}) or {}
    image_type_to_model_raw = training_cfg.get("image_type_to_model", {}) or {}
    image_type_to_model = {str(k): str(v) for k, v in image_type_to_model_raw.items()}
    default_model_type = str(training_cfg.get("default_model_type") or "square")

    counts_by_model_type: dict[str, dict[str, int]] = {}
    model_type_to_image_types: dict[str, list[str]] = {}
    for image_type in ("single", "wide"):
        mapped_model_type = str(image_type_to_model.get(image_type) or default_model_type)
        if mapped_model_type not in counts_by_model_type:
            counts_by_model_type[mapped_model_type] = {"train": 0, "val": 0, "test": 0}
        counts_by_model_type[mapped_model_type]["train"] += _safe_int(normalized_counts_by_type[image_type]["train"])
        counts_by_model_type[mapped_model_type]["val"] += _safe_int(normalized_counts_by_type[image_type]["val"])
        counts_by_model_type[mapped_model_type]["test"] += _safe_int(normalized_counts_by_type[image_type]["test"])
        model_type_to_image_types.setdefault(mapped_model_type, [])
        if image_type not in model_type_to_image_types[mapped_model_type]:
            model_type_to_image_types[mapped_model_type].append(image_type)

    def _type_rank(t: str) -> tuple[int, int]:
        by_split = normalized_counts_by_type.get(t, {})
        train_count = _safe_int(by_split.get("train", 0))
        total_count = train_count + _safe_int(by_split.get("val", 0)) + _safe_int(by_split.get("test", 0))
        return train_count, total_count

    available_image_types = [
        t
        for t in ("single", "wide")
        if (_type_rank(t)[0] > 0 or _type_rank(t)[1] > 0)
    ]
    recommended_image_type = ""
    if available_image_types:
        recommended_image_type = max(available_image_types, key=_type_rank)
    recommended_model_type = str(image_type_to_model.get(recommended_image_type) or default_model_type)

    return {
        "project_id": paths.project_id,
        "build_meta_exists": meta_path.exists(),
        "build_meta_path": str(meta_path),
        "train_ratio": float(payload.get("train_ratio", 0.0)),
        "val_ratio": float(payload.get("val_ratio", 0.0)),
        "test_ratio": float(payload.get("test_ratio", 0.0)),
        "counts": normalized_counts,
        "counts_by_type": normalized_counts_by_type,
        "counts_by_model_type": counts_by_model_type,
        "image_type_to_model": image_type_to_model,
        "model_type_to_image_types": model_type_to_image_types,
        "available_image_types": available_image_types,
        "recommended_image_type": recommended_image_type,
        "recommended_model_type": recommended_model_type,
    }
