"""safe_rmtree（API入力 output_dir の削除封じ込め）の回帰テスト。

overwrite=true でも許可ルート（プロジェクトの outputs 等）配下以外は削除しない。
"""

import logging

import pytest

import src.app.project_paths as project_paths_module
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


class TestPartialFailureDetection:
    """Issue #156: ignore_errors=True でも成否を確認せずsilentに完了扱いしていた
    既存挙動へ、削除未完了時のwarningログを追加したことの回帰テスト。
    戻り値・例外送出契約自体は変更していない（呼び出し側への影響なし）。
    """

    def test_partial_failure_logs_warning_but_keeps_existing_contract(self, outputs_root, monkeypatch, caplog):
        target = outputs_root / "locked"
        target.mkdir(parents=True)
        (target / "file.txt").write_text("x", encoding="utf-8")

        # shutil.rmtree自体を no-op にして「削除が完了しなかった」状態を再現する
        # （Windowsのファイルロック等、ignore_errors=Trueで従来は無警告のまま完了扱い）
        monkeypatch.setattr(project_paths_module.shutil, "rmtree", lambda *a, **k: None)

        with caplog.at_level(logging.WARNING, logger="src.app.project_paths"):
            removed = safe_rmtree(target, [outputs_root], label="partial-failure-test")

        assert removed == target.resolve()  # 戻り値の契約は不変
        assert target.exists()  # 実際には削除されていない（rmtreeをno-op化したため）
        assert any("削除が完了しませんでした" in record.message for record in caplog.records)

    def test_full_success_does_not_log_warning(self, outputs_root, caplog):
        target = outputs_root / "clean"
        target.mkdir(parents=True)

        with caplog.at_level(logging.WARNING, logger="src.app.project_paths"):
            safe_rmtree(target, [outputs_root], label="success-test")

        assert not target.exists()
        assert not any("削除が完了しませんでした" in record.message for record in caplog.records)


class TestIsWithinDirectory:
    def test_child_true(self, outputs_root):
        child = outputs_root / "a"
        child.mkdir()
        assert is_within_directory(child.resolve(), outputs_root.resolve()) is True

    def test_self_false(self, outputs_root):
        assert is_within_directory(outputs_root.resolve(), outputs_root.resolve()) is False

    def test_parent_false(self, outputs_root):
        assert is_within_directory(outputs_root.parent.resolve(), outputs_root.resolve()) is False
