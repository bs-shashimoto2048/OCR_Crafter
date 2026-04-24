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
        conn.commit()


def upsert_training_job(job: dict[str, Any]) -> None:
    training_family = str(job.get("training_family") or "classification")
    engine = str(job.get("engine") or ("custom" if training_family == "classification" else "paddleocr"))
    training_mode = str(job.get("training_mode") or "scratch")
    init_source_type = job.get("init_source_type")
    init_source_value = job.get("init_source_value")
    freeze_backbone_epochs = int(job.get("freeze_backbone_epochs") or 0)
    backbone_lr_scale = float(job.get("backbone_lr_scale") or 1.0)
    charset = job.get("charset")
    max_text_length = job.get("max_text_length")
    dataset_dir = job.get("dataset_dir")
    paddle_repo_dir = job.get("paddle_repo_dir")
    image_shape = job.get("image_shape")
    if isinstance(image_shape, (list, tuple, dict)):
        image_shape = json.dumps(image_shape, ensure_ascii=False)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO training_jobs (
                id, project_id, training_family, engine, model_type, epochs, batch_size, learning_rate, training_mode, init_source_type, init_source_value, freeze_backbone_epochs, backbone_lr_scale, charset, max_text_length, dataset_dir, paddle_repo_dir, image_shape, status, message, model_path, log_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                project_id=excluded.project_id,
                training_family=excluded.training_family,
                engine=excluded.engine,
                model_type=excluded.model_type,
                epochs=excluded.epochs,
                batch_size=excluded.batch_size,
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
                log_path=excluded.log_path,
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
                job.get("log_path"),
                job["created_at"],
                job["updated_at"],
            ),
        )
        conn.commit()


def fetch_training_job(job_id: str) -> Optional[dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT id, project_id, training_family, engine, model_type, epochs, batch_size, learning_rate, training_mode, init_source_type, init_source_value, freeze_backbone_epochs, backbone_lr_scale, charset, max_text_length, dataset_dir, paddle_repo_dir, image_shape, status, message, model_path, log_path, created_at, updated_at
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
        "log_path",
        "created_at",
        "updated_at",
    ]
    payload = dict(zip(keys, row))
    image_shape_raw = payload.get("image_shape")
    if isinstance(image_shape_raw, str) and image_shape_raw.strip():
        try:
            payload["image_shape"] = json.loads(image_shape_raw)
        except Exception:  # noqa: BLE001
            payload["image_shape"] = image_shape_raw
    return payload


def delete_training_jobs_by_project(project_id: str) -> int:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM training_jobs WHERE project_id = ?", (project_id,))
        conn.commit()
        return max(cur.rowcount, 0)
