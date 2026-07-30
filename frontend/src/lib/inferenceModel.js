// 推論使用モデル切替の純ロジック（App.jsx switchInferenceModel から呼ばれる）。
// v1.0.0で修正: 保存トリガーを「関連stateが変わるたびに保存する常時監視effect」から
// 明示呼び出しの一本道へ変更した際に切り出した。ここは判定のみを担い、実際の
// state更新・API呼び出し・確認ダイアログ表示はApp.jsx側で行う（副作用を持たない）。

import { normalizeEngineId } from "./engineResolution.js";

// モデルのengineから、推論に使うべきengineキーを決定する（Issue #12: 未知Engineを
// 暗黙にPaddleOCRとみなさない）。engine未指定（分類モデル・旧データ）はcustom。
// それ以外は既知4Engine（tesseract/paddleocr/easyocr/trocr）へ正規化し、未登録の値は
// "unknown"のまま返す（呼び出し側がunknownを検出して推論を止める。App.jsx参照）。
export function resolveInferenceEngine(modelInfo = {}) {
  const rawEngine = String(modelInfo?.engine ?? "").trim().toLowerCase();
  if (!rawEngine || rawEngine === "custom") return "custom";
  return normalizeEngineId(rawEngine);
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
//   engine未指定（旧データ・後方互換）はcustom。既知4Engine以外の値は"unknown"のまま返す
//   （Issue #12: 未知Engineを暗黙にcustom/paddleocrへ変換しない。呼び出し側で明示的に扱う）
export function resolveRestoredInferenceSelection(savedModel, infoMap) {
  const modelName = String(savedModel?.model || "").trim();
  if (!modelName) return null;
  if (!infoMap || !infoMap[modelName]) {
    return { found: false, model: modelName };
  }
  const rawEngine = String(savedModel?.engine ?? "").trim().toLowerCase();
  const engine = !rawEngine || rawEngine === "custom" ? "custom" : normalizeEngineId(rawEngine);
  return { found: true, engine, model: modelName };
}
