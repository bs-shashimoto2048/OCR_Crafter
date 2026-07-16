// 「現在のラベル」入力欄＋配置切替ボタン（既存ラベル編集とStep5で共通利用）。
// 仕様: 最終画像の実描画幅へ追従・中央配置・最低幅min(320px,100%)・min-height 72px・
// 入力済み38px太字等幅・プレースホルダーは幅に応じて16〜28px（index.cssの.label-main-input）。
import { useEffect, useRef, useState } from "react";

import Button from "../Button";
import { LABEL_TEXT_ALIGN_LABELS, nextLabelTextAlign } from "../../lib/labelAlign";

export default function LabelMainInput({
  value,
  onChange,
  onSubmit,
  align = "center",
  onAlignChange,
  widthPx = null,
  inputRef,
  placeholder = "ラベル文字列を入力",
}) {
  // 配置ボタン: 押すたびに 中央→左→右→中央 を循環。押下時は短く青発光する
  const [alignFlash, setAlignFlash] = useState(false);
  const alignFlashTimerRef = useRef(null);

  function cycleAlign() {
    onAlignChange?.(nextLabelTextAlign(align));
    setAlignFlash(true);
    if (alignFlashTimerRef.current) {
      clearTimeout(alignFlashTimerRef.current);
    }
    alignFlashTimerRef.current = setTimeout(() => setAlignFlash(false), 300);
  }

  useEffect(
    () => () => {
      if (alignFlashTimerRef.current) {
        clearTimeout(alignFlashTimerRef.current);
      }
    },
    []
  );

  const nextAlign = nextLabelTextAlign(align);

  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <label className="app-label mb-0">現在のラベル</label>
        <Button
          size="sm"
          variant="secondary"
          className={`h-6 shrink-0 px-2 text-[11px] transition-shadow duration-200 ${
            alignFlash
              ? "!border-accent/70 !text-blue-200 shadow-[0_0_0_1px_rgba(96,165,250,0.55),0_0_10px_rgba(96,165,250,0.45)]"
              : ""
          }`}
          onClick={cycleAlign}
          title={`現在は${LABEL_TEXT_ALIGN_LABELS[align]}揃えです。押すと${LABEL_TEXT_ALIGN_LABELS[nextAlign]}揃えに変更します。`}
          aria-label={`現在は${LABEL_TEXT_ALIGN_LABELS[align]}揃えです。押すと${LABEL_TEXT_ALIGN_LABELS[nextAlign]}揃えに変更します。`}
        >
          ≡ 配置: {LABEL_TEXT_ALIGN_LABELS[align]}
        </Button>
      </div>
      {/* 入力欄は最終画像の実描画幅に合わせて中央配置（画像と左右端を揃えて比較しやすくする） */}
      <div className="mb-2 flex justify-center">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent?.isComposing) {
              return;
            }
            if (e.key === "Enter" || e.key === "NumpadEnter") {
              e.preventDefault();
              e.stopPropagation();
              if (e.repeat) {
                return; // 長押しrepeatは無視（連打での多重実行防止）
              }
              onSubmit?.();
            }
          }}
          className="app-input label-main-input min-h-[72px] !bg-[#f4f5f7] px-4 font-mono !text-[#111827] placeholder:!text-slate-400"
          style={{
            textAlign: align,
            // 実描画幅が取れるまではカード全幅。小画像でも入力しやすいよう最低320px（親幅は超えない）
            width: widthPx ? `${Math.round(widthPx)}px` : "100%",
            minWidth: "min(320px, 100%)",
            maxWidth: "100%",
            // プレースホルダーだけ入力欄幅に応じて縮小（16〜28px。入力済み文字は38px固定）
            "--label-placeholder-size": `${Math.round(Math.max(16, Math.min(28, (widthPx || 560) * 0.05)))}px`,
          }}
          placeholder={placeholder}
        />
      </div>
    </>
  );
}
