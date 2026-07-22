// 管理No（M0001形式）の共通表示コンポーネント（ModelIdBadge）と
// タイポグラフィ定義（index.css）のテスト。
// - 等幅フォントスタック・サイズ・太さ・最低幅・間隔・縮み防止
// - 一覧（ModelsView）と比較画面で同じ共通コンポーネントを使用すること
// - M0001〜M9999・識別色の維持
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let ModelIdBadge;
let ModelsView;
let css;
let modelsViewSource;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: ModelIdBadge } = await server.ssrLoadModule("/src/components/ModelIdBadge.jsx"));
  ({ default: ModelsView } = await server.ssrLoadModule("/src/views/ModelsView.jsx"));
  css = await readFile(new URL("../src/index.css", import.meta.url), "utf-8");
  modelsViewSource = await readFile(new URL("../src/views/ModelsView.jsx", import.meta.url), "utf-8");
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function cssBlock(selector) {
  const match = css.match(new RegExp(`${selector.replace(/[.\\-]/g, "\\$&")}[^{]*\\{[^}]*\\}`, "s"));
  assert.ok(match, `index.css に ${selector} の定義がない`);
  return match[0];
}

test("CSS: 管理Noへ等幅フォントスタック（Roboto Mono→Cascadia Mono→Consolas→monospace）が適用される", () => {
  const block = cssBlock(".model-id-badge");
  for (const font of ['"Roboto Mono"', '"Cascadia Mono"', '"Consolas"', "monospace"]) {
    assert.ok(block.includes(font), `フォントスタックに ${font} がない`);
  }
  // 一覧・カルテ・比較（テキスト表示）も同じ定義を共有する（.model-id-font, .model-id-badge の共通セレクタ）
  assert.ok(/\.model-id-font,\s*\.model-id-badge\s*\{/.test(css), "バッジとテキスト表示が同一フォント定義を共有していない");
});

test("CSS: 一覧用サイズ12px以上・font-weight 600以上・letter-spacing・行高1", () => {
  const shared = cssBlock(".model-id-badge");
  assert.ok(/font-weight:\s*600/.test(shared), "font-weight 600 がない");
  assert.ok(/letter-spacing:\s*0\.03em/.test(shared), "letter-spacing 0.03em がない");
  assert.ok(/line-height:\s*1\b/.test(shared), "line-height 1 がない");
  // sm（一覧既定）= 12px。md=13px / lg=16px・700
  assert.ok(/\.model-id-badge\s*\{[^}]*font-size:\s*12px/s.test(css), "一覧バッジのfont-size 12pxがない");
  assert.ok(/\.model-id-badge--md\s*\{[^}]*font-size:\s*13px/s.test(css), "mdのfont-size 13pxがない");
  assert.ok(/\.model-id-text--lg\s*\{[^}]*font-size:\s*16px[^}]*font-weight:\s*700/s.test(css), "lgの16px/700がない");
});

