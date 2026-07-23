"""プロジェクトバックアップ・復元とデータ保持設定（Backup / Recovery / Retention）。

- バックアップ: metadata_only（設定・ラベル・実験/リリース/Benchmark記録・モデルメタのみ）
  または full（プロジェクトディレクトリ全体）を選択してZIP化。
  保存先 data/backups/<file>.zip ＋ index.json（BK-0001形式・作成日時・サイズ・モード）
- 復元: **既定で新しいProject IDへ復元する**（既存プロジェクトを上書きしない。
  明示指定したIDでも既存と衝突する場合はエラー）
- データ保持設定: data/retention.json（Job保持日数・監査ログ保持日数）。
  **未設定（null）=無期限保持（従来動作）**。適用（apply_retention）による削除は
  監査ログ（retention_cleanup）へ記録する
"""

from __future__ import annotations

import json
import threading
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from .. import project_paths as project_paths_module
from ..project_paths import ensure_project_directories

_LOCK = threading.RLock()

# metadata_only で含めるプロジェクト直下の対象（実体画像・学習成果物の実体は含めない）
_METADATA_FILES = [
    "experiments.json",
    "releases.json",
    "benchmarks.json",
    "preprocess_config.json",
]
_METADATA_DIRS = [
    ("annotations", None),  # master.csv・manual_masks.json 等
    ("processed/meta", None),  # 前処理スナップショット
    ("models", {".json"}),  # モデルメタ（.tess.json/.ocr.json等）のみ。traineddata実体は含めない
]


