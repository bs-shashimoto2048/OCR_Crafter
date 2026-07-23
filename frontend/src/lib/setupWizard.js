// 初回セットアップウィザードの状態管理（純ロジック・node:test対象）。
// 保存先: localStorage `ocr_setup_wizard_v1`
//   {completed: bool, wizardVersion: number, projectsDir: string, completedAt: ISO文字列}
// wizardVersion: ウィザード内容を更新したらこの定数を上げる。
// 保存済みバージョンが古い場合は再度ウィザードを表示できる（将来の再実行導線）。

export const SETUP_WIZARD_VERSION = 1;
export const SETUP_WIZARD_STORAGE_KEY = "ocr_setup_wizard_v1";

// ウィザードのステップ定義（ステップバー表示用。項目追加はここへ1行追加する）
export const WIZARD_STEPS = [
  { id: "welcome", label: "ようこそ" },
  { id: "storage", label: "保存先" },
  { id: "engines", label: "OCRエンジン" },
  { id: "gpu", label: "GPU" },
  { id: "python", label: "Python環境" },
  { id: "backup", label: "バックアップ" },
  { id: "done", label: "完了" },
];

// 保存状態の読み込み（storage未指定=window.localStorage。SSR・読取失敗は未完了扱い）
export function readSetupState(storage) {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!target) return { completed: false, wizardVersion: 0, projectsDir: "", completedAt: "" };
  try {
    const parsed = JSON.parse(target.getItem(SETUP_WIZARD_STORAGE_KEY) || "{}");
    return {
      completed: Boolean(parsed?.completed),
      wizardVersion: Number(parsed?.wizardVersion) || 0,
      projectsDir: String(parsed?.projectsDir || ""),
      completedAt: String(parsed?.completedAt || ""),
    };
  } catch {
    return { completed: false, wizardVersion: 0, projectsDir: "", completedAt: "" };
  }
}

// 表示判定: 初回起動（保存なし）・設定が壊れている・ウィザードが更新された（旧バージョン完了）
// 場合のみ true。完了済み（現行バージョン）の通常起動では表示しない
export function shouldShowWizard(state) {
  if (!state || !state.completed) return true;
  return Number(state.wizardVersion) < SETUP_WIZARD_VERSION;
}

// 完了時に保存する状態を構築する（now は ISO文字列。テストで固定値を渡せる）
export function buildCompletedState(previous, { projectsDir = "", now = "" } = {}) {
  return {
    completed: true,
    wizardVersion: SETUP_WIZARD_VERSION,
    projectsDir: projectsDir || previous?.projectsDir || "",
    completedAt: now || new Date().toISOString(),
  };
}

export function writeSetupState(state, storage) {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!target) return;
  try {
    target.setItem(SETUP_WIZARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 保存失敗（容量等）は無視（次回起動で再度ウィザードが出るだけで害はない）
  }
}
