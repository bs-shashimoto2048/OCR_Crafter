import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms

from .config import get_settings
from .project_paths import ensure_project_directories


def detect_device() -> torch.device:
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return torch.device("mps")
    return torch.device("cpu")


def build_model(num_classes: int) -> nn.Module:
    model = models.resnet18(weights=None)
    in_features = model.fc.in_features
    model.fc = nn.Linear(in_features, num_classes)
    return model


def _image_size_for_model_type(settings: dict[str, Any], model_type: str) -> tuple[int, int]:
    model_cfg = settings.get("training", {}).get("models", {}).get(model_type, {})
    fallback = settings.get("training", {}).get("default_image_size", [64, 64])
    size = model_cfg.get("image_size", fallback)
    return int(size[0]), int(size[1])


def _image_type_for_model_type(settings: dict[str, Any], model_type: str) -> Optional[str]:
    mapping = settings.get("training", {}).get("image_type_to_model", {})
    for image_type, mapped_model_type in mapping.items():
        if str(mapped_model_type) == str(model_type):
            return str(image_type)
    return None


def _has_any_class_folder(split_dir: Path) -> bool:
    if not split_dir.exists() or not split_dir.is_dir():
        return False
    for child in split_dir.iterdir():
        if child.is_dir():
            return True
    return False


def _load_dataset_build_meta(dataset_root: Path) -> dict[str, Any]:
    meta_path = dataset_root / "build_meta.json"
    if not meta_path.exists() or not meta_path.is_file():
        return {}
    try:
        with meta_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, dict):
            return payload
    except Exception:  # noqa: BLE001
        return {}
    return {}


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except Exception:  # noqa: BLE001
        return 0


def _extract_dataset_split_counts(dataset_meta: dict[str, Any], image_type: Optional[str]) -> dict[str, int]:
    counts_by_type = dataset_meta.get("counts_by_type", {})
    if isinstance(counts_by_type, dict) and image_type and isinstance(counts_by_type.get(str(image_type)), dict):
        selected = counts_by_type.get(str(image_type), {})
        return {
            "train": _safe_int(selected.get("train", 0)),
            "val": _safe_int(selected.get("val", 0)),
            "test": _safe_int(selected.get("test", 0)),
        }

    counts = dataset_meta.get("counts", {})
    if isinstance(counts, dict):
        return {
            "train": _safe_int(counts.get("train", 0)),
            "val": _safe_int(counts.get("val", 0)),
            "test": _safe_int(counts.get("test", 0)),
        }

    return {"train": 0, "val": 0, "test": 0}


