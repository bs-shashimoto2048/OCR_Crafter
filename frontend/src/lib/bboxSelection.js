// Step3（Bounding Box選択）の削除後自動選択ロジック。
// 削除後の選択対象は「現在画面へ表示されている一覧（Seriesフィルタ等の適用後）」から決める。
// 全BBox配列を基準にするとフィルタ外（別Series）のBBoxが選択されてしまうため、
// 呼び出し側は必ず表示中の配列（filteredDetections）を渡すこと。

// 削除後は表示中一覧の「次の番号」（無ければ最大の前の番号）を選択する。
// 表示中の残件が0件なら null（=選択解除）。
export function nextSelectionAfterDelete(visibleRows, deletedIds) {
  const deleted = new Set(deletedIds);
  const remaining = (visibleRows || []).filter((row) => !deleted.has(row.id)).map((row) => row.id);
  if (remaining.length === 0) {
    return null;
  }
  const minDeleted = Math.min(...deletedIds);
  const after = remaining.filter((id) => id > minDeleted).sort((a, b) => a - b);
  if (after.length > 0) {
    return after[0];
  }
  return remaining.sort((a, b) => b - a)[0];
}
