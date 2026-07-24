// ダッシュボード「プロジェクト一覧」の純粋ロジック（状態バッジ・Best CER表示・現在の工程推定・
// クイックアクション有効判定・検索・ソート）。既存のsummaryProgress（DashboardView.jsx）とは別に、
// 一覧行専用の表示整形をここへ集約する。

// 状態バッジ: 既存の語彙（使用中/学習中/評価中/Archived）のみを色分けする。新しい状態は追加しない。
// 優先順位: 使用中（選択中）> 学習中/評価中（実行中Job） > Archived（全モデルArchived且つProduction無し） > 記録なし
export function projectStateBadge(summary, selected) {
  if (selected) {
    return { key: "in_use", label: "使用中", dot: "🟢", className: "border-emerald-400/50 bg-emerald-500/15 text-emerald-300" };
  }
  if (summary?.active_job_type === "training") {
    return { key: "training", label: "学習中", dot: "🟡", className: "border-amber-400/50 bg-amber-500/15 text-amber-200" };
  }
  if (summary?.active_job_type === "evaluation") {
    return { key: "evaluating", label: "評価中", dot: "🔵", className: "border-sky-400/50 bg-sky-500/15 text-sky-200" };
  }
  if (summary?.all_models_archived) {
    return { key: "archived", label: "Archived", dot: "⚪", className: "border-border/60 bg-card/40 text-muted" };
  }
  return null;
}

