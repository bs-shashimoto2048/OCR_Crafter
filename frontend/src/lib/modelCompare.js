// モデル比較（CER中心）の純ロジック。
// 最新評価履歴（lib/modelEval.js で正規化済み）から比較テーブル・勝敗表・推奨モデルを組み立てる。
// Accuracy（完全一致率）は業務指標として比較項目に残すが、順位決定はAccuracy単独では行わない。

import { latestEvalOf, whitelistLabelOf } from "./modelEval.js";
import { historyPreprocessLabel } from "./evalHistory.js";

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

// 比較モデルの固定識別色（表示順に割り当て: 1番目=ブルー / 2番目=オレンジ / 3番目=パープル。
// 暗色背景でコントラストを確保した色。評価結果の良否色（緑/赤）とは役割を分ける）
export const COMPARE_MODEL_COLORS = ["#60a5fa", "#fb923c", "#c084fc"];

// 比較表示順（index）→固定色。管理Noへ永続保存はせず、現在の比較配列の並びに対して割り当てる
// （同じ比較セッション内では配列が同じ順序のため、再描画しても色は変わらない）
export function compareModelColor(index) {
  return COMPARE_MODEL_COLORS[index] || COMPARE_MODEL_COLORS[COMPARE_MODEL_COLORS.length - 1];
}

// 比較対象配列→{モデル名: 色} のマップ。全セクションでこのマップを共有し、同じモデルは常に同じ色にする
export function buildCompareColorMap(models) {
  return Object.fromEntries((models || []).map((model, index) => [model, compareModelColor(index)]));
}

// 混同表示ラベル（実装は lib/confusionFormat.js。既存importの互換のため再exportする）
import { confusionLabel } from "./confusionFormat.js";
export { confusionLabel };

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

// 勝敗表（指標別結果）: 指標ごとに最良のモデルへ1勝。
// 【同率最良の扱い】2モデル以上に値があるとき、最良値を持つ全モデルを winners に併記し、
// **同率でも各モデルへ1勝ずつ与える**（「勝者なし」にはしない）。winner は単独最良時のみ設定（後方互換）。
export function buildWinLoss(comparison) {
  const wins = Object.fromEntries(comparison.columns.map((col) => [col.model, 0]));
  const rows = comparison.rows.map((row) => {
    const numeric = row.values.map((value, index) => ({ value, index })).filter((x) => x.value !== null);
    let winners = [];
    if (numeric.length >= 2 && row.best !== null) {
      winners = numeric.filter((x) => x.value === row.best).map((x) => comparison.columns[x.index].model);
      winners.forEach((model) => {
        wins[model] += 1;
      });
    }
    return { metric: row.metric, values: row.values, best: row.best, winners, winner: winners.length === 1 ? winners[0] : null };
  });
  return { rows, wins };
}

// 最良値との差分表示（主要指標カード用）。
// 未記録=null / 最良="最良" / それ以外=最良との符号付き差（ratioPct・percent=pt、count系=件）。
// CERのような min 指標では +1.9pt =「最良より1.9pt悪い」、max 指標では -1.9pt =「最良より1.9pt低い」。
export function formatBestDiff(metric, entry, best) {
  const value = metricValue(metric, entry);
  if (value === null || best === null) return null;
  if (value === best) return "最良";
  const diff = metric.kind === "ratioPct" ? (value - best) * 100 : value - best;
  const unit = metric.kind === "count" || metric.kind === "correctTotal" ? "件" : "pt";
  const rounded = Math.round(diff * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}${unit}`;
}

// 評価条件の比較行と一致判定。
// 警告対象（dataset / OCR前処理 / Whitelist / 評価画像数）がモデル間で異なれば mismatched へラベルを列挙。
// 評価データのあるモデルが2件未満なら判定不能（match=null）。旧形式で未記録の値も文字列比較の対象
// （「未記録」同士は一致扱い）。評価日時は表示のみで一致判定には含めない。
export function buildConditionComparison(comparison) {
  const defs = [
    { key: "dataset", label: "評価データセット", value: (latest) => latest.dataset || "未記録", check: true },
    { key: "total", label: "評価画像数", value: (latest) => (latest.total === null ? "未記録" : String(latest.total)), check: true },
    { key: "preprocess", label: "OCR前処理", value: (latest) => historyPreprocessLabel(latest), check: true },
    { key: "whitelist", label: "Whitelist", value: (latest) => whitelistLabelOf(latest.whitelist), check: true },
    { key: "at", label: "評価日時", value: (latest) => (latest.at ? latest.at.slice(5, 16).replace("T", " ") : "未記録"), check: false },
  ];
  const evaluated = comparison.columns.filter((col) => col.latest);
  const rows = defs.map((def) => ({
    key: def.key,
    label: def.label,
    values: comparison.columns.map((col) => (col.latest ? def.value(col.latest) : "—")),
  }));
  if (evaluated.length < 2) {
    return { rows, match: null, mismatched: [] };
  }
  const mismatched = defs
    .filter((def) => def.check)
    .filter((def) => new Set(evaluated.map((col) => def.value(col.latest))).size > 1)
    .map((def) => def.label);
  return { rows, match: mismatched.length === 0, mismatched };
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

// 混同比較: 全モデルの混同を件数合計で統合し、合計が多い順にモデル別件数を並べる
// （比較中は同じ混同が全モデルで同じ位置に並ぶ）。limit=Infinity で全件。
// counts: 評価データがあるモデルは件数（未出現=0）、評価未実施はnull（-表示）。
// total=全モデル合計、maxCount=全行の最大件数（横棒グラフのスケール基準）
export function buildConfusionComparison(comparison, limit = 8) {
  const totals = new Map();
  for (const col of comparison.columns) {
    for (const c of col.latest?.confusions || []) {
      const key = `${c.kind}|${c.from}|${c.to}`;
      totals.set(key, (totals.get(key) || 0) + Number(c.count || 0));
    }
  }
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const keys = (Number.isFinite(limit) ? entries.slice(0, limit) : entries).map(([key]) => key);
  return keys.map((key) => {
    const [kind, from, to] = key.split("|");
    const counts = comparison.columns.map((col) => {
      // 評価未実施・旧形式（CER未記録=混同データなし）はnull（-表示）。
      // 新形式でキー未出現は0件（起きなかった）として扱う
      if (!col.latest || col.latest.cer === null) return null;
      const hit = (col.latest.confusions || []).find((c) => c.kind === kind && c.from === from && c.to === to);
      return hit ? Number(hit.count) : 0;
    });
    return { kind, from, to, label: confusionLabel({ from, to }), counts, total: totals.get(key) || 0 };
  });
}
