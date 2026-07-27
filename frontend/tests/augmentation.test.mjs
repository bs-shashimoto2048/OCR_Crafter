// 学習時オーグメンテーション設定（lib/augmentation.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUG_PRESET_LABELS,
  AUGMENTATION_COMPARISON_ROWS,
  AUGMENTATION_STRENGTH_PARAMS,
  WEAK_AUGMENTATION,
  applyAugmentationPreset,
  augmentationPresetLabel,
  augmentationSummary,
  buildAugmentationPayload,
  buildEffectiveAugmentation,
  defaultAugmentationState,
  normalizeAugmentationForCompare,
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

test("buildEffectiveAugmentation: weakプリセットの実効値（sigma=3・radius=0.3-0.6・±2°）", () => {
  const built = buildEffectiveAugmentation(WEAK_AUGMENTATION);
  assert.equal(built.enabled, true);
  assert.deepEqual(built.effective.rotation, { minDegrees: -2, maxDegrees: 2, probability: 0.3 });
  assert.equal(built.effective.brightness.minFactor, 0.9);
  assert.equal(built.effective.brightness.maxFactor, 1.1);
  assert.equal(built.effective.blur.radiusMin, 0.3);
  assert.equal(built.effective.blur.radiusMax, 0.6);
  assert.equal(built.effective.noise.sigma, 3.0);
  // displayは設定値そのもの（抽象値）を保持する
  assert.equal(built.display.preset, "weak");
});

test("buildEffectiveAugmentation: strength=mediumはsigma=6・radius=0.5-0.9", () => {
  const config = { ...structuredClone(WEAK_AUGMENTATION), noise: { enabled: true, strength: "medium", probability: 0.1 }, blur: { enabled: true, strength: "medium", probability: 0.1 } };
  const built = buildEffectiveAugmentation(config);
  assert.equal(built.effective.noise.sigma, AUGMENTATION_STRENGTH_PARAMS.medium.noiseSigma);
  assert.equal(built.effective.blur.radiusMin, AUGMENTATION_STRENGTH_PARAMS.medium.blurRadiusRange[0]);
  assert.equal(built.effective.blur.radiusMax, AUGMENTATION_STRENGTH_PARAMS.medium.blurRadiusRange[1]);
});

test("buildEffectiveAugmentation: 設定なし・全項目disabledはenabled=false", () => {
  assert.equal(buildEffectiveAugmentation(null).enabled, false);
  assert.equal(
    buildEffectiveAugmentation({ preset: "custom", rotation: { enabled: false }, brightness: {}, contrast: {}, blur: {}, noise: {} }).enabled,
    false
  );
});

test("buildEffectiveAugmentation: displayは元オブジェクトを複製する（参照共有しない）", () => {
  const built = buildEffectiveAugmentation(WEAK_AUGMENTATION);
  built.display.rotation.max_degrees = 999;
  assert.equal(WEAK_AUGMENTATION.rotation.max_degrees, 2.0);
});

function rowValue(key, info) {
  const row = AUGMENTATION_COMPARISON_ROWS.find((r) => r.key === key);
  return row.value(normalizeAugmentationForCompare(info));
}

test("学習条件比較「オーグメンテーション」セクション: プリセット・生成倍率・各項目を確率+実効値で表示する", () => {
  const info = { augmentation_config: WEAK_AUGMENTATION };
  assert.equal(rowValue("augCompactPreset", info), "弱い");
  assert.equal(rowValue("augCompactMultiplier", info), "1.5倍");
  assert.equal(rowValue("augCompactRotation", info), "30% / -2°〜+2°");
  assert.equal(rowValue("augCompactBrightness", info), "30% / -10%〜+10%");
  assert.equal(rowValue("augCompactNoise", info), "10% / 弱 / sigma=3");
  assert.equal(rowValue("augCompactBlur", info), "10% / 弱 / radius=0.3-0.6");
});

test("学習条件比較「オーグメンテーション」セクション: 個別項目が無効ならOFF、未記録は「未記録」", () => {
  const disabledRotation = { augmentation_config: { ...structuredClone(WEAK_AUGMENTATION), rotation: { enabled: false } } };
  assert.equal(rowValue("augCompactRotation", disabledRotation), "OFF");
  // 新形式・旧形式ともに記録が無い（真の未記録）
  assert.equal(rowValue("augCompactPreset", {}), "未記録");
  assert.equal(rowValue("augCompactRotation", {}), "未記録");
  // 旧形式のみ記録（項目別の内訳は出せないため「-」）
  const legacyOnly = { ocr_augmentation: { enabled: true, strength: 2 } };
  assert.equal(rowValue("augCompactRotation", legacyOnly), "-");
});

test("augmentationPresetLabel: 新形式はプリセット名・旧形式/未記録はフォールバック", () => {
  assert.equal(augmentationPresetLabel(WEAK_AUGMENTATION), "弱い");
  assert.equal(augmentationPresetLabel({ preset: "custom" }), "カスタム");
  assert.equal(augmentationPresetLabel(null, true), "旧形式（強度指定）");
  assert.equal(augmentationPresetLabel(null, false), "なし");
  assert.equal(augmentationPresetLabel(null, null), ""); // 未記録（UI側で「未記録」表示）
});
