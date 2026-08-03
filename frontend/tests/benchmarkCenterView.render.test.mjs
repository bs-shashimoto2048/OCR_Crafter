// Benchmark Center画面（BenchmarkCenterView）のレンダリングテスト。
// 一覧テーブル・フィルタ・Benchmark履歴カードを検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let BenchmarkCenterView;
let engineDisplayText;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: BenchmarkCenterView, engineDisplayText } = await server.ssrLoadModule("/src/views/BenchmarkCenterView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function render(props = {}) {
  const html = renderToString(
    React.createElement(BenchmarkCenterView, {
      projectId: "p1",
      onOpenEvaluation: noop,
      notify: noop,
      ...props,
    })
  );
  return html.replaceAll("<!-- -->", "");
}

test("初期表示: タイトル・フィルタ・一覧列見出し・Benchmark履歴カードを表示する", () => {
  const html = render();
  assert.ok(html.includes("Benchmark Center"));
  assert.ok(html.includes("評価は実行しません"), "評価を実行しない旨の説明がない");
  assert.ok(html.includes("Dataset: すべて") && html.includes("Engine: すべて"), "フィルタがない");
  assert.ok(html.includes("前処理Version: すべて") && html.includes("Experiment: すべて"));
  for (const label of ["モデル", "Engine", "Dataset", "Experiment", "前処理", "サイズ", "Accuracy", "CER"]) {
    assert.ok(html.includes(label), `列見出し「${label}」がない`);
  }
  assert.ok(html.includes("Benchmark履歴"));
  assert.ok(html.includes("Benchmark履歴がありません"));
});

test("モデルが0件の場合は案内メッセージを表示する", () => {
  const html = render();
  assert.ok(html.includes("比較可能なモデルがありません"));
});

// ---------------------------------------------------------------------------
// Engine Label Migration（Refactor #57: BenchmarkCenterViewのEngine表示をRegistryへ移行）
//
// `rows`（モデル一覧）はコンポーネント内部のuseEffect経由でrequest()により非同期取得される
// stateであり、SSRのrenderToString()ではuseEffectが実行されないため、行が入った状態の
// テーブル・フィルタ選択肢をこのレンダリングテスト経由で検証することはできない
// （既存テスト2件が0件状態のみを検証しているのも同じ理由）。そのため、Engine表示の
// 変換ロジック（engineDisplayText、本Featureでテスト用にexport追加）自体を直接呼び出して
// 検証する。フィルタのvalue（row.engine自体）はソースコード上unchangedであることを
// diffで確認済み（filters.engine・engineOptions.map(e => <option value={e}>)はいずれも
// 生のengine idのまま、表示テキストのみengineDisplayText()経由に変更）。
// ---------------------------------------------------------------------------

test("engineDisplayText: 既知Engine（Tesseract/PaddleOCR/EasyOCR/TrOCR/Custom）はRegistryの表示名を返す", () => {
  assert.equal(engineDisplayText("tesseract"), "Tesseract");
  assert.equal(engineDisplayText("paddleocr"), "PaddleOCR");
  assert.equal(engineDisplayText("easyocr"), "EasyOCR");
  assert.equal(engineDisplayText("trocr"), "TrOCR");
  assert.equal(engineDisplayText("custom"), "カスタム");
});

test("engineDisplayText: 未登録Engineは既知Engineへフォールバックせず「不明」を返す", () => {
  assert.equal(engineDisplayText("unknown-engine"), "不明");
  assert.equal(engineDisplayText("parseq"), "不明");
});

test("engineDisplayText: null/undefined/空文字/前後空白も安全に「不明」を返す（既知Engineへ変換しない）", () => {
  for (const value of [null, undefined, "", "   "]) {
    assert.equal(engineDisplayText(value), "不明", `value=${String(value)}`);
  }
});

test("Regression: 既存の初期表示（フィルタ・列見出し・0件案内）は無修正のまま維持される", () => {
  const html = render();
  assert.ok(html.includes("Dataset: すべて") && html.includes("Engine: すべて"), "フィルタの既定表示が変わっている");
  for (const label of ["モデル", "Engine", "Dataset", "Experiment", "前処理", "サイズ", "Accuracy", "CER"]) {
    assert.ok(html.includes(label), `列見出し「${label}」がない`);
  }
  assert.ok(html.includes("比較可能なモデルがありません"));
});
