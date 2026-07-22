// 学習時前処理の表示・比較・差分（lib/preprocessCompare.js）と関連ヘルパーのテスト。
// バックエンド preprocess_snapshot.py が保存する training_preprocess 形式を模したデータで検証する。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PREPROCESS_COMPARISON_ROWS,
  buildPreprocessNotes,
  diffTrainingPreprocess,
  normalizeTrainingPreprocess,
  preprocessDetailRows,
  preprocessMatchLabels,
  preprocessRowValue,
  shortPreprocessHash,
  thresholdLabel,
  trainingPreprocessSummary,
} from "../src/lib/preprocessCompare.js";
import { normalizeTrainingCondition, TRAINING_CONDITION_ROWS } from "../src/lib/trainingCompare.js";
import { evalPreprocessModeForSource, evalPreprocessSourceLabel } from "../src/lib/evalPreprocess.js";
import { flattenEvalHistory, historyPreprocessLabel } from "../src/lib/evalHistory.js";

function makeTp({ thresholdType = "binary", thresholdValue = 128, illumination = false, gamma = null } = {}) {
  return {
    source: "processed_snapshot",
    snapshot_id: "prep_20260722_110000",
    created_at: "2026-07-22T11:00:00",
    pipeline_version: "preprocess-v1",
    image_types: ["wide"],
    steps: {
      wide: [
        { name: "grayscale", enabled: true, params: {} },
        { name: "illumination", enabled: illumination, params: { method: "gaussian", background_size: 81, strength: 1.0 } },
        { name: "gamma", enabled: gamma !== null, params: { value: gamma ?? 1.0 } },
        { name: "clahe", enabled: true, params: { clip_limit: 1.0, tile_grid_size: 2 } },
        { name: "threshold", enabled: true, params: { type: thresholdType, value: thresholdValue, block_size: 35, c: 11 } },
        { name: "morph", enabled: false, params: { method: "close", ksize: 3, iterations: 1 } },
        { name: "stroke_boost", enabled: true, params: { method: "close", ksize: 1, iterations: 1 } },
        { name: "deskew", enabled: true, params: { max_abs_angle: 8.0 } },
        { name: "resize", enabled: true, params: { single: 64, wide_height: 48, keep_ratio: true, interpolation: "area" } },
        { name: "denoise", enabled: true, params: { method: "gaussian", ksize: 1 } },
      ],
    },
    ocr_input_normalization: {
      grayscale: true,
      autocontrast_cutoff: 1,
      contrast_factor: 1.08,
      alignment: "center",
      background: "white",
      channels: 3,
      target_height: 48,
      canvas_width: 320,
    },
  };
}

function makeInfo(tp, hash = "sha256:abcdef1234567890") {
  return { training_preprocess: tp, training_preprocess_hash: hash, dataset_source_image_state: "processed" };
}

test("normalizeTrainingPreprocess: 記録ありモデルの正規化（wide優先・stepMap・ハッシュ短縮）", () => {
  const pre = normalizeTrainingPreprocess(makeInfo(makeTp()));
  assert.equal(pre.recorded, true);
  assert.equal(pre.primaryType, "wide");
  assert.equal(pre.hashShort, "abcdef12");
  assert.equal(pre.snapshotId, "prep_20260722_110000");
  assert.equal(pre.stepMap.threshold.params.value, 128);
  assert.equal(shortPreprocessHash("sha256:1234567890ab"), "12345678");
});

test("normalizeTrainingPreprocess: 未記録の旧モデルは recorded=false（推測しない）", () => {
  const pre = normalizeTrainingPreprocess({ engine: "tesseract" });
  assert.equal(pre.recorded, false);
  assert.equal(pre.hash, "");
  // 全比較行が「未記録」表示になる
  for (const row of PREPROCESS_COMPARISON_ROWS) {
    assert.equal(preprocessRowValue(row, pre), "未記録");
  }
  assert.equal(trainingPreprocessSummary(pre), "");
});

test("thresholdLabel: Binary/Otsu/Adaptive の表示", () => {
  assert.equal(thresholdLabel(normalizeTrainingPreprocess(makeInfo(makeTp()))), "Binary 128");
  assert.equal(thresholdLabel(normalizeTrainingPreprocess(makeInfo(makeTp({ thresholdType: "otsu" })))), "Otsu");
  assert.equal(
    thresholdLabel(normalizeTrainingPreprocess(makeInfo(makeTp({ thresholdType: "adaptive" })))),
    "Adaptive(35, 11)"
  );
});

test("比較行の値: 照明ムラ補正・Gamma・入力整形など", () => {
  const pre = normalizeTrainingPreprocess(makeInfo(makeTp({ illumination: true, gamma: 1.1 })));
  const value = (key) => preprocessRowValue(PREPROCESS_COMPARISON_ROWS.find((r) => r.key === key), pre);
  assert.equal(value("illumination"), "ON（gaussian）");
  assert.equal(value("gamma"), "1.1");
  assert.equal(value("thresholdMethod"), "Binary 128");
  assert.equal(value("deskew"), "ON");
  assert.equal(value("normalization"), "320×48");
  assert.equal(value("resize"), "高さ48px（比率維持）");
});

test("trainingPreprocessSummary: 学習条件比較用の要約（二値化・入力サイズ・ハッシュ）", () => {
  const pre = normalizeTrainingPreprocess(makeInfo(makeTp()));
  assert.equal(trainingPreprocessSummary(pre), "Binary 128・320×48（abcdef12）");
});

