import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 共通ヘルプツールチップ（?アイコン）。ホバーまたはクリックで説明を表示する。
// 文言は lib/helpTexts.js の HELP_TEXTS へ集約し、{...HELP_TEXTS.cer} のように渡す。
// パネルは document.body へポータル描画（position: fixed・z-index最大級）。
// テーブルの overflow-x:auto / stickyセル / カードの overflow:hidden に埋もれず常に最前面へ出る。
const PANEL_WIDTH = 256; // w-64相当
const MARGIN = 8;
const GAP = 6;

export default function InfoTooltip({ title, body, align = "right" }) {
  const [open, setOpen] = useState(false); // クリックで固定表示
  const [hover, setHover] = useState(false); // ホバー表示（パネル上のホバーも維持）
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const hoverTimer = useRef(null);
  const visible = open || hover;

  // ホバーは120msの猶予つきで閉じる（ボタン→パネルへマウス移動しても消えない）
  const hoverIn = () => {
    clearTimeout(hoverTimer.current);
    setHover(true);
  };
  const hoverOut = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(false), 120);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // 表示位置: トリガーのrect基準のfixed配置。左右は画面内へクランプ
  useEffect(() => {
    if (!visible || !buttonRef.current) {
      setPos(null);
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    let left = align === "left" ? rect.left : rect.right - PANEL_WIDTH;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - PANEL_WIDTH - MARGIN));
    setPos({ top: rect.bottom + GAP, left, anchorTop: rect.top });
  }, [visible, align]);

  // パネル実高さで下にはみ出す場合はトリガーの上側へ反転
  useEffect(() => {
    if (!visible || !pos || !panelRef.current) return;
    const height = panelRef.current.offsetHeight;
    if (pos.top + height > window.innerHeight - MARGIN) {
      const above = pos.anchorTop - height - GAP;
      if (above >= MARGIN && above !== pos.top) {
        setPos((prev) => ({ ...prev, top: above }));
      }
    }
  }, [visible, pos]);

  // クリック表示は外側クリックで閉じる（ポータル先のパネル内クリックは除外）
  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (buttonRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  // スクロール・リサイズ時はfixed位置をトリガーへ追従再計算（内部スクローラもcaptureで検知）。
  // トリガー自体が画面外へ出たら閉じる（初期化時の微小scrollで即閉じない）
  useEffect(() => {
    if (!visible) return undefined;
    const reposition = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        setHover(false);
        return;
      }
      let left = align === "left" ? rect.left : rect.right - PANEL_WIDTH;
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - PANEL_WIDTH - MARGIN));
      setPos({ top: rect.bottom + GAP, left, anchorTop: rect.top });
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [visible, align]);

  return (
    <span className="ml-1 inline-flex align-middle" onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${title || "項目"}のヘルプ`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-border/80 bg-card/60 text-[10px] font-semibold leading-none text-muted transition-colors hover:border-accent/60 hover:text-accent"
      >
        ?
      </button>
      {visible && pos
        ? createPortal(
            <span
              ref={panelRef}
              role="tooltip"
              style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
              onMouseEnter={hoverIn}
              onMouseLeave={hoverOut}
              className="fixed z-[9999] block max-w-[85vw] whitespace-pre-line rounded-lg border border-border bg-[#232b34] px-3 py-2.5 text-left text-xs font-normal leading-relaxed text-text shadow-xl"
            >
              {title ? <span className="mb-1 block text-[13px] font-semibold text-text">{title}</span> : null}
              {body}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
