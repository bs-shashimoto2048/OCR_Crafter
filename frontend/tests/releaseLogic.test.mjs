// リリース管理の純ロジック（lib/releaseLogic.js）と ReleasesView のレンダリングテスト。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

import { normalizeExperiment } from "../src/lib/experimentAnalysis.js";
import {
  RELEASE_STATUS_LABELS,
  experimentByModel,
  productionComparison,
  promoteWarnings,
  releaseJudgement,
} from "../src/lib/releaseLogic.js";

function makeExperiment(id, model, { cer = 0.3, hash = "sha256:h1", group = "CG-0001", enabled = true } = {}) {
  return normalizeExperiment({
    experiment_id: id,
    created_at: "2026-07-22T10:00:00",
    models: [model],
    model_ids: ["M0001"],
    training: { iterations: 1000, split_ratio: { train: 0.8, val: 0.1, test: 0.1 }, split_seed: 42, counts: { train: 80, val: 10, test: 10 } },
    preprocess: { hash: "sha256:tp1", snapshot_id: "prep_x", summary: "Binary 90" },
    augmentation: { config: null, generated: null },
    evaluation: cer === null ? null : { cer, char_accuracy: 1 - cer, accuracy_percent: 40, evaluated_at: "2026-07-22T10:00:00", dataset: "ds1" },
    evaluation_hash: hash,
    comparable_group: group,
    analysis_enabled: enabled,
    evaluation_profile: { dataset_id: "ds1", image_count: 228, label_count: 228, preprocess_signature: "sig", engine: "tesseract", psm: 7, whitelist: "AB" },
    tags: [],
    favorite: false,
    source: "training",
  });
}

test("releaseJudgement: リリース判定の表示項目（CER/文字正解率/完全一致率/Experiment/Group/評価データ数/前処理Hash）", () => {
  const rows = releaseJudgement(makeExperiment("EXP-0003", "m.tess.json", { cer: 0.287 }));
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(byLabel["CER"], "28.7%");
  assert.equal(byLabel["文字正解率"], "71.3%");
  assert.equal(byLabel["完全一致率"], "40%");
  assert.equal(byLabel["Experiment"], "EXP-0003");
  assert.equal(byLabel["Evaluation Group"], "CG-0001");
  assert.equal(byLabel["評価データ数"], 228);
  assert.ok(byLabel["前処理Hash"].includes("Binary 90"));
  // 評価未実施
  const empty = releaseJudgement(null);
  assert.equal(empty.find((r) => r.label === "CER").value, "評価未実施");
});

test("promoteWarnings: Group違い/CERなし/評価未実施/Scientific Mode外/件数5未満/比較品質低で警告（禁止しない）", () => {
  const production = makeExperiment("EXP-0001", "prod.tess.json");
  // 正常（同一Group・評価あり）→ 件数警告のみ制御可能
  assert.deepEqual(promoteWarnings({ candidate: makeExperiment("EXP-0002", "c.tess.json"), production, groupBasisCount: 6 }), []);
  // 評価未実施
  assert.ok(promoteWarnings({ candidate: null, production })[0].includes("評価未実施"));
  // CERなし
  const noCer = makeExperiment("EXP-0002", "c.tess.json", { cer: null });
  assert.ok(promoteWarnings({ candidate: noCer, production }).some((w) => w.includes("CERがありません")));
  // Comparable Group違い＋比較品質低（データセット違い=★2）
  const otherGroup = makeExperiment("EXP-0002", "c.tess.json", { hash: "sha256:h2", group: "CG-0002" });
  otherGroup.evalProfile.datasetId = "ds2";
  const warnings = promoteWarnings({ candidate: otherGroup, production });
  assert.ok(warnings.some((w) => w.includes("Comparable Groupが異なります")));
  assert.ok(warnings.some((w) => w.includes("比較品質が低い")));
  // Scientific Mode外（分析対象OFF）
  const disabled = makeExperiment("EXP-0002", "c.tess.json", { enabled: false });
  assert.ok(promoteWarnings({ candidate: disabled, production }).some((w) => w.includes("分析対象外")));
  // 件数5未満
  assert.ok(
    promoteWarnings({ candidate: makeExperiment("EXP-0002", "c.tess.json"), production, groupBasisCount: 3 }).some((w) =>
      w.includes("3件")
    )
  );
});

