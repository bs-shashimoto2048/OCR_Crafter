// 学習条件比較・条件差分・次回学習提案の純ロジック。
// モデル情報（/models/info の item）から学習条件を正規化し、
// 表示行・前後モデルの差分・比較可能性・ルールベースの次回学習候補を組み立てる。

import { augmentationPresetLabel, augmentationSummary } from "./augmentation.js";
import { normalizeTrainingPreprocess, trainingPreprocessSummary } from "./preprocessCompare.js";

const MISSING = "未記録";

// 数値の桁区切り表示（未記録はそのまま）
function fmtNum(value) {
  return Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value).toLocaleString("ja-JP") : MISSING;
}

// モデル情報→学習条件の正規化（未記録は空文字/nullではなく表示用の「未記録」へ寄せない生値も保持）
export function normalizeTrainingCondition(info = {}) {
  const counts = info.dataset_split_counts || info.ocr_dataset_counts || {};
  const params = info.ocr_training_params || {};
  const iterations = Number(params.max_iterations || 0) || null;
  const train = Number(counts.train || 0);
  const val = Number(counts.val || 0);
  const test = Number(counts.test || 0);
  const total = train + val + test;
  const aug = info.ocr_augmentation || {};
  const legacyAugText =
    aug?.enabled === null || aug?.enabled === undefined ? "" : aug.enabled ? `ON（強度 ${Number(aug.strength || 0) || "-"}）` : "OFF";
  const augConfig = info.augmentation_config && typeof info.augmentation_config === "object" ? info.augmentation_config : null;
  // Number(null)===0 のため null/undefined/空は先に弾く（0秒への化け防止）
  const rawDuration = info.training_duration_seconds;
  const duration = rawDuration === null || rawDuration === undefined || rawDuration === "" ? NaN : Number(rawDuration);
  const rawSeed = info.split_seed;
  const rawGenerated = info.augmentation_generated;
  const ratioObj = info.dataset_split_ratio && typeof info.dataset_split_ratio === "object" ? info.dataset_split_ratio : null;
  const ratioText =
    ratioObj && [ratioObj.train, ratioObj.val, ratioObj.test].some((v) => Number(v) > 0)
      ? `${Number(ratioObj.train).toFixed(2)} / ${Number(ratioObj.val).toFixed(2)} / ${Number(ratioObj.test).toFixed(2)}`
      : "";
  return {
    splitRatio: ratioText,
    splitSeed: rawSeed === null || rawSeed === undefined || rawSeed === "" ? null : Number(rawSeed),
    splitMethod: String(info.split_method || ""),
    augPreset: augmentationPresetLabel(augConfig, aug?.enabled === null || aug?.enabled === undefined ? null : Boolean(aug.enabled)),
    augGenerated: rawGenerated === null || rawGenerated === undefined || rawGenerated === "" ? null : Number(rawGenerated),
    experimentName: String(info.experiment_name || ""),
    parentModelId: String(info.parent_model_id || ""),
    baseModel: String(info.base_lang || params.init_source_value || ""),
    iterations,
    imageTotal: total > 0 ? total : null,
    split: total > 0 ? `${train || "-"} / ${val || "-"} / ${test || "-"}` : "",
    splitCounts: total > 0 ? { train, val, test } : null,
    // 学習時前処理（前処理スナップショット由来の要約。旧モデル=未記録は空文字）
    trainingPreprocess: trainingPreprocessSummary(normalizeTrainingPreprocess(info)),
    // 新形式（augmentation_config）を優先し、旧 use_augmentation/aug_strength はON/OFF表示で互換
    augmentation: augmentationSummary(augConfig, legacyAugText),
    charset: String(info.charset || ""),
    durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
    createdAt: String(info.created_at || info.modified_at || ""),
    trainingNote: String(info.training_note || ""),
  };
}

