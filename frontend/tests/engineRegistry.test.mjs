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
  getEngineSnapshotType,
  getEngineSupportedDevices,
  getEngineTrainingPanel,
  getTrainingSelectableEngines,
  isEngineDeviceSupported,
  isEngineTrainingSelectable,
  isEngineTrainingSupported,
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

// ---------------------------------------------------------------------------
// TrainingView Migration（Feature #53）向けに追加したフィールド・公開API
// ---------------------------------------------------------------------------

// ---------- 学習可否（trainingSupported） ----------

test("isEngineTrainingSupported: PaddleOCR/Tesseract/TrOCRはtrue、EasyOCRはfalse", () => {
  assert.equal(isEngineTrainingSupported("paddleocr"), true);
  assert.equal(isEngineTrainingSupported("tesseract"), true);
  assert.equal(isEngineTrainingSupported("easyocr"), false);
  assert.equal(isEngineTrainingSupported("trocr"), true);
});

test("isEngineTrainingSupported: custom・未登録・null/undefined/空文字はfalse（学習可能と誤認させない）", () => {
  for (const value of ["custom", "unknown-engine", null, undefined, "", "   "]) {
    assert.equal(isEngineTrainingSupported(value), false, `value=${String(value)}`);
  }
});

// ---------- 選択肢（trainingSelectable / getTrainingSelectableEngines） ----------

test("isEngineTrainingSelectable: PaddleOCR/Tesseract/EasyOCR/TrOCRはtrue、customはfalse", () => {
  assert.equal(isEngineTrainingSelectable("paddleocr"), true);
  assert.equal(isEngineTrainingSelectable("tesseract"), true);
  assert.equal(isEngineTrainingSelectable("easyocr"), true);
  assert.equal(isEngineTrainingSelectable("trocr"), true);
  assert.equal(isEngineTrainingSelectable("custom"), false);
});

test("getTrainingSelectableEngines: 既存UIと同じ順序・内容（PaddleOCR→Tesseract→EasyOCR→TrOCR）でcustomを含まない", () => {
  const engines = getTrainingSelectableEngines();
  assert.deepEqual(engines, [
    { id: "paddleocr", label: "PaddleOCR" },
    { id: "tesseract", label: "Tesseract" },
    { id: "easyocr", label: "EasyOCR" },
    { id: "trocr", label: "TrOCR" },
  ]);
});

// ---------- デバイス対応可否 ----------

test("getEngineSupportedDevices: エンジンごとの対応デバイス", () => {
  assert.deepEqual(getEngineSupportedDevices("tesseract"), ["cpu"]);
  assert.deepEqual(getEngineSupportedDevices("paddleocr"), ["cpu", "gpu"]);
  assert.deepEqual(getEngineSupportedDevices("easyocr"), []);
});

test("getEngineSupportedDevices: 未登録engineは空配列", () => {
  assert.deepEqual(getEngineSupportedDevices("unknown-engine"), []);
});

test("isEngineDeviceSupported: Tesseractはcpuのみ、PaddleOCRはcpu/gpu両方、EasyOCRはどちらも非対応", () => {
  assert.equal(isEngineDeviceSupported("tesseract", "cpu"), true);
  assert.equal(isEngineDeviceSupported("tesseract", "gpu"), false);
  assert.equal(isEngineDeviceSupported("paddleocr", "cpu"), true);
  assert.equal(isEngineDeviceSupported("paddleocr", "gpu"), true);
  assert.equal(isEngineDeviceSupported("easyocr", "cpu"), false);
  assert.equal(isEngineDeviceSupported("easyocr", "gpu"), false);
});

test("isEngineDeviceSupported: 未登録engineは全デバイスfalse（全対応扱いにならない）", () => {
  assert.equal(isEngineDeviceSupported("unknown-engine", "cpu"), false);
  assert.equal(isEngineDeviceSupported("unknown-engine", "gpu"), false);
  assert.equal(isEngineDeviceSupported(null, "cpu"), false);
});

// ---------------------------------------------------------------------------
// Registry内部状態の不変性（PR #54レビューMajor #1対応）
// 呼び出し側が戻り値を変更しても、Registry内部状態・以降の呼び出し結果へ影響しないことを確認する。
// ---------------------------------------------------------------------------

test("getTrainingSelectableEngines: 戻り値を変更しても次回呼び出し結果へ影響しない（順序・内容も維持）", () => {
  const first = getTrainingSelectableEngines();
  first.push({ id: "fake", label: "Fake" });
  first[0].label = "HACKED";

  const second = getTrainingSelectableEngines();
  assert.equal(second.length, 4, "2回目の呼び出し結果の件数が変化している");
  assert.deepEqual(second, [
    { id: "paddleocr", label: "PaddleOCR" },
    { id: "tesseract", label: "Tesseract" },
    { id: "easyocr", label: "EasyOCR" },
    { id: "trocr", label: "TrOCR" },
  ]);
});

