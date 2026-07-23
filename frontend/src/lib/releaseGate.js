// Release Gate（本番昇格の自動判定）のUI用純ロジック。
// 判定そのものはサーバー（services/release_gate.py）が行い、ここでは
// 表示ラベル・Policy編集フォームの変換・Critical Confusionsのテキスト入出力のみを扱う。

// 判定の表示定義（tone: success=緑 / warning=黄 / danger=赤 / muted=灰）
export const VERDICT_LABELS = {
  PASS: { label: "PASS（全ルール合格）", tone: "success" },
  CONDITIONAL_PASS: { label: "CONDITIONAL PASS（警告・未検証あり）", tone: "warning" },
  FAIL: { label: "FAIL（不合格ルールあり）", tone: "danger" },
  NOT_EVALUATED: { label: "NOT EVALUATED（評価未実施）", tone: "muted" },
};

export const RULE_RESULT_LABELS = {
  pass: "合格",
  fail: "不合格",
  warning: "警告",
  unverified: "未検証",
};

// FAIL判定は例外承認（Override Reason + Approved By）なしで昇格できない
export function overrideRequired(verdict) {
  return verdict === "FAIL";
}

export function canSubmitPromote({ verdict, note, overrideReason, approvedBy }) {
  if (!String(note || "").trim()) return false;
  if (overrideRequired(verdict)) {
    return Boolean(String(overrideReason || "").trim()) && Boolean(String(approvedBy || "").trim());
  }
  return true;
}

// Critical Confusionsのテキスト形式: 1行1ルール「0→O:fail」「1→I:warning:2」（:件数は省略時0）
export function parseCriticalConfusions(text) {
  const rules = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(.+?)(?:→|->)(.+?):(warning|fail)(?::(\d+))?$/);
    if (!match) {
      return { rules: [], error: `形式が不正です: 「${line}」（例: 0→O:fail / 1→I:warning:2）` };
    }
    rules.push({
      from: match[1].trim(),
      to: match[2].trim(),
      severity: match[3],
      max_count: match[4] ? Number(match[4]) : 0,
    });
  }
  return { rules, error: "" };
}

export function formatCriticalConfusions(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((r) => `${r.from}→${r.to}:${r.severity}${r.max_count ? `:${r.max_count}` : ""}`)
    .join("\n");
}

// Policy（サーバー形式・割合は0〜1）→ 編集フォーム（%表記の文字列）
export function policyToForm(policy) {
  const src = policy || {};
  const pct = (value) => (value === null || value === undefined ? "" : String(Number(value) * 100));
  const num = (value) => (value === null || value === undefined ? "" : String(value));
  return {
    maxCerPct: pct(src.max_cer),
    minCharAccuracyPct: pct(src.min_char_accuracy),
    minExactMatchPct: pct(src.min_exact_match),
    minEvalImages: num(src.min_eval_images),
    maxFailed: num(src.max_failed),
    noCerRegression: Boolean(src.no_cer_regression),
    requireSameEvaluationHash: Boolean(src.require_same_evaluation_hash),
    minComparisonQuality: num(src.min_comparison_quality),
    maxBenchmarkRank: num(src.max_benchmark_rank),
    requiredChars: String(src.required_chars?.chars || ""),
    requiredCharsMinAccuracyPct: src.required_chars ? String(Number(src.required_chars.min_accuracy) * 100) : "90",
    criticalConfusionsText: formatCriticalConfusions(src.critical_confusions),
    allowedEngines: Array.isArray(src.allowed_engines) ? [...src.allowed_engines] : [],
  };
}

// 編集フォーム → Policy（サーバー形式）。空欄=null（ルール無効）
export function formToPolicy(form) {
  const ratio = (value) => (String(value ?? "").trim() === "" ? null : Number(value) / 100);
  const intOrNull = (value) => (String(value ?? "").trim() === "" ? null : Number(value));
  const parsed = parseCriticalConfusions(form.criticalConfusionsText);
  if (parsed.error) {
    return { policy: null, error: parsed.error };
  }
  return {
    policy: {
      max_cer: ratio(form.maxCerPct),
      min_char_accuracy: ratio(form.minCharAccuracyPct),
      min_exact_match: ratio(form.minExactMatchPct),
      min_eval_images: intOrNull(form.minEvalImages),
      max_failed: intOrNull(form.maxFailed),
      no_cer_regression: Boolean(form.noCerRegression),
      require_same_evaluation_hash: Boolean(form.requireSameEvaluationHash),
      min_comparison_quality: intOrNull(form.minComparisonQuality),
      max_benchmark_rank: intOrNull(form.maxBenchmarkRank),
      required_chars: String(form.requiredChars || "").trim()
        ? { chars: String(form.requiredChars).trim(), min_accuracy: Number(form.requiredCharsMinAccuracyPct || 90) / 100 }
        : null,
      critical_confusions: parsed.rules,
      allowed_engines: Array.isArray(form.allowedEngines) ? form.allowedEngines : [],
    },
    error: "",
  };
}
