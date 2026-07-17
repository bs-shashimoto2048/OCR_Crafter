// Step5（評価用データ作成）専用のOCR前処理設定（グレースケール・二値化）。
// OCR候補の生成時だけ適用し、評価用画像・作成済みデータセット・学習画像へは一切反映しない。
// プロジェクト共通OCR前処理・YOLO検出前処理・Step5 OCRモデル設定とは独立して保存する。

export const EVAL_PREPROCESS_STORAGE_KEY = "ocr_eval_preprocess_settings_by_project_v1";

export const EVAL_BINARIZE_METHODS = [
  { id: "otsu", label: "大津の二値化" },
  { id: "fixed", label: "固定しきい値" },
];

export const DEFAULT_EVAL_PREPROCESS = {
  grayscale: false,
  binarize: false,
  binarizeMethod: "otsu",
  threshold: 127,
};

// 欠損・不正値は既定値で補完して正規化する
export function normalizeEvalPreprocess(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const method = EVAL_BINARIZE_METHODS.some((row) => row.id === src.binarizeMethod)
    ? src.binarizeMethod
    : DEFAULT_EVAL_PREPROCESS.binarizeMethod;
  const thresholdNum = Number(src.threshold);
  return {
    grayscale: src.grayscale === true,
    binarize: src.binarize === true,
    binarizeMethod: method,
    threshold:
      Number.isInteger(thresholdNum) && thresholdNum >= 0 && thresholdNum <= 255
        ? thresholdNum
        : DEFAULT_EVAL_PREPROCESS.threshold,
  };
}

export function readEvalPreprocess(projectId) {
  try {
    const map = JSON.parse(localStorage.getItem(EVAL_PREPROCESS_STORAGE_KEY) || "{}");
    return normalizeEvalPreprocess(map?.[projectId]);
  } catch {
    return { ...DEFAULT_EVAL_PREPROCESS };
  }
}

export function writeEvalPreprocess(projectId, settings) {
  try {
    const raw = localStorage.getItem(EVAL_PREPROCESS_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[projectId] = normalizeEvalPreprocess(settings);
    localStorage.setItem(EVAL_PREPROCESS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage が使えない環境では保存なしで動作継続
  }
}

// /api/ocr/preview-file の eval_preprocess_json へ渡す文字列。
// 両設定OFF時は空文字（=パラメータ未指定・従来動作）を返す
export function evalPreprocessRequestJson(settings) {
  const s = normalizeEvalPreprocess(settings);
  if (!s.grayscale && !s.binarize) {
    return "";
  }
  return JSON.stringify({
    grayscale: s.grayscale,
    binarize: s.binarize,
    binarize_method: s.binarizeMethod,
    threshold: s.threshold,
  });
}
