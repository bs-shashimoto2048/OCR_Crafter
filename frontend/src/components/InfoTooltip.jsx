import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { computeTooltipArrowLeft, computeTooltipPosition, estimateTooltipHeight } from "../lib/tooltipPosition";

// 共通ヘルプツールチップ（?アイコン）。ホバー・キーボードフォーカス・クリック/タップで表示する。
// 文言は lib/helpTexts.js の HELP_TEXTS へ集約し、{...HELP_TEXTS.cer} のように渡す。
// パネルは document.body へポータル描画（position: fixed・z-index最大級）。
// テーブルの overflow-x:auto / stickyセル / カードの overflow:hidden、モーダル・インライン編集の
// 高いz-indexにも埋もれず常に最前面へ出る。
// 表示位置は「対象要素の上部中央」を既定とし、上端に十分な空間が無い場合のみ下側へフォールバックする
// （lib/tooltipPosition.js の純粋関数で計算。画面端は左右へクランプ）。
const PANEL_WIDTH = 256; // w-64相当
const MARGIN = 8;
const GAP = 6;
// アプリ内の最上位モーダル（z-[10000]）より確実に上へ出す
const Z_INDEX = "z-[10010]";

export default function InfoTooltip({ title, body, align = "right" }) {
  const [open, setOpen] = useState(false); // クリック/タップで固定表示
  const [hover, setHover] = useState(false); // ホバー・フォーカス表示（パネル上のホバーも維持）
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const hoverTimer = useRef(null);
  const visible = open || hover;
  const panelId = useId();

  // ホバー/フォーカスは120msの猶予つきで閉じる（ボタン→パネルへマウス移動しても消えない）
  const hoverIn = () => {
    clearTimeout(hoverTimer.current);
    setHover(true);
  };
  const hoverOut = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(false), 120);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // 表示位置: トリガーのrect基準のfixed配置。既定は上部中央（placement=top）、
  // 上端に空間が無い場合のみ下側へフォールバック。初回は本文長からの概算高さで配置し、
  // 実測後（次のeffect）に正確な位置へ補正する（ちらつき軽減）
  useEffect(() => {
    if (!visible || !buttonRef.current) {
      setPos(null);
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    const estimatedHeight = estimateTooltipHeight(body, { panelWidth: PANEL_WIDTH });
    const { top, left, placement } = computeTooltipPosition({
      trigger: rect,
      panelWidth: PANEL_WIDTH,
      panelHeight: estimatedHeight,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      align,
      margin: MARGIN,
      gap: GAP,
    });
    setPos({ top, left, placement, anchorTop: rect.top, anchorBottom: rect.bottom, anchorLeft: rect.left, anchorRight: rect.right });
  }, [visible, align, body]);

  // パネル実高さで再計算（概算との差を補正。上端に十分な空間があれば上側を維持）
  useEffect(() => {
    if (!visible || !pos || !panelRef.current) return;
    const height = panelRef.current.offsetHeight;
    const trigger = { top: pos.anchorTop, bottom: pos.anchorBottom, left: pos.anchorLeft, right: pos.anchorRight };
    const { top, left, placement } = computeTooltipPosition({
      trigger,
      panelWidth: PANEL_WIDTH,
      panelHeight: height,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      align,
      margin: MARGIN,
      gap: GAP,
    });
    if (top !== pos.top || left !== pos.left || placement !== pos.placement) {
      setPos((prev) => ({ ...prev, top, left, placement }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pos?.anchorTop, pos?.anchorBottom]);

  // クリック表示は外側クリックで閉じる（ポータル先のパネル内クリックは除外）
  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (buttonRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [open]);

  // Escで閉じる（ホバー・クリックのどちらの表示中も）
  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        setHover(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible]);

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
      const estimatedHeight = panelRef.current?.offsetHeight ?? estimateTooltipHeight(body, { panelWidth: PANEL_WIDTH });
      const { top, left, placement } = computeTooltipPosition({
        trigger: rect,
        panelWidth: PANEL_WIDTH,
        panelHeight: estimatedHeight,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align,
        margin: MARGIN,
        gap: GAP,
      });
      setPos({ top, left, placement, anchorTop: rect.top, anchorBottom: rect.bottom, anchorLeft: rect.left, anchorRight: rect.right });
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [visible, align, body]);

  const arrowLeft =
    pos != null
      ? computeTooltipArrowLeft({
          trigger: { left: pos.anchorLeft, right: pos.anchorRight },
          panelLeft: pos.left,
          panelWidth: PANEL_WIDTH,
        })
      : PANEL_WIDTH / 2;

  return (
    <span className="ml-1 inline-flex align-middle" onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${title || "項目"}のヘルプ`}
        aria-describedby={visible ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={hoverIn}
        onBlur={hoverOut}
        className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-border/80 bg-card/60 text-[10px] font-semibold leading-none text-muted transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        ?
      </button>
      {visible && pos
        ? createPortal(
            <span
              ref={panelRef}
              id={panelId}
              role="tooltip"
              style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
              onMouseEnter={hoverIn}
              onMouseLeave={hoverOut}
              className={`fixed ${Z_INDEX} block max-w-[85vw] whitespace-pre-line rounded-lg border border-border bg-[#232b34] px-2.5 py-2 text-left text-xs font-normal leading-[1.5] text-text shadow-xl`}
            >
              {/* 矢印: パネルの反対側の端から対象要素を指す（上部表示時は下向き＝パネル下端） */}
              <span
                aria-hidden="true"
                style={{ left: arrowLeft }}
                className={`absolute h-2 w-2 -translate-x-1/2 rotate-45 border-border bg-[#232b34] ${
                  pos.placement === "top"
                    ? "-bottom-1 border-b border-r"
                    : "-top-1 border-l border-t"
                }`}
              />
              {title ? <span className="mb-1 block text-[13px] font-semibold text-text">{title}</span> : null}
              {body}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
