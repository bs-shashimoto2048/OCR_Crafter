// 次回学習の設定インライン編集のスナップショット・差分判定テスト（lib/trainingSettingsDraft.js）
import assert from "node:assert/strict";
import { test } from "node:test";

import { SETTINGS_DRAFT_KEYS, collectSettingsSnapshot, isSettingsDirty } from "../src/lib/trainingSettingsDraft.js";

function sampleValues(overrides = {}) {
  return {
    trainRatio: 0.8,
    valRatio: 0.1,
    testRatio: 0.1,
    ocrSplitSeed: 42,
    ocrDatasetCreateMode: "new",
    ocrFromLogsOnlyInvalid: false,
    ocrFromLogsIncludeCorrected: true,
    ocrAugmentation: { preset: "none", multiplier: 1.5, rotation: { enabled: false, max_degrees: 2, probability: 0.3 } },
    ocrEngine: "tesseract",
    epochs: 1500,
    ocrTrainDevice: "cpu",
    ocrCharset: "ABC123klt",
    experimentName: "",
    parentModelId: "",
    trainingNote: "",
    ocrInitSourceType: "scratch",
    ocrInitSourceValue: "",
    ocrSaveEpochStep: 10,
    ocrTrainNumWorkers: 0,
    ocrEvalNumWorkers: 0,
    ocrAutoBatchSize: false,
    ocrUseAmp: false,
    ocrPinMemory: false,
    ocrPersistentWorkers: false,
    batchSize: 16,
    ocrMaxTextLength: 8,
    ocrImageShape: "1,48,320",
    ...overrides,
  };
}

test("スナップショットは編集対象キーをすべて含み、オブジェクトは複製される（後の編集の影響を受けない）", () => {
  const values = sampleValues();
  const snapshot = collectSettingsSnapshot(values);
  for (const key of SETTINGS_DRAFT_KEYS) {
    assert.ok(key in snapshot, key);
  }
  // 元オブジェクトを変更してもスナップショットは変わらない
  values.ocrAugmentation.rotation.enabled = true;
  assert.equal(snapshot.ocrAugmentation.rotation.enabled, false);
});

test("未変更なら差分なし（確認なしで閉じられる）", () => {
  const snapshot = collectSettingsSnapshot(sampleValues());
  assert.equal(isSettingsDirty(snapshot, sampleValues()), false);
});

test("値の変更・ネスト変更で差分ありになる", () => {
  const snapshot = collectSettingsSnapshot(sampleValues());
  assert.equal(isSettingsDirty(snapshot, sampleValues({ epochs: 3000 })), true);
  assert.equal(isSettingsDirty(snapshot, sampleValues({ trainRatio: 0.7 })), true);
  const aug = sampleValues();
  aug.ocrAugmentation = { ...aug.ocrAugmentation, preset: "weak" };
  assert.equal(isSettingsDirty(snapshot, aug), true);
});

test("スナップショット未採取（編集未開始）は常に差分なし", () => {
  assert.equal(isSettingsDirty(null, sampleValues()), false);
  assert.equal(isSettingsDirty(undefined, sampleValues()), false);
});

test("undefined値はnullへ正規化され、undefined同士は差分にならない", () => {
  const snapshot = collectSettingsSnapshot(sampleValues({ experimentName: undefined }));
  assert.equal(snapshot.experimentName, null);
  assert.equal(isSettingsDirty(snapshot, sampleValues({ experimentName: undefined })), false);
});

test("編集対象外のキーは差分判定に影響しない", () => {
  const snapshot = collectSettingsSnapshot(sampleValues());
  assert.equal(isSettingsDirty(snapshot, { ...sampleValues(), unrelated: "x" }), false);
});
