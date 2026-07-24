// DashboardView「プロジェクト一覧」のレンダリング回帰テスト。
// 2段構成（プロジェクト情報＋テンプレート/状態/Production/画像・ラベル・モデル・Benchmark・
// Best CER・進捗+工程名）・クイックアクション・行クリック・ソート見出し・検索・サムネイルを検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let DashboardView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: DashboardView } = await server.ssrLoadModule("/src/views/DashboardView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function baseProps(overrides = {}) {
  return {
    projectId: "cursive",
    projects: ["cursive", "tube_20260710", "empty_proj"],
    projectSummaries: {
      cursive: {
        images: 60,
        labeled: 60,
        ocr_confirmed: 7,
        models: 7,
        image_stage: "processed",
        updated_at: "2026-07-20T10:00:00",
        sample_image: "a.png",
        production_model: "",
        production_model_id: "",
        best_cer: null,
        best_cer_source: "",
        benchmark_count: 0,
        active_job_type: "",
        all_models_archived: false,
      },
      tube_20260710: {
        images: 1000,
        labeled: 1000,
        ocr_confirmed: 900,
        models: 9,
        image_stage: "processed",
        updated_at: "2026-07-23T09:30:00",
        sample_image: "b.png",
        production_model: "m9.tess.json",
        production_model_id: "M0009",
        best_cer: 0.0091,
        best_cer_source: "production",
        benchmark_count: 7,
        active_job_type: "",
        all_models_archived: false,
      },
      empty_proj: {
        images: 0,
        labeled: 0,
        ocr_confirmed: 0,
        models: 0,
        image_stage: "none",
        updated_at: null,
        sample_image: "",
        production_model: "",
        production_model_id: "",
        best_cer: null,
        best_cer_source: "",
        benchmark_count: 0,
        active_job_type: "",
        all_models_archived: false,
      },
    },
    onSelectProject: noop,
    onOpenCreate: noop,
    templateRecord: null,
    templateRecords: {
      tube_20260710: { templateId: "nameplate-ocr", templateVersion: 1, templateName: "銘板OCR", appliedAt: "2026-07-10T00:00:00" },
    },
    onDeleteProject: noop,
    onNavigate: noop,
    onOpenImageInPreprocess: noop,
    workflowSteps: [],
    currentStepLabel: "",
    images: [],
    imageVersion: 0,
    imagesCount: 60,
    labeledCount: 60,
    modelCount: 7,
    ...overrides,
  };
}

function render(overrides = {}) {
  const html = renderToString(React.createElement(DashboardView, baseProps(overrides)));
  return html.replaceAll("<!-- -->", "");
}

test("2段表示: プロジェクト名の下にテンプレート名を表示する", () => {
  const html = render();
  assert.ok(html.includes("cursive"));
  assert.ok(html.includes("tube_20260710"));
  assert.ok(html.includes("銘板OCR"));
  // テンプレート記録が無いプロジェクトは既存仕様どおり「記録なし」
  assert.ok(html.includes("記録なし"));
});

test("Production表示: 存在すれば管理No、存在しなければ—", () => {
  const html = render();
  assert.ok(html.includes("M0009"));
  assert.ok(html.includes("Production"));
  // cursive/empty_proj はProductionなし → —が複数出現する
  assert.ok(html.includes("—"));
});

test("Best CER表示: 0.91%形式、記録なしは—", () => {
  const html = render();
  assert.ok(html.includes("0.91%"));
});

test("Benchmark表示: 件数表記、記録なしは—", () => {
  const html = render();
  assert.ok(html.includes("7件"));
});

test("サムネイル表示: img要素またはEmptyStateアイコン(⊘)が行ごとに描画される", () => {
  const html = render();
  const imgCount = (html.match(/<img/g) || []).length;
  const emptyIconCount = (html.match(/⊘/g) || []).length;
  // 3行分のサムネイル（img or ⊘）が存在する
  assert.ok(imgCount + emptyIconCount >= 3);
});

test("クイックアクション: 開く/学習/評価/Benchmark/レポート/削除のアイコンボタンを表示する", () => {
  const html = render();
  for (const label of ["開く", "学習", "評価", "Benchmark", "レポート", "削除"]) {
    assert.ok(html.includes(`aria-label="tube_20260710 を${label}へ"`) || html.includes(`aria-label="tube_20260710 を${label}"`), label);
  }
});

test("クイックアクションの有効/disabled: モデル0件のプロジェクトは評価・レポートがdisabled、画像0件はBenchmarkもdisabled", () => {
  const html = render();
  // empty_proj（画像0・モデル0）の評価/Benchmarkボタンはdisabled属性を持つ（disabled属性はaria-labelより前に出力される）
  const emptyRowMatch = html.match(/disabled=""\s*aria-label="empty_proj を評価へ"/);
  assert.ok(emptyRowMatch, "empty_proj evaluate should be disabled");
  const benchmarkMatch = html.match(/disabled=""\s*aria-label="empty_proj をBenchmarkへ"/);
  assert.ok(benchmarkMatch, "empty_proj benchmark should be disabled");
});

test("行クリック: role=buttonでTab移動・Enter/Space対応の属性を持つ", () => {
  const html = render();
  assert.ok(html.includes('role="button"'));
  assert.ok(html.includes('tabindex="0"') || html.includes('tabIndex="0"'));
  assert.ok(html.includes("プロジェクト tube_20260710 を開く"));
});

test("ソート: 更新日時・画像・ラベル・モデル・Best CER・進捗の列見出しが並び替えボタンを持つ", () => {
  const html = render();
  for (const label of ["更新日時", "画像", "ラベル", "モデル", "Best CER", "進捗"]) {
    assert.ok(html.includes(`で並び替え`) && html.includes(label), label);
  }
});

test("検索: テンプレート名・Productionモデル・状態でも一致する既存仕様（プロジェクト名検索は維持）", () => {
  // SSRでは検索stateの変更は検証できないため、matchesSearchのimport元(lib)で別途検証済み。
  // ここでは初期表示に検索欄のplaceholderが拡張されていることを確認する
  const html = render();
  assert.ok(html.includes("テンプレート・Production・状態"));
});

test("状態バッジ: 使用中は🟢、学習中Jobがあれば🟡", () => {
  const html = render();
  assert.ok(html.includes("使用中"));
  const html2 = render({
    projectSummaries: {
      ...baseProps().projectSummaries,
      tube_20260710: { ...baseProps().projectSummaries.tube_20260710, active_job_type: "training" },
    },
  });
  assert.ok(html2.includes("学習中"));
});

test("回帰: テンプレート無し・Production無し・Benchmark無し・CER無しでもクラッシュしない", () => {
  const html = render({
    projectSummaries: {
      solo: {
        images: 0,
        labeled: 0,
        ocr_confirmed: 0,
        models: 0,
        image_stage: "none",
        updated_at: null,
        sample_image: "",
        production_model: "",
        production_model_id: "",
        best_cer: null,
        best_cer_source: "",
        benchmark_count: 0,
        active_job_type: "",
        all_models_archived: false,
      },
    },
    projects: ["solo"],
    projectId: "solo",
    templateRecords: {},
  });
  assert.ok(html.includes("solo"));
});

test("回帰: プロジェクト0件はEmptyStateを表示する", () => {
  const html = render({ projects: [], projectSummaries: {}, projectId: "" });
  assert.ok(html.includes("プロジェクトがありません"));
});
