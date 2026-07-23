"""Release Gate（Policy・判定・Override・REL-ID・Version規則・Validated自動遷移）のテスト。"""

import json

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.experiment_tracker import attach_evaluation, record_experiment
from src.app.services.release_gate import (
    comparison_quality,
    evaluate_release_gate,
    normalize_policy,
)
from src.app.services.release_manager import (
    _load,
    list_releases,
    migrate_releases_registry,
    promote_model,
    rollback_release,
    set_model_status,
    set_release_policy,
)

PID = "p_gate"


def _seed_model(model="m1.tess.json", project=PID):
    paths = ensure_project_directories(project)
    (paths.models / model).write_text(json.dumps({"created_at": "2026-07-01T00:00:00"}), encoding="utf-8")
    return paths


def _seed_evaluated_experiment(model="m1.tess.json", cer=0.05, project=PID, **extra):
    record_experiment(project, {"models": [model], "experiment_name": f"exp-{model}"})
    evaluation = {
        "cer": cer,
        "char_accuracy": 1 - cer,
        "accuracy_percent": 80.0,
        "dataset_id": "eval_a",
        "image_count": 100,
        "label_count": 100,
        "preprocess_signature": "none:x",
        "engine": "tesseract",
        "psm": 7,
        "whitelist": "AB01",
        **extra,
    }
    return attach_evaluation(project, model, evaluation)


def test_normalize_policy_and_validation(temp_projects):
    policy = normalize_policy(
        {
            "max_cer": "0.1",
            "min_eval_images": 50,
            "critical_confusions": [{"from": "0", "to": "O", "severity": "fail"}],
            "required_chars": {"chars": "0O", "min_accuracy": 0.95},
            "allowed_engines": ["tesseract"],
        }
    )
    assert policy["max_cer"] == 0.1
    assert policy["min_exact_match"] is None  # 未設定=ルール無効
    assert policy["critical_confusions"][0]["max_count"] == 0
    with pytest.raises(ValueError, match="severity"):
        normalize_policy({"critical_confusions": [{"from": "1", "to": "I", "severity": "block"}]})


def test_comparison_quality_levels(temp_projects):
    a = {"dataset_id": "d1", "psm": 7, "preprocess_signature": "s"}
    assert comparison_quality(a, a, "h1", "h1") == 5
    assert comparison_quality(a, {**a}, "h1", "h2") == 4  # Whitelist違いのみ
    assert comparison_quality(a, {**a, "psm": 8}, "h1", "h2") == 3
    assert comparison_quality(a, {**a, "dataset_id": "d2"}, "h1", "h2") == 2
    assert comparison_quality(None, a, "", "h2") == 1


def test_gate_not_evaluated_and_pass_fail(temp_projects):
    _seed_model()
    # 評価なし → NOT_EVALUATED
    gate = evaluate_release_gate(PID, "m1.tess.json")
    assert gate["verdict"] == "NOT_EVALUATED"
    # 評価あり＋Policy未設定 → ルール0件でPASS
    _seed_evaluated_experiment(cer=0.05)
    gate = evaluate_release_gate(PID, "m1.tess.json")
    assert gate["verdict"] == "PASS"
    assert gate["rules"] == []
    # Max CER=3% → CER5%はFAIL。各ルール行に Rule/Expected/Actual/Result/Message
    set_release_policy(PID, {"max_cer": 0.03, "min_eval_images": 50})
    gate = evaluate_release_gate(PID, "m1.tess.json")
    assert gate["verdict"] == "FAIL"
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["max_cer"]["result"] == "fail"
    assert by_rule["max_cer"]["expected"] and by_rule["max_cer"]["actual"] == "5.00%" and by_rule["max_cer"]["message"]
    assert by_rule["min_eval_images"]["result"] == "pass"  # 100件 >= 50件


