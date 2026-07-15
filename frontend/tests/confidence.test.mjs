// Confidence表示フォーマッタの回帰テスト（内部値0〜1 → UI% / null=取得不能→"--"）
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatConfidencePercent } from "../src/lib/confidence.js";

test("0.842 は 84.2% と表示する", () => {
  assert.equal(formatConfidencePercent(0.842), "84.2%");
});

test("0.0 は 0.0% と表示する（本当の0%）", () => {
  assert.equal(formatConfidencePercent(0), "0.0%");
});

test("1.0 は 100.0% と表示する", () => {
  assert.equal(formatConfidencePercent(1), "100.0%");
});

test("null（取得不能）は -- と表示する", () => {
  assert.equal(formatConfidencePercent(null), "--");
});

test("undefined は -- と表示する", () => {
  assert.equal(formatConfidencePercent(undefined), "--");
});

test("NaN・文字列は -- と表示する", () => {
  assert.equal(formatConfidencePercent(Number.NaN), "--");
  assert.equal(formatConfidencePercent("0.8"), "--");
});

test("fallback指定時はその文字を返す", () => {
  assert.equal(formatConfidencePercent(null, "-"), "-");
});
