// Evaluation画面の現在の設定から、Benchmark画面へ引き継ぐべきEngine key・モデル識別子・
// Datasetを解決する純粋ロジック（Issue #119、Evaluation → Benchmark Handoff）。
//
// 設計方針:
// - Benchmark Runner（services/benchmark.py::ENGINE_CATALOG）はEasyOCRを
//   `implemented: False`（未導入・利用不可）としており、実行経路自体が存在しない。
//   したがってEvaluationのengineがeasyocrの場合はhandoff不可（null）を返す
//   （BenchmarkViewのUI側でも選択不可のチェックボックスとして表示される既存契約と一致させる。
//   Benchmarkの対応engineが変わった場合はこのマッピングを更新する）
// - TrOCRは、Evaluationで実際に使われたmodel_ref（trocrModelSource==="metadata"なら
//   登録済みモデルからの解決値、"manual"なら直接入力値）をそのまま manual モードで
//   Benchmarkへ渡す。Evaluationの「登録済みモデルから選択」モードはGET /models/info
//   経由のためTrOCRを含まず実運用上常に空になる既知の別バグがあるが、Benchmark側は
//   常にmanualモードで引き継ぐためこの影響を受けない
import { normalizeTrocrModelRef } from "./inferenceModel.js";
import { resolveSelectedTrocrModelRef } from "./trocrModelMetadata.js";

// Evaluationのengine → Benchmark Runner（ENGINE_CATALOG）のengine keyへの対応。
// 既存2形式の使い分け（PaddleOCRは自作学習済み=custom、Tesseractは登録済みモデル=model）
// にそのまま合わせる（新しい識別子体系は作らない）
const ENGINE_TO_BENCHMARK_KEY = {
  tesseract: "tesseract_model",
  paddleocr: "paddleocr_custom",
  trocr: "trocr",
};

/**
 * @param {object} params
 * @param {string} params.engine - Evaluationで現在選択中のengine（ocrEvalEngine）
 * @param {string} params.trainedModel - Tesseractの登録済みモデル選択値（ocrEvalTrainedModel）
 * @param {string} params.paddleModel - PaddleOCRの登録済みモデル選択値（ocrEvalPaddleModel）
 * @param {string} params.trocrModelSource - "metadata"|"manual"（ocrEvalTrocrModelSource）
 * @param {string} params.trocrSelectedModel - 登録済みモデル選択値（ocrEvalTrocrSelectedModel）
 * @param {Array<object>} params.trocrModels - Evaluationが参照するTrOCRモデル一覧（ocrEvalTrocrModelSource==="metadata"の解決に使用）
 * @param {string} params.trocrModelRef - 手動入力値（ocrEvalTrocrModelRef）
 * @param {string} params.imageDir / gtCsv / datasetId - Evaluationのdataset識別子
 * @returns {null | {benchmarkEngineKey: string, modelName: string, trocrModelRef: string, imageDir: string, gtCsv: string, datasetId: string}}
 *   Benchmarkが対応しないengine（例: easyocr）の場合はnull
 */
export function resolveEvaluationBenchmarkHandoff({
  engine,
  trainedModel = "",
  paddleModel = "",
  trocrModelSource = "manual",
  trocrSelectedModel = "",
  trocrModels = [],
  trocrModelRef = "",
  imageDir = "",
  gtCsv = "",
  datasetId = "",
} = {}) {
  const normalizedEngine = String(engine || "").trim().toLowerCase();
  const benchmarkEngineKey = ENGINE_TO_BENCHMARK_KEY[normalizedEngine];
  if (!benchmarkEngineKey) {
    return null;
  }

  let modelName = "";
  let resolvedTrocrModelRef = "";
  if (normalizedEngine === "tesseract") {
    modelName = String(trainedModel || "").trim();
    if (modelName === "latest") {
      // "latest"はEvaluation固有の特殊値（最新モデル）であり、Benchmarkの登録済みモデル
      // 選択肢には存在しない具体的な値ではない。推測で特定モデル名へ変換しない
      modelName = "";
    }
  } else if (normalizedEngine === "paddleocr") {
    modelName = String(paddleModel || "").trim();
    if (modelName === "latest") {
      modelName = "";
    }
  } else if (normalizedEngine === "trocr") {
    resolvedTrocrModelRef =
      trocrModelSource === "metadata"
        ? resolveSelectedTrocrModelRef(trocrModels, trocrSelectedModel)
        : normalizeTrocrModelRef(trocrModelRef);
  }

  return {
    benchmarkEngineKey,
    modelName,
    trocrModelRef: resolvedTrocrModelRef,
    imageDir: String(imageDir || "").trim(),
    gtCsv: String(gtCsv || "").trim(),
    datasetId: String(datasetId || "").trim(),
  };
}
