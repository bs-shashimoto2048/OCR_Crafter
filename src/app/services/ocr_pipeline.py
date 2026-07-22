import base64
import io
import json
import importlib.util
import math
import random
import shutil
import subprocess
import sys
import re
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import numpy as np
import yaml
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from ..project_paths import ensure_project_directories, safe_rmtree
from .labels import read_labels
from .model_registry import resolve_ocr_model_meta
from .preprocess_snapshot import (
    build_training_preprocess,
    compute_training_preprocess_hash,
    load_preprocess_snapshot,
    source_state_of_path,
    summarize_source_states,
)

OCR_CHARSET_DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
CONF_THRESHOLD = 0.9
DEFAULT_BUSINESS_PATTERN = r"^[A-Z0-9]{8}$"
BANNED_PATTERNS = {"AAAAAAAA", "00000000"}
PADDLE_INFERENCE_MARKERS = ("inference.yml", "inference.pdiparams", "inference.pdmodel", "inference.json")
OFFICIAL_PADDLEOCR_REC_SPECS: dict[str, dict[str, str]] = {
    "en_PP-OCRv5_mobile_rec": {
        "config_path": "configs/rec/PP-OCRv5/multi_language/en_PP-OCRv5_mobile_rec.yaml",
        "pretrained_url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/en_PP-OCRv5_mobile_rec_pretrained.pdparams",
    },
    "PP-OCRv5_server_rec": {
        "config_path": "configs/rec/PP-OCRv5/PP-OCRv5_server_rec.yml",
        "pretrained_url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv5_server_rec_pretrained.pdparams",
    },
    "en_PP-OCRv4_mobile_rec": {
        "config_path": "configs/rec/PP-OCRv4/en_PP-OCRv4_mobile_rec.yml",
        "pretrained_url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/en_PP-OCRv4_mobile_rec_pretrained.pdparams",
    },
    "PP-OCRv4_mobile_rec": {
        "config_path": "configs/rec/PP-OCRv4/PP-OCRv4_mobile_rec.yml",
        "pretrained_url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv4_mobile_rec_pretrained.pdparams",
    },
    "PP-OCRv3_mobile_rec": {
        "config_path": "configs/rec/PP-OCRv3/PP-OCRv3_mobile_rec.yml",
        "pretrained_url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv3_mobile_rec_pretrained.pdparams",
    },
}


def _ensure_paddle_runtime_env() -> None:
    # Keep Paddle cache/home inside workspace to avoid permission issues on locked profiles.
    workspace_root = Path(__file__).resolve().parents[3]
    runtime_home = workspace_root / ".runtime_home"
    cache_home = workspace_root / ".cache"
    paddle_home = cache_home / "paddle"
    data_home = paddle_home / "dataset"
    runtime_home.mkdir(parents=True, exist_ok=True)
    cache_home.mkdir(parents=True, exist_ok=True)
    paddle_home.mkdir(parents=True, exist_ok=True)
    data_home.mkdir(parents=True, exist_ok=True)
    os.environ["HOME"] = str(runtime_home)
    os.environ["USERPROFILE"] = str(runtime_home)
    os.environ["XDG_CACHE_HOME"] = str(cache_home)
    os.environ["PADDLE_HOME"] = str(paddle_home)
    os.environ["DATA_HOME"] = str(data_home)


def _load_torch_module() -> Optional[Any]:
    if importlib.util.find_spec("torch") is None:
        return None
    try:
        import torch  # type: ignore
    except Exception:  # noqa: BLE001
        return None
    return torch


def detect_torch_cuda_available() -> bool:
    torch = _load_torch_module()
    if torch is None:
        return False
    try:
        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return False


def _read_nvidia_smi_device_info() -> Optional[dict[str, Any]]:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception:  # noqa: BLE001
        return None
    if int(result.returncode) != 0:
        return None
    for row in str(result.stdout or "").splitlines():
        line = row.strip()
        if not line:
            continue
        parts = [segment.strip() for segment in line.split(",")]
        if len(parts) < 2:
            continue
        name = str(parts[0] or "").strip()
        try:
            memory_total_mb = float(parts[1])
        except Exception:  # noqa: BLE001
            memory_total_mb = 0.0
        return {"name": name, "memory_total_mb": float(memory_total_mb)}
    return None


def get_vram_gb() -> float:
    torch = _load_torch_module()
    if torch is not None:
        try:
            if torch.cuda.is_available():
                return float(torch.cuda.get_device_properties(0).total_memory) / float(1024**3)
        except Exception:  # noqa: BLE001
            pass
    info = _read_nvidia_smi_device_info()
    if info is None:
        return 0.0
    return float(info.get("memory_total_mb") or 0.0) / float(1024.0)


def auto_batch_size(vram_gb: float) -> int:
    if float(vram_gb) >= 16.0:
        return 64
    if float(vram_gb) >= 12.0:
        return 48
    if float(vram_gb) >= 8.0:
        return 24
    if float(vram_gb) >= 6.0:
        return 16
    return 8


def get_gpu_name() -> str:
    torch = _load_torch_module()
    if torch is not None:
        try:
            if torch.cuda.is_available():
                return str(torch.cuda.get_device_name(0))
        except Exception:  # noqa: BLE001
            pass
    info = _read_nvidia_smi_device_info()
    if info is None:
        return ""
    return str(info.get("name") or "").strip()


def _read_nvidia_smi_metrics() -> Optional[dict[str, float]]:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used",
                "--format=csv,noheader,nounits",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception:  # noqa: BLE001
        return None
    if int(result.returncode) != 0:
        return None
    line = ""
    for row in str(result.stdout or "").splitlines():
        row = row.strip()
        if row:
            line = row
            break
    if not line:
        return None
    parts = [segment.strip() for segment in line.split(",")]
    if len(parts) < 2:
        return None
    try:
        gpu_usage = float(parts[0])
        memory_used_mb = float(parts[1])
    except Exception:  # noqa: BLE001
        return None
    return {
        "gpu_usage": float(gpu_usage),
        "vram_usage": float(memory_used_mb) / float(1024.0),
    }


def _extract_avg_step_time(line: str) -> Optional[float]:
    matched = re.search(r"avg_batch_cost:\s*([0-9.eE+-]+)\s*s", str(line or ""))
    if not matched:
        return None
    try:
        return float(matched.group(1))
    except Exception:  # noqa: BLE001
        return None


def detect_paddle_gpu_available() -> bool:
    _ensure_paddle_runtime_env()
    if importlib.util.find_spec("paddle") is None:
        return False
    try:
        import paddle  # type: ignore
    except Exception:  # noqa: BLE001
        return False
    try:
        if not bool(paddle.device.is_compiled_with_cuda()):
            return False
        return int(paddle.device.cuda.device_count()) > 0
    except Exception:  # noqa: BLE001
        return False


def _resolve_paddle_use_gpu(device: str) -> tuple[bool, str]:
    normalized = str(device or "auto").strip().lower()
    if normalized not in {"auto", "cpu", "gpu"}:
        raise ValueError(f"unsupported device: {device}")
    gpu_available = detect_paddle_gpu_available()
    if normalized == "cpu":
        return False, "cpu"
    if normalized == "gpu":
        if not gpu_available:
            raise RuntimeError("device=gpu was requested, but CUDA GPU is not available for PaddlePaddle.")
        return True, "gpu"
    if gpu_available:
        return True, "gpu"
    return False, "cpu"


def _now_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _apply_text_case(value: str, text_case: str = "upper") -> str:
    mode = str(text_case or "upper").strip().lower()
    if mode == "lower":
        return value.lower()
    if mode == "keep":
        return value
    return value.upper()


def _normalize_charset(charset: Optional[str], text_case: str = "upper") -> str:
    cased = _apply_text_case((charset or OCR_CHARSET_DEFAULT).strip(), text_case)
    normalized = "".join(dict.fromkeys(cased))
    if not normalized:
        normalized = _apply_text_case(OCR_CHARSET_DEFAULT, text_case)
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


