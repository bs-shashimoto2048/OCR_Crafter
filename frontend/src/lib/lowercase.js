// 「小文字を出力に含める」設定（EasyOCR/PaddleOCR）の共通判定。
// バックエンド src/app/services/latin_case.py の LATIN_CASE_LANGS と対応させる。

export const LATIN_CASE_LANGS = new Set([
  "en", "fr", "de", "es", "it", "pt", "nl",
  "latin", "french", "german",
  "af", "az", "bs", "cs", "cy", "da", "et", "fi", "ga", "hr", "hu",
  "id", "is", "lt", "lv", "ms", "mt", "no", "oc", "pl", "ro", "sk",
  "sl", "sq", "sv", "sw", "tl", "tr", "uz", "vi",
]);

// langs は配列またはカンマ区切り文字列。全言語がラテン文字言語のときのみ true
export function isLatinCaseLangs(langs) {
  const list = Array.isArray(langs)
    ? langs
    : String(langs || "")
        .split(",")
        .map((item) => item.trim());
  const normalized = list.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return false;
  return normalized.every((lang) => LATIN_CASE_LANGS.has(lang));
}

// チェックボックスを表示（有効化）してよい条件
export function lowercaseToggleApplicable(engine, langs) {
  const name = String(engine || "").toLowerCase();
  return (name === "easyocr" || name === "paddleocr") && isLatinCaseLangs(langs);
}
