// TrOCR Model Management Parity（Issue #141）の純粋関数の単体テスト。
//
// `/models`・`/models/info`（Tesseract/PaddleOCR用）は無変更のまま、Frontend側で
// 既存の`GET /api/trocr/models`をModelsViewの`models`/`modelInfos`形状へマージする
// `mapTrocrModelToInfo`/`mergeTrocrModelsIntoList`（App.jsx::loadModels()から呼ばれる）
// を検証する。実APIには依存しない。

import assert from "node:assert/strict";
import { test } from "node:test";

import { mapTrocrModelToInfo, mergeTrocrModelsIntoList } from "../src/lib/trocrModelManagement.js";

test("mapTrocrModelToInfo: sidecar payloadをmodelInfos 1件分の形状へ変換する", () => {
  const info = mapTrocrModelToInfo({
    name: "trocr_job-1.trocr.json",
    model_type: "ocr",
    created_at: "2026-08-01T00:00:00",
    dataset_id: "ds1",
    job_id: "job-1",
    base_model_ref: "microsoft/trocr-base-printed",
  });
  assert.equal(info.name, "trocr_job-1.trocr.json");
  assert.equal(info.engine, "trocr");
  assert.equal(info.training_family, "trocr", "training_familyは既存ocr/tesseractと区別する専用値であること");
  assert.equal(info.model_type, "ocr");
  assert.equal(info.created_at, "2026-08-01T00:00:00");
  assert.equal(info.dataset_id, "ds1");
  assert.equal(info.job_id, "job-1");
  assert.equal(info.base_model_ref, "microsoft/trocr-base-printed");
});

test("mapTrocrModelToInfo: 欠損フィールドは空文字/既定値へフォールバックし、例外を投げない", () => {
  const info = mapTrocrModelToInfo({});
  assert.equal(info.name, "");
  assert.equal(info.engine, "trocr");
  assert.equal(info.training_family, "trocr");
  assert.equal(info.model_type, "ocr");
  assert.equal(info.created_at, "");
  assert.equal(info.dataset_id, "");
  assert.equal(info.job_id, "");
  assert.equal(info.base_model_ref, "");
});

test("mapTrocrModelToInfo: item自体がnull/undefinedでも例外を投げない", () => {
  assert.equal(mapTrocrModelToInfo(null).name, "");
  assert.equal(mapTrocrModelToInfo(undefined).name, "");
});

test("mergeTrocrModelsIntoList: TrOCRモデルをmodelItems/modelInfosへ追加する", () => {
  const result = mergeTrocrModelsIntoList(
    ["model_a.tess.json"],
    { "model_a.tess.json": { engine: "tesseract", training_family: "tesseract" } },
    [{ name: "trocr_job-1.trocr.json", job_id: "job-1", created_at: "2026-08-01T00:00:00" }]
  );
  assert.deepEqual(result.modelItems, ["model_a.tess.json", "trocr_job-1.trocr.json"].sort());
  assert.ok(result.modelInfos["trocr_job-1.trocr.json"], "TrOCRモデルがmodelInfosへ追加されていない");
  assert.equal(result.modelInfos["trocr_job-1.trocr.json"].engine, "trocr");
  assert.equal(result.modelInfos["model_a.tess.json"].engine, "tesseract", "既存Tesseractエントリが変更されている");
});

test("mergeTrocrModelsIntoList: 同名エントリが既に存在する場合は上書きしない", () => {
  const existingInfo = { engine: "tesseract", training_family: "tesseract", model_id: "M0001" };
  const result = mergeTrocrModelsIntoList(
    ["dup.trocr.json"],
    { "dup.trocr.json": existingInfo },
    [{ name: "dup.trocr.json", job_id: "job-2" }]
  );
  assert.deepEqual(result.modelItems, ["dup.trocr.json"], "同名モデルが重複追加されている");
  assert.equal(result.modelInfos["dup.trocr.json"], existingInfo, "既存エントリが上書きされている");
});

test("mergeTrocrModelsIntoList: trocrItemsが空/未指定でも既存リストをそのまま返す", () => {
  const result = mergeTrocrModelsIntoList(["model_a.tess.json"], { "model_a.tess.json": { engine: "tesseract" } }, []);
  assert.deepEqual(result.modelItems, ["model_a.tess.json"]);

  const resultUndefined = mergeTrocrModelsIntoList(["model_a.tess.json"], { "model_a.tess.json": { engine: "tesseract" } });
  assert.deepEqual(resultUndefined.modelItems, ["model_a.tess.json"]);
});

test("mergeTrocrModelsIntoList: name未設定（空文字/空白のみ）のTrOCRアイテムは無視する", () => {
  const result = mergeTrocrModelsIntoList([], {}, [{ name: "" }, { name: "   " }, {}]);
  assert.deepEqual(result.modelItems, []);
  assert.deepEqual(result.modelInfos, {});
});

test("mergeTrocrModelsIntoList: 複数TrOCRモデルは名前順でソートされる", () => {
  const result = mergeTrocrModelsIntoList(
    [],
    {},
    [{ name: "trocr_b.trocr.json" }, { name: "trocr_a.trocr.json" }]
  );
  assert.deepEqual(result.modelItems, ["trocr_a.trocr.json", "trocr_b.trocr.json"]);
});

test("mergeTrocrModelsIntoList: 引数のmodelItems/infoMapを変更しない（呼び出し元のstateを直接ミューテートしない）", () => {
  const modelItems = ["model_a.tess.json"];
  const infoMap = { "model_a.tess.json": { engine: "tesseract" } };
  mergeTrocrModelsIntoList(modelItems, infoMap, [{ name: "trocr_new.trocr.json" }]);
  assert.deepEqual(modelItems, ["model_a.tess.json"], "元のmodelItems配列がミューテートされている");
  assert.deepEqual(Object.keys(infoMap), ["model_a.tess.json"], "元のinfoMapオブジェクトがミューテートされている");
});
