// 学習画像作成 Step2（YOLO検出）のモデル選択・結果表示ロジック（lib/detectModel.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  extractDetectErrorDetail,
  formatDetectFailureMessage,
  formatDetectResultMessage,
  isModelMissing,
} from "../src/lib/detectModel.js";

test("isModelMissing: 一覧に無い保存済み選択はmissing", () => {
  assert.equal(isModelMissing("TrmRead_yolo26s.pt", ["yolo11n.pt", "yolov8n.pt"]), true);
});

test("isModelMissing: 一覧にあればmissingではない", () => {
  assert.equal(isModelMissing("yolo11n.pt", ["yolo11n.pt", "yolov8n.pt"]), false);
});

test("isModelMissing: カスタムパス選択・未選択・一覧未取得は対象外", () => {
  assert.equal(isModelMissing("__custom__", ["yolo11n.pt"]), false);
  assert.equal(isModelMissing("", ["yolo11n.pt"]), false);
  assert.equal(isModelMissing("model.pt", []), false);
  assert.equal(isModelMissing("model.pt", null), false);
});

test("extractDetectErrorDetail: FastAPIのdetailを取り出す", () => {
  assert.equal(
    extractDetectErrorDetail('{"detail":"YOLOモデルが見つかりません: x.pt"}'),
    "YOLOモデルが見つかりません: x.pt"
  );
});

test("extractDetectErrorDetail: JSONでなければ本文をそのまま返す", () => {
  assert.equal(extractDetectErrorDetail("Internal Server Error"), "Internal Server Error");
  assert.equal(extractDetectErrorDetail(""), "");
});

test("formatDetectFailureMessage: 理由と確認ヒントを含む", () => {
  const message = formatDetectFailureMessage('{"detail":"model not found"}');
  assert.match(message, /YOLO検出に失敗しました/);
  assert.match(message, /model not found/);
  assert.match(message, /検出前処理設定/);
  assert.match(formatDetectFailureMessage(""), /不明/);
});

test("formatDetectResultMessage: 0件は正常終了と明示し、処理失敗と区別する", () => {
  assert.match(formatDetectResultMessage(0), /0件/);
  assert.match(formatDetectResultMessage(0), /正常終了/);
  assert.equal(formatDetectResultMessage(14), "検出完了: 14件");
});
