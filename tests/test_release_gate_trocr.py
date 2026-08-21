"""TrOCR Release Gate Integration（Issue #104）のテスト。

既存Release Gate lifecycle（Draft/Validated/Candidate/Production/Archived）へ
TrOCRモデル（`.trocr.json`）を統合したことの回帰テスト。実TrOCRモデル・Hugging Face
network access・GPU/CUDAへは依存しない（Release Gate自体はモデルをloadしない）。
"""

from __future__ import annotations

import json

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.experiment_tracker import attach_evaluation, record_experiment
from src.app.services.release_gate import evaluate_release_gate
from src.app.services.release_manager import list_releases, promote_model, set_release_policy

PID = "p_gate_trocr"


def _seed_trocr_model(model="trocr_job-1.trocr.json", project=PID, model_dir="/data/models/trocr-a"):
    """`.trocr.json`sidecarを直接書き込む（Issue #96のregister_trocr_model()と同じ
    ファイル形状。実TrOCRモデル・artifact directoryは不要——Release Gate自体は
    モデルをloadしないため）。"""
    paths = ensure_project_directories(project)
    (paths.models / model).write_text(
        json.dumps(
            {
                "name": model,
                "engine": "trocr",
                "model_dir": model_dir,
                "base_model_ref": "microsoft/trocr-base-printed",
                "project_id": project,
                "job_id": "job-1",
                "dataset_root": "",
                "dataset_id": "",
                "epochs": 3,
                "batch_size": 2,
                "learning_rate": 5e-5,
                "final_loss": 0.5,
                "created_at": "2026-08-01T00:00:00",
            }
        ),
        encoding="utf-8",
    )
    return paths


def _seed_evaluated_trocr_experiment(model="trocr_job-1.trocr.json", cer=0.05, project=PID, **extra):
    record_experiment(project, {"models": [model], "experiment_name": f"exp-{model}"})
    evaluation = {
        "cer": cer,
        "char_accuracy": 1 - cer,
        "accuracy_percent": 80.0,
        "dataset_id": "eval_a",
        "image_count": 100,
        "label_count": 100,
        "preprocess_signature": "none:x",
        "engine": "trocr",
        "psm": 7,
        "whitelist": "",
        **extra,
    }
    return attach_evaluation(project, model, evaluation)


def _seed_benchmark_result(project, *, engine, model, failed=0, rank_hint_cer=0.02):
    """`benchmarks.json`へ最小限のBenchmark結果を直接書き込む（run_benchmark_job()を
    実行せず、_latest_benchmark_result()が読む形状のみを再現する）。"""
    from src.app.services import benchmark as bm

    paths = ensure_project_directories(project)
    registry = {
        "counter": 1,
        "items": [
            {
                "benchmark_id": "BM-0001",
                "name": "seeded",
                "created_at": "2026-08-01T00:00:00",
                "completed_at": "2026-08-01T00:01:00",
                "profile": {"profile_hash": "sha256:dummy"},
                "preprocess": {"mode": "none", "hash": "", "source_model": ""},
                "results": [
                    {
                        "engine": engine,
                        "model": model,
                        "engine_key": f"{engine}:{model}",
                        "label": engine,
                        "cer": rank_hint_cer,
                        "exact_match_rate": 0.9,
                        "failed": failed,
                        "total": 10,
                        "mean_time_ms": 100.0,
                    }
                ],
                "cases": [],
            }
        ],
        "config": {},
    }
    bm._save_registry(project, registry)  # noqa: SLF001


# ---------------------------------------------------------------------------
# TrOCR Model Identification / list_releases()
# ---------------------------------------------------------------------------


def test_list_releases_includes_trocr_model(temp_projects):
    _seed_trocr_model()
    releases = list_releases(PID)
    assert releases["statuses"]["trocr_job-1.trocr.json"]["status"] == "Draft"  # 既定=学習直後


