// レポート画面（ReportsView）のレンダリングテスト
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let ReportsView;
let REPORT_TYPE_LABELS;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: ReportsView, REPORT_TYPE_LABELS } = await server.ssrLoadModule("/src/views/ReportsView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function render(props = {}) {
  return renderToString(
    React.createElement(ReportsView, {
      projectId: "p1",
      ocrModels: [{ name: "m1.tess.json" }, { name: "m2.tess.json" }],
      onOpenJobs: noop,
      notify: noop,
      ...props,
    })
  ).replaceAll("<!-- -->", "");
}

test("生成フォーム: 種別3種・対象モデル・出力形式（Markdown/PDF）・画像掲載・生成ボタン", () => {
  const html = render();
  assert.deepEqual(Object.keys(REPORT_TYPE_LABELS), ["single_model", "comparison", "project_summary"]);
  assert.ok(html.includes("単一モデル") && html.includes("モデル比較") && html.includes("プロジェクト総括"));
  assert.ok(html.includes("対象モデル"));
  assert.ok(html.includes(">Markdown<") && html.includes(">PDF<"));
  assert.ok(html.includes("代表失敗例の画像を掲載"));
  assert.ok(html.includes("レポートを生成（Job作成）"));
  assert.ok(html.includes("外部通信なし"));
});

test("Empty State: レポートがない場合の案内", () => {
  const html = render();
  assert.ok(html.includes("レポートはまだありません"));
  assert.ok(html.includes("最初のレポートを生成しましょう"));
});

test("履歴テーブルのヘッダー（Report ID/種別/対象/形式/状態/作成日時/操作者/Job ID）", () => {
  const html = render();
  for (const h of ["Report ID", ">種別<", ">対象<", ">形式<", ">状態<", "作成日時", "操作者", "Job ID"]) {
    assert.ok(html.includes(h), `ヘッダー ${h} がない`);
  }
});
