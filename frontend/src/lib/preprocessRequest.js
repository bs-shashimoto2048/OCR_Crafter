// 前処理リクエストの共通ペイロード生成。
// /preprocess/preview（リアルタイムプレビュー）と /preprocess/run（学習用processed生成）が
// 「同一の正規化ロジック・同一のoverrides」を使うことを保証する（別々に組み立てない）。
// UI値の正規化（型変換・未指定値の補完）はここへ集約し、実行前の設定要約も同じデータから生成する。

// 二値化方式の表示名（要約・UI共通）
export const THRESHOLD_TYPE_LABELS = {
  none: "なし",
  otsu: "大津法",
  binary: "固定しきい値",
  adaptive: "適応的しきい値",
};

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// UIパラメータ → /preprocess/preview・/preprocess/run 共通の overrides（正規化済み）。
// 未指定・不正値は既定値で補完し、無効工程も enabled:false として明示的に送る
// （サーバー側の解決結果がUIの表示状態と一致するように）。single/wide の分岐は
// サーバーのパイプライン定義（settings.yaml pipelines）側で行われるため、ここでは共通値を送る
export function normalizePreprocessOverrides(params = {}) {
  return {
    preprocess: {
      ratio_threshold: num(params.ratio_threshold, 1.6),
      operations: {
        manual_mask: {
          enabled: Boolean(params.manual_mask_enabled),
          fill: params.manual_mask_fill || "white",
          timing: params.manual_mask_timing || "post",
        },
        illumination: {
          enabled: Boolean(params.illumination_enabled),
          method: params.illumination_method || "gaussian",
          background_size: num(params.illumination_background_size, 81),
          strength: num(params.illumination_strength, 1.0),
        },
        threshold: {
          type: params.threshold_type || "binary",
          value: num(params.threshold_value, 128),
          block_size: num(params.threshold_block_size, 35),
          c: num(params.threshold_c, 11),
        },
        clahe: {
          clip_limit: num(params.clahe_clip_limit, 1.0),
          tile_grid_size: num(params.clahe_tile_grid_size, 2),
        },
        sharpen: {
          enabled: Boolean(params.sharpen_enabled),
          amount: num(params.sharpen_amount, 0.2),
          sigma: num(params.sharpen_sigma, 0.5),
        },
        gamma: {
          enabled: Boolean(params.gamma_enabled),
          value: num(params.gamma_value, 1.0),
        },
        morph: {
          enabled: Boolean(params.morph_enabled),
          method: params.morph_method || "close",
          ksize: num(params.morph_ksize, 3),
          iterations: num(params.morph_iterations, 1),
        },
        unsharp: {
          enabled: Boolean(params.unsharp_enabled),
          amount: num(params.unsharp_amount, 0.8),
          radius: num(params.unsharp_radius, 1.0),
          threshold: num(params.unsharp_threshold, 0),
        },
        bilateral: {
          enabled: Boolean(params.bilateral_enabled),
          diameter: num(params.bilateral_diameter, 5),
          sigma_color: num(params.bilateral_sigma_color, 50),
          sigma_space: num(params.bilateral_sigma_space, 50),
        },
        local_contrast: {
          enabled: Boolean(params.local_contrast_enabled),
          clip_limit: num(params.local_contrast_clip_limit, 2.0),
          tile_grid_size: num(params.local_contrast_tile_grid_size, 8),
        },
        crop_margin: {
          enabled: Boolean(params.crop_margin_enabled),
          threshold: num(params.crop_margin_threshold, 245),
          margin: num(params.crop_margin_margin, 2),
        },
        hist_equalize: {
          enabled: Boolean(params.hist_equalize_enabled),
        },
        stroke_boost: {
          enabled: Boolean(params.stroke_boost_enabled),
          method: params.stroke_boost_method || "close",
          ksize: num(params.stroke_boost_ksize, 1),
          iterations: num(params.stroke_boost_iterations, 1),
        },
        denoise: {
          method: params.denoise_method || "gaussian",
          ksize: num(params.denoise_ksize, 1),
        },
        deskew: {
          enabled: Boolean(params.deskew_enabled),
        },
        resize: {
          single: num(params.single_size, 64),
          wide_height: num(params.wide_height, 48),
          keep_ratio: Boolean(params.wide_keep_ratio),
        },
      },
    },
  };
}

// /preprocess/preview 用ペイロード（overridesは run と同一の共通関数で生成）
export function buildPreprocessPreviewPayload({ image, projectId, params, fields = {} }) {
  return {
    image,
    project_id: projectId,
    overrides: normalizePreprocessOverrides(params),
    ...fields,
  };
}

// /preprocess/run 用ペイロード（overridesは preview と同一の共通関数で生成）
export function buildPreprocessRunPayload({ projectId, params }) {
  return {
    project_id: projectId,
    overrides: normalizePreprocessOverrides(params),
  };
}

