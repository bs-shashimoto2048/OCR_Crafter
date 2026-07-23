// TrainingView の状態別レンダリング回帰テスト。
// build成功だけでは検出できないJSXの未定義参照（例: statusText is not defined）を、
// viteのssrLoadModuleで実際にレンダリングして検出する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let TrainingView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: TrainingView } = await server.ssrLoadModule("/src/views/TrainingView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

// OCR学習画面の最小props（settersは全てnoop）
function baseProps(overrides = {}) {
  return {
    trainingMode: "ocr",
    projectId: "testproj",
    trainingFamily: "ocr",
    setTrainingFamily: noop,
    modelType: "square",
    setModelType: noop,
    modelTypes: [],
    trainRatio: 0.8,
    setTrainRatio: noop,
    valRatio: 0.1,
    setValRatio: noop,
    testRatio: 0.1,
    setTestRatio: noop,
    epochs: 1000,
    setEpochs: noop,
    batchSize: 8,
    setBatchSize: noop,
    learningRate: 0.001,
    setLearningRate: noop,
    clsInitSourceType: "imagenet",
    setClsInitSourceType: noop,
    clsInitSourceValue: "",
    setClsInitSourceValue: noop,
    freezeBackboneEpochs: 0,
    setFreezeBackboneEpochs: noop,
    backboneLrScale: 1,
    setBackboneLrScale: noop,
    classificationInitModelOptions: [],
    savedLabeledCount: 0,
    ocrEngine: "tesseract",
    setOcrEngine: noop,
    ocrCharset: "ABC123klt",
    setOcrCharset: noop,
    ocrMaxTextLength: 8,
    setOcrMaxTextLength: noop,
    ocrImageShape: "1,48,320",
    setOcrImageShape: noop,
    ocrUseAugmentation: false,
    setOcrUseAugmentation: noop,
    ocrAugStrength: 1,
    setOcrAugStrength: noop,
    ocrDatasetDir: "C:/dataset",
    ocrDatasetCreateMode: "new",
    setOcrDatasetCreateMode: noop,
    ocrFromLogsOnlyInvalid: false,
    setOcrFromLogsOnlyInvalid: noop,
    ocrFromLogsIncludeCorrected: true,
    setOcrFromLogsIncludeCorrected: noop,
    ocrInitSourceType: "scratch",
    setOcrInitSourceType: noop,
    ocrInitSourceValue: "",
    setOcrInitSourceValue: noop,
    ocrInitModelOptions: [],
    ocrOfficialInitModelOptions: [],
    ocrTrainDevice: "cpu",
    setOcrTrainDevice: noop,
    ocrTrainNumWorkers: 0,
    setOcrTrainNumWorkers: noop,
    ocrEvalNumWorkers: 0,
    setOcrEvalNumWorkers: noop,
    ocrSaveEpochStep: 10,
    setOcrSaveEpochStep: noop,
    ocrAutoBatchSize: false,
    setOcrAutoBatchSize: noop,
    ocrUseAmp: false,
    setOcrUseAmp: noop,
    ocrPinMemory: false,
    setOcrPinMemory: noop,
    ocrPersistentWorkers: false,
    setOcrPersistentWorkers: noop,
    systemCheck: {},
    onApplyOcrTrainingPreset: noop,
    ocrDatasetInfo: null,
    onCreateSelectedOcrDataset: noop,
    onPreprocess: noop,
    onBuildDataset: noop,
    onStartTraining: noop,
    onStartOcrTraining: noop,
    onStopTraining: noop,
    onStopTrainingAndDelete: noop,
    canTrain: false,
    canStartOcrTraining: true,
    jobId: "",
    jobStatus: "idle",
    jobInfo: null,
    stopRequested: false,
    startPending: false,
    onOpenModels: noop,
    onOpenInference: noop,
    logs: [],
    workflowState: {},
    ...overrides,
  };
}

function render(overrides = {}) {
  return renderToString(React.createElement(TrainingView, baseProps(overrides)));
}

const ITERATION_LOG =
  "[2026/07/15 13:01:00] At iteration 422/800/800, mean rms=1.284%, BCER train=17.178%, wrote best model:C:\\x\\finetune_17.178_422_800.checkpoint wrote checkpoint.";

