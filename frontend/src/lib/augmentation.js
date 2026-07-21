// 学習時オーグメンテーション設定の純ロジック（OCR学習画面・学習条件比較で共用）。
// プリセット: none=すべて無効 / weak=OCR文字を壊しにくい推奨値 / custom=個別編集。
// 強いプリセットは意図的に提供しない（OCRでは文字形状を壊す可能性があるため）。

export const WEAK_AUGMENTATION = {
  preset: "weak",
  multiplier: 1.5,
  rotation: { enabled: true, max_degrees: 2.0, probability: 0.3 },
  brightness: { enabled: true, range: 0.1, probability: 0.3 },
  contrast: { enabled: true, range: 0.1, probability: 0.3 },
  blur: { enabled: true, strength: "weak", probability: 0.1 },
  noise: { enabled: true, strength: "weak", probability: 0.1 },
};

export const AUG_PRESET_LABELS = { none: "なし", weak: "弱い", custom: "カスタム" };

// UI状態の初期値（既定=なし）
export function defaultAugmentationState() {
  return { ...structuredClone(WEAK_AUGMENTATION), preset: "none" };
}

// プリセット変更時の状態（weakは推奨値を一括適用・customは現在値を維持して編集可能に）
export function applyAugmentationPreset(state, preset) {
  if (preset === "weak") {
    return structuredClone(WEAK_AUGMENTATION);
  }
  return { ...structuredClone(state || WEAK_AUGMENTATION), preset };
}

// API送信用のペイロード（none=null=未使用）
export function buildAugmentationPayload(state) {
  if (!state || state.preset === "none") {
    return null;
  }
  return structuredClone(state);
}

// 学習条件比較用のサマリー文字列。config=モデル情報の augmentation_config。
// 旧形式（use_augmentation/aug_strength由来の ocr_augmentation）は legacyText で表示。
export function augmentationSummary(config, legacyText = "") {
  if (config && typeof config === "object") {
    const parts = [];
    if (config.rotation?.enabled) parts.push(`回転±${config.rotation.max_degrees}°`);
    if (config.brightness?.enabled) parts.push(`明るさ±${Math.round((config.brightness.range || 0) * 100)}%`);
    if (config.contrast?.enabled) parts.push(`コントラスト±${Math.round((config.contrast.range || 0) * 100)}%`);
    if (config.blur?.enabled) parts.push(`ぼかし${config.blur.strength === "medium" ? "中" : "弱"}`);
    if (config.noise?.enabled) parts.push(`ノイズ${config.noise.strength === "medium" ? "中" : "弱"}`);
    if (parts.length === 0) return "なし";
    return `${parts.join(" ")}（×${config.multiplier ?? 1.5}）`;
  }
  return legacyText || "";
}

// プリセット表示名（未記録は空を返しUI側で「未記録」フォールバック）
export function augmentationPresetLabel(config, legacyEnabled = null) {
  if (config && typeof config === "object") {
    return AUG_PRESET_LABELS[String(config.preset)] || "カスタム";
  }
  if (legacyEnabled === true) return "旧形式（強度指定）";
  if (legacyEnabled === false) return "なし";
  return "";
}
