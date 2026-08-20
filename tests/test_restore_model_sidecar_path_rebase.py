"""Restore時のモデルsidecar絶対パスrebase（Issue #145）のテスト。

Investigation #143で発見した既知バグ（restore_backup()がsidecar内の絶対パス
（model_dir/tessdata_dir/inference_dir/traineddata_path）を復元先projectへ
書き換えず、復元後のTesseract/PaddleOCR/TrOCRモデルが旧project pathを指した
ままになる）の修正を検証する。実`data/projects/`・実`outputs/app.db`へは
一切触れない（`temp_projects`フィクスチャで隔離）。
"""

import json
import zipfile
from pathlib import Path

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.backup_manager import (
    _backups_root,
    _rebase_path_value,
    create_backup,
    restore_backup,
)

PID = "p_rebase"


def _write_trocr_sidecar(paths, *, job_id="job-1"):
    model_dir = paths.models / "trocr_runs" / job_id
    model_dir.mkdir(parents=True)
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / "model.safetensors").write_bytes(b"fake-weights")
    sidecar_name = f"trocr_{job_id}.trocr.json"
    sidecar = paths.models / sidecar_name
    sidecar.write_text(
        json.dumps({"name": sidecar_name, "engine": "trocr", "model_dir": str(model_dir), "job_id": job_id}),
        encoding="utf-8",
    )
    return sidecar_name, model_dir


def _write_tesseract_sidecar(paths, *, name="m1"):
    tess_dir = paths.models / "tesseract" / name
    tess_dir.mkdir(parents=True)
    traineddata = tess_dir / f"{name}.traineddata"
    traineddata.write_bytes(b"fake-traineddata")
    sidecar_name = f"{name}.tess.json"
    sidecar = paths.models / sidecar_name
    sidecar.write_text(
        json.dumps(
            {
                "engine": "tesseract",
                "tessdata_dir": str(tess_dir),
                "model_dir": str(tess_dir),
                "traineddata_path": str(traineddata),
            }
        ),
        encoding="utf-8",
    )
    return sidecar_name, tess_dir, traineddata


def _write_paddleocr_sidecar(paths, *, name="p1"):
    inference_dir = paths.models / "ocr_runs" / name / "inference"
    checkpoint_dir = paths.models / "ocr_runs" / name / "checkpoint"
    inference_dir.mkdir(parents=True)
    checkpoint_dir.mkdir(parents=True)
    (inference_dir / "inference.pdmodel").write_bytes(b"fake-pdmodel")
    (checkpoint_dir / "best_accuracy.pdparams").write_bytes(b"fake-ckpt")
    sidecar_name = f"{name}.ocr.json"
    sidecar = paths.models / sidecar_name
    sidecar.write_text(
        json.dumps(
            {
                "engine": "paddleocr",
                "model_dir": str(inference_dir),
                "inference_dir": str(inference_dir),
                "checkpoint_dir": str(checkpoint_dir),
            }
        ),
        encoding="utf-8",
    )
    return sidecar_name, inference_dir, checkpoint_dir


# ---------------------------------------------------------------------------
# _rebase_path_value(): 単体テスト
# ---------------------------------------------------------------------------


def test_rebase_path_value_finds_last_matching_component(tmp_path):
    target_root = tmp_path / "projects" / "new_id"
    old = Path("/data/projects/old_id/models/trocr_runs/job-1")
    result = _rebase_path_value(str(old), "old_id", target_root)
    assert result == target_root / "models" / "trocr_runs" / "job-1"


def test_rebase_path_value_uses_last_occurrence_when_source_pid_repeats(tmp_path):
    """source_pidと同名のディレクトリが途中にも現れる場合、末尾側（実際のproject境界）を採用する。"""
    target_root = tmp_path / "projects" / "new_id"
    # "old_id" という名前がパスの途中（無関係な階層）にも偶然出現するケース
    old = Path("/data/old_id/backup_stage/projects/old_id/models/m1.tess.json")
    result = _rebase_path_value(str(old), "old_id", target_root)
    assert result == target_root / "models" / "m1.tess.json"


def test_rebase_path_value_returns_none_when_anchor_not_found(tmp_path):
    target_root = tmp_path / "projects" / "new_id"
    old = Path("/completely/unrelated/path/models/m1.tess.json")
    assert _rebase_path_value(str(old), "old_id", target_root) is None


def test_rebase_path_value_returns_none_when_anchor_is_last_component(tmp_path):
    target_root = tmp_path / "projects" / "new_id"
    old = Path("/data/projects/old_id")
    assert _rebase_path_value(str(old), "old_id", target_root) is None


