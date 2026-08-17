// OcrEvaluationView（モデル評価画面）のEvaluation UI Generalization（Issue #83）テスト。
// viteのssrLoadModuleで実際にレンダリングし、Engine選択肢・Engine別モデル/オプションUIの
// 条件表示・既存Tesseractフローの無回帰・TrOCR未解決時の実行ボタン無効化を検証する
// （InferenceView.jsxの既存テストパターンをEvaluation画面向けに揃える）。
import assert from "node:assert/strict";
import { before, after, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let OcrEvaluationView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: OcrEvaluationView } = await server.ssrLoadModule("/src/views/OcrEvaluationView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function baseProps(overrides = {}) {
  return {
    imageDir: "C:\\eval\\images",
    setImageDir: noop,
    onBrowseImageDir: noop,
    gtCsv: "C:\\eval\\gt.csv",
    setGtCsv: noop,
    onBrowseGtCsv: noop,
    includeBase: true,
    setIncludeBase: noop,
    trainedModel: "latest",
    setTrainedModel: noop,
    tesseractModels: [],
    whitelistMode: "default",
    setWhitelistMode: noop,
    whitelistCustom: "",
    setWhitelistCustom: noop,
    whitelistDefault: "ABC",
    engine: "tesseract",
    setEngine: noop,
    paddleModel: "latest",
    setPaddleModel: noop,
    paddleModels: [],
    paddleLanguage: "en",
    setPaddleLanguage: noop,
    paddleUseAngleCls: false,
    setPaddleUseAngleCls: noop,
    easyocrLangs: ["en"],
    setEasyocrLangs: noop,
    easyocrLanguageOptions: ["en", "ja"],
    trocrModelRef: "",
    setTrocrModelRef: noop,
    trocrModelSource: "manual",
    setTrocrModelSource: noop,
    trocrSelectedModel: "",
    setTrocrSelectedModel: noop,
    trocrModels: [],
    trocrDevice: "",
    setTrocrDevice: noop,
    trocrLocalFilesOnly: false,
    setTrocrLocalFilesOnly: noop,
    onRun: noop,
    loading: false,
    result: null,
    onExportCsv: noop,
    preprocessSource: "training",
    onChangePreprocessSource: noop,
    ...overrides,
  };
}

// 「評価を実行」ボタン要素（開始タグのみ）を抽出する
function extractRunButton(html) {
  const matches = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)];
  const found = matches.find(([, , text]) => text.includes("評価を実行") || text.includes("評価中"));
  return found ? `<button${found[1]}>` : null;
}

test("評価エンジンの選択肢に4Engine（Tesseract/PaddleOCR/EasyOCR/TrOCR）が表示される", () => {
  const html = renderToString(React.createElement(OcrEvaluationView, baseProps()));
  assert.match(html, /<option value="tesseract"[^>]*>Tesseract<\/option>/);
  assert.match(html, /<option value="paddleocr"[^>]*>PaddleOCR<\/option>/);
  assert.match(html, /<option value="easyocr"[^>]*>EasyOCR<\/option>/);
  assert.match(html, /<option value="trocr"[^>]*>TrOCR<\/option>/);
});

test("Tesseract選択時（既定）: 既存の学習前後比較・学習後モデル選択・whitelist設定が表示される（既存フロー無回帰）", () => {
  const html = renderToString(React.createElement(OcrEvaluationView, baseProps({ engine: "tesseract" })));
  assert.ok(html.includes("学習前モデル（eng.traineddata）を含めて比較する"));
  assert.ok(html.includes("学習後モデル"));
  assert.ok(html.includes("評価時 whitelist"));
  assert.ok(!html.includes("PaddleOCRモデル"));
  assert.ok(!html.includes("EasyOCR 言語"));
  assert.ok(!html.includes("TrOCRモデル指定方法"));
});

test("PaddleOCR選択時: モデル選択・言語・use_angle_clsが表示され、Tesseract固有UIは表示されない", () => {
  const html = renderToString(React.createElement(OcrEvaluationView, baseProps({ engine: "paddleocr" })));
  assert.ok(html.includes("PaddleOCRモデル"));
  assert.ok(html.includes("PaddleOCR 言語"));
  assert.ok(html.includes("角度分類器を使用する"));
  assert.ok(!html.includes("学習前モデル（eng.traineddata）を含めて比較する"));
  assert.ok(!html.includes("評価時 whitelist"));
});

