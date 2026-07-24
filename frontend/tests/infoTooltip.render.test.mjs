// InfoTooltip の共通コンポーネント回帰テスト（vite ssrLoadModule + renderToString）。
// 表示位置の計算ロジックはeffect駆動のためSSRでは実行されない（tests/tooltipPosition.test.mjsで直接検証）。
// ここでは閉じている（初期）状態の構造・aria属性のwiringのみ確認する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let InfoTooltip;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: InfoTooltip } = await server.ssrLoadModule("/src/components/InfoTooltip.jsx"));
});

after(async () => {
  await server?.close();
});

function render(props) {
  return renderToString(React.createElement(InfoTooltip, props)).replaceAll("<!-- -->", "");
}

test("初期状態は?アイコンのみ表示し、パネルは表示されない（visible=falseのため未マウント）", () => {
  const html = render({ title: "CER", body: "文字誤り率です。" });
  assert.ok(html.includes(">?<"));
  assert.ok(html.includes('aria-label="CERのヘルプ"'));
  assert.ok(!html.includes('role="tooltip"'));
  assert.ok(!html.includes("aria-describedby"));
});

test("titleが無い場合もクラッシュせず既定のaria-labelになる", () => {
  const html = render({ body: "本文のみ" });
  assert.ok(html.includes('aria-label="項目のヘルプ"'));
});

test("focus-visibleのスタイルとfocus/blurハンドラが構成されている（クラス名で確認）", () => {
  const html = render({ title: "生成倍率", body: "倍率の説明" });
  assert.ok(html.includes("focus-visible:outline"));
});
