// 実験管理（Experiment Tracking）の純ロジック。
// /api/experiments の実験カルテを正規化し、フィルタ・条件差分・CER推移などのグラフデータ・
// 学習条件との簡易相関（差分集計。統計学的検定はしない）・ベスト条件・条件推薦・CSVを組み立てる。

import { augmentationPresetLabel, augmentationSummary } from "./augmentation.js";

const num = (value) =>
  value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

// APIの実験カルテ → 表示用へ正規化（欠損はnull/空=「未記録」表示。推測しない）
export function normalizeExperiment(raw = {}) {
  const training = raw.training && typeof raw.training === "object" ? raw.training : {};
  const counts = training.counts && typeof training.counts === "object" ? training.counts : {};
  const ratio = training.split_ratio && typeof training.split_ratio === "object" ? training.split_ratio : null;
  const preprocess = raw.preprocess && typeof raw.preprocess === "object" ? raw.preprocess : {};
  const aug = raw.augmentation && typeof raw.augmentation === "object" ? raw.augmentation : {};
  const augConfig = aug.config && typeof aug.config === "object" ? aug.config : null;
  const evaluation = raw.evaluation && typeof raw.evaluation === "object" ? raw.evaluation : null;
  const ratioText = ratio
    ? `${Number(ratio.train ?? 0)} : ${Number(ratio.val ?? 0)} : ${Number(ratio.test ?? 0)}`
    : "";
  return {
    id: String(raw.experiment_id || ""),
    createdAt: String(raw.created_at || ""),
    startedAt: String(raw.started_at || ""),
    finishedAt: String(raw.finished_at || ""),
    durationSeconds: num(raw.duration_seconds),
    models: Array.isArray(raw.models) ? raw.models.map(String) : [],
    modelIds: Array.isArray(raw.model_ids) ? raw.model_ids.map(String) : [],
    name: String(raw.experiment_name || ""),
    parentModelId: String(raw.parent_model_id || ""),
    note: String(raw.note || ""),
    operator: String(raw.operator || ""),
    iterations: num(training.iterations),
    splitRatioText: ratioText,
    splitSeed: num(training.split_seed),
    counts: {
      train: num(counts.train),
      val: num(counts.val),
      test: num(counts.test),
    },
    charset: String(training.charset || ""),
    baseLang: String(training.base_lang || ""),
    preprocessHash: String(preprocess.hash || ""),
    preprocessShort: String(preprocess.hash || "").replace(/^sha256:/, "").slice(0, 8),
    preprocessSummary: String(preprocess.summary || ""),
    snapshotId: String(preprocess.snapshot_id || ""),
    augPreset: augmentationPresetLabel(augConfig, augConfig ? true : null) || (augConfig ? "custom" : ""),
    augMultiplier: augConfig ? num(augConfig.multiplier) : null,
    augSummary: augmentationSummary(augConfig, "") || "なし",
    augGenerated: num(aug.generated),
    cer: evaluation ? num(evaluation.cer) : null,
    charAccuracy: evaluation ? num(evaluation.char_accuracy) : null,
    accuracyPercent: evaluation ? num(evaluation.accuracy_percent) : null,
    improved: evaluation ? num(evaluation.improved) : null,
    regressed: evaluation ? num(evaluation.regressed) : null,
    evaluatedAt: evaluation ? String(evaluation.evaluated_at || "") : "",
    evalDataset: evaluation ? String(evaluation.dataset || "") : "",
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    favorite: raw.favorite === true,
    source: String(raw.source || "training"),
  };
}

// ---------- フィルタ（Iteration / CER / Aug / 前処理 / モデル / 日付 / タグ / ★ / フリーテキスト） ----------

