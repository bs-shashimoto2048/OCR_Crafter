// 初回セットアップウィザード（SetupWizard）のレンダリングテスト。
// 各ステップの表示内容・ステップバー・ボタン構成を initialStep 指定で検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let SetupWizard;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: SetupWizard } = await server.ssrLoadModule("/src/components/SetupWizard.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function render(initialStep = 0) {
  return renderToString(
    React.createElement(SetupWizard, { onComplete: noop, onCancel: noop, initialStep })
  ).replaceAll("<!-- -->", "");
}

test("Step1 ようこそ: 案内文・ステップバー・次へ/×（確認つき）を表示", () => {
  const html = render(0);
  assert.ok(html.includes("OCR Crafterへようこそ"));
  assert.ok(html.includes("セットアップは数分で完了します"));
  assert.ok(html.includes("必要な設定だけ"));
  assert.ok(html.includes(">次へ<"));
  assert.ok(html.includes("戻る"));
  assert.ok(html.includes('aria-label="セットアップを中断（確認あり）"'), "右上×がない");
  // ステップバー: 7ステップのラベル
  for (const label of ["ようこそ", "保存先", "OCRエンジン", "GPU", "Python環境", "バックアップ", ">完了<"]) {
    assert.ok(html.includes(label), `ステップバーに「${label}」がない`);
  }
  assert.ok(html.includes('aria-label="ステップ 1 / 7"'));
});

test("Step2 保存先: デフォルト保存先・Browse・書き込み確認・変更方法の案内", () => {
  const html = render(1);
  assert.ok(html.includes("プロジェクト保存先"));
  assert.ok(html.includes("デフォルト保存先"));
  assert.ok(html.includes("Browse..."));
  assert.ok(html.includes("書き込み確認"));
  assert.ok(html.includes("paths.data_projects"));
});

test("Step3 OCRエンジン: Tesseract/PaddleOCRの確認と続行可能の説明", () => {
  const html = render(2);
  assert.ok(html.includes("OCRエンジンの確認"));
  assert.ok(html.includes("Tesseract"));
  assert.ok(html.includes("PaddleOCR"));
  assert.ok(html.includes("未インストールでもセットアップは続行できます"));
});

test("Step4 GPU: GPU名・CUDA利用可否・CPU実行可を表示", () => {
  const html = render(3);
  assert.ok(html.includes("GPUの確認"));
  assert.ok(html.includes("GPU名:"));
  assert.ok(html.includes("CUDA利用可否:"));
  assert.ok(html.includes("CPUでも実行できます"));
});

test("Step5 Python環境: Backend・設定・ライブラリの確認", () => {
  const html = render(4);
  assert.ok(html.includes("Python環境の確認"));
  assert.ok(html.includes("Python / Backend"));
  assert.ok(html.includes("settings.yaml"));
  assert.ok(html.includes("必要ライブラリ"));
});

test("Step6 バックアップ: 保存先と推奨頻度（metadata毎日/full毎週）", () => {
  const html = render(5);
  assert.ok(html.includes("バックアップの推奨設定"));
  assert.ok(html.includes("data/backups/"));
  assert.ok(html.includes("metadata（設定・記録のみ）: 毎日"));
  assert.ok(html.includes("full（プロジェクト全体）: 毎週"));
});

test("Step7 完了: ショートカット3つ＋完了ボタン", () => {
  const html = render(6);
  assert.ok(html.includes("セットアップ完了"));
  assert.ok(html.includes("新規プロジェクト"));
  assert.ok(html.includes("プロジェクトを開く"));
  assert.ok(html.includes("サンプルを見る"));
  assert.ok(html.includes(">完了<"));
  assert.ok(!html.includes(">次へ<"), "最終ステップに次へが残っている");
});
