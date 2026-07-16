// 画面単位ErrorBoundaryのkey決定。
// 学習画像作成のStep1〜4は別view idだが同一コンポーネント（TrainingImageBuilderView）であり、
// 選択画像・検出結果などの内部状態をStep間で保持する必要があるため、単一keyへまとめて
// Step遷移による再マウント（=state全消失）を防ぐ。
// （key=activeView のままだと「Step1で選択した画像が次へで解除される」不具合になる）
export function viewBoundaryKey(activeView) {
  const view = String(activeView || "");
  if (view.startsWith("image-builder-step")) {
    return "image-builder";
  }
  return view;
}
