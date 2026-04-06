from pathlib import Path

from .project_paths import DEFAULT_PROJECT_ID, ensure_project_directories
from .paths import PROJECT_ROOT


def ensure_directories() -> list[Path]:
    required_dirs = [
        PROJECT_ROOT / "data" / "projects",
        PROJECT_ROOT / "outputs",
        PROJECT_ROOT / "src" / "app",
        PROJECT_ROOT / "config",
    ]

    created = []
    for directory in required_dirs:
        directory.mkdir(parents=True, exist_ok=True)
        created.append(directory)

    project_paths = ensure_project_directories(DEFAULT_PROJECT_ID)
    created.extend(
        [
            project_paths.root,
            project_paths.raw,
            project_paths.interim,
            project_paths.processed,
            project_paths.dataset,
            project_paths.annotations_dir,
            project_paths.models,
            project_paths.logs,
            project_paths.outputs,
        ]
    )

    return created


if __name__ == "__main__":
    for d in ensure_directories():
        print(d)