test("getEngineSupportedDevices: 戻り値を変更してもRegistry内部・以降の呼び出しへ影響しない", () => {
  const first = getEngineSupportedDevices("paddleocr");
  first.push("unexpected");

  const second = getEngineSupportedDevices("paddleocr");
  assert.deepEqual(second, ["cpu", "gpu"]);
  assert.ok(!second.includes("unexpected"), "unexpectedがRegistry内部へ混入している");
});

test("getEngineSupportedDevices: あるEngineの戻り値変更が他Engineへ波及しない（cross-engine isolation）", () => {
  const paddle = getEngineSupportedDevices("paddleocr");
  paddle.push("unexpected");
  paddle.length = 0; // さらに配列自体を空にする破壊的操作も試す

  assert.deepEqual(getEngineSupportedDevices("tesseract"), ["cpu"]);
  assert.deepEqual(getEngineSupportedDevices("easyocr"), []);
  assert.deepEqual(getEngineSupportedDevices("paddleocr"), ["cpu", "gpu"], "PaddleOCR自身への再取得も影響を受けない");
});

test("getEngineSupportedDevices: 未登録Engineの空配列を変更しても、その後の呼び出し結果は空のまま", () => {
  const first = getEngineSupportedDevices("unknown-engine");
  first.push("unexpected");

  const second = getEngineSupportedDevices("unknown-engine");
  assert.deepEqual(second, []);
});

test("getEngineEntry: 戻り値はfrozenであり、フィールドを変更しようとするとエラーになりRegistry内部状態は変化しない", () => {
  const entry = getEngineEntry("tesseract");
  assert.throws(() => {
    entry.trainingSupported = false;
  });
  assert.equal(isEngineTrainingSupported("tesseract"), true);
  assert.equal(getEngineLabel("tesseract"), "Tesseract");
});

test("getEngineEntry: supportedDevices配列もfrozenであり、push()はエラーになる", () => {
  const entry = getEngineEntry("paddleocr");
  assert.throws(() => {
    entry.supportedDevices.push("unexpected");
  });
  assert.deepEqual(getEngineSupportedDevices("paddleocr"), ["cpu", "gpu"]);
});

// ---------- 設定パネル種別 ----------

test("getEngineTrainingPanel: paddleocr/tesseract/trocrは専用パネル、easyocrはunsupported", () => {
  assert.equal(getEngineTrainingPanel("paddleocr"), "paddleocr");
  assert.equal(getEngineTrainingPanel("tesseract"), "tesseract");
  assert.equal(getEngineTrainingPanel("easyocr"), "unsupported");
  assert.equal(getEngineTrainingPanel("trocr"), "trocr");
});

test("getEngineTrainingPanel: 未登録engineはnull（呼び出し側でPaddleOCRへフォールバックしないこと）", () => {
  assert.equal(getEngineTrainingPanel("unknown-engine"), null);
  assert.equal(getEngineTrainingPanel(null), null);
  assert.equal(getEngineTrainingPanel(""), null);
});

// ---------- ジョブスナップショット種別 ----------

test("getEngineSnapshotType: tesseractのみtesseract、それ以外（paddleocr/easyocr/trocr）はgeneric", () => {
  assert.equal(getEngineSnapshotType("tesseract"), "tesseract");
  assert.equal(getEngineSnapshotType("paddleocr"), "generic");
  assert.equal(getEngineSnapshotType("easyocr"), "generic");
  assert.equal(getEngineSnapshotType("trocr"), "generic");
});

test("getEngineSnapshotType: 未登録engineはnull（tesseract扱いにもgeneric扱いにも決め打ちしない）", () => {
  assert.equal(getEngineSnapshotType("unknown-engine"), null);
  assert.equal(getEngineSnapshotType(undefined), null);
});

// ---------- Regression: 既存のengineResolution.js等（本Featureでは変更しない）に影響しないこと ----------

test("Regression: engineResolution.jsの正規化ロジックは無変更のまま参照可能", async () => {
  const { normalizeEngineId, engineDisplayLabel } = await import("../src/lib/engineResolution.js");
  assert.equal(normalizeEngineId("paddleocr"), "paddleocr");
  assert.equal(normalizeEngineId("custom"), "unknown"); // customを扱わない既存方針は維持される
  assert.equal(engineDisplayLabel("trocr"), "TrOCR");
});
