// InferenceView（推論テスト画面）のTrOCR選択UI追加テスト（Issue #23）。
// viteのssrLoadModuleで実際にレンダリングし、Engine選択肢・条件表示・
// 必須検証（実行ボタンの無効化）・結果表示を検証する。
import assert from "node:assert/strict";
import { before, after, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let InferenceView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: InferenceView } = await server.ssrLoadModule("/src/views/InferenceView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function baseProps(overrides = {}) {
  return {
    engine: "custom",
    setEngine: noop,
    easyocrLangs: ["en"],
    setEasyocrLangs: noop,
    easyocrLanguageOptions: ["en"],
    includeLowercase: true,
    setIncludeLowercase: noop,
    modelType: "square",
    setModelType: noop,
    modelTypes: ["square"],
    model: "latest",
    setModel: noop,
    models: [],
    paddleModel: "latest",
    setPaddleModel: noop,
    paddleModels: [],
    tesseractModel: "latest",
    setTesseractModel: noop,
    tesseractModels: [],
    trocrModelRef: "",
    setTrocrModelRef: noop,
    latestModels: { any: "", byType: {} },
    onFileChange: noop,
    fileName: "",
    previewUrl: "",
    rotation: 0,
    onRotate: noop,
    onRun: noop,
    loading: false,
    result: null,
    ...overrides,
  };
}

// React SSRは隣接するテキスト式の境界に<!-- -->を挿む（例: "現在: <!-- -->0<!-- -->°"）。
// 文言の完全一致チェックの邪魔になるため、比較前に取り除く
function stripSsrComments(html) {
  return html.replace(/<!--\s*-->/g, "");
}

// 「推論実行」ボタン要素（開始タグ+内包テキストのみ）を抽出する（90°回転ボタン等と区別するため）
function extractRunButton(html) {
  const matches = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)];
  const found = matches.find(([, , text]) => text.includes("推論実行") || text.includes("推論中"));
  return found ? `<button${found[1]}>` : null;
}

test("Engine選択肢にTrOCRが表示される（内部値trocr・表示ラベルTrOCR）", () => {
  const html = renderToString(React.createElement(InferenceView, baseProps()));
  assert.match(html, /<option value="trocr"[^>]*>TrOCR<\/option>/);
});

test("既存3Engineの選択肢が残る", () => {
  const html = renderToString(React.createElement(InferenceView, baseProps()));
  assert.match(html, /<option value="custom"[^>]*>カスタムモデル<\/option>/);
  assert.match(html, /<option value="easyocr"[^>]*>EasyOCR<\/option>/);
  assert.match(html, /<option value="paddleocr"[^>]*>PaddleOCR<\/option>/);
  assert.match(html, /<option value="tesseract"[^>]*>Tesseract<\/option>/);
});

test("TrOCR選択時にモデル参照入力欄が表示される", () => {
  const html = renderToString(React.createElement(InferenceView, baseProps({ engine: "trocr" })));
  assert.ok(html.includes("TrOCRモデル参照"));
  assert.ok(html.includes("Hugging Face model IDまたはローカルモデルパスを指定してください"));
  assert.ok(html.includes("Backendがモデルを取得する可能性があります"));
});

test("PaddleOCR選択時にはTrOCRモデル参照入力欄は表示されない", () => {
  const html = renderToString(React.createElement(InferenceView, baseProps({ engine: "paddleocr" })));
  assert.ok(!html.includes("TrOCRモデル参照"));
  assert.ok(html.includes("PaddleOCRモデル"));
});

test("EasyOCR選択時にはTrOCRモデル参照入力欄は表示されない", () => {
  const html = renderToString(React.createElement(InferenceView, baseProps({ engine: "easyocr" })));
  assert.ok(!html.includes("TrOCRモデル参照"));
});

test("Tesseract選択時にはTrOCRモデル参照入力欄は表示されない", () => {
  const html = renderToString(React.createElement(InferenceView, baseProps({ engine: "tesseract" })));
  assert.ok(!html.includes("TrOCRモデル参照"));
  assert.ok(html.includes("Tesseractモデル"));
});

test("カスタムモデル選択時にはTrOCRモデル参照入力欄は表示されない", () => {
  const html = renderToString(React.createElement(InferenceView, baseProps({ engine: "custom" })));
  assert.ok(!html.includes("TrOCRモデル参照"));
});

test("model_ref未入力でTrOCR選択時は実行ボタンが無効化される", () => {
  const html = renderToString(
    React.createElement(InferenceView, baseProps({ engine: "trocr", trocrModelRef: "", fileName: "img.png" }))
  );
  const button = extractRunButton(html);
  assert.ok(button, "推論実行ボタンが見つからない");
  assert.match(button, /disabled=""/);
});

test("空白のみのmodel_refでもTrOCR選択時は実行ボタンが無効化される", () => {
  const html = renderToString(
    React.createElement(InferenceView, baseProps({ engine: "trocr", trocrModelRef: "   ", fileName: "img.png" }))
  );
  const button = extractRunButton(html);
  assert.match(button, /disabled=""/);
});

test("model_ref入力済みでTrOCR選択・画像選択済みなら実行ボタンは有効", () => {
  const html = renderToString(
    React.createElement(
      InferenceView,
      baseProps({ engine: "trocr", trocrModelRef: "microsoft/trocr-base-printed", fileName: "img.png" })
    )
  );
  const button = extractRunButton(html);
  // ボタンのclassNameには常にTailwindの"disabled:opacity-50"等が含まれるため、
  // 実際のdisabled属性（disabled=""）の有無で判定する
  assert.ok(!/\sdisabled=""/.test(button));
});

test("TrOCR選択時に未入力なら「実際に使用される推論先」は未入力と表示する（既定モデルをハードコードしない）", () => {
  const html = renderToString(React.createElement(InferenceView, baseProps({ engine: "trocr", trocrModelRef: "" })));
  assert.ok(html.includes("未入力"));
});

test("TrOCR選択時に入力済みなら「実際に使用される推論先」へ前後空白除去済みの値を表示する", () => {
  const html = renderToString(
    React.createElement(InferenceView, baseProps({ engine: "trocr", trocrModelRef: "  microsoft/trocr-base-printed  " }))
  );
  assert.ok(html.includes(">microsoft/trocr-base-printed<") || html.includes("microsoft/trocr-base-printed"));
});

test("結果表示: confidence=null・char_scores=[]でもクラッシュせず既存表示のまま", () => {
  const result = {
    text: "ABC123",
    prediction: "ABC123",
    confidence: null,
    engine: "trocr",
    model_name: "microsoft/trocr-base-printed",
    model_type: "trocr",
    char_scores: [],
    char_confidence_normalized: [],
  };
  const html = stripSsrComments(renderToString(React.createElement(InferenceView, baseProps({ engine: "trocr", result }))));
  assert.ok(html.includes("ABC123"));
  assert.ok(html.includes("--")); // confidence未取得時の既存表示
  assert.ok(html.includes("エンジン: TrOCR"));
  assert.ok(!html.includes("undefined"));
});

test("結果表示: confidenceを0や100として捏造しない", () => {
  const result = { text: "X", prediction: "X", confidence: null, engine: "trocr" };
  const html = renderToString(React.createElement(InferenceView, baseProps({ engine: "trocr", result })));
  assert.ok(!html.includes("信頼度 0.0%"));
  assert.ok(!html.includes("信頼度 100.0%"));
});