# ---------------------------------------------------------------------------
# restore_backup(): Tesseract
# ---------------------------------------------------------------------------


def test_restore_rebases_tesseract_absolute_paths(temp_projects):
    paths = ensure_project_directories(PID)
    sidecar_name, tess_dir, traineddata = _write_tesseract_sidecar(paths)
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    restored_pid = restored["project_id"]

    restored_root = temp_projects["projects_dir"] / restored_pid
    restored_payload = json.loads((restored_root / "models" / sidecar_name).read_text(encoding="utf-8"))

    assert restored_payload["tessdata_dir"] == str(restored_root / "models" / "tesseract" / "m1")
    assert restored_payload["model_dir"] == str(restored_root / "models" / "tesseract" / "m1")
    assert restored_payload["traineddata_path"] == str(restored_root / "models" / "tesseract" / "m1" / "m1.traineddata")
    # 旧project pathを一切保持していない（PIDそのものがpath componentとして残っていない）
    assert PID not in Path(restored_payload["tessdata_dir"]).parts
    assert str(tess_dir) != restored_payload["tessdata_dir"]
    assert restored["model_path_rebase"]["rebased"] == [f"project/models/{sidecar_name}"]
    assert restored["model_path_rebase"]["unrebased"] == []


def test_restore_tesseract_ready_check_resolves_against_restored_artifact(temp_projects):
    """`_is_tesseract_model_ready()`が、rebase後のtraineddata_pathを使って正しくreadyと判定できること。"""
    from src.app.services.model_registry import _is_tesseract_model_ready

    paths = ensure_project_directories(PID)
    sidecar_name, _, _ = _write_tesseract_sidecar(paths)
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    restored_payload = json.loads((restored_root / "models" / sidecar_name).read_text(encoding="utf-8"))
    assert _is_tesseract_model_ready(restored_payload) is True


# ---------------------------------------------------------------------------
# restore_backup(): PaddleOCR
# ---------------------------------------------------------------------------


def test_restore_rebases_paddleocr_absolute_paths(temp_projects):
    paths = ensure_project_directories(PID)
    sidecar_name, inference_dir, checkpoint_dir = _write_paddleocr_sidecar(paths)
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    restored_payload = json.loads((restored_root / "models" / sidecar_name).read_text(encoding="utf-8"))

    assert restored_payload["inference_dir"] == str(restored_root / "models" / "ocr_runs" / "p1" / "inference")
    assert restored_payload["checkpoint_dir"] == str(restored_root / "models" / "ocr_runs" / "p1" / "checkpoint")
    assert restored_payload["model_dir"] == restored_payload["inference_dir"]
    assert str(inference_dir) != restored_payload["inference_dir"]
    assert restored["model_path_rebase"]["unrebased"] == []


def test_restore_paddleocr_official_model_has_no_sidecar_to_rebase(temp_projects):
    """PaddleOCR official（project-localなartifactを持たない）はそもそも`.ocr.json`を
    project内に書かないため、rebase処理の対象にもならない（無害な無変更を確認する）。"""
    paths = ensure_project_directories(PID)
    (paths.root / "experiments.json").write_text(json.dumps({"counter": 0, "items": []}), encoding="utf-8")
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    assert restored["model_path_rebase"] == {"rebased": [], "unrebased": []}


# ---------------------------------------------------------------------------
# restore_backup(): TrOCR
# ---------------------------------------------------------------------------


def test_restore_rebases_trocr_absolute_paths(temp_projects):
    paths = ensure_project_directories(PID)
    sidecar_name, model_dir = _write_trocr_sidecar(paths)
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    restored_payload = json.loads((restored_root / "models" / sidecar_name).read_text(encoding="utf-8"))

    expected = restored_root / "models" / "trocr_runs" / "job-1"
    assert restored_payload["model_dir"] == str(expected)
    assert str(model_dir) != restored_payload["model_dir"]
    assert expected.is_dir()
    assert (expected / "model.safetensors").is_file()


