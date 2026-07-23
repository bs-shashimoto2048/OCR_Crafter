"""End-to-End UATシナリオ試験（19工程・本番相当の合成データ）。

プロジェクト作成→画像登録→前処理設定→前処理Job→データセット作成→学習Job→モデル登録→
評価Job→Experiment/Profile→Comparable Group→Benchmark→Candidate→Gate判定→Production昇格→
Deployment Package→Rollback→Backup→Restore→監査ログ確認 を1本のシナリオとして通す。

- OCRエンジン推論・Tesseract学習のみフェイク（数分かかる実学習を除き、パイプラインは実物）
- 全工程のID（JOB/EXP/BM/REL/AUD）と結果を記録し、UATチェックリスト（docs/23）の根拠とする
"""

import json

import numpy as np
import pytest
from PIL import Image

RESULTS: list[dict] = []  # 完了報告用の工程記録（-s 実行時に表を出力）


def _record(step, operation, expected, actual, ids="", ok=True):
    RESULTS.append({"step": step, "operation": operation, "expected": expected, "actual": actual, "ids": ids, "result": "PASS" if ok else "FAIL"})
    assert ok, f"E2E step {step} FAILED: {operation} expected={expected} actual={actual}"


@pytest.fixture()
def e2e(temp_projects, monkeypatch, tmp_path):
    """TestClient＋フェイク学習/推論エンジンのE2E環境。"""
    from fastapi.testclient import TestClient

    import src.app.main as main_module
    from src.app.services import benchmark as bm
    from src.app.services import job_manager

    # フェイクTesseract学習: 実学習の代わりにモデル実体+メタ（.tess.json）を登録する
    def fake_training(project_id, job_id, dataset_dir, charset=None, max_iterations=1000, base_lang=None, psm=7, log_path=None, config=None, extra_meta=None):
        from src.app.project_paths import ensure_project_directories

        paths = ensure_project_directories(project_id)
        lang = "e2e_model"
        traineddata = paths.models / f"{lang}.traineddata"
        traineddata.write_bytes(b"fake-traineddata")
        dataset_meta = {}
        try:
            dataset_meta = json.loads((tmp_path / "nonexistent").read_text())
        except OSError:
            pass
        meta = {
            "engine": "tesseract",
            "lang": lang,
            "created_at": "2026-07-23T12:00:00",
            "traineddata_path": str(traineddata),
            "tessdata_dir": str(paths.models),
            "dataset_dir": str(dataset_dir),
            "charset": charset or "AB12CD34",
            "max_iterations": int(max_iterations),
            "base_lang": base_lang or "eng",
            "status": "ready",
            **(dataset_meta or {}),
        }
        (paths.models / f"{lang}.tess.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"model_path": str(traineddata), "lang": lang, "counts": {"train": 2, "val": 1, "test": 1}}

    monkeypatch.setattr("src.app.services.tesseract_pipeline.run_tesseract_training", fake_training)

    # フェイクOCR推論（評価・Benchmark）: 常にGTと同じ文字列を返す（CER=0の理想エンジン）
    def fake_recognizer(project_id, model, charset, psm):
        return {
            "label": f"{model}（学習後）" if str(model).endswith(".tess.json") else "eng.traineddata（学習前）",
            "engine": "tesseract",
            "model": model if str(model).endswith(".tess.json") else "eng",
            "is_base": not str(model).endswith(".tess.json"),
            "recognize": lambda path: ("AB12", 0.95),
            "training_preprocess": None,
            "training_preprocess_hash": None,
        }

    monkeypatch.setattr("src.app.services.ocr_evaluation._build_tesseract_recognizer", fake_recognizer)
    monkeypatch.setitem(bm.ENGINE_BUILDERS, "tesseract_model", lambda pid, spec: {"label": "e2e_model", "recognize": lambda p: ("AB12", 0.9)})
    monkeypatch.setitem(bm.ENGINE_BUILDERS, "tesseract_base", lambda pid, spec: {"label": "eng", "recognize": lambda p: ("AB1Z", 0.5)})

    client = TestClient(main_module.app, raise_server_exceptions=False)

    def run_next_job():
        worker = job_manager.JobWorker(job_manager.get_job_service())
        return worker.process_next()

    return {"client": client, "run_next_job": run_next_job, "tmp": tmp_path}


def test_e2e_scenario_19_steps(e2e, temp_projects):
    client = e2e["client"]
    run_next_job = e2e["run_next_job"]
    tmp = e2e["tmp"]
    pid = "e2e_uat"
    RESULTS.clear()

    # 1. プロジェクト作成
    response = client.post("/projects", json={"project_id": pid})
    _record(1, "プロジェクト作成", "200", response.status_code, ids=pid, ok=response.status_code == 200)

    # 2. 画像登録（本番相当: 横長の刻印風合成画像4枚）
    source = tmp / "incoming"
    source.mkdir()
    for i in range(4):
        arr = np.full((32, 96), 210 - i * 5, dtype=np.uint8)
        arr[12:20, 10:80] = 40  # 文字帯に相当する暗部
        Image.fromarray(arr, mode="L").save(source / f"stamp_{i}.png")
    response = client.post("/images/import", json={"project_id": pid, "source_dir": str(source)})
    _record(2, "画像登録", "4枚", response.json().get("copied"), ok=response.json().get("copied") == 4)

    # 3. 前処理設定（UIの設定値=overridesをJob paramsへ。二値化固定128）
    overrides = {"threshold": {"enabled": True, "type": "binary", "value": 128}}
    _record(3, "前処理設定", "overrides作成", "作成済み", ok=True)

    # 4. 前処理Job実行
    response = client.post("/api/jobs", json={"project_id": pid, "job_type": "preprocess", "params": {"overrides": overrides}, "requested_by": "uat"})
    preprocess_job = response.json()["job"]["job_id"]
    run_next_job()
    job = client.get(f"/api/jobs/{preprocess_job}").json()["job"]
    _record(4, "前処理Job実行", "succeeded", job["status"], ids=preprocess_job, ok=job["status"] == "succeeded")

    # 5. OCRデータセット作成（ラベル付与→dataset_creation Job）
    for i in range(4):
        client.put(f"/labels/stamp_{i}.png?project_id={pid}", json={"label": "AB12"})
    response = client.post(
        "/api/jobs",
        json={"project_id": pid, "job_type": "dataset_creation", "params": {"image_types": ["wide"], "charset": "AB12", "max_text_length": 8, "overwrite": True}, "requested_by": "uat"},
    )
    dataset_job = response.json()["job"]["job_id"]
    run_next_job()
    job = client.get(f"/api/jobs/{dataset_job}").json()["job"]
    dataset_root = (job.get("result_summary") or {}).get("dataset_root")
    _record(5, "OCRデータセット作成", "succeeded", job["status"], ids=dataset_job, ok=job["status"] == "succeeded" and bool(dataset_root))

    # 6. 学習Job実行（フェイク学習=モデル登録まで）
    response = client.post(
        "/api/jobs",
        json={"project_id": pid, "job_type": "training", "params": {"dataset_dir": dataset_root, "charset": "AB12", "max_iterations": 500}, "requested_by": "uat"},
    )
    training_job = response.json()["job"]["job_id"]
    run_next_job()
    job = client.get(f"/api/jobs/{training_job}").json()["job"]
    _record(6, "学習Job実行", "succeeded", job["status"], ids=training_job, ok=job["status"] == "succeeded")

    # 7. モデル登録の確認（.tess.json）＋管理No付与
    response = client.get(f"/models/info?project_id={pid}")
    models = [m for m in response.json()["items"] if str(m.get("name", "")).endswith(".tess.json")]
    model_name = models[0]["name"] if models else ""
    model_id = models[0].get("model_id") if models else ""
    _record(7, "モデル登録", "e2e_model.tess.json", model_name, ids=model_id, ok=model_name == "e2e_model.tess.json" and bool(model_id))

    # 8. 評価Job実行（評価データ＋GT。フェイク推論=CER 0）
    eval_dir = tmp / "eval"
    eval_dir.mkdir()
    for i in range(3):
        Image.fromarray(np.full((32, 96), 200, dtype=np.uint8), mode="L").save(eval_dir / f"eval_{i}.png")
    gt_csv = tmp / "gt.csv"
    gt_csv.write_text("\n".join(f"eval_{i}.png,AB12" for i in range(3)), encoding="utf-8")
    response = client.post(
        "/api/jobs",
        json={"project_id": pid, "job_type": "evaluation", "params": {"image_dir": str(eval_dir), "gt_csv": str(gt_csv), "targets": [{"engine": "tesseract", "model": model_name}]}, "requested_by": "uat"},
    )
    eval_job = response.json()["job"]["job_id"]
    run_next_job()
    job = client.get(f"/api/jobs/{eval_job}").json()["job"]
    cer = ((job.get("result_summary") or {}).get("targets") or [{}])[0].get("cer")
    _record(8, "評価Job実行", "succeeded・CER 0.0", f"{job['status']}・CER {cer}", ids=eval_job, ok=job["status"] == "succeeded" and cer == 0.0)

    # 9. Experiment作成（バックフィル）＋評価Profile保存（attach-evaluation）
    response = client.post(
        "/api/experiments/attach-evaluation",
        json={
            "project_id": pid,
            "model": model_name,
            "evaluation": {"cer": 0.0, "char_accuracy": 1.0, "accuracy_percent": 100.0, "dataset_id": "eval_uat", "image_count": 3, "label_count": 3, "preprocess_signature": "none:e2e", "engine": "tesseract", "psm": 7, "whitelist": "AB12"},
        },
    )
    experiment = response.json().get("item") or {}
    experiment_id = experiment.get("experiment_id", "")
    _record(9, "Experiment作成・評価Profile保存", "attached=true", str(response.json().get("attached")), ids=experiment_id, ok=response.json().get("attached") is True)

    # 10. Comparable Group生成
    response = client.get(f"/api/experiments/comparable_groups?project_id={pid}")
    groups = response.json().get("groups") or []
    group_id = groups[0]["group_id"] if groups else ""
    _record(10, "Comparable Group生成", "CG-0001", group_id, ids=group_id, ok=group_id == "CG-0001")

    # 11. Benchmark実行（登録モデル vs Tesseract標準・前処理manual）
    response = client.post(
        "/api/benchmarks",
        json={
            "project_id": pid,
            "name": "UAT",
            "image_dir": str(eval_dir),
            "gt_csv": str(gt_csv),
            "dataset_id": "eval_uat",
            "engines": [{"engine": "tesseract_model", "model": model_name, "psm": 7}, {"engine": "tesseract_base", "psm": 7}],
            "preprocess": {"mode": "manual", "settings": {"grayscale": True, "binarize": False}},
        },
    )
    benchmark_job = response.json()["job"]["job_id"]
    run_next_job()
    job = client.get(f"/api/jobs/{benchmark_job}").json()["job"]
    benchmark_id = str(job.get("related_benchmark_id") or "")
    detail = client.get(f"/api/benchmarks/{benchmark_id}?project_id={pid}").json()["item"]
    top = detail["results"][0]
    _record(11, "Benchmark実行", "BM-0001・1位=登録モデル", f"{benchmark_id}・1位={top['label']}", ids=f"{benchmark_job}/{benchmark_id}", ok=benchmark_id == "BM-0001" and top["label"] == "e2e_model")

    # 12. Candidate化（Validated自動遷移の確認込み）
    statuses = client.get(f"/api/releases?project_id={pid}").json()["statuses"]
    validated = statuses.get(model_name, {}).get("status")
    response = client.post("/api/releases/status", json={"project_id": pid, "model": model_name, "status": "Candidate"})
    candidate_version = response.json()["item"]["version"]
    _record(12, "Candidate化", "Validated→Candidate v0.1", f"{validated}→Candidate v{candidate_version}", ok=validated == "Validated" and candidate_version == "0.1")

    # 13. Release Gate判定（Policy設定→PASS）
    client.put("/api/releases/policy", json={"project_id": pid, "policy": {"max_cer": 0.05, "min_eval_images": 3, "allowed_engines": ["tesseract"]}})
    response = client.get(f"/api/releases/gate?project_id={pid}&model={model_name}")
    verdict = response.json()["verdict"]
    _record(13, "Release Gate判定", "PASS", verdict, ok=verdict == "PASS")

    # 14. Production昇格
    response = client.post("/api/releases/promote", json={"project_id": pid, "model": model_name, "note": "UAT初回リリース", "author": "uat"})
    release_id = response.json()["entry"]["release_id"]
    version = response.json()["version"]
    _record(14, "Production昇格", "REL-0001 v1.0.0", f"{release_id} v{version}", ids=release_id, ok=release_id == "REL-0001" and version == "1.0.0")

    # 15. Deployment Package生成
    response = client.get(f"/api/releases/deployment_package?project_id={pid}")
    _record(15, "Deployment Package生成", "200・ZIP", f"{response.status_code}・{len(response.content)}bytes", ok=response.status_code == 200 and response.content[:2] == b"PK")

    # 16. Rollback（2つ目のモデルを昇格→v1.0.0へ戻す。Version維持・新Release ID）
    from src.app.project_paths import ensure_project_directories

    paths = ensure_project_directories(pid)
    (paths.models / "e2e_second.tess.json").write_text(json.dumps({"lang": "e2e_second", "created_at": "2026-07-23T13:00:00"}), encoding="utf-8")
    client.post("/api/releases/promote", json={"project_id": pid, "model": "e2e_second.tess.json", "note": "2回目"})
    response = client.post("/api/releases/rollback", json={"project_id": pid, "version": "1.0.0", "author": "uat"})
    rollback_entry = response.json()["entry"]
    _record(16, "Rollback", "v1.0.0維持・REL-0003", f"v{response.json()['version']}・{rollback_entry['release_id']}", ids=rollback_entry["release_id"], ok=response.json()["version"] == "1.0.0" and rollback_entry["release_id"] == "REL-0003")

    # 17. Backup（full）＋整合性検証
    response = client.post("/api/backups", json={"project_id": pid, "mode": "full"})
    backup_id = response.json()["item"]["backup_id"]
    verify = client.get(f"/api/backups/{backup_id}/verify").json()
    _record(17, "Backup作成+検証", "BK-0001・valid=true", f"{backup_id}・valid={verify['valid']}・{(verify.get('mismatches') or [])[:3]}", ids=backup_id, ok=backup_id == "BK-0001" and verify["valid"] is True)

    # 18. 新規Project IDへのRestore
    response = client.post(f"/api/backups/{backup_id}/restore", json={})
    restored_pid = response.json()["project_id"]
    restored_models = client.get(f"/models/info?project_id={restored_pid}").json()["items"]
    _record(18, "新規Project IDへのRestore", f"{pid}_restored_1", restored_pid, ok=restored_pid == f"{pid}_restored_1" and len(restored_models) >= 1)

    # 19. 監査ログ確認（主要操作が記録されている・削除APIなし）
    audit = client.get("/api/audit?limit=1000").json()["items"]
    actions = {entry["action"] for entry in audit}
    expected_actions = {"project_create", "job_finished", "benchmark_run", "release_status_change", "release_policy_update", "release_promote", "release_rollback", "deployment_export", "backup_create", "backup_restore"}
    missing = expected_actions - actions
    first_audit = audit[-1]["audit_id"] if audit else ""
    _record(19, "監査ログ確認", "主要操作すべて記録", f"{len(audit)}件・欠落{sorted(missing) or 'なし'}", ids=f"{first_audit}〜{audit[0]['audit_id'] if audit else ''}", ok=not missing)

    # job_finished がJob 5件（preprocess/dataset/training/evaluation/benchmark）すべてで記録されている
    finished_jobs = {entry["job_id"] for entry in audit if entry["action"] == "job_finished"}
    assert {preprocess_job, dataset_job, training_job, eval_job, benchmark_job} <= finished_jobs

    # 記録表の出力（pytest -s で確認可能。docs/23_UAT_CHECKLIST.md の根拠）
    print("\n=== E2E UAT結果 ===")
    for row in RESULTS:
        print(f"[{row['result']}] {row['step']:>2}. {row['operation']}: 期待={row['expected']} / 実結果={row['actual']} / ID={row['ids']}")
    assert all(row["result"] == "PASS" for row in RESULTS)
