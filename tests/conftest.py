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

import src.app.db as db_module  # noqa: E402
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


@pytest.fixture()
def isolated_test_db(tmp_path, monkeypatch):
    """テスト専用の一時DBへ`db._db_path()`を差し替え、`init_db()`でスキーマを初期化する
    （Issue #8）。

    `outputs/app.db`（実データ）には一切触れない。`db.py`のスキーマ・`init_db()`本体は
    変更しない（既存の`CREATE TABLE IF NOT EXISTS`をそのまま一時DBへ向けて実行するのみ）。
    `training_jobs`テーブルへ依存するコード経路（`model_registry.py::list_model_infos()`の
    `.ocr.json`分岐等）を呼ぶテストは、このフィクスチャを明示的に要求することで、実DBの
    事前状態（開発機に偶然残っていたテーブル等）に依存せず独立して成功できる
    （既存の`test_ocr_dataset_workflow.py`/`test_training_condition_snapshot.py`が個別に
    行っていた`monkeypatch.setattr(db_module, "_db_path", ...); db_module.init_db()`と
    同じ手順を共通化したもの）。テスト終了後は`tmp_path`ごと自動的に破棄される。
    """
    db_path = tmp_path / "test_app.db"
    monkeypatch.setattr(db_module, "_db_path", lambda: db_path)
    db_module.init_db()
    return db_path
