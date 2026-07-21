import sqlite3
import json
from pathlib import Path
from typing import Any, Optional

from .config import get_settings
from .paths import PROJECT_ROOT


def _db_path() -> Path:
    settings = get_settings()
    return PROJECT_ROOT / settings["app"].get("db_path", "outputs/app.db")


def get_conn() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(path)


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS training_jobs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL DEFAULT 'default',
                training_family TEXT NOT NULL DEFAULT 'classification',
                engine TEXT NOT NULL DEFAULT 'custom',
                model_type TEXT NOT NULL,
                epochs INTEGER NOT NULL,
                batch_size INTEGER NOT NULL,
                device TEXT NOT NULL DEFAULT 'auto',
                auto_batch_size INTEGER NOT NULL DEFAULT 0,
                train_num_workers INTEGER NOT NULL DEFAULT 0,
                eval_num_workers INTEGER NOT NULL DEFAULT 0,
                save_epoch_step INTEGER NOT NULL DEFAULT 10,
                use_amp INTEGER NOT NULL DEFAULT 0,
                pin_memory INTEGER NOT NULL DEFAULT 0,
                persistent_workers INTEGER NOT NULL DEFAULT 0,
                resolved_device TEXT,
                learning_rate REAL NOT NULL DEFAULT 0.001,
                training_mode TEXT NOT NULL DEFAULT 'scratch',
                init_source_type TEXT,
                init_source_value TEXT,
                freeze_backbone_epochs INTEGER NOT NULL DEFAULT 0,
                backbone_lr_scale REAL NOT NULL DEFAULT 1.0,
                charset TEXT,
                max_text_length INTEGER,
                dataset_dir TEXT,
                paddle_repo_dir TEXT,
                image_shape TEXT,
                status TEXT NOT NULL,
                message TEXT,
                model_path TEXT,
                worker_pid INTEGER,
                log_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

        columns = [row[1] for row in conn.execute("PRAGMA table_info(training_jobs)").fetchall()]
        if "project_id" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'")
        if "training_family" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN training_family TEXT NOT NULL DEFAULT 'classification'")
        if "engine" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN engine TEXT NOT NULL DEFAULT 'custom'")
        if "learning_rate" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN learning_rate REAL NOT NULL DEFAULT 0.001")
        if "device" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN device TEXT NOT NULL DEFAULT 'auto'")
        if "auto_batch_size" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN auto_batch_size INTEGER NOT NULL DEFAULT 0")
        if "train_num_workers" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN train_num_workers INTEGER NOT NULL DEFAULT 0")
        if "eval_num_workers" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN eval_num_workers INTEGER NOT NULL DEFAULT 0")
        if "save_epoch_step" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN save_epoch_step INTEGER NOT NULL DEFAULT 10")
        if "use_amp" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN use_amp INTEGER NOT NULL DEFAULT 0")
        if "pin_memory" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN pin_memory INTEGER NOT NULL DEFAULT 0")
        if "persistent_workers" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN persistent_workers INTEGER NOT NULL DEFAULT 0")
        if "resolved_device" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN resolved_device TEXT")
        if "training_mode" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN training_mode TEXT NOT NULL DEFAULT 'scratch'")
        if "init_source_type" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN init_source_type TEXT")
        if "init_source_value" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN init_source_value TEXT")
        if "freeze_backbone_epochs" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN freeze_backbone_epochs INTEGER NOT NULL DEFAULT 0")
        if "backbone_lr_scale" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN backbone_lr_scale REAL NOT NULL DEFAULT 1.0")
        if "charset" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN charset TEXT")
        if "max_text_length" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN max_text_length INTEGER")
        if "dataset_dir" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN dataset_dir TEXT")
        if "paddle_repo_dir" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN paddle_repo_dir TEXT")
        if "image_shape" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN image_shape TEXT")
        if "log_path" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN log_path TEXT")
        if "worker_pid" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN worker_pid INTEGER")
        if "experiment_meta" not in columns:
            # 実験情報（experiment_name / parent_model_id / training_note）のJSON文字列。
            # モデルメタ（.tess.json等）へ引き継ぐための一時保管（後方互換のためNULL可）
            conn.execute("ALTER TABLE training_jobs ADD COLUMN experiment_meta TEXT")
        conn.commit()


