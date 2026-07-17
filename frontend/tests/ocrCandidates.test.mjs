// OCR候補の純ロジック（lib/ocrCandidates.js）と配置保存（lib/labelAlign.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import { engineLabelOf, lowercaseLabelOf, predictSignature } from "../src/lib/ocrCandidates.js";
import {
  EVAL_ALIGN_STORAGE_KEY,
  LABELING_ALIGN_STORAGE_KEY,
  nextLabelTextAlign,
  readLabelTextAlign,
  writeLabelTextAlign,
} from "../src/lib/labelAlign.js";

test("engineLabelOf: エンジン表示名（未知はそのまま・空は--）", () => {
  assert.equal(engineLabelOf("tesseract"), "Tesseract");
  assert.equal(engineLabelOf("PADDLEOCR"), "PaddleOCR");
  assert.equal(engineLabelOf("easyocr"), "EasyOCR");
  assert.equal(engineLabelOf("custom"), "カスタムモデル");
  assert.equal(engineLabelOf("unknown"), "unknown");
  assert.equal(engineLabelOf(""), "--");
});

test("lowercaseLabelOf: EasyOCR/PaddleOCR×ラテン言語のみ小文字ON/OFFを表示", () => {
  assert.equal(lowercaseLabelOf({ engine: "easyocr", easyocr_langs: "en", include_lowercase: true }), "小文字: ON");
  assert.equal(lowercaseLabelOf({ engine: "paddleocr", easyocr_langs: "en", include_lowercase: false }), "小文字: OFF");
  assert.equal(lowercaseLabelOf({ engine: "tesseract", easyocr_langs: "en" }), "");
});

test("predictSignature: Engine+Model+Language+小文字設定の完全一致で重複判定", () => {
  const a = { engine: "tesseract", model: "latest", easyocr_langs: "en", include_lowercase: true };
  assert.equal(predictSignature(a), predictSignature({ ...a }));
  assert.notEqual(predictSignature(a), predictSignature({ ...a, model: "eng" }));
  assert.notEqual(predictSignature(a), predictSignature({ ...a, include_lowercase: false }));
});

test("predictSignature: PSM・whitelistも重複判定へ含める（未指定=空扱いで従来判定と互換）", () => {
  const a = { engine: "tesseract", model: "latest", easyocr_langs: "en", include_lowercase: true };
  // psm/whitelist未指定と空値は同一シグネチャ（既存ラベル編集の呼び出しと互換）
  assert.equal(predictSignature(a), predictSignature({ ...a, psm: 0, whitelist: "" }));
  assert.notEqual(predictSignature({ ...a, psm: 7 }), predictSignature({ ...a, psm: 6 }));
  assert.notEqual(predictSignature({ ...a, whitelist: "ABC" }), predictSignature({ ...a, whitelist: "" }));
});

test("labelAlign: 循環順とストレージキー分離（既存とStep5を混在させない）", () => {
  assert.equal(nextLabelTextAlign("center"), "left");
  assert.equal(nextLabelTextAlign("left"), "right");
  assert.equal(nextLabelTextAlign("right"), "center");
  assert.notEqual(LABELING_ALIGN_STORAGE_KEY, EVAL_ALIGN_STORAGE_KEY);

  // localStorageモックで読み書きの往復を確認
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  writeLabelTextAlign(EVAL_ALIGN_STORAGE_KEY, "p1", "left");
  assert.equal(readLabelTextAlign(EVAL_ALIGN_STORAGE_KEY, "p1"), "left");
  assert.equal(readLabelTextAlign(EVAL_ALIGN_STORAGE_KEY, "p2"), "center");
  assert.equal(readLabelTextAlign(LABELING_ALIGN_STORAGE_KEY, "p1"), "center"); // キー分離
  delete globalThis.localStorage;
});
