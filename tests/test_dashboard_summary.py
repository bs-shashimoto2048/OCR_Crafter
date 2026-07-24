"""ダッシュボード「プロジェクト一覧」向け集約データ（GET /projects summaries）のテスト。

- Best CERの優先順位（Production→Candidate→Best Model→記録なし）
- Benchmark件数・Production/管理No
- 実行中Job種別（training/evaluation）の検出とN+1にならないこと（全プロジェクト1回のjobs.json読み取り）
- 全モデルArchived判定
- 既存フィールド（images/labeled/models等）への影響がないこと（回帰）
"""

import json

from fastapi.testclient import TestClient

from src.app.main import _active_job_types_by_project, _build_project_summary, _project_dashboard_quality
from src.app.project_paths import ensure_project_directories


def _seed_model(project, name, *, status=None, cer=None, exact_match=90.0, experiment_name="exp"):
    """モデル+実験カルテ（必要なら評価結果・リリースステータス）を用意する。"""
    from src.app.services.experiment_tracker import attach_evaluation, record_experiment
    from src.app.services.release_manager import promote_model, set_model_status

    paths = ensure_project_directories(project)
    traineddata = paths.models / f"{name}.traineddata"
    traineddata.write_bytes(b"fake-model-bytes")
    (paths.models / f"{name}.tess.json").write_text(
        json.dumps(
            {
                "engine": "tesseract",
                "lang": name,
                "created_at": "2026-07-20T10:00:00",
                "charset": "AB12",
                "max_iterations": 800,
                "base_lang": "eng",
                "traineddata_path": str(traineddata),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    model_file = f"{name}.tess.json"
    record_experiment(project, {"models": [model_file], "experiment_name": experiment_name})
    if cer is not None:
        evaluation = {"cer": cer, "char_accuracy": 1 - cer}
        if exact_match is not None:
            evaluation["accuracy_percent"] = exact_match
        attach_evaluation(project, model_file, evaluation)
    if status == "Production":
        promote_model(project, model_file, note="テスト昇格", author="tester")
    elif status:
        set_model_status(project, model_file, status)
    return model_file


def _seed_benchmarks(project, count):
    paths = ensure_project_directories(project)
    (paths.root / "benchmarks.json").write_text(
        json.dumps({"counter": count, "items": [{"benchmark_id": f"BM-{i:04d}"} for i in range(count)], "config": {}}),
        encoding="utf-8",
    )


def _seed_benchmark_run(project, benchmark_id, *, cer=0.05, mean_time_ms=200.0, p95_time_ms=42.0, failed=0, total=50, completed_at="2026-07-24T10:00:00"):
    """1エンジンのBenchmark実行結果を1件、登録簿へ直接書き込む（run_benchmark_jobの実行は行わない軽量版）。"""
    paths = ensure_project_directories(project)
    path = paths.root / "benchmarks.json"
    registry = {"counter": 0, "items": [], "config": {}}
    if path.exists():
        registry = json.loads(path.read_text(encoding="utf-8"))
    registry["counter"] = int(registry.get("counter", 0)) + 1
    registry["items"].append(
        {
            "benchmark_id": benchmark_id,
            "completed_at": completed_at,
            "results": [
                {
                    "engine": "tesseract",
                    "model": "model_a",
                    "engine_key": "tesseract:model_a",
                    "cer": cer,
                    "mean_time_ms": mean_time_ms,
                    "p95_time_ms": p95_time_ms,
                    "failed": failed,
                    "total": total,
                }
            ],
        }
    )
    path.write_text(json.dumps(registry), encoding="utf-8")


def _seed_job(project, job_type, status="running", job_id="JOB-000001"):
    from src.app.services import job_manager as jm

    jobs_root = jm._jobs_root()
    path = jobs_root / "jobs.json"
    registry = {"counter": 1, "items": [], "config": {}}
    if path.exists():
        registry = json.loads(path.read_text(encoding="utf-8"))
    registry["items"].append(
        {
            "job_id": job_id,
            "project_id": project,
            "job_type": job_type,
            "status": status,
            "created_at": "2026-07-24T10:00:00",
            "updated_at": "2026-07-24T10:00:00",
        }
    )
    path.write_text(json.dumps(registry), encoding="utf-8")


class TestBestCerPriority:
    def test_production_takes_priority(self, temp_projects):
        pid = "p_prod"
        _seed_model(pid, "prod_model", status="Production", cer=0.05)
        _seed_model(pid, "cand_model", status="Candidate", cer=0.01)  # より良いCERでもProductionが優先
        quality = _project_dashboard_quality(pid)
        assert quality["best_cer_source"] == "production"
        assert quality["best_cer"] == 0.05
        assert quality["production_model"] == "prod_model.tess.json"

    def test_candidate_used_when_production_unevaluated(self, temp_projects):
        pid = "p_cand"
        _seed_model(pid, "prod_model", status="Production", cer=None)  # Productionだが評価未実施
        _seed_model(pid, "cand_model", status="Candidate", cer=0.08)
        quality = _project_dashboard_quality(pid)
        assert quality["best_cer_source"] == "candidate"
        assert quality["best_cer"] == 0.08

    def test_best_model_fallback_when_no_production_or_candidate(self, temp_projects):
        pid = "p_best"
        _seed_model(pid, "draft_a", status=None, cer=0.20)
        _seed_model(pid, "draft_b", status=None, cer=0.12)
        quality = _project_dashboard_quality(pid)
        assert quality["best_cer_source"] == "best_model"
        assert quality["best_cer"] == 0.12
        assert quality["best_cer_model"] == "draft_b.tess.json"

    def test_none_when_no_evaluation_exists(self, temp_projects):
        pid = "p_none"
        _seed_model(pid, "draft_only", status=None, cer=None)
        quality = _project_dashboard_quality(pid)
        assert quality["best_cer_source"] == ""
        assert quality["best_cer"] is None

    def test_no_models_at_all_returns_none(self, temp_projects):
        pid = "p_empty"
        ensure_project_directories(pid)
        quality = _project_dashboard_quality(pid)
        assert quality["best_cer"] is None
        assert quality["production_model"] == ""
        assert quality["benchmark_count"] == 0


class TestBenchmarkAndProduction:
    def test_benchmark_count_reflects_registry(self, temp_projects):
        pid = "p_bm"
        _seed_benchmarks(pid, 7)
        quality = _project_dashboard_quality(pid)
        assert quality["benchmark_count"] == 7

    def test_production_model_id_resolved_from_experiments(self, temp_projects):
        pid = "p_mid"
        _seed_model(pid, "m1", status="Production", cer=0.03)
        quality = _project_dashboard_quality(pid)
        assert quality["production_model_id"].startswith("M")


class TestLatestBenchmark:
    def test_latest_completed_benchmark_returns_balance_and_p95(self, temp_projects):
        pid = "p_bench_latest"
        # cer=0.05・failed無し・単一エンジンのため speed_score=1.0/stability=1.0
        # balance = 0.7*(1-0.05) + 0.2*1 + 0.1*1 = 0.965 → ×100で96.5
        _seed_benchmark_run(pid, "BM-0001", cer=0.05, mean_time_ms=200.0, p95_time_ms=42.0)
        quality = _project_dashboard_quality(pid)
        latest = quality["latest_benchmark"]
        assert latest is not None
        assert latest["benchmark_id"] == "BM-0001"
        assert latest["balance_score"] == 96.5
        assert latest["p95_ms"] == 42.0
        assert latest["completed_at"] == "2026-07-24T10:00:00"

    def test_multiple_items_selects_latest(self, temp_projects):
        pid = "p_bench_multi"
        _seed_benchmark_run(pid, "BM-0001", cer=0.20, p95_time_ms=100.0, completed_at="2026-07-20T10:00:00")
        _seed_benchmark_run(pid, "BM-0002", cer=0.05, p95_time_ms=42.0, completed_at="2026-07-24T10:00:00")
        quality = _project_dashboard_quality(pid)
        latest = quality["latest_benchmark"]
        assert latest["benchmark_id"] == "BM-0002"
        assert latest["p95_ms"] == 42.0

    def test_no_benchmark_at_all_returns_none(self, temp_projects):
        pid = "p_bench_none"
        ensure_project_directories(pid)
        quality = _project_dashboard_quality(pid)
        assert quality["latest_benchmark"] is None

    def test_failed_only_returns_none(self, temp_projects):
        # Failed（Job側で失敗）は run_benchmark_job の保存処理まで到達しないため、
        # benchmarks.json へitemとして残らない（Jobレコードのみ存在する状態を模す）
        pid = "p_bench_failed"
        _seed_job(pid, "benchmark", status="failed", job_id="JOB-BENCH-1")
        quality = _project_dashboard_quality(pid)
        assert quality["latest_benchmark"] is None

    def test_cancelled_only_returns_none(self, temp_projects):
        pid = "p_bench_cancelled"
        _seed_job(pid, "benchmark", status="cancel_requested", job_id="JOB-BENCH-2")
        quality = _project_dashboard_quality(pid)
        assert quality["latest_benchmark"] is None

    def test_interrupted_only_returns_none(self, temp_projects):
        # Interrupted（プロセス強制終了等でrunningのまま完了しなかった実行）も同様にitem化されない
        pid = "p_bench_interrupted"
        _seed_job(pid, "benchmark", status="stopped", job_id="JOB-BENCH-3")
        quality = _project_dashboard_quality(pid)
        assert quality["latest_benchmark"] is None


class TestBestExactMatch:
    def test_paired_with_best_cer_model_not_a_different_model(self, temp_projects):
        pid = "p_exact"
        _seed_model(pid, "prod_model", status="Production", cer=0.05, exact_match=88.5)
        _seed_model(pid, "cand_model", status="Candidate", cer=0.01, exact_match=99.9)  # 良いCERでも無視される
        quality = _project_dashboard_quality(pid)
        assert quality["best_cer_source"] == "production"
        assert quality["best_exact_match"] == 88.5

    def test_none_when_not_recorded_not_estimated(self, temp_projects):
        pid = "p_exact_missing"
        _seed_model(pid, "m1", status="Production", cer=0.05, exact_match=None)
        quality = _project_dashboard_quality(pid)
        assert quality["best_cer"] == 0.05
        assert quality["best_exact_match"] is None

    def test_none_when_no_evaluation_at_all(self, temp_projects):
        pid = "p_exact_none"
        _seed_model(pid, "m1", status=None, cer=None)
        quality = _project_dashboard_quality(pid)
        assert quality["best_exact_match"] is None


class TestHasCandidateOrAbove:
    def test_true_when_production_exists(self, temp_projects):
        pid = "p_cand_prod"
        _seed_model(pid, "m1", status="Production", cer=0.05)
        quality = _project_dashboard_quality(pid)
        assert quality["has_candidate_or_above"] is True

    def test_true_when_candidate_exists_without_production(self, temp_projects):
        pid = "p_cand_only"
        _seed_model(pid, "m1", status="Candidate", cer=0.05)
        quality = _project_dashboard_quality(pid)
        assert quality["has_candidate_or_above"] is True

    def test_false_when_only_draft_or_validated(self, temp_projects):
        pid = "p_draft_only"
        _seed_model(pid, "m1", status=None, cer=0.05)
        quality = _project_dashboard_quality(pid)
        assert quality["has_candidate_or_above"] is False

    def test_false_when_no_models(self, temp_projects):
        pid = "p_no_models_cand"
        ensure_project_directories(pid)
        quality = _project_dashboard_quality(pid)
        assert quality["has_candidate_or_above"] is False


class TestAllModelsArchived:
    def test_true_when_every_model_archived_and_no_production(self, temp_projects):
        pid = "p_archived"
        _seed_model(pid, "old1", status="Archived")
        _seed_model(pid, "old2", status="Archived")
        quality = _project_dashboard_quality(pid)
        assert quality["all_models_archived"] is True

    def test_false_when_production_exists(self, temp_projects):
        pid = "p_not_archived"
        _seed_model(pid, "cur", status="Production", cer=0.05)
        quality = _project_dashboard_quality(pid)
        assert quality["all_models_archived"] is False

    def test_false_when_no_models(self, temp_projects):
        pid = "p_no_models"
        ensure_project_directories(pid)
        quality = _project_dashboard_quality(pid)
        assert quality["all_models_archived"] is False


class TestActiveJobDetectionNoNPlusOne:
    def test_detects_training_and_evaluation_across_multiple_projects_in_one_read(self, temp_projects):
        ensure_project_directories("p_job_a")
        ensure_project_directories("p_job_b")
        ensure_project_directories("p_job_c")
        _seed_job("p_job_a", "training", status="running", job_id="JOB-000001")
        _seed_job("p_job_b", "evaluation", status="queued", job_id="JOB-000002")
        # 完了済み・他job_typeは対象外（新しい状態を追加しないため学習/評価以外は空文字のまま）
        _seed_job("p_job_c", "benchmark", status="running", job_id="JOB-000003")

        mapping = _active_job_types_by_project()
        assert mapping.get("p_job_a") == "training"
        assert mapping.get("p_job_b") == "evaluation"
        assert "p_job_c" not in mapping

    def test_summary_includes_active_job_type(self, temp_projects):
        ensure_project_directories("p_running")
        _seed_job("p_running", "training", status="running")
        mapping = _active_job_types_by_project()
        summary = _build_project_summary("p_running", mapping.get("p_running", ""))
        assert summary["active_job_type"] == "training"


class TestSampleImage:
    def test_returns_first_raw_image_sorted(self, temp_projects):
        pid = "p_thumb"
        paths = ensure_project_directories(pid)
        (paths.raw / "b.png").write_bytes(b"fake")
        (paths.raw / "a.png").write_bytes(b"fake")
        summary = _build_project_summary(pid)
        assert summary["sample_image"] == "a.png"

    def test_empty_when_no_images(self, temp_projects):
        pid = "p_thumb_empty"
        ensure_project_directories(pid)
        summary = _build_project_summary(pid)
        assert summary["sample_image"] == ""


class TestApiEndToEnd:
    def test_get_projects_returns_new_fields_without_breaking_existing_ones(self, temp_projects):
        from src.app.main import app

        pid = "p_api"
        _seed_model(pid, "api_model", status="Production", cer=0.09)
        _seed_benchmarks(pid, 3)
        client = TestClient(app)
        resp = client.get("/projects")
        assert resp.status_code == 200
        data = resp.json()
        row = next(r for r in data["summaries"] if r["project_id"] == pid)
        # 既存フィールド（回帰）
        assert "images" in row and "labeled" in row and "models" in row and "updated_at" in row and "image_stage" in row
        # 新規フィールド
        assert row["production_model"] == "api_model.tess.json"
        assert row["best_cer"] == 0.09
        assert row["best_cer_source"] == "production"
        assert row["best_exact_match"] == 90.0
        assert row["has_candidate_or_above"] is True
        assert row["benchmark_count"] == 3
        assert row["active_job_type"] == ""
        # latest_benchmark: 登録簿はあるがresults未記録の軽量フィクスチャのため、benchmark_idのみ解決できる
        assert row["latest_benchmark"]["benchmark_id"] == "BM-0002"
        assert row["latest_benchmark"]["balance_score"] is None
