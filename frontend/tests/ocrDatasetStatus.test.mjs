// 学習データセット準備状態の純ロジック（lib/ocrDatasetStatus.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDatasetCreateProgressLabel,
  buildOcrDatasetDisplay,
  buildOcrDatasetSummary,
  buildTrainingPreprocessStatus,
  deriveOcrDatasetId,
  deriveOcrDatasetStatus,
} from "../src/lib/ocrDatasetStatus.js";

test("deriveOcrDatasetId: フォルダ名からDS-プレフィックス表示IDを導出する", () => {
  assert.equal(deriveOcrDatasetId("C:\\data\\projects\\p1\\outputs\\ocr_dataset\\20260727_143022"), "DS-20260727_143022");
  assert.equal(deriveOcrDatasetId("/data/projects/p1/outputs/ocr_dataset/20260727_143022"), "DS-20260727_143022");
  assert.equal(deriveOcrDatasetId(""), "-");
  assert.equal(deriveOcrDatasetId(null), "-");
  // 既にDS-が付いている場合は二重に付与しない
  assert.equal(deriveOcrDatasetId("/x/DS-20260727_143022"), "DS-20260727_143022");
});

test("deriveOcrDatasetStatus: 未作成/作成中/作成済み/失敗の4状態", () => {
  assert.deepEqual(deriveOcrDatasetStatus(), { key: "not_created", label: "未作成" });
  assert.deepEqual(deriveOcrDatasetStatus({ hasInfo: false }), { key: "not_created", label: "未作成" });
  assert.deepEqual(deriveOcrDatasetStatus({ creating: true }), { key: "creating", label: "作成中" });
  assert.deepEqual(deriveOcrDatasetStatus({ failed: true }), { key: "failed", label: "失敗" });
  assert.deepEqual(deriveOcrDatasetStatus({ hasInfo: true }), { key: "created", label: "作成済み" });
  // creatingが最優先（前回failed/hasInfoが残っていても作成中を優先表示）
  assert.deepEqual(deriveOcrDatasetStatus({ hasInfo: true, creating: true, failed: true }), {
    key: "creating",
    label: "作成中",
  });
});

test("buildOcrDatasetDisplay: 作成済みデータの表示フィールド一式", () => {
  const info = {
    dataset_root: "/data/projects/p1/outputs/ocr_dataset/20260727_143022",
    created_at: "2026-07-27T14:30:22.123456",
    charset: "AB0123456789",
    seed: 42,
    training_preprocess_hash: "sha256:abcd",
    counts: { train: 700, val: 200, test: 100 },
  };
  const display = buildOcrDatasetDisplay(info);
  assert.equal(display.status.key, "created");
  assert.equal(display.datasetId, "DS-20260727_143022");
  assert.equal(display.datasetRoot, info.dataset_root);
  assert.equal(display.createdAt, "2026-07-27 14:30:22");
  assert.equal(display.charset, "AB0123456789");
  assert.equal(display.seed, 42);
  assert.equal(display.trainingPreprocessHash, "sha256:abcd");
  assert.deepEqual(display.counts, { train: 700, val: 200, test: 100 });
});

test("buildOcrDatasetDisplay: 未記録・未作成時は推測補完せずプレースホルダを返す", () => {
  const display = buildOcrDatasetDisplay(null);
  assert.equal(display.status.key, "not_created");
  assert.equal(display.datasetId, "-");
  assert.equal(display.datasetRoot, "-");
  assert.equal(display.createdAt, "-");
  assert.equal(display.trainingPreprocessHash, "未記録");
  assert.deepEqual(display.counts, { train: 0, val: 0, test: 0 });

  const creating = buildOcrDatasetDisplay(null, { creating: true });
  assert.equal(creating.status.key, "creating");

  const failed = buildOcrDatasetDisplay(null, { failed: true });
  assert.equal(failed.status.key, "failed");
});

test("buildOcrDatasetSummary: 準備済み（作成済み＋件数>0）のときのみ準備済み表示", () => {
  const ready = buildOcrDatasetSummary({ datasetInfo: { counts: { train: 700, val: 200, test: 100 } } });
  assert.equal(ready.ready, true);
  assert.equal(ready.headline, "準備済み");
  assert.equal(ready.total, 1000);
  assert.equal(ready.train, 700);
  assert.equal(ready.val, 200);
  assert.equal(ready.test, 100);
});

