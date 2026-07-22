"""Experiment Validation（実験比較の妥当性判定）のテスト。

- Evaluation Profile正規化と Evaluation Hash生成（同一条件=同一Hash・日時は除外・生成不可条件）
- Comparable Group（CG-0001形式・出現順採番・Hashなしは含めない）
- 分析対象ON/OFF（PATCH相当）とバックフィルの既定=分析対象外
- 推薦の除外（バックフィル/CERなし/評価未実施/Hash生成不可）と根拠件数・5件未満=insufficient
"""

import pytest

from src.app.services.experiment_tracker import (
    analysis_exclusion_reason,
    attach_evaluation,
    build_comparable_groups,
    build_recommendations,
    compute_evaluation_hash,
    list_experiments,
    normalize_evaluation_profile,
    record_experiment,
    set_analysis_enabled,
)


def _evaluation(dataset="ds1", whitelist="AB", psm=7, cer=0.3, signature="sha256:pre1", image_count=100):
    return {
        "cer": cer,
        "char_accuracy": 1 - cer,
        "accuracy_percent": 40,
        "improved": 5,
        "regressed": 1,
        "evaluated_at": "2026-07-22T10:00:00",
        "dataset": dataset,
        "dataset_id": dataset,
        "image_count": image_count,
        "label_count": image_count,
        "preprocess_signature": signature,
        "engine": "tesseract",
        "psm": psm,
        "whitelist": whitelist,
    }


def _record_evaluated(project_id, model, evaluation, iterations=1000, aug=None):
    record_experiment(
        project_id,
        {
            "models": [model],
            "training": {"iterations": iterations},
            "augmentation": {"config": aug, "generated": None},
        },
    )
    attach_evaluation(project_id, model, evaluation)


# ---------- Evaluation Hash ----------


def test_evaluation_hash_same_conditions_same_hash():
    p1 = normalize_evaluation_profile(_evaluation())
    p2 = normalize_evaluation_profile({**_evaluation(), "evaluated_at": "2026-07-23T00:00:00", "cer": 0.9})
    assert compute_evaluation_hash(p1) == compute_evaluation_hash(p2)  # 日時・結果値はHashへ影響しない
    assert compute_evaluation_hash(p1).startswith("sha256:")


@pytest.mark.parametrize(
    "patch",
    [
        {"whitelist": "ABC"},
        {"dataset": "ds2", "dataset_id": "ds2"},
        {"psm": 6},
        {"preprocess_signature": "sha256:pre2"},
        {"image_count": 200},
    ],
)
def test_evaluation_hash_changes_on_condition_diff(patch):
    base = normalize_evaluation_profile(_evaluation())
    changed = normalize_evaluation_profile({**_evaluation(), **patch})
    assert compute_evaluation_hash(base) != compute_evaluation_hash(changed)


def test_evaluation_hash_unavailable_when_no_identity():
    # データセットID・前処理識別子の両方が空=条件を特定できない → Hash生成不可（空文字）
    profile = normalize_evaluation_profile({"dataset": "", "preprocess_signature": ""})
    assert compute_evaluation_hash(profile) == ""
    assert compute_evaluation_hash(None) == ""


# ---------- Comparable Group ----------


def test_comparable_groups_assigned_by_hash(temp_projects):
    pid = "p_cg"
    _record_evaluated(pid, "a.tess.json", _evaluation(dataset="ds1"))
    _record_evaluated(pid, "b.tess.json", _evaluation(dataset="ds1"))
    _record_evaluated(pid, "c.tess.json", _evaluation(dataset="ds2"))
    record_experiment(pid, {"models": ["d.tess.json"]})  # 評価未実施=グループなし
    items = list_experiments(pid, backfill=False)
    by_id = {row["experiment_id"]: row for row in items}
    assert by_id["EXP-0001"]["comparable_group"] == "CG-0001"
    assert by_id["EXP-0002"]["comparable_group"] == "CG-0001"  # 同一条件=同一グループ
    assert by_id["EXP-0003"]["comparable_group"] == "CG-0002"  # データセット違い=別グループ
    assert by_id["EXP-0004"]["comparable_group"] == ""  # Hashなしはグループへ含めない
    groups = build_comparable_groups(items)
    assert [g["group_id"] for g in groups] == ["CG-0001", "CG-0002"]
    assert groups[0]["count"] == 2 and groups[0]["experiments"] == ["EXP-0001", "EXP-0002"]
    assert groups[0]["dataset"] == "ds1"


# ---------- 分析対象ON/OFF・バックフィル既定 ----------


