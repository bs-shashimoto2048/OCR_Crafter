// AugmentationSettingsPanel のレンダリング回帰テスト（vite ssrLoadModule + renderToString）
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let AugmentationSettingsPanel;
let WEAK_AUGMENTATION;
let defaultAugmentationState;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: AugmentationSettingsPanel } = await server.ssrLoadModule("/src/components/AugmentationSettingsPanel.jsx"));
  ({ WEAK_AUGMENTATION, defaultAugmentationState } = await server.ssrLoadModule("/src/lib/augmentation.js"));
});

after(async () => {
  await server?.close();
});

function render(props = {}) {
  const html = renderToString(React.createElement(AugmentationSettingsPanel, props));
  return html.replaceAll("<!-- -->", "");
}

test("weak設定でカテゴリ・項目行・サマリー・プレビューEmpty Stateを表示する", () => {
  const html = render({ augmentation: structuredClone(WEAK_AUGMENTATION) });
  // 3カテゴリと5項目
  for (const label of ["幾何変換", "明るさ・コントラスト", "ノイズ・ぼかし"]) assert.ok(html.includes(label), label);
  for (const label of ["回転", "明るさ", "コントラスト", "ぼかし（ガウシアン）", "ノイズ"]) assert.ok(html.includes(label), label);
  // 単位を明示した入力ラベル
  assert.ok(html.includes("確率 (%)"));
  assert.ok(html.includes("範囲 ±(°)"));
  assert.ok(html.includes("範囲 ±(%)"));
  assert.ok(html.includes("強度"));
  // ヘッダー操作・プレビュー・サマリー
  assert.ok(html.includes("適用モード"));
  assert.ok(html.includes("生成倍率"));
  assert.ok(html.includes("推奨設定を適用"));
  assert.ok(html.includes("設定をリセット"));
  assert.ok(html.includes("プレビューを再生成"));
  assert.ok(html.includes("プレビューはまだ生成されていません"));
  assert.ok(html.includes("設定サマリー"));
  assert.ok(html.includes("適用項目数"));
  assert.ok(html.includes("5 / 5"));
  assert.ok(html.includes("22%"));
  assert.ok(html.includes("1.5倍"));
  assert.ok(html.includes("推定値は目安です。実際の生成枚数はデータ内容により変動します。"));
  // 次回学習から適用される旨（Trainのみ）
  assert.ok(html.includes("Trainのみへ適用"));
});

test("適用モード「なし」では案内を表示し、項目入力がdisabledになる", () => {
  const html = render({ augmentation: defaultAugmentationState() });
  assert.ok(html.includes("適用モードが「なし」のため、オーグメンテーションは適用されません"));
  assert.ok(html.includes("disabled"));
  // サマリーは0件・倍率なし
  assert.ok(html.includes("0 / 5"));
  assert.ok(html.includes("増加なし"));
});

test("プレビュー結果（元画像/適用例）と適用変換名を表示する", () => {
  const html = render({
    augmentation: structuredClone(WEAK_AUGMENTATION),
    preview: {
      items: [
        { image_name: "a.png", label: "CHYBkt", original: "data:image/png;base64,x", augmented: "data:image/png;base64,y" },
      ],
    },
    trainCount: 100,
  });
  assert.ok(html.includes("元画像"));
  assert.ok(html.includes("適用例"));
  assert.ok(html.includes("a.png"));
  assert.ok(html.includes("適用される変換"));
  assert.ok(html.includes("回転"));
  // Train枚数から推定追加枚数（100×0.5=50枚）
  assert.ok(html.includes("約50枚（+50%）"));
});

test("aria属性（describedby・live）が付与される", () => {
  const html = render({ augmentation: structuredClone(WEAK_AUGMENTATION) });
  assert.ok(html.includes('aria-describedby="aug-desc-rotation"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(html.includes('aria-label="オーグメンテーションプレビュー"'));
});
