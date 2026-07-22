// 実験管理の純ロジック（lib/experimentAnalysis.js）と ExperimentsView のレンダリングテスト。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

import {
  augmentationImprovement,
  bestExperiment,
  buildExperimentDiff,
  buildExperimentRecommendations,
  buildScatter,
  buildTrendSeries,
  collectFilterOptions,
  experimentsToCsvLines,
  filterExperiments,
  iterationCorrelation,
  normalizeExperiment,
  preprocessGroups,
} from "../src/lib/experimentAnalysis.js";

function makeRaw({ id, iterations = 1000, cer = null, aug = null, hash = "sha256:aaaa1111", created = "2026-07-20T10:00:00" } = {}) {
  return {
    experiment_id: id,
    created_at: created,
    started_at: "2026-07-20T09:58:00",
    finished_at: created,
    duration_seconds: 120,
    models: [`tess_${id}.tess.json`],
    model_ids: ["M0001"],
    experiment_name: "",
    parent_model_id: "",
    note: "",
    training: {
      iterations,
      charset: "AB",
      base_lang: "eng",
      split_ratio: { train: 0.8, val: 0.1, test: 0.1 },
      split_seed: 42,
      split_method: "image",
      counts: { train: 80, val: 10, test: 10 },
    },
    preprocess: { hash, snapshot_id: "prep_x", summary: "Binary 128" },
    augmentation: { config: aug, generated: aug ? 40 : null },
    evaluation: cer === null ? null : { cer, char_accuracy: 1 - cer, accuracy_percent: 40, improved: 5, regressed: 1, evaluated_at: created, dataset: "ds" },
    tags: [],
    favorite: false,
    source: "training",
  };
}

const WEAK = { preset: "weak", multiplier: 1.5, rotation: { enabled: true, max_degrees: 2, probability: 0.3 } };

const EXPS = [
  makeRaw({ id: "EXP-0001", iterations: 1000, cer: 0.382, created: "2026-07-18T10:00:00" }),
  makeRaw({ id: "EXP-0002", iterations: 5000, cer: 0.351, created: "2026-07-19T10:00:00" }),
  makeRaw({ id: "EXP-0003", iterations: 10000, cer: 0.296, aug: WEAK, created: "2026-07-20T10:00:00" }),
  makeRaw({ id: "EXP-0004", iterations: 15000, cer: 0.317, hash: "sha256:bbbb2222", created: "2026-07-21T10:00:00" }),
].map(normalizeExperiment);

test("normalizeExperiment: 学習条件・前処理・Aug・評価の正規化（欠損=null/空）", () => {
  const e = EXPS[2];
  assert.equal(e.id, "EXP-0003");
  assert.equal(e.iterations, 10000);
  assert.equal(e.splitRatioText, "0.8 : 0.1 : 0.1");
  assert.equal(e.preprocessShort, "aaaa1111");
  assert.equal(e.cer, 0.296);
  assert.ok(e.augSummary.includes("回転"));
  const empty = normalizeExperiment({ experiment_id: "EXP-9999" });
  assert.equal(empty.iterations, null);
  assert.equal(empty.cer, null);
  assert.equal(empty.augSummary, "なし");
});

test("filterExperiments: Iteration範囲・CER上限・Aug・前処理・日付・タグ・★・フリーテキスト", () => {
  assert.equal(filterExperiments(EXPS, { iterMin: 5000 }).length, 3);
  assert.equal(filterExperiments(EXPS, { iterMin: 5000, iterMax: 10000 }).length, 2);
  assert.equal(filterExperiments(EXPS, { cerMax: 32 }).length, 2); // 29.6% と 31.7%
  assert.deepEqual(filterExperiments(EXPS, { augPreset: "none" }).map((e) => e.id), ["EXP-0001", "EXP-0002", "EXP-0004"]);
  assert.deepEqual(filterExperiments(EXPS, { preprocessHash: "sha256:bbbb2222" }).map((e) => e.id), ["EXP-0004"]);
  assert.deepEqual(filterExperiments(EXPS, { dateFrom: "2026-07-20" }).map((e) => e.id), ["EXP-0003", "EXP-0004"]);
  assert.deepEqual(filterExperiments(EXPS, { dateTo: "2026-07-18" }).map((e) => e.id), ["EXP-0001"]);
  assert.deepEqual(filterExperiments(EXPS, { query: "exp-0002" }).map((e) => e.id), ["EXP-0002"]);
  const tagged = [{ ...EXPS[0], tags: ["Baseline"] }, { ...EXPS[1], favorite: true }];
  assert.equal(filterExperiments(tagged, { tag: "Baseline" }).length, 1);
  assert.equal(filterExperiments(tagged, { favoriteOnly: true }).length, 1);
});

test("buildExperimentDiff: 変更された条件だけchanged=true（全て同値・未記録は変更なし）", () => {
  const rows = buildExperimentDiff([EXPS[0], EXPS[2]]);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.iterations.changed, true);
  assert.deepEqual(byKey.iterations.values, ["1,000", "10,000"]);
  assert.equal(byKey.augmentation.changed, true);
  assert.equal(byKey.split.changed, false); // 同値は変更なし（薄く表示）
  assert.equal(byKey.seed.changed, false);
  assert.equal(byKey.preprocess.changed, false);
  // 両方未評価ならCER行は変更なし扱い
  const noEval = buildExperimentDiff([normalizeExperiment(makeRaw({ id: "A" })), normalizeExperiment(makeRaw({ id: "B" }))]);
  assert.equal(noEval.find((r) => r.key === "cer").changed, false);
});

