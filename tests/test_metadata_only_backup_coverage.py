"""metadata_onlyバックアップの対象拡張（Issue #150）のテスト。

Investigation #143で発見された既知gap（`benchmark_center.json`・
`inference_model.json`がproject単位backupの`metadata_only`モードから漏れていた）
の修正を検証する。実`data/projects/`・実`outputs/app.db`へは一切触れない
（`temp_projects`フィクスチャで隔離）。
"""

import json
import zipfile

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.backup_manager import (
    _backups_root,
    _METADATA_DIRS,
    _METADATA_FILES,
    create_backup,
    restore_backup,
)

PID = "p_metadata_coverage"


def _archive_names(entry):
    with zipfile.ZipFile(_backups_root() / entry["file"]) as zf:
        return set(zf.namelist())


def _seed_full_project(temp_projects):
    paths = ensure_project_directories(PID)
    (paths.raw / "img.png").write_bytes(b"\x89PNG-fake")
    (paths.root / "annotations").mkdir(exist_ok=True)
    (paths.root / "annotations" / "master.csv").write_text("filename,text\nimg.png,AB12\n", encoding="utf-8")
    (paths.root / "experiments.json").write_text(json.dumps({"counter": 1, "items": []}), encoding="utf-8")
    (paths.root / "benchmark_center.json").write_text(
        json.dumps({"counter": 1, "items": [{"id": "BMC-0001", "dataset_id": "DS0001"}]}), encoding="utf-8"
    )
    (paths.root / "inference_model.json").write_text(
        json.dumps({"engine": "tesseract", "model": "m1.tess.json", "inference_model_id": "M0001"}),
        encoding="utf-8",
    )
    preprocess_dir = paths.root / "preprocess"
    preprocess_dir.mkdir(parents=True, exist_ok=True)
    (preprocess_dir / "saved_config.json").write_text(json.dumps({"grayscale": True}), encoding="utf-8")
    history_dir = preprocess_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    (history_dir / "v0001.json").write_text(json.dumps({"grayscale": False}), encoding="utf-8")
    (paths.models / "m1.tess.json").write_text(json.dumps({"lang": "x"}), encoding="utf-8")
    (paths.models / "m1.traineddata").write_bytes(b"binary-model")
    return paths


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------


def test_metadata_only_includes_benchmark_center_json(temp_projects):
    _seed_full_project(temp_projects)
    entry = create_backup(PID, mode="metadata_only")
    assert "project/benchmark_center.json" in _archive_names(entry)


def test_metadata_only_includes_inference_model_json(temp_projects):
    _seed_full_project(temp_projects)
    entry = create_backup(PID, mode="metadata_only")
    assert "project/inference_model.json" in _archive_names(entry)


def test_metadata_only_includes_preprocess_saved_config_and_history(temp_projects):
    _seed_full_project(temp_projects)
    entry = create_backup(PID, mode="metadata_only")
    names = _archive_names(entry)
    assert "project/preprocess/saved_config.json" in names
    assert "project/preprocess/history/v0001.json" in names


def test_metadata_only_still_excludes_binary_artifacts(temp_projects):
    """既存の除外方針（画像・モデル実体）は今回の拡張で変わらない。"""
    _seed_full_project(temp_projects)
    entry = create_backup(PID, mode="metadata_only")
    names = _archive_names(entry)
    assert "project/raw/img.png" not in names
    assert "project/models/m1.traineddata" not in names


def test_metadata_only_file_contents_are_preserved(temp_projects):
    paths = _seed_full_project(temp_projects)
    entry = create_backup(PID, mode="metadata_only")
    with zipfile.ZipFile(_backups_root() / entry["file"]) as zf:
        backed_up = json.loads(zf.read("project/benchmark_center.json").decode("utf-8"))
        backed_up_inference = json.loads(zf.read("project/inference_model.json").decode("utf-8"))
        backed_up_saved_config = json.loads(zf.read("project/preprocess/saved_config.json").decode("utf-8"))
    original = json.loads((paths.root / "benchmark_center.json").read_text(encoding="utf-8"))
    original_inference = json.loads((paths.root / "inference_model.json").read_text(encoding="utf-8"))
    original_saved_config = json.loads((paths.root / "preprocess" / "saved_config.json").read_text(encoding="utf-8"))
    assert backed_up == original
    assert backed_up_inference == original_inference
    assert backed_up_saved_config == original_saved_config


def test_manifest_includes_sha256_for_new_files(temp_projects):
    _seed_full_project(temp_projects)
    entry = create_backup(PID, mode="metadata_only")
    with zipfile.ZipFile(_backups_root() / entry["file"]) as zf:
        manifest = json.loads(zf.read("backup_manifest.json").decode("utf-8"))
    paths_in_manifest = {f["path"] for f in manifest["files"]}
    for expected in (
        "project/benchmark_center.json",
        "project/inference_model.json",
        "project/preprocess/saved_config.json",
        "project/preprocess/history/v0001.json",
    ):
        assert expected in paths_in_manifest
        entry_for_path = next(f for f in manifest["files"] if f["path"] == expected)
        assert entry_for_path["sha256"]
        assert entry_for_path["size"] > 0


