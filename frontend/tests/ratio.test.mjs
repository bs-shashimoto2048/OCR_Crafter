// データ分割比率ユーティリティ（lib/ratio.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRatioInput, summarizeRatios } from "../src/lib/ratio.js";

test("normalizeRatioInput: 浮動小数点誤差を小数第1位へ丸める", () => {
  assert.equal(normalizeRatioInput("0.30000000000000004"), "0.3");
  assert.equal(normalizeRatioInput("0.7999999999999999"), "0.8");
});

test("normalizeRatioInput: 丸め不要な値はそのままの表記で返す", () => {
  assert.equal(normalizeRatioInput("0.7"), "0.7");
  assert.equal(normalizeRatioInput("0"), "0");
  assert.equal(normalizeRatioInput("1"), "1");
});

test("normalizeRatioInput: 小数第2位以下は第1位へ丸める（0.1単位入力）", () => {
  assert.equal(normalizeRatioInput("0.15"), "0.2");
  assert.equal(normalizeRatioInput("0.04"), "0");
});

test("normalizeRatioInput: 入力途中の文字列は変更しない", () => {
  assert.equal(normalizeRatioInput(""), "");
  assert.equal(normalizeRatioInput("-"), "-");
  assert.equal(normalizeRatioInput("0."), "0.");
  assert.equal(normalizeRatioInput("."), ".");
});

test("normalizeRatioInput: 数値以外はそのまま返す", () => {
  assert.equal(normalizeRatioInput("abc"), "abc");
});

test("summarizeRatios: 0.7/0.2/0.1 は浮動小数点誤差があっても合計1.00でvalid", () => {
  // 0.7+0.2+0.1 === 0.9999999999999999（厳密比較では不合格になる組み合わせ）
  const result = summarizeRatios("0.7", "0.2", "0.1");
  assert.equal(result.total, "1.00");
  assert.equal(result.valid, true);
});

test("summarizeRatios: 合計が1.0でない場合はinvalid", () => {
  const result = summarizeRatios("0.7", "0.2", "0.2");
  assert.equal(result.total, "1.10");
  assert.equal(result.valid, false);
});

test("summarizeRatios: Trainは0より大きい必要がある", () => {
  const result = summarizeRatios("0", "0.5", "0.5");
  assert.equal(result.valid, false);
});

test("summarizeRatios: 数値でない入力はtotal=-でinvalid", () => {
  const result = summarizeRatios("abc", "0.2", "0.1");
  assert.equal(result.total, "-");
  assert.equal(result.valid, false);
});

test("summarizeRatios: 空入力はNumber()で0扱い（従来挙動維持）となりTrain>0を満たさずinvalid", () => {
  const result = summarizeRatios("", "0.2", "0.1");
  assert.equal(result.total, "0.30");
  assert.equal(result.valid, false);
});
