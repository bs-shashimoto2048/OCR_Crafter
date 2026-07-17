// Step5（評価用データ作成）専用のOCR設定。
// ラベル編集（前処理画面の推論設定）とは独立して保存し、片方の変更が他方へ影響しない。
// 前処理はプロジェクト共通のOCR前処理設定を使用する（このモジュールの対象外）。

import { lowercaseToggleApplicable } from "./lowercase.js";

export const EVAL_OCR_SETTINGS_STORAGE_KEY = "ocr_eval_preview_settings_by_project_v1";

export const EVAL_OCR_ENGINES = ["paddleocr", "tesseract", "easyocr"];

export const DEFAULT_EVAL_OCR_SETTINGS = {
  engine: "paddleocr",
  paddleModel: "latest",
  tesseractModel: "latest",
  easyocrLangs: "en",
  includeLowercase: true,
};

// 保存値・旧形式・欠損キーを既定値で補完して正規化する
export function normalizeEvalOcrSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const engine = EVAL_OCR_ENGINES.includes(src.engine) ? src.engine : DEFAULT_EVAL_OCR_SETTINGS.engine;
  const text = (value, fallback) => {
    const v = typeof value === "string" ? value.trim() : "";
    return v || fallback;
  };
  return {
    engine,
    paddleModel: text(src.paddleModel, DEFAULT_EVAL_OCR_SETTINGS.paddleModel),
    tesseractModel: text(src.tesseractModel, DEFAULT_EVAL_OCR_SETTINGS.tesseractModel),
    easyocrLangs: text(src.easyocrLangs, DEFAULT_EVAL_OCR_SETTINGS.easyocrLangs),
    includeLowercase: src.includeLowercase !== false,
  };
}

export function readEvalOcrSettings(projectId) {
  try {
    const map = JSON.parse(localStorage.getItem(EVAL_OCR_SETTINGS_STORAGE_KEY) || "{}");
    return normalizeEvalOcrSettings(map?.[projectId]);
  } catch {
    return { ...DEFAULT_EVAL_OCR_SETTINGS };
  }
}

export function writeEvalOcrSettings(projectId, settings) {
  try {
    const raw = localStorage.getItem(EVAL_OCR_SETTINGS_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[projectId] = normalizeEvalOcrSettings(settings);
    localStorage.setItem(EVAL_OCR_SETTINGS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage が使えない環境では保存なしで動作継続
  }
}

// /api/ocr/preview-file へ渡すリクエストフィールドへ変換する。
// 言語はEasyOCR/PaddleOCRで使用（Tesseractは無関係のため既定"en"を送る=従来のAPI既定と同じ）。
// 小文字設定は適用可能なエンジン・言語のときのみ反映する（非対象はtrue=従来動作）。
export function evalOcrRequestFields(settings) {
  const s = normalizeEvalOcrSettings(settings);
  const model = s.engine === "paddleocr" ? s.paddleModel : s.engine === "tesseract" ? s.tesseractModel : "latest";
  const langs = s.engine === "easyocr" || s.engine === "paddleocr" ? s.easyocrLangs : "en";
  return {
    engine: s.engine,
    model,
    easyocr_langs: langs,
    include_lowercase: lowercaseToggleApplicable(s.engine, langs) ? s.includeLowercase : true,
  };
}