def _sanitize_text(raw: str, charset: str, max_text_length: int, text_case: str = "upper") -> str:
    value = _apply_text_case(str(raw or "").strip(), text_case)
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


def compute_split_counts(total: int, train_ratio: float, val_ratio: float, test_ratio: float) -> dict[str, int]:
    """Train/Val/Test の分割枚数を最大剰余法（Largest Remainder Method）で算出する。

    - `int(n*ratio)` の単純切り捨ては浮動小数点誤差で期待値からずれる
      （例: 1000*0.85 = 849.9999... → 849）ため使用しない。
    - 各分割は floor（微小誤差はepsilonで補正）で仮確定し、残り枚数を小数部分の大きい順に1枚ずつ配分する。
    - 小数部分が同値の場合の優先順位は Train → Val → Test で固定（仕様）。
    - 常に train+val+test == total を保証する（重複・欠落なし）。
    """
    n = int(total)
    if n <= 0:
        return {"train": 0, "val": 0, "test": 0}
    ratios = [float(train_ratio), float(val_ratio), float(test_ratio)]
    eps = 1e-9
    raw = [n * r for r in ratios]
    counts = [math.floor(v + eps) for v in raw]
    remaining = n - sum(counts)
    # 小数部分の大きい順（同値はindex昇順=Train優先）へ残りを配分
    fractions = sorted(
        ((max(0.0, raw[i] - counts[i]), -i) for i in range(3)),
        reverse=True,
    )
    for frac, neg_index in fractions:
        if remaining <= 0:
            break
        counts[-neg_index] += 1
        remaining -= 1
    # train_ratio > 0 なのに train=0 になる極小ケースは train を最低1枚確保
    if counts[0] <= 0 and ratios[0] > 0 and n > 0:
        donor = 1 if counts[1] > 0 else 2
        counts[donor] -= 1
        counts[0] = 1
    return {"train": counts[0], "val": counts[1], "test": counts[2]}


# 学習時オーグメンテーションの既定（弱いプリセット）。
# OCRの短い文字列・筆記体を破壊しない弱い値のみ（強いプリセットは意図的に提供しない）
WEAK_AUGMENTATION_CONFIG: dict[str, Any] = {
    "preset": "weak",
    "multiplier": 1.5,
    "rotation": {"enabled": True, "max_degrees": 2.0, "probability": 0.3},
    "brightness": {"enabled": True, "range": 0.1, "probability": 0.3},
    "contrast": {"enabled": True, "range": 0.1, "probability": 0.3},
    "blur": {"enabled": True, "strength": "weak", "probability": 0.1},
    "noise": {"enabled": True, "strength": "weak", "probability": 0.1},
}


def _clamp(value: Any, low: float, high: float, default: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(v):
        return default
    return max(low, min(high, v))


def parse_augmentation_config(raw: Any) -> Optional[dict[str, Any]]:
    """学習時オーグメンテーション設定を正規化する。無効（None/preset=none）は None を返す。

    値は安全範囲へクランプ: 回転±10°以内 / 明るさ・コントラスト±50%以内 / 確率0〜1 /
    強度は weak のみ（将来拡張用にmediumも許容）/ 生成倍率1.0〜3.0。
    """
    if not isinstance(raw, dict):
        return None
    preset = str(raw.get("preset") or "custom").strip().lower()
    if preset == "none":
        return None
    if preset not in {"weak", "custom"}:
        preset = "custom"

    def _transform(key: str, defaults: dict[str, Any], value_key: Optional[str] = None, value_range=(0.0, 0.5)) -> dict[str, Any]:
        entry = raw.get(key) if isinstance(raw.get(key), dict) else {}
        # weak=未指定の変換も推奨値で有効 / custom=明示的にenabledにした変換のみ有効
        default_enabled = bool(defaults.get("enabled", False)) if preset == "weak" else False
        out: dict[str, Any] = {
            "enabled": bool(entry.get("enabled", default_enabled)),
            "probability": _clamp(entry.get("probability", defaults.get("probability", 0.3)), 0.0, 1.0, defaults.get("probability", 0.3)),
        }
        if value_key == "max_degrees":
            out["max_degrees"] = _clamp(entry.get("max_degrees", defaults.get("max_degrees", 2.0)), 0.0, 10.0, defaults.get("max_degrees", 2.0))
        elif value_key == "range":
            out["range"] = _clamp(entry.get("range", defaults.get("range", 0.1)), value_range[0], value_range[1], defaults.get("range", 0.1))
        elif value_key == "strength":
            strength = str(entry.get("strength", defaults.get("strength", "weak")) or "weak").strip().lower()
            out["strength"] = strength if strength in {"weak", "medium"} else "weak"
        return out

    config = {
        "preset": preset,
        "multiplier": _clamp(raw.get("multiplier", 1.5), 1.0, 3.0, 1.5),
        "rotation": _transform("rotation", WEAK_AUGMENTATION_CONFIG["rotation"], "max_degrees"),
        "brightness": _transform("brightness", WEAK_AUGMENTATION_CONFIG["brightness"], "range"),
        "contrast": _transform("contrast", WEAK_AUGMENTATION_CONFIG["contrast"], "range"),
        "blur": _transform("blur", WEAK_AUGMENTATION_CONFIG["blur"], "strength"),
        "noise": _transform("noise", WEAK_AUGMENTATION_CONFIG["noise"], "strength"),
    }
    if not any(config[key]["enabled"] for key in ("rotation", "brightness", "contrast", "blur", "noise")):
        return None
    return config


def _apply_augmentation_config(image: Image.Image, rng: random.Random, config: dict[str, Any]) -> Image.Image:
    """設定に基づくランダム変換をTrain画像へ適用する（ラベルは変更しない）。"""
    pil = image.convert("RGB")
    rot = config.get("rotation") or {}
    if rot.get("enabled") and rng.random() < float(rot.get("probability", 0)):
        max_deg = float(rot.get("max_degrees", 2.0))
        angle = rng.uniform(-max_deg, max_deg)
        pil = pil.rotate(angle, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(255, 255, 255))
    bri = config.get("brightness") or {}
    if bri.get("enabled") and rng.random() < float(bri.get("probability", 0)):
        r = float(bri.get("range", 0.1))
        pil = ImageEnhance.Brightness(pil).enhance(rng.uniform(1.0 - r, 1.0 + r))
    con = config.get("contrast") or {}
    if con.get("enabled") and rng.random() < float(con.get("probability", 0)):
        r = float(con.get("range", 0.1))
        pil = ImageEnhance.Contrast(pil).enhance(rng.uniform(1.0 - r, 1.0 + r))
    blur = config.get("blur") or {}
    if blur.get("enabled") and rng.random() < float(blur.get("probability", 0)):
        radius = rng.uniform(0.3, 0.6) if str(blur.get("strength")) != "medium" else rng.uniform(0.5, 0.9)
        pil = pil.filter(ImageFilter.GaussianBlur(radius=radius))
    noise = config.get("noise") or {}
    if noise.get("enabled") and rng.random() < float(noise.get("probability", 0)):
        sigma = 3.0 if str(noise.get("strength")) != "medium" else 6.0
        arr = np.asarray(pil).astype(np.float32)
        np_rng = np.random.default_rng(rng.randrange(0, 2**32 - 1))
        arr = np.clip(arr + np_rng.normal(loc=0.0, scale=sigma, size=arr.shape).astype(np.float32), 0, 255).astype(np.uint8)
        pil = Image.fromarray(arr, mode="RGB")
    return pil


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
    text_case: str = "upper",
) -> dict[str, Any]:
    # text_case="keep" のとき大小文字を保持して検証する（小文字を出力に含める設定用）。
    # 既定は従来どおり大文字へ正規化する
    allowed = set(_normalize_charset(charset, text_case))
    raw = _apply_text_case(str(text or "").strip(), text_case)
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
            # 大小文字はログ保存時のまま返す（Tesseractの小文字 k/l/t を復元時に失わないため）
            predicted_text = str(payload.get("predicted_text") or payload.get("prediction") or "").strip()
            corrected_text = str(payload.get("corrected_text") or "").strip()
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
    text_case: str = "upper",
) -> dict[str, Any]:
    if int(max_text_length) <= 0:
        raise ValueError("max_text_length must be > 0")
    normalized_charset = _normalize_charset(charset, text_case)
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
        corrected = _apply_text_case(str(payload.get("corrected_text") or "").strip(), text_case)
        predicted = _apply_text_case(str(payload.get("predicted_text") or payload.get("prediction") or "").strip(), text_case)
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
        # overwrite=true でも削除はプロジェクトの outputs 配下に限定（API入力パスの封じ込め）
        safe_rmtree(dataset_root, [paths.outputs], label="ocr_dataset_from_logs overwrite")
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
        "text_case": str(text_case or "upper").strip().lower(),
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


