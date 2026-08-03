// ModelsView（モデル一覧＋右ペイン）のレンダリング回帰テスト。
// viteのssrLoadModuleで実際にレンダリングし、一覧の簡素化（比較バッジ削除）と
// 左右レイアウト（右ペイン最低幅・縦積み切替）のクラス構成を検証する。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let ModelsView;
let MODEL_LIST_GRID_COLUMNS;

let fallbackDownloadName;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: ModelsView, MODEL_LIST_GRID_COLUMNS, fallbackDownloadName } = await server.ssrLoadModule(
    "/src/views/ModelsView.jsx"
  ));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

// バッジ判定が発生する評価履歴（model_aがCER最良→Best CER/Recommended等の対象になる）
const EVAL_HISTORY = {
  "model_a.tess.json": {
    ds: { percent: 40, at: "2026-07-17T10:00:00Z", cer: 0.1, char_accuracy: 0.9, regressed: 10 },
  },
  "model_b.tess.json": {
    ds: { percent: 30, at: "2026-07-17T10:00:00Z", cer: 0.2, char_accuracy: 0.8, regressed: 20 },
  },
};

function baseProps(overrides = {}) {
  return {
    projectId: "testproj",
    models: ["model_a.tess.json", "model_b.tess.json"],
    modelInfos: {
      "model_a.tess.json": { model_id: "M0001", engine: "tesseract", training_family: "tesseract", created_at: "2026-07-15T10:00:00" },
      "model_b.tess.json": { model_id: "M0002", engine: "tesseract", training_family: "tesseract", created_at: "2026-07-16T10:00:00" },
    },
    latest: { any: "model_b.tess.json", byType: {} },
    onRefresh: noop,
    onDeleteSelected: noop,
    aliases: {},
    onAliasChange: noop,
    evalHistory: EVAL_HISTORY,
    inferenceInUseModel: "",
    inferenceInUseEngine: "",
    onUseForInference: noop,
    onOpenEvaluation: noop,
    ...overrides,
  };
}

test("モデル一覧: 比較・順位バッジを表示しない（管理No＋モデル名のみ）", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  // バッジ判定対象の履歴があっても、一覧（初期表示）にバッジ文言・装飾は出ない
  for (const badge of ["Best Accuracy", "Best CER", "Best Char Acc", "Recommended", "Latest Best"]) {
    assert.ok(!html.includes(badge), `一覧に比較バッジ「${badge}」が表示されている`);
  }
  for (const icon of ["🏆", "⭐", "🟢", "🔵"]) {
    assert.ok(!html.includes(icon), `一覧に順位・推奨の装飾「${icon}」が表示されている`);
  }
  // 管理Noチップとモデル名は表示される
  assert.ok(html.includes("M0001"));
  assert.ok(html.includes("M0002"));
  assert.ok(html.includes("model_a.tess.json"));
  assert.ok(html.includes("model_b.tess.json"));
});

test("状態列の「最新」ラベルは維持される", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  assert.ok(html.includes("最新"), "状態列の「最新」が消えている");
});

test("レイアウト: 右ペイン拡張の流体2カラム（1366px/1600px段階）と縦積み（未満）のクラス構成", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  // 1366〜1599px: 左1.05fr:右1fr（右≈49%） / 1600px以上: 左1.2fr:右1fr（右≈45.5%）
  assert.ok(
    html.includes("min-[1366px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"),
    "1366px以上の流体グリッド指定がない"
  );
  assert.ok(
    html.includes("min-[1600px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"),
    "1600px以上の右ペイン拡張比率がない"
  );
  // 右ペインへ固定520pxを常時強制しない
  assert.ok(!html.includes("minmax(520px"), "右ペインに固定520pxが残っている");
  // 1366px未満は1カラム（右ペインを下段へ縦積み）
  assert.ok(html.includes("grid-cols-1"), "縦積み用のgrid-cols-1がない");
  // 左右ペインの min-w-0（Flex/Grid既定のmin-width:autoで収縮不能にならない）
  assert.ok(html.includes("min-w-0"), "ペインのmin-w-0がない");
  // 右ペインは幅コンテナ（コンテナクエリの基準・min-width:0）
  assert.ok(html.includes("model-side-pane"), "右ペインのmodel-side-paneクラスがない");
});

