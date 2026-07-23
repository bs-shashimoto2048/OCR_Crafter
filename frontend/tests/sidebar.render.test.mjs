// Sidebar（OCR開発フロー順の再設計）のレンダリング回帰テスト。
// viteのssrLoadModuleで実際にレンダリングし、カテゴリ構成・並び順・展開/選択状態を検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let Sidebar;
let SIDEBAR_SECTIONS;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: Sidebar, SIDEBAR_SECTIONS } = await server.ssrLoadModule("/src/components/Sidebar.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function render(active = "dashboard") {
  return renderToString(React.createElement(Sidebar, { active, onChange: noop, onExitApp: noop }));
}

test("新しいカテゴリ順: プロジェクト→データ作成→OCRモデル→運用→実験機能（実験機能は最下部）", () => {
  const html = render();
  const order = ["プロジェクト", "データ作成", "OCRモデル", ">運用<", "実験機能"].map((label) => html.indexOf(label));
  assert.ok(order.every((idx) => idx >= 0), "カテゴリ名が見つからない");
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] < order[i], `カテゴリ順が不正（${i}番目）`);
  }
  // 構成データ側でも実験機能が最後
  assert.equal(SIDEBAR_SECTIONS[SIDEBAR_SECTIONS.length - 1].id, "experimental");
});

test("名称変更: 「データ作成」「OCRモデル」があり、「モデル作成」「学習画像作成」「学習 >」は存在しない", () => {
  const html = render();
  assert.ok(html.includes("データ作成"));
  assert.ok(html.includes("OCRモデル"));
  assert.ok(!html.includes("モデル作成"), "旧カテゴリ「モデル作成」が残っている");
  assert.ok(!html.includes("学習画像作成"), "旧カテゴリ「学習画像作成」が残っている");
  assert.ok(!html.includes("学習 &gt;") && !html.includes("学習 >"), "パンくず「学習 >」が残っている");
});

test("OCRモデル配下の順序: モデル評価が推論より前", () => {
  const html = render();
  assert.ok(html.indexOf("モデル評価") >= 0 && html.indexOf(">推論<") >= 0);
  assert.ok(html.indexOf("モデル評価") < html.indexOf(">推論<"), "モデル評価が推論より後にある");
  const section = SIDEBAR_SECTIONS.find((s) => s.id === "ocr-model");
  const ids = section.items.map((item) => item.id);
  assert.ok(ids.indexOf("ocr-eval") < ids.indexOf("ocr-inference"));
  // 実験管理はモデル管理の直後（学習→管理→実験分析→評価の順）
  assert.deepEqual(ids, ["ocr-training", "ocr-models", "experiments", "releases", "ocr-eval", "ocr-inference", "rapid-ocr", "ocr-batch"]);
});

test("ダッシュボードはプロジェクト配下・データ作成はフロー順（並び順固定）", () => {
  const project = SIDEBAR_SECTIONS.find((s) => s.id === "project");
  assert.deepEqual(project.items.map((i) => i.id), ["dashboard"]);
  const data = SIDEBAR_SECTIONS.find((s) => s.id === "data-creation");
  assert.deepEqual(
    data.items.map((i) => i.id),
    [
      "image-builder-step1",
      "image-builder-step2",
      "image-builder-step3",
      "image-builder-step4",
      "images",
      "preprocess",
      "labeling",
      "image-builder-step5",
    ]
  );
});

test("初期展開状態: プロジェクト/データ作成/OCRモデル=展開・実験機能のみ折りたたみ", () => {
  const html = render();
  // 展開済みセクションの項目は表示される
  for (const label of ["ダッシュボード", "画像指定・リサイズ", "モデル管理"]) {
    assert.ok(html.includes(label), `展開済みのはずの「${label}」が表示されていない`);
  }
  // 実験機能・運用の項目は初期表示されない（折りたたみ）
  assert.ok(!html.includes("分類モデル管理"), "実験機能が初期展開されている");
  assert.ok(!html.includes("ジョブ管理"), "運用が初期展開されている");
});

test("運用セクション: OCRモデルと実験機能の間・ジョブ管理を含む", () => {
  const ids = SIDEBAR_SECTIONS.map((s) => s.id);
  assert.ok(ids.indexOf("ocr-model") < ids.indexOf("operations"));
  assert.ok(ids.indexOf("operations") < ids.indexOf("experimental"));
  const operations = SIDEBAR_SECTIONS.find((s) => s.id === "operations");
  assert.deepEqual(operations.items.map((i) => i.id), ["jobs", "benchmark", "audit", "operations"]);
  assert.equal(operations.defaultOpen, false);
});

test("選択状態: 選択中ページの項目と所属セクションヘッダーがアクティブ表示", () => {
  const html = render("ocr-models");
  // 選択項目のアクティブ装飾
  assert.ok(html.includes("sidebar-active-wave"), "選択項目のアクティブ表示がない");
  // 所属セクション（OCRモデル）のヘッダーがアクティブになる（text-accent＋data-active）
  assert.ok(/data-section="ocr-model" data-active="true"[^>]*text-accent/.test(html), "所属セクションのアクティブ表示がない");
  // 非所属セクション選択時はOCRモデルヘッダーがアクティブにならず、プロジェクトがアクティブになる
  const html2 = render("dashboard");
  assert.ok(html2.includes('data-section="ocr-model" data-active="false"'), "非選択セクションがアクティブ表示になっている");
  assert.ok(/data-section="project" data-active="true"/.test(html2), "プロジェクトセクションがアクティブにならない");
  // セクション説明のツールチップ（title属性）
  assert.ok(html.includes("OCR学習に必要な画像・ラベル・評価データを準備します。"));
  assert.ok(html.includes("学習・評価・推論・モデル管理を行います。"));
});

test("絵文字を使用しない（アイコンはSVG）", () => {
  const html = render();
  for (const emoji of ["📁", "🖼", "🤖", "🧪"]) {
    assert.ok(!html.includes(emoji), `絵文字「${emoji}」が使用されている`);
  }
  assert.ok(html.includes("<svg"), "SVGアイコンがない");
});
