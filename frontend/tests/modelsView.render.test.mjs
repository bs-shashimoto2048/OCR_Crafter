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
let MODEL_LIST_GRID_COLUMNS;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: ModelsView, MODEL_LIST_GRID_COLUMNS } = await server.ssrLoadModule("/src/views/ModelsView.jsx"));
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

test("レイアウト: 右ペイン拡張の流体2カラム（1366px/1600px段階）と縦積み（未満）のクラス構成", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  // 1366〜1599px: 左1.05fr:右1fr（右≈49%） / 1600px以上: 左1.2fr:右1fr（右≈45.5%）
  assert.ok(
    html.includes("min-[1366px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"),
    "1366px以上の流体グリッド指定がない"
  );
  assert.ok(
    html.includes("min-[1600px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"),
    "1600px以上の右ペイン拡張比率がない"
  );
  // 右ペインへ固定520pxを常時強制しない
  assert.ok(!html.includes("minmax(520px"), "右ペインに固定520pxが残っている");
  // 1366px未満は1カラム（右ペインを下段へ縦積み）
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

test("一覧の列定義: モデル名に最大幅400px・ヘッダーとデータ行が同じ列定義を共有", () => {
  // 共有定数: モデル名は minmax(300px,420px) の上限付き（余った幅いっぱいまで伸ばさない）
  assert.equal(MODEL_LIST_GRID_COLUMNS, "32px minmax(300px, 420px) 80px 85px 140px 140px 70px");
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  // ヘッダー1 + データ行2件 = 同じgrid-template-columnsが3回以上出現（列定義の共有）
  const needle = "minmax(300px, 420px)";
  const count = html.split(needle).length - 1;
  assert.ok(count >= 3, `列定義の共有回数が不足（${count}回）`);
  // 長いモデル名は省略表示＋title（Engine列との間に過剰な空白を作らず、列を押し広げない）
  assert.ok(html.includes("truncate"), "モデル名の省略表示がない");
});
