// Benchmark純ロジック（ケースフィルタ・ページング・Profile比較警告）のテスト
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CASE_FILTERS,
  filterCases,
  formatMs,
  formatRate,
  pageCases,
  profileMismatchWarning,
} from "../src/lib/benchmarkLogic.js";

const CASES = [
  {
    image: "a.png",
    expected: "AB",
    engines: {
      "tesseract_model:m1": { prediction: "AB", match: true, failed: false },
      "tesseract_base:": { prediction: "AB", match: true, failed: false },
    },
  },
  {
    image: "b.png",
    expected: "CD",
    engines: {
      "tesseract_model:m1": { prediction: "CD", match: true, failed: false },
      "tesseract_base:": { prediction: "C0", match: false, failed: false },
    },
  },
  {
    image: "c.png",
    expected: "EF",
    engines: {
      "tesseract_model:m1": { prediction: "E1", match: false, failed: false },
      "tesseract_base:": { prediction: "", match: false, failed: true },
    },
  },
];

test("フィルタ定義: 全件/どれか失敗/Engine間不一致/全Engine不正解/特定Engineのみ正解の5種", () => {
  assert.deepEqual(
    CASE_FILTERS.map((f) => f.key),
    ["all", "any_failed", "mismatch", "all_wrong", "only_correct"]
  );
});

test("filterCases: 各フィルタが正しい行を返す", () => {
  assert.equal(filterCases(CASES, "all").length, 3);
  assert.deepEqual(filterCases(CASES, "any_failed").map((r) => r.image), ["c.png"]);
  assert.deepEqual(filterCases(CASES, "mismatch").map((r) => r.image), ["b.png", "c.png"]);
  assert.deepEqual(filterCases(CASES, "all_wrong").map((r) => r.image), ["c.png"]);
  // 特定Engineのみ正解: m1だけが正解している行（b.png。a.pngは両方正解のため対象外）
  assert.deepEqual(
    filterCases(CASES, "only_correct", "tesseract_model:m1").map((r) => r.image),
    ["b.png"]
  );
  assert.equal(filterCases(CASES, "only_correct", "").length, 0); // Engine未選択は0件
  assert.equal(filterCases(null, "all").length, 0); // 空安全
});

test("pageCases: ページング（1始まり・範囲クランプ）", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ image: `${i}.png` }));
  const page1 = pageCases(rows, 1, 50);
  assert.equal(page1.rows.length, 50);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.total, 120);
  const page3 = pageCases(rows, 3, 50);
  assert.equal(page3.rows.length, 20);
  assert.equal(pageCases(rows, 99, 50).page, 3); // 範囲外は最終ページへクランプ
  assert.equal(pageCases([], 1, 50).totalPages, 1);
});

test("profileMismatchWarning: Hash不一致は警告・一致は空・欠損は判定不能", () => {
  const a = { profile: { profile_hash: "sha256:aaa" } };
  const b = { profile: { profile_hash: "sha256:bbb" } };
  const same = { profile: { profile_hash: "sha256:aaa" } };
  assert.ok(profileMismatchWarning(a, b).includes("比較条件（Profile）が異なります"));
  assert.equal(profileMismatchWarning(a, same), "");
  assert.ok(profileMismatchWarning(a, {}).includes("判定できません"));
});

test("formatMs / formatRate: null=データなしは'-'（0へ偽装しない）", () => {
  assert.equal(formatMs(null), "-");
  assert.equal(formatMs(12.34), "12.3ms");
  assert.equal(formatRate(null), "-");
  assert.equal(formatRate(0.0833), "8.33%");
});
