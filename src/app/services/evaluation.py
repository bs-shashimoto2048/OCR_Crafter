import base64
import io
import json
import shutil
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import matplotlib
import torch
from PIL import Image
from sklearn.metrics import confusion_matrix
from torchvision import transforms

from ..config import get_settings
from ..paths import IMAGE_EXTENSIONS
from ..project_paths import ensure_project_directories
from ..train import build_model, detect_device
from .model_registry import resolve_model_path
from .preprocess import build_preprocess_config, preprocess_image_for_model

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def _now_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _to_data_url_from_bytes(payload: bytes, mime: str) -> str:
    encoded = base64.b64encode(payload).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _thumbnail_data_url(path: Path, size: tuple[int, int] = (96, 96)) -> str:
    with Image.open(path) as opened:
        img = opened.convert("RGB")
        img.thumbnail(size)
        with io.BytesIO() as buf:
            img.save(buf, format="PNG")
            return _to_data_url_from_bytes(buf.getvalue(), "image/png")


def _save_confusion_matrix(cm: Any, labels: list[str], out_path: Path) -> None:
    n = max(len(labels), 2)
    fig_size = max(4, min(16, int(n * 0.9)))
    fig, ax = plt.subplots(figsize=(fig_size, fig_size))
    ax.imshow(cm, cmap="Blues")
    ax.set_title("Confusion Matrix")
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Ground Truth")
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
    ax.set_yticklabels(labels, fontsize=8)

    for i in range(len(labels)):
        for j in range(len(labels)):
            ax.text(j, i, str(int(cm[i][j])), ha="center", va="center", color="#0b0f14", fontsize=7)

    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=160)
    plt.close(fig)


