// Benchmark画面（BenchmarkView）のレンダリングテスト。
// 実行フォーム（未導入エンジンの明示）・履歴一覧・Leaderboard・用途別ベスト・CSVリンクを検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let BenchmarkView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: BenchmarkView } = await server.ssrLoadModule("/src/views/BenchmarkView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

const ENGINES = [
  { key: "tesseract_model", label: "Tesseract（登録モデル）", implemented: true, available: true, availability_note: "", description: "登録モデル" },
  { key: "tesseract_base", label: "Tesseract標準（eng）", implemented: true, available: true, availability_note: "", description: "ベースライン" },
  { key: "paddleocr_official", label: "PaddleOCR公式", implemented: true, available: false, availability_note: "PaddleOCRが未インストールです", description: "公式モデル" },
  { key: "paddleocr_custom", label: "PaddleOCR（自作モデル）", implemented: true, available: true, availability_note: "推論用エクスポート済みの自作モデルが必要です", description: "自作モデル" },
  { key: "easyocr", label: "EasyOCR", implemented: false, available: false, availability_note: "未導入・利用不可", description: "未導入・利用不可" },
];

const ITEMS = [
  {
    benchmark_id: "BM-0002",
    name: "本番想定",
    created_at: "2026-07-23T11:00:00",
    profile: { profile_hash: "sha256:abcdef1234567890" },
    results: [
      { engine_key: "tesseract_model:m1", label: "m1.tess.json（学習後）", rank: 1, cer: 0.02, exact_match_rate: 0.9, failed: 0, mean_time_ms: 120 },
      { engine_key: "tesseract_base:", label: "eng.traineddata（学習前）", rank: 2, cer: 0.31, exact_match_rate: 0.4, failed: 1, mean_time_ms: 110 },
    ],
  },
];

function render(props = {}) {
  const html = renderToString(
    React.createElement(BenchmarkView, {
      projectId: "p1",
      items: ITEMS,
      balanceWeights: { accuracy: 0.7, speed: 0.2, stability: 0.1 },
      engines: ENGINES,
      ocrModels: [{ name: "m1.tess.json" }],
      onRefresh: noop,
      onRun: noop,
      onUpdateWeights: noop,
      onOpenJobs: noop,
      ...props,
    })
  );
  return html.replaceAll("<!-- -->", "");
}

test("実行フォーム: 対象エンジン一覧と未導入エンジンの「未導入・利用不可」明示", () => {
  const html = render();
  assert.ok(html.includes("Tesseract（登録モデル）"));
  assert.ok(html.includes("Tesseract標準（eng）"));
  assert.ok(html.includes("PaddleOCR公式"));
  assert.ok(html.includes("EasyOCR"));
  assert.ok(html.includes("未導入・利用不可"), "未実装エンジンの明示がない");
  assert.ok(html.includes("PaddleOCRが未インストールです"), "環境未導入の理由表示がない");
  assert.ok(html.includes("Benchmarkを実行（Job作成）"));
  assert.ok(html.includes("ウォームアップ回数"));
});

test("前処理選択と自作モデルAdapterの表示", () => {
  const html = render();
  assert.ok(html.includes("前処理（全エンジン共通）"), "前処理セクションがない");
  assert.ok(html.includes("なし（元画像のまま）"));
  assert.ok(html.includes("手動設定（グレースケール・二値化）"));
  assert.ok(html.includes("学習時前処理（モデルの記録）"));
  assert.ok(html.includes("プロジェクトの現在の前処理"));
  assert.ok(html.includes("PaddleOCR（自作モデル）"), "自作モデルエンジンがない");
  assert.ok(html.includes("推論用エクスポート済みの自作モデルが必要です"));
});

test("履歴一覧: BM ID・1位エンジン・Profile Hash短縮表示", () => {
  const html = render();
  assert.ok(html.includes("BM-0002"));
  assert.ok(html.includes("本番想定"));
  assert.ok(html.includes("CER 2.00%"), "1位のCER表示がない");
  assert.ok(html.includes("abcdef12"), "Profile Hash短縮表示がない");
  assert.ok(html.includes("Benchmark履歴（1件）"));
});

test("空状態: 履歴なしメッセージ", () => {
  const html = render({ items: [] });
  assert.ok(html.includes("Benchmark履歴がありません"));
});