def _validate_split_ratios(train_ratio: float, val_ratio: float, test_ratio: float) -> None:
    """比率合計の検証（浮動小数点誤差を許容）。"""
    ratio_sum = float(train_ratio) + float(val_ratio) + float(test_ratio)
    if not math.isclose(ratio_sum, 1.0, rel_tol=0, abs_tol=1e-6):
        raise ValueError("train/val/test ratio must sum to 1.0")


def _collect_ocr_candidates(
    paths: Any,
    selected_types: list[str],
    normalized_charset: str,
    max_text_length: int,
    text_case: str,
) -> tuple[list[dict[str, Any]], dict[str, int], int]:
    """ラベル行から分割対象の有効サンプルを集める。

    戻り値: (candidates, skipped内訳, 入力行数)。除外理由=対象外type / ラベル不正（空・charset外・長さ超過）/ 元画像なし。
    """
    rows = read_labels(paths.project_id)
    candidates: list[dict[str, Any]] = []
    skipped_invalid_label = 0
    skipped_missing_source = 0
    skipped_type = 0
    input_count = 0
    for row in rows:
        image_name = str(row.get("filename") or row.get("image") or "").strip()
        if not image_name:
            continue
        input_count += 1
        image_type = str(row.get("type") or "").strip().lower()
        if image_type not in selected_types:
            skipped_type += 1
            continue
        text = _sanitize_text(str(row.get("label") or ""), normalized_charset, int(max_text_length), text_case)
        if not text:
            skipped_invalid_label += 1
            continue
        src = _resolve_source_image(paths.root, image_name, image_type)
        if src is None:
            skipped_missing_source += 1
            continue
        # 学習ソース画像の由来（processed / interim / raw）。前処理適用状態の記録・警告に使う
        source_state = source_state_of_path(src, paths.root)
        candidates.append(
            {"image_name": image_name, "type": image_type, "text": text, "source": src, "source_state": source_state}
        )
    skipped = {
        "type": skipped_type,
        "invalid_label": skipped_invalid_label,
        "missing_source": skipped_missing_source,
    }
    return candidates, skipped, input_count


def preview_ocr_dataset_split(
    project_id: Optional[str],
    image_types: Optional[list[str]] = None,
    charset: Optional[str] = None,
    max_text_length: int = 8,
    text_case: str = "upper",
    train_ratio: float = 0.8,
    val_ratio: float = 0.1,
    test_ratio: float = 0.1,
) -> dict[str, Any]:
    """データセット作成前の分割予定枚数プレビュー（画像は生成しない）。

    入力画像数（ラベル行数）と有効画像数（分割対象）を分けて返し、除外内訳も返す。
    枚数は作成時と同じ最大剰余法（compute_split_counts）で算出する。
    """
    selected_types = [str(x).strip().lower() for x in (image_types or ["wide"]) if str(x).strip()] or ["wide"]
    if any(x not in {"single", "wide"} for x in selected_types):
        raise ValueError("image_types must be single and/or wide")
    _validate_split_ratios(train_ratio, val_ratio, test_ratio)
    normalized_charset = _normalize_charset(charset, text_case)
    paths = ensure_project_directories(project_id)
    candidates, skipped, input_count = _collect_ocr_candidates(
        paths, selected_types, normalized_charset, int(max_text_length), text_case
    )
    valid_count = len(candidates)
    counts = compute_split_counts(valid_count, train_ratio, val_ratio, test_ratio)
    return {
        "project_id": paths.project_id,
        "input_count": input_count,
        "valid_count": valid_count,
        "skipped": skipped,
        "counts": counts,
        "split_method": "image",
        "ratios": {"train": float(train_ratio), "val": float(val_ratio), "test": float(test_ratio)},
    }


