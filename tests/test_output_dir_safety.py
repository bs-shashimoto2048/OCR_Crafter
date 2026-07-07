"""safe_rmtree（API入力 output_dir の削除封じ込め）の回帰テスト。

overwrite=true でも許可ルート（プロジェクトの outputs 等）配下以外は削除しない。
"""

import pytest

from src.app.project_paths import is_within_directory, safe_rmtree


@pytest.fixture()
def outputs_root(temp_projects):
    root = temp_projects["projects_dir"] / "p" / "outputs"
    root.mkdir(parents=True)
    return root


class TestRejects:
    def test_empty_rejected(self, outputs_root):
        with pytest.raises(ValueError):
            safe_rmtree("", [outputs_root])

    def test_none_rejected(self, outputs_root):
        with pytest.raises(ValueError):
            safe_rmtree(None, [outputs_root])

    def test_dot_rejected(self, outputs_root):
        with pytest.raises(ValueError):
            safe_rmtree(".", [outputs_root])

    def test_cwd_rejected(self, temp_projects, outputs_root):
        with pytest.raises(ValueError):
            safe_rmtree(str(temp_projects["cwd"]), [outputs_root])
        assert (temp_projects["cwd"] / "cwd_marker.txt").exists()

    def test_allowed_root_itself_rejected(self, outputs_root):
        with pytest.raises(ValueError):
            safe_rmtree(str(outputs_root), [outputs_root])
        assert outputs_root.exists()

    def test_parent_rejected(self, outputs_root):
        with pytest.raises(ValueError):
            safe_rmtree(str(outputs_root.parent), [outputs_root])
        assert outputs_root.parent.exists()

    def test_outside_path_rejected(self, temp_projects, outputs_root):
        outside = temp_projects["tmp"] / "outside"
        outside.mkdir()
        with pytest.raises(ValueError, match="not permitted"):
            safe_rmtree(str(outside), [outputs_root])
        assert outside.exists()


class TestAllows:
    def test_only_under_allowed_root_deleted(self, outputs_root):
        target = outputs_root / "ocr_dataset" / "run1"
        target.mkdir(parents=True)
        (target / "dataset.txt").write_text("x", encoding="utf-8")
        sibling = outputs_root / "ocr_dataset" / "keep"
        sibling.mkdir(parents=True)

        removed = safe_rmtree(target, [outputs_root], label="test")

        assert removed == target.resolve()
        assert not target.exists()
        assert sibling.exists()
        assert outputs_root.exists()


class TestIsWithinDirectory:
    def test_child_true(self, outputs_root):
        child = outputs_root / "a"
        child.mkdir()
        assert is_within_directory(child.resolve(), outputs_root.resolve()) is True

    def test_self_false(self, outputs_root):
        assert is_within_directory(outputs_root.resolve(), outputs_root.resolve()) is False

    def test_parent_false(self, outputs_root):
        assert is_within_directory(outputs_root.parent.resolve(), outputs_root.resolve()) is False