def test_gate_critical_confusion_warning_vs_fail(temp_projects):
    _seed_model()
    _seed_evaluated_experiment(
        cer=0.01,
        confusions=[{"kind": "sub", "from": "0", "to": "O", "count": 2}, {"kind": "sub", "from": "5", "to": "S", "count": 1}],
        char_stats={"0": {"total": 10, "errors": 2}},
    )
    # warning設定 → CONDITIONAL_PASS（昇格は可能・警告表示）
    set_release_policy(PID, {"critical_confusions": [{"from": "0", "to": "O", "severity": "warning"}]})
    gate = evaluate_release_gate(PID, "m1.tess.json")
    assert gate["verdict"] == "CONDITIONAL_PASS"
    assert gate["rules"][0]["result"] == "warning"
    # fail設定 → 1件でもFAIL
    set_release_policy(PID, {"critical_confusions": [{"from": "0", "to": "O", "severity": "fail"}]})
    gate = evaluate_release_gate(PID, "m1.tess.json")
    assert gate["verdict"] == "FAIL"
    # 発生していない混同はpass
    set_release_policy(PID, {"critical_confusions": [{"from": "1", "to": "I", "severity": "fail"}]})
    assert evaluate_release_gate(PID, "m1.tess.json")["verdict"] == "PASS"


def test_gate_required_chars_unverified(temp_projects):
    _seed_model()
    _seed_evaluated_experiment(
        cer=0.01,
        char_stats={"0": {"total": 20, "errors": 0}, "O": {"total": 10, "errors": 5}},
    )
    # "1" は評価データに現れない → 未検証（CONDITIONAL_PASS）
    set_release_policy(PID, {"required_chars": {"chars": "01", "min_accuracy": 0.9}})
    gate = evaluate_release_gate(PID, "m1.tess.json")
    assert gate["verdict"] == "CONDITIONAL_PASS"
    assert gate["rules"][0]["result"] == "unverified"
    assert "未検証" in gate["rules"][0]["message"]
    # "O" は正解率50% < 90% → FAIL
    set_release_policy(PID, {"required_chars": {"chars": "0O", "min_accuracy": 0.9}})
    gate = evaluate_release_gate(PID, "m1.tess.json")
    assert gate["verdict"] == "FAIL"
    assert "O" in gate["rules"][0]["message"]


def test_gate_production_comparison_rules(temp_projects):
    _seed_model("prod.tess.json")
    _seed_model("cand.tess.json")
    _seed_evaluated_experiment("prod.tess.json", cer=0.02)
    promote_model(PID, "prod.tess.json", note="初回リリース")
    _seed_evaluated_experiment("cand.tess.json", cer=0.05)  # Productionより悪い・同一評価条件
    set_release_policy(PID, {"no_cer_regression": True, "require_same_evaluation_hash": True, "min_comparison_quality": 5})
    gate = evaluate_release_gate(PID, "cand.tess.json")
    by_rule = {r["rule"]: r for r in gate["rules"]}
    assert by_rule["no_cer_regression"]["result"] == "fail"  # 2%→5%は悪化
    assert by_rule["same_evaluation_hash"]["result"] == "pass"  # 同一条件で評価済み
    assert by_rule["min_comparison_quality"]["result"] == "pass"  # ★5
    assert gate["verdict"] == "FAIL"


def test_gate_benchmark_rules_unverified_without_benchmark(temp_projects):
    _seed_model()
    _seed_evaluated_experiment(cer=0.01)
    set_release_policy(PID, {"max_benchmark_rank": 1, "max_failed": 0})
    gate = evaluate_release_gate(PID, "m1.tess.json")
    assert gate["verdict"] == "CONDITIONAL_PASS"  # Benchmark未実施は未検証（FAILにしない）
    assert all(r["result"] == "unverified" for r in gate["rules"])