def test_list_releases_still_includes_tesseract_and_paddleocr(temp_projects):
    """既存2エンジンへの回帰がないことを確認する。"""
    paths = ensure_project_directories(PID)
    (paths.models / "m1.tess.json").write_text("{}", encoding="utf-8")
    (paths.models / "m1.ocr.json").write_text("{}", encoding="utf-8")
    _seed_trocr_model()
    releases = list_releases(PID)
    assert set(releases["statuses"].keys()) == {"m1.tess.json", "m1.ocr.json", "trocr_job-1.trocr.json"}


# ---------------------------------------------------------------------------
# Release Gate判定（NOT_EVALUATED / PASS / FAIL）
# ---------------------------------------------------------------------------


def test_gate_trocr_not_evaluated_then_pass(temp_projects):
    _seed_trocr_model()
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    assert gate["verdict"] == "NOT_EVALUATED"

    _seed_evaluated_trocr_experiment(cer=0.05)
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    assert gate["verdict"] == "PASS"
    assert gate["rules"] == []


def test_gate_trocr_max_cer_fail(temp_projects):
    _seed_trocr_model()
    _seed_evaluated_trocr_experiment(cer=0.10)
    set_release_policy(PID, {"max_cer": 0.05})
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    assert gate["verdict"] == "FAIL"
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_cer"]["result"] == "fail"


# ---------------------------------------------------------------------------
# Allowed Engines（_model_engine()がTrOCRを識別できること）
# ---------------------------------------------------------------------------


def test_gate_allowed_engines_recognizes_trocr(temp_projects):
    _seed_trocr_model()
    _seed_evaluated_trocr_experiment(cer=0.01)
    set_release_policy(PID, {"allowed_engines": ["trocr"]})
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["allowed_engines"]["result"] == "pass"
    assert by_rule["allowed_engines"]["actual"] == "trocr"  # "不明"にならない


def test_gate_allowed_engines_rejects_trocr_when_not_listed(temp_projects):
    _seed_trocr_model()
    _seed_evaluated_trocr_experiment(cer=0.01)
    set_release_policy(PID, {"allowed_engines": ["tesseract", "paddleocr"]})
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["allowed_engines"]["result"] == "fail"
    assert gate["verdict"] == "FAIL"


# ---------------------------------------------------------------------------
# Benchmark Evidence接続（sidecar名→model_dir解決）
# ---------------------------------------------------------------------------


def test_gate_benchmark_rank_unverified_without_matching_benchmark(temp_projects):
    _seed_trocr_model(model_dir="/data/models/trocr-a")
    _seed_evaluated_trocr_experiment(cer=0.01)
    # Benchmark結果はあるが、model_dirが一致しない（別モデル）
    _seed_benchmark_result(PID, engine="trocr", model="/data/models/trocr-OTHER", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1, "max_failed": 0})
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "unverified"
    assert by_rule["max_failed"]["result"] == "unverified"


def test_gate_benchmark_rank_connects_via_model_dir_resolution(temp_projects):
    """Benchmark（Issue #102）はTrOCRのmodelへmodel_dirを保存するため、Release Gate側の
    sidecar名とは異なる文字列になる。list_trocr_models()経由の解決で正しく接続できることを
    確認する（Issue #104の中心的な設計判断）。"""
    _seed_trocr_model(model_dir="/data/models/trocr-a")
    _seed_evaluated_trocr_experiment(cer=0.01)
    _seed_benchmark_result(PID, engine="trocr", model="/data/models/trocr-a", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1, "max_failed": 0})
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "pass"
    assert by_rule["max_failed"]["result"] == "pass"
    assert gate["verdict"] == "PASS"


def test_gate_benchmark_rank_connects_despite_path_separator_style_difference(temp_projects):
    """Issue #164（TrOCR End-to-End Production Workflow Validation）で発見した回帰ガード:
    sidecarのmodel_dir（Windowsでは`\\`区切り）とBenchmark実行時にユーザーが入力した
    同じmodel_ref（`/`区切り）が、実際には同一パスを指しているにも関わらず単純な文字列
    比較では一致せず、Release Gateが実在するBenchmark結果を「Benchmarkなし」として
    見落とすことを実際のE2E実行で確認した。区切り文字が違うだけの同一パスは接続される
    ことを確認する（`os.path.normpath()`による正規化比較、Issue #164で追加）。"""
    _seed_trocr_model(model_dir="C:\\models\\trocr-a")
    _seed_evaluated_trocr_experiment(cer=0.01)
    _seed_benchmark_result(PID, engine="trocr", model="C:/models/trocr-a", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1, "max_failed": 0})
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "pass"
    assert by_rule["max_failed"]["result"] == "pass"
    assert gate["verdict"] == "PASS"


