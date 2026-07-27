// 前処理設定保存の表示状態（lib/preprocessConfigStatus.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDatasetPreprocessVersionDisplay,
  buildPreprocessConfigHistoryDisplay,
  buildPreprocessSaveStatus,
} from "../src/lib/preprocessConfigStatus.js";

test("buildPreprocessSaveStatus: 一度も保存されていない場合", () => {
  const status = buildPreprocessSaveStatus({ savedConfig: null, isSaved: false });
  assert.equal(status.status, "never_saved");
  assert.equal(status.label, "学習用設定は未保存です");
  assert.equal(status.version, null);
});

test("buildPreprocessSaveStatus: 保存済みで現在設定と一致", () => {
  const status = buildPreprocessSaveStatus({
    savedConfig: { version: 4, saved_at: "2026-07-27T19:10:00.123456", config_hash: "sha256:abc" },
    isSaved: true,
  });
  assert.equal(status.status, "saved");
  assert.equal(status.label, "保存済み");
  assert.equal(status.version, 4);
  assert.equal(status.savedAt, "2026-07-27 19:10:00");
});

test("buildPreprocessSaveStatus: 保存後に変更あり", () => {
  const status = buildPreprocessSaveStatus({
    savedConfig: { version: 4, saved_at: "2026-07-27T19:10:00", config_hash: "sha256:abc" },
    isSaved: false,
  });
  assert.equal(status.status, "changed");
  assert.equal(status.label, "未保存の変更があります");
  assert.equal(status.version, 4);
});

test("buildDatasetPreprocessVersionDisplay: 保存日時と適用日時を区別して整形する", () => {
  const display = buildDatasetPreprocessVersionDisplay({
    version: 4,
    savedAt: "2026-07-27T19:10:00",
    appliedAt: "2026-07-27T19:20:00",
    hash: "sha256:abc123",
  });
  assert.equal(display.version, 4);
  assert.equal(display.savedAt, "2026-07-27 19:10:00");
  assert.equal(display.appliedAt, "2026-07-27 19:20:00");
  assert.equal(display.hash, "sha256:abc123");
});

test("buildDatasetPreprocessVersionDisplay: 未記録は推測補完せずプレースホルダを返す", () => {
  const display = buildDatasetPreprocessVersionDisplay({});
  assert.equal(display.version, "-");
  assert.equal(display.savedAt, "-");
  assert.equal(display.appliedAt, "-");
  assert.equal(display.hash, "未記録");
});

test("buildPreprocessConfigHistoryDisplay: version降順の履歴を整形し現在使用中を区別する", () => {
  const history = [
    { version: 3, saved_at: "2026-07-25T16:30:00", config_hash: "sha256:def456" },
    { version: 2, saved_at: "2026-07-20T10:00:00", config_hash: "sha256:ghi789" },
  ];
  const display = buildPreprocessConfigHistoryDisplay(history, 3);
  assert.equal(display.length, 2);
  assert.equal(display[0].isCurrent, true);
  assert.equal(display[1].isCurrent, false);
  assert.equal(display[0].savedAt, "2026-07-25 16:30:00");
});

test("buildPreprocessConfigHistoryDisplay: 空配列・未指定でもクラッシュしない", () => {
  assert.deepEqual(buildPreprocessConfigHistoryDisplay(), []);
  assert.deepEqual(buildPreprocessConfigHistoryDisplay(null, 1), []);
});
