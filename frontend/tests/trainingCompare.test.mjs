// 学習条件比較・条件差分・次回学習提案（lib/trainingCompare.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  DIFF_CLASSIFICATION_LABELS,
  TRAINING_CONDITION_ROWS,
  buildComparabilityNotes,
  buildConditionDiffSummaries,
  buildNextTrainingProposals,
  diffPerformance,
  diffTrainingConditions,
  normalizeTrainingCondition,
} from "../src/lib/trainingCompare.js";

// /models/info 相当のモデル情報（M0001=初期・M0002=Iterationのみ変更・M0003=複数条件変更）
const INFOS = {
  m1: {
    experiment_name: "初期学習",
    parent_model_id: "",
    base_lang: "eng",
    charset: "ABC",
    training_note: "初期比較",
    training_duration_seconds: 90,
    created_at: "2026-07-15T13:01:48",
    dataset_split_counts: { train: 694, val: 198, test: 0 },
    ocr_training_params: { max_iterations: 1500 },
  },
  m2: {
    experiment_name: "Iteration増加",
    parent_model_id: "M0001",
    base_lang: "eng",
    charset: "ABC",
    training_note: "Iterationのみ",
    training_duration_seconds: null,
    created_at: "2026-07-15T13:10:54",
    dataset_split_counts: { train: 694, val: 198, test: 0 },
    ocr_training_params: { max_iterations: 6000 },
  },
  m3: {
    experiment_name: "Train比率変更",
    parent_model_id: "M0002",
    base_lang: "eng",
    charset: "ABC",
    training_note: "分割変更あり",
    training_duration_seconds: 1122,
    created_at: "2026-07-15T14:50:27",
    dataset_split_counts: { train: 798, val: 99, test: 0 },
    ocr_training_params: { max_iterations: 10000 },
  },
};

const LATEST = {
  m1: { cer: 0.312, charAccuracy: 0.688, percent: 38.6 },
  m2: { cer: 0.317, charAccuracy: 0.683, percent: 34.6 },
  m3: { cer: 0.298, charAccuracy: 0.702, percent: 38.6 },
};

const TARGETS = ["m1", "m2", "m3"];
const labelOf = (name) => ({ m1: "M0001", m2: "M0002", m3: "M0003" })[name];
const conditionOf = (name) => normalizeTrainingCondition(INFOS[name]);
const latestOf = (name) => LATEST[name];

test("normalizeTrainingCondition: モデル情報から学習条件を正規化・表示行は未記録フォールバック", () => {
  const cond = conditionOf("m1");
  assert.equal(cond.experimentName, "初期学習");
  assert.equal(cond.iterations, 1500);
  assert.equal(cond.imageTotal, 892);
  assert.equal(cond.split, "694 / 198 / -");
  assert.equal(cond.durationSeconds, 90);
  // 表示行: 実験名〜学習メモの12項目・未記録項目は「未記録」
  assert.equal(TRAINING_CONDITION_ROWS.length, 12);
  const rowOf = (key) => TRAINING_CONDITION_ROWS.find((r) => r.key === key);
  assert.equal(rowOf("iterations").value(cond), "1,500");
  assert.equal(rowOf("durationSeconds").value(cond), "1分30秒");
  assert.equal(rowOf("parentModelId").value(cond), "未記録"); // ベース直学習は空→未記録
  assert.equal(rowOf("trainingPreprocess").value(cond), "未記録"); // Tesseractは学習前処理なし
  // 旧モデル（情報なし）も安全に未記録表示
  const legacy = normalizeTrainingCondition({});
  for (const row of TRAINING_CONDITION_ROWS) {
    assert.ok(typeof row.value(legacy) === "string" && row.value(legacy).length > 0);
  }
  assert.equal(rowOf("experimentName").value(legacy), "未記録");
});

test("diffTrainingConditions: 単一条件比較（Iterationのみ）の判定", () => {
  const diff = diffTrainingConditions(conditionOf("m1"), conditionOf("m2"));
  // 変更=Iterationと親モデル…親モデルはM0001→M0002で異なるが、m1は空（未記録扱い）
  // m1.parentModelId="" と m2="M0001" → 片方欠損は変更として数える? 仕様: 両方未記録のみ除外
  const labels = diff.changes.map((c) => c.label);
  assert.ok(labels.includes("Iteration"));
  const iter = diff.changes.find((c) => c.label === "Iteration");
  assert.equal(iter.from, "1,500");
  assert.equal(iter.to, "6,000");
});

