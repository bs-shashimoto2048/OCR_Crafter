import argparse
from pathlib import Path
from typing import Any, Optional

import torch
from PIL import Image
from torchvision import transforms

from .services.model_registry import latest_model
from .train import build_model, detect_device


def _load_checkpoint(
    model_type: str,
    project_id: Optional[str] = None,
    model_path: Optional[str] = None,
) -> tuple[dict[str, Any], Path]:
    if model_path:
        path = Path(model_path).resolve()
    else:
        latest = latest_model(project_id=project_id, model_type=model_type)
        if latest is None:
            raise FileNotFoundError(f"No model found for type: {model_type}")
        path = latest

    checkpoint = torch.load(path, map_location="cpu")
    return checkpoint, path


def predict_from_image(
    image_path: str,
    model_type: str = "square",
    project_id: Optional[str] = None,
    model_path: Optional[str] = None,
) -> dict[str, Any]:
    checkpoint, resolved_model_path = _load_checkpoint(model_type, project_id=project_id, model_path=model_path)

    classes = checkpoint.get("classes", [])
    image_size = checkpoint.get("image_size", [64, 64])

    if not classes:
        raise ValueError("Checkpoint classes are empty")

    model = build_model(num_classes=len(classes))
    model.load_state_dict(checkpoint["state_dict"])

    device = detect_device()
    model = model.to(device)
    model.eval()

    transform = transforms.Compose(
        [
            transforms.Grayscale(num_output_channels=3),
            transforms.Resize((int(image_size[0]), int(image_size[1]))),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]),
        ]
    )

    image = Image.open(image_path)
    tensor = transform(image).unsqueeze(0).to(device)

    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)
        conf, idx = torch.max(probs, dim=1)

    return {
        "prediction": classes[idx.item()],
        "confidence": float(conf.item()),
        "model_path": str(resolved_model_path),
        "project_id": checkpoint.get("project_id", project_id),
        "model_type": checkpoint.get("model_type", model_type),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict digit from image")
    parser.add_argument("image_path", type=str)
    parser.add_argument("--project-id", type=str, default="default")
    parser.add_argument("--model-type", type=str, default="square", choices=["square", "wide"])
    parser.add_argument("--model-path", type=str, default=None)
    args = parser.parse_args()

    result = predict_from_image(
        args.image_path,
        model_type=args.model_type,
        project_id=args.project_id,
        model_path=args.model_path,
    )
    print(result)


if __name__ == "__main__":
    main()
