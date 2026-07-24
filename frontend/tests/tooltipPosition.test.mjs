// ツールチップ位置計算の純粋関数テスト（lib/tooltipPosition.js）
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeTooltipArrowLeft, computeTooltipPosition, estimateTooltipHeight } from "../src/lib/tooltipPosition.js";

const VIEWPORT = { width: 1366, height: 768 };

test("上側に十分な空間がある場合は上部（placement=top）へ配置する", () => {
  const trigger = { top: 400, bottom: 416, left: 600, right: 616 };
  const result = computeTooltipPosition({ trigger, panelWidth: 256, panelHeight: 80, viewport: VIEWPORT });
  assert.equal(result.placement, "top");
  assert.equal(result.top, 400 - 6 - 80); // gap既定6
});

test("上端に十分な空間が無い場合のみ下側（placement=bottom）へフォールバックする", () => {
  const trigger = { top: 20, bottom: 36, left: 600, right: 616 };
  const result = computeTooltipPosition({ trigger, panelWidth: 256, panelHeight: 80, viewport: VIEWPORT });
  assert.equal(result.placement, "bottom");
  assert.equal(result.top, 36 + 6);
});

test("左端では右へ補正される（画面外へはみ出さない）", () => {
  const trigger = { top: 400, bottom: 416, left: 2, right: 18 };
  const result = computeTooltipPosition({ trigger, panelWidth: 256, panelHeight: 80, viewport: VIEWPORT, align: "left" });
  assert.equal(result.left, 8); // margin既定8
});

test("右端では左へ補正される（画面外へはみ出さない）", () => {
  const trigger = { top: 400, bottom: 416, left: 1350, right: 1360 };
  const result = computeTooltipPosition({ trigger, panelWidth: 256, panelHeight: 80, viewport: VIEWPORT });
  assert.equal(result.left, VIEWPORT.width - 256 - 8);
});

test("align=left はパネル左端をトリガー左端に揃え、それ以外は右端に揃える", () => {
  const trigger = { top: 400, bottom: 416, left: 600, right: 650 };
  const left = computeTooltipPosition({ trigger, panelWidth: 256, panelHeight: 80, viewport: VIEWPORT, align: "left" });
  const right = computeTooltipPosition({ trigger, panelWidth: 256, panelHeight: 80, viewport: VIEWPORT, align: "right" });
  assert.equal(left.left, 600);
  assert.equal(right.left, 650 - 256);
});

test("矢印はトリガー中央を指し、パネル内（margin〜width-margin）へクランプされる", () => {
  const centered = computeTooltipArrowLeft({ trigger: { left: 100, right: 116 }, panelLeft: 0, panelWidth: 256 });
  assert.equal(centered, 108);

  const clampedLow = computeTooltipArrowLeft({ trigger: { left: 0, right: 4 }, panelLeft: 8, panelWidth: 256, margin: 10 });
  assert.equal(clampedLow, 10);

  const clampedHigh = computeTooltipArrowLeft({ trigger: { left: 1000, right: 1016 }, panelLeft: 700, panelWidth: 256, margin: 10 });
  assert.equal(clampedHigh, 246); // panelWidth(256) - margin(10)
});

test("概算高さは本文が長いほど大きくなり、最低1行分は確保する", () => {
  const empty = estimateTooltipHeight("");
  const long = estimateTooltipHeight("あ".repeat(200));
  assert.ok(empty > 0);
  assert.ok(long > empty);
});
