// テンプレート選択付き新規プロジェクト作成モーダルのレンダリングテスト
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let ProjectCreateModal;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: ProjectCreateModal } = await server.ssrLoadModule("/src/components/ProjectCreateModal.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function render() {
  return renderToString(React.createElement(ProjectCreateModal, { onCreate: noop, onClose: noop })).replaceAll("<!-- -->", "");
}

test("テンプレートカード: 6種類がカード形式で表示・アイコン/説明/エンジン/用途タグ", () => {
  const html = render();
  for (const name of ["標準プロジェクト", "英数字OCR", "日本語OCR", "銘板OCR", "手書きOCR", "OCR＋YOLO"]) {
    assert.ok(html.includes(name), `テンプレート「${name}」のカードがない`);
  }
  assert.ok(html.includes("OCR Crafterの標準設定から開始します。"));
  assert.ok(html.includes("配電盤や機器に使用される銘板文字列の認識向けです。"));
  assert.ok(html.includes("このテンプレートを使用"));
  assert.ok(html.includes("Tesseract") && html.includes("PaddleOCR"));
  assert.ok(html.includes('aria-label="標準プロジェクトのアイコン"'), "アイコンのaria-labelがない");
});

test("選択状態: 初期選択=標準プロジェクトがaria-selectedとaccent強調・説明とaria-describedbyで関連付け", () => {
  const html = render();
  assert.ok(html.includes('aria-selected="true"'), "選択状態のaria-selectedがない");
  const selectedCount = (html.match(/aria-selected="true"/g) || []).length;
  assert.equal(selectedCount, 1, "選択中カードが1枚でない");
  assert.ok(html.includes("border-accent"), "選択カードのaccent強調がない");
  assert.ok(html.includes("✓ 選択中"));
  assert.ok(html.includes('aria-describedby="template-desc-standard"'));
  assert.ok(html.includes('id="template-desc-standard"'));
});

test("詳細確認: 適用される設定（エンジン/文字セット/前処理/評価指標/YOLO/学習方式/推奨用途）を表示", () => {
  const html = render();
  assert.ok(html.includes("適用される設定（初期値。作成後はすべて変更できます）"));
  for (const label of ["OCRエンジン", "文字セット", ">前処理<", "評価指標", "YOLO使用", "学習方式", "推奨用途"]) {
    assert.ok(html.includes(label), `詳細項目「${label}」がない`);
  }
});

test("フロー: ステップ表示（1/3）・戻る/次へ・×閉じるボタン", () => {
  const html = render();
  assert.ok(html.includes("テンプレート選択") && html.includes("1/3"));
  assert.ok(html.includes("戻る") && html.includes(">次へ<"));
  assert.ok(html.includes('aria-label="新規プロジェクト作成を閉じる"'));
});
