// ModelsView（モデル一覧＋右ペイン）のレンダリング回帰テスト。
// viteのssrLoadModuleで実際にレンダリングし、一覧の簡素化（比較バッジ削除）と
// 左右レイアウト（右ペイン最低幅・縦積み切替）のクラス構成を検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let ModelsView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: ModelsView } = await server.ssrLoadModule("/src/views/ModelsView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

// バッジ判定が発生する評価履歴（model_aがCER最良→Best CER/Recommended等の対象になる）
const EVAL_HISTORY = {
  "model_a.tess.json": {
    ds: { percent: 40, at: "2026-07-17T10:00:00Z", cer: 0.1, char_accuracy: 0.9, regressed: 10 },
  },
  "model_b.tess.json": {
    ds: { percent: 30, at: "2026-07-17T10:00:00Z", cer: 0.2, char_accuracy: 0.8, regressed: 20 },
  },
};

function baseProps(overrides = {}) {
  return {
    projectId: "testproj",
    models: ["model_a.tess.json", "model_b.tess.json"],
    modelInfos: {
      "model_a.tess.json": { model_id: "M0001", engine: "tesseract", training_family: "tesseract", created_at: "2026-07-15T10:00:00" },
      "model_b.tess.json": { model_id: "M0002", engine: "tesseract", training_family: "tesseract", created_at: "2026-07-16T10:00:00" },
    },
    latest: { any: "model_b.tess.json", byType: {} },
    onRefresh: noop,
    onDeleteSelected: noop,
    aliases: {},
    onAliasChange: noop,
    evalHistory: EVAL_HISTORY,
    inferenceInUseModel: "",
    inferenceInUseEngine: "",
    onUseForInference: noop,
    onOpenEvaluation: noop,
    ...overrides,
  };
}

test("モデル一覧: 比較・順位バッジを表示しない（管理No＋モデル名のみ）", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  // バッジ判定対象の履歴があっても、一覧（初期表示）にバッジ文言・装飾は出ない
  for (const badge of ["Best Accuracy", "Best CER", "Best Char Acc", "Recommended", "Latest Best"]) {
    assert.ok(!html.includes(badge), `一覧に比較バッジ「${badge}」が表示されている`);
  }
  for (const icon of ["🏆", "⭐", "🟢", "🔵"]) {
    assert.ok(!html.includes(icon), `一覧に順位・推奨の装飾「${icon}」が表示されている`);
  }
  // 管理Noチップとモデル名は表示される
  assert.ok(html.includes("M0001"));
  assert.ok(html.includes("M0002"));
  assert.ok(html.includes("model_a.tess.json"));
  assert.ok(html.includes("model_b.tess.json"));
});

test("状態列の「最新」ラベルは維持される", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  assert.ok(html.includes("最新"), "状態列の「最新」が消えている");
});

test("レイアウト: 右ペイン最低幅520pxの2カラム（1400px以上）と縦積み（未満）のクラス構成", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  // 1400px以上で 左2fr:右minmax(520px,1fr)
  assert.ok(html.includes("min-[1400px]:grid-cols-[minmax(0,2fr)_minmax(520px,1fr)]"), "右ペイン最低幅520pxのグリッド指定がない");
  // 1400px未満は1カラム（右ペインを下段へ縦積み）
  assert.ok(html.includes("grid-cols-1"), "縦積み用のgrid-cols-1がない");
});

test("一覧の列幅: モデル名はminmax相当の広い列・他列は固定幅", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  assert.ok(html.includes("min-w-[280px]"), "モデル名列の最低幅280pxがない");
  assert.ok(html.includes("w-[150px]"), "作成日/評価列の固定幅がない");
  assert.ok(html.includes("w-[80px]"), "状態列の固定幅がない");
});
