// 「現在のラベル」の文字配置（中央→左→右の循環）のプロジェクト別 localStorage 保存。
// 既存ラベル編集とStep5（評価用データ作成）でストレージキーを分けて共通利用する
// （既存キーと混在させない。task仕様）。

export const LABEL_TEXT_ALIGN_VALUES = new Set(["left", "center", "right"]);
export const LABEL_TEXT_ALIGN_ORDER = ["center", "left", "right"];
export const LABEL_TEXT_ALIGN_LABELS = { center: "中央", left: "左", right: "右" };

// 既存ラベル編集のキー（形式変更禁止）
export const LABELING_ALIGN_STORAGE_KEY = "ocr_label_text_align_by_project_v1";
// Step5（評価用データ作成）専用の新キー
export const EVAL_ALIGN_STORAGE_KEY = "ocr_eval_label_text_align_by_project_v1";

export function readLabelTextAlign(storageKey, projectId) {
  try {
    const map = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const value = map?.[projectId];
    return LABEL_TEXT_ALIGN_VALUES.has(value) ? value : "center";
  } catch {
    return "center";
  }
}

export function writeLabelTextAlign(storageKey, projectId, value) {
  try {
    const raw = localStorage.getItem(storageKey);
    const map = raw ? JSON.parse(raw) : {};
    map[projectId] = value;
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // localStorage が使えない環境では保存なしで動作継続
  }
}

export function nextLabelTextAlign(current) {
  const index = LABEL_TEXT_ALIGN_ORDER.indexOf(current);
  return LABEL_TEXT_ALIGN_ORDER[(index + 1) % LABEL_TEXT_ALIGN_ORDER.length];
}
