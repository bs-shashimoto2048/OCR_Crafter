// DashboardView「プロジェクト一覧」のレンダリング回帰テスト（カードビュー）。
// カード構成（ヘッダー/品質情報/進捗/クイックアクション/フッター）・Gridレスポンシブ・
// Health Badge・Exact Match非表示条件・削除の「・・・」メニュー分離・検索・ソート・行クリックを検証する。
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
        best_exact_match: null,
        benchmark_count: 0,
        latest_benchmark: null,
        active_job_type: "",
        all_models_archived: false,
        has_candidate_or_above: false,
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
        best_exact_match: 92.34,
        benchmark_count: 7,
        latest_benchmark: { benchmark_id: "BM-0007", balance_score: 96.2, p95_ms: 42.0, completed_at: "2026-07-23T09:00:00" },
        active_job_type: "",
        all_models_archived: false,
        has_candidate_or_above: true,
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
        best_exact_match: null,
        benchmark_count: 0,
        latest_benchmark: null,
        active_job_type: "",
        all_models_archived: false,
        has_candidate_or_above: false,
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

test("カード表示: プロジェクト件数分のカード(role=button)が描画される", () => {
  const html = render();
  const cardCount = (html.match(/role="button"/g) || []).length;
  assert.equal(cardCount, 3);
});

test("Gridレスポンシブ: 既定1列・1100px以上2列・1920px以上3列のクラスを持つ", () => {
  const html = render();
  assert.ok(html.includes("grid-cols-1"));
  assert.ok(html.includes("min-[1100px]:grid-cols-2"));
  assert.ok(html.includes("min-[1920px]:grid-cols-3"));
});

test("2段表示: プロジェクト名とテンプレート名を表示する", () => {
  const html = render();
  assert.ok(html.includes("cursive"));
  assert.ok(html.includes("tube_20260710"));
  assert.ok(html.includes("銘板OCR"));
  // テンプレート記録が無いプロジェクトは既存仕様どおり「記録なし」
  assert.ok(html.includes("記録なし"));
});

test("Health Badge: Production+Benchmark+CER+Candidate以上ありはExcellent、未評価はNeeds Review、画像0件はIncomplete", () => {
  const html = render();
  assert.ok(html.includes("Excellent")); // tube_20260710
  assert.ok(html.includes("Needs Review")); // cursive（評価未実施）
  assert.ok(html.includes("Incomplete")); // empty_proj（画像なし）
});

test("Production表示: 存在すれば管理No、存在しなければ表示しない", () => {
  const html = render();
  assert.ok(html.includes("M0009"));
  // 検索欄のプレースホルダーにも「Production」の語が含まれるため、カード内表示は専用クラスで判定する
  const productionLineMarker = 'text-emerald-300">Production</span>';
  assert.ok(html.includes(productionLineMarker));
  const soloHtml = render({
    projects: ["cursive"],
    projectSummaries: { cursive: baseProps().projectSummaries.cursive },
  });
  assert.ok(!soloHtml.includes(productionLineMarker));
});

test("Best CER表示: 0.91%形式、記録なしは—", () => {
  const html = render();
  assert.ok(html.includes("0.91%"));
  assert.ok(html.includes("—"));
});

test("Exact Match表示: 記録があれば%表示、未記録の行には表示しない（推測補完しない）", () => {
  const html = render();
  assert.ok(html.includes("92.34%"));
  const exactMatchLabelCount = (html.match(/Exact Match/g) || []).length;
  // 3プロジェクト中、記録があるのはtube_20260710のみ
  assert.equal(exactMatchLabelCount, 1);
});

test("Benchmark性能表示: Balance Score・P95・実施回数を表示し、未実施は単なる—を使わず「未実施」と表示する", () => {
  const html = render();
  assert.ok(html.includes("96.2")); // tube_20260710のBalance Score
  assert.ok(html.includes("42 ms")); // P95
  assert.ok(html.includes("7回")); // 実施回数
  assert.ok(html.includes("未実施")); // cursive/empty_projはlatest_benchmarkなし
});

test("サムネイル表示: img要素またはEmptyStateアイコン(⊘)がカードごとに描画される", () => {
  const html = render();
  const imgCount = (html.match(/<img/g) || []).length;
  const emptyIconCount = (html.match(/⊘/g) || []).length;
  assert.ok(imgCount + emptyIconCount >= 3);
});