test("CSS: バッジの最低幅（48px）・余白・角丸・青系コントラスト配色・縮み防止", () => {
  assert.ok(/\.model-id-badge\s*\{[^}]*min-width:\s*48px/s.test(css), "最低幅48pxがない（M0001〜M9999で幅が揺れる）");
  assert.ok(/\.model-id-badge\s*\{[^}]*padding:\s*4px 7px/s.test(css), "padding 4px 7px がない");
  assert.ok(/\.model-id-badge\s*\{[^}]*border-radius:\s*5px/s.test(css), "border-radius 5px がない");
  assert.ok(/background-color:\s*rgba\(37,\s*99,\s*235,\s*0\.18\)/.test(css), "青系背景（コントラスト改善）がない");
  assert.ok(/border:\s*1px solid rgba\(96,\s*165,\s*250,\s*0\.35\)/.test(css), "枠線がない");
  assert.ok(/color:\s*#7dd3fc/.test(css), "文字色 #7dd3fc がない");
  // 長いモデル名（truncate側）があっても管理Noが縮まない
  const shared = cssBlock(".model-id-badge");
  assert.ok(/flex-shrink:\s*0/.test(shared), "flex-shrink: 0 がない");
});

test("ModelIdBadge: sm/md=バッジ・lg=テキスト表示・識別色指定でテキスト表示＋色維持", () => {
  const html = (props) => renderToString(React.createElement(ModelIdBadge, props));
  assert.ok(html({ modelId: "M0003" }).includes('class="model-id-badge"'));
  assert.ok(html({ modelId: "M0003", size: "md" }).includes("model-id-badge--md"));
  const lg = html({ modelId: "M0003", size: "lg", color: "#60a5fa" });
  assert.ok(lg.includes("model-id-text--lg"), "lgのテキスト表示クラスがない");
  assert.ok(!lg.includes("model-id-badge"), "lgにバッジ背景が付いている");
  // 比較画面の3色（ブルー/オレンジ/パープル）がそのまま維持される
  for (const color of ["#60a5fa", "#fb923c", "#c084fc"]) {
    const out = html({ modelId: "M0001", size: "md", color });
    assert.ok(out.includes(`color:${color}`), `識別色 ${color} が適用されない`);
    assert.ok(out.includes("model-id-font"), "色指定時も共通フォントクラスが付かない");
  }
  // 空IDは描画しない
  assert.equal(html({ modelId: "" }), "");
});

test("ModelIdBadge: M0001〜M9999のどれでも同一クラス構成（レイアウトが崩れない）", () => {
  for (const id of ["M0001", "M0011", "M0101", "M0111", "M1000", "M9999"]) {
    const html = renderToString(React.createElement(ModelIdBadge, { modelId: id }));
    assert.ok(html.includes('class="model-id-badge"'), `${id} でバッジクラスが変わる`);
    assert.ok(html.includes(id));
  }
});

test("モデル一覧: 共通バッジ使用・モデル名とgap-2（8px）で分離・長い名前でも管理No側は縮まない構成", () => {
  const longName = "tess_20260715_145027_very_long_model_name_for_shrink_check.tess.json";
  const props = {
    projectId: "p",
    models: [longName],
    modelInfos: { [longName]: { model_id: "M0101", engine: "tesseract", training_family: "tesseract", created_at: "2026-07-15T10:00:00" } },
    latest: { any: "", byType: {} },
    onRefresh: noop,
    onDeleteSelected: noop,
    aliases: {},
    onAliasChange: noop,
    evalHistory: {},
    inferenceInUseModel: "",
    inferenceInUseEngine: "",
    onUseForInference: noop,
    onOpenEvaluation: noop,
  };
  const html = renderToString(React.createElement(ModelsView, props));
  assert.ok(html.includes("model-id-badge"), "一覧に共通バッジが使われていない");
  assert.ok(html.includes("M0101"));
  // 管理Noとモデル名の間隔（gap-2）と、モデル名側のtruncate（バッジはflex-shrink:0で不縮小）
  assert.ok(/flex min-w-0 items-center gap-2/.test(html), "管理Noとモデル名のgap-2がない");
  assert.ok(html.includes("truncate"), "モデル名のtruncateがない");
  // ツールチップ（管理No：/モデル名：）
  assert.ok(html.includes("管理No：M0101"), "管理Noツールチップがない");
});

test("比較画面でも同じ共通コンポーネント（ModelIdBadge）を使用する", () => {
  assert.ok(modelsViewSource.includes('import ModelIdBadge from "../components/ModelIdBadge"'), "ModelsViewがModelIdBadgeをimportしていない");
  const uses = modelsViewSource.split("<ModelIdBadge").length - 1;
  // 凡例・推奨・カード・各テーブル見出し（改善悪化/学習条件/前処理/評価条件/詳細情報）・差分ペア・混同・指標別・勝利数
  assert.ok(uses >= 12, `比較画面のModelIdBadge使用箇所が不足（${uses}箇所）`);
  // 旧・画面別実装（font-monoのアドホックなチップ）が残っていない
  assert.ok(!modelsViewSource.includes("font-mono font-semibold text-accent"), "旧チップ実装が残っている");
});
