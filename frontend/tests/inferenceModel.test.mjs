// 推論使用モデル切替不具合修正（lib/inferenceModel.js）のテスト。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSwitchConfirmMessage,
  resolveInferenceEngine,
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
