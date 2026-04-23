import tempfile
import uuid
import os
import signal
import subprocess
import time
import io
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image

from .config import get_settings
from .db import delete_training_jobs_by_project, fetch_training_job, init_db, upsert_training_job
from .init_dirs import ensure_directories
from .predict import predict_from_image
from .project_paths import (
    delete_project_directory,
    ensure_project_directories,
    list_projects,
    normalize_project_id,
)
from .schemas import (
    AppShutdownRequest,
    DatasetBuildRequest,
    DirectorySelectRequest,
    EvaluateRequest,
    FileSelectRequest,
    ImportImagesRequest,
    LabelUpdateRequest,
    OcrDatasetCreateRequest,
    OcrDatasetFromLogsRequest,
    OcrLogSaveRequest,
    OcrTrainStartRequest,
    OcrTuningExportRequest,
    PreprocessPreviewRequest,
    PreprocessRequest,
    ProjectCreateRequest,
    RotateImageRequest,
    TrainRequest,
)
from .services.data_manager import import_images_from_directory, list_raw_images, rotate_project_image
from .services.dataset_builder import build_dataset, read_dataset_meta
from .services.dialogs import select_directory_path, select_file_path
from .services.evaluation import evaluate_dataset
from .services.labels import ensure_master_csv, read_labels, upsert_label
from .services.model_registry import (
    delete_model,
    latest_model,
    latest_ocr_model_meta,
    list_model_infos,
    list_model_types,
    list_models,
)
from .services.ocr_tuning import export_ocr_training_data
from .services.ocr_pipeline import (
    OCR_CHARSET_DEFAULT,
    create_ocr_dataset_from_logs,
    create_ocr_dataset,
    read_latest_rapid_ocr_states,
    read_training_log_lines,
    run_paddleocr_training,
    save_ocr_prediction_log,
)
from .services.preprocess import preview_preprocess, run_preprocess
from .services.training_image_builder import (
    detect_bboxes_with_yolo,
    export_selected_crops,
    list_yolo_models,
    make_resize_preview,
)
from .train import run_training

app = FastAPI(title="OCR Crafter API", version="0.2.0")
FIXED_PADDLE_OCR_REPO_DIR = str((Path(__file__).resolve().parents[2] / "external" / "PaddleOCR").resolve())
IMAGE_BUILDER_ALLOWED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
    ".heic",
    ".heif",
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now_iso() -> str:
    return datetime.now().isoformat()