test("jobなし（idle）でレンダリングでき、開始ボタンと未開始ラベルを表示する", () => {
  const html = render();
  assert.ok(html.includes("未開始"));
  assert.ok(html.includes("OCR学習を開始"));
  assert.ok(!html.includes("statusText"));
});

test("次回学習の設定はカテゴリサマリー（4カテゴリ+編集）を表示し、モーダルは初期非表示", () => {
  const html = render().replaceAll("<!-- -->", "");
  assert.ok(html.includes("次回学習の設定"));
  for (const label of ["データ分割", "オーグメンテーション", "学習パラメータ", "エンジン設定"]) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(html.includes("編集"));
  // 次回適用の明示文言
  assert.ok(html.includes("ここで変更した設定は、次回の学習から適用されます。完了済みの学習結果には影響しません。"));
  // サマリー値（比率・Seed・エンジン）
  assert.ok(html.includes("0.8 / 0.1 / 0.1"));
  assert.ok(html.includes("Split Seed: 42"));
  assert.ok(html.includes("eng.traineddata / PSM 7"));
  // オーグメンテーション未設定は「なし」
  assert.ok(html.includes("なし"));
  // モーダル（dialog）は開くまで描画されない
  assert.ok(!html.includes('role="dialog"'));
  assert.ok(!html.includes('role="tablist"'));
});

test("queued（学習準備中）で開始ボタンが無効化表示になる", () => {
  const html = render({ jobStatus: "queued", jobId: "j1", jobInfo: { created_at: "2026-07-15T13:00:00" } });
  assert.ok(html.includes("学習準備中"));
  assert.ok(!html.includes("OCR学習を開始"));
});

test("running（iterationなし）は学習準備中と表示する", () => {
  const html = render({ jobStatus: "running", jobId: "j1" });
  assert.ok(html.includes("学習準備中"));
});

test("running（iterationあり）は学習中と表示し、開始ボタンを出さない", () => {
  const html = render({ jobStatus: "running", jobId: "j1", logs: [ITERATION_LOG], jobInfo: { epochs: 1000 } });
  assert.ok(html.includes("学習中"));
  assert.ok(html.includes("OCR学習中"));
  assert.ok(!html.includes("OCR学習を開始"));
  assert.ok(html.includes("学習停止"));
  assert.ok(html.includes("停止して削除"));
});

test("completedで完了ラベルと結果確認ボタンを表示する", () => {
  const html = render({ jobStatus: "completed", jobId: "j1", jobInfo: { model_path: "C:/m.tess.json" } });
  assert.ok(html.includes("完了"));
  assert.ok(html.includes("学習結果を確認"));
  assert.ok(html.includes("推論で試す"));
  assert.ok(html.includes("同じ設定で再学習"));
});

test("failedで失敗ラベルと再実行ボタンを表示する", () => {
  const html = render({ jobStatus: "failed", jobId: "j1", jobInfo: { message: "combine_tessdata が見つかりません" } });
  assert.ok(html.includes("失敗"));
  assert.ok(html.includes("再実行"));
  assert.ok(html.includes("combine_tessdata"));
});

test("stopped（停止済み）で再実行ボタンを表示する", () => {
  const html = render({ jobStatus: "stopped", jobId: "j1" });
  assert.ok(html.includes("停止済み"));
  assert.ok(html.includes("学習を再実行"));
});

test("stopping（停止要求中）で全実行操作が無効になる", () => {
  const html = render({ jobStatus: "running", jobId: "j1", stopRequested: true, logs: [ITERATION_LOG] });
  assert.ok(html.includes("停止処理中"));
});

test("未知の状態でもクラッシュせず「状態不明」と表示する", () => {
  const html = render({ jobStatus: "unknown", jobId: "j1" });
  assert.ok(html.includes("状態不明"));
});

test("jobInfoなしのrunningでもクラッシュしない", () => {
  const html = render({ jobStatus: "running", jobId: "j1", jobInfo: null });
  assert.ok(html.length > 0);
});