test("EasyOCR選択時: 言語チェックボックスが表示され、whitelist/includeBaseは表示されない", () => {
  const html = renderToString(
    React.createElement(OcrEvaluationView, baseProps({ engine: "easyocr", easyocrLanguageOptions: ["en", "ja"] }))
  );
  assert.ok(html.includes("EasyOCR 言語"));
  assert.match(html, /<input type="checkbox" checked=""\/>en/);
  assert.match(html, /<input type="checkbox"\/>ja/);
  assert.ok(!html.includes("評価時 whitelist"));
  assert.ok(!html.includes("学習前モデル（eng.traineddata）を含めて比較する"));
});

test("TrOCR選択時: モデル指定方法（登録済み/手動入力）・推論デバイス・local_files_onlyが表示される", () => {
  const html = renderToString(React.createElement(OcrEvaluationView, baseProps({ engine: "trocr" })));
  assert.ok(html.includes("TrOCRモデル指定方法"));
  assert.ok(html.includes("TrOCRモデル参照"));
  assert.ok(html.includes("推論デバイス"));
  assert.ok(html.includes("ローカルファイルのみ使用する"));
  assert.ok(!html.includes("評価時 whitelist"));
});

test("TrOCR選択・model_ref未入力時は「評価を実行」ボタンが無効化される", () => {
  const html = renderToString(
    React.createElement(OcrEvaluationView, baseProps({ engine: "trocr", trocrModelRef: "" }))
  );
  const button = extractRunButton(html);
  assert.ok(button, "評価を実行ボタンが見つからない");
  assert.match(button, /disabled=""/);
});

test("TrOCR選択・model_ref入力済みなら「評価を実行」ボタンは有効", () => {
  const html = renderToString(
    React.createElement(
      OcrEvaluationView,
      baseProps({ engine: "trocr", trocrModelRef: "microsoft/trocr-base-printed" })
    )
  );
  const button = extractRunButton(html);
  assert.ok(!/\sdisabled=""/.test(button));
});

test("TrOCR登録済みモデル方式・未選択時はボタンが無効化される", () => {
  const trocrModels = [{ name: "a.trocr.json", label: "手書きTrOCR", modelRef: "/opt/models/trocr-a" }];
  const html = renderToString(
    React.createElement(
      OcrEvaluationView,
      baseProps({ engine: "trocr", trocrModelSource: "metadata", trocrModels, trocrSelectedModel: "" })
    )
  );
  const button = extractRunButton(html);
  assert.match(button, /disabled=""/);
});

test("評価前処理モード: Tesseract選択時は学習時前処理・Step5同期の選択肢が表示される", () => {
  const html = renderToString(React.createElement(OcrEvaluationView, baseProps({ engine: "tesseract" })));
  assert.match(html, /<option value="training"[^>]*>/);
  assert.match(html, /<option value="step5"[^>]*>/);
});

test("評価前処理モード: 非Tesseract選択時は学習時前処理・Step5同期の選択肢を表示しない（Backendが拒否するため）", () => {
  const html = renderToString(
    React.createElement(OcrEvaluationView, baseProps({ engine: "paddleocr", preprocessSource: "custom" }))
  );
  assert.ok(!/<option value="training"/.test(html));
  assert.ok(!/<option value="step5"/.test(html));
  assert.match(html, /<option value="custom"[^>]*>/);
  assert.match(html, /<option value="none"[^>]*>/);
});

test("結果表示: Multi-engine経路（preprocess_source無し・preprocess_modeあり）は「未記録（旧形式）」と誤表示しない", () => {
  const result = {
    targets: [{ label: "paddleocr:official", engine: "paddleocr", model: "official", is_base: false, total: 1, correct: 1 }],
    rows: [],
    count: 1,
    gt_count: 1,
    skipped_missing_image: 0,
    preprocess_mode: "none",
    comparison: null,
  };
  const html = renderToString(React.createElement(OcrEvaluationView, baseProps({ engine: "paddleocr", result })));
  assert.ok(!html.includes("未記録（旧形式の結果）"));
});