test("productionComparison: CER差/完全一致率差/前処理差/Experiment差/Evaluation差", () => {
  const production = makeExperiment("EXP-0001", "prod.tess.json", { cer: 0.312 });
  const candidate = makeExperiment("EXP-0003", "cand.tess.json", { cer: 0.287 });
  const rows = productionComparison(candidate, production);
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.equal(byLabel["CER差（候補 − Production。負=改善）"].value, "-2.5pt");
  assert.equal(byLabel["CER差（候補 − Production。負=改善）"].improved, true);
  assert.equal(byLabel["前処理差"].value, "同一");
  assert.equal(byLabel["Experiment差"].value, "EXP-0001 → EXP-0003");
  assert.equal(byLabel["Evaluation差"].value, "同一条件評価");
  assert.equal(productionComparison(null, production).length, 0);
});

test("experimentByModel: 同一モデル複数実験は最新を返す / RELEASE_STATUS_LABELS", () => {
  const list = [makeExperiment("EXP-0001", "m.tess.json"), makeExperiment("EXP-0002", "m.tess.json")];
  assert.equal(experimentByModel(list, "m.tess.json").id, "EXP-0002");
  assert.equal(experimentByModel(list, "none.tess.json"), null);
  assert.ok(RELEASE_STATUS_LABELS.Production.includes("使用中"));
});

// ---------- ReleasesView レンダリング ----------

let server;
let ReleasesView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: ReleasesView } = await server.ssrLoadModule("/src/views/ReleasesView.jsx"));
});

after(async () => {
  await server?.close();
});

test("ReleasesView: Production表示・ステータス一覧・Release History・Rollbackボタン・Deployment Package", () => {
  const html = renderToString(
    React.createElement(ReleasesView, {
      projectId: "p",
      releases: {
        production: "tess_new.tess.json",
        statuses: {
          "tess_new.tess.json": { status: "Production", version: "1.1.0" },
          "tess_old.tess.json": { status: "Archived", version: "1.0.0" },
          "tess_cand.tess.json": { status: "Candidate", version: "0.1" },
        },
        history: [
          { version: "1.1.0", model: "tess_new.tess.json", released_at: "2026-07-22T10:00:00", author: "hashimoto", note: "CER改善", rollback: false },
          { version: "1.0.0", model: "tess_old.tess.json", released_at: "2026-07-20T10:00:00", author: "", note: "初回", rollback: false },
        ],
      },
      experiments: [],
      modelInfos: { "tess_new.tess.json": { model_id: "M0002" } },
      onRefresh: () => {},
      onSetStatus: () => {},
      onPromote: () => {},
      onRollback: () => {},
      onOpenModel: () => {},
    })
  ).replaceAll("<!-- -->", "");
  assert.ok(html.includes("Production（現在使用中）"));
  assert.ok(html.includes("v1.1.0"), "現行Versionがない");
  assert.ok(html.includes("Deployment Package"), "配布パッケージ導線がない");
  assert.ok(html.includes("Model Card"), "Model Cardボタンがない");
  assert.ok(html.includes("Candidate"), "Candidateステータスがない");
  assert.ok(html.includes("Productionへ昇格"), "昇格ボタンがない");
  assert.ok(html.includes("Release History"));
  assert.ok(html.includes("このVersionへ戻す"), "Rollbackボタンがない");
  assert.ok(html.includes("CER改善"), "Reason表示がない");
  assert.ok(html.includes("hashimoto"), "Author表示がない");
});
