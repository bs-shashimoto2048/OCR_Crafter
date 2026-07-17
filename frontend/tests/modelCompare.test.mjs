// モデル比較（CER中心・lib/modelCompare.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildConfusionComparison,
  buildModelComparison,
  buildWinLoss,
  confusionLabel,
  formatMetricValue,
  recommendModel,
} from "../src/lib/modelCompare.js";

const HISTORY = {
  model_a: {
    ds1: {
      percent: 38.6,
      at: "2026-07-17T14:55:00.000Z",
      cer: 0.112,
      char_accuracy: 0.888,
      correct_count: 88,
      total_count: 228,
      cer_relative_improvement: 0.391,
      improved: 64,
      regressed: 25,
      perfect_fixed: 34,
      perfect_regressed: 8,
      confusions: [
        { kind: "sub", from: "0", to: "O", count: 12 },
        { kind: "sub", from: "B", to: "8", count: 6 },
      ],
    },
  },
  model_b: {
    ds1: {
      percent: 37.4,
      at: "2026-07-17T14:55:00.000Z",
      cer: 0.128,
      char_accuracy: 0.872,
      correct_count: 85,
      total_count: 228,
      cer_relative_improvement: 0.3,
      improved: 60,
      regressed: 31,
      perfect_fixed: 30,
      perfect_regressed: 10,
      confusions: [{ kind: "sub", from: "0", to: "O", count: 19 }],
    },
  },
  model_c: {
    ds1: { percent: 34.2, at: "2026-07-10T00:00:00.000Z" }, // 旧形式（CERなし）
  },
};

const MODELS = ["model_a", "model_b", "model_c"];

test("buildModelComparison: 各指標の最良値（CER=最小・文字正解率=最大・悪化=最小）", () => {
  const comparison = buildModelComparison(HISTORY, MODELS);
  const rowOf = (key) => comparison.rows.find((row) => row.metric.key === key);
  assert.equal(rowOf("cer").best, 0.112); // 最小が最良
  assert.equal(rowOf("charAccuracy").best, 0.888); // 最大が最良
  assert.equal(rowOf("percent").best, 38.6);
  assert.equal(rowOf("regressed").best, 25); // 最小が最良
  // 旧形式（CERなし）はnull=未記録
  assert.equal(rowOf("cer").values[2], null);
  assert.equal(formatMetricValue(rowOf("cer").metric, comparison.columns[0].latest), "11.2%");
  assert.equal(formatMetricValue(rowOf("correct").metric, comparison.columns[0].latest), "88 / 228");
  assert.equal(formatMetricValue(rowOf("cer").metric, comparison.columns[2].latest), "未記録");
});

test("buildWinLoss: 指標ごとの勝者と勝利数（タイ・欠損は勝者なし）", () => {
  const comparison = buildModelComparison(HISTORY, MODELS);
  const winLoss = buildWinLoss(comparison);
  const winnerOf = (key) => winLoss.rows.find((row) => row.metric.key === key).winner;
  assert.equal(winnerOf("cer"), "model_a");
  assert.equal(winnerOf("charAccuracy"), "model_a");
  assert.equal(winnerOf("percent"), "model_a");
  assert.equal(winnerOf("regressed"), "model_a"); // 悪化最少
  assert.equal(winLoss.wins.model_a, 9); // 全9指標で最良
  assert.equal(winLoss.wins.model_b, 0);
  assert.equal(winLoss.wins.model_c, 0);
});

test("recommendModel: 勝利数で総合推奨（理由付き・Accuracy単独で決めない）", () => {
  const comparison = buildModelComparison(HISTORY, MODELS);
  const winLoss = buildWinLoss(comparison);
  const recommended = recommendModel(comparison, winLoss);
  assert.equal(recommended.model, "model_a");
  assert.equal(recommended.wins, 9);
  assert.ok(recommended.reasons.includes("CER最良"));
  assert.ok(recommended.reasons.includes("文字正解率最良"));
  assert.ok(recommended.reasons.includes("悪化件数最良"));
});

test("recommendModel: 勝利数タイはCER最小を優先（Accuracyでは決めない）", () => {
  const history = {
    a: { ds: { percent: 30, at: "2026-07-17T00:00:00Z", cer: 0.1, char_accuracy: 0.9 } },
    b: { ds: { percent: 45, at: "2026-07-17T00:00:00Z" } }, // Accuracyは高いがCER未記録
  };
  const comparison = buildModelComparison(history, ["a", "b"]);
  const winLoss = buildWinLoss(comparison);
  // a: cer/charAccuracyは単独値（勝敗なし）。percentはbが勝ち=1勝
  const recommended = recommendModel(comparison, winLoss);
  assert.equal(recommended.model, "b"); // 勝利数1-0でb（勝敗表基準）
});

test("buildConfusionComparison: 全モデルの混同を統合しモデル別件数を比較", () => {
  const comparison = buildModelComparison(HISTORY, MODELS);
  const rows = buildConfusionComparison(comparison);
  assert.equal(rows[0].label, "0→O"); // 合計件数最多（12+19）
  assert.deepEqual(rows[0].counts, [12, 19, null]); // 旧形式モデルはnull（-表示）
  const b8 = rows.find((row) => row.label === "B→8");
  assert.deepEqual(b8.counts, [6, 0, null]); // データありで未出現=0
  assert.equal(confusionLabel({ from: "Y", to: "" }), "Y→∅");
  assert.equal(confusionLabel({ from: "", to: "1" }), "∅→1");
});
