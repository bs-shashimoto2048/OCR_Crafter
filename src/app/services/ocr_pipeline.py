import json
import importlib.util
import random
import shutil
import subprocess
import sys
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from ..project_paths import ensure_project_directories
from .labels import read_labels

OCR_CHARSET_DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
CONF_THRESHOLD = 0.9
DEFAULT_BUSINESS_PATTERN = r"^[A-Z0-9]{8}$"
BANNED_PATTERNS = {"AAAAAAAA", "00000000"}


def _now_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _normalize_charset(charset: Optional[str]) -> str:
    normalized = "".join(dict.fromkeys((charset or OCR_CHARSET_DEFAULT).strip().upper()))
    if not normalized:
        normalized = OCR_CHARSET_DEFAULT
    return normalized


def _normalize_image_shape(image_shape: Optional[list[int]]) -> list[int]:
    shape = list(image_shape or [3, 48, 320])
    if len(shape) != 3:
        raise ValueError("image_shape must be [C,H,W]")
    c, h, w = [int(x) for x in shape]
    if c not in {1, 3}:
        raise ValueError("image_shape[0] must be 1 or 3")
    if h <= 0 or w <= 0:
        raise ValueError("image_shape height/width must be > 0")
    return [c, h, w]


def _resolve_source_image(project_root: Path, image_name: str, image_type: str) -> Optional[Path]:
    stem = Path(image_name).stem
    if image_type in {"single", "wide"}:
        processed = project_root / "processed" / image_type / "images" / f"{stem}.png"
        if processed.exists() and processed.is_file():
            return processed

    interim = project_root / "interim" / f"{stem}.png"
    if interim.exists() and interim.is_file():
        return interim

    raw = project_root / "raw" / image_name
    if raw.exists() and raw.is_file():
        return raw
    return None


def _sanitize_text(raw: str, charset: str, max_text_length: int) -> str:
    value = str(raw or "").strip().upper()
    if not value:
        return ""
    if any(ch not in charset for ch in value):
        return ""
    if len(value) > max_text_length:
        return ""
    return value


def preprocess_ocr_image(image: Any, image_shape: Optional[list[int]] = None, strong: bool = False) -> Image.Image:
    """
    OCR用画像前処理
    - 高さ48(既定)にリサイズ
    - アスペクト維持
    - 正規化相当の輝度/コントラスト安定化
    """
    shape = _normalize_image_shape(image_shape)
    channels = int(shape[0])
    target_h = int(shape[1])
    target_w = int(shape[2])
    if isinstance(image, Image.Image):
        opened = image.convert("L")
    elif isinstance(image, (str, Path)):
        with Image.open(image) as src:
            opened = src.convert("L")
    else:
        raise ValueError("unsupported image input for preprocess_ocr_image")

    cutoff = 1 if not strong else 0
    contrast_gain = 1.08 if not strong else 1.2
    gray = ImageOps.autocontrast(opened, cutoff=cutoff)
    gray = ImageEnhance.Contrast(gray).enhance(contrast_gain)
    if strong:
        gray = gray.filter(ImageFilter.SHARPEN)

    src_w, src_h = gray.size
    if src_w <= 0 or src_h <= 0:
        raise ValueError("invalid image size for OCR preprocess")
    scale = float(target_h) / float(src_h)
    resized_w = max(1, int(round(src_w * scale)))
    resized = gray.resize((resized_w, target_h), Image.Resampling.LANCZOS)

    canvas = Image.new("L", (target_w, target_h), color=255)
    if resized_w <= target_w:
        x = (target_w - resized_w) // 2
        canvas.paste(resized, (x, 0))
    else:
        resized = resized.resize((target_w, target_h), Image.Resampling.LANCZOS)
        canvas.paste(resized, (0, 0))

    if channels == 1:
        return canvas
    return Image.merge("RGB", (canvas, canvas, canvas))


