import csv
from datetime import datetime
from pathlib import Path
from typing import Optional

from ..project_paths import ensure_project_directories


FIELDNAMES = ["filename", "label", "type"]


def _normalize_key(key: str) -> str:
    return str(key or "").replace("\ufeff", "").strip().lower()


def _get_row_value(row: dict[str, str], *candidates: str) -> str:
    normalized = {_normalize_key(k): v for k, v in row.items()}
    for key in candidates:
        value = normalized.get(_normalize_key(key))
        if value is not None:
            return str(value)
    return ""


def _normalize_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for row in rows:
        filename = _get_row_value(row, "filename", "image").strip()
        if not filename:
            continue
        normalized.append(
            {
                "filename": filename,
                "label": _get_row_value(row, "label").strip(),
                "type": _get_row_value(row, "type").strip(),
            }
        )
    return normalized


def _backup_if_exists(path: Path) -> None:
    if not path.exists() or not path.is_file():
        return
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_name(f"{path.name}.bak_{timestamp}")
    backup.write_bytes(path.read_bytes())


def _rewrite_master_csv(project_id: Optional[str], rows: list[dict[str, str]]) -> None:
    paths = ensure_project_directories(project_id)
    with paths.annotations_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(_normalize_rows(rows))


def ensure_master_csv(project_id: Optional[str] = None) -> None:
    paths = ensure_project_directories(project_id)
    if not paths.annotations_csv.exists():
        _rewrite_master_csv(project_id, [])
        return

    with paths.annotations_csv.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        existing_fields = [_normalize_key(x) for x in (reader.fieldnames or [])]
        rows = list(reader)

    if existing_fields != FIELDNAMES:
        _backup_if_exists(paths.annotations_csv)
        _rewrite_master_csv(project_id, rows)


def read_labels(project_id: Optional[str] = None) -> list[dict[str, str]]:
    paths = ensure_project_directories(project_id)
    ensure_master_csv(project_id)
    with paths.annotations_csv.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = _normalize_rows(list(reader))
        return [
            {
                "filename": row["filename"],
                "image": row["filename"],  # backward compatible key
                "label": row["label"],
                "type": row["type"],
            }
            for row in rows
        ]


def labels_map(project_id: Optional[str] = None) -> dict[str, str]:
    return {row["filename"]: row["label"] for row in read_labels(project_id)}


def upsert_label(
    image_name: str,
    label: str,
    project_id: Optional[str] = None,
    image_type: Optional[str] = None,
) -> None:
    ensure_master_csv(project_id)
    rows = read_labels(project_id)

    updated = False
    for row in rows:
        if row["filename"] == image_name:
            row["label"] = label
            if image_type is not None:
                row["type"] = image_type
            updated = True
            break

    if not updated:
        rows.append({"filename": image_name, "image": image_name, "label": label, "type": image_type or ""})

    _rewrite_master_csv(project_id, rows)


def upsert_image_type(image_name: str, image_type: str, project_id: Optional[str] = None) -> None:
    ensure_master_csv(project_id)
    rows = read_labels(project_id)

    updated = False
    for row in rows:
        if row["filename"] == image_name:
            row["type"] = image_type
            updated = True
            break

    if not updated:
        rows.append({"filename": image_name, "image": image_name, "label": "", "type": image_type})

    _rewrite_master_csv(project_id, rows)