// Best CER表示（0-1の小数を%表記へ。記録なし=null）。推測補完はしない
export function formatBestCer(summary) {
  const value = summary?.best_cer;
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

// Production表示: モデルが無ければ「—」。管理No未解決時はモデル名を暫定表示（欠落を隠さない）
export function formatProductionModel(summary) {
  if (!summary?.production_model) return "—";
  return summary.production_model_id || summary.production_model;
}

export function formatBenchmarkCount(summary) {
  const count = Number(summary?.benchmark_count || 0);
  return count > 0 ? `${count}件` : "—";
}

// Exact Match（完全一致率）表示。未記録（accuracy_percentが保存されていない）場合は
// nullを返し、呼び出し側で「行自体を表示しない」（推測補完も「—」表示もしない）
export function formatExactMatch(summary) {
  const value = summary?.best_exact_match;
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return `${Number(value).toFixed(2)}%`;
}

// 相対時刻表示（フッター用。「たった今」「N分前」「N時間前」「N日前」。1週間以上は絶対日時のみに委ねる）
export function formatRelativeTime(updatedAt, nowMs = Date.now()) {
  const t = Date.parse(updatedAt || "");
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (diffSec < 60) return "たった今";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}日前`;
  return "";
}

// Health Badge: 純粋なルールベース判定（AIによる推定は行わない）。優先順位（上から）:
// ①Incomplete（基礎データ不足）②Excellent（Production+Benchmark+CER+Candidate以上の全条件）
// ③Good（評価済みモデルが存在＝Excellentの一部条件を満たさない場合を含む）④NeedsReview（未評価）
export function computeHealthBadge(summary) {
  const images = Number(summary?.images || 0);
  const labeled = Number(summary?.labeled || 0);
  const models = Number(summary?.models || 0);
  const hasCer = summary?.best_cer !== null && summary?.best_cer !== undefined;

  if (images === 0 || labeled === 0 || models === 0) {
    return { key: "incomplete", label: "Incomplete", dot: "🔴", className: "border-red-400/50 bg-red-500/15 text-red-200" };
  }
  const isExcellent =
    Boolean(summary?.production_model) &&
    Number(summary?.benchmark_count || 0) > 0 &&
    hasCer &&
    Boolean(summary?.has_candidate_or_above);
  if (isExcellent) {
    return {
      key: "excellent",
      label: "Excellent",
      dot: "🟢",
      className: "border-emerald-400/50 bg-emerald-500/15 text-emerald-200",
    };
  }
  if (hasCer) {
    return { key: "good", label: "Good", dot: "🟡", className: "border-amber-400/50 bg-amber-500/15 text-amber-200" };
  }
  return {
    key: "needs_review",
    label: "Needs Review",
    dot: "🟠",
    className: "border-orange-400/50 bg-orange-500/15 text-orange-200",
  };
}

// 現在の工程名（既存のワークフロー概念=画像取込/前処理/ラベル/データ作成・学習/評価 を、
// 一覧の集約カウントのみから推定する簡易版。実行中Jobがあれば最優先で反映する）
export function currentStepLabel(summary) {
  if (summary?.active_job_type === "training") return "モデル学習";
  if (summary?.active_job_type === "evaluation") return "評価";
  const images = Number(summary?.images || 0);
  if (images === 0) return "画像取込";
  if (summary?.image_stage !== "processed") return "前処理";
  const labeled = Number(summary?.labeled || 0);
  if (labeled < images) return "ラベル編集";
  if (Number(summary?.models || 0) === 0) return "データ作成・学習";
  if (!summary?.production_model) return "評価";
  return "完了";
}

// 一覧行の進捗%（DashboardView.jsxの summaryProgress と同一の4要素均等配分式を共有する）
export function rowProgressPercent(summary) {
  const images = Number(summary?.images || 0);
  if (!images) return 0;
  const labeledRatio = Math.min(1, Number(summary?.labeled || 0) / images);
  const ocrRatio = Math.min(1, Number(summary?.ocr_confirmed || 0) / images);
  const modelScore = Number(summary?.models || 0) > 0 ? 1 : 0;
  return Math.round(((1 + labeledRatio + ocrRatio + modelScore) / 4) * 100);
}

// クイックアクションの有効判定（既存カウントのみで判定。新規APIは使わない）
export function quickActionEnabled(actionId, summary) {
  const images = Number(summary?.images || 0);
  const models = Number(summary?.models || 0);
  if (actionId === "open" || actionId === "train") return true;
  if (actionId === "evaluate" || actionId === "report") return models > 0;
  if (actionId === "benchmark") return images > 0;
  return true;
}

// 検索: プロジェクト名（既存互換）＋テンプレート名＋Productionモデル＋状態＋Health
export function matchesSearch(pid, summary, templateOrigin, stateLabel, keyword, healthLabel = "") {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return true;
  const haystacks = [pid, templateOrigin, summary?.production_model, summary?.production_model_id, stateLabel, healthLabel];
  return haystacks.some((v) => String(v || "").toLowerCase().includes(kw));
}

export const SORT_COLUMNS = [
  { key: "updated_at", label: "更新日時" },
  { key: "images", label: "画像" },
  { key: "labeled", label: "ラベル" },
  { key: "models", label: "モデル" },
  { key: "best_cer", label: "CER" },
  { key: "benchmark_count", label: "Benchmark" },
  { key: "progress", label: "進捗" },
  { key: "health", label: "Health" },
];

// Health段階の順位（ソート用。数値が大きいほど良好）
const HEALTH_RANK = { incomplete: 0, needs_review: 1, good: 2, excellent: 3 };

function sortValueOf(pid, summary, key) {
  switch (key) {
    case "updated_at": {
      const t = Date.parse(summary?.updated_at || "");
      return Number.isFinite(t) ? t : -Infinity;
    }
    case "images":
      return Number(summary?.images || 0);
    case "labeled":
      return Number(summary?.labeled || 0);
    case "models":
      return Number(summary?.models || 0);
    case "best_cer": {
      const v = summary?.best_cer;
      // CERは低いほど良いが「記録なし」は最下位（昇順で最後・降順で最初にならないよう最大値扱い）
      return v === null || v === undefined ? Infinity : Number(v);
    }
    case "benchmark_count":
      return Number(summary?.benchmark_count || 0);
    case "progress":
      return rowProgressPercent(summary);
    case "health":
      return HEALTH_RANK[computeHealthBadge(summary).key] ?? 0;
    default:
      return 0;
  }
}

// pids（既存順=既存ソートを維持する既定の並び）を、指定列・方向で安定ソートする。
// sortKey=nullの場合はpidsをそのまま返す（既存の並びを崩さない）
export function sortProjectIds(pids, summaries, sortKey, sortDir = "desc") {
  if (!sortKey) return pids;
  const dir = sortDir === "asc" ? 1 : -1;
  return [...pids]
    .map((pid, index) => ({ pid, index, value: sortValueOf(pid, summaries?.[pid] || {}, sortKey) }))
    .sort((a, b) => {
      if (a.value === b.value) return a.index - b.index; // 安定ソート
      return a.value < b.value ? -dir : dir;
    })
    .map((row) => row.pid);
}
