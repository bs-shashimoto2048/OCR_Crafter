// TrOCR Model Metadata連携（lib/trocrModelMetadata.js）のテスト（Issue #25）。
// 実Backend・実Model Metadataファイルは使用しない。modelInfos形状のフェイクデータのみ。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractTrocrModels,
  resolveSelectedTrocrModelRef,
  trocrMetadataValidationError,
} from "../src/lib/trocrModelMetadata.js";

const MODELS = ["a.trocr.json", "b.ocr.json", "c.tess.json", "d_classify.pt", "e_unknown.trocr.json"];

const MODEL_INFOS = {
  "a.trocr.json": { engine: "trocr", artifact_path: "/opt/models/trocr-a" },
  "b.ocr.json": { engine: "paddleocr" },
  "c.tess.json": { engine: "tesseract" },
  "d_classify.pt": { engine: "custom" },
  "e_unknown.trocr.json": { engine: "unknown-engine" },
};

// ---------- extractTrocrModels ----------

test("extractTrocrModels: engineが正規化してtrocrのものだけを抽出する", () => {
  const result = extractTrocrModels(MODELS, MODEL_INFOS, {});
  assert.deepEqual(
    result.map((m) => m.name),
    ["a.trocr.json"]
  );
});

test("extractTrocrModels: 他Engine（paddleocr/tesseract/custom）を含めない", () => {
  const result = extractTrocrModels(MODELS, MODEL_INFOS, {});
  const names = result.map((m) => m.name);
  assert.ok(!names.includes("b.ocr.json"));
  assert.ok(!names.includes("c.tess.json"));
  assert.ok(!names.includes("d_classify.pt"));
});

test("extractTrocrModels: ファイル名に'trocr'を含んでいてもengineが未知なら含めない（拡張子・ファイル名で判定しない）", () => {
  const result = extractTrocrModels(MODELS, MODEL_INFOS, {});
  assert.ok(!result.map((m) => m.name).includes("e_unknown.trocr.json"));
});

test("extractTrocrModels: エイリアスがあれば表示名として使う。無ければファイル名", () => {
  const result = extractTrocrModels(MODELS, MODEL_INFOS, { "a.trocr.json": "手書き文字TrOCR v1" });
  assert.equal(result[0].label, "手書き文字TrOCR v1");
});

test("extractTrocrModels: エイリアス未設定はファイル名がそのままlabel", () => {
  const result = extractTrocrModels(MODELS, MODEL_INFOS, {});
  assert.equal(result[0].label, "a.trocr.json");
});

test("extractTrocrModels: artifact_pathが解決済みmodel_refになる", () => {
  const result = extractTrocrModels(MODELS, MODEL_INFOS, {});
  assert.equal(result[0].modelRef, "/opt/models/trocr-a");
});

test("extractTrocrModels: artifact_pathが無いエントリはmodelRefが空文字（ファイル名で代用しない）", () => {
  const infos = { ...MODEL_INFOS, "f.trocr.json": { engine: "trocr" } };
  const result = extractTrocrModels([...MODELS, "f.trocr.json"], infos, {});
  const entry = result.find((m) => m.name === "f.trocr.json");
  assert.equal(entry.modelRef, "");
});

test("extractTrocrModels: 空配列・null/undefinedでもクラッシュしない", () => {
  assert.deepEqual(extractTrocrModels([], {}, {}), []);
  assert.deepEqual(extractTrocrModels(null, null, null), []);
  assert.deepEqual(extractTrocrModels(undefined, undefined, undefined), []);
});

// ---------- resolveSelectedTrocrModelRef ----------

test("resolveSelectedTrocrModelRef: 選択済みモデルのmodelRefを返す", () => {
  const list = extractTrocrModels(MODELS, MODEL_INFOS, {});
  assert.equal(resolveSelectedTrocrModelRef(list, "a.trocr.json"), "/opt/models/trocr-a");
});

test("resolveSelectedTrocrModelRef: 未選択・未存在は空文字", () => {
  const list = extractTrocrModels(MODELS, MODEL_INFOS, {});
  assert.equal(resolveSelectedTrocrModelRef(list, ""), "");
  assert.equal(resolveSelectedTrocrModelRef(list, null), "");
  assert.equal(resolveSelectedTrocrModelRef(list, "not_in_list.trocr.json"), "");
});

// ---------- trocrMetadataValidationError ----------

test("trocrMetadataValidationError: 未選択はエラー文言を返す", () => {
  const list = extractTrocrModels(MODELS, MODEL_INFOS, {});
  assert.equal(trocrMetadataValidationError(list, ""), "TrOCRモデルを選択してください。");
  assert.equal(trocrMetadataValidationError(list, null), "TrOCRモデルを選択してください。");
  assert.equal(trocrMetadataValidationError(list, "   "), "TrOCRモデルを選択してください。");
});

test("trocrMetadataValidationError: 存在しない・model_ref解決不能なモデルはエラー文言を返す", () => {
  const infos = { ...MODEL_INFOS, "f.trocr.json": { engine: "trocr" } };
  const list = extractTrocrModels([...MODELS, "f.trocr.json"], infos, {});
  assert.equal(trocrMetadataValidationError(list, "not_in_list.trocr.json"), "選択したTrOCRモデルを利用できません。");
  assert.equal(trocrMetadataValidationError(list, "f.trocr.json"), "選択したTrOCRモデルを利用できません。");
});

test("trocrMetadataValidationError: 有効な選択はnull", () => {
  const list = extractTrocrModels(MODELS, MODEL_INFOS, {});
  assert.equal(trocrMetadataValidationError(list, "a.trocr.json"), null);
});
