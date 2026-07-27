// 学習時前処理（training_preprocess）の表示・比較・差分の純ロジック。
// /models/info の training_preprocess / training_preprocess_hash（バックエンドの
// preprocess_snapshot.py が保存した実効パラメータ）を正規化し、
// モデル比較の「学習前処理比較」テーブル・差分表示・要約を組み立てる。
// 旧モデル（未記録）は recorded=false のまま扱い、推測で値を補完しない。

const MISSING = "未記録";

// ハッシュの短縮表示（sha256:先頭8桁）。表示専用で同一判定には完全ハッシュを使う
export function shortPreprocessHash(hash) {
  const text = String(hash || "");
  const body = text.startsWith("sha256:") ? text.slice(7) : text;
  return body ? body.slice(0, 8) : "";
}

// /models/info のモデル情報 → 表示用の学習時前処理レコードへ正規化する
export function normalizeTrainingPreprocess(info = {}) {
  const tp = info.training_preprocess && typeof info.training_preprocess === "object" ? info.training_preprocess : null;
  const hash = String(info.training_preprocess_hash || "");
  if (!tp) {
    return { recorded: false, hash: "", hashShort: "", snapshotId: "", createdAt: "", imageTypes: [], steps: [], stepMap: {}, normalization: null, sourceImageState: String(info.dataset_source_image_state || "") };
  }
  const imageTypes = Array.isArray(tp.image_types) ? tp.image_types.map(String) : [];
  const stepsByType = tp.steps && typeof tp.steps === "object" ? tp.steps : {};
  // 表示の主対象は学習に使った種別（wide優先。単一種別ならその種別）
  const primaryType = imageTypes.includes("wide") ? "wide" : imageTypes[0] || (stepsByType.wide ? "wide" : Object.keys(stepsByType)[0] || "");
  const steps = Array.isArray(stepsByType[primaryType]) ? stepsByType[primaryType] : [];
  const stepMap = {};
  for (const step of steps) {
    if (step && typeof step === "object" && step.name) {
      stepMap[String(step.name)] = { enabled: step.enabled === true, params: step.params && typeof step.params === "object" ? step.params : {} };
    }
  }
  return {
    recorded: true,
    hash,
    hashShort: shortPreprocessHash(hash),
    snapshotId: String(tp.snapshot_id || ""),
    createdAt: String(tp.created_at || ""),
    pipelineVersion: String(tp.pipeline_version || ""),
    imageTypes,
    primaryType,
    steps,
    stepMap,
    normalization: tp.ocr_input_normalization && typeof tp.ocr_input_normalization === "object" ? tp.ocr_input_normalization : null,
    sourceImageState: String(info.dataset_source_image_state || ""),
    raw: tp,
  };
}

const onOff = (step) => (step ? (step.enabled ? "ON" : "OFF") : "工程なし");
const num = (v, digits = 2) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(digits)).toString() : "-");

// 二値化の表示（Binary 128 / Otsu / Adaptive(35, 11) / OFF）
export function thresholdLabel(pre) {
  const step = pre?.stepMap?.threshold;
  if (!step) return "工程なし";
  if (!step.enabled) return "OFF";
  const type = String(step.params?.type || "otsu").toLowerCase();
  if (type === "otsu") return "Otsu";
  if (type === "adaptive") return `Adaptive(${num(step.params?.block_size, 0)}, ${num(step.params?.c, 0)})`;
  return `Binary ${num(step.params?.value, 0)}`;
}

// 入力整形の表示（320×48・中央・白背景）
export function normalizationLabel(pre) {
  const n = pre?.normalization;
  if (!n) return MISSING;
  return `${num(n.canvas_width, 0)}×${num(n.target_height, 0)}`;
}