def test_missing_optional_files_do_not_fail_backup(temp_projects):
    """既存metadata fileと同様、対象fileがproject内に存在しなくてもbackup全体は失敗しない。"""
    paths = ensure_project_directories(PID)
    (paths.root / "experiments.json").write_text(json.dumps({"counter": 0, "items": []}), encoding="utf-8")
    # benchmark_center.json・inference_model.json・preprocess/はいずれも未作成のまま
    entry = create_backup(PID, mode="metadata_only")
    names = _archive_names(entry)
    assert "project/experiments.json" in names
    assert "project/benchmark_center.json" not in names
    assert "project/inference_model.json" not in names
    assert not any(name.startswith("project/preprocess/") for name in names)


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------


def test_metadata_only_restore_recreates_new_files_with_equal_values(temp_projects):
    paths = _seed_full_project(temp_projects)
    entry = create_backup(PID, mode="metadata_only")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]

    original_bc = json.loads((paths.root / "benchmark_center.json").read_text(encoding="utf-8"))
    restored_bc = json.loads((restored_root / "benchmark_center.json").read_text(encoding="utf-8"))
    assert restored_bc == original_bc

    original_inf = json.loads((paths.root / "inference_model.json").read_text(encoding="utf-8"))
    restored_inf = json.loads((restored_root / "inference_model.json").read_text(encoding="utf-8"))
    assert restored_inf == original_inf

    original_saved = json.loads((paths.root / "preprocess" / "saved_config.json").read_text(encoding="utf-8"))
    restored_saved = json.loads((restored_root / "preprocess" / "saved_config.json").read_text(encoding="utf-8"))
    assert restored_saved == original_saved
    assert (restored_root / "preprocess" / "history" / "v0001.json").is_file()


def test_full_backup_restore_regression_still_includes_everything(temp_projects):
    """full modeは今回のIssueで変更していないため、既存どおり画像・モデル実体を含む。"""
    _seed_full_project(temp_projects)
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    assert (restored_root / "raw" / "img.png").is_file()
    assert (restored_root / "models" / "m1.traineddata").is_file()
    assert (restored_root / "benchmark_center.json").is_file()
    assert (restored_root / "preprocess" / "history" / "v0001.json").is_file()


def test_metadata_only_existing_files_regression(temp_projects):
    """既存4件（experiments.json等）が今回の拡張後も引き続きmetadata_onlyへ含まれる。"""
    _seed_full_project(temp_projects)
    entry = create_backup(PID, mode="metadata_only")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    assert (restored_root / "experiments.json").is_file()
    assert (restored_root / "annotations" / "master.csv").is_file()
    assert (restored_root / "models" / "m1.tess.json").is_file()


def test_model_sidecar_path_rebase_still_works_after_metadata_expansion(temp_projects):
    """Issue #145で実装したmodel sidecarの絶対パスrebaseが、本Issueの変更後も無回帰であること。"""
    paths = _seed_full_project(temp_projects)
    tess_dir = paths.models / "tesseract" / "m2"
    tess_dir.mkdir(parents=True)
    (tess_dir / "m2.traineddata").write_bytes(b"fake-traineddata")
    (paths.models / "m2.tess.json").write_text(
        json.dumps(
            {
                "tessdata_dir": str(tess_dir),
                "model_dir": str(tess_dir),
                "traineddata_path": str(tess_dir / "m2.traineddata"),
            }
        ),
        encoding="utf-8",
    )
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    restored_payload = json.loads((restored_root / "models" / "m2.tess.json").read_text(encoding="utf-8"))
    assert restored_payload["tessdata_dir"] == str(restored_root / "models" / "tesseract" / "m2")
    assert restored["model_path_rebase"]["rebased"] == ["project/models/m2.tess.json"]


# ---------------------------------------------------------------------------
# Contract guard
# ---------------------------------------------------------------------------


def test_metadata_files_contract_is_pinned():
    """将来の意図しない除外（誰かが_METADATA_FILESから削除してしまう等）を検出する
    固定リストテスト。このテスト自体を更新する場合は、削除ではなく追加であること・
    Scope Decisionの5条件を満たすことを確認してから変更すること。"""
    assert _METADATA_FILES == [
        "experiments.json",
        "releases.json",
        "benchmarks.json",
        "preprocess_config.json",
        "benchmark_center.json",
        "inference_model.json",
    ]


def test_metadata_dirs_contract_is_pinned():
    assert _METADATA_DIRS == [
        ("annotations", None),
        ("processed/meta", None),
        ("models", {".json"}),
        ("preprocess", {".json"}),
    ]


def test_accidental_exclusion_of_new_files_would_be_detected(temp_projects):
    """_METADATA_FILESから今回追加した2件を意図的に取り除いた場合に、backupへ
    含まれなくなることを示す（=既存テストが正しく漏れを検出できることの確認）。"""
    from src.app.services import backup_manager as backup_manager_module

    _seed_full_project(temp_projects)
    original = list(backup_manager_module._METADATA_FILES)
    try:
        backup_manager_module._METADATA_FILES = [f for f in original if f != "benchmark_center.json"]
        entry = create_backup(PID, mode="metadata_only")
        assert "project/benchmark_center.json" not in _archive_names(entry)
    finally:
        backup_manager_module._METADATA_FILES = original
