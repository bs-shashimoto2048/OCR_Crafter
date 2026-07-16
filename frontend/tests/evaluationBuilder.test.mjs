// Step5（評価用データ作成）純ロジック（lib/evaluationBuilder.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  computeEvalCounts,
  cropKey,
  EVAL_SERIES_ALL,
  evaluateCreateReadiness,
  filterEvalItems,
  nextRotation,
} from "../src/lib/evaluationBuilder.js";

const items = [
  { key: "e1/1.png", series: "tube", exists: true },
  { key: "e1/2.png", series: "tube", exists: true },
  { key: "e1/3.png", series: "nmb", exists: false },
];

test("nextRotation: 90/180の繰り返し適用で0-270を循環する", () => {
  assert.equal(nextRotation(0, 90), 90);
  assert.equal(nextRotation(90, 90), 180);
  assert.equal(nextRotation(180, 180), 0);
  assert.equal(nextRotation(270, 90), 0);
  assert.equal(nextRotation(90, 180), 270);
  assert.equal(nextRotation(null, 0), 0);
});

test("computeEvalCounts: 評価対象のみ集計（登録済/未入力/回転済み）", () => {
  const state = {
    "e1/1.png": { label: "AB1", rotation: 90 },
    "e1/2.png": { label: " ", rotation: 0 },
    "e1/3.png": { checked: false, label: "X" },
  };
  const counts = computeEvalCounts(items, state);
  assert.deepEqual(counts, { target: 2, labeled: 1, unlabeled: 1, rotated: 1 });
});

test("filterEvalItems: Seriesと未入力のみで絞り込む", () => {
  const state = { "e1/1.png": { label: "AB1" } };
  assert.equal(filterEvalItems(items, state, { series: "tube" }).length, 2);
  assert.equal(filterEvalItems(items, state, { series: EVAL_SERIES_ALL }).length, 3);
  const unlabeled = filterEvalItems(items, state, { unlabeledOnly: true });
  assert.deepEqual(
    unlabeled.map((i) => i.key),
    ["e1/2.png", "e1/3.png"]
  );
});

test("evaluateCreateReadiness: 未入力・欠損・0件で作成不可", () => {
  const allLabeled = {
    "e1/1.png": { label: "A" },
    "e1/2.png": { label: "B" },
    "e1/3.png": { checked: false },
  };
  assert.deepEqual(evaluateCreateReadiness(items, allLabeled), { target: 2, unlabeled: 0, missing: 0, ok: true });

  const withUnlabeled = { ...allLabeled, "e1/2.png": { label: "" } };
  assert.equal(evaluateCreateReadiness(items, withUnlabeled).ok, false);
  assert.equal(evaluateCreateReadiness(items, withUnlabeled).unlabeled, 1);

  const withMissing = { ...allLabeled, "e1/3.png": { label: "C" } };
  assert.equal(evaluateCreateReadiness(items, withMissing).missing, 1);
  assert.equal(evaluateCreateReadiness(items, withMissing).ok, false);

  const nothingChecked = {
    "e1/1.png": { checked: false },
    "e1/2.png": { checked: false },
    "e1/3.png": { checked: false },
  };
  assert.equal(evaluateCreateReadiness(items, nothingChecked).ok, false);
});

test("cropKey: export_idとファイル名から一意キーを作る", () => {
  assert.equal(cropKey("export_1", "001.png"), "export_1/001.png");
});
