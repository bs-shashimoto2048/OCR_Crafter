// InfoTooltip の表示位置計算（DOM非依存の純粋関数）。画面端補正込み。
// 基本方針: 対象要素の上部中央（placement=top）を優先し、上側に十分な空間が無い場合のみ
// 下側（placement=bottom）へフォールバックする。左右は画面内へクランプする。

// 水平位置とプレースメント（top/bottom）を計算する。
// trigger: {top, bottom, left, right}（対象要素のビューポート座標） / panelWidth・panelHeight: パネル寸法
// viewport: {width, height} / align: "left"=パネル左端を対象要素左端に揃える / それ以外=右端を揃える
export function computeTooltipPosition({ trigger, panelWidth, panelHeight, viewport, align = "right", margin = 8, gap = 6 }) {
  let left = align === "left" ? trigger.left : trigger.right - panelWidth;
  left = Math.max(margin, Math.min(left, viewport.width - panelWidth - margin));

  const above = trigger.top - gap - panelHeight;
  if (above >= margin) {
    return { top: above, left, placement: "top" };
  }
  // 上端に十分な空間が無い場合のみ下側へフォールバック
  return { top: trigger.bottom + gap, left, placement: "bottom" };
}

// パネル基準での矢印の水平オフセット（対象要素の水平中央を指すように、パネル内へクランプ）
export function computeTooltipArrowLeft({ trigger, panelLeft, panelWidth, margin = 10 }) {
  const idealCenter = trigger.left + (trigger.right - trigger.left) / 2 - panelLeft;
  return Math.max(margin, Math.min(idealCenter, panelWidth - margin));
}

// 本文の長さからの概算高さ（初回配置のちらつき防止用。実測後に正確な値へ補正される）
export function estimateTooltipHeight(text, { panelWidth = 256, charsPerLine = 34, lineHeight = 18, basePadding = 40 } = {}) {
  const length = String(text || "").length;
  const lines = Math.max(1, Math.ceil(length / charsPerLine));
  return basePadding + lines * lineHeight;
}
