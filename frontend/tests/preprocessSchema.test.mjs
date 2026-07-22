// 前処理設定スキーマ（lib/preprocessSchema.js）・UI状態保存（lib/preprocessUiState.js）・
// プレビューキャッシュ（lib/previewCache.js）のテスト。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PREPROCESS_SECTIONS,
  appliesToLabel,
  itemChanged,
  itemMatchesQuery,
  itemVisible,
  sectionChangedCount,
  sectionResetPatch,
  sectionStatusLabel,
  thresholdDependency,
  visibleItems,
} from "../src/lib/preprocessSchema.js";
import { normalizePredictSettings, normalizeUiState } from "../src/lib/preprocessUiState.js";
import { createPreviewCache, makePreviewCacheKey } from "../src/lib/previewCache.js";

const DEFAULTS = {
  threshold_type: "binary",
  threshold_value: 128,
  gamma_enabled: false,
  gamma_value: 1.0,
  deskew_enabled: true,
  illumination_enabled: false,
};

function section(id) {
  return PREPROCESS_SECTIONS.find((s) => s.id === id);
}

test("セクションは実処理順（入力→明るさ→鮮明化→二値化→マスク形状→出力整形）", () => {
  assert.deepEqual(
    PREPROCESS_SECTIONS.map((s) => s.id),
    ["input", "brightness", "sharpness", "threshold", "shape", "output"]
  );
  // 実処理順の裏付け: 明るさ系（gamma/clahe/局所/平坦化）が「その他」ではなく序盤セクションにある
  const brightnessIds = section("brightness").items.map((i) => i.id);
  for (const id of ["illumination", "gamma", "clahe", "local_contrast", "hist_equalize"]) {
    assert.ok(brightnessIds.includes(id), `${id} が明るさ・コントラストにない`);
  }
  // 鮮明化にバイラテラル・シャープ・アンシャープが集約されている
  assert.deepEqual(section("sharpness").items.map((i) => i.id), ["bilateral", "sharpen", "unsharp"]);
  // 傾き補正はマスク・形状補正へ（旧・基本設定から移動）
  assert.ok(section("shape").items.some((i) => i.id === "deskew"));
});

test("基本/詳細モード: 基本では詳細項目が隠れ、依存項目（adaptive）は基本でも表示", () => {
  const shape = section("shape");
  const strokeBoost = shape.items.find((i) => i.id === "stroke_boost");
  assert.equal(itemVisible(strokeBoost, shape, { mode: "basic", query: "", params: {} }), false);
  assert.equal(itemVisible(strokeBoost, shape, { mode: "advanced", query: "", params: {} }), true);
  // adaptive依存項目は基本モードでも adaptive 選択時に表示される
  const thresholdSection = section("threshold");
  const adaptive = thresholdSection.items.find((i) => i.id === "threshold_adaptive");
  assert.equal(itemVisible(adaptive, thresholdSection, { mode: "basic", query: "", params: { threshold_type: "adaptive" } }), true);
  assert.equal(itemVisible(adaptive, thresholdSection, { mode: "basic", query: "", params: { threshold_type: "binary" } }), false);
});

test("設定検索: 表示名・内部キー・検索語・カテゴリ名で一致し、非一致セクションは0件になる", () => {
  const thresholdSection = section("threshold");
  const typeItem = thresholdSection.items.find((i) => i.id === "threshold_type");
  assert.ok(itemMatchesQuery(typeItem, thresholdSection, "しきい値"));
  assert.ok(itemMatchesQuery(typeItem, thresholdSection, "otsu"));
  assert.ok(itemMatchesQuery(typeItem, thresholdSection, "threshold_type")); // 内部キー
  assert.ok(itemMatchesQuery(typeItem, thresholdSection, "二値化")); // カテゴリ名
  assert.ok(!itemMatchesQuery(typeItem, thresholdSection, "ガンマ"));
  // 「傾き」で shape セクションに deskew が残る・brightness は照明等のみ
  const hits = visibleItems(section("shape"), { mode: "advanced", query: "傾き", params: {} });
  assert.deepEqual(hits.map((i) => i.id), ["deskew"]);
  assert.equal(visibleItems(section("output"), { mode: "advanced", query: "傾き", params: {} }).length, 0);
});

