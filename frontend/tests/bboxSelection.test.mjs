// 削除後の自動選択ロジック（lib/bboxSelection.js）のテスト。
// Seriesフィルタ適用中にフィルタ外のBBoxが選択される不具合の回帰テスト
import test from "node:test";
import assert from "node:assert/strict";

import { nextSelectionAfterDelete } from "../src/lib/bboxSelection.js";

const row = (id) => ({ id });

test("中間を削除したら表示中一覧の次の番号を選択する", () => {
  assert.equal(nextSelectionAfterDelete([row(1), row(2), row(3), row(4)], [2]), 3);
});

test("末尾を削除したら前の番号を選択する", () => {
  assert.equal(nextSelectionAfterDelete([row(1), row(2), row(3), row(4)], [4]), 3);
});

test("残件0なら null（選択解除）", () => {
  assert.equal(nextSelectionAfterDelete([row(1)], [1]), null);
  assert.equal(nextSelectionAfterDelete([], [1]), null);
});

test("Seriesフィルタ適用中はフィルタ外のBBoxを選択しない（回帰）", () => {
  // Series=A: #1,#2,#3 / Series=B: #10,#11（表示中はAのみ）
  const visibleSeriesA = [row(1), row(2), row(3)];
  // #2削除 → #3（#10ではない）
  assert.equal(nextSelectionAfterDelete(visibleSeriesA, [2]), 3);
  // 末尾#3削除 → #2
  assert.equal(nextSelectionAfterDelete(visibleSeriesA, [3]), 2);
  // 表示中を全削除 → null（フィルタ外の#10へ移らない）
  assert.equal(nextSelectionAfterDelete(visibleSeriesA, [1, 2, 3]), null);
});

test("複数削除は最小の削除番号を基準に次を選ぶ", () => {
  assert.equal(nextSelectionAfterDelete([row(1), row(2), row(3), row(4), row(5)], [2, 4]), 3);
});
