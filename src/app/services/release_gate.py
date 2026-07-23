"""Release Gate（本番昇格の自動判定）。

プロジェクト毎の Release Policy に基づき、モデルの評価結果・Production比較・
Benchmark結果を検証して PASS / CONDITIONAL_PASS / FAIL / NOT_EVALUATED を判定する。

- 各ルールは Rule / Expected / Actual / Result / Message の行として返す（UI表示用）
- 未設定のPolicy項目はルール自体を生成しない（後方互換: Policy未設定=従来どおり制限なし）
- FAIL判定のモデルは例外承認（Override）なしでProductionへ昇格できない
  （承認の強制は release_manager.promote_model 側で行う）
- 判定の情報源は実験カルテ（experiments.json の evaluation / evaluation_profile /
  evaluation_hash）と benchmarks.json（Benchmark Rank / Failed）。推測で補完しない
"""

from __future__ import annotations

from typing import Any, Optional

# ルール判定結果（1行毎）
RESULT_PASS = "pass"
RESULT_FAIL = "fail"
RESULT_WARNING = "warning"
RESULT_UNVERIFIED = "unverified"  # 検証材料がない（評価データに文字がない等）=未検証

VERDICTS = ["PASS", "CONDITIONAL_PASS", "FAIL", "NOT_EVALUATED"]

CRITICAL_SEVERITIES = {"warning", "fail"}


def normalize_policy(policy: dict[str, Any]) -> dict[str, Any]:
    """Release Policyの正規化。未設定キーはNone/空（=ルール無効）として保存する。"""
    src = policy if isinstance(policy, dict) else {}

    def opt_float(key: str) -> Optional[float]:
        value = src.get(key)
        if value in (None, ""):
            return None
        return float(value)

    def opt_int(key: str) -> Optional[int]:
        value = src.get(key)
        if value in (None, ""):
            return None
        return int(value)

    critical: list[dict[str, Any]] = []
    for row in src.get("critical_confusions") or []:
        if not isinstance(row, dict):
            continue
        source = str(row.get("from") or "")
        target = str(row.get("to") or "")
        severity = str(row.get("severity") or "fail").lower()
        if not source or not target:
            continue
        if severity not in CRITICAL_SEVERITIES:
            raise ValueError(f"critical_confusions.severity は warning / fail のいずれか: {severity}")
        critical.append(
            {"from": source, "to": target, "severity": severity, "max_count": max(0, int(row.get("max_count") or 0))}
        )

    required = src.get("required_chars") if isinstance(src.get("required_chars"), dict) else None
    required_chars = None
    if required and str(required.get("chars") or ""):
        required_chars = {
            "chars": str(required["chars"]),
            "min_accuracy": float(required.get("min_accuracy") if required.get("min_accuracy") is not None else 0.9),
        }

    allowed_engines = [str(e).strip() for e in (src.get("allowed_engines") or []) if str(e).strip()]

    return {
        "max_cer": opt_float("max_cer"),
        "min_char_accuracy": opt_float("min_char_accuracy"),
        "min_exact_match": opt_float("min_exact_match"),
        "min_eval_images": opt_int("min_eval_images"),
        "max_failed": opt_int("max_failed"),
        "no_cer_regression": bool(src.get("no_cer_regression", False)),
        "require_same_evaluation_hash": bool(src.get("require_same_evaluation_hash", False)),
        "min_comparison_quality": opt_int("min_comparison_quality"),
        "required_chars": required_chars,
        "critical_confusions": critical,
        "max_benchmark_rank": opt_int("max_benchmark_rank"),
        "allowed_engines": allowed_engines,
    }


