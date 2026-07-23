"""運用ダッシュボード・ヘルスチェック（Operations）。

- ダッシュボード: 実行中/待機中/失敗Job・Production＋Release Gate状態・最近のBenchmark・
  データ使用量・未評価Candidate・バックアップ状態を1画面分のJSONで返す
- ヘルスチェック: /health（死活）/ /health/ready（受付可否）/ /health/details（管理者向け詳細）。
  確認項目: Backendバージョン・データDir書き込み・Tesseract・PaddleOCR・GPU・JobWorker・
  ディスク空き・設定ファイル・モデルDir。取得不能な値はnull（推測しない）
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .. import project_paths as project_paths_module
from ..project_paths import ensure_project_directories


def _dir_size_mb(path: Path) -> Optional[float]:
    try:
        total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        return round(total / (1024 * 1024), 1)
    except OSError:
        return None


def _latest_backup(project_id: str) -> Optional[dict[str, Any]]:
    """最新バックアップの要約（Phase 5のバックアップ機能が保存する index を参照）。なければNone。"""
    try:
        index_path = Path(project_paths_module.PROJECTS_DIR).parent / "backups" / "index.json"
        payload = json.loads(index_path.read_text(encoding="utf-8"))
        items = [i for i in payload.get("items", []) if i.get("project_id") == project_id]
        return items[-1] if items else None
    except (OSError, ValueError):
        return None


def build_dashboard(project_id: Optional[str]) -> dict[str, Any]:
    """運用ダッシュボード（現在のプロジェクト＋システム全体のJob状況）。"""
    from .benchmark import list_benchmarks
    from .job_manager import get_job_service, get_job_worker
    from .release_gate import evaluate_release_gate
    from .release_manager import list_releases

    paths = ensure_project_directories(project_id)
    pid = paths.project_id

    # Job状況（システム全体）
    jobs = get_job_service().repository.list()
    job_summary = {
        "running": sum(1 for j in jobs if j.get("status") == "running"),
        "queued": sum(1 for j in jobs if j.get("status") in {"queued", "cancel_requested"}),
        "failed_recent": sum(1 for j in jobs[-50:] if j.get("status") == "failed"),
        "worker_alive": get_job_worker().is_alive(),
        "recent": [
            {k: j.get(k) for k in ("job_id", "job_type", "project_id", "status", "progress", "created_at")}
            for j in list(reversed(jobs))[:5]
        ],
    }

    # Production＋Release Gate状態
    releases = list_releases(pid)
    production = str(releases.get("production") or "")
    gate = evaluate_release_gate(pid, production) if production else None
    statuses = releases.get("statuses") or {}

    # 未評価Candidate（Candidateだが実験カルテに評価がないモデル）
    from .experiment_tracker import list_experiments

    experiments = list_experiments(pid, backfill=False)
    evaluated_models = {
        str(m)
        for item in experiments
        if isinstance(item.get("evaluation"), dict)
        for m in (item.get("models") or [])
    }
    unevaluated_candidates = [
        name
        for name, record in statuses.items()
        if record.get("status") == "Candidate" and name not in evaluated_models
    ]

    # 最近のBenchmark
    benchmarks = list_benchmarks(pid)["items"]
    latest_bench = None
    if benchmarks:
        top = (benchmarks[0].get("results") or [None])[0]
        latest_bench = {
            "benchmark_id": benchmarks[0].get("benchmark_id"),
            "name": benchmarks[0].get("name"),
            "created_at": benchmarks[0].get("created_at"),
            "engines": len(benchmarks[0].get("results") or []),
            "best": {"label": top.get("label"), "cer": top.get("cer")} if top else None,
        }

    # データ使用量（現在のプロジェクト）
    data_usage = {
        "raw_mb": _dir_size_mb(paths.raw),
        "processed_mb": _dir_size_mb(paths.processed),
        "models_mb": _dir_size_mb(paths.models),
        "outputs_mb": _dir_size_mb(paths.outputs),
        "total_mb": _dir_size_mb(paths.root),
    }

    return {
        "project_id": pid,
        "generated_at": datetime.now().isoformat(),
        "jobs": job_summary,
        "production": {
            "model": production,  # Productionは0件（空文字）または1件
            "version": str((statuses.get(production) or {}).get("version") or "") if production else "",
            "gate_verdict": gate["verdict"] if gate else None,
            "gate_failed_rules": [r["rule"] for r in (gate["rules"] if gate else []) if r.get("result") == "fail"],
        },
        "unevaluated_candidates": unevaluated_candidates,
        "latest_benchmark": latest_bench,
        "data_usage": data_usage,
        "backup": _latest_backup(pid),
    }


# ---------- ヘルスチェック ----------


def check_ready() -> dict[str, Any]:
    """受付可否（データDir書き込み＋設定ファイル）。失敗があれば ready=false。"""
    checks = {
        "data_dir_writable": _check_data_writable()["ok"],
        "settings_loadable": _check_settings()["ok"],
    }
    return {"ready": all(checks.values()), "checks": checks}


def _check_data_writable() -> dict[str, Any]:
    try:
        probe = Path(project_paths_module.PROJECTS_DIR).parent / ".health_probe"
        probe.write_text(datetime.now().isoformat(), encoding="utf-8")
        probe.unlink(missing_ok=True)
        return {"ok": True, "detail": str(Path(project_paths_module.PROJECTS_DIR).parent)}
    except OSError as e:
        return {"ok": False, "detail": str(e)[:200]}


def _check_settings() -> dict[str, Any]:
    try:
        from ..config import get_settings

        get_settings()
        return {"ok": True, "detail": "config/settings.yaml"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "detail": str(e)[:200]}


def build_health_details() -> dict[str, Any]:
    """管理者向けの詳細ヘルスチェック。取得不能な値はnull（推測しない）。"""
    from .job_manager import get_job_worker

    # Tesseract
    tesseract: dict[str, Any] = {"ok": False, "detail": ""}
    try:
        from .tesseract_pipeline import ensure_tesseract_inference_tool

        tesseract = {"ok": True, "detail": ensure_tesseract_inference_tool()}
    except Exception as e:  # noqa: BLE001
        tesseract = {"ok": False, "detail": str(e)[:200]}

    # PaddleOCR / GPU
    try:
        import paddleocr  # type: ignore # noqa: F401

        paddle = {"ok": True, "detail": "importable"}
    except Exception as e:  # noqa: BLE001
        paddle = {"ok": False, "detail": str(e)[:200]}
    try:
        from .ocr_pipeline import detect_paddle_gpu_available

        gpu: dict[str, Any] = {"ok": bool(detect_paddle_gpu_available()), "detail": ""}
    except Exception:  # noqa: BLE001
        gpu = {"ok": None, "detail": "判定不能"}

    # ディスク空き
    try:
        usage = shutil.disk_usage(str(Path(project_paths_module.PROJECTS_DIR).parent))
        disk = {
            "ok": usage.free > 1024**3,  # 1GB未満で警告
            "detail": f"空き {usage.free / 1024**3:.1f}GB / 全体 {usage.total / 1024**3:.1f}GB",
        }
    except OSError as e:
        disk = {"ok": None, "detail": str(e)[:200]}

    models_dir = Path(project_paths_module.PROJECTS_DIR)
    checks = {
        "backend": {"ok": True, "detail": "FastAPI 稼働中"},
        "data_dir_writable": _check_data_writable(),
        "settings": _check_settings(),
        "tesseract": tesseract,
        "paddleocr": paddle,
        "gpu": gpu,
        "job_worker": {
            "ok": get_job_worker().is_alive(),
            "detail": "稼働中" if get_job_worker().is_alive() else "停止（Job作成時に自動起動）",
        },
        "disk": disk,
        "projects_dir": {"ok": models_dir.is_dir(), "detail": str(models_dir)},
    }
    problems = [name for name, check in checks.items() if check.get("ok") is False]
    return {
        "status": "degraded" if problems else "ok",
        "problems": problems,
        "checks": checks,
        "checked_at": datetime.now().isoformat(),
    }
