// モデル管理画面「モデルカルテ」の純ロジック。
// 評価履歴（localStorage `ocr_model_eval_history_by_project_v1` = {model: {datasetLabel: entry}}）を
// 表示用へ正規化し、推奨バッジを自動判定する。
// 旧形式（percent/atのみ）のエントリはエラーにせず、欠損項目をnull（UIでは「未記録」）にする。

import { normalizeConfusions } from "./confusionFormat.js";

export function normalizeEvalEntry(datasetLabel, entry) {
  const num = (value) => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);
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
    // CER主指標（0〜1・低いほど良い）と関連指標（旧形式はnull=未記録）
    cer: num(entry?.cer),
    charAccuracy: num(entry?.char_accuracy),
    cerDelta: num(entry?.cer_delta),
    cerRelativeImprovement: num(entry?.cer_relative_improvement),
    improved: num(entry?.improved),
    unchanged: num(entry?.unchanged),
    regressed: num(entry?.regressed),
    perfectFixed: num(entry?.perfect_fixed),
    perfectRegressed: num(entry?.perfect_regressed),
    // 構造化形式（配列）を正とし、旧・文字列キー形式（{"Y→":5}等）は読み込み時に構造化へ変換
    confusions: normalizeConfusions(entry?.confusions),
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

// バッジ自動判定（手動設定なし・最新評価履歴から算出）:
// 🔵 baseline = 学習前ベースモデル
// 🏆 best_cer = 最新評価のCERが最小 / 🏆 best_char = 文字正解率が最大 / 🏆 best = Accuracy（完全一致率）が最大
// 🟢 recommended = 総合推奨（CER最小→文字正解率→Accuracy→悪化件数の順で比較。Accuracy単独では決めない）
// ⭐ latest_best = 最も新しい評価日時のモデル群の中でCER（無ければAccuracy）最良
export function modelBadges(evalHistory, models) {
  const badges = {};
  const push = (model, key) => {
    (badges[model] = badges[model] || []).push(key);
  };
  const evaluated = [];
  for (const model of models || []) {
    if (isBaselineModel(model)) {
      push(model, "baseline");
      continue;
    }
    const latest = latestEvalOf(evalHistory, model);
    if (latest) {
      evaluated.push({ model, latest });
    }
  }
  if (evaluated.length === 0) {
    return badges;
  }
  const minBy = (rows, fn) =>
    rows.reduce((acc, row) => (fn(row) !== null && (acc === null || fn(row) < fn(acc)) ? row : acc), null);
  const maxBy = (rows, fn) =>
    rows.reduce((acc, row) => (fn(row) !== null && (acc === null || fn(row) > fn(acc)) ? row : acc), null);

  const withCer = evaluated.filter((row) => row.latest.cer !== null);
  const bestCer = minBy(withCer, (row) => row.latest.cer);
  if (bestCer) push(bestCer.model, "best_cer");
  const bestChar = maxBy(
    evaluated.filter((row) => row.latest.charAccuracy !== null),
    (row) => row.latest.charAccuracy
  );
  if (bestChar) push(bestChar.model, "best_char");
  const bestAcc = maxBy(evaluated, (row) => (Number.isFinite(row.latest.percent) ? row.latest.percent : null));
  if (bestAcc) push(bestAcc.model, "best");

  // 総合推奨: CER→文字正解率→Accuracy→悪化件数（少ないほど良い）の優先順で比較
  const recommended = [...evaluated].sort((a, b) => {
    const cerA = a.latest.cer ?? Infinity;
    const cerB = b.latest.cer ?? Infinity;
    if (cerA !== cerB) return cerA - cerB;
    const charA = a.latest.charAccuracy ?? -1;
    const charB = b.latest.charAccuracy ?? -1;
    if (charA !== charB) return charB - charA;
    if (a.latest.percent !== b.latest.percent) return b.latest.percent - a.latest.percent;
    return (a.latest.regressed ?? Infinity) - (b.latest.regressed ?? Infinity);
  })[0];
  if (recommended) push(recommended.model, "recommended");

  // 最新の評価実行（最も新しい評価日時）内での最良
  const newestAt = evaluated.reduce((acc, row) => (row.latest.at > acc ? row.latest.at : acc), "");
  const newestRows = evaluated.filter((row) => row.latest.at === newestAt);
  const latestBest =
    minBy(
      newestRows.filter((row) => row.latest.cer !== null),
      (row) => row.latest.cer
    ) || maxBy(newestRows, (row) => (Number.isFinite(row.latest.percent) ? row.latest.percent : null));
  if (latestBest) push(latestBest.model, "latest_best");
  return badges;
}

export const MODEL_BADGE_LABELS = {
  recommended: { icon: "🟢", label: "Recommended", title: "総合推奨（CER→文字正解率→完全一致率→悪化件数で自動判定）" },
  latest_best: { icon: "⭐", label: "Latest Best", title: "最新の評価実行で最良（評価履歴から自動判定）" },
  best_cer: { icon: "🏆", label: "Best CER", title: "最新評価でCER最小（評価履歴から自動判定）" },
  best_char: { icon: "🏆", label: "Best Char Acc", title: "最新評価で文字正解率最大（評価履歴から自動判定）" },
  best: { icon: "🏆", label: "Best Accuracy", title: "最新評価で完全一致率最大（評価履歴から自動判定）" },
  baseline: { icon: "🔵", label: "Baseline", title: "学習前のベースモデル" },
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

// モデル一覧検索: モデル名・別名・管理No（M0004等）のいずれかに部分一致（大文字小文字無視）。
// 空検索は全件一致。
export function matchesModelSearch(query, { name, alias, modelId } = {}) {
  const search = String(query || "").trim().toLowerCase();
  if (!search) return true;
  return [name, alias, modelId].some((value) => String(value || "").toLowerCase().includes(search));
}
