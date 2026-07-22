import { useEffect, useMemo, useRef, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import ModelIdBadge from "../components/ModelIdBadge";
import {
  bestExperiment,
  augmentationImprovement,
  buildExperimentDiff,
  buildExperimentRecommendations,
  buildScatter,
  buildTrendSeries,
  collectFilterOptions,
  experimentsToCsvLines,
  filterExperiments,
  iterationCorrelation,
  normalizeExperiment,
  preprocessGroups,
} from "../lib/experimentAnalysis";

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

// 折れ線グラフ（SVG手書き・依存なし）。points=[{id, value}]
function LineChart({ points, unit = "%", stroke = "#60a5fa" }) {
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
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" />
      {points.map((p, i) => (
        <g key={p.id}>
          <circle cx={x(i)} cy={y(p.value)} r="3" fill={stroke} />
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
  onOpenModel,
  focusExperimentId = "",
}) {
  const items = useMemo(() => experiments.map(normalizeExperiment), [experiments]);
  const options = useMemo(() => collectFilterOptions(items), [items]);
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
  const cerTrend = useMemo(() => buildTrendSeries(filtered, "cer"), [filtered]);
  const accTrend = useMemo(() => buildTrendSeries(filtered, "accuracy"), [filtered]);
  const iterScatter = useMemo(() => buildScatter(filtered, "iterations"), [filtered]);
  const augScatter = useMemo(() => buildScatter(filtered, "aug"), [filtered]);
  const iterCorr = useMemo(() => iterationCorrelation(filtered), [filtered]);
  const augImpact = useMemo(() => augmentationImprovement(filtered), [filtered]);
  const preGroups = useMemo(() => preprocessGroups(filtered), [filtered]);
  const best = useMemo(() => bestExperiment(filtered), [filtered]);
  const recommendations = useMemo(() => buildExperimentRecommendations(items), [items]);

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
                    <span className="model-id-font model-id-text--sm text-blue-200" title={`source: ${e.source}`}>
                      {e.id}
                    </span>
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
                  <td colSpan={13} className="px-3 py-6 text-center text-muted">
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
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diffRows.map((row) => (
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
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* ③ 推移・相関・ベスト条件・条件推薦 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="推移グラフ" subtitle="フィルタ中の実験をExperiment順に表示">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card/45 p-2">
              <p className="mb-1 text-[11px] font-semibold text-muted">CER推移（低いほど良い）</p>
              <LineChart points={cerTrend} stroke="#34d399" />
            </div>
            <div className="rounded-lg border border-border bg-card/45 p-2">
              <p className="mb-1 text-[11px] font-semibold text-muted">完全一致率推移</p>
              <LineChart points={accTrend} stroke="#60a5fa" />
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
          <Card title="学習条件との相関（簡易分析）" subtitle="過去実験の差分集計です（統計学的検定はしていません）">
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

          <Card title="ベスト条件" subtitle="最もCERが良かった実験の条件">
            {best ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                <span className="text-muted">実験</span>
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
              <p className="text-[13px] text-muted">評価済みの実験がありません</p>
            )}
          </Card>

          <Card title="条件推薦" subtitle="実験履歴から生成したルールベースの推薦です（性能向上を保証しません）">
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
              <p className="text-[13px] text-muted">評価済みの実験が2件以上になると表示されます</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
