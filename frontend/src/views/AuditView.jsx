import { useEffect, useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import { request } from "../lib/api";
import { AUDIT_ACTION_LABELS, buildAuditDiff } from "../lib/auditDiff";

const SCROLL_AREA = "dark-scroll [overscroll-behavior:contain] [scrollbar-gutter:stable]";

function dateLabel(value) {
  return value ? String(value).slice(0, 19).replace("T", " ") : "-";
}

export default function AuditView({ projects = [], authContext = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ project: "", action: "", user: "", targetId: "", dateFrom: "", dateTo: "" });
  const [detailId, setDetailId] = useState("");
  const detail = useMemo(() => items.find((i) => i.audit_id === detailId) || null, [items, detailId]);
  const diffRows = useMemo(() => (detail ? buildAuditDiff(detail.before, detail.after) : []), [detail]);

  async function load(currentFilters = filters) {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (currentFilters.project) query.set("project_id", currentFilters.project);
      if (currentFilters.action) query.set("action", currentFilters.action);
      if (currentFilters.user) query.set("user", currentFilters.user);
      if (currentFilters.targetId) query.set("target_id", currentFilters.targetId);
      if (currentFilters.dateFrom) query.set("date_from", currentFilters.dateFrom);
      if (currentFilters.dateTo) query.set("date_to", currentFilters.dateTo);
      const data = await request(`/api/audit?${query.toString()}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  return (
    <div className="space-y-4">
      {authContext && !authContext.auth_configured ? (
        <div className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          認証未設定モード: 認証基盤（SSO等）が未導入のため、全ユーザーがAdmin互換で動作しています。X-Operator /
          X-Roleヘッダで操作者・ロールを指定できます。
        </div>
      ) : null}
      <Card
        title={`監査ログ（${items.length}件）`}
        subtitle="重要操作の追記型記録。削除・編集はできません（パスワード・トークン・APIキー・画像バイナリは保存されません）"
        actions={
          <Button size="sm" variant="secondary" onClick={() => load(filters)} disabled={loading}>
            {loading ? "更新中..." : "更新"}
          </Button>
        }
      >
        {/* フィルタ */}
        <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <select className="app-select h-8 text-xs" value={filters.project} onChange={(e) => setFilters({ ...filters, project: e.target.value })}>
            <option value="">Project: すべて</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select className="app-select h-8 text-xs" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
            <option value="">操作: すべて</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input className="app-input h-8 text-xs" placeholder="User" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} />
          <input className="app-input h-8 text-xs" placeholder="Target ID" value={filters.targetId} onChange={(e) => setFilters({ ...filters, targetId: e.target.value })} />
          <input type="date" className="app-input h-8 text-xs" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
          <input type="date" className="app-input h-8 text-xs" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
        </div>

        <div className={`max-h-[42vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                {["Audit ID", "日時", "User", "操作", "Project", "Target", "Reason", "Job"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr
                  key={entry.audit_id}
                  className={`cursor-pointer border-t border-border/60 hover:bg-card/60 ${detailId === entry.audit_id ? "bg-accent/10" : ""}`}
                  onClick={() => setDetailId(entry.audit_id)}
                >
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className="model-id-font model-id-text--sm text-blue-200">{entry.audit_id}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{dateLabel(entry.timestamp)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-text">
                    {entry.user || "-"}
                    {entry.role ? <span className="ml-1 text-[10px] text-muted">({entry.role})</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-text">{AUDIT_ACTION_LABELS[entry.action] || entry.action}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{entry.project_id || "-"}</td>
                  <td className="min-w-0 max-w-[12rem] truncate px-2 py-1.5 text-muted" title={`${entry.target_type}: ${entry.target_id}`}>
                    {entry.target_id || "-"}
                  </td>
                  <td className="min-w-0 max-w-[14rem] truncate px-2 py-1.5 text-muted" title={entry.reason}>
                    {entry.reason || "-"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{entry.job_id || "-"}</td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">
                    監査ログがありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {detail ? (
        <Card title={`監査詳細: ${detail.audit_id}`} subtitle={`${AUDIT_ACTION_LABELS[detail.action] || detail.action} / ${dateLabel(detail.timestamp)} / ${detail.user || "-"}`}>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
              <p className="mb-1 font-semibold text-muted">Before / After 差分</p>
              {diffRows.length === 0 ? (
                <p className="text-muted">Before/Afterの記録がありません</p>
              ) : (
                <table className="min-w-full text-[11px]">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="px-1.5 py-1 font-medium">項目</th>
                      <th className="px-1.5 py-1 font-medium">Before</th>
                      <th className="px-1.5 py-1 font-medium">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffRows.map((row) => (
                      <tr key={row.key} className={`border-t border-border/40 ${row.changed ? "bg-amber-400/5" : ""}`}>
                        <td className={`whitespace-nowrap px-1.5 py-1 ${row.changed ? "font-semibold text-amber-200" : "text-muted"}`}>{row.key}</td>
                        <td className="max-w-[16rem] break-all px-1.5 py-1 text-muted">{row.before || "-"}</td>
                        <td className={`max-w-[16rem] break-all px-1.5 py-1 ${row.changed ? "text-amber-100" : "text-muted"}`}>{row.after || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
              <p className="mb-1 font-semibold text-muted">記録情報</p>
              <p className="text-text">Target: {detail.target_type || "-"} / {detail.target_id || "-"}</p>
              <p className="text-muted">Project: {detail.project_id || "-"} / Job: {detail.job_id || "-"}</p>
              <p className="text-muted">Client: {detail.client?.ip || "-"} / {detail.client?.user_agent || "-"}</p>
              {detail.reason ? <p className="mt-1 text-amber-200">Reason: {detail.reason}</p> : null}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