test("比較カード・テーブルの収縮定義（index.css）: minmax(0,1fr)と横スクロール限定ラッパー", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf-8");
  // 比較カードは固定最小幅なし（minmax(0,1fr)×可変列数）＋狭い右ペインでは縦並び
  assert.ok(css.includes("repeat(var(--cols, 3), minmax(0, 1fr))"), "比較カードのminmax(0,1fr)定義がない");
  assert.ok(/@container \(max-width: \d+px\)/.test(css), "右ペイン幅基準のコンテナクエリがない");
  assert.ok(css.includes("container-type: inline-size"), "model-side-paneのコンテナ定義がない");
  // 横スクロールはテーブルラッパー内のみに限定
  assert.ok(css.includes(".comparison-table-wrap"), "テーブル専用ラッパー定義がない");
  assert.ok(/\.comparison-table-wrap\s*\{[^}]*overflow-x: auto/.test(css), "ラッパーのoverflow-x:autoがない");
  assert.ok(/\.comparison-card\s*\{[^}]*min-width: 0/.test(css), "比較カードのmin-width:0がない");
});

test("長いモデル名は一覧で省略表示され、title属性で全文確認できる", () => {
  const longName = "tess_20260715_145027_very_long_model_name_for_truncation_check.tess.json";
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: [longName],
        modelInfos: { [longName]: { model_id: "M0009", engine: "tesseract", training_family: "tesseract", created_at: "2026-07-15T10:00:00" } },
        evalHistory: {},
      })
    )
  );
  assert.ok(html.includes(`title="${longName}"`), "モデル名のtitle（全文確認手段）がない");
  assert.ok(html.includes("truncate"), "省略表示（truncate）がない");
});

test("推論使用モデル: 一覧行に専用背景・左accentバー・「推論使用中」バッジを常時表示する", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps({ inferenceInUseModel: "model_a.tess.json" })));
  assert.ok(html.includes("推論使用中"), "「推論使用中」バッジが表示されていない");
  assert.ok(html.includes("border-l-cyan-400"), "左端のaccentバーがない");
  assert.ok(html.includes("bg-cyan-500/10"), "行の専用背景がない");
  // ModelIdChipの強調（リング）
  assert.ok(html.includes("ring-2 ring-cyan-400/70"), "管理Noの強調（リング）がない");
});

test("推論使用モデル: 非推論モデルの行には「推論使用中」バッジ・強調が付かない", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps({ inferenceInUseModel: "model_a.tess.json" })));
  // 「推論使用中」の可視バッジ（rounded-fullのcyanピル）は1件のみ描画される（行のaria-labelにも同文言が入るため、
  // ピル要素自体の出現回数をクラス名込みで数える）
  const badgeCount = (html.match(/text-cyan-200/g) || []).length;
  assert.equal(badgeCount, 1, "「推論使用中」バッジのピル要素が複数（もしくは0）描画されている");
  // 左accentバー（border-l-cyan-400）も1行分のみ
  const barCount = (html.match(/border-l-cyan-400/g) || []).length;
  assert.equal(barCount, 1, "左accentバーが複数（もしくは0）の行に付いている");
});

test("推論使用モデル: 未設定（空文字）の場合はどの行にも強調表示が付かない", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps({ inferenceInUseModel: "" })));
  assert.ok(!html.includes("推論使用中"));
  assert.ok(!html.includes("border-l-cyan-400"));
});

test("推論使用モデル: 比較選択チェックボックスと併用できる（片方の表示で上書きしない）", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps({ inferenceInUseModel: "model_a.tess.json" })));
  // 推論使用中の行にもチェックボックス（比較選択）が存在し続ける
  assert.ok(html.includes('aria-label="model_a.tess.json を比較・削除対象に選択"'));
});