def comparison_quality(profile_a: Optional[dict[str, Any]], profile_b: Optional[dict[str, Any]], hash_a: str, hash_b: str) -> int:
    """比較品質（★1〜5）。frontend releaseLogic と同じ規則のサーバー側判定。

    5=Evaluation Hash完全一致 / 4=Whitelist違いのみ / 3=PSM・評価前処理違い /
    2=データセット違い / 1=比較不可（Profile欠損）
    """
    if not hash_a or not hash_b or not isinstance(profile_a, dict) or not isinstance(profile_b, dict):
        return 1
    if hash_a == hash_b:
        return 5
    if str(profile_a.get("dataset_id") or "") != str(profile_b.get("dataset_id") or ""):
        return 2
    same_except_whitelist = (
        profile_a.get("psm") == profile_b.get("psm")
        and str(profile_a.get("preprocess_signature") or "") == str(profile_b.get("preprocess_signature") or "")
    )
    return 4 if same_except_whitelist else 3


def _experiment_for_model(project_id: str, model: str) -> Optional[dict[str, Any]]:
    from .experiment_tracker import list_experiments

    target = None
    for item in list_experiments(project_id, backfill=False):
        if model in [str(m) for m in (item.get("models") or [])]:
            target = item  # 複数該当時は最新
    return target


def _latest_benchmark_result(project_id: str, model: str) -> Optional[dict[str, Any]]:
    """モデルを含む最新Benchmarkのこのモデルの結果行（rank付き）。なければNone。"""
    from .benchmark import list_benchmarks

    for item in list_benchmarks(project_id)["items"]:  # 新しい順
        for row in item.get("results") or []:
            if row.get("engine") == "tesseract_model" and str(row.get("model") or "") == model:
                return {**row, "benchmark_id": item.get("benchmark_id")}
    return None


def _model_engine(model: str) -> str:
    if model.endswith(".tess.json"):
        return "tesseract"
    if model.endswith(".ocr.json"):
        return "paddleocr"
    return ""


def _rule(rule: str, expected: Any, actual: Any, result: str, message: str) -> dict[str, Any]:
    return {"rule": rule, "expected": expected, "actual": actual, "result": result, "message": message}


def _pct(value: Any) -> str:
    return f"{float(value) * 100:.2f}%" if isinstance(value, (int, float)) else "未記録"