def evaluate_dataset(
    project_id: Optional[str],
    dataset_split: str,
    model: str = "latest",
    model_type: Optional[str] = None,
    overrides: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    paths = ensure_project_directories(project_id)
    model_path = resolve_model_path(project_id=paths.project_id, model=model, model_type=model_type)
    if model_path is None:
        raise FileNotFoundError(f"model not found (model={model}, model_type={model_type or 'any'})")

    checkpoint = torch.load(model_path, map_location="cpu")
    classes = [str(x) for x in checkpoint.get("classes", [])]
    resolved_model_type = str(checkpoint.get("model_type", model_type or ""))
    if not classes:
        raise ValueError("checkpoint classes are empty")

    settings = get_settings()
    image_type_to_model = settings.get("training", {}).get("image_type_to_model", {})
    resolved_image_type = ""
    for image_type, mapped_model_type in image_type_to_model.items():
        if str(mapped_model_type) == resolved_model_type:
            resolved_image_type = str(image_type)
            break

    typed_split_dir = paths.dataset / resolved_image_type / dataset_split if resolved_image_type else None
    split_dir = typed_split_dir if typed_split_dir is not None and typed_split_dir.exists() else paths.dataset / dataset_split
    if not split_dir.exists() or not split_dir.is_dir():
        raise FileNotFoundError(f"dataset split not found: {split_dir}")

    image_size = checkpoint.get("image_size", [64, 64])
    transform = transforms.Compose(
        [
            transforms.Grayscale(num_output_channels=3),
            transforms.Resize((int(image_size[0]), int(image_size[1]))),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]),
        ]
    )

    model_net = build_model(num_classes=len(classes))
    model_net.load_state_dict(checkpoint["state_dict"])
    device = detect_device()
    model_net = model_net.to(device)
    model_net.eval()

    preprocess_cfg = build_preprocess_config(overrides)
    samples: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    y_true: list[str] = []
    y_pred: list[str] = []
    per_class_total: dict[str, int] = defaultdict(int)
    per_class_correct: dict[str, int] = defaultdict(int)

    for class_dir in sorted(split_dir.iterdir()):
        if not class_dir.is_dir():
            continue
        gt_label = class_dir.name
        for image_path in sorted(class_dir.iterdir()):
            if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue

            if overrides:
                pre = preprocess_image_for_model(image_path, config=preprocess_cfg)
                infer_img = Image.fromarray(pre["processed"], mode="L")
            else:
                with Image.open(image_path) as opened:
                    infer_img = opened.convert("L").copy()

            tensor = transform(infer_img).unsqueeze(0).to(device)
            with torch.no_grad():
                logits = model_net(tensor)
                probs = torch.softmax(logits, dim=1)
                conf, idx = torch.max(probs, dim=1)

            pred_label = classes[idx.item()]
            confidence = float(conf.item())
            correct = pred_label == gt_label
            thumbnail = _thumbnail_data_url(image_path)

            row = {
                "image": image_path.name,
                "gt": gt_label,
                "pred": pred_label,
                "confidence": confidence,
                "correct": correct,
                "thumbnail_data_url": thumbnail,
            }
            samples.append(row)

            per_class_total[gt_label] += 1
            if correct:
                per_class_correct[gt_label] += 1
            else:
                errors.append(
                    {
                        "image": image_path.name,
                        "gt": gt_label,
                        "pred": pred_label,
                        "confidence": confidence,
                        "thumbnail_data_url": thumbnail,
                    }
                )

            y_true.append(gt_label)
            y_pred.append(pred_label)

    total = len(samples)
    if total <= 0:
        raise ValueError(
            "評価対象画像が0件です。"
            f"dataset={dataset_split}, model_type={resolved_model_type}, dataset_path={split_dir}. "
            "データセット作成時に train/val/test の比率と保存済みラベル数を確認してください。"
        )
    correct = sum(1 for row in samples if row["correct"])
    accuracy = (correct / total) if total else 0.0

    per_class_accuracy = {}
    for label in sorted(per_class_total.keys()):
        denom = per_class_total[label]
        per_class_accuracy[label] = (per_class_correct[label] / denom) if denom else 0.0

    all_labels = list(dict.fromkeys(classes + sorted(set(y_true) | set(y_pred))))
    if all_labels:
        cm = confusion_matrix(y_true, y_pred, labels=all_labels)
    else:
        cm = [[0]]
        all_labels = ["-"]

    timestamp = _now_tag()
    metrics_dir = paths.outputs / "metrics"
    errors_dir = paths.outputs / "errors"
    metrics_dir.mkdir(parents=True, exist_ok=True)
    errors_dir.mkdir(parents=True, exist_ok=True)

    cm_history_path = metrics_dir / f"confusion_matrix_{timestamp}.png"
    cm_latest_path = metrics_dir / "confusion_matrix.png"
    _save_confusion_matrix(cm, all_labels, cm_history_path)
    shutil.copy2(cm_history_path, cm_latest_path)
    cm_data_url = _to_data_url_from_bytes(cm_latest_path.read_bytes(), "image/png")

    errors_path = errors_dir / f"errors_{dataset_split}_{timestamp}.json"
    with errors_path.open("w", encoding="utf-8") as f:
        json.dump(errors, f, ensure_ascii=False, indent=2)

    summary = {
        "project_id": paths.project_id,
        "dataset": dataset_split,
        "dataset_path": str(split_dir),
        "dataset_image_type": resolved_image_type,
        "model": model,
        "model_type": resolved_model_type,
        "model_name": model_path.name,
        "model_path": str(model_path),
        "accuracy": accuracy,
        "total": total,
        "correct": correct,
        "per_class_accuracy": per_class_accuracy,
        "labels": all_labels,
        "confusion_matrix_path": str(cm_latest_path),
        "confusion_matrix_data_url": cm_data_url,
        "errors_path": str(errors_path),
        "errors": errors,
        "samples": samples,
        "preprocess_config": preprocess_cfg,
        "overrides": overrides,
        "created_at": datetime.now().isoformat(),
    }

    summary_path = metrics_dir / f"evaluation_{dataset_split}_{timestamp}.json"
    with summary_path.open("w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    summary["summary_path"] = str(summary_path)
    return summary