test("変更済み判定とセクション変更件数・セクションリセット", () => {
  const thresholdSection = section("threshold");
  const valueItem = thresholdSection.items.find((i) => i.id === "threshold_value");
  assert.equal(itemChanged(valueItem, { threshold_value: 128 }, DEFAULTS), false);
  assert.equal(itemChanged(valueItem, { threshold_value: 90 }, DEFAULTS), true);
  assert.equal(sectionChangedCount(thresholdSection, { threshold_type: "otsu", threshold_value: 90 }, DEFAULTS), 2);
  const patch = sectionResetPatch(thresholdSection, DEFAULTS);
  assert.equal(patch.threshold_value, 128);
  assert.equal(patch.threshold_type, "binary");
});

test("見出しバッジ: 項目ON/OFF・セクションのON数・対象種別ラベル", () => {
  const brightness = section("brightness");
  assert.equal(sectionStatusLabel(brightness, { illumination_enabled: true }), "1/4 ON");
  assert.equal(sectionStatusLabel(section("input"), {}), ""); // トグルなしセクションはバッジなし
  const deskew = section("shape").items.find((i) => i.id === "deskew");
  assert.equal(appliesToLabel(deskew), "wide画像のみ");
  assert.equal(appliesToLabel(section("output").items.find((i) => i.id === "pad")), "single画像のみ");
});

test("二値化の依存関係: 固定のみしきい値有効・adaptiveのみblock/C表示", () => {
  assert.deepEqual(thresholdDependency("binary"), { valueEnabled: true, adaptiveVisible: false });
  assert.deepEqual(thresholdDependency("otsu"), { valueEnabled: false, adaptiveVisible: false });
  assert.deepEqual(thresholdDependency("adaptive"), { valueEnabled: false, adaptiveVisible: true });
  assert.deepEqual(thresholdDependency("none"), { valueEnabled: false, adaptiveVisible: false });
});

test("UI状態の正規化（折りたたみ・モード保存。検索文字列は含まれない）", () => {
  const state = normalizeUiState({ mode: "advanced", openSections: ["threshold"], query: "abc" });
  assert.deepEqual(state, { mode: "advanced", openSections: ["threshold"] });
  assert.equal(normalizeUiState(null).mode, "basic");
  assert.ok(normalizeUiState(null).openSections.includes("threshold"));
});

test("OCR結果確認設定の正規化（PSM範囲・エンジン既定）", () => {
  const s = normalizePredictSettings({ engine: "tesseract", psm: 6, whitelist: "AB", langs: ["en", "ja"] });
  assert.equal(s.engine, "tesseract");
  assert.equal(s.psm, 6);
  assert.equal(s.whitelist, "AB");
  assert.equal(normalizePredictSettings({ psm: 99 }).psm, 7);
  assert.equal(normalizePredictSettings({ engine: "bad" }).engine, "easyocr");
});

test("プレビューキャッシュ: 同一設定でキー一致・設定差で不一致・LRU上限", () => {
  const overrides = { preprocess: { operations: { threshold: { type: "binary", value: 90 } } } };
  const key1 = makePreviewCacheKey({ image: "a.png", overrides, fields: { engine: "tesseract" } });
  const key2 = makePreviewCacheKey({ image: "a.png", overrides: JSON.parse(JSON.stringify(overrides)), fields: { engine: "tesseract" } });
  assert.equal(key1, key2); // 同一設定は同一キー（メイン/比較スロットでキャッシュ共有）
  const key3 = makePreviewCacheKey({ image: "a.png", overrides: { ...overrides, x: 1 }, fields: { engine: "tesseract" } });
  assert.notEqual(key1, key3);
  const cache = createPreviewCache(2);
  cache.set("k1", 1);
  cache.set("k2", 2);
  cache.get("k1"); // k1を最近使用へ
  cache.set("k3", 3); // k2が追い出される
  assert.equal(cache.get("k1"), 1);
  assert.equal(cache.get("k2"), undefined);
  assert.equal(cache.get("k3"), 3);
});