def preview_ocr_augmentation(
    project_id: Optional[str],
    augmentation: Optional[dict[str, Any]],
    image_types: Optional[list[str]] = None,
    charset: Optional[str] = None,
    max_text_length: int = 8,
    text_case: str = "upper",
    image_shape: Optional[list[int]] = None,
    sample_count: int = 3,
    seed: Optional[int] = None,
) -> dict[str, Any]:
    """学習前のオーグメンテーションプレビュー。ランダムなサンプル画像へ設定を適用し、
    元画像/適用後をbase64で返す（ディスクへは書き込まない・ラベルは変更しない）。"""
    config = parse_augmentation_config(augmentation)
    if config is None:
        raise ValueError("augmentation config is empty (preset=none or all transforms disabled)")
    selected_types = [str(x).strip().lower() for x in (image_types or ["wide"]) if str(x).strip()] or ["wide"]
    normalized_charset = _normalize_charset(charset, text_case)
    shape = _normalize_image_shape(image_shape)
    paths = ensure_project_directories(project_id)
    candidates, _, _ = _collect_ocr_candidates(paths, selected_types, normalized_charset, int(max_text_length), text_case)
    if not candidates:
        raise ValueError("No valid OCR samples found. Check labels/type/charset/max_text_length.")
    # seed未指定は毎回異なるサンプル・変換（強すぎる設定の発見が目的のため）
    rng = random.Random(int(seed) if seed is not None else time.time_ns())
    count = max(1, min(int(sample_count or 3), 5, len(candidates)))
    samples = rng.sample(candidates, count)

    def _b64(img: Image.Image) -> str:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

    items = []
    for sample in samples:
        original = preprocess_ocr_image(sample["source"], image_shape=shape, strong=False)
        augmented = preprocess_ocr_image(
            _apply_augmentation_config(original, rng=rng, config=config), image_shape=shape, strong=False
        )
        items.append({"image_name": sample["image_name"], "label": sample["text"], "original": _b64(original), "augmented": _b64(augmented)})
    return {"items": items, "config": config}


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
    text_case: str = "upper",
    augmentation: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    selected_types = [str(x).strip().lower() for x in (image_types or ["wide"]) if str(x).strip()]
    if any(x not in {"single", "wide"} for x in selected_types):
        raise ValueError("image_types must be single and/or wide")
    if not selected_types:
        selected_types = ["wide"]

    shape = _normalize_image_shape(image_shape)
    normalized_charset = _normalize_charset(charset, text_case)
    if max_text_length <= 0:
        raise ValueError("max_text_length must be > 0")
    if int(aug_strength) < 1 or int(aug_strength) > 3:
        raise ValueError("aug_strength must be between 1 and 3")
    _validate_split_ratios(train_ratio, val_ratio, test_ratio)
    # 新形式のオーグメンテーション設定（回転/明るさ/コントラスト/ぼかし/ノイズの個別設定＋生成倍率）。
    # 無効（None）なら旧 use_augmentation/aug_strength の従来動作（後方互換）
    aug_config = parse_augmentation_config(augmentation)

    paths = ensure_project_directories(project_id)
    candidates, skipped, input_count = _collect_ocr_candidates(
        paths, selected_types, normalized_charset, int(max_text_length), text_case
    )

    if not candidates:
        raise ValueError("No valid OCR samples found. Check labels/type/charset/max_text_length.")

    rng = random.Random(int(seed))
    rng.shuffle(candidates)
    n = len(candidates)
    # 最大剰余法で train+val+test == n を保証（int切り捨ての浮動小数点ずれを排除）
    split_counts = compute_split_counts(n, float(train_ratio), float(val_ratio), float(test_ratio))
    n_train = split_counts["train"]
    n_val = split_counts["val"]
    n_test = split_counts["test"]

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
        # overwrite=true でも削除はプロジェクトの outputs 配下に限定（API入力パスの封じ込め）
        safe_rmtree(dataset_root, [paths.outputs], label="ocr_dataset overwrite")
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
                # 新形式設定時は元画像を無加工で必ず残す（追加分だけを別生成）。
                # 旧 use_augmentation は従来どおり train 画像自体へ適用（後方互換）
                use_augmentation=bool(use_augmentation and aug_config is None and split == "train"),
                aug_strength=int(aug_strength),
            )
            img.save(dst)
            label_lines[split].append(f"{rel_path}\t{sample['text']}")

    # 新形式オーグメンテーション: Trainのみへ適用した追加画像を生成（Val/Test/評価データには適用しない）。
    # 生成枚数 = (生成倍率 - 1.0) × Train枚数。元画像と同じ正解ラベルを使う（ラベル不変）
    augmented_count = 0
    if aug_config is not None and split_map["train"]:
        extra_total = int(round((float(aug_config.get("multiplier", 1.5)) - 1.0) * len(split_map["train"])))
        train_images_dir = dataset_root / "train" / "images"
        for i in range(extra_total):
            sample = split_map["train"][i % len(split_map["train"])]
            augmented_count += 1
            file_name = f"train_aug_{augmented_count:06d}.png"
            rel_path = f"train/images/{file_name}"
            base = preprocess_ocr_image(sample["source"], image_shape=shape, strong=False)
            img = preprocess_ocr_image(
                _apply_augmentation_config(base, rng=rng, config=aug_config), image_shape=shape, strong=False
            )
            img.save(train_images_dir / file_name)
            label_lines["train"].append(f"{rel_path}\t{sample['text']}")

    train_file = dataset_root / "train.txt"
    val_file = dataset_root / "val.txt"
    test_file = dataset_root / "test.txt"
    train_file.write_text("\n".join(label_lines["train"]) + ("\n" if label_lines["train"] else ""), encoding="utf-8")
    val_file.write_text("\n".join(label_lines["val"]) + ("\n" if label_lines["val"] else ""), encoding="utf-8")
    test_file.write_text("\n".join(label_lines["test"]) + ("\n" if label_lines["test"] else ""), encoding="utf-8")

    charset_path = dataset_root / "charset.txt"
    charset_path.write_text("\n".join(list(normalized_charset)) + "\n", encoding="utf-8")

    # 学習時前処理の確定保存: 作成時点の processed スナップショットをデータセットへ焼き込む。
    # スナップショット未保存（旧プロジェクト等）は None（未記録。推測で補完しない）。
    # processed/ 画像は既に前処理適用済みのため、ここでは再適用しない（二重前処理防止）
    snapshot = load_preprocess_snapshot(paths.root)
    training_preprocess = build_training_preprocess(snapshot, selected_types, shape)
    training_preprocess_hash = compute_training_preprocess_hash(training_preprocess)
    # 学習データの由来（processed / interim / raw）。processed 以外の混在は警告する
    source_summary = summarize_source_states([str(c.get("source_state") or "") for c in candidates])

    meta = {
        "project_id": paths.project_id,
        "dataset_root": str(dataset_root),
        "image_types": selected_types,
        "charset": normalized_charset,
        "text_case": str(text_case or "upper").strip().lower(),
        "max_text_length": int(max_text_length),
        "image_shape": shape,
        "use_augmentation": bool(use_augmentation),
        "aug_strength": int(aug_strength),
        # 新形式のオーグメンテーション設定（None=未使用。学習条件比較で表示）
        "augmentation": aug_config,
        "augmentation_generated": int(augmented_count),
        "train_ratio": float(train_ratio),
        "val_ratio": float(val_ratio),
        "test_ratio": float(test_ratio),
        "seed": int(seed),
        # 分割方式（現状は画像単位のみ。グループ/Series単位は未実装）
        "split_method": "image",
        "input_count": int(input_count),
        "valid_count": int(n),
        "counts": {k: len(v) for k, v in split_map.items()},
        "skipped": skipped,
        # 学習時前処理（processedスナップショットの確定保存。未記録=None・推測補完しない）
        "training_preprocess": training_preprocess,
        "training_preprocess_hash": training_preprocess_hash,
        # 学習データの由来（processed=前処理適用済み画像。二重適用防止の判定に使う）
        "source_image_state": source_summary["overall"],
        "source_priority": ["processed", "interim", "raw"],
        "source_state_counts": source_summary["counts"],
        "source_preprocess_snapshot_id": str((snapshot or {}).get("snapshot_id") or ""),
        "source_warning": source_summary["warning"],
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


def resolve_official_paddleocr_rec_spec(model_name: str) -> Optional[dict[str, str]]:
    key = str(model_name or "").strip()
    if not key:
        return None
    spec = OFFICIAL_PADDLEOCR_REC_SPECS.get(key)
    if not isinstance(spec, dict):
        return None
    return {
        "model_name": key,
        "config_path": str(spec.get("config_path") or ""),
        "pretrained_url": str(spec.get("pretrained_url") or ""),
    }


def _resolve_paddle_base_config(repo_dir: Path, official_model_name: Optional[str] = None) -> Path:
    if official_model_name:
        official_spec = resolve_official_paddleocr_rec_spec(str(official_model_name))
        if official_spec is None:
            raise FileNotFoundError(f"unsupported official PaddleOCR rec model: {official_model_name}")
        official_candidate = repo_dir / str(official_spec.get("config_path") or "")
        if official_candidate.exists() and official_candidate.is_file():
            return official_candidate
        raise FileNotFoundError(f"official PaddleOCR config not found: {official_candidate}")

    candidates = [
        repo_dir / "configs/rec/PP-OCRv5/multi_language/en_PP-OCRv5_mobile_rec.yaml",
        repo_dir / "configs/rec/PP-OCRv5/PP-OCRv5_mobile_rec.yml",
        repo_dir / "configs/rec/PP-OCRv4/en_PP-OCRv4_mobile_rec.yml",
        repo_dir / "configs/rec/PP-OCRv3/en_PP-OCRv3_mobile_rec.yml",
        repo_dir / "configs/rec/PP-OCRv3/PP-OCRv3_mobile_rec.yml",
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


def _is_paddle_inference_dir(path: Path) -> bool:
    if not path.exists() or not path.is_dir():
        return False
    weights = path / "inference.pdiparams"
    graph_candidates = [path / "inference.pdmodel", path / "inference.json"]
    has_graph = any(item.exists() and item.is_file() for item in graph_candidates)
    return weights.exists() and weights.is_file() and has_graph


def _resolve_checkpoints_prefix(checkpoint_dir: Path) -> Path:
    latest = checkpoint_dir / "latest.pdparams"
    if latest.exists() and latest.is_file():
        return checkpoint_dir / "latest"
    candidates = sorted(checkpoint_dir.glob("iter_epoch_*.pdparams"))
    if not candidates:
        raise FileNotFoundError(f"checkpoint file not found under: {checkpoint_dir}")
    picked = candidates[-1]
    return checkpoint_dir / picked.stem


def _resolve_export_model_prefix(model_dir: Path) -> Path:
    preferred = model_dir / "best_accuracy.pdparams"
    if preferred.exists() and preferred.is_file():
        return model_dir / "best_accuracy"
    return _resolve_checkpoints_prefix(model_dir)


def _normalize_exported_inference_yaml(inference_dir: Path) -> None:
    yml_path = inference_dir / "inference.yml"
    if not yml_path.exists() or not yml_path.is_file():
        return
    payload = yaml.safe_load(yml_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return
    preprocess = payload.get("PreProcess")
    if not isinstance(preprocess, dict):
        return
    ops = preprocess.get("transform_ops")
    if not isinstance(ops, list):
        return
    normalized_ops: list[dict[str, Any]] = []
    for op in ops:
        if not isinstance(op, dict) or len(op) != 1:
            continue
        op_name = str(next(iter(op.keys())))
        if op_name.endswith("LabelEncode"):
            continue
        if op_name == "KeepKeys":
            normalized_ops.append({"KeepKeys": {"keep_keys": ["image"]}})
            continue
        normalized_ops.append(op)
    preprocess["transform_ops"] = normalized_ops
    yml_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _export_paddle_inference_model(
    repo_dir: Path,
    config_path: Path,
    model_prefix: Path,
    save_inference_dir: Path,
    log_file: Optional[Any] = None,
) -> Path:
    export_py = repo_dir / "tools/export_model.py"
    if not export_py.exists() or not export_py.is_file():
        raise FileNotFoundError(f"PaddleOCR export script not found: {export_py}")
    if not config_path.exists() or not config_path.is_file():
        raise FileNotFoundError(f"config file not found for export: {config_path}")
    if not (Path(str(model_prefix) + ".pdparams")).exists():
        raise FileNotFoundError(f"checkpoint params not found: {model_prefix}.pdparams")

    save_inference_dir.mkdir(parents=True, exist_ok=True)
    export_home = (save_inference_dir / "_home").resolve()
    export_cache = (save_inference_dir / "_cache").resolve()
    export_paddle_home = (save_inference_dir / "_paddle_home").resolve()
    export_home.mkdir(parents=True, exist_ok=True)
    export_cache.mkdir(parents=True, exist_ok=True)
    export_paddle_home.mkdir(parents=True, exist_ok=True)

    option_candidates = ["Global.pretrained_model", "Global.checkpoints"]
    return_code = -1
    lines: list[str] = []
    success = False
    for option_key in option_candidates:
        command = [
            sys.executable,
            str(export_py),
            "-c",
            str(config_path),
            "-o",
            "Global.use_gpu=False",
            f"{option_key}={str(model_prefix)}",
            f"Global.save_inference_dir={str(save_inference_dir)}",
        ]
        if log_file is not None:
            log_file.write(f"[{datetime.now().isoformat()}] export_command: {' '.join(command)}\n")
            log_file.flush()
        process = subprocess.Popen(
            command,
            cwd=str(repo_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env={
                **os.environ,
                "HOME": str(export_home),
                "XDG_CACHE_HOME": str(export_cache),
                "PADDLE_HOME": str(export_paddle_home),
            },
        )
        assert process.stdout is not None
        lines = []
        for line in process.stdout:
            lines.append(line)
            if log_file is not None:
                log_file.write(line)
        return_code = process.wait()
        if log_file is not None:
            log_file.write(f"[{datetime.now().isoformat()}] export_return_code={return_code}\n")
        if return_code == 0:
            success = True
            break
    if not success:
        tail = "".join(lines[-20:]).strip()
        raise RuntimeError(f"PaddleOCR export failed with exit code {return_code}. {tail}")
    _normalize_exported_inference_yaml(save_inference_dir)
    if not _is_paddle_inference_dir(save_inference_dir):
        raise RuntimeError(f"PaddleOCR export succeeded but inference files not found: {save_inference_dir}")
    return save_inference_dir.resolve()


def export_paddleocr_model(
    config_path: str,
    model_dir: str,
    export_dir: str,
    paddle_repo_dir: str,
    log_file: Optional[Any] = None,
) -> str:
    config = Path(config_path).expanduser().resolve()
    train_dir = Path(model_dir).expanduser().resolve()
    inference_dir = Path(export_dir).expanduser().resolve()
    repo_dir = Path(paddle_repo_dir).expanduser().resolve()
    if not train_dir.exists() or not train_dir.is_dir():
        raise FileNotFoundError(f"model_dir not found: {train_dir}")
    model_prefix = _resolve_export_model_prefix(train_dir)
    exported = _export_paddle_inference_model(
        repo_dir=repo_dir,
        config_path=config,
        model_prefix=model_prefix,
        save_inference_dir=inference_dir,
        log_file=log_file,
    )
    return str(exported)


def _register_ocr_model(
    project_id: str,
    engine: str,
    checkpoint_dir: Path,
    inference_dir: Path,
    charset: str,
    max_text_length: int,
    image_shape: list[int],
    dataset_root: Path,
    job_id: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    training_mode: str = "scratch",
    init_source_type: str = "scratch",
    init_source_value: str = "",
    device: str = "auto",
    resolved_device: str = "cpu",
    train_num_workers: int = 0,
    eval_num_workers: int = 0,
    save_epoch_step: int = 10,
    auto_batch_size_enabled: bool = False,
    use_amp: bool = False,
    pin_memory: bool = False,
    persistent_workers: bool = False,
    vram_gb: float = 0.0,
    effective_train_batch: int = 0,
    effective_eval_batch: int = 0,
    oom_retry_count: int = 0,
    avg_step_time: float = 0.0,
    peak_gpu_usage: float = 0.0,
    peak_vram_usage: float = 0.0,
    metrics_samples: int = 0,
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
        "train_dir": str(checkpoint_dir.resolve()),
        "infer_dir": str(inference_dir.resolve()),
        "exported": True,
        "model_dir": str(inference_dir.resolve()),
        "checkpoint_dir": str(checkpoint_dir.resolve()),
        "inference_dir": str(inference_dir.resolve()),
        "export_ready": True,
        "exported_at": datetime.now().isoformat(),
        "charset": charset,
        "max_text_length": int(max_text_length),
        "image_shape": image_shape,
        "dataset_root": str(dataset_root.resolve()),
        "job_id": job_id,
        "training_params": {
            "epochs": int(epochs),
            "batch_size": int(batch_size),
            "learning_rate": float(learning_rate),
            "training_mode": str(training_mode or "scratch"),
            "init_source_type": str(init_source_type or "scratch"),
            "init_source_value": str(init_source_value or ""),
            "device": str(device or "auto"),
            "resolved_device": str(resolved_device or "cpu"),
            "train_num_workers": int(train_num_workers),
            "eval_num_workers": int(eval_num_workers),
            "save_epoch_step": int(save_epoch_step),
            "auto_batch_size": bool(auto_batch_size_enabled),
            "use_amp": bool(use_amp),
            "pin_memory": bool(pin_memory),
            "persistent_workers": bool(persistent_workers),
            "vram_gb": float(vram_gb),
            "effective_train_batch": int(effective_train_batch),
            "effective_eval_batch": int(effective_eval_batch),
            "oom_retry_count": int(oom_retry_count),
            "avg_step_time": float(avg_step_time),
            "peak_gpu_usage": float(peak_gpu_usage),
            "peak_vram_usage": float(peak_vram_usage),
            "metrics_samples": int(metrics_samples),
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


def register_exported_ocr_model(
    project_id: str,
    engine: str,
    checkpoint_dir: Path,
    inference_dir: Path,
    charset: str,
    max_text_length: int,
    image_shape: list[int],
    dataset_root: Path,
    job_id: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    training_mode: str = "scratch",
    init_source_type: str = "scratch",
    init_source_value: str = "",
    device: str = "auto",
    resolved_device: str = "cpu",
    train_num_workers: int = 0,
    eval_num_workers: int = 0,
    save_epoch_step: int = 10,
    auto_batch_size_enabled: bool = False,
    use_amp: bool = False,
    pin_memory: bool = False,
    persistent_workers: bool = False,
    vram_gb: float = 0.0,
    effective_train_batch: int = 0,
    effective_eval_batch: int = 0,
    oom_retry_count: int = 0,
    avg_step_time: float = 0.0,
    peak_gpu_usage: float = 0.0,
    peak_vram_usage: float = 0.0,
    metrics_samples: int = 0,
) -> str:
    return _register_ocr_model(
        project_id=project_id,
        engine=engine,
        checkpoint_dir=checkpoint_dir,
        inference_dir=inference_dir,
        charset=charset,
        max_text_length=max_text_length,
        image_shape=image_shape,
        dataset_root=dataset_root,
        job_id=job_id,
        epochs=epochs,
        batch_size=batch_size,
        learning_rate=learning_rate,
        training_mode=training_mode,
        init_source_type=init_source_type,
        init_source_value=init_source_value,
        device=device,
        resolved_device=resolved_device,
        train_num_workers=train_num_workers,
        eval_num_workers=eval_num_workers,
        save_epoch_step=save_epoch_step,
        auto_batch_size_enabled=auto_batch_size_enabled,
        use_amp=use_amp,
        pin_memory=pin_memory,
        persistent_workers=persistent_workers,
        vram_gb=vram_gb,
        effective_train_batch=effective_train_batch,
        effective_eval_batch=effective_eval_batch,
        oom_retry_count=oom_retry_count,
        avg_step_time=avg_step_time,
        peak_gpu_usage=peak_gpu_usage,
        peak_vram_usage=peak_vram_usage,
        metrics_samples=metrics_samples,
    )


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
    device: str = "auto",
    auto_batch_size_enabled: bool = False,
    train_num_workers: int = 0,
    eval_num_workers: int = 0,
    save_epoch_step: int = 10,
    use_amp: bool = False,
    pin_memory: bool = False,
    persistent_workers: bool = False,
    training_mode: str = "scratch",
    init_source_type: str = "scratch",
    init_source_value: Optional[str] = None,
) -> dict[str, Any]:
    _ensure_paddle_training_dependencies()
    _ensure_paddle_runtime_env()
    dataset_root = Path(dataset_dir).expanduser().resolve()
    repo_dir = Path(paddle_repo_dir).expanduser().resolve()
    if not dataset_root.exists():
        raise FileNotFoundError(f"dataset_dir not found: {dataset_root}")
    if not repo_dir.exists():
        raise FileNotFoundError(f"paddle_repo_dir not found: {repo_dir}")
    train_py = repo_dir / "tools/train.py"
    if not train_py.exists():
        raise FileNotFoundError(f"PaddleOCR train script not found: {train_py}")

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
    requested_batch_size = max(1, int(batch_size))
    normalized_train_workers = max(0, int(train_num_workers))
    normalized_eval_workers = max(0, int(eval_num_workers))
    normalized_save_epoch_step = max(1, int(save_epoch_step))
    use_gpu, resolved_device = _resolve_paddle_use_gpu(device)
    normalized_auto_batch_size_enabled = bool(auto_batch_size_enabled)
    normalized_use_amp = bool(use_amp and use_gpu)
    normalized_pin_memory = bool(pin_memory and use_gpu)
    normalized_persistent_workers = bool(persistent_workers and use_gpu and normalized_train_workers > 0)
    gpu_vram_gb = get_vram_gb() if use_gpu else 0.0
    resolved_batch_size = requested_batch_size
    auto_batch_applied = False
    if use_gpu and normalized_auto_batch_size_enabled:
        resolved_batch_size = auto_batch_size(gpu_vram_gb)
        auto_batch_applied = True
    effective_train_batch = max(1, min(int(resolved_batch_size), len(train_lines)))
    effective_eval_batch = max(1, min(int(resolved_batch_size), len(val_lines)))
    charset_path = dataset_root / "charset.txt"
    if not charset_path.exists():
        charset_path.write_text("\n".join(list(charset)) + "\n", encoding="utf-8")

    paths = ensure_project_directories(project_id)
    save_model_dir = paths.models / "ocr_runs" / f"{job_id}"
    save_model_dir.mkdir(parents=True, exist_ok=True)
    normalized_training_mode = str(training_mode or "scratch").strip().lower()
    normalized_init_source_type = str(init_source_type or "scratch").strip().lower()
    resolved_init_source_value = str(init_source_value or "").strip()
    if normalized_training_mode not in {"scratch", "finetune"}:
        raise ValueError(f"unsupported training_mode: {training_mode}")
    if normalized_init_source_type not in {"scratch", "ocr_model"}:
        raise ValueError(f"unsupported init_source_type: {init_source_type}")
    if normalized_training_mode == "scratch":
        normalized_init_source_type = "scratch"
        resolved_init_source_value = ""

    official_init_spec: Optional[dict[str, str]] = None
    init_checkpoint_prefix = ""
    init_pretrained_url = ""
    if normalized_training_mode == "finetune":
        official_init_spec = resolve_official_paddleocr_rec_spec(resolved_init_source_value)
        if normalized_init_source_type != "ocr_model":
            raise ValueError("OCR finetune requires init_source_type=ocr_model")
        if not resolved_init_source_value:
            raise ValueError("init_source_value is required for OCR finetune")
        if official_init_spec is not None:
            init_pretrained_url = str(official_init_spec.get("pretrained_url") or "").strip()
            if not init_pretrained_url:
                raise FileNotFoundError(f"pretrained_url not found for official OCR model: {resolved_init_source_value}")
        else:
            init_model = resolve_ocr_model_meta(
                project_id=project_id,
                model=resolved_init_source_value,
                engine="paddleocr",
            )
            if init_model is None:
                raise FileNotFoundError(f"OCR model not found for fine-tune: {resolved_init_source_value}")
            checkpoint_dir_raw = str(init_model.get("checkpoint_dir") or init_model.get("train_dir") or "").strip()
            if not checkpoint_dir_raw:
                raise FileNotFoundError(f"checkpoint_dir not found in OCR model metadata: {resolved_init_source_value}")
            checkpoint_dir = Path(checkpoint_dir_raw).expanduser().resolve()
            if not checkpoint_dir.exists() or not checkpoint_dir.is_dir():
                raise FileNotFoundError(f"checkpoint_dir not found: {checkpoint_dir}")
            init_checkpoint_prefix = str(_resolve_export_model_prefix(checkpoint_dir))

    base_config = _resolve_paddle_base_config(
        repo_dir,
        official_model_name=(resolved_init_source_value if official_init_spec is not None else None),
    )

    def _build_train_command(train_batch: int, eval_batch: int) -> list[str]:
        override_args: list[str] = [
            f"Global.use_gpu={'True' if use_gpu else 'False'}",
            f"Global.use_amp={'True' if normalized_use_amp else 'False'}",
            f"Global.epoch_num={int(epochs)}",
            f"Global.save_epoch_step={normalized_save_epoch_step}",
            f"Global.save_model_dir={str(save_model_dir)}",
            f"Global.character_dict_path={str(charset_path)}",
            f"Global.max_text_length={int(max_text_length)}",
            f"Train.dataset.data_dir={str(dataset_root)}",
            f"Train.dataset.label_file_list=['{str(train_txt)}']",
            f"Eval.dataset.data_dir={str(dataset_root)}",
            f"Eval.dataset.label_file_list=['{str(val_txt)}']",
            f"Train.loader.batch_size_per_card={int(train_batch)}",
            f"Train.loader.num_workers={normalized_train_workers}",
            "Train.loader.use_shared_memory=False",
            f"Eval.loader.batch_size_per_card={int(eval_batch)}",
            f"Eval.loader.num_workers={normalized_eval_workers}",
            "Eval.loader.use_shared_memory=False",
            "Global.print_batch_step=1",
            (f"Global.pretrained_model={init_pretrained_url}" if init_pretrained_url else "Global.pretrained_model="),
            (f"Global.checkpoints={init_checkpoint_prefix}" if init_checkpoint_prefix else "Global.checkpoints="),
        ]
        if use_gpu:
            override_args.extend(
                [
                    f"Train.loader.pin_memory={'True' if normalized_pin_memory else 'False'}",
                    f"Train.loader.persistent_workers={'True' if normalized_persistent_workers else 'False'}",
                    f"Eval.loader.pin_memory={'True' if normalized_pin_memory else 'False'}",
                    f"Eval.loader.persistent_workers={'True' if normalized_persistent_workers else 'False'}",
                ]
            )
        return [sys.executable, str(train_py), "-c", str(base_config), "-o", *override_args]

    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(
            f"[{datetime.now().isoformat()}] init_mode: mode={normalized_training_mode} "
            f"type={normalized_init_source_type} value={resolved_init_source_value or '-'}\n"
        )
        log_file.write(
            f"[{datetime.now().isoformat()}] runtime: requested_device={str(device or 'auto').strip().lower()} "
            f"resolved_device={resolved_device} use_gpu={use_gpu} "
            f"train_num_workers={normalized_train_workers} eval_num_workers={normalized_eval_workers} "
            f"save_epoch_step={normalized_save_epoch_step} use_amp={normalized_use_amp} "
            f"pin_memory={normalized_pin_memory} persistent_workers={normalized_persistent_workers}\n"
        )
        perf_log = {
            "device": str(device or "auto").strip().lower(),
            "resolved_device": resolved_device,
            "vram_gb": round(float(gpu_vram_gb), 2),
            "batch_size_requested": int(requested_batch_size),
            "batch_size_resolved": int(resolved_batch_size),
            "auto_batch_size_enabled": bool(normalized_auto_batch_size_enabled),
            "auto_batch_applied": bool(auto_batch_applied),
            "train_num_workers": int(normalized_train_workers),
            "eval_num_workers": int(normalized_eval_workers),
            "use_amp": bool(normalized_use_amp),
            "pin_memory": bool(normalized_pin_memory),
            "persistent_workers": bool(normalized_persistent_workers),
        }
        log_file.write(f"[{datetime.now().isoformat()}] perf: {json.dumps(perf_log, ensure_ascii=False)}\n")
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
        if effective_train_batch != int(requested_batch_size) or effective_eval_batch != int(requested_batch_size):
            log_file.write(
                f"[{datetime.now().isoformat()}] batch_adjust: requested={int(requested_batch_size)} "
                f"train={effective_train_batch} eval={effective_eval_batch}\n"
            )
        current_train_batch = int(effective_train_batch)
        current_eval_batch = int(effective_eval_batch)
        oom_retry_count = 0
        max_oom_retry = 1
        return_code = -1
        detected_fatal_error = False
        training_succeeded = False
        latest_step_time = 0.0
        peak_gpu_usage = 0.0
        peak_vram_usage = 0.0
        metrics_samples = 0
        metrics_log_interval_sec = 20.0
        last_metrics_logged_at = 0.0
        while True:
            command = _build_train_command(current_train_batch, current_eval_batch)
            log_file.write(
                f"[{datetime.now().isoformat()}] command: {' '.join(command)} "
                f"(attempt={oom_retry_count + 1}, train_batch={current_train_batch}, eval_batch={current_eval_batch})\n"
            )
            log_file.flush()
            process = subprocess.Popen(
                command,
                cwd=str(repo_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env={
                    **os.environ,
                    "PYTHONUNBUFFERED": "1",
                    "PYTHONIOENCODING": "utf-8",
                },
            )
            assert process.stdout is not None
            detected_fatal_error = False
            detected_oom = False
            fatal_markers = (
                "ppocr ERROR: No Images in train dataset",
                "ModuleNotFoundError:",
            )
            oom_markers = (
                "out of memory",
                "resourceexhaustederror",
                "cuda out of memory",
                "cudnn_status_alloc_failed",
            )
            for line in process.stdout:
                log_file.write(line)
                log_file.flush()
                if any(marker in line for marker in fatal_markers):
                    detected_fatal_error = True
                line_lower = str(line).lower()
                if any(marker in line_lower for marker in oom_markers):
                    detected_oom = True
                step_time = _extract_avg_step_time(line)
                if step_time is not None:
                    latest_step_time = float(step_time)
                if use_gpu:
                    now_monotonic = time.monotonic()
                    if now_monotonic - last_metrics_logged_at >= metrics_log_interval_sec:
                        metrics = _read_nvidia_smi_metrics()
                        if metrics is not None:
                            gpu_usage = float(metrics.get("gpu_usage") or 0.0)
                            vram_usage = float(metrics.get("vram_usage") or 0.0)
                            peak_gpu_usage = max(peak_gpu_usage, gpu_usage)
                            peak_vram_usage = max(peak_vram_usage, vram_usage)
                            metrics_samples += 1
                            metrics_payload = {
                                "batch_size": int(current_train_batch),
                                "step_time": round(float(latest_step_time), 4) if latest_step_time > 0 else None,
                                "gpu_usage": round(gpu_usage, 2),
                                "vram_usage": round(vram_usage, 3),
                            }
                            log_file.write(
                                f"[{datetime.now().isoformat()}] metrics: "
                                f"{json.dumps(metrics_payload, ensure_ascii=False)}\n"
                            )
                            log_file.flush()
                        last_metrics_logged_at = now_monotonic
            return_code = process.wait()
            if use_gpu:
                final_metrics = _read_nvidia_smi_metrics()
                if final_metrics is not None:
                    gpu_usage = float(final_metrics.get("gpu_usage") or 0.0)
                    vram_usage = float(final_metrics.get("vram_usage") or 0.0)
                    peak_gpu_usage = max(peak_gpu_usage, gpu_usage)
                    peak_vram_usage = max(peak_vram_usage, vram_usage)
                    metrics_samples += 1
                    metrics_payload = {
                        "batch_size": int(current_train_batch),
                        "step_time": round(float(latest_step_time), 4) if latest_step_time > 0 else None,
                        "gpu_usage": round(gpu_usage, 2),
                        "vram_usage": round(vram_usage, 3),
                    }
                    log_file.write(
                        f"[{datetime.now().isoformat()}] metrics: "
                        f"{json.dumps(metrics_payload, ensure_ascii=False)}\n"
                    )
            log_file.write(f"[{datetime.now().isoformat()}] return_code={return_code}\n")
            log_file.flush()
            if return_code == 0 and not detected_fatal_error:
                training_succeeded = True
                break
            if detected_oom and oom_retry_count < max_oom_retry and current_train_batch > 8:
                next_train_batch = max(8, current_train_batch // 2)
                if next_train_batch >= current_train_batch:
                    next_train_batch = max(8, current_train_batch - 1)
                next_eval_batch = max(1, min(current_eval_batch, next_train_batch))
                oom_retry_count += 1
                log_file.write(
                    f"[{datetime.now().isoformat()}] warning: OOM detected. retry with "
                    f"train_batch={next_train_batch}, eval_batch={next_eval_batch}\n"
                )
                log_file.flush()
                current_train_batch = int(next_train_batch)
                current_eval_batch = int(next_eval_batch)
                continue
            break

    if not training_succeeded:
        raise RuntimeError(f"PaddleOCR training failed with exit code {return_code}")

    export_config_path = save_model_dir / "config.yml"
    if not export_config_path.exists() or not export_config_path.is_file():
        export_config_path = base_config
    inference_dir = save_model_dir / "inference"
    with log_path.open("a", encoding="utf-8") as log_file:
        export_paddleocr_model(
            config_path=str(export_config_path),
            model_dir=str(save_model_dir),
            export_dir=str(inference_dir),
            paddle_repo_dir=str(repo_dir),
            log_file=log_file,
        )

    model_name = _register_ocr_model(
        project_id=project_id,
        engine="paddleocr",
        checkpoint_dir=save_model_dir,
        inference_dir=inference_dir,
        charset=charset,
        max_text_length=max_text_length,
        image_shape=image_shape,
        dataset_root=dataset_root,
        job_id=job_id,
        epochs=int(epochs),
        batch_size=int(resolved_batch_size),
        learning_rate=0.0,
        training_mode=normalized_training_mode,
        init_source_type=normalized_init_source_type,
        init_source_value=resolved_init_source_value,
        device=str(device or "auto").strip().lower(),
        resolved_device=resolved_device,
        train_num_workers=normalized_train_workers,
        eval_num_workers=normalized_eval_workers,
        save_epoch_step=normalized_save_epoch_step,
        auto_batch_size_enabled=normalized_auto_batch_size_enabled,
        use_amp=normalized_use_amp,
        pin_memory=normalized_pin_memory,
        persistent_workers=normalized_persistent_workers,
        vram_gb=float(gpu_vram_gb),
        effective_train_batch=int(current_train_batch),
        effective_eval_batch=int(current_eval_batch),
        oom_retry_count=int(oom_retry_count),
        avg_step_time=float(latest_step_time),
        peak_gpu_usage=float(peak_gpu_usage),
        peak_vram_usage=float(peak_vram_usage),
        metrics_samples=int(metrics_samples),
    )
    return {
        "model_name": model_name,
        "model_dir": str(inference_dir),
        "checkpoint_dir": str(save_model_dir),
        "inference_dir": str(inference_dir),
        "log_path": str(log_path),
        "dataset_dir": str(dataset_root),
        "training_mode": normalized_training_mode,
        "init_source_type": normalized_init_source_type,
        "init_source_value": resolved_init_source_value,
        "device": str(device or "auto").strip().lower(),
        "resolved_device": resolved_device,
        "train_num_workers": normalized_train_workers,
        "eval_num_workers": normalized_eval_workers,
        "save_epoch_step": normalized_save_epoch_step,
        "auto_batch_size_enabled": normalized_auto_batch_size_enabled,
        "use_amp": normalized_use_amp,
        "pin_memory": normalized_pin_memory,
        "persistent_workers": normalized_persistent_workers,
        "vram_gb": float(gpu_vram_gb),
        "effective_train_batch": int(current_train_batch),
        "effective_eval_batch": int(current_eval_batch),
        "oom_retry_count": int(oom_retry_count),
        "avg_step_time": float(latest_step_time),
        "peak_gpu_usage": float(peak_gpu_usage),
        "peak_vram_usage": float(peak_vram_usage),
        "metrics_samples": int(metrics_samples),
    }


def migrate_ocr_models_to_inference(
    project_id: Optional[str],
    paddle_repo_dir: str,
    overwrite: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    resolved = ensure_project_directories(project_id)
    repo_dir = Path(str(paddle_repo_dir or "")).expanduser().resolve()
    if not repo_dir.exists() or not repo_dir.is_dir():
        raise FileNotFoundError(f"paddle_repo_dir not found: {repo_dir}")

    meta_files = sorted([p for p in resolved.models.glob("*.ocr.json") if p.is_file()])
    results: list[dict[str, Any]] = []
    migrated = 0
    skipped = 0
    failed = 0
    for meta_path in meta_files:
        payload: dict[str, Any]
        try:
            payload = json.loads(meta_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                payload = {}
        except Exception:  # noqa: BLE001
            failed += 1
            results.append({"name": meta_path.name, "status": "failed", "reason": "invalid_meta_json"})
            continue

        engine = str(payload.get("engine") or "paddleocr").strip().lower()
        if engine != "paddleocr":
            skipped += 1
            results.append({"name": meta_path.name, "status": "skipped", "reason": f"unsupported_engine:{engine}"})
            continue

        model_dir_raw = str(payload.get("model_dir") or "").strip()
        model_dir = Path(model_dir_raw).expanduser() if model_dir_raw else None
        inference_dir_raw = str(payload.get("inference_dir") or "").strip()
        inference_dir = Path(inference_dir_raw).expanduser() if inference_dir_raw else None
        checkpoint_dir_raw = str(payload.get("checkpoint_dir") or "").strip()
        checkpoint_dir = Path(checkpoint_dir_raw).expanduser() if checkpoint_dir_raw else None

        if inference_dir is not None and _is_paddle_inference_dir(inference_dir) and not overwrite:
            skipped += 1
            results.append({"name": meta_path.name, "status": "skipped", "reason": "already_exported"})
            continue
        if (
            inference_dir is None
            and model_dir is not None
            and _is_paddle_inference_dir(model_dir)
            and not overwrite
        ):
            skipped += 1
            results.append({"name": meta_path.name, "status": "skipped", "reason": "already_exported"})
            continue

        if checkpoint_dir is None or not checkpoint_dir.exists() or not checkpoint_dir.is_dir():
            if model_dir is not None and (model_dir / "latest.pdparams").exists():
                checkpoint_dir = model_dir
            elif model_dir is not None and model_dir.name == "inference" and model_dir.parent.exists():
                parent = model_dir.parent
                if (parent / "latest.pdparams").exists():
                    checkpoint_dir = parent

        if checkpoint_dir is None or not checkpoint_dir.exists() or not checkpoint_dir.is_dir():
            failed += 1
            results.append({"name": meta_path.name, "status": "failed", "reason": "checkpoint_dir_not_found"})
            continue

        config_path = checkpoint_dir / "config.yml"
        if not config_path.exists() or not config_path.is_file():
            failed += 1
            results.append({"name": meta_path.name, "status": "failed", "reason": "config_not_found"})
            continue

        target_inference_dir = checkpoint_dir / "inference"
        if dry_run:
            migrated += 1
            results.append(
                {
                    "name": meta_path.name,
                    "status": "dry_run",
                    "checkpoint_dir": str(checkpoint_dir.resolve()),
                    "inference_dir": str(target_inference_dir.resolve()),
                }
            )
            continue

        log_path = resolved.logs / f"migrate_export_{meta_path.stem}_{_now_tag()}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with log_path.open("w", encoding="utf-8") as log_file:
                export_paddleocr_model(
                    config_path=str(config_path),
                    model_dir=str(checkpoint_dir),
                    export_dir=str(target_inference_dir),
                    paddle_repo_dir=str(repo_dir),
                    log_file=log_file,
                )
            payload["train_dir"] = str(checkpoint_dir.resolve())
            payload["infer_dir"] = str(target_inference_dir.resolve())
            payload["exported"] = True
            payload["model_dir"] = str(target_inference_dir.resolve())
            payload["checkpoint_dir"] = str(checkpoint_dir.resolve())
            payload["inference_dir"] = str(target_inference_dir.resolve())
            payload["export_ready"] = True
            payload["exported_at"] = datetime.now().isoformat()
            payload["export_log_path"] = str(log_path.resolve())
            meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            migrated += 1
            results.append(
                {
                    "name": meta_path.name,
                    "status": "migrated",
                    "checkpoint_dir": str(checkpoint_dir.resolve()),
                    "inference_dir": str(target_inference_dir.resolve()),
                    "log_path": str(log_path.resolve()),
                }
            )
        except Exception as e:  # noqa: BLE001
            failed += 1
            results.append({"name": meta_path.name, "status": "failed", "reason": str(e), "log_path": str(log_path.resolve())})

    return {
        "project_id": resolved.project_id,
        "total": len(meta_files),
        "migrated": migrated,
        "skipped": skipped,
        "failed": failed,
        "dry_run": bool(dry_run),
        "items": results,
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
