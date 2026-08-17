// TrOCR UI Integration（Issue #85）: 推論テスト画面（InferenceView）とモデル評価画面
// （OcrEvaluationView）のTrOCR関連stateが完全に分離されていることの回帰テスト。
//
// 両画面は「推論に使用モデル」とテスト用選択を混同させない既存方針（App.jsx冒頭コメント、
// switchInferenceModel()関連の既存設計）と同じ考え方で、Evaluation UI Generalization
// （Issue #83）実装時に評価画面専用のTrOCR state（ocrEvalTrocr*）を新設し、推論テスト画面の
// 既存state（inferTrocr*）とは一切共有していない。これをApp.jsxの実ソースに対する
// 静的検証で確認する（appMount.test.mjsと同じ手法。App.jsx全体はモック依存が多く
// フルマウントでの動的検証が高コストなため）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const APP_SOURCE_PROMISE = readFile(new URL("../src/App.jsx", import.meta.url), "utf-8");

test("推論テスト画面用TrOCR state（inferTrocr*）が個別に存在する", async () => {
  const source = await APP_SOURCE_PROMISE;
  for (const name of [
    "inferTrocrModelRef",
    "setInferTrocrModelRef",
    "inferTrocrModelSource",
    "setInferTrocrModelSource",
    "inferTrocrSelectedModel",
    "setInferTrocrSelectedModel",
  ]) {
    assert.ok(source.includes(name), `App.jsxに"${name}"が見つからない`);
  }
});

test("モデル評価画面用TrOCR state（ocrEvalTrocr*）が個別に存在する（推論テスト画面のstateと別名前空間）", async () => {
  const source = await APP_SOURCE_PROMISE;
  for (const name of [
    "ocrEvalTrocrModelRef",
    "setOcrEvalTrocrModelRef",
    "ocrEvalTrocrModelSource",
    "setOcrEvalTrocrModelSource",
    "ocrEvalTrocrSelectedModel",
    "setOcrEvalTrocrSelectedModel",
    "ocrEvalTrocrDevice",
    "ocrEvalTrocrLocalFilesOnly",
  ]) {
    assert.ok(source.includes(name), `App.jsxに"${name}"が見つからない`);
  }
});

test("InferenceViewへは推論テスト画面用state（inferTrocr*）のみを渡し、Evaluation用stateを渡さない", async () => {
  const source = await APP_SOURCE_PROMISE;
  const start = source.indexOf("<InferenceView");
  assert.ok(start >= 0, "<InferenceView が見つからない");
  const end = source.indexOf("/>", start);
  const block = source.slice(start, end);
  assert.ok(block.includes("trocrModelRef={inferTrocrModelRef}"));
  assert.ok(block.includes("trocrModelSource={inferTrocrModelSourceEffective}"));
  assert.ok(!block.includes("ocrEvalTrocr"), "InferenceViewへEvaluation専用stateが渡っている");
});

test("OcrEvaluationViewへは評価画面用state（ocrEvalTrocr*）のみを渡し、推論テスト画面用stateを渡さない", async () => {
  const source = await APP_SOURCE_PROMISE;
  const start = source.indexOf("<OcrEvaluationView");
  assert.ok(start >= 0, "<OcrEvaluationView が見つからない");
  const end = source.indexOf("/>", start);
  const block = source.slice(start, end);
  assert.ok(block.includes("trocrModelRef={ocrEvalTrocrModelRef}"));
  assert.ok(block.includes("trocrModelSource={ocrEvalTrocrModelSource}"));
  assert.ok(!block.includes("{inferTrocr"), "OcrEvaluationViewへ推論テスト画面専用stateが渡っている");
});

test("trocrModels（登録済みモデル一覧）は読み取り専用の共有データとして両画面へ同じ値を渡す（選択stateとは別物）", async () => {
  const source = await APP_SOURCE_PROMISE;
  // 一覧データ自体（extractTrocrModels由来）は1箇所のuseMemoで生成され、両画面が
  // 同じ読み取り専用propとして参照する（選択中モデル・model_ref入力とは異なり、
  // 画面ごとに複製する意味がないデータのため）。
  assert.match(source, /const trocrModels = useMemo\(/);
  const inferStart = source.indexOf("<InferenceView");
  const inferEnd = source.indexOf("/>", inferStart);
  assert.ok(source.slice(inferStart, inferEnd).includes("trocrModels={trocrModels}"));
  const evalStart = source.indexOf("<OcrEvaluationView");
  const evalEnd = source.indexOf("/>", evalStart);
  assert.ok(source.slice(evalStart, evalEnd).includes("trocrModels={trocrModels}"));
});
