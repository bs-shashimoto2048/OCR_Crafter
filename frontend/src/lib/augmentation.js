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

// 強度ラベル（弱/中）→実効パラメータ。バックエンド services/ocr_pipeline.py の
// AUGMENTATION_STRENGTH_PARAMS の手動ミラー（既存のWEAK_AUGMENTATION_CONFIG複製方針と同じ）。
// 実際の画素変換はサーバー側のみで行うため、ここは表示専用（値を変更する場合は両方を同期すること）
export const AUGMENTATION_STRENGTH_PARAMS = {
  weak: { blurRadiusRange: [0.3, 0.6], noiseSigma: 3.0 },
  medium: { blurRadiusRange: [0.5, 0.9], noiseSigma: 6.0 },
};

function strengthKey(value) {
  const key = String(value || "weak").toLowerCase();
  return Object.prototype.hasOwnProperty.call(AUGMENTATION_STRENGTH_PARAMS, key) ? key : "weak";
}

// オーグメンテーション設定の表示値(display)と実効値(effective)を組み立てる共通定義。
// 学習画面のプレビュー・モデル管理の履歴表示・比較画面のすべてがこの関数を使う
// （バックエンドの build_effective_augmentation と同一構造。学習実行時のスナップショットは
// バックエンド側の同名関数が正として計算し保存する）。
export function buildEffectiveAugmentation(config) {
  const hasAny =
    config &&
    typeof config === "object" &&
    ["rotation", "brightness", "contrast", "blur", "noise"].some((key) => config[key]?.enabled);
  if (!hasAny) {
    return { enabled: false, display: {}, effective: {} };
  }
  const effective = {};
  if (config.rotation?.enabled) {
    const maxDeg = Number(config.rotation.max_degrees ?? 2.0);
    effective.rotation = { minDegrees: -maxDeg, maxDegrees: maxDeg, probability: Number(config.rotation.probability ?? 0) };
  }
  if (config.brightness?.enabled) {
    const r = Number(config.brightness.range ?? 0.1);
    effective.brightness = { minFactor: round4(1 - r), maxFactor: round4(1 + r), probability: Number(config.brightness.probability ?? 0) };
  }
  if (config.contrast?.enabled) {
    const r = Number(config.contrast.range ?? 0.1);
    effective.contrast = { minFactor: round4(1 - r), maxFactor: round4(1 + r), probability: Number(config.contrast.probability ?? 0) };
  }
  if (config.blur?.enabled) {
    const strength = strengthKey(config.blur.strength);
    const [low, high] = AUGMENTATION_STRENGTH_PARAMS[strength].blurRadiusRange;
    effective.blur = { strength, radiusMin: low, radiusMax: high, probability: Number(config.blur.probability ?? 0) };
  }
  if (config.noise?.enabled) {
    const strength = strengthKey(config.noise.strength);
    effective.noise = {
      strength,
      sigma: AUGMENTATION_STRENGTH_PARAMS[strength].noiseSigma,
      probability: Number(config.noise.probability ?? 0),
    };
  }
  return { enabled: true, display: structuredClone(config), effective };
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

const MISSING = "未記録";
const STRENGTH_JA_LABELS = { weak: "弱", medium: "中" };

// モデル比較（学習条件比較「オーグメンテーション」セクション）向けの正規化。
// info=/models/info の1件。新形式（augmentation_config）が無い場合は旧形式（ocr_augmentation）の
// 有無のみ判定し、項目別の内訳は出さない（旧形式に項目別の記録が無いため）
export function normalizeAugmentationForCompare(info = {}) {
  const config = info.augmentation_config && typeof info.augmentation_config === "object" ? info.augmentation_config : null;
  const legacy = info.ocr_augmentation || {};
  const legacyEnabled = legacy?.enabled === null || legacy?.enabled === undefined ? null : Boolean(legacy.enabled);
  const built = buildEffectiveAugmentation(config);
  return {
    hasNewFormat: Boolean(config),
    legacyEnabled,
    presetLabel: augmentationPresetLabel(config, legacyEnabled),
    multiplier: config?.multiplier ?? null,
    effective: built.effective,
    display: built.display,
  };
}

// 新形式の記録が無く、旧形式の記録も無い（本当に未記録）場合のみ MISSING
function isAugCompareMissing(a) {
  return !a.hasNewFormat && a.legacyEnabled === null;
}

function augRangeRow(a, key) {
  if (isAugCompareMissing(a)) return MISSING;
  if (!a.hasNewFormat) return "-";
  const eff = a.effective[key];
  if (!eff) return "OFF";
  const pct = Math.round((1 - eff.minFactor) * 100);
  return `${Math.round(eff.probability * 100)}% / -${pct}%〜+${pct}%`;
}

function augStrengthRow(a, key) {
  if (isAugCompareMissing(a)) return MISSING;
  if (!a.hasNewFormat) return "-";
  const eff = a.effective[key];
  if (!eff) return "OFF";
  const label = STRENGTH_JA_LABELS[eff.strength] || eff.strength;
  const effectiveValue = key === "blur" ? `radius=${eff.radiusMin}-${eff.radiusMax}` : `sigma=${eff.sigma}`;
  return `${Math.round(eff.probability * 100)}% / ${label} / ${effectiveValue}`;
}

// オーグメンテーション比較セクションの行定義（学習条件比較「オーグメンテーション」セクション）。
// 抽象表現（確率・強度）と実効値（実際の内部パラメータ）の両方を1行に表示する
export const AUGMENTATION_COMPARISON_ROWS = [
  { key: "augCompactPreset", label: "プリセット", value: (a) => (isAugCompareMissing(a) ? MISSING : a.presetLabel || MISSING) },
  {
    key: "augCompactMultiplier",
    label: "生成倍率",
    value: (a) => (isAugCompareMissing(a) ? MISSING : a.multiplier != null ? `${a.multiplier}倍` : "-"),
  },
  {
    key: "augCompactRotation",
    label: "回転",
    value: (a) => {
      if (isAugCompareMissing(a)) return MISSING;
      if (!a.hasNewFormat) return "-";
      const eff = a.effective.rotation;
      if (!eff) return "OFF";
      return `${Math.round(eff.probability * 100)}% / -${eff.maxDegrees}°〜+${eff.maxDegrees}°`;
    },
  },
  { key: "augCompactBrightness", label: "明るさ", value: (a) => augRangeRow(a, "brightness") },
  { key: "augCompactContrast", label: "コントラスト", value: (a) => augRangeRow(a, "contrast") },
  { key: "augCompactBlur", label: "ぼかし", value: (a) => augStrengthRow(a, "blur") },
  { key: "augCompactNoise", label: "ノイズ", value: (a) => augStrengthRow(a, "noise") },
];

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
