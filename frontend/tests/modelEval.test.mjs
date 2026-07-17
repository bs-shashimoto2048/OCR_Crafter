// モデルカルテ純ロジック（lib/modelEval.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  correctTotalLabel,
  formatSignedValue,
  isBaselineModel,
  latestEvalOf,
  modelBadges,
  modelEvalEntries,
  normalizeEvalEntry,
  whitelistLabelOf,
} from "../src/lib/modelEval.js";

const HISTORY = {
  model_a: {
    ds1: {
      percent: 38.6,
      at: "2026-07-17T14:55:00.000Z",
      correct_count: 88,
      total_count: 228,
      misrecognized_count: 140,
      improvement_rate: 12.8,
      improvement_count: 10,
      dataset: "eval_20260717",
      whitelist: "default",
      pre: { source: "step5", summary: "Gray/固定100" },
    },
    ds0: { percent: 25.0, at: "2026-07-10T09:00:00.000Z" }, // 旧形式（percent/atのみ）
  },
  model_b: {
    ds1: { percent: 20.1, at: "2026-07-16T10:00:00.000Z" },
  },
  eng: {
    ds1: { percent: 10.0, at: "2026-07-17T14:55:00.000Z" },
  },
};

test("normalizeEvalEntry: 新形式は全項目・旧形式は欠損をnullにして互換（エラーにしない）", () => {
  const full = normalizeEvalEntry("ds1", HISTORY.model_a.ds1);
  assert.equal(full.correct, 88);
  assert.equal(full.total, 228);
  assert.equal(full.mismatch, 140);
  assert.equal(full.improvementRate, 12.8);
  assert.equal(full.improvementCount, 10);
  assert.equal(full.whitelist, "default");
  assert.equal(full.preSummary, "Gray/固定100");

  const legacy = normalizeEvalEntry("ds0", HISTORY.model_a.ds0);
  assert.equal(legacy.percent, 25.0);
  assert.equal(legacy.correct, null);
  assert.equal(legacy.total, null);
  assert.equal(legacy.mismatch, null);
  assert.equal(legacy.improvementRate, null);
  assert.equal(legacy.dataset, "ds0"); // dataset未記録はキー名で代替
});

test("modelEvalEntries/latestEvalOf: 新しい順に並び最新が先頭", () => {
  const entries = modelEvalEntries(HISTORY, "model_a");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].dataset, "eval_20260717");
  assert.equal(latestEvalOf(HISTORY, "model_a").percent, 38.6);
  assert.equal(latestEvalOf(HISTORY, "unknown_model"), null);
});

test("表示ヘルパー: 正解/総数・符号付き・whitelistラベル（未記録フォールバック）", () => {
  const latest = latestEvalOf(HISTORY, "model_a");
  assert.equal(correctTotalLabel(latest), "88 / 228");
  assert.equal(correctTotalLabel(latestEvalOf(HISTORY, "model_b")), "未記録");
  assert.equal(formatSignedValue(12.8, "%"), "+12.8%");
  assert.equal(formatSignedValue(-3, "件"), "-3件");
  assert.equal(formatSignedValue(null, "%"), "未記録");
  assert.equal(whitelistLabelOf("default"), "実運用");
  assert.equal(whitelistLabelOf("none"), "なし");
  assert.equal(whitelistLabelOf(""), "未記録");
});

test("modelBadges: 推奨=最新評価の最高性能 / Best=全履歴最高 / ベースライン=eng系（自動判定）", () => {
  const badges = modelBadges(HISTORY, ["model_a", "model_b", "eng", "not_evaluated"]);
  assert.deepEqual(badges.model_a, ["recommended", "best"]);
  assert.equal(badges.model_b, undefined);
  assert.deepEqual(badges.eng, ["baseline"]);
  assert.equal(badges.not_evaluated, undefined);
  assert.equal(isBaselineModel("ENG.traineddata".toLowerCase() && "eng"), true);
});
