// モデル比較（CER中心・lib/modelCompare.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPARE_METRICS,
  COMPARE_MODEL_COLORS,
  buildCompareColorMap,
  buildConditionComparison,
  buildConfusionComparison,
  buildModelComparison,
  buildWinLoss,
  confusionLabel,
  formatBestDiff,
  formatMetricValue,
  getComparisonModelLabel,
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

test("buildWinLoss: 指標ごとの勝者と勝利数（単独最良）", () => {
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

test("buildWinLoss: 同率最良は全モデルをwinnersへ併記し各モデルへ1勝（勝者なしにしない）", () => {
  const history = {
    a: { ds: { percent: 38.6, at: "2026-07-17T00:00:00Z", cer: 0.1, char_accuracy: 0.9, correct_count: 88, total_count: 228 } },
    b: { ds: { percent: 38.6, at: "2026-07-17T00:00:00Z", cer: 0.12, char_accuracy: 0.88, correct_count: 88, total_count: 228 } },
  };
  const comparison = buildModelComparison(history, ["a", "b"]);
  const winLoss = buildWinLoss(comparison);
  const rowOf = (key) => winLoss.rows.find((row) => row.metric.key === key);
  // 完全一致率は同率 → 両方winners・単独勝者(winner)はnull
  assert.deepEqual(rowOf("percent").winners, ["a", "b"]);
  assert.equal(rowOf("percent").winner, null);
  // CERは単独最良
  assert.deepEqual(rowOf("cer").winners, ["a"]);
  assert.equal(rowOf("cer").winner, "a");
  // 勝利数: 同率でも各モデルへ1勝（a=cer,charAcc,percent,correct=4 / b=percent,correct=2）
  assert.equal(winLoss.wins.a, 4);
  assert.equal(winLoss.wins.b, 2);
});

test("formatBestDiff: 最良との差分表示（最良/pt/件・未記録はnull）", () => {
  const metricOf = (key) => COMPARE_METRICS.find((m) => m.key === key);
  const comparison = buildModelComparison(HISTORY, MODELS);
  const rowOf = (key) => comparison.rows.find((r) => r.metric.key === key);
  const colA = comparison.columns[0].latest;
  const colB = comparison.columns[1].latest;
  const colC = comparison.columns[2].latest;
  // CER（min指標）: 最良=最小。劣る側は+pt表示
  assert.equal(formatBestDiff(metricOf("cer"), colA, rowOf("cer").best), "最良");
  assert.equal(formatBestDiff(metricOf("cer"), colB, rowOf("cer").best), "+1.6pt"); // 12.8% - 11.2%
  // 文字正解率（max指標）: 劣る側は-pt表示
  assert.equal(formatBestDiff(metricOf("charAccuracy"), colB, rowOf("charAccuracy").best), "-1.6pt");
  // 完全一致率（percent）: pt差
  assert.equal(formatBestDiff(metricOf("percent"), colB, rowOf("percent").best), "-1.2pt");
  // 件数系
  assert.equal(formatBestDiff(metricOf("regressed"), colB, rowOf("regressed").best), "+6件");
  // 未記録（旧形式）はnull
  assert.equal(formatBestDiff(metricOf("cer"), colC, rowOf("cer").best), null);
});

test("buildConditionComparison: 条件一致の判定と表示行", () => {
  // 全モデル同条件 → match=true
  const matched = {
    a: { ds: { percent: 30, at: "2026-07-17T08:04:00Z", cer: 0.1, total_count: 228, dataset: "eval_x", whitelist: "default", pre: { source: "step5", summary: "Gray/固定90" } } },
    b: { ds: { percent: 28, at: "2026-07-17T08:35:00Z", cer: 0.12, total_count: 228, dataset: "eval_x", whitelist: "default", pre: { source: "step5", summary: "Gray/固定90" } } },
  };
  const c1 = buildConditionComparison(buildModelComparison(matched, ["a", "b"]));
  assert.equal(c1.match, true);
  assert.deepEqual(c1.mismatched, []);
  assert.equal(c1.rows.find((r) => r.key === "dataset").values[0], "eval_x");
  assert.equal(c1.rows.find((r) => r.key === "preprocess").values[0], "Step5: Gray/固定90");

  // OCR前処理と画像数が異なる → match=false・mismatchedへ列挙（評価日時の差は警告対象外）
  const mismatched = {
    a: { ds: { percent: 30, at: "2026-07-17T08:04:00Z", cer: 0.1, total_count: 228, dataset: "eval_x", whitelist: "default", pre: { source: "step5", summary: "Gray/固定90" } } },
    b: { ds: { percent: 28, at: "2026-07-18T09:00:00Z", cer: 0.12, total_count: 200, dataset: "eval_x", whitelist: "default", pre: { source: "none" } } },
  };
  const c2 = buildConditionComparison(buildModelComparison(mismatched, ["a", "b"]));
  assert.equal(c2.match, false);
  assert.deepEqual(c2.mismatched, ["評価画像数", "OCR前処理"]);

  // 評価データのあるモデルが1件だけ → 判定不能（match=null・警告も一致表示もしない）
  const single = { a: matched.a };
  const c3 = buildConditionComparison(buildModelComparison(single, ["a", "no_eval"]));
  assert.equal(c3.match, null);
  // 評価未実施モデルの表示は—
  assert.equal(c3.rows.find((r) => r.key === "dataset").values[1], "—");
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
  assert.equal(rows[0].label, "0 → O"); // 合計件数最多（12+19）
  assert.equal(rows[0].total, 31); // 全モデル合計
  assert.deepEqual(rows[0].counts, [12, 19, null]); // 旧形式モデルはnull（-表示）
  const b8 = rows.find((row) => row.label === "B → 8");
  assert.deepEqual(b8.counts, [6, 0, null]); // データありで未出現=0
  assert.equal(b8.total, 6);
  assert.equal(confusionLabel({ from: "Y", to: "" }), "Y → ∅");
  assert.equal(confusionLabel({ from: "", to: "1" }), "∅ → 1");
});

test("buildConfusionComparison: 合計多い順の並び・TOP8制限とInfinityで全件", () => {
  // 10種類の混同を持つ履歴を生成（件数=キー番号で合計順が一意に決まる）
  const confusions = Array.from({ length: 10 }, (_, i) => ({ kind: "sub", from: `${i}`, to: "X", count: i + 1 }));
  const history = {
    a: { ds: { percent: 30, at: "2026-07-17T00:00:00Z", cer: 0.1, confusions } },
    b: { ds: { percent: 28, at: "2026-07-17T00:00:00Z", cer: 0.12, confusions: [] } },
  };
  const comparison = buildModelComparison(history, ["a", "b"]);
  const top8 = buildConfusionComparison(comparison, 8);
  assert.equal(top8.length, 8);
  assert.equal(top8[0].label, "9 → X"); // 件数最多が先頭
  assert.equal(top8[0].counts[1], 0); // 評価データありで未出現=0（棒なし表示）
  const all = buildConfusionComparison(comparison, Infinity);
  assert.equal(all.length, 10); // Infinityで全件
  // 並びは全件でも合計降順を維持（比較中は同じ混同が同じ位置）
  assert.deepEqual(
    all.map((r) => r.total),
    [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
  );
});

test("buildCompareColorMap: 表示順に固定色（ブルー/オレンジ/パープル）を割り当て・3モデルは全て異なる色", () => {
  const map = buildCompareColorMap(["m1", "m2", "m3"]);
  assert.equal(map.m1, COMPARE_MODEL_COLORS[0]); // 1番目=ブルー
  assert.equal(map.m2, COMPARE_MODEL_COLORS[1]); // 2番目=オレンジ
  assert.equal(map.m3, COMPARE_MODEL_COLORS[2]); // 3番目=パープル
  assert.equal(new Set(Object.values(map)).size, 3); // 3モデルで色が重複しない
});

test("buildCompareColorMap: 同一比較セッション内（同じ配列）は再描画でも同じ色", () => {
  const targets = ["m1", "m2", "m3"];
  const first = buildCompareColorMap(targets);
  const second = buildCompareColorMap(targets); // 再描画のたびに呼ばれても同一入力→同一出力
  assert.deepEqual(first, second);
});

test("buildCompareColorMap: 全セクションで同じマップを共有すれば同じモデルは常に同じ色", () => {
  // 混同比較（件数0のモデルを含む）・指標別結果（同率2モデル）・総合勝利数を同じマップで引く
  const history = {
    m1: {
      ds: {
        percent: 38.6, at: "2026-07-17T00:00:00Z", cer: 0.1, char_accuracy: 0.9,
        confusions: [{ kind: "sub", from: "0", to: "O", count: 7 }],
      },
    },
    m2: {
      ds: {
        percent: 38.6, at: "2026-07-17T00:00:00Z", cer: 0.12, char_accuracy: 0.88,
        confusions: [], // 0→O は0件（棒なしでも管理Noの色は維持される）
      },
    },
  };
  const targets = ["m1", "m2"];
  const map = buildCompareColorMap(targets);
  const comparison = buildModelComparison(history, targets);
  const winLoss = buildWinLoss(comparison);

  // 指標別結果: 完全一致率は同率（m1/m2併記）→ それぞれの固定色で表示できる
  const percentRow = winLoss.rows.find((row) => row.metric.key === "percent");
  assert.deepEqual(percentRow.winners, ["m1", "m2"]);
  const winnerColors = percentRow.winners.map((w) => map[w]);
  assert.deepEqual(winnerColors, [COMPARE_MODEL_COLORS[0], COMPARE_MODEL_COLORS[1]]); // 同率でも複数色を維持

  // 混同比較: 0件のモデル（m2）でも色マップから同じ色が引ける
  const confusion = buildConfusionComparison(comparison)[0];
  assert.equal(confusion.counts[1], 0);
  assert.equal(map[targets[1]], COMPARE_MODEL_COLORS[1]);

  // 総合勝利数・棒グラフ: 列順とマップの対応が一致（m1=ブルー/m2=オレンジ）
  comparison.columns.forEach((col, index) => {
    assert.equal(map[col.model], COMPARE_MODEL_COLORS[index]);
  });
});

test("getComparisonModelLabel: 比較カード用のモデル名短縮（日時抽出・拡張子除去フォールバック）", () => {
  // YYYYMMDD_HHMMSS を最優先で抽出
  assert.equal(getComparisonModelLabel("tess_20260715_131053.tess.json"), "20260715_131053");
  assert.equal(getComparisonModelLabel("paddle_20260715_145027.ocr.json"), "20260715_145027");
  assert.equal(getComparisonModelLabel("model_20260101_000000.traineddata"), "20260101_000000");
  // 日時形式を抽出できない場合は拡張子を除いた名前
  assert.equal(getComparisonModelLabel("custom_model_alpha_v2.tess.json"), "custom_model_alpha_v2");
  assert.equal(getComparisonModelLabel("eng.traineddata"), "eng");
  assert.equal(getComparisonModelLabel("plain.json"), "plain");
  // 拡張子なし・空も安全
  assert.equal(getComparisonModelLabel("no_ext_name"), "no_ext_name");
  assert.equal(getComparisonModelLabel(""), "");
});