// 「推論に使用」ボタンの回帰テスト（常時グレーアウト不具合修正）。
// サマリーカード（「推論使用モデル」「最新モデル」）は name プロップのみでボタンが決まるため
// SSRで検証できる唯一の箇所（一覧行には専用ボタンがなく、詳細パネルはクリック後のstateに
// 依存しSSRでは出現しない）。「最新モデル」カードの latest.any を差し替えることで、
// 「現在使用中のモデル以外」の任意モデルのボタン状態を検証する。
const THREE_MODEL_INFOS = {
  "model_a.tess.json": {
    model_id: "M0001",
    engine: "tesseract",
    training_family: "tesseract",
    created_at: "2026-07-15T10:00:00",
    ocr_inference_ready: true,
  },
  "model_b.tess.json": {
    model_id: "M0002",
    engine: "tesseract",
    training_family: "tesseract",
    created_at: "2026-07-16T10:00:00",
    ocr_inference_ready: true,
  },
  "model_c.tess.json": {
    model_id: "M0003",
    engine: "tesseract",
    training_family: "tesseract",
    created_at: "2026-07-17T10:00:00",
    ocr_inference_ready: true,
  },
};
const THREE_MODELS = ["model_a.tess.json", "model_b.tess.json", "model_c.tess.json"];

// html中の「推論に使用」「推論使用中」ボタンをDOM出現順に抽出し、disabled有無・titleを返す
function extractInferenceButtons(html) {
  const re = /<button([^>]*)>(推論に使用|推論使用中)<\/button>/g;
  const results = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const titleMatch = attrs.match(/title="([^"]*)"/);
    results.push({
      label: m[2],
      disabled: / disabled(=|>|\s)/.test(`${attrs} `),
      title: titleMatch ? titleMatch[1] : "",
    });
  }
  return results;
}

// 「最新モデル」カードのnameをtargetModelにして、そのモデル1件分のボタン状態だけを取り出す。
// 「推論使用モデル」カード（A）はshowInferenceButton=falseで切替ボタン自体を持たないため、
// 末尾（＝最新モデルカードか、initialDetailModel指定時はさらに後の詳細パネル）を採用すれば
// 常にA以外の対象を取得できる
function inferenceButtonFor(targetModel, overrides = {}) {
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: THREE_MODELS,
        modelInfos: THREE_MODEL_INFOS,
        ...overrides,
        latest: { any: targetModel, byType: {} },
      })
    )
  );
  const buttons = extractInferenceButtons(html);
  return buttons[buttons.length - 1];
}

// 2枚のサマリーカードのうち、startTitle（例:"推論使用モデル"）からendTitle（例:"最新モデル"）
// 直前までのHTML断片だけを取り出す（Aカード単独の検証用。両カードは兄弟要素として連続して
// 描画されるため、タイトル文言の間だけを切り出せばそのカードの内容に限定できる）
function extractCardHtml(html, startTitle, endTitle) {
  const start = html.indexOf(startTitle);
  const end = endTitle ? html.indexOf(endTitle, start) : -1;
  return html.slice(start, end === -1 ? html.length : end);
}

test("回帰ケース1（未設定）: ModelA・ModelBともにボタンが有効", () => {
  const a = inferenceButtonFor("model_a.tess.json", { inferenceInUseModel: "" });
  const b = inferenceButtonFor("model_b.tess.json", { inferenceInUseModel: "" });
  assert.equal(a.disabled, false, "未設定なのにModelAのボタンが無効化されている");
  assert.equal(a.label, "推論に使用");
  assert.equal(b.disabled, false, "未設定なのにModelBのボタンが無効化されている");
  assert.equal(b.label, "推論に使用");
});

test("回帰ケース2（ModelAが推論使用中）: Aカードに切替ボタンはなく、ModelB・ModelCは有効「推論に使用」", () => {
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: THREE_MODELS,
        modelInfos: THREE_MODEL_INFOS,
        inferenceInUseModel: "model_a.tess.json",
        latest: { any: "model_b.tess.json", byType: {} },
      })
    )
  );
  // Aカード（推論使用モデル）は showInferenceButton=false のため切替ボタン自体を持たない
  const cardAHtml = extractCardHtml(html, "推論使用モデル", "最新モデル");
  assert.ok(!/<button[^>]*>(推論に使用|推論使用中)<\/button>/.test(cardAHtml), "Aカードに切替ボタンが残っている");

  const [cardB] = extractInferenceButtons(html);
  assert.equal(cardB.disabled, false, "別モデルのModelBのボタンが無効化されている（誤り）");
  assert.equal(cardB.label, "推論に使用");

  const c = inferenceButtonFor("model_c.tess.json", { inferenceInUseModel: "model_a.tess.json" });
  assert.equal(c.disabled, false, "別モデルのModelCのボタンが無効化されている（誤り）");
  assert.equal(c.label, "推論に使用");
});

