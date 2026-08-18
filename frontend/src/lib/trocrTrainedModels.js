// TrOCR Training UI（Issue #98）専用の純ロジック。
//
// Inference/Evaluationの`trocrModelMetadata.js::extractTrocrModels()`とは
// データソースが異なる。Trainingの「登録済みモデルから継続Fine-tune」は
// Issue #96で新設した`.trocr.json`sidecar（`GET /api/trocr/models`、
// `list_trocr_models()`の薄いラッパー）をそのまま使う。`GET /models/info`は
// `.trocr.json`をglobしないため（Issue #96で意図的に未統合）、extractTrocrModels()の
// 結果は実運用上常に空になる。Trainingでは新エンドポイントの応答を直接使うことで
// 「継続元モデルが常に空リストになる」問題を避ける。

// `GET /api/trocr/models`の`items`（`.trocr.json`sidecarそのもの）から、
// select用の{name, label, modelRef}へ変換する。
// 戻り値の`modelRef`はそのまま学習開始APIのmodel_refとして送信できる
// （save_pretrained()で書き出したディレクトリをfrom_pretrained()でそのまま
// 読み込める既存契約、Issue #96 trocr_model_registry.py参照）。
export function mapTrocrTrainedModels(items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((item) => {
      const name = String(item?.name || "").trim();
      const modelRef = String(item?.model_dir || "").trim();
      const baseModelRef = String(item?.base_model_ref || "").trim();
      const jobId = String(item?.job_id || "").trim();
      if (!name || !modelRef) {
        return null;
      }
      const suffixParts = [];
      if (baseModelRef) suffixParts.push(`base: ${baseModelRef}`);
      if (jobId) suffixParts.push(`job: ${jobId}`);
      const label = suffixParts.length > 0 ? `${name} (${suffixParts.join(", ")})` : name;
      return { name, label, modelRef };
    })
    .filter(Boolean);
}

// 選択中モデル名から、送信すべきmodel_refを解決する。未選択・未存在は空文字
export function resolveTrocrTrainedModelRef(trainedModels, selectedName) {
  const trimmedName = String(selectedName || "").trim();
  if (!trimmedName) return "";
  const found = (Array.isArray(trainedModels) ? trainedModels : []).find((m) => m.name === trimmedName);
  return found ? found.modelRef : "";
}

// 「登録済みモデルから選択」方式のValidationエラーメッセージ。有効ならnull
export function trocrTrainedModelValidationError(trainedModels, selectedName) {
  const trimmedName = String(selectedName || "").trim();
  if (!trimmedName) {
    return "継続元のTrOCRモデルを選択してください。";
  }
  const found = (Array.isArray(trainedModels) ? trainedModels : []).find((m) => m.name === trimmedName);
  if (!found || !found.modelRef) {
    return "選択したTrOCRモデルを利用できません。";
  }
  return null;
}
