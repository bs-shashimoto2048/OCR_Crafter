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

// 「推論に使用」ボタン3か所（推論使用モデルカード・最新モデルカード・モデル詳細パネル）で
// 判定がバラバラにならないよう、対象モデルが現在の推論使用モデルかどうかの比較を1関数に集約する。
// このアプリではモデルはfilename（name）で一意に識別される（Tesseract/PaddleOCR/分類モデルで
// 拡張子・命名規則が異なり衝突しない。model_idは「管理No」という表示用の連番ラベルであり、
// 実体の一致判定にはfilenameを使う既存設計に合わせる）
export function isInferenceModelInUse(name, savedInferenceModel) {
  return Boolean(name) && Boolean(savedInferenceModel) && name === savedInferenceModel;
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

// 保存済み推論使用モデル（GET /api/ocr/inference/model の応答）から、復元時に
// 適用すべきstate（engine・model名）を決定する。App.jsxのloadModels()内の復元処理から
// 呼ばれる（副作用=setState自体はApp.jsx側で行う）。
// - 保存が無い/モデル名が空 → null（何もしない）
// - 保存されたモデルが現在の一覧（infoMap）に存在しない（削除・移動済み）→ found:false
//   （勝手に別モデルへ置き換えない。呼び出し側は警告表示のみ行う）
// - 存在する → found:true と、適用すべきengine/model
export function resolveRestoredInferenceSelection(savedModel, infoMap) {
  const modelName = String(savedModel?.model || "").trim();
  if (!modelName) return null;
  if (!infoMap || !infoMap[modelName]) {
    return { found: false, model: modelName };
  }
  const savedEngine = String(savedModel?.engine || "custom");
  const engine = savedEngine === "tesseract" ? "tesseract" : savedEngine === "paddleocr" ? "paddleocr" : "custom";
  return { found: true, engine, model: modelName };
}