test("回帰ケース3（ModelBへ切替後）: Aカードに切替ボタンはなく、ModelA・ModelCは有効", () => {
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: THREE_MODELS,
        modelInfos: THREE_MODEL_INFOS,
        inferenceInUseModel: "model_b.tess.json",
        latest: { any: "model_a.tess.json", byType: {} },
      })
    )
  );
  const cardAHtml = extractCardHtml(html, "推論使用モデル", "最新モデル");
  assert.ok(!/<button[^>]*>(推論に使用|推論使用中)<\/button>/.test(cardAHtml), "Aカードに切替ボタンが残っている");

  // 最新モデルカードの対象はModelA（現在の使用中モデルはModelBなので別モデル→有効のはず）
  const [cardLatest] = extractInferenceButtons(html);
  assert.equal(cardLatest.disabled, false, "切替後、ModelAのボタンが無効化されたままになっている");
  assert.equal(cardLatest.label, "推論に使用");

  const c = inferenceButtonFor("model_c.tess.json", { inferenceInUseModel: "model_b.tess.json" });
  assert.equal(c.disabled, false, "切替後もModelCのボタンが無効化されている（誤り）");
});

test("回帰ケース4（通信中）: 残る切替ボタン（最新モデルカード）が一時無効化され、完了後は正しく復帰する", () => {
  const duringHtml = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: THREE_MODELS,
        modelInfos: THREE_MODEL_INFOS,
        inferenceInUseModel: "model_a.tess.json",
        switchingInferenceModel: true,
        latest: { any: "model_b.tess.json", byType: {} },
      })
    )
  );
  const [duringB] = extractInferenceButtons(duringHtml);
  assert.equal(duringB.disabled, true, "通信中に別モデルModelBのボタンが無効化されていない");
  assert.equal(duringB.title, "切替処理中です");

  const afterHtml = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: THREE_MODELS,
        modelInfos: THREE_MODEL_INFOS,
        inferenceInUseModel: "model_a.tess.json",
        switchingInferenceModel: false,
        latest: { any: "model_b.tess.json", byType: {} },
      })
    )
  );
  const [afterB] = extractInferenceButtons(afterHtml);
  assert.equal(afterB.disabled, false, "通信完了後にModelBのボタンが正しく復帰していない");
});

test("回帰ケース5（利用不可モデル）: 未Exportのモデルだけが無効、他モデルは有効", () => {
  const modelInfosWithUnavailable = {
    ...THREE_MODEL_INFOS,
    "model_d.tess.json": {
      model_id: "M0004",
      engine: "tesseract",
      training_family: "tesseract",
      created_at: "2026-07-18T10:00:00",
      ocr_inference_ready: false,
    },
  };
  const models = [...THREE_MODELS, "model_d.tess.json"];
  const unavailable = inferenceButtonFor("model_d.tess.json", {
    models,
    modelInfos: modelInfosWithUnavailable,
    inferenceInUseModel: "",
  });
  assert.equal(unavailable.disabled, true, "未Exportのモデルのボタンが有効になっている");
  assert.equal(unavailable.title, "モデルファイルが見つかりません（未Export）");

  const available = inferenceButtonFor("model_a.tess.json", {
    models,
    modelInfos: modelInfosWithUnavailable,
    inferenceInUseModel: "",
  });
  assert.equal(available.disabled, false, "利用可能なModelAのボタンまで無効化されている（誤り）");
});

// 「推論に使用」ボタン3か所（推論使用モデルカード=A・最新モデルカード=B・モデル詳細パネル=C）の
// 個別回帰テスト。各ボタンは自身の対象モデル（A=inferenceInUseModel自身・B=latest.any・
// C=詳細表示中のモデル）と保存済み推論使用モデルを比較する必要があり、3か所とも同じ結果に
// なってしまう誤り（例: disabled={Boolean(inferenceInUseModel)}）を防ぐことが目的。
// 詳細パネル（C）はクリックで開くまで内部stateが空でSSRには出現しないため、
// テスト専用のinitialDetailModelプロップ（本番コードでは未使用・省略時は従来どおり非表示）で開く。
test("Aカード（推論使用モデル）: 「推論使用中」ボタンを表示しない（カード自体が使用中モデルの表示のため重複操作を置かない）", () => {
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: THREE_MODELS,
        modelInfos: THREE_MODEL_INFOS,
        inferenceInUseModel: "model_a.tess.json",
        latest: { any: "model_b.tess.json", byType: {} },
      })
    )
  );
  const cardAHtml = extractCardHtml(html, "推論使用モデル", "最新モデル");
  assert.ok(
    !/<button[^>]*>(推論に使用|推論使用中)<\/button>/.test(cardAHtml),
    "Aカードに「推論使用中」/「推論に使用」ボタンが残っている"
  );
});

