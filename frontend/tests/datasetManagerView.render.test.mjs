// Dataset Manager画面（DatasetManagerView）のレンダリングテスト。
// 一覧テーブル（Dataset/作成日時/画像数/Train/Val/Test/前処理/使用モデル数）とソート可能ヘッダーを検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let DatasetManagerView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: DatasetManagerView } = await server.ssrLoadModule("/src/views/DatasetManagerView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function render(props = {}) {
  const html = renderToString(
    React.createElement(DatasetManagerView, {
      projectId: "p1",
      onOpenModel: noop,
      notify: noop,
      ...props,
    })
  );
  return html.replaceAll("<!-- -->", "");
}

test("初期表示: タイトル・検索欄・一覧テーブルの列見出しを表示する", () => {
  const html = render();
  assert.ok(html.includes("Dataset Manager"));
  assert.ok(html.includes("Dataset名・コメント・Charset・前処理Versionで検索"));
  for (const label of ["Dataset", "作成日時", "画像数", "Train", "Val", "Test", "前処理", "使用モデル数"]) {
    assert.ok(html.includes(`>${label}<`) || html.includes(label), `列見出し「${label}」がない`);
  }
});

test("Datasetが0件の場合は案内メッセージを表示する", () => {
  const html = render();
  assert.ok(html.includes("Datasetがありません"));
});

test("ソート可能なヘッダーにはaria-sortが設定される（デフォルトは作成日時降順）", () => {
  const html = render();
  assert.ok(html.includes('aria-sort="descending"'), "デフォルトの降順ソート表示がない");
});
