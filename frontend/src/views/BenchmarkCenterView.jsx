import { useEffect, useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import { request } from "../lib/api";
import {
  buildBenchmarkRecommendations,
  buildEvalHistoryFromRows,
  buildRadarSeries,
  buildTrendByExperiment,
  matchesBenchmarkCenterFilters,
  sortBenchmarkRows,
  toCsvLines,
  toJsonReport,
  toMarkdownReport,
} from "../lib/benchmarkCenter";
import { latestEvalOf } from "../lib/modelEval";
import { buildModelComparison, buildWinLoss, formatMetricValue, recommendModel } from "../lib/modelCompare";

const SCROLL_AREA = "dark-scroll [overscroll-behavior:contain] [scrollbar-gutter:stable]";

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ja-JP", { hour12: false });
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 「未対応」指標（Precision/Recall/F1/WER/推論速度）。既存の評価ロジックに算出処理が
// 無いため、新しい評価ロジックを作らずそのまま「未対応」表示にする（推測補完しない）
const UNAVAILABLE_ROWS = [
  { key: "wer", label: "WER" },
  { key: "precision", label: "Precision" },
  { key: "recall", label: "Recall" },
  { key: "f1", label: "F1" },
  { key: "latency", label: "推論速度" },
];

// レーダーチャート（SVG手書き・依存なし。ExperimentsViewのLineChart/ScatterChartと同じ方式）
function RadarChart({ series }) {
  if (!series || series.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-muted">評価済みの比較対象がありません</p>;
  }
  const axisCount = series[0].values.length;
  const size = 220;
  const center = size / 2;
  const radius = size / 2 - 24;
  const angleAt = (i) => (Math.PI * 2 * i) / axisCount - Math.PI / 2;
  const pointAt = (i, ratio) => {
    const angle = angleAt(i);
    return [center + radius * ratio * Math.cos(angle), center + radius * ratio * Math.sin(angle)];
  };
  const colors = ["#60a5fa", "#fb923c", "#c084fc", "#34d399"];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[260px]" role="img" aria-label="レーダーチャート">
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <polygon
          key={ratio}
          points={Array.from({ length: axisCount }, (_, i) => pointAt(i, ratio).join(",")).join(" ")}
          fill="none"
          stroke="#3a434d"
          strokeWidth="1"
        />
      ))}
      {Array.from({ length: axisCount }, (_, i) => {
        const [x, y] = pointAt(i, 1);
        return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="#3a434d" strokeWidth="1" />;
      })}
      {series.map((s, si) => (
        <polygon
          key={s.modelName}
          points={s.values.map((v, i) => pointAt(i, Math.max(0, Math.min(1, v / 100))).join(",")).join(" ")}
          fill={colors[si % colors.length]}
          fillOpacity="0.18"
          stroke={colors[si % colors.length]}
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}

// 推移グラフ（Experiment順のAccuracy/CER。ExperimentsViewのLineChartと同じ手書きSVG方式）
function TrendChart({ points, unit = "%", stroke = "#60a5fa" }) {
  if (!points || points.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-muted">評価済みの比較対象がありません</p>;
  }
  const w = 340;
  const h = 110;
  const pad = { left: 10, right: 10, top: 14, bottom: 20 };
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => pad.left + (points.length === 1 ? (w - pad.left - pad.right) / 2 : (i * (w - pad.left - pad.right)) / (points.length - 1));
  const y = (v) => pad.top + ((max - v) / span) * (h - pad.top - pad.bottom);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="推移グラフ">
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" />
      {points.map((p, i) => (
        <circle key={p.id} cx={x(i)} cy={y(p.value)} r="3" fill={stroke}>
          <title>{`${p.id}: ${p.value.toFixed(1)}${unit}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function BenchmarkCenterView({ projectId, onOpenEvaluation, notify = () => {} }) {
  const [rows, setRows] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ datasetId: "", engine: "", preprocessVersion: "", experimentId: "", query: "" });
  const [selected, setSelected] = useState([]);
  const [missingEvalNames, setMissingEvalNames] = useState([]);
  const [comparisons, setComparisons] = useState([]);
  const [saving, setSaving] = useState(false);
  const [comparisonName, setComparisonName] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [modelsData, datasetsData, comparisonsData] = await Promise.all([
        request(`/api/benchmark-center/models?project_id=${encodeURIComponent(projectId)}`),
        request(`/api/ocr/datasets?project_id=${encodeURIComponent(projectId)}`),
        request(`/api/benchmark-center/comparisons?project_id=${encodeURIComponent(projectId)}`),
      ]);
      setRows(Array.isArray(modelsData?.items) ? modelsData.items : []);
      setDatasets(Array.isArray(datasetsData?.items) ? datasetsData.items : []);
      setComparisons(Array.isArray(comparisonsData?.items) ? comparisonsData.items : []);
    } catch (error) {
      notify("error", `Benchmark Centerのデータ取得に失敗しました: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    setSelected([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const filtered = useMemo(() => rows.filter((row) => matchesBenchmarkCenterFilters(row, filters)), [rows, filters]);
  const engineOptions = useMemo(() => [...new Set(rows.map((row) => row.engine))].filter(Boolean).sort(), [rows]);
  const preprocessVersionOptions = useMemo(
    () => [...new Set(rows.map((row) => row.preprocess_version).filter((v) => v !== null && v !== undefined))].sort((a, b) => a - b),
    [rows]
  );
  const experimentOptions = useMemo(
    () => [...new Set(rows.map((row) => row.experiment_id).filter(Boolean))].sort(),
    [rows]
  );

  function toggleSelect(modelName) {
    setSelected((prev) => (prev.includes(modelName) ? prev.filter((v) => v !== modelName) : [...prev, modelName]));
  }

  const selectedRows = useMemo(() => filtered.filter((row) => selected.includes(row.model_name)), [filtered, selected]);
  const evalHistory = useMemo(() => buildEvalHistoryFromRows(selectedRows), [selectedRows]);
  const comparison = useMemo(
    () => (selectedRows.length > 0 ? buildModelComparison(evalHistory, selectedRows.map((r) => r.model_name)) : null),
    [evalHistory, selectedRows]
  );
  const winLoss = useMemo(() => (comparison ? buildWinLoss(comparison) : null), [comparison]);
  const overallBest = useMemo(() => (comparison && winLoss ? recommendModel(comparison, winLoss) : null), [comparison, winLoss]);
  const radarSeries = useMemo(
    () => buildRadarSeries(selectedRows, (name) => latestEvalOf(evalHistory, name)),
    [selectedRows, evalHistory]
  );
  const trend = useMemo(() => buildTrendByExperiment(selectedRows), [selectedRows]);
  const recommendations = useMemo(() => buildBenchmarkRecommendations(selectedRows), [selectedRows]);

  async function checkAndConfirmEvaluation() {
    if (selected.length === 0) return;
    try {
      const data = await request(
        `/api/benchmark-center/missing-evaluations?project_id=${encodeURIComponent(projectId)}&model_names=${encodeURIComponent(selected.join(","))}`
      );
      const missing = Array.isArray(data?.missing) ? data.missing : [];
      setMissingEvalNames(missing);
      if (missing.length > 0) {
        notify("info", `評価結果がありません: ${missing.join(", ")}`);
      }
    } catch (error) {
      notify("error", `評価結果の確認に失敗しました: ${error.message}`);
    }
  }

  async function saveComparison() {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const data = await request("/api/benchmark-center/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name: comparisonName,
          dataset_ids: [...new Set(selectedRows.map((r) => r.dataset_id).filter(Boolean))],
          model_names: selected,
          experiment_ids: [...new Set(selectedRows.map((r) => r.experiment_id).filter(Boolean))],
          filters,
          sort: {},
        }),
      });
      notify("success", `比較条件を保存しました: ${data?.item?.comparison_id || ""}`);
      setComparisonName("");
      const list = await request(`/api/benchmark-center/comparisons?project_id=${encodeURIComponent(projectId)}`);
      setComparisons(Array.isArray(list?.items) ? list.items : []);
    } catch (error) {
      notify("error", `比較条件の保存に失敗しました: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    downloadBlob("﻿" + toCsvLines(selectedRows).join("\r\n"), `benchmark_center_${projectId}.csv`, "text/csv;charset=utf-8;");
  }

  function exportMarkdown() {
    const bestAccuracyRow = selectedRows.find((r) => r.model_name === recommendations.find((c) => c.id === "accuracy")?.modelName) || null;
    const bestCerRow = selectedRows.find((r) => r.model_name === recommendations.find((c) => c.id === "cer")?.modelName) || null;
    const datasetLabel = [...new Set(selectedRows.map((r) => r.dataset_id).filter(Boolean))].join(", ");
    const md = toMarkdownReport(selectedRows, { datasetLabel, bestAccuracyRow, bestCerRow });
    downloadBlob(md, `benchmark_center_${projectId}.md`, "text/markdown;charset=utf-8;");
  }

  function exportJson() {
    downloadBlob(toJsonReport(selectedRows, { project_id: projectId }), `benchmark_center_${projectId}.json`, "application/json;charset=utf-8;");
  }

  return (
    <div className="space-y-4">
      <Card
        title={`Benchmark Center（${filtered.length}件）`}
        subtitle="Dataset Manager・Experiment Tracking・Model Managerの既存データと評価結果を横断比較します（評価は実行しません）"
        actions={
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            {loading ? "更新中..." : "更新"}
          </Button>
        }
      >
        <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-5">
          <select
            className="app-select h-8 text-xs"
            value={filters.datasetId}
            onChange={(e) => setFilters((prev) => ({ ...prev, datasetId: e.target.value }))}
          >
            <option value="">Dataset: すべて</option>
            {datasets.map((d) => (
              <option key={d.dataset_id} value={d.dataset_id}>
                {d.dataset_id} {d.name}
              </option>
            ))}
          </select>
          <select
            className="app-select h-8 text-xs"
            value={filters.engine}
            onChange={(e) => setFilters((prev) => ({ ...prev, engine: e.target.value }))}
          >
            <option value="">Engine: すべて</option>
            {engineOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <select
            className="app-select h-8 text-xs"
            value={filters.preprocessVersion}
            onChange={(e) => setFilters((prev) => ({ ...prev, preprocessVersion: e.target.value }))}
          >
            <option value="">前処理Version: すべて</option>
            {preprocessVersionOptions.map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </select>
          <select
            className="app-select h-8 text-xs"
            value={filters.experimentId}
            onChange={(e) => setFilters((prev) => ({ ...prev, experimentId: e.target.value }))}
          >
            <option value="">Experiment: すべて</option>
            {experimentOptions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <input
            className="app-input h-8 text-xs"
            placeholder="検索（モデル名・Dataset）"
            value={filters.query}
            onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
          />
        </div>

        <div className={`max-h-[36vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                <th className="px-1.5 py-1.5 font-medium">選択</th>
                <th className="px-1.5 py-1.5 font-medium">モデル</th>
                <th className="px-1.5 py-1.5 font-medium">Engine</th>
                <th className="px-1.5 py-1.5 font-medium">Dataset</th>
                <th className="px-1.5 py-1.5 font-medium">Experiment</th>
                <th className="px-1.5 py-1.5 font-medium">前処理</th>
                <th className="px-1.5 py-1.5 font-medium">サイズ</th>
                <th className="px-1.5 py-1.5 font-medium">Accuracy</th>
                <th className="px-1.5 py-1.5 font-medium">CER</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.model_name} className={`border-t border-border/60 ${selected.includes(row.model_name) ? "bg-accent/10" : ""}`}>
                  <td className="px-1.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.model_name)}
                      onChange={() => toggleSelect(row.model_name)}
                      aria-label={`${row.model_name} を比較対象に選択`}
                    />
                  </td>
                  <td className="min-w-0 max-w-[14rem] truncate px-1.5 py-1.5 text-text" title={row.model_name}>
                    {row.model_name}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-muted">{row.engine}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-muted">{row.dataset_name || "-"}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-muted">{row.experiment_id || "-"}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-muted">{row.preprocess_version ? `v${row.preprocess_version}` : "-"}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-muted">{Number.isFinite(row.model_size_mb) ? `${row.model_size_mb}MB` : "-"}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-text">
                    {row.evaluation ? `${row.evaluation.accuracy_percent}%` : "未評価"}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-emerald-300">
                    {row.evaluation && Number.isFinite(row.evaluation.cer) ? `${(row.evaluation.cer * 100).toFixed(1)}%` : "未評価"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      compact
                      title="比較可能なモデルがありません"
                      description="モデル管理で学習・評価を行うと、ここに表示されます。"
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={checkAndConfirmEvaluation} disabled={selected.length === 0}>
            評価結果を確認（{selected.length}件選択中）
          </Button>
          {missingEvalNames.length > 0 ? (
            <span className="text-[12px] text-amber-200">
              評価結果がありません: {missingEvalNames.join(", ")}
              {onOpenEvaluation ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-2 h-6 px-2 text-[11px]"
                  onClick={() => onOpenEvaluation(missingEvalNames[0])}
                >
                  評価を実行しますか？
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      </Card>

      {selectedRows.length > 0 ? (
        <>
          <Card
            title={`比較（${selectedRows.length}件）`}
            subtitle="🏆は各項目の最良値。Precision/Recall/F1/WER/推論速度は既存の評価ロジックに算出処理が無いため「未対応」表示です"
            actions={
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={exportCsv}>
                  CSV出力
                </Button>
                <Button size="sm" variant="secondary" onClick={exportMarkdown}>
                  Markdown出力
                </Button>
                <Button size="sm" variant="secondary" onClick={exportJson}>
                  JSON出力
                </Button>
              </div>
            }
          >
            <div className="comparison-table-wrap overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className="min-w-[120px] px-2 py-1.5 text-left text-muted"></th>
                    {selectedRows.map((row) => (
                      <th key={row.model_name} className="whitespace-nowrap px-2 py-1.5 text-left text-text">
                        {row.model_name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((metricRow) => (
                    <tr key={metricRow.metric.key} className="border-t border-border/50">
                      <td className="px-2 py-1.5 text-muted">{metricRow.metric.label}</td>
                      {selectedRows.map((row, index) => {
                        const entry = comparison.columns[index]?.latest;
                        const isBest = metricRow.values[index] !== null && metricRow.values[index] === metricRow.best;
                        return (
                          <td key={row.model_name} className={`px-2 py-1.5 ${isBest ? "font-semibold text-emerald-300" : "text-text"}`}>
                            {isBest ? "🏆" : ""}
                            {formatMetricValue(metricRow.metric, entry)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-t border-border/50">
                    <td className="px-2 py-1.5 text-muted">モデルサイズ</td>
                    {selectedRows.map((row) => {
                      const isBest = Number.isFinite(row.model_size_mb) && row.model_size_mb === Math.min(...selectedRows.map((r) => (Number.isFinite(r.model_size_mb) ? r.model_size_mb : Infinity)));
                      return (
                        <td key={row.model_name} className={`px-2 py-1.5 ${isBest ? "font-semibold text-emerald-300" : "text-text"}`}>
                          {isBest ? "🏆" : ""}
                          {Number.isFinite(row.model_size_mb) ? `${row.model_size_mb}MB` : "未記録"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-t border-border/50">
                    <td className="px-2 py-1.5 text-muted">Engine</td>
                    {selectedRows.map((row) => (
                      <td key={row.model_name} className="px-2 py-1.5 text-text">
                        {row.engine}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t border-border/50">
                    <td className="px-2 py-1.5 text-muted">前処理Version</td>
                    {selectedRows.map((row) => (
                      <td key={row.model_name} className="px-2 py-1.5 text-text">
                        {row.preprocess_version ? `v${row.preprocess_version}` : "未記録"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t border-border/50">
                    <td className="px-2 py-1.5 text-muted">Dataset</td>
                    {selectedRows.map((row) => (
                      <td key={row.model_name} className="px-2 py-1.5 text-text">
                        {row.dataset_name || "未記録"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t border-border/50">
                    <td className="px-2 py-1.5 text-muted">Experiment</td>
                    {selectedRows.map((row) => (
                      <td key={row.model_name} className="px-2 py-1.5 text-text">
                        {row.experiment_id || "未記録"}
                      </td>
                    ))}
                  </tr>
                  {UNAVAILABLE_ROWS.map((r) => (
                    <tr key={r.key} className="border-t border-border/50">
                      <td className="px-2 py-1.5 text-muted">{r.label}</td>
                      {selectedRows.map((row) => (
                        <td key={row.model_name} className="px-2 py-1.5 text-muted">
                          未対応
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                className="app-input h-8 flex-1 text-xs"
                placeholder="比較条件の表示名（任意）"
                value={comparisonName}
                onChange={(e) => setComparisonName(e.target.value)}
              />
              <Button size="sm" variant="secondary" onClick={saveComparison} disabled={saving}>
                {saving ? "保存中..." : "比較条件を保存"}
              </Button>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="レーダーチャート" subtitle="完全一致率・CER精度・文字正解率（Precision/Recall/F1は既存ロジックが無く未対応）">
              <RadarChart series={radarSeries} />
            </Card>
            <Card title="推移グラフ" subtitle="Experiment順のAccuracy/CER">
              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-lg border border-border bg-card/45 p-2">
                  <p className="mb-1 text-[11px] font-semibold text-muted">Accuracy推移</p>
                  <TrendChart points={trend.map((t) => ({ id: t.experimentId, value: t.accuracyPercent }))} stroke="#60a5fa" />
                </div>
                <div className="rounded-lg border border-border bg-card/45 p-2">
                  <p className="mb-1 text-[11px] font-semibold text-muted">CER推移</p>
                  <TrendChart points={trend.map((t) => ({ id: t.experimentId, value: t.cerPercent })).filter((p) => p.value !== null)} stroke="#34d399" />
                </div>
              </div>
            </Card>
          </div>

          <Card title="モデル推薦" subtitle="既存の推薦ロジック（勝敗集計・最良値抽出）をそのまま利用します。新しいAIロジックは使用しません">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {overallBest ? (
                <div className="rounded-lg border border-amber-400/40 bg-amber-400/5 px-2.5 py-2">
                  <p className="text-[11px] text-amber-200">総合</p>
                  <p className="text-[13px] text-text">
                    {overallBest.model}
                    <span className="ml-1 text-muted">（{overallBest.reasons.join("・") || `${overallBest.wins}勝`}）</span>
                  </p>
                </div>
              ) : null}
              {recommendations.map((card) => (
                <div key={card.id} className="rounded-lg border border-amber-400/40 bg-amber-400/5 px-2.5 py-2">
                  <p className="text-[11px] text-amber-200">{card.title}</p>
                  <p className="text-[13px] text-text">
                    {card.modelName}
                    <span className="ml-1 text-muted">（{card.value}）</span>
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}

      <Card title={`Benchmark履歴（${comparisons.length}件）`} subtitle="保存した比較条件のみ（評価結果自体は保存していません）">
        <div className={`max-h-[30vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                <th className="px-1.5 py-1.5 font-medium">Benchmark</th>
                <th className="px-1.5 py-1.5 font-medium">名前</th>
                <th className="px-1.5 py-1.5 font-medium">Dataset</th>
                <th className="px-1.5 py-1.5 font-medium">Models</th>
                <th className="px-1.5 py-1.5 font-medium">実行日</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((item) => (
                <tr key={item.comparison_id} className="border-t border-border/60">
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-blue-200">{item.comparison_id}</td>
                  <td className="px-1.5 py-1.5 text-text">{item.name || "-"}</td>
                  <td className="px-1.5 py-1.5 text-muted">{(item.dataset_ids || []).join(", ") || "-"}</td>
                  <td className="min-w-0 max-w-[16rem] truncate px-1.5 py-1.5 text-muted" title={(item.model_names || []).join(", ")}>
                    {(item.model_names || []).join(", ") || "-"}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-muted">{formatDateTime(item.created_at)}</td>
                </tr>
              ))}
              {comparisons.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState compact title="Benchmark履歴がありません" description="比較条件を保存すると、ここに表示されます。" />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
