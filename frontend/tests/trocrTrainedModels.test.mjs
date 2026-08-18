// TrOCR Training UIの「登録済みモデルから継続Fine-tune」用ロジック
// （lib/trocrTrainedModels.js）のテスト（Issue #98）。
// 実Backend・実`.trocr.json`ファイルは使用しない。GET /api/trocr/models応答形状の
// フェイクデータのみ（Issue #96 list_trocr_models()の戻り値と同じ形）。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mapTrocrTrainedModels,
  resolveTrocrTrainedModelRef,
  trocrTrainedModelValidationError,
} from "../src/lib/trocrTrainedModels.js";

const ITEMS = [
  {
    name: "trocr_job-1.trocr.json",
    engine: "trocr",
    model_dir: "/data/projects/p1/models/trocr_job-1",
    base_model_ref: "microsoft/trocr-base-printed",
    job_id: "job-1",
  },
  {
    name: "trocr_job-2.trocr.json",
    engine: "trocr",
    model_dir: "",
    base_model_ref: "microsoft/trocr-base-printed",
    job_id: "job-2",
  },
];

// ---------- mapTrocrTrainedModels ----------

test("mapTrocrTrainedModels: name/modelRefが揃ったitemだけをselect用配列へ変換する", () => {
  const result = mapTrocrTrainedModels(ITEMS);
  assert.deepEqual(
    result.map((m) => m.name),
    ["trocr_job-1.trocr.json"]
  );
});

test("mapTrocrTrainedModels: model_dirが空のitemは除外する（modelRef不在をファイル名で代用しない）", () => {
  const result = mapTrocrTrainedModels(ITEMS);
  assert.ok(!result.some((m) => m.name === "trocr_job-2.trocr.json"));
});

test("mapTrocrTrainedModels: modelRefはmodel_dirがそのまま入る", () => {
  const result = mapTrocrTrainedModels(ITEMS);
  assert.equal(result[0].modelRef, "/data/projects/p1/models/trocr_job-1");
});

test("mapTrocrTrainedModels: labelにbase_model_ref/job_idを含める", () => {
  const result = mapTrocrTrainedModels(ITEMS);
  assert.equal(result[0].label, "trocr_job-1.trocr.json (base: microsoft/trocr-base-printed, job: job-1)");
});

test("mapTrocrTrainedModels: base_model_ref/job_idが無い場合はnameのみのlabelになる", () => {
  const result = mapTrocrTrainedModels([{ name: "x.trocr.json", model_dir: "/m/x" }]);
  assert.equal(result[0].label, "x.trocr.json");
});

test("mapTrocrTrainedModels: 空配列・null/undefinedでもクラッシュしない", () => {
  assert.deepEqual(mapTrocrTrainedModels([]), []);
  assert.deepEqual(mapTrocrTrainedModels(null), []);
  assert.deepEqual(mapTrocrTrainedModels(undefined), []);
});

test("mapTrocrTrainedModels: nameが空のitemは除外する", () => {
  const result = mapTrocrTrainedModels([{ name: "  ", model_dir: "/m/x" }]);
  assert.deepEqual(result, []);
});

// ---------- resolveTrocrTrainedModelRef ----------

test("resolveTrocrTrainedModelRef: 選択済みモデルのmodelRefを返す", () => {
  const list = mapTrocrTrainedModels(ITEMS);
  assert.equal(resolveTrocrTrainedModelRef(list, "trocr_job-1.trocr.json"), "/data/projects/p1/models/trocr_job-1");
});

test("resolveTrocrTrainedModelRef: 未選択・未存在は空文字", () => {
  const list = mapTrocrTrainedModels(ITEMS);
  assert.equal(resolveTrocrTrainedModelRef(list, ""), "");
  assert.equal(resolveTrocrTrainedModelRef(list, null), "");
  assert.equal(resolveTrocrTrainedModelRef(list, "not_in_list.trocr.json"), "");
});

// ---------- trocrTrainedModelValidationError ----------

test("trocrTrainedModelValidationError: 未選択はエラー文言を返す", () => {
  const list = mapTrocrTrainedModels(ITEMS);
  assert.equal(trocrTrainedModelValidationError(list, ""), "継続元のTrOCRモデルを選択してください。");
  assert.equal(trocrTrainedModelValidationError(list, null), "継続元のTrOCRモデルを選択してください。");
  assert.equal(trocrTrainedModelValidationError(list, "   "), "継続元のTrOCRモデルを選択してください。");
});

test("trocrTrainedModelValidationError: 存在しないモデルはエラー文言を返す", () => {
  const list = mapTrocrTrainedModels(ITEMS);
  assert.equal(
    trocrTrainedModelValidationError(list, "not_in_list.trocr.json"),
    "選択したTrOCRモデルを利用できません。"
  );
});

test("trocrTrainedModelValidationError: 有効な選択はnull", () => {
  const list = mapTrocrTrainedModels(ITEMS);
  assert.equal(trocrTrainedModelValidationError(list, "trocr_job-1.trocr.json"), null);
});
