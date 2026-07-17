// Step5専用OCR設定（lib/evalOcrSettings.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EVAL_OCR_SETTINGS,
  EVAL_OCR_ENGINES,
  evalOcrRequestFields,
  normalizeEvalOcrSettings,
} from "../src/lib/evalOcrSettings.js";

test("normalizeEvalOcrSettings: 欠損・不正値は既定値で補完する", () => {
  assert.deepEqual(normalizeEvalOcrSettings(null), DEFAULT_EVAL_OCR_SETTINGS);
  assert.deepEqual(normalizeEvalOcrSettings({}), DEFAULT_EVAL_OCR_SETTINGS);
  const fixed = normalizeEvalOcrSettings({ engine: "unknown", easyocrLangs: "  ", paddleModel: "" });
  assert.equal(fixed.engine, "paddleocr");
  assert.equal(fixed.easyocrLangs, "en");
  assert.equal(fixed.paddleModel, "latest");
  assert.equal(fixed.includeLowercase, true);
});

test("normalizeEvalOcrSettings: 有効値は保持される", () => {
  const s = normalizeEvalOcrSettings({
    engine: "tesseract",
    tesseractModel: "cursive_v3",
    includeLowercase: false,
  });
  assert.equal(s.engine, "tesseract");
  assert.equal(s.tesseractModel, "cursive_v3");
  assert.equal(s.includeLowercase, false);
  assert.ok(EVAL_OCR_ENGINES.includes(s.engine));
});

test("evalOcrRequestFields: エンジンごとのmodel/言語の使い分け", () => {
  const paddle = evalOcrRequestFields({ engine: "paddleocr", paddleModel: "pd_v2", easyocrLangs: "en" });
  assert.deepEqual(paddle, { engine: "paddleocr", model: "pd_v2", easyocr_langs: "en", include_lowercase: true });

  const tess = evalOcrRequestFields({ engine: "tesseract", tesseractModel: "cursive_v3", easyocrLangs: "ja" });
  assert.equal(tess.model, "cursive_v3");
  assert.equal(tess.easyocr_langs, "en"); // Tesseractに言語欄は使わない（API既定と同じ）
  assert.equal(tess.include_lowercase, true); // 小文字制御の対象外エンジンは常にtrue（従来動作）

  const easy = evalOcrRequestFields({ engine: "easyocr", easyocrLangs: "en,fr", includeLowercase: false });
  assert.deepEqual(easy, { engine: "easyocr", model: "latest", easyocr_langs: "en,fr", include_lowercase: false });
});

test("evalOcrRequestFields: 非ラテン言語では小文字OFFを適用しない", () => {
  const easyJa = evalOcrRequestFields({ engine: "easyocr", easyocrLangs: "ja,en", includeLowercase: false });
  assert.equal(easyJa.include_lowercase, true);
});
