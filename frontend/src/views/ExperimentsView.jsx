import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import ModelIdBadge from "../components/ModelIdBadge";
import {
  DIFF_CATEGORIES,
  EXCLUSION_LABELS,
  analysisExclusionReason,
  augmentationImprovement,
  bestExperiment,
  buildExperimentDiff,
  buildExperimentRecommendations,
  buildGroupColorMap,
  buildScatter,
  buildTrendSeries,
  collectComparableGroups,
  collectFilterOptions,
  comparisonQuality,
  comparisonWarning,
  experimentsToCsvLines,
  filterExperiments,
  iterationCorrelation,
  normalizeExperiment,
  preprocessGroups,
  resolveAnalysisScope,
} from "../lib/experimentAnalysis";

// Scientific Mode（比較可能Experimentのみ分析）の保存キー（プロジェクト別・既定ON）
const SCIENTIFIC_MODE_STORAGE_KEY = "ocr_experiment_scientific_mode_by_project_v1";

function readScientificMode(projectId) {
  try {
    const map = JSON.parse(localStorage.getItem(SCIENTIFIC_MODE_STORAGE_KEY) || "{}");
    return map?.[projectId] !== false; // 既定ON（明示的にOFF保存時のみOFF）
  } catch {
    return true;
  }
}

function writeScientificMode(projectId, value) {
  try {
    const map = JSON.parse(localStorage.getItem(SCIENTIFIC_MODE_STORAGE_KEY) || "{}");
    map[projectId] = value === true;
    localStorage.setItem(SCIENTIFIC_MODE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage不可環境では保存なしで継続
  }
}

// 内部スクロール領域の共通クラス
const SCROLL_AREA = "dark-scroll [overscroll-behavior:contain] [scrollbar-gutter:stable]";
// 比較対象の実験識別色（モデル比較と同系統の固定色）
const EXP_COLORS = ["#60a5fa", "#fb923c", "#c084fc", "#34d399"];

function pct(value, digits = 1) {
  return value === null || value === undefined ? "未評価" : `${(value * 100).toFixed(digits)}%`;
}

function dateLabel(value) {
  return value ? String(value).slice(0, 16).replace("T", " ") : "-";
}

// 折れ線グラフ（SVG手書き・依存なし）。points=[{id, value, group?}]。
// colorOf指定時はComparable Groupごとに点を色分けする（線は共通のグレー）
function LineChart({ points, unit = "%", stroke = "#60a5fa", colorOf = null }) {
  if (!points || points.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-muted">評価済みの実験がありません</p>;
  }
  const w = 340;
  const h = 130;
  const pad = { left: 10, right: 34, top: 14, bottom: 20 };
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => pad.left + (points.length === 1 ? (w - pad.left - pad.right) / 2 : (i * (w - pad.left - pad.right)) / (points.length - 1));
  const y = (v) => pad.top + ((max - v) / span) * (h - pad.top - pad.bottom);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const showLabels = points.length <= 8;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="推移グラフ">
      <path d={path} fill="none" stroke={colorOf ? "#64748b" : stroke} strokeWidth="2" />
      {points.map((p, i) => (
        <g key={p.id}>
          <circle cx={x(i)} cy={y(p.value)} r="3" fill={colorOf ? colorOf(p) : stroke} />
          {showLabels ? (
            <text x={x(i)} y={y(p.value) - 6} textAnchor="middle" fontSize="9" fill="#cbd5e1">
              {p.value.toFixed(1)}
              {unit}
            </text>
          ) : null}
          {showLabels ? (
            <text x={x(i)} y={h - 6} textAnchor="middle" fontSize="8" fill="#8b98a5">
              {p.id.replace("EXP-", "#")}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

// 散布図（Iteration×CER / Aug倍率×CER）。points=[{id, x, y}]
function ScatterChart({ points, xFormat = (v) => v.toLocaleString("ja-JP"), fill = "#60a5fa" }) {
  if (!points || points.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-muted">評価済みの実験がありません</p>;
  }
  const w = 340;
  const h = 130;
  const pad = { left: 14, right: 20, top: 14, bottom: 22 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
  const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const x = (v) => pad.left + ((v - xMin) / xSpan) * (w - pad.left - pad.right);
  const y = (v) => pad.top + ((yMax - v) / ySpan) * (h - pad.top - pad.bottom);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="散布図">
      {points.map((p) => (
        <g key={`${p.id}-${p.x}`}>
          <circle cx={x(p.x)} cy={y(p.y)} r="3.5" fill={fill} fillOpacity="0.85">
            <title>{`${p.id}: x=${xFormat(p.x)} / CER ${p.y.toFixed(1)}%`}</title>
          </circle>
        </g>
      ))}
      <text x={pad.left} y={h - 6} fontSize="8" fill="#8b98a5">
        {xFormat(xMin)}
      </text>
      <text x={w - pad.right} y={h - 6} textAnchor="end" fontSize="8" fill="#8b98a5">
        {xFormat(xMax)}
      </text>
      <text x={pad.left} y={pad.top - 4} fontSize="8" fill="#8b98a5">
        CER {yMax.toFixed(1)}%〜{yMin.toFixed(1)}%
      </text>
    </svg>
  );
}

export default function ExperimentsView({
  projectId,
  experiments = [],
  loading = false,
  onRefresh,
  onUpdateExperiment,
  onToggleAnalysis,
  onOpenModel,
  focusExperimentId = "",
}) {
  const items = useMemo(() => experiments.map(normalizeExperiment), [experiments]);
  const options = useMemo(() => collectFilterOptions(items), [items]);
  // Scientific Mode（ON=比較可能Experimentのみ分析 / OFF=全Experiment対象）と分析グループ選択
  const [scientificMode, setScientificMode] = useState(() => readScientificMode(projectId));
  const [analysisGroupId, setAnalysisGroupId] = useState("");
  const [showAllTrend, setShowAllTrend] = useState(false);
  useEffect(() => {
    setScientificMode(readScientificMode(projectId));
    setAnalysisGroupId("");
  }, [projectId]);
  function toggleScientificMode(value) {
    setScientificMode(value);
    writeScientificMode(projectId, value);
  }
  const groupList = useMemo(() => collectComparableGroups(items), [items]);
  const groupColors = useMemo(() => buildGroupColorMap(items), [items]);
  const [filters, setFilters] = useState({
    query: "",
    iterMin: "",
    iterMax: "",
    cerMax: "",
    augPreset: "",
    preprocessHash: "",
    dateFrom: "",
    dateTo: "",
    tag: "",
    favoriteOnly: false,
  });
  const [selected, setSelected] = useState([]);
  const focusRef = useRef(null);

  const filtered = useMemo(() => filterExperiments(items, filters), [items, filters]);
  const selectedExperiments = useMemo(
    () => selected.map((id) => items.find((e) => e.id === id)).filter(Boolean),
    [selected, items]
  );
  const diffRows = useMemo(() => buildExperimentDiff(selectedExperiments), [selectedExperiments]);
  const compareWarning = useMemo(() => comparisonWarning(selectedExperiments), [selectedExperiments]);
  const compareQuality = useMemo(() => comparisonQuality(selectedExperiments), [selectedExperiments]);
  // 分析スコープ（Scientific Mode ON=選択Comparable Group内の分析対象実験のみ / OFF=全Experiment）
  const scope = useMemo(
    () => resolveAnalysisScope(items, { scientificMode, groupId: analysisGroupId }),
    [items, scientificMode, analysisGroupId]
  );
  const scopeItems = scope.items;
  // CER推移は既定でComparable Group内のみ。「全Experimentを表示」でグループ色分けの全体表示へ
  const trendItems = showAllTrend || !scientificMode ? items : scopeItems;
  const trendColorOf = showAllTrend || !scientificMode ? (p) => groupColors[p.group] || "#94a3b8" : null;
  const cerTrend = useMemo(() => buildTrendSeries(trendItems, "cer"), [trendItems]);
  const accTrend = useMemo(() => buildTrendSeries(trendItems, "accuracy"), [trendItems]);
  const iterScatter = useMemo(() => buildScatter(scopeItems, "iterations"), [scopeItems]);
  const augScatter = useMemo(() => buildScatter(scopeItems, "aug"), [scopeItems]);
  const iterCorr = useMemo(() => iterationCorrelation(scopeItems), [scopeItems]);
  const augImpact = useMemo(() => augmentationImprovement(scopeItems), [scopeItems]);
  const preGroups = useMemo(() => preprocessGroups(scopeItems), [scopeItems]);
  const best = useMemo(() => bestExperiment(scopeItems), [scopeItems]);
  const overallBest = useMemo(() => bestExperiment(items), [items]);
  const recommendations = useMemo(() => buildExperimentRecommendations(scopeItems), [scopeItems]);
  const recommendationInsufficient = scope.scientific && scope.basisCount < 5;

  // モデルカルテからの遷移: 対象実験を選択状態にしてスクロール
  useEffect(() => {
    if (!focusExperimentId) return;
    setSelected((prev) => (prev.includes(focusExperimentId) ? prev : [focusExperimentId, ...prev].slice(0, 4)));
    focusRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [focusExperimentId]);

  function patchFilter(patch) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function toggleSelect(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id].slice(-4)));
  }

  function editTags(experiment) {
    const next = window.prompt(
      "タグ（カンマ区切り。例: Baseline, Best, 失敗, Aug試験, 前処理試験, OCR改善）",
      experiment.tags.join(", ")
    );
    if (next === null) return;
    const tags = next
      .split(/[,、]/)
      .map((t) => t.trim())
      .filter(Boolean);
    onUpdateExperiment?.(experiment.id, { tags });
  }

  function exportCsv() {
    const lines = experimentsToCsvLines(filtered);
    // BOM付きUTF-8（Excelでそのまま開ける）
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `experiments_${projectId || "default"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const colorOf = (id) => EXP_COLORS[selected.indexOf(id)] || "#60a5fa";

  return (
    <div className="space-y-4">
      {/* ① 実験一覧（フィルタ・タグ・★・CSV） */}
      <Card
        title={`実験一覧（${filtered.length} / ${items.length}件）`}
        subtitle="学習実行ごとの実験カルテ。行のチェックで比較対象を選択（最大4件）"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={filtered.length === 0}>
              CSV / Excel出力
            </Button>
            <Button size="sm" variant="secondary" onClick={onRefresh} disabled={loading}>
              {loading ? "更新中..." : "更新"}
            </Button>
          </div>
        }
      >
        {/* フィルタ（Iteration / CER / Aug / 前処理 / モデル / 日付 / タグ / ★） */}
        <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          <input
            className="app-input col-span-2 h-8 text-xs"
            placeholder="検索（EXP / モデル / 管理No / タグ / メモ）"
            value={filters.query}
            onChange={(e) => patchFilter({ query: e.target.value })}
          />
          <div className="flex items-center gap-1">
            <input
              className="app-input h-8 min-w-0 text-xs"
              placeholder="Iter最小"
              value={filters.iterMin}
              onChange={(e) => patchFilter({ iterMin: e.target.value })}
            />
            <span className="text-xs text-muted">〜</span>
            <input
              className="app-input h-8 min-w-0 text-xs"
              placeholder="最大"
              value={filters.iterMax}
              onChange={(e) => patchFilter({ iterMax: e.target.value })}
            />
          </div>
          <input
            className="app-input h-8 text-xs"
            placeholder="CER上限%（例:35）"
            value={filters.cerMax}
            onChange={(e) => patchFilter({ cerMax: e.target.value })}
          />
          <select className="app-select h-8 text-xs" value={filters.augPreset} onChange={(e) => patchFilter({ augPreset: e.target.value })}>
            <option value="">Aug: すべて</option>
            <option value="none">Aug: なし</option>
            {options.augPresets.map((p) => (
              <option key={p} value={p}>
                Aug: {p}
              </option>
            ))}
          </select>
          <select
            className="app-select h-8 text-xs"
            value={filters.preprocessHash}
            onChange={(e) => patchFilter({ preprocessHash: e.target.value })}
          >
            <option value="">前処理: すべて</option>
            {options.preprocessHashes.map((row) => (
              <option key={row.hash} value={row.hash}>
                前処理: {row.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input
              type="date"
              className="app-input h-8 min-w-0 text-xs"
              value={filters.dateFrom}
              onChange={(e) => patchFilter({ dateFrom: e.target.value })}
            />
            <span className="text-xs text-muted">〜</span>
            <input
              type="date"
              className="app-input h-8 min-w-0 text-xs"
              value={filters.dateTo}
              onChange={(e) => patchFilter({ dateTo: e.target.value })}
            />
          </div>
          <select className="app-select h-8 text-xs" value={filters.tag} onChange={(e) => patchFilter({ tag: e.target.value })}>
            <option value="">タグ: すべて</option>
            {options.tags.map((t) => (
              <option key={t} value={t}>
                タグ: {t}
              </option>
            ))}
          </select>
          <label className="inline-flex h-8 items-center gap-1.5 text-xs text-text">
            <input type="checkbox" checked={filters.favoriteOnly} onChange={(e) => patchFilter({ favoriteOnly: e.target.checked })} />
            ★のみ
          </label>
        </div>

        <div className={`max-h-[46vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                <th className="px-1.5 py-1.5 font-medium">比較</th>
                <th className="px-1.5 py-1.5 font-medium">★</th>
                <th className="px-1.5 py-1.5 font-medium">実験ID</th>
                <th className="px-1.5 py-1.5 font-medium" title="Comparable Group（Evaluation Hash単位の比較可能グループ）">CG</th>
                <th className="px-1.5 py-1.5 font-medium" title="分析対象（推薦・相関へ使用。失敗・デバッグ実験はOFFにできます）">分析</th>
                <th className="px-1.5 py-1.5 font-medium">日時</th>
                <th className="px-1.5 py-1.5 font-medium">生成モデル</th>
                <th className="px-1.5 py-1.5 font-medium">Iteration</th>
                <th className="px-1.5 py-1.5 font-medium">Aug</th>
                <th className="px-1.5 py-1.5 font-medium">前処理</th>
                <th className="px-1.5 py-1.5 font-medium">CER</th>
                <th className="px-1.5 py-1.5 font-medium">文字</th>
                <th className="px-1.5 py-1.5 font-medium">一致</th>
                <th className="px-1.5 py-1.5 font-medium">タグ</th>
                <th className="px-1.5 py-1.5 font-medium">実験名 / メモ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  ref={e.id === focusExperimentId ? focusRef : undefined}
                  className={`border-t border-border/60 ${
                    selected.includes(e.id) ? "bg-accent/10" : e.id === focusExperimentId ? "bg-amber-400/10" : ""
                  }`}
                >
                  <td className="px-1.5 py-1.5">
                    <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggleSelect(e.id)} aria-label={`${e.id} を比較対象に選択`} />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <button
                      type="button"
                      className={`text-sm ${e.favorite ? "text-amber-300" : "text-muted/50 hover:text-amber-200"}`}
                      onClick={() => onUpdateExperiment?.(e.id, { favorite: !e.favorite })}
                      title={e.favorite ? "★固定を解除" : "重要実験として★固定"}
                    >
                      ★
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5">
                    <span className="model-id-font model-id-text--sm text-blue-200">{e.id}</span>
                    {e.source === "backfill" ? (
                      <span
                        className="ml-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-1 py-0.5 text-[9px] text-amber-200"
                        title="旧モデルから自動生成された実験（Source: Backfill）。既定で分析対象外です"
                      >
                        Backfill
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5">
                    {e.comparableGroup ? (
                      <span
                        className="model-id-font model-id-text--sm"
                        style={{ color: groupColors[e.comparableGroup] || "#94a3b8" }}
                        title={`Evaluation Hash: ${e.evaluationHash}`}
                      >
                        {e.comparableGroup}
                      </span>
                    ) : (
                      <span className="text-muted/60" title="評価未実施またはHash生成不可のためグループなし">-</span>
                    )}
                  </td>
                  <td className="px-1.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={e.analysisEnabled}
                      onChange={(event) => onToggleAnalysis?.(e.id, event.target.checked)}
                      title={
                        e.analysisEnabled
                          ? "分析対象（推薦・相関へ使用中）"
                          : `分析対象外${analysisExclusionReason(e) ? `（${EXCLUSION_LABELS[analysisExclusionReason(e)] || ""}）` : ""}`
                      }
                      aria-label={`${e.id} を分析対象にする`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-muted">{dateLabel(e.createdAt)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5">
                    {e.models.map((model, i) => (
                      <button
                        key={model}
                        type="button"
                        className="mr-1 inline-flex items-center gap-1 rounded border border-border/70 px-1 py-0.5 transition hover:border-accent/60"
                        onClick={() => onOpenModel?.(model)}
                        title={`モデル管理でこのモデルを開く: ${model}`}
                      >
                        <ModelIdBadge modelId={e.modelIds[i] || ""} size="sm" />
                        {!e.modelIds[i] ? <span className="max-w-[9rem] truncate text-muted">{model}</span> : null}
                      </button>
                    ))}
                  </td>
                  <td className="px-1.5 py-1.5 text-text">{e.iterations === null ? "未記録" : e.iterations.toLocaleString("ja-JP")}</td>
                  <td className="min-w-0 max-w-[9rem] truncate px-1.5 py-1.5 text-muted" title={e.augSummary}>
                    {e.augSummary}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-muted" title={e.preprocessHash || "未記録"}>
                    {e.preprocessHash ? `${e.preprocessSummary || ""}（${e.preprocessShort}）` : "未記録"}
                  </td>
                  <td className="px-1.5 py-1.5 font-semibold text-emerald-300">{pct(e.cer)}</td>
                  <td className="px-1.5 py-1.5 text-text">{e.charAccuracy === null ? "-" : pct(e.charAccuracy)}</td>
                  <td className="px-1.5 py-1.5 text-text">{e.accuracyPercent === null ? "-" : `${e.accuracyPercent}%`}</td>
                  <td className="px-1.5 py-1.5">
                    <span className="flex flex-wrap items-center gap-1">
                      {e.tags.map((tag) => (
                        <span key={tag} className="rounded-full border border-border/70 bg-card/60 px-1.5 py-0.5 text-[10px] text-text">
                          {tag}
                        </span>
                      ))}
                      <button
                        type="button"
                        className="rounded border border-border/60 px-1 py-0.5 text-[10px] text-muted transition hover:border-accent/60 hover:text-accent"
                        onClick={() => editTags(e)}
                        title="タグを編集"
                      >
                        {e.tags.length === 0 ? "+タグ" : "編集"}
                      </button>
                    </span>
                  </td>
                  <td className="min-w-0 max-w-[14rem] truncate px-1.5 py-1.5 text-muted" title={`${e.name} ${e.note}`}>
                    {e.name || e.note || "-"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-3 py-6 text-center text-muted">
                    {items.length === 0 ? "実験がありません（Tesseract学習を実行すると自動記録されます）" : "条件に一致する実験がありません"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ② Experiment比較（変更された条件だけ強調・同じ値は薄く） */}
      {selectedExperiments.length >= 2 ? (
        <Card title={`Experiment比較（${selectedExperiments.map((e) => e.id).join(" / ")}）`} subtitle="変更された条件のみ強調表示します">
          {/* 比較可能判定（Evaluation Hash不一致=警告。比較自体は禁止しない）と比較品質★ */}
          {compareWarning ? (
            <div className="mb-2 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-200">
              {compareWarning}
            </div>
          ) : null}
          {compareQuality ? (
            <p className="mb-2 text-[13px]">
              <span className="text-muted">比較品質: </span>
              <span className="text-amber-300">{compareQuality.starsLabel}</span>
              <span className="ml-2 text-muted">{compareQuality.label}</span>
            </p>
          ) : null}
          <div className="comparison-table-wrap">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className="min-w-[120px] px-2 py-1.5 text-left text-muted"></th>
                  {selectedExperiments.map((e) => (
                    <th key={e.id} className="whitespace-nowrap px-2 py-1.5 text-left">
                      <span className="model-id-font model-id-text--md" style={{ color: colorOf(e.id) }}>
                        {e.id}
                      </span>
                      <span className="ml-1.5 text-[10px] font-normal text-muted">{dateLabel(e.createdAt)}</span>
                      {e.comparableGroup ? (
                        <span className="ml-1.5 text-[10px] font-normal" style={{ color: groupColors[e.comparableGroup] }}>
                          {e.comparableGroup}
                        </span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* 条件差分を 学習条件 / 前処理 / Aug / モデル / 評価条件 / その他 のカテゴリへ分類して表示 */}
                {DIFF_CATEGORIES.map((category) => {
                  const rows = diffRows.filter((row) => row.category === category);
                  if (rows.length === 0) return null;
                  return (
                    <Fragment key={category}>
                      <tr className="border-t border-border/70 bg-card/60">
                        <td colSpan={1 + selectedExperiments.length} className="px-2 py-1 text-[11px] font-semibold text-blue-300">
                          {category}
                        </td>
                      </tr>
                      {rows.map((row) => (
                        <tr key={row.key} className={`border-t border-border/50 ${row.changed ? "bg-amber-400/10" : ""}`}>
                          <td className={`px-2 py-1.5 ${row.changed ? "font-semibold text-amber-200" : "text-muted"}`}>
                            {row.changed ? "● " : ""}
                            {row.label}
                          </td>
                          {row.values.map((value, index) => (
                            <td
                              key={selectedExperiments[index].id}
                              className={`px-2 py-1.5 ${row.changed ? "font-semibold text-text" : "text-muted/60"}`}
                            >
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* ③ 分析設定（Scientific Mode・Comparable Group選択） */}
      <Card
        title="分析設定"
        subtitle="比較可能なExperimentだけを分析対象にすることで、信頼できる推薦・相関分析にします"
      >
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <label className="inline-flex items-center gap-1.5 text-text" title="ON=比較可能（同一評価条件）Experimentだけ分析 / OFF=全Experiment対象">
            <input type="checkbox" checked={scientificMode} onChange={(e) => toggleScientificMode(e.target.checked)} />
            Scientific Mode
          </label>
          {scientificMode ? (
            <select
              className="app-select h-8 w-auto text-xs"
              value={scope.groupId}
              onChange={(e) => setAnalysisGroupId(e.target.value)}
              aria-label="分析対象のComparable Group"
            >
              {groupList.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.id}（{group.count}件{group.dataset ? ` / ${group.dataset}` : ""}）
                </option>
              ))}
              {groupList.length === 0 ? <option value="">Comparable Groupなし</option> : null}
            </select>
          ) : null}
          <span className="text-muted">
            {scientificMode
              ? `分析対象: ${scope.groupId || "なし"} 内の比較可能Experiment ${scope.basisCount}件`
              : `分析対象: 全Experiment（評価条件の異なる実験が混在します）`}
          </span>
          {/* グラフ凡例: Comparable Groupの色分け */}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {groupList.map((group) => (
              <span key={group.id} className="inline-flex items-center gap-1 text-[11px]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: groupColors[group.id] }} />
                <span className="model-id-font model-id-text--sm" style={{ color: groupColors[group.id] }}>
                  {group.id}
                </span>
              </span>
            ))}
          </span>
        </div>
      </Card>

      {/* ④ 推移・相関・ベスト条件・条件推薦 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="推移グラフ"
          subtitle={showAllTrend || !scientificMode ? "全Experiment（Comparable Groupで色分け）" : `${scope.groupId || "グループなし"} 内のみ表示`}
          actions={
            scientificMode ? (
              <label className="inline-flex items-center gap-1.5 text-xs text-text">
                <input type="checkbox" checked={showAllTrend} onChange={(e) => setShowAllTrend(e.target.checked)} />
                全Experimentを表示
              </label>
            ) : null
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card/45 p-2">
              <p className="mb-1 text-[11px] font-semibold text-muted">CER推移（低いほど良い）</p>
              <LineChart points={cerTrend} stroke="#34d399" colorOf={trendColorOf} />
            </div>
            <div className="rounded-lg border border-border bg-card/45 p-2">
              <p className="mb-1 text-[11px] font-semibold text-muted">完全一致率推移</p>
              <LineChart points={accTrend} stroke="#60a5fa" colorOf={trendColorOf} />
            </div>
            <div className="rounded-lg border border-border bg-card/45 p-2">
              <p className="mb-1 text-[11px] font-semibold text-muted">Iteration × CER</p>
              <ScatterChart points={iterScatter} />
            </div>
            <div className="rounded-lg border border-border bg-card/45 p-2">
              <p className="mb-1 text-[11px] font-semibold text-muted">Aug倍率 × CER（なし=1.0）</p>
              <ScatterChart points={augScatter} xFormat={(v) => `${v.toFixed(1)}倍`} fill="#fb923c" />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card
            title="学習条件との相関（簡易分析）"
            subtitle={`${scientificMode ? `${scope.groupId || "グループなし"} 内の比較可能Experimentのみ` : "全Experiment"}の差分集計です（統計学的検定はしていません）`}
          >
            <div className="space-y-2 text-[13px]">
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2">
                <p className="font-semibold text-text">Iteration増加とCER</p>
                {iterCorr.available ? (
                  <p className="text-muted">
                    {iterCorr.direction}　<span className="text-amber-300">{iterCorr.starsLabel}</span>
                    <span className="ml-2 text-[11px]">（相関係数 r={iterCorr.r} / {iterCorr.count}件）</span>
                  </p>
                ) : (
                  <p className="text-muted">評価済み実験が2件未満のため算出できません</p>
                )}
              </div>
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2">
                <p className="font-semibold text-text">Augmentationの平均改善</p>
                {augImpact.available ? (
                  <p className="text-muted">
                    Augあり平均 − なし平均: <span className={augImpact.deltaPt > 0 ? "text-success" : "text-danger"}>{augImpact.label}</span>
                    <span className="ml-2 text-[11px]">（あり{augImpact.withCount}件 / なし{augImpact.withoutCount}件）</span>
                  </p>
                ) : (
                  <p className="text-muted">Augあり・なし双方の評価済み実験が必要です</p>
                )}
              </div>
              <div className="rounded-lg border border-border bg-card/45 px-3 py-2">
                <p className="font-semibold text-text">前処理別の平均CER</p>
                {preGroups.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    {preGroups.slice(0, 4).map((g) => (
                      <p key={g.hash} className="text-muted">
                        {g.summary || g.short}（{g.count}件）: <span className="text-text">{g.meanCerPercent}%</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted">前処理記録つきの評価済み実験がありません</p>
                )}
              </div>
            </div>
          </Card>

          <Card title="ベスト条件" subtitle="最もCERが良かった実験の条件（グループベスト / 全体ベスト）">
            {best ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                <span className="text-muted">{scientificMode ? `グループベスト（${scope.groupId}）` : "ベスト実験"}</span>
                <span className="model-id-font text-blue-200">{best.id}</span>
                <span className="text-muted">CER</span>
                <span className="font-semibold text-emerald-300">{pct(best.cer)}</span>
                <span className="text-muted">Iteration</span>
                <span className="text-text">{best.iterations === null ? "未記録" : best.iterations.toLocaleString("ja-JP")}</span>
                <span className="text-muted">Aug</span>
                <span className="text-text">{best.augSummary}</span>
                <span className="text-muted">前処理</span>
                <span className="text-text">{best.preprocessSummary || best.preprocessShort || "未記録"}</span>
                <span className="text-muted">Split</span>
                <span className="text-text">{best.splitRatioText || "未記録"}</span>
              </div>
            ) : (
              <p className="text-[13px] text-muted">分析対象内に評価済みの実験がありません</p>
            )}
            {scientificMode && overallBest && overallBest.id !== best?.id ? (
              <p className="mt-2 border-t border-border/50 pt-2 text-[12px] text-muted">
                全体ベスト: <span className="model-id-font text-blue-200">{overallBest.id}</span>（CER {pct(overallBest.cer)}・
                {overallBest.comparableGroup || "グループなし"}。評価条件が異なるため直接比較できません）
              </p>
            ) : null}
          </Card>

          <Card title="条件推薦" subtitle="比較可能Experimentから生成したルールベースの推薦です（性能向上を保証しません）">
            {/* Recommendation Safety: 推薦根拠の比較可能Experiment数を必ず表示。5件未満は参考値 */}
            <div className="mb-2 rounded-lg border border-border/70 bg-card/60 px-3 py-2 text-[12px]">
              <p className="text-muted">
                推薦根拠: Comparable Experiment{" "}
                <span className="font-semibold text-text">{scientificMode ? scope.basisCount : scopeItems.filter((e) => e.cer !== null).length}件</span>
                {recommendationInsufficient ? (
                  <span className="ml-2 rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
                    参考値（データ不足）
                  </span>
                ) : null}
              </p>
              {scientificMode ? (
                <p className="mt-0.5 text-muted">
                  この推薦は{scope.basisCount}件の比較可能Experiment（{scope.groupId || "なし"}）から生成されています。
                </p>
              ) : (
                <p className="mt-0.5 text-amber-200/90">Scientific Mode OFF: 評価条件の異なる実験が混在した参考値です。</p>
              )}
            </div>
            {recommendations.length > 0 ? (
              <div className="space-y-2">
                {recommendations.map((card) => (
                  <div key={card.id} className="rounded-lg border border-border bg-card/45 px-3 py-2">
                    <p className="text-[13px] font-semibold text-text">
                      {card.title}: <span className="text-blue-200">{card.value}</span>
                    </p>
                    <p className="text-[12px] text-muted">理由: {card.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-muted">分析対象内に評価済みの実験が2件以上になると表示されます</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
