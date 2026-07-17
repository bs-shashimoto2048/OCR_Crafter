// Step5のOCR実行条件キーとLRUキャッシュ（lib/evalOcrRun.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import { buildOcrRunKey, createLruCache, shouldAutoRunOcr } from "../src/lib/evalOcrRun.js";
import { readEvalOcrAutoRun, writeEvalOcrAutoRun, writeEvalOcrSlots, readEvalOcrSlots } from "../src/lib/evalOcrSettings.js";

test("buildOcrRunKey: 画像・回転・前処理・スロット設定のいずれが変わっても別キー", () => {
  const base = buildOcrRunKey("e1/1.png", 0, "", '[{"engine":"paddleocr"}]');
  assert.equal(base, buildOcrRunKey("e1/1.png", 0, "", '[{"engine":"paddleocr"}]'));
  assert.notEqual(base, buildOcrRunKey("e1/2.png", 0, "", '[{"engine":"paddleocr"}]')); // 画像
  assert.notEqual(base, buildOcrRunKey("e1/1.png", 90, "", '[{"engine":"paddleocr"}]')); // 回転
  assert.notEqual(base, buildOcrRunKey("e1/1.png", 0, '{"grayscale":true}', '[{"engine":"paddleocr"}]')); // 前処理
  assert.notEqual(base, buildOcrRunKey("e1/1.png", 0, "", '[{"engine":"tesseract"}]')); // スロット設定
});

test("createLruCache: 上限超過で最古を破棄・getで最近使用扱いになる", () => {
  const cache = createLruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1); // aを最近使用へ
  cache.set("c", 3); // 上限2 → 最古のbを破棄
  assert.equal(cache.has("b"), false);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 2);
});

test("autoRun設定: 未保存=ON・明示false=OFF・スロット保存と共存する", () => {
  // localStorageモック
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  assert.equal(readEvalOcrAutoRun("p1"), true); // 未保存=ON（既定）
  writeEvalOcrAutoRun("p1", false); // 旧バージョンでOFFを選んだ利用者の設定は尊重
  assert.equal(readEvalOcrAutoRun("p1"), false);
  // スロット保存してもautoRunが消えない
  writeEvalOcrSlots("p1", [{ enabled: true, engine: "tesseract" }]);
  assert.equal(readEvalOcrAutoRun("p1"), false);
  assert.equal(readEvalOcrSlots("p1")[0].engine, "tesseract");
  // ONへ戻してもスロットが消えない
  writeEvalOcrAutoRun("p1", true);
  assert.equal(readEvalOcrAutoRun("p1"), true);
  assert.equal(readEvalOcrSlots("p1")[0].engine, "tesseract");
  delete global.localStorage;
});

test("shouldAutoRunOcr: キャッシュヒット時・無効時・対象なし時は発火しない", () => {
  const base = { autoRun: true, hasItem: true, itemExists: true, enabledCount: 3, hasCachedResult: false };
  assert.equal(shouldAutoRunOcr(base), true);
  assert.equal(shouldAutoRunOcr({ ...base, hasCachedResult: true }), false); // キャッシュヒット=API呼ばない
  assert.equal(shouldAutoRunOcr({ ...base, autoRun: false }), false);
  assert.equal(shouldAutoRunOcr({ ...base, enabledCount: 0 }), false);
  assert.equal(shouldAutoRunOcr({ ...base, hasItem: false }), false);
  assert.equal(shouldAutoRunOcr({ ...base, itemExists: false }), false); // 欠損画像
});
