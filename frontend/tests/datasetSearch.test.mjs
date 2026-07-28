import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesDatasetSearch, sortDatasetItems } from "../src/lib/datasetSearch.js";

test("matchesDatasetSearch: 空文字は常にtrue", () => {
  assert.equal(matchesDatasetSearch("", { name: "OCRDataset_v1" }), true);
  assert.equal(matchesDatasetSearch(undefined, {}), true);
});

test("matchesDatasetSearch: Dataset名で一致", () => {
  assert.equal(matchesDatasetSearch("v3", { name: "OCRDataset_v3" }), true);
  assert.equal(matchesDatasetSearch("v9", { name: "OCRDataset_v3" }), false);
});

test("matchesDatasetSearch: コメントで一致", () => {
  assert.equal(matchesDatasetSearch("CLAHE", { name: "ds", comment: "CLAHE追加版" }), true);
});

test("matchesDatasetSearch: Charsetで一致", () => {
  assert.equal(matchesDatasetSearch("abc", { name: "ds", charset: "ABC0123" }), true);
});

test("matchesDatasetSearch: 前処理Versionで一致（v5のように検索）", () => {
  assert.equal(matchesDatasetSearch("v5", { name: "ds", preprocessVersion: 5 }), true);
  assert.equal(matchesDatasetSearch("v6", { name: "ds", preprocessVersion: 5 }), false);
});

test("sortDatasetItems: created_at降順（デフォルト方向）", () => {
  const items = [
    { name: "old", created_at: "2026-07-01T00:00:00" },
    { name: "new", created_at: "2026-07-15T00:00:00" },
  ];
  const sorted = sortDatasetItems(items, "created_at", "desc");
  assert.deepEqual(sorted.map((i) => i.name), ["new", "old"]);
});

test("sortDatasetItems: name昇順", () => {
  const items = [{ name: "b" }, { name: "a" }, { name: "c" }];
  const sorted = sortDatasetItems(items, "name", "asc");
  assert.deepEqual(sorted.map((i) => i.name), ["a", "b", "c"]);
});

test("sortDatasetItems: model_count降順", () => {
  const items = [
    { name: "few", model_count: 1 },
    { name: "many", model_count: 5 },
  ];
  const sorted = sortDatasetItems(items, "model_count", "desc");
  assert.deepEqual(sorted.map((i) => i.name), ["many", "few"]);
});

test("sortDatasetItems: 未対応keyは変更せずそのまま返す", () => {
  const items = [{ name: "b" }, { name: "a" }];
  const sorted = sortDatasetItems(items, "unknown_key");
  assert.deepEqual(sorted.map((i) => i.name), ["b", "a"]);
});
