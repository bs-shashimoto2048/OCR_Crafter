import assert from "node:assert/strict";
import { test } from "node:test";

import { latestEvalOf } from "../src/lib/modelEval.js";
import { buildModelComparison, buildWinLoss, recommendModel } from "../src/lib/modelCompare.js";
import {
  bestModelSize,
  buildBenchmarkRecommendations,
  buildEvalHistoryFromRows,
  buildRadarSeries,
  buildTrendByExperiment,
  matchesBenchmarkCenterFilters,
  sortBenchmarkRows,
  toCsvLines,
  toJsonReport,
  toMarkdownReport,
} from "../src/lib/benchmarkCenter.js";

function row({
  model_name,
  engine = "tesseract",
  dataset_id = "DS0001",
  dataset_name = "ds",
  experiment_id = "EXP-0001",
  preprocess_version = 3,
  model_size_mb = 10,
  evaluation = null,
} = {}) {
  return { model_name, engine, dataset_id, dataset_name, experiment_id, preprocess_version, model_size_mb, evaluation };
}

const ROWS = [
  row({ model_name: "a.tess.json", experiment_id: "EXP-0001", model_size_mb: 12, evaluation: { cer: 0.05, char_accuracy: 0.95, accuracy_percent: 90 } }),
  row({ model_name: "b.tess.json", experiment_id: "EXP-0002", model_size_mb: 8, evaluation: { cer: 0.02, char_accuracy: 0.98, accuracy_percent: 96 } }),
  row({ model_name: "c.tess.json", experiment_id: "EXP-0003", model_size_mb: 20, evaluation: null }),
];

test("buildEvalHistoryFromRows: 評価ありのモデルのみキーを作り、既存latestEvalOf/buildModelComparisonでそのまま読める", () => {
  const history = buildEvalHistoryFromRows(ROWS);
  assert.ok(history["a.tess.json"]);
  assert.ok(!history["c.tess.json"], "評価の無いモデルはキーを作らない");
  const latest = latestEvalOf(history, "a.tess.json");
  assert.equal(latest.cer, 0.05);
  assert.equal(latest.percent, 90);

  const comparison = buildModelComparison(history, ["a.tess.json", "b.tess.json"]);
  const winLoss = buildWinLoss(comparison);
  const best = recommendModel(comparison, winLoss);
  assert.equal(best.model, "b.tess.json"); // CER最小・文字正解率最大の両方で優位
});

test("matchesBenchmarkCenterFilters: dataset/engine/preprocessVersion/experiment/queryで絞り込む", () => {
  const target = ROWS[0];
  assert.equal(matchesBenchmarkCenterFilters(target, {}), true);
  assert.equal(matchesBenchmarkCenterFilters(target, { datasetId: "DS0001" }), true);
  assert.equal(matchesBenchmarkCenterFilters(target, { datasetId: "DS9999" }), false);
  assert.equal(matchesBenchmarkCenterFilters(target, { engine: "tesseract" }), true);
  assert.equal(matchesBenchmarkCenterFilters(target, { engine: "paddleocr" }), false);
  assert.equal(matchesBenchmarkCenterFilters(target, { preprocessVersion: 3 }), true);
  assert.equal(matchesBenchmarkCenterFilters(target, { preprocessVersion: 9 }), false);
  assert.equal(matchesBenchmarkCenterFilters(target, { experimentId: "EXP-0001" }), true);
  assert.equal(matchesBenchmarkCenterFilters(target, { experimentId: "EXP-9999" }), false);
  assert.equal(matchesBenchmarkCenterFilters(target, { query: "a.tess" }), true);
  assert.equal(matchesBenchmarkCenterFilters(target, { query: "zzz" }), false);
});

test("sortBenchmarkRows: model_size_mb昇順・cer昇順・accuracy_percent降順・未対応keyはそのまま", () => {
  assert.deepEqual(sortBenchmarkRows(ROWS, "model_size_mb", "asc").map((r) => r.model_name), ["b.tess.json", "a.tess.json", "c.tess.json"]);
  assert.deepEqual(sortBenchmarkRows(ROWS, "cer", "asc").map((r) => r.model_name).slice(0, 2), ["b.tess.json", "a.tess.json"]);
  assert.deepEqual(sortBenchmarkRows(ROWS, "accuracy_percent", "desc").map((r) => r.model_name).slice(0, 2), ["b.tess.json", "a.tess.json"]);
  assert.deepEqual(sortBenchmarkRows(ROWS, "unknown_key").map((r) => r.model_name), ["a.tess.json", "b.tess.json", "c.tess.json"]);
});

test("bestModelSize: モデルサイズ最小の行を返す（評価ロジックとは無関係の単純比較）", () => {
  const best = bestModelSize(ROWS);
  assert.equal(best.model_name, "b.tess.json");
  assert.equal(bestModelSize([]), null);
});

test("buildRadarSeries: 完全一致率・CER精度・文字正解率の3軸（Precision/Recall/F1は既存ロジックが無いため代替）", () => {
  const history = buildEvalHistoryFromRows(ROWS);
  const series = buildRadarSeries(ROWS, (name) => latestEvalOf(history, name));
  assert.equal(series.length, 2); // 評価ありの2件のみ
  const a = series.find((s) => s.modelName === "a.tess.json");
  assert.equal(a.values.length, 3);
  assert.equal(a.values[0], 90); // 完全一致率
  assert.equal(Math.round(a.values[1]), 95); // CER精度=100-5=95
});

test("buildTrendByExperiment: Experiment ID順にAccuracy/CERを並べる", () => {
  const trend = buildTrendByExperiment(ROWS);
  assert.deepEqual(trend.map((t) => t.experimentId), ["EXP-0001", "EXP-0002"]);
  assert.equal(trend[0].accuracyPercent, 90);
  assert.equal(trend[1].cerPercent, 2);
});

test("toCsvLines: ヘッダ＋行（評価未実施は空欄）", () => {
  const lines = toCsvLines(ROWS);
  assert.ok(lines[0].startsWith("model_name,engine"));
  assert.equal(lines.length, 4);
  assert.ok(lines[3].includes("c.tess.json"));
});

test("toMarkdownReport: task.md記載の見出し構成（Dataset→Best Accuracy→Best CER）", () => {
  const md = toMarkdownReport(ROWS, { datasetLabel: "DS0008", bestAccuracyRow: ROWS[1], bestCerRow: ROWS[1] });
  assert.ok(md.startsWith("# Benchmark Report"));
  assert.ok(md.includes("## Dataset") && md.includes("DS0008"));
  assert.ok(md.includes("## Best Accuracy") && md.includes("b.tess.json 96.0%"));
  assert.ok(md.includes("## Best CER") && md.includes("0.020"));
});

test("toJsonReport: メタ情報＋modelsを含むJSON文字列", () => {
  const json = JSON.parse(toJsonReport(ROWS, { dataset: "DS0008" }));
  assert.equal(json.dataset, "DS0008");
  assert.equal(json.models.length, 3);
});

test("buildBenchmarkRecommendations: Accuracy重視/CER重視/軽量重視（既存推薦は総合側でrecommendModelを別途利用）", () => {
  const cards = buildBenchmarkRecommendations(ROWS);
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(byId.accuracy.modelName, "b.tess.json");
  assert.equal(byId.cer.modelName, "b.tess.json");
  assert.equal(byId.size.modelName, "b.tess.json");
  assert.equal(buildBenchmarkRecommendations([]).length, 0);
});
