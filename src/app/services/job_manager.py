"""バックグラウンドジョブ管理（Job Management）。

前処理・データセット作成・学習・評価・Benchmark・Deployment Package生成を
統一のJobとして管理する。既存の同期APIは維持し、新しいJob API経由でも
同じ処理を呼び出せる構造（ハンドラが既存サービスを呼ぶ）。

レイヤ構成（将来Redis/Celery/RQ・SQLiteへ交換できるよう分離）:
- JobRepository: 永続化（現在は data/jobs/jobs.json。インターフェースを固定し
  SQLite等へ差し替え可能）
- JobService: 採番・状態遷移検証・同時実行制御・キャンセル・再実行
- JobWorker: 単一プロセス・単一Workerのキュー消化スレッド
- JobHandler: 種別ごとの実処理（既存サービスを呼ぶ。progress/cancelコールバック付き）

仕様:
- Job ID: JOB-000001 形式・システム全体（全プロジェクト横断）で一意・再利用しない
- 状態: queued → running → succeeded / failed / (cancel_requested → cancelled)。
  不正遷移（例: succeeded→running）は拒否
- 同時実行制御: 学習=システム全体で1件 / 前処理=同一プロジェクトで1件 /
  評価=同一プロジェクト×同一モデルの重複防止 / benchmark=設定可能な同時数（既定1）。
  重複要求は既存のアクティブJobを返す（deduplicated=true。409ではなく統一して既存ID返却）
- 進捗: 0〜100%＋ステップ名。イベントは data/jobs/events/JOB-xxxxxx.jsonl へ追記
  （現在はポーリング取得。将来SSEへ移行できるようイベント形式を分離）
- エラー: ユーザー向けには要約のみ（error_summary）。スタックトレースは
  data/jobs/logs/JOB-xxxxxx.log へ保存し画面へ出さない
"""

from __future__ import annotations

import json
import threading
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from .. import project_paths as project_paths_module

JOB_TYPES = ["preprocess", "dataset_creation", "training", "evaluation", "benchmark", "deployment_export"]
# interrupted: Backend再起動でrunning/cancel_requestedのまま残ったJobの回収先
# （終端扱い・再実行可能。永続的にrunning表示のまま残さないための状態）
JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancel_requested", "cancelled", "interrupted"]

# 許可される状態遷移（これ以外は拒否）
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "queued": {"running", "cancel_requested", "cancelled"},
    "running": {"succeeded", "failed", "cancel_requested", "interrupted"},
    "cancel_requested": {"cancelled", "succeeded", "failed", "interrupted"},
    "succeeded": set(),
    "failed": set(),
    "cancelled": set(),
    "interrupted": set(),
}

ACTIVE_STATUSES = {"queued", "running", "cancel_requested"}


class JobCancelled(Exception):
    """ハンドラ内のキャンセルポイントで送出される（安全に中断できる区間でのみ停止）。"""


def _jobs_root() -> Path:
    # PROJECTS_DIR（テストでは一時領域へ差し替え）の親= dataディレクトリ配下へ保存
    root = Path(project_paths_module.PROJECTS_DIR).parent / "jobs"
    root.mkdir(parents=True, exist_ok=True)
    return root


