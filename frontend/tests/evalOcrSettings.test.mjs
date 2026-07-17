// Step5専用OCR設定（lib/evalOcrSettings.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EVAL_OCR_SETTINGS,
  EVAL_OCR_ENGINES,
  evalOcrRequestFields,
  evalOcrSlotRequestFields,
  migrateEvalOcrSlots,
  normalizeEvalOcrSettings,
  normalizeEvalOcrSlot,
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

test("normalizeEvalOcrSlot: 欠損・不正値は既定値で補完（PSM範囲外は7へ）", () => {
  const s = normalizeEvalOcrSlot({ engine: "tesseract", psm: 99, whitelist: "  AB1 " });
  assert.equal(s.enabled, false);
  assert.equal(s.engine, "tesseract");
  assert.equal(s.psm, 7);
  assert.equal(s.whitelist, "AB1");
  assert.equal(normalizeEvalOcrSlot({ psm: 6 }).psm, 6);
});

test("migrateEvalOcrSlots: 保存なし+旧単一設定あり → モデル1へ移行（2/3は無効）", () => {
  const legacy = { engine: "tesseract", tesseractModel: "cursive_v3", includeLowercase: false };
  const slots = migrateEvalOcrSlots(null, legacy);
  assert.equal(slots.length, 3);
  assert.equal(slots[0].enabled, true);
  assert.equal(slots[0].engine, "tesseract");
  assert.equal(slots[0].tesseractModel, "cursive_v3");
  assert.equal(slots[1].enabled, false);
  assert.equal(slots[2].enabled, false);
});

test("migrateEvalOcrSlots: 保存なし+旧設定なし → モデル1のみ既定で有効", () => {
  const slots = migrateEvalOcrSlots(null, null);
  assert.equal(slots[0].enabled, true);
  assert.equal(slots[0].engine, "paddleocr");
  assert.equal(slots[1].enabled, false);
});

test("migrateEvalOcrSlots: 保存済みスロットはそのまま3枠へ正規化（旧設定は無視）", () => {
  const stored = [
    { enabled: false, engine: "easyocr" },
    { enabled: true, engine: "tesseract", psm: 6 },
  ];
  const slots = migrateEvalOcrSlots(stored, { engine: "paddleocr" });
  assert.equal(slots[0].enabled, false);
  assert.equal(slots[0].engine, "easyocr");
  assert.equal(slots[1].enabled, true);
  assert.equal(slots[1].psm, 6);
  assert.equal(slots[2].enabled, false); // 3枠目は既定で補完
});

test("evalOcrSlotRequestFields: エンジン非対応の設定は既定値へ正規化（実効設定で重複判定できる）", () => {
  const paddle = evalOcrSlotRequestFields({ engine: "paddleocr", psm: 6, whitelist: "AB" });
  assert.equal(paddle.psm, 0);
  assert.equal(paddle.whitelist, "");

  const tess = evalOcrSlotRequestFields({ engine: "tesseract", psm: 6, whitelist: "AB1", easyocrLangs: "ja" });
  assert.equal(tess.psm, 6);
  assert.equal(tess.whitelist, "AB1");
  assert.equal(tess.easyocr_langs, "en"); // Tesseractに言語欄なし
  assert.equal(tess.include_lowercase, true); // 小文字設定の対象外

  const easy = evalOcrSlotRequestFields({ engine: "easyocr", whitelist: "kt", easyocrLangs: "en" });
  assert.equal(easy.whitelist, "kt");
  assert.equal(easy.psm, 0);
});