def test_promote_blocked_on_fail_and_override(temp_projects):
    _seed_model()
    _seed_evaluated_experiment(cer=0.5)
    set_release_policy(PID, {"max_cer": 0.1})
    # 承認なし → 昇格不可
    with pytest.raises(ValueError, match="例外承認"):
        promote_model(PID, "m1.tess.json", note="無理やり")
    # reasonのみ / approved_byのみ でも不可
    with pytest.raises(ValueError):
        promote_model(PID, "m1.tess.json", note="x", override_reason="緊急対応")
    # 両方あり → 昇格でき、履歴へOverride記録（Failed Rulesスナップショット必須）
    result = promote_model(PID, "m1.tess.json", note="緊急", override_reason="顧客要望による暫定対応", approved_by="hashimoto")
    override = result["entry"]["override"]
    assert override["reason"] == "顧客要望による暫定対応"
    assert override["approved_by"] == "hashimoto"
    assert override["approved_at"]
    assert override["failed_rules"][0]["rule"] == "max_cer"


def test_release_id_backfill_migration(temp_projects):
    paths = ensure_project_directories(PID)
    # 旧形式（schema_versionなし・release_idなし）のreleases.jsonを直接作る
    legacy = {
        "models": {"old.tess.json": {"status": "Production", "version": "1.1.0", "updated_at": "t"}},
        "history": [
            {"version": "1.0.0", "model": "old.tess.json", "released_at": "2026-07-01T00:00:00", "note": "first"},
            {"version": "1.1.0", "model": "old.tess.json", "released_at": "2026-07-10T00:00:00", "note": "second"},
        ],
        "candidate_counter": 0,
    }
    (paths.root / "releases.json").write_text(json.dumps(legacy), encoding="utf-8")
    data = list_releases(PID)
    # 古い順に REL-0001, REL-0002 をバックフィル（既存フィールドは不変）
    assert [h["release_id"] for h in reversed(data["history"])] == ["REL-0001", "REL-0002"]
    assert data["history"][0]["version"] == "1.1.0"
    saved = json.loads((paths.root / "releases.json").read_text(encoding="utf-8"))
    assert saved["schema_version"] == 2 and saved["release_counter"] == 2  # migrationが永続化される
    # 新しいリリースは REL-0003
    _seed_model("new.tess.json")
    result = promote_model(PID, "new.tess.json", note="third")
    assert result["entry"]["release_id"] == "REL-0003"
    # migrate関数は冪等
    registry, changed = migrate_releases_registry(_load(paths.root))
    assert changed is False


def test_rollback_keeps_version_new_release_id(temp_projects):
    _seed_model("a.tess.json")
    _seed_model("b.tess.json")
    promote_model(PID, "a.tess.json", note="v1")
    promote_model(PID, "b.tess.json", note="v2")
    result = rollback_release(PID, "1.0.0", author="ops")
    # RollbackはVersion維持（新規採番しない）＋新Release ID
    assert result["version"] == "1.0.0"
    assert result["entry"]["release_id"] == "REL-0003"
    assert result["entry"]["rollback"] is True
    assert result["entry"]["rollback_from"] == "1.0.0"


def test_candidate_version_preserved(temp_projects):
    _seed_model()
    first = set_model_status(PID, "m1.tess.json", "Candidate")
    assert first["version"] == "0.1"
    set_model_status(PID, "m1.tess.json", "Draft")  # Candidate解除
    again = set_model_status(PID, "m1.tess.json", "Candidate")
    assert again["version"] == "0.1"  # Version維持（再採番しない）


def test_validated_auto_transition(temp_projects):
    _seed_model()
    # 評価成功（CERあり＋Hash生成可能）→ Draft→Validated 自動遷移
    _seed_evaluated_experiment(cer=0.05)
    assert list_releases(PID)["statuses"]["m1.tess.json"]["status"] == "Validated"
    # Candidate以降は自動変更しない
    set_model_status(PID, "m1.tess.json", "Candidate")
    _seed_evaluated_experiment(cer=0.04)
    assert list_releases(PID)["statuses"]["m1.tess.json"]["status"] == "Candidate"
    # Hash生成不可（dataset_id・preprocess_signatureなし）ではDraftのまま
    _seed_model("m2.tess.json")
    record_experiment(PID, {"models": ["m2.tess.json"]})
    attach_evaluation(PID, "m2.tess.json", {"cer": 0.1, "dataset_id": "", "preprocess_signature": ""})
    assert list_releases(PID)["statuses"]["m2.tess.json"]["status"] == "Draft"
