// 学習画像作成 Step2（YOLO検出）のモデル選択・結果表示ロジック（lib/detectModel.js）のテスト
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModelValue,
  canDetectWithModel,
  extractDetectErrorDetail,
  findModelBySource,
  findModelInfo,
  formatDetectFailureMessage,
  formatDetectResultMessage,
  formatMillisAsSeconds,
  groupModelsBySource,
  isModelMissing,
  modelSourceCardLabel,
  modelSourceLabel,
  parseModelValue,
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

test("modelSourceLabel: 取得元の短い表示名（不明はフォールバック）", () => {
  assert.equal(modelSourceLabel("project"), "プロジェクト");
  assert.equal(modelSourceLabel("common"), "共通");
  assert.equal(modelSourceLabel("builtin"), "標準");
  assert.equal(modelSourceLabel("path"), "パス指定");
  assert.equal(modelSourceLabel(null), "不明");
  assert.equal(modelSourceLabel("unexpected"), "不明");
});

test("modelSourceCardLabel: 情報カード用の説明的表示名", () => {
  assert.equal(modelSourceCardLabel("project"), "プロジェクトモデル");
  assert.equal(modelSourceCardLabel("common"), "共通モデル");
  assert.equal(modelSourceCardLabel("builtin"), "Ultralytics標準モデル");
  assert.equal(modelSourceCardLabel(undefined), "不明");
});

test("findModelInfo: 名前で取得元情報を引く（無ければnull）", () => {
  const models = [
    { name: "a.pt", source: "project", path: "data/projects/p/models/yolo/a.pt" },
    { name: "b.pt", source: "common", path: "models/yolo/b.pt" },
  ];
  assert.deepEqual(findModelInfo("b.pt", models), models[1]);
  assert.equal(findModelInfo("c.pt", models), null);
  assert.equal(findModelInfo("a.pt", null), null);
  assert.equal(findModelInfo("", models), null);
});

test("formatMillisAsSeconds: ミリ秒を秒表示へ整形（不明は--）", () => {
  assert.equal(formatMillisAsSeconds(720), "0.72秒");
  assert.equal(formatMillisAsSeconds(0), "0.00秒");
  assert.equal(formatMillisAsSeconds(1543), "1.54秒");
  assert.equal(formatMillisAsSeconds(null), "--");
  assert.equal(formatMillisAsSeconds("abc"), "--");
});

test("buildModelValue / parseModelValue: 取得元と名前の往復（旧形式はsource未確定）", () => {
  assert.equal(buildModelValue("common", "a.pt"), "common|a.pt");
  assert.deepEqual(parseModelValue("common|a.pt"), { source: "common", name: "a.pt" });
  assert.deepEqual(parseModelValue("a.pt"), { source: "", name: "a.pt" });
  assert.deepEqual(parseModelValue(""), { source: "", name: "" });
});

test("groupModelsBySource: 取得元ごとにグループ化する", () => {
  const models = [
    { name: "p.pt", source: "project" },
    { name: "c.pt", source: "common" },
    { name: "b.pt", source: "builtin", downloaded: false },
    { name: "x.pt", source: "unexpected" },
  ];
  const groups = groupModelsBySource(models);
  assert.equal(groups.project.length, 1);
  assert.equal(groups.common.length, 1);
  assert.equal(groups.builtin.length, 1);
  assert.deepEqual(groupModelsBySource(null), { project: [], common: [], builtin: [] });
});

test("findModelBySource: 同名でも指定した取得元の行を返す", () => {
  const models = [
    { name: "dup.pt", source: "project" },
    { name: "dup.pt", source: "common" },
  ];
  assert.equal(findModelBySource(models, "common", "dup.pt").source, "common");
  assert.equal(findModelBySource(models, "builtin", "dup.pt"), null);
  assert.equal(findModelBySource(models, "", "dup.pt"), null);
});

test("canDetectWithModel: 標準モデルは取得済みのときだけ使用可能", () => {
  assert.equal(canDetectWithModel({ source: "builtin", downloaded: true }), true);
  assert.equal(canDetectWithModel({ source: "builtin", downloaded: false }), false);
  assert.equal(canDetectWithModel({ source: "project" }), true);
  assert.equal(canDetectWithModel({ source: "common" }), true);
  assert.equal(canDetectWithModel(null), false);
});
