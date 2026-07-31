// EngineRegistry（frontend/src/config/engineRegistry.js）のテスト。
// Feature: Engine Registry Core（Epic #46, Feature #47のENGINE_REGISTRY_DESIGN.md 6章の
// データ構造案に基づく最小実装）。Registry本体・Label/表示名/Color/DownloadType取得のみを検証する。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ENGINE_ID_CUSTOM,
  ENGINE_ID_EASYOCR,
  ENGINE_ID_PADDLEOCR,
  ENGINE_ID_TESSERACT,
  ENGINE_ID_TROCR,
  getEngineColor,
  getEngineDisplayName,
  getEngineDownloadType,
  getEngineEntry,
  getEngineLabel,
  listEngineIds,
} from "../src/config/engineRegistry.js";

// ---------- listEngineIds ----------

test("listEngineIds: 5エントリ（tesseract/paddleocr/easyocr/trocr/custom）を返す", () => {
  const ids = listEngineIds();
  assert.equal(ids.length, 5);
  assert.deepEqual(
    [...ids].sort(),
    ["custom", "easyocr", "paddleocr", "tesseract", "trocr"]
  );
});

// ---------- getEngineEntry / 正規化 ----------

test("getEngineEntry: 既知5エンジンはRegistryエントリを返す", () => {
  for (const id of [ENGINE_ID_TESSERACT, ENGINE_ID_PADDLEOCR, ENGINE_ID_EASYOCR, ENGINE_ID_TROCR, ENGINE_ID_CUSTOM]) {
    const entry = getEngineEntry(id);
    assert.ok(entry, `${id} should resolve`);
    assert.equal(entry.id, id);
  }
});

test("getEngineEntry: 大文字混在・前後空白を正規化する", () => {
  assert.equal(getEngineEntry("PaddleOCR").id, "paddleocr");
  assert.equal(getEngineEntry(" tesseract ").id, "tesseract");
  assert.equal(getEngineEntry("TROCR").id, "trocr");
  assert.equal(getEngineEntry("Custom").id, "custom");
});

test("getEngineEntry: 未登録・null/undefined/非文字列・空文字はnull", () => {
  assert.equal(getEngineEntry("unknown-engine"), null);
  assert.equal(getEngineEntry("parseq"), null);
  assert.equal(getEngineEntry(null), null);
  assert.equal(getEngineEntry(undefined), null);
  assert.equal(getEngineEntry(123), null);
  assert.equal(getEngineEntry({}), null);
  assert.equal(getEngineEntry(""), null);
  assert.equal(getEngineEntry("   "), null);
});

// ---------- Label取得 / 表示名取得 ----------

test("getEngineLabel: 既知5エンジンのラベル", () => {
  assert.equal(getEngineLabel("tesseract"), "Tesseract");
  assert.equal(getEngineLabel("paddleocr"), "PaddleOCR");
  assert.equal(getEngineLabel("easyocr"), "EasyOCR");
  assert.equal(getEngineLabel("trocr"), "TrOCR");
  assert.equal(getEngineLabel("custom"), "カスタム");
});

test("getEngineLabel: 未登録はnull", () => {
  assert.equal(getEngineLabel("unknown-engine"), null);
  assert.equal(getEngineLabel(null), null);
});

test("getEngineDisplayName: 既知5エンジンの表示名", () => {
  assert.equal(getEngineDisplayName("tesseract"), "Tesseract");
  assert.equal(getEngineDisplayName("paddleocr"), "PaddleOCR");
  assert.equal(getEngineDisplayName("easyocr"), "EasyOCR");
  assert.equal(getEngineDisplayName("trocr"), "TrOCR");
  assert.equal(getEngineDisplayName("custom"), "カスタム（分類）");
});

test("getEngineDisplayName: 未登録はnull", () => {
  assert.equal(getEngineDisplayName("unknown-engine"), null);
});

// ---------- Color取得 ----------

test("getEngineColor: 既知5エンジンそれぞれ異なる色を持つ", () => {
  const colors = [ENGINE_ID_TESSERACT, ENGINE_ID_PADDLEOCR, ENGINE_ID_EASYOCR, ENGINE_ID_TROCR, ENGINE_ID_CUSTOM].map(
    getEngineColor
  );
  assert.ok(colors.every((c) => typeof c === "string" && c.length > 0));
  assert.equal(new Set(colors).size, colors.length, "colors should be distinct per engine");
});

test("getEngineColor: 未登録はnull", () => {
  assert.equal(getEngineColor("unknown-engine"), null);
});

// ---------- DownloadType取得 ----------

test("getEngineDownloadType: 既知5エンジンのダウンロード方式", () => {
  assert.equal(getEngineDownloadType("tesseract"), "single_file");
  assert.equal(getEngineDownloadType("paddleocr"), "zip");
  assert.equal(getEngineDownloadType("easyocr"), "none");
  assert.equal(getEngineDownloadType("trocr"), "directory_or_ref");
  assert.equal(getEngineDownloadType("custom"), "single_file");
});

test("getEngineDownloadType: 未登録はnull", () => {
  assert.equal(getEngineDownloadType("unknown-engine"), null);
});

// ---------- Regression: 既存のengineResolution.js等（本Featureでは変更しない）に影響しないこと ----------

test("Regression: engineResolution.jsの正規化ロジックは無変更のまま参照可能", async () => {
  const { normalizeEngineId, engineDisplayLabel } = await import("../src/lib/engineResolution.js");
  assert.equal(normalizeEngineId("paddleocr"), "paddleocr");
  assert.equal(normalizeEngineId("custom"), "unknown"); // customを扱わない既存方針は維持される
  assert.equal(engineDisplayLabel("trocr"), "TrOCR");
});