// 学習前処理比較テーブル・学習前処理タブ共通の行定義（label / 値の取り出し）。
// 実際の学習パイプライン（config/settings.yaml preprocess.pipelines）に存在する工程のみを列挙する
// （存在しない前処理を追加しない。§20の調査結果に基づく）。
// paramName/unit/description は「学習前処理」タブの詳細表示でのみ使用する（比較表は value() の要約のみ）
export const PREPROCESS_COMPARISON_ROWS = [
  {
    key: "grayscale",
    label: "グレースケール",
    paramName: "grayscale",
    unit: "",
    description: "カラー画像をグレースケール（白黒濃淡）へ変換します。常時実行される工程です。",
    value: (p) => onOff(p.stepMap.grayscale),
  },
  {
    key: "illumination",
    label: "照明ムラ補正",
    paramName: "illumination_method",
    unit: "",
    description: "背景の明暗ムラ（照明の偏り）を補正し、文字と背景のコントラストを均一にします。",
    value: (p) => {
      const s = p.stepMap.illumination;
      if (!s) return "工程なし";
      return s.enabled ? `ON（${String(s.params.method || "gaussian")}）` : "OFF";
    },
  },
  {
    key: "gamma",
    label: "ガンマ補正",
    paramName: "gamma_value",
    unit: "",
    description: "画像全体の明るさをガンマカーブで補正します（1.0=補正なし）。",
    value: (p) => {
      const s = p.stepMap.gamma;
      if (!s) return "工程なし";
      return s.enabled ? num(s.params.value) : "OFF";
    },
  },
  {
    key: "clahe",
    label: "CLAHE",
    paramName: "clahe_clip_limit / clahe_tile_grid_size",
    unit: "",
    description: "局所領域ごとにコントラストを強調します（ヒストグラム平坦化の一種）。",
    value: (p) => {
      const s = p.stepMap.clahe;
      if (!s) return "工程なし";
      return s.enabled ? `ON（clip ${num(s.params.clip_limit)} / tile ${num(s.params.tile_grid_size, 0)}）` : "OFF";
    },
  },
  {
    key: "localContrast",
    label: "局所コントラスト",
    paramName: "local_contrast_clip_limit / local_contrast_tile_grid_size",
    unit: "",
    description: "CLAHEに似た局所コントラスト強調を追加で適用します。",
    value: (p) => {
      const s = p.stepMap.local_contrast;
      if (!s) return "工程なし";
      return s.enabled ? `ON（clip ${num(s.params.clip_limit)} / tile ${num(s.params.tile_grid_size, 0)}）` : "OFF";
    },
  },
  {
    key: "histEqualize",
    label: "ヒストグラム平坦化",
    paramName: "hist_equalize_enabled",
    unit: "",
    description: "画像全体の明暗ヒストグラムを平坦化し、コントラストを底上げします。",
    value: (p) => onOff(p.stepMap.hist_equalize),
  },
  {
    key: "bilateral",
    label: "バイラテラルノイズ除去",
    paramName: "bilateral_diameter / bilateral_sigma_color / bilateral_sigma_space",
    unit: "",
    description: "輪郭（文字の線）を保ったまま、なめらかにノイズを除去します。",
    value: (p) => {
      const s = p.stepMap.bilateral;
      if (!s) return "工程なし";
      return s.enabled
        ? `ON（d${num(s.params.diameter, 0)} / σc${num(s.params.sigma_color, 0)} / σs${num(s.params.sigma_space, 0)}）`
        : "OFF";
    },
  },
  {
    key: "sharpen",
    label: "シャープ化",
    paramName: "sharpen_amount / sharpen_sigma",
    unit: "",
    description: "文字の輪郭を強調してくっきりさせます。",
    value: (p) => {
      const s = p.stepMap.sharpen;
      if (!s) return "工程なし";
      return s.enabled ? `ON（amount ${num(s.params.amount)} / σ${num(s.params.sigma)}）` : "OFF";
    },
  },
  {
    key: "unsharp",
    label: "アンシャープマスク",
    paramName: "unsharp_amount / unsharp_radius / unsharp_threshold",
    unit: "",
    description: "ぼかした画像との差分を利用して輪郭を強調します（シャープ化の一種）。",
    value: (p) => {
      const s = p.stepMap.unsharp;
      if (!s) return "工程なし";
      return s.enabled ? `ON（amount ${num(s.params.amount)} / r${num(s.params.radius)}）` : "OFF";
    },
  },
  { key: "thresholdMethod", label: "二値化方式", paramName: "threshold_type", unit: "", description: "文字と背景を白黒2値へ分離する方式（Otsu=自動しきい値 / Adaptive=領域適応 / 固定値）。", value: (p) => thresholdLabel(p) },
  {
    key: "morph",
    label: "オープン/クローズ処理",
    paramName: "morph_method / morph_ksize / morph_iterations",
    unit: "",
    description: "モルフォロジー処理で微小なノイズの除去や文字の穴埋めを行います。",
    value: (p) => {
      const s = p.stepMap.morph;
      if (!s) return "工程なし";
      return s.enabled ? `${String(s.params.method || "close")} k${num(s.params.ksize, 0)}×${num(s.params.iterations, 0)}` : "OFF";
    },
  },
  {
    key: "strokeBoost",
    label: "掠れ補正",
    paramName: "stroke_boost_method / stroke_boost_ksize / stroke_boost_iterations",
    unit: "",
    description: "文字の掠れ（線の欠け）を太らせて補います。",
    value: (p) => {
      const s = p.stepMap.stroke_boost;
      if (!s) return "工程なし";
      return s.enabled ? `${String(s.params.method || "close")} k${num(s.params.ksize, 0)}×${num(s.params.iterations, 0)}` : "OFF";
    },
  },
  {
    key: "cropMargin",
    label: "余白トリミング",
    paramName: "crop_margin_threshold / crop_margin_margin",
    unit: "px",
    description: "文字領域の外側の余白を検出して切り詰めます。",
    value: (p) => {
      const s = p.stepMap.crop_margin;
      if (!s) return "工程なし";
      return s.enabled ? `ON（margin ${num(s.params.margin, 0)}px）` : "OFF";
    },
  },
  { key: "deskew", label: "傾き補正", paramName: "deskew_enabled", unit: "", description: "文字列の傾きを検出して水平に補正します。", value: (p) => onOff(p.stepMap.deskew) },
  {
    key: "resize",
    label: "リサイズ",
    paramName: "resize_single / resize_wide_height",
    unit: "px",
    description: "学習画像を一定の高さ・サイズへ統一します。",
    value: (p) => {
      const s = p.stepMap.resize;
      if (!s) return "工程なし";
      if (p.primaryType === "single") return `${num(s.params.single, 0)}px 正方形`;
      return `高さ${num(s.params.wide_height, 0)}px${s.params.keep_ratio === false ? "" : "（比率維持）"}`;
    },
  },
  {
    key: "denoise",
    label: "ノイズ除去",
    paramName: "denoise_method / denoise_ksize",
    unit: "",
    description: "画像の細かなノイズを軽減します（method=gaussianの場合はガウシアンぼかしを使用）。",
    value: (p) => {
      const s = p.stepMap.denoise;
      if (!s) return "工程なし";
      const method = String(s.params.method || "median");
      return method === "none" ? "OFF" : `${method} k${num(s.params.ksize, 0)}`;
    },
  },
  {
    key: "normalization",
    label: "入力整形",
    paramName: "canvas_width / target_height",
    unit: "px",
    description: "OCRエンジンへ入力する固定サイズへ整形します（中央配置・白背景でパディング）。常時実行される工程です。",
    value: (p) => normalizationLabel(p),
  },
];

