// Frontend Job List/Detail表示契約の部分共通化（Issue #131）の回帰テスト。
//
// Training Job（Job System A: training_jobsテーブル）とJobManager Job
// （Job System B: job_manager.py、Issue #127でSQLite移行済み）の両raw job shapeが、
// 共通のJobDisplayModelへ正しく正規化されることを検証する。既存語彙（rawStatus）を
// 保持したまま、表示専用のcanonical categoryへ写像していることを重点的に確認する。

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANONICAL_JOB_STATUSES,
  CANONICAL_JOB_STATUS_LABELS,
  formatJobDuration,
  formatJobTimestamp,
  jobStatusBadgeClass,
  mapStatusToCanonical,
  toJobDisplayModel,
} from "../src/lib/jobDisplayModel.js";

// ---- System A（training_jobs）のstatus mapping ----

test("System A: queued/running/completed/failed/stoppedがそれぞれ正しいcanonical categoryへ写像される", () => {
  assert.equal(mapStatusToCanonical("training", "queued"), "queued");
  assert.equal(mapStatusToCanonical("training", "running"), "running");
  assert.equal(mapStatusToCanonical("training", "completed"), "success");
  assert.equal(mapStatusToCanonical("training", "failed"), "failed");
  assert.equal(mapStatusToCanonical("training", "stopped"), "cancelled");
});

test("System A: 未知のstatusはunknownへ写像される（存在しない値を捏造しない）", () => {
  assert.equal(mapStatusToCanonical("training", "totally_unknown"), "unknown");
  assert.equal(mapStatusToCanonical("training", ""), "unknown");
});

// ---- System B（job_manager）のstatus mapping ----

test("System B: 7状態すべてが正しいcanonical categoryへ写像される", () => {
  assert.equal(mapStatusToCanonical("job_manager", "queued"), "queued");
  assert.equal(mapStatusToCanonical("job_manager", "running"), "running");
  assert.equal(mapStatusToCanonical("job_manager", "succeeded"), "success");
  assert.equal(mapStatusToCanonical("job_manager", "failed"), "failed");
  assert.equal(mapStatusToCanonical("job_manager", "cancel_requested"), "cancelling");
  assert.equal(mapStatusToCanonical("job_manager", "cancelled"), "cancelled");
  assert.equal(mapStatusToCanonical("job_manager", "interrupted"), "interrupted");
});

test("mapStatusToCanonical: 未知のsourceはエラーを投げる", () => {
  assert.throws(() => mapStatusToCanonical("unknown_source", "queued"));
});

test("CANONICAL_JOB_STATUSES/CANONICAL_JOB_STATUS_LABELSは両システムの全カテゴリを網羅する", () => {
  const allCategories = new Set([
    ...["queued", "running", "completed", "failed", "stopped"].map((s) => mapStatusToCanonical("training", s)),
    ...["queued", "running", "succeeded", "failed", "cancel_requested", "cancelled", "interrupted"].map((s) =>
      mapStatusToCanonical("job_manager", s)
    ),
  ]);
  for (const category of allCategories) {
    assert.ok(CANONICAL_JOB_STATUSES.includes(category), `${category}がCANONICAL_JOB_STATUSESに無い`);
    assert.ok(CANONICAL_JOB_STATUS_LABELS[category], `${category}のラベルが無い`);
  }
});

// ---- toJobDisplayModel: System A ----

test("toJobDisplayModel(training): idはid、statusはcanonical化、progressはoverride経由でのみ入る", () => {
  const raw = {
    id: "job-uuid-1",
    project_id: "p1",
    training_family: "ocr",
    engine: "paddleocr",
    status: "running",
    message: "epoch 3/10",
    created_at: "2026-08-19T10:00:00",
    updated_at: "2026-08-19T10:05:00",
  };
  const model = toJobDisplayModel("training", raw, { progressOverride: 42.5 });
  assert.equal(model.id, "job-uuid-1");
  assert.equal(model.source, "training");
  assert.equal(model.type, "ocr");
  assert.equal(model.engine, "paddleocr");
  assert.equal(model.displayStatus, "running");
  assert.equal(model.rawStatus, "running");
  assert.equal(model.progress, 42.5);
  assert.equal(model.message, "epoch 3/10");
  assert.equal(model.error, null); // runningなのでerrorはnull
  assert.equal(model.createdAt, "2026-08-19T10:00:00");
  assert.equal(model.updatedAt, "2026-08-19T10:05:00");
  assert.equal(model.startedAt, null); // training_jobsにはstarted_atが無い
  assert.equal(model.finishedAt, null); // training_jobsにはfinished_atが無い
  assert.equal(model.canCancel, true);
  assert.equal(model.canRetry, false);
});

