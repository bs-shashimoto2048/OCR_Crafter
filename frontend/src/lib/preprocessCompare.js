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

// 学習前処理比較テーブルの行定義（label / 値の取り出し）。タスク仕様の最低限項目
export const PREPROCESS_COMPARISON_ROWS = [
  { key: "grayscale", label: "グレースケール", value: (p) => onOff(p.stepMap.grayscale) },
  {
    key: "illumination",
    label: "照明ムラ補正",
    value: (p) => {
      const s = p.stepMap.illumination;
      if (!s) return "工程なし";
      return s.enabled ? `ON（${String(s.params.method || "gaussian")}）` : "OFF";
    },
  },
  {
    key: "gamma",
    label: "Gamma",
    value: (p) => {
      const s = p.stepMap.gamma;
      if (!s) return "工程なし";
      return s.enabled ? num(s.params.value) : "OFF";
    },
  },
  {
    key: "clahe",
    label: "CLAHE",
    value: (p) => {
      const s = p.stepMap.clahe;
      if (!s) return "工程なし";
      return s.enabled ? `ON（clip ${num(s.params.clip_limit)} / tile ${num(s.params.tile_grid_size, 0)}）` : "OFF";
    },
  },
  { key: "thresholdMethod", label: "二値化方式", value: (p) => thresholdLabel(p) },
  {
    key: "morph",
    label: "Morphology",
    value: (p) => {
      const s = p.stepMap.morph;
      if (!s) return "工程なし";
      return s.enabled ? `${String(s.params.method || "close")} k${num(s.params.ksize, 0)}×${num(s.params.iterations, 0)}` : "OFF";
    },
  },
  {
    key: "strokeBoost",
    label: "Stroke Boost",
    value: (p) => {
      const s = p.stepMap.stroke_boost;
      if (!s) return "工程なし";
      return s.enabled ? `${String(s.params.method || "close")} k${num(s.params.ksize, 0)}×${num(s.params.iterations, 0)}` : "OFF";
    },
  },
  { key: "deskew", label: "Deskew", value: (p) => onOff(p.stepMap.deskew) },
  {
    key: "resize",
    label: "リサイズ",
    value: (p) => {
      const s = p.stepMap.resize;
      if (!s) return "工程なし";
      if (p.primaryType === "single") return `${num(s.params.single, 0)}px 正方形`;
      return `高さ${num(s.params.wide_height, 0)}px${s.params.keep_ratio === false ? "" : "（比率維持）"}`;
    },
  },
  {
    key: "denoise",
    label: "Denoise",
    value: (p) => {
      const s = p.stepMap.denoise;
      if (!s) return "工程なし";
      const method = String(s.params.method || "median");
      return method === "none" ? "OFF" : `${method} k${num(s.params.ksize, 0)}`;
    },
  },
  { key: "normalization", label: "入力整形", value: (p) => normalizationLabel(p) },
];

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