export function filterExperiments(experiments, filters = {}) {
  const query = String(filters.query || "").trim().toLowerCase();
  const iterMin = num(filters.iterMin);
  const iterMax = num(filters.iterMax);
  const cerMax = num(filters.cerMax); // %指定（例: 35 → CER 35%以下）
  const augPreset = String(filters.augPreset || "");
  const preprocessHash = String(filters.preprocessHash || "");
  const dateFrom = String(filters.dateFrom || "");
  const dateTo = String(filters.dateTo || "");
  const tag = String(filters.tag || "");
  const favoriteOnly = filters.favoriteOnly === true;
  return (experiments || []).filter((e) => {
    if (favoriteOnly && !e.favorite) return false;
    if (tag && !e.tags.includes(tag)) return false;
    if (iterMin !== null && (e.iterations === null || e.iterations < iterMin)) return false;
    if (iterMax !== null && (e.iterations === null || e.iterations > iterMax)) return false;
    if (cerMax !== null && (e.cer === null || e.cer * 100 > cerMax)) return false;
    if (augPreset) {
      if (augPreset === "none" && e.augSummary !== "なし") return false;
      if (augPreset !== "none" && e.augPreset !== augPreset) return false;
    }
    if (preprocessHash && e.preprocessHash !== preprocessHash) return false;
    if (dateFrom && e.createdAt.slice(0, 10) < dateFrom) return false;
    if (dateTo && e.createdAt.slice(0, 10) > dateTo) return false;
    if (query) {
      const haystack = [e.id, e.name, e.note, e.operator, ...e.models, ...e.modelIds, ...e.tags, e.preprocessSummary]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

// ---------- 条件差分（変更された条件だけ強調・同じ値は薄く表示） ----------

const fmt = (value, suffix = "") => (value === null || value === undefined || value === "" ? "未記録" : `${value}${suffix}`);

export const EXPERIMENT_DIFF_ROWS = [
  { key: "iterations", label: "Iteration", value: (e) => fmt(e.iterations === null ? null : e.iterations.toLocaleString("ja-JP")) },
  { key: "split", label: "Split比率", value: (e) => fmt(e.splitRatioText) },
  { key: "seed", label: "Split Seed", value: (e) => fmt(e.splitSeed) },
  {
    key: "counts",
    label: "Train / Val / Test",
    value: (e) =>
      e.counts.train === null && e.counts.val === null && e.counts.test === null
        ? "未記録"
        : `${fmt(e.counts.train)} / ${fmt(e.counts.val)} / ${fmt(e.counts.test)}`,
  },
  { key: "preprocess", label: "前処理", value: (e) => (e.preprocessHash ? `${e.preprocessSummary || "記録あり"}（${e.preprocessShort}）` : "未記録") },
  { key: "augmentation", label: "Augmentation", value: (e) => e.augSummary || "なし" },
  { key: "charset", label: "Charset", value: (e) => fmt(e.charset) },
  { key: "base", label: "ベース / 親", value: (e) => `${e.baseLang || "未記録"}${e.parentModelId ? ` / ${e.parentModelId}` : ""}` },
  { key: "cer", label: "CER", value: (e) => (e.cer === null ? "未評価" : `${(e.cer * 100).toFixed(1)}%`) },
];

// 比較対象の実験群に対する差分行。changed=値が2種類以上（全て未記録は変更なし扱い）
export function buildExperimentDiff(experiments) {
  return EXPERIMENT_DIFF_ROWS.map((row) => {
    const values = experiments.map((e) => row.value(e));
    const informative = values.filter((v) => v !== "未記録" && v !== "未評価");
    const changed = new Set(informative).size > 1;
    return { key: row.key, label: row.label, values, changed };
  });
}

// ---------- グラフデータ（CER推移 / 完全一致率推移 / Iteration×CER / Aug倍率×CER） ----------

// 実験ID順（=実行順）の推移。値が無い実験は除外
export function buildTrendSeries(experiments, metric = "cer") {
  const sorted = [...(experiments || [])].sort((a, b) => a.id.localeCompare(b.id));
  const pick = (e) =>
    metric === "cer" ? (e.cer === null ? null : e.cer * 100) : metric === "accuracy" ? e.accuracyPercent : null;
  return sorted
    .map((e) => ({ id: e.id, value: pick(e) }))
    .filter((p) => p.value !== null && Number.isFinite(p.value));
}

export function buildScatter(experiments, xKey = "iterations") {
  return (experiments || [])
    .map((e) => ({ id: e.id, x: xKey === "aug" ? (e.augSummary === "なし" ? 1.0 : e.augMultiplier) : e.iterations, y: e.cer === null ? null : e.cer * 100 }))
    .filter((p) => p.x !== null && p.x !== undefined && p.y !== null && Number.isFinite(p.x) && Number.isFinite(p.y));
}

// ---------- 学習条件との簡易相関（差分集計。統計学的検定はしない） ----------

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

// Iteration と CER の相関（r<0=Iteration増加でCER改善）。stars=|r|を5段階
export function iterationCorrelation(experiments) {
  const pairs = (experiments || []).filter((e) => e.iterations !== null && e.cer !== null);
  const r = pearson(pairs.map((e) => e.iterations), pairs.map((e) => e.cer));
  if (r === null) return { available: false, count: pairs.length };
  const stars = Math.max(1, Math.min(5, Math.round(Math.abs(r) * 5)));
  return {
    available: true,
    count: pairs.length,
    r: Math.round(r * 100) / 100,
    stars,
    starsLabel: "★".repeat(stars) + "☆".repeat(5 - stars),
    direction: r < -0.1 ? "Iteration増加でCER改善傾向" : r > 0.1 ? "Iteration増加でCER悪化傾向" : "明確な傾向なし",
  };
}

// Augmentationの有無による平均CER差（+pt=Augありのほうが改善）
export function augmentationImprovement(experiments) {
  const evaluated = (experiments || []).filter((e) => e.cer !== null);
  const withAug = evaluated.filter((e) => e.augSummary !== "なし");
  const withoutAug = evaluated.filter((e) => e.augSummary === "なし");
  if (withAug.length === 0 || withoutAug.length === 0) {
    return { available: false, withCount: withAug.length, withoutCount: withoutAug.length };
  }
  const deltaPt = (mean(withoutAug.map((e) => e.cer)) - mean(withAug.map((e) => e.cer))) * 100;
  return {
    available: true,
    withCount: withAug.length,
    withoutCount: withoutAug.length,
    deltaPt: Math.round(deltaPt * 10) / 10,
    label: `${deltaPt >= 0 ? "+" : ""}${(Math.round(deltaPt * 10) / 10).toFixed(1)}pt`,
  };
}

// 前処理（ハッシュ）別の平均CER（差分集計）。平均CERの良い順
export function preprocessGroups(experiments) {
  const groups = new Map();
  for (const e of experiments || []) {
    if (e.cer === null || !e.preprocessHash) continue;
    const key = e.preprocessHash;
    if (!groups.has(key)) {
      groups.set(key, { hash: key, short: e.preprocessShort, summary: e.preprocessSummary, cers: [] });
    }
    groups.get(key).cers.push(e.cer);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, count: g.cers.length, meanCerPercent: Math.round(mean(g.cers) * 1000) / 10 }))
    .sort((a, b) => a.meanCerPercent - b.meanCerPercent);
}

// ---------- ベスト条件（最もCERが良かった実験の条件） ----------

export function bestExperiment(experiments) {
  const evaluated = (experiments || []).filter((e) => e.cer !== null);
  if (evaluated.length === 0) return null;
  return evaluated.reduce((best, e) => (e.cer < best.cer ? e : best), evaluated[0]);
}

// ---------- 条件推薦（実験履歴からのルールベース。AI推論はしない） ----------

export function buildExperimentRecommendations(experiments) {
  const cards = [];
  const evaluated = (experiments || []).filter((e) => e.cer !== null);
  if (evaluated.length < 2) return cards;
  const best = bestExperiment(evaluated);

  // Iteration: ベストCERのIterationを推奨。それより大きいIterationの平均CERが悪ければ過学習傾向を付記
  if (best.iterations !== null) {
    const higher = evaluated.filter((e) => e.iterations !== null && e.iterations > best.iterations);
    const higherMean = mean(higher.map((e) => e.cer));
    let reason = `${best.id}（CER ${(best.cer * 100).toFixed(1)}%）で最良`;
    if (higher.length > 0 && higherMean !== null && higherMean > best.cer) {
      reason += `。${best.iterations.toLocaleString("ja-JP")}超は平均CER ${(higherMean * 100).toFixed(1)}%と悪化（過学習傾向）`;
    }
    cards.push({
      id: "iteration",
      title: "Iteration",
      value: `${best.iterations.toLocaleString("ja-JP")} を推奨`,
      reason,
    });
  }

  // Augmentation: 有無の平均差から推奨
  const aug = augmentationImprovement(evaluated);
  if (aug.available) {
    cards.push({
      id: "augmentation",
      title: "Augmentation",
      value: aug.deltaPt > 0 ? "使用を推奨" : "なしを推奨",
      reason: `Augあり平均とAugなし平均の差 ${aug.label}（あり${aug.withCount}件 / なし${aug.withoutCount}件）`,
    });
  }

  // 前処理: 平均CER最良のハッシュ
  const groups = preprocessGroups(evaluated);
  if (groups.length >= 2) {
    const top = groups[0];
    cards.push({
      id: "preprocess",
      title: "前処理",
      value: `${top.summary || top.short} を推奨`,
      reason: `平均CER ${top.meanCerPercent}%（${top.count}件）で最良`,
    });
  }
  return cards;
}

// ---------- CSV / Excel 出力 ----------

export function experimentsToCsvLines(experiments) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = [
    "experiment_id",
    "created_at",
    "started_at",
    "finished_at",
    "duration_seconds",
    "models",
    "model_ids",
    "experiment_name",
    "parent_model_id",
    "operator",
    "iterations",
    "split_ratio",
    "split_seed",
    "train_count",
    "val_count",
    "test_count",
    "preprocess_hash",
    "preprocess_summary",
    "snapshot_id",
    "augmentation",
    "aug_multiplier",
    "aug_generated",
    "cer",
    "char_accuracy",
    "accuracy_percent",
    "improved",
    "regressed",
    "evaluated_at",
    "eval_dataset",
    "tags",
    "favorite",
    "note",
  ];
  const lines = [header.map(escape).join(",")];
  for (const e of experiments || []) {
    lines.push(
      [
        e.id,
        e.createdAt,
        e.startedAt,
        e.finishedAt,
        e.durationSeconds ?? "",
        e.models.join(" / "),
        e.modelIds.filter(Boolean).join(" / "),
        e.name,
        e.parentModelId,
        e.operator,
        e.iterations ?? "",
        e.splitRatioText,
        e.splitSeed ?? "",
        e.counts.train ?? "",
        e.counts.val ?? "",
        e.counts.test ?? "",
        e.preprocessHash,
        e.preprocessSummary,
        e.snapshotId,
        e.augSummary,
        e.augMultiplier ?? "",
        e.augGenerated ?? "",
        e.cer ?? "",
        e.charAccuracy ?? "",
        e.accuracyPercent ?? "",
        e.improved ?? "",
        e.regressed ?? "",
        e.evaluatedAt,
        e.evalDataset,
        e.tags.join(" / "),
        e.favorite ? "1" : "0",
        e.note,
      ]
        .map(escape)
        .join(",")
    );
  }
  return lines;
}

// 一覧から選べるタグ・Augプリセット・前処理ハッシュの候補（フィルタUI用）
export function collectFilterOptions(experiments) {
  const tags = new Set();
  const presets = new Set();
  const hashes = new Map();
  for (const e of experiments || []) {
    e.tags.forEach((t) => tags.add(t));
    if (e.augSummary !== "なし" && e.augPreset) presets.add(e.augPreset);
    if (e.preprocessHash) hashes.set(e.preprocessHash, e.preprocessSummary || e.preprocessShort);
  }
  return {
    tags: [...tags].sort(),
    augPresets: [...presets].sort(),
    preprocessHashes: [...hashes.entries()].map(([hash, label]) => ({ hash, label })),
  };
}
