// ReleasesView（Release Gate / Model Release Management画面）のレンダリングテスト。
//
// Issue #104（TrOCR Release Gate Integration）の実装前調査で、このView自体は
// エンジン固有のファイル名判定（.tess.json/.ocr.json等）を一切持たず、Backendの
// list_releases()が返すstatuses（モデル名をキーとする辞書）をそのまま汎用的に
// 描画していることを確認した。そのためUI変更は行わず、TrOCRモデル（.trocr.json）が
// 既存の一覧・昇格候補選択へ自然に現れることをテストで契約として固定する。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

let server;
let ReleasesView;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  ({ default: ReleasesView } = await server.ssrLoadModule("/src/views/ReleasesView.jsx"));
});

after(async () => {
  await server?.close();
});

const noop = () => {};

function render(overrides = {}) {
  const html = renderToString(
    React.createElement(ReleasesView, {
      projectId: "p1",
      releases: {
        production: "",
        statuses: {
          "m1.tess.json": { status: "Draft", version: "", updated_at: "" },
          "trocr_job-1.trocr.json": { status: "Draft", version: "", updated_at: "" },
        },
        history: [],
      },
      experiments: [],
      modelInfos: {},
      onRefresh: noop,
      onSetStatus: noop,
      onPromote: noop,
      onRollback: noop,
      onOpenModel: noop,
      ...overrides,
    })
  );
  return html.replaceAll("<!-- -->", "");
}

test("TrOCRモデル（.trocr.json）がTesseractモデルと並んで一覧・昇格候補へエンジン非依存に表示される", () => {
  const html = render();
  assert.ok(html.includes("trocr_job-1.trocr.json"), "TrOCRモデルが一覧へ表示されない");
  assert.ok(html.includes("m1.tess.json"), "既存Tesseractモデルの表示に回帰がある");
});

test("TrOCRモデルがProductionの場合もクラッシュせず表示される", () => {
  const html = render({
    releases: {
      production: "trocr_job-1.trocr.json",
      statuses: {
        "trocr_job-1.trocr.json": { status: "Production", version: "1.0.0", updated_at: "2026-08-01T00:00:00" },
      },
      history: [
        {
          release_id: "REL-0001",
          version: "1.0.0",
          model: "trocr_job-1.trocr.json",
          released_at: "2026-08-01T00:00:00",
          author: "hashimoto",
          note: "初回リリース",
          rollback: false,
        },
      ],
    },
  });
  assert.ok(html.includes("trocr_job-1.trocr.json"));
  assert.ok(html.includes("v1.0.0") || html.includes("1.0.0"));
});

test("空状態: モデルが無ければ既存のEmptyStateをそのまま表示する（回帰確認）", () => {
  const html = render({ releases: { production: "", statuses: {}, history: [] } });
  assert.ok(!html.includes("trocr_job-1.trocr.json"));
});
