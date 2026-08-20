"""TrOCR Model Management Parity（Issue #141）のテスト。

Model Manager（`delete_model()`/`download_model_endpoint()`）がTrOCRモデル
（`.trocr.json` sidecar + directory artifact）を、Tesseract/PaddleOCRと同様に
安全に削除・ダウンロードできることを検証する。実TrOCRモデル（Hugging Face
モデル読込等）には依存しない（Model Manager自体はモデルをloadしないため、
`test_delete_model_safety.py`/`test_release_gate_trocr.py`と同じ手法で
`.trocr.json`をダミーの内容で直接書き込む）。実`data/projects/`・実
`outputs/app.db`へは一切触れない（`temp_projects`フィクスチャで隔離）。
"""

import json
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

import src.app.main as main_module
import src.app.services.model_registry as mr

PROJECT = "t_trocr_mgmt"


def models_root(temp_projects) -> Path:
    return temp_projects["projects_dir"] / PROJECT / "models"


def _write_trocr_model(temp_projects, *, job_id="job-1", name=None, model_dir_files=("config.json", "model.safetensors")):
    """`register_trocr_model()`と同じ形状のsidecar + artifact directoryを直接書き込む。"""
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    sidecar_name = name or f"trocr_{job_id}.trocr.json"
    artifact_dir = root / "trocr_runs" / job_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    for filename in model_dir_files:
        (artifact_dir / filename).write_text("{}", encoding="utf-8")
    meta = {
        "name": sidecar_name,
        "engine": "trocr",
        "training_family": "ocr",
        "model_type": "ocr",
        "model_dir": str(artifact_dir),
        "base_model_ref": "microsoft/trocr-base-printed",
        "project_id": PROJECT,
        "job_id": job_id,
        "dataset_root": "",
        "dataset_id": "",
        "epochs": 3,
        "batch_size": 2,
        "learning_rate": 5e-5,
        "final_loss": 0.5,
        "created_at": "2026-08-01T00:00:00",
    }
    (root / sidecar_name).write_text(json.dumps(meta), encoding="utf-8")
    return sidecar_name, artifact_dir


# ---------------------------------------------------------------------------
# delete_model(): TrOCR
# ---------------------------------------------------------------------------


def test_delete_trocr_model_removes_sidecar_and_artifact_dir(temp_projects):
    sidecar_name, artifact_dir = _write_trocr_model(temp_projects)
    result = mr.delete_model(PROJECT, sidecar_name)
    assert result == sidecar_name
    assert not (models_root(temp_projects) / sidecar_name).exists()
    assert not artifact_dir.exists()


def test_delete_trocr_model_does_not_touch_other_model_dir(temp_projects):
    """同じmodels/trocr_runs/配下でも、対象job_id以外のディレクトリは無傷。"""
    sidecar_name, artifact_dir = _write_trocr_model(temp_projects, job_id="job-1")
    _, other_dir = _write_trocr_model(temp_projects, job_id="job-2")
    mr.delete_model(PROJECT, sidecar_name)
    assert not artifact_dir.exists()
    assert other_dir.exists()


def test_delete_trocr_model_missing_artifact_dir_still_deletes_sidecar(temp_projects):
    """artifact directoryが既に無い場合でも、sidecar自体は削除できる（診断可能・クラッシュしない）。"""
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    sidecar_name = "trocr_job-missing.trocr.json"
    meta = {"name": sidecar_name, "engine": "trocr", "model_dir": str(root / "trocr_runs" / "does-not-exist")}
    (root / sidecar_name).write_text(json.dumps(meta), encoding="utf-8")
    result = mr.delete_model(PROJECT, sidecar_name)
    assert result == sidecar_name
    assert not (root / sidecar_name).exists()


def test_delete_trocr_model_malformed_metadata_deletes_sidecar_only(temp_projects):
    """破損（JSONパース不能）の.trocr.json: 実体には触れずsidecarのみ削除
    （PaddleOCRの既存fallthrough挙動と同じ、専用の早期returnを追加していないことの確認）。"""
    root = models_root(temp_projects)
    artifact_dir = root / "trocr_runs" / "job-broken"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "config.json").write_text("{}", encoding="utf-8")
    sidecar_name = "trocr_job-broken.trocr.json"
    (root / sidecar_name).write_text("{not valid json", encoding="utf-8")
    result = mr.delete_model(PROJECT, sidecar_name)
    assert result == sidecar_name
    assert not (root / sidecar_name).exists()
    assert artifact_dir.exists()  # 破損メタでは実体を推測削除しない


def test_delete_trocr_model_dir_outside_models_root_is_skipped(temp_projects):
    """model_dirがmodelsディレクトリ配下でない場合、_resolve_safe_model_dirs()の
    既存ガードによりrmtreeされない（sidecarのみ削除、実体は残存）。"""
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    outside_dir = temp_projects["tmp"] / "outside_trocr_artifact"
    outside_dir.mkdir(parents=True)
    (outside_dir / "config.json").write_text("{}", encoding="utf-8")
    sidecar_name = "trocr_job-outside.trocr.json"
    meta = {"name": sidecar_name, "engine": "trocr", "model_dir": str(outside_dir)}
    (root / sidecar_name).write_text(json.dumps(meta), encoding="utf-8")
    mr.delete_model(PROJECT, sidecar_name)
    assert not (root / sidecar_name).exists()
    assert outside_dir.exists()  # models配下ではないため削除されない


