import logging
import tempfile
import uuid
import os
import sys
import signal
import subprocess
import time
import asyncio
import hashlib
import io
import json
import math
import base64
import re
import shutil
import zipfile
from concurrent.futures import CancelledError, Future, ThreadPoolExecutor
from threading import Lock
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from starlette.background import BackgroundTask

from .config import get_settings
from .db import (
    delete_training_jobs_by_project,
    fetch_active_training_job,
    fetch_training_job,
    init_db,
    upsert_training_job,
)
from .init_dirs import ensure_directories
from .predict import list_paddleocr_official_rec_models, predict_from_image
from .project_paths import (
    delete_project_directory,
    ensure_project_directories,
    list_projects,
    normalize_project_id,
)
from .schemas import (
    AnalyzeMaskRegionRequest,
    AppShutdownRequest,
    DatasetBuildRequest,
    ManualMasksUpdateRequest,
    DirectorySelectRequest,
    EvaluateRequest,
    BackupCreateRequest,
    BackupRestoreRequest,
    BenchmarkConfigRequest,
    BenchmarkCreateRequest,
    FileSelectRequest,
    ImportImagesRequest,
    JobCreateRequest,
    JobRetryRequest,
    LabelUpdateRequest,
    OcrDatasetCreateRequest,
    ReleasePolicyRequest,
    ReportGenerateRequest,
    RetentionConfigRequest,
    OcrDatasetSplitPreviewRequest,
    OcrAugmentationPreviewRequest,
    OcrDatasetFromLogsRequest,
    OcrEvaluateRequest,
    OcrLogSaveRequest,
    OcrTrainStartRequest,
    BuiltinYoloDownloadRequest,
    EvaluationDatasetCreateRequest,
    EvaluationDatasetRenameRequest,
    EvaluationStateSaveRequest,
    ExperimentAnalysisToggleRequest,
    ExperimentEvaluationAttachRequest,
    ExperimentUpdateRequest,
    OcrTuningExportRequest,
    PreprocessPreviewRequest,
    PreprocessRequest,
    ProjectCreateRequest,
    ReleasePromoteRequest,
    ReleaseRollbackRequest,
    ReleaseStatusRequest,
    RotateImageRequest,
    TesseractTrainStartRequest,
    TrainingPreprocessPreviewRequest,
    TrainRequest,
)
from .services.data_manager import import_images_from_directory, list_raw_images, rotate_project_image
from .services.dataset_builder import build_dataset, read_dataset_meta
from .services.dialogs import select_directory_path, select_file_path
from .services.evaluation import evaluate_dataset
from .services.ocr_evaluation import TRAINING_PREPROCESS_MISSING_MESSAGE, evaluate_ocr
from .services.labels import ensure_master_csv, read_labels, upsert_label
from .services.model_registry import (
    delete_model,
    latest_model,
    latest_ocr_model_meta,
    latest_tesseract_model_meta,
    list_model_infos,
    list_model_types,
    list_models,
    resolve_model_training_preprocess,
    resolve_ocr_model_meta,
    resolve_tesseract_model_meta,
)
from .services.ocr_tuning import export_ocr_training_data
from .services.ocr_pipeline import (
    OCR_CHARSET_DEFAULT,
    create_ocr_dataset_from_logs,
    create_ocr_dataset,
    preview_ocr_dataset_split,
    preview_ocr_augmentation,
    migrate_ocr_models_to_inference,
    PADDLE_INFERENCE_MARKERS,
    read_latest_rapid_ocr_states,
    read_training_log_lines,
    register_exported_ocr_model,
    resolve_official_paddleocr_rec_spec,
    run_paddleocr_training,
    save_ocr_prediction_log,
)
from .services.manual_mask import extract_black_region, load_manual_masks, save_manual_masks_for_image
from .services.ocr_preview_cache import (
    get_cached_preview_result,
    make_preview_cache_key,
    set_cached_preview_result,
)
from .services.preprocess import (
    apply_eval_preprocess,
    build_preprocess_config,
    preview_preprocess,
    preview_preprocess_image,
    preprocess_image_for_model,
    run_preprocess,
)
from .services.preprocess_snapshot import apply_training_preprocess
from .services.tesseract_pipeline import (
    TESSERACT_TARGET_CHARSET,
    ensure_tesseract_training_tools,
    run_tesseract_training,
)
from .services.experiment_tracker import (
    attach_evaluation,
    build_comparable_groups,
    build_recommendations,
    ensure_experiments_for_models,
    list_experiments,
    set_analysis_enabled,
    update_experiment,
)
from .services.job_manager import ensure_worker_started, get_job_service, get_job_worker
from .services.release_manager import (
    build_deployment_package,
    build_model_card,
    list_releases,
    promote_model,
    rollback_release,
    set_model_status,
)
from .services.detection_preprocess import parse_detection_preprocess_json
from .services.evaluation_dataset import (
    check_training_overlap,
    create_evaluation_dataset,
    delete_evaluation_dataset,
    list_directory_images,
    list_evaluation_datasets,
    list_export_candidates,
    load_directory_image,
    load_editing_state,
    load_export_crop_image,
    rename_evaluation_dataset,
    save_editing_state,
)
from .services.training_image_builder import (
    BuiltinYoloDownloadInProgressError,
    BuiltinYoloModelNotDownloadedError,
    detect_bboxes_with_yolo,
    download_builtin_yolo_model,
    export_selected_crops,
    get_yolo_model_classes,
    list_yolo_models,
    make_resize_preview,
)
from .train import run_training

from .version import APP_VERSION

app = FastAPI(title="OCR Crafter API", version=APP_VERSION)
DEFAULT_PADDLEOCR_REPO_RELATIVE = "external/PaddleOCR"
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

def _cors_allowed_origins() -> list[str]:
    """許可オリジン。環境変数 CORS_ALLOWED_ORIGINS（カンマ区切り）> settings.yaml cors.allowed_origins > 既定値。"""
    env_value = os.environ.get("CORS_ALLOWED_ORIGINS", "").strip()
    if env_value:
        return [origin.strip() for origin in env_value.split(",") if origin.strip()]
    try:
        configured = get_settings().get("cors", {}).get("allowed_origins")
        if isinstance(configured, list) and configured:
            return [str(origin) for origin in configured]
    except Exception:  # noqa: BLE001
        pass
    return ["http://localhost:5173", "http://127.0.0.1:5173"]


# ---------- 統一エラー形式（docs/22参照。スタックトレース・内部パスは画面へ出さない） ----------

_ERROR_CODE_BY_STATUS = {
    400: "VALIDATION_ERROR",
    401: "AUTH_REQUIRED",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    500: "INTERNAL_ERROR",
}
# メッセージ内容による error_code の特化（HTTPステータスより優先）
_ERROR_CODE_OVERRIDES = [
    ("Release Gate判定がFAIL", "RELEASE_GATE_FAILED"),
    ("整合性", "BACKUP_VALIDATION_FAILED"),
    ("実行中です", "JOB_CONFLICT"),
    ("Release Note", "VALIDATION_ERROR"),
]
_RELATED_ID_PATTERN = re.compile(r"\b(JOB-\d{6}|BM-\d{4}|REL-\d{4}|EXP-\d{4}|AUD-\d{6}|BK-\d{4}|CG-\d{4}|M\d{4})\b")


def _unified_error_body(status_code: int, message: str, details: Optional[dict[str, Any]] = None, error_code: str = "") -> dict[str, Any]:
    """ユーザー向け統一エラー形式（error_code / message / details / related_id）。"""
    code = error_code
    if not code:
        for needle, override in _ERROR_CODE_OVERRIDES:
            if needle in message:
                code = override
                break
    if not code:
        code = _ERROR_CODE_BY_STATUS.get(status_code, "ERROR")
    matched = _RELATED_ID_PATTERN.search(message)
    return {
        "error_code": code,
        "message": message,
        "details": details or {},
        "related_id": matched.group(1) if matched else "",
    }


@app.exception_handler(HTTPException)
async def _http_exception_unified(request: Request, exc: HTTPException) -> JSONResponse:
    """全HTTPExceptionを統一エラー形式へ正規化する（既存のdetail文字列も message へ変換）。"""
    if isinstance(exc.detail, dict) and "error_code" in exc.detail:
        body = exc.detail
    else:
        body = _unified_error_body(exc.status_code, str(exc.detail))
    # 後方互換: detail へ message 文字列も残す（旧クライアント・テストの文字列参照用）
    return JSONResponse(status_code=exc.status_code, content={"detail": body["message"], **body})


# CORSMiddleware より内側で未処理例外を捕捉する。
# これが無いと未処理例外の500はCORSヘッダーなしで返り、ブラウザではCORSエラーとして表示される
@app.middleware("http")
async def _unhandled_exception_as_json(request, call_next):
    try:
        return await call_next(request)
    except Exception as e:  # noqa: BLE001
        logging.getLogger("uvicorn.error").exception("unhandled exception: %s %s", request.method, request.url.path)
        # スタックトレース・内部パスは返さない（詳細はサーバーログのみ）
        body = _unified_error_body(500, f"サーバー内部エラーが発生しました（{type(e).__name__}）。詳細はサーバーログを確認してください。")
        return JSONResponse(status_code=500, content={"detail": body["message"], **body})


