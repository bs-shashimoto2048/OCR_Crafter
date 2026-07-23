// ジョブ管理画面（JobsView）のレンダリングテスト。
// 一覧・フィルタ・進捗表示・関連リンク・種別/状態ラベルを検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let JobsView;
let JOB_TYPE_LABELS;
let JOB_STATUS_LABELS;
let jobDuration;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: JobsView, JOB_TYPE_LABELS, JOB_STATUS_LABELS, jobDuration } = await server.ssrLoadModule(
    "/src/views/JobsView.jsx"
  ));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

const SAMPLE_JOBS = [
  {
    job_id: "JOB-000002",
    project_id: "invoice",
    job_type: "training",
    status: "running",
    progress: 45,
    current_step: "学習イテレーション",
    requested_by: "hashimoto",
    created_at: "2026-07-23T10:00:00",
    started_at: "2026-07-23T10:00:05",
    finished_at: null,
    related_experiment_id: "EXP-0012",
    related_model_id: "",
    related_benchmark_id: "",
    params: {},
  },
  {
    job_id: "JOB-000001",
    project_id: "invoice",
    job_type: "preprocess",
    status: "failed",
    progress: 30,
    current_step: "前処理",
    requested_by: "",
    created_at: "2026-07-23T09:00:00",
    started_at: "2026-07-23T09:00:02",
    finished_at: "2026-07-23T09:01:02",
    error_summary: "画像の読み込みに失敗",
    params: {},
  },
];

function render(props = {}) {
  const html = renderToString(
    React.createElement(JobsView, {
      projects: ["invoice", "receipt"],
      jobs: SAMPLE_JOBS,
      workerAlive: true,
      filters: {},
      onFiltersChange: noop,
      onRefresh: noop,
      onCancel: noop,
      onRetry: noop,
      ...props,
    })
  );
  return html.replaceAll("<!-- -->", "");
}

test("一覧: Job ID・種別/状態の日本語ラベル・進捗%・実行者・関連リンクを表示", () => {
  const html = render();
  assert.ok(html.includes("JOB-000002") && html.includes("JOB-000001"));
  assert.ok(html.includes("ジョブ一覧（2件）"));
  assert.ok(html.includes(">学習<") && html.includes(">前処理<"), "種別の日本語ラベルがない");
  assert.ok(html.includes("実行中") && html.includes("失敗"), "状態の日本語ラベルがない");
  assert.ok(html.includes("45%") && html.includes("30%"), "進捗%表示がない");
  assert.ok(html.includes("hashimoto"));
  assert.ok(html.includes("EXP-0012"), "関連Experimentリンクがない");
  assert.ok(html.includes("Worker: 稼働中"));
});

test("フィルタ: Project/種別/Status/RequestedBy/日付の入力がある", () => {
  const html = render();
  assert.ok(html.includes("Project: すべて"));
  assert.ok(html.includes("種別: すべて"));
  assert.ok(html.includes("Status: すべて"));
  assert.ok(html.includes('placeholder="Requested By"'));
  assert.ok((html.match(/type="date"/g) || []).length === 2, "日付フィルタが2つない");
  assert.ok(html.includes(">invoice<") && html.includes(">receipt<"), "プロジェクト選択肢がない");
});

test("空一覧: 案内メッセージを表示", () => {
  const html = render({ jobs: [] });
  assert.ok(html.includes("ジョブがありません"));
});

test("ラベル定義: 全6種別・全6状態が揃っている", () => {
  assert.deepEqual(Object.keys(JOB_TYPE_LABELS), [
    "preprocess",
    "dataset_creation",
    "training",
    "evaluation",
    "benchmark",
    "deployment_export",
    "report_generate",
  ]);
  assert.deepEqual(Object.keys(JOB_STATUS_LABELS), [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancel_requested",
    "cancelled",
    "interrupted",
  ]);
  assert.equal(JOB_STATUS_LABELS.interrupted, "中断（再起動）");
});

test("jobDuration: 終了済みは開始〜終了の秒/分表示・未開始はハイフン", () => {
  assert.equal(jobDuration({ started_at: null }), "-");
  assert.equal(
    jobDuration({ started_at: "2026-07-23T09:00:00", finished_at: "2026-07-23T09:00:42" }),
    "42秒"
  );
  assert.equal(
    jobDuration({ started_at: "2026-07-23T09:00:00", finished_at: "2026-07-23T09:02:05" }),
    "2分5秒"
  );
});