// PREPROCESS_COMPARISON_ROWS の key（camelCase）→ stepMap のキー（snake_case）対応表。
// 一致する場合は明示せずそのまま同名を使う
const STEP_KEY_OVERRIDES = {
  thresholdMethod: "threshold",
  localContrast: "local_contrast",
  histEqualize: "hist_equalize",
  strokeBoost: "stroke_boost",
  cropMargin: "crop_margin",
};

function rowStepKey(row) {
  return STEP_KEY_OVERRIDES[row.key] || row.key;
}

// 「学習前処理」タブ・次回学習設定カードで使う詳細行（表示名/専門パラメータ名/現在値/単位/説明）を
// 組み立てる共通定義（buildEffectiveTrainingPreprocess）。PREPROCESS_COMPARISON_ROWS と同一の
// 値組み立てロジックを再利用し、表示専用の別ロジックを複製しない。
// 学習前処理は（オーグメンテーションの強度ラベルと異なり）設定値がそのまま実効値のため、
// display/effectiveの変換は不要——学習パイプラインに実在する工程のみを一覧化する。
export function buildEffectiveTrainingPreprocess(info = {}) {
  const pre = normalizeTrainingPreprocess(info);
  if (!pre.recorded) {
    return { recorded: false, items: [], enabledItems: [], enabledCount: 0, totalCount: 0, primaryType: "", hash: "", hashShort: "" };
  }
  const items = PREPROCESS_COMPARISON_ROWS.filter((row) => row.key === "normalization" || pre.stepMap[rowStepKey(row)]).map(
    (row) => {
      const step = row.key === "normalization" ? null : pre.stepMap[rowStepKey(row)];
      // グレースケール・入力整形は常時実行の工程のため、ON/OFF切替可能な項目としては数えない
      const enabled = row.key === "normalization" || row.key === "grayscale" ? true : Boolean(step?.enabled);
      return {
        key: row.key,
        label: row.label,
        paramName: row.paramName,
        unit: row.unit,
        description: row.description,
        enabled,
        value: row.value(pre),
      };
    }
  );
  const toggleable = items.filter((item) => item.key !== "grayscale" && item.key !== "normalization");
  return {
    recorded: true,
    items,
    enabledItems: items.filter((item) => item.enabled),
    enabledCount: toggleable.filter((item) => item.enabled).length,
    totalCount: toggleable.length,
    primaryType: pre.primaryType,
    hash: pre.hash,
    hashShort: pre.hashShort,
  };
}