test("Aカード（推論使用モデル）: 使用中バッジ・モデル評価/ダウンロード/詳細ボタンは維持する", () => {
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: THREE_MODELS,
        modelInfos: THREE_MODEL_INFOS,
        inferenceInUseModel: "model_a.tess.json",
        latest: { any: "model_b.tess.json", byType: {} },
      })
    )
  );
  const cardAHtml = extractCardHtml(html, "推論使用モデル", "最新モデル");
  assert.ok(cardAHtml.includes(">使用中<"), "Aカードの使用中バッジが表示されていない");
  assert.ok(cardAHtml.includes(">モデル評価<"), "Aカードのモデル評価ボタンが消えている");
  assert.ok(cardAHtml.includes("ダウンロード"), "Aカードのダウンロードボタンが消えている");
  assert.ok(cardAHtml.includes(">詳細<"), "Aカードの詳細ボタンが消えている");
});

test("Bカード（最新モデル）: 最新モデル=現在の推論使用モデルと同一なら無効「推論使用中」", () => {
  const b = inferenceButtonFor("model_a.tess.json", { inferenceInUseModel: "model_a.tess.json" });
  assert.equal(b.label, "推論使用中", "最新モデルが現在の推論使用モデルと同じ場合のラベルが誤っている");
  assert.equal(b.disabled, true, "最新モデルが現在の推論使用モデルと同じ場合に無効化されていない");
});

test("Bカード（最新モデル）: 最新モデルが現在の推論使用モデルと異なるなら有効「推論に使用」", () => {
  const b = inferenceButtonFor("model_b.tess.json", { inferenceInUseModel: "model_a.tess.json" });
  assert.equal(b.label, "推論に使用", "最新モデルが別モデルの場合のラベルが誤っている");
  assert.equal(b.disabled, false, "最新モデルが別モデルなのに無効化されている（誤り）");
});

test("Cパネル（モデル詳細）: 使用中モデルを選択している場合は無効「推論使用中」", () => {
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: THREE_MODELS,
        modelInfos: THREE_MODEL_INFOS,
        inferenceInUseModel: "model_a.tess.json",
        latest: { any: "model_c.tess.json", byType: {} },
        initialDetailModel: "model_a.tess.json",
      })
    )
  );
  const buttons = extractInferenceButtons(html);
  const detailButton = buttons[buttons.length - 1];
  assert.equal(detailButton.label, "推論使用中", "詳細パネルで使用中モデルを選択してもラベルが誤っている");
  assert.equal(detailButton.disabled, true, "詳細パネルで使用中モデルを選択しても無効化されていない");
});

test("Cパネル（モデル詳細）: 別モデルを選択している場合は有効「推論に使用」", () => {
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: THREE_MODELS,
        modelInfos: THREE_MODEL_INFOS,
        inferenceInUseModel: "model_a.tess.json",
        latest: { any: "model_c.tess.json", byType: {} },
        initialDetailModel: "model_b.tess.json",
      })
    )
  );
  const buttons = extractInferenceButtons(html);
  const detailButton = buttons[buttons.length - 1];
  assert.equal(detailButton.label, "推論に使用", "詳細パネルで別モデルを選択してもラベルが誤っている");
  assert.equal(detailButton.disabled, false, "詳細パネルで別モデルを選択しているのに無効化されている（誤り）");
});

