import tempfile
import uuid
import os
import signal
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

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
    ImportImagesRequest,
    LabelUpdateRequest,
    PreprocessPreviewRequest,
    PreprocessRequest,
    ProjectCreateRequest,
    RotateImageRequest,
    TrainRequest,
)
from .services.data_manager import import_images_from_directory, list_raw_images, rotate_project_image
from .services.dataset_builder import build_dataset
from .services.dialogs import select_directory_path
from .services.evaluation import evaluate_dataset
from .services.labels import ensure_master_csv, read_labels, upsert_label
from .services.model_registry import latest_model, list_model_types, list_models
from .services.preprocess import preview_preprocess, run_preprocess
from .train import run_training

app = FastAPI(title="OCR Crafter API", version="0.2.0")

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
        )
        preview["prediction"] = prediction.get("prediction", "")
        preview["confidence"] = prediction.get("confidence")
        preview["predict_model_type"] = prediction.get("model_type", selected_model_type)
        preview["predict_model_name"] = prediction.get("model_name", "")
        preview["predict_engine"] = prediction.get("engine", engine)
        if prediction.get("easyocr_languages") is not None:
            preview["predict_easyocr_languages"] = prediction.get("easyocr_languages")
    except Exception as e:  # noqa: BLE001
        preview["prediction"] = ""
        preview["confidence"] = None
        preview["predict_error"] = str(e)
        preview["predict_model_type"] = selected_model_type
        preview["predict_model_name"] = ""
        preview["predict_engine"] = engine
    return preview


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
    return {"items": list_projects()}


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

    try:
        result = run_training(
            project_id=job["project_id"],
            dataset_dir=None,
            model_type=job["model_type"],
            epochs=job["epochs"],
            batch_size=job["batch_size"],
            learning_rate=job.get("learning_rate", 1e-3),
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


@app.post("/train/start")
def train_start(req: TrainRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    project_id = _resolve_project_id(req.project_id)
    job_id = str(uuid.uuid4())
    now = _now_iso()
    upsert_training_job(
        {
            "id": job_id,
            "project_id": project_id,
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


@app.get("/models")
def models_endpoint(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "items": list_models(project_id=resolved)}


@app.get("/models/latest")
def model_latest(model_type: Optional[str] = Query(default=None), project_id: Optional[str] = Query(default="default")) -> dict[str, str]:
    resolved = _resolve_project_id(project_id)
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
    project_id: str = Form("default"),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    suffix = Path(file.filename or "image.png").suffix or ".png"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        langs = [x.strip() for x in (easyocr_langs or "en").split(",") if x.strip()]
        return predict_from_image(
            tmp_path,
            model_type=(model_type or None),
            model=model,
            project_id=resolved,
            engine=engine,
            easyocr_languages=langs,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e
    finally:
        Path(tmp_path).unlink(missing_ok=True)


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
