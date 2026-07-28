// 推論使用モデル切替の純ロジック（App.jsx switchInferenceModel から呼ばれる）。
// v1.0.0で修正: 保存トリガーを「関連stateが変わるたびに保存する常時監視effect」から
// 明示呼び出しの一本道へ変更した際に切り出した。ここは判定のみを担い、実際の
// state更新・API呼び出し・確認ダイアログ表示はApp.jsx側で行う（副作用を持たない）。

// モデルのengine/training_familyから、推論に使うべきengineキーを決定する
// （既存の分岐: tesseract優先 → training_family=ocr（PaddleOCR系）→ それ以外はcustom=分類モデル）
export function resolveInferenceEngine(modelInfo = {}) {
  const engine = String(modelInfo?.engine || "");
  const family = String(modelInfo?.training_family || "classification");
  if (engine === "tesseract") return "tesseract";
  if (family === "ocr") return "paddleocr";
  return "custom";
}

// 既に別モデルが推論使用モデルに設定されている場合のみ確認が必要（初回設定は確認不要）
export function shouldConfirmSwitch(currentDisplayName, nextDisplayName) {
  const current = String(currentDisplayName || "").trim();
  const next = String(nextDisplayName || "").trim();
  return Boolean(current) && current !== next;
}

// 確認ダイアログの文言（要求仕様どおりの形式）
export function buildSwitchConfirmMessage(currentDisplayName, nextDisplayName) {
  return `現在の推論使用モデル\n${currentDisplayName}\n\n↓\n\n${nextDisplayName}\n\nへ変更します。\nよろしいですか？`;
}
