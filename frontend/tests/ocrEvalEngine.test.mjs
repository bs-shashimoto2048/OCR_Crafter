// Evaluation UI Generalization（Issue #83、lib/ocrEvalEngine.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOcrEvalTargets,
  EVALUATION_ENGINE_IDS,
  isEvaluationEngineId,
  isPreprocessSourceAllowedForEngine,
  isTrocrEvalModelUnresolved,
  resolvePreprocessSourceForEngine,
} from "../src/lib/ocrEvalEngine.js";

test("EVALUATION_ENGINE_IDS: Evaluation対応済み4Engine（customを含まない）", () => {
  assert.deepEqual(EVALUATION_ENGINE_IDS, ["tesseract", "paddleocr", "easyocr", "trocr"]);
  assert.equal(isEvaluationEngineId("custom"), false);
  assert.equal(isEvaluationEngineId("trocr"), true);
});

test("buildOcrEvalTargets: tesseractは既存挙動を維持する（includeBase有無・optionsを持たない）", () => {
  const withBase = buildOcrEvalTargets({ engine: "tesseract", includeBase: true, trainedModel: "m1" });
  assert.deepEqual(withBase, [
    { engine: "tesseract", model: "eng" },
    { engine: "tesseract", model: "m1" },
  ]);
  assert.ok(!("options" in withBase[0]));
  assert.ok(!("options" in withBase[1]));

  const withoutBase = buildOcrEvalTargets({ engine: "tesseract", includeBase: false, trainedModel: "m1" });
  assert.deepEqual(withoutBase, [{ engine: "tesseract", model: "m1" }]);

  const latestDefault = buildOcrEvalTargets({ engine: "tesseract" });
  assert.deepEqual(latestDefault, [{ engine: "tesseract", model: "latest" }]);
});

test("buildOcrEvalTargets: 未知engineはtesseract扱いにフォールバックする", () => {
  const targets = buildOcrEvalTargets({ engine: "unknown-engine", trainedModel: "m1" });
  assert.deepEqual(targets, [{ engine: "tesseract", model: "m1" }]);
});

test("buildOcrEvalTargets: PaddleOCRはtarget1件・language/use_angle_clsをoptionsへ", () => {
  const targets = buildOcrEvalTargets({
    engine: "paddleocr",
    paddleModel: "custom_v1",
    paddleLanguage: "ja",
    paddleUseAngleCls: true,
  });
  assert.deepEqual(targets, [
    { engine: "paddleocr", model: "custom_v1", options: { language: "ja", use_angle_cls: true } },
  ]);
});

test("buildOcrEvalTargets: PaddleOCRの既定値（未指定時）", () => {
  const targets = buildOcrEvalTargets({ engine: "paddleocr" });
  assert.deepEqual(targets, [
    { engine: "paddleocr", model: "latest", options: { language: "en", use_angle_cls: false } },
  ]);
});

test("buildOcrEvalTargets: EasyOCRはmodel固定latest・languagesをoptionsへ", () => {
  const targets = buildOcrEvalTargets({ engine: "easyocr", easyocrLangs: ["ja", "en"] });
  assert.deepEqual(targets, [{ engine: "easyocr", model: "latest", options: { languages: ["ja", "en"] } }]);
});

test("buildOcrEvalTargets: EasyOCR未選択時はenへフォールバック（空配列を送らない）", () => {
  const targets = buildOcrEvalTargets({ engine: "easyocr", easyocrLangs: [] });
  assert.deepEqual(targets[0].options.languages, ["en"]);
});

test("buildOcrEvalTargets: TrOCR手動入力方式はmodel_refを前後空白除去して使う", () => {
  const targets = buildOcrEvalTargets({
    engine: "trocr",
    trocrModelSource: "manual",
    trocrModelRef: "  microsoft/trocr-base-printed  ",
  });
  assert.deepEqual(targets, [
    { engine: "trocr", model: "microsoft/trocr-base-printed", options: { local_files_only: false } },
  ]);
});

test("buildOcrEvalTargets: TrOCR登録済みモデル方式はmodelInfosから解決したmodel_refを使う", () => {
  const trocrModels = [{ name: "a.trocr.json", label: "手書きTrOCR", modelRef: "/opt/models/trocr-a" }];
  const targets = buildOcrEvalTargets({
    engine: "trocr",
    trocrModelSource: "metadata",
    trocrSelectedModel: "a.trocr.json",
    trocrModels,
  });
  assert.equal(targets[0].model, "/opt/models/trocr-a");
});

test("buildOcrEvalTargets: TrOCRのdevice未指定時はoptionsへ含めない（Backend既定=自動判定に委ねる）", () => {
  const targets = buildOcrEvalTargets({ engine: "trocr", trocrModelRef: "m" });
  assert.ok(!("device" in targets[0].options));
});

test("buildOcrEvalTargets: TrOCRのdevice/local_files_onlyを明示指定できる", () => {
  const targets = buildOcrEvalTargets({
    engine: "trocr",
    trocrModelRef: "m",
    trocrDevice: "cuda",
    trocrLocalFilesOnly: true,
  });
  assert.deepEqual(targets[0].options, { local_files_only: true, device: "cuda" });
});

test("isPreprocessSourceAllowedForEngine: tesseractは全source許容、他engineはcustom/noneのみ", () => {
  assert.equal(isPreprocessSourceAllowedForEngine("tesseract", "training"), true);
  assert.equal(isPreprocessSourceAllowedForEngine("tesseract", "step5"), true);
  assert.equal(isPreprocessSourceAllowedForEngine("paddleocr", "training"), false);
  assert.equal(isPreprocessSourceAllowedForEngine("paddleocr", "step5"), false);
  assert.equal(isPreprocessSourceAllowedForEngine("paddleocr", "custom"), true);
  assert.equal(isPreprocessSourceAllowedForEngine("easyocr", "none"), true);
  assert.equal(isPreprocessSourceAllowedForEngine("trocr", "custom"), true);
});

test("resolvePreprocessSourceForEngine: 許容されないsourceのみnoneへフォールバックする", () => {
  assert.equal(resolvePreprocessSourceForEngine("tesseract", "training"), "training");
  assert.equal(resolvePreprocessSourceForEngine("paddleocr", "training"), "none");
  assert.equal(resolvePreprocessSourceForEngine("paddleocr", "step5"), "none");
  assert.equal(resolvePreprocessSourceForEngine("paddleocr", "custom"), "custom"); // 許容される値は維持
  assert.equal(resolvePreprocessSourceForEngine("easyocr", "none"), "none");
});

test("isTrocrEvalModelUnresolved: 登録済みモデル方式は未選択・解決不能を検出する", () => {
  const trocrModels = [{ name: "a.trocr.json", label: "a", modelRef: "/opt/a" }];
  assert.equal(isTrocrEvalModelUnresolved("metadata", trocrModels, "", ""), true); // 未選択
  assert.equal(isTrocrEvalModelUnresolved("metadata", trocrModels, "a.trocr.json", ""), false);
  const broken = [{ name: "b.trocr.json", label: "b", modelRef: "" }];
  assert.equal(isTrocrEvalModelUnresolved("metadata", broken, "b.trocr.json", ""), true); // 解決不能
});

test("isTrocrEvalModelUnresolved: 手動入力方式は空文字・空白のみを未解決とする", () => {
  assert.equal(isTrocrEvalModelUnresolved("manual", [], "", ""), true);
  assert.equal(isTrocrEvalModelUnresolved("manual", [], "", "   "), true);
  assert.equal(isTrocrEvalModelUnresolved("manual", [], "", "microsoft/trocr-base-printed"), false);
});
