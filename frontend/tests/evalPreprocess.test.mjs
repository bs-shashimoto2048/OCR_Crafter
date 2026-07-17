// Step5専用OCR前処理設定（lib/evalPreprocess.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EVAL_PREPROCESS,
  evalPreprocessRequestJson,
  normalizeEvalPreprocess,
} from "../src/lib/evalPreprocess.js";

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

test("evalPreprocessRequestJson: ON時はスネークケースのJSONを返す", () => {
  const parsed = JSON.parse(
    evalPreprocessRequestJson({ grayscale: true, binarize: true, binarizeMethod: "fixed", threshold: 100 })
  );
  assert.deepEqual(parsed, { grayscale: true, binarize: true, binarize_method: "fixed", threshold: 100 });
  const grayOnly = JSON.parse(evalPreprocessRequestJson({ grayscale: true }));
  assert.equal(grayOnly.grayscale, true);
  assert.equal(grayOnly.binarize, false);
});
