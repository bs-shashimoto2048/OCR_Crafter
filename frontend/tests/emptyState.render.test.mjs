// 共通Empty State（説明＋次操作＋ボタン）のレンダリングテスト
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let EmptyState;
let JobsView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: EmptyState } = await server.ssrLoadModule("/src/components/EmptyState.jsx"));
  ({ default: JobsView } = await server.ssrLoadModule("/src/views/JobsView.jsx"));
});

after(async () => {
  await server?.close();
});

test("EmptyState: タイトル・説明・操作ボタンを表示する", () => {
  const html = renderToString(
    React.createElement(EmptyState, {
      title: "モデルがありません",
      description: "最初のモデルを作成しましょう。",
      actionLabel: "新規作成",
      onAction: () => {},
    })
  ).replaceAll("<!-- -->", "");
  assert.ok(html.includes("モデルがありません"));
  assert.ok(html.includes("最初のモデルを作成しましょう。"));
  assert.ok(html.includes("新規作成"));
});

test("EmptyState: ボタンなし（説明のみ）でも表示できる", () => {
  const html = renderToString(React.createElement(EmptyState, { title: "データなし", description: "説明のみ" }));
  assert.ok(html.includes("データなし"));
  assert.ok(!html.includes("<button") || !html.includes("undefined"));
});

test("JobsViewの空状態: 説明と次操作（Benchmarkを開く）ボタンを表示する", () => {
  const html = renderToString(
    React.createElement(JobsView, {
      projects: [],
      jobs: [],
      workerAlive: false,
      filters: {},
      onOpenBenchmark: () => {},
    })
  ).replaceAll("<!-- -->", "");
  assert.ok(html.includes("ジョブがありません"));
  assert.ok(html.includes("バックグラウンド実行すると"), "次に行う操作の説明がない");
  assert.ok(html.includes("Benchmarkを開く"), "次操作ボタンがない");
});
