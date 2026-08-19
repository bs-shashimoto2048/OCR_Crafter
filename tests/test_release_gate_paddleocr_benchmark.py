"""PaddleOCR Release Gate Benchmark Linkage（Issue #137）のテスト。

Issue #117のFuture Workで記録された、PaddleOCR自作モデル（.ocr.json）が
`_latest_benchmark_result()`で一切照合されない（常にBenchmarkなし扱いになる）
既存gapの修正を検証する。実PaddleOCRモデル・推論用エクスポートには依存しない
（Release Gate自体はモデルをloadしないため、`.ocr.json` sidecarを直接書き込む
既存の`test_release_gate_trocr.py`と同じ手法を用いる）。
"""

from __future__ import annotations

import json

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.experiment_tracker import attach_evaluation, record_experiment
from src.app.services.release_gate import evaluate_release_gate
from src.app.services.release_manager import list_releases, set_release_policy

PID = "p_gate_paddleocr"


def _seed_paddleocr_model(model="m1.ocr.json", project=PID):
    paths = ensure_project_directories(project)
    (paths.models / model).write_text(json.dumps({"created_at": "2026-08-01T00:00:00"}), encoding="utf-8")
    return paths


def _seed_evaluated_paddleocr_experiment(model="m1.ocr.json", cer=0.05, project=PID, **extra):
    record_experiment(project, {"models": [model], "experiment_name": f"exp-{model}"})
    evaluation = {
        "cer": cer,
        "char_accuracy": 1 - cer,
        "accuracy_percent": 80.0,
        "dataset_id": "eval_a",
        "image_count": 100,
        "label_count": 100,
        "preprocess_signature": "none:x",
        "engine": "paddleocr",
        **extra,
    }
    return attach_evaluation(project, model, evaluation)


def _seed_benchmark_result(project, *, engine, model, failed=0, rank_hint_cer=0.02):
    """`benchmarks.json`へ最小限のBenchmark結果を直接書き込む（`test_release_gate_trocr.py`と
    同じ手法。run_benchmark_job()は実行せず、_latest_benchmark_result()が読む形状のみ再現する）。"""
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
# PaddleOCR custom model → 正しいBenchmark linkage
# ---------------------------------------------------------------------------


