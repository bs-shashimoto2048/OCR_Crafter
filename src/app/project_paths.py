import logging
import shutil
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional, Union

from .paths import PROJECTS_DIR

DEFAULT_PROJECT_ID = "default"

logger = logging.getLogger(__name__)


def is_within_directory(candidate: Path, root: Path) -> bool:
    """candidate が root の真の配下か（root 自身は含まない）。両者 resolve 済み前提。"""
    return candidate != root and root in candidate.parents


def safe_rmtree(target: Union[str, Path], allowed_roots: Iterable[Path], label: str = "") -> Path:
    """許可ルート配下のみ再帰削除を許す共有ガード（delete_model と同じ安全思想）。

    空文字・"."・CWD・許可ルート自身・許可ルート外（プロジェクトルート/親ディレクトリ等）は
    ValueError で中止する。API入力由来のパスを rmtree する箇所は必ずこれを経由すること
    （空パスが Path('.')=CWD 化してプロジェクト全体を削除した事故の再発防止）。
    """
    raw = str(target or "").strip()
    if not raw or raw == ".":
        raise ValueError("deletion target path is empty; refusing to delete")
    try:
        resolved = Path(raw).expanduser().resolve()
    except (OSError, ValueError, RuntimeError) as e:
        raise ValueError(f"invalid deletion target path: {raw!r}") from e
    for root in allowed_roots:
        try:
            root_resolved = Path(root).expanduser().resolve()
        except (OSError, ValueError, RuntimeError):
            continue
        if is_within_directory(resolved, root_resolved):
            logger.info("safe_rmtree: removing %s (%s)", resolved, label or "unlabeled")
            shutil.rmtree(resolved, ignore_errors=True)
            return resolved
    raise ValueError(f"deletion outside allowed directories is not permitted: {resolved}")


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
