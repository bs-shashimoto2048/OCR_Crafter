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

test("レイアウト: 両列minmax(0,…)の流体2カラム（1250px以上）と縦積み（未満）のクラス構成", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  // 1250px以上で 左minmax(0,1.8fr):右minmax(0,1fr)（両列とも収縮可能・右ペインがはみ出さない）
  assert.ok(
    html.includes("min-[1250px]:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]"),
    "両列minmax(0,…)の流体グリッド指定がない"
  );
  // 右ペインへ固定520pxを常時強制しない
  assert.ok(!html.includes("minmax(520px"), "右ペインに固定520pxが残っている");
  // 1250px未満は1カラム（右ペインを下段へ縦積み）
  assert.ok(html.includes("grid-cols-1"), "縦積み用のgrid-cols-1がない");
  // 左右ペインの min-w-0（Flex/Grid既定のmin-width:autoで収縮不能にならない）
  assert.ok(html.includes("min-w-0"), "ペインのmin-w-0がない");
  // 右ペインは幅コンテナ（コンテナクエリの基準・min-width:0）
  assert.ok(html.includes("model-side-pane"), "右ペインのmodel-side-paneクラスがない");
});

test("比較カード・テーブルの収縮定義（index.css）: minmax(0,1fr)と横スクロール限定ラッパー", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf-8");
  // 比較カードは固定最小幅なし（minmax(0,1fr)×可変列数）＋狭い右ペインでは縦並び
  assert.ok(css.includes("repeat(var(--cols, 3), minmax(0, 1fr))"), "比較カードのminmax(0,1fr)定義がない");
  assert.ok(/@container \(max-width: \d+px\)/.test(css), "右ペイン幅基準のコンテナクエリがない");
  assert.ok(css.includes("container-type: inline-size"), "model-side-paneのコンテナ定義がない");
  // 横スクロールはテーブルラッパー内のみに限定
  assert.ok(css.includes(".comparison-table-wrap"), "テーブル専用ラッパー定義がない");
  assert.ok(/\.comparison-table-wrap\s*\{[^}]*overflow-x: auto/.test(css), "ラッパーのoverflow-x:autoがない");
  assert.ok(/\.comparison-card\s*\{[^}]*min-width: 0/.test(css), "比較カードのmin-width:0がない");
});

test("長いモデル名は一覧で省略表示され、title属性で全文確認できる", () => {
  const longName = "tess_20260715_145027_very_long_model_name_for_truncation_check.tess.json";
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: [longName],
        modelInfos: { [longName]: { model_id: "M0009", engine: "tesseract", training_family: "tesseract", created_at: "2026-07-15T10:00:00" } },
        evalHistory: {},
      })
    )
  );
  assert.ok(html.includes(`title="${longName}"`), "モデル名のtitle（全文確認手段）がない");
  assert.ok(html.includes("truncate"), "省略表示（truncate）がない");
});

test("一覧の列幅: モデル名はminmax相当の広い列・他列は固定幅", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  assert.ok(html.includes("min-w-[280px]"), "モデル名列の最低幅280pxがない");
  assert.ok(html.includes("w-[150px]"), "作成日/評価列の固定幅がない");
  assert.ok(html.includes("w-[80px]"), "状態列の固定幅がない");
});
