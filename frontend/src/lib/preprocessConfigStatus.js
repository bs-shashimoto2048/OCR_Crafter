// 「前処理設定保存」（学習に使用する確定済み前処理設定）の表示状態を算出する純粋関数群。
// プリセット（複数保存・再利用可能なテンプレート）とは別機能——このプロジェクトで学習に
// 使用する確定設定を1件（+履歴）だけ扱う。
//
// 未保存変更の判定は、GET /api/ocr/preprocess/current-config が既存の正式なHash生成
// （compute_training_preprocess_hash）で比較した結果（is_saved）をそのまま使う。
// React stateの単純比較・JSON文字列比較は行わない。

function formatDateTime(raw) {
  const value = String(raw || "");
  return value ? value.replace("T", " ").slice(0, 19) : "-";
}

// 保存ボタン付近の状態表示（保存済みで一致 / 保存後に変更あり / 一度も保存されていない）
export function buildPreprocessSaveStatus({ savedConfig, isSaved } = {}) {
  if (!savedConfig) {
    return { status: "never_saved", label: "学習用設定は未保存です", version: null, savedAt: "-" };
  }
  const version = Number(savedConfig.version ?? 0) || 0;
  const savedAt = formatDateTime(savedConfig.saved_at);
  if (isSaved) {
    return { status: "saved", label: "保存済み", version, savedAt };
  }
  return { status: "changed", label: "未保存の変更があります", version, savedAt };
}

// 学習画面「今回学習で使用した前処理」の設定Version表示用（保存日時と適用日時を区別する）
export function buildDatasetPreprocessVersionDisplay({ version, savedAt, appliedAt, hash } = {}) {
  return {
    version: version === null || version === undefined ? "-" : Number(version),
    savedAt: formatDateTime(savedAt),
    appliedAt: formatDateTime(appliedAt),
    hash: hash || "未記録",
  };
}

// 保存履歴一覧の表示用整形（現在使用中のversionを区別する）
export function buildPreprocessConfigHistoryDisplay(history = [], currentVersion = null) {
  return (Array.isArray(history) ? history : []).map((item) => ({
    version: Number(item?.version ?? 0) || 0,
    savedAt: formatDateTime(item?.saved_at),
    hash: String(item?.config_hash || "未記録"),
    isCurrent: currentVersion !== null && Number(item?.version ?? -1) === Number(currentVersion),
  }));
}
