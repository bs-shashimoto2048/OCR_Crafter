// Step5専用OCR前処理設定（lib/evalPreprocess.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EVAL_PREPROCESS,
  evalPreprocessRequestJson,
  evalPreprocessRequestObject,
  evalPreprocessSourceLabel,
  evalPreprocessSummary,
  normalizeEvalPreprocess,
} from "../src/lib/evalPreprocess.js";
import { flattenEvalHistory, historyPreprocessLabel } from "../src/lib/evalHistory.js";

test("normalizeEvalPreprocess: 欠損・不正値は既定値で補完（両設定OFF・大津・127）", () => {
  assert.deepEqual(normalizeEvalPreprocess(null), DEFAULT_EVAL_PREPROCESS);
  assert.deepEqual(normalizeEvalPreprocess({}), DEFAULT_EVAL_PREPROCESS);
  const fixed = normalizeEvalPreprocess({ binarizeMethod: "unknown", threshold: 999 });
  assert.equal(fixed.binarizeMethod, "otsu");
  assert.equal(fixed.threshold, 127);
  assert.equal(normalizeEvalPreprocess({ threshold: 0 }).threshold, 0);
  assert.equal(normalizeEvalPreprocess({ threshold: 255 }).threshold, 255);
});

test("evalPreprocessRequestJson: 両設定OFFは空文字（=API未指定で従来動作）", () => {
  assert.equal(evalPreprocessRequestJson(null), "");
  assert.equal(evalPreprocessRequestJson({ grayscale: false, binarize: false }), "");
});

test("evalPreprocessRequestObject: OFF=null / ON=スネークケースのオブジェクト（評価payload用）", () => {
  assert.equal(evalPreprocessRequestObject({ grayscale: false, binarize: false }), null);
  const obj = evalPreprocessRequestObject({ grayscale: true, binarize: true, binarizeMethod: "otsu" });
  assert.deepEqual(obj, { grayscale: true, binarize: true, binarize_method: "otsu", threshold: 127 });
});

test("evalPreprocessSummary: snake_case/camelCaseの両形式を受け付ける", () => {
  assert.equal(evalPreprocessSummary(null), "前処理なし");
  assert.equal(evalPreprocessSummary({ grayscale: true }), "Gray");
  assert.equal(evalPreprocessSummary({ binarize: true, binarizeMethod: "otsu" }), "Otsu");
  assert.equal(evalPreprocessSummary({ binarize: true, binarize_method: "fixed", threshold: 100 }), "固定100");
  assert.equal(
    evalPreprocessSummary({ grayscale: true, binarize: true, binarize_method: "otsu" }),
    "Gray/Otsu"
  );
});

test("evalPreprocessSourceLabel: 既知のsource＋未知は未記録", () => {
  assert.equal(evalPreprocessSourceLabel("none"), "前処理なし");
  assert.equal(evalPreprocessSourceLabel("step5"), "Step5同期");
  assert.equal(evalPreprocessSourceLabel("custom"), "カスタム");
  assert.equal(evalPreprocessSourceLabel(""), "未記録");
});

test("flattenEvalHistory: pre付きと旧形式（pre無し）が混在してもエラーにならない", () => {
  const history = {
    model_a: {
      ds1: { percent: 39.5, at: "2026-07-17T10:00:00.000Z", pre: { source: "step5", summary: "Gray/Otsu" } },
      ds2: { percent: 20.1, at: "2026-07-16T10:00:00.000Z" }, // 旧形式
    },
  };
  const rows = flattenEvalHistory(history);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset, "ds1"); // 新しい順
  assert.equal(historyPreprocessLabel(rows[0]), "Step5: Gray/Otsu");
  assert.equal(historyPreprocessLabel(rows[1]), "未記録"); // 旧形式は未記録表示
  assert.equal(historyPreprocessLabel({ preSource: "none", preSummary: "前処理なし" }), "なし");
});

test("evalPreprocessRequestJson: ON時はスネークケースのJSONを返す", () => {
  const parsed = JSON.parse(
    evalPreprocessRequestJson({ grayscale: true, binarize: true, binarizeMethod: "fixed", threshold: 100 })
  );
  assert.deepEqual(parsed, { grayscale: true, binarize: true, binarize_method: "fixed", threshold: 100 });
  const grayOnly = JSON.parse(evalPreprocessRequestJson({ grayscale: true }));
  assert.equal(grayOnly.grayscale, true);
  assert.equal(grayOnly.binarize, false);
});
