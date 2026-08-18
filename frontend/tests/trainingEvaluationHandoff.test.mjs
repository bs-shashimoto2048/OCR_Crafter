// Training → Evaluation Handoff（lib/trainingEvaluationHandoff.js）のテスト（Issue #119）。
// 実Backend・実DBは使用しない。/models/info・/api/trocr/models応答形状のフェイクデータのみ。
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTrainingEvaluationHandoff } from "../src/lib/trainingEvaluationHandoff.js";

const MODEL_INFOS = {
  "digits.tess.json": { name: "digits.tess.json", engine: "tesseract", job_id: "job-tess-1" },
  "other.tess.json": { name: "other.tess.json", engine: "tesseract", job_id: "job-tess-old" },
  "ocr_paddleocr_v1.ocr.json": { name: "ocr_paddleocr_v1.ocr.json", engine: "paddleocr", job_id: "job-paddle-1" },
};

const TROCR_ITEMS = [
  { name: "trocr_job-3.trocr.json", model_dir: "/data/models/trocr-a", job_id: "job-trocr-3" },
];

test("tesseract: job_idが一致するモデル名を解決する", () => {
  const result = resolveTrainingEvaluationHandoff({ engine: "tesseract", jobId: "job-tess-1", modelInfos: MODEL_INFOS });
  assert.deepEqual(result, { engine: "tesseract", modelName: "digits.tess.json", modelRef: "" });
});

test("paddleocr: job_idが一致するモデル名を解決する", () => {
  const result = resolveTrainingEvaluationHandoff({ engine: "paddleocr", jobId: "job-paddle-1", modelInfos: MODEL_INFOS });
  assert.deepEqual(result, { engine: "paddleocr", modelName: "ocr_paddleocr_v1.ocr.json", modelRef: "" });
});

test("trocr: job_idが一致するmodel_dirをmodelRefとして解決する（manual入力用）", () => {
  const result = resolveTrainingEvaluationHandoff({
    engine: "trocr",
    jobId: "job-trocr-3",
    trocrTrainedModelItems: TROCR_ITEMS,
  });
  assert.deepEqual(result, { engine: "trocr", modelName: "", modelRef: "/data/models/trocr-a" });
});

test("job_idが一致しない場合は空文字（推測しない）", () => {
  const result = resolveTrainingEvaluationHandoff({ engine: "tesseract", jobId: "job-does-not-exist", modelInfos: MODEL_INFOS });
  assert.deepEqual(result, { engine: "tesseract", modelName: "", modelRef: "" });
});

test("jobIdが空の場合は解決しない", () => {
  const result = resolveTrainingEvaluationHandoff({ engine: "tesseract", jobId: "", modelInfos: MODEL_INFOS });
  assert.equal(result.modelName, "");
});

test("EasyOCR等、Trainableではないengineは解決しない", () => {
  const result = resolveTrainingEvaluationHandoff({ engine: "easyocr", jobId: "job-x", modelInfos: MODEL_INFOS });
  assert.deepEqual(result, { engine: "easyocr", modelName: "", modelRef: "" });
});

test("未知engineは解決しない", () => {
  const result = resolveTrainingEvaluationHandoff({ engine: "", jobId: "job-tess-1", modelInfos: MODEL_INFOS });
  assert.equal(result.modelName, "");
});

test("modelInfos/trocrTrainedModelItems省略時もクラッシュしない", () => {
  assert.doesNotThrow(() => resolveTrainingEvaluationHandoff({ engine: "tesseract", jobId: "job-tess-1" }));
  assert.doesNotThrow(() => resolveTrainingEvaluationHandoff({ engine: "trocr", jobId: "job-trocr-3" }));
});
