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

import hashlib
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


BACKUP_MANIFEST_SCHEMA_VERSION = 2  # v2: File List（SHA-256）・App Version・Components を追加

# Restore時に存在必須のコンポーネント（無ければ整合性エラー）。それ以外はoptional
_REQUIRED_COMPONENT_PREFIXES = {"annotations/"}


def _sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _component_of(arcname: str) -> str:
    """アーカイブ内パス→コンポーネント名（annotations / models / raw / ...）。"""
    relative = arcname[len("project/"):] if arcname.startswith("project/") else arcname
    return relative.split("/", 1)[0] if "/" in relative else relative


def _collect_backup_files(paths: Any, mode: str) -> list[Path]:
    files: list[Path] = []
    if mode == "full":
        files = [p for p in sorted(paths.root.rglob("*")) if p.is_file()]
    else:
        for name in _METADATA_FILES:
            file_path = paths.root / name
            if file_path.is_file():
                files.append(file_path)
        for rel, extensions in _METADATA_DIRS:
            base = paths.root / rel
            if not base.is_dir():
                continue
            for file_path in sorted(base.rglob("*")):
                if not file_path.is_file():
                    continue
                if extensions is not None and file_path.suffix.lower() not in extensions:
                    continue
                files.append(file_path)
    return files


def create_backup(project_id: Optional[str], mode: str = "metadata_only") -> dict[str, Any]:
    """プロジェクトのバックアップZIPを作成する（BK-0001形式で採番・index.jsonへ追記）。

    manifest.json（v2）へ全ファイルの SHA-256・サイズを記録し、Restore時の整合性検証に使う。
    """
    if mode not in {"metadata_only", "full"}:
        raise ValueError("mode は metadata_only / full のいずれかを指定してください")
    paths = ensure_project_directories(project_id)
    pid = paths.project_id

    from ..version import APP_VERSION
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
        file_entries: list[dict[str, Any]] = []
        components: set[str] = set()
        with zipfile.ZipFile(tmp_target, "w", zipfile.ZIP_DEFLATED) as zf:
            for file_path in _collect_backup_files(paths, mode):
                arcname = f"project/{file_path.relative_to(paths.root).as_posix()}"
                data = file_path.read_bytes()
                zf.writestr(arcname, data)
                file_entries.append({"path": arcname, "size": len(data), "sha256": _sha256_of(data)})
                components.add(_component_of(arcname))
            required = sorted(
                c for c in components if any(f"{c}/".startswith(prefix) for prefix in _REQUIRED_COMPONENT_PREFIXES)
            )
            manifest = {
                "backup_id": backup_id,
                "created_at": datetime.now().isoformat(),
                "app_version": APP_VERSION,
                "schema_version": BACKUP_MANIFEST_SCHEMA_VERSION,
                "project_id": pid,
                "mode": mode,
                "files": file_entries,
                "file_count": len(file_entries),
                "total_size_bytes": sum(f["size"] for f in file_entries),
                "required_components": required,
                "optional_components": sorted(components - set(required)),
            }
            zf.writestr("backup_manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        atomic_replace(tmp_target, target)  # 完成したZIPだけを正式パスへ
        entry = {
            "backup_id": backup_id,
            "project_id": pid,
            "mode": mode,
            "created_at": datetime.now().isoformat(),
            "file": filename,
            "size_bytes": target.stat().st_size,
            "file_count": len(file_entries),
            "app_version": APP_VERSION,
            "manifest_schema_version": BACKUP_MANIFEST_SCHEMA_VERSION,
        }
        index["items"].append(entry)
        _save_index(index)
        return entry


def list_backups(project_id: str = "") -> list[dict[str, Any]]:
    items = _load_index()["items"]
    if project_id:
        items = [i for i in items if i.get("project_id") == project_id]
    return list(reversed(items))  # 新しい順


def _read_manifest(zf: zipfile.ZipFile) -> Optional[dict[str, Any]]:
    try:
        payload = json.loads(zf.read("backup_manifest.json").decode("utf-8"))
        return payload if isinstance(payload, dict) else None
    except (KeyError, ValueError):
        return None


def verify_backup(backup_id: str) -> dict[str, Any]:
    """バックアップZIPの整合性検証（manifestの全ファイルのSHA-256・サイズ・欠落・余剰を確認）。

    manifest v1（File Listなしの旧バックアップ）は検証不能として valid=None を返す（推測しない）。
    """
    index = _load_index()
    entry = next((i for i in index["items"] if i.get("backup_id") == backup_id), None)
    if entry is None:
        raise FileNotFoundError(f"backup not found: {backup_id}")
    archive = _backups_root() / str(entry.get("file") or "")
    if not archive.is_file():
        raise FileNotFoundError(f"backup file not found: {entry.get('file')}")
    mismatches: list[str] = []
    with zipfile.ZipFile(archive, "r") as zf:
        manifest = _read_manifest(zf)
        if manifest is None:
            return {"backup_id": backup_id, "valid": False, "mismatches": ["backup_manifest.json がありません"], "manifest": None}
        files = manifest.get("files")
        if not isinstance(files, list):
            # 旧形式（v1）: File Listがないため検証不能（validはNone=不明。推測しない）
            return {"backup_id": backup_id, "valid": None, "mismatches": ["manifestが旧形式（v1）のためHash検証できません"], "manifest": manifest}
        names = {info.filename for info in zf.infolist() if not info.is_dir()}
        for item in files:
            path = str(item.get("path") or "")
            if path not in names:
                mismatches.append(f"欠落: {path}")
                continue
            data = zf.read(path)
            if len(data) != int(item.get("size") or -1):
                mismatches.append(f"サイズ不一致: {path}")
            if _sha256_of(data) != str(item.get("sha256") or ""):
                mismatches.append(f"SHA-256不一致: {path}")
        expected = {str(item.get("path")) for item in files} | {"backup_manifest.json"}
        for name in sorted(names - expected):
            mismatches.append(f"manifest未記載のファイル: {name}")
    return {"backup_id": backup_id, "valid": not mismatches, "mismatches": mismatches, "manifest": manifest}


def restore_backup(backup_id: str, new_project_id: str = "") -> dict[str, Any]:
    """バックアップを**新しいProject IDへ**復元する（既存プロジェクトを上書きしない）。

    - 復元前にmanifestの全ファイルのSHA-256を検証し、**不一致があれば復元を開始しない**
    - 復元後にも書き込んだファイルを再検証する（不一致は復元先を削除してエラー）
    - new_project_id 未指定は `<元ID>_restored_<連番>` を自動採番。指定IDが既存の場合はエラー
    """
    index = _load_index()
    entry = next((i for i in index["items"] if i.get("backup_id") == backup_id), None)
    if entry is None:
        raise FileNotFoundError(f"backup not found: {backup_id}")
    archive = _backups_root() / str(entry.get("file") or "")
    if not archive.is_file():
        raise FileNotFoundError(f"backup file not found: {entry.get('file')}")

    # 復元前の整合性検証（不一致・manifest欠落は復元を開始しない）
    verification = verify_backup(backup_id)
    if verification["valid"] is False:
        raise ValueError(
            "バックアップの整合性検証に失敗しました（復元を開始しません）: "
            + " / ".join(verification["mismatches"][:5])
        )
    manifest = verification.get("manifest") or {}
    hash_by_path = {str(f.get("path")): str(f.get("sha256")) for f in (manifest.get("files") or []) if isinstance(f, dict)}

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

    restored: list[tuple[str, Path]] = []
    try:
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
                restored.append((name, destination))
        # 復元後の整合性検証（書き込んだファイルのSHA-256をmanifestと再照合）
        post_mismatches = [
            name for name, path in restored
            if name in hash_by_path and _sha256_of(path.read_bytes()) != hash_by_path[name]
        ]
        if post_mismatches:
            raise ValueError(
                "復元後の整合性検証に失敗しました（復元先を削除しました）: " + " / ".join(post_mismatches[:5])
            )
    except Exception:
        # 部分的に復元されたプロジェクトを残さない（新規作成した復元先のみ削除）
        import shutil

        shutil.rmtree(target_root, ignore_errors=True)
        raise
    ensure_project_directories(target_pid)
    return {
        "backup_id": backup_id,
        "project_id": target_pid,
        "mode": entry.get("mode"),
        "source_project_id": source_pid,
        "verified_files": len(hash_by_path),
    }


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
