// 画面単位ErrorBoundaryのkey決定（lib/viewKey.js）のテスト。
// 学習画像作成のStep遷移で再マウントされない（=Step1の選択画像がStep2でも保持される）ことの回帰テスト
import test from "node:test";
import assert from "node:assert/strict";

import { viewBoundaryKey } from "../src/lib/viewKey.js";

test("学習画像作成のStep1〜4は同一key（Step遷移で再マウントしない）", () => {
  const keys = ["image-builder-step1", "image-builder-step2", "image-builder-step3", "image-builder-step4"].map(
    viewBoundaryKey
  );
  assert.deepEqual(keys, ["image-builder", "image-builder", "image-builder", "image-builder"]);
});

test("学習画像作成以外の画面は従来どおり画面IDがkey（切替時にエラー状態がリセットされる）", () => {
  assert.equal(viewBoundaryKey("ocr-training"), "ocr-training");
  assert.equal(viewBoundaryKey("labeling"), "labeling");
  assert.equal(viewBoundaryKey("dashboard"), "dashboard");
});

test("空・未定義でもクラッシュしない", () => {
  assert.equal(viewBoundaryKey(""), "");
  assert.equal(viewBoundaryKey(undefined), "");
});
