"""`list_model_infos()`の`job_id`公開（Issue #119、Training→Evaluation Handoff）のテスト。

Frontendが「学習完了直後のjobから、その学習で登録されたモデルのsidecar名を
逆引きする」ためだけに追加した最小限のフィールドであることを確認する。
既存キー（engine/charset/traineddata_path等）への影響が無いことも合わせて確認する。
"""

import json

from src.app.project_paths import ensure_project_directories
from src.app.services.model_registry import list_model_infos
from src.app.services.ocr_pipeline import _register_ocr_model
from src.app.services.tesseract_pipeline import register_tesseract_model


def test_list_model_infos_exposes_job_id_for_tesseract(temp_projects):
    pid = "p_jobid_tess"
    paths = ensure_project_directories(pid)
    register_tesseract_model(
        project_id=pid,
        lang="digits",
        traineddata_path=paths.models / "digits.traineddata",
        tessdata_dir=paths.models,
        base_lang="eng",
        charset="0123456789",
        dataset_root=str(paths.models),
        counts={"train": 8, "val": 1, "test": 1},
        job_id="job-tess-1",
        max_iterations=1000,
    )
    info = {item["name"]: item for item in list_model_infos(pid)}["digits.tess.json"]
    assert info["job_id"] == "job-tess-1"
    # 既存キーは無変更のまま存在する（回帰確認）
    assert info["engine"] == "tesseract"
    assert info["charset"] == "0123456789"


def test_list_model_infos_exposes_job_id_for_paddleocr(temp_projects, isolated_test_db):
    """`.ocr.json`分岐は`fetch_training_job()`経由でtraining_jobsテーブルを参照する
    （`model_registry.py`）ため、isolated_test_dbで明示的にテスト専用DBを初期化する
    （Issue #8/#112と同じ理由。実outputs/app.dbの事前状態には依存しない）。
    """
    pid = "p_jobid_paddle"
    paths = ensure_project_directories(pid)
    inference_dir = paths.models / "ocr_paddleocr_infer"
    inference_dir.mkdir(parents=True, exist_ok=True)
    name = _register_ocr_model(
        project_id=pid,
        engine="paddleocr",
        checkpoint_dir=inference_dir,
        inference_dir=inference_dir,
        charset="ABC",
        max_text_length=32,
        image_shape=[3, 32, 320],
        dataset_root=inference_dir,
        job_id="job-paddle-1",
        epochs=10,
        batch_size=8,
        learning_rate=0.001,
    )
    info = {item["name"]: item for item in list_model_infos(pid)}[name]
    assert info["job_id"] == "job-paddle-1"
    assert info["engine"] == "paddleocr"


def test_list_model_infos_job_id_empty_for_legacy_model_without_job_id(temp_projects):
    """job_id未記録の旧モデルはエラーにせず空文字（既存の「未記録」慣例に揃える）。"""
    pid = "p_jobid_legacy"
    paths = ensure_project_directories(pid)
    (paths.models / "legacy.tess.json").write_text(
        json.dumps({"engine": "tesseract", "created_at": "2026-01-01T00:00:00"}), encoding="utf-8"
    )
    info = {item["name"]: item for item in list_model_infos(pid)}["legacy.tess.json"]
    assert info["job_id"] == ""
