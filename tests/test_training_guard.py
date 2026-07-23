"""OCR学習の二重実行防止（409）とアクティブジョブ再接続APIのテスト。"""

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request as StarletteRequest

import src.app.main as main_module
from src.app import db as db_module
from src.app.schemas import OcrTrainStartRequest, TesseractTrainStartRequest


def _dummy_request():
    """監査ログ・ロール検証用のダミーRequest（ヘッダなし=認証未設定モード）。"""
    return StarletteRequest(
        {"type": "http", "method": "POST", "path": "/", "headers": [], "query_string": b"", "client": ("127.0.0.1", 0)}
    )


def _running_job(**overrides):
    base = {
        "id": "job-1",
        "project_id": "p1",
        "training_family": "ocr",
        "engine": "tesseract",
        "status": "running",
    }
    base.update(overrides)
    return base


# ---- 409ガード（フロントのボタン無効化に依存しないバックエンド側防止） ----


def test_reject_helper_raises_409(monkeypatch):
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: _running_job())
    with pytest.raises(HTTPException) as exc:
        main_module._reject_if_training_active("p1", "ocr")
    assert exc.value.status_code == 409
    assert "実行中" in str(exc.value.detail)
    assert "job-1" in str(exc.value.detail)


def test_reject_helper_passes_when_no_active(monkeypatch):
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    main_module._reject_if_training_active("p1", "ocr")  # 例外が出ないこと


def test_ocr_train_start_returns_409(temp_projects, monkeypatch):
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: _running_job())
    req = OcrTrainStartRequest(project_id="p1", engine="paddleocr", dataset_dir="x")
    with pytest.raises(HTTPException) as exc:
        main_module.api_ocr_train_start(req, BackgroundTasks(), _dummy_request())
    assert exc.value.status_code == 409


def test_tesseract_train_start_returns_409(temp_projects, monkeypatch):
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: _running_job())
    req = TesseractTrainStartRequest(project_id="p1", dataset_dir="x")
    with pytest.raises(HTTPException) as exc:
        main_module.api_tesseract_train_start(req, _dummy_request())
    assert exc.value.status_code == 409


# ---- fetch_active_training_job（一時DBで実SQLを検証） ----


def test_fetch_active_training_job_with_temp_db(monkeypatch, tmp_path):
    monkeypatch.setattr(db_module, "_db_path", lambda: tmp_path / "app.db")
    db_module.init_db()
    now = "2026-07-15T13:00:00"

    def job(job_id, status, family="ocr", updated_at=now):
        return {
            "id": job_id,
            "project_id": "p1",
            "training_family": family,
            "engine": "tesseract",
            "model_type": "ocr",
            "epochs": 1000,
            "batch_size": 1,
            "status": status,
            "created_at": now,
            "updated_at": updated_at,
        }

    db_module.upsert_training_job(job("j-stopped", "stopped"))
    db_module.upsert_training_job(job("j-running", "running"))
    db_module.upsert_training_job(job("j-cls", "running", family="classification"))

    active = db_module.fetch_active_training_job("p1", "ocr")
    assert active is not None and active["id"] == "j-running"
    assert db_module.fetch_active_training_job("p1", "classification")["id"] == "j-cls"
    assert db_module.fetch_active_training_job("other-project", "ocr") is None

    # 停止・完了後はアクティブ扱いにならない
    db_module.upsert_training_job(job("j-running", "stopped"))
    db_module.upsert_training_job(job("j-cls", "completed", family="classification"))
    assert db_module.fetch_active_training_job("p1", "ocr") is None
    assert db_module.fetch_active_training_job("p1", "classification") is None


# ---- GET /api/ocr/train/active（再読込時の再接続用） ----


def test_active_endpoint_returns_running_job(temp_projects, monkeypatch):
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: _running_job())
    monkeypatch.setattr(main_module, "_reconcile_ocr_training_job", lambda job_id: _running_job())
    data = main_module.api_ocr_train_active(project_id="p1")
    assert data["job"] is not None
    assert data["job"]["id"] == "job-1"
    assert data["job"]["status"] == "running"


def test_active_endpoint_none_when_no_job(temp_projects, monkeypatch):
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    data = main_module.api_ocr_train_active(project_id="p1")
    assert data["job"] is None


def test_active_endpoint_none_when_reconciled_finished(temp_projects, monkeypatch):
    # DB上runningでも、プロセス突き合わせで終了と判明した場合はアクティブ扱いにしない
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: _running_job())
    monkeypatch.setattr(main_module, "_reconcile_ocr_training_job", lambda job_id: _running_job(status="stopped"))
    data = main_module.api_ocr_train_active(project_id="p1")
    assert data["job"] is None
