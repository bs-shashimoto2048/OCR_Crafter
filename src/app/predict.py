import argparse
from pathlib import Path
from typing import Any, Optional

import torch
from PIL import Image
from torchvision import transforms

from .config import get_settings
from .services.model_registry import resolve_model_path
from .services.preprocess import preprocess_image_for_model
from .train import build_model, detect_device

_EASYOCR_READER_CACHE: dict[tuple[tuple[str, ...], bool], Any] = {}


def _load_checkpoint(
    model_type: Optional[str],
    project_id: Optional[str] = None,
    model: str = "latest",
) -> tuple[dict[str, Any], Path]:
    path = resolve_model_path(project_id=project_id, model=model, model_type=model_type)
    if path is None:
        if model and model != "latest":
            raise FileNotFoundError(f"model not found: {model}")
        raise FileNotFoundError(f"No model found for type: {model_type or 'any'}")

    checkpoint = torch.load(path, map_location="cpu")
    return checkpoint, path


def _get_easyocr_reader(languages: list[str]) -> tuple[Any, bool]:
    try:
        import easyocr  # type: ignore
    except ImportError as e:
        raise RuntimeError("easyocr is not installed. Please run: pip install easyocr") from e

    use_gpu = bool(torch.cuda.is_available())
    key = (tuple(languages), use_gpu)
    if key not in _EASYOCR_READER_CACHE:
        _EASYOCR_READER_CACHE[key] = easyocr.Reader(languages, gpu=use_gpu)
    return _EASYOCR_READER_CACHE[key], use_gpu


def _predict_with_easyocr(
    image_path: str,
    project_id: Optional[str] = None,
    languages: Optional[list[str]] = None,
) -> dict[str, Any]:
    langs = [lang.strip() for lang in (languages or ["en"]) if lang.strip()]
    if not langs:
        langs = ["en"]

    reader, use_gpu = _get_easyocr_reader(langs)
    raw_results = reader.readtext(image_path, detail=1, paragraph=False)

    parsed_results: list[dict[str, Any]] = []
    for row in raw_results[:20]:
        if len(row) < 3:
            continue
        parsed_results.append({"text": str(row[1]), "confidence": float(row[2])})

    if parsed_results:
        best = max(parsed_results, key=lambda x: float(x.get("confidence", 0.0)))
        prediction = str(best.get("text", "")).strip()
        confidence = float(best.get("confidence", 0.0))
    else:
        prediction = ""
        confidence = 0.0

    return {
        "prediction": prediction,
        "confidence": confidence,
        "model_path": "",
        "project_id": project_id,
        "model_type": "easyocr",
        "model_name": "easyocr",
        "engine": "easyocr",
        "easyocr_gpu": use_gpu,
        "easyocr_languages": langs,
        "easyocr_results": parsed_results,
    }


def _auto_model_type_for_image(image_type: str) -> Optional[str]:
    settings = get_settings()
    mapping = settings.get("training", {}).get("image_type_to_model", {"single": "square", "wide": "wide"})
    fallback = settings.get("training", {}).get("default_model_type")
    return mapping.get(image_type) or fallback


def predict_from_image(
    image_path: str,
    model_type: Optional[str] = None,
    project_id: Optional[str] = None,
    model: str = "latest",
    engine: str = "custom",
    easyocr_languages: Optional[list[str]] = None,
    apply_preprocess: bool = True,
) -> dict[str, Any]:
    engine_name = (engine or "custom").strip().lower()
    if engine_name == "easyocr":
        return _predict_with_easyocr(image_path, project_id=project_id, languages=easyocr_languages)

    preprocess_meta: dict[str, Any] = {"applied": False, "image_type": "", "pipeline": []}
    inference_image: Image.Image
    selected_model_type = model_type

    if apply_preprocess:
        pre = preprocess_image_for_model(image_path)
        preprocess_meta = {
            "applied": True,
            "image_type": str(pre.get("type", "")),
            "pipeline": list(pre.get("pipeline", [])),
        }
        inference_image = Image.fromarray(pre["processed"], mode="L")
        if not selected_model_type:
            selected_model_type = _auto_model_type_for_image(preprocess_meta["image_type"])
    else:
        with Image.open(image_path) as opened:
            inference_image = opened.convert("L").copy()

    checkpoint, resolved_model_path = _load_checkpoint(selected_model_type, project_id=project_id, model=model)

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

    tensor = transform(inference_image).unsqueeze(0).to(device)

    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)
        conf, idx = torch.max(probs, dim=1)

    return {
        "prediction": classes[idx.item()],
        "confidence": float(conf.item()),
        "model_path": str(resolved_model_path),
        "project_id": checkpoint.get("project_id", project_id),
        "model_type": checkpoint.get("model_type", selected_model_type or ""),
        "model_name": resolved_model_path.name,
        "engine": "custom",
        "preprocess_applied": preprocess_meta["applied"],
        "preprocess_image_type": preprocess_meta["image_type"],
        "preprocess_pipeline": preprocess_meta["pipeline"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict digit from image")
    parser.add_argument("image_path", type=str)
    parser.add_argument("--project-id", type=str, default="default")
    parser.add_argument("--model-type", type=str, default="")
    parser.add_argument("--model", type=str, default="latest")
    parser.add_argument("--engine", type=str, default="custom", choices=["custom", "easyocr"])
    parser.add_argument("--easyocr-langs", type=str, default="en")
    args = parser.parse_args()

    langs = [x.strip() for x in args.easyocr_langs.split(",") if x.strip()]
    result = predict_from_image(
        args.image_path,
        model_type=(args.model_type or None),
        project_id=args.project_id,
        model=args.model,
        engine=args.engine,
        easyocr_languages=langs,
    )
    print(result)


if __name__ == "__main__":
    main()