def _apply_augmentation(image: Image.Image, rng: random.Random, aug_strength: int) -> Image.Image:
    strength = max(1, min(3, int(aug_strength)))
    pil = image.convert("RGB")
    applied = 0
    probability = {1: 0.35, 2: 0.55, 3: 0.75}[strength]

    # コントラスト変化
    if rng.random() < probability:
        factor_base = {1: 0.1, 2: 0.16, 3: 0.2}[strength]
        factor = rng.uniform(1.0 - factor_base, 1.0 + factor_base)
        pil = ImageEnhance.Contrast(pil).enhance(factor)
        applied += 1

    # ガウシアンブラー（軽微）
    if rng.random() < probability:
        radius = rng.uniform(0.3, 0.6 if strength < 3 else 0.8)
        pil = pil.filter(ImageFilter.GaussianBlur(radius=radius))
        applied += 1

    # ガウシアンノイズ
    if rng.random() < probability:
        sigma = {1: 3.0, 2: 6.0, 3: 9.0}[strength]
        arr = np.asarray(pil).astype(np.float32)
        noise = rng.normalvariate(0, 1)
        # python randomだけでは画素ごとの揺らぎが不足するため、seedを共有してnumpy乱数を使う
        np_rng = np.random.default_rng(rng.randrange(0, 2**32 - 1))
        np_noise = np_rng.normal(loc=noise, scale=sigma, size=arr.shape).astype(np.float32)
        arr = np.clip(arr + np_noise, 0, 255).astype(np.uint8)
        pil = Image.fromarray(arr, mode="RGB")
        applied += 1

    # 軽微な回転（±2度）
    if rng.random() < probability:
        angle_abs = 1.0 if strength == 1 else 2.0
        angle = rng.uniform(-angle_abs, angle_abs)
        pil = pil.rotate(angle, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(255, 255, 255))
        applied += 1

    # 少なくとも1操作は適用
    if applied == 0:
        factor = rng.uniform(0.95, 1.05)
        pil = ImageEnhance.Contrast(pil).enhance(factor)
    return pil


def _prepare_ocr_image(
    source: Any,
    shape: list[int],
    rng: random.Random,
    use_augmentation: bool = False,
    aug_strength: int = 1,
) -> Image.Image:
    processed = preprocess_ocr_image(source, image_shape=shape, strong=False)
    if not use_augmentation:
        return processed
    augmented = _apply_augmentation(processed, rng=rng, aug_strength=aug_strength)
    # 変形後も学習時/推論時で同一の前処理条件に揃える
    return preprocess_ocr_image(augmented, image_shape=shape, strong=False)


def validate_ocr_result(
    text: str,
    max_text_length: int = 8,
    charset: str = OCR_CHARSET_DEFAULT,
    confidence: Optional[float] = None,
    conf_threshold: float = CONF_THRESHOLD,
) -> dict[str, Any]:
    allowed = set(_normalize_charset(charset))
    raw = str(text or "").strip().upper()
    cleaned = "".join(ch for ch in raw if ch in allowed)
    reason: Optional[str] = None
    valid = True

    if confidence is not None and float(confidence) < float(conf_threshold):
        valid = False
        reason = "low_confidence"

    if len(cleaned) != int(max_text_length):
        valid = False
        reason = "invalid_length" if reason is None else reason

    if cleaned != raw and reason is None:
        valid = False
        reason = "invalid_character_removed"

    return {
        "text": cleaned,
        "valid": bool(valid),
        "reason": reason,
        "confidence_threshold": float(conf_threshold),
        "max_text_length": int(max_text_length),
    }


def validate_business_rules(text: str) -> dict[str, Any]:
    normalized = str(text or "").strip().upper()
    if not normalized:
        return {"valid": False, "reason": "empty_text", "pattern": DEFAULT_BUSINESS_PATTERN}
    if normalized in BANNED_PATTERNS:
        return {"valid": False, "reason": "banned_pattern", "pattern": DEFAULT_BUSINESS_PATTERN}
    if re.fullmatch(DEFAULT_BUSINESS_PATTERN, normalized) is None:
        return {"valid": False, "reason": "pattern_mismatch", "pattern": DEFAULT_BUSINESS_PATTERN}
    return {"valid": True, "reason": None, "pattern": DEFAULT_BUSINESS_PATTERN}


