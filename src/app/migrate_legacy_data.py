import argparse
import shutil
from pathlib import Path
from typing import Iterable

from .project_paths import ensure_project_directories
from .paths import PROJECT_ROOT


def _iter_files(root: Path) -> Iterable[Path]:
    if not root.exists():
        return []
    return [p for p in root.rglob("*") if p.is_file()]


def _safe_destination(dst_root: Path, rel: Path) -> Path:
    candidate = dst_root / rel
    if not candidate.exists():
        return candidate

    stem = candidate.stem
    suffix = candidate.suffix
    parent = candidate.parent
    idx = 1
    while True:
        alt = parent / f"{stem}_legacy{idx}{suffix}"
        if not alt.exists():
            return alt
        idx += 1


def _move_tree(src_root: Path, dst_root: Path, dry_run: bool) -> int:
    moved = 0
    files = _iter_files(src_root)
    for src in files:
        rel = src.relative_to(src_root)
        dst = _safe_destination(dst_root, rel)
        if dry_run:
            print(f"[DRY] move {src} -> {dst}")
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
        moved += 1
    return moved


def _merge_annotations(src_csv: Path, dst_csv: Path, dry_run: bool) -> bool:
    if not src_csv.exists():
        return False

    dst_csv.parent.mkdir(parents=True, exist_ok=True)
    if not dst_csv.exists():
        if dry_run:
            print(f"[DRY] copy annotation file {src_csv} -> {dst_csv}")
        else:
            shutil.copy2(src_csv, dst_csv)
        return True

    src_lines = src_csv.read_text(encoding="utf-8").splitlines()
    dst_lines = dst_csv.read_text(encoding="utf-8").splitlines()

    src_header = src_lines[0] if src_lines else "image,label"
    if not dst_lines:
        dst_lines = [src_header]

    existing = set(dst_lines[1:]) if len(dst_lines) > 1 else set()
    added = 0
    for line in src_lines[1:]:
        line = line.strip()
        if not line:
            continue
        if line in existing:
            continue
        dst_lines.append(line)
        existing.add(line)
        added += 1

    if added > 0:
        if dry_run:
            print(f"[DRY] merge annotations: +{added} lines into {dst_csv}")
        else:
            dst_csv.write_text("\n".join(dst_lines) + "\n", encoding="utf-8")

    return added > 0


def _remove_dir_if_empty(path: Path, dry_run: bool) -> None:
    if not path.exists() or not path.is_dir():
        return
    try:
        next(path.iterdir())
        return
    except StopIteration:
        if dry_run:
            print(f"[DRY] rmdir {path}")
        else:
            path.rmdir()


def _prune_empty_tree(path: Path, dry_run: bool) -> None:
    if not path.exists() or not path.is_dir():
        return
    for child in path.iterdir():
        if child.is_dir():
            _prune_empty_tree(child, dry_run)
    _remove_dir_if_empty(path, dry_run)


def run_migration(project_id: str = "default", dry_run: bool = False) -> dict:
    project = ensure_project_directories(project_id)

    old_raw = PROJECT_ROOT / "data" / "raw"
    old_interim = PROJECT_ROOT / "data" / "interim"
    old_processed = PROJECT_ROOT / "data" / "processed"
    old_dataset = PROJECT_ROOT / "data" / "dataset"
    old_annotations = PROJECT_ROOT / "data" / "annotations" / "master.csv"
    old_models = PROJECT_ROOT / "models"
    old_logs = PROJECT_ROOT / "logs"

    result = {
        "moved_raw": _move_tree(old_raw, project.raw, dry_run),
        "moved_interim": _move_tree(old_interim, project.interim, dry_run),
        "moved_processed": _move_tree(old_processed, project.processed, dry_run),
        "moved_dataset": _move_tree(old_dataset, project.dataset, dry_run),
        "moved_models": _move_tree(old_models, project.models, dry_run),
        "moved_logs": _move_tree(old_logs, project.logs, dry_run),
        "merged_annotations": _merge_annotations(old_annotations, project.annotations_csv, dry_run),
    }

    if old_annotations.exists():
        if dry_run:
            print(f"[DRY] remove legacy annotation file {old_annotations}")
        else:
            old_annotations.unlink()

    for p in [old_raw, old_interim, old_processed, old_models, old_logs]:
        _remove_dir_if_empty(p, dry_run)

    _prune_empty_tree(old_dataset, dry_run)
    _prune_empty_tree(old_annotations.parent, dry_run)

    _remove_dir_if_empty(PROJECT_ROOT / "data", dry_run)

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate legacy OCR data layout into project layout")
    parser.add_argument("--project-id", type=str, default="default")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = run_migration(project_id=args.project_id, dry_run=args.dry_run)
    print(result)


if __name__ == "__main__":
    main()
