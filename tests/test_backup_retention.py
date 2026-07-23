"""バックアップ・復元・データ保持設定のテスト。"""

import json
import zipfile
from datetime import datetime, timedelta

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.backup_manager import (
    _backups_root,
    apply_retention,
    create_backup,
    get_retention,
    list_backups,
    restore_backup,
    set_retention,
)

PID = "p_backup"


def _seed_project(project=PID):
    paths = ensure_project_directories(project)
    (paths.raw / "img.png").write_bytes(b"\x89PNG-fake")
    (paths.root / "annotations").mkdir(exist_ok=True)
    (paths.root / "annotations" / "master.csv").write_text("filename,text\nimg.png,AB12\n", encoding="utf-8")
    (paths.root / "experiments.json").write_text(json.dumps({"counter": 1, "items": []}), encoding="utf-8")
    (paths.models / "m1.tess.json").write_text(json.dumps({"lang": "x"}), encoding="utf-8")
    (paths.models / "m1.traineddata").write_bytes(b"binary-model")
    return paths


def test_backup_metadata_only_and_full(temp_projects):
    _seed_project()
    meta = create_backup(PID, mode="metadata_only")
    full = create_backup(PID, mode="full")
    assert meta["backup_id"] == "BK-0001" and full["backup_id"] == "BK-0002"
    assert meta["mode"] == "metadata_only" and meta["size_bytes"] > 0

    def names(entry):
        with zipfile.ZipFile(_backups_root() / entry["file"]) as zf:
            return set(zf.namelist())

    meta_names = names(meta)
    # metadata_only: 設定・記録・モデルメタのみ（画像・モデル実体は含めない）
    assert "project/annotations/master.csv" in meta_names
    assert "project/experiments.json" in meta_names
    assert "project/models/m1.tess.json" in meta_names
    assert "project/raw/img.png" not in meta_names
    assert "project/models/m1.traineddata" not in meta_names
    assert "backup_manifest.json" in meta_names
    # full: 全体
    full_names = names(full)
    assert "project/raw/img.png" in full_names
    assert "project/models/m1.traineddata" in full_names

    with pytest.raises(ValueError):
        create_backup(PID, mode="partial")

    items = list_backups(PID)
    assert [i["backup_id"] for i in items] == ["BK-0002", "BK-0001"]  # 新しい順


def test_restore_to_new_project_id(temp_projects):
    _seed_project()
    entry = create_backup(PID, mode="full")
    # 既定=新Project IDを自動採番（既存プロジェクトを上書きしない）
    restored = restore_backup(entry["backup_id"])
    assert restored["project_id"] == f"{PID}_restored_1"
    restored_root = temp_projects["projects_dir"] / restored["project_id"]
    assert (restored_root / "raw" / "img.png").read_bytes() == b"\x89PNG-fake"
    assert (restored_root / "annotations" / "master.csv").is_file()
    # 明示指定で既存IDと衝突する場合はエラー
    with pytest.raises(ValueError, match="既に存在"):
        restore_backup(entry["backup_id"], new_project_id=PID)
    with pytest.raises(FileNotFoundError):
        restore_backup("BK-9999")


def test_retention_config_and_apply(temp_projects):
    from src.app.services.audit_log import read_audit, record_audit
    from src.app.services.job_manager import JobService

    # 既定=無期限保持（従来動作）
    assert get_retention() == {"job_retention_days": None, "audit_retention_days": None}
    with pytest.raises(ValueError):
        set_retention({"job_retention_days": 0})
    config = set_retention({"job_retention_days": 30, "audit_retention_days": 90})
    assert config == {"job_retention_days": 30, "audit_retention_days": 90}

    # 古い終端Job・古い監査エントリを作る
    service = JobService()
    old_job, _ = service.create_job("p1", "preprocess", {})
    service.transition(old_job["job_id"], "running")
    service.transition(old_job["job_id"], "succeeded")
    old_stamp = (datetime.now() - timedelta(days=60)).isoformat()
    service.repository.update(old_job["job_id"], {"created_at": old_stamp})
    active_job, _ = service.create_job("p2", "training", {})  # アクティブJobは削除しない
    service.repository.update(active_job["job_id"], {"created_at": old_stamp})

    record_audit("project_create", user="a", project_id="p1", target_id="p1")
    audit_path = temp_projects["projects_dir"].parent / "audit" / "audit.jsonl"
    lines = audit_path.read_text(encoding="utf-8").splitlines()
    entry = json.loads(lines[0])
    entry["timestamp"] = (datetime.now() - timedelta(days=120)).isoformat()
    audit_path.write_text(json.dumps(entry, ensure_ascii=False) + "\n", encoding="utf-8")

    result = apply_retention()
    assert result["removed_jobs"] == 1  # 終端かつ期限切れのみ
    assert result["removed_audit_entries"] == 1
    assert service.repository.get(old_job["job_id"]) is None
    assert service.repository.get(active_job["job_id"]) is not None  # アクティブは残る
    # 削除の事実が監査記録される（retention_cleanup）
    cleanup = read_audit(action="retention_cleanup")
    assert len(cleanup) == 1
    assert cleanup[0]["after"]["removed_jobs"] == 1
