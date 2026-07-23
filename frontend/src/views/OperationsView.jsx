import { useEffect, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import { request } from "../lib/api";

function StatCard({ label, value, tone = "text" }) {
  const toneClass = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : tone === "warning" ? "text-amber-200" : "text-text";
  return (
    <div className="rounded-lg border border-border bg-card/45 px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function checkTone(ok) {
  if (ok === true) return "text-success";
  if (ok === false) return "text-danger";
  return "text-muted";
}

const CHECK_LABELS = {
  backend: "Backend",
  data_dir_writable: "データDir書き込み",
  settings: "設定ファイル",
  tesseract: "Tesseract",
  paddleocr: "PaddleOCR",
  gpu: "GPU",
  job_worker: "Job Worker",
  disk: "ディスク空き",
  projects_dir: "モデル/プロジェクトDir",
};

export default function OperationsView({ projectId, authContext = null, onOpenJobs, onOpenBenchmark, onOpenReleases }) {
  const [dashboard, setDashboard] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  // バックアップ・データ保持設定
  const [backups, setBackups] = useState([]);
  const [backupMode, setBackupMode] = useState("metadata_only");
  const [restoreTarget, setRestoreTarget] = useState("");
  const [retention, setRetention] = useState({ job_retention_days: "", audit_retention_days: "" });
  const [message, setMessage] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [dashboardData, healthData, backupsData, retentionData] = await Promise.all([
        request(`/api/operations/dashboard?project_id=${encodeURIComponent(projectId)}`),
        request("/health/details"),
        request(`/api/backups?project_id=${encodeURIComponent(projectId)}`),
        request("/api/retention"),
      ]);
      setDashboard(dashboardData);
      setHealth(healthData);
      setBackups(Array.isArray(backupsData?.items) ? backupsData.items : []);
      setRetention({
        job_retention_days: retentionData?.config?.job_retention_days ?? "",
        audit_retention_days: retentionData?.config?.audit_retention_days ?? "",
      });
    } catch {
      setDashboard(null);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function notifyLocal(tone, text) {
    setMessage({ tone, text });
    window.setTimeout(() => setMessage(null), 6000);
  }

  async function createBackup() {
    try {
      const data = await request("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, mode: backupMode }),
      });
      notifyLocal("success", `バックアップを作成しました: ${data?.item?.backup_id}（${backupMode}）`);
      load();
    } catch (error) {
      notifyLocal("danger", `バックアップ作成に失敗しました: ${error.message}`);
    }
  }

  async function restoreBackup(backupId) {
    if (!window.confirm(`${backupId} を新しいプロジェクトへ復元します（既存プロジェクトは上書きされません）。よろしいですか？`)) {
      return;
    }
    try {
      const data = await request(`/api/backups/${encodeURIComponent(backupId)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_project_id: restoreTarget.trim() }),
      });
      notifyLocal("success", `復元しました: 新プロジェクト「${data?.project_id}」（画面更新後に選択できます）`);
      setRestoreTarget("");
    } catch (error) {
      notifyLocal("danger", `復元に失敗しました: ${error.message}`);
    }
  }

  async function saveRetention() {
    try {
      const data = await request("/api/retention", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_retention_days: retention.job_retention_days === "" ? null : Number(retention.job_retention_days),
          audit_retention_days: retention.audit_retention_days === "" ? null : Number(retention.audit_retention_days),
        }),
      });
      setRetention({
        job_retention_days: data?.config?.job_retention_days ?? "",
        audit_retention_days: data?.config?.audit_retention_days ?? "",
      });
      notifyLocal("success", "データ保持設定を保存しました（空欄=無期限保持）");
    } catch (error) {
      notifyLocal("danger", `保存に失敗しました: ${error.message}`);
    }
  }

  async function applyRetention() {
    if (!window.confirm("保持期間を過ぎた終端状態のJobと監査ログを削除します（削除は監査記録されます）。よろしいですか？")) {
      return;
    }
    try {
      const data = await request("/api/retention/apply", { method: "POST" });
      notifyLocal("success", `適用しました: Job ${data?.removed_jobs}件 / 監査 ${data?.removed_audit_entries}件を削除`);
      load();
    } catch (error) {
      notifyLocal("danger", `適用に失敗しました: ${error.message}`);
    }
  }

  const jobs = dashboard?.jobs || {};
  const production = dashboard?.production || {};
  const usage = dashboard?.data_usage || {};

  return (
    <div className="space-y-4">
      {authContext && !authContext.auth_configured ? (
        <div className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          認証未設定モード: 認証基盤（SSO等）が未導入のため、全ユーザーがAdmin互換で動作しています（Viewer/Operator/Approver/Adminの権限はX-Roleヘッダ明示時のみ強制）。
        </div>
      ) : null}

      <Card
        title="運用ダッシュボード"
        subtitle={`プロジェクト: ${projectId || "-"} / 更新: ${String(dashboard?.generated_at || "").slice(0, 19).replace("T", " ") || "-"}`}
        actions={
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            {loading ? "更新中..." : "更新"}
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <StatCard label="実行中Job" value={jobs.running ?? "-"} tone={jobs.running ? "warning" : "text"} />
          <StatCard label="待機中Job" value={jobs.queued ?? "-"} />
          <StatCard label="失敗Job（直近50件中）" value={jobs.failed_recent ?? "-"} tone={jobs.failed_recent ? "danger" : "text"} />
          <StatCard label="Production" value={production.model ? `v${production.version || "-"}` : "0件"} tone={production.model ? "success" : "text"} />
          <StatCard
            label="Release Gate"
            value={production.gate_verdict || "-"}
            tone={production.gate_verdict === "PASS" ? "success" : production.gate_verdict === "FAIL" ? "danger" : "warning"}
          />
          <StatCard label="未評価Candidate" value={(dashboard?.unevaluated_candidates || []).length} tone={(dashboard?.unevaluated_candidates || []).length ? "warning" : "text"} />
          <StatCard label="データ使用量" value={usage.total_mb !== null && usage.total_mb !== undefined ? `${usage.total_mb}MB` : "-"} />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
            <p className="mb-1 flex items-center justify-between font-semibold text-muted">
              最近のJob
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onOpenJobs}>
                ジョブ管理へ
              </Button>
            </p>
            {(jobs.recent || []).length === 0 ? (
              <p className="text-muted">Jobがありません</p>
            ) : (
              (jobs.recent || []).map((job) => (
                <p key={job.job_id} className="tabular-nums text-muted">
                  <span className="text-blue-200">{job.job_id}</span> {job.job_type} / {job.project_id} /{" "}
                  <span className={job.status === "failed" ? "text-danger" : job.status === "succeeded" ? "text-success" : "text-text"}>{job.status}</span> {job.progress}%
                </p>
              ))
            )}
            <p className="mt-1 border-t border-border/50 pt-1 text-[11px] text-muted">Worker: {jobs.worker_alive ? "稼働中" : "停止（Job作成時に自動起動）"}</p>
          </div>
          <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
            <p className="mb-1 flex items-center justify-between font-semibold text-muted">
              Production / Release
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onOpenReleases}>
                リリース管理へ
              </Button>
            </p>
            <p className="text-text">{production.model || "Production 0件（未昇格）"}</p>
            {(production.gate_failed_rules || []).length > 0 ? (
              <p className="text-danger">Gate不合格ルール: {(production.gate_failed_rules || []).join(", ")}</p>
            ) : null}
            {(dashboard?.unevaluated_candidates || []).length > 0 ? (
              <p className="mt-1 text-amber-200">未評価Candidate: {(dashboard?.unevaluated_candidates || []).join(", ")}</p>
            ) : null}
            <p className="mt-1 border-t border-border/50 pt-1 text-[11px] text-muted">
              バックアップ:{" "}
              {dashboard?.backup
                ? `${String(dashboard.backup.created_at || "").slice(0, 16).replace("T", " ")}（${dashboard.backup.mode || "-"}）`
                : "未取得"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
            <p className="mb-1 flex items-center justify-between font-semibold text-muted">
              最近のBenchmark
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onOpenBenchmark}>
                Benchmarkへ
              </Button>
            </p>
            {dashboard?.latest_benchmark ? (
              <>
                <p className="text-text">
                  <span className="text-blue-200">{dashboard.latest_benchmark.benchmark_id}</span> {dashboard.latest_benchmark.name || ""}
                </p>
                <p className="text-muted">
                  エンジン{dashboard.latest_benchmark.engines}件 / 1位: {dashboard.latest_benchmark.best?.label || "-"}
                  {dashboard.latest_benchmark.best?.cer !== null && dashboard.latest_benchmark.best?.cer !== undefined
                    ? `（CER ${(dashboard.latest_benchmark.best.cer * 100).toFixed(2)}%）`
                    : ""}
                </p>
              </>
            ) : (
              <p className="text-muted">Benchmark履歴がありません</p>
            )}
            <p className="mt-1 border-t border-border/50 pt-1 text-[11px] text-muted">
              使用量内訳: raw {usage.raw_mb ?? "-"}MB / processed {usage.processed_mb ?? "-"}MB / models {usage.models_mb ?? "-"}MB / outputs {usage.outputs_mb ?? "-"}MB
            </p>
          </div>
        </div>
      </Card>

      {message ? (
        <div
          className={`rounded-lg border px-3 py-2 text-[12px] ${
            message.tone === "success" ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="バックアップ" subtitle="metadata_only=設定・記録のみ / full=プロジェクト全体。復元は既定で新しいProject IDへ（上書きしない）">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select className="app-select h-8 text-xs" value={backupMode} onChange={(e) => setBackupMode(e.target.value)}>
              <option value="metadata_only">metadata_only（設定・記録のみ）</option>
              <option value="full">full（プロジェクト全体）</option>
            </select>
            <Button size="sm" onClick={createBackup}>
              バックアップを作成
            </Button>
            <input
              className="app-input h-8 flex-1 text-xs"
              placeholder="復元先Project ID（空=自動採番: <元ID>_restored_n）"
              value={restoreTarget}
              onChange={(e) => setRestoreTarget(e.target.value)}
            />
          </div>
          <div className="max-h-48 overflow-auto rounded-lg border border-border dark-scroll [overscroll-behavior:contain]">
            <table className="min-w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-card/90 text-left text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Backup ID</th>
                  <th className="px-2 py-1.5 font-medium">モード</th>
                  <th className="px-2 py-1.5 font-medium">作成日時</th>
                  <th className="px-2 py-1.5 font-medium">サイズ</th>
                  <th className="px-2 py-1.5 font-medium">復元</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((entry) => (
                  <tr key={entry.backup_id} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="model-id-font model-id-text--sm text-blue-200">{entry.backup_id}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted">{entry.mode}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted">{String(entry.created_at || "").slice(0, 16).replace("T", " ")}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted">{(Number(entry.size_bytes || 0) / 1024).toFixed(1)}KB</td>
                    <td className="px-2 py-1.5">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => restoreBackup(entry.backup_id)}>
                        新プロジェクトへ復元
                      </Button>
                    </td>
                  </tr>
                ))}
                {backups.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-muted">
                      バックアップがありません
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="データ保持設定" subtitle="空欄=無期限保持（従来動作）。適用による削除は監査ログへ記録されます">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-muted">
              Job保持日数（終端状態のみ削除）
              <input
                type="number"
                min="1"
                className="app-input mt-0.5 h-8 w-32 text-xs"
                placeholder="無期限"
                value={retention.job_retention_days}
                onChange={(e) => setRetention({ ...retention, job_retention_days: e.target.value })}
              />
            </label>
            <label className="text-[11px] text-muted">
              監査ログ保持日数
              <input
                type="number"
                min="1"
                className="app-input mt-0.5 h-8 w-32 text-xs"
                placeholder="無期限"
                value={retention.audit_retention_days}
                onChange={(e) => setRetention({ ...retention, audit_retention_days: e.target.value })}
              />
            </label>
            <Button size="sm" variant="secondary" onClick={saveRetention}>
              保存
            </Button>
            <Button size="sm" variant="danger" onClick={applyRetention}>
              今すぐ適用
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            適用時、保持期間を過ぎた終端状態（成功/失敗/キャンセル済）のJobと監査ログを削除します。実行中・待機中のJobは削除されません。
          </p>
        </Card>
      </div>

      <Card
        title="ヘルスチェック（/health/details）"
        subtitle={health ? `状態: ${health.status === "ok" ? "正常" : `異常あり（${(health.problems || []).join(", ")}）`}` : "取得中..."}
      >
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(health?.checks || {}).map(([name, check]) => (
            <div key={name} className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-[12px]">
              <span className={`mt-0.5 shrink-0 ${checkTone(check.ok)}`}>{check.ok === true ? "●" : check.ok === false ? "✕" : "?"}</span>
              <span className="min-w-0">
                <span className="text-text">{CHECK_LABELS[name] || name}</span>
                <span className="ml-1 break-all text-[11px] text-muted">{check.detail || ""}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