def save_ocr_prediction_log(project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    paths = ensure_project_directories(project_id)
    log_dir = paths.outputs / "ocr_logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "predictions.jsonl"
    record = {
        "project_id": project_id,
        "timestamp": datetime.now().isoformat(),
        **payload,
    }
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return {"saved": True, "log_path": str(log_path), "record": record}


def read_latest_rapid_ocr_states(project_id: Optional[str]) -> dict[str, Any]:
    paths = ensure_project_directories(project_id)
    logs_dir = paths.outputs / "ocr_logs"
    if not logs_dir.exists() or not logs_dir.is_dir():
        return {"project_id": paths.project_id, "count": 0, "items": []}

    log_files = sorted([p for p in logs_dir.glob("*.jsonl") if p.is_file()])
    if not log_files:
        return {"project_id": paths.project_id, "count": 0, "items": []}

    latest_by_image: dict[str, dict[str, Any]] = {}
    for log_file in log_files:
        lines = log_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        for line in lines:
            payload: dict[str, Any]
            try:
                payload = json.loads(line)
            except Exception:  # noqa: BLE001
                continue
            if not isinstance(payload, dict):
                continue

            extra = payload.get("extra")
            ui_source = ""
            if isinstance(extra, dict):
                ui_source = str(extra.get("ui_source") or "").strip()

            # 高速OCR修正由来のみ対象。旧ログ互換として corrected/skipped がある行は許容。
            legacy_rapid_like = ("corrected_text" in payload) or (str(payload.get("reason") or "") == "skipped")
            if ui_source != "rapid_ocr" and not legacy_rapid_like:
                continue

            image_name = Path(str(payload.get("image_path") or "")).name
            if not image_name:
                continue

            reason = str(payload.get("reason") or "").strip()
            predicted_text = str(payload.get("predicted_text") or payload.get("prediction") or "").strip().upper()
            corrected_text = str(payload.get("corrected_text") or "").strip().upper()
            status = "pending" if reason == "skipped" else "confirmed"
            text = corrected_text if corrected_text else predicted_text
            latest_by_image[image_name] = {
                "image": image_name,
                "status": status,
                "text": text,
                "timestamp": str(payload.get("timestamp") or ""),
                "reason": reason or None,
            }

    items = sorted(latest_by_image.values(), key=lambda x: str(x.get("image") or ""))
    return {"project_id": paths.project_id, "count": len(items), "items": items}


def _resolve_logged_image_path(project_root: Path, image_path: str) -> Optional[Path]:
    value = str(image_path or "").strip()
    if not value:
        return None
    candidate = Path(value).expanduser()
    if candidate.exists() and candidate.is_file():
        return candidate.resolve()

    name = Path(value).name
    raw_candidate = project_root / "raw" / name
    if raw_candidate.exists() and raw_candidate.is_file():
        return raw_candidate

    stem = Path(name).stem
    for image_type in ("single", "wide"):
        processed_candidate = project_root / "processed" / image_type / "images" / f"{stem}.png"
        if processed_candidate.exists() and processed_candidate.is_file():
            return processed_candidate

    interim_candidate = project_root / "interim" / f"{stem}.png"
    if interim_candidate.exists() and interim_candidate.is_file():
        return interim_candidate
    return None


def create_ocr_dataset_from_logs(
    project_id: Optional[str],
    only_invalid: bool = True,
    include_corrected: bool = True,
    max_text_length: int = 8,
    charset: Optional[str] = None,
    image_shape: Optional[list[int]] = None,
    output_dir: Optional[str] = None,
    overwrite: bool = False,
) -> dict[str, Any]:
    if int(max_text_length) <= 0:
        raise ValueError("max_text_length must be > 0")
    normalized_charset = _normalize_charset(charset)
    shape = _normalize_image_shape(image_shape)
    paths = ensure_project_directories(project_id)
    logs_dir = paths.outputs / "ocr_logs"
    if not logs_dir.exists() or not logs_dir.is_dir():
        raise FileNotFoundError(f"ocr log directory not found: {logs_dir}")

    log_files = sorted([p for p in logs_dir.glob("*.jsonl") if p.is_file()])
    if not log_files:
        raise FileNotFoundError(f"ocr log files not found under: {logs_dir}")

    latest_by_image: dict[str, dict[str, Any]] = {}
    for log_file in log_files:
        lines = log_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        for line in lines:
            payload: dict[str, Any]
            try:
                payload = json.loads(line)
            except Exception:  # noqa: BLE001
                continue
            if not isinstance(payload, dict):
                continue
            image_key = str(payload.get("image_path") or "").strip()
            if not image_key:
                continue
            # 同一画像の重複ログは最新行を優先
            latest_by_image[image_key] = payload

    records: list[dict[str, Any]] = []
    skipped_invalid_filter = 0
    skipped_empty_text = 0
    skipped_over_max_length = 0
    skipped_charset = 0
    skipped_missing_image = 0
    for payload in latest_by_image.values():
        if only_invalid and bool(payload.get("is_valid", True)):
            skipped_invalid_filter += 1
            continue
        corrected = str(payload.get("corrected_text") or "").strip().upper()
        predicted = str(payload.get("predicted_text") or payload.get("prediction") or "").strip().upper()
        selected = corrected if (include_corrected and corrected) else predicted
        if not selected:
            skipped_empty_text += 1
            continue
        if len(selected) > int(max_text_length):
            skipped_over_max_length += 1
            continue
        if any(ch not in normalized_charset for ch in selected):
            skipped_charset += 1
            continue
        resolved_image = _resolve_logged_image_path(paths.root, str(payload.get("image_path") or ""))
        if resolved_image is None:
            skipped_missing_image += 1
            continue
        records.append(
            {
                "image_path": resolved_image,
                "text": selected,
                "source_log": str(payload.get("source_log") or ""),
                "used_corrected": bool(include_corrected and corrected),
            }
        )

    if not records:
        raise ValueError("No reusable OCR log records found.")

    if output_dir:
        dataset_root = Path(output_dir).expanduser().resolve()
    else:
        dataset_root = (paths.outputs / "ocr_dataset_from_logs" / _now_tag()).resolve()
    if dataset_root.exists():
        if not overwrite:
            raise ValueError(f"output_dir already exists: {dataset_root}")
        shutil.rmtree(dataset_root)
    images_dir = dataset_root / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    lines: list[str] = []
    for idx, row in enumerate(records, start=1):
        file_name = f"log_{idx:06d}.png"
        rel_path = f"images/{file_name}"
        target = dataset_root / rel_path
        processed = preprocess_ocr_image(row["image_path"], image_shape=shape, strong=False)
        processed.save(target)
        lines.append(f"{rel_path}\t{row['text']}")

    dataset_txt = dataset_root / "dataset.txt"
    dataset_txt.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

    meta = {
        "project_id": paths.project_id,
        "dataset_root": str(dataset_root),
        "dataset_file": str(dataset_txt),
        "count": len(lines),
        "source_log_items": len(latest_by_image),
        "only_invalid": bool(only_invalid),
        "include_corrected": bool(include_corrected),
        "max_text_length": int(max_text_length),
        "charset": normalized_charset,
        "image_shape": shape,
        "skipped": {
            "invalid_filter": skipped_invalid_filter,
            "empty_text": skipped_empty_text,
            "over_max_length": skipped_over_max_length,
            "charset": skipped_charset,
            "missing_image": skipped_missing_image,
        },
        "created_at": datetime.now().isoformat(),
    }
    meta_path = dataset_root / "meta.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {**meta, "meta_path": str(meta_path)}


def create_ocr_dataset(
    project_id: Optional[str],
    image_types: Optional[list[str]] = None,
    charset: Optional[str] = None,
    max_text_length: int = 8,
    image_shape: Optional[list[int]] = None,
    use_augmentation: bool = False,
    aug_strength: int = 1,
    train_ratio: float = 0.8,
    val_ratio: float = 0.1,
    test_ratio: float = 0.1,
    seed: int = 42,
    output_dir: Optional[str] = None,
    overwrite: bool = False,
) -> dict[str, Any]:
    selected_types = [str(x).strip().lower() for x in (image_types or ["wide"]) if str(x).strip()]
    if any(x not in {"single", "wide"} for x in selected_types):
        raise ValueError("image_types must be single and/or wide")
    if not selected_types:
        selected_types = ["wide"]

    shape = _normalize_image_shape(image_shape)
    normalized_charset = _normalize_charset(charset)
    if max_text_length <= 0:
        raise ValueError("max_text_length must be > 0")
    if int(aug_strength) < 1 or int(aug_strength) > 3:
        raise ValueError("aug_strength must be between 1 and 3")
    ratio_sum = float(train_ratio) + float(val_ratio) + float(test_ratio)
    if abs(ratio_sum - 1.0) > 1e-6:
        raise ValueError("train/val/test ratio must sum to 1.0")

    paths = ensure_project_directories(project_id)
    rows = read_labels(paths.project_id)

    candidates: list[dict[str, Any]] = []
    skipped_invalid_label = 0
    skipped_missing_source = 0
    skipped_type = 0
    for row in rows:
        image_name = str(row.get("filename") or row.get("image") or "").strip()
        if not image_name:
            continue
        image_type = str(row.get("type") or "").strip().lower()
        if image_type not in selected_types:
            skipped_type += 1
            continue
        text = _sanitize_text(str(row.get("label") or ""), normalized_charset, int(max_text_length))
        if not text:
            skipped_invalid_label += 1
            continue
        src = _resolve_source_image(paths.root, image_name, image_type)
        if src is None:
            skipped_missing_source += 1
            continue
        candidates.append(
            {
                "image_name": image_name,
                "type": image_type,
                "text": text,
                "source": src,
            }
        )

    if not candidates:
        raise ValueError("No valid OCR samples found. Check labels/type/charset/max_text_length.")

    rng = random.Random(int(seed))
    rng.shuffle(candidates)
    n = len(candidates)
    n_train = int(n * float(train_ratio))
    n_val = int(n * float(val_ratio))
    n_test = n - n_train - n_val
    if n_train <= 0:
        n_train = 1
        if n_val > 0:
            n_val -= 1
        elif n_test > 0:
            n_test -= 1

    split_map = {
        "train": candidates[:n_train],
        "val": candidates[n_train : n_train + n_val],
        "test": candidates[n_train + n_val : n_train + n_val + n_test],
    }

    if output_dir:
        dataset_root = Path(output_dir).expanduser().resolve()
    else:
        dataset_root = (paths.outputs / "ocr_dataset" / _now_tag()).resolve()
    if dataset_root.exists():
        if not overwrite:
            raise ValueError(f"output_dir already exists: {dataset_root}")
        shutil.rmtree(dataset_root)
    dataset_root.mkdir(parents=True, exist_ok=True)

    label_lines: dict[str, list[str]] = {"train": [], "val": [], "test": []}
    index_by_split = {"train": 0, "val": 0, "test": 0}
    for split, items in split_map.items():
        split_images_dir = dataset_root / split / "images"
        split_images_dir.mkdir(parents=True, exist_ok=True)
        for sample in items:
            index_by_split[split] += 1
            file_name = f"{split}_{index_by_split[split]:06d}.png"
            rel_path = f"{split}/images/{file_name}"
            dst = dataset_root / rel_path
            img = _prepare_ocr_image(
                sample["source"],
                shape,
                rng=rng,
                use_augmentation=bool(use_augmentation and split == "train"),
                aug_strength=int(aug_strength),
            )
            img.save(dst)
            label_lines[split].append(f"{rel_path}\t{sample['text']}")

    train_file = dataset_root / "train.txt"
    val_file = dataset_root / "val.txt"
    test_file = dataset_root / "test.txt"
    train_file.write_text("\n".join(label_lines["train"]) + ("\n" if label_lines["train"] else ""), encoding="utf-8")
    val_file.write_text("\n".join(label_lines["val"]) + ("\n" if label_lines["val"] else ""), encoding="utf-8")
    test_file.write_text("\n".join(label_lines["test"]) + ("\n" if label_lines["test"] else ""), encoding="utf-8")

    charset_path = dataset_root / "charset.txt"
    charset_path.write_text("\n".join(list(normalized_charset)) + "\n", encoding="utf-8")

    meta = {
        "project_id": paths.project_id,
        "dataset_root": str(dataset_root),
        "image_types": selected_types,
        "charset": normalized_charset,
        "max_text_length": int(max_text_length),
        "image_shape": shape,
        "use_augmentation": bool(use_augmentation),
        "aug_strength": int(aug_strength),
        "train_ratio": float(train_ratio),
        "val_ratio": float(val_ratio),
        "test_ratio": float(test_ratio),
        "seed": int(seed),
        "counts": {k: len(v) for k, v in split_map.items()},
        "skipped": {
            "type": skipped_type,
            "invalid_label": skipped_invalid_label,
            "missing_source": skipped_missing_source,
        },
        "created_at": datetime.now().isoformat(),
    }
    meta_path = dataset_root / "meta.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        **meta,
        "train_file": str(train_file),
        "val_file": str(val_file),
        "test_file": str(test_file),
        "charset_path": str(charset_path),
        "meta_path": str(meta_path),
    }


