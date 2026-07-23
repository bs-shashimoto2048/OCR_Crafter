// 次回学習の設定（インライン編集）の編集開始スナップショットと差分判定。
// 編集はモーダルを使わず学習画面左パネル内で行い、変更は既存stateへ直接反映される。
// 「変更を破棄」時にここで採取したスナップショットへ復元する（設定キー・保存形式は不変）。

// 編集対象のキー（4タブ: データ分割/オーグメンテーション/学習パラメータ/エンジン設定 で編集できる値）
export const SETTINGS_DRAFT_KEYS = [
  // データ分割
  "trainRatio",
  "valRatio",
  "testRatio",
  "ocrSplitSeed",
  "ocrDatasetCreateMode",
  "ocrFromLogsOnlyInvalid",
  "ocrFromLogsIncludeCorrected",
  // オーグメンテーション
  "ocrAugmentation",
  // 学習パラメータ
  "ocrEngine",
  "epochs",
  "ocrTrainDevice",
  // エンジン設定
  "ocrCharset",
  "experimentName",
  "parentModelId",
  "trainingNote",
  "ocrInitSourceType",
  "ocrInitSourceValue",
  "ocrSaveEpochStep",
  "ocrTrainNumWorkers",
  "ocrEvalNumWorkers",
  "ocrAutoBatchSize",
  "ocrUseAmp",
  "ocrPinMemory",
  "ocrPersistentWorkers",
  "batchSize",
  "ocrMaxTextLength",
  "ocrImageShape",
];

// 現在値からスナップショットを採取する（オブジェクトは複製し、後の編集の影響を受けない）
export function collectSettingsSnapshot(values) {
  const snapshot = {};
  for (const key of SETTINGS_DRAFT_KEYS) {
    const value = values?.[key];
    if (value === undefined) {
      snapshot[key] = null; // JSON比較で欠落キーとの差が出ないよう正規化
    } else if (value && typeof value === "object") {
      snapshot[key] = structuredClone(value);
    } else {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

// 編集開始時スナップショットと現在値の差分判定（キー順固定のJSON比較）。
// snapshotがない（編集未開始）場合は常にfalse=確認なしで閉じられる
export function isSettingsDirty(snapshot, currentValues) {
  if (!snapshot) return false;
  return JSON.stringify(collectSettingsSnapshot(snapshot)) !== JSON.stringify(collectSettingsSnapshot(currentValues));
}