test("Cパネル（モデル詳細）: 選択モデルが変わるとラベル・disabledも連動して切り替わる", () => {
  const renderWithDetail = (initialDetailModel) => {
    const html = renderToString(
      React.createElement(
        ModelsView,
        baseProps({
          models: THREE_MODELS,
          modelInfos: THREE_MODEL_INFOS,
          inferenceInUseModel: "model_a.tess.json",
          latest: { any: "model_c.tess.json", byType: {} },
          initialDetailModel,
        })
      )
    );
    const buttons = extractInferenceButtons(html);
    return buttons[buttons.length - 1];
  };

  const onA = renderWithDetail("model_a.tess.json");
  const onB = renderWithDetail("model_b.tess.json");
  const onC = renderWithDetail("model_c.tess.json");

  assert.equal(onA.label, "推論使用中");
  assert.equal(onA.disabled, true);
  assert.equal(onB.label, "推論に使用");
  assert.equal(onB.disabled, false);
  assert.equal(onC.label, "推論に使用");
  assert.equal(onC.disabled, false);
});

test("3ボタンとも onClick は自身の対象モデルのみを渡す（保存済み推論使用モデルを渡さない）", async () => {
  const source = await readFile(new URL("../src/views/ModelsView.jsx", import.meta.url), "utf-8");
  // 禁止パターン: 対象モデルではなく保存済み推論使用モデル自体を渡してしまう誤り
  assert.ok(!source.includes("onUseForInference?.(inferenceInUseModel)"), "onClickがinferenceInUseModelを引数に渡している（誤り）");
  // SummaryCard（A・Bカードで共用）・詳細パネル（C）の2箇所とも、必ず自身のnameを渡している
  const correctCallSites = source.match(/onClick=\{\(\) => onUseForInference\?\.\(name\)\}/g) || [];
  assert.equal(correctCallSites.length, 2, "「推論に使用」ボタンのonClickがname引数を渡す形で2箇所（SummaryCard・詳細パネル）に無い");
});

test("3ボタンとも判定を共通関数 isInferenceModelInUse に集約している（個別に比較を書き直していない）", async () => {
  const source = await readFile(new URL("../src/views/ModelsView.jsx", import.meta.url), "utf-8");
  assert.ok(source.includes('import { isInferenceModelInUse } from "../lib/inferenceModel";'));
  // 生の比較（name === inferenceInUseModel）が残っていない＝全箇所が共通関数経由
  assert.ok(!/name === inferenceInUseModel/.test(source), "共通関数を使わない生の比較がまだ残っている");
  const usageCount = (source.match(/isInferenceModelInUse\(/g) || []).length;
  // import文1 + 呼び出し4箇所（disabledReason・statusOf・SummaryCardラベル・詳細パネルラベル・行強調）以上
  assert.ok(usageCount >= 4, `isInferenceModelInUseの利用箇所が少なすぎる（${usageCount}件）`);
});

test("一覧の列定義: モデル名に最大幅400px・ヘッダーとデータ行が同じ列定義を共有", () => {
  // 共有定数: モデル名は minmax(300px,420px) の上限付き（余った幅いっぱいまで伸ばさない）
  assert.equal(MODEL_LIST_GRID_COLUMNS, "32px minmax(300px, 420px) 80px 85px 130px 140px 140px 70px");
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  // ヘッダー1 + データ行2件 = 同じgrid-template-columnsが3回以上出現（列定義の共有）
  const needle = "minmax(300px, 420px)";
  const count = html.split(needle).length - 1;
  assert.ok(count >= 3, `列定義の共有回数が不足（${count}回）`);
  // 長いモデル名は省略表示＋title（Engine列との間に過剰な空白を作らず、列を押し広げない）
  assert.ok(html.includes("truncate"), "モデル名の省略表示がない");
});

// ---------------------------------------------------------------------------
// Engine Registry Migration（Feature: ModelsView Migration）
// Engine表示（Label/表示名/Color）・ダウンロード判定をengineRegistry.js経由へ置換したことの回帰確認。
// ---------------------------------------------------------------------------

test("一覧: Engine列は既存どおり短いラベルを表示する（見た目を変えない）", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  assert.ok(html.includes(">Tesseract<"), "Engine列のラベル表示が変わっている");
});

test("一覧: Engine列にEngineRegistry由来のtitle・data-engine-color属性を付与する（描画される文字・レイアウトは変えない）", () => {
  const html = renderToString(React.createElement(ModelsView, baseProps()));
  assert.ok(html.includes('title="Tesseract"'), "表示名（getEngineDisplayName）がtitle属性に反映されていない");
  assert.ok(html.includes('data-engine-color="sky"'), "色（getEngineColor）がdata-engine-color属性に反映されていない");
});

