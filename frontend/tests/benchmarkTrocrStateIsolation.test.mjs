// TrOCR Benchmark Runner Integration（Issue #102）: Benchmark画面のTrOCR関連stateが
// Training（ocrTrocr*）・推論テスト画面（inferTrocr*）・モデル評価画面（ocrEvalTrocr*）の
// 既存stateと完全に分離されていることの回帰テスト。
//
// BenchmarkView.jsxのTrOCR設定（benchTrocr*）は他3画面と異なりApp.jsxへ持ち上げず、
// コンポーネント内のuseStateとして閉じている（Benchmark実行フォームがApp.jsx側で
// 状態を保持する必要のない、画面内完結の一時設定であるため）。そのため静的検証は
// BenchmarkView.jsx自身のソースとApp.jsx側の受け渡しの両方を確認する
// （trocrStateIsolation.test.mjsと同じ手法）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const APP_SOURCE_PROMISE = readFile(new URL("../src/App.jsx", import.meta.url), "utf-8");
const BENCHMARK_VIEW_SOURCE_PROMISE = readFile(new URL("../src/views/BenchmarkView.jsx", import.meta.url), "utf-8");

test("BenchmarkView.jsx内にTrOCR用state（benchTrocr*）が個別に存在する", async () => {
  const source = await BENCHMARK_VIEW_SOURCE_PROMISE;
  for (const name of [
    "benchTrocrModelSource",
    "setBenchTrocrModelSource",
    "benchTrocrSelectedModel",
    "setBenchTrocrSelectedModel",
    "benchTrocrModelRef",
    "setBenchTrocrModelRef",
    "benchTrocrDevice",
    "setBenchTrocrDevice",
    "benchTrocrLocalFilesOnly",
    "setBenchTrocrLocalFilesOnly",
  ]) {
    assert.ok(source.includes(name), `BenchmarkView.jsxに"${name}"が見つからない`);
  }
});

test("BenchmarkView.jsxは他画面専用のTrOCR state（ocrTrocr*/inferTrocr*/ocrEvalTrocr*）を参照しない", async () => {
  const source = await BENCHMARK_VIEW_SOURCE_PROMISE;
  assert.ok(!source.includes("ocrTrocr"), "BenchmarkView.jsxへ学習画面専用stateが混在している");
  assert.ok(!source.includes("inferTrocr"), "BenchmarkView.jsxへ推論テスト画面専用stateが混在している");
  assert.ok(!source.includes("ocrEvalTrocr"), "BenchmarkView.jsxへ評価画面専用stateが混在している");
});

test("<BenchmarkView>へは他画面専用のTrOCR state（ocrTrocr*/inferTrocr*/ocrEvalTrocr*）を渡さない", async () => {
  const source = await APP_SOURCE_PROMISE;
  const start = source.indexOf("<BenchmarkView");
  assert.ok(start >= 0, "<BenchmarkView が見つからない");
  const end = source.indexOf("/>", start);
  const block = source.slice(start, end);
  assert.ok(!block.includes("ocrTrocr"), "BenchmarkViewへ学習画面専用stateが渡っている");
  assert.ok(!block.includes("inferTrocr"), "BenchmarkViewへ推論テスト画面専用stateが渡っている");
  assert.ok(!block.includes("ocrEvalTrocr"), "BenchmarkViewへ評価画面専用stateが渡っている");
});

test("trocrTrainedModels（登録済みモデル一覧）はTraining画面と同じ読み取り専用の共有propとしてBenchmarkViewへも渡す", async () => {
  const source = await APP_SOURCE_PROMISE;
  assert.match(source, /const trocrTrainedModels = useMemo\(/);
  const start = source.indexOf("<BenchmarkView");
  const end = source.indexOf("/>", start);
  assert.ok(source.slice(start, end).includes("trocrTrainedModels={trocrTrainedModels}"));
});
