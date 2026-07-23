// オーグメンテーション設定UIの純ロジック（項目定義・集計・サマリー）。
// 設定キー・保存形式は lib/augmentation.js の既存形式（rotation/brightness/contrast/blur/noise +
// preset/multiplier）をそのまま使用し、変更しない。UI上の分類・表示のみをここで定義する。
// node:test から直接importするため拡張子つきで参照する（Vite・node両対応）
import { WEAK_AUGMENTATION, defaultAugmentationState } from "./augmentation.js";

// 変換項目の定義（既存の設定キーに存在する5項目のみ。存在しない変換は追加しない）
// input: degrees=±角度 / percent=±%（内部値は0-1の小数） / strength=強度（weak/medium）
export const AUG_ITEM_DEFS = [
  {
    key: "rotation",
    label: "回転",
    category: "geometry",
    description: "画像を指定範囲内でランダムに回転します",
    tooltip:
      "画像を指定した角度範囲内でランダムに回転します。文字の傾きに対する耐性を高めます。大きすぎる角度は実データとの差を増やすため注意してください。",
    input: { type: "degrees", valueKey: "max_degrees", min: 0, max: 10, step: 0.5, fallback: 2 },
  },
  {
    key: "brightness",
    label: "明るさ",
    category: "brightness",
    description: "明るさをランダムに変化させます",
    tooltip:
      "画像の明るさを指定範囲内でランダムに変化させます。照明条件の違い（明るい/暗い環境での撮影）への耐性を高めます。",
    input: { type: "percent", valueKey: "range", min: 0, max: 0.5, step: 0.05, fallback: 0.1 },
  },
  {
    key: "contrast",
    label: "コントラスト",
    category: "brightness",
    description: "コントラストをランダムに変化させます",
    tooltip:
      "画像のコントラストを指定範囲内でランダムに変化させます。印刷の濃淡や背景とのコントラスト差への耐性を高めます。",
    input: { type: "percent", valueKey: "range", min: 0, max: 0.5, step: 0.05, fallback: 0.1 },
  },
  {
    key: "blur",
    label: "ぼかし（ガウシアン）",
    category: "noise",
    description: "軽微なガウシアンぼかしを適用します",
    tooltip:
      "軽微なガウシアンぼかしを適用します。ピントの甘さや撮影距離の違いを再現します。強すぎると文字形状が失われるため「弱」を推奨します。",
    input: { type: "strength", valueKey: "strength", fallback: "weak" },
  },
  {
    key: "noise",
    label: "ノイズ",
    category: "noise",
    description: "ランダムなノイズを追加します",
    tooltip: "画像へランダムなノイズを追加します。撮影時のセンサーノイズや印刷の荒れを再現します。",
    input: { type: "strength", valueKey: "strength", fallback: "weak" },
  },
];

// 設定カテゴリ（UI表示上の分類。設定キーには影響しない）
export const AUG_CATEGORIES = [
  { id: "geometry", label: "幾何変換" },
  { id: "brightness", label: "明るさ・コントラスト" },
  { id: "noise", label: "ノイズ・ぼかし" },
].map((category) => ({
  ...category,
  items: AUG_ITEM_DEFS.filter((item) => item.category === category.id),
}));

export const AUG_STRENGTH_LABELS = { weak: "弱", medium: "中" };

export const MULTIPLIER_TOOLTIP =
  "元画像数に対して、学習用画像をどの程度増やすかを指定します（追加生成枚数 =（倍率 − 1）× Train枚数）。実際の生成枚数はデータ件数や除外条件により変動します。";

// 適用モード（preset）が「なし」か
export function isAugmentationOff(state) {
  return !state || String(state.preset || "none") === "none";
}

// 有効項目数（適用モードが「なし」の場合は0）
export function enabledAugItemCount(state) {
  if (isAugmentationOff(state)) return 0;
  return AUG_ITEM_DEFS.filter((def) => Boolean(state?.[def.key]?.enabled)).length;
}

export function totalAugItemCount() {
  return AUG_ITEM_DEFS.length;
}

