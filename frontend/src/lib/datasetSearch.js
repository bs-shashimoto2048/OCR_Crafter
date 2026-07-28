// Dataset Manager: Dataset一覧の検索・ソート純粋関数（DatasetManagerView.jsxから利用）。

// 検索対象: Dataset名・コメント・Charset・前処理Version（要求仕様11.）
export function matchesDatasetSearch(query, { name, comment, charset, preprocessVersion } = {}) {
  const search = String(query || "").trim().toLowerCase();
  if (!search) return true;
  const versionText = preprocessVersion === null || preprocessVersion === undefined ? "" : `v${preprocessVersion}`;
  return [name, comment, charset, versionText].some((value) => String(value || "").toLowerCase().includes(search));
}

const SORT_ACCESSORS = {
  name: (item) => String(item?.name || "").toLowerCase(),
  created_at: (item) => String(item?.created_at || ""),
  input_count: (item) => Number(item?.input_count || 0),
  model_count: (item) => Number(item?.model_count || 0),
  charset: (item) => String(item?.charset || "").toLowerCase(),
};

// key未対応時はcreated_at降順のデフォルト順を維持したまま返す（不要な例外を出さない）
export function sortDatasetItems(items, key, dir = "desc") {
  const list = Array.isArray(items) ? [...items] : [];
  const accessor = SORT_ACCESSORS[key];
  if (!accessor) return list;
  const factor = dir === "asc" ? 1 : -1;
  return list.sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}
