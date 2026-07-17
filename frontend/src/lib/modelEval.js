// モデル管理画面「モデルカルテ」の純ロジック。
// 評価履歴（localStorage `ocr_model_eval_history_by_project_v1` = {model: {datasetLabel: entry}}）を
// 表示用へ正規化し、推奨バッジを自動判定する。
// 旧形式（percent/atのみ）のエントリはエラーにせず、欠損項目をnull（UIでは「未記録」）にする。

export function normalizeEvalEntry(datasetLabel, entry) {
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  const pre = entry && typeof entry.pre === "object" && entry.pre !== null ? entry.pre : null;
  return {
    datasetKey: String(datasetLabel || ""),
    dataset: String(entry?.dataset || datasetLabel || ""),
    percent: Number(entry?.percent),
    at: String(entry?.at || ""),
    correct: num(entry?.correct_count),
    total: num(entry?.total_count),
    mismatch: num(entry?.misrecognized_count),
    improvementRate: num(entry?.improvement_rate),
    improvementCount: num(entry?.improvement_count),
    whitelist: entry?.whitelist ? String(entry.whitelist) : "",
    preSource: pre ? String(pre.source || "") : "",
    preSummary: pre ? String(pre.summary || "") : "",
  };
}

// モデルの評価履歴を新しい順で返す
export function modelEvalEntries(evalHistory, model) {
  const record = evalHistory?.[model];
  if (!record || typeof record !== "object") {
    return [];
  }
  return Object.entries(record)
    .map(([label, entry]) => normalizeEvalEntry(label, entry))
    .filter((row) => Number.isFinite(row.percent))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

// 最新の評価エントリ（モデルカルテの「最新評価」「評価条件」に使う）
export function latestEvalOf(evalHistory, model) {
  return modelEvalEntries(evalHistory, model)[0] || null;
}

// 学習前ベースモデルの別名（バッジ判定用。predict.py の TESSERACT_BASE_MODEL_ALIASES と対応）
export const BASELINE_MODEL_NAMES = new Set(["eng", "base", "eng.traineddata", "base:eng", "eng.tess"]);

export function isBaselineModel(name) {
  return BASELINE_MODEL_NAMES.has(String(name || "").toLowerCase());
}

// バッジ自動判定（手動設定なし）:
// 🔴 baseline = 学習前ベースモデル
// 🟢 recommended = 最新評価のAccuracyが評価済みモデル中で最高
// 🏆 best = 全評価履歴の最高Accuracyを持つ
export function modelBadges(evalHistory, models) {
  const badges = {};
  let bestLatest = null;
  let bestEver = null;
  for (const model of models || []) {
    if (isBaselineModel(model)) {
      (badges[model] = badges[model] || []).push("baseline");
      continue;
    }
    const entries = modelEvalEntries(evalHistory, model);
    if (entries.length === 0) {
      continue;
    }
    const latest = entries[0];
    if (!bestLatest || latest.percent > bestLatest.percent) {
      bestLatest = { model, percent: latest.percent };
    }
    const top = Math.max(...entries.map((row) => row.percent));
    if (!bestEver || top > bestEver.percent) {
      bestEver = { model, percent: top };
    }
  }
  if (bestLatest) {
    (badges[bestLatest.model] = badges[bestLatest.model] || []).push("recommended");
  }
  if (bestEver) {
    (badges[bestEver.model] = badges[bestEver.model] || []).push("best");
  }
  return badges;
}

export const MODEL_BADGE_LABELS = {
  recommended: { icon: "🟢", label: "推奨", title: "最新評価で最高性能（評価履歴から自動判定）" },
  best: { icon: "🏆", label: "Best Accuracy", title: "全評価履歴で最高Accuracy（評価履歴から自動判定）" },
  baseline: { icon: "🔴", label: "ベースライン", title: "学習前のベースモデル" },
};

// 評価時whitelistモードの表示ラベル（旧形式=記録なしは未記録）
export function whitelistLabelOf(mode) {
  if (mode === "default") return "実運用";
  if (mode === "none") return "なし";
  if (mode === "custom") return "カスタム";
  return "未記録";
}

// 符号付き数値表示（改善率・改善件数）。記録なし（null/undefined/空）は「未記録」
// （Number(null)===0 のため、明示的にnull系を先に弾く）
export function formatSignedValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "未記録";
  const n = Number(value);
  if (!Number.isFinite(n)) return "未記録";
  return `${n >= 0 ? "+" : ""}${n}${suffix}`;
}

// 正解/総数 表示。記録なしは「未記録」
export function correctTotalLabel(entry) {
  if (!entry || entry.correct === null || entry.total === null) return "未記録";
  return `${entry.correct} / ${entry.total}`;
}