def test_restore_trocr_download_succeeds_against_restored_project(temp_projects):
    """download_model_endpoint()が、rebase後のmodel_dirを使って復元先projectから
    正しくダウンロードできること（Issue #143で確認された「復元後は404になる」の
    直接的な回帰確認）。"""
    import src.app.main as main_module

    paths = ensure_project_directories(PID)
    sidecar_name, _ = _write_trocr_sidecar(paths)
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    restored_pid = restored["project_id"]

    response = main_module.download_model_endpoint(sidecar_name, project_id=restored_pid)
    try:
        assert response.media_type == "application/zip"
        with zipfile.ZipFile(response.path) as zf:
            names = set(zf.namelist())
            assert sidecar_name in names
            assert "model/config.json" in names
            assert "model/model.safetensors" in names
    finally:
        Path(response.path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Safety / Regression
# ---------------------------------------------------------------------------


def test_source_project_sidecar_unchanged_after_restore(temp_projects):
    """rebaseは復元先のコピーのみを書き換え、元projectのsidecarには一切触れない。"""
    paths = ensure_project_directories(PID)
    sidecar_name, model_dir = _write_trocr_sidecar(paths)
    source_sidecar_path = paths.models / sidecar_name
    before = source_sidecar_path.read_text(encoding="utf-8")
    entry = create_backup(PID, mode="full")
    restore_backup(entry["backup_id"])
    assert source_sidecar_path.read_text(encoding="utf-8") == before
    assert json.loads(before)["model_dir"] == str(model_dir)


def test_backup_archive_not_mutated_by_rebase(temp_projects):
    """rebaseは復元先ファイルのみを書き換え、元のbackup archive（ZIP）自体は変更しない。"""
    paths = ensure_project_directories(PID)
    _write_trocr_sidecar(paths)
    entry = create_backup(PID, mode="full")
    archive = _backups_root() / entry["file"]
    before_bytes = archive.read_bytes()
    restore_backup(entry["backup_id"])
    assert archive.read_bytes() == before_bytes


def test_malformed_sidecar_json_does_not_fail_restore(temp_projects):
    """破損したsidecar JSONがあっても、restore全体は失敗せず、他のデータは正しく復元される。
    破損sidecarはunrebasedとして報告される（silent successにしない）。"""
    paths = ensure_project_directories(PID)
    (paths.root / "annotations").mkdir(exist_ok=True)
    (paths.root / "annotations" / "master.csv").write_text("filename,text\na.png,AB\n", encoding="utf-8")
    broken_sidecar = paths.models / "broken.tess.json"
    broken_sidecar.write_text("{not valid json", encoding="utf-8")
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    assert (restored_root / "annotations" / "master.csv").is_file()
    unrebased = restored["model_path_rebase"]["unrebased"]
    assert len(unrebased) == 1
    assert "project/models/broken.tess.json" == unrebased[0]["sidecar"]


def test_metadata_only_restore_reports_unrebased_since_artifact_not_copied(temp_projects):
    """metadata_onlyモードは`.json`以外のartifact本体（traineddata等）を含まないため、
    rebase先の実体が存在せず`unrebased`として報告される（restore自体は成功する）。

    Tesseractを使う（TrOCRのartifact directoryは`config.json`が`.json`拡張子の
    ためmetadata_onlyでも部分的に作られてしまう既知の別gap＝Investigation #143の
    Next Issue split 3件目。traineddataは`.traineddata`拡張子のため純粋に
    「artifactが一切存在しない」ケースを再現できるTesseractで検証する）。
    """
    paths = ensure_project_directories(PID)
    sidecar_name, _, _ = _write_tesseract_sidecar(paths)
    entry = create_backup(PID, mode="metadata_only")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    # sidecar自体は metadata_only でも含まれる（.json拡張子のため）
    assert (restored_root / "models" / sidecar_name).is_file()
    # しかしartifact directory本体（traineddata等）は含まれない
    assert not (restored_root / "models" / "tesseract" / "m1").exists()
    unrebased = restored["model_path_rebase"]["unrebased"]
    assert len(unrebased) == 1
    assert unrebased[0]["sidecar"] == f"project/models/{sidecar_name}"


def test_missing_path_field_is_left_untouched(temp_projects):
    """model_dir等のキー自体が存在しないsidecar（例: 分類モデルのmetadata等）は
    rebase対象キーが無いため何もせず、rebasedにもunrebasedにも計上されない。"""
    paths = ensure_project_directories(PID)
    sidecar = paths.models / "no_path_fields.tess.json"
    sidecar.write_text(json.dumps({"engine": "tesseract"}), encoding="utf-8")
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    assert restored["model_path_rebase"] == {"rebased": [], "unrebased": []}


def test_restore_without_any_model_present_still_works(temp_projects):
    """モデルが1件も無いプロジェクトのrestoreは、rebase処理が単に何もしないだけで
    従来どおり成功する。"""
    paths = ensure_project_directories(PID)
    (paths.raw / "img.png").write_bytes(b"\x89PNG-fake")
    entry = create_backup(PID, mode="full")
    restored = restore_backup(entry["backup_id"])
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    assert (restored_root / "raw" / "img.png").is_file()
    assert restored["model_path_rebase"] == {"rebased": [], "unrebased": []}
