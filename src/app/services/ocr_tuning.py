import json
import random
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import yaml

from ..project_paths import ensure_project_directories
from ..paths import IMAGE_EXTENSIONS
from .labels import read_labels


SUPPORTED_OCR_EXPORT_ENGINES = {"easyocr", "paddleocr", "both"}
SUPPORTED_IMAGE_TYPES = {"single", "wide"}


@dataclass
class OcrRecord:
    image_name: str
    label: str
    image_type: str
    source_path: Path


def _now_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _sanitize_label(label: str) -> str:
    return str(label or "").replace("\r", " ").replace("\n", " ").strip()


def _normalize_image_types(image_types: Optional[list[str]]) -> list[str]:
    if not image_types:
        return ["wide"]
    normalized: list[str] = []
    for item in image_types:
        value = str(item or "").strip().lower()
        if not value:
            continue
        if value not in SUPPORTED_IMAGE_TYPES:
            raise ValueError(f"unsupported image type: {value}")
        if value not in normalized:
            normalized.append(value)
    if not normalized:
        raise ValueError("image_types must include at least one of: single, wide")
    return normalized


def _resolve_image_source(project_root: Path, image_name: str, image_type: str) -> Optional[Path]:
    stem = Path(image_name).stem
    processed = project_root / "processed" / image_type / "images" / f"{stem}.png"
    if processed.exists() and processed.is_file():
        return processed

    interim = project_root / "interim" / f"{stem}.png"
    if interim.exists() and interim.is_file():
        return interim

    raw = project_root / "raw" / image_name
    if raw.exists() and raw.is_file():
        return raw

    # Fallback: search raw by same stem and supported extension.
    raw_dir = project_root / "raw"
    for ext in IMAGE_EXTENSIONS:
        candidate = raw_dir / f"{stem}{ext}"
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _collect_records(project_id: Optional[str], image_types: list[str]) -> tuple[list[OcrRecord], dict[str, int]]:
    paths = ensure_project_directories(project_id)
    rows = read_labels(paths.project_id)
    stats = {
        "rows_total": len(rows),
        "rows_with_label": 0,
        "rows_skipped_empty_label": 0,
        "rows_skipped_type": 0,
        "rows_skipped_missing_source": 0,
    }
    records: list[OcrRecord] = []
    for row in rows:
        image_name = str(row.get("filename") or row.get("image") or "").strip()
        if not image_name:
            continue
        label = _sanitize_label(str(row.get("label") or ""))
        if not label:
            stats["rows_skipped_empty_label"] += 1
            continue
        stats["rows_with_label"] += 1

        image_type = str(row.get("type") or "").strip().lower()
        if image_type not in image_types:
            stats["rows_skipped_type"] += 1
            continue

        source_path = _resolve_image_source(paths.root, image_name, image_type)
        if source_path is None:
            stats["rows_skipped_missing_source"] += 1
            continue

        records.append(
            OcrRecord(
                image_name=image_name,
                label=label,
                image_type=image_type,
                source_path=source_path,
            )
        )

    return records, stats


def _split_records(
    records: list[OcrRecord],
    train_ratio: float,
    val_ratio: float,
    test_ratio: float,
    seed: int,
) -> dict[str, list[OcrRecord]]:
    total_ratio = float(train_ratio) + float(val_ratio) + float(test_ratio)
    if abs(total_ratio - 1.0) > 1e-6:
        raise ValueError("train/val/test ratio must sum to 1.0")
    if len(records) == 0:
        return {"train": [], "val": [], "test": []}

    shuffled = list(records)
    random.Random(seed).shuffle(shuffled)
    n = len(shuffled)
    n_train = int(n * float(train_ratio))
    n_val = int(n * float(val_ratio))
    n_test = n - n_train - n_val

    # Keep train non-empty when possible.
    if n > 0 and n_train <= 0:
        n_train = 1
        if n_val > 0:
            n_val -= 1
        elif n_test > 0:
            n_test -= 1

    train = shuffled[:n_train]
    val = shuffled[n_train : n_train + n_val]
    test = shuffled[n_train + n_val : n_train + n_val + n_test]
    return {"train": train, "val": val, "test": test}


def _copy_split_images(
    split_records: dict[str, list[OcrRecord]],
    out_root: Path,
    prefix: str,
) -> dict[str, list[dict[str, str]]]:
    out_root.mkdir(parents=True, exist_ok=True)
    lines: dict[str, list[dict[str, str]]] = {"train": [], "val": [], "test": []}
    counters: dict[str, int] = {"train": 0, "val": 0, "test": 0}

    for split, items in split_records.items():
        split_images = out_root / split / "images"
        split_images.mkdir(parents=True, exist_ok=True)

        for record in items:
            counters[split] += 1
            filename = f"{prefix}_{split}_{counters[split]:06d}.png"
            dst = split_images / filename
            shutil.copy2(record.source_path, dst)
            relative = f"{split}/images/{filename}"
            lines[split].append({"path": relative, "label": record.label})
    return lines


