// ラベル編集「保存して次へ」の次画像決定ロジックの回帰テスト。
// 実行: node --test frontend/tests/
import assert from "node:assert/strict";
import { test } from "node:test";

import { decideNextImageIndex } from "../src/lib/labelNavigation.js";

const ALL = ["A.png", "B.png", "C.png"];

test("通常一覧: Aを保存したらB（1件だけ進む）", () => {
  assert.equal(decideNextImageIndex(ALL, ALL, "A.png"), 1);
});

test("通常一覧: Bを保存したらC（2件飛ばさない）", () => {
  assert.equal(decideNextImageIndex(ALL, ALL, "B.png"), 2);
});

test("未編集のみ: [A,B,C]表示でBを保存 → C（保存後にBが一覧から消えても飛ばさない）", () => {
  // 保存前のスナップショットで次画像を確定するため、保存後の詰まりに影響されない
  assert.equal(decideNextImageIndex(ALL, ["A.png", "B.png", "C.png"], "B.png"), 2);
});

test("未編集のみ: フィルタ済み一覧[B,C]でBを保存 → C", () => {
  assert.equal(decideNextImageIndex(ALL, ["B.png", "C.png"], "B.png"), 2);
});

test("最後の画像では進まない（null）", () => {
  assert.equal(decideNextImageIndex(ALL, ALL, "C.png"), null);
  assert.equal(decideNextImageIndex(ALL, ["B.png", "C.png"], "C.png"), null);
});

test("現在画像がフィルタで非表示の場合は全体一覧で次へ", () => {
  // 未編集のみ表示中にラベル済みのBを開いている場合など
  assert.equal(decideNextImageIndex(ALL, ["A.png", "C.png"], "B.png"), 2);
});

test("現在画像が見つからない場合は移動しない", () => {
  assert.equal(decideNextImageIndex(ALL, ALL, "Z.png"), null);
  assert.equal(decideNextImageIndex([], [], "A.png"), null);
});

test("次画像が全体一覧に存在しない場合は移動しない", () => {
  assert.equal(decideNextImageIndex(["A.png"], ["A.png", "GHOST.png"], "A.png"), null);
});
