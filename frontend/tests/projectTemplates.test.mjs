// プロジェクトテンプレート定義・適用ロジックのテスト
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROJECT_TEMPLATES,
  PROJECT_TEMPLATE_STORAGE_KEY,
  applyTemplatePreprocess,
  getTemplateById,
  readTemplateRecords,
  recordProjectTemplate,
  templateOriginLabel,
} from "../src/config/projectTemplates.js";

function memoryStorage() {
  const store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
  };
}

const DEFAULTS = { threshold_type: "binary", threshold_value: 128, illumination_enabled: false, deskew_enabled: true, local_contrast_enabled: false };

test("テンプレートは6種類・IDが重複しない・全テンプレートにversionが存在する", () => {
  assert.equal(PROJECT_TEMPLATES.length, 6);
  const ids = PROJECT_TEMPLATES.map((t) => t.id);
  assert.deepEqual(ids, ["standard", "alphanumeric-ocr", "japanese-ocr", "nameplate-ocr", "handwritten-ocr", "ocr-yolo"]);
  assert.equal(new Set(ids).size, ids.length, "テンプレートIDが重複している");
  for (const t of PROJECT_TEMPLATES) {
    assert.ok(Number.isInteger(t.version) && t.version >= 1, `${t.id} にversionがない`);
    assert.ok(t.name && t.description, `${t.id} に表示名/説明がない`);
  }
});

test("標準プロジェクトは従来設定と同等（前処理上書きなし）", () => {
  const standard = getTemplateById("standard");
  assert.deepEqual(standard.preprocessOverrides, {});
  const applied = applyTemplatePreprocess(DEFAULTS, standard);
  assert.deepEqual(applied, DEFAULTS); // 従来の標準設定とまったく同じ
});

test("テンプレート適用後の設定が正しい（部分上書き・元defaultsは不変）", () => {
  const nameplate = getTemplateById("nameplate-ocr");
  const applied = applyTemplatePreprocess(DEFAULTS, nameplate);
  assert.equal(applied.illumination_enabled, true); // 照明ムラ補正 有効
  assert.equal(applied.local_contrast_enabled, true); // コントラスト補正 有効
  assert.equal(applied.threshold_type, "none"); // 二値化は過剰適用しない
  assert.equal(applied.deskew_enabled, true); // 未指定キーは既定値のまま
  assert.equal(DEFAULTS.illumination_enabled, false); // 元オブジェクトは変更されない
  // 適用後も通常のオブジェクト=設定変更可能（固定しない）
  applied.threshold_type = "otsu";
  assert.equal(applied.threshold_type, "otsu");
});

test("不明なtemplateIdは標準設定へ安全にフォールバックする", () => {
  assert.equal(getTemplateById("unknown-id").id, "standard");
  assert.equal(getTemplateById("").id, "standard");
  assert.equal(getTemplateById(undefined).id, "standard");
});

test("テンプレート記録: templateId/templateVersionをプロジェクト別に保存・既存プロジェクトへ影響しない", () => {
  const storage = memoryStorage();
  recordProjectTemplate("proj_a", getTemplateById("nameplate-ocr"), storage, "2026-07-23T12:00:00Z");
  const records = readTemplateRecords(storage);
  assert.deepEqual(records.proj_a, {
    templateId: "nameplate-ocr",
    templateVersion: 1,
    templateName: "銘板OCR",
    appliedAt: "2026-07-23T12:00:00Z",
  });
  // 別プロジェクトの記録追加が既存の記録を変更しない
  recordProjectTemplate("proj_b", getTemplateById("standard"), storage, "t2");
  const after = readTemplateRecords(storage);
  assert.equal(after.proj_a.templateId, "nameplate-ocr");
  assert.equal(after.proj_b.templateId, "standard");
  // 記録のないプロジェクト（既存プロジェクト）はundefined=影響なし
  assert.equal(after.legacy_project, undefined);
});

test("プロジェクト情報表示: テンプレート名/標準設定/記録なし", () => {
  assert.deepEqual(templateOriginLabel({ templateId: "nameplate-ocr", templateVersion: 1, templateName: "銘板OCR" }), {
    origin: "銘板OCR",
    version: "1",
  });
  assert.deepEqual(templateOriginLabel({ templateId: "standard", templateVersion: 1, templateName: "標準プロジェクト" }), {
    origin: "標準設定",
    version: "1",
  });
  assert.deepEqual(templateOriginLabel(null), { origin: "記録なし", version: "" }); // 既存プロジェクト
  assert.equal(readTemplateRecords(null) && typeof readTemplateRecords(null), "object"); // SSR安全
  assert.equal(PROJECT_TEMPLATE_STORAGE_KEY, "ocr_project_template_by_project_v1");
});

test("各テンプレートの主要初期設定（仕様どおり）", () => {
  const alnum = getTemplateById("alphanumeric-ocr");
  assert.equal(alnum.recommendedEngine, "tesseract");
  assert.ok(alnum.characterSet.includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ") && alnum.characterSet.includes("abcdefghijklmnopqrstuvwxyz") && alnum.characterSet.includes("0123456789"));
  assert.equal(alnum.recommended.psm, 7);
  assert.equal(alnum.recommended.caseSensitive, true);
  assert.equal(alnum.recommended.evaluation.exactMatchEnabled, true);
  assert.ok(!/[ぁ-んァ-ン一-龥]/.test(alnum.characterSet), "英数字テンプレに日本語文字が含まれている");

  const japanese = getTemplateById("japanese-ocr");
  assert.equal(japanese.recommendedEngine, "paddleocr");
  assert.equal(japanese.recommended.evaluation.primary, "cer");
  assert.equal(japanese.preprocessOverrides.threshold_type, "none");

  const handwritten = getTemplateById("handwritten-ocr");
  assert.equal(handwritten.recommendedEngine, "tesseract");
  assert.equal(handwritten.preprocessOverrides.deskew_enabled, true); // 回転補正
  assert.equal(handwritten.preprocessOverrides.threshold_type, "otsu"); // 過度な二値化を避ける
  assert.equal(handwritten.recommended.caseSensitive, true);
  assert.ok(handwritten.recommended.augmentation.includes("弱"));

  const yolo = getTemplateById("ocr-yolo");
  assert.equal(yolo.yoloEnabled, true);
  assert.ok(yolo.recommended.workflow.includes("YOLO検出"));
  assert.equal(getTemplateById("nameplate-ocr").yoloEnabled, false);
});
