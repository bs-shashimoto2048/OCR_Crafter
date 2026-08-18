// Evaluation → Benchmark Handoff（lib/evaluationBenchmarkHandoff.js）のテスト（Issue #119）。
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveEvaluationBenchmarkHandoff } from "../src/lib/evaluationBenchmarkHandoff.js";

test("tesseract: 登録済みモデル名とdatasetをそのまま引き継ぐ", () => {
  const result = resolveEvaluationBenchmarkHandoff({
    engine: "tesseract",
    trainedModel: "digits.tess.json",
    imageDir: "/data/eval/images",
    gtCsv: "/data/eval/gt.csv",
    datasetId: "DS-0001",
  });
  assert.deepEqual(result, {
    benchmarkEngineKey: "tesseract_model",
    modelName: "digits.tess.json",
    trocrModelRef: "",
    imageDir: "/data/eval/images",
    gtCsv: "/data/eval/gt.csv",
    datasetId: "DS-0001",
  });
});

test("tesseract: 'latest'（特殊値）は推測でモデル名へ変換せず空にする", () => {
  const result = resolveEvaluationBenchmarkHandoff({ engine: "tesseract", trainedModel: "latest" });
  assert.equal(result.modelName, "");
});

test("paddleocr: 登録済みモデル名をpaddleocr_customへ引き継ぐ", () => {
  const result = resolveEvaluationBenchmarkHandoff({ engine: "paddleocr", paddleModel: "ocr_paddleocr_v1.ocr.json" });
  assert.equal(result.benchmarkEngineKey, "paddleocr_custom");
  assert.equal(result.modelName, "ocr_paddleocr_v1.ocr.json");
});

test("trocr: manualモードのmodel_refをそのまま引き継ぐ", () => {
  const result = resolveEvaluationBenchmarkHandoff({
    engine: "trocr",
    trocrModelSource: "manual",
    trocrModelRef: "microsoft/trocr-base-handwritten",
  });
  assert.equal(result.benchmarkEngineKey, "trocr");
  assert.equal(result.trocrModelRef, "microsoft/trocr-base-handwritten");
});

test("trocr: metadataモードは登録済みモデル一覧から解決する", () => {
  const result = resolveEvaluationBenchmarkHandoff({
    engine: "trocr",
    trocrModelSource: "metadata",
    trocrSelectedModel: "trocr_job-1.trocr.json",
    trocrModels: [{ name: "trocr_job-1.trocr.json", modelRef: "/data/models/trocr-a" }],
  });
  assert.equal(result.trocrModelRef, "/data/models/trocr-a");
});

test("easyocr: BenchmarkはEasyOCR実行経路が無いためhandoff不可（null）", () => {
  const result = resolveEvaluationBenchmarkHandoff({ engine: "easyocr" });
  assert.equal(result, null);
});

test("未知engineもhandoff不可（null）", () => {
  const result = resolveEvaluationBenchmarkHandoff({ engine: "unknown_engine" });
  assert.equal(result, null);
});

test("datasetを未指定の場合は空文字のまま（Benchmark既存の値を上書きするかは呼び出し側判断）", () => {
  const result = resolveEvaluationBenchmarkHandoff({ engine: "tesseract", trainedModel: "digits.tess.json" });
  assert.equal(result.imageDir, "");
  assert.equal(result.gtCsv, "");
  assert.equal(result.datasetId, "");
});

test("引数省略時もクラッシュしない", () => {
  assert.doesNotThrow(() => resolveEvaluationBenchmarkHandoff({}));
  assert.doesNotThrow(() => resolveEvaluationBenchmarkHandoff());
});
