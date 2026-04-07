import random
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

from ..project_paths import ensure_project_directories
from .labels import read_labels


def _clear_split_dirs(dataset_dir: Path) -> None:
    for split in ("train", "val", "test"):
        target = dataset_dir / split
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True, exist_ok=True)


def _resolve_image(image_name: str, interim_dir: Path, raw_dir: Path) -> Optional[Path]:
    interim_candidate = interim_dir / f"{Path(image_name).stem}.png"
    if interim_candidate.exists():
        return interim_candidate

    raw_candidate = raw_dir / image_name
    if raw_candidate.exists():
        return raw_candidate

    return None


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

    labels = [row for row in read_labels(paths.project_id) if row.get("label") not in (None, "")]
    buckets: dict[str, list[Path]] = defaultdict(list)

    for row in labels:
        image_name = row.get("filename") or row.get("image")
        if not image_name:
            continue
        path = _resolve_image(image_name, paths.interim, paths.raw)
        if path is None:
            continue
        buckets[row["label"]].append(path)

    _clear_split_dirs(paths.dataset)
    rng = random.Random(seed)

    counts = {"train": 0, "val": 0, "test": 0}

    for label, image_paths in buckets.items():
        rng.shuffle(image_paths)
        n = len(image_paths)
        n_train = int(n * train_ratio)
        n_val = int(n * val_ratio)
        n_test = n - n_train - n_val

        split_map = {
            "train": image_paths[:n_train],
            "val": image_paths[n_train : n_train + n_val],
            "test": image_paths[n_train + n_val : n_train + n_val + n_test],
        }

        for split, split_paths in split_map.items():
            label_dir = paths.dataset / split / str(label)
            label_dir.mkdir(parents=True, exist_ok=True)
            for src in split_paths:
                dst = label_dir / src.name
                shutil.copy2(src, dst)
                counts[split] += 1

    return {
        "project_id": paths.project_id,
        "labels": sorted(buckets.keys()),
        "counts": counts,
        "dataset_dir": str(paths.dataset),
    }