test("toJobDisplayModel(training): progressOverrideを渡さなければnull（捏造しない）", () => {
  const model = toJobDisplayModel("training", { id: "j1", status: "running" });
  assert.equal(model.progress, null);
});

test("toJobDisplayModel(training): progressOverrideがnullなら明示的にnullのまま", () => {
  const model = toJobDisplayModel("training", { id: "j1", status: "running" }, { progressOverride: null });
  assert.equal(model.progress, null);
});

test("toJobDisplayModel(training): failed時のみmessageがerrorとしても表れる", () => {
  const failed = toJobDisplayModel("training", { id: "j1", status: "failed", message: "boom" });
  assert.equal(failed.error, "boom");
  assert.equal(failed.message, "boom");

  const running = toJobDisplayModel("training", { id: "j1", status: "running", message: "epoch 1/5" });
  assert.equal(running.error, null); // runningのmessageは進捗メッセージであり、errorへは出さない
  assert.equal(running.message, "epoch 1/5");
});

test("toJobDisplayModel(training): stopped(cancelled)はcanCancel=false・canRetry=true", () => {
  const model = toJobDisplayModel("training", { id: "j1", status: "stopped" });
  assert.equal(model.displayStatus, "cancelled");
  assert.equal(model.canCancel, false);
  assert.equal(model.canRetry, true);
});

test("toJobDisplayModel(training): queuedはcanCancel=true・canRetry=false", () => {
  const model = toJobDisplayModel("training", { id: "j1", status: "queued" });
  assert.equal(model.canCancel, true);
  assert.equal(model.canRetry, false);
});

// ---- toJobDisplayModel: System B ----

test("toJobDisplayModel(job_manager): job_idはid、progressは構造化フィールドをそのまま使う", () => {
  const raw = {
    job_id: "JOB-000001",
    project_id: "p1",
    job_type: "benchmark",
    status: "running",
    progress: 60,
    current_step: "測定中",
    message: "実行中",
    error_summary: "",
    created_at: "2026-08-19T09:00:00",
    started_at: "2026-08-19T09:00:05",
    finished_at: "",
  };
  const model = toJobDisplayModel("job_manager", raw);
  assert.equal(model.id, "JOB-000001");
  assert.equal(model.source, "job_manager");
  assert.equal(model.type, "benchmark");
  assert.equal(model.engine, null); // job_managerにengine概念は無い
  assert.equal(model.displayStatus, "running");
  assert.equal(model.progress, 60);
  assert.equal(model.message, "実行中");
  assert.equal(model.error, null); // error_summaryが空文字なのでnull
  assert.equal(model.createdAt, "2026-08-19T09:00:00");
  assert.equal(model.startedAt, "2026-08-19T09:00:05");
  assert.equal(model.updatedAt, null); // job_managerにupdated_atは無い
  assert.equal(model.finishedAt, null); // 空文字はnull扱い
});

test("toJobDisplayModel(job_manager): error_summaryがあればerrorへそのまま入る", () => {
  const model = toJobDisplayModel("job_manager", {
    job_id: "JOB-000002",
    job_type: "report_generate",
    status: "failed",
    error_summary: "レポート生成に失敗しました",
  });
  assert.equal(model.error, "レポート生成に失敗しました");
  assert.equal(model.displayStatus, "failed");
});

test("toJobDisplayModel(job_manager): progressが未設定/null/undefinedはnull（0%を偽装しない）", () => {
  assert.equal(toJobDisplayModel("job_manager", { job_id: "j1", status: "queued" }).progress, null);
  assert.equal(toJobDisplayModel("job_manager", { job_id: "j1", status: "queued", progress: null }).progress, null);
});

