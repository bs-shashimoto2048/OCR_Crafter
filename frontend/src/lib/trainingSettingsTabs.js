// 次回学習の設定タブ定義（3カテゴリ）と、旧4タブ構成からの安全なID移行。
// 「学習パラメータ」「データ分割」タブは「学習設定」へ統合された（並び順は固定）。
// localStorageキー ocr_training_settings_tab_v1 はそのまま使用し、
// 旧タブID（data-split / training-params）が保存されている場合は新IDへマッピングする。
// 想定外の値も含め、正規化後は必ずいずれかの有効タブIDを返す（既存ユーザーがタブを開けなくならないように）。

export const SETTINGS_TABS = [
  { id: "training-settings", label: "学習設定" },
  { id: "augmentation", label: "オーグメンテーション" },
  { id: "engine", label: "エンジン設定" },
];

export const DEFAULT_SETTINGS_TAB_ID = "training-settings";

const VALID_TAB_IDS = new Set(SETTINGS_TABS.map((tab) => tab.id));

// 旧タブID → 新タブIDの対応（4タブ時代の「データ分割」「学習パラメータ」はどちらも「学習設定」へ統合）
const LEGACY_TAB_ID_MAP = {
  "data-split": DEFAULT_SETTINGS_TAB_ID,
  "training-params": DEFAULT_SETTINGS_TAB_ID,
};

// 任意の（旧・不正・未知を含む）タブIDを、現行の有効なタブIDへ安全に正規化する。
// 現行タブID→そのまま / 旧タブID→対応表でマッピング / それ以外（null・空・未知の文字列）→既定へフォールバック
export function normalizeSettingsTabId(rawId) {
  const id = String(rawId || "");
  if (VALID_TAB_IDS.has(id)) return id;
  if (Object.prototype.hasOwnProperty.call(LEGACY_TAB_ID_MAP, id)) return LEGACY_TAB_ID_MAP[id];
  return DEFAULT_SETTINGS_TAB_ID;
}
