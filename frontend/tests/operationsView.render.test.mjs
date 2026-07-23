// システム状態画面（OperationsView）のレンダリングテスト。
// 認証未設定モードバナー・ダッシュボード項目・ヘルスチェック表示を検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let OperationsView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: OperationsView } = await server.ssrLoadModule("/src/views/OperationsView.jsx"));
});

after(async () => {
  await server?.close();
});

function render(props = {}) {
  const html = renderToString(
    React.createElement(OperationsView, {
      projectId: "p1",
      authContext: { operator: "", role: "admin", auth_configured: false, auth_mode: "認証未設定モード（Admin互換）" },
      ...props,
    })
  );
  return html.replaceAll("<!-- -->", "");
}

test("認証未設定モードバナーとダッシュボード項目が表示される", () => {
  const html = render();
  assert.ok(html.includes("認証未設定モード"), "認証未設定モードの明示がない");
  assert.ok(html.includes("Admin互換"));
  assert.ok(html.includes("実行中Job"));
  assert.ok(html.includes("待機中Job"));
  assert.ok(html.includes("失敗Job"));
  assert.ok(html.includes("Production"));
  assert.ok(html.includes("Release Gate"));
  assert.ok(html.includes("未評価Candidate"));
  assert.ok(html.includes("データ使用量"));
  assert.ok(html.includes("最近のBenchmark"));
  assert.ok(html.includes("バックアップ"));
  assert.ok(html.includes("ヘルスチェック（/health/details）"));
});

test("バックアップ・データ保持設定カードが表示される", () => {
  const html = render();
  assert.ok(html.includes("metadata_only（設定・記録のみ）"));
  assert.ok(html.includes("full（プロジェクト全体）"));
  assert.ok(html.includes("バックアップを作成"));
  assert.ok(html.includes("復元先Project ID"), "新Project IDへの復元入力がない");
  assert.ok(html.includes("データ保持設定"));
  assert.ok(html.includes("Job保持日数"));
  assert.ok(html.includes("監査ログ保持日数"));
  assert.ok(html.includes("無期限保持（従来動作）"));
  assert.ok(html.includes("監査ログへ記録されます"));
});

test("認証設定済みの場合はバナーを表示しない", () => {
  const html = render({ authContext: { auth_configured: true } });
  assert.ok(!html.includes("認証未設定モード"));
});
