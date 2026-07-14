// ラベル編集「保存して次へ」の移動先決定（方式A: 保存前に画像名で1回だけ確定する）。
//
// indexだけで管理すると「未編集のみ」フィルタで保存後に現在画像が一覧から消えて
// 位置が詰まり、さらに+1すると1件飛ばしてしまう。そのため保存前の表示一覧を基準に
// 次画像を画像名で決め、保存成功後にその画像へ移動する。
//
// - allNames: 全画像名（選択インデックスはこの配列基準）
// - visibleNames: フィルタ適用後に表示中の画像名（保存前のスナップショット）
// - currentName: 現在の画像名
// 戻り値: 移動先の allNames 上の index。移動しない（最後の画像など）場合は null
export function decideNextImageIndex(allNames, visibleNames, currentName) {
  const all = Array.isArray(allNames) ? allNames : [];
  const visible = Array.isArray(visibleNames) ? visibleNames : [];
  const posVisible = visible.indexOf(currentName);
  if (posVisible >= 0) {
    const nextName = visible[posVisible + 1];
    if (nextName === undefined) {
      return null; // 表示一覧の最後 → 現在画像に留まる
    }
    const nextIndex = all.indexOf(nextName);
    return nextIndex >= 0 ? nextIndex : null;
  }
  // 現在画像がフィルタで非表示（例: ラベル済みで「未編集のみ」表示中）の場合は全体一覧で次へ
  const posAll = all.indexOf(currentName);
  if (posAll >= 0 && posAll + 1 < all.length) {
    return posAll + 1;
  }
  return null;
}