test("一覧: custom（分類）エンジンは短いラベル「カスタム」のまま、titleはより詳しい表示名になる", () => {
  const html = renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: ["model_a.tess.json", "cls_model.pt"],
        modelInfos: {
          "model_a.tess.json": { model_id: "M0001", engine: "tesseract", training_family: "tesseract", created_at: "2026-07-15T10:00:00" },
          "cls_model.pt": { model_id: "M0003", engine: "custom", training_family: "classification", created_at: "2026-07-17T10:00:00" },
        },
      })
    )
  );
  assert.ok(html.includes(">カスタム<"), "customの短いラベル表示が変わっている");
  assert.ok(html.includes('title="カスタム（分類）"'), "customの表示名がtitle属性に反映されていない");
});

test("fallbackDownloadName: tesseractは.tess.jsonを.traineddataへ置換する（既存挙動を維持）", () => {
  assert.equal(fallbackDownloadName("digits_20260101.tess.json", "tesseract"), "digits_20260101.traineddata");
});

test("fallbackDownloadName: paddleocr（zip）は.ocr.jsonを.inference.zipへ置換する（既存挙動を維持）", () => {
  assert.equal(fallbackDownloadName("ocr_20260101.ocr.json", "paddleocr"), "ocr_20260101.inference.zip");
});

test("fallbackDownloadName: custom（分類、.pt）はファイル名をそのまま返す（既存挙動を維持）", () => {
  assert.equal(fallbackDownloadName("digits_cnn_20260101.pt", "custom"), "digits_cnn_20260101.pt");
});

test("fallbackDownloadName: 未登録engineはファイル名をそのまま返す", () => {
  assert.equal(fallbackDownloadName("unknown_model", "unknown-engine"), "unknown_model");
});

// ---------------------------------------------------------------------------
// Engine別 表示レビュー（PR #52レビュー指摘: Major「テストカバレッジ不足」対応）
// PaddleOCR/EasyOCR/TrOCR/未登録Engine/空値について、一覧のEngine列（表示ラベル・
// title・data-engine-color属性）を個別に確認する。Production側の実装（ModelsView.jsx）は
// 変更しない（テスト追加のみ）。
// ---------------------------------------------------------------------------

// 1モデルのみの一覧をレンダリングし、Engine列（1件目のデータ行）のHTMLを返す。
function renderSingleModelHtml(name, engine) {
  return renderToString(
    React.createElement(
      ModelsView,
      baseProps({
        models: [name],
        modelInfos: {
          [name]: { model_id: "M0001", engine, training_family: "ocr", created_at: "2026-07-15T10:00:00" },
        },
        latest: { any: name, byType: {} },
      })
    )
  );
}

test("PaddleOCR: 表示ラベル・title・data-engine-colorがRegistry値どおり（見た目は既存仕様のまま）", () => {
  const html = renderSingleModelHtml("model_p.ocr.json", "paddleocr");
  assert.ok(html.includes(">PaddleOCR<"), "PaddleOCRの表示ラベルが変わっている");
  assert.ok(html.includes('title="PaddleOCR"'), "PaddleOCRの表示名（getEngineDisplayName）がtitle属性に反映されていない");
  assert.ok(html.includes('data-engine-color="violet"'), "PaddleOCRの色（getEngineColor）がdata-engine-color属性に反映されていない");
});

test("EasyOCR: 表示ラベル・title・data-engine-colorがRegistry値どおり（見た目は既存仕様のまま）", () => {
  const html = renderSingleModelHtml("model_e.easyocr", "easyocr");
  assert.ok(html.includes(">EasyOCR<"), "EasyOCRの表示ラベルが変わっている");
  assert.ok(html.includes('title="EasyOCR"'), "EasyOCRの表示名（getEngineDisplayName）がtitle属性に反映されていない");
  assert.ok(html.includes('data-engine-color="amber"'), "EasyOCRの色（getEngineColor）がdata-engine-color属性に反映されていない");
});