def evaluate_release_gate(project_id: Optional[str], model: str) -> dict[str, Any]:
    """Release Gate判定。Policy未設定の項目はルールを生成しない。

    戻り値: {model, verdict, rules[], production_model, policy_configured}
    """
    from .release_manager import get_release_policy, list_releases

    policy = normalize_policy(get_release_policy(project_id))
    releases = list_releases(project_id)
    production = str(releases.get("production") or "")

    experiment = _experiment_for_model(str(project_id or "default"), model)
    evaluation = (experiment or {}).get("evaluation") if isinstance((experiment or {}).get("evaluation"), dict) else None
    profile = (experiment or {}).get("evaluation_profile") if isinstance((experiment or {}).get("evaluation_profile"), dict) else None
    eval_hash = str((experiment or {}).get("evaluation_hash") or "")

    rules: list[dict[str, Any]] = []

    # モデル未評価（実験カルテに評価なし）は NOT_EVALUATED
    if evaluation is None:
        return {
            "model": model,
            "verdict": "NOT_EVALUATED",
            "rules": [
                _rule("evaluation_exists", "評価済み", "評価なし", RESULT_UNVERIFIED, "このモデルの評価結果がありません（モデル評価を実行してください）")
            ],
            "production_model": production,
            "policy_configured": any(v not in (None, False, [], "") for v in policy.values()),
        }

    cer = evaluation.get("cer") if isinstance(evaluation.get("cer"), (int, float)) else None
    char_accuracy = evaluation.get("char_accuracy") if isinstance(evaluation.get("char_accuracy"), (int, float)) else None
    exact_match = (
        float(evaluation["accuracy_percent"]) / 100.0 if isinstance(evaluation.get("accuracy_percent"), (int, float)) else None
    )
    image_count = (profile or {}).get("image_count")

    # 1) Max CER
    if policy["max_cer"] is not None:
        if cer is None:
            rules.append(_rule("max_cer", f"CER ≤ {_pct(policy['max_cer'])}", "未記録", RESULT_UNVERIFIED, "CERが記録されていません"))
        else:
            ok = cer <= policy["max_cer"]
            rules.append(
                _rule("max_cer", f"CER ≤ {_pct(policy['max_cer'])}", _pct(cer), RESULT_PASS if ok else RESULT_FAIL,
                      "基準内" if ok else f"CERが基準を超えています（{_pct(cer)} > {_pct(policy['max_cer'])}）")
            )

    # 2) Min 文字正解率
    if policy["min_char_accuracy"] is not None:
        if char_accuracy is None:
            rules.append(_rule("min_char_accuracy", f"文字正解率 ≥ {_pct(policy['min_char_accuracy'])}", "未記録", RESULT_UNVERIFIED, "文字正解率が記録されていません"))
        else:
            ok = char_accuracy >= policy["min_char_accuracy"]
            rules.append(
                _rule("min_char_accuracy", f"文字正解率 ≥ {_pct(policy['min_char_accuracy'])}", _pct(char_accuracy),
                      RESULT_PASS if ok else RESULT_FAIL, "基準内" if ok else "文字正解率が基準未満です")
            )

    # 3) Min 完全一致率
    if policy["min_exact_match"] is not None:
        if exact_match is None:
            rules.append(_rule("min_exact_match", f"完全一致率 ≥ {_pct(policy['min_exact_match'])}", "未記録", RESULT_UNVERIFIED, "完全一致率が記録されていません"))
        else:
            ok = exact_match >= policy["min_exact_match"]
            rules.append(
                _rule("min_exact_match", f"完全一致率 ≥ {_pct(policy['min_exact_match'])}", _pct(exact_match),
                      RESULT_PASS if ok else RESULT_FAIL, "基準内" if ok else "完全一致率が基準未満です")
            )

    # 4) Min 評価画像数
    if policy["min_eval_images"] is not None:
        if not isinstance(image_count, (int, float)):
            rules.append(_rule("min_eval_images", f"評価画像 ≥ {policy['min_eval_images']}件", "未記録", RESULT_UNVERIFIED, "評価画像数が記録されていません"))
        else:
            ok = int(image_count) >= policy["min_eval_images"]
            rules.append(
                _rule("min_eval_images", f"評価画像 ≥ {policy['min_eval_images']}件", f"{int(image_count)}件",
                      RESULT_PASS if ok else RESULT_FAIL, "基準内" if ok else "評価画像数が不足しています")
            )

    # 5) Production比CER悪化なし
    if policy["no_cer_regression"]:
        prod_exp = _experiment_for_model(str(project_id or "default"), production) if production and production != model else None
        prod_eval = (prod_exp or {}).get("evaluation") if isinstance((prod_exp or {}).get("evaluation"), dict) else None
        prod_cer = (prod_eval or {}).get("cer") if isinstance((prod_eval or {}).get("cer"), (int, float)) else None
        if not production or production == model:
            rules.append(_rule("no_cer_regression", "Production比 CER悪化なし", "Production 0件", RESULT_PASS, "比較対象のProductionがありません（初回リリース）"))
        elif prod_cer is None or cer is None:
            rules.append(_rule("no_cer_regression", "Production比 CER悪化なし", "未記録", RESULT_UNVERIFIED, "Production側またはこのモデルのCERが記録されていません"))
        else:
            ok = cer <= prod_cer
            rules.append(
                _rule("no_cer_regression", f"CER ≤ Production（{_pct(prod_cer)}）", _pct(cer), RESULT_PASS if ok else RESULT_FAIL,
                      "悪化なし" if ok else f"ProductionよりCERが悪化しています（+{(cer - prod_cer) * 100:.2f}pt）")
            )

    # 6) Evaluation Hash同一（Productionと同一条件の評価か）
    if policy["require_same_evaluation_hash"]:
        prod_exp = _experiment_for_model(str(project_id or "default"), production) if production and production != model else None
        prod_hash = str((prod_exp or {}).get("evaluation_hash") or "")
        if not production or production == model:
            rules.append(_rule("same_evaluation_hash", "ProductionとEvaluation Hash同一", "Production 0件", RESULT_PASS, "比較対象のProductionがありません（初回リリース）"))
        elif not eval_hash or not prod_hash:
            rules.append(_rule("same_evaluation_hash", "ProductionとEvaluation Hash同一", "Hashなし", RESULT_UNVERIFIED, "Evaluation Hashが生成できていません"))
        else:
            ok = eval_hash == prod_hash
            rules.append(
                _rule("same_evaluation_hash", prod_hash[:15] + "…", eval_hash[:15] + "…", RESULT_PASS if ok else RESULT_FAIL,
                      "同一条件の評価です" if ok else "Productionと評価条件が異なります（同一データセット・同一条件で再評価してください）")
            )

    # 7) Min 比較品質（Productionとの比較の信頼度）
    if policy["min_comparison_quality"] is not None:
        prod_exp = _experiment_for_model(str(project_id or "default"), production) if production and production != model else None
        if not production or production == model:
            rules.append(_rule("min_comparison_quality", f"比較品質 ≥ ★{policy['min_comparison_quality']}", "Production 0件", RESULT_PASS, "比較対象のProductionがありません（初回リリース）"))
        else:
            quality = comparison_quality(
                profile,
                (prod_exp or {}).get("evaluation_profile") if isinstance((prod_exp or {}).get("evaluation_profile"), dict) else None,
                eval_hash,
                str((prod_exp or {}).get("evaluation_hash") or ""),
            )
            ok = quality >= policy["min_comparison_quality"]
            rules.append(
                _rule("min_comparison_quality", f"比較品質 ≥ ★{policy['min_comparison_quality']}", f"★{quality}",
                      RESULT_PASS if ok else RESULT_FAIL, "基準内" if ok else "Productionとの比較品質が基準未満です")
            )

    # 8) 必須文字（評価データに現れない文字は「未検証」）
    if policy["required_chars"]:
        char_stats = evaluation.get("char_stats") if isinstance(evaluation.get("char_stats"), dict) else None
        min_acc = policy["required_chars"]["min_accuracy"]
        if char_stats is None:
            rules.append(_rule("required_chars", f"必須文字 正解率 ≥ {_pct(min_acc)}", "未記録", RESULT_UNVERIFIED, "文字別統計が記録されていません（再評価すると記録されます）"))
        else:
            failed_chars: list[str] = []
            unverified_chars: list[str] = []
            details: list[str] = []
            for ch in policy["required_chars"]["chars"]:
                stat = char_stats.get(ch)
                if not isinstance(stat, dict) or not stat.get("total"):
                    unverified_chars.append(ch)
                    details.append(f"「{ch}」未検証（評価データに含まれない）")
                    continue
                accuracy = 1.0 - float(stat.get("errors") or 0) / float(stat["total"])
                if accuracy < min_acc:
                    failed_chars.append(ch)
                    details.append(f"「{ch}」{accuracy * 100:.1f}%（{stat['total']}回中 {stat.get('errors')}エラー）")
                else:
                    details.append(f"「{ch}」{accuracy * 100:.1f}%")
            result = RESULT_FAIL if failed_chars else (RESULT_UNVERIFIED if unverified_chars else RESULT_PASS)
            rules.append(
                _rule("required_chars", f"必須文字（{policy['required_chars']['chars']}）正解率 ≥ {_pct(min_acc)}",
                      " / ".join(details) or "-", result,
                      "全必須文字が基準内" if result == RESULT_PASS
                      else (f"基準未満の文字: {'、'.join(failed_chars)}" if failed_chars else f"未検証の文字: {'、'.join(unverified_chars)}"))
            )

    # 9) Critical Confusions（ルール毎に warning / fail を選択。1件でもFAILにできる）
    for critical in policy["critical_confusions"]:
        confusions = evaluation.get("confusions") if isinstance(evaluation.get("confusions"), list) else None
        rule_name = f"critical_confusion:{critical['from']}→{critical['to']}"
        expected = f"{critical['from']}→{critical['to']} ≤ {critical['max_count']}件"
        if confusions is None:
            rules.append(_rule(rule_name, expected, "未記録", RESULT_UNVERIFIED, "混同集計が記録されていません（再評価すると記録されます）"))
            continue
        count = sum(
            int(c.get("count") or 0)
            for c in confusions
            if c.get("kind") == "sub" and str(c.get("from")) == critical["from"] and str(c.get("to")) == critical["to"]
        )
        if count <= critical["max_count"]:
            rules.append(_rule(rule_name, expected, f"{count}件", RESULT_PASS, "基準内"))
        else:
            severity = RESULT_FAIL if critical["severity"] == "fail" else RESULT_WARNING
            rules.append(
                _rule(rule_name, expected, f"{count}件", severity,
                      f"危険な混同 {critical['from']}→{critical['to']} が{count}件発生（{'FAIL' if severity == RESULT_FAIL else '警告'}設定）")
            )

    # 10) Benchmark Rank / Max Failed（モデルを含む最新Benchmarkが情報源。なければ未検証）
    if policy["max_benchmark_rank"] is not None or policy["max_failed"] is not None:
        bench = _latest_benchmark_result(str(project_id or "default"), model)
        if policy["max_benchmark_rank"] is not None:
            if bench is None:
                rules.append(_rule("max_benchmark_rank", f"Benchmark順位 ≤ {policy['max_benchmark_rank']}位", "Benchmarkなし", RESULT_UNVERIFIED, "このモデルを含むBenchmarkがありません"))
            else:
                ok = int(bench.get("rank") or 999) <= policy["max_benchmark_rank"]
                rules.append(
                    _rule("max_benchmark_rank", f"Benchmark順位 ≤ {policy['max_benchmark_rank']}位",
                          f"{bench.get('rank')}位（{bench.get('benchmark_id')}）", RESULT_PASS if ok else RESULT_FAIL,
                          "基準内" if ok else "Benchmark順位が基準を下回っています")
                )
        if policy["max_failed"] is not None:
            if bench is None:
                rules.append(_rule("max_failed", f"Benchmark失敗 ≤ {policy['max_failed']}件", "Benchmarkなし", RESULT_UNVERIFIED, "このモデルを含むBenchmarkがありません"))
            else:
                ok = int(bench.get("failed") or 0) <= policy["max_failed"]
                rules.append(
                    _rule("max_failed", f"Benchmark失敗 ≤ {policy['max_failed']}件", f"{bench.get('failed')}件（{bench.get('benchmark_id')}）",
                          RESULT_PASS if ok else RESULT_FAIL, "基準内" if ok else "Benchmarkでの推論失敗数が基準を超えています")
                )

    # 11) Allowed Engines
    if policy["allowed_engines"]:
        engine = _model_engine(model)
        ok = engine in policy["allowed_engines"]
        rules.append(
            _rule("allowed_engines", f"エンジン ∈ {policy['allowed_engines']}", engine or "不明",
                  RESULT_PASS if ok else RESULT_FAIL, "許可エンジンです" if ok else "このプロジェクトで許可されていないエンジンです")
        )

    # 判定: fail>0=FAIL / warning・unverified>0=CONDITIONAL_PASS / それ以外=PASS
    results = [r["result"] for r in rules]
    if RESULT_FAIL in results:
        verdict = "FAIL"
    elif RESULT_WARNING in results or RESULT_UNVERIFIED in results:
        verdict = "CONDITIONAL_PASS"
    else:
        verdict = "PASS"
    return {
        "model": model,
        "verdict": verdict,
        "rules": rules,
        "production_model": production,
        "policy_configured": any(v not in (None, False, [], "") for v in policy.values()),
    }
