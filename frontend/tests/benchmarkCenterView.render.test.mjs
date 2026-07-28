// Benchmark Center画面（BenchmarkCenterView）のレンダリングテスト。
// 一覧テーブル・フィルタ・Benchmark履歴カードを検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let BenchmarkCenterView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: BenchmarkCenterView } = await server.ssrLoadModule("/src/views/BenchmarkCenterView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function render(props = {}) {
  const html = renderToString(
    React.createElement(BenchmarkCenterView, {
      projectId: "p1",
      onOpenEvaluation: noop,
      notify: noop,
      ...props,
    })
  );
  return html.replaceAll("<!-- -->", "");
}

test("初期表示: タイトル・フィルタ・一覧列見出し・Benchmark履歴カードを表示する", () => {
  const html = render();
  assert.ok(html.includes("Benchmark Center"));
  assert.ok(html.includes("評価は実行しません"), "評価を実行しない旨の説明がない");
  assert.ok(html.includes("Dataset: すべて") && html.includes("Engine: すべて"), "フィルタがない");
  assert.ok(html.includes("前処理Version: すべて") && html.includes("Experiment: すべて"));
  for (const label of ["モデル", "Engine", "Dataset", "Experiment", "前処理", "サイズ", "Accuracy", "CER"]) {
    assert.ok(html.includes(label), `列見出し「${label}」がない`);
  }
  assert.ok(html.includes("Benchmark履歴"));
  assert.ok(html.includes("Benchmark履歴がありません"));
});

test("モデルが0件の場合は案内メッセージを表示する", () => {
  const html = render();
  assert.ok(html.includes("比較可能なモデルがありません"));
});
