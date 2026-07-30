// TrOCR Model Metadata連携（Issue #25）の純ロジック。
//
// Backend側にTrOCR専用のモデル一覧APIは無く、Model Metadata（ModelMetadata）自体も
// 既存コードへ未配線（model_registry.py等からは一切参照されない、独立したデータ型）。
// そのため、既存のモデル一覧API（GET /models/info、App.jsxが既に読み込み済みの
// modelInfos）から、engineが正規化して"trocr"のものだけを抽出する。新規APIは追加しない。
//
// 現状（2026-07-30時点）、既存の`.pt`/`.ocr.json`/`.tess.json`のいずれの形式にも
// engine="trocr"を持つファイルパターンは存在しない（TrOCR学習が未実装のため）。
// よって実環境では本モジュールの抽出結果は基本的に空配列になる。これはバグではなく、
// TrOCR学習・モデル登録の仕組みが実装されるまでの既知の状態である
// （docs/workitems/trocr/FEATURE_TROCR_MODEL_METADATA_UI.md参照）。

import { normalizeEngineId } from "./engineResolution.js";

// ModelMetadataとの将来接続点（docs/design/TROCR_BACKEND.mdで既に言及されている
// artifact_path）を優先する。存在しない場合は解決不能として扱う（ファイル名を
// model_refとして代用しない。TrOCREngine.load()はfilenameルックアップではなく
// Hugging Face model ID・ローカルパスをそのまま受け取るため、代用は不正な推測になる）
function resolveTrocrModelRef(info) {
  const artifactPath = String(info?.artifact_path || "").trim();
  return artifactPath || "";
}

// modelInfos（GET /models/info の応答をキー化したもの）から、engineが正規化して
// "trocr"のものだけを抽出する。ファイル名・拡張子・training_familyのみでの判定は
// 行わない（Issue #25の方針）。
// 戻り値: [{ name, label, modelRef }]（labelは表示用、絶対パス等は含まない）
export function extractTrocrModels(models, modelInfos, modelAliases) {
  const list = Array.isArray(models) ? models : [];
  const infoMap = modelInfos && typeof modelInfos === "object" ? modelInfos : {};
  const aliasMap = modelAliases && typeof modelAliases === "object" ? modelAliases : {};
  return list
    .filter((name) => normalizeEngineId(infoMap[name]?.engine) === "trocr")
    .map((name) => ({
      name,
      // 表示名は既存のエイリアス機構（App.jsx各所の `modelAliases[name] || name` と同じ
      // 優先順位）を使う。model_dir等のパス系フィールドはラベルへ使用しない
      label: String(aliasMap[name] || name),
      modelRef: resolveTrocrModelRef(infoMap[name]),
    }));
}

// 選択中モデル名から、送信すべきmodel_refを解決する。未選択・未存在・解決不能は空文字
export function resolveSelectedTrocrModelRef(trocrModels, selectedName) {
  const trimmedName = String(selectedName || "").trim();
  if (!trimmedName) return "";
  const found = (Array.isArray(trocrModels) ? trocrModels : []).find((m) => m.name === trimmedName);
  return found ? found.modelRef : "";
}

// 登録済みモデル方式のValidationエラーメッセージ。有効ならnull
export function trocrMetadataValidationError(trocrModels, selectedName) {
  const trimmedName = String(selectedName || "").trim();
  if (!trimmedName) {
    return "TrOCRモデルを選択してください。";
  }
  const found = (Array.isArray(trocrModels) ? trocrModels : []).find((m) => m.name === trimmedName);
  if (!found || !found.modelRef) {
    return "選択したTrOCRモデルを利用できません。";
  }
  return null;
}
