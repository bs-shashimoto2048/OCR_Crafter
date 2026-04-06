import csv
from typing import Optional

from ..project_paths import ensure_project_directories


FIELDNAMES = ["image", "label"]


def ensure_master_csv(project_id: Optional[str] = None) -> None:
    paths = ensure_project_directories(project_id)
    if paths.annotations_csv.exists():
        return
    with paths.annotations_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()


def read_labels(project_id: Optional[str] = None) -> list[dict[str, str]]:
    paths = ensure_project_directories(project_id)
    ensure_master_csv(project_id)
    with paths.annotations_csv.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        return [
            {"image": row.get("image", "").strip(), "label": row.get("label", "").strip()}
            for row in reader
            if row.get("image")
        ]


def labels_map(project_id: Optional[str] = None) -> dict[str, str]:
    return {row["image"]: row["label"] for row in read_labels(project_id)}


def upsert_label(image_name: str, label: str, project_id: Optional[str] = None) -> None:
    paths = ensure_project_directories(project_id)
    ensure_master_csv(project_id)
    rows = read_labels(project_id)

    updated = False
    for row in rows:
        if row["image"] == image_name:
            row["label"] = label
            updated = True
            break

    if not updated:
        rows.append({"image": image_name, "label": label})

    with paths.annotations_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
