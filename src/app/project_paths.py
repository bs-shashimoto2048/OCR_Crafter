import shutil
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .paths import PROJECTS_DIR

DEFAULT_PROJECT_ID = "default"


@dataclass(frozen=True)
class ProjectPaths:
    project_id: str
    root: Path
    raw: Path
    interim: Path
    processed: Path
    dataset: Path
    annotations_dir: Path
    annotations_csv: Path
    models: Path
    logs: Path
    outputs: Path


def normalize_project_id(project_id: Optional[str]) -> str:
    if project_id is None:
        return DEFAULT_PROJECT_ID
    value = unicodedata.normalize("NFKC", project_id).strip()
    if not value:
        return DEFAULT_PROJECT_ID

    # Prevent path traversal / invalid path semantics.
    if Path(value).is_absolute():
        raise ValueError("invalid project_id: absolute path is not allowed")
    if "/" in value or "\\" in value:
        raise ValueError("invalid project_id: '/' and '\\' are not allowed")
    if value in {".", ".."} or ".." in value:
        raise ValueError("invalid project_id: path traversal is not allowed")
    if len(value) > 64:
        raise ValueError("invalid project_id: max length is 64")
    return value


def get_project_paths(project_id: Optional[str] = None) -> ProjectPaths:
    normalized = normalize_project_id(project_id)
    root = PROJECTS_DIR / normalized
    annotations_dir = root / "annotations"
    return ProjectPaths(
        project_id=normalized,
        root=root,
        raw=root / "raw",
        interim=root / "interim",
        processed=root / "processed",
        dataset=root / "dataset",
        annotations_dir=annotations_dir,
        annotations_csv=annotations_dir / "master.csv",
        models=root / "models",
        logs=root / "logs",
        outputs=root / "outputs",
    )


def ensure_project_directories(project_id: Optional[str] = None) -> ProjectPaths:
    paths = get_project_paths(project_id)
    paths.root.mkdir(parents=True, exist_ok=True)
    paths.raw.mkdir(parents=True, exist_ok=True)
    paths.interim.mkdir(parents=True, exist_ok=True)
    paths.processed.mkdir(parents=True, exist_ok=True)
    paths.dataset.mkdir(parents=True, exist_ok=True)
    paths.annotations_dir.mkdir(parents=True, exist_ok=True)
    paths.models.mkdir(parents=True, exist_ok=True)
    paths.logs.mkdir(parents=True, exist_ok=True)
    paths.outputs.mkdir(parents=True, exist_ok=True)
    return paths


def list_projects() -> list[str]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    return sorted([p.name for p in PROJECTS_DIR.iterdir() if p.is_dir()])


def delete_project_directory(project_id: Optional[str]) -> str:
    normalized = normalize_project_id(project_id)

    paths = get_project_paths(normalized)
    if not paths.root.exists() or not paths.root.is_dir():
        raise FileNotFoundError(f"project not found: {normalized}")
    if paths.root.is_symlink():
        raise ValueError("invalid project directory: symlink is not allowed")

    shutil.rmtree(paths.root)
    return normalized