def _backups_root() -> Path:
    root = Path(project_paths_module.PROJECTS_DIR).parent / "backups"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _load_index() -> dict[str, Any]:
    try:
        payload = json.loads((_backups_root() / "index.json").read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            return {"counter": int(payload.get("counter") or 0), "items": payload["items"]}
    except (OSError, ValueError):
        pass
    return {"counter": 0, "items": []}


def _save_index(index: dict[str, Any]) -> None:
    from .atomic_io import atomic_write_json

    atomic_write_json(_backups_root() / "index.json", index)


def create_backup(project_id: Optional[str], mode: str = "metadata_only") -> dict[str, Any]:
    """プロジェクトのバックアップZIPを作成する（BK-0001形式で採番・index.jsonへ追記）。"""
    if mode not in {"metadata_only", "full"}:
        raise ValueError("mode は metadata_only / full のいずれかを指定してください")
    paths = ensure_project_directories(project_id)
    pid = paths.project_id

    def _add(zf: zipfile.ZipFile, file_path: Path) -> int:
        arcname = f"project/{file_path.relative_to(paths.root).as_posix()}"
        zf.write(file_path, arcname)
        return 1

    from .atomic_io import atomic_replace, file_lock

    with _LOCK, file_lock(_backups_root() / "index.json"):
        index = _load_index()
        index["counter"] = int(index["counter"]) + 1
        backup_id = f"BK-{index['counter']:04d}"
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{backup_id}_{pid}_{mode}_{stamp}.zip"
        target = _backups_root() / filename
        # 原子性: 一時ファイルへ生成→完了後にリネーム（途中失敗ZIPを正式成果物として残さない）
        tmp_target = _backups_root() / f".{filename}.tmp"
        file_count = 0
        with zipfile.ZipFile(tmp_target, "w", zipfile.ZIP_DEFLATED) as zf:
            if mode == "full":
                for file_path in sorted(paths.root.rglob("*")):
                    if file_path.is_file():
                        file_count += _add(zf, file_path)
            else:
                for name in _METADATA_FILES:
                    file_path = paths.root / name
                    if file_path.is_file():
                        file_count += _add(zf, file_path)
                for rel, extensions in _METADATA_DIRS:
                    base = paths.root / rel
                    if not base.is_dir():
                        continue
                    for file_path in sorted(base.rglob("*")):
                        if not file_path.is_file():
                            continue
                        if extensions is not None and file_path.suffix.lower() not in extensions:
                            continue
                        file_count += _add(zf, file_path)
            zf.writestr(
                "backup_manifest.json",
                json.dumps(
                    {"backup_id": backup_id, "project_id": pid, "mode": mode, "created_at": datetime.now().isoformat()},
                    ensure_ascii=False,
                    indent=2,
                ),
            )
        atomic_replace(tmp_target, target)  # 完成したZIPだけを正式パスへ
        entry = {
            "backup_id": backup_id,
            "project_id": pid,
            "mode": mode,
            "created_at": datetime.now().isoformat(),
            "file": filename,
            "size_bytes": target.stat().st_size,
            "file_count": file_count,
        }
        index["items"].append(entry)
        _save_index(index)
        return entry


def list_backups(project_id: str = "") -> list[dict[str, Any]]:
    items = _load_index()["items"]
    if project_id:
        items = [i for i in items if i.get("project_id") == project_id]
    return list(reversed(items))  # 新しい順


def restore_backup(backup_id: str, new_project_id: str = "") -> dict[str, Any]:
    """バックアップを**新しいProject IDへ**復元する（既存プロジェクトを上書きしない）。

    new_project_id 未指定は `<元ID>_restored_<連番>` を自動採番。指定IDが既存の場合はエラー。
    """
    index = _load_index()
    entry = next((i for i in index["items"] if i.get("backup_id") == backup_id), None)
    if entry is None:
        raise FileNotFoundError(f"backup not found: {backup_id}")
    archive = _backups_root() / str(entry.get("file") or "")
    if not archive.is_file():
        raise FileNotFoundError(f"backup file not found: {entry.get('file')}")

    projects_dir = Path(project_paths_module.PROJECTS_DIR)
    source_pid = str(entry.get("project_id") or "project")
    target_pid = str(new_project_id or "").strip()
    if not target_pid:
        suffix = 1
        while (projects_dir / f"{source_pid}_restored_{suffix}").exists():
            suffix += 1
        target_pid = f"{source_pid}_restored_{suffix}"
    target_root = projects_dir / target_pid
    if target_root.exists():
        raise ValueError(f"復元先プロジェクトが既に存在します: {target_pid}（既存プロジェクトへは復元しません）")

    with zipfile.ZipFile(archive, "r") as zf:
        for info in zf.infolist():
            name = info.filename
            if not name.startswith("project/") or info.is_dir():
                continue
            relative = Path(name[len("project/"):])
            # Zip Slip対策: 展開先がプロジェクト外へ出る相対パスは拒否する
            destination = (target_root / relative).resolve()
            if not str(destination).startswith(str(target_root.resolve())):
                raise ValueError(f"不正なパスを含むバックアップです: {name}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(zf.read(info))
    ensure_project_directories(target_pid)
    return {"backup_id": backup_id, "project_id": target_pid, "mode": entry.get("mode"), "source_project_id": source_pid}


# ---------- データ保持設定（Retention） ----------


def _retention_path() -> Path:
    return Path(project_paths_module.PROJECTS_DIR).parent / "retention.json"


def get_retention() -> dict[str, Any]:
    """保持設定。未設定（null）=無期限保持（従来動作）。"""
    try:
        payload = json.loads(_retention_path().read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return {
                "job_retention_days": payload.get("job_retention_days"),
                "audit_retention_days": payload.get("audit_retention_days"),
            }
    except (OSError, ValueError):
        pass
    return {"job_retention_days": None, "audit_retention_days": None}


def set_retention(config: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key in ("job_retention_days", "audit_retention_days"):
        value = config.get(key)
        if value in (None, ""):
            cleaned[key] = None
            continue
        days = int(value)
        if days < 1:
            raise ValueError(f"{key} は1以上の日数か未設定（無期限）を指定してください")
        cleaned[key] = days
    from .atomic_io import atomic_write_json

    atomic_write_json(_retention_path(), cleaned)
    return cleaned


def apply_retention(user: Any = None, client: Optional[dict[str, str]] = None) -> dict[str, Any]:
    """保持期間を過ぎたJob・監査ログを削除する（削除は監査ログ retention_cleanup へ記録）。

    - Job: 終端状態（succeeded/failed/cancelled）のみ削除対象（アクティブJobは残す）。
      events/logs ファイルも併せて削除
    - 監査ログ: 保持日数より古い行を削除（削除の事実を新しい監査エントリとして残す）
    """
    from .audit_log import _audit_root, record_audit
    from .job_manager import get_job_service

    config = get_retention()
    now = datetime.now()
    removed_jobs = 0
    removed_audit = 0

    if config["job_retention_days"]:
        cutoff = (now - timedelta(days=int(config["job_retention_days"]))).isoformat()
        repository = get_job_service().repository
        with repository._lock:  # noqa: SLF001 （Repository内部の一括削除。外部APIは追加しない）
            registry = repository._load()  # noqa: SLF001
            kept = []
            for job in registry["items"]:
                terminal = job.get("status") in {"succeeded", "failed", "cancelled"}
                old = str(job.get("created_at") or "") < cutoff
                if terminal and old:
                    removed_jobs += 1
                    job_id = str(job.get("job_id") or "")
                    jobs_root = Path(project_paths_module.PROJECTS_DIR).parent / "jobs"
                    (jobs_root / "events" / f"{job_id}.jsonl").unlink(missing_ok=True)
                    (jobs_root / "logs" / f"{job_id}.log").unlink(missing_ok=True)
                else:
                    kept.append(job)
            registry["items"] = kept
            repository._save(registry)  # noqa: SLF001

    if config["audit_retention_days"]:
        cutoff = (now - timedelta(days=int(config["audit_retention_days"]))).isoformat()
        audit_path = _audit_root() / "audit.jsonl"
        try:
            lines = audit_path.read_text(encoding="utf-8").splitlines()
        except OSError:
            lines = []
        kept_lines = []
        for line in lines:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if str(entry.get("timestamp") or "") < cutoff:
                removed_audit += 1
            else:
                kept_lines.append(line)
        if removed_audit:
            audit_path.write_text("\n".join(kept_lines) + ("\n" if kept_lines else ""), encoding="utf-8")

    result = {
        "removed_jobs": removed_jobs,
        "removed_audit_entries": removed_audit,
        "config": config,
        "applied_at": now.isoformat(),
    }
    # 削除の事実は必ず監査記録する（削除0件でも適用実行を記録）
    record_audit(
        "retention_cleanup",
        user=user or "",
        target_type="retention",
        target_id="global",
        after=result,
        client=client,
    )
    return result