def _resolve_project_id(project_id: Optional[str]) -> str:
    try:
        return normalize_project_id(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _build_project_summary(project_id: str) -> dict[str, Any]:
    image_count = len(list_raw_images(project_id=project_id))
    labels = read_labels(project_id=project_id)
    labeled_count = len([row for row in labels if str(row.get("label") or "").strip() != ""])
    models_count = len(list_models(project_id=project_id))
    rapid_state = read_latest_rapid_ocr_states(project_id)
    items = rapid_state.get("items") if isinstance(rapid_state, dict) else []
    confirmed_count = 0
    pending_count = 0
    if isinstance(items, list):
        for row in items:
            status = str((row or {}).get("status") or "").strip().lower()
            if status == "confirmed":
                confirmed_count += 1
            elif status == "pending":
                pending_count += 1
    return {
        "project_id": project_id,
        "images": image_count,
        "labeled": labeled_count,
        "ocr_confirmed": confirmed_count,
        "ocr_pending": pending_count,
        "models": models_count,
    }


def _safe_kill(pid: int) -> None:
    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:  # noqa: BLE001
        pass


def _listening_pids(port: int) -> list[int]:
    if port <= 0:
        return []
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception:  # noqa: BLE001
        return []

    pids: list[int] = []
    for line in (result.stdout or "").splitlines():
        value = line.strip()
        if not value:
            continue
        try:
            pids.append(int(value))
        except ValueError:
            continue
    return pids


def _pid_command(pid: int) -> str:
    if pid <= 1:
        return ""
    try:
        result = subprocess.run(
            ["ps", "-o", "command=", "-p", str(pid)],
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception:  # noqa: BLE001
        return ""
    return (result.stdout or "").strip()


def _shutdown_app(frontend_port: Optional[int]) -> None:
    current_pid = os.getpid()
    parent_pid = os.getppid()

    if frontend_port:
        for pid in _listening_pids(frontend_port):
            if pid != current_pid:
                _safe_kill(pid)

    parent_command = _pid_command(parent_pid).lower()
    if "uvicorn" in parent_command or "watchfiles" in parent_command:
        _safe_kill(parent_pid)

    time.sleep(0.2)
    _safe_kill(current_pid)


def _attach_preview_prediction(
    preview: dict[str, Any],
    project_id: str,
    engine: str = "custom",
    model: str = "latest",
    model_type: Optional[str] = None,
    easyocr_langs: str = "en",
) -> dict[str, Any]:
    image_type = str(preview.get("type", "single"))
    selected_model_type = model_type
    if (engine or "custom").strip().lower() == "custom" and not selected_model_type:
        settings = get_settings()
        mapping = settings.get("training", {}).get("image_type_to_model", {"single": "square", "wide": "wide"})
        selected_model_type = mapping.get(image_type) or settings.get("training", {}).get("default_model_type")

    try:
        paths = ensure_project_directories(project_id)
        processed_rel = preview.get("processed_preview")
        if not processed_rel:
            raise FileNotFoundError("processed preview path is missing")
        processed_path = paths.root / str(processed_rel)
        langs = [x.strip() for x in (easyocr_langs or "en").split(",") if x.strip()]
        prediction = predict_from_image(
            str(processed_path),
            model_type=selected_model_type,
            model=model,
            project_id=project_id,
            engine=engine,
            easyocr_languages=langs,
            apply_preprocess=False,
        )
        preview["prediction"] = prediction.get("prediction", "")
        preview["confidence"] = prediction.get("confidence")
        preview["predict_model_type"] = prediction.get("model_type", selected_model_type)
        preview["predict_model_name"] = prediction.get("model_name", "")
        preview["predict_engine"] = prediction.get("engine", engine)
        preview["predict_validation"] = prediction.get("validation")
        preview["predict_valid"] = prediction.get("valid")
        preview["predict_char_scores"] = prediction.get("char_scores")
        preview["predict_char_confidence_normalized"] = prediction.get("char_confidence_normalized")
        preview["predict_model_warning"] = prediction.get("model_warning")
        preview["predict_retry_used"] = prediction.get("retry_used")
        preview["predict_multi_ocr"] = prediction.get("multi_ocr")
        if prediction.get("easyocr_languages") is not None:
            preview["predict_easyocr_languages"] = prediction.get("easyocr_languages")
        if prediction.get("paddleocr_languages") is not None:
            preview["predict_paddleocr_languages"] = prediction.get("paddleocr_languages")
    except Exception as e:  # noqa: BLE001
        preview["prediction"] = ""
        preview["confidence"] = None
        preview["predict_error"] = str(e)
        preview["predict_model_type"] = selected_model_type
        preview["predict_model_name"] = ""
        preview["predict_engine"] = engine
    return preview


def _resize_image_by_axis(image: Image.Image, target_size: int, resize_axis: str) -> Image.Image:
    if target_size <= 0:
        raise ValueError("resize_long_side must be positive")
    axis = (resize_axis or "long").strip().lower()
    if axis not in {"long", "width", "height"}:
        raise ValueError("resize_axis must be one of: long, width, height")
    width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError("invalid image size")

    if axis == "width":
        scale = float(target_size) / float(width)
    elif axis == "height":
        scale = float(target_size) / float(height)
    else:
        scale = float(target_size) / float(max(width, height))
    target_w = max(1, int(round(width * scale)))
    target_h = max(1, int(round(height * scale)))
    return image.resize((target_w, target_h), Image.Resampling.LANCZOS)


def _prepare_yolo_source_image(image_bytes: bytes, use_resize: bool, resize_long_side: int, resize_axis: str) -> Image.Image:
    with Image.open(io.BytesIO(image_bytes)) as opened:
        base = opened.convert("RGB")
    if not use_resize:
        return base
    return _resize_image_by_axis(base, resize_long_side, resize_axis)


def _normalize_easyocr_langs(value: str) -> list[str]:
    langs = [x.strip() for x in (value or "en").split(",") if x.strip()]
    if not langs:
        langs = ["en"]
    return langs


def _parse_preprocess_overrides_json(raw: str) -> Optional[dict[str, Any]]:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid preprocess_overrides_json: {e.msg}") from e
    if not isinstance(parsed, dict):
        raise ValueError("preprocess_overrides_json must be a JSON object")
    return parsed


@app.on_event("startup")
def on_startup() -> None:
    ensure_directories()
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/system/shutdown")
def shutdown_app(req: AppShutdownRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if req.frontend_port is not None and not (1 <= req.frontend_port <= 65535):
        raise HTTPException(status_code=400, detail="frontend_port must be between 1 and 65535")
    background_tasks.add_task(_shutdown_app, req.frontend_port)
    return {"status": "shutting_down"}


@app.get("/projects")
def projects() -> dict[str, Any]:
    items = list_projects()
    summaries = [_build_project_summary(project_id) for project_id in items]
    return {"items": items, "summaries": summaries}


@app.post("/projects")
def create_project(req: ProjectCreateRequest) -> dict[str, str]:
    project_id = _resolve_project_id(req.project_id)
    ensure_project_directories(project_id)
    ensure_master_csv(project_id)
    return {"project_id": project_id}


@app.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    try:
        deleted_project = delete_project_directory(resolved)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    deleted_jobs = delete_training_jobs_by_project(resolved)
    return {"project_id": deleted_project, "deleted_jobs": deleted_jobs}


@app.post("/images/import")
def import_images(req: ImportImagesRequest) -> dict[str, Any]:
    project_id = _resolve_project_id(req.project_id)
    try:
        imported = import_images_from_directory(req.source_dir, project_id=project_id)
        copied_files = imported.get("copied_files") or []
        pipeline = run_preprocess(project_id=project_id, only_files=copied_files)
        return {
            **imported,
            "pipeline": {
                "count": pipeline.get("count", 0),
                "type_counts": pipeline.get("type_counts", {"single": 0, "wide": 0}),
            },
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/dialogs/select-directory")
def select_directory(req: DirectorySelectRequest) -> dict[str, str]:
    try:
        path = select_directory_path(req.initial_dir)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"failed to open directory dialog: {e}") from e
    return {"path": path}


@app.post("/dialogs/select-file")
def select_file(req: FileSelectRequest) -> dict[str, str]:
    try:
        path = select_file_path(req.initial_dir, extensions=["pt"])
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"failed to open file dialog: {e}") from e
    return {"path": path}


@app.get("/images")
def list_images(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    images = list_raw_images(project_id=resolved)
    rows = read_labels(project_id=resolved)
    label_map = {row.get("filename") or row.get("image"): row.get("label", "") for row in rows}
    type_map = {row.get("filename") or row.get("image"): row.get("type", "") for row in rows}
    return {
        "project_id": resolved,
        "count": len(images),
        "items": [{"image": name, "label": label_map.get(name, ""), "type": type_map.get(name, "")} for name in images],
    }


@app.post("/images/{image_name}/rotate")
def rotate_image(
    image_name: str,
    req: RotateImageRequest,
    project_id: Optional[str] = Query(default="default"),
) -> dict[str, Any]:
    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise HTTPException(status_code=400, detail="invalid image name")

    resolved = _resolve_project_id(project_id)
    try:
        rotated = rotate_project_image(safe_name, req.angle, project_id=resolved)
        pipeline = run_preprocess(project_id=resolved, only_files=[safe_name])
        return {**rotated, "pipeline": {"count": pipeline.get("count", 0), "files": pipeline.get("files", [])}}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/images/{image_name}/file")
def image_file(image_name: str, project_id: Optional[str] = Query(default="default")) -> FileResponse:
    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise HTTPException(status_code=400, detail="invalid image name")

    resolved = _resolve_project_id(project_id)
    paths = ensure_project_directories(resolved)
    path = paths.raw / safe_name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="image not found")

    return FileResponse(path)


@app.get("/images/{image_name}/processed")
def image_processed_file(
    image_name: str,
    project_id: Optional[str] = Query(default="default"),
    image_type: Optional[str] = Query(default=None),
) -> FileResponse:
    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise HTTPException(status_code=400, detail="invalid image name")

    resolved = _resolve_project_id(project_id)
    paths = ensure_project_directories(resolved)
    stem = Path(safe_name).stem

    candidates: list[Path] = []
    normalized_type = (image_type or "").strip().lower()
    if normalized_type in {"single", "wide"}:
        candidates.append(paths.processed / normalized_type / "images" / f"{stem}.png")
    else:
        rows = read_labels(project_id=resolved)
        type_map = {row.get("filename") or row.get("image"): row.get("type", "") for row in rows}
        labeled_type = str(type_map.get(safe_name, "")).strip().lower()
        if labeled_type in {"single", "wide"}:
            candidates.append(paths.processed / labeled_type / "images" / f"{stem}.png")
        candidates.extend(
            [
                paths.processed / "single" / "images" / f"{stem}.png",
                paths.processed / "wide" / "images" / f"{stem}.png",
            ]
        )

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return FileResponse(candidate)

    try:
        preview = preview_preprocess(image_name=safe_name, project_id=resolved)
        processed_rel = preview.get("processed_preview")
        if processed_rel:
            processed_path = paths.root / str(processed_rel)
            if processed_path.exists() and processed_path.is_file():
                return FileResponse(processed_path)
    except Exception:  # noqa: BLE001
        pass

    raise HTTPException(status_code=404, detail="processed image not found")


@app.post("/preprocess/run")
def preprocess(req: PreprocessRequest) -> dict[str, Any]:
    project_id = _resolve_project_id(req.project_id)
    return run_preprocess(project_id=project_id, overrides=req.overrides)


@app.get("/preprocess/preview")
def preprocess_preview_get(
    image: str = Query(..., description="raw image filename"),
    project_id: Optional[str] = Query(default="default"),
    engine: str = Query(default="custom"),
    model: str = Query(default="latest"),
    model_type: Optional[str] = Query(default=None),
    easyocr_langs: str = Query(default="en"),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    try:
        preview = preview_preprocess(image_name=image, project_id=resolved)
        return _attach_preview_prediction(
            preview,
            resolved,
            engine=engine,
            model=model,
            model_type=model_type,
            easyocr_langs=easyocr_langs,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/preprocess/preview")
def preprocess_preview_post(req: PreprocessPreviewRequest) -> dict[str, Any]:
    resolved = _resolve_project_id(req.project_id)
    try:
        preview = preview_preprocess(image_name=req.image, project_id=resolved, overrides=req.overrides)
        return _attach_preview_prediction(
            preview,
            resolved,
            engine=req.engine,
            model=req.model,
            model_type=req.model_type,
            easyocr_langs=req.easyocr_langs,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/labels")
def labels(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "items": read_labels(resolved)}


@app.put("/labels/{image_name}")
def update_label(
    image_name: str,
    req: LabelUpdateRequest,
    project_id: Optional[str] = Query(default="default"),
) -> dict[str, str]:
    resolved = _resolve_project_id(project_id)
    upsert_label(image_name, req.label, project_id=resolved)
    return {"project_id": resolved, "image": image_name, "label": req.label}


@app.post("/dataset/build")
def dataset(req: DatasetBuildRequest) -> dict[str, Any]:
    project_id = _resolve_project_id(req.project_id)
    try:
        return build_dataset(
            project_id=project_id,
            train_ratio=req.train_ratio,
            val_ratio=req.val_ratio,
            test_ratio=req.test_ratio,
            seed=req.seed,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/dataset/meta")
def dataset_meta(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    return read_dataset_meta(project_id=resolved)


def _run_training_job(job_id: str) -> None:
    job = fetch_training_job(job_id)
    if not job:
        return

    started = _now_iso()
    upsert_training_job(
        {
            **job,
            "status": "running",
            "message": "training started",
            "updated_at": started,
        }
    )

    def _on_epoch_progress(epoch_metrics: dict[str, Any], total_epochs: int) -> None:
        current = fetch_training_job(job_id) or job
        epoch = int(epoch_metrics.get("epoch", 0))
        train_loss = float(epoch_metrics.get("train_loss", 0.0))
        train_acc = float(epoch_metrics.get("train_acc", 0.0))
        if "val_acc" in epoch_metrics:
            val_acc = float(epoch_metrics.get("val_acc", 0.0))
            message = (
                f"epoch {epoch}/{int(total_epochs)} "
                f"train_loss={train_loss:.4f} train_acc={train_acc:.3f} val_acc={val_acc:.3f}"
            )
        else:
            message = (
                f"epoch {epoch}/{int(total_epochs)} "
                f"train_loss={train_loss:.4f} train_acc={train_acc:.3f}"
            )
        upsert_training_job(
            {
                **current,
                "status": "running",
                "message": message,
                "updated_at": _now_iso(),
            }
        )

    try:
        result = run_training(
            project_id=job["project_id"],
            dataset_dir=None,
            model_type=job["model_type"],
            epochs=job["epochs"],
            batch_size=job["batch_size"],
            learning_rate=job.get("learning_rate", 1e-3),
            progress_callback=_on_epoch_progress,
        )

        current = fetch_training_job(job_id) or job
        upsert_training_job(
            {
                **current,
                "status": "completed",
                "message": "training completed",
                "model_path": result["model_path"],
                "updated_at": _now_iso(),
            }
        )
    except Exception as e:  # noqa: BLE001
        current = fetch_training_job(job_id) or job
        upsert_training_job(
            {
                **current,
                "status": "failed",
                "message": str(e),
                "updated_at": _now_iso(),
            }
        )


def _run_ocr_training_job(job_id: str) -> None:
    job = fetch_training_job(job_id)
    if not job:
        return

    upsert_training_job(
        {
            **job,
            "status": "running",
            "message": "ocr training started",
            "updated_at": _now_iso(),
        }
    )

    try:
        project_id = str(job.get("project_id") or "default")
        dataset_dir = str(job.get("dataset_dir") or "")
        paddle_repo_dir = str(job.get("paddle_repo_dir") or "").strip() or FIXED_PADDLE_OCR_REPO_DIR
        charset = str(job.get("charset") or OCR_CHARSET_DEFAULT)
        max_text_length = int(job.get("max_text_length") or 8)
        image_shape = job.get("image_shape") or [3, 48, 320]
        if not isinstance(image_shape, list):
            image_shape = [3, 48, 320]
        image_shape = [int(x) for x in image_shape]

        log_path = Path(str(job.get("log_path") or ""))
        if not str(log_path):
            paths = ensure_project_directories(project_id)
            log_path = paths.logs / f"train_ocr_{job_id}.log"

        result = run_paddleocr_training(
            project_id=project_id,
            job_id=job_id,
            dataset_dir=dataset_dir,
            paddle_repo_dir=paddle_repo_dir,
            epochs=int(job.get("epochs") or 50),
            batch_size=int(job.get("batch_size") or 16),
            charset=charset,
            max_text_length=max_text_length,
            image_shape=image_shape,
            log_path=log_path,
        )
        current = fetch_training_job(job_id) or job
        upsert_training_job(
            {
                **current,
                "status": "completed",
                "message": "ocr training completed",
                "model_path": result.get("model_dir"),
                "log_path": result.get("log_path"),
                "updated_at": _now_iso(),
            }
        )
    except Exception as e:  # noqa: BLE001
        current = fetch_training_job(job_id) or job
        upsert_training_job(
            {
                **current,
                "status": "failed",
                "message": str(e),
                "updated_at": _now_iso(),
            }
        )


@app.post("/train/start")
def train_start(req: TrainRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    project_id = _resolve_project_id(req.project_id)
    job_id = str(uuid.uuid4())
    now = _now_iso()
    upsert_training_job(
        {
            "id": job_id,
            "project_id": project_id,
            "training_family": "classification",
            "engine": "custom",
            "model_type": req.model_type,
            "epochs": req.epochs,
            "batch_size": req.batch_size,
            "learning_rate": req.learning_rate,
            "status": "queued",
            "message": "queued",
            "model_path": None,
            "created_at": now,
            "updated_at": now,
        }
    )
    background_tasks.add_task(_run_training_job, job_id)
    return {"job_id": job_id, "project_id": project_id, "status": "queued"}


@app.get("/train/{job_id}")
def train_status(job_id: str) -> dict[str, Any]:
    job = fetch_training_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.post("/api/ocr/dataset/create")
def api_ocr_dataset_create(req: OcrDatasetCreateRequest) -> dict[str, Any]:
    resolved = _resolve_project_id(req.project_id)
    try:
        return create_ocr_dataset(
            project_id=resolved,
            image_types=req.image_types,
            charset=req.charset,
            max_text_length=req.max_text_length,
            image_shape=req.image_shape,
            use_augmentation=req.use_augmentation,
            aug_strength=req.aug_strength,
            train_ratio=req.train_ratio,
            val_ratio=req.val_ratio,
            test_ratio=req.test_ratio,
            seed=req.seed,
            output_dir=req.output_dir,
            overwrite=req.overwrite,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/ocr/dataset/from_logs")
def api_ocr_dataset_from_logs(req: OcrDatasetFromLogsRequest) -> dict[str, Any]:
    resolved = _resolve_project_id(req.project_id)
    try:
        return create_ocr_dataset_from_logs(
            project_id=resolved,
            only_invalid=req.only_invalid,
            include_corrected=req.include_corrected,
            max_text_length=req.max_text_length,
            charset=req.charset,
            image_shape=req.image_shape,
            output_dir=req.output_dir,
            overwrite=req.overwrite,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/ocr/train/start")
def api_ocr_train_start(req: OcrTrainStartRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    project_id = _resolve_project_id(req.project_id)
    engine = str(req.engine or "").strip().lower()
    if engine != "paddleocr":
        raise HTTPException(status_code=400, detail="Only paddleocr is trainable. EasyOCR is inference-only.")

    paddle_repo_dir = str(req.paddle_repo_dir or "").strip() or FIXED_PADDLE_OCR_REPO_DIR
    job_id = str(uuid.uuid4())
    now = _now_iso()
    paths = ensure_project_directories(project_id)
    log_path = paths.logs / f"train_ocr_{job_id}.log"
    upsert_training_job(
        {
            "id": job_id,
            "project_id": project_id,
            "training_family": "ocr",
            "engine": "paddleocr",
            "model_type": "ocr",
            "epochs": req.epochs,
            "batch_size": req.batch_size,
            "learning_rate": 0.0,
            "charset": req.charset,
            "max_text_length": req.max_text_length,
            "dataset_dir": req.dataset_dir,
            "paddle_repo_dir": paddle_repo_dir,
            "image_shape": req.image_shape,
            "status": "queued",
            "message": "queued",
            "model_path": None,
            "log_path": str(log_path),
            "created_at": now,
            "updated_at": now,
        }
    )
    background_tasks.add_task(_run_ocr_training_job, job_id)
    return {"job_id": job_id, "project_id": project_id, "status": "queued", "training_family": "ocr", "engine": "paddleocr"}


@app.get("/api/ocr/train/status/{job_id}")
def api_ocr_train_status(job_id: str) -> dict[str, Any]:
    job = fetch_training_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if str(job.get("training_family") or "") != "ocr":
        raise HTTPException(status_code=400, detail="not an OCR training job")
    return job


@app.get("/api/ocr/train/log/{job_id}")
def api_ocr_train_log(job_id: str, tail: int = Query(default=200, ge=1, le=5000)) -> dict[str, Any]:
    job = fetch_training_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if str(job.get("training_family") or "") != "ocr":
        raise HTTPException(status_code=400, detail="not an OCR training job")
    log_path = str(job.get("log_path") or "")
    if not log_path:
        return {"job_id": job_id, "lines": []}
    lines = read_training_log_lines(Path(log_path), tail=int(tail))
    return {"job_id": job_id, "log_path": log_path, "lines": lines}


@app.get("/models")
def models_endpoint(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "items": list_models(project_id=resolved)}


@app.get("/models/info")
def model_infos_endpoint(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "items": list_model_infos(project_id=resolved)}


@app.delete("/models/{model_name}")
def delete_model_endpoint(model_name: str, project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    try:
        deleted = delete_model(project_id=resolved, model_name=model_name)
        return {"project_id": resolved, "deleted": deleted}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/models/latest")
def model_latest(
    model_type: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default="default"),
    training_family: str = Query(default="classification"),
    engine: Optional[str] = Query(default=None),
) -> dict[str, str]:
    resolved = _resolve_project_id(project_id)
    if str(training_family).strip().lower() == "ocr":
        model = latest_ocr_model_meta(project_id=resolved, engine=engine)
        if model is None:
            return {"project_id": resolved, "model": ""}
        return {"project_id": resolved, "model": str(model)}
    model = latest_model(project_id=resolved, model_type=model_type)
    if model is None:
        return {"project_id": resolved, "model": ""}
    return {"project_id": resolved, "model": str(model)}


@app.get("/model-types")
def model_types(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "items": list_model_types(project_id=resolved)}


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    engine: str = Form("custom"),
    model_type: str = Form(""),
    model: str = Form("latest"),
    easyocr_langs: str = Form("en"),
    apply_preprocess: bool = Form(True),
    preprocess_overrides_json: str = Form(""),
    project_id: str = Form("default"),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    suffix = Path(file.filename or "image.png").suffix or ".png"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        langs = _normalize_easyocr_langs(easyocr_langs)
        overrides = _parse_preprocess_overrides_json(preprocess_overrides_json)
        prediction = predict_from_image(
            tmp_path,
            model_type=(model_type or None),
            model=model,
            project_id=resolved,
            engine=engine,
            easyocr_languages=langs,
            apply_preprocess=bool(apply_preprocess),
            preprocess_overrides=overrides,
        )
        save_ocr_prediction_log(
            resolved,
            {
                "image_path": str(file.filename or Path(tmp_path).name),
                "predicted_text": str(prediction.get("prediction") or ""),
                "confidence": prediction.get("confidence"),
                "is_valid": bool(prediction.get("valid", True)),
                "reason": (prediction.get("validation") or {}).get("reason"),
                "model_name": prediction.get("model_name"),
                "engine": prediction.get("engine"),
                "char_scores": prediction.get("char_scores"),
                "used_retry": bool(prediction.get("retry_used", False)),
                "multi_ocr": bool(prediction.get("multi_ocr", False)),
            },
        )
        return prediction
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/api/ocr/log/save")
def api_ocr_log_save(req: OcrLogSaveRequest) -> dict[str, Any]:
    resolved = _resolve_project_id(req.project_id)
    payload: dict[str, Any] = {
        "image_path": req.image_path,
        "predicted_text": req.predicted_text,
        "corrected_text": req.corrected_text,
        "confidence": req.confidence,
        "is_valid": req.is_valid,
        "reason": req.reason,
        "model_name": req.model_name,
        "engine": req.engine,
        "char_scores": req.char_scores,
        "used_retry": req.used_retry,
        "multi_ocr": req.multi_ocr,
    }
    if isinstance(req.extra, dict):
        payload["extra"] = req.extra
    return save_ocr_prediction_log(resolved, payload)


@app.get("/api/ocr/log/state")
def api_ocr_log_state(project_id: str = Query("default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    return read_latest_rapid_ocr_states(resolved)


@app.post("/api/ocr/predict/batch")
async def api_ocr_predict_batch(
    files: list[UploadFile] = File(...),
    engine: str = Form("paddleocr"),
    model_type: str = Form(""),
    model: str = Form("latest"),
    easyocr_langs: str = Form("en"),
    apply_preprocess: bool = Form(True),
    preprocess_overrides_json: str = Form(""),
    project_id: str = Form("default"),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    langs = _normalize_easyocr_langs(easyocr_langs)
    try:
        overrides = _parse_preprocess_overrides_json(preprocess_overrides_json)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not files:
        raise HTTPException(status_code=400, detail="files is required")

    items: list[dict[str, Any]] = []
    for upload in files:
        suffix = Path(upload.filename or "image.png").suffix or ".png"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await upload.read()
            tmp.write(content)
            tmp_path = tmp.name
        try:
            prediction = predict_from_image(
                tmp_path,
                model_type=(model_type or None),
                model=model,
                project_id=resolved,
                engine=engine,
                easyocr_languages=langs,
                apply_preprocess=bool(apply_preprocess),
                preprocess_overrides=overrides,
            )
            record = {
                "file_name": upload.filename or Path(tmp_path).name,
                **prediction,
            }
            items.append(record)
            save_ocr_prediction_log(
                resolved,
                {
                    "image_path": record["file_name"],
                    "predicted_text": str(prediction.get("prediction") or ""),
                    "confidence": prediction.get("confidence"),
                    "is_valid": bool(prediction.get("valid", True)),
                    "reason": (prediction.get("validation") or {}).get("reason"),
                    "model_name": prediction.get("model_name"),
                    "engine": prediction.get("engine"),
                    "char_scores": prediction.get("char_scores"),
                    "used_retry": bool(prediction.get("retry_used", False)),
                    "multi_ocr": bool(prediction.get("multi_ocr", False)),
                },
            )
        except Exception as e:  # noqa: BLE001
            items.append(
                {
                    "file_name": upload.filename or Path(tmp_path).name,
                    "prediction": "",
                    "confidence": 0.0,
                    "valid": False,
                    "error": str(e),
                    "engine": engine,
                }
            )
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    return {
        "project_id": resolved,
        "count": len(items),
        "engine": engine,
        "model": model,
        "items": items,
    }


@app.post("/api/ocr/yolo/predict")
async def api_ocr_yolo_predict(
    file: UploadFile = File(...),
    resize_long_side: int = Form(1280),
    use_resize: bool = Form(True),
    resize_axis: str = Form("long"),
    yolo_model: str = Form(...),
    conf_threshold: float = Form(0.25),
    merge_overlaps: bool = Form(True),
    merge_iou_threshold: float = Form(0.5),
    engine: str = Form("paddleocr"),
    model: str = Form("latest"),
    model_type: str = Form(""),
    easyocr_langs: str = Form("en"),
    project_id: str = Form("default"),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    content = await file.read()
    langs = _normalize_easyocr_langs(easyocr_langs)

    try:
        detection = detect_bboxes_with_yolo(
            image_bytes=content,
            long_side=int(resize_long_side),
            use_resize=bool(use_resize),
            resize_axis=str(resize_axis),
            model_name=yolo_model,
            conf_threshold=float(conf_threshold),
            merge_overlaps=bool(merge_overlaps),
            merge_iou_threshold=float(merge_iou_threshold),
            project_id=resolved,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e

    resized_image = _prepare_yolo_source_image(
        content,
        use_resize=bool(use_resize),
        resize_long_side=int(resize_long_side),
        resize_axis=str(resize_axis),
    )

    results: list[dict[str, Any]] = []
    for row in detection.get("detections", []):
        x1 = int(max(0, round(float(row.get("x1", 0)))))
        y1 = int(max(0, round(float(row.get("y1", 0)))))
        x2 = int(min(resized_image.width, round(float(row.get("x2", 0)))))
        y2 = int(min(resized_image.height, round(float(row.get("y2", 0)))))
        if x2 <= x1 or y2 <= y1:
            continue
        crop = resized_image.crop((x1, y1, x2, y2))

        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmp:
            crop.save(tmp.name, format="PNG")
            tmp_path = tmp.name
        try:
            prediction = predict_from_image(
                tmp_path,
                model_type=(model_type or None),
                model=model,
                project_id=resolved,
                engine=engine,
                easyocr_languages=langs,
            )
            result_item = {
                "bbox": [x1, y1, x2, y2],
                "text": prediction.get("prediction", ""),
                "confidence": float(prediction.get("confidence") or 0.0),
                "valid": bool(prediction.get("valid", True)),
                "validation": prediction.get("validation"),
                "char_scores": prediction.get("char_scores"),
                "engine": prediction.get("engine", engine),
                "model_name": prediction.get("model_name", ""),
            }
            results.append(result_item)
            save_ocr_prediction_log(
                resolved,
                {
                    "image_path": str(file.filename or "upload"),
                    "predicted_text": result_item["text"],
                    "confidence": result_item["confidence"],
                    "is_valid": result_item["valid"],
                    "reason": (result_item.get("validation") or {}).get("reason"),
                    "model_name": result_item.get("model_name"),
                    "engine": result_item.get("engine"),
                    "char_scores": prediction.get("char_scores"),
                    "used_retry": bool(prediction.get("retry_used", False)),
                    "multi_ocr": bool(prediction.get("multi_ocr", False)),
                    "extra": {"bbox": result_item["bbox"]},
                },
            )
        except Exception as e:  # noqa: BLE001
            results.append(
                {
                    "bbox": [x1, y1, x2, y2],
                    "text": "",
                    "confidence": 0.0,
                    "valid": False,
                    "error": str(e),
                }
            )
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    return {
        "project_id": resolved,
        "count": len(results),
        "detections": results,
        "yolo": {
            "model": yolo_model,
            "count": int(detection.get("count") or 0),
            "resolved_model": detection.get("resolved_model", ""),
        },
    }


@app.get("/image-builder/yolo-models")
def image_builder_yolo_models(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    return list_yolo_models(project_id=resolved)


@app.post("/image-builder/resize-preview")
async def image_builder_resize_preview(
    file: UploadFile = File(...),
    resize_long_side: int = Form(...),
    use_resize: bool = Form(True),
    resize_axis: str = Form("long"),
) -> dict[str, Any]:
    suffix = Path(file.filename or "image.png").suffix.lower()
    if suffix not in IMAGE_BUILDER_ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="unsupported image format")
    content = await file.read()
    try:
        return make_resize_preview(content, int(resize_long_side), bool(use_resize), str(resize_axis))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/image-builder/detect")
async def image_builder_detect(
    file: UploadFile = File(...),
    resize_long_side: int = Form(...),
    use_resize: bool = Form(True),
    resize_axis: str = Form("long"),
    model: str = Form(...),
    conf_threshold: float = Form(0.25),
    merge_overlaps: bool = Form(True),
    merge_iou_threshold: float = Form(0.5),
    project_id: str = Form("default"),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    content = await file.read()
    try:
        return detect_bboxes_with_yolo(
            image_bytes=content,
            long_side=int(resize_long_side),
            use_resize=bool(use_resize),
            resize_axis=str(resize_axis),
            model_name=model,
            conf_threshold=float(conf_threshold),
            merge_overlaps=bool(merge_overlaps),
            merge_iou_threshold=float(merge_iou_threshold),
            project_id=resolved,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/image-builder/export")
async def image_builder_export(
    file: UploadFile = File(...),
    resize_long_side: int = Form(...),
    use_resize: bool = Form(True),
    resize_axis: str = Form("long"),
    boxes_json: str = Form(...),
    output_dir: str = Form(...),
    crop_height: int = Form(32),
) -> dict[str, Any]:
    content = await file.read()
    try:
        return export_selected_crops(
            image_bytes=content,
            long_side=int(resize_long_side),
            use_resize=bool(use_resize),
            resize_axis=str(resize_axis),
            boxes_json=boxes_json,
            output_dir=output_dir,
            crop_height=int(crop_height),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/evaluate")
def evaluate(req: EvaluateRequest) -> dict[str, Any]:
    resolved = _resolve_project_id(req.project_id)
    try:
        return evaluate_dataset(
            project_id=resolved,
            dataset_split=req.dataset,
            model=req.model,
            model_type=req.model_type,
            overrides=req.overrides,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/ocr/tuning/export")
def ocr_tuning_export(req: OcrTuningExportRequest) -> dict[str, Any]:
    resolved = _resolve_project_id(req.project_id)
    try:
        return export_ocr_training_data(
            project_id=resolved,
            engine=req.engine,
            output_dir=req.output_dir,
            image_types=req.image_types,
            train_ratio=req.train_ratio,
            val_ratio=req.val_ratio,
            test_ratio=req.test_ratio,
            seed=req.seed,
            overwrite=req.overwrite,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