class JobRepository:
    """Jobの永続化層（JSONファイル）。将来SQLiteへ差し替える場合はこのクラスのみ置換する。

    read-modify-write は threading.RLock（プロセス内）＋ file_lock（プロセス間）で排他し、
    保存は原子的リネーム（atomic_write_json）で行う（クラッシュ時の破損・二重採番防止）。
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()

    def _path(self) -> Path:
        return _jobs_root() / "jobs.json"

    def _load(self) -> dict[str, Any]:
        try:
            payload = json.loads(self._path().read_text(encoding="utf-8"))
            if isinstance(payload, dict) and isinstance(payload.get("items"), list):
                return {
                    "counter": int(payload.get("counter") or 0),
                    "items": payload["items"],
                    "config": payload.get("config") if isinstance(payload.get("config"), dict) else {},
                }
        except (OSError, ValueError):
            pass
        return {"counter": 0, "items": [], "config": {}}

    def _save(self, registry: dict[str, Any]) -> None:
        from .atomic_io import atomic_write_json

        atomic_write_json(self._path(), registry)

    def next_id(self) -> str:
        from .atomic_io import file_lock

        with self._lock, file_lock(self._path()):
            registry = self._load()
            registry["counter"] = int(registry["counter"]) + 1
            job_id = f"JOB-{registry['counter']:06d}"
            self._save(registry)
            return job_id

    def insert(self, job: dict[str, Any]) -> None:
        from .atomic_io import file_lock

        with self._lock, file_lock(self._path()):
            registry = self._load()
            registry["items"].append(job)
            self._save(registry)

    def update(self, job_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        from .atomic_io import file_lock

        with self._lock, file_lock(self._path()):
            registry = self._load()
            for item in registry["items"]:
                if item.get("job_id") == job_id:
                    item.update(patch)
                    self._save(registry)
                    return dict(item)
            raise FileNotFoundError(f"job not found: {job_id}")

    def get(self, job_id: str) -> Optional[dict[str, Any]]:
        for item in self._load()["items"]:
            if item.get("job_id") == job_id:
                return dict(item)
        return None

    def list(self) -> list[dict[str, Any]]:
        return [dict(item) for item in self._load()["items"]]

    def get_config(self, key: str, default: Any = None) -> Any:
        return self._load()["config"].get(key, default)

    def set_config(self, key: str, value: Any) -> None:
        from .atomic_io import file_lock

        with self._lock, file_lock(self._path()):
            registry = self._load()
            registry["config"][key] = value
            self._save(registry)

    # イベント（進捗履歴）: 1行1イベントのJSONL。ポーリング/将来SSEの両方で使える形式
    def append_event(self, job_id: str, event: dict[str, Any]) -> None:
        events_dir = _jobs_root() / "events"
        events_dir.mkdir(parents=True, exist_ok=True)
        with (events_dir / f"{job_id}.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": datetime.now().isoformat(), **event}, ensure_ascii=False) + "\n")

    def read_events(self, job_id: str) -> list[dict[str, Any]]:
        path = _jobs_root() / "events" / f"{job_id}.jsonl"
        events: list[dict[str, Any]] = []
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    events.append(json.loads(line))
                except ValueError:
                    continue
        except OSError:
            pass
        return events

    def write_internal_log(self, job_id: str, text: str) -> None:
        """スタックトレース等の内部ログ（ユーザー画面へは出さない）。"""
        logs_dir = _jobs_root() / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        with (logs_dir / f"{job_id}.log").open("a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().isoformat()}]\n{text}\n")


# ---------- Job Handler（種別ごとの実処理。既存サービスを呼ぶ） ----------


class JobContext:
    """ハンドラへ渡す進捗更新・キャンセル確認のコンテキスト。"""

    def __init__(self, service: "JobService", job_id: str) -> None:
        self._service = service
        self.job_id = job_id

    def update(self, progress: int, step: str, message: str = "") -> None:
        self._service.record_progress(self.job_id, progress, step, message)

    def check_cancelled(self) -> None:
        """キャンセルポイント。cancel_requested なら JobCancelled を送出して安全に停止する。"""
        job = self._service.repository.get(self.job_id)
        if job and job.get("status") == "cancel_requested":
            raise JobCancelled()


def _handle_preprocess(params: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    from .preprocess import run_preprocess

    ctx.update(10, "入力確認")
    ctx.check_cancelled()
    ctx.update(30, "前処理実行")
    result = run_preprocess(project_id=params.get("project_id"), overrides=params.get("overrides"))
    ctx.update(95, "スナップショット保存")
    return {
        "processed_count": result.get("processed_count"),
        "preprocess_snapshot_id": result.get("preprocess_snapshot_id"),
        "preprocess_hash": result.get("preprocess_hash"),
    }


def _handle_dataset_creation(params: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    from .ocr_pipeline import create_ocr_dataset

    ctx.update(10, "入力確認")
    ctx.check_cancelled()
    ctx.update(30, "データセット作成")
    kwargs = {k: v for k, v in params.items() if k != "project_id"}
    result = create_ocr_dataset(project_id=params.get("project_id"), **kwargs)
    ctx.update(95, "メタデータ保存")
    return {
        "dataset_root": result.get("dataset_root"),
        "counts": result.get("counts"),
        "valid_count": result.get("valid_count"),
        "training_preprocess_hash": result.get("training_preprocess_hash"),
    }


def _handle_training(params: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    from .tesseract_pipeline import run_tesseract_training

    ctx.update(10, "入力確認")
    ctx.check_cancelled()
    ctx.update(25, "データ準備")
    ctx.update(40, "学習開始")
    result = run_tesseract_training(
        project_id=str(params.get("project_id") or "default"),
        job_id=ctx.job_id,
        dataset_dir=str(params.get("dataset_dir") or ""),
        charset=params.get("charset"),
        max_iterations=int(params.get("max_iterations") or 1000),
        base_lang=params.get("base_lang"),
        psm=int(params.get("psm") or 7),
        extra_meta={
            "experiment_name": str(params.get("experiment_name") or ""),
            "parent_model_id": str(params.get("parent_model_id") or ""),
            "training_note": str(params.get("training_note") or ""),
        },
    )
    ctx.update(95, "モデル登録")
    return {"model_path": result.get("model_path"), "lang": result.get("lang"), "counts": result.get("counts")}


def _handle_evaluation(params: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    from .ocr_evaluation import evaluate_ocr

    ctx.update(10, "入力確認")
    ctx.check_cancelled()
    ctx.update(30, "評価実行")
    result = evaluate_ocr(
        project_id=params.get("project_id"),
        image_dir=str(params.get("image_dir") or ""),
        gt_csv=str(params.get("gt_csv") or ""),
        targets=params.get("targets") or [],
        charset=params.get("charset"),
        psm=int(params.get("psm") or 7),
        eval_preprocess=params.get("eval_preprocess"),
        preprocess_mode=params.get("preprocess_mode"),
    )
    ctx.update(95, "集計")
    return {
        "count": result.get("count"),
        "targets": [
            {"label": t.get("label"), "cer": t.get("cer"), "accuracy_percent": t.get("accuracy_percent")}
            for t in result.get("targets") or []
        ],
    }


def _handle_deployment_export(params: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    from ..project_paths import ensure_project_directories
    from .release_manager import build_deployment_package

    ctx.update(10, "入力確認")
    ctx.check_cancelled()
    ctx.update(40, "パッケージ生成")
    filename, payload = build_deployment_package(params.get("project_id"))
    paths = ensure_project_directories(params.get("project_id"))
    export_dir = paths.outputs / "deployments"
    export_dir.mkdir(parents=True, exist_ok=True)
    target = export_dir / filename
    # 原子性: 一時ファイル→リネーム（途中失敗ZIPを正式成果物として残さない）
    from .atomic_io import atomic_write_bytes

    atomic_write_bytes(target, payload)
    ctx.update(95, "保存")
    return {"file": str(target), "size_bytes": len(payload)}


def _handle_benchmark(params: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    # Benchmark Suite（Phase 2）で実装。ハンドラ登録の形はここで確定させる
    from .benchmark import run_benchmark_job

    return run_benchmark_job(params, ctx)


JOB_HANDLERS: dict[str, Callable[[dict[str, Any], JobContext], dict[str, Any]]] = {
    "preprocess": _handle_preprocess,
    "dataset_creation": _handle_dataset_creation,
    "training": _handle_training,
    "evaluation": _handle_evaluation,
    "deployment_export": _handle_deployment_export,
    "benchmark": _handle_benchmark,
}


# ---------- Job Service（採番・遷移・並行制御・キャンセル・再実行） ----------


class JobService:
    def __init__(self, repository: Optional[JobRepository] = None) -> None:
        self.repository = repository or JobRepository()

    # -- 状態遷移 --
    def transition(self, job_id: str, new_status: str, extra: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        job = self.repository.get(job_id)
        if job is None:
            raise FileNotFoundError(f"job not found: {job_id}")
        current = str(job.get("status"))
        if new_status not in JOB_STATUSES:
            raise ValueError(f"unknown status: {new_status}")
        if new_status not in ALLOWED_TRANSITIONS.get(current, set()):
            raise ValueError(f"invalid status transition: {current} → {new_status}")
        patch = {"status": new_status, **(extra or {})}
        if new_status == "running":
            patch["started_at"] = datetime.now().isoformat()
        if new_status in {"succeeded", "failed", "cancelled"}:
            patch["finished_at"] = datetime.now().isoformat()
        updated = self.repository.update(job_id, patch)
        self.repository.append_event(job_id, {"type": "status", "status": new_status, "message": patch.get("message", "")})
        return updated

    # -- 同時実行制御（重複時は既存アクティブJobを返す=統一仕様） --
    def _find_duplicate(self, job_type: str, project_id: str, params: dict[str, Any]) -> Optional[dict[str, Any]]:
        active = [j for j in self.repository.list() if j.get("status") in ACTIVE_STATUSES]
        if job_type == "training":
            # 学習はシステム全体で同時1件
            for job in active:
                if job.get("job_type") == "training":
                    return job
        if job_type == "preprocess":
            # 同一プロジェクトの前処理は同時1件
            for job in active:
                if job.get("job_type") == "preprocess" and job.get("project_id") == project_id:
                    return job
        if job_type == "evaluation":
            # 同じモデルへの評価Job重複を防止（対象モデル集合が交差する場合）
            models = {str(t.get("model") or "") for t in (params.get("targets") or [])}
            for job in active:
                if job.get("job_type") != "evaluation" or job.get("project_id") != project_id:
                    continue
                other = {str(t.get("model") or "") for t in ((job.get("params") or {}).get("targets") or [])}
                if models & other:
                    return job
        return None

    def _benchmark_slot_available(self) -> bool:
        limit = int(self.repository.get_config("benchmark_concurrency", 1) or 1)
        running = [
            j for j in self.repository.list() if j.get("job_type") == "benchmark" and j.get("status") == "running"
        ]
        return len(running) < max(1, limit)

    # -- 作成 --
    def create_job(
        self,
        project_id: str,
        job_type: str,
        params: dict[str, Any],
        requested_by: str = "",
        retry_source_job_id: str = "",
        related: Optional[dict[str, str]] = None,
    ) -> tuple[dict[str, Any], bool]:
        """Job作成。戻り値=(job, deduplicated)。重複時は既存アクティブJobを返す。

        重複判定（check）と登録（act）を同一ロック内で行い、連続クリック・同時要求でも
        新規Jobが1件だけ作成されることを保証する（§二重実行・競合試験）。
        """
        from .atomic_io import file_lock

        if job_type not in JOB_TYPES:
            raise ValueError(f"unknown job_type: {job_type}（{JOB_TYPES}）")
        with self.repository._lock, file_lock(self.repository._path()):  # noqa: SLF001
            return self._create_job_locked(project_id, job_type, params, requested_by, retry_source_job_id, related)

    def _create_job_locked(
        self,
        project_id: str,
        job_type: str,
        params: dict[str, Any],
        requested_by: str = "",
        retry_source_job_id: str = "",
        related: Optional[dict[str, str]] = None,
    ) -> tuple[dict[str, Any], bool]:
        duplicate = self._find_duplicate(job_type, project_id, params)
        if duplicate is not None:
            return duplicate, True
        job = {
            "job_id": self.repository.next_id(),
            "project_id": str(project_id or "default"),
            "job_type": job_type,
            "status": "queued",
            "requested_by": str(requested_by or ""),
            "created_at": datetime.now().isoformat(),
            "started_at": "",
            "finished_at": "",
            "progress": 0,
            "current_step": "待機中",
            "message": "",
            "params": params or {},
            "result_summary": None,
            "error_summary": "",
            "related_experiment_id": str((related or {}).get("experiment_id") or ""),
            "related_model_id": str((related or {}).get("model_id") or ""),
            "related_benchmark_id": str((related or {}).get("benchmark_id") or ""),
            "retry_source_job_id": str(retry_source_job_id or ""),
            "cancellation_requested_at": "",
        }
        self.repository.insert(job)
        self.repository.append_event(job["job_id"], {"type": "status", "status": "queued", "message": ""})
        return job, False

    # -- キャンセル（running→cancel_requested→cancelled。即座にcancelledへはしない） --
    def request_cancel(self, job_id: str) -> dict[str, Any]:
        job = self.repository.get(job_id)
        if job is None:
            raise FileNotFoundError(f"job not found: {job_id}")
        status = str(job.get("status"))
        if status == "queued":
            # 未開始はそのまま取り消せる（queued→cancel_requested→cancelled を即時完了）
            self.transition(job_id, "cancel_requested", {"cancellation_requested_at": datetime.now().isoformat()})
            return self.transition(job_id, "cancelled", {"message": "開始前にキャンセルされました"})
        if status == "running":
            return self.transition(
                job_id, "cancel_requested", {"cancellation_requested_at": datetime.now().isoformat(), "message": "キャンセル要求受付（現在工程の終了後に停止します）"}
            )
        raise ValueError(f"キャンセルできない状態です: {status}")

    # -- 再実行（同一入力条件・retry_source_job_id保存） --
    def retry_job(self, job_id: str, requested_by: str = "") -> tuple[dict[str, Any], bool]:
        source = self.repository.get(job_id)
        if source is None:
            raise FileNotFoundError(f"job not found: {job_id}")
        if source.get("status") in ACTIVE_STATUSES:
            raise ValueError("実行中のJobは再実行できません（完了・失敗・キャンセル後に再実行してください）")
        return self.create_job(
            project_id=str(source.get("project_id") or "default"),
            job_type=str(source.get("job_type") or ""),
            params=dict(source.get("params") or {}),
            requested_by=requested_by or str(source.get("requested_by") or ""),
            retry_source_job_id=job_id,
        )

    # -- 進捗 --
    def record_progress(self, job_id: str, progress: int, step: str, message: str = "") -> None:
        clamped = max(0, min(100, int(progress)))
        self.repository.update(job_id, {"progress": clamped, "current_step": str(step), "message": str(message)})
        self.repository.append_event(job_id, {"type": "progress", "progress": clamped, "step": str(step), "message": str(message)})

    def _audit_job_finished(self, job: dict[str, Any]) -> None:
        """Job完了（succeeded/failed/cancelled）の監査記録。

        Service層で記録するため、API経由・Worker実行・CLI実行のいずれでも同じ経路で
        1回だけ記録される（APIとCLIの二重記録なし）。記録失敗は本処理へ影響させない。
        """
        try:
            from .audit_log import record_audit

            record_audit(
                "job_finished",
                user=str(job.get("requested_by") or "system:worker"),
                project_id=str(job.get("project_id") or ""),
                target_type="job",
                target_id=str(job.get("job_id") or ""),
                job_id=str(job.get("job_id") or ""),
                after={
                    "job_type": job.get("job_type"),
                    "status": job.get("status"),
                    "error_summary": job.get("error_summary") or "",
                },
            )
        except Exception:  # noqa: BLE001
            pass

    # -- 実行（Workerから呼ばれる。テストでは直接呼び出し可能） --
    def execute_job(self, job_id: str) -> dict[str, Any]:
        job = self.repository.get(job_id)
        if job is None:
            raise FileNotFoundError(f"job not found: {job_id}")
        if job.get("status") != "queued":
            return job
        if job.get("job_type") == "benchmark" and not self._benchmark_slot_available():
            return job  # スロット空き待ち（queuedのまま）
        self.transition(job_id, "running")
        ctx = JobContext(self, job_id)
        handler = JOB_HANDLERS.get(str(job.get("job_type")))
        try:
            if handler is None:
                raise ValueError(f"handler not registered: {job.get('job_type')}")
            result = handler(dict(job.get("params") or {}), ctx)
            # 完了直前のキャンセル要求は成功として完結させる（結果は生成済みのため）
            self.record_progress(job_id, 100, "完了")
            related_patch = {}
            for key in ("related_model_id", "related_experiment_id", "related_benchmark_id"):
                if isinstance(result, dict) and result.get(key):
                    related_patch[key] = str(result[key])
            finished = self.transition(job_id, "succeeded", {"result_summary": result, **related_patch})
        except JobCancelled:
            finished = self.transition(job_id, "cancelled", {"message": "キャンセルされました"})
        except Exception as e:  # noqa: BLE001
            # スタックトレースは内部ログのみ（画面へは要約だけ）
            self.repository.write_internal_log(job_id, traceback.format_exc())
            current = self.repository.get(job_id)
            if current and current.get("status") == "cancel_requested":
                finished = self.transition(job_id, "cancelled", {"message": "キャンセルされました"})
            else:
                finished = self.transition(job_id, "failed", {"error_summary": str(e)[:500]})
        self._audit_job_finished(finished)
        return finished

    # -- 一覧（フィルタ） --
    def list_jobs(
        self,
        project_id: str = "",
        job_type: str = "",
        status: str = "",
        requested_by: str = "",
        date_from: str = "",
        date_to: str = "",
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        items = self.repository.list()
        result = []
        for job in reversed(items):  # 新しい順
            if project_id and job.get("project_id") != project_id:
                continue
            if job_type and job.get("job_type") != job_type:
                continue
            if status and job.get("status") != status:
                continue
            if requested_by and requested_by.lower() not in str(job.get("requested_by") or "").lower():
                continue
            created = str(job.get("created_at") or "")[:10]
            if date_from and created < date_from:
                continue
            if date_to and created > date_to:
                continue
            result.append(job)
            if len(result) >= max(1, int(limit)):
                break
        return result


# ---------- Job Worker（単一プロセス・単一Worker。将来キュー基盤へ交換可能） ----------


class JobWorker:
    def __init__(self, service: JobService, poll_interval: float = 1.0) -> None:
        self.service = service
        self.poll_interval = poll_interval
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

    def is_alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> None:
        if self.is_alive():
            return
        # Worker起動前に、前回プロセスでrunningのまま残ったJobをinterruptedへ回収する
        # （実行実体のないJobを二重実行・永続running表示にしない）
        try:
            recover_interrupted_jobs(self.service)
        except Exception:  # noqa: BLE001
            pass
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="ocr-crafter-job-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def process_next(self) -> Optional[str]:
        """キュー先頭のqueued Jobを1件実行する（テスト・同期実行用）。実行したjob_idを返す。"""
        for job in self.service.repository.list():
            if job.get("status") == "queued":
                self.service.execute_job(str(job["job_id"]))
                return str(job["job_id"])
        return None

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                executed = self.process_next()
            except Exception:  # noqa: BLE001
                executed = None
            if executed is None:
                self._stop.wait(self.poll_interval)


def recover_interrupted_jobs(service: Optional["JobService"] = None) -> list[str]:
    """Backend再起動でrunning/cancel_requestedのまま残ったJobをinterruptedへ回収する。

    - Workerスレッドはプロセスと共に消えるため、再起動後にrunningのJobは実行実体がない
    - queuedのJobはWorker再起動でそのまま実行再開されるため対象外
    - interrupted へ移行したJobはUIから再実行（同一入力条件）で復旧できる
    起動時（app startup / Worker start）に呼ぶ。戻り値=回収したJob ID一覧。
    """
    svc = service or get_job_service()
    recovered: list[str] = []
    for job in svc.repository.list():
        if job.get("status") in {"running", "cancel_requested"}:
            job_id = str(job.get("job_id"))
            svc.transition(
                job_id,
                "interrupted",
                {"message": "Backend再起動により中断されました（再実行で復旧できます）"},
            )
            svc.repository.write_internal_log(job_id, "recover_interrupted_jobs: 再起動時にrunningのまま検出されたためinterruptedへ移行")
            recovered.append(job_id)
    return recovered


# アプリ全体で共有するシングルトン（main.pyから使用）
_service: Optional[JobService] = None
_worker: Optional[JobWorker] = None


def get_job_service() -> JobService:
    global _service
    if _service is None:
        _service = JobService()
    return _service


def get_job_worker() -> JobWorker:
    global _worker
    if _worker is None:
        _worker = JobWorker(get_job_service())
    return _worker


def ensure_worker_started() -> None:
    get_job_worker().start()
