// 前処理設定画面のUI状態（折りたたみ・基本/詳細モード）とプリセットの保存。
// - UI状態: localStorage `ocr_preprocess_ui_state_by_project_v1`（プロジェクト別。検索文字列は保存しない）
// - プリセット: localStorage `ocr_preprocess_presets_by_project_v1`（プロジェクト別）。
//   旧・全プロジェクト共通キー `ocr_preprocess_presets_v1` は初回読み込み時にプロジェクトへ
//   コピー移行する（旧キー自体は変更しない=他プロジェクトの初回移行にも使える）。

export const PREPROCESS_UI_STATE_STORAGE_KEY = "ocr_preprocess_ui_state_by_project_v1";
export const PREPROCESS_PRESETS_BY_PROJECT_STORAGE_KEY = "ocr_preprocess_presets_by_project_v1";
export const LEGACY_PRESET_STORAGE_KEY = "ocr_preprocess_presets_v1";
// OCR結果確認（旧・推論設定）のエンジン設定（プロジェクト別に保存し、リロードで消えないようにする）
export const PREPROCESS_PREDICT_STORAGE_KEY = "ocr_preprocess_predict_by_project_v1";

// 既定のUI状態: 実処理順の主要セクション（入力・明るさ・二値化）を開いた基本モード
export const DEFAULT_PREPROCESS_UI_STATE = {
  mode: "basic",
  openSections: ["input", "brightness", "threshold"],
};

function readMap(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

function writeMap(storageKey, map) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // localStorage が使えない環境では保存なしで動作継続
  }
}

export function normalizeUiState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    mode: src.mode === "advanced" ? "advanced" : "basic",
    openSections: Array.isArray(src.openSections)
      ? src.openSections.map(String)
      : [...DEFAULT_PREPROCESS_UI_STATE.openSections],
  };
}

export function readPreprocessUiState(projectId) {
  const map = readMap(PREPROCESS_UI_STATE_STORAGE_KEY);
  return normalizeUiState(map?.[projectId]);
}

export function writePreprocessUiState(projectId, state) {
  if (!projectId) return;
  const map = readMap(PREPROCESS_UI_STATE_STORAGE_KEY);
  map[projectId] = normalizeUiState(state);
  writeMap(PREPROCESS_UI_STATE_STORAGE_KEY, map);
}

// プリセット読込（プロジェクト別）。未保存プロジェクトは旧・共通プリセットをコピー移行
export function readPreprocessPresets(projectId) {
  const map = readMap(PREPROCESS_PRESETS_BY_PROJECT_STORAGE_KEY);
  const own = map?.[projectId];
  if (own && typeof own === "object") {
    return { ...own };
  }
  // 旧キーからの移行（存在する場合のみ。旧キーは変更しない）
  try {
    const legacyRaw = localStorage.getItem(LEGACY_PRESET_STORAGE_KEY);
    const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
    if (legacy && typeof legacy === "object" && Object.keys(legacy).length > 0) {
      if (projectId) {
        map[projectId] = legacy;
        writeMap(PREPROCESS_PRESETS_BY_PROJECT_STORAGE_KEY, map);
      }
      return { ...legacy };
    }
  } catch {
    // 移行失敗は空プリセットで継続
  }
  return {};
}

export function writePreprocessPresets(projectId, presets) {
  if (!projectId) return;
  const map = readMap(PREPROCESS_PRESETS_BY_PROJECT_STORAGE_KEY);
  map[projectId] = presets && typeof presets === "object" ? presets : {};
  writeMap(PREPROCESS_PRESETS_BY_PROJECT_STORAGE_KEY, map);
}

// OCR結果確認（プレビュー用推論）の設定（プロジェクト別・自動保存）
export const DEFAULT_PREPROCESS_PREDICT_SETTINGS = {
  engine: "easyocr",
  model: "latest",
  paddleModel: "latest",
  tesseractModel: "latest",
  modelType: "square",
  langs: ["en"],
  psm: 7,
  whitelist: "",
};

export function normalizePredictSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const psm = Number(src.psm);
  return {
    engine: ["custom", "easyocr", "paddleocr", "tesseract"].includes(src.engine)
      ? src.engine
      : DEFAULT_PREPROCESS_PREDICT_SETTINGS.engine,
    model: typeof src.model === "string" && src.model ? src.model : "latest",
    paddleModel: typeof src.paddleModel === "string" && src.paddleModel ? src.paddleModel : "latest",
    tesseractModel: typeof src.tesseractModel === "string" && src.tesseractModel ? src.tesseractModel : "latest",
    modelType: typeof src.modelType === "string" && src.modelType ? src.modelType : "square",
    langs: Array.isArray(src.langs) && src.langs.length > 0 ? src.langs.map(String) : ["en"],
    psm: Number.isInteger(psm) && psm >= 0 && psm <= 13 ? psm : DEFAULT_PREPROCESS_PREDICT_SETTINGS.psm,
    whitelist: typeof src.whitelist === "string" ? src.whitelist : "",
  };
}

export function readPreprocessPredictSettings(projectId) {
  const map = readMap(PREPROCESS_PREDICT_STORAGE_KEY);
  return normalizePredictSettings(map?.[projectId]);
}

export function writePreprocessPredictSettings(projectId, settings) {
  if (!projectId) return;
  const map = readMap(PREPROCESS_PREDICT_STORAGE_KEY);
  map[projectId] = normalizePredictSettings(settings);
  writeMap(PREPROCESS_PREDICT_STORAGE_KEY, map);
}
