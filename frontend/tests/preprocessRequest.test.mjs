// 前処理リクエスト共通ペイロード（lib/preprocessRequest.js）のテスト。
// preview / run が同一の正規化ロジック・同一の overrides を使うことを保証する。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  buildPreprocessPreviewPayload,
  buildPreprocessRunPayload,
  normalizePreprocessOverrides,
  preprocessRunConfirmText,
  summarizePreprocessRun,
} from "../src/lib/preprocessRequest.js";

const PARAMS = {
  ratio_threshold: 1.6,
  threshold_type: "binary",
  threshold_value: 90,
  illumination_enabled: true,
  illumination_method: "gaussian",
  illumination_background_size: 81,
  illumination_strength: 1.0,
  deskew_enabled: false,
  manual_mask_enabled: true,
  manual_mask_fill: "white",
  manual_mask_timing: "post",
  single_size: 64,
  wide_height: 48,
  wide_keep_ratio: true,
  denoise_method: "gaussian",
  denoise_ksize: 1,
};

test("normalizePreprocessOverrides: 型変換・未指定値の補完・無効工程のenabled明示", () => {
  const ops = normalizePreprocessOverrides({ threshold_value: "90" }).preprocess.operations;
  assert.equal(ops.threshold.value, 90); // 文字列→数値
  assert.equal(ops.threshold.type, "binary"); // 未指定は既定値
  assert.equal(ops.threshold.block_size, 35); // adaptive用パラメータも補完
  assert.equal(ops.threshold.c, 11);
  assert.equal(ops.gamma.enabled, false); // 無効工程も明示的に送る
  assert.equal(ops.deskew.enabled, false);
  assert.equal(ops.resize.single, 64);
  assert.equal(normalizePreprocessOverrides({}).preprocess.ratio_threshold, 1.6);
});

test("previewとrunのペイロードが同一のoverridesを持つ（共通関数）", () => {
  const preview = buildPreprocessPreviewPayload({
    image: "a.png",
    projectId: "p1",
    params: PARAMS,
    fields: { engine: "easyocr" },
  });
  const run = buildPreprocessRunPayload({ projectId: "p1", params: PARAMS });
  assert.deepEqual(preview.overrides, run.overrides);
  assert.equal(preview.image, "a.png");
  assert.equal(preview.engine, "easyocr");
  assert.equal(run.project_id, "p1");
  assert.ok(!("image" in run));
});

test("実行前要約: /preprocess/run へ送る同一データ（overrides）から生成される", () => {
  const lines = summarizePreprocessRun(PARAMS);
  const byLabel = Object.fromEntries(lines.map((row) => [row.label, row.value]));
  assert.equal(byLabel["二値化"], "固定しきい値 90");
  assert.equal(byLabel["照明ムラ補正"], "ON");
  assert.equal(byLabel["傾き補正"], "OFF（wideのみ）");
  assert.equal(byLabel["手動マスク補正"], "ON（二値化後）");
  assert.ok(byLabel["出力サイズ"].includes("高さ48px"));
  // Otsu選択時はしきい値の数値を出さない
  const otsu = Object.fromEntries(summarizePreprocessRun({ ...PARAMS, threshold_type: "otsu" }).map((r) => [r.label, r.value]));
  assert.equal(otsu["二値化"], "大津法");
});

test("確認ダイアログ文言: 注意＋実行設定要約を含む", () => {
  const text = preprocessRunConfirmText(PARAMS);
  assert.ok(text.includes("既存の学習用画像・前処理スナップショットが更新されます"));
  assert.ok(text.includes("二値化: 固定しきい値 90"));
});

test("App.jsx: preview・run とも共通ライブラリを使用し、旧の画面内組み立てが残っていない", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf-8");
  assert.ok(source.includes('from "./lib/preprocessRequest"'), "共通ライブラリをimportしていない");
  assert.ok(source.includes("buildPreprocessRunPayload({ projectId, params: preprocessParams })"), "runが共通関数を使っていない");
  assert.ok(source.includes("buildPreprocessPreviewPayload("), "previewが共通関数を使っていない");
  // メイン・比較スロットとも同一の fetchPreview（共通関数＋キャッシュ）を通る
  assert.ok(source.includes("fetchPreview(mainFields)") && source.includes("fetchPreview(fields)"), "previewのメイン/スロットが共通経路でない");
  assert.ok(!source.includes("function buildPreprocessOverrides"), "旧のApp.jsx内組み立て関数が残っている");
  assert.ok(source.includes("preprocessRunConfirmText"), "実行前の確認ダイアログがない");
});