def test_gate_benchmark_max_failed_fail_via_model_dir_resolution(temp_projects):
    _seed_trocr_model(model_dir="/data/models/trocr-a")
    _seed_evaluated_trocr_experiment(cer=0.01)
    _seed_benchmark_result(PID, engine="trocr", model="/data/models/trocr-a", failed=5)
    set_release_policy(PID, {"max_failed": 0})
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_failed"]["result"] == "fail"
    assert gate["verdict"] == "FAIL"


def test_gate_benchmark_trocr_row_does_not_match_different_model_dir(temp_projects):
    """model_dirが異なるTrOCR行は、engineが一致していても誤って接続されないことを確認する
    （_resolve_trocr_benchmark_model_ref()の照合がmodel_dirの厳密一致であることの回帰確認）。"""
    _seed_trocr_model(model_dir="/data/models/trocr-a")
    _seed_evaluated_trocr_experiment(cer=0.01)
    _seed_benchmark_result(PID, engine="trocr", model="/data/models/trocr-DIFFERENT", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1})
    gate = evaluate_release_gate(PID, "trocr_job-1.trocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "unverified"


def test_gate_benchmark_trocr_row_does_not_leak_into_tesseract_query(temp_projects):
    """`.trocr.json`ではないモデル（Tesseract）を照会した場合、TrOCR resolver（sidecar名→
    model_dir解決）は一切発動せず、trocr engineのBenchmark行と誤って接続されないことを
    確認する（model.endswith(".trocr.json")ガードの回帰確認）。"""
    paths = ensure_project_directories(PID)
    (paths.models / "m1.tess.json").write_text("{}", encoding="utf-8")
    record_experiment(PID, {"models": ["m1.tess.json"]})
    attach_evaluation(
        PID,
        "m1.tess.json",
        {"cer": 0.01, "char_accuracy": 0.99, "dataset_id": "eval_a", "image_count": 10, "label_count": 10},
    )
    # 偶然にも"model"の値が同じ文字列になるtrocr行を用意する（本来は接続対象外）
    _seed_benchmark_result(PID, engine="trocr", model="m1.tess.json", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1})
    gate = evaluate_release_gate(PID, "m1.tess.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "unverified"


# ---------------------------------------------------------------------------
# Promotion（Draft→...→Production。既存artifact存在確認契約を維持）
# ---------------------------------------------------------------------------


def test_promote_trocr_model_to_production(temp_projects):
    _seed_trocr_model()
    _seed_evaluated_trocr_experiment(cer=0.01)
    result = promote_model(PID, "trocr_job-1.trocr.json", note="初回リリース")
    assert result["model"] == "trocr_job-1.trocr.json"
    releases = list_releases(PID)
    assert releases["production"] == "trocr_job-1.trocr.json"
    assert releases["statuses"]["trocr_job-1.trocr.json"]["status"] == "Production"


def test_promote_trocr_model_missing_artifact_raises(temp_projects):
    ensure_project_directories(PID)  # sidecarを作らない
    with pytest.raises(FileNotFoundError):
        promote_model(PID, "trocr_job-999.trocr.json", note="x")


def test_promote_trocr_blocked_on_fail_and_override(temp_projects):
    _seed_trocr_model()
    _seed_evaluated_trocr_experiment(cer=0.5)
    set_release_policy(PID, {"max_cer": 0.1})
    with pytest.raises(ValueError, match="例外承認"):
        promote_model(PID, "trocr_job-1.trocr.json", note="無理やり")
    result = promote_model(
        PID, "trocr_job-1.trocr.json", note="緊急", override_reason="顧客要望による暫定対応", approved_by="hashimoto"
    )
    assert result["entry"]["override"]["approved_by"] == "hashimoto"