test("グラフデータ: CER推移（実験ID順）・完全一致率推移・散布図", () => {
  const trend = buildTrendSeries(EXPS, "cer");
  assert.deepEqual(trend.map((p) => p.id), ["EXP-0001", "EXP-0002", "EXP-0003", "EXP-0004"]);
  assert.deepEqual(trend.map((p) => Math.round(p.value * 10) / 10), [38.2, 35.1, 29.6, 31.7]);
  const acc = buildTrendSeries(EXPS, "accuracy");
  assert.equal(acc.length, 4);
  const scatter = buildScatter(EXPS, "iterations");
  assert.equal(scatter.length, 4);
  assert.equal(scatter[0].x, 1000);
  const augScatter = buildScatter(EXPS, "aug");
  assert.deepEqual(augScatter.map((p) => p.x), [1.0, 1.0, 1.5, 1.0]); // なし=1.0
});

test("簡易相関: Iteration相関（星付き）・Aug平均改善・前処理グループ", () => {
  const corr = iterationCorrelation(EXPS);
  assert.equal(corr.available, true);
  assert.ok(corr.r < 0, "Iteration増加でCER改善（負の相関）のはず");
  assert.ok(corr.stars >= 1 && corr.stars <= 5);
  assert.ok(corr.starsLabel.includes("★"));
  assert.equal(corr.direction, "Iteration増加でCER改善傾向");

  const aug = augmentationImprovement(EXPS);
  assert.equal(aug.available, true);
  // Augあり=29.6% / なし平均=(38.2+35.1+31.7)/3=35.0% → +5.4pt改善
  assert.ok(aug.deltaPt > 5 && aug.deltaPt < 6);
  assert.ok(aug.label.startsWith("+"));

  const groups = preprocessGroups(EXPS);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].hash, "sha256:bbbb2222"); // 平均CERが良い順（31.7% < 35.0%）
});

test("ベスト条件と条件推薦（過学習傾向の理由付き）", () => {
  const best = bestExperiment(EXPS);
  assert.equal(best.id, "EXP-0003");
  const cards = buildExperimentRecommendations(EXPS);
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.ok(byId.iteration.value.includes("10,000"));
  assert.ok(byId.iteration.reason.includes("過学習傾向"), "ベスト超のIterationが悪化している場合の理由がない");
  assert.ok(byId.augmentation.value.includes("使用を推奨"));
  assert.ok(byId.preprocess);
});

test("CSV出力: ヘッダ＋実験行（タグ・★・評価を含む）", () => {
  const withTag = [{ ...EXPS[0], tags: ["Baseline", "OCR改善"], favorite: true }];
  const lines = experimentsToCsvLines(withTag);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("experiment_id,created_at"));
  assert.ok(lines[1].includes("EXP-0001"));
  assert.ok(lines[1].includes("Baseline / OCR改善"));
  assert.ok(lines[1].includes("0.382"));
  assert.ok(lines[1].split(",").length >= 25);
});

test("collectFilterOptions: タグ・Augプリセット・前処理ハッシュ候補", () => {
  const options = collectFilterOptions([{ ...EXPS[2], tags: ["Aug試験"] }, EXPS[3]]);
  assert.deepEqual(options.tags, ["Aug試験"]);
  assert.deepEqual(options.augPresets, ["弱い"]);  // augmentationPresetLabelの表示名
  assert.equal(options.preprocessHashes.length, 2);
});

// ---------- ExperimentsView レンダリング ----------

let server;
let ExperimentsView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: ExperimentsView } = await server.ssrLoadModule("/src/views/ExperimentsView.jsx"));
});

after(async () => {
  await server?.close();
});

test("ExperimentsView: 一覧・フィルタ・CSVボタン・グラフ・ベスト条件・推薦・モデルリンク・タグ・★", () => {
  const raws = [
    makeRaw({ id: "EXP-0001", iterations: 1000, cer: 0.382 }),
    makeRaw({ id: "EXP-0002", iterations: 10000, cer: 0.296, aug: WEAK }),
  ];
  raws[0].tags = ["Baseline"];
  raws[0].favorite = true;
  const html = renderToString(
    React.createElement(ExperimentsView, {
      projectId: "p",
      experiments: raws,
      loading: false,
      onRefresh: () => {},
      onUpdateExperiment: () => {},
      onOpenModel: () => {},
    })
  );
  assert.ok(html.includes("実験一覧"), "一覧がない");
  assert.ok(html.includes("EXP-0001") && html.includes("EXP-0002"));
  assert.ok(html.includes("CSV / Excel出力"));
  assert.ok(html.includes("検索（EXP / モデル / 管理No / タグ / メモ）"), "フィルタがない");
  assert.ok(html.includes("CER推移"), "CER推移グラフがない");
  assert.ok(html.includes("Iteration × CER"), "散布図がない");
  assert.ok(html.includes("ベスト条件"));
  assert.ok(html.includes("条件推薦"));
  assert.ok(html.includes("Baseline"), "タグ表示がない");
  assert.ok(html.includes("★"), "お気に入りがない");
  assert.ok(html.includes("M0001"), "生成モデルリンク（管理No）がない");
  assert.ok(html.includes("<svg"), "SVGグラフがない");
});
