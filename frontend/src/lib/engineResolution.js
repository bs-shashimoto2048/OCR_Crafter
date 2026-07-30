// OCRエンジンID判定の共通正規化ロジック（Issue #12: 未知Engineの暗黙PaddleOCRフォールバック廃止）。
//
// BackendのEngine Registry（src/app/services/engine_registry.py::resolve_engine_id()）に
// 登録済みの4エンジンのみを既知として扱う。Backend実装をそのまま複製せず、Frontendに
// 必要な最小限（正規化＋表示ラベル）のみを持つ。
//
// `custom`（分類モデル）はEngine Registry未登録のため、この関数群では意図的に扱わない。
// custom固有の判定・表示は呼び出し側（inferenceModel.js / ModelsView.jsx）で個別に行う。

const KNOWN_ENGINE_IDS = ["paddleocr", "easyocr", "tesseract", "trocr"];

// 既知Engineは正規化ID、それ以外（null/undefined/非文字列/空文字/空白のみ/未登録の値）は"unknown"。
// 前後空白の除去・小文字化のみを正規化として行い、別名（alias）変換は行わない
// （Backend resolve_engine_id()と同じ方針）。未知値を既知Engineへ暗黙変換しない。
export function normalizeEngineId(value) {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  return KNOWN_ENGINE_IDS.includes(normalized) ? normalized : "unknown";
}

const ENGINE_DISPLAY_LABELS = {
  tesseract: "Tesseract",
  paddleocr: "PaddleOCR",
  easyocr: "EasyOCR",
  trocr: "TrOCR",
};

// 既知4Engineの表示ラベル。未知は"不明"（既存UI規約に合わせる。frontend/src/lib/detectModel.js参照）。
// customは扱わない（呼び出し側で「カスタム」表示を別途行う）。
export function engineDisplayLabel(value) {
  const normalized = normalizeEngineId(value);
  return normalized === "unknown" ? "不明" : ENGINE_DISPLAY_LABELS[normalized];
}
