// Training完了直後のjobから、Evaluation画面へ引き継ぐべきモデル識別子を解決する
// 純粋ロジック（Issue #119、Training → Evaluation Handoff）。
//
// 設計方針:
// - 「引き継げない値は推測しない」。job_idが一致するモデルが見つからない場合は
//   空のmodelName/modelRefを返す（呼び出し側はengineのみ設定し、モデル選択は
//   ユーザーへ委ねる。既存の別モデルを誤って選ばない）
// - Tesseract/PaddleOCRは`/models/info`（list_model_infos()）のjob_idフィールド
//   （Issue #119で追加）から、登録済みsidecarファイル名を逆引きする
// - TrOCRは`/api/trocr/models`（list_trocr_models()）の生payload（Issue #96時点から
//   既にjob_idを持つ）から、model_dir（そのままEvaluationのmanual model_refとして使える
//   既存契約、trocr_model_registry.py参照）を逆引きする。Evaluationの「登録済みモデルから
//   選択」モード（trocrModelSource==="metadata"）はGET /models/info を参照するため
//   .trocr.jsonを含まず実運用上常に空になる既知の別バグ（本Issueでは修正しない、
//   workitem docのFuture Work参照）があるため、manualモード（model_ref直接指定）で
//   引き継ぐ
// - EasyOCRは学習エンドポイント自体が存在しないため、本関数の対象外（呼び出されない）

export const TRAINABLE_EVALUATION_ENGINES = ["tesseract", "paddleocr", "trocr"];

/**
 * @param {object} params
 * @param {string} params.engine - 完了したTraining Jobのengine（jobInfo.engine）
 * @param {string} params.jobId - 完了したTraining JobのID（jobInfo.id）
 * @param {Record<string, object>} params.modelInfos - App.jsxのmodelInfos（name→/models/info item）
 * @param {Array<object>} params.trocrTrainedModelItems - GET /api/trocr/modelsの生items
 * @returns {{engine: string, modelName: string, modelRef: string}}
 *   engine="tesseract"|"paddleocr"の場合はmodelNameのみ（登録済みモデル選択用）、
 *   engine="trocr"の場合はmodelRefのみ（manual入力用）を返す。解決できなければ空文字。
 */
export function resolveTrainingEvaluationHandoff({ engine, jobId, modelInfos = {}, trocrTrainedModelItems = [] } = {}) {
  const normalizedEngine = String(engine || "").trim().toLowerCase();
  const normalizedJobId = String(jobId || "").trim();

  if (!TRAINABLE_EVALUATION_ENGINES.includes(normalizedEngine) || !normalizedJobId) {
    return { engine: normalizedEngine, modelName: "", modelRef: "" };
  }

  if (normalizedEngine === "trocr") {
    const match = (Array.isArray(trocrTrainedModelItems) ? trocrTrainedModelItems : []).find(
      (item) => item && String(item.job_id || "") === normalizedJobId
    );
    return { engine: normalizedEngine, modelName: "", modelRef: match ? String(match.model_dir || "") : "" };
  }

  // tesseract / paddleocr: modelInfos（name→info）からjob_id一致を逆引きする
  const infoList = Object.values(modelInfos || {});
  const match = infoList.find((info) => info && String(info.job_id || "") === normalizedJobId);
  return { engine: normalizedEngine, modelName: match ? String(match.name || "") : "", modelRef: "" };
}
