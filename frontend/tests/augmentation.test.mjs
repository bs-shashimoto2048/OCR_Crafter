// 学習時オーグメンテーション設定（lib/augmentation.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUG_PRESET_LABELS,
  WEAK_AUGMENTATION,
  applyAugmentationPreset,
  augmentationPresetLabel,
  augmentationSummary,
  buildAugmentationPayload,
  defaultAugmentationState,
} from "../src/lib/augmentation.js";

test("プリセット: なし/弱い/カスタムの3種（強いは提供しない）", () => {
  assert.deepEqual(Object.keys(AUG_PRESET_LABELS), ["none", "weak", "custom"]);
});

test("defaultAugmentationState: 既定はなし（無効）", () => {
  const state = defaultAugmentationState();
  assert.equal(state.preset, "none");
  assert.equal(buildAugmentationPayload(state), null); // none=API未送信
});

test("applyAugmentationPreset: 弱い=OCR推奨値を一括適用", () => {
  const weak = applyAugmentationPreset(defaultAugmentationState(), "weak");
  assert.equal(weak.preset, "weak");
  assert.equal(weak.rotation.max_degrees, 2.0);
  assert.equal(weak.rotation.probability, 0.3);
  assert.equal(weak.brightness.range, 0.1);
  assert.equal(weak.blur.strength, "weak");
  assert.equal(weak.blur.probability, 0.1);
  assert.equal(weak.multiplier, 1.5);
});

test("applyAugmentationPreset: カスタムは現在値を維持して編集可能", () => {
  const weak = applyAugmentationPreset(defaultAugmentationState(), "weak");
  weak.rotation.max_degrees = 5;
  const custom = applyAugmentationPreset(weak, "custom");
  assert.equal(custom.preset, "custom");
  assert.equal(custom.rotation.max_degrees, 5); // 値は維持
});

test("buildAugmentationPayload: none以外は設定をそのまま送信（元stateを共有しない）", () => {
  const weak = applyAugmentationPreset(defaultAugmentationState(), "weak");
  const payload = buildAugmentationPayload(weak);
  assert.equal(payload.preset, "weak");
  payload.rotation.max_degrees = 99;
  assert.equal(weak.rotation.max_degrees, 2.0); // ディープコピー
});

test("augmentationSummary: 有効な変換だけを列挙し倍率を併記", () => {
  const summary = augmentationSummary(WEAK_AUGMENTATION);
  assert.ok(summary.includes("回転±2°"));
  assert.ok(summary.includes("明るさ±10%"));
  assert.ok(summary.includes("ぼかし弱"));
  assert.ok(summary.includes("×1.5"));
  // 全て無効なら「なし」
  assert.equal(
    augmentationSummary({ preset: "custom", rotation: { enabled: false }, brightness: {}, contrast: {}, blur: {}, noise: {} }),
    "なし"
  );
  // 旧形式はlegacyTextで表示・未記録は空
  assert.equal(augmentationSummary(null, "ON（強度 2）"), "ON（強度 2）");
  assert.equal(augmentationSummary(null, ""), "");
});

test("augmentationPresetLabel: 新形式はプリセット名・旧形式/未記録はフォールバック", () => {
  assert.equal(augmentationPresetLabel(WEAK_AUGMENTATION), "弱い");
  assert.equal(augmentationPresetLabel({ preset: "custom" }), "カスタム");
  assert.equal(augmentationPresetLabel(null, true), "旧形式（強度指定）");
  assert.equal(augmentationPresetLabel(null, false), "なし");
  assert.equal(augmentationPresetLabel(null, null), ""); // 未記録（UI側で「未記録」表示）
});