def upsert_training_job(job: dict[str, Any]) -> None:
    training_family = str(job.get("training_family") or "classification")
    engine = str(job.get("engine") or ("custom" if training_family == "classification" else "paddleocr"))
    device = str(job.get("device") or "auto")
    auto_batch_size = 1 if bool(job.get("auto_batch_size", False)) else 0
    train_num_workers = int(job.get("train_num_workers") or 0)
    eval_num_workers = int(job.get("eval_num_workers") or 0)
    save_epoch_step = int(job.get("save_epoch_step") or 10)
    use_amp = 1 if bool(job.get("use_amp", False)) else 0
    pin_memory = 1 if bool(job.get("pin_memory", False)) else 0
    persistent_workers = 1 if bool(job.get("persistent_workers", False)) else 0
    resolved_device = str(job.get("resolved_device") or "")
    training_mode = str(job.get("training_mode") or "scratch")
    init_source_type = job.get("init_source_type")
    init_source_value = job.get("init_source_value")
    freeze_backbone_epochs = int(job.get("freeze_backbone_epochs") or 0)
    backbone_lr_scale = float(job.get("backbone_lr_scale") or 1.0)
    charset = job.get("charset")
    max_text_length = job.get("max_text_length")
    dataset_dir = job.get("dataset_dir")
    paddle_repo_dir = job.get("paddle_repo_dir")
    worker_pid = job.get("worker_pid")
    image_shape = job.get("image_shape")
    if isinstance(image_shape, (list, tuple, dict)):
        image_shape = json.dumps(image_shape, ensure_ascii=False)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO training_jobs (
                id, project_id, training_family, engine, model_type, epochs, batch_size, device, auto_batch_size, train_num_workers, eval_num_workers, save_epoch_step, use_amp, pin_memory, persistent_workers, resolved_device, learning_rate, training_mode, init_source_type, init_source_value, freeze_backbone_epochs, backbone_lr_scale, charset, max_text_length, dataset_dir, paddle_repo_dir, image_shape, status, message, model_path, worker_pid, log_path, experiment_meta, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                project_id=excluded.project_id,
                training_family=excluded.training_family,
                engine=excluded.engine,
                model_type=excluded.model_type,
                epochs=excluded.epochs,
                batch_size=excluded.batch_size,
                device=excluded.device,
                auto_batch_size=excluded.auto_batch_size,
                train_num_workers=excluded.train_num_workers,
                eval_num_workers=excluded.eval_num_workers,
                save_epoch_step=excluded.save_epoch_step,
                use_amp=excluded.use_amp,
                pin_memory=excluded.pin_memory,
                persistent_workers=excluded.persistent_workers,
                resolved_device=excluded.resolved_device,
                learning_rate=excluded.learning_rate,
                training_mode=excluded.training_mode,
                init_source_type=excluded.init_source_type,
                init_source_value=excluded.init_source_value,
                freeze_backbone_epochs=excluded.freeze_backbone_epochs,
                backbone_lr_scale=excluded.backbone_lr_scale,
                charset=excluded.charset,
                max_text_length=excluded.max_text_length,
                dataset_dir=excluded.dataset_dir,
                paddle_repo_dir=excluded.paddle_repo_dir,
                image_shape=excluded.image_shape,
                status=excluded.status,
                message=excluded.message,
                model_path=excluded.model_path,
                worker_pid=excluded.worker_pid,
                log_path=excluded.log_path,
                experiment_meta=excluded.experiment_meta,
                updated_at=excluded.updated_at
            """,
            (
                job["id"],
                job["project_id"],
                training_family,
                engine,
                job["model_type"],
                job["epochs"],
                job["batch_size"],
                device,
                auto_batch_size,
                train_num_workers,
                eval_num_workers,
                save_epoch_step,
                use_amp,
                pin_memory,
                persistent_workers,
                resolved_device,
                job.get("learning_rate", 1e-3),
                training_mode,
                init_source_type,
                init_source_value,
                freeze_backbone_epochs,
                backbone_lr_scale,
                charset,
                max_text_length,
                dataset_dir,
                paddle_repo_dir,
                image_shape,
                job["status"],
                job.get("message"),
                job.get("model_path"),
                worker_pid,
                job.get("log_path"),
                job.get("experiment_meta"),
                job["created_at"],
                job["updated_at"],
            ),
        )
        conn.commit()


def fetch_training_job(job_id: str) -> Optional[dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT id, project_id, training_family, engine, model_type, epochs, batch_size, device, auto_batch_size, train_num_workers, eval_num_workers, save_epoch_step, use_amp, pin_memory, persistent_workers, resolved_device, learning_rate, training_mode, init_source_type, init_source_value, freeze_backbone_epochs, backbone_lr_scale, charset, max_text_length, dataset_dir, paddle_repo_dir, image_shape, status, message, model_path, worker_pid, log_path, experiment_meta, created_at, updated_at
            FROM training_jobs WHERE id = ?
            """,
            (job_id,),
        ).fetchone()

    if row is None:
        return None

    keys = [
        "id",
        "project_id",
        "training_family",
        "engine",
        "model_type",
        "epochs",
        "batch_size",
        "device",
        "auto_batch_size",
        "train_num_workers",
        "eval_num_workers",
        "save_epoch_step",
        "use_amp",
        "pin_memory",
        "persistent_workers",
        "resolved_device",
        "learning_rate",
        "training_mode",
        "init_source_type",
        "init_source_value",
        "freeze_backbone_epochs",
        "backbone_lr_scale",
        "charset",
        "max_text_length",
        "dataset_dir",
        "paddle_repo_dir",
        "image_shape",
        "status",
        "message",
        "model_path",
        "worker_pid",
        "log_path",
        "experiment_meta",
        "created_at",
        "updated_at",
    ]
    payload = dict(zip(keys, row))
    payload["auto_batch_size"] = bool(payload.get("auto_batch_size", 0))
    payload["use_amp"] = bool(payload.get("use_amp", 0))
    payload["pin_memory"] = bool(payload.get("pin_memory", 0))
    payload["persistent_workers"] = bool(payload.get("persistent_workers", 0))
    image_shape_raw = payload.get("image_shape")
    if isinstance(image_shape_raw, str) and image_shape_raw.strip():
        try:
            payload["image_shape"] = json.loads(image_shape_raw)
        except Exception:  # noqa: BLE001
            payload["image_shape"] = image_shape_raw
    return payload


