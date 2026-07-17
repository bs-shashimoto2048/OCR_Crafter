// モデル比較（CER中心）の純ロジック。
// 最新評価履歴（lib/modelEval.js で正規化済み）から比較テーブル・勝敗表・推奨モデルを組み立てる。
// Accuracy（完全一致率）は業務指標として比較項目に残すが、順位決定はAccuracy単独では行わない。

import { latestEvalOf } from "./modelEval.js";

// 比較項目定義（better: min=小さいほど良い / max=大きいほど良い）
export const COMPARE_METRICS = [
  { key: "cer", label: "CER", better: "min", kind: "ratioPct" },
  { key: "charAccuracy", label: "文字正解率", better: "max", kind: "ratioPct" },
  { key: "percent", label: "完全一致率", better: "max", kind: "percent" },
  { key: "correct", label: "正解/総数", better: "max", kind: "correctTotal" },
  { key: "cerRelativeImprovement", label: "CER改善率", better: "max", kind: "ratioPct" },
  { key: "improved", label: "改善件数", better: "max", kind: "count" },
  { key: "regressed", label: "悪化件数", better: "min", kind: "count" },
  { key: "perfectFixed", label: "完全一致へ改善", better: "max", kind: "count" },
  { key: "perfectRegressed", label: "完全一致から悪化", better: "min", kind: "count" },
];

// 混同表示ラベル（脱落/挿入は∅で表現）
export function confusionLabel(c) {
  const from = String(c?.from || "") || "∅";
  const to = String(c?.to || "") || "∅";
  return `${from}→${to}`;
}

// 指標の数値（比較・最良判定用）。未記録はnull
export function metricValue(metric, entry) {
  if (!entry) return null;
  const value = metric.key === "correct" ? entry.correct : entry[metric.key];
  return Number.isFinite(value) ? value : null;
}

// 指標の表示文字列
export function formatMetricValue(metric, entry) {
  const value = metricValue(metric, entry);
  if (value === null) return "未記録";
  if (metric.kind === "ratioPct") return `${(value * 100).toFixed(1)}%`;
  if (metric.kind === "percent") return `${value}%`;
  if (metric.kind === "correctTotal") return entry.total === null ? `${value}` : `${value} / ${entry.total}`;
  return `${value}`;
}

// 比較テーブル: 各指標×各モデルの値と最良値（タイは全員ハイライト）
export function buildModelComparison(evalHistory, models) {
  const columns = (models || []).map((model) => ({ model, latest: latestEvalOf(evalHistory, model) }));
  const rows = COMPARE_METRICS.map((metric) => {
    const values = columns.map((col) => metricValue(metric, col.latest));
    const numeric = values.filter((v) => v !== null);
    const best =
      numeric.length > 0 ? (metric.better === "min" ? Math.min(...numeric) : Math.max(...numeric)) : null;
    return { metric, values, best };
  });
  return { columns, rows };
}

// 勝敗表: 指標ごとに最良のモデルへ1勝（2モデル以上に値があり、単独最良のときだけ勝者）
export function buildWinLoss(comparison) {
  const wins = Object.fromEntries(comparison.columns.map((col) => [col.model, 0]));
  const rows = comparison.rows.map((row) => {
    const numeric = row.values.map((value, index) => ({ value, index })).filter((x) => x.value !== null);
    let winner = null;
    if (numeric.length >= 2 && row.best !== null) {
      const holders = numeric.filter((x) => x.value === row.best);
      if (holders.length === 1) {
        winner = comparison.columns[holders[0].index].model;
        wins[winner] += 1;
      }
    }
    return { metric: row.metric, values: row.values, best: row.best, winner };
  });
  return { rows, wins };
}

// 推奨モデル: 勝利数最多 → タイはCER最小 → 文字正解率最大（Accuracy単独では決めない）。
// 理由 = 最良を取った指標の一覧
export function recommendModel(comparison, winLoss) {
  const candidates = comparison.columns.filter((col) => col.latest);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const winsA = winLoss.wins[a.model] || 0;
    const winsB = winLoss.wins[b.model] || 0;
    if (winsA !== winsB) return winsB - winsA;
    const cerA = Number.isFinite(a.latest.cer) ? a.latest.cer : Infinity;
    const cerB = Number.isFinite(b.latest.cer) ? b.latest.cer : Infinity;
    if (cerA !== cerB) return cerA - cerB;
    const charA = Number.isFinite(a.latest.charAccuracy) ? a.latest.charAccuracy : -1;
    const charB = Number.isFinite(b.latest.charAccuracy) ? b.latest.charAccuracy : -1;
    return charB - charA;
  });
  const model = sorted[0].model;
  const index = comparison.columns.findIndex((col) => col.model === model);
  const reasons = [];
  for (const row of comparison.rows) {
    const numeric = row.values.filter((v) => v !== null);
    if (numeric.length >= 2 && row.best !== null && row.values[index] === row.best) {
      reasons.push(`${row.metric.label}最良`);
    }
  }
  return { model, wins: winLoss.wins[model] || 0, reasons };
}

// 混同比較: 全モデルの混同上位を件数合計で統合し、モデル別件数を並べる。
// counts: 評価データがあるモデルは件数（未出現=0）、評価未実施はnull（-表示）
export function buildConfusionComparison(comparison, limit = 8) {
  const totals = new Map();
  for (const col of comparison.columns) {
    for (const c of col.latest?.confusions || []) {
      const key = `${c.kind}|${c.from}|${c.to}`;
      totals.set(key, (totals.get(key) || 0) + Number(c.count || 0));
    }
  }
  const keys = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
  return keys.map((key) => {
    const [kind, from, to] = key.split("|");
    const counts = comparison.columns.map((col) => {
      // 評価未実施・旧形式（CER未記録=混同データなし）はnull（-表示）。
      // 新形式でキー未出現は0件（起きなかった）として扱う
      if (!col.latest || col.latest.cer === null) return null;
      const hit = (col.latest.confusions || []).find((c) => c.kind === kind && c.from === from && c.to === to);
      return hit ? Number(hit.count) : 0;
    });
    return { kind, from, to, label: confusionLabel({ from, to }), counts };
  });
}
