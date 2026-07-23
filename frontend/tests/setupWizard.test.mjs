// 初回セットアップウィザードの状態ロジック（初回判定・保存・バージョン管理）のテスト
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SETUP_WIZARD_STORAGE_KEY,
  SETUP_WIZARD_VERSION,
  WIZARD_STEPS,
  buildCompletedState,
  readSetupState,
  shouldShowWizard,
  writeSetupState,
} from "../src/lib/setupWizard.js";

function memoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
    dump: () => store,
  };
}

test("ステップ構成: 7ステップ（ようこそ→保存先→エンジン→GPU→Python→バックアップ→完了）", () => {
  assert.deepEqual(
    WIZARD_STEPS.map((s) => s.id),
    ["welcome", "storage", "engines", "gpu", "python", "backup", "done"]
  );
  assert.equal(WIZARD_STEPS.length, 7);
});

test("初回起動（保存なし）・壊れた保存・SSRでは表示する", () => {
  assert.equal(shouldShowWizard(readSetupState(memoryStorage())), true); // 初回
  const broken = memoryStorage({ [SETUP_WIZARD_STORAGE_KEY]: "not-json{{" });
  assert.equal(shouldShowWizard(readSetupState(broken)), true); // 設定ファイル（保存値）が壊れている
  assert.equal(shouldShowWizard(readSetupState(null)), true); // storageなし（SSR等）
});

test("2回目起動（現行バージョンで完了済み）では表示しない", () => {
  const storage = memoryStorage();
  writeSetupState(buildCompletedState(readSetupState(storage), { projectsDir: "D:/data", now: "2026-07-23T12:00:00Z" }), storage);
  const state = readSetupState(storage);
  assert.equal(state.completed, true);
  assert.equal(state.wizardVersion, SETUP_WIZARD_VERSION);
  assert.equal(state.projectsDir, "D:/data"); // 保存先メモが保持される
  assert.equal(state.completedAt, "2026-07-23T12:00:00Z");
  assert.equal(shouldShowWizard(state), false); // 通常起動では表示しない
});

test("旧バージョンで完了済みの場合は再表示（wizardVersionによる将来の再実行）", () => {
  const storage = memoryStorage({
    [SETUP_WIZARD_STORAGE_KEY]: JSON.stringify({ completed: true, wizardVersion: 0, projectsDir: "" }),
  });
  assert.equal(shouldShowWizard(readSetupState(storage)), true);
});

test("キャンセル（×で中断）は完了フラグを立てない=次回も表示・既存の保存値は保持", () => {
  const storage = memoryStorage();
  // 中断時は writeSetupState を呼ばない運用（App側）→ 状態は未完了のまま
  assert.equal(shouldShowWizard(readSetupState(storage)), true);
  // 完了後の再実行→中断でも、以前の完了状態は上書きされない（設定保持）
  writeSetupState(buildCompletedState(readSetupState(storage), { projectsDir: "D:/keep", now: "t" }), storage);
  const after = readSetupState(storage);
  assert.equal(after.completed, true);
  assert.equal(after.projectsDir, "D:/keep");
  // 完了状態から buildCompletedState を再構築しても projectsDir を引き継ぐ
  const rebuilt = buildCompletedState(after, { now: "t2" });
  assert.equal(rebuilt.projectsDir, "D:/keep");
});
