// ダッシュボード「プロジェクト一覧」純粋ロジックのテスト（lib/dashboardProjectList.js）
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  currentStepLabel,
  formatBenchmarkCount,
  formatBestCer,
  formatProductionModel,
  matchesSearch,
  projectStateBadge,
  quickActionEnabled,
  rowProgressPercent,
  sortProjectIds,
} from "../src/lib/dashboardProjectList.js";

test("状態バッジ: 使用中が最優先、次に学習中/評価中、次にArchived、該当なしはnull", () => {
  assert.equal(projectStateBadge({ active_job_type: "training" }, true).label, "使用中");
  assert.equal(projectStateBadge({ active_job_type: "training" }, false).label, "学習中");
  assert.equal(projectStateBadge({ active_job_type: "evaluation" }, false).label, "評価中");
  assert.equal(projectStateBadge({ all_models_archived: true }, false).label, "Archived");
  assert.equal(projectStateBadge({}, false), null);
});

test("Best CERの表示: 0-1の小数を%表記へ変換し、記録なしは—", () => {
  assert.equal(formatBestCer({ best_cer: 0.0091 }), "0.91%");
  assert.equal(formatBestCer({ best_cer: 0 }), "0.00%");
  assert.equal(formatBestCer({ best_cer: null }), "—");
  assert.equal(formatBestCer({}), "—");
});

test("Production表示: モデルが無ければ—、管理No優先・未解決時はモデル名", () => {
  assert.equal(formatProductionModel({ production_model: "", production_model_id: "" }), "—");
  assert.equal(formatProductionModel({ production_model: "m.tess.json", production_model_id: "M0009" }), "M0009");
  assert.equal(formatProductionModel({ production_model: "m.tess.json", production_model_id: "" }), "m.tess.json");
});

test("Benchmark件数表示: 0件は—、1件以上は件数表記", () => {
  assert.equal(formatBenchmarkCount({ benchmark_count: 0 }), "—");
  assert.equal(formatBenchmarkCount({ benchmark_count: 7 }), "7件");
});

test("現在の工程名: 実行中Jobが最優先、次にカウントからの推定", () => {
  assert.equal(currentStepLabel({ active_job_type: "training" }), "モデル学習");
  assert.equal(currentStepLabel({ active_job_type: "evaluation" }), "評価");
  assert.equal(currentStepLabel({ images: 0 }), "画像取込");
  assert.equal(currentStepLabel({ images: 10, image_stage: "raw" }), "前処理");
  assert.equal(currentStepLabel({ images: 10, image_stage: "processed", labeled: 5 }), "ラベル編集");
  assert.equal(currentStepLabel({ images: 10, image_stage: "processed", labeled: 10, models: 0 }), "データ作成・学習");
  assert.equal(
    currentStepLabel({ images: 10, image_stage: "processed", labeled: 10, models: 2, production_model: "" }),
    "評価"
  );
  assert.equal(
    currentStepLabel({ images: 10, image_stage: "processed", labeled: 10, models: 2, production_model: "m" }),
    "完了"
  );
});

test("進捗%は既存の4要素均等配分と一致する", () => {
  assert.equal(rowProgressPercent({ images: 0 }), 0);
  assert.equal(rowProgressPercent({ images: 4, labeled: 4, ocr_confirmed: 4, models: 1 }), 100);
  assert.equal(rowProgressPercent({ images: 4, labeled: 2, ocr_confirmed: 0, models: 0 }), 38); // (1+0.5+0+0)/4=0.375→38%
});

test("クイックアクションの有効判定: 開く/学習は常時、評価/レポートはモデル有無、Benchmarkは画像有無", () => {
  const empty = { images: 0, models: 0 };
  const withImages = { images: 10, models: 0 };
  const withModels = { images: 10, models: 2 };
  assert.equal(quickActionEnabled("open", empty), true);
  assert.equal(quickActionEnabled("train", empty), true);
  assert.equal(quickActionEnabled("evaluate", empty), false);
  assert.equal(quickActionEnabled("evaluate", withModels), true);
  assert.equal(quickActionEnabled("benchmark", empty), false);
  assert.equal(quickActionEnabled("benchmark", withImages), true);
  assert.equal(quickActionEnabled("report", withImages), false);
  assert.equal(quickActionEnabled("report", withModels), true);
});

test("検索: プロジェクト名（既存互換）・テンプレート名・Productionモデル・状態で一致する", () => {
  const summary = { production_model: "m.tess.json", production_model_id: "M0009" };
  assert.equal(matchesSearch("tube_20260710", summary, "銘板OCR", "使用中", "tube"), true);
  assert.equal(matchesSearch("tube_20260710", summary, "銘板OCR", "使用中", "銘板"), true);
  assert.equal(matchesSearch("tube_20260710", summary, "銘板OCR", "使用中", "M0009"), true);
  assert.equal(matchesSearch("tube_20260710", summary, "銘板OCR", "使用中", "使用中"), true);
  assert.equal(matchesSearch("tube_20260710", summary, "銘板OCR", "使用中", "存在しない語"), false);
  assert.equal(matchesSearch("tube_20260710", summary, "銘板OCR", "使用中", ""), true);
});

test("ソート: 更新日時・画像数・ラベル数・モデル数・Best CER・進捗の各列で並び替えできる", () => {
  const summaries = {
    a: { images: 10, labeled: 5, models: 1, best_cer: 0.1, updated_at: "2026-07-01T00:00:00" },
    b: { images: 20, labeled: 20, models: 3, best_cer: 0.02, updated_at: "2026-07-20T00:00:00" },
    c: { images: 0, labeled: 0, models: 0, best_cer: null, updated_at: "" },
  };
  const pids = ["a", "b", "c"];
  assert.deepEqual(sortProjectIds(pids, summaries, "images", "desc"), ["b", "a", "c"]);
  assert.deepEqual(sortProjectIds(pids, summaries, "images", "asc"), ["c", "a", "b"]);
  assert.deepEqual(sortProjectIds(pids, summaries, "best_cer", "asc"), ["b", "a", "c"]); // 低いほど良い・記録なしは最後
  assert.deepEqual(sortProjectIds(pids, summaries, "updated_at", "desc"), ["b", "a", "c"]);
  // sortKey未指定は既存順を維持
  assert.deepEqual(sortProjectIds(pids, summaries, null), pids);
});
