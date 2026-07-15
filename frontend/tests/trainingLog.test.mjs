// OCR学習画面の状態導出・ログ解析の回帰テスト
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UI_TRAINING_STATE_LABELS,
  classifyLogLine,
  computeEtaSeconds,
  computeProgressPercent,
  deriveUiTrainingState,
  extractImportantEvents,
  formatDuration,
  isImportantLogLine,
  parseTrainingProgress,
} from "../src/lib/trainingLog.js";

const TESS_LINE_1 =
  "[2026/07/15 13:00:00] At iteration 189/300/300, mean rms=1.668%, delta=5.212%, BCER train=25.875%, BWER train=54.333%, skip ratio=0.000%, New best BCER = 25.875 wrote best model:C:\\proj\\models\\checkpoints\\finetune_25.875_189_300.checkpoint wrote checkpoint.";
const TESS_LINE_2 =
  "[2026/07/15 13:01:00] At iteration 422/800/800, mean rms=1.284%, delta=3.459%, BCER train=17.178%, BWER train=46.750%, skip ratio=0.000%, New best BCER = 17.178 wrote best model:C:\\proj\\models\\checkpoints\\finetune_17.178_422_800.checkpoint wrote checkpoint.";

// ---- 状態導出 ----

test("queued は学習準備中", () => {
  assert.equal(deriveUiTrainingState("queued"), "preparing");
});

test("running でも iteration ログが無い間は学習準備中", () => {
  assert.equal(deriveUiTrainingState("running", { hasIterationLog: false }), "preparing");
});

test("running + iteration ログありは学習中", () => {
  assert.equal(deriveUiTrainingState("running", { hasIterationLog: true }), "training");
});

test("停止要求中は状態に関わらず停止処理中", () => {
  assert.equal(deriveUiTrainingState("running", { hasIterationLog: true, stopRequested: true }), "stopping");
});

test("completed/failed/stopped/idle の写像", () => {
  assert.equal(deriveUiTrainingState("completed"), "completed");
  assert.equal(deriveUiTrainingState("failed"), "failed");
  assert.equal(deriveUiTrainingState("stopped"), "cancelled");
  assert.equal(deriveUiTrainingState("idle"), "idle");
  assert.equal(deriveUiTrainingState(null), "idle");
});

test("全UI状態に日本語ラベルがある", () => {
  for (const state of ["idle", "preparing", "training", "stopping", "completed", "failed", "cancelled"]) {
    assert.ok(UI_TRAINING_STATE_LABELS[state], state);
  }
});

// ---- ログ解析（iteration / BCER / checkpoint） ----

test("Tesseractログから累積iteration・BCER・checkpointを抽出する", () => {
  const progress = parseTrainingProgress([TESS_LINE_1, TESS_LINE_2]);
  assert.equal(progress.iteration, 800); // "422/800/800" の2番目（累積学習iteration）
  assert.equal(progress.bcer, 17.178);
  assert.equal(progress.checkpoint, "finetune_17.178_422_800.checkpoint");
  assert.equal(progress.samples.length, 2);
});

test("PaddleOCRのepochログからも進捗を取得する", () => {
  const progress = parseTrainingProgress(["[2026/07/15 13:00:00] epoch: [3/50], global_step: 120"]);
  assert.equal(progress.iteration, 3);
  assert.equal(progress.maxFromLog, 50);
});

test("iteration行が無い場合は進捗なし（不確かな値を出さない）", () => {
  const progress = parseTrainingProgress(["[2026/07/15 13:00:00] Extracting traineddata components..."]);
  assert.equal(progress.iteration, null);
  assert.equal(computeProgressPercent(progress.iteration, 1000), null);
});

test("ログ0件でもクラッシュしない", () => {
  const progress = parseTrainingProgress([]);
  assert.equal(progress.iteration, null);
  assert.deepEqual(extractImportantEvents([]), []);
});

// ---- 進捗率・ETA ----

test("進捗率を算出する（800/1000 = 80%）", () => {
  assert.equal(computeProgressPercent(800, 1000), 80);
});

test("最大iteration不明時は進捗率null", () => {
  assert.equal(computeProgressPercent(800, null), null);
  assert.equal(computeProgressPercent(800, 0), null);
});

test("ETAはiteration速度から計算する", () => {
  // 60秒で 300→800 (500iter) 進行 → 残り200iterは 24秒
  const { samples } = parseTrainingProgress([TESS_LINE_1, TESS_LINE_2]);
  assert.equal(computeEtaSeconds(samples, 1000), 24);
});

test("ETAはサンプル不足・速度ゼロならnull（適当な固定値を出さない）", () => {
  assert.equal(computeEtaSeconds([], 1000), null);
  assert.equal(computeEtaSeconds([{ timeMs: 0, iteration: 100 }], 1000), null);
  assert.equal(
    computeEtaSeconds(
      [
        { timeMs: 0, iteration: 100 },
        { timeMs: 60000, iteration: 100 },
      ],
      1000
    ),
    null
  );
});

test("formatDuration の表示", () => {
  assert.equal(formatDuration(4330), "1時間12分");
  assert.equal(formatDuration(1122), "18分42秒");
  assert.equal(formatDuration(42), "42秒");
  assert.equal(formatDuration(null), "--");
});

// ---- 分類・重要イベント ----

test("エラー・警告・成功・通常行を分類する", () => {
  assert.equal(classifyLogLine("Error: combine_tessdata not found"), "error");
  assert.equal(classifyLogLine("学習に失敗しました"), "error");
  assert.equal(classifyLogLine("Warning: deprecated option"), "warn");
  assert.equal(classifyLogLine("tesseract training completed"), "success");
  assert.equal(classifyLogLine("Loading file list..."), "info");
});

test("重要イベントを抽出し、生パス行を含めない", () => {
  const lines = [
    "[2026/07/15 13:06:04] 学習ステータス: running",
    "[2026/07/15 13:06:05] Extracting traineddata components...",
    "C:\\Users\\x\\very\\long\\path\\to\\image_00001.png",
    TESS_LINE_2,
    "[2026/07/15 13:20:00] tesseract training completed",
  ];
  const events = extractImportantEvents(lines);
  assert.equal(events.length, 4);
  assert.equal(events[0].time, "13:06:04");
  assert.ok(events[0].text.startsWith("学習ステータス"));
  assert.ok(!events.some((e) => e.text.includes("image_00001.png")));
});

test("isImportantLogLine は空行をfalseにする", () => {
  assert.equal(isImportantLogLine(""), false);
  assert.equal(isImportantLogLine("   "), false);
});