test("TrOCR: 表示ラベルは「TrOCR」、PaddleOCR/カスタムへフォールバックしない（TrOCR機能自体は追加しない、表示のみ確認）", () => {
  const html = renderSingleModelHtml("model_t.trocr", "trocr");
  assert.ok(html.includes(">TrOCR<"), "TrOCRの表示ラベルが「TrOCR」になっていない");
  assert.ok(!html.includes(">PaddleOCR<"), "TrOCRがPaddleOCRへフォールバックしている");
  assert.ok(!html.includes(">カスタム<"), "TrOCRがカスタムへフォールバックしている");
  assert.ok(html.includes('title="TrOCR"'), "TrOCRの表示名（getEngineDisplayName）がtitle属性に反映されていない");
  assert.ok(html.includes('data-engine-color="emerald"'), "TrOCRの色（getEngineColor）がdata-engine-color属性に反映されていない");
});

test("未登録Engine: 既知Engineへフォールバックせず「不明」表示、title・data-engine-color属性は付与されない", () => {
  const html = renderSingleModelHtml("model_x.unknown", "some-unregistered-engine");
  assert.ok(html.includes(">不明<"), "未登録Engineが既存のunknown表示方針（不明）のまま表示されていない");
  for (const wrongLabel of [">Tesseract<", ">PaddleOCR<", ">EasyOCR<", ">TrOCR<", ">カスタム<"]) {
    assert.ok(!html.includes(wrongLabel), `未登録Engineが特定の既知Engine（${wrongLabel}）へフォールバックしている`);
  }
  // getEngineDisplayName/getEngineColorがnullを返すため、title/data-engine-color属性自体が
  // 出力されない（Reactはundefined propの属性を省略する。文字列"null"/"undefined"にはならない）
  assert.ok(!html.includes('title="null"') && !html.includes('title="undefined"'), "title属性が不正な文字列になっている");
  assert.ok(
    !html.includes('data-engine-color="null"') && !html.includes('data-engine-color="undefined"'),
    "data-engine-color属性が不正な文字列になっている"
  );
});

test("空値（null/undefined/空文字）: engineName()の既存フォールバック（||\"custom\"）によりカスタム表示のまま（本PRでの変更なし）", () => {
  // engineName(name) は infoOf(name).engine || "custom" であり、本PR以前から
  // null/undefined/空文字は "custom" へフォールバックする（ModelsView.jsx側の既存実装、
  // 本PRでは無変更）。そのためRegistry呼び出しに渡る前に"custom"へ正規化され、
  // 表示は一貫して「カスタム」になる（"null"/"undefined"の文字列表示にはならない）。
  for (const engineValue of [null, undefined, ""]) {
    const html = renderSingleModelHtml("model_null.pt", engineValue);
    assert.ok(html.includes(">カスタム<"), `engine=${String(engineValue)}のとき「カスタム」にならない`);
    assert.ok(!html.includes(">null<") && !html.includes(">undefined<"), "engine値がそのまま文字列表示されている");
  }
});

test("空値（前後空白のみ）: Registry側の正規化により「不明」表示（既存のunknown表示方針を維持）", () => {
  // "   "（空白のみ）はJSの||では真値のため engineName() は"custom"へフォールバックしない。
  // engineRegistry.js側のnormalize()がtrimした結果空文字となり、未登録として扱われ「不明」になる。
  const html = renderSingleModelHtml("model_blank.pt", "   ");
  assert.ok(html.includes(">不明<"), "前後空白のみのengine値が「不明」表示にならない");
  assert.ok(!html.includes(">カスタム<"), "前後空白のみのengine値がカスタムへフォールバックしている");
});

test("fallbackDownloadName: TrOCRは.ocr.jsonにも.ptにも誤分類せず、ファイル名をそのまま返す", () => {
  const result = fallbackDownloadName("trocr_model_20260101", "trocr");
  assert.equal(result, "trocr_model_20260101");
  assert.ok(!result.endsWith(".inference.zip"), "TrOCRが.ocr.json由来のzip名に誤分類されている");
  assert.ok(!result.endsWith(".traineddata"), "TrOCRがtesseract由来のtraineddata名に誤分類されている");
});

test("fallbackDownloadName: 未登録EngineはTesseract/PaddleOCR/customいずれの命名規則にも推測変換しない", () => {
  const result = fallbackDownloadName("some_model.dat", "some-unregistered-engine");
  assert.equal(result, "some_model.dat", "未登録Engineがファイル名をそのまま返していない（特定Engine向けに推測変換された）");
});