app.add_middleware(
    CORSMiddleware,
    # allow_credentials=True と "*" の組み合わせを避け、開発オリジンを明示する
    allow_origins=_cors_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now_iso() -> str:
    return datetime.now().isoformat()


def _os_family() -> str:
    if sys.platform.startswith("darwin"):
        return "macos"
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform.startswith("linux"):
        return "linux"
    return "unknown"


def _resolve_default_paddleocr_repo_dir() -> str:
    env_raw = str(os.getenv("PADDLEOCR_PATH") or "").strip()
    if env_raw:
        return str(Path(env_raw).expanduser().resolve())

    settings = get_settings()
    raw = str(settings.get("ocr_training", {}).get("paddleocr_repo_dir") or "").strip()
    if not raw:
        raw = DEFAULT_PADDLEOCR_REPO_RELATIVE
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    return str(path.resolve())


def _resolve_paddleocr_repo_dir(requested: Optional[str]) -> str:
    raw = str(requested or "").strip()
    if raw:
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = (Path(__file__).resolve().parents[2] / path).resolve()
        else:
            path = path.resolve()
        return str(path)
    return _resolve_default_paddleocr_repo_dir()


def _is_valid_paddleocr_repo_dir(path: Path) -> bool:
    if not path.exists() or not path.is_dir():
        return False
    train_py = path / "tools/train.py"
    export_py = path / "tools/export_model.py"
    return train_py.exists() and train_py.is_file() and export_py.exists() and export_py.is_file()


def _system_check_snapshot() -> dict[str, Any]:
    from .services.ocr_pipeline import detect_paddle_gpu_available, detect_torch_cuda_available, get_gpu_name, get_vram_gb

    settings = get_settings()
    ocr_cfg = settings.get("ocr_training", {}) if isinstance(settings.get("ocr_training"), dict) else {}
    resolved_repo = _resolve_default_paddleocr_repo_dir()
    paddle_repo_path = Path(resolved_repo).expanduser()
    paddle_gpu_available = bool(detect_paddle_gpu_available())
    torch_cuda_available = bool(detect_torch_cuda_available())
    gpu_available = bool(paddle_gpu_available)
    gpu_name = str(get_gpu_name() or "")
    vram_gb = float(get_vram_gb() or 0.0)
    recommended_profile = "RTX Train" if gpu_available else "Mac Safe"
    presets = ocr_cfg.get("presets", {}) if isinstance(ocr_cfg.get("presets"), dict) else {}
    recommended_preset_key = "rtx_train" if gpu_available else "mac_safe"
    recommended_preset = presets.get(recommended_preset_key) if isinstance(presets.get(recommended_preset_key), dict) else {}
    return {
        "os_family": _os_family(),
        "gpu_available": gpu_available,
        "paddle_gpu_available": paddle_gpu_available,
        "torch_cuda_available": torch_cuda_available,
        "gpu_name": gpu_name,
        "vram_gb": round(vram_gb, 2),
        "paddleocr_path": str(paddle_repo_path),
        "paddleocr_path_valid": _is_valid_paddleocr_repo_dir(paddle_repo_path),
        "recommended_profile": recommended_profile,
        "recommended_preset_key": recommended_preset_key,
        "recommended_preset": recommended_preset,
        "default_device": str(ocr_cfg.get("default_device") or "auto"),
        "default_auto_batch_size": bool(ocr_cfg.get("default_auto_batch_size", False)),
        "default_train_num_workers": int(ocr_cfg.get("default_train_num_workers") or 0),
        "default_eval_num_workers": int(ocr_cfg.get("default_eval_num_workers") or 0),
        "default_save_epoch_step": int(ocr_cfg.get("default_save_epoch_step") or 10),
        "default_use_amp": bool(ocr_cfg.get("default_use_amp", False)),
        "default_pin_memory": bool(ocr_cfg.get("default_pin_memory", False)),
        "default_persistent_workers": bool(ocr_cfg.get("default_persistent_workers", False)),
        "presets": presets,
    }


def _resolve_project_id(project_id: Optional[str]) -> str:
    try:
        return normalize_project_id(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _project_image_stage(paths: Any) -> str:
    """実在ファイルに基づく画像段階の判定（processed > interim > raw > none）。"""
    for image_type in ("single", "wide"):
        processed_dir = paths.processed / image_type / "images"
        if processed_dir.is_dir() and any(p.suffix.lower() == ".png" for p in processed_dir.iterdir()):
            return "processed"
    if paths.interim.is_dir() and any(p.suffix.lower() == ".png" for p in paths.interim.iterdir()):
        return "interim"
    return "raw"


def _project_updated_at(paths: Any) -> Optional[str]:
    """主要ファイル・ディレクトリのmtime最大値（軽量な代表値）。"""
    candidates = [
        paths.annotations_csv,
        paths.raw,
        paths.processed,
        paths.models,
        paths.outputs / "ocr_logs" / "predictions.jsonl",
    ]
    latest = 0.0
    for candidate in candidates:
        try:
            if candidate.exists():
                latest = max(latest, candidate.stat().st_mtime)
        except OSError:
            continue
    if latest <= 0:
        return None
    return datetime.fromtimestamp(latest).isoformat()


def _project_dashboard_quality(project_id: str) -> dict[str, Any]:
    """ダッシュボード一覧向けの品質・運用指標（テンプレート/Production/Best CER/Benchmark件数）。

    既存のリリース管理・実験管理・Benchmarkの登録簿を読み取るのみで、推測による補完は行わない
    （評価結果が存在しない項目は None のまま返し、フロント側で「—」表示する）。
    """
    from .services.benchmark import count_benchmarks, get_latest_completed_benchmark

    releases = list_releases(project_id)
    production_model = str(releases.get("production") or "")
    statuses = releases.get("statuses") or {}

    # backfill=Falseで読み取り専用に留める（一覧表示のたびに全プロジェクトへ書き込みが走らないように）
    experiments = list_experiments(project_id, backfill=False)
    model_cer: dict[str, float] = {}
    model_exact_match: dict[str, float] = {}
    for exp in experiments:
        evaluation = exp.get("evaluation") or {}
        cer = evaluation.get("cer")
        if cer is None:
            continue
        accuracy_percent = evaluation.get("accuracy_percent")
        for model in (exp.get("models") or []):
            model_cer[str(model)] = float(cer)
            if accuracy_percent is not None:
                model_exact_match[str(model)] = float(accuracy_percent)
    # 管理No（M0001形式）は既存の list_model_infos（/api/models/info と同じ経路）で解決する
    model_id_of = {str(item.get("name")): str(item.get("model_id") or "") for item in list_model_infos(project_id=project_id)}

    best_cer_value: Optional[float] = None
    best_cer_model = ""
    best_cer_source = ""
    if production_model and production_model in model_cer:
        best_cer_model, best_cer_value, best_cer_source = production_model, model_cer[production_model], "production"
    else:
        candidate_models = [
            m for m, info in statuses.items() if str((info or {}).get("status")) == "Candidate" and m in model_cer
        ]
        if candidate_models:
            best_cer_model = min(candidate_models, key=lambda m: model_cer[m])
            best_cer_value, best_cer_source = model_cer[best_cer_model], "candidate"
        elif model_cer:
            best_cer_model = min(model_cer, key=lambda m: model_cer[m])
            best_cer_value, best_cer_source = model_cer[best_cer_model], "best_model"

    # Exact Match（完全一致率）はBest CERと同一モデル・同一評価の値のみを使う（別モデルの値を混在させない）。
    # 記録が無い場合はNone（フロント側で非表示。推測補完はしない）
    best_exact_match = model_exact_match.get(best_cer_model) if best_cer_model else None

    all_archived = bool(statuses) and not production_model and all(
        str((info or {}).get("status")) == "Archived" for info in statuses.values()
    )

    return {
        "production_model": production_model,
        "production_model_id": model_id_of.get(production_model, "") if production_model else "",
        "best_cer": best_cer_value,
        "best_cer_model": best_cer_model,
        "best_cer_source": best_cer_source,
        "best_exact_match": best_exact_match,
        "benchmark_count": count_benchmarks(project_id),
        "latest_benchmark": get_latest_completed_benchmark(project_id),
        "all_models_archived": all_archived,
        # Health Badge用: Candidate/Production昇格済みモデルが存在するか（既存のリリース状態のみで判定）
        "has_candidate_or_above": bool(production_model) or any(
            str((info or {}).get("status")) in ("Candidate", "Production") for info in statuses.values()
        ),
    }


def _active_job_types_by_project() -> dict[str, str]:
    """全プロジェクトの実行中Job種別（training/evaluation）を1回のjobs.json読み取りで求める。

    一覧描画のたびにプロジェクトごとへ問い合わせない（N+1回避。他のjob_typeは対象外＝新しい状態を追加しない）。
    """
    try:
        jobs = get_job_service().repository.list()
    except Exception:  # noqa: BLE001
        return {}
    result: dict[str, str] = {}
    for job in jobs:
        status = str(job.get("status") or "")
        if status not in ("queued", "running"):
            continue
        job_type = str(job.get("job_type") or "")
        if job_type not in ("training", "evaluation"):
            continue
        pid = str(job.get("project_id") or "")
        if not pid or pid in result:
            continue
        result[pid] = job_type
    return result


def _build_project_summary(project_id: str, active_job_type: str = "") -> dict[str, Any]:
    raw_images = list_raw_images(project_id=project_id)
    image_count = len(raw_images)
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
    paths = ensure_project_directories(project_id)
    quality = _project_dashboard_quality(project_id)
    return {
        "project_id": project_id,
        "images": image_count,
        "labeled": labeled_count,
        "ocr_confirmed": confirmed_count,
        "ocr_pending": pending_count,
        "models": models_count,
        # ダッシュボード表示用の読み取り専用フィールド（実在ファイルに基づく判定）
        "image_stage": _project_image_stage(paths) if image_count > 0 else "none",
        "updated_at": _project_updated_at(paths),
        # 一覧サムネイル用（優先順位2「最初の画像」）。image_count算出と同じ一覧を再利用しファイル名のみ渡す
        "sample_image": raw_images[0] if raw_images else "",
        # v1.0.0 ダッシュボード一覧UX改善: 品質・運用指標（推測禁止・既存登録簿のみ参照）
        **quality,
        "active_job_type": active_job_type,
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


def _image_to_data_url(image: Image.Image, max_side: int = 256) -> str:
    buf = io.BytesIO()
    preview = image.copy()
    if max_side > 0:
        preview.thumbnail((max_side, max_side), Image.LANCZOS)
    preview.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _referenced_ocr_dataset_roots(project_id: str) -> set[Path]:
    paths = ensure_project_directories(project_id)
    roots: set[Path] = set()
    for meta_path in paths.models.glob("*.ocr.json"):
        if not meta_path.is_file():
            continue
        try:
            payload = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        root_raw = str(payload.get("dataset_root") or "").strip()
        if not root_raw:
            continue
        try:
            roots.add(Path(root_raw).expanduser().resolve())
        except Exception:  # noqa: BLE001
            continue
    return roots


def _cleanup_failed_ocr_dataset(project_id: str, dataset_dir: str) -> bool:
    raw = str(dataset_dir or "").strip()
    if not raw:
        return False
    try:
        dataset_path = Path(raw).expanduser().resolve()
    except Exception:  # noqa: BLE001
        return False
    if not dataset_path.exists() or not dataset_path.is_dir():
        return False

    paths = ensure_project_directories(project_id)
    allowed_roots = {
        (paths.outputs / "ocr_dataset").resolve(),
        (paths.outputs / "ocr_dataset_from_logs").resolve(),
    }
    # プロジェクト管理下の自動生成データのみ削除対象にする
    if not any(root == dataset_path or root in dataset_path.parents for root in allowed_roots):
        return False

    # 既存モデルが参照しているデータは削除しない
    if dataset_path in _referenced_ocr_dataset_roots(project_id):
        return False

    shutil.rmtree(dataset_path, ignore_errors=True)
    return True


def _is_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        if not sys.platform.startswith("win"):
            return False
        try:
            import ctypes

            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(  # type: ignore[attr-defined]
                PROCESS_QUERY_LIMITED_INFORMATION,
                False,
                int(pid),
            )
            if not handle:
                return False
            ctypes.windll.kernel32.CloseHandle(handle)  # type: ignore[attr-defined]
            return True
        except Exception:
            return False
    return True


def _ocr_run_dir_for_job(job_id: str, project_id: str) -> Path:
    paths = ensure_project_directories(project_id)
    return paths.models / "ocr_runs" / job_id


def _is_paddle_inference_dir(path: Path) -> bool:
    if not path.exists() or not path.is_dir():
        return False
    if not (path / "inference.yml").exists():
        return False
    if not (path / "inference.pdiparams").exists():
        return False
    return (path / "inference.pdmodel").exists() or (path / "inference.json").exists()


def _find_ocr_meta_by_job_id(project_id: str, job_id: str) -> Optional[Path]:
    paths = ensure_project_directories(project_id)
    for meta_path in paths.models.glob("*.ocr.json"):
        if not meta_path.is_file():
            continue
        try:
            payload = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if str(payload.get("job_id") or "").strip() == job_id:
            return meta_path
    return None


def _recover_exported_ocr_runs(project_id: str) -> int:
    paths = ensure_project_directories(project_id)
    ocr_runs_root = paths.models / "ocr_runs"
    if not ocr_runs_root.exists() or not ocr_runs_root.is_dir():
        return 0

    recovered = 0
    for run_dir in sorted(ocr_runs_root.iterdir()):
        if not run_dir.is_dir():
            continue
        inference_dir = run_dir / "inference"
        if not _is_paddle_inference_dir(inference_dir):
            continue

        job_id = run_dir.name
        job = fetch_training_job(job_id)
        if not job or str(job.get("training_family") or "") != "ocr":
            continue

        meta_path = _find_ocr_meta_by_job_id(project_id, job_id)
        try:
            if meta_path is None:
                register_exported_ocr_model(
                    project_id=project_id,
                    engine="paddleocr",
                    checkpoint_dir=run_dir,
                    inference_dir=inference_dir,
                    charset=str(job.get("charset") or OCR_CHARSET_DEFAULT),
                    max_text_length=int(job.get("max_text_length") or 8),
                    image_shape=[int(x) for x in (job.get("image_shape") or [3, 48, 320])],
                    dataset_root=Path(str(job.get("dataset_dir") or "")).expanduser(),
                    job_id=job_id,
                    epochs=int(job.get("epochs") or 0),
                    batch_size=int(job.get("batch_size") or 0),
                    learning_rate=float(job.get("learning_rate") or 0.0),
                    training_mode=str(job.get("training_mode") or "scratch"),
                    init_source_type=str(job.get("init_source_type") or "scratch"),
                    init_source_value=str(job.get("init_source_value") or ""),
                    device=str(job.get("device") or "auto"),
                    resolved_device=str(job.get("resolved_device") or "cpu"),
                    train_num_workers=int(job.get("train_num_workers") or 0),
                    eval_num_workers=int(job.get("eval_num_workers") or 0),
                    save_epoch_step=int(job.get("save_epoch_step") or 10),
                    auto_batch_size_enabled=bool(job.get("auto_batch_size", False)),
                    use_amp=bool(job.get("use_amp", False)),
                    pin_memory=bool(job.get("pin_memory", False)),
                    persistent_workers=bool(job.get("persistent_workers", False)),
                    vram_gb=float(job.get("vram_gb") or 0.0),
                    effective_train_batch=int(job.get("effective_train_batch") or 0),
                    effective_eval_batch=int(job.get("effective_eval_batch") or 0),
                    oom_retry_count=int(job.get("oom_retry_count") or 0),
                )
            upsert_training_job(
                {
                    **job,
                    "status": "completed",
                    "message": "ocr training completed",
                    "model_path": str(inference_dir.resolve()),
                    "updated_at": _now_iso(),
                }
            )
            recovered += 1
        except Exception:  # noqa: BLE001
            continue
    return recovered


def _reconcile_ocr_training_job(job_id: str) -> Optional[dict[str, Any]]:
    job = fetch_training_job(job_id)
    if not job or str(job.get("training_family") or "") != "ocr":
        return job

    # Tesseract ジョブは PaddleOCR の inference 復旧ロジックの対象外
    if str(job.get("engine") or "").strip().lower() == "tesseract":
        return job

    project_id = str(job.get("project_id") or "default")
    _recover_exported_ocr_runs(project_id)
    current = fetch_training_job(job_id) or job

    run_dir = _ocr_run_dir_for_job(job_id, project_id)
    inference_dir = run_dir / "inference"
    if _is_paddle_inference_dir(inference_dir):
        upsert_training_job(
            {
                **current,
                "status": "completed",
                "message": "ocr training completed",
                "model_path": str(inference_dir.resolve()),
                "updated_at": _now_iso(),
            }
        )
        return fetch_training_job(job_id)

    if str(current.get("status") or "") not in {"queued", "running"}:
        return current

    worker_pid = int(current.get("worker_pid") or 0)
    if worker_pid and _is_pid_alive(worker_pid):
        return current

    latest_checkpoint = run_dir / "latest.pdparams"
    if latest_checkpoint.exists():
        upsert_training_job(
            {
                **current,
                "status": "failed",
                "message": "ocr training process ended before export/registration completed",
                "updated_at": _now_iso(),
            }
        )
        return fetch_training_job(job_id)
    return current


def _spawn_training_runner(job_type: str, job_id: str) -> int:
    repo_root = Path(__file__).resolve().parents[2]
    process = subprocess.Popen(
        [sys.executable, "-m", "src.app.job_runner", job_type, job_id],
        cwd=str(repo_root),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    return int(process.pid)


def _reject_if_training_active(project_id: str, training_family: str) -> None:
    """同一プロジェクト・同一系統でアクティブなジョブがある場合は409で開始要求を拒否する。

    フロントのボタン無効化だけに依存せず、連打・複数タブ・画面再読込でも
    二重起動しないためのバックエンド側ガード。
    """
    active = fetch_active_training_job(project_id, training_family)
    if active:
        label = "OCR学習" if training_family == "ocr" else "学習"
        raise HTTPException(
            status_code=409,
            detail=f"このプロジェクトでは{label}ジョブがすでに実行中です。(job: {active.get('id')})",
        )


def _delete_training_artifacts(job: dict[str, Any]) -> dict[str, Any]:
    project_id = str(job.get("project_id") or "default")
    training_family = str(job.get("training_family") or "classification")
    paths = ensure_project_directories(project_id)
    removed: dict[str, Any] = {
        "run_dir_removed": False,
        "model_removed": False,
        "log_removed": False,
    }

    if training_family == "ocr":
        job_id_str = str(job.get("id") or "").strip()
        # 空idだと Path結合で ocr_runs ルート自体を指してしまうため必ず除外する
        if job_id_str:
            run_dir = paths.models / "ocr_runs" / job_id_str
            if run_dir.exists() and run_dir.is_dir() and not run_dir.is_symlink():
                shutil.rmtree(run_dir)
                removed["run_dir_removed"] = True

    model_path_raw = str(job.get("model_path") or "").strip()
    if model_path_raw:
        try:
            model_path = Path(model_path_raw)
            resolved_model_path = model_path.resolve()
            if resolved_model_path.exists() and resolved_model_path.is_file():
                resolved_model_path.relative_to(paths.models.resolve())
                resolved_model_path.unlink()
                removed["model_removed"] = True
        except Exception:
            pass

    log_path_raw = str(job.get("log_path") or "").strip()
    if log_path_raw:
        try:
            log_path = Path(log_path_raw)
            resolved_log_path = log_path.resolve()
            if resolved_log_path.exists() and resolved_log_path.is_file():
                resolved_log_path.relative_to(paths.logs.resolve())
                resolved_log_path.unlink()
                removed["log_removed"] = True
        except Exception:
            pass

    return removed


def _stop_training_worker(
    job_id: str,
    expected_family: Optional[str] = None,
    delete_artifacts: bool = False,
) -> dict[str, Any]:
    job = fetch_training_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    training_family = str(job.get("training_family") or "classification")
    if expected_family and training_family != expected_family:
        raise HTTPException(status_code=400, detail=f"not a {expected_family} training job")

    status = str(job.get("status") or "")
    if status not in {"queued", "running"}:
        raise HTTPException(status_code=400, detail=f"job is not stoppable: {status or 'unknown'}")

    worker_pid = int(job.get("worker_pid") or 0)
    if worker_pid <= 0:
        raise HTTPException(status_code=409, detail="worker pid is missing")

    stopped = False
    try:
        os.killpg(worker_pid, signal.SIGTERM)
        stopped = True
    except ProcessLookupError:
        stopped = False
    except Exception:
        try:
            os.kill(worker_pid, signal.SIGTERM)
            stopped = True
        except ProcessLookupError:
            stopped = False

    current = fetch_training_job(job_id) or job
    removed = {"run_dir_removed": False, "model_removed": False, "log_removed": False}
    message = "training stopped by user"
    next_model_path = current.get("model_path")
    next_log_path = current.get("log_path")
    if delete_artifacts:
        removed = _delete_training_artifacts(current)
        message = "training stopped by user and artifacts deleted"
        next_model_path = None
        next_log_path = None
    upsert_training_job(
        {
            **current,
            "status": "stopped",
            "message": message,
            "model_path": next_model_path,
            "worker_pid": None,
            "log_path": next_log_path,
            "updated_at": _now_iso(),
        }
    )
    return {
        "job_id": job_id,
        "project_id": str(current.get("project_id") or "default"),
        "training_family": training_family,
        "status": "stopped",
        "stopped": stopped,
        "artifacts_deleted": bool(delete_artifacts),
        "removed": removed,
    }


def _attach_preview_prediction(
    preview: dict[str, Any],
    project_id: str,
    engine: str = "custom",
    model: str = "latest",
    model_type: Optional[str] = None,
    easyocr_langs: str = "en",
    include_lowercase: bool = True,
    tesseract_psm: Optional[int] = None,
    whitelist: Optional[str] = None,
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
            include_lowercase=bool(include_lowercase),
            tesseract_psm=tesseract_psm,
            whitelist=whitelist,
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
        if prediction.get("include_lowercase") is not None:
            preview["predict_include_lowercase"] = bool(prediction.get("include_lowercase"))
            preview["predict_lowercase_control_applied"] = bool(prediction.get("lowercase_control_applied"))
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
    # 再起動復旧: 前回プロセスでrunningのまま残ったJobをinterruptedへ回収し、
    # queuedのJobを再開するためWorkerを起動する（docs/18_JOB_MANAGEMENT.md）
    if os.environ.get("OCRC_DISABLE_WORKER_AUTOSTART"):
        return  # テスト実行時（conftest）に実データへのWorker起動・復旧を行わない
    try:
        from .services.job_manager import recover_interrupted_jobs

        recovered = recover_interrupted_jobs()
        if recovered:
            logging.getLogger(__name__).warning("再起動復旧: %d件のJobをinterruptedへ移行しました: %s", len(recovered), recovered)
        ensure_worker_started()
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("Job再起動復旧に失敗しました")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def health_ready() -> dict[str, Any]:
    """受付可否（データDir書き込み・設定ファイル）。"""
    from .services.operations import check_ready

    return check_ready()


@app.get("/health/details")
def health_details() -> dict[str, Any]:
    """管理者向けの詳細ヘルスチェック（Backend/データDir/Tesseract/PaddleOCR/GPU/JobWorker/ディスク/設定/モデルDir）。"""
    from .services.operations import build_health_details

    return build_health_details()


# ---------- 監査ログ・ユーザー識別（docs/22_SECURITY_AND_AUDIT.md） ----------


def _user_ctx(request: Request):
    from .services.audit_log import resolve_user_context

    return resolve_user_context(request.headers)


def _enforce_role(request: Request, action: str):
    """操作に必要なロールの検証。

    - 認証未設定モード（既定）: X-Role明示時のみロール階層を強制（Admin互換）
    - 本番モード（allow_unauthenticated_admin=false）: X-Operatorなし=401 /
      不正Role・ロール不足=403
    """
    from .services.audit_log import AuthenticationError, require_role

    ctx = _user_ctx(request)
    try:
        require_role(ctx, action)
    except AuthenticationError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    return ctx


def _record_audit_safe(request: Request, action: str, **kwargs: Any) -> None:
    """監査記録（記録の失敗で本処理を失敗させない）。"""
    from .services.audit_log import record_audit

    try:
        record_audit(
            action,
            user=_user_ctx(request),
            client={
                "ip": request.client.host if request.client else "",
                "user_agent": str(request.headers.get("user-agent") or "")[:200],
            },
            **kwargs,
        )
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("監査ログの記録に失敗しました: %s", action)


@app.get("/api/auth/context")
def api_auth_context(request: Request) -> dict[str, Any]:
    """現在のユーザー識別（X-Operator / X-Role）。認証未設定環境はAdmin互換＋その旨を返す。"""
    return _user_ctx(request).to_dict()


@app.get("/api/audit")
def api_audit(
    project_id: str = Query(default=""),
    action: str = Query(default=""),
    user: str = Query(default=""),
    target_id: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to: str = Query(default=""),
    limit: int = Query(default=200, ge=1, le=1000),
) -> dict[str, Any]:
    """監査ログ一覧（新しい順・フィルタ）。追記型のため削除・編集APIは提供しない。"""
    from .services.audit_log import AUDIT_ACTIONS, read_audit

    return {
        "items": read_audit(
            project_id=project_id, action=action, user=user, target_id=target_id,
            date_from=date_from, date_to=date_to, limit=limit,
        ),
        "actions": AUDIT_ACTIONS,
    }


@app.get("/api/operations/dashboard")
def api_operations_dashboard(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """運用ダッシュボード（Job状況・Production＋Gate・未評価Candidate・Benchmark・データ使用量・バックアップ）。"""
    from .services.operations import build_dashboard

    return build_dashboard(_resolve_project_id(project_id))


# ---------- モデル開発レポート（docs/16参照。生成はJob Management経由） ----------


@app.post("/api/reports/generate")
def api_report_generate(req: ReportGenerateRequest, request: Request) -> dict[str, Any]:
    """レポート生成Jobの作成（job_type=report_generate。進捗はジョブ管理で監視）。"""
    ctx = _enforce_role(request, "report_generate")
    resolved = _resolve_project_id(req.project_id)
    try:
        from .services.report_generator import REPORT_TYPES

        if req.report_type not in REPORT_TYPES:
            raise ValueError(f"report_type は {REPORT_TYPES} のいずれかを指定してください")
        if req.report_type == "single_model" and len(req.model_ids) != 1:
            raise ValueError("単一モデルレポートは対象モデルを1件指定してください")
        if req.report_type == "comparison" and len(req.model_ids) < 2:
            raise ValueError("モデル比較レポートは比較モデルを2件以上指定してください")
        job, deduplicated = get_job_service().create_job(
            project_id=resolved,
            job_type="report_generate",
            params={
                "project_id": resolved,
                "report_type": req.report_type,
                "model_ids": req.model_ids,
                "formats": req.formats,
                "include_images": bool(req.include_images),
                "experiments_limit": req.experiments_limit,
                "template_info": req.template_info,
                "project_description": req.project_description,
                "purpose": req.purpose,
                "created_by": req.created_by or ctx.operator,
            },
            requested_by=req.created_by or ctx.operator,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    ensure_worker_started()
    _record_audit_safe(
        request, "report_generate", project_id=resolved, target_type="report_job", target_id=job["job_id"],
        job_id=job["job_id"],
        after={"report_type": req.report_type, "model_ids": req.model_ids, "formats": req.formats},
    )
    return {"project_id": resolved, "job": job, "deduplicated": deduplicated}


@app.get("/api/reports")
def api_reports(project_id: str = Query(default="")) -> dict[str, Any]:
    """レポート一覧（新しい順・メタデータのみ）。"""
    from .services.report_generator import list_reports

    return {"items": list_reports(project_id)}


@app.get("/api/reports/{report_id}")
def api_report_detail(report_id: str) -> dict[str, Any]:
    from .services.report_generator import get_report

    try:
        return {"item": get_report(report_id)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.delete("/api/reports/{report_id}")
def api_report_delete(report_id: str, request: Request) -> dict[str, Any]:
    """レポート削除（メタデータ+出力ファイル。監査記録あり）。"""
    from .services.report_generator import delete_report

    _enforce_role(request, "report_delete")
    try:
        entry = delete_report(report_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    _record_audit_safe(
        request, "report_delete", project_id=str(entry.get("projectId") or ""), target_type="report", target_id=report_id,
        before={"files": entry.get("files")},
    )
    return {"deleted": report_id}


@app.get("/api/reports/{report_id}/download")
def api_report_download(report_id: str, format: str = Query(default="markdown")) -> Response:
    """レポートのダウンロード（markdown / pdf。reports配下限定・トラバーサル防止）。"""
    from .services.report_generator import report_file_path

    try:
        path = report_file_path(report_id, format)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    media = "application/pdf" if format == "pdf" else "text/markdown; charset=utf-8"
    from urllib.parse import quote

    return Response(
        content=path.read_bytes(),
        media_type=media,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(path.name)}"},
    )


# ---------- バックアップ・データ保持（docs/21_OPERATIONS_GUIDE.md） ----------


@app.get("/api/backups")
def api_backups(project_id: str = Query(default="")) -> dict[str, Any]:
    """バックアップ一覧（新しい順。project_id指定で絞り込み）。"""
    from .services.backup_manager import list_backups

    return {"items": list_backups(project_id)}


@app.post("/api/backups")
def api_backup_create(req: BackupCreateRequest, request: Request) -> dict[str, Any]:
    """バックアップ作成（metadata_only / full）。data/backups/ へZIP保存。"""
    from .services.backup_manager import create_backup

    resolved = _resolve_project_id(req.project_id)
    try:
        item = create_backup(resolved, mode=req.mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "backup_create", project_id=resolved, target_type="backup", target_id=item["backup_id"],
        after={"mode": item.get("mode"), "file": item.get("file"), "size_bytes": item.get("size_bytes")},
    )
    return {"project_id": resolved, "item": item}


@app.get("/api/backups/{backup_id}/verify")
def api_backup_verify(backup_id: str) -> dict[str, Any]:
    """バックアップの整合性検証（manifestの全ファイルのSHA-256照合。復元せず検証のみ）。"""
    from .services.backup_manager import verify_backup

    try:
        result = verify_backup(backup_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    manifest = result.get("manifest") or {}
    return {
        "backup_id": backup_id,
        "valid": result["valid"],
        "mismatches": result["mismatches"],
        "manifest_summary": {
            "app_version": manifest.get("app_version"),
            "schema_version": manifest.get("schema_version"),
            "file_count": manifest.get("file_count"),
            "total_size_bytes": manifest.get("total_size_bytes"),
            "required_components": manifest.get("required_components"),
            "optional_components": manifest.get("optional_components"),
        },
    }


@app.post("/api/backups/{backup_id}/restore")
def api_backup_restore(backup_id: str, req: BackupRestoreRequest, request: Request) -> dict[str, Any]:
    """バックアップの復元。**既定で新しいProject IDへ復元**（既存プロジェクトは上書きしない）。"""
    from .services.backup_manager import restore_backup

    _enforce_role(request, "backup_restore")
    try:
        result = restore_backup(backup_id, new_project_id=req.new_project_id)
    except FileNotFoundError as e:
        _record_audit_safe(
            request, "restore_failed", target_type="backup", target_id=backup_id, reason=str(e)[:500],
        )
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        # 復元失敗（整合性エラー・復元先衝突等）も監査記録する
        _record_audit_safe(
            request, "restore_failed", target_type="backup", target_id=backup_id, reason=str(e)[:500],
        )
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "backup_restore", project_id=result["project_id"], target_type="backup", target_id=backup_id,
        before={"source_project_id": result.get("source_project_id")},
        after={"restored_project_id": result["project_id"], "mode": result.get("mode")},
    )
    return result


@app.get("/api/retention")
def api_retention_get() -> dict[str, Any]:
    """データ保持設定（未設定=無期限保持=従来動作）。"""
    from .services.backup_manager import get_retention

    return {"config": get_retention()}


@app.put("/api/retention")
def api_retention_put(req: RetentionConfigRequest) -> dict[str, Any]:
    from .services.backup_manager import set_retention

    try:
        return {"config": set_retention(req.model_dump())}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/retention/apply")
def api_retention_apply(request: Request) -> dict[str, Any]:
    """保持期間を過ぎたJob・監査ログの削除を適用する（削除は監査ログ retention_cleanup へ記録）。"""
    from .services.backup_manager import apply_retention

    _enforce_role(request, "retention_cleanup")
    return apply_retention(
        user=_user_ctx(request),
        client={
            "ip": request.client.host if request.client else "",
            "user_agent": str(request.headers.get("user-agent") or "")[:200],
        },
    )


@app.get("/api/system/check")
def system_check() -> dict[str, Any]:
    return _system_check_snapshot()


@app.post("/system/shutdown")
def shutdown_app(req: AppShutdownRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if req.frontend_port is not None and not (1 <= req.frontend_port <= 65535):
        raise HTTPException(status_code=400, detail="frontend_port must be between 1 and 65535")
    background_tasks.add_task(_shutdown_app, req.frontend_port)
    return {"status": "shutting_down"}


@app.get("/projects")
def projects() -> dict[str, Any]:
    items = list_projects()
    # 実行中Job種別は全プロジェクト分を1回のjobs.json読み取りで求め、各サマリーへ配る（N+1回避）
    active_job_types = _active_job_types_by_project()
    summaries = [_build_project_summary(project_id, active_job_types.get(project_id, "")) for project_id in items]
    return {"items": items, "summaries": summaries}


@app.post("/projects")
def create_project(req: ProjectCreateRequest, request: Request) -> dict[str, str]:
    _enforce_role(request, "project_create")
    project_id = _resolve_project_id(req.project_id)
    ensure_project_directories(project_id)
    ensure_master_csv(project_id)
    _record_audit_safe(request, "project_create", project_id=project_id, target_type="project", target_id=project_id)
    return {"project_id": project_id}


@app.delete("/projects/{project_id}")
def delete_project(project_id: str, request: Request) -> dict[str, Any]:
    _enforce_role(request, "project_delete")
    resolved = _resolve_project_id(project_id)
    try:
        deleted_project = delete_project_directory(resolved)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    deleted_jobs = delete_training_jobs_by_project(resolved)
    _record_audit_safe(
        request, "project_delete", project_id=resolved, target_type="project", target_id=resolved,
        after={"deleted_jobs": deleted_jobs},
    )
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
        path = select_file_path(req.initial_dir, extensions=req.extensions or ["pt"])
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"failed to open file dialog: {e}") from e
    return {"path": path}


@app.get("/images")
def list_images(
    project_id: Optional[str] = Query(default="default"),
    offset: Optional[int] = Query(default=None, ge=0),
    limit: Optional[int] = Query(default=None, ge=1, le=1000),
    search: Optional[str] = Query(default=None),
    unlabeled_only: bool = Query(default=False),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    images = list_raw_images(project_id=resolved)
    rows = read_labels(project_id=resolved)
    label_map = {row.get("filename") or row.get("image"): row.get("label", "") for row in rows}
    type_map = {row.get("filename") or row.get("image"): row.get("type", "") for row in rows}
    items = [{"image": name, "label": label_map.get(name, ""), "type": type_map.get(name, "")} for name in images]

    keyword = str(search or "").strip().lower()
    if keyword:
        items = [item for item in items if keyword in item["image"].lower() or keyword in str(item["label"]).lower()]
    if unlabeled_only:
        items = [item for item in items if not str(item["label"]).strip()]

    total = len(items)
    # offset/limit 未指定時は従来どおり全件返却（既存クライアント互換）
    if offset is not None or limit is not None:
        start = int(offset or 0)
        size = int(limit or 100)
        page_items = items[start : start + size]
        return {
            "project_id": resolved,
            "count": len(page_items),
            "items": page_items,
            "total": total,
            "offset": start,
            "limit": size,
            "has_more": start + size < total,
        }
    return {
        "project_id": resolved,
        "count": total,
        "items": items,
        "total": total,
        "offset": 0,
        "limit": total,
        "has_more": False,
    }


@app.get("/images/{image_name}/thumbnail")
def image_thumbnail(
    image_name: str,
    project_id: Optional[str] = Query(default="default"),
    width: int = Query(default=240, ge=16, le=640),
    height: int = Query(default=96, ge=16, le=640),
) -> FileResponse:
    """一覧表示用の軽量サムネイル。元画像のmtimeをキャッシュキーにディスクへ保存し、
    回転などで元画像が更新された場合のみ再生成する（原画像の直接配信を避ける）。"""
    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise HTTPException(status_code=400, detail="invalid image name")
    resolved = _resolve_project_id(project_id)
    paths = ensure_project_directories(resolved)
    source = paths.raw / safe_name
    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail="image not found")

    stem = Path(safe_name).stem
    mtime_key = int(source.stat().st_mtime)
    cache_dir = paths.outputs / "thumbnails"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{stem}_{width}x{height}_{mtime_key}.jpg"

    if not cache_file.exists():
        # 同一画像の古いキャッシュを掃除してから生成
        for stale in cache_dir.glob(f"{stem}_{width}x{height}_*.jpg"):
            try:
                stale.unlink()
            except OSError:
                pass
        with Image.open(source) as opened:
            thumb = opened.convert("RGB")
            thumb.thumbnail((width, height), Image.Resampling.LANCZOS)
            thumb.save(cache_file, format="JPEG", quality=85)

    # no-cache: キャッシュは保持しつつ毎回 ETag/Last-Modified で再検証させる（変更なしなら304）。
    # 回転で画像が更新された後、リロード（URLの v= が初期値へ戻る）でも古い向きの
    # キャッシュがそのまま表示される問題を防ぐ
    return FileResponse(
        cache_file,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/images/manual-masks")
def get_manual_masks(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """プロジェクト内の全画像分の手動マスク定義（画像単位）を返す。"""
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "items": load_manual_masks(resolved)}


@app.put("/images/{image_name}/manual-masks")
def put_manual_masks(image_name: str, req: ManualMasksUpdateRequest) -> dict[str, Any]:
    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise HTTPException(status_code=400, detail="invalid image name")
    resolved = _resolve_project_id(req.project_id)
    try:
        save_manual_masks_for_image(resolved, safe_name, req.manual_masks)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"project_id": resolved, "image": safe_name, "count": len(req.manual_masks)}


@app.post("/images/{image_name}/analyze-mask-region")
def analyze_mask_region(image_name: str, req: AnalyzeMaskRegionRequest) -> dict[str, Any]:
    """クリック点（正規化座標）が属する黒連結領域を元画像グレースケール上で抽出する。"""
    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise HTTPException(status_code=400, detail="invalid image name")
    resolved = _resolve_project_id(req.project_id)
    paths = ensure_project_directories(resolved)
    source = paths.raw / safe_name
    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail="image not found")
    import numpy as _np

    with Image.open(source) as opened:
        gray = _np.asarray(opened.convert("L"))
    result = extract_black_region(gray, float(req.x), float(req.y), int(req.threshold))
    return {"project_id": resolved, "image": safe_name, **result}


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

    # 回転等でファイルが更新されても古いキャッシュが表示されないよう毎回再検証させる
    return FileResponse(path, headers={"Cache-Control": "no-cache"})


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
            return FileResponse(candidate, headers={"Cache-Control": "no-cache"})

    try:
        preview = preview_preprocess(image_name=safe_name, project_id=resolved)
        processed_rel = preview.get("processed_preview")
        if processed_rel:
            processed_path = paths.root / str(processed_rel)
            if processed_path.exists() and processed_path.is_file():
                return FileResponse(processed_path, headers={"Cache-Control": "no-cache"})
    except Exception:  # noqa: BLE001
        pass

    raise HTTPException(status_code=404, detail="processed image not found")


@app.get("/images/{image_name}/interim")
def image_interim_file(
    image_name: str,
    project_id: Optional[str] = Query(default="default"),
) -> FileResponse:
    """中間画像（前処理途中の保存済みファイル）を配信する。実在しない場合は404（生成はしない）。"""
    safe_name = Path(image_name).name
    if safe_name != image_name:
        raise HTTPException(status_code=400, detail="invalid image name")
    resolved = _resolve_project_id(project_id)
    paths = ensure_project_directories(resolved)
    candidate = paths.interim / f"{Path(safe_name).stem}.png"
    if candidate.exists() and candidate.is_file():
        return FileResponse(candidate, headers={"Cache-Control": "no-cache"})
    raise HTTPException(status_code=404, detail="interim image not found")


@app.post("/preprocess/run")
def preprocess(req: PreprocessRequest, request: Request) -> dict[str, Any]:
    _enforce_role(request, "preprocess_run")
    project_id = _resolve_project_id(req.project_id)
    result = run_preprocess(project_id=project_id, overrides=req.overrides)
    _record_audit_safe(
        request, "preprocess_run", project_id=project_id, target_type="preprocess",
        target_id=str(result.get("preprocess_snapshot_id") or ""),
        after={"processed_count": result.get("processed_count"), "preprocess_hash": result.get("preprocess_hash")},
    )
    return result


@app.get("/preprocess/preview")
def preprocess_preview_get(
    image: str = Query(..., description="raw image filename"),
    project_id: Optional[str] = Query(default="default"),
    engine: str = Query(default="custom"),
    model: str = Query(default="latest"),
    model_type: Optional[str] = Query(default=None),
    easyocr_langs: str = Query(default="en"),
    include_lowercase: bool = Query(default=True),
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
            include_lowercase=include_lowercase,
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
            include_lowercase=req.include_lowercase,
            tesseract_psm=req.psm,
            whitelist=req.whitelist,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _parse_preview_json_object(text: str, name: str) -> Optional[dict[str, Any]]:
    """preview-file系のJSON Formパラメータ（object想定）を検証付きでparseする。空=None。"""
    raw = str(text or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError) as e:
        raise ValueError(f"invalid {name}: {e}") from e
    if not isinstance(parsed, dict):
        raise ValueError(f"{name} must be an object")
    return parsed


def _load_preview_source_image(
    resolved: str,
    upload_bytes: Optional[bytes],
    upload_name: str,
    export_id: str,
    source_directory: str,
    filename: str,
    rotation: int,
) -> tuple[Image.Image, str]:
    """preview-file系の入力画像解決（アップロード / Step4評価候補 / フォルダ画像）。

    評価候補はマニフェスト記載ファイルのみ・フォルダ画像はフォルダ直下のみ解決（トラバーサル拒否）。
    回転（フォルダ画像はEXIF反映も）はここで適用済みの画像を返す。
    """
    if upload_bytes is not None:
        try:
            with Image.open(io.BytesIO(upload_bytes)) as opened:
                img = opened.convert("RGB")
        except Exception as e:  # noqa: BLE001
            raise ValueError("unsupported or unreadable image format") from e
        return img, f"upload_{Path(str(upload_name or 'image')).stem}"
    if str(export_id or "").strip() and str(filename or "").strip():
        # Step5評価候補: 現在のユーザー回転を適用した状態でOCRへ入力する（回転前の画像を渡さない）
        img = load_export_crop_image(resolved, export_id, filename, rotation=int(rotation))
        return img, f"eval_{export_id}_{Path(filename).stem}_r{int(rotation)}"
    if str(source_directory or "").strip() and str(filename or "").strip():
        # Step5フォルダ取得モード: EXIF反映＋ユーザー回転適用後の画像をOCRへ入力する
        img = load_directory_image(source_directory, filename, rotation=int(rotation))
        return img, f"evaldir_{Path(filename).stem}_r{int(rotation)}"
    raise ValueError("file / export_id+filename / source_directory+filename のいずれかを指定してください")


def _prepare_preview_slot(slot: dict[str, Any], image_type: str, processed_sha: str) -> dict[str, Any]:
    """スロット設定の正規化とキャッシュキー計算（推論は実行しない）。

    キャッシュキーは処理済み画像sha256+推論設定。処理済み画像は元画像・回転・
    Step5専用前処理・共通前処理をすべて反映するため、いずれの変更でも別キーになる。
    """
    engine = str(slot.get("engine") or "custom")
    model = str(slot.get("model") or "latest")
    langs_text = str(slot.get("easyocr_langs") or "en")
    include_lowercase = slot.get("include_lowercase") is not False
    psm_val = int(slot.get("psm") or 0)
    whitelist = str(slot.get("whitelist") or "")

    selected_model_type = slot.get("model_type") or None
    if engine.strip().lower() == "custom" and not selected_model_type:
        settings = get_settings()
        mapping = settings.get("training", {}).get("image_type_to_model", {"single": "square", "wide": "wide"})
        selected_model_type = mapping.get(image_type) or settings.get("training", {}).get("default_model_type")

    cache_key = make_preview_cache_key(
        processed_sha,
        engine=engine,
        model=model,
        model_type=str(selected_model_type or ""),
        easyocr_langs=langs_text,
        include_lowercase=include_lowercase,
        psm=psm_val,
        whitelist=whitelist,
    )
    return {
        "slot_no": slot.get("slot"),
        "engine": engine,
        "model": model,
        "model_type": selected_model_type,
        "langs_text": langs_text,
        "include_lowercase": include_lowercase,
        "psm": psm_val,
        "whitelist": whitelist,
        "cache_key": cache_key,
    }


def _execute_preview_slot(project_id: str, prepared: dict[str, Any], processed_path: Path) -> dict[str, Any]:
    """1スロットの推論実行（共有Executorのワーカー上で動く）。

    - 結果にはbase64画像を含めない（prediction/confidence/engine/model_name/errorのみ）
    - 成功時のみLRUへ保存（エラーは設定・環境修正後の再実行で即反映させるためキャッシュしない）
    """
    started = time.perf_counter()
    try:
        langs = [x.strip() for x in prepared["langs_text"].split(",") if x.strip()]
        prediction = predict_from_image(
            str(processed_path),
            model_type=prepared["model_type"],
            model=prepared["model"],
            project_id=project_id,
            engine=prepared["engine"],
            easyocr_languages=langs,
            apply_preprocess=False,
            include_lowercase=prepared["include_lowercase"],
            tesseract_psm=(prepared["psm"] or None),
            whitelist=(prepared["whitelist"] or None),
        )
        result = {
            "engine": prediction.get("engine", prepared["engine"]),
            "model_name": prediction.get("model_name", ""),
            "prediction": prediction.get("prediction", ""),
            "confidence": prediction.get("confidence"),
            "error": None,
        }
        result["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
        set_cached_preview_result(prepared["cache_key"], result)
    except Exception as e:  # noqa: BLE001
        result = {
            "engine": prepared["engine"],
            "model_name": "",
            "prediction": "",
            "confidence": None,
            "error": str(e),
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
        }
    return result


def _slot_row(prepared: dict[str, Any], result: dict[str, Any], cached: bool) -> dict[str, Any]:
    return {**result, "slot": prepared["slot_no"], "cached": cached}


# Step5 OCR専用の共有Executor（プロセスで1つ）。リクエストごとにPoolを作らず、
# **全リクエスト横断で同時推論数を2に制限**する。Abort済みリクエストの残骸・先読みが
# 積み重なっても同時推論は2件のままで、CPU飽和による周期的な遅延を防ぐ
# （実測: 旧実装はリクエスト毎に独立Pool生成のため6同時要求で全件20秒超に劣化）。
# 待機はExecutorの内部キューで直列化され、in-flight共有と先読み抑制で滞留は最大数件に収まる
_STEP5_OCR_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="step5-ocr")
# 同一条件（処理済み画像sha256+推論設定）のin-flight共有。先読みと現在画像OCRが
# 同じ条件を要求した場合に推論を1回へ統合する。エントリは所有者が完了時に必ず削除する
_OCR_INFLIGHT: dict[str, Future] = {}
_OCR_INFLIGHT_LOCK = Lock()


def _has_ocr_inflight() -> bool:
    with _OCR_INFLIGHT_LOCK:
        return bool(_OCR_INFLIGHT)


def run_preview_ocr_batch(
    img: Image.Image,
    project_id: str,
    overrides: Optional[dict[str, Any]],
    slots: list[dict[str, Any]],
    preview_stem: str = "adhoc",
    include_images: bool = True,
    prefetch: bool = False,
    should_abort: Optional[Any] = None,
) -> dict[str, Any]:
    """前処理1回＋複数OCRスロットの実行（Step5バッチ用コア）。

    - 画像デコード・回転・Step5専用前処理は呼び出し側で適用済み。共通OCR前処理・
      中間/最終画像のbase64生成はここで**1回だけ**行い、全スロットで共有する
    - 推論は**プロセス共有のExecutor（同時実行数2）**へスロット番号順にsubmit。
      リクエスト横断で同時推論数が2に制限され、連続操作でも滞留がCPU飽和を起こさない。
      結果の並びはスロット順を維持
    - **in-flight共有**: 同一キャッシュキーの推論が実行中なら新規に開始せず同じFutureを待つ
      （先読みと現在画像OCRの二重実行を1回に統合）。エントリは所有者が完了時に必ず削除
    - `prefetch=True` は「実行中/待機中のOCRが無いときだけ」実行し、混雑時はスロットを
      実行せず `skipped_busy=True` で返す（現在画像の処理を先読みより優先する）
    - `should_abort`（呼び出し元でクライアント切断等を判定）がTrueを返したら、
      未開始スロットは実行せず、キュー内のFutureはキャンセルする
    - slots=[] はプレビュー（中間・最終画像）のみ生成しOCR推論を実行しない
    - include_images=False は画像data URLを空で返す（先読み用の転送削減）
    """
    if not isinstance(slots, list) or len(slots) > 3:
        raise ValueError("slots は最大3件の配列で指定してください")
    for slot in slots:
        if not isinstance(slot, dict):
            raise ValueError("slots の各要素はobjectで指定してください")
    t0 = time.perf_counter()
    preview = preview_preprocess_image(img, project_id=project_id, overrides=overrides, preview_stem=preview_stem)
    preprocess_ms = round((time.perf_counter() - t0) * 1000, 1)

    skipped_busy = False
    results: list[Optional[dict[str, Any]]] = []
    slots_wall_ms = 0.0
    if slots and prefetch and _has_ocr_inflight():
        # 先読みはアイドル時だけ（実行中/待機中のOCRがあれば破棄=現在画像を優先）
        skipped_busy = True
    elif slots:
        paths = ensure_project_directories(project_id)
        processed_path = paths.root / str(preview.get("processed_preview") or "")
        processed_sha = hashlib.sha256(processed_path.read_bytes()).hexdigest()
        image_type = str(preview.get("type", "single"))
        t1 = time.perf_counter()
        results = [None] * len(slots)
        pending: list[tuple[int, dict[str, Any], Future, bool]] = []
        for i, slot in enumerate(slots):
            prepared = _prepare_preview_slot(slot, image_type, processed_sha)
            cached = get_cached_preview_result(prepared["cache_key"])
            if cached is not None:
                results[i] = _slot_row(prepared, cached, cached=True)
                continue
            # クライアント切断済みなら未開始スロットを実行しない
            if callable(should_abort) and should_abort():
                results[i] = _slot_row(
                    prepared,
                    {"engine": prepared["engine"], "model_name": "", "prediction": "", "confidence": None,
                     "error": "client disconnected (skipped)", "elapsed_ms": 0.0},
                    cached=False,
                )
                continue
            with _OCR_INFLIGHT_LOCK:
                future = _OCR_INFLIGHT.get(prepared["cache_key"])
                owner = future is None
                if owner:
                    future = _STEP5_OCR_EXECUTOR.submit(_execute_preview_slot, project_id, prepared, processed_path)
                    _OCR_INFLIGHT[prepared["cache_key"]] = future
            pending.append((i, prepared, future, owner))
        for i, prepared, future, owner in pending:
            # 各スロットの待機前に切断確認: 未開始（キュー内）のFutureはキャンセルして実行しない
            if callable(should_abort) and should_abort() and owner and future.cancel():
                with _OCR_INFLIGHT_LOCK:
                    _OCR_INFLIGHT.pop(prepared["cache_key"], None)
                results[i] = _slot_row(
                    prepared,
                    {"engine": prepared["engine"], "model_name": "", "prediction": "", "confidence": None,
                     "error": "cancelled (client disconnected)", "elapsed_ms": 0.0},
                    cached=False,
                )
                continue
            try:
                result = future.result()
            except CancelledError:
                result = {"engine": prepared["engine"], "model_name": "", "prediction": "", "confidence": None,
                          "error": "cancelled", "elapsed_ms": 0.0}
            finally:
                if owner:
                    with _OCR_INFLIGHT_LOCK:
                        _OCR_INFLIGHT.pop(prepared["cache_key"], None)
            results[i] = _slot_row(prepared, result, cached=False)
        slots_wall_ms = round((time.perf_counter() - t1) * 1000, 1)
    return {
        "project_id": preview.get("project_id"),
        "type": preview.get("type"),
        "ratio": preview.get("ratio"),
        "original_size": preview.get("original_size"),
        "pipeline": preview.get("pipeline"),
        "interim_data_url": str(preview.get("interim_data_url") or "") if include_images else "",
        "processed_data_url": str(preview.get("processed_data_url") or "") if include_images else "",
        "results": [row for row in results if row is not None],
        "skipped_busy": skipped_busy,
        "timings": {"preprocess_ms": preprocess_ms, "slots_wall_ms": slots_wall_ms},
    }


@app.post("/api/ocr/preview-file/batch")
async def api_ocr_preview_file_batch(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    project_id: str = Form("default"),
    export_id: str = Form(""),
    source_directory: str = Form(""),
    filename: str = Form(""),
    rotation: int = Form(0),
    overrides_json: str = Form(""),
    eval_preprocess_json: str = Form(""),
    slots_json: str = Form("[]"),
    include_images: bool = Form(True),
    prefetch: bool = Form(False),
) -> dict[str, Any]:
    """Step5用: 前処理1回＋複数OCR設定（最大3スロット）を1リクエストで処理する。

    - `slots_json=[]` は中間・最終画像プレビューのみ更新（OCR推論なし）
    - スロットは同時実行数2で並列実行（結果の並びはスロット順を維持）
    - 中間・最終画像のdata URLはレスポンス直下に1回だけ含め、各スロット結果には含めない
      （`include_images=false` で画像を省略可能=先読み用の転送削減）
    - 同一の処理済み画像×同一設定の結果はプロセス内LRUキャッシュを再利用（エラーは対象外）
    - ブロッキング処理はワーカースレッドへ逃がし、イベントループ（他のプレビュー・一覧等の
      リクエスト）を塞がない（既存ラベル編集のsync defエンドポイントと同等の並行性）
    - 既存 `POST /api/ocr/preview-file` は後方互換のため維持
    """
    resolved = _resolve_project_id(project_id)
    try:
        overrides = _parse_preview_json_object(overrides_json, "overrides_json")
        slots_raw = json.loads(str(slots_json or "[]"))
        if not isinstance(slots_raw, list):
            raise ValueError("slots_json must be an array")
        # 画像デコード前の切断確認（Abort済みリクエストの処理を最小化）
        if await request.is_disconnected():
            return {"results": [], "skipped_busy": False, "disconnected": True}
        upload_bytes = await file.read() if file is not None else None

        # ワーカースレッドから呼べるクライアント切断チェック（各スロット実行前に確認し、
        # 切断済みなら未開始スロットを実行しない。実行中の推論の強制中断はしない）
        loop = asyncio.get_running_loop()

        def _client_disconnected() -> bool:
            # timeoutは短く保つ（このチェック自体がスロット実行を遅らせないため）
            try:
                return bool(asyncio.run_coroutine_threadsafe(request.is_disconnected(), loop).result(timeout=0.2))
            except Exception:  # noqa: BLE001
                return False

        def _run() -> dict[str, Any]:
            img, stem = _load_preview_source_image(
                resolved,
                upload_bytes,
                str(file.filename or "image") if file is not None else "",
                export_id,
                source_directory,
                filename,
                int(rotation),
            )
            parsed_eval = _parse_preview_json_object(eval_preprocess_json, "eval_preprocess_json")
            if parsed_eval is not None:
                img = apply_eval_preprocess(img, parsed_eval)
            return run_preview_ocr_batch(
                img,
                resolved,
                overrides,
                slots_raw,
                preview_stem=stem,
                include_images=bool(include_images),
                prefetch=bool(prefetch),
                should_abort=_client_disconnected,
            )

        return await asyncio.to_thread(_run)
    except (TypeError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"invalid slots_json: {e}") from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/ocr/preview-file")
async def api_ocr_preview_file(
    file: Optional[UploadFile] = File(default=None),
    project_id: str = Form("default"),
    export_id: str = Form(""),
    source_directory: str = Form(""),
    filename: str = Form(""),
    rotation: int = Form(0),
    overrides_json: str = Form(""),
    eval_preprocess_json: str = Form(""),
    engine: str = Form("custom"),
    model: str = Form("latest"),
    model_type: str = Form(""),
    easyocr_langs: str = Form("en"),
    include_lowercase: bool = Form(True),
    psm: int = Form(0),
    whitelist: str = Form(""),
) -> dict[str, Any]:
    """登録前・評価用画像のOCR前処理＋推論プレビュー（/preprocess/preview のファイル入力版）。

    入力は「アップロード画像」「サーバー管理下の評価候補（export_id+filename+rotation）」
    「指定フォルダの画像（source_directory+filename+rotation。Step5のフォルダ取得モード）」のいずれか。
    評価候補はマニフェスト記載ファイルのみ解決、フォルダ画像はフォルダ直下のみ解決（トラバーサル拒否）。
    前処理・推論・小文字制御・Confidence正規化は既存サービスを共通利用する。
    """
    resolved = _resolve_project_id(project_id)
    try:
        overrides = _parse_preview_json_object(overrides_json, "overrides_json")
        upload_bytes = await file.read() if file is not None else None
        img, stem = _load_preview_source_image(
            resolved,
            upload_bytes,
            str(file.filename or "image") if file is not None else "",
            export_id,
            source_directory,
            filename,
            int(rotation),
        )

        # Step5専用OCR前処理（グレースケール/二値化）。回転適用後・共通前処理パイプラインの前に適用する。
        # OCR候補生成用の推論入力にのみ作用し、評価用コピー・データセット画像へは一切反映されない。
        # 未指定=従来動作
        parsed_eval = _parse_preview_json_object(eval_preprocess_json, "eval_preprocess_json")
        if parsed_eval is not None:
            img = apply_eval_preprocess(img, parsed_eval)

        preview = preview_preprocess_image(img, project_id=resolved, overrides=overrides, preview_stem=stem)
        return _attach_preview_prediction(
            preview,
            resolved,
            engine=engine,
            model=model,
            model_type=(model_type or None),
            easyocr_langs=easyocr_langs,
            include_lowercase=bool(include_lowercase),
            tesseract_psm=(int(psm) if int(psm or 0) > 0 else None),
            whitelist=(whitelist or None),
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
            training_mode=str(job.get("training_mode") or "scratch"),
            init_source_type=str(job.get("init_source_type") or "scratch"),
            init_source_value=str(job.get("init_source_value") or "").strip() or None,
            freeze_backbone_epochs=int(job.get("freeze_backbone_epochs") or 0),
            backbone_lr_scale=float(job.get("backbone_lr_scale") or 1.0),
            progress_callback=_on_epoch_progress,
        )

        current = fetch_training_job(job_id) or job
        upsert_training_job(
            {
                **current,
                "status": "completed",
                "message": "training completed",
                "model_path": result["model_path"],
                "worker_pid": None,
                "updated_at": _now_iso(),
            }
        )
    except Exception as e:  # noqa: BLE001
        current = fetch_training_job(job_id) or job
        failed_message = str(e)
        cleaned = False
        try:
            cleaned = _cleanup_failed_ocr_dataset(
                project_id=str(current.get("project_id") or "default"),
                dataset_dir=str(current.get("dataset_dir") or ""),
            )
        except Exception:  # noqa: BLE001
            cleaned = False
        if cleaned:
            failed_message = f"{failed_message} (failed dataset cleaned)"
        upsert_training_job(
            {
                **current,
                "status": "failed",
                "message": failed_message,
                "worker_pid": None,
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
        paddle_repo_dir = _resolve_paddleocr_repo_dir(str(job.get("paddle_repo_dir") or "").strip())
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
            device=str(job.get("device") or "auto"),
            auto_batch_size_enabled=bool(job.get("auto_batch_size", False)),
            train_num_workers=int(job.get("train_num_workers") or 0),
            eval_num_workers=int(job.get("eval_num_workers") or 0),
            save_epoch_step=int(job.get("save_epoch_step") or 10),
            use_amp=bool(job.get("use_amp", False)),
            pin_memory=bool(job.get("pin_memory", False)),
            persistent_workers=bool(job.get("persistent_workers", False)),
            training_mode=str(job.get("training_mode") or "scratch"),
            init_source_type=str(job.get("init_source_type") or "scratch"),
            init_source_value=str(job.get("init_source_value") or "").strip() or None,
            log_path=log_path,
        )
        current = fetch_training_job(job_id) or job
        def _value(key: str, current_key: Optional[str] = None, default: Any = None) -> Any:
            if key in result and result.get(key) is not None:
                return result.get(key)
            ref_key = current_key if current_key is not None else key
            if ref_key in current and current.get(ref_key) is not None:
                return current.get(ref_key)
            return default

        upsert_training_job(
            {
                **current,
                "status": "completed",
                "message": "ocr training completed",
                "model_path": result.get("model_dir"),
                "resolved_device": str(_value("resolved_device", default="cpu")),
                "device": str(_value("device", default="auto")),
                "train_num_workers": int(_value("train_num_workers", default=0)),
                "eval_num_workers": int(_value("eval_num_workers", default=0)),
                "save_epoch_step": int(_value("save_epoch_step", default=10)),
                "auto_batch_size": bool(_value("auto_batch_size_enabled", "auto_batch_size", False)),
                "use_amp": bool(_value("use_amp", default=False)),
                "pin_memory": bool(_value("pin_memory", default=False)),
                "persistent_workers": bool(_value("persistent_workers", default=False)),
                "vram_gb": float(_value("vram_gb", default=0.0)),
                "effective_train_batch": int(_value("effective_train_batch", default=0)),
                "effective_eval_batch": int(_value("effective_eval_batch", default=0)),
                "oom_retry_count": int(_value("oom_retry_count", default=0)),
                "worker_pid": None,
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
                "worker_pid": None,
                "updated_at": _now_iso(),
            }
        )


def _run_tesseract_training_job(job_id: str) -> None:
    job = fetch_training_job(job_id)
    if not job:
        return

    upsert_training_job(
        {
            **job,
            "status": "running",
            "message": "tesseract training started",
            "updated_at": _now_iso(),
        }
    )

    try:
        project_id = str(job.get("project_id") or "default")
        dataset_dir = str(job.get("dataset_dir") or "")
        # Tesseractジョブでは epochs=max_iterations / init_source_value=base_lang / max_text_length=psm を流用
        max_iterations = int(job.get("epochs") or 1000)
        base_lang = str(job.get("init_source_value") or "eng").strip() or "eng"
        psm = int(job.get("max_text_length") or 7)
        charset = str(job.get("charset") or TESSERACT_TARGET_CHARSET)

        log_path = Path(str(job.get("log_path") or ""))
        if not str(log_path):
            paths = ensure_project_directories(project_id)
            log_path = paths.logs / f"train_tesseract_{job_id}.log"

        # 実験情報（実験名/親モデル/学習メモ）をジョブからモデルメタへ引き継ぐ
        extra_meta: Optional[dict[str, Any]] = None
        try:
            raw_meta = job.get("experiment_meta")
            parsed = json.loads(raw_meta) if raw_meta else None
            extra_meta = parsed if isinstance(parsed, dict) else None
        except (TypeError, ValueError):
            extra_meta = None

        result = run_tesseract_training(
            project_id=project_id,
            job_id=job_id,
            dataset_dir=dataset_dir,
            charset=charset,
            max_iterations=max_iterations,
            base_lang=base_lang,
            psm=psm,
            log_path=log_path,
            extra_meta=extra_meta,
        )
        current = fetch_training_job(job_id) or job
        upsert_training_job(
            {
                **current,
                "status": "completed",
                "message": "tesseract training completed",
                "model_path": result.get("traineddata_path"),
                "worker_pid": None,
                "log_path": result.get("log_path") or str(log_path),
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
                "worker_pid": None,
                "updated_at": _now_iso(),
            }
        )


@app.post("/train/start")
def train_start(req: TrainRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    project_id = _resolve_project_id(req.project_id)
    _reject_if_training_active(project_id, "classification")
    training_mode = str(req.training_mode or "finetune").strip().lower()
    init_source_type = str(req.init_source_type or "imagenet").strip().lower()
    init_source_value = str(req.init_source_value or "").strip()
    freeze_backbone_epochs = int(req.freeze_backbone_epochs or 0)
    backbone_lr_scale = float(req.backbone_lr_scale or 1.0)

    if training_mode not in {"scratch", "finetune"}:
        raise HTTPException(status_code=400, detail=f"unsupported training_mode: {training_mode}")
    if init_source_type not in {"scratch", "imagenet", "classification_model"}:
        raise HTTPException(status_code=400, detail=f"unsupported init_source_type: {init_source_type}")
    if training_mode == "scratch":
        init_source_type = "scratch"
        init_source_value = ""
        freeze_backbone_epochs = 0
        backbone_lr_scale = 1.0
    else:
        if init_source_type == "scratch":
            raise HTTPException(status_code=400, detail="finetune mode requires init_source_type other than scratch")
        if init_source_type == "classification_model" and not init_source_value:
            raise HTTPException(status_code=400, detail="init_source_value is required for classification_model")

    job_id = str(uuid.uuid4())
    now = _now_iso()
    job_payload = {
        "id": job_id,
        "project_id": project_id,
        "training_family": "classification",
        "engine": "custom",
        "model_type": req.model_type,
        "epochs": req.epochs,
        "batch_size": req.batch_size,
        "learning_rate": req.learning_rate,
        "training_mode": training_mode,
        "init_source_type": init_source_type,
        "init_source_value": init_source_value,
        "freeze_backbone_epochs": freeze_backbone_epochs,
        "backbone_lr_scale": backbone_lr_scale,
        "status": "queued",
        "message": "queued",
        "model_path": None,
        "worker_pid": None,
        "created_at": now,
        "updated_at": now,
    }
    upsert_training_job(job_payload)
    worker_pid = _spawn_training_runner("classification", job_id)
    upsert_training_job(
        {
            **job_payload,
            "worker_pid": worker_pid,
            "updated_at": _now_iso(),
        }
    )
    return {"job_id": job_id, "project_id": project_id, "status": "queued"}


@app.get("/train/{job_id}")
def train_status(job_id: str) -> dict[str, Any]:
    job = fetch_training_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.post("/train/stop/{job_id}")
def train_stop(job_id: str, delete_artifacts: bool = Query(default=False)) -> dict[str, Any]:
    return _stop_training_worker(job_id, expected_family="classification", delete_artifacts=delete_artifacts)


def _split_ratio_error_detail(train: float, val: float, test: float) -> Optional[dict[str, Any]]:
    """比率合計の事前検証（構造化エラー）。合計1.0（許容誤差1e-6）でなければ詳細を返す。"""
    total = float(train) + float(val) + float(test)
    if math.isclose(total, 1.0, rel_tol=0, abs_tol=1e-6):
        return None
    return {
        "code": "INVALID_SPLIT_RATIO",
        "message": "Train・Validation・Testの合計を1.00にしてください。",
        "values": {
            "train": float(train),
            "validation": float(val),
            "test": float(test),
            "sum": round(total, 6),
        },
    }


@app.post("/api/ocr/dataset/create")
def api_ocr_dataset_create(req: OcrDatasetCreateRequest, request: Request) -> dict[str, Any]:
    _enforce_role(request, "dataset_create")
    resolved = _resolve_project_id(req.project_id)
    ratio_error = _split_ratio_error_detail(req.train_ratio, req.val_ratio, req.test_ratio)
    if ratio_error is not None:
        raise HTTPException(status_code=400, detail=ratio_error)
    try:
        result = create_ocr_dataset(
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
            text_case=req.text_case,
            augmentation=req.augmentation,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "dataset_create", project_id=resolved, target_type="dataset",
        target_id=str(result.get("dataset_root") or ""),
        after={"counts": result.get("counts"), "charset": req.charset, "use_augmentation": req.use_augmentation},
    )
    return result


@app.post("/api/ocr/dataset/split-preview")
def api_ocr_dataset_split_preview(req: OcrDatasetSplitPreviewRequest) -> dict[str, Any]:
    """データセット作成前の分割予定枚数プレビュー（入力/有効/除外内訳＋最大剰余法の予定枚数）。"""
    resolved = _resolve_project_id(req.project_id)
    ratio_error = _split_ratio_error_detail(req.train_ratio, req.val_ratio, req.test_ratio)
    if ratio_error is not None:
        raise HTTPException(status_code=400, detail=ratio_error)
    try:
        return preview_ocr_dataset_split(
            project_id=resolved,
            image_types=req.image_types,
            charset=req.charset,
            max_text_length=req.max_text_length,
            text_case=req.text_case,
            train_ratio=req.train_ratio,
            val_ratio=req.val_ratio,
            test_ratio=req.test_ratio,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/ocr/dataset/augmentation-preview")
def api_ocr_dataset_augmentation_preview(req: OcrAugmentationPreviewRequest) -> dict[str, Any]:
    """学習前のオーグメンテーションプレビュー（元画像/適用後のペアをbase64で返す）。"""
    resolved = _resolve_project_id(req.project_id)
    try:
        return preview_ocr_augmentation(
            project_id=resolved,
            augmentation=req.augmentation,
            image_types=req.image_types,
            charset=req.charset,
            max_text_length=req.max_text_length,
            text_case=req.text_case,
            image_shape=req.image_shape,
            sample_count=req.sample_count,
        )
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
            text_case=req.text_case,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/ocr/train/start")
def api_ocr_train_start(req: OcrTrainStartRequest, background_tasks: BackgroundTasks, request: Request) -> dict[str, Any]:
    _enforce_role(request, "training_start")
    project_id = _resolve_project_id(req.project_id)
    _reject_if_training_active(project_id, "ocr")
    engine = str(req.engine or "").strip().lower()
    if engine != "paddleocr":
        raise HTTPException(status_code=400, detail="Only paddleocr is trainable. EasyOCR is inference-only.")
    settings = get_settings()
    ocr_cfg = settings.get("ocr_training", {}) if isinstance(settings.get("ocr_training"), dict) else {}
    system_info = _system_check_snapshot()
    resolved_device = str(req.device or ocr_cfg.get("default_device") or "auto").strip().lower()
    if resolved_device not in {"auto", "cpu", "gpu"}:
        raise HTTPException(status_code=400, detail=f"unsupported device: {resolved_device}")
    if resolved_device == "gpu" and not bool(system_info.get("paddle_gpu_available")):
        raise HTTPException(status_code=400, detail="device=gpu was requested, but CUDA GPU is not available for PaddlePaddle.")
    will_use_gpu = resolved_device == "gpu" or (resolved_device == "auto" and bool(system_info.get("gpu_available")))
    resolved_auto_batch_size = (
        bool(req.auto_batch_size)
        if req.auto_batch_size is not None
        else bool(ocr_cfg.get("default_auto_batch_size", False))
    )
    if not will_use_gpu:
        resolved_auto_batch_size = False
    resolved_train_num_workers = (
        int(req.train_num_workers)
        if req.train_num_workers is not None
        else int(ocr_cfg.get("default_train_num_workers") or 0)
    )
    resolved_eval_num_workers = (
        int(req.eval_num_workers)
        if req.eval_num_workers is not None
        else int(ocr_cfg.get("default_eval_num_workers") or 0)
    )
    resolved_save_epoch_step = (
        int(req.save_epoch_step)
        if req.save_epoch_step is not None
        else int(ocr_cfg.get("default_save_epoch_step") or 10)
    )
    resolved_use_amp = bool(req.use_amp) if req.use_amp is not None else bool(ocr_cfg.get("default_use_amp", False))
    resolved_pin_memory = (
        bool(req.pin_memory) if req.pin_memory is not None else bool(ocr_cfg.get("default_pin_memory", False))
    )
    resolved_persistent_workers = (
        bool(req.persistent_workers)
        if req.persistent_workers is not None
        else bool(ocr_cfg.get("default_persistent_workers", False))
    )
    if not will_use_gpu:
        resolved_use_amp = False
        resolved_pin_memory = False
        resolved_persistent_workers = False
    if resolved_train_num_workers <= 0:
        resolved_persistent_workers = False
    if resolved_eval_num_workers < 0 or resolved_train_num_workers < 0:
        raise HTTPException(status_code=400, detail="num_workers must be >= 0")
    if resolved_save_epoch_step <= 0:
        raise HTTPException(status_code=400, detail="save_epoch_step must be >= 1")
    training_mode = str(req.training_mode or "scratch").strip().lower()
    init_source_type = str(req.init_source_type or "scratch").strip().lower()
    init_source_value = str(req.init_source_value or "").strip()
    if training_mode not in {"scratch", "finetune"}:
        raise HTTPException(status_code=400, detail=f"unsupported training_mode: {training_mode}")
    if init_source_type not in {"scratch", "ocr_model"}:
        raise HTTPException(status_code=400, detail=f"unsupported init_source_type: {init_source_type}")
    if training_mode == "scratch":
        init_source_type = "scratch"
        init_source_value = ""
    else:
        if init_source_type != "ocr_model":
            raise HTTPException(status_code=400, detail="OCR finetune requires init_source_type=ocr_model")
        if not init_source_value:
            raise HTTPException(status_code=400, detail="init_source_value is required for OCR finetune")
        if (
            resolve_ocr_model_meta(project_id=project_id, model=init_source_value, engine="paddleocr") is None
            and resolve_official_paddleocr_rec_spec(init_source_value) is None
        ):
            raise HTTPException(status_code=404, detail=f"OCR model not found: {init_source_value}")

    paddle_repo_dir = _resolve_paddleocr_repo_dir(req.paddle_repo_dir)
    job_id = str(uuid.uuid4())
    now = _now_iso()
    paths = ensure_project_directories(project_id)
    log_path = paths.logs / f"train_ocr_{job_id}.log"
    job_payload = {
        "id": job_id,
        "project_id": project_id,
        "training_family": "ocr",
        "engine": "paddleocr",
        "model_type": "ocr",
        "epochs": req.epochs,
        "batch_size": req.batch_size,
        "device": resolved_device,
        "auto_batch_size": resolved_auto_batch_size,
        "train_num_workers": resolved_train_num_workers,
        "eval_num_workers": resolved_eval_num_workers,
        "save_epoch_step": resolved_save_epoch_step,
        "use_amp": resolved_use_amp,
        "pin_memory": resolved_pin_memory,
        "persistent_workers": resolved_persistent_workers,
        "learning_rate": 0.0,
        "charset": req.charset,
        "max_text_length": req.max_text_length,
        "dataset_dir": req.dataset_dir,
        "paddle_repo_dir": paddle_repo_dir,
        "image_shape": req.image_shape,
        "training_mode": training_mode,
        "init_source_type": init_source_type,
        "init_source_value": init_source_value,
        "status": "queued",
        "message": "queued",
        "model_path": None,
        "worker_pid": None,
        "log_path": str(log_path),
        "created_at": now,
        "updated_at": now,
    }
    upsert_training_job(job_payload)
    worker_pid = _spawn_training_runner("ocr", job_id)
    upsert_training_job(
        {
            **job_payload,
            "worker_pid": worker_pid,
            "updated_at": _now_iso(),
        }
    )
    _record_audit_safe(
        request, "training_start", project_id=project_id, target_type="training_job", target_id=job_id,
        job_id=job_id, after={"engine": "paddleocr", "dataset_dir": str(req.dataset_dir or ""), "epochs": req.epochs},
    )
    return {"job_id": job_id, "project_id": project_id, "status": "queued", "training_family": "ocr", "engine": "paddleocr"}


@app.post("/api/tesseract/train/start")
def api_tesseract_train_start(req: TesseractTrainStartRequest, request: Request) -> dict[str, Any]:
    _enforce_role(request, "training_start")
    project_id = _resolve_project_id(req.project_id)
    _reject_if_training_active(project_id, "ocr")
    dataset_dir = str(req.dataset_dir or "").strip()
    if not dataset_dir:
        raise HTTPException(status_code=400, detail="dataset_dir is required")
    # 学習ツール未導入なら着手前に導入手順つきで失敗させる
    try:
        ensure_tesseract_training_tools()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # 学習対象文字セット。大小文字を区別するため大小変換はしない（重複除去のみ）
    charset = "".join(dict.fromkeys(str(req.charset or TESSERACT_TARGET_CHARSET)))
    if not charset:
        charset = TESSERACT_TARGET_CHARSET

    job_id = str(uuid.uuid4())
    now = _now_iso()
    paths = ensure_project_directories(project_id)
    log_path = paths.logs / f"train_tesseract_{job_id}.log"
    job_payload = {
        "id": job_id,
        "project_id": project_id,
        "training_family": "ocr",
        "engine": "tesseract",
        "model_type": "ocr",
        "epochs": int(req.max_iterations),
        "batch_size": 1,
        "learning_rate": 0.0,
        "charset": charset,
        "max_text_length": int(req.psm),
        "dataset_dir": dataset_dir,
        "image_shape": None,
        "training_mode": "finetune",
        "init_source_type": "tesseract_base",
        "init_source_value": str(req.base_lang or "eng"),
        "status": "queued",
        "message": "queued",
        "model_path": None,
        "worker_pid": None,
        "log_path": str(log_path),
        # 実験情報はジョブ経由でモデルメタ（.tess.json）へ引き継ぐ（未指定なら保存しない=従来動作）
        "experiment_meta": (
            json.dumps(
                {
                    "experiment_name": str(req.experiment_name or "").strip(),
                    "parent_model_id": str(req.parent_model_id or "").strip(),
                    "training_note": str(req.training_note or "").strip(),
                },
                ensure_ascii=False,
            )
            if (req.experiment_name or req.parent_model_id or req.training_note)
            else None
        ),
        "created_at": now,
        "updated_at": now,
    }
    upsert_training_job(job_payload)
    worker_pid = _spawn_training_runner("tesseract", job_id)
    upsert_training_job(
        {
            **job_payload,
            "worker_pid": worker_pid,
            "updated_at": _now_iso(),
        }
    )
    _record_audit_safe(
        request, "training_start", project_id=project_id, target_type="training_job", target_id=job_id,
        job_id=job_id,
        after={"engine": "tesseract", "dataset_dir": dataset_dir, "max_iterations": int(req.max_iterations), "charset": charset},
    )
    return {"job_id": job_id, "project_id": project_id, "status": "queued", "training_family": "ocr", "engine": "tesseract"}


@app.get("/api/ocr/train/active")
def api_ocr_train_active(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """プロジェクトのアクティブなOCR学習ジョブ（queued/running）を返す。

    画面再読込・別タブからの再接続用。プロセス実態との突き合わせ
    （_reconcile_ocr_training_job）を通した最新状態を返す。
    """
    resolved = _resolve_project_id(project_id)
    job = fetch_active_training_job(resolved, "ocr")
    if job:
        job = _reconcile_ocr_training_job(str(job.get("id"))) or job
        # 突き合わせの結果、実は終了していた場合はアクティブ扱いにしない
        if str(job.get("status") or "") not in {"queued", "running"}:
            job = None
    return {"project_id": resolved, "job": job}


@app.get("/api/ocr/train/status/{job_id}")
def api_ocr_train_status(job_id: str) -> dict[str, Any]:
    job = _reconcile_ocr_training_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if str(job.get("training_family") or "") != "ocr":
        raise HTTPException(status_code=400, detail="not an OCR training job")
    return job


@app.post("/api/ocr/train/stop/{job_id}")
def api_ocr_train_stop(job_id: str, delete_artifacts: bool = Query(default=False)) -> dict[str, Any]:
    return _stop_training_worker(job_id, expected_family="ocr", delete_artifacts=delete_artifacts)


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


@app.post("/api/ocr/models/export-migrate")
def api_ocr_models_export_migrate(
    project_id: Optional[str] = Query(default="default"),
    overwrite: bool = Query(default=False),
    dry_run: bool = Query(default=False),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    try:
        return migrate_ocr_models_to_inference(
            project_id=resolved,
            paddle_repo_dir=_resolve_default_paddleocr_repo_dir(),
            overwrite=bool(overwrite),
            dry_run=bool(dry_run),
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.get("/api/ocr/models/official")
def api_ocr_models_official() -> dict[str, Any]:
    return {"items": list_paddleocr_official_rec_models()}


@app.get("/api/experiments")
def api_experiments(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """実験一覧（EXP-0001形式・管理No・Evaluation Hash・Comparable Group・分析対象付き）。

    実験記録のない旧モデルは自動バックフィルされる（既定で分析対象外）。
    """
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "items": list_experiments(resolved)}


@app.get("/api/experiments/comparable_groups")
def api_experiment_comparable_groups(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """Comparable Group一覧（Evaluation Hash単位・CG-0001形式・出現順採番）。"""
    resolved = _resolve_project_id(project_id)
    items = list_experiments(resolved)
    return {"project_id": resolved, "groups": build_comparable_groups(items)}


@app.get("/api/experiments/recommendation")
def api_experiment_recommendation(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """比較可能Experimentのみから生成した条件推薦（根拠件数・5件未満はinsufficient・除外理由つき）。"""
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, **build_recommendations(resolved)}


@app.patch("/api/experiments/{experiment_id}/analysis")
def api_experiment_analysis_toggle(experiment_id: str, req: ExperimentAnalysisToggleRequest, request: Request) -> dict[str, Any]:
    """実験の分析対象ON/OFF（失敗・途中停止・デバッグ実験を推薦・相関から除外する）。"""
    resolved = _resolve_project_id(req.project_id)
    try:
        item = set_analysis_enabled(resolved, experiment_id, bool(req.enabled))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    _record_audit_safe(
        request, "analysis_toggle", project_id=resolved, target_type="experiment", target_id=experiment_id,
        after={"analysis_enabled": bool(req.enabled)},
    )
    return {"project_id": resolved, "item": item}


@app.patch("/api/experiments/{experiment_id}")
def api_experiment_update(experiment_id: str, req: ExperimentUpdateRequest, request: Request) -> dict[str, Any]:
    """実験カルテの更新（タグ・お気に入り・メモ・学習者・実験名のみ。学習条件は不変）。"""
    resolved = _resolve_project_id(req.project_id)
    patch = {
        "tags": req.tags,
        "favorite": req.favorite,
        "note": req.note,
        "operator": req.operator,
        "experiment_name": req.experiment_name,
    }
    try:
        item = update_experiment(resolved, experiment_id, patch)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    _record_audit_safe(
        request, "experiment_update", project_id=resolved, target_type="experiment", target_id=experiment_id,
        after={key: value for key, value in patch.items() if value is not None},
    )
    return {"project_id": resolved, "item": item}


@app.post("/api/experiments/attach-evaluation")
def api_experiment_attach_evaluation(req: ExperimentEvaluationAttachRequest) -> dict[str, Any]:
    """評価実行結果（CER等の要約）をモデル名から該当実験へ保存する。該当なしは attached=false。"""
    resolved = _resolve_project_id(req.project_id)
    # 旧モデル評価時もバックフィル済み実験へ紐付くよう先に補完する
    ensure_experiments_for_models(resolved)
    item = attach_evaluation(resolved, req.model, req.evaluation)
    return {"project_id": resolved, "attached": item is not None, "item": item}


@app.post("/api/jobs")
def api_job_create(req: JobCreateRequest) -> dict[str, Any]:
    """Job作成（queuedで登録→Workerが順次実行）。同時実行制御に該当する重複要求は
    既存のアクティブJobを `deduplicated: true` で返す（統一仕様。409は返さない）。"""
    resolved = _resolve_project_id(req.project_id)
    try:
        job, deduplicated = get_job_service().create_job(
            project_id=resolved,
            job_type=req.job_type,
            params={"project_id": resolved, **(req.params or {})},
            requested_by=req.requested_by,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    ensure_worker_started()
    return {"project_id": resolved, "job": job, "deduplicated": deduplicated}


@app.get("/api/jobs")
def api_jobs(
    project_id: Optional[str] = Query(default=""),
    job_type: str = Query(default=""),
    status: str = Query(default=""),
    requested_by: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to: str = Query(default=""),
    limit: int = Query(default=200, ge=1, le=1000),
) -> dict[str, Any]:
    """Job一覧（新しい順。Project / 種別 / Status / 実行者 / 日付でフィルタ）。"""
    return {
        "items": get_job_service().list_jobs(
            project_id=str(project_id or ""),
            job_type=job_type,
            status=status,
            requested_by=requested_by,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
        ),
        "worker_alive": get_job_worker().is_alive(),
    }


@app.get("/api/jobs/{job_id}")
def api_job_detail(job_id: str) -> dict[str, Any]:
    job = get_job_service().repository.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"job not found: {job_id}")
    return {"job": job}


@app.post("/api/jobs/{job_id}/cancel")
def api_job_cancel(job_id: str, request: Request) -> dict[str, Any]:
    """キャンセル要求（running→cancel_requested→安全な区間でcancelled。即時cancelledにはしない）。"""
    _enforce_role(request, "job_cancel")
    try:
        job = get_job_service().request_cancel(job_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "job_cancel", project_id=str(job.get("project_id") or ""), target_type="job", target_id=job_id,
        job_id=job_id, after={"status": job.get("status")},
    )
    return {"job": job}


@app.post("/api/jobs/{job_id}/retry")
def api_job_retry(job_id: str, req: JobRetryRequest, request: Request) -> dict[str, Any]:
    """同一入力条件での再実行（retry_source_job_idを保存）。"""
    _enforce_role(request, "job_retry")
    try:
        job, deduplicated = get_job_service().retry_job(job_id, requested_by=req.requested_by)
        ensure_worker_started()
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "job_retry", project_id=str(job.get("project_id") or ""), target_type="job", target_id=job["job_id"],
        job_id=job["job_id"], before={"retry_source_job_id": job_id}, after={"deduplicated": deduplicated},
    )
    return {"job": job, "deduplicated": deduplicated}


@app.get("/api/jobs/{job_id}/events")
def api_job_events(job_id: str) -> dict[str, Any]:
    """進捗イベント履歴（現在はポーリング取得。イベント形式は将来SSEでもそのまま使用する）。"""
    return {"events": get_job_service().repository.read_events(job_id)}


@app.get("/api/releases")
def api_releases(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """リリース状況（モデル別Status/Version・現Production・リリース履歴=新しい順）。"""
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, **list_releases(resolved)}


@app.post("/api/releases/status")
def api_release_status(req: ReleaseStatusRequest, request: Request) -> dict[str, Any]:
    """モデルステータスの手動変更（Draft/Validated/Candidate/Archived。Candidate初回は0.x採番）。"""
    _enforce_role(request, "release_status_change")
    resolved = _resolve_project_id(req.project_id)
    before = (list_releases(resolved).get("statuses") or {}).get(Path(str(req.model)).name)
    try:
        item = set_model_status(resolved, req.model, req.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "release_status_change", project_id=resolved, target_type="model", target_id=item["model"],
        before={"status": (before or {}).get("status"), "version": (before or {}).get("version")},
        after={"status": item.get("status"), "version": item.get("version")},
    )
    return {"project_id": resolved, "item": item}


@app.post("/api/releases/promote")
def api_release_promote(req: ReleasePromoteRequest, request: Request) -> dict[str, Any]:
    """Productionへ昇格（Release Note必須）。旧Productionは自動Archived・履歴へ追記。

    Release Gate判定がFAILのモデルは例外承認（override_reason + approved_by）なしでは昇格できない。
    """
    _enforce_role(request, "release_promote")
    resolved = _resolve_project_id(req.project_id)
    try:
        result = promote_model(
            resolved,
            req.model,
            req.note,
            author=req.author,
            version=req.version,
            override_reason=req.override_reason,
            approved_by=req.approved_by,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "release_promote", project_id=resolved, target_type="model", target_id=result["model"],
        before={"production": result.get("previous_production")},
        after={"production": result["model"], "version": result["version"], "release_id": result["entry"].get("release_id"), "override": result["entry"].get("override")},
        reason=req.note,
    )
    return {"project_id": resolved, **result}


@app.get("/api/releases/policy")
def api_release_policy_get(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """Release Policy（プロジェクト毎のGateルール設定。未設定キー=ルール無効）。"""
    from .services.release_gate import normalize_policy
    from .services.release_manager import get_release_policy

    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "policy": normalize_policy(get_release_policy(resolved))}


@app.put("/api/releases/policy")
def api_release_policy_put(req: ReleasePolicyRequest, request: Request) -> dict[str, Any]:
    """Release Policyの保存（正規化して releases.json の policy へ保存）。"""
    from .services.release_gate import normalize_policy
    from .services.release_manager import get_release_policy, set_release_policy

    _enforce_role(request, "release_policy_update")
    resolved = _resolve_project_id(req.project_id)
    before = normalize_policy(get_release_policy(resolved))
    try:
        policy = set_release_policy(resolved, req.policy or {})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "release_policy_update", project_id=resolved, target_type="release_policy", target_id=resolved,
        before=before, after=policy,
    )
    return {"project_id": resolved, "policy": policy}


@app.get("/api/releases/gate")
def api_release_gate(
    model: str = Query(...), project_id: Optional[str] = Query(default="default")
) -> dict[str, Any]:
    """Release Gate判定（PASS / CONDITIONAL_PASS / FAIL / NOT_EVALUATED＋ルール毎の判定行）。"""
    from .services.release_gate import evaluate_release_gate

    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, **evaluate_release_gate(resolved, str(model))}


@app.post("/api/releases/rollback")
def api_release_rollback(req: ReleaseRollbackRequest, request: Request) -> dict[str, Any]:
    """Productionを過去のリリースVersionへ戻す（Version維持・新Release ID・rollback=true）。"""
    _enforce_role(request, "release_rollback")
    resolved = _resolve_project_id(req.project_id)
    try:
        result = rollback_release(resolved, req.version, author=req.author, note=req.note)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "release_rollback", project_id=resolved, target_type="model", target_id=result["model"],
        before={"production": result["entry"].get("previous_production")},
        after={"production": result["model"], "version": result["version"], "release_id": result["entry"].get("release_id")},
        reason=req.note,
    )
    return {"project_id": resolved, **result}


@app.get("/api/releases/model_card")
def api_release_model_card(
    project_id: Optional[str] = Query(default="default"),
    model: Optional[str] = Query(default=None, description="未指定=現Production"),
) -> dict[str, Any]:
    """Model Card（Markdown）の自動生成（概要・Version・用途・対象文字・評価条件・性能・制約・更新履歴）。"""
    resolved = _resolve_project_id(project_id)
    try:
        return {"project_id": resolved, **build_model_card(resolved, model)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/releases/deployment_package")
def api_release_deployment_package(request: Request, project_id: Optional[str] = Query(default="default")) -> Response:
    """Productionモデルの配布パッケージ（ZIP: traineddata/設定JSON/前処理Snapshot/Release Note/Model Card）。"""
    _enforce_role(request, "deployment_export")
    resolved = _resolve_project_id(project_id)
    try:
        filename, payload = build_deployment_package(resolved)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    _record_audit_safe(
        request, "deployment_export", project_id=resolved, target_type="deployment", target_id=filename,
        after={"file": filename, "size_bytes": len(payload)},
    )
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/benchmarks/engines")
def api_benchmark_engines() -> dict[str, Any]:
    """Benchmark対応エンジンカタログ＋実行環境での利用可否（未実装は「未導入・利用不可」明示）。"""
    from .services.benchmark import engine_catalog_with_availability

    return {"items": engine_catalog_with_availability()}


@app.get("/api/benchmarks")
def api_benchmarks(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """Benchmark一覧（新しい順・Leaderboard/用途別ベスト付き・casesは含めない）＋バランス重み設定。"""
    from .services.benchmark import list_benchmarks

    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, **list_benchmarks(resolved)}


@app.post("/api/benchmarks")
def api_benchmark_create(req: BenchmarkCreateRequest, request: Request) -> dict[str, Any]:
    """Benchmark実行（Job Management経由）。条件を検証してから job_type=benchmark のJobを作成する。"""
    from .services.benchmark import normalize_engine_spec, resolve_benchmark_preprocess

    _enforce_role(request, "benchmark_run")
    resolved = _resolve_project_id(req.project_id)
    try:
        engines = [normalize_engine_spec(spec) for spec in (req.engines or [])]
        if not engines:
            raise ValueError("Benchmark対象エンジンを1つ以上選択してください")
        # 前処理計画の事前検証（不正なmode・学習時前処理未記録・スナップショットなしはここで400）
        resolve_benchmark_preprocess(resolved, req.preprocess)
        job, deduplicated = get_job_service().create_job(
            project_id=resolved,
            job_type="benchmark",
            params={
                "project_id": resolved,
                "name": str(req.name or ""),
                "image_dir": str(req.image_dir or ""),
                "gt_csv": str(req.gt_csv or ""),
                "dataset_id": str(req.dataset_id or ""),
                "engines": engines,
                "warmup_runs": int(req.warmup_runs if req.warmup_runs is not None else 1),
                "preprocess": req.preprocess,
            },
            requested_by=str(req.requested_by or ""),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    ensure_worker_started()
    _record_audit_safe(
        request, "benchmark_run", project_id=resolved, target_type="benchmark_job", target_id=job["job_id"],
        job_id=job["job_id"],
        after={"name": str(req.name or ""), "engines": engines, "deduplicated": deduplicated},
    )
    return {"project_id": resolved, "job": job, "deduplicated": deduplicated}


@app.patch("/api/benchmarks/config")
def api_benchmark_config(req: BenchmarkConfigRequest) -> dict[str, Any]:
    """バランス最良スコアの重み設定（プロジェクト毎。合計1へ正規化して使用）。"""
    from .services.benchmark import set_balance_weights

    resolved = _resolve_project_id(req.project_id)
    try:
        weights = set_balance_weights(resolved, req.balance_weights or {})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"project_id": resolved, "balance_weights": weights}


@app.get("/api/benchmarks/{benchmark_id}")
def api_benchmark_detail(
    benchmark_id: str, project_id: Optional[str] = Query(default="default")
) -> dict[str, Any]:
    """Benchmark詳細（Leaderboard・用途別ベスト・画像単位ケース含む）。"""
    from .services.benchmark import get_benchmark

    resolved = _resolve_project_id(project_id)
    try:
        return {"project_id": resolved, "item": get_benchmark(resolved, benchmark_id)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/benchmarks/{benchmark_id}/export")
def api_benchmark_export(
    benchmark_id: str,
    kind: str = Query(default="summary"),
    project_id: Optional[str] = Query(default="default"),
) -> Response:
    """CSV（Excel対応）Export 3種: summary / cases / confusions（BOM付きUTF-8）。"""
    from .services.benchmark import export_benchmark_csv

    resolved = _resolve_project_id(project_id)
    try:
        filename, payload = export_benchmark_csv(resolved, benchmark_id, kind)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return Response(
        content=payload,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/models")
def models_endpoint(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    _recover_exported_ocr_runs(resolved)
    return {"project_id": resolved, "items": list_models(project_id=resolved)}


@app.get("/models/info")
def model_infos_endpoint(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    _recover_exported_ocr_runs(resolved)
    return {"project_id": resolved, "items": list_model_infos(project_id=resolved)}


@app.get("/api/models/download/{model_name}")
def download_model_endpoint(model_name: str, project_id: Optional[str] = Query(default="default")) -> FileResponse:
    resolved = _resolve_project_id(project_id)
    safe_name = Path(model_name).name
    if safe_name != model_name:
        raise HTTPException(status_code=400, detail="invalid model name")

    paths = ensure_project_directories(resolved)
    model_path = paths.models / safe_name
    if not model_path.exists() or not model_path.is_file():
        raise HTTPException(status_code=404, detail=f"model not found: {safe_name}")

    if safe_name.endswith(".pt"):
        return FileResponse(model_path, media_type="application/octet-stream", filename=safe_name)

    if safe_name.endswith(".tess.json"):
        meta = resolve_tesseract_model_meta(project_id=resolved, model=safe_name, ready_only=True)
        if not isinstance(meta, dict):
            raise HTTPException(status_code=404, detail=f"tesseract model metadata not found: {safe_name}")
        traineddata_raw = str(meta.get("traineddata_path") or "").strip()
        traineddata = Path(traineddata_raw).expanduser() if traineddata_raw else None
        if traineddata is None or not traineddata.exists() or not traineddata.is_file():
            raise HTTPException(status_code=404, detail=f"traineddata not found: {traineddata_raw}")
        return FileResponse(traineddata, media_type="application/octet-stream", filename=traineddata.name)

    if not safe_name.endswith(".ocr.json"):
        raise HTTPException(status_code=400, detail="only .pt, .ocr.json and .tess.json are downloadable")

    meta = resolve_ocr_model_meta(project_id=resolved, model=safe_name, engine=None)
    if not isinstance(meta, dict):
        raise HTTPException(status_code=404, detail=f"ocr model metadata not found: {safe_name}")

    inference_dir_raw = str(meta.get("inference_dir") or meta.get("model_dir") or "").strip()
    if not inference_dir_raw:
        raise HTTPException(status_code=400, detail=f"model has no inference_dir: {safe_name}")
    inference_dir = Path(inference_dir_raw).expanduser()
    if not inference_dir.exists() or not inference_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"inference_dir not found: {inference_dir}")

    required_candidates = [
        ("inference.json", "inference.pdmodel"),
        ("inference.pdiparams",),
        ("inference.yml",),
    ]
    selected_files: list[Path] = []
    for candidates in required_candidates:
        picked: Optional[Path] = None
        for name in candidates:
            candidate = inference_dir / name
            if candidate.exists() and candidate.is_file():
                picked = candidate
                break
        if picked is None:
            raise HTTPException(
                status_code=400,
                detail=f"inference file missing under {inference_dir}: one of {', '.join(candidates)}",
            )
        selected_files.append(picked)

    export_name = safe_name.replace(".ocr.json", "")
    tmp_zip = Path(tempfile.NamedTemporaryFile(delete=False, suffix=".zip").name)
    try:
        with zipfile.ZipFile(tmp_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            root = f"{export_name}/"
            for file_path in selected_files:
                zf.write(file_path, arcname=f"{root}{file_path.name}")
            zf.write(model_path, arcname=f"{root}{safe_name}")
        return FileResponse(
            tmp_zip,
            media_type="application/zip",
            filename=f"{export_name}.inference.zip",
            background=BackgroundTask(lambda: tmp_zip.unlink(missing_ok=True)),
        )
    except Exception as e:  # noqa: BLE001
        tmp_zip.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.delete("/models/{model_name}")
def delete_model_endpoint(
    model_name: str, request: Request, project_id: Optional[str] = Query(default="default")
) -> dict[str, Any]:
    _enforce_role(request, "model_delete")
    resolved = _resolve_project_id(project_id)
    try:
        deleted = delete_model(project_id=resolved, model_name=model_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "model_delete", project_id=resolved, target_type="model", target_id=model_name,
        before={"model": model_name}, after={"deleted": deleted},
    )
    return {"project_id": resolved, "deleted": deleted}


@app.get("/models/latest")
def model_latest(
    model_type: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default="default"),
    training_family: str = Query(default="classification"),
    engine: Optional[str] = Query(default=None),
) -> dict[str, str]:
    resolved = _resolve_project_id(project_id)
    normalized_family = str(training_family).strip().lower()
    normalized_engine = str(engine or "").strip().lower()
    if normalized_family == "tesseract" or normalized_engine == "tesseract":
        meta_file = latest_tesseract_model_meta(project_id=resolved, ready_only=True)
        if meta_file is None:
            return {"project_id": resolved, "model": ""}
        return {"project_id": resolved, "model": Path(str(meta_file)).name}
    if normalized_family == "ocr":
        _recover_exported_ocr_runs(resolved)
        model = latest_ocr_model_meta(project_id=resolved, engine=engine, inference_ready_only=True)
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
    include_lowercase: bool = Form(True),
    apply_preprocess: bool = Form(True),
    preprocess_overrides_json: str = Form(""),
    preprocess_mode: str = Form(""),
    project_id: str = Form("default"),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    suffix = Path(file.filename or "image.png").suffix or ".png"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    pre_tmp_path: Optional[str] = None
    try:
        langs = _normalize_easyocr_langs(easyocr_langs)
        overrides = _parse_preprocess_overrides_json(preprocess_overrides_json)
        # 推論前処理モード: ""=従来動作 / none=OCR入力整形のみ / manual=現在の前処理設定 /
        # training=モデルの学習時前処理（未記録の旧モデルは400・フォールバックしない）
        mode = str(preprocess_mode or "").strip().lower()
        if mode and mode not in {"none", "manual", "training"}:
            raise HTTPException(status_code=400, detail=f"unsupported preprocess_mode: {preprocess_mode}")
        inference_preprocess: Optional[dict[str, Any]] = None
        predict_source = tmp_path
        preprocess_preview_data_url = ""
        if mode == "training":
            if str(engine or "").strip().lower() == "custom":
                raise HTTPException(status_code=400, detail="分類モデル（custom）では学習時前処理モードは使用できません")
            record = resolve_model_training_preprocess(resolved, model)
            if record is None:
                raise HTTPException(status_code=400, detail=TRAINING_PREPROCESS_MISSING_MESSAGE)
            from PIL import ImageOps as _ImageOps

            with Image.open(tmp_path) as opened:
                oriented = _ImageOps.exif_transpose(opened)
                pre_img = apply_training_preprocess(oriented, record["training_preprocess"])
            with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as pre_tmp:
                pre_tmp_path = pre_tmp.name
            pre_img.save(pre_tmp_path)
            predict_source = pre_tmp_path
            preprocess_preview_data_url = _image_to_data_url(pre_img)
            inference_preprocess = {
                "mode": "training",
                "model": record["model"],
                "preprocess_hash": str(record.get("training_preprocess_hash") or ""),
                "snapshot_id": str((record["training_preprocess"] or {}).get("snapshot_id") or ""),
            }
            # 学習時前処理と手動上書きは併用しない（この後エンジン側でOCR入力整形のみ適用される）
            overrides = None
            apply_preprocess = True
        elif mode == "manual":
            # 現在の前処理設定（前処理設定画面の設定＋上書き）を適用してからOCR入力整形へ渡す
            preprocess_cfg = build_preprocess_config(overrides)
            pre = preprocess_image_for_model(tmp_path, force_image_type=None, config=preprocess_cfg)
            pre_img = Image.fromarray(pre["processed"], mode="L")
            with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as pre_tmp:
                pre_tmp_path = pre_tmp.name
            pre_img.save(pre_tmp_path)
            predict_source = pre_tmp_path
            preprocess_preview_data_url = _image_to_data_url(pre_img)
            inference_preprocess = {"mode": "manual", "image_type": str(pre.get("type") or ""), "pipeline": list(pre.get("pipeline") or [])}
            overrides = None
            apply_preprocess = True
        elif mode == "none":
            # 取込前処理なし（エンジン側のOCR入力整形のみ。分類モデルは従来どおり前処理適用）
            inference_preprocess = {"mode": "none"}
            overrides = None
        if not preprocess_preview_data_url and bool(apply_preprocess) and mode in {"", "none"}:
            try:
                preprocess_cfg = build_preprocess_config(overrides) if overrides else None
                pre = preprocess_image_for_model(tmp_path, force_image_type=None, config=preprocess_cfg)
                processed = pre.get("processed")
                if processed is not None:
                    processed_img = Image.fromarray(processed).convert("L")
                    preprocess_preview_data_url = _image_to_data_url(processed_img)
            except Exception:  # noqa: BLE001
                preprocess_preview_data_url = ""
        prediction = predict_from_image(
            predict_source,
            model_type=(model_type or None),
            model=model,
            project_id=resolved,
            engine=engine,
            easyocr_languages=langs,
            apply_preprocess=bool(apply_preprocess),
            preprocess_overrides=overrides,
            include_lowercase=bool(include_lowercase),
        )
        prediction["preprocess_preview_data_url"] = preprocess_preview_data_url
        if inference_preprocess is not None:
            prediction["inference_preprocess"] = inference_preprocess
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
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        if pre_tmp_path:
            Path(pre_tmp_path).unlink(missing_ok=True)


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
    include_lowercase: bool = Form(True),
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
                include_lowercase=bool(include_lowercase),
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
        "easyocr_langs": ",".join(langs),
        "include_lowercase": bool(include_lowercase),
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
    include_lowercase: bool = Form(True),
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
                include_lowercase=bool(include_lowercase),
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
    detect_preprocess_json: str = Form(""),
) -> dict[str, Any]:
    suffix = Path(file.filename or "image.png").suffix.lower()
    if suffix not in IMAGE_BUILDER_ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="unsupported image format")
    content = await file.read()
    try:
        detect_preprocess = parse_detection_preprocess_json(detect_preprocess_json)
        return make_resize_preview(
            content,
            int(resize_long_side),
            bool(use_resize),
            str(resize_axis),
            detect_preprocess=detect_preprocess,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/image-builder/detect")
async def image_builder_detect(
    file: UploadFile = File(...),
    resize_long_side: int = Form(...),
    use_resize: bool = Form(True),
    resize_axis: str = Form("long"),
    model: str = Form(...),
    model_source: str = Form(""),
    conf_threshold: float = Form(0.25),
    merge_overlaps: bool = Form(True),
    merge_iou_threshold: float = Form(0.5),
    project_id: str = Form("default"),
    detect_preprocess_json: str = Form(""),
    series_json: str = Form(""),
) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    content = await file.read()
    try:
        # 前処理が無指定または無変換設定の場合は None（従来どおり元画像で検出）
        detect_preprocess = parse_detection_preprocess_json(detect_preprocess_json)
        # 検出対象Series（class名のJSON配列）。空文字=未指定（従来どおり全class対象）
        series: Optional[list[str]] = None
        series_text = str(series_json or "").strip()
        if series_text:
            try:
                parsed_series = json.loads(series_text)
            except (TypeError, ValueError) as e:
                raise ValueError(f"invalid series_json: {e}") from e
            if not isinstance(parsed_series, list) or not all(isinstance(v, str) for v in parsed_series):
                raise ValueError("series_json must be an array of strings")
            if len(parsed_series) == 0:
                raise ValueError("検出対象Seriesを1つ以上選択してください")
            series = parsed_series
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
            detect_preprocess=detect_preprocess,
            model_source=str(model_source or ""),
            series=series,
        )
    except BuiltinYoloModelNotDownloadedError as e:
        # 検出API実行中は外部通信（自動ダウンロード）を行わない。未取得標準モデルは409で明示する
        raise HTTPException(status_code=409, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/image-builder/yolo-models/classes")
def image_builder_yolo_model_classes(
    model: str = Query(...),
    model_source: str = Query(""),
    project_id: Optional[str] = Query(default="default"),
) -> dict[str, Any]:
    """YOLOモデルのclass名一覧（Step2の検出対象Series候補）。解決規則は検出APIと同一。"""
    resolved = _resolve_project_id(project_id)
    try:
        return get_yolo_model_classes(project_id=resolved, model_name=model, model_source=str(model_source or ""))
    except BuiltinYoloModelNotDownloadedError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/image-builder/yolo-models/builtin/download")
def image_builder_download_builtin_yolo_model(req: BuiltinYoloDownloadRequest) -> dict[str, Any]:
    """Ultralytics標準モデルの明示取得（許可リスト内の名前のみ。取得済みなら再ダウンロードしない）。"""
    try:
        return download_builtin_yolo_model(req.model_name)
    except BuiltinYoloDownloadInProgressError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
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
    detect_preprocess_json: str = Form(""),
    project_id: str = Form(""),
    export_context_json: str = Form(""),
) -> dict[str, Any]:
    content = await file.read()
    try:
        detect_preprocess = parse_detection_preprocess_json(detect_preprocess_json)
        # Step5（評価用データ作成）が参照する確定情報（元画像名・モデル・Series）。空=マニフェスト情報なし
        export_context: Optional[dict[str, Any]] = None
        context_text = str(export_context_json or "").strip()
        if context_text:
            try:
                parsed_context = json.loads(context_text)
            except (TypeError, ValueError) as e:
                raise ValueError(f"invalid export_context_json: {e}") from e
            if not isinstance(parsed_context, dict):
                raise ValueError("export_context_json must be an object")
            export_context = parsed_context
        return export_selected_crops(
            image_bytes=content,
            long_side=int(resize_long_side),
            use_resize=bool(use_resize),
            resize_axis=str(resize_axis),
            boxes_json=boxes_json,
            output_dir=output_dir,
            crop_height=int(crop_height),
            detect_preprocess=detect_preprocess,
            project_id=_resolve_project_id(project_id) if str(project_id or "").strip() else "",
            export_context=export_context,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/image-builder/evaluation/candidates")
def image_builder_evaluation_candidates(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """Step4出力マニフェストから評価候補（クロップ一覧）を返す。"""
    resolved = _resolve_project_id(project_id)
    return list_export_candidates(resolved)


@app.get("/image-builder/evaluation/crop")
def image_builder_evaluation_crop(
    export_id: str = Query(...),
    filename: str = Query(...),
    rotation: int = Query(0),
    max_side: int = Query(0),
    project_id: Optional[str] = Query(default="default"),
) -> Response:
    """評価候補クロップのプレビュー/サムネイル（回転はその場で適用。元ファイルは変更しない）。"""
    resolved = _resolve_project_id(project_id)
    try:
        img = load_export_crop_image(resolved, export_id, filename, rotation=int(rotation))
        if int(max_side) > 0:
            img.thumbnail((int(max_side), int(max_side)))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        # rotationがURLに含まれ回転ごとに別URLになるため短期キャッシュ可（サムネイルの
        # 再取得がOCR・保存リクエストとブラウザ同時接続枠を奪い合うのを防ぐ）
        return Response(content=buf.getvalue(), media_type="image/png", headers={"Cache-Control": "private, max-age=300"})
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/image-builder/evaluation/directory-images")
def image_builder_evaluation_directory_images(directory: str = Query(...)) -> dict[str, Any]:
    """指定フォルダ直下の画像一覧（Step5「フォルダから読み込む」用。サブフォルダは対象外）。"""
    try:
        return list_directory_images(directory)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/image-builder/evaluation/directory-image")
def image_builder_evaluation_directory_image(
    directory: str = Query(...),
    filename: str = Query(...),
    rotation: int = Query(0),
    max_side: int = Query(0),
) -> Response:
    """フォルダ画像のプレビュー/サムネイル（EXIF反映＋回転をその場適用。元ファイルは変更しない）。"""
    try:
        img = load_directory_image(directory, filename, rotation=int(rotation))
        if int(max_side) > 0:
            img.thumbnail((int(max_side), int(max_side)))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        # rotationがURLに含まれ回転ごとに別URLになるため短期キャッシュ可（サムネイルの
        # 再取得がOCR・保存リクエストとブラウザ同時接続枠を奪い合うのを防ぐ）
        return Response(content=buf.getvalue(), media_type="image/png", headers={"Cache-Control": "private, max-age=300"})
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/image-builder/evaluation/state")
def image_builder_evaluation_state(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """Step5の途中保存状態（プロジェクト単位）。"""
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "state": load_editing_state(resolved)}


@app.post("/image-builder/evaluation/state")
def image_builder_evaluation_state_save(req: EvaluationStateSaveRequest) -> dict[str, Any]:
    resolved = _resolve_project_id(req.project_id)
    try:
        return save_editing_state(resolved, req.state)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/evaluation/datasets")
def api_evaluation_datasets(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    """作成済み評価データセット一覧（モデル評価画面の選択候補）。"""
    resolved = _resolve_project_id(project_id)
    return list_evaluation_datasets(resolved)


@app.delete("/api/evaluation/datasets/{dataset_id}")
def api_evaluation_dataset_delete(
    dataset_id: str, project_id: Optional[str] = Query(default="default")
) -> dict[str, Any]:
    """評価データセット一式（images/CSV/metadata/editing_state）を削除。"""
    resolved = _resolve_project_id(project_id)
    try:
        return delete_evaluation_dataset(resolved, dataset_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/evaluation/datasets/{dataset_id}/rename")
def api_evaluation_dataset_rename(dataset_id: str, req: EvaluationDatasetRenameRequest) -> dict[str, Any]:
    """評価データセット名の変更（CSV・画像参照はディレクトリ内相対のため壊れない）。"""
    resolved = _resolve_project_id(req.project_id)
    try:
        return rename_evaluation_dataset(resolved, dataset_id, req.new_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/evaluation/datasets/{dataset_id}/overlap")
def api_evaluation_dataset_overlap(
    dataset_id: str, project_id: Optional[str] = Query(default="default")
) -> dict[str, Any]:
    """学習データ（outputs/ocr_dataset）との重複チェック（sha256→元画像+BBoxID→ファイル名）。"""
    resolved = _resolve_project_id(project_id)
    try:
        return check_training_overlap(resolved, dataset_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/image-builder/evaluation/create")
def image_builder_evaluation_create(req: EvaluationDatasetCreateRequest) -> dict[str, Any]:
    """評価データセットを作成（画像コピー＋回転焼き込み＋ground_truth.csv＋metadata.json）。"""
    resolved = _resolve_project_id(req.project_id)
    try:
        return create_evaluation_dataset(
            project_id=resolved,
            dataset_name=req.dataset_name,
            items=[item.model_dump() for item in req.items],
            editing_state=req.editing_state,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
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


@app.post("/api/ocr/evaluate")
def api_ocr_evaluate(req: OcrEvaluateRequest, request: Request) -> dict[str, Any]:
    project_id = _resolve_project_id(req.project_id)
    try:
        result = evaluate_ocr(
            project_id=project_id,
            image_dir=req.image_dir,
            gt_csv=req.gt_csv,
            targets=[t.model_dump() for t in req.targets],
            charset=req.charset,
            psm=req.psm,
            eval_preprocess=req.eval_preprocess,
            preprocess_source=str(req.preprocess_source or "none"),
            preprocess_mode=req.preprocess_mode,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _record_audit_safe(
        request, "evaluation_run", project_id=project_id, target_type="evaluation",
        target_id=",".join(str(t.get("model") or "") for t in (result.get("targets") or []) if not t.get("is_base"))[:200],
        after={
            "count": result.get("count"),
            "targets": [
                {"model": t.get("model"), "cer": t.get("cer"), "accuracy_percent": t.get("accuracy_percent")}
                for t in (result.get("targets") or [])
            ],
        },
    )
    return result


@app.post("/api/ocr/training-preprocess/preview")
def api_training_preprocess_preview(req: TrainingPreprocessPreviewRequest) -> dict[str, Any]:
    """モデルの学習時前処理を適用したプレビュー（元画像→学習時前処理後→OCR入力整形後）。

    学習時前処理が未記録の旧モデルは400（固定値へ自動フォールバックしない）。
    元ファイルは変更しない（メモリ内変換のみ）。
    """
    from .services.ocr_pipeline import preprocess_ocr_image

    resolved = _resolve_project_id(req.project_id)
    record = resolve_model_training_preprocess(resolved, req.model)
    if record is None:
        raise HTTPException(status_code=400, detail=TRAINING_PREPROCESS_MISSING_MESSAGE)
    try:
        img = load_directory_image(req.directory, req.filename, rotation=0)
        training_preprocess = record["training_preprocess"]
        preprocessed = apply_training_preprocess(img, training_preprocess)
        normalization = (
            training_preprocess.get("ocr_input_normalization")
            if isinstance(training_preprocess.get("ocr_input_normalization"), dict)
            else {}
        )
        target_h = int(normalization.get("target_height") or 48)
        canvas_w = int(normalization.get("canvas_width") or 320)
        normalized = preprocess_ocr_image(preprocessed, image_shape=[1, target_h, canvas_w], strong=False)
        return {
            "model": record["model"],
            "training_preprocess_hash": str(record.get("training_preprocess_hash") or ""),
            "snapshot_id": str(training_preprocess.get("snapshot_id") or ""),
            "preprocessed_data_url": _image_to_data_url(preprocessed, max_side=512),
            "normalized_data_url": _image_to_data_url(normalized, max_side=512),
        }
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