// 「前処理を実行」前の設定要約。/preprocess/run へ送信するペイロードと同じデータ
// （normalizePreprocessOverridesの結果）から生成する（UI状態から別途組み立てない）
export function summarizePreprocessRun(params = {}) {
  const ops = normalizePreprocessOverrides(params).preprocess.operations;
  const onOff = (enabled) => (enabled ? "ON" : "OFF");
  const thresholdType = String(ops.threshold.type);
  const thresholdLabel =
    thresholdType === "binary"
      ? `固定しきい値 ${ops.threshold.value}`
      : thresholdType === "adaptive"
        ? `適応的（block ${ops.threshold.block_size} / C ${ops.threshold.c}）`
        : THRESHOLD_TYPE_LABELS[thresholdType] || thresholdType;
  const lines = [
    { label: "二値化", value: thresholdLabel },
    { label: "照明ムラ補正", value: onOff(ops.illumination.enabled) },
    { label: "CLAHE", value: `clip ${ops.clahe.clip_limit} / tile ${ops.clahe.tile_grid_size}（wideのみ）` },
    { label: "傾き補正", value: `${onOff(ops.deskew.enabled)}（wideのみ）` },
    { label: "手動マスク補正", value: ops.manual_mask.enabled ? `ON（${ops.manual_mask.timing === "pre" ? "二値化前" : "二値化後"}）` : "OFF" },
    { label: "オープン/クローズ", value: onOff(ops.morph.enabled) },
    { label: "掠れ補正", value: onOff(ops.stroke_boost.enabled) },
    { label: "ノイズ除去", value: `${ops.denoise.method} k${ops.denoise.ksize}` },
    {
      label: "出力サイズ",
      value: `single ${ops.resize.single}px / wide 高さ${ops.resize.wide_height}px${ops.resize.keep_ratio ? "（比率維持）" : ""}`,
    },
  ];
  return lines;
}

// normalizePreprocessOverrides の逆変換: 解決済み設定（{ratio_threshold, operations}。
// 保存済み設定の復元=training_preprocess_to_config の戻り値）→ UIパラメータ（preprocessParams）へ。
// 「保存時の設定に戻す」で、プリセット読込のようにUI表示ではなく実際のプロジェクト前処理設定へ
// 反映する際に使う（新しい設定構造・正規化ロジックは追加しない。既存normalizeの対称のみ）
export function denormalizePreprocessOperations(cfg = {}) {
  const ops = (cfg && cfg.operations) || {};
  const manualMask = ops.manual_mask || {};
  const illumination = ops.illumination || {};
  const threshold = ops.threshold || {};
  const clahe = ops.clahe || {};
  const sharpen = ops.sharpen || {};
  const gamma = ops.gamma || {};
  const morph = ops.morph || {};
  const unsharp = ops.unsharp || {};
  const bilateral = ops.bilateral || {};
  const localContrast = ops.local_contrast || {};
  const cropMargin = ops.crop_margin || {};
  const histEqualize = ops.hist_equalize || {};
  const strokeBoost = ops.stroke_boost || {};
  const denoise = ops.denoise || {};
  const deskew = ops.deskew || {};
  const resize = ops.resize || {};

  return {
    ratio_threshold: num(cfg.ratio_threshold, 1.6),
    manual_mask_enabled: Boolean(manualMask.enabled),
    manual_mask_fill: manualMask.fill || "white",
    manual_mask_timing: manualMask.timing || "post",
    illumination_enabled: Boolean(illumination.enabled),
    illumination_method: illumination.method || "gaussian",
    illumination_background_size: num(illumination.background_size, 81),
    illumination_strength: num(illumination.strength, 1.0),
    threshold_type: threshold.type || "binary",
    threshold_value: num(threshold.value, 128),
    threshold_block_size: num(threshold.block_size, 35),
    threshold_c: num(threshold.c, 11),
    clahe_clip_limit: num(clahe.clip_limit, 1.0),
    clahe_tile_grid_size: num(clahe.tile_grid_size, 2),
    sharpen_enabled: Boolean(sharpen.enabled),
    sharpen_amount: num(sharpen.amount, 0.2),
    sharpen_sigma: num(sharpen.sigma, 0.5),
    gamma_enabled: Boolean(gamma.enabled),
    gamma_value: num(gamma.value, 1.0),
    morph_enabled: Boolean(morph.enabled),
    morph_method: morph.method || "close",
    morph_ksize: num(morph.ksize, 3),
    morph_iterations: num(morph.iterations, 1),
    unsharp_enabled: Boolean(unsharp.enabled),
    unsharp_amount: num(unsharp.amount, 0.8),
    unsharp_radius: num(unsharp.radius, 1.0),
    unsharp_threshold: num(unsharp.threshold, 0),
    bilateral_enabled: Boolean(bilateral.enabled),
    bilateral_diameter: num(bilateral.diameter, 5),
    bilateral_sigma_color: num(bilateral.sigma_color, 50),
    bilateral_sigma_space: num(bilateral.sigma_space, 50),
    local_contrast_enabled: Boolean(localContrast.enabled),
    local_contrast_clip_limit: num(localContrast.clip_limit, 2.0),
    local_contrast_tile_grid_size: num(localContrast.tile_grid_size, 8),
    crop_margin_enabled: Boolean(cropMargin.enabled),
    crop_margin_threshold: num(cropMargin.threshold, 245),
    crop_margin_margin: num(cropMargin.margin, 2),
    hist_equalize_enabled: Boolean(histEqualize.enabled),
    stroke_boost_enabled: Boolean(strokeBoost.enabled),
    stroke_boost_method: strokeBoost.method || "close",
    stroke_boost_ksize: num(strokeBoost.ksize, 1),
    stroke_boost_iterations: num(strokeBoost.iterations, 1),
    denoise_method: denoise.method || "gaussian",
    denoise_ksize: num(denoise.ksize, 1),
    deskew_enabled: Boolean(deskew.enabled),
    single_size: num(resize.single, 64),
    wide_height: num(resize.wide_height, 48),
    wide_keep_ratio: Boolean(resize.keep_ratio),
  };
}

// window.confirm 等で使う要約テキスト（注意文つき）
export function preprocessRunConfirmText(params) {
  const lines = summarizePreprocessRun(params)
    .map((row) => `・${row.label}: ${row.value}`)
    .join("\n");
  return (
    "現在の画面設定で全画像のprocessed画像を再生成します。\n" +
    "既存の学習用画像・前処理スナップショットが更新されます。\n\n" +
    `実行設定:\n${lines}\n\n実行しますか？`
  );
}