def test_delete_unknown_extension_still_rejected(temp_projects):
    """.trocr.json追加後も、対応外拡張子の拒否ロジック自体は無回帰。"""
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    (root / "model.bin").write_text("x", encoding="utf-8")
    with pytest.raises(ValueError, match="only .pt, .ocr.json, .tess.json and .trocr.json"):
        mr.delete_model(PROJECT, "model.bin")


# ---------------------------------------------------------------------------
# Tesseract/PaddleOCR regression（delete_model）
# ---------------------------------------------------------------------------


def test_delete_tesseract_model_regression(temp_projects):
    root = models_root(temp_projects)
    artifact = root / "tesseract" / "m1"
    artifact.mkdir(parents=True)
    (artifact / "m1.traineddata").write_bytes(b"x")
    meta = root / "m1.tess.json"
    meta.write_text(json.dumps({"tessdata_dir": str(artifact), "model_dir": str(artifact)}), encoding="utf-8")
    mr.delete_model(PROJECT, "m1.tess.json")
    assert not meta.exists()
    assert not artifact.exists()


def test_delete_paddleocr_model_regression(temp_projects):
    root = models_root(temp_projects)
    artifact = root / "ocr_runs" / "job-1" / "inference"
    artifact.mkdir(parents=True)
    (artifact / "inference.pdmodel").write_bytes(b"x")
    meta = root / "m1.ocr.json"
    meta.write_text(json.dumps({"inference_dir": str(artifact)}), encoding="utf-8")
    mr.delete_model(PROJECT, "m1.ocr.json")
    assert not meta.exists()
    assert not artifact.exists()


# ---------------------------------------------------------------------------
# download_model_endpoint(): TrOCR
# ---------------------------------------------------------------------------


def test_download_trocr_model_returns_zip_with_sidecar_and_artifact_files(temp_projects):
    sidecar_name, artifact_dir = _write_trocr_model(temp_projects, model_dir_files=("config.json", "model.safetensors"))
    response = main_module.download_model_endpoint(sidecar_name, project_id=PROJECT)
    try:
        assert response.media_type == "application/zip"
        assert response.filename.endswith(".trocr.zip")
        with zipfile.ZipFile(response.path) as zf:
            names = set(zf.namelist())
            assert sidecar_name in names
            assert "model/config.json" in names
            assert "model/model.safetensors" in names
    finally:
        Path(response.path).unlink(missing_ok=True)


def test_download_trocr_model_source_artifact_unchanged(temp_projects):
    """ダウンロード処理が元のartifact directory・sidecarを変更しないことを確認する。"""
    sidecar_name, artifact_dir = _write_trocr_model(temp_projects)
    sidecar_path = models_root(temp_projects) / sidecar_name
    before_sidecar = sidecar_path.read_text(encoding="utf-8")
    before_files = sorted(p.name for p in artifact_dir.iterdir())
    response = main_module.download_model_endpoint(sidecar_name, project_id=PROJECT)
    Path(response.path).unlink(missing_ok=True)
    assert sidecar_path.read_text(encoding="utf-8") == before_sidecar
    assert sorted(p.name for p in artifact_dir.iterdir()) == before_files


def test_download_trocr_model_missing_model_dir_returns_404(temp_projects):
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    sidecar_name = "trocr_job-nodir.trocr.json"
    meta = {"name": sidecar_name, "engine": "trocr", "model_dir": str(root / "trocr_runs" / "nope")}
    (root / sidecar_name).write_text(json.dumps(meta), encoding="utf-8")
    with pytest.raises(HTTPException) as exc:
        main_module.download_model_endpoint(sidecar_name, project_id=PROJECT)
    assert exc.value.status_code == 404


def test_download_trocr_model_malformed_metadata_returns_400(temp_projects):
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    sidecar_name = "trocr_job-broken.trocr.json"
    (root / sidecar_name).write_text("{not valid json", encoding="utf-8")
    with pytest.raises(HTTPException) as exc:
        main_module.download_model_endpoint(sidecar_name, project_id=PROJECT)
    assert exc.value.status_code == 400


def test_download_trocr_model_no_model_dir_field_returns_400(temp_projects):
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    sidecar_name = "trocr_job-empty.trocr.json"
    (root / sidecar_name).write_text(json.dumps({"name": sidecar_name, "engine": "trocr", "model_dir": ""}), encoding="utf-8")
    with pytest.raises(HTTPException) as exc:
        main_module.download_model_endpoint(sidecar_name, project_id=PROJECT)
    assert exc.value.status_code == 400


def test_download_nonexistent_model_returns_404(temp_projects):
    models_root(temp_projects).mkdir(parents=True, exist_ok=True)
    with pytest.raises(HTTPException) as exc:
        main_module.download_model_endpoint("trocr_ghost.trocr.json", project_id=PROJECT)
    assert exc.value.status_code == 404


def test_download_path_traversal_rejected(temp_projects):
    models_root(temp_projects).mkdir(parents=True, exist_ok=True)
    with pytest.raises(HTTPException) as exc:
        main_module.download_model_endpoint("../secret.trocr.json", project_id=PROJECT)
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# Tesseract/PaddleOCR regression（download_model_endpoint）
# ---------------------------------------------------------------------------


def test_download_unsupported_extension_still_rejected(temp_projects):
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    (root / "model.bin").write_text("x", encoding="utf-8")
    with pytest.raises(HTTPException) as exc:
        main_module.download_model_endpoint("model.bin", project_id=PROJECT)
    assert exc.value.status_code == 400
    assert "trocr" in exc.value.detail  # エラーメッセージが更新後の対応拡張子一覧を含む
