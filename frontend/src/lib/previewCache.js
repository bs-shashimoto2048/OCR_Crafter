// 前処理プレビューの結果キャッシュ（同一画像・同一設定の再取得を防ぐ）。
// キー=画像名＋overrides＋推論設定のシグネチャ。メイン設定と比較スロットで
// 同一キーになった場合もキャッシュを共有する（重複推論しない）。

export const PREVIEW_CACHE_LIMIT = 30;

// 安定キー（オブジェクトはキー順に正規化してJSON化）
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function makePreviewCacheKey({ image, overrides, fields }) {
  return `${String(image || "")}::${stableStringify(overrides || {})}::${stableStringify(fields || {})}`;
}

// 挿入順を利用した簡易LRU（getで末尾へ移動・上限超過で先頭を破棄）
export function createPreviewCache(limit = PREVIEW_CACHE_LIMIT) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > limit) {
        map.delete(map.keys().next().value);
      }
    },
    has(key) {
      return map.has(key);
    },
    get size() {
      return map.size;
    },
  };
}
