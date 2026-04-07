import csv
from typing import Optional

from ..project_paths import ensure_project_directories


FIELDNAMES = ["filename", "label", "type"]


def _normalize_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for row in rows:
        filename = (row.get("filename") or row.get("image") or "").strip()
        if not filename:
            continue
        normalized.append(
            {
                "filename": filename,
                "label": (row.get("label") or "").strip(),
                "type": (row.get("type") or "").strip(),
            }
        )
    return normalized


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

    with paths.annotations_csv.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        existing_fields = reader.fieldnames or []
        rows = list(reader)

    if existing_fields != FIELDNAMES:
        _rewrite_master_csv(project_id, rows)


def read_labels(project_id: Optional[str] = None) -> list[dict[str, str]]:
    paths = ensure_project_directories(project_id)
    ensure_master_csv(project_id)
    with paths.annotations_csv.open("r", encoding="utf-8", newline="") as f:
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