// 行の表示値（未記録モデルは全行「未記録」）
export function preprocessRowValue(row, pre) {
  if (!pre || !pre.recorded) return MISSING;
  return row.value(pre);
}

// 学習条件比較（trainingCompare.js）向けの1行要約。
// 例: "Binary 128・320×48（7c57f300）"。未記録は空文字（呼び出し側で「未記録」表示）
export function trainingPreprocessSummary(pre) {
  if (!pre || !pre.recorded) return "";
  const hashPart = pre.hashShort ? `（${pre.hashShort}）` : "";
  return `${thresholdLabel(pre)}・${normalizationLabel(pre)}${hashPart}`;
}

// モデル間の前処理一致状態。基準=最初の記録ありモデル。
// 戻り値: モデルごとに "同一" / "異なる" / "未記録"
export function preprocessMatchLabels(pres) {
  const reference = (pres || []).find((p) => p && p.recorded && p.hash);
  return (pres || []).map((p) => {
    if (!p || !p.recorded || !p.hash) return MISSING;
    if (!reference) return MISSING;
    return p.hash === reference.hash ? "同一" : "異なる";
  });
}

// 前処理差分（変更点のみ抽出）。両方未記録・片方未記録は判定不能として空を返し、
// hasUnknown で未記録の存在を伝える
export function diffTrainingPreprocess(prevPre, nextPre) {
  if (!prevPre?.recorded || !nextPre?.recorded) {
    return { changes: [], comparable: false };
  }
  if (prevPre.hash && nextPre.hash && prevPre.hash === nextPre.hash) {
    return { changes: [], comparable: true };
  }
  const changes = [];
  for (const row of PREPROCESS_COMPARISON_ROWS) {
    const from = row.value(prevPre);
    const to = row.value(nextPre);
    if (from !== to) {
      changes.push({ key: row.key, label: row.label, from, to });
    }
  }
  return { changes, comparable: true };
}

// モデル間で学習時前処理が異なる場合の注意文（比較画面用）。問題なければ空配列
export function buildPreprocessNotes({ targets, labelOf, preOf }) {
  const notes = [];
  const pres = (targets || []).map((t) => preOf(t));
  const recorded = pres.filter((p) => p && p.recorded && p.hash);
  if (recorded.length >= 2) {
    const hashes = new Set(recorded.map((p) => p.hash));
    if (hashes.size > 1) {
      notes.push(
        "モデル間で学習時前処理が異なります。評価前処理を共通にしても、学習入力条件の差が性能差へ影響している可能性があります。"
      );
    }
  }
  const unrecorded = (targets || []).filter((t, i) => !pres[i] || !pres[i].recorded);
  if (unrecorded.length > 0 && recorded.length > 0) {
    notes.push(`${unrecorded.map((t) => labelOf(t)).join("・")}は学習時前処理が未記録のため、前処理の一致は判定できません。`);
  }
  return notes;
}

// 前処理詳細（折りたたみ）用: 工程順の一覧行（name / 有効 / パラメータ文字列）
export function preprocessDetailRows(pre) {
  if (!pre || !pre.recorded) return [];
  return (pre.steps || []).map((step) => ({
    name: String(step.name || ""),
    enabled: step.enabled === true,
    params: Object.entries(step.params || {})
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("×") : String(v)}`)
      .join(", "),
  }));
}