def _resolve_paddle_base_config(repo_dir: Path) -> Path:
    candidates = [
        repo_dir / "configs/rec/PP-OCRv3/en_PP-OCRv3_rec.yml",
        repo_dir / "configs/rec/PP-OCRv4/en_PP-OCRv4_rec.yml",
        repo_dir / "configs/rec/rec_icdar15_train.yml",
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    raise FileNotFoundError(
        f"PaddleOCR config not found under {repo_dir}. "
        "Please ensure official repo exists and config files are available."
    )


def _read_ocr_label_lines(label_path: Path) -> list[str]:
    if not label_path.exists() or not label_path.is_file():
        return []
    lines = label_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    return [line.strip() for line in lines if "\t" in line and line.strip()]


def _write_ocr_label_lines(label_path: Path, lines: list[str]) -> None:
    label_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _ensure_train_val_from_dataset_txt(
    dataset_root: Path,
    train_txt: Path,
    val_txt: Path,
    test_txt: Path,
    seed: int = 42,
) -> bool:
    """
    dataset.txt しかないデータセットを PaddleOCR 学習用の train/val(/test) に分割して保存する。
    既存 train.txt / val.txt が揃っている場合は何もしない。
    """
    if train_txt.exists() and val_txt.exists():
        return False

    dataset_txt = dataset_root / "dataset.txt"
    lines = _read_ocr_label_lines(dataset_txt)
    if not lines:
        raise FileNotFoundError(f"train.txt not found and dataset.txt is unavailable/empty: {dataset_txt}")

    rng = random.Random(int(seed))
    rng.shuffle(lines)

    total = len(lines)
    if total == 1:
        train_lines = list(lines)
        val_lines = list(lines)
        test_lines: list[str] = []
    else:
        val_count = max(1, int(round(total * 0.1)))
        val_count = min(val_count, total - 1)
        train_count = total - val_count
        if train_count <= 0:
            train_count = total - 1
            val_count = 1
        train_lines = lines[:train_count]
        val_lines = lines[train_count:]
        test_lines = []

    _write_ocr_label_lines(train_txt, train_lines)
    _write_ocr_label_lines(val_txt, val_lines)
    _write_ocr_label_lines(test_txt, test_lines)
    return True


def _ensure_paddle_training_dependencies() -> None:
    required_modules = {
        "paddle": "paddlepaddle",
        "albumentations": "albumentations",
        "lmdb": "lmdb",
        "rapidfuzz": "rapidfuzz",
    }
    missing_packages = [pkg for module, pkg in required_modules.items() if importlib.util.find_spec(module) is None]
    if missing_packages:
        package_list = ", ".join(missing_packages)
        raise ModuleNotFoundError(
            f"Missing required packages for PaddleOCR training: {package_list}. "
            "Run: source .venv/bin/activate && pip install -r requirements-ocr-tuning.txt"
        )


def _register_ocr_model(
    project_id: str,
    engine: str,
    model_dir: Path,
    charset: str,
    max_text_length: int,
    image_shape: list[int],
    dataset_root: Path,
    job_id: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
) -> str:
    paths = ensure_project_directories(project_id)
    paths.models.mkdir(parents=True, exist_ok=True)
    name = f"ocr_{engine}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    model_meta_path = paths.models / f"{name}.ocr.json"
    dataset_meta = {}
    dataset_meta_path = dataset_root / "meta.json"
    if dataset_meta_path.exists() and dataset_meta_path.is_file():
        try:
            dataset_meta = json.loads(dataset_meta_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            dataset_meta = {}
    counts = dataset_meta.get("counts") if isinstance(dataset_meta.get("counts"), dict) else {}
    payload = {
        "name": name,
        "training_family": "ocr",
        "engine": engine,
        "model_type": "ocr",
        "model_dir": str(model_dir.resolve()),
        "charset": charset,
        "max_text_length": int(max_text_length),
        "image_shape": image_shape,
        "dataset_root": str(dataset_root.resolve()),
        "job_id": job_id,
        "training_params": {
            "epochs": int(epochs),
            "batch_size": int(batch_size),
            "learning_rate": float(learning_rate),
        },
        "dataset_split_ratio": {
            "train": float(dataset_meta.get("train_ratio", 0.0)) if isinstance(dataset_meta, dict) else 0.0,
            "val": float(dataset_meta.get("val_ratio", 0.0)) if isinstance(dataset_meta, dict) else 0.0,
            "test": float(dataset_meta.get("test_ratio", 0.0)) if isinstance(dataset_meta, dict) else 0.0,
        },
        "dataset_split_counts": {
            "train": int(counts.get("train", 0)) if counts else 0,
            "val": int(counts.get("val", 0)) if counts else 0,
            "test": int(counts.get("test", 0)) if counts else 0,
            "total": int(dataset_meta.get("count", 0)) if isinstance(dataset_meta, dict) else 0,
        },
        "preprocess": {
            "image_shape": image_shape,
            "image_types": dataset_meta.get("image_types", []) if isinstance(dataset_meta.get("image_types"), list) else [],
            "charset": str(dataset_meta.get("charset") or charset),
            "max_text_length": int(dataset_meta.get("max_text_length", max_text_length)),
        },
        "augmentation": {
            "enabled": bool(dataset_meta.get("use_augmentation")) if "use_augmentation" in dataset_meta else None,
            "strength": int(dataset_meta.get("aug_strength", 0)) if "aug_strength" in dataset_meta else None,
        },
        "created_at": datetime.now().isoformat(),
    }
    model_meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return model_meta_path.name


def run_paddleocr_training(
    project_id: str,
    job_id: str,
    dataset_dir: str,
    paddle_repo_dir: str,
    epochs: int,
    batch_size: int,
    charset: str,
    max_text_length: int,
    image_shape: list[int],
    log_path: Path,
) -> dict[str, Any]:
    _ensure_paddle_training_dependencies()
    dataset_root = Path(dataset_dir).expanduser().resolve()
    repo_dir = Path(paddle_repo_dir).expanduser().resolve()
    if not dataset_root.exists():
        raise FileNotFoundError(f"dataset_dir not found: {dataset_root}")
    if not repo_dir.exists():
        raise FileNotFoundError(f"paddle_repo_dir not found: {repo_dir}")
    train_py = repo_dir / "tools/train.py"
    if not train_py.exists():
        raise FileNotFoundError(f"PaddleOCR train script not found: {train_py}")

    base_config = _resolve_paddle_base_config(repo_dir)

    train_txt = dataset_root / "train.txt"
    val_txt = dataset_root / "val.txt"
    test_txt = dataset_root / "test.txt"
    auto_split_used = _ensure_train_val_from_dataset_txt(
        dataset_root=dataset_root,
        train_txt=train_txt,
        val_txt=val_txt,
        test_txt=test_txt,
        seed=42,
    )
    if not train_txt.exists():
        raise FileNotFoundError(f"train.txt not found: {train_txt}")
    if not val_txt.exists():
        raise FileNotFoundError(f"val.txt not found: {val_txt}")
    train_lines = _read_ocr_label_lines(train_txt)
    val_lines = _read_ocr_label_lines(val_txt)
    if not train_lines:
        raise ValueError(
            f"train.txt is empty: {train_txt}. "
            "Please create OCR dataset again and ensure at least 1 labeled sample."
        )
    val_filled_from_train = False
    if not val_lines:
        # 少数データ時に val=0 になると PaddleOCR 側が不安定になるため、train先頭1件を流用する
        val_lines = [train_lines[0]]
        _write_ocr_label_lines(val_txt, val_lines)
        val_filled_from_train = True
    effective_train_batch = max(1, min(int(batch_size), len(train_lines)))
    effective_eval_batch = max(1, min(int(batch_size), len(val_lines)))
    charset_path = dataset_root / "charset.txt"
    if not charset_path.exists():
        charset_path.write_text("\n".join(list(charset)) + "\n", encoding="utf-8")

    paths = ensure_project_directories(project_id)
    save_model_dir = paths.models / "ocr_runs" / f"{job_id}"
    save_model_dir.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        str(train_py),
        "-c",
        str(base_config),
        "-o",
        "Global.use_gpu=False",
        f"Global.epoch_num={int(epochs)}",
        f"Global.save_model_dir={str(save_model_dir)}",
        f"Global.character_dict_path={str(charset_path)}",
        f"Global.max_text_length={int(max_text_length)}",
        f"Train.dataset.data_dir={str(dataset_root)}",
        f"Train.dataset.label_file_list=['{str(train_txt)}']",
        f"Eval.dataset.data_dir={str(dataset_root)}",
        f"Eval.dataset.label_file_list=['{str(val_txt)}']",
        f"Train.loader.batch_size_per_card={effective_train_batch}",
        f"Eval.loader.batch_size_per_card={effective_eval_batch}",
    ]

    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as log_file:
        if auto_split_used:
            train_count = len(_read_ocr_label_lines(train_txt))
            val_count = len(_read_ocr_label_lines(val_txt))
            log_file.write(
                f"[{datetime.now().isoformat()}] auto_split: dataset.txt -> "
                f"train.txt({train_count}) / val.txt({val_count})\n"
            )
        if val_filled_from_train:
            log_file.write(
                f"[{datetime.now().isoformat()}] val_fallback: val.txt was empty, "
                "copied first sample from train.txt\n"
            )
        if effective_train_batch != int(batch_size) or effective_eval_batch != int(batch_size):
            log_file.write(
                f"[{datetime.now().isoformat()}] batch_adjust: requested={int(batch_size)} "
                f"train={effective_train_batch} eval={effective_eval_batch}\n"
            )
        log_file.write(f"[{datetime.now().isoformat()}] command: {' '.join(command)}\n")
        log_file.flush()
        process = subprocess.Popen(
            command,
            cwd=str(repo_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert process.stdout is not None
        detected_fatal_error = False
        fatal_markers = (
            "ppocr ERROR: No Images in train dataset",
            "Traceback (most recent call last):",
            "ModuleNotFoundError:",
        )
        for line in process.stdout:
            log_file.write(line)
            if any(marker in line for marker in fatal_markers):
                detected_fatal_error = True
        return_code = process.wait()
        log_file.write(f"[{datetime.now().isoformat()}] return_code={return_code}\n")

    if return_code != 0 or detected_fatal_error:
        raise RuntimeError(f"PaddleOCR training failed with exit code {return_code}")

    model_name = _register_ocr_model(
        project_id=project_id,
        engine="paddleocr",
        model_dir=save_model_dir,
        charset=charset,
        max_text_length=max_text_length,
        image_shape=image_shape,
        dataset_root=dataset_root,
        job_id=job_id,
        epochs=int(epochs),
        batch_size=int(batch_size),
        learning_rate=0.0,
    )
    return {
        "model_name": model_name,
        "model_dir": str(save_model_dir),
        "log_path": str(log_path),
        "dataset_dir": str(dataset_root),
    }


def read_training_log_lines(log_path: Path, tail: int = 200) -> list[str]:
    if not log_path.exists() or not log_path.is_file():
        return []
    try:
        lines = log_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:  # noqa: BLE001
        return []
    if tail <= 0:
        return lines
    return lines[-tail:]


def load_ocr_model_meta(project_id: Optional[str], model_name: str) -> Optional[dict[str, Any]]:
    paths = ensure_project_directories(project_id)
    safe_name = Path(model_name).name
    if not safe_name.endswith(".ocr.json"):
        return None
    meta_path = paths.models / safe_name
    if not meta_path.exists() or not meta_path.is_file():
        return None
    try:
        payload = json.loads(meta_path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:  # noqa: BLE001
        return None
    return None