def test_gate_benchmark_unverified_without_matching_benchmark(temp_projects):
    """既存gap: 修正前は常にこの状態（paddleocr_customが一切照合されない）だった。"""
    _seed_paddleocr_model()
    _seed_evaluated_paddleocr_experiment(cer=0.01)
    set_release_policy(PID, {"max_benchmark_rank": 1, "max_failed": 0})
    gate = evaluate_release_gate(PID, "m1.ocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "unverified"
    assert by_rule["max_failed"]["result"] == "unverified"


def test_gate_benchmark_connects_via_paddleocr_custom_direct_match(temp_projects):
    """本Issueの中心的な修正: paddleocr_customはsidecarファイル名の直接一致で
    Benchmark結果と接続できる（TrOCRのような追加解決は不要）。"""
    _seed_paddleocr_model()
    _seed_evaluated_paddleocr_experiment(cer=0.01)
    _seed_benchmark_result(PID, engine="paddleocr_custom", model="m1.ocr.json", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1, "max_failed": 0})
    gate = evaluate_release_gate(PID, "m1.ocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "pass"
    assert by_rule["max_failed"]["result"] == "pass"
    assert gate["verdict"] == "PASS"


def test_gate_benchmark_max_failed_fail_via_paddleocr_custom(temp_projects):
    _seed_paddleocr_model()
    _seed_evaluated_paddleocr_experiment(cer=0.01)
    _seed_benchmark_result(PID, engine="paddleocr_custom", model="m1.ocr.json", failed=5)
    set_release_policy(PID, {"max_failed": 0})
    gate = evaluate_release_gate(PID, "m1.ocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_failed"]["result"] == "fail"
    assert gate["verdict"] == "FAIL"


def test_gate_benchmark_different_paddleocr_model_does_not_leak(temp_projects):
    """同じengineでも別モデル（別.ocr.jsonファイル名）の結果へ誤って接続しない。"""
    _seed_paddleocr_model(model="m1.ocr.json")
    _seed_evaluated_paddleocr_experiment(model="m1.ocr.json", cer=0.01)
    _seed_benchmark_result(PID, engine="paddleocr_custom", model="m2-OTHER.ocr.json", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1})
    gate = evaluate_release_gate(PID, "m1.ocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "unverified"


def test_gate_benchmark_paddleocr_official_row_does_not_match_custom_model(temp_projects):
    """paddleocr_official（事前学習済みモデル。.ocr.json sidecarを持たずRelease候補に
    ならない）のBenchmark行は、名前が偶然一致しても意図的にRelease Gateへ接続されない
    （official/customの識別を曖昧一致にしない、Issue本文の要求）。"""
    _seed_paddleocr_model(model="m1.ocr.json")
    _seed_evaluated_paddleocr_experiment(model="m1.ocr.json", cer=0.01)
    # official行のmodelはPaddleOCR公式モデル名（.ocr.jsonではない）が通常だが、
    # 念のため偶然同名になるケースも含めて、engineがofficialならcustomモデルへ接続しないことを確認する
    _seed_benchmark_result(PID, engine="paddleocr_official", model="m1.ocr.json", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1})
    gate = evaluate_release_gate(PID, "m1.ocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "unverified"


def test_gate_benchmark_multiple_results_picks_latest_existing_semantics(temp_projects):
    """既存のsemantics（新しい順のBenchmarkから最初に一致した行を採用）が
    PaddleOCRでも維持されることを確認する。"""
    from src.app.services import benchmark as bm

    _seed_paddleocr_model()
    _seed_evaluated_paddleocr_experiment(cer=0.01)
    paths = ensure_project_directories(PID)
    registry = {
        # list_benchmarks()はregistry["items"]を追記順（古い→新しい）とみなしreversed()で
        # 新しい順へ変換する（benchmark.py::list_benchmarks()実装の既存仕様）。
        # そのため生成順は「古い方を先」にする（本番のcreate_benchmark追記順と同じ）
        "counter": 2,
        "items": [
            {
                "benchmark_id": "BM-0001",
                "name": "older",
                "created_at": "2026-08-01T00:00:00",
                "completed_at": "2026-08-01T00:01:00",
                "profile": {"profile_hash": "sha256:dummy"},
                "preprocess": {"mode": "none", "hash": "", "source_model": ""},
                "results": [
                    {"engine": "paddleocr_custom", "model": "m1.ocr.json", "engine_key": "paddleocr_custom:m1.ocr.json",
                     "label": "paddleocr_custom", "cer": 0.5, "exact_match_rate": 0.1, "failed": 9, "total": 10, "mean_time_ms": 200.0},
                ],
                "cases": [],
            },
            {
                "benchmark_id": "BM-0002",
                "name": "newer",
                "created_at": "2026-08-02T00:00:00",
                "completed_at": "2026-08-02T00:01:00",
                "profile": {"profile_hash": "sha256:dummy2"},
                "preprocess": {"mode": "none", "hash": "", "source_model": ""},
                "results": [
                    {"engine": "paddleocr_custom", "model": "m1.ocr.json", "engine_key": "paddleocr_custom:m1.ocr.json",
                     "label": "paddleocr_custom", "cer": 0.01, "exact_match_rate": 0.95, "failed": 0, "total": 10, "mean_time_ms": 90.0},
                ],
                "cases": [],
            },
        ],
        "config": {},
    }
    bm._save_registry(PID, registry)  # noqa: SLF001
    set_release_policy(PID, {"max_failed": 0})
    gate = evaluate_release_gate(PID, "m1.ocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    # list_benchmarks()の新しい順（reversed()適用後の先頭=最新）に従い、
    # newer（BM-0002、failed=0）が採用されることを確認
    assert by_rule["max_failed"]["actual"].startswith("0件")
    assert by_rule["max_failed"]["result"] == "pass"


# ---------------------------------------------------------------------------
# Tesseract / TrOCR 無回帰
# ---------------------------------------------------------------------------


def test_gate_benchmark_tesseract_regression_unaffected(temp_projects):
    paths = ensure_project_directories(PID)
    (paths.models / "m1.tess.json").write_text("{}", encoding="utf-8")
    record_experiment(PID, {"models": ["m1.tess.json"]})
    attach_evaluation(
        PID, "m1.tess.json",
        {"cer": 0.01, "char_accuracy": 0.99, "dataset_id": "eval_a", "image_count": 10, "label_count": 10},
    )
    _seed_benchmark_result(PID, engine="tesseract_model", model="m1.tess.json", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1, "max_failed": 0})
    gate = evaluate_release_gate(PID, "m1.tess.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "pass"
    assert by_rule["max_failed"]["result"] == "pass"


def test_gate_benchmark_trocr_regression_unaffected(temp_projects):
    from src.app.services.release_manager import promote_model  # noqa: F401  (import path sanity only)

    paths = ensure_project_directories(PID)
    (paths.models / "t1.trocr.json").write_text(
        json.dumps({"name": "t1.trocr.json", "engine": "trocr", "model_dir": "/data/models/trocr-a"}),
        encoding="utf-8",
    )
    record_experiment(PID, {"models": ["t1.trocr.json"]})
    attach_evaluation(
        PID, "t1.trocr.json",
        {"cer": 0.01, "char_accuracy": 0.99, "dataset_id": "eval_a", "image_count": 10, "label_count": 10, "engine": "trocr"},
    )
    _seed_benchmark_result(PID, engine="trocr", model="/data/models/trocr-a", failed=0)
    set_release_policy(PID, {"max_benchmark_rank": 1, "max_failed": 0})
    gate = evaluate_release_gate(PID, "t1.trocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_benchmark_rank"]["result"] == "pass"
    assert by_rule["max_failed"]["result"] == "pass"


def test_gate_allowed_engines_recognizes_paddleocr(temp_projects):
    """_model_engine()自体は既存のまま（本Issueで無変更）であることの回帰確認。"""
    _seed_paddleocr_model()
    _seed_evaluated_paddleocr_experiment(cer=0.01)
    set_release_policy(PID, {"allowed_engines": ["paddleocr"]})
    gate = evaluate_release_gate(PID, "m1.ocr.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["allowed_engines"]["result"] == "pass"
    assert by_rule["allowed_engines"]["actual"] == "paddleocr"
