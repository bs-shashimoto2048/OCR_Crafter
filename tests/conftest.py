"""共通フィクスチャ。

すべてのテストは一時ディレクトリのみを使用する:
- PROJECTS_DIR を tmp_path 配下へ差し替え（プロジェクト系の全パスが一時側になる）
- CWD も tmp_path へ移す（万一の誤削除も一時領域内に限定）
実データ・実プロジェクト・.git には一切触れない。
"""

import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# テストプロセスではJob Workerを自動起動しない（TestClientのapp startupが
# 実データ側 data/jobs へ触れないようにする。Workerの挙動は明示的にstart/process_nextで検証する）
os.environ.setdefault("OCRC_DISABLE_WORKER_AUTOSTART", "1")

import src.app.project_paths as project_paths  # noqa: E402


@pytest.fixture()
def temp_projects(tmp_path, monkeypatch):
    """PROJECTS_DIR とCWDを一時ディレクトリへ隔離し、プロジェクトパス群を返す。"""
    projects_dir = tmp_path / "projects"
    projects_dir.mkdir()
    monkeypatch.setattr(project_paths, "PROJECTS_DIR", projects_dir)
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    (cwd / "cwd_marker.txt").write_text("must survive", encoding="utf-8")
    monkeypatch.chdir(cwd)
    return {
        "projects_dir": projects_dir,
        "cwd": cwd,
        "tmp": tmp_path,
    }