def run_training(
    project_id: Optional[str],
    dataset_dir: Optional[str],
    model_type: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    progress_callback: Optional[Callable[[dict[str, Any], int], None]] = None,
) -> dict[str, Any]:
    settings = get_settings()
    paths = ensure_project_directories(project_id)
    dataset_root = Path(dataset_dir).resolve() if dataset_dir else paths.dataset
    image_type = _image_type_for_model_type(settings, model_type)

    typed_train_dir = dataset_root / str(image_type) / "train" if image_type else None
    typed_val_dir = dataset_root / str(image_type) / "val" if image_type else None
    if typed_train_dir is not None and typed_train_dir.exists():
        if not _has_any_class_folder(typed_train_dir):
            available_by_type: dict[str, int] = {}
            mapping = settings.get("training", {}).get("image_type_to_model", {}) or {}
            for candidate_image_type, mapped_model_type in mapping.items():
                candidate_dir = dataset_root / str(candidate_image_type) / "train"
                if _has_any_class_folder(candidate_dir):
                    available_by_type[str(mapped_model_type)] = sum(
                        1 for p in candidate_dir.iterdir() if p.is_dir()
                    )
            available_text = ", ".join(
                f"{k}({v} classes)" for k, v in sorted(available_by_type.items())
            ) or "none"
            raise ValueError(
                "No class folder for selected model type. "
                f"model_type={model_type}, image_type={image_type}, train_dir={typed_train_dir}. "
                f"Available model types in dataset: {available_text}"
            )
        train_dir = typed_train_dir
        val_dir = typed_val_dir if typed_val_dir is not None else dataset_root / "val"
    else:
        train_dir = dataset_root / "train"
        val_dir = dataset_root / "val"

    if not train_dir.exists():
        raise FileNotFoundError(f"train dataset not found: {train_dir}")
    if not _has_any_class_folder(train_dir):
        raise ValueError(f"No class folder found in train dataset: {train_dir}")

    dataset_meta = _load_dataset_build_meta(dataset_root)
    dataset_split_ratio = {
        "train": float(dataset_meta.get("train_ratio", 0.0)),
        "val": float(dataset_meta.get("val_ratio", 0.0)),
        "test": float(dataset_meta.get("test_ratio", 0.0)),
    }
    dataset_split_counts = _extract_dataset_split_counts(dataset_meta, image_type)

    image_size = _image_size_for_model_type(settings, model_type)
    transform = transforms.Compose(
        [
            transforms.Grayscale(num_output_channels=3),
            transforms.Resize(image_size),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]),
        ]
    )

    train_ds = datasets.ImageFolder(str(train_dir), transform=transform)
    has_val_classes = _has_any_class_folder(val_dir)
    val_ds = datasets.ImageFolder(str(val_dir), transform=transform) if has_val_classes else None

    if len(train_ds.classes) == 0:
        raise ValueError("No class folders found in dataset/train")

    num_workers = int(settings.get("training", {}).get("num_workers", 0))
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=num_workers)
    val_loader = (
        DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers)
        if val_ds is not None
        else None
    )

    device = detect_device()
    model = build_model(num_classes=len(train_ds.classes)).to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

    history = []
    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            optimizer.zero_grad()
            logits = model(x)
            loss = criterion(logits, y)
            loss.backward()
            optimizer.step()

            train_loss += loss.item() * x.size(0)
            preds = logits.argmax(dim=1)
            train_correct += (preds == y).sum().item()
            train_total += y.size(0)

        epoch_metrics = {
            "epoch": epoch,
            "train_loss": train_loss / max(train_total, 1),
            "train_acc": train_correct / max(train_total, 1),
        }

        if val_loader is not None:
            model.eval()
            val_loss = 0.0
            val_correct = 0
            val_total = 0
            with torch.no_grad():
                for x, y in val_loader:
                    x, y = x.to(device), y.to(device)
                    logits = model(x)
                    loss = criterion(logits, y)

                    val_loss += loss.item() * x.size(0)
                    preds = logits.argmax(dim=1)
                    val_correct += (preds == y).sum().item()
                    val_total += y.size(0)

            epoch_metrics["val_loss"] = val_loss / max(val_total, 1)
            epoch_metrics["val_acc"] = val_correct / max(val_total, 1)

        history.append(epoch_metrics)
        if progress_callback is not None:
            progress_callback(epoch_metrics, epochs)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    paths.models.mkdir(parents=True, exist_ok=True)
    paths.logs.mkdir(parents=True, exist_ok=True)

    model_path = paths.models / f"{model_type}_{timestamp}.pt"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "classes": train_ds.classes,
            "model_type": model_type,
            "project_id": paths.project_id,
            "image_size": list(image_size),
            "dataset_split_ratio": dataset_split_ratio,
            "dataset_split_counts": dataset_split_counts,
            "created_at": datetime.now().isoformat(),
        },
        model_path,
    )

    log_path = paths.logs / f"train_{model_type}_{timestamp}.json"
    with log_path.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "history": history,
                "device": str(device),
                "classes": train_ds.classes,
                "dataset_split_ratio": dataset_split_ratio,
                "dataset_split_counts": dataset_split_counts,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    return {
        "project_id": paths.project_id,
        "model_path": str(model_path),
        "log_path": str(log_path),
        "device": str(device),
        "dataset_image_type": image_type or "",
        "dataset_train_dir": str(train_dir),
        "dataset_val_dir": str(val_dir),
        "dataset_split_ratio": dataset_split_ratio,
        "dataset_split_counts": dataset_split_counts,
        "classes": train_ds.classes,
        "history": history,
    }


def main() -> None:
    settings = get_settings()
    default_paths = ensure_project_directories(None)
    parser = argparse.ArgumentParser(description="Train OCR classifier")
    parser.add_argument("--project-id", type=str, default=default_paths.project_id)
    parser.add_argument("--dataset-dir", type=str, default=str(default_paths.dataset))
    parser.add_argument("--model-type", type=str, default="square")
    parser.add_argument("--epochs", type=int, default=int(settings.get("training", {}).get("default_epochs", 5)))
    parser.add_argument("--batch-size", type=int, default=int(settings.get("training", {}).get("default_batch_size", 32)))
    parser.add_argument("--learning-rate", type=float, default=float(settings.get("training", {}).get("default_lr", 1e-3)))

    args = parser.parse_args()
    result = run_training(
        project_id=args.project_id,
        dataset_dir=args.dataset_dir,
        model_type=args.model_type,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