test("Progress表示: 現在の工程と%を表示する", () => {
  const html = render();
  assert.ok(html.includes("現在の工程:"));
  assert.ok(html.includes("%"));
});

test("クイックアクション: 開く/学習/評価/Benchmark/Reportのアイコンボタンを表示し、削除はクイックアクションに含まれない", () => {
  const html = render();
  for (const label of ["開く", "学習", "評価", "Benchmark", "Report"]) {
    assert.ok(html.includes(`aria-label="tube_20260710 を${label}へ"`), label);
  }
  // 削除は「・・・」メニューへ分離済み（クイックアクションの並びには存在しない。誤操作防止のため）
  assert.ok(!html.includes('aria-label="tube_20260710 を削除へ"'));
  // 「・・・」メニューの開閉ボタン自体は常に描画される
  assert.ok(html.includes('aria-label="tube_20260710 のその他の操作"'));
});

test("クイックアクション: Benchmarkボタンのツールチップへ最新結果または未実施の案内を表示する", () => {
  const html = render();
  assert.ok(html.includes('title="最新Benchmark: Balance 96.2 / P95 42 ms"')); // tube_20260710
  assert.ok(html.includes('title="Benchmarkはまだ実施されていません"')); // cursive/empty_proj
});

test("Health Badge: ツールチップへ判定根拠（reasons）を表示する", () => {
  const html = render();
  // cursive（Good想定: 評価未実施ではなくCERありのケースは別途libテストで検証済み。ここではフッターのtitleにHealthラベル+理由が入ることを確認）
  assert.ok(html.includes("Excellent\nProductionモデルがあります。"));
});

test("クイックアクションの有効/disabled: モデル0件は評価・Reportがdisabled、画像0件はBenchmarkもdisabled", () => {
  const html = render();
  const evaluateMatch = html.match(/disabled=""\s*aria-label="empty_proj を評価へ"/);
  assert.ok(evaluateMatch, "empty_proj evaluate should be disabled");
  const benchmarkMatch = html.match(/disabled=""\s*aria-label="empty_proj をBenchmarkへ"/);
  assert.ok(benchmarkMatch, "empty_proj benchmark should be disabled");
});

test("行クリック: カードはrole=buttonでTab移動・Enter/Space対応の属性を持つ", () => {
  const html = render();
  assert.ok(html.includes('role="button"'));
  assert.ok(html.includes('tabindex="0"') || html.includes('tabIndex="0"'));
  assert.ok(html.includes("プロジェクト tube_20260710 を開く"));
});

test("ソート: 更新日時・画像・ラベル・モデル・CER・Benchmark・進捗・Healthの並び替え項目を持つ", () => {
  const html = render();
  for (const label of ["更新日時", "画像", "ラベル", "モデル", "CER", "Benchmark", "進捗", "Health"]) {
    assert.ok(html.includes(`>${label}</option>`), label);
  }
});

test("検索: プレースホルダーにテンプレート・Production・状態・Healthを含む（既存の検索欄は維持）", () => {
  const html = render();
  assert.ok(html.includes("テンプレート・Production・状態・Health"));
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

test("回帰: テンプレート無し・Production無し・Benchmark無し・CER無し・Exact Match無しでもクラッシュしない", () => {
  const html = render({
    projectSummaries: {
      solo: {
        images: 3,
        labeled: 1,
        ocr_confirmed: 0,
        models: 1,
        image_stage: "processed",
        updated_at: null,
        sample_image: "",
        production_model: "",
        production_model_id: "",
        best_cer: null,
        best_cer_source: "",
        best_exact_match: null,
        benchmark_count: 0,
        latest_benchmark: null,
        active_job_type: "",
        all_models_archived: false,
        has_candidate_or_above: false,
      },
    },
    projects: ["solo"],
    projectId: "solo",
    templateRecords: {},
  });
  assert.ok(html.includes("solo"));
});

test("回帰: プロジェクト0件は大きな「新規プロジェクトを作成」ボタンを中央表示する", () => {
  const html = render({ projects: [], projectSummaries: {}, projectId: "" });
  assert.ok(html.includes("プロジェクトがありません"));
  assert.ok(html.includes("新規プロジェクトを作成"));
});