def test_analysis_toggle_and_backfill_default(temp_projects):
    from src.app.project_paths import ensure_project_directories
    import json

    pid = "p_toggle"
    _record_evaluated(pid, "t.tess.json", _evaluation())
    paths = ensure_project_directories(pid)
    (paths.models / "old.tess.json").write_text(json.dumps({"created_at": "2026-07-01T00:00:00"}), encoding="utf-8")
    items = {row["experiment_id"]: row for row in list_experiments(pid)}  # backfillが走る
    assert items["EXP-0001"]["analysis_enabled"] is True  # 学習由来は既定で分析対象
    backfilled = next(row for row in items.values() if row["source"] == "backfill")
    assert backfilled["analysis_enabled"] is False  # バックフィルは既定で分析対象外
    # ON/OFF切替（失敗実験の除外・バックフィルの復帰）
    set_analysis_enabled(pid, "EXP-0001", False)
    set_analysis_enabled(pid, backfilled["experiment_id"], True)
    items2 = {row["experiment_id"]: row for row in list_experiments(pid, backfill=False)}
    assert items2["EXP-0001"]["analysis_enabled"] is False
    assert items2[backfilled["experiment_id"]]["analysis_enabled"] is True
    with pytest.raises(FileNotFoundError):
        set_analysis_enabled(pid, "EXP-9999", True)


# ---------- 推薦の除外・根拠件数 ----------


def test_recommendation_uses_only_comparable_and_reports_basis(temp_projects):
    pid = "p_rec"
    # 比較可能グループ（ds1）: Iteration違いの6件（5件以上=insufficientでない）
    for index, (iteration, cer) in enumerate([(1000, 0.38), (3000, 0.35), (5000, 0.33), (10000, 0.29), (12000, 0.31), (15000, 0.32)]):
        _record_evaluated(pid, f"m{index}.tess.json", _evaluation(cer=cer), iterations=iteration)
    # 別条件（ds2）の優秀な実験は根拠へ混ぜない
    _record_evaluated(pid, "other.tess.json", _evaluation(dataset="ds2", cer=0.05), iterations=99999)
    # 除外対象: 評価未実施 / CERなし / 分析対象OFF
    record_experiment(pid, {"models": ["ne.tess.json"], "training": {"iterations": 1}})
    _record_evaluated(pid, "nocer.tess.json", {**_evaluation(), "cer": None})
    _record_evaluated(pid, "disabled.tess.json", _evaluation(cer=0.01), iterations=77777)
    disabled_id = next(
        row["experiment_id"] for row in list_experiments(pid, backfill=False) if "disabled.tess.json" in row["models"]
    )
    set_analysis_enabled(pid, disabled_id, False)

    result = build_recommendations(pid)
    assert result["group_id"] == "CG-0001"
    assert result["basis_count"] == 6
    assert result["insufficient"] is False
    assert "6件の比較可能Experiment" in result["safety"]
    by_id = {card["id"]: card for card in result["cards"]}
    assert by_id["iteration"]["value"] == "10,000 を推奨"  # ds2の99999やOFFの77777に引きずられない
    assert "過学習傾向" in by_id["iteration"]["reason"]
    reasons = {row["reason"] for row in result["excluded"]}
    assert {"not_evaluated", "no_cer", "analysis_disabled"} <= reasons


def test_recommendation_insufficient_below_five(temp_projects):
    pid = "p_few"
    for index, cer in enumerate([0.35, 0.30]):
        _record_evaluated(pid, f"m{index}.tess.json", _evaluation(cer=cer), iterations=1000 * (index + 1))
    result = build_recommendations(pid)
    assert result["basis_count"] == 2
    assert result["insufficient"] is True  # 5件未満=参考値・データ不足


def test_exclusion_reasons():
    assert analysis_exclusion_reason({"source": "backfill"}) == "backfill"
    assert analysis_exclusion_reason({"analysis_enabled": False}) == "analysis_disabled"
    assert analysis_exclusion_reason({"analysis_enabled": True, "evaluation": None}) == "not_evaluated"
    assert analysis_exclusion_reason({"analysis_enabled": True, "evaluation": {"cer": None}}) == "no_cer"
    assert (
        analysis_exclusion_reason({"analysis_enabled": True, "evaluation": {"cer": 0.3}, "evaluation_profile": None})
        == "no_evaluation_hash"
    )
    ok = {
        "analysis_enabled": True,
        "evaluation": {"cer": 0.3},
        "evaluation_profile": normalize_evaluation_profile(_evaluation()),
    }
    assert analysis_exclusion_reason(ok) == ""