def _write_line_file(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(f"{row['path']}\t{row['label']}\n")


def _build_charset(records: list[OcrRecord]) -> list[str]:
    chars = sorted({ch for record in records for ch in record.label})
    return chars


def _export_easyocr(split_records: dict[str, list[OcrRecord]], out_dir: Path) -> dict[str, Any]:
    easy_root = out_dir / "easyocr"
    lines = _copy_split_images(split_records, easy_root, "easyocr")

    train_path = easy_root / "train_labels.txt"
    val_path = easy_root / "val_labels.txt"
    test_path = easy_root / "test_labels.txt"
    _write_line_file(train_path, lines["train"])
    _write_line_file(val_path, lines["val"])
    _write_line_file(test_path, lines["test"])

    return {
        "root": str(easy_root),
        "train_labels": str(train_path),
        "val_labels": str(val_path),
        "test_labels": str(test_path),
        "counts": {
            "train": len(lines["train"]),
            "val": len(lines["val"]),
            "test": len(lines["test"]),
        },
    }


def _write_paddle_config_yaml(rec_root: Path, charset_path: Path) -> Path:
    config_path = rec_root / "rec_train_config.yaml"
    content = {
        "Global": {
            "use_gpu": False,
            "epoch_num": 50,
            "batch_size_per_card": 64,
            "character_dict_path": str(charset_path),
            "max_text_length": 32,
            "save_model_dir": str(rec_root / "output"),
            "eval_batch_step": [0, 200],
        },
        "Train": {
            "dataset": {
                "name": "SimpleDataSet",
                "data_dir": str(rec_root),
                "label_file_list": [str(rec_root / "train.txt")],
            }
        },
        "Eval": {
            "dataset": {
                "name": "SimpleDataSet",
                "data_dir": str(rec_root),
                "label_file_list": [str(rec_root / "val.txt")],
            }
        },
    }
    config_path.write_text(yaml.safe_dump(content, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return config_path


def _export_paddleocr(
    split_records: dict[str, list[OcrRecord]],
    out_dir: Path,
    charset: list[str],
) -> dict[str, Any]:
    paddle_root = out_dir / "paddleocr"
    rec_root = paddle_root / "rec"
    lines = _copy_split_images(split_records, rec_root, "paddle")

    train_path = rec_root / "train.txt"
    val_path = rec_root / "val.txt"
    test_path = rec_root / "test.txt"
    _write_line_file(train_path, lines["train"])
    _write_line_file(val_path, lines["val"])
    _write_line_file(test_path, lines["test"])

    charset_path = rec_root / "charset.txt"
    charset_path.write_text("\n".join(charset), encoding="utf-8")
    config_path = _write_paddle_config_yaml(rec_root, charset_path)

    return {
        "root": str(paddle_root),
        "rec_root": str(rec_root),
        "train_labels": str(train_path),
        "val_labels": str(val_path),
        "test_labels": str(test_path),
        "charset_path": str(charset_path),
        "config_path": str(config_path),
        "counts": {
            "train": len(lines["train"]),
            "val": len(lines["val"]),
            "test": len(lines["test"]),
        },
    }


def export_ocr_training_data(
    project_id: Optional[str],
    engine: str = "both",
    output_dir: Optional[str] = None,
    image_types: Optional[list[str]] = None,
    train_ratio: float = 0.8,
    val_ratio: float = 0.1,
    test_ratio: float = 0.1,
    seed: int = 42,
    overwrite: bool = False,
) -> dict[str, Any]:
    normalized_engine = str(engine or "both").strip().lower()
    if normalized_engine not in SUPPORTED_OCR_EXPORT_ENGINES:
        raise ValueError(f"unsupported engine: {normalized_engine}")

    selected_types = _normalize_image_types(image_types)
    records, collect_stats = _collect_records(project_id, selected_types)
    if len(records) == 0:
        raise ValueError("No labeled records available for OCR export. Check labels/type/source images.")

    paths = ensure_project_directories(project_id)
    if output_dir:
        export_root = Path(output_dir).expanduser().resolve()
    else:
        export_root = (paths.outputs / "ocr_tuning" / _now_tag()).resolve()

    if export_root.exists():
        if not overwrite:
            raise ValueError(f"output_dir already exists: {export_root}")
        shutil.rmtree(export_root)
    export_root.mkdir(parents=True, exist_ok=True)

    split_records = _split_records(records, train_ratio, val_ratio, test_ratio, seed)
    charset = _build_charset(records)

    result: dict[str, Any] = {
        "project_id": paths.project_id,
        "engine": normalized_engine,
        "output_dir": str(export_root),
        "image_types": selected_types,
        "train_ratio": float(train_ratio),
        "val_ratio": float(val_ratio),
        "test_ratio": float(test_ratio),
        "seed": int(seed),
        "records_total": len(records),
        "split_counts": {k: len(v) for k, v in split_records.items()},
        "charset_size": len(charset),
        "collect_stats": collect_stats,
        "exports": {},
        "created_at": datetime.now().isoformat(),
    }

    if normalized_engine in {"easyocr", "both"}:
        result["exports"]["easyocr"] = _export_easyocr(split_records, export_root)
    if normalized_engine in {"paddleocr", "both"}:
        result["exports"]["paddleocr"] = _export_paddleocr(split_records, export_root, charset)

    meta_path = export_root / "meta.json"
    meta_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    result["meta_path"] = str(meta_path)
    return result
