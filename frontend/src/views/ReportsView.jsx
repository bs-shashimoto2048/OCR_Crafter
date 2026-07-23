import { useEffect, useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import { API_BASE, request } from "../lib/api";
import { readTemplateRecords } from "../config/projectTemplates";

const SCROLL_AREA = "dark-scroll [overscroll-behavior:contain] [scrollbar-gutter:stable]";

export const REPORT_TYPE_LABELS = {
  single_model: "単一モデル",
  comparison: "モデル比較",
  project_summary: "プロジェクト総括",
};

const STATUS_LABELS = { completed: "完了", failed: "失敗" };

function dateLabel(value) {
  return value ? String(value).slice(0, 16).replace("T", " ") : "-";
}

// モデル開発レポート画面（生成フォーム・履歴・詳細）。生成はJob Management経由（非同期）
export default function ReportsView({ projectId, ocrModels = [], onOpenJobs, notify }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [detailId, setDetailId] = useState("");
  const detail = useMemo(() => items.find((i) => i.reportId === detailId) || null, [items, detailId]);

  // 生成フォーム
  const [reportType, setReportType] = useState("single_model");
  const [targetModel, setTargetModel] = useState("");
  const [compareModels, setCompareModels] = useState([]);
  const [formats, setFormats] = useState(["markdown", "pdf"]);
  const [experimentsLimit, setExperimentsLimit] = useState(50);
  const [includeImages, setIncludeImages] = useState(false);

  const tessModels = useMemo(
    () => ocrModels.filter((m) => String(m?.name || m).endsWith(".tess.json")).map((m) => String(m?.name || m)),
    [ocrModels]
  );

  async function load() {
    setLoading(true);
    try {
      const data = await request(`/api/reports?project_id=${encodeURIComponent(projectId)}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Escで詳細を閉じる
  useEffect(() => {
    if (!detailId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setDetailId("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailId]);

  function buildPayload(overrides = {}) {
    const modelIds = reportType === "single_model" ? (targetModel ? [targetModel] : []) : reportType === "comparison" ? compareModels : [];
    return {
      project_id: projectId,
      report_type: reportType,
      model_ids: modelIds,
      formats,
      include_images: includeImages,
      experiments_limit: Number(experimentsLimit) || 50,
      template_info: readTemplateRecords()[projectId] || null,
      ...overrides,
    };
  }

  async function generate(payload = buildPayload()) {
    setGenerating(true);
    try {
      const data = await request("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      notify?.("success", `レポート生成Jobを作成しました: ${data?.job?.job_id}（完了後に履歴へ表示されます）`);
    } catch (error) {
      notify?.("error", `レポート生成に失敗しました: ${error.message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function removeReport(reportId) {
    if (!window.confirm(`${reportId} を削除します。出力ファイル（Markdown/PDF）も削除されます。続行しますか？`)) return;
    try {
      await request(`/api/reports/${encodeURIComponent(reportId)}`, { method: "DELETE" });
      notify?.("success", `レポートを削除しました: ${reportId}`);
      setDetailId("");
      load();
    } catch (error) {
      notify?.("error", `削除に失敗しました: ${error.message}`);
    }
  }

  const canGenerate =
    reportType === "project_summary" ||
    (reportType === "single_model" && targetModel) ||
    (reportType === "comparison" && compareModels.length >= 2);

  return (
    <div className="space-y-4">
      <Card title="レポート生成" subtitle="学習・評価・比較・リリース情報をMarkdown/PDFへ自動生成します（外部通信なし・ジョブ管理経由）"
        actions={
          <Button size="sm" variant="secondary" onClick={onOpenJobs}>
            ジョブ管理を開く
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-[11px] text-muted">
              レポート種別
              <select className="app-select mt-0.5 h-8 w-full text-xs" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                {Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {reportType === "single_model" ? (
              <label className="block text-[11px] text-muted">
                対象モデル <span className="text-danger">*</span>
                <select className="app-select mt-0.5 h-8 w-full text-xs" value={targetModel} onChange={(e) => setTargetModel(e.target.value)}>
                  <option value="">モデルを選択...</option>
                  {tessModels.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {reportType === "comparison" ? (
              <fieldset className="rounded-lg border border-border/70 bg-card/40 px-2 py-1.5">
                <legend className="px-1 text-[11px] text-muted">比較モデル（2件以上） <span className="text-danger">*</span></legend>
                <div className={`max-h-28 space-y-0.5 overflow-y-auto ${SCROLL_AREA}`}>
                  {tessModels.map((name) => (
                    <label key={name} className="flex items-center gap-2 text-[12px] text-text">
                      <input
                        type="checkbox"
                        checked={compareModels.includes(name)}
                        onChange={(e) =>
                          setCompareModels((prev) => (e.target.checked ? [...prev, name] : prev.filter((m) => m !== name)))
                        }
                      />
                      {name}
                    </label>
                  ))}
                  {tessModels.length === 0 ? <p className="text-[11px] text-muted">モデルがありません</p> : null}
                </div>
              </fieldset>
            ) : null}
            {reportType === "project_summary" ? (
              <label className="block text-[11px] text-muted">
                実験履歴の掲載件数
                <input type="number" min="1" max="500" className="app-input mt-0.5 h-8 w-28 text-xs" value={experimentsLimit} onChange={(e) => setExperimentsLimit(e.target.value)} />
              </label>
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-[11px] text-muted">出力形式</p>
            <div className="flex gap-3">
              {[["markdown", "Markdown"], ["pdf", "PDF"]].map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-[12px] text-text">
                  <input
                    type="checkbox"
                    checked={formats.includes(value)}
                    onChange={(e) => setFormats((prev) => (e.target.checked ? [...prev, value] : prev.filter((f) => f !== value)))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[12px] text-text" title="最新Benchmarkの失敗例画像を同梱ディレクトリへコピーして掲載します（最大10件）">
              <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} />
              代表失敗例の画像を掲載（Benchmark実行済みの場合）
            </label>
            <Button size="sm" onClick={() => generate()} disabled={generating || !canGenerate || formats.length === 0}
              title={!canGenerate ? "対象モデルを選択してください" : formats.length === 0 ? "出力形式を選択してください" : ""}
              aria-live="polite"
            >
              {generating ? "Job作成中..." : "レポートを生成（Job作成）"}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={`レポート履歴（${items.length}件）`} subtitle="行クリックで詳細（メタデータ・ファイル・ハッシュ）を表示"
        actions={
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            {loading ? "更新中..." : "更新"}
          </Button>
        }
      >
        <div className={`max-h-[38vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                {["Report ID", "種別", "対象", "形式", "状態", "作成日時", "操作者", "Job ID"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.reportId}
                  tabIndex={0}
                  aria-label={`${item.reportId} の詳細を表示`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailId(item.reportId);
                    }
                  }}
                  onClick={() => setDetailId(item.reportId)}
                  className={`cursor-pointer border-t border-border/60 hover:bg-card/60 focus-visible:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 ${detailId === item.reportId ? "bg-accent/10" : ""}`}
                >
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className="model-id-font model-id-text--sm text-blue-200">{item.reportId}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-text">{REPORT_TYPE_LABELS[item.reportType] || item.reportType}</td>
                  <td className="min-w-0 max-w-[14rem] truncate px-2 py-1.5 text-muted" title={(item.modelIds || []).join(", ")}>
                    {(item.modelIds || []).join(", ") || item.projectId}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{(item.formats || []).join("+")}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className={item.status === "completed" ? "text-success" : "text-danger"}>{STATUS_LABELS[item.status] || item.status}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{dateLabel(item.createdAt)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{item.createdBy || "-"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{item.jobId || "-"}</td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="レポートはまだありません"
                      description="学習・評価結果をまとめた最初のレポートを生成しましょう。上のフォームで種別と対象モデルを選び、「レポートを生成」をクリックしてください。"
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {detail ? (
        <Card
          title={`レポート詳細: ${detail.reportId}`}
          subtitle={`${REPORT_TYPE_LABELS[detail.reportType] || detail.reportType} / ${dateLabel(detail.createdAt)}`}
          actions={
            <div className="flex gap-1.5">
              {(detail.formats || []).includes("markdown") ? (
                <a
                  className="inline-flex h-7 items-center rounded-lg border border-slate-500 bg-slate-700/90 px-2.5 text-xs font-medium text-slate-100 transition hover:border-slate-400 hover:bg-slate-600/90"
                  href={`${API_BASE}/api/reports/${encodeURIComponent(detail.reportId)}/download?format=markdown`}
                  aria-label="Markdown形式でダウンロード"
                >
                  Markdownを開く
                </a>
              ) : null}
              {(detail.formats || []).includes("pdf") ? (
                <a
                  className="inline-flex h-7 items-center rounded-lg border border-slate-500 bg-slate-700/90 px-2.5 text-xs font-medium text-slate-100 transition hover:border-slate-400 hover:bg-slate-600/90"
                  href={`${API_BASE}/api/reports/${encodeURIComponent(detail.reportId)}/download?format=pdf`}
                  aria-label="PDF形式でダウンロード"
                >
                  PDFを開く
                </a>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  generate({
                    project_id: detail.projectId,
                    report_type: detail.reportType,
                    model_ids: detail.modelIds || [],
                    formats: detail.formats || ["markdown"],
                    include_images: Boolean(detail.options?.include_images),
                    experiments_limit: detail.options?.experiments_limit || 50,
                    template_info: readTemplateRecords()[detail.projectId] || null,
                  })
                }
                title="同じ条件で新しいレポートを生成します（新しいReport ID）"
              >
                再生成
              </Button>
              <Button size="sm" variant="danger" onClick={() => removeReport(detail.reportId)}>
                削除
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDetailId("")} aria-label="詳細を閉じる（Esc）" title="閉じる（Esc）">
                閉じる
              </Button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
              <p className="mb-1 font-semibold text-muted">メタデータ</p>
              <p className="text-text">対象: {(detail.modelIds || []).join(", ") || detail.projectId}</p>
              <p className="text-muted">操作者: {detail.createdBy || "-"} / Job: {detail.jobId || "-"}</p>
              <p className="text-muted">使用データ更新日時: {dateLabel(detail.sourceUpdatedAt)} / generatorVersion: {detail.generatorVersion}</p>
              <p className="text-muted">保存先: data/reports/{detail.projectId}/</p>
            </div>
            <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-[12px]">
              <p className="mb-1 font-semibold text-muted">出力ファイルとSHA-256</p>
              {(detail.files || []).map((file) => (
                <p key={file} className="min-w-0 break-all text-muted">
                  <span className="text-text">{file}</span>
                  <br />
                  <span className="font-mono text-[10px]">{(detail.sha256 || {})[file] || "-"}</span>
                </p>
              ))}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
