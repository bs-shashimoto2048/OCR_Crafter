"""delete_model 安全ガードの回帰テスト。

背景: モデルメタの空パスが Path('') → Path('.')=CWD となり、rmtree が
プロジェクト全体を削除した事故（2026-07-07）の再発防止。
すべて一時ディレクトリ内で実施する（conftest の temp_projects 参照）。
"""

import json
from pathlib import Path

import pytest

import src.app.services.model_registry as mr

PROJECT = "t"


def models_root(temp_projects) -> Path:
    return temp_projects["projects_dir"] / PROJECT / "models"


def write_meta(temp_projects, name: str, payload) -> Path:
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    meta = root / name
    meta.write_text(payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8")
    return meta


class TestGuardFunction:
    def test_cwd_rejected(self, temp_projects):
        root = models_root(temp_projects)
        root.mkdir(parents=True, exist_ok=True)
        assert mr._is_safe_model_artifact_dir(Path(".").resolve(), root) is False

    def test_models_root_itself_rejected(self, temp_projects):
        root = models_root(temp_projects)
        root.mkdir(parents=True, exist_ok=True)
        assert mr._is_safe_model_artifact_dir(root.resolve(), root) is False

    def test_parent_rejected(self, temp_projects):
        root = models_root(temp_projects)
        root.mkdir(parents=True, exist_ok=True)
        assert mr._is_safe_model_artifact_dir(root.parent.resolve(), root) is False

    def test_project_root_rejected(self, temp_projects):
        root = models_root(temp_projects)
        root.mkdir(parents=True, exist_ok=True)
        project_root = temp_projects["projects_dir"] / PROJECT
        assert mr._is_safe_model_artifact_dir(project_root.resolve(), root) is False

    def test_under_models_allowed(self, temp_projects):
        root = models_root(temp_projects)
        ok = root / "tesseract" / "m1"
        ok.mkdir(parents=True)
        assert mr._is_safe_model_artifact_dir(ok.resolve(), root) is True

    def test_nonexistent_rejected(self, temp_projects):
        root = models_root(temp_projects)
        root.mkdir(parents=True, exist_ok=True)
        assert mr._is_safe_model_artifact_dir((root / "nope").resolve(), root) is False


class TestDeleteModel:
    def test_empty_paths_meta_deletes_meta_only(self, temp_projects):
        """空パスメタ: Path('')を生成せず、関連dir削除なしでメタのみ削除。CWD無傷。"""
        meta = write_meta(temp_projects, "empty.ocr.json", {"checkpoint_dir": "", "inference_dir": "", "model_dir": ""})
        mr.delete_model(PROJECT, "empty.ocr.json")
        assert not meta.exists()
        assert (temp_projects["cwd"] / "cwd_marker.txt").exists()

    def test_cwd_pointing_meta_skipped(self, temp_projects):
        """model_dir='.'（CWD）を指すメタ: スキップされCWDは無傷、メタは削除。"""
        meta = write_meta(temp_projects, "cwd.ocr.json", {"model_dir": "."})
        mr.delete_model(PROJECT, "cwd.ocr.json")
        assert (temp_projects["cwd"] / "cwd_marker.txt").exists()
        assert not meta.exists()

    def test_project_root_pointing_meta_skipped(self, temp_projects):
        """プロジェクトルートを指すメタ: 実体は削除されない。"""
        project_root = temp_projects["projects_dir"] / PROJECT
        meta = write_meta(
            temp_projects,
            "rootattack.tess.json",
            {"tessdata_dir": str(project_root), "model_dir": str(models_root(temp_projects).parent)},
        )
        mr.delete_model(PROJECT, "rootattack.tess.json")
        assert project_root.exists()
        assert models_root(temp_projects).exists()
        assert not meta.exists()

    def test_only_dir_under_models_deleted(self, temp_projects):
        """models配下の正規ダミーのみ削除でき、無関係dirとmodelsルートは無傷。"""
        root = models_root(temp_projects)
        target = root / "tesseract" / "victim"
        target.mkdir(parents=True)
        (target / "victim.traineddata").write_bytes(b"x")
        other = root / "tesseract" / "other"
        other.mkdir(parents=True)
        meta = write_meta(temp_projects, "victim.tess.json", {"tessdata_dir": str(target), "model_dir": str(target)})
        mr.delete_model(PROJECT, "victim.tess.json")
        assert not target.exists()
        assert other.exists()
        assert root.exists()
        assert not meta.exists()

    def test_broken_tess_meta_deletes_meta_only(self, temp_projects):
        """破損（JSONパース不能）の .tess.json: 実体に触れずメタのみ削除。"""
        root = models_root(temp_projects)
        artifact = root / "tesseract" / "broken"
        artifact.mkdir(parents=True)
        (artifact / "broken.traineddata").write_bytes(b"x")
        meta = write_meta(temp_projects, "broken.tess.json", '{"tessdata_dir": ')  # 壊れたJSON
        result = mr.delete_model(PROJECT, "broken.tess.json")
        assert result == "broken.tess.json"
        assert not meta.exists()
        assert (artifact / "broken.traineddata").exists()

    def test_incomplete_tess_meta_aborts(self, temp_projects):
        """読めるが関連パス欠落の .tess.json: 削除中止（メタ残存）。"""
        meta = write_meta(temp_projects, "incomplete.tess.json", {"tessdata_dir": "", "model_dir": ""})
        with pytest.raises(ValueError, match="delete aborted"):
            mr.delete_model(PROJECT, "incomplete.tess.json")
        assert meta.exists()

    def test_nul_byte_path_does_not_crash(self, temp_projects):
        """NULバイト等の不正パスでもクラッシュせずメタ削除に到達する（except拡大の回帰）。"""
        meta = write_meta(temp_projects, "nul.ocr.json", {"model_dir": "bad\x00path"})
        mr.delete_model(PROJECT, "nul.ocr.json")
        assert not meta.exists()
