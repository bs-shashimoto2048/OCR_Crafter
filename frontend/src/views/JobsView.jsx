import { useEffect, useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import InfoTooltip from "../components/InfoTooltip";
import { request } from "../lib/api";
import { HELP_TEXTS } from "../lib/helpTexts";

const SCROLL_AREA = "dark-scroll [overscroll-behavior:contain] [scrollbar-gutter:stable]";

export const JOB_TYPE_LABELS = {
  preprocess: "前処理",
  dataset_creation: "データセット作成",
  training: "学習",
  evaluation: "評価",
  benchmark: "Benchmark",
  deployment_export: "配布パッケージ",
};

export const JOB_STATUS_LABELS = {
  queued: "待機中",
  running: "実行中",
  succeeded: "成功",
  failed: "失敗",
  cancel_requested: "キャンセル要求中",
  cancelled: "キャンセル済",
  interrupted: "中断（再起動）",
};

function statusChipClass(status) {
  if (status === "running") return "border-accent/50 bg-accent/15 text-blue-200";
  if (status === "succeeded") return "border-success/40 bg-success/10 text-success";
  if (status === "failed") return "border-danger/40 bg-danger/10 text-danger";
  if (status === "cancel_requested" || status === "interrupted") return "border-amber-400/50 bg-amber-400/10 text-amber-200";
  return "border-border/60 bg-card/40 text-muted";
}

function dateLabel(value) {
  return value ? String(value).slice(5, 16).replace("T", " ") : "-";
}

// 実行時間（開始〜終了 / 実行中は開始〜現在）
export function jobDuration(job) {
  const start = job?.started_at ? new Date(job.started_at).getTime() : null;
  if (!start || Number.isNaN(start)) return "-";
  const end = job?.finished_at ? new Date(job.finished_at).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

export default function JobsView({
  projects = [],
  jobs = [],
  workerAlive = false,
  loading = false,
  filters = {},
  onFiltersChange,
  onRefresh,
  onCancel,
  onRetry,
  onOpenModel,
  onOpenExperiment,
  onOpenBenchmark,
}) {
  const [detailId, setDetailId] = useState("");
  const [events, setEvents] = useState([]);
  const detail = useMemo(() => jobs.find((j) => j.job_id === detailId) || null, [jobs, detailId]);

  // Escで詳細パネルを閉じる（キーボード操作）
  useEffect(() => {
    if (!detailId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setDetailId("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailId]);

  async function openDetail(jobId) {
    setDetailId(jobId);
    try {
      const data = await request(`/api/jobs/${encodeURIComponent(jobId)}/events`);
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch {
      setEvents([]);
    }
  }

  function patchFilter(patch) {
    onFiltersChange?.({ ...filters, ...patch });
  }

  return (
    <div className="space-y-4">
      <Card
        title={`ジョブ一覧（${jobs.length}件）`}
        subtitle={
          <>
            バックグラウンドジョブの統一管理。Worker: {workerAlive ? "稼働中" : "停止（Job作成時に自動起動）"}
            <InfoTooltip {...HELP_TEXTS.jobWorker} align="left" />
          </>
        }
        actions={
          <Button size="sm" variant="secondary" onClick={onRefresh} disabled={loading}>
            {loading ? "更新中..." : "更新"}
          </Button>
        }
      >
        {/* フィルタ: Project / 種別 / Status / 実行者 / 日付 */}
        <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <select className="app-select h-8 text-xs" value={filters.project || ""} onChange={(e) => patchFilter({ project: e.target.value })}>
            <option value="">Project: すべて</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select className="app-select h-8 text-xs" value={filters.jobType || ""} onChange={(e) => patchFilter({ jobType: e.target.value })}>
            <option value="">種別: すべて</option>
            {Object.entries(JOB_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select className="app-select h-8 text-xs" value={filters.status || ""} onChange={(e) => patchFilter({ status: e.target.value })}>
            <option value="">Status: すべて</option>
            {Object.entries(JOB_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            className="app-input h-8 text-xs"
            placeholder="Requested By"
            value={filters.requestedBy || ""}
            onChange={(e) => patchFilter({ requestedBy: e.target.value })}
          />
          <input type="date" className="app-input h-8 text-xs" value={filters.dateFrom || ""} onChange={(e) => patchFilter({ dateFrom: e.target.value })} />
          <input type="date" className="app-input h-8 text-xs" value={filters.dateTo || ""} onChange={(e) => patchFilter({ dateTo: e.target.value })} />
        </div>

        <div className={`max-h-[46vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                <th className="px-2 py-1.5 font-medium">Job ID</th>
                <th className="px-2 py-1.5 font-medium">種別</th>
                <th className="px-2 py-1.5 font-medium">Project</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="min-w-[140px] px-2 py-1.5 font-medium">Progress</th>
                <th className="px-2 py-1.5 font-medium">Current Step</th>
                <th className="px-2 py-1.5 font-medium">Requested By</th>
                <th className="px-2 py-1.5 font-medium">Created</th>
                <th className="px-2 py-1.5 font-medium">Duration</th>
                <th className="px-2 py-1.5 font-medium">関連</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.job_id}
                  tabIndex={0}
                  aria-label={`${job.job_id} の詳細を表示`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openDetail(job.job_id);
                    }
                  }}
                  className={`cursor-pointer border-t border-border/60 transition hover:bg-card/60 focus-visible:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 ${detailId === job.job_id ? "bg-accent/10" : ""}`}
                  onClick={() => openDetail(job.job_id)}
                >
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className="model-id-font model-id-text--sm text-blue-200">{job.job_id}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-text">{JOB_TYPE_LABELS[job.job_type] || job.job_type}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{job.project_id}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusChipClass(job.status)}`}>
                      {JOB_STATUS_LABELS[job.status] || job.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 min-w-[70px] flex-1 overflow-hidden rounded-full bg-border/50">
                        <div
                          className={`h-full rounded-full ${job.status === "failed" ? "bg-danger/70" : "bg-accent"}`}
                          style={{ width: `${Math.max(2, Number(job.progress) || 0)}%` }}
                        />
                      </div>
                      <span className="w-9 shrink-0 text-right text-muted">{Number(job.progress) || 0}%</span>
                    </div>
                  </td>
                  <td className="min-w-0 max-w-[10rem] truncate px-2 py-1.5 text-muted" title={job.current_step}>
                    {job.current_step || "-"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{job.requested_by || "-"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{dateLabel(job.created_at)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{jobDuration(job)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[11px]">
                    {job.related_model_id ? (
                      <button type="button" className="mr-1 text-blue-200 underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); onOpenModel?.(job.related_model_id); }}>
                        Model
                      </button>
                    ) : null}
                    {job.related_experiment_id ? (
                      <button type="button" className="mr-1 text-blue-200 underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); onOpenExperiment?.(job.related_experiment_id); }}>
                        {job.related_experiment_id}
                      </button>
                    ) : null}
                    {job.related_benchmark_id ? (
                      <button type="button" className="text-blue-200 underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); onOpenBenchmark?.(job.related_benchmark_id); }}>
                        {job.related_benchmark_id}
                      </button>
                    ) : null}
                    {!job.related_model_id && !job.related_experiment_id && !job.related_benchmark_id ? "-" : null}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title="ジョブがありません"
                      description="前処理・学習・評価・Benchmarkなどをバックグラウンド実行すると、ここに進捗と履歴が表示されます。まずはBenchmarkを実行してみましょう。"
                      actionLabel="Benchmarkを開く"
                      onAction={onOpenBenchmark}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Job詳細 */}
      {detail ? (
        <Card
          title={`Job詳細: ${detail.job_id}`}
          subtitle={`${JOB_TYPE_LABELS[detail.job_type] || detail.job_type} / ${detail.project_id}`}
          actions={
            <div className="flex gap-2">
              {["queued", "running"].includes(detail.status) ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(`${detail.job_id} をキャンセルしますか？（実行中は現在工程の終了後に停止します）`)) {
                      onCancel?.(detail.job_id);
                    }
                  }}
                >
                  キャンセル
                </Button>
              ) : null}
              {["succeeded", "failed", "cancelled", "interrupted"].includes(detail.status) ? (
                <Button size="sm" variant="secondary" onClick={() => onRetry?.(detail.job_id)} title="同じ入力条件で再実行します">
                  再実行
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setDetailId("")} aria-label="詳細を閉じる（Esc）" title="閉じる（Esc）">
                閉じる
              </Button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="space-y-2">
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
                <p className="mb-1 font-semibold text-muted">実行情報</p>
                <p className="text-text">
                  Status: {JOB_STATUS_LABELS[detail.status] || detail.status} / Progress: {detail.progress}% / {detail.current_step}
                </p>
                <p className="text-muted">
                  作成 {dateLabel(detail.created_at)} / 開始 {dateLabel(detail.started_at)} / 終了 {dateLabel(detail.finished_at)} / 所要 {jobDuration(detail)}
                </p>
                {detail.retry_source_job_id ? <p className="text-muted">再実行元: {detail.retry_source_job_id}</p> : null}
                {detail.message ? <p className="text-amber-200">{detail.message}</p> : null}
                {detail.error_summary ? (
                  <p className="mt-1 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-danger">
                    エラー要約: {detail.error_summary}（詳細は内部ログ data/jobs/logs/{detail.job_id}.log）
                  </p>
                ) : null}
              </div>
              <details className="rounded-lg border border-border bg-card/45 px-3 py-2" open>
                <summary className="cursor-pointer select-none text-[12px] font-semibold text-muted">入力条件</summary>
                <pre className={`mt-1 max-h-48 overflow-auto rounded bg-black/25 p-2 text-[10px] leading-4 text-slate-200 ${SCROLL_AREA}`}>
                  {JSON.stringify(detail.params, null, 2)}
                </pre>
              </details>
              {detail.result_summary ? (
                <details className="rounded-lg border border-border bg-card/45 px-3 py-2" open>
                  <summary className="cursor-pointer select-none text-[12px] font-semibold text-muted">結果要約</summary>
                  <pre className={`mt-1 max-h-48 overflow-auto rounded bg-black/25 p-2 text-[10px] leading-4 text-slate-200 ${SCROLL_AREA}`}>
                    {JSON.stringify(detail.result_summary, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
            <div className="rounded-lg border border-border bg-card/45 px-3 py-2">
              <p className="mb-1 text-[12px] font-semibold text-muted">進捗履歴（イベント）</p>
              <div className={`max-h-64 overflow-y-auto ${SCROLL_AREA}`}>
                {events.length === 0 ? (
                  <p className="text-[12px] text-muted">イベントがありません</p>
                ) : (
                  <ul className="space-y-0.5 text-[11px] tabular-nums">
                    {events.map((event, index) => (
                      <li key={index} className="flex gap-2 border-t border-border/40 py-0.5 first:border-t-0">
                        <span className="shrink-0 text-muted">{String(event.ts || "").slice(11, 19)}</span>
                        {event.type === "status" ? (
                          <span className={`shrink-0 rounded-full border px-1.5 text-[10px] ${statusChipClass(event.status)}`}>
                            {JOB_STATUS_LABELS[event.status] || event.status}
                          </span>
                        ) : (
                          <span className="shrink-0 text-text">{event.progress}%</span>
                        )}
                        <span className="min-w-0 truncate text-muted" title={`${event.step || ""} ${event.message || ""}`}>
                          {event.step || ""} {event.message || ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