test("buildOcrDatasetDisplay/buildOcrDatasetSummary: OCRログ再学習データ（分割なし・count単数）はunsplitモード", () => {
  const info = { dataset_root: "/data/p1/outputs/ocr_dataset_from_logs/20260727_150000", count: 42, created_at: "2026-07-27T15:00:00" };
  const display = buildOcrDatasetDisplay(info);
  assert.equal(display.mode, "unsplit");
  assert.equal(display.unsplitCount, 42);
  assert.deepEqual(display.counts, { train: 0, val: 0, test: 0 });

  const summary = buildOcrDatasetSummary({ datasetInfo: info });
  assert.equal(summary.mode, "unsplit");
  assert.equal(summary.total, 42);
  assert.equal(summary.ready, true);
  assert.equal(summary.headline, "準備済み");
});

test("buildOcrDatasetSummary: 未作成/作成中/失敗/件数0はすべて未準備", () => {
  assert.equal(buildOcrDatasetSummary({}).headline, "未準備");
  assert.equal(buildOcrDatasetSummary({ creating: true }).headline, "未準備");
  assert.equal(buildOcrDatasetSummary({ failed: true }).headline, "未準備");
  // datasetInfoはあるが件数0（異常系。作成済みだが空データセットは扱わない設計）
  assert.equal(
    buildOcrDatasetSummary({ datasetInfo: { counts: { train: 0, val: 0, test: 0 } } }).headline,
    "未準備"
  );
});

test("buildTrainingPreprocessStatus: 新規プロジェクト（画像なし）は not_processed（前処理画像なし）", () => {
  const status = buildTrainingPreprocessStatus(null);
  assert.equal(status.status, "not_processed");
  assert.equal(status.label, "前処理画像なし");
  assert.equal(status.processedImageCount, 0);
  assert.equal(status.executedAt, "-");
});

test("buildTrainingPreprocessStatus: 旧プロジェクト（processedあり・snapshotなし）は processed_without_snapshot", () => {
  const status = buildTrainingPreprocessStatus({
    training_preprocess: null,
    training_preprocess_hash: null,
    executed: false,
    executed_at: "",
    processed_image_count: 1000,
  });
  assert.equal(status.status, "processed_without_snapshot");
  assert.equal(status.label, "前処理済み・設定記録なし");
  assert.equal(status.processedImageCount, 1000);
  // 設定記録が無い以上、処理日時も不明（推測補完しない）
  assert.equal(status.executedAt, "-");
});

test("buildTrainingPreprocessStatus: 記録ありは処理画像数・処理日時を整形して返す（training_preprocess/hash/executedのいずれかで判定）", () => {
  const status = buildTrainingPreprocessStatus({
    training_preprocess: { steps: {} },
    executed: true,
    executed_at: "2026-07-27T12:18:00.123456",
    processed_image_count: 1024,
  });
  assert.equal(status.status, "recorded");
  assert.equal(status.label, "前処理済み・設定記録あり");
  assert.equal(status.processedImageCount, 1024);
  assert.equal(status.executedAt, "2026-07-27 12:18:00");

  // executedのみでも記録ありと判定する（後方互換: 旧フィールドのみのデータ）
  const status2 = buildTrainingPreprocessStatus({ executed: true, executed_at: "2026-07-27T12:18:00", processed_image_count: 5 });
  assert.equal(status2.status, "recorded");

  // training_preprocess_hashのみでも記録ありと判定する
  const status3 = buildTrainingPreprocessStatus({ training_preprocess_hash: "sha256:abc", processed_image_count: 5 });
  assert.equal(status3.status, "recorded");
});

test("buildDatasetCreateProgressLabel: データセット作成フローの2段階進捗ラベル", () => {
  assert.equal(buildDatasetCreateProgressLabel("preprocess"), "1/2 前処理中");
  assert.equal(buildDatasetCreateProgressLabel("dataset"), "2/2 Dataset作成中");
  assert.equal(buildDatasetCreateProgressLabel(null), null);
  assert.equal(buildDatasetCreateProgressLabel(undefined), null);
  assert.equal(buildDatasetCreateProgressLabel("unknown"), null);
});
