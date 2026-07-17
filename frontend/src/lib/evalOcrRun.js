// Step5のOCR実行条件キーと結果キャッシュ（フロント側・セッション内LRU）。
// 「画像・回転・Step5専用前処理・有効スロット設定」のいずれかが変わると別キーになり、
// 既存のOCR候補は「要再実行」表示になる。同一条件へ戻った場合はキャッシュ結果を即表示する。

// OCR実行条件の一意キー
export function buildOcrRunKey(itemKey, rotation, evalPreprocessJson, slotFieldsKey) {
  return JSON.stringify([String(itemKey || ""), Number(rotation) || 0, String(evalPreprocessJson || ""), String(slotFieldsKey || "")]);
}

// 自動OCRを発火してよいか（キャッシュヒット時はAPIを呼ばない）。
// 発火条件: 自動実行ON・対象画像あり（欠損でない）・有効スロットあり・同一条件の結果未取得
export function shouldAutoRunOcr({ autoRun, hasItem, itemExists, enabledCount, hasCachedResult }) {
  return (
    autoRun === true &&
    hasItem === true &&
    itemExists !== false &&
    Number(enabledCount) > 0 &&
    hasCachedResult !== true
  );
}

// サイズ制限付きLRUマップ（Mapの挿入順を利用。上限超過で最古を破棄）
export function createLruCache(limit = 30) {
  const map = new Map();
  const max = Math.max(1, Number(limit) || 1);
  return {
    get(key) {
      if (!map.has(key)) {
        return undefined;
      }
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      if (map.has(key)) {
        map.delete(key);
      }
      map.set(key, value);
      while (map.size > max) {
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
