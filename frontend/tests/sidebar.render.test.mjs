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
let sectionItems;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: Sidebar, SIDEBAR_SECTIONS, sectionItems } = await server.ssrLoadModule("/src/components/Sidebar.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function render(active = "dashboard") {
  return renderToString(React.createElement(Sidebar, { active, onChange: noop, onExitApp: noop }));
}

test("新しいカテゴリ順: プロジェクト→データ準備→OCRモデル→運用→実験機能（実験機能は最下部）", () => {
  const html = render();
  const order = ["プロジェクト", "データ準備", "OCRモデル", ">運用<", "実験機能"].map((label) => html.indexOf(label));
  assert.ok(order.every((idx) => idx >= 0), "カテゴリ名が見つからない");
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] < order[i], `カテゴリ順が不正（${i}番目）`);
  }
  // 構成データ側でも実験機能が最後
  assert.equal(SIDEBAR_SECTIONS[SIDEBAR_SECTIONS.length - 1].id, "experimental");
});

test("名称変更: 「データ準備」があり、旧カテゴリ名「データ作成」は存在しない", () => {
  const html = render();
  assert.ok(html.includes("データ準備"));
  assert.ok(html.includes("OCRモデル"));
  assert.ok(!html.includes(">データ作成<"), "旧カテゴリ「データ作成」が残っている");
  assert.ok(!html.includes("モデル作成"), "旧カテゴリ「モデル作成」が残っている");
  assert.ok(!html.includes("学習画像作成"), "旧カテゴリ「学習画像作成」が残っている");
  assert.ok(!html.includes("学習 &gt;") && !html.includes("学習 >"), "パンくず「学習 >」が残っている");
  // 表示名変更: 評価データ作成 → データセット作成（評価データグループ配下）
  assert.ok(html.includes(">データセット作成<"));
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

test("ダッシュボードはプロジェクト配下・データ準備は3グループ構成（view id・フロー順は不変）", () => {
  const project = SIDEBAR_SECTIONS.find((s) => s.id === "project");
  assert.deepEqual(project.items.map((i) => i.id), ["dashboard"]);
  const data = SIDEBAR_SECTIONS.find((s) => s.id === "data-creation");
  // 3つの折りたたみグループ（目的別の工程まとまり）
  assert.deepEqual(data.groups.map((g) => g.id), ["ocr-image", "training-data", "eval-data"]);
  assert.deepEqual(data.groups.map((g) => g.label), ["OCR画像作成", "学習データ", "評価データ"]);
  assert.deepEqual(
    data.groups.map((g) => g.items.map((i) => i.id)),
    [
      ["image-builder-step1", "image-builder-step2", "image-builder-step3", "image-builder-step4"],
      ["images", "preprocess", "labeling"],
      ["image-builder-step5"],
    ]
  );
  // 平坦化した全項目のview id・順序は再編前と同一（遷移・状態は互換）
  assert.deepEqual(
    sectionItems(data).map((i) => i.id),
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

test("データ準備のサブグループ: ヘッダー表示・初回すべて展開・選択でグループもアクティブ", () => {
  const html = render();
  // グループヘッダー3つが順に表示される
  const order = ["OCR画像作成", ">学習データ<", ">評価データ<"].map((label) => html.indexOf(label));
  assert.ok(order.every((idx) => idx >= 0), "グループ名が見つからない");
  assert.ok(order[0] < order[1] && order[1] < order[2], "グループ順が不正");
  // 初回はすべて展開（各グループの項目が表示される）
  for (const label of ["画像指定・リサイズ", "クロップ出力", "前処理設定", ">データセット作成<"]) {
    assert.ok(html.includes(label), `初回展開のはずの「${label}」が表示されていない`);
  }
  // 選択中の項目が属するグループとセクションの両方がアクティブ表示
  const activeHtml = render("image-builder-step5");
  assert.ok(/data-group="eval-data" data-active="true"/.test(activeHtml), "所属グループのアクティブ表示がない");
  assert.ok(/data-section="data-creation" data-active="true"/.test(activeHtml), "所属セクションのアクティブ表示がない");
  assert.ok(activeHtml.includes('data-group="ocr-image" data-active="false"'));
});

test("サブグループの展開状態はlocalStorage（ocr_sidebar_groups_v1）から復元される", () => {
  // 学習データグループのみ折りたたみ済みの保存状態を再現
  const stored = {};
  globalThis.window = {
    localStorage: {
      getItem: (key) => (key === "ocr_sidebar_groups_v1" ? JSON.stringify({ "training-data": false }) : null),
      setItem: (key, value) => {
        stored[key] = value;
      },
    },
  };
  try {
    const html = render();
    assert.ok(html.includes(">学習データ<"), "折りたたみ中でもグループヘッダーは表示される");
    assert.ok(!html.includes("前処理設定"), "保存された折りたたみ状態が復元されていない");
    assert.ok(html.includes("画像指定・リサイズ"), "未保存のグループは既定（展開）のまま");
    assert.ok(html.includes(">データセット作成<"));
  } finally {
    delete globalThis.window;
  }
});

test("初期展開状態: プロジェクト/データ準備/OCRモデル=展開・実験機能のみ折りたたみ", () => {
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