# 実行中とみなすジョブ状態（開始要求の二重実行防止・再接続の対象）
ACTIVE_TRAINING_STATUSES = ("queued", "running")


def fetch_active_training_job(project_id: str, training_family: Optional[str] = None) -> Optional[dict[str, Any]]:
    """プロジェクト内のアクティブ（queued/running）な学習ジョブを1件返す。無ければ None。

    training_family を指定した場合はその系統（ocr / classification）のみ対象。
    複数存在する場合は最新（updated_at 降順）の1件。
    """
    placeholders = ",".join("?" for _ in ACTIVE_TRAINING_STATUSES)
    query = f"SELECT id FROM training_jobs WHERE project_id = ? AND status IN ({placeholders})"
    params: list[Any] = [project_id, *ACTIVE_TRAINING_STATUSES]
    if training_family:
        query += " AND training_family = ?"
        params.append(training_family)
    query += " ORDER BY updated_at DESC LIMIT 1"
    with get_conn() as conn:
        row = conn.execute(query, params).fetchone()
    if row is None:
        return None
    return fetch_training_job(str(row[0]))


def delete_training_jobs_by_project(project_id: str) -> int:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM training_jobs WHERE project_id = ?", (project_id,))
        conn.commit()
        return max(cur.rowcount, 0)
