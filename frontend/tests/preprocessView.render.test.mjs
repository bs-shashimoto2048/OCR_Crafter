// 前処理設定画面（PreprocessView / PreprocessPanel）のレンダリング回帰テスト。
// viteのssrLoadModuleで実レンダリングし、実処理順の新構成・基本/詳細モード・検索ボックス・
// 中間画像の重複非表示・依存disabled・縦長レイアウト切替クラスを検証する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let PreprocessView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: PreprocessView } = await server.ssrLoadModule("/src/views/PreprocessView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

const DEFAULT_PARAMS = {
  ratio_threshold: 1.6,
  single_size: 64,
  wide_height: 48,
  wide_keep_ratio: true,
  illumination_enabled: false,
  illumination_method: "gaussian",
  illumination_background_size: 81,
  illumination_strength: 1.0,
  manual_mask_enabled: false,
  manual_mask_mode: "point",
  manual_mask_fill: "white",
  manual_mask_timing: "post",
  manual_mask_threshold: 80,
  threshold_type: "binary",
  threshold_value: 128,
  threshold_block_size: 35,
  threshold_c: 11,
  clahe_clip_limit: 1.0,
  clahe_tile_grid_size: 2,
  sharpen_enabled: true,
  sharpen_amount: 0.2,
  sharpen_sigma: 0.5,
  gamma_enabled: false,
  gamma_value: 1.0,
  morph_enabled: false,
  morph_method: "close",
  morph_ksize: 3,
  morph_iterations: 1,
  unsharp_enabled: false,
  unsharp_amount: 0.8,
  unsharp_radius: 1.0,
  unsharp_threshold: 0,
  bilateral_enabled: false,
  bilateral_diameter: 5,
  bilateral_sigma_color: 50,
  bilateral_sigma_space: 50,
  local_contrast_enabled: false,
  local_contrast_clip_limit: 2.0,
  local_contrast_tile_grid_size: 8,
  crop_margin_enabled: false,
  crop_margin_threshold: 245,
  crop_margin_margin: 2,
  hist_equalize_enabled: false,
  stroke_boost_enabled: true,
  stroke_boost_method: "close",
  stroke_boost_ksize: 1,
  stroke_boost_iterations: 1,
  denoise_method: "gaussian",
  denoise_ksize: 1,
  deskew_enabled: true,
};

function renderView({ params = DEFAULT_PARAMS, preview = null, uiState } = {}) {
  return renderToString(
    React.createElement(PreprocessView, {
      projectId: "p",
      imageVersion: 0,
      images: [{ image: "a.png", type: "wide" }],
      selectedImage: "a.png",
      onSelectImage: noop,
      defaultParams: DEFAULT_PARAMS,
      params,
      onParamsChange: noop,
      preview,
      loading: false,
      error: "",
      predictEngine: "tesseract",
      setPredictEngine: noop,
      predictModel: "latest",
      setPredictModel: noop,
      predictPaddleModel: "latest",
      setPredictPaddleModel: noop,
      predictTesseractModel: "latest",
      setPredictTesseractModel: noop,
      predictModelType: "square",
      setPredictModelType: noop,
      predictEasyOcrLangs: ["en"],
      setPredictEasyOcrLangs: noop,
      predictIncludeLowercase: true,
      setPredictIncludeLowercase: noop,
      easyocrLanguageOptions: ["en"],
      modelTypes: [],
      models: [],
      paddleModels: [],
      tesseractModels: [],
      latestModels: {},
      presetName: "",
      setPresetName: noop,
      presets: {},
      selectedPreset: "",
      setSelectedPreset: noop,
      onSavePreset: noop,
      onLoadPreset: noop,
      uiState: uiState || { mode: "advanced", openSections: ["input", "brightness", "threshold"] },
      onUiStateChange: noop,
      predictPsm: 7,
      setPredictPsm: noop,
      predictWhitelist: "",
      setPredictWhitelist: noop,
    })
  );
}

// SSR出力のテキストノード間コメント（<!-- -->）を除去して文字列比較を安定させる
function plain(html) {
  return html.replaceAll("<!-- -->", "");
}

// 項目見出し（Item内のラベル）に限定した存在判定（セクション注記の文言と衝突させない）
function hasItemLabel(html, label) {
  return html.includes(`text-blue-300">${label}</p>`);
}

test("実処理順のセクション構成と旧カテゴリの廃止", () => {
  const html = renderView();
  for (const title of ["入力・分岐", "明るさ・コントラスト", "鮮明化", "二値化", "マスク・形状補正", "出力整形", "OCR結果確認", "プリセット"]) {
    assert.ok(html.includes(title), `セクション「${title}」がない`);
  }
  // セクション順は data-section 属性で判定（本文・注記の文言に依存しない）
  const order = ["input", "brightness", "sharpness", "threshold", "shape", "output", "ocr", "preset"];
  let last = -1;
  for (const id of order) {
    const index = html.indexOf(`data-section="${id}"`);
    assert.ok(index > last, `セクション順が実処理順でない: ${id}（index=${index}）`);
    last = index;
  }
  // 曖昧な旧カテゴリ名は廃止
  for (const legacy of ["その他（詳細設定）", "鮮明化・補正", "推論設定"]) {
    assert.ok(!html.includes(legacy), `旧カテゴリ「${legacy}」が残っている`);
  }
});

