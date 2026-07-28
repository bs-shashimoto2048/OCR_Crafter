// 推論使用モデル切替不具合修正（lib/inferenceModel.js）のテスト。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSwitchConfirmMessage,
  resolveInferenceEngine,
  resolveRestoredInferenceSelection,
  shouldConfirmSwitch,
} from "../src/lib/inferenceModel.js";

test("resolveInferenceEngine: engine=tesseractのモデルはtesseract", () => {
  assert.equal(resolveInferenceEngine({ engine: "tesseract", training_family: "tesseract" }), "tesseract");
});

test("resolveInferenceEngine: training_family=ocr（PaddleOCR系）はpaddleocr", () => {
  assert.equal(resolveInferenceEngine({ engine: "paddleocr", training_family: "ocr" }), "paddleocr");
});

test("resolveInferenceEngine: それ以外（分類モデル等）はcustom", () => {
  assert.equal(resolveInferenceEngine({ engine: "custom", training_family: "classification" }), "custom");
  assert.equal(resolveInferenceEngine({}), "custom");
  assert.equal(resolveInferenceEngine(undefined), "custom");
});

test("shouldConfirmSwitch: 初回設定（現在値なし）は確認不要", () => {
  assert.equal(shouldConfirmSwitch("", "ModelA"), false);
  assert.equal(shouldConfirmSwitch(undefined, "ModelA"), false);
});

test("shouldConfirmSwitch: 同一モデルへの再設定は確認不要（実質変更なし）", () => {
  assert.equal(shouldConfirmSwitch("ModelA", "ModelA"), false);
});

test("shouldConfirmSwitch: 既存の別モデルからの切替は確認が必要", () => {
  assert.equal(shouldConfirmSwitch("ModelA", "ModelB"), true);
  assert.equal(shouldConfirmSwitch("ModelB", "ModelC"), true);
});

test("buildSwitchConfirmMessage: 要求仕様どおりの文言（現在→次モデル）", () => {
  const message = buildSwitchConfirmMessage("ModelA", "ModelB");
  assert.ok(message.includes("現在の推論使用モデル"));
  assert.ok(message.includes("ModelA"));
  assert.ok(message.includes("ModelB"));
  assert.ok(message.includes("へ変更します。"));
  assert.ok(message.includes("よろしいですか？"));
});

// ---------- resolveRestoredInferenceSelection（保存済み推論モデルの復元） ----------

const INFO_MAP = {
  "ModelA.tess.json": { engine: "tesseract", training_family: "tesseract" },
  "ModelB.ocr.json": { engine: "paddleocr", training_family: "ocr" },
  "ModelC_classify.pt": { engine: "custom", training_family: "classification" },
};

test("resolveRestoredInferenceSelection: 保存が無い場合はnull（何もしない）", () => {
  assert.equal(resolveRestoredInferenceSelection(null, INFO_MAP), null);
  assert.equal(resolveRestoredInferenceSelection({}, INFO_MAP), null);
  assert.equal(resolveRestoredInferenceSelection({ model: "" }, INFO_MAP), null);
});

test("resolveRestoredInferenceSelection: 保存済みTesseractモデルの復元が正常に完了する", () => {
  const resolved = resolveRestoredInferenceSelection(
    { engine: "tesseract", model: "ModelA.tess.json" },
    INFO_MAP
  );
  assert.deepEqual(resolved, { found: true, engine: "tesseract", model: "ModelA.tess.json" });
});

test("resolveRestoredInferenceSelection: 保存済みPaddleOCRモデルの復元が正常に完了する", () => {
  const resolved = resolveRestoredInferenceSelection(
    { engine: "paddleocr", model: "ModelB.ocr.json" },
    INFO_MAP
  );
  assert.deepEqual(resolved, { found: true, engine: "paddleocr", model: "ModelB.ocr.json" });
});

test("resolveRestoredInferenceSelection: engine未指定はcustomとして復元する（後方互換）", () => {
  const resolved = resolveRestoredInferenceSelection({ model: "ModelC_classify.pt" }, INFO_MAP);
  assert.deepEqual(resolved, { found: true, engine: "custom", model: "ModelC_classify.pt" });
});

test("resolveRestoredInferenceSelection: 保存済みモデルが現在の一覧に無い（削除・移動済み）場合はfound:falseで、勝手に置き換えない", () => {
  const resolved = resolveRestoredInferenceSelection({ engine: "tesseract", model: "Deleted.tess.json" }, INFO_MAP);
  assert.deepEqual(resolved, { found: false, model: "Deleted.tess.json" });
});
