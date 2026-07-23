// オーグメンテーション設定UIの純ロジックテスト（lib/augmentationSettings.js）
import assert from "node:assert/strict";
import { test } from "node:test";

import { WEAK_AUGMENTATION, defaultAugmentationState } from "../src/lib/augmentation.js";
import {
  AUG_CATEGORIES,
  AUG_ITEM_DEFS,
  augCategorySummaryLabel,
  averageAugProbabilityPercent,
  buildAugSummary,
  clampAugValue,
  clampProbability,
  enabledAugItemCount,
  enabledAugItemLabels,
  estimatedAddedCount,
  estimatedIncreasePercent,
  isAugmentationOff,
  recommendedAugmentationState,
  resetAugmentationState,
  setAugItemEnabled,
  setAugItemValue,
  totalAugItemCount,
} from "../src/lib/augmentationSettings.js";

test("項目定義は既存の設定キー5項目のみで、3カテゴリへ分類される", () => {
  assert.deepEqual(
    AUG_ITEM_DEFS.map((def) => def.key),
    ["rotation", "brightness", "contrast", "blur", "noise"]
  );
  assert.deepEqual(
    AUG_CATEGORIES.map((category) => category.label),
    ["幾何変換", "明るさ・コントラスト", "ノイズ・ぼかし"]
  );
  // 全項目がいずれかのカテゴリへ属する（漏れ・重複なし）
  const categorized = AUG_CATEGORIES.flatMap((category) => category.items.map((item) => item.key));
  assert.deepEqual([...categorized].sort(), [...AUG_ITEM_DEFS.map((d) => d.key)].sort());
  assert.equal(totalAugItemCount(), 5);
});

test("有効項目数の集計: なし=0 / weak=5 / 個別OFFで減る", () => {
  assert.equal(enabledAugItemCount(defaultAugmentationState()), 0);
  assert.equal(enabledAugItemCount(structuredClone(WEAK_AUGMENTATION)), 5);
  const partial = structuredClone(WEAK_AUGMENTATION);
  partial.blur.enabled = false;
  partial.noise.enabled = false;
  assert.equal(enabledAugItemCount(partial), 3);
});

test("平均適用確率: weak=(30+30+30+10+10)/5=22% / 有効なし=null", () => {
  assert.equal(averageAugProbabilityPercent(structuredClone(WEAK_AUGMENTATION)), 22);
  assert.equal(averageAugProbabilityPercent(defaultAugmentationState()), null);
  const custom = structuredClone(WEAK_AUGMENTATION);
  custom.preset = "custom";
  for (const key of ["brightness", "contrast", "blur", "noise"]) custom[key].enabled = false;
  custom.rotation.probability = 0.5;
  assert.equal(averageAugProbabilityPercent(custom), 50);
});

test("生成倍率と推定増加: (倍率-1)×100% / Train枚数があれば枚数も算出", () => {
  const state = structuredClone(WEAK_AUGMENTATION);
  assert.equal(estimatedIncreasePercent(state), 50);
  assert.equal(estimatedAddedCount(state, 100), 50);
  state.multiplier = 3;
  assert.equal(estimatedIncreasePercent(state), 200);
  assert.equal(estimatedAddedCount(state, 40), 80);
  // Train枚数不明はnull（率のみ表示）・なし=0
  assert.equal(estimatedAddedCount(state, null), null);
  assert.equal(estimatedIncreasePercent(defaultAugmentationState()), 0);
});

test("無効化しても値は保持され、再度ONで直前の設定値へ戻る", () => {
  let state = structuredClone(WEAK_AUGMENTATION);
  state = setAugItemValue(state, AUG_ITEM_DEFS[0], { max_degrees: 5, probability: 0.8 });
  state = setAugItemEnabled(state, "rotation", false);
  // OFF後も値が残る
  assert.equal(state.rotation.enabled, false);
  assert.equal(state.rotation.max_degrees, 5);
  assert.equal(state.rotation.probability, 0.8);
  // ONへ戻すと直前の値のまま有効化される
  state = setAugItemEnabled(state, "rotation", true);
  assert.equal(state.rotation.enabled, true);
  assert.equal(state.rotation.max_degrees, 5);
  assert.equal(state.rotation.probability, 0.8);
  // 編集でプリセットはcustomへ（既存挙動の維持）
  assert.equal(state.preset, "custom");
});

test("推奨設定の適用は既存の標準プリセット（weak）と一致する", () => {
  assert.deepEqual(recommendedAugmentationState(), WEAK_AUGMENTATION);
});

test("リセットは既定（なし）へ戻す", () => {
  const state = resetAugmentationState();
  assert.equal(state.preset, "none");
  assert.equal(isAugmentationOff(state), true);
});

test("既存保存値（旧stateそのまま）を読み込んで集計できる", () => {
  // 旧UIで保存されていた形式（キー・値の意味は不変）
  const legacy = {
    preset: "custom",
    multiplier: 2,
    rotation: { enabled: true, max_degrees: 2.0, probability: 0.3 },
    brightness: { enabled: false, range: 0.1, probability: 0.3 },
    contrast: { enabled: true, range: 0.2, probability: 0.4 },
    blur: { enabled: false, strength: "weak", probability: 0.1 },
    noise: { enabled: true, strength: "medium", probability: 0.1 },
  };
  assert.equal(enabledAugItemCount(legacy), 3);
  assert.equal(averageAugProbabilityPercent(legacy), Math.round(((0.3 + 0.4 + 0.1) / 3) * 100));
  assert.deepEqual(enabledAugItemLabels(legacy), ["回転", "コントラスト", "ノイズ"]);
});

test("不正値のバリデーション: 既存範囲へクランプし、範囲自体は変更しない", () => {
  const rotation = AUG_ITEM_DEFS.find((def) => def.key === "rotation");
  assert.equal(clampAugValue(rotation, 999), 10); // max=10（既存min/max属性と同一）
  assert.equal(clampAugValue(rotation, -5), 0);
  assert.equal(clampAugValue(rotation, "abc"), 2); // 不正入力はfallback
  const brightness = AUG_ITEM_DEFS.find((def) => def.key === "brightness");
  assert.equal(clampAugValue(brightness, 0.9), 0.5); // max=0.5（±50%）
  assert.equal(clampProbability(1.5), 1);
  assert.equal(clampProbability(-1), 0);
  assert.equal(clampProbability("x"), 0.3);
});

test("サマリー表示: buildAugSummary と カテゴリサマリーラベル", () => {
  const summary = buildAugSummary(structuredClone(WEAK_AUGMENTATION), 100);
  assert.deepEqual(summary, {
    enabled: 5,
    total: 5,
    avgProbabilityPercent: 22,
    multiplier: 1.5,
    increasePercent: 50,
    addedCount: 50,
  });
  assert.equal(augCategorySummaryLabel(defaultAugmentationState()), "なし");
  assert.equal(augCategorySummaryLabel(structuredClone(WEAK_AUGMENTATION)), "適用項目数: 5 / 5・生成倍率: 1.5倍");
});
