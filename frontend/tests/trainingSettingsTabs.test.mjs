// 次回学習の設定タブ定義・旧タブID移行のテスト（lib/trainingSettingsTabs.js）
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS_TAB_ID, SETTINGS_TABS, normalizeSettingsTabId } from "../src/lib/trainingSettingsTabs.js";

test("タブは3件で、学習設定→オーグメンテーション→エンジン設定の順", () => {
  assert.equal(SETTINGS_TABS.length, 3);
  assert.deepEqual(
    SETTINGS_TABS.map((t) => t.id),
    ["training-settings", "augmentation", "engine"]
  );
  assert.deepEqual(
    SETTINGS_TABS.map((t) => t.label),
    ["学習設定", "オーグメンテーション", "エンジン設定"]
  );
  assert.equal(DEFAULT_SETTINGS_TAB_ID, "training-settings");
});

test("旧タブID（data-split / training-params）は学習設定へ安全に移行する", () => {
  assert.equal(normalizeSettingsTabId("data-split"), "training-settings");
  assert.equal(normalizeSettingsTabId("training-params"), "training-settings");
});

test("現行タブIDはそのまま維持される", () => {
  assert.equal(normalizeSettingsTabId("training-settings"), "training-settings");
  assert.equal(normalizeSettingsTabId("augmentation"), "augmentation");
  assert.equal(normalizeSettingsTabId("engine"), "engine");
});

test("想定外の値（未知の文字列・null・undefined・空文字）は学習設定へフォールバックする", () => {
  assert.equal(normalizeSettingsTabId("unknown-tab"), "training-settings");
  assert.equal(normalizeSettingsTabId(null), "training-settings");
  assert.equal(normalizeSettingsTabId(undefined), "training-settings");
  assert.equal(normalizeSettingsTabId(""), "training-settings");
});
