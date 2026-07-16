// ラベル編集のキーボードショートカット（既存ラベル編集とStep5で共通利用）。
// Ctrl+S=保存 / Ctrl+←→=画像移動 / Enter=保存して次へ（入力欄以外） /
// Esc=最上位の有効OCR候補を採用 / Alt+1〜5=辞書候補採用。挙動は既存仕様を移設したもので変更しない。
import { useEffect } from "react";

export default function useLabelingShortcuts({
  onSave,
  onPrev,
  onNext,
  onSaveAndNext,
  onAdoptTopCandidate,
  dictionaryCandidates,
  onAdoptText,
}) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.isComposing) {
        return;
      }
      if (event.ctrlKey && !event.altKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        onSave?.();
        return;
      }
      if (event.ctrlKey && event.key === "ArrowRight") {
        event.preventDefault();
        onNext?.();
        return;
      }
      if (event.ctrlKey && event.key === "ArrowLeft") {
        event.preventDefault();
        onPrev?.();
        return;
      }
      // Enter=保存して次へ（ボタンクリックと同じ処理へ一本化）。
      // 入力欄フォーカス時は入力欄自身の onKeyDown が処理するためここでは扱わない
      if ((event.key === "Enter" || event.key === "NumpadEnter") && !event.ctrlKey) {
        const target = event.target;
        const isEditableTarget =
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT");
        if (isEditableTarget) {
          return;
        }
        if (target instanceof HTMLElement && target.tagName === "BUTTON") {
          return; // ボタン上のEnterはクリックとして発火するため二重実行しない
        }
        if (event.repeat) {
          return; // 長押しrepeatは無視
        }
        event.preventDefault();
        onSaveAndNext?.();
        return;
      }
      // Alt+1〜5: 辞書からの近似候補を採用（Esc=OCR候補採用とは競合しない）
      if (event.altKey && !event.ctrlKey && !event.metaKey && /^[1-5]$/.test(event.key)) {
        const candidate = dictionaryCandidates?.[Number(event.key) - 1];
        if (candidate) {
          event.preventDefault();
          onAdoptText?.(candidate.entry);
        }
        return;
      }
      if (event.key === "Escape") {
        onAdoptTopCandidate?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });
}
