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

// --- 最大3モデルスロット構成（ocr_eval_preview_slots_by_project_v1） ---
// 旧単一設定（EVAL_OCR_SETTINGS_STORAGE_KEY）は読み込み時にモデル1へ自動移行する。

export const EVAL_OCR_SLOTS_STORAGE_KEY = "ocr_eval_preview_slots_by_project_v1";
export const EVAL_OCR_SLOT_COUNT = 3;

export const DEFAULT_EVAL_OCR_SLOT = {
  enabled: false,
  engine: "paddleocr",
  paddleModel: "latest",
  tesseractModel: "latest",
  easyocrLangs: "en",
  includeLowercase: true,
  psm: 7,
  whitelist: "",
};

// 1スロット分の正規化（欠損・不正値は既定値で補完。入力途中の空文字は保持しない=保存/送信時に使用）
export function normalizeEvalOcrSlot(raw, { enabledDefault = false } = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const base = normalizeEvalOcrSettings(src);
  const psmNum = Number(src.psm);
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : enabledDefault,
    engine: base.engine,
    paddleModel: base.paddleModel,
    tesseractModel: base.tesseractModel,
    easyocrLangs: base.easyocrLangs,
    includeLowercase: base.includeLowercase,
    psm: Number.isInteger(psmNum) && psmNum >= 0 && psmNum <= 13 ? psmNum : DEFAULT_EVAL_OCR_SLOT.psm,
    whitelist: typeof src.whitelist === "string" ? src.whitelist.trim() : "",
  };
}

// スロット配列の正規化＋旧単一設定からの移行。
// storedSlots が無い場合: legacySingle（旧キーの単一設定）があればモデル1へ移行、無ければ既定
// （モデル1のみ有効・モデル2/3無効）。storedSlots がある場合はそれを3枠へ正規化する。
export function migrateEvalOcrSlots(storedSlots, legacySingle) {
  if (Array.isArray(storedSlots) && storedSlots.length > 0) {
    return Array.from({ length: EVAL_OCR_SLOT_COUNT }, (_, i) =>
      normalizeEvalOcrSlot(storedSlots[i], { enabledDefault: false })
    );
  }
  const first = normalizeEvalOcrSlot({ ...(legacySingle || {}), enabled: true }, { enabledDefault: true });
  return [
    first,
    normalizeEvalOcrSlot(null),
    normalizeEvalOcrSlot(null),
  ];
}

export function readEvalOcrSlots(projectId) {
  let stored = null;
  try {
    const map = JSON.parse(localStorage.getItem(EVAL_OCR_SLOTS_STORAGE_KEY) || "{}");
    stored = Array.isArray(map?.[projectId]?.slots) ? map[projectId].slots : null;
  } catch {
    stored = null;
  }
  // 旧単一設定キーはモデル1へ自動移行（旧キー自体は変更しない）
  const legacy = stored ? null : readEvalOcrSettings(projectId);
  return migrateEvalOcrSlots(stored, legacy);
}

export function writeEvalOcrSlots(projectId, slots) {
  try {
    const raw = localStorage.getItem(EVAL_OCR_SLOTS_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[projectId] = {
      slots: Array.from({ length: EVAL_OCR_SLOT_COUNT }, (_, i) => normalizeEvalOcrSlot(slots?.[i])),
    };
    localStorage.setItem(EVAL_OCR_SLOTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage が使えない環境では保存なしで動作継続
  }
}

// スロット→ /api/ocr/preview-file リクエストフィールド。
// エンジンに存在しない設定は既定値へ正規化する（重複判定が実効設定ベースになる）:
// PaddleOCR=PSM/whitelistなし / Tesseract=言語・小文字なし / EasyOCR=モデル・PSMなし
export function evalOcrSlotRequestFields(slot) {
  const s = normalizeEvalOcrSlot(slot);
  const base = evalOcrRequestFields(s);
  return {
    ...base,
    psm: s.engine === "tesseract" ? s.psm : 0,
    whitelist: s.engine === "tesseract" || s.engine === "easyocr" ? s.whitelist : "",
  };
}
