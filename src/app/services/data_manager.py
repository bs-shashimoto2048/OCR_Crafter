import shutil
from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps

from ..paths import IMAGE_EXTENSIONS
from ..project_paths import ensure_project_directories


def _unique_destination(raw_dir: Path, base_name: str) -> Path:
    target = raw_dir / base_name
    if not target.exists():
        return target

    stem = target.stem
    suffix = target.suffix
    idx = 1
    while True:
        candidate = raw_dir / f"{stem}_{idx}{suffix}"
        if not candidate.exists():
            return candidate
        idx += 1


def import_images_from_directory(source_dir: str, project_id: Optional[str] = None) -> dict:
    paths = ensure_project_directories(project_id)
    src = Path(source_dir).expanduser().resolve()
    if not src.exists() or not src.is_dir():
        raise FileNotFoundError(f"source_dir not found: {src}")

    paths.raw.mkdir(parents=True, exist_ok=True)
    copied = 0
    copied_files: list[str] = []

    for file_path in sorted(src.rglob("*")):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        destination = _unique_destination(paths.raw, file_path.name)
        shutil.copy2(file_path, destination)
        copied += 1
        copied_files.append(destination.name)

    return {
        "source": str(src),
        "copied": copied,
        "copied_files": copied_files,
        "project_id": paths.project_id,
    }


def list_raw_images(project_id: Optional[str] = None) -> list[str]:
    paths = ensure_project_directories(project_id)
    paths.raw.mkdir(parents=True, exist_ok=True)
    images = [p.name for p in paths.raw.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS]
    return sorted(images)


def _rotate_image_file(path: Path, angle: int) -> None:
    with Image.open(path) as image:
        normalized = ImageOps.exif_transpose(image)
        # Pillow rotates counterclockwise with positive values.
        rotated = normalized.rotate(-angle, expand=True)
        save_kwargs = {}
        if image.format:
            save_kwargs["format"] = image.format
        if image.format == "JPEG":
            save_kwargs["quality"] = 95
        rotated.save(path, **save_kwargs)


def rotate_project_image(image_name: str, angle: int, project_id: Optional[str] = None) -> dict:
    if angle == 0 or angle % 90 != 0:
        raise ValueError("angle must be a non-zero multiple of 90")
    if angle not in {-270, -180, -90, 90, 180, 270}:
        raise ValueError("angle must be one of -270, -180, -90, 90, 180, 270")

    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise ValueError("invalid image name")

    paths = ensure_project_directories(project_id)
    raw_path = paths.raw / safe_name
    if not raw_path.exists() or not raw_path.is_file():
        raise FileNotFoundError(f"image not found: {safe_name}")

    _rotate_image_file(raw_path, angle)

    return {
        "project_id": paths.project_id,
        "image": safe_name,
        "angle": angle,
    }