test("基本モードと詳細モード: 詳細項目（掠れ補正等）は基本で非表示・値は失われない設計（同一params）", () => {
  const advanced = renderView({ uiState: { mode: "advanced", openSections: ["shape", "sharpness"] } });
  const basic = renderView({ uiState: { mode: "basic", openSections: ["shape", "sharpness"] } });
  assert.ok(hasItemLabel(advanced, "掠れ補正"));
  assert.ok(!hasItemLabel(basic, "掠れ補正"), "基本モードで詳細項目が表示されている");
  assert.ok(hasItemLabel(basic, "オープン/クローズ処理"), "基本モードの主要項目が消えている");
  // 鮮明化セクション（全項目が詳細）は基本モードで丸ごと非表示
  assert.ok(!basic.includes('data-section="sharpness"'), "基本モードで鮮明化セクションが残っている");
  // モード切替ボタン
  assert.ok(basic.includes("基本") && basic.includes("詳細"));
});

test("設定検索ボックスと見出しのON/OFF・変更バッジ・wide/single対象表示", () => {
  const html = plain(renderView({ params: { ...DEFAULT_PARAMS, threshold_value: 90, illumination_enabled: true } }));
  assert.ok(html.includes("設定を検索"), "検索ボックスがない");
  assert.ok(html.includes("●変更済み"), "変更済み表示がない");
  assert.ok(html.includes("変更1件"), "セクション見出しの変更件数がない");
  assert.ok(html.includes("wide画像のみ"), "対象種別ラベルがない");
  assert.ok(html.includes("すべてリセット"), "すべてリセットがない");
  assert.ok(html.includes(">リセット</button>"), "セクションリセットがない");
});

test("二値化の依存関係: Otsu選択時はしきい値スライダーがdisabled・adaptive選択時のみblock/C表示", () => {
  const otsu = renderView({ params: { ...DEFAULT_PARAMS, threshold_type: "otsu" }, uiState: { mode: "advanced", openSections: ["threshold"] } });
  assert.ok(/max="255"[^>]*disabled/.test(otsu) || /disabled[^>]*max="255"/.test(otsu), "Otsu選択時にしきい値がdisabledでない");
  assert.ok(!otsu.includes("block size"), "Otsu選択時にadaptiveパラメータが表示されている");
  const adaptive = renderView({ params: { ...DEFAULT_PARAMS, threshold_type: "adaptive" }, uiState: { mode: "advanced", openSections: ["threshold"] } });
  assert.ok(adaptive.includes("block size"), "adaptive選択時にblock sizeがない");
  assert.ok(adaptive.includes("なし（二値化しない）"), "二値化なしの選択肢がない");
});

test("中間画像の重複非表示: 最終と同一なら出さず、異なる場合のみ「中間画像を表示」", () => {
  const same = renderView({ preview: { type: "wide", ratio: 4.8, interim_data_url: "data:x", processed_data_url: "data:x" } });
  assert.ok(!same.includes("中間画像"), "同一なのに中間画像が表示されている");
  assert.ok(same.includes("処理後画像"), "処理後画像がない");
  const diff = renderView({ preview: { type: "wide", ratio: 4.8, interim_data_url: "data:a", processed_data_url: "data:b" } });
  assert.ok(diff.includes("中間画像を表示"), "差分ありで中間画像トグルがない");
});

test("レイアウト: 縦長=縦積み・2カラム/3カラムの切替クラスとプレビュー最小幅", () => {
  const html = renderView();
  assert.ok(html.includes("grid-cols-1"), "縦積み既定がない");
  assert.ok(html.includes("min-[1024px]:grid-cols-[minmax(180px,230px)_minmax(420px,1fr)]"), "2カラム定義（プレビュー最小420px）がない");
  assert.ok(html.includes("min-[1280px]:grid-cols-[minmax(180px,18fr)_minmax(440px,45fr)_minmax(340px,37fr)]"), "3カラム定義（プレビュー最小440px）がない");
  assert.ok(html.includes("min-[1280px]:h-[calc(100vh-238px)]"), "3カラム時のビューポート内固定がない");
  // 2カラム時は設定パネルが下段全幅（col-span-2）・3カラム時は右列へ戻る
  assert.ok(html.includes("min-[1024px]:col-span-2") && html.includes("min-[1280px]:col-span-1"), "設定パネルの列スパン切替がない");
});

test("OCR結果確認: 名称変更・PSM/Whitelist入力・前処理でない旨の注記", () => {
  const html = renderView();
  assert.ok(html.includes("OCR結果確認"));
  assert.ok(html.includes("PSM"));
  assert.ok(html.includes("Whitelist"));
  assert.ok(html.includes("前処理のパラメータではありません"));
});

test("手動マスク: 前段/後段の適用位置が明示される", () => {
  const html = renderView({ uiState: { mode: "advanced", openSections: ["shape"] } });
  assert.ok(html.includes("前段マスク（二値化より前に適用）"));
  assert.ok(html.includes("後段マスク（二値化の後に適用）"));
});
