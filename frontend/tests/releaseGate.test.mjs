// Release Gate UI純ロジック（判定ラベル・Override必須判定・Policyフォーム変換）のテスト
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RULE_RESULT_LABELS,
  VERDICT_LABELS,
  canSubmitPromote,
  formToPolicy,
  formatCriticalConfusions,
  overrideRequired,
  parseCriticalConfusions,
  policyToForm,
} from "../src/lib/releaseGate.js";

test("判定4種とルール結果4種のラベル定義", () => {
  assert.deepEqual(Object.keys(VERDICT_LABELS), ["PASS", "CONDITIONAL_PASS", "FAIL", "NOT_EVALUATED"]);
  assert.deepEqual(Object.keys(RULE_RESULT_LABELS), ["pass", "fail", "warning", "unverified"]);
  assert.equal(VERDICT_LABELS.FAIL.tone, "danger");
});

test("overrideRequired / canSubmitPromote: FAILはOverride理由+承認者が必須", () => {
  assert.equal(overrideRequired("FAIL"), true);
  assert.equal(overrideRequired("CONDITIONAL_PASS"), false);
  // Release Note必須（全判定共通）
  assert.equal(canSubmitPromote({ verdict: "PASS", note: "", overrideReason: "", approvedBy: "" }), false);
  assert.equal(canSubmitPromote({ verdict: "PASS", note: "改善", overrideReason: "", approvedBy: "" }), true);
  // FAIL: reason/approver両方が揃うまで不可
  assert.equal(canSubmitPromote({ verdict: "FAIL", note: "x", overrideReason: "", approvedBy: "" }), false);
  assert.equal(canSubmitPromote({ verdict: "FAIL", note: "x", overrideReason: "緊急", approvedBy: "" }), false);
  assert.equal(canSubmitPromote({ verdict: "FAIL", note: "x", overrideReason: "緊急", approvedBy: "boss" }), true);
});

test("parseCriticalConfusions: 0→O:fail / 1→I:warning:2 形式の入出力", () => {
  const { rules, error } = parseCriticalConfusions("0→O:fail\n1->I:warning:2\n\n");
  assert.equal(error, "");
  assert.deepEqual(rules, [
    { from: "0", to: "O", severity: "fail", max_count: 0 },
    { from: "1", to: "I", severity: "warning", max_count: 2 },
  ]);
  assert.equal(formatCriticalConfusions(rules), "0→O:fail\n1→I:warning:2");
  // 不正形式はエラー（黙って捨てない）
  const bad = parseCriticalConfusions("0とOを混同禁止");
  assert.ok(bad.error.includes("形式が不正"));
});

test("policyToForm / formToPolicy: %⇔割合の相互変換・空欄=null", () => {
  const policy = {
    max_cer: 0.05,
    min_char_accuracy: null,
    min_exact_match: 0.8,
    min_eval_images: 100,
    max_failed: null,
    no_cer_regression: true,
    require_same_evaluation_hash: false,
    min_comparison_quality: 4,
    max_benchmark_rank: 1,
    required_chars: { chars: "0O", min_accuracy: 0.95 },
    critical_confusions: [{ from: "5", to: "S", severity: "fail", max_count: 0 }],
    allowed_engines: ["tesseract"],
  };
  const form = policyToForm(policy);
  assert.equal(form.maxCerPct, "5");
  assert.equal(form.minCharAccuracyPct, "");
  assert.equal(form.requiredCharsMinAccuracyPct, "95");
  assert.equal(form.criticalConfusionsText, "5→S:fail");
  const { policy: roundTrip, error } = formToPolicy(form);
  assert.equal(error, "");
  assert.deepEqual(roundTrip, policy);
  // 必須文字空欄=ルール無効（null）
  const { policy: cleared } = formToPolicy({ ...form, requiredChars: "", criticalConfusionsText: "" });
  assert.equal(cleared.required_chars, null);
  assert.deepEqual(cleared.critical_confusions, []);
});
