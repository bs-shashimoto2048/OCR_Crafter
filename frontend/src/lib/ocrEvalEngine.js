// Evaluation UI Generalization（Issue #83）の純ロジック。
//
// OcrEvaluationView.jsx（モデル評価画面）をTesseract専用からTesseract/PaddleOCR/
// EasyOCR/TrOCRの4Engine対応へ一般化するための、Engine別target構築・前処理モード制約を
// ここへ切り出す。Backend Multi-engine Evaluation API（Issue #79、
// services/evaluation_multi_engine.py）の既存契約に合わせるだけで、新しい評価ロジック・
// 新しいconfidence計算・新しいModel Resolverは一切実装しない。
//
// - Tesseract: 既存挙動を一切変更しない（学習前後比較=includeBase、options無し）。
// - PaddleOCR/EasyOCR/TrOCR: 学習前後比較の概念が無いためtarget1件のみ。
//   options（language/use_angle_cls・languages・device/local_files_only）は
//   build_predictor()（evaluation_multi_engine.py）が読むキーのみを組み立てる。
//
// TrOCRのmodel_ref解決は既存lib（inferenceModel.js/trocrModelMetadata.js、
// InferenceView.jsxが使うものと同じ純関数）をそのまま再利用し、判定基準を重複させない。

import { normalizeTrocrModelRef, trocrModelRefMissing } from "./inferenceModel.js";
import { resolveSelectedTrocrModelRef, trocrMetadataValidationError } from "./trocrModelMetadata.js";

// Evaluation対応済みEngine（Backend build_predictor()が受け付ける4Engine）。
// custom（分類モデル）はEvaluation Dispatcherに未登録のため含めない。
export const EVALUATION_ENGINE_IDS = ["tesseract", "paddleocr", "easyocr", "trocr"];

export function isEvaluationEngineId(value) {
  return EVALUATION_ENGINE_IDS.includes(value);
}

// 評価前処理モード（プロファイル）のうち、指定engineで選択可能なものを判定する。
// "training"/"step5"はTesseract学習後モデルのtraining_preprocessメタデータに依存する
// 概念であり、Backend（run_multi_engine_evaluation()）は非Tesseractengineを含む
// リクエストのpreprocess_mode="training"を明示的にValueErrorで拒否する
// （services/evaluation_multi_engine.py::_UNSUPPORTED_PREPROCESS_MODES）。
export function isPreprocessSourceAllowedForEngine(engine, source) {
  if (engine === "tesseract") {
    return true;
  }
  return source === "custom" || source === "none";
}

// engine切替時、現在選択中のsourceがそのengineで使えない場合のみ"none"へフォールバックする
// （使えるならそのまま維持し、無関係な設定を勝手に書き換えない）。
export function resolvePreprocessSourceForEngine(engine, currentSource) {
  return isPreprocessSourceAllowedForEngine(engine, currentSource) ? currentSource : "none";
}

// TrOCR評価対象のmodel_refが未解決（実行不可）かどうかを判定する。
// InferenceView.jsxの実行ボタン無効化判定（登録済みモデル方式/手動入力方式）と
// 同じ既存関数をそのまま再利用し、判定基準を重複定義しない。
export function isTrocrEvalModelUnresolved(modelSource, trocrModels, selectedModel, manualModelRef) {
  if (modelSource === "metadata") {
    return Boolean(trocrMetadataValidationError(trocrModels, selectedModel));
  }
  return trocrModelRefMissing("trocr", manualModelRef);
}

// Engine別のOcrEvalTarget[]（POST /api/ocr/evaluateのtargets）を構築する。
export function buildOcrEvalTargets({
  engine,
  includeBase = false,
  trainedModel = "latest",
  paddleModel = "latest",
  paddleLanguage = "en",
  paddleUseAngleCls = false,
  easyocrLangs = ["en"],
  trocrModelSource = "manual",
  trocrSelectedModel = "",
  trocrModels = [],
  trocrModelRef = "",
  trocrDevice = "",
  trocrLocalFilesOnly = false,
} = {}) {
  const normalizedEngine = isEvaluationEngineId(engine) ? engine : "tesseract";

  if (normalizedEngine === "tesseract") {
    // 既存挙動と1バイトも変えない（optionsフィールドを追加しない）。
    const targets = [];
    if (includeBase) {
      targets.push({ engine: "tesseract", model: "eng" });
    }
    targets.push({ engine: "tesseract", model: trainedModel || "latest" });
    return targets;
  }

  if (normalizedEngine === "paddleocr") {
    return [
      {
        engine: "paddleocr",
        model: paddleModel || "latest",
        options: { language: paddleLanguage || "en", use_angle_cls: Boolean(paddleUseAngleCls) },
      },
    ];
  }

  if (normalizedEngine === "easyocr") {
    const langs = Array.isArray(easyocrLangs) && easyocrLangs.length > 0 ? easyocrLangs : ["en"];
    return [{ engine: "easyocr", model: "latest", options: { languages: langs } }];
  }

  // trocr
  const resolvedModelRef =
    trocrModelSource === "metadata"
      ? resolveSelectedTrocrModelRef(trocrModels, trocrSelectedModel)
      : normalizeTrocrModelRef(trocrModelRef);
  const options = { local_files_only: Boolean(trocrLocalFilesOnly) };
  const device = String(trocrDevice || "").trim();
  if (device) {
    options.device = device;
  }
  return [{ engine: "trocr", model: resolvedModelRef, options }];
}