// 有効項目の平均適用確率（%・四捨五入）。有効項目なし=null
export function averageAugProbabilityPercent(state) {
  if (isAugmentationOff(state)) return null;
  const probs = AUG_ITEM_DEFS.filter((def) => Boolean(state?.[def.key]?.enabled)).map((def) =>
    Number(state?.[def.key]?.probability ?? 0)
  );
  if (probs.length === 0) return null;
  return Math.round((probs.reduce((sum, value) => sum + value, 0) / probs.length) * 100);
}

// 推定増加率（%）: 既存の生成ロジック「追加枚数=(倍率-1)×Train枚数」に基づく表示のみの換算
export function estimatedIncreasePercent(state) {
  if (isAugmentationOff(state) || enabledAugItemCount(state) === 0) return 0;
  const multiplier = Number(state?.multiplier ?? 1.5);
  return Math.round(Math.max(0, multiplier - 1) * 100);
}

// 推定追加枚数（Train枚数が分かる場合のみ。不明時はnull=率のみ表示）
export function estimatedAddedCount(state, trainCount) {
  const count = Number(trainCount);
  if (!Number.isFinite(count) || count <= 0) return null;
  if (isAugmentationOff(state) || enabledAugItemCount(state) === 0) return 0;
  const multiplier = Number(state?.multiplier ?? 1.5);
  return Math.round(Math.max(0, multiplier - 1) * count);
}

// 設定サマリー（画面下部のサマリーバー用）
export function buildAugSummary(state, trainCount = null) {
  return {
    enabled: enabledAugItemCount(state),
    total: totalAugItemCount(),
    avgProbabilityPercent: averageAugProbabilityPercent(state),
    multiplier: isAugmentationOff(state) ? null : Number(state?.multiplier ?? 1.5),
    increasePercent: estimatedIncreasePercent(state),
    addedCount: estimatedAddedCount(state, trainCount),
  };
}

// 有効な変換名の一覧（プレビューの「適用された変換名」表示用）
export function enabledAugItemLabels(state) {
  if (isAugmentationOff(state)) return [];
  return AUG_ITEM_DEFS.filter((def) => Boolean(state?.[def.key]?.enabled)).map((def) => def.label);
}

// 値のクランプ（既存のmin/max範囲そのまま。範囲外入力を保存しないためのバリデーション）
export function clampAugValue(def, value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return def.input.fallback;
  if (def.input.min == null || def.input.max == null) return num;
  return Math.min(def.input.max, Math.max(def.input.min, num));
}

// 確率のクランプ（0〜1の小数）
export function clampProbability(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.3;
  return Math.min(1, Math.max(0, num));
}

// 項目の有効/無効切替。無効化しても値（max_degrees/range/strength/probability）は保持し、
// 再度ONにすると直前の設定値へ戻る（enabledフラグのみ変更する）
export function setAugItemEnabled(state, key, enabled) {
  const base = state || defaultAugmentationState();
  const entry = base[key] || {};
  return { ...base, preset: "custom", [key]: { ...entry, enabled: Boolean(enabled) } };
}

// 項目の値変更（プリセットはcustomへ。クランプ済みの値を保存する）
export function setAugItemValue(state, def, patch) {
  const base = state || defaultAugmentationState();
  const entry = base[def.key] || {};
  return { ...base, preset: "custom", [def.key]: { ...entry, ...patch } };
}

// 推奨設定（プロジェクトテンプレートに機械可読な推奨値は存在しないため、
// 既存の標準プリセット=weak（OCR文字を壊しにくい推奨値）を適用する）
export function recommendedAugmentationState() {
  return structuredClone(WEAK_AUGMENTATION);
}

// リセット（既定=「なし」へ戻す）
export function resetAugmentationState() {
  return defaultAugmentationState();
}

// 左ペインのカテゴリサマリー表示用
export function augCategorySummaryLabel(state) {
  if (isAugmentationOff(state)) return "なし";
  return `適用項目数: ${enabledAugItemCount(state)} / ${totalAugItemCount()}・生成倍率: ${Number(state?.multiplier ?? 1.5)}倍`;
}