test("preprocessMatchLabels: 同一/異なる/未記録の判定", () => {
  const a = normalizeTrainingPreprocess(makeInfo(makeTp(), "sha256:aaaa1111"));
  const b = normalizeTrainingPreprocess(makeInfo(makeTp(), "sha256:aaaa1111"));
  const c = normalizeTrainingPreprocess(makeInfo(makeTp({ thresholdType: "otsu" }), "sha256:bbbb2222"));
  const old = normalizeTrainingPreprocess({});
  assert.deepEqual(preprocessMatchLabels([a, b, c, old]), ["同一", "同一", "異なる", "未記録"]);
});

test("diffTrainingPreprocess: 変更点のみ抽出・同一ハッシュは差分なし・未記録は判定不能", () => {
  const a = normalizeTrainingPreprocess(makeInfo(makeTp({ illumination: true, gamma: 1.1 }), "sha256:a1"));
  const b = normalizeTrainingPreprocess(makeInfo(makeTp({ thresholdType: "otsu", gamma: 1.0 }), "sha256:b2"));
  const diff = diffTrainingPreprocess(a, b);
  assert.equal(diff.comparable, true);
  const labels = diff.changes.map((c) => c.label);
  assert.ok(labels.includes("照明ムラ補正"));
  assert.ok(labels.includes("二値化方式"));
  assert.ok(labels.includes("Gamma"));
  const thresholdChange = diff.changes.find((c) => c.key === "thresholdMethod");
  assert.equal(thresholdChange.from, "Binary 128");
  assert.equal(thresholdChange.to, "Otsu");

  const same = diffTrainingPreprocess(
    normalizeTrainingPreprocess(makeInfo(makeTp(), "sha256:same")),
    normalizeTrainingPreprocess(makeInfo(makeTp(), "sha256:same"))
  );
  assert.deepEqual(same, { changes: [], comparable: true });

  const unknown = diffTrainingPreprocess(normalizeTrainingPreprocess({}), a);
  assert.equal(unknown.comparable, false);
});

test("buildPreprocessNotes: モデル間不一致・未記録混在の注意文", () => {
  const infos = {
    A: makeInfo(makeTp(), "sha256:a1"),
    B: makeInfo(makeTp({ thresholdType: "otsu" }), "sha256:b2"),
    C: {},
  };
  const notes = buildPreprocessNotes({
    targets: ["A", "B", "C"],
    labelOf: (t) => t,
    preOf: (t) => normalizeTrainingPreprocess(infos[t]),
  });
  assert.ok(notes.some((n) => n.includes("学習時前処理が異なります")));
  assert.ok(notes.some((n) => n.includes("未記録")));
});

test("preprocessDetailRows: 工程順・有効状態・パラメータ文字列", () => {
  const rows = preprocessDetailRows(normalizeTrainingPreprocess(makeInfo(makeTp())));
  assert.equal(rows[0].name, "grayscale");
  const threshold = rows.find((r) => r.name === "threshold");
  assert.equal(threshold.enabled, true);
  assert.ok(threshold.params.includes("type=binary"));
  assert.ok(threshold.params.includes("value=128"));
});

test("normalizeTrainingCondition: 学習前処理行が要約表示になる（旧モデルは未記録）", () => {
  const cond = normalizeTrainingCondition(makeInfo(makeTp()));
  assert.equal(cond.trainingPreprocess, "Binary 128・320×48（abcdef12）");
  const row = TRAINING_CONDITION_ROWS.find((r) => r.key === "trainingPreprocess");
  assert.equal(row.value(cond), "Binary 128・320×48（abcdef12）");
  const legacy = normalizeTrainingCondition({ engine: "tesseract" });
  assert.equal(row.value(legacy), "未記録");
});

test("evalPreprocessModeForSource / sourceラベル: training対応", () => {
  assert.equal(evalPreprocessModeForSource("training"), "training");
  assert.equal(evalPreprocessModeForSource("none"), "none");
  assert.equal(evalPreprocessModeForSource("step5"), "manual");
  assert.equal(evalPreprocessModeForSource("custom"), "manual");
  assert.equal(evalPreprocessSourceLabel("training"), "学習時前処理");
  assert.equal(evalPreprocessSourceLabel("training_individual"), "学習時前処理（個別）");
});

test("評価履歴: 学習時前処理モードの表示と不一致マーク（旧形式は未記録のまま）", () => {
  const history = {
    "m.tess.json": {
      ds1: { percent: 90, at: "2026-07-22T10:00:00Z", pre: { source: "training", summary: "学習時前処理", mode: "training", hash: "sha256:a1" }, preprocess_match: true },
      ds2: { percent: 80, at: "2026-07-21T10:00:00Z", pre: { source: "custom", summary: "Gray/固定90" }, preprocess_match: false },
      ds3: { percent: 70, at: "2026-07-20T10:00:00Z" },
    },
  };
  const rows = flattenEvalHistory(history);
  const byDataset = Object.fromEntries(rows.map((r) => [r.dataset, r]));
  assert.equal(historyPreprocessLabel(byDataset.ds1), "学習時前処理");
  assert.equal(byDataset.ds1.preMatch, true);
  assert.equal(historyPreprocessLabel(byDataset.ds2), "⚠カスタム: Gray/固定90");
  assert.equal(historyPreprocessLabel(byDataset.ds3), "未記録");
  assert.equal(byDataset.ds3.preMatch, null);
});
