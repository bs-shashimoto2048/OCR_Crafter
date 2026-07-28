// App.jsx起動エラー回帰テスト（推論モデル切替修正後の setInferenceModelRestored is not defined 対策）。
//
// 背景: 推論使用モデルの保存トリガーをswitchInferenceModel()へ一本化した際、
// inferenceModelRestored/setInferenceModelRestored/inferenceModelSuppressSaveRef を
// 廃止したが、プロジェクト切替effect内に setInferenceModelRestored(false) の呼び出しが
// 1箇所残っていた。この呼び出しは useEffect のコールバック内にあるため、
// renderToString（SSRはeffectを一切実行しない）だけでは検出できない——実際に
// npm run build は成功していたにもかかわらずブラウザ実行時にReferenceErrorが発生した。
// そのため、ここでは(1)廃止済み識別子がソースに残っていないことを直接検証する静的チェックと
// (2)初期マウント（render部分）で例外が出ないことのSSRスモークテストを併用する。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

test("App.jsx: 廃止済みの推論モデル復元state/setter/抑制refを参照していない", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf-8");
  for (const retired of ["inferenceModelRestored", "setInferenceModelRestored", "inferenceModelSuppressSaveRef"]) {
    assert.ok(!source.includes(retired), `廃止済み識別子 "${retired}" がApp.jsxに残っている`);
  }
});

let server;
let App;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: App } = await server.ssrLoadModule("/src/App.jsx"));
});

after(async () => {
  await server?.close();
});

test("App: 初期マウント（SSRレンダリング）で例外が発生しない", () => {
  // renderToStringはuseEffectを実行しないため、effect内のみで起きるエラー
  // （今回のReferenceError等）はここでは検出できない。render本体の例外のみを保証する
  // best-effort smoke test（上の静的チェックと組み合わせて初めて今回の不具合を再現防止できる）
  assert.doesNotThrow(() => {
    const html = renderToString(React.createElement(App));
    assert.ok(html.length > 0, "Appのレンダリング結果が空");
  });
});
