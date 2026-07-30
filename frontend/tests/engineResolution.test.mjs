// Frontend Engine判定の共通正規化ロジック（lib/engineResolution.js）のテスト。
// Issue #12: 未知Engineを暗黙にPaddleOCRとみなさない。
import assert from "node:assert/strict";
import { test } from "node:test";

import { engineDisplayLabel, normalizeEngineId } from "../src/lib/engineResolution.js";

// ---------- normalizeEngineId ----------

test("normalizeEngineId: 既知4Engineは正規IDを返す（小文字・完全一致）", () => {
  assert.equal(normalizeEngineId("paddleocr"), "paddleocr");
  assert.equal(normalizeEngineId("easyocr"), "easyocr");
  assert.equal(normalizeEngineId("tesseract"), "tesseract");
  assert.equal(normalizeEngineId("trocr"), "trocr");
});

test("normalizeEngineId: 大文字混在・前後空白を正規化する", () => {
  assert.equal(normalizeEngineId("PaddleOCR"), "paddleocr");
  assert.equal(normalizeEngineId(" paddleocr "), "paddleocr");
  assert.equal(normalizeEngineId("EasyOCR"), "easyocr");
  assert.equal(normalizeEngineId("Tesseract"), "tesseract");
  assert.equal(normalizeEngineId("TrOCR"), "trocr");
  assert.equal(normalizeEngineId("  TrOCR  "), "trocr");
  assert.equal(normalizeEngineId("TROCR"), "trocr");
});

test("normalizeEngineId: null/undefined/非文字列/空文字/空白のみはunknown", () => {
  assert.equal(normalizeEngineId(null), "unknown");
  assert.equal(normalizeEngineId(undefined), "unknown");
  assert.equal(normalizeEngineId(123), "unknown");
  assert.equal(normalizeEngineId({}), "unknown");
  assert.equal(normalizeEngineId([]), "unknown");
  assert.equal(normalizeEngineId(""), "unknown");
  assert.equal(normalizeEngineId("   "), "unknown");
});

test("normalizeEngineId: 未登録の値はunknown（PaddleOCRへフォールバックしない）", () => {
  assert.equal(normalizeEngineId("custom"), "unknown");
  assert.equal(normalizeEngineId("unknown-engine"), "unknown");
  assert.equal(normalizeEngineId("parseq"), "unknown");
  assert.equal(normalizeEngineId(".pt"), "unknown");
});

// ---------- engineDisplayLabel ----------

test("engineDisplayLabel: 既知4Engineの表示ラベル", () => {
  assert.equal(engineDisplayLabel("paddleocr"), "PaddleOCR");
  assert.equal(engineDisplayLabel("easyocr"), "EasyOCR");
  assert.equal(engineDisplayLabel("tesseract"), "Tesseract");
  assert.equal(engineDisplayLabel("trocr"), "TrOCR");
});

test("engineDisplayLabel: 未知・空値は不明（PaddleOCRを誤表示しない）", () => {
  assert.equal(engineDisplayLabel("unknown-engine"), "不明");
  assert.equal(engineDisplayLabel(""), "不明");
  assert.equal(engineDisplayLabel(null), "不明");
  assert.equal(engineDisplayLabel(undefined), "不明");
  assert.equal(engineDisplayLabel("custom"), "不明"); // customは呼び出し側で個別に扱う
});
