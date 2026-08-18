"""TrOCR Training Job Integration（Issue #94）のテスト。

Issue #92のTraining Core（`run_trocr_training()`）はここではmonkeypatchで差し替え、
実モデルダウンロード・GPU・ネットワークに依存しない。既存Tesseract/PaddleOCRのjob path
（`test_training_guard.py`等）は本Issueで一切変更していないため、本ファイルでは重複せず
TrOCR固有の配線（バリデーション・DBマッピング・lifecycle・reconcile除外・job_runner分岐）
のみを検証する。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request as StarletteRequest

import src.app.main as main_module
from src.app import db as db_module
from src.app.schemas import TrocrTrainStartRequest
from src.app.services.trocr_training_core import TrocrTrainingConfig, TrocrTrainingResult


def _dummy_request():
    return StarletteRequest(
        {"type": "http", "method": "POST", "path": "/", "headers": [], "query_string": b"", "client": ("127.0.0.1", 0)}
    )


def _use_temp_db(monkeypatch, tmp_path):
    monkeypatch.setattr(db_module, "_db_path", lambda: tmp_path / "app.db")
    db_module.init_db()


# ---------------------------------------------------------------------------
# api_trocr_train_start(): バリデーション
# ---------------------------------------------------------------------------


def test_missing_dataset_dir_returns_400(temp_projects, monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    req = TrocrTrainStartRequest(project_id="p1", dataset_dir="   ", model_ref="dummy/model")
    with pytest.raises(HTTPException) as exc:
        main_module.api_trocr_train_start(req, _dummy_request())
    assert exc.value.status_code == 400


def test_dataset_dir_not_found_returns_404(temp_projects, monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    req = TrocrTrainStartRequest(project_id="p1", dataset_dir=str(tmp_path / "does_not_exist"), model_ref="dummy/model")
    with pytest.raises(HTTPException) as exc:
        main_module.api_trocr_train_start(req, _dummy_request())
    assert exc.value.status_code == 404


def test_missing_model_ref_returns_400(temp_projects, monkeypatch, tmp_path):
    # model_refは必須Fieldだが空白のみの文字列自体はpydantic型検証を通過するため、
    # 空白除去後の空判定はAPIハンドラ側（api_trocr_train_start）の責務として検証する
    _use_temp_db(monkeypatch, tmp_path)
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    dataset_dir = tmp_path / "dataset_ok"
    dataset_dir.mkdir()
    req = TrocrTrainStartRequest(project_id="p1", dataset_dir=str(dataset_dir), model_ref="   ")
    with pytest.raises(HTTPException) as exc:
        main_module.api_trocr_train_start(req, _dummy_request())
    assert exc.value.status_code == 400


def test_unsupported_device_returns_400(temp_projects, monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    dataset_dir = tmp_path / "dataset_ok"
    dataset_dir.mkdir()
    with pytest.raises(Exception):
        TrocrTrainStartRequest(project_id="p1", dataset_dir=str(dataset_dir), model_ref="m", device="gpu")


def test_cuda_device_without_cuda_available_returns_400(temp_projects, monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    monkeypatch.setattr(main_module, "_system_check_snapshot", lambda: {"torch_cuda_available": False})
    dataset_dir = tmp_path / "dataset_ok"
    dataset_dir.mkdir()
    req = TrocrTrainStartRequest(project_id="p1", dataset_dir=str(dataset_dir), model_ref="dummy/model", device="cuda")
    with pytest.raises(HTTPException) as exc:
        main_module.api_trocr_train_start(req, _dummy_request())
    assert exc.value.status_code == 400
    assert "CUDA" in str(exc.value.detail)


def test_returns_409_when_training_already_active(temp_projects, monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    monkeypatch.setattr(
        main_module,
        "fetch_active_training_job",
        lambda pid, fam=None: {"id": "job-1", "project_id": "p1", "training_family": "ocr", "engine": "tesseract", "status": "running"},
    )
    dataset_dir = tmp_path / "dataset_ok"
    dataset_dir.mkdir()
    req = TrocrTrainStartRequest(project_id="p1", dataset_dir=str(dataset_dir), model_ref="dummy/model")
    with pytest.raises(HTTPException) as exc:
        main_module.api_trocr_train_start(req, _dummy_request())
    assert exc.value.status_code == 409


# ---------------------------------------------------------------------------
# api_trocr_train_start(): 正常系（DBマッピング確認）
# ---------------------------------------------------------------------------


def test_successful_job_creation_maps_request_fields_to_db(temp_projects, monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    monkeypatch.setattr(main_module, "_spawn_training_runner", lambda job_type, job_id: 4242)
    dataset_dir = tmp_path / "dataset_ok"
    dataset_dir.mkdir()

    req = TrocrTrainStartRequest(
        project_id="p1",
        dataset_dir=f"  {dataset_dir}  ",
        model_ref="my-org/my-trocr-model",
        epochs=5,
        batch_size=4,
        learning_rate=1e-4,
        max_target_length=48,
        device="cpu",
        local_files_only=True,
    )
    result = main_module.api_trocr_train_start(req, _dummy_request())
    assert result["status"] == "queued"
    assert result["engine"] == "trocr"
    assert result["training_family"] == "ocr"

    job = db_module.fetch_training_job(result["job_id"])
    assert job["engine"] == "trocr"
    assert job["training_family"] == "ocr"
    assert job["dataset_dir"] == str(dataset_dir)  # 前後空白はstripされる
    assert job["init_source_value"] == "my-org/my-trocr-model"
    assert job["epochs"] == 5
    assert job["batch_size"] == 4
    assert job["learning_rate"] == 1e-4
    assert job["max_text_length"] == 48
    assert job["device"] == "cpu"
    assert job["local_files_only"] is True
    assert job["worker_pid"] == 4242
    assert job["status"] == "queued"


def test_spawn_training_runner_called_with_trocr_job_type(temp_projects, monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    monkeypatch.setattr(main_module, "fetch_active_training_job", lambda pid, fam=None: None)
    captured = {}

    def _fake_spawn(job_type, job_id):
        captured["job_type"] = job_type
        return 1

    monkeypatch.setattr(main_module, "_spawn_training_runner", _fake_spawn)
    dataset_dir = tmp_path / "dataset_ok"
    dataset_dir.mkdir()
    req = TrocrTrainStartRequest(project_id="p1", dataset_dir=str(dataset_dir), model_ref="dummy/model")
    main_module.api_trocr_train_start(req, _dummy_request())
    assert captured["job_type"] == "trocr"


# ---------------------------------------------------------------------------
# _run_trocr_training_job(): lifecycle・Core呼び出しマッピング
# ---------------------------------------------------------------------------


def _queued_trocr_job(tmp_path, job_id="job-1", **overrides):
    now = "2026-08-18T00:00:00"
    base = {
        "id": job_id,
        "project_id": "p1",
        "training_family": "ocr",
        "engine": "trocr",
        "model_type": "ocr",
        "epochs": 2,
        "batch_size": 3,
        "learning_rate": 1e-4,
        "device": "auto",
        "max_text_length": 40,
        "dataset_dir": str(tmp_path / "dataset"),
        "local_files_only": False,
        "training_mode": "finetune",
        "init_source_type": "trocr_model_ref",
        "init_source_value": "dummy/model",
        "status": "queued",
        "message": "queued",
        "model_path": None,
        "worker_pid": 999,
        "log_path": str(tmp_path / "train.log"),
        "created_at": now,
        "updated_at": now,
    }
    base.update(overrides)
    return base


def test_run_trocr_training_job_success_lifecycle_and_core_args(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    db_module.upsert_training_job(_queued_trocr_job(tmp_path))

    captured = {}

    def _fake_run_trocr_training(dataset_dir, model_ref, config, on_epoch_end=None):
        captured["dataset_dir"] = dataset_dir
        captured["model_ref"] = model_ref
        captured["config"] = config
        if on_epoch_end is not None:
            on_epoch_end(1, 2, 0.5)
            on_epoch_end(2, 2, 0.25)
        return TrocrTrainingResult(
            artifact_dir=tmp_path / "artifact",
            model_ref=model_ref,
            sample_count=3,
            epochs_completed=2,
            final_loss=0.25,
        )

    monkeypatch.setattr(main_module, "run_trocr_training", _fake_run_trocr_training)
    main_module._run_trocr_training_job("job-1")

    job = db_module.fetch_training_job("job-1")
    assert job["status"] == "completed"
    assert job["message"] == "trocr training completed"
    assert job["model_path"] == str(tmp_path / "artifact")
    assert job["worker_pid"] is None

    assert captured["dataset_dir"] == str(tmp_path / "dataset")
    assert captured["model_ref"] == "dummy/model"
    config = captured["config"]
    assert isinstance(config, TrocrTrainingConfig)
    assert config.epochs == 2
    assert config.batch_size == 3
    assert config.learning_rate == 1e-4
    assert config.max_target_length == 40
    assert config.device is None  # DB上"auto"はCoreへNoneとして渡す
    assert config.local_files_only is False


def test_run_trocr_training_job_translates_explicit_device(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    db_module.upsert_training_job(_queued_trocr_job(tmp_path, device="cpu"))
    captured = {}

    def _fake_run_trocr_training(dataset_dir, model_ref, config, on_epoch_end=None):
        captured["device"] = config.device
        return TrocrTrainingResult(
            artifact_dir=tmp_path / "artifact", model_ref=model_ref, sample_count=1, epochs_completed=1, final_loss=0.1
        )

    monkeypatch.setattr(main_module, "run_trocr_training", _fake_run_trocr_training)
    main_module._run_trocr_training_job("job-1")
    assert captured["device"] == "cpu"


def test_run_trocr_training_job_sets_running_before_calling_core(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    db_module.upsert_training_job(_queued_trocr_job(tmp_path))
    observed_status_at_call_time = {}

    def _fake_run_trocr_training(dataset_dir, model_ref, config, on_epoch_end=None):
        observed_status_at_call_time["status"] = db_module.fetch_training_job("job-1")["status"]
        return TrocrTrainingResult(
            artifact_dir=tmp_path / "artifact", model_ref=model_ref, sample_count=1, epochs_completed=1, final_loss=0.1
        )

    monkeypatch.setattr(main_module, "run_trocr_training", _fake_run_trocr_training)
    main_module._run_trocr_training_job("job-1")
    assert observed_status_at_call_time["status"] == "running"


def test_run_trocr_training_job_core_failure_marks_job_failed(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    db_module.upsert_training_job(_queued_trocr_job(tmp_path))

    def _raise(dataset_dir, model_ref, config, on_epoch_end=None):
        raise RuntimeError("training exploded")

    monkeypatch.setattr(main_module, "run_trocr_training", _raise)
    main_module._run_trocr_training_job("job-1")

    job = db_module.fetch_training_job("job-1")
    assert job["status"] == "failed"
    assert "training exploded" in job["message"]
    assert job["worker_pid"] is None


def test_run_trocr_training_job_epoch_progress_is_logged(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    log_path = tmp_path / "train.log"
    db_module.upsert_training_job(_queued_trocr_job(tmp_path, log_path=str(log_path)))

    def _fake_run_trocr_training(dataset_dir, model_ref, config, on_epoch_end=None):
        on_epoch_end(1, 2, 0.5)
        on_epoch_end(2, 2, 0.25)
        return TrocrTrainingResult(
            artifact_dir=tmp_path / "artifact", model_ref=model_ref, sample_count=1, epochs_completed=2, final_loss=0.25
        )

    monkeypatch.setattr(main_module, "run_trocr_training", _fake_run_trocr_training)
    main_module._run_trocr_training_job("job-1")

    log_text = log_path.read_text(encoding="utf-8")
    assert "epoch: [1/2]" in log_text
    assert "epoch: [2/2]" in log_text
    assert "loss=0.5000" in log_text
    assert "loss=0.2500" in log_text


def test_run_trocr_training_job_missing_job_is_a_noop(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    # 存在しないjob_idを呼んでも例外を出さない（既存2エンジンのorchestration関数と同じ契約）
    main_module._run_trocr_training_job("does-not-exist")


# ---------------------------------------------------------------------------
# _reconcile_ocr_training_job(): trocr除外
# ---------------------------------------------------------------------------


def test_reconcile_excludes_trocr_engine_like_tesseract(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    db_module.upsert_training_job(_queued_trocr_job(tmp_path, status="running"))

    called = {"count": 0}

    def _fake_is_paddle_inference_dir(path):
        called["count"] += 1
        return False

    monkeypatch.setattr(main_module, "_is_paddle_inference_dir", _fake_is_paddle_inference_dir)
    result = main_module._reconcile_ocr_training_job("job-1")
    assert result["status"] == "running"  # 無変更のまま返る
    assert called["count"] == 0  # PaddleOCR固有の復旧チェックは一切呼ばれない


# ---------------------------------------------------------------------------
# job_runner.py: trocr分岐
# ---------------------------------------------------------------------------


def test_job_runner_dispatches_trocr_job_type(monkeypatch):
    import src.app.job_runner as job_runner_module

    monkeypatch.setattr(job_runner_module, "init_db", lambda: None)
    called = {}
    monkeypatch.setattr(job_runner_module, "_run_trocr_training_job", lambda job_id: called.setdefault("job_id", job_id))
    monkeypatch.setattr("sys.argv", ["job_runner", "trocr", "job-42"])
    exit_code = job_runner_module.main()
    assert exit_code == 0
    assert called["job_id"] == "job-42"
