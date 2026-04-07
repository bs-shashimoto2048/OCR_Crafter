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

    return counts[0], counts[1], counts[2]


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
        path = _resolve_image(image_name, row.get("type", ""), paths.processed, paths.interim, paths.raw)
        if path is None:
            continue
        buckets[row["label"]].append(path)

    _clear_split_dirs(paths.dataset)
    rng = random.Random(seed)

    counts = {"train": 0, "val": 0, "test": 0}

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