function durationLabel(seconds) {
  if (seconds === null) return MISSING;
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}分${s}秒` : `${m}分`;
}

function dateLabel(value) {
  if (!value) return MISSING;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 学習条件比較テーブルの行定義（label / helpKey / 値の取り出し）。表示順はタスク仕様どおり
export const TRAINING_CONDITION_ROWS = [
  { key: "experimentName", label: "実験名", value: (c) => c.experimentName || MISSING },
  { key: "parentModelId", label: "親モデル", helpKey: "parentModel", value: (c) => c.parentModelId || MISSING },
  { key: "baseModel", label: "ベースモデル", helpKey: "baseModel", value: (c) => c.baseModel || MISSING },
  { key: "iterations", label: "Iteration", helpKey: "iteration", value: (c) => (c.iterations === null ? MISSING : fmtNum(c.iterations)) },
  { key: "imageTotal", label: "学習画像数", value: (c) => (c.imageTotal === null ? MISSING : fmtNum(c.imageTotal)) },
  { key: "split", label: "Train / Val / Test", helpKey: "trainValTest", value: (c) => c.split || MISSING },
  { key: "splitRatio", label: "Train / Val / Test 比率", helpKey: "trainValTest", value: (c) => c.splitRatio || MISSING },
  { key: "splitSeed", label: "Split Seed", helpKey: "splitSeed", value: (c) => (c.splitSeed === null || c.splitSeed === undefined ? MISSING : String(c.splitSeed)) },
  { key: "splitMethod", label: "分割方式", helpKey: "splitMethod", value: (c) => (c.splitMethod === "image" ? "画像単位" : c.splitMethod || MISSING) },
  { key: "trainingPreprocess", label: "学習前処理", helpKey: "ocrPreprocess", value: (c) => c.trainingPreprocess || MISSING },
  { key: "augPreset", label: "Augプリセット", helpKey: "augmentation", value: (c) => c.augPreset || MISSING },
  { key: "augmentation", label: "Augmentation設定", helpKey: "augmentation", value: (c) => c.augmentation || MISSING },
  { key: "augGenerated", label: "Aug生成枚数", value: (c) => (c.augGenerated === null || c.augGenerated === undefined ? MISSING : `${c.augGenerated}枚`) },
  { key: "charset", label: "Charset", helpKey: "charset", value: (c) => c.charset || MISSING },
  { key: "durationSeconds", label: "学習時間", value: (c) => durationLabel(c.durationSeconds) },
  { key: "createdAt", label: "学習日時", value: (c) => dateLabel(c.createdAt) },
  { key: "trainingNote", label: "学習メモ", value: (c) => c.trainingNote || MISSING },
];

// 差分抽出の対象（変更項目数のカウント対象。タスク13の対象リスト）
const DIFF_KEYS = [
  { key: "baseModel", label: "ベースモデル" },
  { key: "parentModelId", label: "親モデル" },
  { key: "iterations", label: "Iteration" },
  { key: "imageTotal", label: "学習画像数" },
  { key: "split", label: "Train / Val / Test" },
  { key: "trainingPreprocess", label: "学習前処理" },
  { key: "augmentation", label: "Augmentation" },
  { key: "charset", label: "Charset" },
];

function diffValueLabel(key, condition) {
  const row = TRAINING_CONDITION_ROWS.find((r) => r.key === key);
  return row ? row.value(condition) : MISSING;
}

// 前後モデルの学習条件差分。両方未記録の項目は「変更なし」として扱う（判定不能項目はカウントしない）
export function diffTrainingConditions(prevCondition, nextCondition) {
  const changes = [];
  let unknown = 0;
  for (const def of DIFF_KEYS) {
    const a = prevCondition?.[def.key];
    const b = nextCondition?.[def.key];
    const aMissing = a === null || a === undefined || a === "";
    const bMissing = b === null || b === undefined || b === "";
    if (aMissing && bMissing) {
      unknown += 1;
      continue;
    }
    if (String(a ?? "") !== String(b ?? "")) {
      changes.push({ key: def.key, label: def.label, from: diffValueLabel(def.key, prevCondition), to: diffValueLabel(def.key, nextCondition) });
    }
  }
  // 分類: 変更0件=同一条件 / 1件=単一条件比較（原因判断に適する） / 2件以上=複数条件変更（要因特定不可）
  const classification = changes.length === 0 ? "none" : changes.length === 1 ? "single" : "multi";
  return { changes, unknownCount: unknown, classification };
}

export const DIFF_CLASSIFICATION_LABELS = {
  none: "条件同一",
  single: "単一条件比較",
  multi: "複数条件変更",
};

const pt = (v) => `${v >= 0 ? "+" : ""}${Math.round(v * 10) / 10}pt`;

// 前後モデルの性能変化（latest評価エントリ: cer/charAccuracy/percent）
export function diffPerformance(prevLatest, nextLatest) {
  const results = [];
  const push = (label, a, b, scale, betterWhenLower) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    const delta = (b - a) * scale;
    const improved = betterWhenLower ? delta < 0 : delta > 0;
    results.push({
      label,
      from: `${Math.round(a * scale * 10) / 10}%`,
      to: `${Math.round(b * scale * 10) / 10}%`,
      delta: pt(delta),
      improved,
      worsened: delta !== 0 && !improved,
    });
  };
  push("CER", prevLatest?.cer, nextLatest?.cer, 100, true);
  push("文字正解率", prevLatest?.charAccuracy, nextLatest?.charAccuracy, 100, false);
  push("完全一致率", Number(prevLatest?.percent) / 100, Number(nextLatest?.percent) / 100, 100, false);
  return results;
}

// 条件差分の要約（比較表示順で隣接ペアごと）。verdict=判定文
export function buildConditionDiffSummaries({ targets, labelOf, conditionOf, latestOf }) {
  const summaries = [];
  for (let i = 1; i < (targets || []).length; i += 1) {
    const prev = targets[i - 1];
    const next = targets[i];
    const diff = diffTrainingConditions(conditionOf(prev), conditionOf(next));
    const results = diffPerformance(latestOf(prev), latestOf(next));
    const cer = results.find((r) => r.label === "CER");
    let verdict;
    if (diff.classification === "none") {
      verdict =
        diff.unknownCount > 0
          ? "記録上の条件は同一です（未記録項目があるため差分は判定できません）。"
          : "学習条件は同一です。性能差は学習の揺らぎの可能性があります。";
    } else if (!cer) {
      verdict = "評価が未実施のため、性能への影響は判定できません。";
    } else if (diff.classification === "single") {
      const changed = diff.changes[0].label;
      verdict = cer.improved
        ? `${changed}の変更で改善しました（単一条件比較のため要因判断に適します）。`
        : cer.worsened
          ? `${changed}の変更のみでは改善しませんでした。`
          : `${changed}を変更しましたが、CERは変化しませんでした。`;
    } else {
      verdict = cer.improved
        ? "性能は改善しましたが、複数条件が変更されているため、改善要因は特定できません。"
        : "複数条件が変更されているため、悪化要因は特定できません。";
    }
    summaries.push({
      from: prev,
      to: next,
      pair: `${labelOf(prev)} → ${labelOf(next)}`,
      changes: diff.changes,
      changeCount: diff.changes.length,
      classification: diff.classification,
      results,
      verdict,
    });
  }
  return summaries;
}

// 比較可能性の注意（学習条件の不一致に対する原因分析上の注意文）
export function buildComparabilityNotes({ targets, labelOf, conditionOf }) {
  const notes = [];
  const evaluated = (targets || []).filter((t) => conditionOf(t));
  if (evaluated.length < 2) return notes;
  // Train/Val/Test 分割の差異（記録がある範囲で比較）
  const splits = evaluated.map((t) => ({ t, split: conditionOf(t).split })).filter((x) => x.split);
  const uniqueSplits = new Set(splits.map((x) => x.split));
  if (splits.length >= 2 && uniqueSplits.size > 1) {
    const counts = new Map();
    splits.forEach((x) => counts.set(x.split, (counts.get(x.split) || 0) + 1));
    const minority = splits.filter((x) => counts.get(x.split) === Math.min(...counts.values()));
    const names = [...new Set(minority.map((x) => labelOf(x.t)))].join("・");
    notes.push(
      `${names}はTrain / Validation分割が他モデルと異なります。同一評価データセットでの最終性能比較は可能ですが、Iterationなど単一条件の効果としては比較できません。`
    );
  }
  return notes;
}

// 次回学習の提案（ルールベース）。断定せず比較実験候補として返す
export function buildNextTrainingProposals({ targets, labelOf, conditionOf, latestOf, conditionsMatch }) {
  const proposals = [];
  const evaluated = (targets || [])
    .map((t) => ({ t, cond: conditionOf(t), latest: latestOf(t) }))
    .filter((x) => x.cond);
  if (evaluated.length === 0) return proposals;

  // 評価条件が不一致 → まず同一条件での再評価を提案（最優先）
  if (conditionsMatch === false) {
    proposals.push({
      id: "re-evaluate",
      title: "同一条件での再評価",
      settings: null,
      changedLabel: "評価条件の統一",
      lines: [
        { label: "内容", value: "評価データセット・評価前処理・Whitelistを揃えて全モデルを再評価" },
        { label: "目的", value: "学習条件の効果を正しく比較できる状態にする" },
      ],
    });
  }

  const withIter = evaluated.filter((x) => x.cond.iterations !== null);
  const maxIter = withIter.length > 0 ? Math.max(...withIter.map((x) => x.cond.iterations)) : null;
  const best = evaluated
    .filter((x) => Number.isFinite(x.latest?.cer))
    .sort((a, b) => a.latest.cer - b.latest.cer)[0];
  const reference = best || evaluated[evaluated.length - 1];
  const refLabel = labelOf(reference.t);
  const refModel = reference.t; // 学習設定引き継ぎ用の実モデル名（分割・親モデルの参照元）

  // Iterationが最大のモデルがCER最良（改善傾向）→ さらに高いIterationを候補として提示
  if (maxIter !== null && best && best.cond.iterations === maxIter) {
    const nextIter = maxIter * 1.5 >= 10000 ? Math.round((maxIter * 1.5) / 5000) * 5000 : Math.round((maxIter * 1.5) / 500) * 500;
    proposals.push({
      id: "iteration",
      title: "Iteration検証",
      settings: {
        parentModel: refLabel,
        referenceModel: refModel,
        iterations: nextIter,
        splitFrom: refLabel,
        augmentation: "なし",
      },
      changedLabel: "Iterationのみ",
      lines: [
        { label: "親モデルまたはベースモデル", value: `eng または ${refLabel}` },
        { label: "データ分割", value: `${refLabel}と同一で固定` },
        { label: "Augmentation", value: "なし" },
        { label: "Iteration", value: fmtNum(nextIter) },
        { label: "変更項目", value: "Iterationのみ" },
      ],
    });
  }

  // Augmentationが未使用（OFF/未記録）→ 弱いAugmentationを候補として提示
  const augUnused = evaluated.every((x) => !x.cond.augmentation || x.cond.augmentation === "OFF");
  if (augUnused) {
    proposals.push({
      id: "augmentation",
      title: "弱いAugmentation検証",
      settings: {
        parentModel: refLabel,
        referenceModel: refModel,
        iterations: reference.cond.iterations,
        splitFrom: refLabel,
        augmentation: "弱（回転±2°・Blur弱・明るさ±10%・コントラスト±10%）",
      },
      changedLabel: "Augmentationのみ",
      lines: [
        { label: "データ分割", value: `${refLabel}と同一で固定` },
        { label: "Iteration", value: reference.cond.iterations === null ? MISSING : fmtNum(reference.cond.iterations) },
        { label: "回転", value: "±2°" },
        { label: "Blur", value: "弱" },
        { label: "Brightness / Contrast", value: "±10%" },
        { label: "変更項目", value: "Augmentationのみ" },
      ],
    });
  }

  // Train/Val分割がモデル間で異なる → 分割固定を優先提案
  const splits = new Set(evaluated.map((x) => x.cond.split).filter(Boolean));
  if (splits.size > 1) {
    proposals.push({
      id: "fix-split",
      title: "データ分割の固定",
      settings: {
        parentModel: refLabel,
        referenceModel: refModel,
        iterations: reference.cond.iterations,
        splitFrom: refLabel,
        augmentation: "なし",
      },
      changedLabel: "分割固定",
      lines: [
        { label: "内容", value: `以後の実験は${refLabel}のTrain / Val / Test分割へ固定` },
        { label: "目的", value: "分割差の影響を排除し、単一条件比較を可能にする" },
        { label: "変更項目", value: "なし（条件固定の方針）" },
      ],
    });
  }

  return proposals;
}
