// Issue #104で発見・修正した不具合の回帰テスト。
//
// runOcrEvaluation()が/api/experiments/attach-evaluationへ送るペイロードのengineフィールドは、
// 以前は評価対象エンジンに関わらず常に"tesseract"へ固定されていた。この値はExperimentの
// Evaluation Profile / Evaluation Hashへ含まれ、Release Gateのno_cer_regression /
// require_same_evaluation_hash / min_comparison_qualityルールが比較条件の同一性判定に使う
// ため、PaddleOCR/EasyOCR/TrOCRを評価した場合でも常に"tesseract"として記録されてしまい、
// 異なるEngine間の評価を「同一条件」と誤認しうる不具合だった。
//
// 実際に評価したengine（ocrEvalEngine、Evaluation UI Generalization Issue #83で確立済みの
// 選択値）をそのまま渡すよう修正した。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const APP_SOURCE_PROMISE = readFile(new URL("../src/App.jsx", import.meta.url), "utf-8");

test("attach-evaluationペイロードのengineは実際に評価したocrEvalEngineを渡す（'tesseract'固定ではない）", async () => {
  const source = await APP_SOURCE_PROMISE;
  const start = source.indexOf('request("/api/experiments/attach-evaluation"');
  assert.ok(start >= 0, "/api/experiments/attach-evaluation の呼び出しが見つからない");
  const end = source.indexOf("})", start + 400) + 2;
  const block = source.slice(start, end);
  assert.ok(block.includes("engine: ocrEvalEngine"), "engineへocrEvalEngineが渡されていない");
  assert.ok(!block.includes('engine: "tesseract"'), "engineが'tesseract'に固定されたままになっている");
});
