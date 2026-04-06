import sqlite3
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
                model_type TEXT NOT NULL,
                epochs INTEGER NOT NULL,
                batch_size INTEGER NOT NULL,
                learning_rate REAL NOT NULL DEFAULT 0.001,
                status TEXT NOT NULL,
                message TEXT,
                model_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

        columns = [row[1] for row in conn.execute("PRAGMA table_info(training_jobs)").fetchall()]
        if "project_id" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'")
        if "learning_rate" not in columns:
            conn.execute("ALTER TABLE training_jobs ADD COLUMN learning_rate REAL NOT NULL DEFAULT 0.001")
        conn.commit()


def upsert_training_job(job: dict[str, Any]) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO training_jobs (
                id, project_id, model_type, epochs, batch_size, learning_rate, status, message, model_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                project_id=excluded.project_id,
                model_type=excluded.model_type,
                epochs=excluded.epochs,
                batch_size=excluded.batch_size,
                learning_rate=excluded.learning_rate,
                status=excluded.status,
                message=excluded.message,
                model_path=excluded.model_path,
                updated_at=excluded.updated_at
            """,
            (
                job["id"],
                job["project_id"],
                job["model_type"],
                job["epochs"],
                job["batch_size"],
                job.get("learning_rate", 1e-3),
                job["status"],
                job.get("message"),
                job.get("model_path"),
                job["created_at"],
                job["updated_at"],
            ),
        )
        conn.commit()


def fetch_training_job(job_id: str) -> Optional[dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT id, model_type, epochs, batch_size, learning_rate, status, message, model_path, created_at, updated_at
            , project_id
            FROM training_jobs WHERE id = ?
            """,
            (job_id,),
        ).fetchone()

    if row is None:
        return None

    keys = [
        "id",
        "model_type",
        "epochs",
        "batch_size",
        "learning_rate",
        "status",
        "message",
        "model_path",
        "created_at",
        "updated_at",
        "project_id",
    ]
    return dict(zip(keys, row))


def delete_training_jobs_by_project(project_id: str) -> int:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM training_jobs WHERE project_id = ?", (project_id,))
        conn.commit()
        return max(cur.rowcount, 0)