test("diffTrainingConditions: 変更0件=条件同一・複数変更=複数条件変更", () => {
  const same = diffTrainingConditions(conditionOf("m1"), conditionOf("m1"));
  assert.equal(same.classification, "none");
  assert.equal(same.changes.length, 0);
  const multi = diffTrainingConditions(conditionOf("m2"), conditionOf("m3"));
  assert.equal(multi.classification, "multi"); // Iteration+画像数+分割+親モデル
  const labels = multi.changes.map((c) => c.label);
  assert.ok(labels.includes("Iteration"));
  assert.ok(labels.includes("学習画像数"));
  assert.ok(labels.includes("Train / Val / Test"));
  assert.equal(DIFF_CLASSIFICATION_LABELS.single, "単一条件比較");
  assert.equal(DIFF_CLASSIFICATION_LABELS.multi, "複数条件変更");
});

test("diffTrainingConditions: 両方未記録の項目は変更として数えない", () => {
  const a = normalizeTrainingCondition({ ocr_training_params: { max_iterations: 100 } });
  const b = normalizeTrainingCondition({ ocr_training_params: { max_iterations: 200 } });
  const diff = diffTrainingConditions(a, b);
  assert.equal(diff.classification, "single"); // Iterationのみ（他は両方未記録）
  assert.ok(diff.unknownCount > 0);
});

test("diffPerformance: CER低下=改善・完全一致率のpt差", () => {
  const results = diffPerformance(LATEST.m2, LATEST.m3);
  const cer = results.find((r) => r.label === "CER");
  assert.equal(cer.delta, "-1.9pt");
  assert.equal(cer.improved, true);
  const acc = results.find((r) => r.label === "完全一致率");
  assert.equal(acc.delta, "+4pt");
  assert.equal(acc.improved, true);
});

test("buildConditionDiffSummaries: 隣接ペアの要約と判定文", () => {
  const summaries = buildConditionDiffSummaries({ targets: TARGETS, labelOf, conditionOf, latestOf });
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].pair, "M0001 → M0002");
  // m1→m2: CER悪化。判定は「改善しませんでした」系
  assert.ok(summaries[0].verdict.includes("改善しませんでした") || summaries[0].verdict.includes("特定できません"));
  // m2→m3: 複数条件変更で改善 → 要因特定不可の判定
  assert.equal(summaries[1].classification, "multi");
  assert.ok(summaries[1].verdict.includes("複数条件"));
  assert.ok(summaries[1].verdict.includes("特定できません"));
  assert.ok(summaries[1].changeCount >= 2);
});

test("buildComparabilityNotes: Train/Validation分割差異の注意を生成", () => {
  const notes = buildComparabilityNotes({ targets: TARGETS, labelOf, conditionOf });
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes("M0003"));
  assert.ok(notes[0].includes("Train / Validation分割が他モデルと異なります"));
  // 全モデル同一分割なら注意なし
  const sameNotes = buildComparabilityNotes({ targets: ["m1", "m2"], labelOf, conditionOf });
  assert.equal(sameNotes.length, 0);
});

test("buildNextTrainingProposals: ルールベースの候補生成", () => {
  const proposals = buildNextTrainingProposals({ targets: TARGETS, labelOf, conditionOf, latestOf, conditionsMatch: true });
  const ids = proposals.map((p) => p.id);
  // Iteration最大のM0003がCER最良 → さらに高いIterationを提案
  assert.ok(ids.includes("iteration"));
  const iter = proposals.find((p) => p.id === "iteration");
  assert.equal(iter.settings.iterations, 15000); // 10000*1.5
  assert.equal(iter.settings.referenceModel, "m3");
  assert.equal(iter.changedLabel, "Iterationのみ");
  // Augmentation未使用 → 弱いAugmentationを提案
  assert.ok(ids.includes("augmentation"));
  // 分割がモデル間で異なる → 分割固定を提案
  assert.ok(ids.includes("fix-split"));
  // 評価条件不一致なら再評価を最優先で提案
  const withMismatch = buildNextTrainingProposals({ targets: TARGETS, labelOf, conditionOf, latestOf, conditionsMatch: false });
  assert.equal(withMismatch[0].id, "re-evaluate");
});

test("normalizeTrainingCondition: 学習時間null/undefinedは0秒へ化けず未記録（Number(null)===0の罠）", () => {
  const rowOf = (key) => TRAINING_CONDITION_ROWS.find((r) => r.key === key);
  assert.equal(normalizeTrainingCondition({ training_duration_seconds: null }).durationSeconds, null);
  assert.equal(normalizeTrainingCondition({}).durationSeconds, null);
  assert.equal(rowOf("durationSeconds").value(normalizeTrainingCondition({ training_duration_seconds: null })), "未記録");
  // 実際の0秒は0秒として表示（nullと区別）
  assert.equal(normalizeTrainingCondition({ training_duration_seconds: 0 }).durationSeconds, 0);
  assert.equal(rowOf("durationSeconds").value(normalizeTrainingCondition({ training_duration_seconds: 0 })), "0秒");
});
