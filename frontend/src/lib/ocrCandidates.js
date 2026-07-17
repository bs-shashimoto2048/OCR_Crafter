// OCR候補まわりの純ロジック（ラベル編集・学習画像作成Step5で共通利用）。
// node:test（ESM）でも解決できるよう拡張子付きで参照する（Vite側も問題なし）
import { lowercaseToggleApplicable } from "./lowercase.js";

export const ENGINE_LABELS = {
  tesseract: "Tesseract",
  paddleocr: "PaddleOCR",
  easyocr: "EasyOCR",
  custom: "カスタムモデル",
};

export function engineLabelOf(engine) {
  return ENGINE_LABELS[String(engine || "").toLowerCase()] || (engine ? String(engine) : "--");
}

// 候補ヘッダーへ付ける「小文字: ON/OFF」表示（EasyOCR/PaddleOCR × ラテン言語時のみ）
export function lowercaseLabelOf(fields) {
  if (!lowercaseToggleApplicable(fields?.engine, fields?.easyocr_langs)) {
    return "";
  }
  return fields?.include_lowercase !== false ? "小文字: ON" : "小文字: OFF";
}

// 推論設定の同一判定シグネチャ。Engine＋Model＋Language＋小文字設定＋PSM＋whitelist が
// 完全一致するスロットは重複扱いとして推論をスキップする。
// psm/whitelist 未指定（既存ラベル編集の呼び出し）は空扱いで従来の判定結果と変わらない
export function predictSignature(fields) {
  const f = fields || {};
  return `${f.engine}|${f.model}|${f.easyocr_langs}|lc:${f.include_lowercase !== false ? "1" : "0"}|psm:${f.psm || ""}|wl:${f.whitelist || ""}`;
}
