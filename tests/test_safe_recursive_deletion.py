"""Safe Recursive Deletion（Issue #156）のテスト。

（末尾に delete_model() の部分削除失敗ログ回帰テストも含む）

Issue #154のFuture Workとして記録された、recursive deleteの安全性統一・失敗検知を
検証する。本Issueの調査中に発見した最重要の発見（`restore_backup()`の
`new_project_id`が検証前に`projects_dir`外へのパスとして使われ、project root外への
任意ファイル書込み・cleanup時のrmtreeが可能だった脆弱性）の修正を中心に、
`_cleanup_failed_ocr_dataset()`の許可root自身削除の見落としも検証する。
実`data/projects/`・実`outputs/app.db`へは一切触れない
（`temp_projects`/`isolated_test_db`フィクスチャで隔離）。
"""

import json
import logging
from pathlib import Path

import pytest

import src.app.main as main_module
import src.app.services.model_registry as model_registry_module
from src.app.project_paths import ensure_project_directories
from src.app.services.backup_manager import create_backup, restore_backup

PID = "p_safe_delete"


# ---------------------------------------------------------------------------
# restore_backup(): new_project_id path traversal（最重要の発見）
# ---------------------------------------------------------------------------


def _seed_and_backup(temp_projects):
    paths = ensure_project_directories(PID)
    (paths.root / "experiments.json").write_text(json.dumps({"counter": 0, "items": []}), encoding="utf-8")
    return create_backup(PID, mode="full")


@pytest.mark.parametrize(
    "malicious_new_project_id",
    [
        "../../escaped",
        "..",
        "/absolute/unix/path",
        "sub/dir",
        "sub\\dir",
    ],
)
def test_restore_rejects_path_traversal_new_project_id_before_any_write(
    temp_projects, malicious_new_project_id
):
    """new_project_idが'/'/'\\'・'..'・絶対パスを含む場合、ZIP展開・ファイル書込みが
    一切発生する前にValueErrorで拒否される（Issue #156で発見・修正した脆弱性）。"""
    entry = _seed_and_backup(temp_projects)
    projects_dir = temp_projects["projects_dir"]
    before = sorted(p.name for p in projects_dir.iterdir())

    with pytest.raises(ValueError):
        restore_backup(entry["backup_id"], new_project_id=malicious_new_project_id)

    # projects_dir配下に新しいエントリが一切作られていない（projects_dir外はもちろん、
    # projects_dir内にも中途半端なディレクトリを残さない）
    after = sorted(p.name for p in projects_dir.iterdir())
    assert before == after


def test_restore_path_traversal_does_not_create_directory_outside_projects_dir(temp_projects):
    """traversalが実際にprojects_dir外へディレクトリを作らないことを直接確認する
    （リグレッションガード。修正前はこのアサーションが失敗していた）。"""
    entry = _seed_and_backup(temp_projects)
    projects_dir = temp_projects["projects_dir"]
    escape_target = projects_dir.parent.parent / "escaped_by_traversal"

    with pytest.raises(ValueError):
        restore_backup(entry["backup_id"], new_project_id="../../escaped_by_traversal")

    assert not escape_target.exists()


def test_restore_windows_absolute_path_new_project_id_rejected(temp_projects):
    """Windows形式の絶対パス（ドライブレター付き）も拒否される。
    pathlibは`base / "C:/x"`のような絶対パスとの結合で左辺を破棄するため、
    validationを経ないと`target_root`がprojects_dir完全に置き換わってしまう。"""
    entry = _seed_and_backup(temp_projects)
    outside_abs = str(temp_projects["tmp"] / "abs_escape_target")
    with pytest.raises(ValueError, match="absolute path"):
        restore_backup(entry["backup_id"], new_project_id=outside_abs)
    assert not Path(outside_abs).exists()


def test_restore_legitimate_explicit_new_project_id_still_works(temp_projects):
    """正当なnew_project_id指定は引き続き正しく動作する（回帰確認）。"""
    entry = _seed_and_backup(temp_projects)
    result = restore_backup(entry["backup_id"], new_project_id="legit_restored")
    assert result["project_id"] == "legit_restored"
    restored_root = temp_projects["projects_dir"] / "legit_restored"
    assert (restored_root / "experiments.json").is_file()


def test_restore_empty_new_project_id_still_auto_generates(temp_projects):
    """new_project_id未指定（空文字）は引き続き<元ID>_restored_<n>を自動採番する
    （回帰確認。空文字はnormalize_project_id()の対象外パスのまま維持）。"""
    entry = _seed_and_backup(temp_projects)
    result = restore_backup(entry["backup_id"])
    assert result["project_id"] == f"{PID}_restored_1"


