// 学習画像作成 Step5（評価用データ作成）の純ロジック。
// クロップの識別キー・件数集計・回転状態・一覧フィルタを扱う。

export const EVAL_SERIES_ALL = "__all__";

// クロップの一意キー（export_id + ファイル名。マニフェスト由来の確定情報）
export function cropKey(exportId, filename) {
  return `${exportId}/${filename}`;
}

// フォルダ取得モードのキー接頭辞（Step4のexport_idと衝突しない予約値）
export const DIRECTORY_SOURCE_KEY = "__dir__";

// フォルダ画像の一意キー
export function directoryItemKey(filename) {
  return `${DIRECTORY_SOURCE_KEY}/${filename}`;
}

// フォルダ画像一覧から評価候補アイテムを組み立てる（Step4候補と同じ形。Series・元画像情報は持たない）
export function buildDirectoryItems(directory, filenames) {
  const dir = String(directory || "");
  return (Array.isArray(filenames) ? filenames : [])
    .map((name) => String(name || ""))
    .filter(Boolean)
    .map((name) => ({
      key: directoryItemKey(name),
      source: "directory",
      directory: dir,
      exportId: "",
      filename: name,
      series: "",
      bboxId: null,
      exists: true,
      sourceImage: "",
      createdAt: "",
    }));
}

// 回転角の加算（0/90/180/270 で循環）
export function nextRotation(current, delta) {
  const base = Number(current) || 0;
  const step = Number(delta) || 0;
  return (((base + step) % 360) + 360) % 360;
}

// ステータス表示用の件数集計（評価対象のみを数える）
export function computeEvalCounts(items, itemState) {
  let target = 0;
  let labeled = 0;
  let unlabeled = 0;
  let rotated = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const state = (itemState && itemState[item.key]) || {};
    if (state.checked === false) {
      continue;
    }
    target += 1;
    if (String(state.label || "").trim()) {
      labeled += 1;
    } else {
      unlabeled += 1;
    }
    if (nextRotation(state.rotation, 0) !== 0) {
      rotated += 1;
    }
  }
  return { target, labeled, unlabeled, rotated };
}

// 一覧の表示フィルタ（Series・未入力のみ）
export function filterEvalItems(items, itemState, { series = EVAL_SERIES_ALL, unlabeledOnly = false } = {}) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (series !== EVAL_SERIES_ALL && String(item.series || "") !== series) {
      return false;
    }
    if (unlabeledOnly) {
      const state = (itemState && itemState[item.key]) || {};
      if (String(state.label || "").trim()) {
        return false;
      }
    }
    return true;
  });
}

// データセット作成可否（評価対象が1件以上・未入力なし・ソース欠損なし）
export function evaluateCreateReadiness(items, itemState) {
  let target = 0;
  let unlabeled = 0;
  let missing = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const state = (itemState && itemState[item.key]) || {};
    if (state.checked === false) {
      continue;
    }
    target += 1;
    if (item.exists === false) {
      missing += 1;
    }
    if (!String(state.label || "").trim()) {
      unlabeled += 1;
    }
  }
  return { target, unlabeled, missing, ok: target > 0 && unlabeled === 0 && missing === 0 };
}
