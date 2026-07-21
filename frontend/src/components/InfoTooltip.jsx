import { useEffect, useRef, useState } from "react";

// 共通ヘルプツールチップ（?アイコン）。ホバーまたはクリックで説明を表示する。
// 文言は lib/helpTexts.js の HELP_TEXTS へ集約し、{...HELP_TEXTS.cer} のように渡す。
// 右ペインなど狭い領域でも収まるよう、パネルはアイコン左上基準（右端揃え）で開く。
export default function InfoTooltip({ title, body, align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // クリックで開いたパネルは外側クリックで閉じる
  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  return (
    <span ref={ref} className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label={`${title || "項目"}のヘルプ`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-border/80 bg-card/60 text-[10px] font-semibold leading-none text-muted transition-colors hover:border-accent/60 hover:text-accent"
      >
        ?
      </button>
      <span
        role="tooltip"
        className={`absolute top-full z-30 mt-1.5 w-64 max-w-[75vw] whitespace-pre-line rounded-lg border border-border bg-[#232b34] px-3 py-2.5 text-left text-xs font-normal leading-relaxed text-text shadow-xl ${
          align === "left" ? "left-0" : "right-0"
        } ${open ? "block" : "hidden group-hover:block"}`}
      >
        {title ? <span className="mb-1 block text-[13px] font-semibold text-text">{title}</span> : null}
        {body}
      </span>
    </span>
  );
}