def test_restore_new_project_id_collision_with_existing_still_rejected(temp_projects):
    """既存プロジェクトIDとの衝突は、正規化後の値で引き続き検出される（回帰確認）。"""
    entry = _seed_and_backup(temp_projects)
    with pytest.raises(ValueError, match="既に存在"):
        restore_backup(entry["backup_id"], new_project_id=PID)


# ---------------------------------------------------------------------------
# _cleanup_failed_ocr_dataset(): 許可root自身の削除防止
# ---------------------------------------------------------------------------


def test_cleanup_failed_ocr_dataset_rejects_root_itself(temp_projects):
    """dataset_dirが許可root自身（例: outputs/ocr_dataset全体）を指す場合、
    削除しない（Issue #156修正前は誤って許可され、全datasetを巻き込んで
    削除しうるバグだった）。"""
    paths = ensure_project_directories(PID)
    ocr_dataset_root = paths.outputs / "ocr_dataset"
    ocr_dataset_root.mkdir(parents=True)
    other_dataset = ocr_dataset_root / "20260101_000000"
    other_dataset.mkdir(parents=True)
    (other_dataset / "meta.json").write_text("{}", encoding="utf-8")

    result = main_module._cleanup_failed_ocr_dataset(PID, str(ocr_dataset_root))

    assert result is False
    assert ocr_dataset_root.exists()
    assert other_dataset.exists()  # 他のdatasetも無傷


def test_cleanup_failed_ocr_dataset_still_deletes_proper_subdirectory(temp_projects):
    """許可rootの真の配下（実際の個別dataset）は引き続き削除できる（回帰確認）。"""
    paths = ensure_project_directories(PID)
    ocr_dataset_root = paths.outputs / "ocr_dataset"
    target = ocr_dataset_root / "20260101_120000"
    target.mkdir(parents=True)
    (target / "meta.json").write_text("{}", encoding="utf-8")

    result = main_module._cleanup_failed_ocr_dataset(PID, str(target))

    assert result is True
    assert not target.exists()
    assert ocr_dataset_root.exists()


def test_cleanup_failed_ocr_dataset_outside_root_rejected(temp_projects):
    """許可root外を指す場合は引き続き削除しない（回帰確認）。"""
    paths = ensure_project_directories(PID)
    outside = temp_projects["tmp"] / "outside_dataset"
    outside.mkdir(parents=True)

    result = main_module._cleanup_failed_ocr_dataset(PID, str(outside))

    assert result is False
    assert outside.exists()


def test_cleanup_failed_ocr_dataset_reports_false_when_deletion_incomplete(temp_projects, monkeypatch):
    """rmtreeが完了しなかった場合、成功扱い（True）にしない（Issue #156）。"""
    paths = ensure_project_directories(PID)
    ocr_dataset_root = paths.outputs / "ocr_dataset"
    target = ocr_dataset_root / "20260102_000000"
    target.mkdir(parents=True)

    monkeypatch.setattr(main_module.shutil, "rmtree", lambda *a, **k: None)  # 削除をno-op化

    result = main_module._cleanup_failed_ocr_dataset(PID, str(target))

    assert result is False  # 実際には残っているため成功扱いにしない
    assert target.exists()


# ---------------------------------------------------------------------------
# delete_model(): 部分削除失敗のログ（Issue #156）
# ---------------------------------------------------------------------------


def test_delete_model_logs_warning_when_model_dir_removal_incomplete(temp_projects, monkeypatch, caplog):
    """delete_model()のmodel dir rmtreeが完了しなかった場合、既存contract
    （sidecarは削除・例外は投げない）は変更せず、warningログを残す。"""
    paths = ensure_project_directories(PID)
    artifact = paths.models / "tesseract" / "locked_model"
    artifact.mkdir(parents=True)
    (artifact / "locked.traineddata").write_bytes(b"x")
    meta = paths.models / "locked.tess.json"
    meta.write_text(json.dumps({"tessdata_dir": str(artifact), "model_dir": str(artifact)}), encoding="utf-8")

    monkeypatch.setattr(model_registry_module.shutil, "rmtree", lambda *a, **k: None)

    with caplog.at_level(logging.WARNING, logger="src.app.services.model_registry"):
        result = model_registry_module.delete_model(PID, "locked.tess.json")

    assert result == "locked.tess.json"
    assert not meta.exists()  # sidecar自体は既存contractどおり削除される
    assert artifact.exists()  # rmtreeをno-op化したため実際には残る
    assert any("削除が完了しませんでした" in record.message for record in caplog.records)