test("toJobDisplayModel(job_manager): cancel_requestedはcanCancel=false・canRetry=false（既存UIの再キャンセル不可・再実行不可と一致）", () => {
  const model = toJobDisplayModel("job_manager", { job_id: "j1", status: "cancel_requested" });
  assert.equal(model.displayStatus, "cancelling");
  assert.equal(model.canCancel, false);
  assert.equal(model.canRetry, false);
});

test("toJobDisplayModel(job_manager): succeeded/failed/cancelled/interruptedはcanRetry=true・canCancel=false", () => {
  for (const status of ["succeeded", "failed", "cancelled", "interrupted"]) {
    const model = toJobDisplayModel("job_manager", { job_id: "j1", status });
    assert.equal(model.canCancel, false, `${status}: canCancelはfalseのはず`);
    assert.equal(model.canRetry, true, `${status}: canRetryはtrueのはず`);
  }
});

test("toJobDisplayModel(job_manager): queued/runningはcanCancel=true・canRetry=false", () => {
  for (const status of ["queued", "running"]) {
    const model = toJobDisplayModel("job_manager", { job_id: "j1", status });
    assert.equal(model.canCancel, true, `${status}: canCancelはtrueのはず`);
    assert.equal(model.canRetry, false, `${status}: canRetryはfalseのはず`);
  }
});

// ---- 共通 ----

test("toJobDisplayModel: rawが無ければnull", () => {
  assert.equal(toJobDisplayModel("training", null), null);
  assert.equal(toJobDisplayModel("job_manager", undefined), null);
});

test("toJobDisplayModel: 不明なsourceはエラーを投げる", () => {
  assert.throws(() => toJobDisplayModel("unknown", { id: "j1", status: "running" }));
});

test("toJobDisplayModel: rawStatus/sourceは常に保持される（未知statusでも）", () => {
  const model = toJobDisplayModel("training", { id: "j1", status: "some_future_status" });
  assert.equal(model.rawStatus, "some_future_status");
  assert.equal(model.displayStatus, "unknown");
  assert.equal(model.source, "training");
});

test("toJobDisplayModel: canOpenDetailsはrawが存在すれば常にtrue", () => {
  assert.equal(toJobDisplayModel("training", { id: "j1", status: "queued" }).canOpenDetails, true);
  assert.equal(toJobDisplayModel("job_manager", { job_id: "j1", status: "succeeded" }).canOpenDetails, true);
});

// ---- formatting helpers（JobsView.jsxの既存ロジックと同一の計算結果を保証する回帰） ----

test("formatJobTimestamp: 既存dateLabelと同一の変換（YYYY-MM-DDThh:mm:ss → MM-DD hh:mm）", () => {
  assert.equal(formatJobTimestamp("2026-07-23T09:00:42"), "07-23 09:00");
  assert.equal(formatJobTimestamp(null), "-");
  assert.equal(formatJobTimestamp(""), "-");
});

test("formatJobDuration: 既存jobDurationと同一の計算（開始〜終了の秒/分表示・未開始はハイフン）", () => {
  assert.equal(formatJobDuration({ startedAt: null }), "-");
  assert.equal(
    formatJobDuration({ startedAt: "2026-07-23T09:00:00", finishedAt: "2026-07-23T09:00:42" }),
    "42秒"
  );
  assert.equal(
    formatJobDuration({ startedAt: "2026-07-23T09:00:00", finishedAt: "2026-07-23T09:02:05" }),
    "2分5秒"
  );
});

test("jobStatusBadgeClass: 既存statusChipClassと同一の配色ルール（running/success/failed/cancelling・interrupted/その他）", () => {
  assert.match(jobStatusBadgeClass("running"), /text-blue-200/);
  assert.match(jobStatusBadgeClass("success"), /text-success/);
  assert.match(jobStatusBadgeClass("failed"), /text-danger/);
  assert.match(jobStatusBadgeClass("cancelling"), /text-amber-200/);
  assert.match(jobStatusBadgeClass("interrupted"), /text-amber-200/);
  assert.match(jobStatusBadgeClass("queued"), /text-muted/);
  assert.match(jobStatusBadgeClass("cancelled"), /text-muted/);
});
