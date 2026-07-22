import { useEffect, useMemo, useRef, useState } from "react";

import Header from "./components/Header";
import ExperimentalNotice from "./components/ExperimentalNotice";
import ViewErrorBoundary from "./components/ViewErrorBoundary";
import Sidebar from "./components/Sidebar";
import WorkflowProgress from "./components/WorkflowProgress";
import DashboardView from "./views/DashboardView";
import ImagesView from "./views/ImagesView";
import LabelingView from "./views/LabelingView";
import TrainingView from "./views/TrainingView";
import ModelsView from "./views/ModelsView";
import InferenceView from "./views/InferenceView";
import ExperimentsView from "./views/ExperimentsView";
import ReleasesView from "./views/ReleasesView";
import PreprocessView from "./views/PreprocessView";
import EvaluationView from "./views/EvaluationView";
import OcrEvaluationView from "./views/OcrEvaluationView";
import TrainingImageBuilderView from "./views/TrainingImageBuilderView";
import RapidOCRView from "./views/RapidOCRView";
import OcrBatchView from "./views/OcrBatchView";
import { API_BASE, imageUrl, request } from "./lib/api";
import { charCodepoints, confusionLabel } from "./lib/confusionFormat";
import { buildAugmentationPayload, defaultAugmentationState } from "./lib/augmentation";
import { viewBoundaryKey } from "./lib/viewKey";
import { lowercaseToggleApplicable } from "./lib/lowercase";
import {
  buildPreprocessPreviewPayload,
  buildPreprocessRunPayload,
  normalizePreprocessOverrides,
  preprocessRunConfirmText,
} from "./lib/preprocessRequest";
import {
  DEFAULT_PREPROCESS_PREDICT_SETTINGS,
  DEFAULT_PREPROCESS_UI_STATE,
  readPreprocessPredictSettings,
  readPreprocessPresets,
  readPreprocessUiState,
  writePreprocessPredictSettings,
  writePreprocessPresets,
  writePreprocessUiState,
} from "./lib/preprocessUiState";
import { createPreviewCache, makePreviewCacheKey } from "./lib/previewCache";
import {
  DEFAULT_EVAL_PREPROCESS,
  evalPreprocessModeForSource,
  evalPreprocessRequestObject,
  evalPreprocessSummary,
  readEvalPreprocess,
} from "./lib/evalPreprocess";

const viewMeta = {
  dashboard: { title: "ダッシュボード", subtitle: "OCR学習ワークフロー全体を管理" },
  images: { title: "画像", subtitle: "画像取り込みと一覧確認" },
  preprocess: { title: "前処理設定", subtitle: "前処理パラメータ設定とプレビュー" },
  labeling: { title: "ラベル編集", subtitle: "数字ラベル編集" },
  training: { title: "学習", subtitle: "学習ジョブ実行とログ監視" },
  "ocr-training": { title: "学習", subtitle: "OCR認識モデル: OCRデータ作成・学習" },
  "cls-training": { title: "学習", subtitle: "実験機能（分割学習）: 前処理・データセット作成・学習" },
  models: { title: "モデル", subtitle: "保存済みモデル管理" },
  "ocr-models": { title: "モデル", subtitle: "OCR認識モデルの管理" },
  experiments: { title: "実験管理", subtitle: "学習条件・結果・考察の一元管理と実験比較" },
  releases: { title: "リリース管理", subtitle: "モデルのライフサイクル管理・本番適用・配布" },
  "cls-models": { title: "モデル", subtitle: "実験機能（分割学習）: モデル管理" },
  inference: { title: "推論", subtitle: "画像推論と精度確認" },
  "ocr-inference": { title: "推論", subtitle: "OCR認識モデルで推論" },
  "cls-inference": { title: "推論", subtitle: "実験機能（分割学習）: 推論" },
  evaluation: { title: "評価", subtitle: "精度評価と誤認識分析" },
  "cls-evaluation": { title: "評価", subtitle: "実験機能（分割学習）: 精度評価" },
  "rapid-ocr": { title: "OCR修正", subtitle: "キーボード中心でOCR結果を素早く修正" },
  "ocr-batch": { title: "バッチ推論", subtitle: "OCR認識モデルで複数画像を一括推論" },
  "ocr-eval": { title: "モデル評価", subtitle: "学習前後のOCRモデルを同一データで比較評価" },
  "image-builder-step1": { title: "データ作成", subtitle: "Step1: 画像指定とリサイズ" },
  "image-builder-step2": { title: "データ作成", subtitle: "Step2: YOLO検出" },
  "image-builder-step3": { title: "データ作成", subtitle: "Step3: Bounding Box選択" },
  "image-builder-step4": { title: "データ作成", subtitle: "Step4: クロップ出力" },
  "image-builder-step5": { title: "データ作成", subtitle: "Step5: 評価用データ作成" },
};

// 実験機能配下の view id。今後 TrOCR / PARSeq 等を追加する場合はここに足すだけで
// 開発中バナー(ExperimentalNotice)が共通表示される。
const EXPERIMENTAL_VIEWS = new Set(["cls-training", "cls-models", "cls-inference", "cls-evaluation"]);

// ワークフロー進行状況の工程ナビ定義（viewId 付き = クリックで遷移可能）。
// OCR認識モデル系と実験機能系は混ぜず、現在の系統内のみ表示する。
const OCR_WORKFLOW_VIEWS = ["ocr-training", "ocr-models", "ocr-inference", "rapid-ocr", "ocr-batch", "ocr-eval"];
const OCR_WORKFLOW_STEP_DEFS = [
  { id: "ocr-training", viewId: "ocr-training", label: "データ作成・学習" },
  { id: "ocr-models", viewId: "ocr-models", label: "モデル管理" },
  { id: "ocr-inference", viewId: "ocr-inference", label: "推論" },
  { id: "rapid-ocr", viewId: "rapid-ocr", label: "OCR修正" },
  { id: "ocr-batch", viewId: "ocr-batch", label: "バッチ推論" },
  { id: "ocr-eval", viewId: "ocr-eval", label: "モデル評価" },
];
const CLS_WORKFLOW_VIEWS = ["cls-training", "cls-models", "cls-inference", "cls-evaluation"];
const CLS_WORKFLOW_STEP_DEFS = [
  { id: "cls-training", viewId: "cls-training", label: "分割学習" },
  { id: "cls-models", viewId: "cls-models", label: "モデル管理" },
  { id: "cls-inference", viewId: "cls-inference", label: "推論" },
  { id: "cls-evaluation", viewId: "cls-evaluation", label: "評価" },
];

// プリセットはプロジェクト単位保存へ移行済み（lib/preprocessUiState.js。
// 旧・全プロジェクト共通キー ocr_preprocess_presets_v1 は初回読み込み時にコピー移行）
// 前処理画面の比較用推論スロット（モデル2/3）。モデル1は既存の単一推論設定を継続使用
const PREPROCESS_EXTRA_SLOTS_STORAGE_KEY = "ocr_preprocess_extra_slots_by_project_v1";

// モデル管理画面: 表示名(Alias)とモデル別評価履歴（どちらもUI側のjson保存。API変更なし）
const MODEL_ALIASES_STORAGE_KEY = "ocr_model_aliases_by_project_v1";
const MODEL_EVAL_HISTORY_STORAGE_KEY = "ocr_model_eval_history_by_project_v1";

function readProjectScopedStorage(storageKey, projectId) {
  try {
    const raw = localStorage.getItem(storageKey);
    const map = raw ? JSON.parse(raw) : {};
    const value = map?.[projectId];
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeProjectScopedStorage(storageKey, projectId, value) {
  try {
    const raw = localStorage.getItem(storageKey);
    const map = raw ? JSON.parse(raw) : {};
    map[projectId] = value;
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // localStorage が使えない環境では保存なしで動作継続
  }
}

// 比較スロットを /preprocess/preview のリクエストフィールドへ変換（前処理画面・ラベル編集共通）
function extraSlotRequestFields(slot) {
  const engine = String(slot?.engine || "tesseract");
  const langs =
    engine === "easyocr" || engine === "paddleocr" ? String(slot?.langs || "en").trim() || "en" : "en";
  return {
    engine,
    model: engine === "easyocr" ? "latest" : String(slot?.model || "latest"),
    model_type: null,
    easyocr_langs: langs,
    // 小文字設定はスロット単位。非対象（Tesseract等・非ラテン言語）は常にtrueへ正規化する
    include_lowercase: lowercaseToggleApplicable(engine, langs) ? slot?.includeLowercase !== false : true,
  };
}
const PREPROCESS_PARAMS_BY_PROJECT_STORAGE_KEY = "ocr_preprocess_params_by_project_v1";
const INCLUDE_LOWERCASE_BY_PROJECT_STORAGE_KEY = "ocr_include_lowercase_by_project_v1";
const CANDIDATE_DICT_BY_PROJECT_STORAGE_KEY = "ocr_candidate_dict_by_project_v1";
// OCR候補辞書の既定値（ファイル未選択）。entriesはプロジェクト別にlocalStorageへ保存する
const DEFAULT_CANDIDATE_DICT = {
  source_name: "",
  entries: [],
  stats: null,
  max_candidates: 3,
  min_similarity: 60,
};
const TRAINING_SESSION_BY_PROJECT_STORAGE_KEY = "ocr_training_session_by_project_v1";
const LAST_PROJECT_STORAGE_KEY = "ocr_last_project_v1";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "ocr_sidebar_collapsed_v1";
const NOTICE_AUTO_HIDE_MS = 4500;
const EASYOCR_LANGUAGE_OPTIONS = [
  "en",
  "ja",
  "ko",
  "ch_sim",
  "ch_tra",
  "fr",
  "de",
  "es",
  "it",
  "pt",
  "ru",
];
const OCR_TRAINING_PRESET_MAC_SAFE = "mac_safe";
const OCR_TRAINING_PRESET_RTX_TRAIN = "rtx_train";
const DEFAULT_PREPROCESS_PARAMS = {
  ratio_threshold: 1.6,
  single_size: 64,
  wide_height: 48,
  wide_keep_ratio: true,
  // 照明ムラ補正（既存プロジェクトへ影響しないよう初期はOFF）
  illumination_enabled: false,
  illumination_method: "gaussian",
  illumination_background_size: 81,
  illumination_strength: 1.0,
  // 手動マスク補正（マスク自体は画像単位でサーバー保存。ここは共通設定のみ）
  manual_mask_enabled: false,
  manual_mask_mode: "point",
  manual_mask_fill: "white",
  manual_mask_timing: "post",
  manual_mask_threshold: 80,
  threshold_type: "binary",
  threshold_value: 128,
  // 適応的しきい値のパラメータ（サーバー既定と同値。adaptive選択時のみUI表示）
  threshold_block_size: 35,
  threshold_c: 11,
  clahe_clip_limit: 1.0,
  clahe_tile_grid_size: 2,
  sharpen_enabled: true,
  sharpen_amount: 0.2,
  sharpen_sigma: 0.5,
  gamma_enabled: false,
  gamma_value: 1.0,
  morph_enabled: false,
  morph_method: "close",
  morph_ksize: 3,
  morph_iterations: 1,
  unsharp_enabled: false,
  unsharp_amount: 0.8,
  unsharp_radius: 1.0,
  unsharp_threshold: 0,
  bilateral_enabled: false,
  bilateral_diameter: 5,
  bilateral_sigma_color: 50,
  bilateral_sigma_space: 50,
  local_contrast_enabled: false,
  local_contrast_clip_limit: 2.0,
  local_contrast_tile_grid_size: 8,
  crop_margin_enabled: false,
  crop_margin_threshold: 245,
  crop_margin_margin: 2,
  hist_equalize_enabled: false,
  stroke_boost_enabled: true,
  stroke_boost_method: "close",
  stroke_boost_ksize: 1,
  stroke_boost_iterations: 1,
  denoise_method: "gaussian",
  denoise_ksize: 1,
  deskew_enabled: true,
};
const OCR_CHARSET_DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
// Tesseract学習対象文字セット: A-Z / 0-9 / 小文字筆記体 k,l,t
const TESSERACT_CHARSET_DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt";
// 学習回数の既定値。Tesseractは最大iterationとして扱われるためFine-tuning向けの1500を既定にする
// （PaddleOCR等のEpoch既定30には影響しない。ユーザー変更済みの値は上書きしない）
const OCR_EPOCHS_DEFAULT = 30;
const TESSERACT_MAX_ITERATIONS_DEFAULT = 1500;
// 推論・評価時whitelist既定（実運用で出現しうる文字。学習対象とは別概念）
const TESSERACT_WHITELIST_DEFAULT = TESSERACT_CHARSET_DEFAULT;

function nowLabel() {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

function summarizePpocrLogLine(rawLine) {
  const line = String(rawLine || "");
  if (!line.includes("ppocr")) {
    return line;
  }

  const tsMatch = line.match(/^\[(\d{4}\/\d{2}\/\d{2}\s+(\d{2}:\d{2}:\d{2}))\]/);
  const time = tsMatch?.[2] || "";
  const prefix = time ? `[${time}] ` : "";
  const body = line.replace(/^\[[^\]]+\]\s*ppocr\s+INFO:\s*/, "").trim();

  const epochMatch = body.match(
    /epoch:\s*\[(\d+)\/(\d+)\],\s*global_step:\s*([\d.]+),\s*lr:\s*([\d.eE+-]+),\s*acc:\s*([\d.eE+-]+),\s*norm_edit_dis:\s*([\d.eE+-]+),\s*loss:\s*([\d.eE+-]+),\s*avg_reader_cost:\s*([\d.eE+-]+)\s*s,\s*avg_batch_cost:\s*([\d.eE+-]+)\s*s,\s*avg_samples:\s*([\d.eE+-]+),\s*ips:\s*([\d.eE+-]+)\s*samples\/s,\s*eta:\s*([0-9:]+)/
  );
  if (epochMatch) {
    const [
      ,
      epoch,
      totalEpoch,
      step,
      lr,
      acc,
      normEditDis,
      loss,
      readerCost,
      batchCost,
      avgSamples,
      ips,
      eta,
    ] = epochMatch;
    const accValue = Number(acc);
    const lossVal = Number(loss).toFixed(4);
    const reader = Number(readerCost).toFixed(3);
    const batch = Number(batchCost).toFixed(3);
    const speed = Number(ips).toFixed(2);
    const lrValue = Number(lr);
    const parts = [
      `${prefix}学習 ${epoch}/${totalEpoch}`,
      `step ${step}`,
      `損失 ${lossVal}`,
      `文字一致度 ${normEditDis}`,
      `読込 ${reader}s`,
      `バッチ ${batch}s`,
      `平均${avgSamples}件`,
      `${speed}枚/秒`,
      `残り ${eta}`,
    ];
    // acc=0% が長く続くケースが多く監視ノイズになるため、変化がある時のみ表示
    if (Number.isFinite(accValue) && accValue > 0) {
      parts.splice(3, 0, `精度 ${(accValue * 100).toFixed(2)}%`);
    }
    // 既定の固定学習率(0.0005)は情報量が低いため非表示、変更時のみ表示
    if (Number.isFinite(lrValue) && Math.abs(lrValue - 0.0005) > 1e-12) {
      parts.splice(parts.length - 1, 0, `学習率 ${lr}`);
    }
    return parts.join(" | ");
  }

  const saveMatch = body.match(/^save model in\s+(.+)$/i);
  if (saveMatch) {
    const path = saveMatch[1];
    const label = path.endsWith("/latest") ? "latest" : path.split("/").pop() || "checkpoint";
    return `${prefix}モデル保存 | ${label} | ${path}`;
  }

  return `${prefix}${body}`;
}

function modelTypeFromModelName(modelName) {
  const stem = String(modelName || "").split("/").pop() || "";
  if (!stem.includes("_")) {
    return "";
  }
  return stem.split("_", 1)[0];
}

function loadSessionStorageJson(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSessionStorageJson(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore session storage write error
  }
}

function loadLastProjectId() {
  try {
    return window.sessionStorage.getItem(LAST_PROJECT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export default function App() {
  const [activeView, setActiveView] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // ラベル編集の「推論設定を開く」経由で前処理設定を開いたときの戻り先（通常遷移では null）
  const [preprocessReturnView, setPreprocessReturnView] = useState(null);

  useEffect(() => {
    // 前処理設定画面を離れたら戻り先を破棄する（サイドバー等の通常遷移で復活させない）
    if (activeView !== "preprocess" && preprocessReturnView) {
      setPreprocessReturnView(null);
    }
  }, [activeView, preprocessReturnView]);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // localStorage が使えない環境では状態保持なしで動作継続
      }
      return next;
    });
  }
  const [notice, setNotice] = useState(null);

  const [projects, setProjects] = useState([]);
  const [projectSummaries, setProjectSummaries] = useState({});
  const [projectId, setProjectId] = useState("");
  // レース対策用: 非同期応答の反映可否判定に最新の projectId を参照する
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  // 現在の images 一覧がどのプロジェクトのものかを記録（切替直後の不整合描画防止）
  const [imageListProjectId, setImageListProjectId] = useState("");
  const [newProjectId, setNewProjectId] = useState("");

  const [sourceDir, setSourceDir] = useState("");
  const [images, setImages] = useState([]);
  const [labelDrafts, setLabelDrafts] = useState({});
  const [labelUppercase, setLabelUppercase] = useState(false);
  const [imageShapes, setImageShapes] = useState({});
  const [imageVersion, setImageVersion] = useState(0);
  // 画像単位のキャッシュキー（回転時に対象画像のサムネイルだけ更新するため）
  const [imageVersions, setImageVersions] = useState({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [workflowState, setWorkflowState] = useState({
    refreshed: false,
    preprocessed: false,
    datasetBuilt: false,
    trainingStarted: false,
  });

  const [trainingFamily, setTrainingFamily] = useState("classification");
  const [modelType, setModelType] = useState("square");
  const [modelTypes, setModelTypes] = useState([]);
  const [trainRatio, setTrainRatio] = useState(0.7);
  const [valRatio, setValRatio] = useState(0.2);
  const [testRatio, setTestRatio] = useState(0.1);
  const [epochs, setEpochs] = useState(OCR_EPOCHS_DEFAULT);
  const [batchSize, setBatchSize] = useState(16);
  const [learningRate, setLearningRate] = useState(0.001);
  const [clsInitSourceType, setClsInitSourceType] = useState("imagenet");
  const [clsInitSourceValue, setClsInitSourceValue] = useState("latest");
  const [freezeBackboneEpochs, setFreezeBackboneEpochs] = useState(1);
  const [backboneLrScale, setBackboneLrScale] = useState(0.1);
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState("idle");
  const [jobFamily, setJobFamily] = useState("classification");
  // 実行中ジョブの詳細（実行スナップショット表示・開始日時・最大iteration用）。ポーリングで更新
  const [jobInfo, setJobInfo] = useState(null);
  // 停止要求中（stopping状態の表示・二重停止防止）
  const [stopRequested, setStopRequested] = useState(false);
  // 学習開始API応答待ち（押下直後にUIをロックするため）
  const [startingTraining, setStartingTraining] = useState(false);
  const [logs, setLogs] = useState([]);

  const [ocrEngine, setOcrEngine] = useState("paddleocr");
  const [ocrCharset, setOcrCharset] = useState(OCR_CHARSET_DEFAULT);
  // 実験情報（Tesseract学習時にモデルメタへ保存。モデル比較の学習条件比較・次回学習提案で使用）
  const [tessExperimentName, setTessExperimentName] = useState("");
  const [tessParentModelId, setTessParentModelId] = useState("");
  const [tessTrainingNote, setTessTrainingNote] = useState("");
  const [ocrMaxTextLength, setOcrMaxTextLength] = useState(8);
  const [ocrImageShape, setOcrImageShape] = useState("1,48,320");
  // 学習時オーグメンテーション（新形式: preset/変換別設定/生成倍率。既定=なし）
  const [ocrAugmentation, setOcrAugmentation] = useState(() => defaultAugmentationState());
  const [ocrAugPreview, setOcrAugPreview] = useState(null);
  const [ocrAugPreviewLoading, setOcrAugPreviewLoading] = useState(false);
  // データ分割: Seed（再現性）・分割予定枚数プレビュー・比率エラー（入力欄付近へ表示）
  const [ocrSplitSeed, setOcrSplitSeed] = useState(42);
  const [ocrSplitPreview, setOcrSplitPreview] = useState(null);
  const [ocrSplitPreviewLoading, setOcrSplitPreviewLoading] = useState(false);
  const [ocrRatioError, setOcrRatioError] = useState("");
  const [ocrDatasetDir, setOcrDatasetDir] = useState("");
  const [ocrDatasetCreateMode, setOcrDatasetCreateMode] = useState("new");
  const [ocrDatasetInfo, setOcrDatasetInfo] = useState(null);
  const [ocrFromLogsOnlyInvalid, setOcrFromLogsOnlyInvalid] = useState(true);
  const [ocrFromLogsIncludeCorrected, setOcrFromLogsIncludeCorrected] = useState(true);
  const [ocrInitSourceType, setOcrInitSourceType] = useState("scratch");
  const [ocrInitSourceValue, setOcrInitSourceValue] = useState("");
  const [ocrTrainDevice, setOcrTrainDevice] = useState("auto");
  const [ocrTrainNumWorkers, setOcrTrainNumWorkers] = useState(0);
  const [ocrEvalNumWorkers, setOcrEvalNumWorkers] = useState(0);
  const [ocrSaveEpochStep, setOcrSaveEpochStep] = useState(10);
  const [ocrAutoBatchSize, setOcrAutoBatchSize] = useState(false);
  const [ocrUseAmp, setOcrUseAmp] = useState(false);
  const [ocrPinMemory, setOcrPinMemory] = useState(false);
  const [ocrPersistentWorkers, setOcrPersistentWorkers] = useState(false);
  const [systemCheck, setSystemCheck] = useState(null);

  const [models, setModels] = useState([]);
  const [modelInfos, setModelInfos] = useState({});
  const [officialPaddleModels, setOfficialPaddleModels] = useState([]);
  const [latestModels, setLatestModels] = useState({ any: "", byType: {}, ocrPaddle: "", ocrTesseract: "" });
  const classificationModels = useMemo(
    () =>
      models.filter((name) => {
        const info = modelInfos[name] || {};
        return (info.training_family || "classification") === "classification";
      }),
    [models, modelInfos]
  );
  const ocrPaddleModels = useMemo(
    () =>
      models.filter((name) => {
        const info = modelInfos[name] || {};
        return info.training_family === "ocr" && info.engine === "paddleocr" && Boolean(info.ocr_inference_ready);
      }),
    [models, modelInfos]
  );
  const paddleOcrModelOptions = useMemo(
    () => [...new Set([...ocrPaddleModels, ...officialPaddleModels])],
    [ocrPaddleModels, officialPaddleModels]
  );
  const ocrModels = useMemo(
    () =>
      models.filter((name) => {
        const info = modelInfos[name] || {};
        // OCR認識モデル一覧: PaddleOCR(.ocr.json, export済み) と Tesseract(.tess.json) を含む
        if (info.training_family === "tesseract") {
          return true;
        }
        return info.training_family === "ocr" && (info.engine !== "paddleocr" || Boolean(info.ocr_inference_ready));
      }),
    [models, modelInfos]
  );
  const tesseractModels = useMemo(
    () =>
      models.filter((name) => {
        const info = modelInfos[name] || {};
        return info.engine === "tesseract" && Boolean(info.ocr_inference_ready);
      }),
    [models, modelInfos]
  );

  const [inferModelType, setInferModelType] = useState("square");
  const [inferModel, setInferModel] = useState("latest");
  const [inferEngine, setInferEngine] = useState("custom");
  const [inferEasyOcrLangs, setInferEasyOcrLangs] = useState(["en"]);
  const [inferPaddleModel, setInferPaddleModel] = useState("latest");
  const [inferTesseractModel, setInferTesseractModel] = useState("latest");
  // 推論前処理モード（Tesseract）。""=自動（学習時前処理の記録があればtraining=既定 / なければ従来動作）
  const [inferPreprocessMode, setInferPreprocessMode] = useState("");
  // 「latest」選択時に実際に使われるTesseractモデル（学習時前処理の記録有無の判定用）
  const inferTessResolvedModel = useMemo(() => {
    if (inferTesseractModel && inferTesseractModel !== "latest") return inferTesseractModel;
    const sorted = [...tesseractModels].sort((a, b) =>
      String(modelInfos[b]?.created_at || "").localeCompare(String(modelInfos[a]?.created_at || ""))
    );
    return sorted[0] || "";
  }, [inferTesseractModel, tesseractModels, modelInfos]);
  const inferTessPreRecorded = Boolean(modelInfos[inferTessResolvedModel]?.training_preprocess_hash);
  // 自動時: 記録があれば学習時前処理を使用（運用時に学習条件と異なる入力を与えないため）。
  // 記録がない旧モデルは従来動作（推測で前処理を割り当てない）
  const inferEffectivePreprocessMode = inferPreprocessMode || (inferTessPreRecorded ? "training" : "");
  const [ocrEvalImageDir, setOcrEvalImageDir] = useState("");
  const [ocrEvalGtCsv, setOcrEvalGtCsv] = useState("");
  // 評価データセット（Step5で作成）の一覧・選択・学習データ重複チェック
  const [ocrEvalDatasets, setOcrEvalDatasets] = useState([]);
  const [ocrEvalDatasetId, setOcrEvalDatasetId] = useState("");
  const [ocrEvalOverlap, setOcrEvalOverlap] = useState(null);
  // 評価時のOCR前処理（Step5と同じ設定定義を共用）。
  // source: training=学習時前処理（既定） / none=前処理なし / step5=Step5設定と同期 / custom=上書き
  const [ocrEvalPreSource, setOcrEvalPreSource] = useState("training");
  const [ocrEvalPreCustom, setOcrEvalPreCustom] = useState({ ...DEFAULT_EVAL_PREPROCESS });

  // プロジェクト切替時は評価データセットの選択・一覧をリセット（他プロジェクトのデータを混在させない）
  useEffect(() => {
    setOcrEvalDatasets([]);
    setOcrEvalDatasetId("");
    setOcrEvalOverlap(null);
    setOcrEvalPreSource("training");
    setOcrEvalPreCustom({ ...DEFAULT_EVAL_PREPROCESS });
  }, [projectId]);

  // Step5同期時に参照するStep5の保存済み前処理設定（モデル評価画面表示中に読み直す）
  const step5EvalPreprocess = useMemo(
    () => readEvalPreprocess(projectId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, activeView]
  );
  // 評価で実際に使う前処理設定（sourceに応じて解決）
  const ocrEvalEffectivePreprocess =
    ocrEvalPreSource === "step5" ? step5EvalPreprocess : ocrEvalPreSource === "custom" ? ocrEvalPreCustom : null;

  // モデル評価画面を開いたときに一覧を取得（削除・作成後の再表示にも追従）
  useEffect(() => {
    if (activeView === "ocr-eval") {
      loadOcrEvalDatasets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, projectId]);
  const [ocrEvalTrainedModel, setOcrEvalTrainedModel] = useState("latest");
  const [ocrEvalIncludeBase, setOcrEvalIncludeBase] = useState(true);
  const [ocrEvalWhitelistMode, setOcrEvalWhitelistMode] = useState("default"); // default | none | custom
  const [ocrEvalWhitelistCustom, setOcrEvalWhitelistCustom] = useState(TESSERACT_WHITELIST_DEFAULT);
  const [ocrEvalLoading, setOcrEvalLoading] = useState(false);
  const [ocrEvalResult, setOcrEvalResult] = useState(null);
  const [inferFile, setInferFile] = useState(null);
  const [inferFileName, setInferFileName] = useState("");
  const [inferPreviewUrl, setInferPreviewUrl] = useState("");
  const [inferRotation, setInferRotation] = useState(0);
  const [inferLoading, setInferLoading] = useState(false);
  const [inferResult, setInferResult] = useState(null);

  const [evalDataset, setEvalDataset] = useState("val");
  const [evalDatasetOptions, setEvalDatasetOptions] = useState(["val", "test"]);
  const [evalModelType, setEvalModelType] = useState("square");
  const [evalModel, setEvalModel] = useState("latest");
  const [evalUseOverrides, setEvalUseOverrides] = useState(false);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalResult, setEvalResult] = useState(null);

  const [preprocessParams, setPreprocessParams] = useState(DEFAULT_PREPROCESS_PARAMS);
  const [preprocessImage, setPreprocessImage] = useState("");
  const [preprocessPredictEngine, setPreprocessPredictEngine] = useState("easyocr");
  const [preprocessPredictModel, setPreprocessPredictModel] = useState("latest");
  const [preprocessPredictPaddleModel, setPreprocessPredictPaddleModel] = useState("latest");
  const [preprocessPredictTesseractModel, setPreprocessPredictTesseractModel] = useState("latest");
  const [preprocessPredictModelType, setPreprocessPredictModelType] = useState("square");
  const [preprocessPredictEasyOcrLangs, setPreprocessPredictEasyOcrLangs] = useState(["en"]);
  // 小文字を出力に含める（EasyOCR/PaddleOCR）。未設定=ONで既存動作を維持
  const [preprocessPredictIncludeLowercase, setPreprocessPredictIncludeLowercase] = useState(true);
  // OCR結果確認（プレビュー推論）のTesseract用 PSM / whitelist（プロジェクト別に保存）
  const [preprocessPredictPsm, setPreprocessPredictPsm] = useState(DEFAULT_PREPROCESS_PREDICT_SETTINGS.psm);
  const [preprocessPredictWhitelist, setPreprocessPredictWhitelist] = useState("");
  // 前処理画面のUI状態（折りたたみセクション・基本/詳細モード。プロジェクト別に保存・検索文字列は保存しない）
  const [preprocessUiState, setPreprocessUiState] = useState({ ...DEFAULT_PREPROCESS_UI_STATE });
  const [inferIncludeLowercase, setInferIncludeLowercase] = useState(true);
  // OCR候補辞書（ラベル編集の近似候補表示用。プロジェクト単位で保存）
  const [candidateDict, setCandidateDict] = useState({ ...DEFAULT_CANDIDATE_DICT });
  const [preprocessPreview, setPreprocessPreview] = useState(null);
  const [preprocessLoading, setPreprocessLoading] = useState(false);
  const [preprocessError, setPreprocessError] = useState("");
  // 比較用の追加推論スロット（最大2つ = モデル2/3）とその推論結果
  const [preprocessExtraSlots, setPreprocessExtraSlots] = useState([]);
  const [preprocessExtraPreviews, setPreprocessExtraPreviews] = useState([]);
  // 手動マスク更新カウンタ（マスクはサーバー保存のため、保存後にプレビューを再実行するトリガー）
  const [manualMaskVersion, setManualMaskVersion] = useState(0);
  const [preprocessPresets, setPreprocessPresets] = useState({});
  // 実験管理（Experiment Tracking）。実験一覧はサーバー保存（experiments.json）・EXP-0001形式
  const [experiments, setExperiments] = useState([]);
  const [experimentsLoading, setExperimentsLoading] = useState(false);
  // モデルカルテ→実験管理の遷移で対象実験を選択・スクロールするためのフォーカス指定
  const [focusExperimentId, setFocusExperimentId] = useState("");
  // 実験→生成モデルの遷移でモデル管理のカルテを開くためのリクエスト
  const [modelDetailRequest, setModelDetailRequest] = useState(null);
  // リリース管理（Model Release Management）。状態・履歴はサーバー保存（releases.json）
  const [releases, setReleases] = useState({ production: "", statuses: {}, history: [] });
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [rapidPreprocessEnabled, setRapidPreprocessEnabled] = useState(true);

  const lastStatusRef = useRef("");
  const lastMessageRef = useRef("");
  const stopPollingRef = useRef(false);
  const preprocessParamsByProjectRef = useRef({});
  const skipPreprocessPersistRef = useRef(false);
  const noticeTimerRef = useRef(null);
  const trainingSessionByProjectRef = useRef(loadSessionStorageJson(TRAINING_SESSION_BY_PROJECT_STORAGE_KEY));
  const ocrRuntimeDefaultsAppliedRef = useRef(false);

  function pushLog(line) {
    setLogs((prev) => [...prev.slice(-120), `[${nowLabel()}] ${line}`]);
  }

  function clearNotice() {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice(null);
  }

  function notify(kind, text) {
    if (!text) {
      clearNotice();
      return;
    }
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice({ kind, text });
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, NOTICE_AUTO_HIDE_MS);
  }

  useEffect(() => {
    clearNotice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    },
    []
  );

  function resetTrainingLog(initialLine = "") {
    stopPollingRef.current = true;
    setJobId("");
    setJobStatus("idle");
    setJobFamily("classification");
    lastStatusRef.current = "";
    lastMessageRef.current = "";
    if (initialLine) {
      setLogs([`[${nowLabel()}] ${initialLine}`]);
      return;
    }
    setLogs([]);
  }

  function persistTrainingSession(targetProjectId, nextSession) {
    const normalizedProjectId = String(targetProjectId || "");
    const nextMap = { ...trainingSessionByProjectRef.current };
    if (!normalizedProjectId) {
      trainingSessionByProjectRef.current = nextMap;
      return;
    }
    if (nextSession) {
      nextMap[normalizedProjectId] = nextSession;
    } else {
      delete nextMap[normalizedProjectId];
    }
    trainingSessionByProjectRef.current = nextMap;
    saveSessionStorageJson(TRAINING_SESSION_BY_PROJECT_STORAGE_KEY, nextMap);
  }

  async function exitApplication() {
    const confirmed = window.confirm("フロントエンドとバックエンドを終了します。よろしいですか？");
    if (!confirmed) {
      return;
    }

    try {
      const parsedPort = Number.parseInt(window.location.port || "", 10);
      const frontendPort = Number.isFinite(parsedPort) ? parsedPort : null;
      await request("/system/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontend_port: frontendPort }),
      });
      notify("info", "アプリを終了しています...");
      setTimeout(() => {
        window.close();
        window.location.href = "about:blank";
      }, 200);
    } catch (error) {
      notify("error", error.message);
    }
  }

  function persistPreprocessPresets(next) {
    setPreprocessPresets(next);
    // プリセットはプロジェクト単位で保存（旧・全プロジェクト共通キーは読み込み時に移行済み）
    writePreprocessPresets(projectId, next);
  }

  async function loadProjects(preferredProjectId = projectId || loadLastProjectId()) {
    const data = await request("/projects");
    const items = data.items || [];
    const summaries = Array.isArray(data.summaries) ? data.summaries : [];
    const summaryMap = {};
    for (const row of summaries) {
      const pid = String(row?.project_id || "");
      if (!pid) continue;
      summaryMap[pid] = {
        images: Number(row?.images || 0),
        labeled: Number(row?.labeled || 0),
        ocr_confirmed: Number(row?.ocr_confirmed || 0),
        ocr_pending: Number(row?.ocr_pending || 0),
        models: Number(row?.models || 0),
      };
    }
    setProjectSummaries(summaryMap);
    setProjects(items);
    let nextProjectId = preferredProjectId;
    if (items.length === 0) {
      nextProjectId = "";
    } else if (!nextProjectId || !items.includes(nextProjectId)) {
      nextProjectId = items[0];
    }
    setProjectId(nextProjectId);
    return { items, nextProjectId };
  }

  async function loadSystemCheck() {
    const data = await request("/api/system/check");
    setSystemCheck(data || null);
    if (!ocrRuntimeDefaultsAppliedRef.current && data && typeof data === "object") {
      const preset = data.recommended_preset && typeof data.recommended_preset === "object" ? data.recommended_preset : {};
      const nextDevice = String(preset.device || data.default_device || "auto").trim().toLowerCase();
      const toInt = (value, fallback) => {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) return fallback;
        return parsed;
      };
      setOcrTrainDevice(nextDevice === "gpu" ? "gpu" : nextDevice === "cpu" ? "cpu" : "auto");
      setOcrAutoBatchSize(Boolean(preset.auto_batch_size ?? data.default_auto_batch_size ?? false));
      setOcrTrainNumWorkers(Math.max(0, toInt(preset.train_num_workers ?? data.default_train_num_workers, 0)));
      setOcrEvalNumWorkers(Math.max(0, toInt(preset.eval_num_workers ?? data.default_eval_num_workers, 0)));
      setOcrSaveEpochStep(Math.max(1, toInt(preset.save_epoch_step ?? data.default_save_epoch_step, 10)));
      setOcrUseAmp(Boolean(preset.use_amp ?? data.default_use_amp ?? false));
      setOcrPinMemory(Boolean(preset.pin_memory ?? data.default_pin_memory ?? false));
      setOcrPersistentWorkers(Boolean(preset.persistent_workers ?? data.default_persistent_workers ?? false));
      if (preset.batch_size != null) {
        setBatchSize(Math.max(1, toInt(preset.batch_size, 16)));
      }
      ocrRuntimeDefaultsAppliedRef.current = true;
    }
    return data || null;
  }

  async function loadImages(targetProjectId = projectId) {
    if (!targetProjectId) {
      setImages([]);
      setImageListProjectId("");
      setLabelDrafts({});
      setSelectedIndex(0);
      return;
    }
    const pid = encodeURIComponent(targetProjectId);
    const data = await request(`/images?project_id=${pid}`);
    // 取得中にプロジェクトが切り替わっていたら旧応答を反映しない（レース対策）
    if (projectIdRef.current !== targetProjectId) {
      return;
    }
    const items = data.items || [];
    setImages(items);
    setImageListProjectId(targetProjectId);

    const drafts = {};
    for (const item of items) {
      drafts[item.image] = item.label || "";
    }
    setLabelDrafts(drafts);

    setSelectedIndex((prev) => {
      if (items.length === 0) {
        return 0;
      }
      return Math.min(prev, items.length - 1);
    });
  }

  async function loadModels(targetProjectId = projectId) {
    if (!targetProjectId) {
      setModels([]);
      setModelInfos({});
      setOfficialPaddleModels([]);
      setLatestModels({ any: "", byType: {}, ocrPaddle: "", ocrTesseract: "" });
      setModelTypes([]);
      return;
    }
    const pid = encodeURIComponent(targetProjectId);
    const [modelsData, typesData, infosData, officialData] = await Promise.all([
      request(`/models?project_id=${pid}`),
      request(`/model-types?project_id=${pid}`),
      request(`/models/info?project_id=${pid}`).catch(() => ({ items: [] })),
      request("/api/ocr/models/official").catch(() => ({ items: [] })),
    ]);
    const modelItems = modelsData.items || [];
    const types = typesData.items || [];
    const infoItems = infosData.items || [];
    const infoMap = {};
    for (const item of infoItems) {
      if (!item?.name) continue;
      infoMap[item.name] = item;
    }
    const inferredTypes = modelItems
      .map((name) => {
        const info = infoMap[name] || {};
        if ((info.training_family || "classification") !== "classification") {
          return "";
        }
        const stem = String(name || "").split("/").pop() || "";
        if (!stem.includes("_")) {
          return "";
        }
        return stem.split("_", 1)[0];
      })
      .filter(Boolean);
    const mergedTypes = [...new Set([...types, ...inferredTypes, "square", "wide"])];
    setModels(modelItems);
    setModelInfos(infoMap);
    setModelTypes(mergedTypes);
    setOfficialPaddleModels(Array.isArray(officialData?.items) ? officialData.items : []);

    const latestAny = await request(`/models/latest?project_id=${pid}`)
      .then((r) => r.model || "")
      .catch(() => "");

    const latestEntries = await Promise.all(
      mergedTypes.map(async (type) => {
        const model = await request(`/models/latest?project_id=${pid}&model_type=${encodeURIComponent(type)}`)
          .then((r) => r.model || "")
          .catch(() => "");
        return [type, model];
      })
    );
    const byType = Object.fromEntries(latestEntries);
    const latestOcrPaddle = await request(
      `/models/latest?project_id=${pid}&training_family=ocr&engine=paddleocr`
    )
      .then((r) => r.model || "")
      .catch(() => "");
    const latestOcrTesseract = await request(
      `/models/latest?project_id=${pid}&training_family=tesseract`
    )
      .then((r) => r.model || "")
      .catch(() => "");
    setLatestModels({ any: latestAny, byType, ocrPaddle: latestOcrPaddle, ocrTesseract: latestOcrTesseract });
  }

  async function refreshAll(targetProjectId = projectId) {
    if (!targetProjectId) {
      setImages([]);
      setLabelDrafts({});
      setSelectedIndex(0);
      setModels([]);
      setModelInfos({});
      setOfficialPaddleModels([]);
      setLatestModels({ any: "", byType: {}, ocrPaddle: "", ocrTesseract: "" });
      setModelTypes([]);
      return;
    }
    await Promise.all([loadImages(targetProjectId), loadModels(targetProjectId)]);
  }

  async function autoSelectTrainingModelType(targetProjectId = projectId) {
    if (!targetProjectId) {
      return;
    }
    const pid = encodeURIComponent(targetProjectId);
    try {
      const data = await request(`/dataset/meta?project_id=${pid}`);
      const recommended = String(data?.recommended_model_type || "").trim();
      if (!recommended) {
        return;
      }
      setModelType((prev) => (prev === recommended ? prev : recommended));
    } catch {
      // ignore: no dataset yet or optional endpoint failure
    }
  }

  async function refreshEvaluationDatasetOptions(targetProjectId = projectId) {
    if (!targetProjectId) {
      setEvalDatasetOptions(["val", "test"]);
      setEvalDataset("val");
      return;
    }

    const pid = encodeURIComponent(targetProjectId);
    try {
      const data = await request(`/dataset/meta?project_id=${pid}`);
      const splitCounts = data?.counts || {};

      const nextOptions = [];
      if (Number(splitCounts?.val || 0) > 0) {
        nextOptions.push("val");
      }
      if (Number(splitCounts?.test || 0) > 0) {
        nextOptions.push("test");
      }

      setEvalDatasetOptions(nextOptions);
      setEvalDataset((prev) => (nextOptions.includes(prev) ? prev : nextOptions[0] || ""));
    } catch {
      setEvalDatasetOptions(["val", "test"]);
      setEvalDataset((prev) => prev || "val");
    }
  }

  useEffect(() => {
    loadProjects().catch((error) => notify("error", error.message));
    loadSystemCheck().catch(() => null);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREPROCESS_PARAMS_BY_PROJECT_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        preprocessParamsByProjectRef.current = parsed;
      }
    } catch {
      // ignore invalid local storage payload
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      skipPreprocessPersistRef.current = true;
      setPreprocessParams({ ...DEFAULT_PREPROCESS_PARAMS });
      return;
    }

    const saved = preprocessParamsByProjectRef.current[projectId];
    skipPreprocessPersistRef.current = true;
    if (saved && typeof saved === "object") {
      setPreprocessParams({ ...DEFAULT_PREPROCESS_PARAMS, ...saved });
    } else {
      setPreprocessParams({ ...DEFAULT_PREPROCESS_PARAMS });
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    if (skipPreprocessPersistRef.current) {
      skipPreprocessPersistRef.current = false;
      return;
    }
    preprocessParamsByProjectRef.current = {
      ...preprocessParamsByProjectRef.current,
      [projectId]: preprocessParams,
    };
    try {
      localStorage.setItem(
        PREPROCESS_PARAMS_BY_PROJECT_STORAGE_KEY,
        JSON.stringify(preprocessParamsByProjectRef.current)
      );
    } catch {
      // ignore local storage write error
    }
  }, [projectId, preprocessParams]);

  useEffect(() => {
    if (!projectId) {
      refreshAll("").catch((error) => notify("error", error.message));
      return;
    }
    // プロジェクト切替直後に旧プロジェクトの一覧のまま新IDで画像URLが生成され
    // 404リクエストが発生するのを防ぐため、新一覧の取得前に旧一覧をクリアする
    setImages([]);
    setLabelDrafts({});
    setSelectedIndex(0);
    refreshAll(projectId).catch((error) => notify("error", error.message));
  }, [projectId]);

  useEffect(() => {
    setWorkflowState({
      refreshed: false,
      preprocessed: false,
      datasetBuilt: false,
      trainingStarted: false,
    });
    const savedSession = projectId ? trainingSessionByProjectRef.current[projectId] : null;
    if (
      savedSession &&
      typeof savedSession === "object" &&
      (savedSession.jobId || (Array.isArray(savedSession.logs) && savedSession.logs.length > 0))
    ) {
      stopPollingRef.current = false;
      setJobId(String(savedSession.jobId || ""));
      setJobStatus(String(savedSession.jobStatus || "idle"));
      setJobFamily(String(savedSession.jobFamily || "classification"));
      setLogs(Array.isArray(savedSession.logs) ? savedSession.logs : []);
      lastStatusRef.current = String(savedSession.jobStatus || "");
      lastMessageRef.current = "";
      return;
    }
    resetTrainingLog();
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    try {
      window.sessionStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId);
    } catch {
      // ignore session storage write error
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    if (!jobId && jobStatus === "idle" && logs.length === 0) {
      persistTrainingSession(projectId, null);
      return;
    }
    persistTrainingSession(projectId, {
      jobId,
      jobStatus,
      jobFamily,
      logs: Array.isArray(logs) ? logs.slice(-300) : [],
    });
  }, [projectId, jobId, jobStatus, jobFamily, logs]);

  useEffect(() => {
    setImageShapes({});
    setEvalResult(null);
    setInferResult(null);
    setOcrDatasetInfo(null);
    setOcrDatasetDir("");
  }, [projectId]);

  useEffect(() => {
    if (modelTypes.length === 0) {
      return;
    }
    if (!modelTypes.includes(modelType)) {
      setModelType(modelTypes[0]);
    }
    if (!modelTypes.includes(inferModelType)) {
      setInferModelType(modelTypes[0]);
    }
    if (!modelTypes.includes(evalModelType)) {
      setEvalModelType(modelTypes[0]);
    }
    if (!modelTypes.includes(preprocessPredictModelType)) {
      setPreprocessPredictModelType(modelTypes[0]);
    }
  }, [modelTypes, modelType, inferModelType, evalModelType, preprocessPredictModelType]);

  useEffect(() => {
    if (inferModel !== "latest" && !classificationModels.includes(inferModel)) {
      setInferModel("latest");
    }
    if (inferPaddleModel !== "latest" && !paddleOcrModelOptions.includes(inferPaddleModel)) {
      setInferPaddleModel("latest");
    }
    if (evalModel !== "latest" && !classificationModels.includes(evalModel)) {
      setEvalModel("latest");
    }
    if (preprocessPredictModel !== "latest" && !classificationModels.includes(preprocessPredictModel)) {
      setPreprocessPredictModel("latest");
    }
    if (preprocessPredictPaddleModel !== "latest" && !paddleOcrModelOptions.includes(preprocessPredictPaddleModel)) {
      setPreprocessPredictPaddleModel("latest");
    }
  }, [
    classificationModels,
    paddleOcrModelOptions,
    inferModel,
    inferPaddleModel,
    evalModel,
    preprocessPredictModel,
    preprocessPredictPaddleModel,
  ]);

  useEffect(() => {
    if (inferModel === "latest") {
      return;
    }
    const inferred = modelTypeFromModelName(inferModel);
    if (inferred && inferModelType !== inferred) {
      setInferModelType(inferred);
    }
  }, [inferModel, inferModelType]);

  useEffect(() => {
    if (evalModel === "latest") {
      return;
    }
    const inferred = modelTypeFromModelName(evalModel);
    if (inferred && evalModelType !== inferred) {
      setEvalModelType(inferred);
    }
  }, [evalModel, evalModelType]);

  // プリセットはプロジェクト単位で保存（未保存プロジェクトは旧・全プロジェクト共通キーから初回コピー移行）。
  // 前処理画面のUI状態（折りたたみ・基本/詳細モード）とOCR結果確認の推論設定も同時に復元する
  useEffect(() => {
    setPreprocessPresets(projectId ? readPreprocessPresets(projectId) : {});
    setSelectedPreset("");
    setPreprocessUiState(projectId ? readPreprocessUiState(projectId) : { ...DEFAULT_PREPROCESS_UI_STATE });
    if (projectId) {
      const saved = readPreprocessPredictSettings(projectId);
      setPreprocessPredictEngine(saved.engine);
      setPreprocessPredictModel(saved.model);
      setPreprocessPredictPaddleModel(saved.paddleModel);
      setPreprocessPredictTesseractModel(saved.tesseractModel);
      setPreprocessPredictModelType(saved.modelType);
      setPreprocessPredictEasyOcrLangs(saved.langs);
      setPreprocessPredictPsm(saved.psm);
      setPreprocessPredictWhitelist(saved.whitelist);
    }
  }, [projectId]);

  useEffect(() => {
    if (images.length === 0) {
      setPreprocessImage("");
      setPreprocessPreview(null);
      setPreprocessError("");
      return;
    }
    if (!images.some((item) => item.image === preprocessImage)) {
      setPreprocessImage(images[0].image);
    }
  }, [images, preprocessImage]);

  useEffect(() => {
    if (!["training", "cls-training"].includes(activeView) || !projectId) {
      return;
    }
    autoSelectTrainingModelType(projectId).catch(() => null);
  }, [activeView, projectId]);

  useEffect(() => {
    if (activeView === "ocr-training" && trainingFamily !== "ocr") {
      setTrainingFamily("ocr");
      return;
    }
    if (activeView === "cls-training" && trainingFamily !== "classification") {
      setTrainingFamily("classification");
    }
  }, [activeView, trainingFamily]);

  // OCRタイプ切替時に文字セット既定を切替（Paddle/EasyOCR: A-Z0-9 / Tesseract: A-Z0-9+筆記体klt）
  useEffect(() => {
    if (ocrEngine === "tesseract") {
      setOcrCharset((prev) => (prev === OCR_CHARSET_DEFAULT ? TESSERACT_CHARSET_DEFAULT : prev));
    } else {
      setOcrCharset((prev) => (prev === TESSERACT_CHARSET_DEFAULT ? OCR_CHARSET_DEFAULT : prev));
    }
  }, [ocrEngine]);

  // OCRタイプ切替時に学習回数の既定値を切替（Tesseract: 1500 iteration=Fine-tuning向け / その他: 30 epoch）。
  // ユーザーが既定値以外へ変更した値は上書きしない（charset既定切替と同じ方式）
  useEffect(() => {
    if (ocrEngine === "tesseract") {
      setEpochs((prev) => (String(prev) === String(OCR_EPOCHS_DEFAULT) ? TESSERACT_MAX_ITERATIONS_DEFAULT : prev));
    } else {
      setEpochs((prev) => (String(prev) === String(TESSERACT_MAX_ITERATIONS_DEFAULT) ? OCR_EPOCHS_DEFAULT : prev));
    }
  }, [ocrEngine]);

  useEffect(() => {
    if (activeView === "ocr-inference" && inferEngine === "custom") {
      setInferEngine("paddleocr");
      return;
    }
    if (activeView === "cls-inference" && inferEngine !== "custom") {
      setInferEngine("custom");
    }
  }, [activeView, inferEngine]);

  useEffect(() => {
    refreshEvaluationDatasetOptions(projectId).catch(() => null);
  }, [projectId]);

  // モデル表示名(Alias)とモデル別評価履歴の project 別読込
  const [modelAliases, setModelAliases] = useState({});
  const [modelEvalHistory, setModelEvalHistory] = useState({});

  useEffect(() => {
    setModelAliases(readProjectScopedStorage(MODEL_ALIASES_STORAGE_KEY, projectId));
    setModelEvalHistory(readProjectScopedStorage(MODEL_EVAL_HISTORY_STORAGE_KEY, projectId));
  }, [projectId]);

  function persistModelAlias(modelName, alias) {
    setModelAliases((prev) => {
      const next = { ...prev };
      const trimmed = String(alias || "").trim();
      if (trimmed) {
        next[modelName] = trimmed;
      } else {
        delete next[modelName];
      }
      writeProjectScopedStorage(MODEL_ALIASES_STORAGE_KEY, projectId, next);
      return next;
    });
  }

  // 比較用推論スロットの project 別読込（既存の単一推論設定とは独立したキーで互換維持）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREPROCESS_EXTRA_SLOTS_STORAGE_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const slots = Array.isArray(map?.[projectId]) ? map[projectId].slice(0, 2) : [];
      setPreprocessExtraSlots(slots);
    } catch {
      setPreprocessExtraSlots([]);
    }
    setPreprocessExtraPreviews([]);
  }, [projectId]);

  function persistPreprocessExtraSlots(next) {
    setPreprocessExtraSlots(next);
    try {
      const raw = localStorage.getItem(PREPROCESS_EXTRA_SLOTS_STORAGE_KEY);
      const map = raw ? JSON.parse(raw) : {};
      map[projectId] = next;
      localStorage.setItem(PREPROCESS_EXTRA_SLOTS_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // localStorage が使えない環境では保存なしで動作継続
    }
  }

  // 「小文字を出力に含める」をプロジェクト単位で復元（旧設定・未保存はON扱い）
  useEffect(() => {
    const saved = readProjectScopedStorage(INCLUDE_LOWERCASE_BY_PROJECT_STORAGE_KEY, projectId);
    setPreprocessPredictIncludeLowercase(saved?.preprocess !== false);
    setInferIncludeLowercase(saved?.infer !== false);
  }, [projectId]);

  // OCR候補辞書をプロジェクト単位で復元（プロジェクト切替で混在させない）
  useEffect(() => {
    const saved = readProjectScopedStorage(CANDIDATE_DICT_BY_PROJECT_STORAGE_KEY, projectId);
    if (saved && Array.isArray(saved.entries)) {
      setCandidateDict({ ...DEFAULT_CANDIDATE_DICT, ...saved });
    } else {
      setCandidateDict({ ...DEFAULT_CANDIDATE_DICT });
    }
  }, [projectId]);

  function persistCandidateDict(next) {
    const value = { ...DEFAULT_CANDIDATE_DICT, ...next };
    setCandidateDict(value);
    if (projectId) {
      writeProjectScopedStorage(CANDIDATE_DICT_BY_PROJECT_STORAGE_KEY, projectId, value);
    }
  }

  useEffect(() => {
    if (!projectId) {
      return;
    }
    writeProjectScopedStorage(INCLUDE_LOWERCASE_BY_PROJECT_STORAGE_KEY, projectId, {
      preprocess: preprocessPredictIncludeLowercase,
      infer: inferIncludeLowercase,
    });
  }, [projectId, preprocessPredictIncludeLowercase, inferIncludeLowercase]);

  // OCR結果確認（プレビュー推論）の設定をプロジェクト別へ自動保存（リロードで消えないように）
  useEffect(() => {
    if (!projectId) {
      return;
    }
    writePreprocessPredictSettings(projectId, {
      engine: preprocessPredictEngine,
      model: preprocessPredictModel,
      paddleModel: preprocessPredictPaddleModel,
      tesseractModel: preprocessPredictTesseractModel,
      modelType: preprocessPredictModelType,
      langs: preprocessPredictEasyOcrLangs,
      psm: preprocessPredictPsm,
      whitelist: preprocessPredictWhitelist,
    });
  }, [
    projectId,
    preprocessPredictEngine,
    preprocessPredictModel,
    preprocessPredictPaddleModel,
    preprocessPredictTesseractModel,
    preprocessPredictModelType,
    preprocessPredictEasyOcrLangs,
    preprocessPredictPsm,
    preprocessPredictWhitelist,
  ]);

  // 前処理画面のUI状態（折りたたみ・基本/詳細モード）の変更を保存
  function handlePreprocessUiStateChange(next) {
    setPreprocessUiState(next);
    writePreprocessUiState(projectId, next);
  }

  // プレビュー結果キャッシュ（同一画像・同一設定の再取得防止。メイン/比較スロットで共有）と
  // リクエスト連番（古いレスポンスを破棄）・AbortController（旧リクエストの中断）
  const preprocessPreviewCacheRef = useRef(createPreviewCache());
  const preprocessPreviewSeqRef = useRef(0);

  useEffect(() => {
    if (activeView !== "preprocess") {
      return undefined;
    }
    if (!projectId || !preprocessImage) {
      setPreprocessPreview(null);
      setPreprocessExtraPreviews([]);
      return undefined;
    }

    setPreprocessLoading(true);
    setPreprocessError("");
    const seq = ++preprocessPreviewSeqRef.current;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      const mainFields = {
        engine: preprocessPredictEngine,
        model:
          preprocessPredictEngine === "custom"
            ? preprocessPredictModel
            : preprocessPredictEngine === "paddleocr"
              ? preprocessPredictPaddleModel
              : preprocessPredictEngine === "tesseract"
                ? preprocessPredictTesseractModel
                : "latest",
        model_type:
          preprocessPredictEngine === "custom" && preprocessPredictModel === "latest"
            ? preprocessPredictModelType
            : null,
        easyocr_langs:
          preprocessPredictEngine === "easyocr" || preprocessPredictEngine === "paddleocr"
            ? (preprocessPredictEasyOcrLangs.length > 0 ? preprocessPredictEasyOcrLangs.join(",") : "en")
            : "en",
        include_lowercase: lowercaseToggleApplicable(preprocessPredictEngine, preprocessPredictEasyOcrLangs)
          ? preprocessPredictIncludeLowercase
          : true,
        // Tesseract時のみPSM/whitelistを送信（他エンジンは従来動作を維持）
        ...(preprocessPredictEngine === "tesseract"
          ? {
              psm: Number(preprocessPredictPsm) || 7,
              ...(String(preprocessPredictWhitelist || "").trim()
                ? { whitelist: String(preprocessPredictWhitelist).trim() }
                : {}),
            }
          : {}),
      };
      const signatureOf = (fields) =>
        `${fields.engine}|${fields.model}|${fields.easyocr_langs}|lc:${fields.include_lowercase !== false ? "1" : "0"}|psm:${fields.psm ?? ""}|wl:${fields.whitelist ?? ""}`;
      const seenSignatures = new Set([signatureOf(mainFields)]);

      // 同一画像・同一設定（前処理overrides＋推論fields）の結果キャッシュ。
      // ヒット時はAPIを呼ばない（メイン/比較スロットでキーが同じならキャッシュを共有）
      const cache = preprocessPreviewCacheRef.current;
      const fetchPreview = async (fields) => {
        const payload = buildPreprocessPreviewPayload({ image: preprocessImage, projectId, params: preprocessParams, fields });
        // 画像の回転（imageVersion）・手動マスク更新（manualMaskVersion）でキャッシュが古くならないようキーへ含める
        const cacheKey = makePreviewCacheKey({
          image: `${projectId}::${preprocessImage}::v${imageVersion}::m${manualMaskVersion}`,
          overrides: payload.overrides,
          fields,
        });
        const cached = cache.get(cacheKey);
        if (cached) {
          return { ...cached, __cached: true };
        }
        const startedAt = performance.now();
        const data = await request("/preprocess/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const result = { ...data, __elapsed_ms: Math.round(performance.now() - startedAt) };
        cache.set(cacheKey, result);
        return result;
      };

      // モデル2/3 は同一APIをスロット分並行呼び（既存APIは無変更）。1つの失敗が他へ波及しないよう個別に捕捉
      const extraPromise = Promise.all(
        preprocessExtraSlots.map(async (slot) => {
          const fields = extraSlotRequestFields(slot);
          const engine = fields.engine;
          const signature = signatureOf(fields);
          if (seenSignatures.has(signature)) {
            return { duplicate: true, engine, modelName: "" };
          }
          seenSignatures.add(signature);
          try {
            const d = await fetchPreview(fields);
            const prediction = String(d?.prediction || "").trim();
            return {
              prediction,
              confidence: typeof d?.confidence === "number" ? d.confidence : null,
              engine: d?.predict_engine || engine,
              modelName: d?.predict_model_name || "",
              error: !prediction && d?.predict_error ? String(d.predict_error) : "",
            };
          } catch (error) {
            if (error?.name === "AbortError") {
              return { duplicate: false, engine, modelName: "", error: "" };
            }
            return { error: String(error?.message || error), engine, modelName: "" };
          }
        })
      );

      try {
        const data = await fetchPreview(mainFields);
        // 古いレスポンスは破棄（連番ガード。Abortされずに完了した遅延レスポンス対策）
        if (seq !== preprocessPreviewSeqRef.current) {
          return;
        }
        setPreprocessPreview(data);
      } catch (error) {
        if (error?.name === "AbortError" || seq !== preprocessPreviewSeqRef.current) {
          return;
        }
        setPreprocessPreview(null);
        setPreprocessError(error.message);
      } finally {
        if (seq === preprocessPreviewSeqRef.current) {
          setPreprocessLoading(false);
        }
      }
      const extras = await extraPromise;
      if (seq === preprocessPreviewSeqRef.current) {
        setPreprocessExtraPreviews(extras);
      }
    }, 300);

    return () => {
      // デバウンス中の未発火タイマーを止め、発行済みリクエストも中断する（旧レスポンスの上書き防止）
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeView,
    projectId,
    preprocessImage,
    imageVersion,
    preprocessParams,
    preprocessPredictEngine,
    preprocessPredictModel,
    preprocessPredictPaddleModel,
    preprocessPredictTesseractModel,
    preprocessPredictModelType,
    preprocessPredictEasyOcrLangs,
    preprocessPredictIncludeLowercase,
    preprocessPredictPsm,
    preprocessPredictWhitelist,
    preprocessExtraSlots,
    manualMaskVersion,
  ]);

  useEffect(() => {
    images.forEach((item) => {
      const name = item.image;
      if (imageShapes[name]) {
        return;
      }

      const probe = new window.Image();
      probe.onload = () => {
        setImageShapes((prev) => {
          if (prev[name]) {
            return prev;
          }
          return { ...prev, [name]: `${probe.naturalWidth}x${probe.naturalHeight}` };
        });
      };
      probe.onerror = () => {
        setImageShapes((prev) => {
          if (prev[name]) {
            return prev;
          }
          return { ...prev, [name]: "--" };
        });
      };
      probe.src = imageUrl(name, projectId, imageVersion);
    });
  }, [images, imageShapes, projectId, imageVersion]);

  useEffect(() => {
    if (!jobId) {
      return undefined;
    }

    stopPollingRef.current = false;

    const poll = async () => {
      if (stopPollingRef.current) {
        return;
      }
      try {
        const statusPath = jobFamily === "ocr" ? `/api/ocr/train/status/${jobId}` : `/train/${jobId}`;
        const data = await request(statusPath);
        if (stopPollingRef.current) {
          return;
        }
        setJobStatus(data.status || "unknown");
        setJobInfo(data);

        if (data.status && data.status !== lastStatusRef.current) {
          pushLog(`学習ステータス: ${data.status}`);
          lastStatusRef.current = data.status;
        }

        if (data.message && data.message !== lastMessageRef.current) {
          pushLog(`メッセージ: ${data.message}`);
          lastMessageRef.current = data.message;
        }

        if (jobFamily === "ocr") {
          const logData = await request(`/api/ocr/train/log/${jobId}?tail=300`).catch(() => ({ lines: [] }));
          if (stopPollingRef.current) {
            return;
          }
          if (Array.isArray(logData?.lines)) {
            setLogs(logData.lines.slice(-300).map((line) => summarizePpocrLogLine(line)));
          }
        }

        if (data.status === "completed") {
          notify("success", "学習が完了しました");
          loadModels(data.project_id || projectId).catch(() => null);
          stopPollingRef.current = true;
        }

        if (data.status === "failed") {
          notify("error", "学習に失敗しました");
          stopPollingRef.current = true;
        }

        if (data.status === "stopped") {
          notify("info", "学習を停止しました");
          stopPollingRef.current = true;
        }
      } catch (error) {
        pushLog(`ポーリングエラー: ${error.message}`);
      }
    };

    const timer = setInterval(poll, 2000);
    poll().catch(() => null);

    return () => {
      stopPollingRef.current = true;
      clearInterval(timer);
    };
  }, [jobId, jobFamily, projectId]);

  // OCR学習画面を開いたとき、実行中ジョブがあればAPIから復元する（画面再読込・別タブでもidle表示にしない）
  useEffect(() => {
    if (activeView !== "ocr-training" || !projectId || jobId) {
      return;
    }
    reconnectActiveOcrJob(projectId).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, projectId, jobId]);

  useEffect(() => {
    if (activeView !== "labeling") {
      return undefined;
    }

    const selected = images[selectedIndex];
    if (!selected) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (isEditableTarget) {
        return;
      }

      const key = event.key;
      // Enterの「保存して次へ」はLabelingView側の saveAndNext に一本化している
      // （ここでも保存すると二重発火で2件先へ進むため、このハンドラでは扱わない）
      if (/^[a-zA-Z0-9]$/.test(key)) {
        event.preventDefault();
        setLabelDrafts((prev) => ({
          ...prev,
          [selected.image]: `${prev[selected.image] || ""}${key}`,
        }));
        return;
      }

      if (key === "Backspace") {
        event.preventDefault();
        setLabelDrafts((prev) => ({
          ...prev,
          [selected.image]: String(prev[selected.image] || "").slice(0, -1),
        }));
        return;
      }

      if (key === " ") {
        // ボタンフォーカス中のSpaceはボタン操作（クリック）を優先する（配置切替ボタン等）
        if (target instanceof HTMLElement && target.tagName === "BUTTON") {
          return;
        }
        event.preventDefault();
        setLabelDrafts((prev) => ({
          ...prev,
          [selected.image]: `${prev[selected.image] || ""} `,
        }));
        return;
      }

      if (key === "ArrowRight") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, images.length - 1));
      }

      if (key === "ArrowLeft") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeView, images, selectedIndex, projectId]);

  useEffect(() => {
    return () => {
      if (inferPreviewUrl) {
        URL.revokeObjectURL(inferPreviewUrl);
      }
    };
  }, [inferPreviewUrl]);

  // 一覧が現在のプロジェクトに属する場合のみ描画に使用する。
  // プロジェクト切替直後の1フレームで「旧一覧+新projectId」の画像URLが生成され
  // 存在しないファイルへの404リクエストが発生するのを防ぐ
  const currentImages = imageListProjectId === projectId ? images : [];
  const selectedImage = currentImages[selectedIndex] || null;
  const selectedLabel = selectedImage ? labelDrafts[selectedImage.image] ?? "" : "";
  const labelingPreprocessOverrides = useMemo(
    () => normalizePreprocessOverrides(preprocessParams),
    [preprocessParams]
  );
  // ラベル編集のOCR候補（モデル2/3）は前処理画面の比較スロット設定を参照する
  const labelingExtraPredictParams = useMemo(
    () => preprocessExtraSlots.map(extraSlotRequestFields),
    [preprocessExtraSlots]
  );

  // ラベル編集のOCR候補は前処理画面の推論設定と同じエンジン/モデルで取得する
  const labelingPredictParams = useMemo(
    () => ({
      engine: preprocessPredictEngine,
      model:
        preprocessPredictEngine === "custom"
          ? preprocessPredictModel
          : preprocessPredictEngine === "paddleocr"
            ? preprocessPredictPaddleModel
            : preprocessPredictEngine === "tesseract"
              ? preprocessPredictTesseractModel
              : "latest",
      model_type:
        preprocessPredictEngine === "custom" && preprocessPredictModel === "latest"
          ? preprocessPredictModelType
          : null,
      easyocr_langs:
        preprocessPredictEngine === "easyocr" || preprocessPredictEngine === "paddleocr"
          ? (preprocessPredictEasyOcrLangs.length > 0 ? preprocessPredictEasyOcrLangs.join(",") : "en")
          : "en",
      include_lowercase: lowercaseToggleApplicable(preprocessPredictEngine, preprocessPredictEasyOcrLangs)
        ? preprocessPredictIncludeLowercase
        : true,
    }),
    [
      preprocessPredictEngine,
      preprocessPredictModel,
      preprocessPredictPaddleModel,
      preprocessPredictTesseractModel,
      preprocessPredictModelType,
      preprocessPredictEasyOcrLangs,
      preprocessPredictIncludeLowercase,
    ]
  );
  const rapidPreprocessOverrides = useMemo(
    () => normalizePreprocessOverrides(preprocessParams),
    [preprocessParams]
  );

  const labeledCount = useMemo(
    () => images.filter((item) => String(labelDrafts[item.image] || item.label || "").trim() !== "").length,
    [images, labelDrafts]
  );
  const savedLabeledCount = useMemo(
    () => images.filter((item) => String(item.label || "").trim() !== "").length,
    [images]
  );

  const clsTrainingMode = clsInitSourceType === "scratch" ? "scratch" : "finetune";
  const ocrTrainingMode = ocrInitSourceType === "scratch" ? "scratch" : "finetune";
  const canTrain = workflowState.datasetBuilt && savedLabeledCount > 0;
  const canStartOcrTraining =
    (ocrEngine === "paddleocr" || ocrEngine === "tesseract") &&
    String(ocrDatasetDir || "").trim() !== "" &&
    (ocrEngine === "tesseract" ||
      ocrTrainingMode === "scratch" ||
      String(ocrInitSourceValue || "").trim() !== "");
  const workflowSteps = useMemo(() => {
    const jobRunning = jobStatus === "running" || jobStatus === "queued";
    // OCR認識モデル系 / 実験機能系の画面では、その系統内の工程ナビを表示する
    // （viewId 付きステップはクリックで遷移できる。系統をまたぐ導線は混ぜない）
    if (OCR_WORKFLOW_VIEWS.includes(activeView)) {
      return OCR_WORKFLOW_STEP_DEFS.map((step) => ({
        ...step,
        status:
          step.viewId === "ocr-training" && jobFamily === "ocr"
            ? jobStatus === "failed"
              ? "error"
              : jobRunning
                ? "running"
                : activeView === step.viewId
                  ? "current"
                  : "todo"
            : activeView === step.viewId
              ? "current"
              : "todo",
      }));
    }
    if (CLS_WORKFLOW_VIEWS.includes(activeView)) {
      return CLS_WORKFLOW_STEP_DEFS.map((step) => ({
        ...step,
        status:
          step.viewId === "cls-training" && jobFamily === "classification"
            ? jobStatus === "failed"
              ? "error"
              : jobRunning
                ? "running"
                : activeView === step.viewId
                  ? "current"
                  : "todo"
            : activeView === step.viewId
              ? "current"
              : "todo",
      }));
    }

    const labelDone = images.length > 0 && savedLabeledCount === images.length;
    const defs = [
      { id: "images", viewId: "images", label: "画像取込", done: images.length > 0, meta: `${images.length}件` },
      { id: "preprocess", viewId: "preprocess", label: "前処理", done: workflowState.preprocessed },
      { id: "labeling", viewId: "labeling", label: "ラベル", done: labelDone, meta: `${savedLabeledCount}/${images.length}` },
      {
        id: "ocr-training",
        viewId: "ocr-training",
        label: "データ作成・学習",
        done: jobStatus === "completed",
        running: jobStatus === "running" || jobStatus === "queued",
        error: jobStatus === "failed",
      },
      { id: "evaluation", viewId: "ocr-eval", label: "評価", done: Boolean(evalResult) },
    ];

    let currentAssigned = false;
    return defs.map((step) => {
      if (step.error) {
        return { ...step, status: "error" };
      }
      if (step.running) {
        return { ...step, status: "running" };
      }
      if (step.done) {
        return { ...step, status: "done" };
      }
      if (!currentAssigned) {
        currentAssigned = true;
        return { ...step, status: "current" };
      }
      return { ...step, status: "todo" };
    });
  }, [activeView, images.length, savedLabeledCount, workflowState.preprocessed, jobStatus, jobFamily, evalResult]);

  async function createProject() {
    const value = newProjectId.trim();
    if (!value) {
      return;
    }
    try {
      const data = await request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: value }),
      });
      setNewProjectId("");
      await loadProjects(data.project_id);
      setProjectId(data.project_id);
      notify("success", `プロジェクトを作成しました: ${data.project_id}`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function deleteProject(targetProjectId = projectId) {
    const deletingProjectId = String(targetProjectId || "");
    if (!deletingProjectId) {
      notify("error", "削除対象のプロジェクトが選択されていません");
      return;
    }

    const confirmed = window.confirm(
      `プロジェクト「${deletingProjectId}」を削除します。\n生画像・アノテーション・モデル・データセットを含むデータが削除されます。続行しますか？`
    );
    if (!confirmed) {
      return;
    }
    const typed = window.prompt(`確認のため、削除するプロジェクトIDを入力してください: ${deletingProjectId}`, "");
    if (typed !== deletingProjectId) {
      notify("info", "プロジェクト削除をキャンセルしました（入力不一致）");
      return;
    }

    try {
      const data = await request(`/projects/${encodeURIComponent(deletingProjectId)}`, {
        method: "DELETE",
      });
      persistTrainingSession(deletingProjectId, null);
      if (deletingProjectId === projectId) {
        try {
          window.sessionStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
        } catch {
          // ignore session storage write error
        }
      }
      notify("success", `プロジェクトを削除しました: ${data.project_id}`);
      pushLog(`プロジェクト削除: ${data.project_id}（削除ジョブ数=${data.deleted_jobs ?? 0}）`);
      const result = await loadProjects();
      await refreshAll(result.nextProjectId);
      setActiveView("dashboard");
    } catch (error) {
      notify("error", error.message);
    }
  }

  function savePreprocessPreset() {
    const name = presetName.trim();
    if (!name) {
      notify("error", "プリセット名を入力してください");
      return;
    }
    const next = { ...preprocessPresets, [name]: preprocessParams };
    persistPreprocessPresets(next);
    setSelectedPreset(name);
    notify("success", `プリセットを保存しました: ${name}`);
  }

  function loadPreprocessPreset() {
    if (!selectedPreset) {
      notify("error", "プリセットを選択してください");
      return;
    }
    const preset = preprocessPresets[selectedPreset];
    if (!preset) {
      notify("error", "プリセットが見つかりません");
      return;
    }
    setPreprocessParams({ ...DEFAULT_PREPROCESS_PARAMS, ...preset });
    notify("success", `プリセットを読み込みました: ${selectedPreset}`);
  }

  async function importImages() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    if (!sourceDir.trim()) {
      notify("error", "取り込み元ディレクトリを入力してください");
      return;
    }

    try {
      const data = await request("/images/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_dir: sourceDir, project_id: projectId }),
      });
      await loadImages(projectId);
      setImageVersion((prev) => prev + 1);
      setWorkflowState({
        refreshed: true,
        preprocessed: false,
        datasetBuilt: false,
        trainingStarted: false,
      });
      notify("success", `${data.copied} 件の画像を取り込みました`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function browseImagesDirectory() {
    try {
      const data = await request("/dialogs/select-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: sourceDir || null }),
      });
      if (data.path) {
        setSourceDir(data.path);
        notify("success", `選択したフォルダ: ${data.path}`);
      } else {
        notify("info", "フォルダ選択がキャンセルされました");
      }
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function rotateImage(imageName, angle) {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return false;
    }
    try {
      await request(`/images/${encodeURIComponent(imageName)}/rotate?project_id=${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ angle }),
      });
      setImageShapes((prev) => {
        if (!prev[imageName]) {
          return prev;
        }
        const next = { ...prev };
        delete next[imageName];
        return next;
      });
      // 画像一覧は対象画像のサムネイルのみ更新（全件再取得を避ける）。他画面用のグローバル版数も更新
      setImageVersions((prev) => ({ ...prev, [imageName]: (prev[imageName] || 0) + 1 }));
      setImageVersion((prev) => prev + 1);
      setWorkflowState((prev) => ({
        refreshed: prev.refreshed,
        preprocessed: false,
        datasetBuilt: false,
        trainingStarted: false,
      }));
      notify("success", `${imageName} を回転しました（${angle > 0 ? "+" : ""}${angle}°）`);
      return true;
    } catch (error) {
      notify("error", error.message);
      return false;
    }
  }

  // ラベルを保存する（保存のみ。次画像への移動は呼び出し側=LabelingViewのsaveAndNextへ集約）。
  // 戻り値: 保存成功なら true、失敗なら false（失敗時は次へ進まない判断に使う）
  async function saveLabel(imageName) {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return false;
    }
    const value = String(labelDrafts[imageName] || "");

    try {
      await request(`/labels/${encodeURIComponent(imageName)}?project_id=${encodeURIComponent(projectId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: value }),
      });

      setImages((prev) => prev.map((item) => (item.image === imageName ? { ...item, label: value } : item)));
      setWorkflowState((prev) => ({
        refreshed: prev.refreshed,
        preprocessed: prev.preprocessed,
        datasetBuilt: false,
        trainingStarted: false,
      }));
      notify("success", `ラベル保存: ${imageName} -> ${value || "(空)"}`);
      return true;
    } catch (error) {
      notify("error", error.message);
      return false;
    }
  }

  // 実験一覧の取得（実験管理・モデル管理表示時。旧モデルはサーバー側で自動バックフィル）
  async function loadExperiments(pid = projectId) {
    if (!pid) {
      setExperiments([]);
      return;
    }
    setExperimentsLoading(true);
    try {
      const data = await request(`/api/experiments?project_id=${encodeURIComponent(pid)}`);
      setExperiments(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setExperiments([]);
    } finally {
      setExperimentsLoading(false);
    }
  }

  // リリース状況の取得（リリース管理・モデル管理表示時）
  async function loadReleases(pid = projectId) {
    if (!pid) {
      setReleases({ production: "", statuses: {}, history: [] });
      return;
    }
    setReleasesLoading(true);
    try {
      const data = await request(`/api/releases?project_id=${encodeURIComponent(pid)}`);
      setReleases({
        production: String(data?.production || ""),
        statuses: data?.statuses || {},
        history: Array.isArray(data?.history) ? data.history : [],
      });
    } catch {
      setReleases({ production: "", statuses: {}, history: [] });
    } finally {
      setReleasesLoading(false);
    }
  }

  // 実験カルテの更新（タグ・★・メモ等）→ 一覧を差し替え
  async function updateExperiment(experimentId, patch) {
    try {
      const data = await request(`/api/experiments/${encodeURIComponent(experimentId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, ...patch }),
      });
      if (data?.item) {
        setExperiments((prev) => prev.map((row) => (row.experiment_id === experimentId ? data.item : row)));
      }
    } catch (error) {
      notify("error", `実験の更新に失敗しました: ${error.message}`);
    }
  }


  // 実験管理・モデル管理・リリース管理を開いたときに実験一覧を取得（判定・リンク用）
  useEffect(() => {
    if (["experiments", "ocr-models", "releases"].includes(activeView)) {
      loadExperiments(projectId);
    }
    if (["releases", "ocr-models"].includes(activeView)) {
      loadReleases(projectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, projectId]);

  async function runPreprocess() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    // 実行前の最終確認: 実際に送信するペイロード（プレビューと同一の共通関数で生成）から
    // 設定要約を表示する。既存のprocessed画像・前処理スナップショットが更新される旨を注意
    if (!window.confirm(preprocessRunConfirmText(preprocessParams))) {
      return;
    }
    resetTrainingLog("前処理を再実行します");
    try {
      // プレビューと同一のUI設定（overrides）を /preprocess/run へ送信し、
      // 学習用processed画像を画面で確認した条件そのままで生成する
      const data = await request("/preprocess/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPreprocessRunPayload({ projectId, params: preprocessParams })),
      });
      setWorkflowState((prev) => ({
        refreshed: prev.refreshed,
        preprocessed: true,
        datasetBuilt: false,
        trainingStarted: false,
      }));
      notify("success", `${data.count} 件の前処理を実行しました`);
      pushLog(`前処理完了: ${data.count}`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function buildDataset() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    resetTrainingLog("データセットを再作成します");
    if (savedLabeledCount <= 0) {
      setWorkflowState((prev) => ({
        refreshed: prev.refreshed,
        preprocessed: prev.preprocessed,
        datasetBuilt: false,
        trainingStarted: false,
      }));
      notify("error", "保存済みラベルが0件です。ラベル保存後にデータセット作成を実行してください。");
      pushLog("データセット作成失敗: 保存済みラベルが0件");
      return;
    }

    const train = Number(trainRatio);
    const val = Number(valRatio);
    const test = Number(testRatio);
    const total = train + val + test;
    if (!Number.isFinite(train) || !Number.isFinite(val) || !Number.isFinite(test)) {
      notify("error", "データセット比率は数値で入力してください。");
      return;
    }
    if (train <= 0 || val < 0 || test < 0) {
      notify("error", "比率は train>0, val>=0, test>=0 を満たしてください。");
      return;
    }
    if (Math.abs(total - 1.0) > 1e-6) {
      notify("error", `比率の合計を1.00にしてください（現在: ${total.toFixed(2)}）。`);
      return;
    }

    try {
      const data = await request("/dataset/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, train_ratio: train, val_ratio: val, test_ratio: test }),
      });
      const totalCount =
        Number(data?.counts?.train || 0) + Number(data?.counts?.val || 0) + Number(data?.counts?.test || 0);
      const totalImages = Number(data?.total_images || 0);
      const labeledImages = Number(data?.labeled_images || 0);
      const unlabeledImages = Number(data?.unlabeled_images || 0);
      setWorkflowState((prev) => ({
        refreshed: prev.refreshed,
        preprocessed: prev.preprocessed,
        datasetBuilt: totalCount > 0,
        trainingStarted: false,
      }));
      notify(
        totalCount > 0 ? "success" : "error",
        totalCount > 0
          ? `データセット作成完了 学習=${data.counts.train} 検証=${data.counts.val} テスト=${data.counts.test} (保存済みラベル ${labeledImages}/${totalImages})`
          : "データセット作成結果が0件です。ラベルと前処理出力を確認してください。"
      );
      const missing = Array.isArray(data?.missing_train_labels) ? data.missing_train_labels : [];
      if (missing.length > 0) {
        pushLog(`学習データ未収載ラベル: ${missing.join(", ")}`);
      }
      pushLog(`データセット作成: ${JSON.stringify(data.counts)}`);
      if (totalImages > 0) {
        pushLog(`ラベル保存状況: ${labeledImages}/${totalImages}（未保存 ${unlabeledImages}）`);
      }
      autoSelectTrainingModelType(projectId).catch(() => null);
      refreshEvaluationDatasetOptions(projectId).catch(() => null);
    } catch (error) {
      notify("error", error.message);
    }
  }

  function parseOcrImageShape(value) {
    const raw = String(value || "")
      .split(",")
      .map((x) => Number.parseInt(x.trim(), 10))
      .filter((x) => Number.isFinite(x));
    if (raw.length !== 3 || ![1, 3].includes(raw[0]) || raw[1] <= 0 || raw[2] <= 0) {
      throw new Error("image_shape は 1,48,320 または 3,48,320 のように入力してください（Cは1または3）");
    }
    return raw;
  }

  async function browseOcrDatasetDirectory() {
    try {
      const data = await request("/dialogs/select-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: ocrDatasetDir || null }),
      });
      if (data.path) {
        setOcrDatasetDir(data.path);
      }
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function createOcrDataset() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    try {
      const isTesseract = ocrEngine === "tesseract";
      const imageShape = parseOcrImageShape(ocrImageShape);
      const payload = {
        project_id: projectId,
        image_types: ["wide"],
        charset: isTesseract
          ? ocrCharset || TESSERACT_CHARSET_DEFAULT
          : (ocrCharset || OCR_CHARSET_DEFAULT).toUpperCase(),
        text_case: isTesseract ? "keep" : "upper",
        max_text_length: isTesseract ? 64 : Number(ocrMaxTextLength),
        image_shape: imageShape,
        use_augmentation: false,
        aug_strength: 1,
        augmentation: buildAugmentationPayload(ocrAugmentation),
        train_ratio: Number(trainRatio),
        val_ratio: Number(valRatio),
        test_ratio: Number(testRatio),
        seed: Number(ocrSplitSeed) || 42,
        output_dir: null,
        overwrite: false,
      };
      setOcrRatioError("");
      const data = await request("/api/ocr/dataset/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setOcrDatasetInfo(data);
      setOcrDatasetDir(data.dataset_root || "");
      resetTrainingLog("OCRデータセットを作成します");
      pushLog(
        `OCRデータ作成: train=${data?.counts?.train ?? 0}, val=${data?.counts?.val ?? 0}, test=${data?.counts?.test ?? 0}` +
          (data?.augmentation_generated ? `, aug=${data.augmentation_generated}` : "")
      );
      notify("success", "OCRデータセットを作成しました");
    } catch (error) {
      // 比率エラー（INVALID_SPLIT_RATIO）は入力欄付近へ表示（通知だけにしない）
      const structured = parseStructuredRatioError(error);
      if (structured) {
        setOcrRatioError(structured);
      }
      notify("error", structured || error.message);
    }
  }

  // 構造化された比率エラー（{detail:{code:"INVALID_SPLIT_RATIO",...}}）からメッセージを取り出す
  function parseStructuredRatioError(error) {
    try {
      const payload = JSON.parse(String(error?.message || ""));
      const detail = payload?.detail;
      if (detail?.code === "INVALID_SPLIT_RATIO") {
        const v = detail.values || {};
        return `${detail.message}（現在の合計: ${v.sum}）`;
      }
    } catch {
      // 構造化エラーではない
    }
    return "";
  }

  // データセット作成前の分割予定枚数プレビュー（入力/有効/除外内訳＋最大剰余法の予定枚数）
  async function previewOcrSplit() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    setOcrSplitPreviewLoading(true);
    try {
      const isTesseract = ocrEngine === "tesseract";
      const data = await request("/api/ocr/dataset/split-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          image_types: ["wide"],
          charset: isTesseract ? ocrCharset || TESSERACT_CHARSET_DEFAULT : (ocrCharset || OCR_CHARSET_DEFAULT).toUpperCase(),
          text_case: isTesseract ? "keep" : "upper",
          max_text_length: isTesseract ? 64 : Number(ocrMaxTextLength),
          train_ratio: Number(trainRatio),
          val_ratio: Number(valRatio),
          test_ratio: Number(testRatio),
        }),
      });
      setOcrSplitPreview(data);
      setOcrRatioError("");
    } catch (error) {
      const structured = parseStructuredRatioError(error);
      if (structured) setOcrRatioError(structured);
      notify("error", structured || error.message);
    } finally {
      setOcrSplitPreviewLoading(false);
    }
  }

  // 学習前のオーグメンテーションプレビュー（元画像/適用後のペアを表示）
  async function previewOcrAugmentation() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    const payload = buildAugmentationPayload(ocrAugmentation);
    if (!payload) {
      notify("error", "オーグメンテーションが「なし」のためプレビューできません");
      return;
    }
    setOcrAugPreviewLoading(true);
    try {
      const isTesseract = ocrEngine === "tesseract";
      const data = await request("/api/ocr/dataset/augmentation-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          image_types: ["wide"],
          charset: isTesseract ? ocrCharset || TESSERACT_CHARSET_DEFAULT : (ocrCharset || OCR_CHARSET_DEFAULT).toUpperCase(),
          text_case: isTesseract ? "keep" : "upper",
          max_text_length: isTesseract ? 64 : Number(ocrMaxTextLength),
          image_shape: parseOcrImageShape(ocrImageShape),
          augmentation: payload,
          sample_count: 3,
        }),
      });
      setOcrAugPreview(data);
    } catch (error) {
      notify("error", error.message);
    } finally {
      setOcrAugPreviewLoading(false);
    }
  }

  async function createOcrDatasetFromLogs() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    try {
      const isTesseract = ocrEngine === "tesseract";
      const imageShape = parseOcrImageShape(ocrImageShape);
      const payload = {
        project_id: projectId,
        only_invalid: Boolean(ocrFromLogsOnlyInvalid),
        include_corrected: Boolean(ocrFromLogsIncludeCorrected),
        max_text_length: isTesseract ? 64 : Number(ocrMaxTextLength),
        charset: isTesseract
          ? ocrCharset || TESSERACT_CHARSET_DEFAULT
          : (ocrCharset || OCR_CHARSET_DEFAULT).toUpperCase(),
        text_case: isTesseract ? "keep" : "upper",
        image_shape: imageShape,
      };
      const data = await request("/api/ocr/dataset/from_logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setOcrDatasetInfo(data);
      setOcrDatasetDir(data.dataset_root || "");
      pushLog(`ログ再学習データ作成: count=${data?.count ?? 0}`);
      if (data?.skipped) {
        const toInt = (value) => {
          const n = Number(value);
          return Number.isFinite(n) ? n : 0;
        };
        pushLog(
          `除外内訳: missing_image=${toInt(data.skipped?.missing_image)}, over_max_length=${toInt(
            data.skipped?.over_max_length
          )}, charset=${toInt(data.skipped?.charset)}, empty_text=${toInt(data.skipped?.empty_text)}`
        );
      }
      notify("success", "OCRログから再学習データを作成しました");
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function createSelectedOcrDataset() {
    if (ocrDatasetCreateMode === "from_logs") {
      await createOcrDatasetFromLogs();
      return;
    }
    await createOcrDataset();
  }

  async function startTraining() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    try {
      const initType = String(clsInitSourceType || "imagenet").trim();
      const initValueRaw = String(clsInitSourceValue || "").trim();
      if (clsTrainingMode === "finetune" && initType === "classification_model" && !initValueRaw) {
        notify("error", "既存モデルを使う場合は初期モデルを選択してください。");
        return;
      }
      const data = await request("/train/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          model_type: modelType,
          epochs: Number(epochs),
          batch_size: Number(batchSize),
          learning_rate: Number(learningRate),
          training_mode: clsTrainingMode,
          init_source_type: initType,
          init_source_value: initType === "classification_model" ? initValueRaw : null,
          freeze_backbone_epochs: Number(freezeBackboneEpochs),
          backbone_lr_scale: Number(backboneLrScale),
        }),
      });

      resetTrainingLog(`学習開始要求: プロジェクト=${projectId}`);
      setJobId(data.job_id);
      setJobStatus(data.status || "queued");
      setJobFamily("classification");
      setWorkflowState((prev) => ({
        refreshed: prev.refreshed,
        preprocessed: prev.preprocessed,
        datasetBuilt: prev.datasetBuilt,
        trainingStarted: true,
      }));
      lastStatusRef.current = "";
      lastMessageRef.current = "";
      pushLog(`学習開始要求: プロジェクト=${projectId} / ジョブ=${data.job_id}`);
      notify("info", `学習キューに追加しました (${data.job_id})`);
      setActiveView("cls-training");
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function startTesseractTraining() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    if (!String(ocrDatasetDir || "").trim()) {
      notify("error", "先にOCRデータ作成を実行してください");
      return;
    }
    try {
      const maxIterations = Math.max(1, Number.parseInt(String(epochs), 10) || 1000);
      const payload = {
        project_id: projectId,
        dataset_dir: ocrDatasetDir,
        charset: ocrCharset || TESSERACT_CHARSET_DEFAULT,
        max_iterations: maxIterations,
        base_lang: "eng",
        psm: 7,
        // 実験情報（未入力は空文字=モデルメタでは未記録扱い）
        experiment_name: tessExperimentName.trim(),
        parent_model_id: tessParentModelId.trim(),
        training_note: tessTrainingNote.trim(),
      };
      const data = await request("/api/tesseract/train/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      resetTrainingLog(`Tesseract学習開始要求: プロジェクト=${projectId}`);
      setJobId(data.job_id);
      setJobStatus(data.status || "queued");
      setJobFamily("ocr");
      setWorkflowState((prev) => ({ ...prev, trainingStarted: true }));
      lastStatusRef.current = "";
      lastMessageRef.current = "";
      pushLog(`Tesseract学習開始要求: プロジェクト=${projectId} / ジョブ=${data.job_id}`);
      pushLog(`Tesseract学習設定: base=eng, charset=${payload.charset}, max_iterations=${maxIterations}`);
      notify("info", `Tesseract学習キューに追加しました (${data.job_id})`);
      setActiveView("ocr-training");
    } catch (error) {
      // 409（すでに実行中）は新規開始せず既存ジョブへ再接続する
      if (String(error?.message || "").includes("すでに実行中")) {
        notify("info", "OCR学習ジョブがすでに実行中のため、既存ジョブへ再接続しました");
        await reconnectActiveOcrJob();
        setActiveView("ocr-training");
      } else {
        notify("error", error.message);
      }
    }
  }

  async function startOcrTraining() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    if (startingTraining) {
      return; // API応答待ちの間の再押下（連打）を無視
    }
    setStartingTraining(true);
    try {
      if (ocrEngine === "tesseract") {
        await startTesseractTraining();
        return;
      }
      if (ocrEngine !== "paddleocr") {
        notify("error", "EasyOCR は学習対象外です。PaddleOCR または Tesseract を選択してください。");
        return;
      }
      await startPaddleOcrTraining();
    } finally {
      setStartingTraining(false);
    }
  }

  async function startPaddleOcrTraining() {
    try {
      const latestSystemCheck = (await loadSystemCheck().catch(() => null)) || systemCheck || {};
      const imageShape = parseOcrImageShape(ocrImageShape);
      const initType = String(ocrInitSourceType || "scratch").trim();
      const initValueRaw = String(ocrInitSourceValue || "").trim();
      const osFamily = String(latestSystemCheck?.os_family || "").trim().toLowerCase();
      const recommendedProfile = String(latestSystemCheck?.recommended_profile || "").trim();
      const gpuAvailable = Boolean(latestSystemCheck?.gpu_available);
      const paddlePathValid = Boolean(latestSystemCheck?.paddleocr_path_valid);
      const requestedDevice = String(ocrTrainDevice || "auto").trim().toLowerCase();
      if (requestedDevice === "gpu" && !gpuAvailable) {
        notify("error", "GPUが利用できない環境です。device を auto または cpu に変更してください。");
        return;
      }
      if (!paddlePathValid) {
        notify("error", "PaddleOCR のパスが無効です。設定または PADDLEOCR_PATH を確認してください。");
        return;
      }
      if (ocrTrainingMode === "finetune" && !initValueRaw) {
        notify("error", "OCR Fine-tuneでは初期モデルを選択してください。");
        return;
      }
      const toNonNegativeInt = (value, fallback = 0) => {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(0, parsed);
      };
      let trainWorkers = toNonNegativeInt(ocrTrainNumWorkers, 0);
      let evalWorkers = toNonNegativeInt(ocrEvalNumWorkers, 0);
      const saveEpochStep = Math.max(1, toNonNegativeInt(ocrSaveEpochStep, 10));

      if ((osFamily === "macos" || recommendedProfile === "Mac Safe") && trainWorkers > 1) {
        trainWorkers = 1;
        setOcrTrainNumWorkers(1);
        notify("warning", "Mac環境では train_num_workers を 1 に補正しました。");
      }
      if ((osFamily === "macos" || recommendedProfile === "Mac Safe") && evalWorkers > 1) {
        evalWorkers = 1;
        setOcrEvalNumWorkers(1);
      }
      const batch = Math.max(1, Number(batchSize));
      const likelyMemoryRisk =
        (osFamily === "macos" || recommendedProfile === "Mac Safe") &&
        (trainWorkers > 1 || evalWorkers > 1 || batch > 8 || imageShape[2] > 320);
      if (likelyMemoryRisk) {
        const confirmed = window.confirm(
          "現在の設定はメモリ不足の可能性があります（Mac Safe推奨より重い設定）。このまま学習を開始しますか？"
        );
        if (!confirmed) {
          return;
        }
      }
      const payload = {
        project_id: projectId,
        engine: "paddleocr",
        dataset_dir: ocrDatasetDir,
        paddle_repo_dir: null,
        charset: (ocrCharset || OCR_CHARSET_DEFAULT).toUpperCase(),
        max_text_length: Number(ocrMaxTextLength),
        image_shape: imageShape,
        batch_size: batch,
        epochs: Number(epochs),
        device: requestedDevice === "gpu" ? "gpu" : requestedDevice === "cpu" ? "cpu" : "auto",
        auto_batch_size: Boolean(ocrAutoBatchSize),
        train_num_workers: trainWorkers,
        eval_num_workers: evalWorkers,
        save_epoch_step: saveEpochStep,
        use_amp: Boolean(ocrUseAmp),
        pin_memory: Boolean(ocrPinMemory),
        persistent_workers: Boolean(ocrPersistentWorkers),
        training_mode: ocrTrainingMode,
        init_source_type: initType,
        init_source_value: ocrTrainingMode === "finetune" ? initValueRaw : null,
      };
      const data = await request("/api/ocr/train/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      resetTrainingLog(`OCR学習開始要求: プロジェクト=${projectId}`);
      setJobId(data.job_id);
      setJobStatus(data.status || "queued");
      setJobFamily("ocr");
      setWorkflowState((prev) => ({
        ...prev,
        trainingStarted: true,
      }));
      lastStatusRef.current = "";
      lastMessageRef.current = "";
      pushLog(`OCR学習開始要求: プロジェクト=${projectId} / ジョブ=${data.job_id}`);
      pushLog(
        `OCR学習設定: device=${payload.device}, batch=${batch}(${payload.auto_batch_size ? "自動" : "手動"}), workers(train/eval)=${trainWorkers}/${evalWorkers}, AMP=${payload.use_amp ? "ON" : "OFF"}, save_epoch_step=${saveEpochStep}`
      );
      notify("info", `OCR学習キューに追加しました (${data.job_id})`);
      setActiveView("ocr-training");
    } catch (error) {
      // 409（すでに実行中）は新規開始せず既存ジョブへ再接続する
      if (String(error?.message || "").includes("すでに実行中")) {
        notify("info", "OCR学習ジョブがすでに実行中のため、既存ジョブへ再接続しました");
        await reconnectActiveOcrJob();
        setActiveView("ocr-training");
      } else {
        notify("error", error.message);
      }
    }
  }

  function applyOcrTrainingPreset(presetName) {
    const key = String(presetName || "").trim().toLowerCase();
    if (key === OCR_TRAINING_PRESET_MAC_SAFE) {
      setOcrTrainDevice("cpu");
      setOcrAutoBatchSize(false);
      setOcrTrainNumWorkers(0);
      setOcrEvalNumWorkers(0);
      setOcrSaveEpochStep(10);
      setOcrUseAmp(false);
      setOcrPinMemory(false);
      setOcrPersistentWorkers(false);
      setBatchSize(8);
      notify("info", "Mac Safe プリセットを適用しました");
      return;
    }
    if (key === OCR_TRAINING_PRESET_RTX_TRAIN) {
      setOcrTrainDevice("gpu");
      setOcrAutoBatchSize(true);
      setOcrTrainNumWorkers(4);
      setOcrEvalNumWorkers(2);
      setOcrSaveEpochStep(5);
      setOcrUseAmp(true);
      setOcrPinMemory(true);
      setOcrPersistentWorkers(true);
      setBatchSize(64);
      notify("info", "RTX Train プリセットを適用しました");
    }
  }

  async function stopTraining(deleteArtifacts = false) {
    if (!jobId) {
      notify("error", "停止対象の学習ジョブがありません");
      return;
    }
    if (stopRequested) {
      return; // 停止処理中の二重停止を防止
    }
    const confirmMessage = deleteArtifacts
      ? "現在の学習を停止し、この実行で生成したチェックポイント・モデル・学習ログを削除します。続行しますか？（他のジョブのモデルには影響しません）"
      : "現在の学習を停止します。続行しますか？（生成済みのログ・checkpoint・学習データは保持されます）";
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setStopRequested(true);
    try {
      const suffix = deleteArtifacts ? "?delete_artifacts=true" : "";
      const path = jobFamily === "ocr" ? `/api/ocr/train/stop/${jobId}${suffix}` : `/train/stop/${jobId}${suffix}`;
      const data = await request(path, { method: "POST" });
      setJobStatus(data.status || "stopped");
      stopPollingRef.current = true;
      pushLog(deleteArtifacts ? `学習停止と関連データ削除: ジョブ=${jobId}` : `学習停止要求: ジョブ=${jobId}`);
      notify("info", deleteArtifacts ? "学習を停止し、関連データを削除しました" : "学習を停止しました");
    } catch (error) {
      notify("error", error.message);
    } finally {
      setStopRequested(false);
    }
  }

  // 実行中のOCR学習ジョブへ再接続する（画面再読込・別タブ・409応答時）
  async function reconnectActiveOcrJob(targetProjectId) {
    const pid = targetProjectId || projectId;
    if (!pid) {
      return false;
    }
    try {
      const data = await request(`/api/ocr/train/active?project_id=${encodeURIComponent(pid)}`);
      const job = data?.job;
      if (!job?.id) {
        return false;
      }
      stopPollingRef.current = false;
      lastStatusRef.current = "";
      lastMessageRef.current = "";
      setJobId(job.id);
      setJobFamily("ocr");
      setJobStatus(job.status || "running");
      setJobInfo(job);
      setWorkflowState((prev) => ({ ...prev, trainingStarted: true }));
      pushLog(`実行中のOCR学習ジョブへ再接続しました: ${job.id}`);
      return true;
    } catch {
      return false;
    }
  }

  function openLabeling(imageName) {
    const index = images.findIndex((item) => item.image === imageName);
    if (index >= 0) {
      setSelectedIndex(index);
    }
    setActiveView("labeling");
  }

  function appendLabelChar(char) {
    if (!selectedImage) {
      return;
    }
    setLabelDrafts((prev) => ({
      ...prev,
      [selectedImage.image]: `${prev[selectedImage.image] || ""}${char}`,
    }));
  }

  function backspaceLabel() {
    if (!selectedImage) {
      return;
    }
    setLabelDrafts((prev) => ({
      ...prev,
      [selectedImage.image]: String(prev[selectedImage.image] || "").slice(0, -1),
    }));
  }

  function clearLabel() {
    if (!selectedImage) {
      return;
    }
    setLabelDrafts((prev) => ({ ...prev, [selectedImage.image]: "" }));
  }

  function selectInferenceFile(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (inferPreviewUrl) {
      URL.revokeObjectURL(inferPreviewUrl);
    }

    setInferFile(file);
    setInferFileName(file.name);
    setInferPreviewUrl(URL.createObjectURL(file));
    setInferRotation(0);
    setInferResult(null);
  }

  async function rotateInferenceFile(file, degrees) {
    const normalized = ((Number(degrees || 0) % 360) + 360) % 360;
    if (normalized === 0) {
      return file;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
        img.src = objectUrl;
      });

      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const canvas = document.createElement("canvas");
      if (normalized === 90 || normalized === 270) {
        canvas.width = height;
        canvas.height = width;
      } else {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("画像回転に失敗しました");
      }

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((normalized * Math.PI) / 180);
      ctx.drawImage(image, -width / 2, -height / 2);

      const rotatedBlob = await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), file.type || "image/png");
      });
      if (!rotatedBlob) {
        throw new Error("回転画像の生成に失敗しました");
      }

      return new File([rotatedBlob], file.name, {
        type: rotatedBlob.type || file.type || "image/png",
        lastModified: Date.now(),
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function runInference() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    if (!inferFile) {
      notify("error", "画像ファイルを選択してください");
      return;
    }

    setInferLoading(true);
    try {
      const formData = new FormData();
      const rotatedFile = await rotateInferenceFile(inferFile, inferRotation);
      formData.append("file", rotatedFile);
      formData.append("engine", inferEngine);
      if (inferEngine === "custom") {
        formData.append("model", inferModel);
        if (inferModel === "latest" && inferModelType) {
          formData.append("model_type", inferModelType);
        }
      } else if (inferEngine === "paddleocr") {
        formData.append("model", inferPaddleModel || "latest");
        formData.append("easyocr_langs", inferEasyOcrLangs.length > 0 ? inferEasyOcrLangs.join(",") : "en");
      } else if (inferEngine === "tesseract") {
        formData.append("model", inferTesseractModel || "latest");
        // 推論前処理モード（training=モデルの学習時前処理 / manual=現在の前処理設定 / none=OCR入力整形のみ）。
        // 未指定（記録なしの自動時）は従来動作
        if (inferEffectivePreprocessMode) {
          formData.append("preprocess_mode", inferEffectivePreprocessMode);
        }
      } else if (inferEngine === "easyocr") {
        formData.append("easyocr_langs", inferEasyOcrLangs.length > 0 ? inferEasyOcrLangs.join(",") : "en");
      }
      if (lowercaseToggleApplicable(inferEngine, inferEasyOcrLangs)) {
        formData.append("include_lowercase", inferIncludeLowercase ? "true" : "false");
      }
      formData.append("project_id", projectId);

      const response = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "推論に失敗しました");
      }

      const result = await response.json();
      setInferResult(result);
      notify("success", `推論結果: ${result.prediction}`);
    } catch (error) {
      notify("error", error.message);
    } finally {
      setInferLoading(false);
    }
  }

  async function browseOcrEvalImageDir() {
    try {
      const data = await request("/dialogs/select-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: ocrEvalImageDir || null }),
      });
      if (data.path) setOcrEvalImageDir(data.path);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function browseOcrEvalGtCsv() {
    try {
      const data = await request("/dialogs/select-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: ocrEvalImageDir || null, extensions: ["csv"] }),
      });
      if (data.path) setOcrEvalGtCsv(data.path);
    } catch (error) {
      notify("error", error.message);
    }
  }

  // 評価データセット一覧の取得（モデル評価画面の選択候補）
  async function loadOcrEvalDatasets() {
    if (!projectId) return [];
    try {
      const data = await request(`/api/evaluation/datasets?project_id=${encodeURIComponent(projectId)}`);
      const list = Array.isArray(data?.datasets) ? data.datasets : [];
      setOcrEvalDatasets(list);
      return list;
    } catch {
      setOcrEvalDatasets([]);
      return [];
    }
  }

  // 選択で image_dir / gt_csv を自動反映し、学習データとの重複チェックを実行
  async function selectOcrEvalDataset(datasetId, presetEntry = null) {
    setOcrEvalDatasetId(datasetId || "");
    setOcrEvalOverlap(null);
    if (!datasetId) {
      return;
    }
    const entry = presetEntry || ocrEvalDatasets.find((row) => row.id === datasetId) || null;
    if (entry) {
      setOcrEvalImageDir(entry.image_dir || "");
      setOcrEvalGtCsv(entry.csv_path || "");
    }
    try {
      const overlap = await request(
        `/api/evaluation/datasets/${encodeURIComponent(datasetId)}/overlap?project_id=${encodeURIComponent(projectId)}`
      );
      setOcrEvalOverlap(overlap);
    } catch {
      setOcrEvalOverlap(null);
    }
  }

  async function deleteOcrEvalDataset(datasetId) {
    try {
      await request(
        `/api/evaluation/datasets/${encodeURIComponent(datasetId)}?project_id=${encodeURIComponent(projectId)}`,
        { method: "DELETE" }
      );
      notify("success", `評価データセットを削除しました: ${datasetId}`);
      if (ocrEvalDatasetId === datasetId) {
        setOcrEvalDatasetId("");
        setOcrEvalOverlap(null);
      }
      await loadOcrEvalDatasets();
    } catch (error) {
      notify("error", `削除に失敗しました: ${error.message}`);
    }
  }

  async function renameOcrEvalDataset(datasetId, newName) {
    try {
      const data = await request(`/api/evaluation/datasets/${encodeURIComponent(datasetId)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, new_name: newName }),
      });
      notify("success", `名前を変更しました: ${data.dataset_id}`);
      const list = await loadOcrEvalDatasets();
      if (ocrEvalDatasetId === datasetId) {
        // 選択中データセットの改名はパス参照も更新する
        await selectOcrEvalDataset(data.dataset_id, list.find((row) => row.id === data.dataset_id) || null);
      }
    } catch (error) {
      notify("error", `名前変更に失敗しました: ${error.message}`);
    }
  }

  // Step5「モデル評価へ」導線: 作成したデータセットを自動選択した状態で評価画面を開く
  async function openEvaluationWithDataset(created) {
    setActiveView("ocr-eval");
    if (created?.image_dir) setOcrEvalImageDir(created.image_dir);
    if (created?.csv_path) setOcrEvalGtCsv(created.csv_path);
    const list = await loadOcrEvalDatasets();
    if (created?.dataset_id) {
      await selectOcrEvalDataset(created.dataset_id, list.find((row) => row.id === created.dataset_id) || null);
    }
  }

  async function runOcrEvaluation() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    if (!String(ocrEvalImageDir || "").trim() || !String(ocrEvalGtCsv || "").trim()) {
      notify("error", "評価用画像フォルダと正解CSVを指定してください");
      return;
    }
    const targets = [];
    if (ocrEvalIncludeBase) {
      targets.push({ engine: "tesseract", model: "eng" });
    }
    targets.push({ engine: "tesseract", model: ocrEvalTrainedModel || "latest" });

    setOcrEvalLoading(true);
    try {
      // 評価前処理モード（training=学習時前処理 / none=前処理なし / step5・custom=手動設定）
      const preprocessMode = evalPreprocessModeForSource(ocrEvalPreSource);
      const evalPreObject = preprocessMode === "manual" ? evalPreprocessRequestObject(ocrEvalEffectivePreprocess) : null;
      const payload = {
        project_id: projectId,
        image_dir: ocrEvalImageDir,
        gt_csv: ocrEvalGtCsv,
        targets,
        // 空文字 = whitelistなし
        charset:
          ocrEvalWhitelistMode === "none"
            ? ""
            : ocrEvalWhitelistMode === "custom"
              ? ocrEvalWhitelistCustom
              : TESSERACT_WHITELIST_DEFAULT,
        psm: 7,
        preprocess_mode: preprocessMode,
        ...(evalPreObject ? { eval_preprocess: evalPreObject, preprocess_source: ocrEvalPreSource } : {}),
      };
      const data = await request("/api/ocr/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // 評価結果へ使用データセット情報を紐付ける（履歴・比較用のスナップショット）
      const selectedDataset = ocrEvalDatasetId
        ? ocrEvalDatasets.find((row) => row.id === ocrEvalDatasetId) || null
        : null;
      const resultWithDataset = selectedDataset
        ? {
            ...data,
            dataset: {
              dataset_id: selectedDataset.id,
              dataset_name: selectedDataset.name,
              image_count: selectedDataset.image_count,
              created_at: selectedDataset.created_at,
            },
          }
        : data;
      setOcrEvalResult(resultWithDataset);
      // モデル管理画面向けに、モデル別の評価結果を記録
      // （評価セットはデータセットID優先。手動パス指定時は従来どおり画像フォルダ名で区別）
      try {
        const datasetLabel =
          selectedDataset?.id ||
          String(ocrEvalImageDir || "")
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() ||
          "eval";
        // 前処理情報はサーバーが実際に適用した値（応答のecho）を保存する（UI選択中の値ではない）。
        // 学習時前処理モードはハッシュも保存し、後から同じ評価を再現できるようにする
        const appliedMode = String(data?.preprocess_mode || "");
        const appliedPre = {
          source: String(data?.preprocess_source || "none"),
          summary:
            appliedMode === "training" || appliedMode === "training_individual"
              ? "学習時前処理"
              : data?.eval_preprocess
                ? evalPreprocessSummary(data.eval_preprocess)
                : "前処理なし",
          ...(appliedMode ? { mode: appliedMode } : {}),
          ...(data?.evaluation_preprocess?.preprocess_hash ? { hash: String(data.evaluation_preprocess.preprocess_hash) } : {}),
          ...(data?.evaluation_preprocess?.source_model_id
            ? { source_model_id: String(data.evaluation_preprocess.source_model_id) }
            : {}),
        };
        // 同一評価実行のエントリは同じ評価日時を共有する（⭐Latest Bestバッジの同一実行判定に使う）
        const evaluatedAt = new Date().toISOString();
        setModelEvalHistory((prev) => {
          const next = { ...prev };
          for (const target of data?.targets || []) {
            const key = String(target?.model || "");
            if (!key) continue;
            // 改善率・改善件数・CER比較は学習前モデルとの差分（comparisonがある評価のみ。ベース側にはnull）
            const hasImprovement = !target?.is_base && data?.comparison;
            next[key] = {
              ...(next[key] || {}),
              [datasetLabel]: {
                percent: Number(target?.accuracy_percent),
                at: evaluatedAt,
                pre: appliedPre,
                // モデルカルテ用の詳細（旧形式=これらのキー無しは「未記録」表示で互換）
                correct_count: Number(target?.correct),
                total_count: Number(target?.total),
                misrecognized_count: Number(target?.mismatch_count),
                improvement_rate:
                  hasImprovement && data.comparison.improvement_rate !== null && data.comparison.improvement_rate !== undefined
                    ? Math.round(Number(data.comparison.improvement_rate) * 1000) / 10
                    : null,
                improvement_count: hasImprovement ? Number(data.comparison.correct_delta) : null,
                dataset: selectedDataset?.name || datasetLabel,
                whitelist: ocrEvalWhitelistMode,
                // CER主指標（マイクロ平均）と関連指標
                cer: target?.cer ?? null,
                char_accuracy: target?.char_accuracy ?? null,
                cer_delta: hasImprovement ? (data.comparison.cer_delta ?? null) : null,
                cer_relative_improvement: hasImprovement ? (data.comparison.cer_relative_improvement ?? null) : null,
                improved: hasImprovement ? (data.comparison.improved ?? null) : null,
                unchanged: hasImprovement ? (data.comparison.unchanged ?? null) : null,
                regressed: hasImprovement ? (data.comparison.regressed ?? null) : null,
                perfect_fixed: hasImprovement ? (data.comparison.perfect_fixed ?? null) : null,
                perfect_regressed: hasImprovement ? (data.comparison.perfect_regressed ?? null) : null,
                // 混同TOP5（モデルカルテ・比較用の要約のみ保持）
                confusions: Array.isArray(target?.confusions) ? target.confusions.slice(0, 5) : [],
                // 学習時前処理との一致（true/false/null=未記録。旧形式=キー無しは未記録扱い）
                preprocess_match: target?.preprocess_match === true ? true : target?.preprocess_match === false ? false : null,
                training_preprocess_hash: target?.training_preprocess_hash ? String(target.training_preprocess_hash) : null,
              },
            };
          }
          writeProjectScopedStorage(MODEL_EVAL_HISTORY_STORAGE_KEY, projectId, next);
          return next;
        });
      } catch {
        // 記録失敗は評価結果表示に影響させない
      }
      // 実験管理へ評価要約＋Evaluation Profile（比較可能性の判定条件）を保存
      // （該当実験はサーバーがモデル名から解決。失敗しても評価表示に影響させない）
      try {
        const evaluatedAtIso = new Date().toISOString();
        // 評価前処理の識別子: 学習時前処理モード=ハッシュ / 手動=設定JSON / なし="none"
        const preprocessSignature = `${data?.preprocess_mode || "legacy"}:${
          data?.evaluation_preprocess?.preprocess_hash ||
          (data?.eval_preprocess ? JSON.stringify(data.eval_preprocess) : "none")
        }`;
        await Promise.allSettled(
          (data?.targets || [])
            .filter((target) => !target?.is_base && target?.model)
            .map((target) =>
              request("/api/experiments/attach-evaluation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  project_id: projectId,
                  model: target.model,
                  evaluation: {
                    cer: target.cer ?? null,
                    char_accuracy: target.char_accuracy ?? null,
                    accuracy_percent: target.accuracy_percent ?? null,
                    improved: data?.comparison?.improved ?? null,
                    regressed: data?.comparison?.regressed ?? null,
                    evaluated_at: evaluatedAtIso,
                    dataset: ocrEvalDatasetId || "",
                    // Evaluation Profile（Evaluation Hash生成用の評価条件）
                    dataset_id: ocrEvalDatasetId || String(ocrEvalImageDir || ""),
                    image_count: data?.count ?? null,
                    label_count: data?.gt_count ?? null,
                    preprocess_signature: preprocessSignature,
                    engine: "tesseract",
                    psm: data?.psm ?? 7,
                    whitelist: String(data?.charset ?? ""),
                  },
                }),
              })
            )
        );
      } catch {
        // 実験への保存失敗は評価結果表示へ影響させない
      }
      const acc = data?.comparison
        ? `学習前 ${(data.comparison.base_accuracy * 100).toFixed(1)}% → 学習後 ${(data.comparison.trained_accuracy * 100).toFixed(1)}%`
        : `対象 ${(data?.targets || []).length} 件`;
      notify("success", `評価完了: ${acc}`);
    } catch (error) {
      notify("error", error.message);
    } finally {
      setOcrEvalLoading(false);
    }
  }

  function exportOcrEvalCsv() {
    if (!ocrEvalResult) {
      notify("error", "評価結果がありません");
      return;
    }
    const targets = Array.isArray(ocrEvalResult.targets) ? ocrEvalResult.targets : [];
    const rows = Array.isArray(ocrEvalResult.rows) ? ocrEvalResult.rows : [];
    const escape = (value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    // 管理No（M0001形式）: 評価ラベル→モデル名（target.model）→モデル情報のmodel_id を引く。
    // ベース疑似モデル（eng等）は一覧に無いため未採番=空欄
    const idByLabel = {};
    targets.forEach((t) => {
      idByLabel[t.label] = modelInfos?.[t.model]?.model_id || "";
    });
    const modelIdOf = (label) => idByLabel[label] || "";
    // 明細: 1行=画像×モデル（編集距離・置換/脱落/挿入件数・学習前比の改善/悪化を含む）
    const comparison = ocrEvalResult.comparison || null;
    const lines = [
      [
        "filename",
        "ground_truth",
        "prediction",
        "match",
        "model",
        "model_id",
        "edit_distance",
        "sub_count",
        "del_count",
        "ins_count",
        "vs_base",
      ]
        .map(escape)
        .join(","),
    ];
    rows.forEach((row) => {
      const baseRes = comparison ? (row.results || []).find((r) => r.model_label === comparison.base_label) : null;
      (row.results || []).forEach((r) => {
        // 学習後モデル行には学習前との編集距離比較（improved/unchanged/regressed）を付ける
        let vsBase = "";
        if (baseRes && r.model_label !== comparison.base_label && r.edit_distance !== undefined) {
          const diff = Number(r.edit_distance) - Number(baseRes.edit_distance);
          vsBase = diff < 0 ? "improved" : diff > 0 ? "regressed" : "unchanged";
        }
        lines.push(
          [
            row.image,
            row.expected,
            r.prediction ?? "",
            r.match ? "1" : "0",
            r.model_label,
            modelIdOf(r.model_label),
            r.edit_distance ?? "",
            r.sub_count ?? "",
            r.del_count ?? "",
            r.ins_count ?? "",
            vsBase,
          ]
            .map(escape)
            .join(",")
        );
      });
    });
    // サマリ: モデル別の集計（CER主指標＋従来のaccuracy）
    lines.push("");
    lines.push(
      [
        "model",
        "model_id",
        "total",
        "correct",
        "accuracy_percent",
        "mismatch_count",
        "cer_percent",
        "char_accuracy_percent",
        "edit_distance_total",
        "ref_length_total",
        "evaluation_preprocess_mode",
        "evaluation_preprocess_hash",
        "training_preprocess_hash",
        "preprocess_match",
      ]
        .map(escape)
        .join(",")
    );
    // 前処理識別情報（旧結果=キー無しは空欄=未記録）。preprocess_match: 1=一致/0=不一致/空=未記録
    const evalPreMode = String(ocrEvalResult.preprocess_mode || "");
    const evalPreHash = String(ocrEvalResult.evaluation_preprocess?.preprocess_hash || "");
    targets.forEach((t) => {
      lines.push(
        [
          t.label,
          modelIdOf(t.label),
          t.total,
          t.correct,
          t.accuracy_percent,
          t.mismatch_count,
          t.cer_percent ?? "",
          t.char_accuracy_percent ?? "",
          t.edit_distance_total ?? "",
          t.ref_length_total ?? "",
          evalPreMode,
          evalPreHash,
          t.training_preprocess_hash ?? "",
          t.preprocess_match === true ? "1" : t.preprocess_match === false ? "0" : "",
        ]
          .map(escape)
          .join(",")
      );
    });
    // 前処理スナップショット（評価で実際に適用した前処理の再現用。明細行へは繰り返さない）
    if (ocrEvalResult.evaluation_preprocess) {
      lines.push("");
      lines.push(["evaluation_preprocess_json"].map(escape).join(","));
      lines.push([JSON.stringify(ocrEvalResult.evaluation_preprocess)].map(escape).join(","));
    }
    // 混同集計（モデル別TOP10: 置換/脱落/挿入）
    lines.push("");
    // from_codepoint/to_codepoint: 画面で表示できない文字（制御文字・U+FFFD等）も解析できるようU+XXXX表記を併記。
    // display_label=画面と同じ表示ラベル（空文字=[空文字]等）。解析用の from/to は生値のまま変更しない
    lines.push(
      ["model", "model_id", "kind", "from", "to", "from_codepoint", "to_codepoint", "count", "display_label"].map(escape).join(",")
    );
    targets.forEach((t) => {
      (t.confusions || []).forEach((c) => {
        lines.push(
          [t.label, modelIdOf(t.label), c.kind, c.from, c.to, charCodepoints(c.from), charCodepoints(c.to), c.count, confusionLabel(c)]
            .map(escape)
            .join(",")
        );
      });
    });

    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ocr_eval_${projectId || "default"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function deleteSelectedModels(modelNames) {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    const names = Array.isArray(modelNames) ? modelNames.filter(Boolean) : [];
    if (names.length === 0) {
      return;
    }

    const pid = encodeURIComponent(projectId);
    // 1件の失敗で他の削除結果が失われないよう allSettled で全件を待つ
    const results = await Promise.allSettled(
      names.map((name) =>
        request(`/models/${encodeURIComponent(name)}?project_id=${pid}`, {
          method: "DELETE",
        })
      )
    );
    const failed = results
      .map((result, idx) => ({ result, name: names[idx] }))
      .filter(({ result }) => result.status === "rejected")
      .map(({ result, name }) => ({ name, reason: String(result.reason?.message || result.reason || "unknown") }));
    const okCount = names.length - failed.length;

    try {
      await loadModels(projectId);
    } catch {
      // 一覧更新失敗は通知に影響させない（手動更新で回復可能）
    }

    if (failed.length === 0) {
      notify("success", `${okCount} 件のモデルを削除しました`);
      pushLog(`モデル削除: ${names.join(", ")}`);
      return;
    }
    const failedDetail = failed.map((f) => `${f.name}: ${f.reason}`).join(" / ");
    notify("error", `モデル削除: 成功 ${okCount} 件 / 失敗 ${failed.length} 件 — ${failedDetail}`);
    pushLog(`モデル削除(一部失敗): 成功=${okCount}件, 失敗=${failed.map((f) => f.name).join(", ")}`);
  }

  async function runEvaluation() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    if (!["val", "test"].includes(evalDataset)) {
      notify("error", "評価可能なデータセットがありません。ラベル保存後にデータセット作成を実行してください。");
      return;
    }

    setEvalLoading(true);
    try {
      let selectedModel = evalModel;
      let selectedModelType = evalModel === "latest" ? evalModelType : null;
      if (evalModel === "latest") {
        const latest = await request(
          `/models/latest?project_id=${encodeURIComponent(projectId)}&training_family=classification&model_type=${encodeURIComponent(evalModelType)}`
        );
        const resolvedPath = String(latest?.model || "");
        const resolvedName = resolvedPath.split("/").pop() || "";
        if (!resolvedName) {
          throw new Error(`最新モデルが見つかりません（種別: ${evalModelType}）`);
        }
        selectedModel = resolvedName;
        selectedModelType = null;
      }

      const payload = {
        project_id: projectId,
        dataset: evalDataset,
        model: selectedModel,
        model_type: selectedModelType,
        overrides: evalUseOverrides ? normalizePreprocessOverrides(preprocessParams) : null,
      };
      const data = await request("/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setEvalResult(data);
      pushLog(
        `評価 ${evalDataset}: 正解率=${(Number(data.accuracy || 0) * 100).toFixed(2)} / 件数=${data.total} / モデル=${
          data.model_name || selectedModel
        } / 前処理設定=${evalUseOverrides ? "ON" : "OFF"}`
      );
      setActiveView("cls-evaluation");
    } catch (error) {
      notify("error", error.message);
    } finally {
      setEvalLoading(false);
    }
  }

  const currentMeta = viewMeta[activeView] || viewMeta.dashboard;

  let view = null;
  if (activeView === "dashboard") {
    view = (
        <DashboardView
          projectId={projectId}
          projects={projects}
          projectSummaries={projectSummaries}
          newProjectId={newProjectId}
          onNewProjectIdChange={setNewProjectId}
          onSelectProject={setProjectId}
        onCreateProject={createProject}
        onDeleteProject={deleteProject}
        onNavigate={setActiveView}
        onOpenImageInPreprocess={(name) => {
          setPreprocessImage(name);
          setActiveView("preprocess");
        }}
        images={currentImages}
        imageVersion={imageVersion}
        workflowSteps={workflowSteps}
        currentStepLabel={
          (workflowSteps.find((step) => step.status === "current") ||
            workflowSteps.find((step) => step.status === "running"))?.label || "完了"
        }
        imagesCount={currentImages.length}
        labeledCount={labeledCount}
        modelCount={models.length}
      />
    );
  }

  if (activeView === "images") {
    view = (
      <ImagesView
        projectId={projectId}
        sourceDir={sourceDir}
        setSourceDir={setSourceDir}
        onBrowseDir={browseImagesDirectory}
        onImport={importImages}
        onRefresh={() => loadImages(projectId)}
        onRotate={rotateImage}
        imageVersion={imageVersion}
        imageVersions={imageVersions}
        images={currentImages}
        imageShapes={imageShapes}
        onOpenLabeling={openLabeling}
      />
    );
  }

  if (activeView === "preprocess") {
    view = (
      <PreprocessView
        projectId={projectId}
        imageVersion={imageVersion}
        extraSlots={preprocessExtraSlots}
        onExtraSlotsChange={persistPreprocessExtraSlots}
        extraPreviews={preprocessExtraPreviews}
        onManualMasksSaved={() => setManualMaskVersion((prev) => prev + 1)}
        returnView={preprocessReturnView}
        onReturn={() => {
          if (preprocessReturnView) {
            setActiveView(preprocessReturnView);
          }
        }}
        images={currentImages}
        selectedImage={preprocessImage}
        onSelectImage={setPreprocessImage}
        defaultParams={DEFAULT_PREPROCESS_PARAMS}
        predictEngine={preprocessPredictEngine}
        setPredictEngine={setPreprocessPredictEngine}
        predictModel={preprocessPredictModel}
        setPredictModel={setPreprocessPredictModel}
        predictPaddleModel={preprocessPredictPaddleModel}
        setPredictPaddleModel={setPreprocessPredictPaddleModel}
        predictTesseractModel={preprocessPredictTesseractModel}
        setPredictTesseractModel={setPreprocessPredictTesseractModel}
        predictModelType={preprocessPredictModelType}
        setPredictModelType={setPreprocessPredictModelType}
        predictEasyOcrLangs={preprocessPredictEasyOcrLangs}
        setPredictEasyOcrLangs={setPreprocessPredictEasyOcrLangs}
        predictIncludeLowercase={preprocessPredictIncludeLowercase}
        setPredictIncludeLowercase={setPreprocessPredictIncludeLowercase}
        easyocrLanguageOptions={EASYOCR_LANGUAGE_OPTIONS}
        modelTypes={modelTypes}
        models={classificationModels}
        paddleModels={paddleOcrModelOptions}
        tesseractModels={tesseractModels}
        latestModels={latestModels}
        params={preprocessParams}
        onParamsChange={setPreprocessParams}
        preview={preprocessPreview}
        loading={preprocessLoading}
        error={preprocessError}
        presetName={presetName}
        setPresetName={setPresetName}
        presets={preprocessPresets}
        selectedPreset={selectedPreset}
        setSelectedPreset={setSelectedPreset}
        onSavePreset={savePreprocessPreset}
        onLoadPreset={loadPreprocessPreset}
        uiState={preprocessUiState}
        onUiStateChange={handlePreprocessUiStateChange}
        predictPsm={preprocessPredictPsm}
        setPredictPsm={setPreprocessPredictPsm}
        predictWhitelist={preprocessPredictWhitelist}
        setPredictWhitelist={setPreprocessPredictWhitelist}
      />
    );
  }

  if (activeView === "labeling") {
    view = (
      <LabelingView
        projectId={projectId}
        imageVersion={imageVersion}
        preprocessOverrides={labelingPreprocessOverrides}
        preprocessParams={preprocessParams}
        predictParams={labelingPredictParams}
        extraPredictParams={labelingExtraPredictParams}
        candidateDict={candidateDict}
        onCandidateDictChange={persistCandidateDict}
        onOpenPreprocess={() => {
          setPreprocessReturnView("labeling");
          setActiveView("preprocess");
        }}
        images={currentImages}
        selectedIndex={selectedIndex}
        onSelectIndex={setSelectedIndex}
        labelDrafts={labelDrafts}
        labelValue={selectedLabel}
        onLabelChange={(value) => {
          if (!selectedImage) {
            return;
          }
          setLabelDrafts((prev) => ({ ...prev, [selectedImage.image]: value }));
        }}
        onAppendChar={appendLabelChar}
        onBackspace={backspaceLabel}
        onClear={clearLabel}
        isUppercase={labelUppercase}
        onToggleCase={() => setLabelUppercase((prev) => !prev)}
        onSave={() => (selectedImage ? saveLabel(selectedImage.image) : Promise.resolve(false))}
        onPrev={() => setSelectedIndex((prev) => Math.max(prev - 1, 0))}
        onNext={() => setSelectedIndex((prev) => Math.min(prev + 1, images.length - 1))}
        imageShapes={imageShapes}
      />
    );
  }

  if (["training", "ocr-training", "cls-training"].includes(activeView)) {
    const trainingMode = activeView === "ocr-training" ? "ocr" : activeView === "cls-training" ? "classification" : "all";
    view = (
      <TrainingView
        trainingMode={trainingMode}
        projectId={projectId}
        trainingFamily={trainingFamily}
        setTrainingFamily={setTrainingFamily}
        modelType={modelType}
        setModelType={setModelType}
        modelTypes={modelTypes}
        trainRatio={trainRatio}
        setTrainRatio={setTrainRatio}
        valRatio={valRatio}
        setValRatio={setValRatio}
        testRatio={testRatio}
        setTestRatio={setTestRatio}
        epochs={epochs}
        setEpochs={setEpochs}
        batchSize={batchSize}
        setBatchSize={setBatchSize}
        learningRate={learningRate}
        setLearningRate={setLearningRate}
        clsInitSourceType={clsInitSourceType}
        setClsInitSourceType={setClsInitSourceType}
        clsInitSourceValue={clsInitSourceValue}
        setClsInitSourceValue={setClsInitSourceValue}
        freezeBackboneEpochs={freezeBackboneEpochs}
        setFreezeBackboneEpochs={setFreezeBackboneEpochs}
        backboneLrScale={backboneLrScale}
        setBackboneLrScale={setBackboneLrScale}
        classificationInitModelOptions={classificationModels}
        savedLabeledCount={savedLabeledCount}
        ocrEngine={ocrEngine}
        setOcrEngine={setOcrEngine}
        ocrCharset={ocrCharset}
        experimentName={tessExperimentName}
        setExperimentName={setTessExperimentName}
        parentModelId={tessParentModelId}
        setParentModelId={setTessParentModelId}
        trainingNote={tessTrainingNote}
        setTrainingNote={setTessTrainingNote}
        setOcrCharset={setOcrCharset}
        ocrMaxTextLength={ocrMaxTextLength}
        setOcrMaxTextLength={setOcrMaxTextLength}
        ocrImageShape={ocrImageShape}
        setOcrImageShape={setOcrImageShape}
        ocrAugmentation={ocrAugmentation}
        setOcrAugmentation={setOcrAugmentation}
        ocrAugPreview={ocrAugPreview}
        ocrAugPreviewLoading={ocrAugPreviewLoading}
        onPreviewAugmentation={previewOcrAugmentation}
        ocrSplitSeed={ocrSplitSeed}
        setOcrSplitSeed={setOcrSplitSeed}
        ocrSplitPreview={ocrSplitPreview}
        ocrSplitPreviewLoading={ocrSplitPreviewLoading}
        onPreviewSplit={previewOcrSplit}
        ratioError={ocrRatioError}
        ocrDatasetDir={ocrDatasetDir}
        ocrDatasetCreateMode={ocrDatasetCreateMode}
        setOcrDatasetCreateMode={setOcrDatasetCreateMode}
        ocrDatasetInfo={ocrDatasetInfo}
        ocrFromLogsOnlyInvalid={ocrFromLogsOnlyInvalid}
        setOcrFromLogsOnlyInvalid={setOcrFromLogsOnlyInvalid}
        ocrFromLogsIncludeCorrected={ocrFromLogsIncludeCorrected}
        setOcrFromLogsIncludeCorrected={setOcrFromLogsIncludeCorrected}
        ocrInitSourceType={ocrInitSourceType}
        setOcrInitSourceType={setOcrInitSourceType}
        ocrInitSourceValue={ocrInitSourceValue}
        setOcrInitSourceValue={setOcrInitSourceValue}
        ocrInitModelOptions={ocrPaddleModels}
        ocrOfficialInitModelOptions={officialPaddleModels}
        ocrTrainDevice={ocrTrainDevice}
        setOcrTrainDevice={setOcrTrainDevice}
        ocrTrainNumWorkers={ocrTrainNumWorkers}
        setOcrTrainNumWorkers={setOcrTrainNumWorkers}
        ocrEvalNumWorkers={ocrEvalNumWorkers}
        setOcrEvalNumWorkers={setOcrEvalNumWorkers}
        ocrSaveEpochStep={ocrSaveEpochStep}
        setOcrSaveEpochStep={setOcrSaveEpochStep}
        ocrAutoBatchSize={ocrAutoBatchSize}
        setOcrAutoBatchSize={setOcrAutoBatchSize}
        ocrUseAmp={ocrUseAmp}
        setOcrUseAmp={setOcrUseAmp}
        ocrPinMemory={ocrPinMemory}
        setOcrPinMemory={setOcrPinMemory}
        ocrPersistentWorkers={ocrPersistentWorkers}
        setOcrPersistentWorkers={setOcrPersistentWorkers}
        systemCheck={systemCheck}
        onApplyOcrTrainingPreset={applyOcrTrainingPreset}
        onCreateSelectedOcrDataset={createSelectedOcrDataset}
        onPreprocess={runPreprocess}
        onBuildDataset={buildDataset}
        onStartTraining={startTraining}
        onStartOcrTraining={startOcrTraining}
        onStopTraining={() => stopTraining(false)}
        onStopTrainingAndDelete={() => stopTraining(true)}
        canTrain={canTrain}
        canStartOcrTraining={canStartOcrTraining}
        jobId={jobId}
        jobStatus={jobStatus}
        jobInfo={jobInfo}
        stopRequested={stopRequested}
        startPending={startingTraining}
        onOpenModels={() => setActiveView(trainingMode === "classification" ? "cls-models" : "ocr-models")}
        onOpenInference={() => setActiveView(trainingMode === "classification" ? "cls-inference" : "ocr-inference")}
        logs={logs}
        workflowState={workflowState}
      />
    );
  }

  // モデル名 → 実験ID の対応（モデルカルテの「このモデルを作成したExperiment」リンク用）
  const experimentsByModel = useMemo(() => {
    const map = {};
    for (const row of experiments) {
      for (const model of row?.models || []) {
        map[String(model)] = String(row.experiment_id || "");
      }
    }
    return map;
  }, [experiments]);

  if (["models", "ocr-models", "cls-models"].includes(activeView)) {
    const modelItems = activeView === "ocr-models" ? ocrModels : activeView === "cls-models" ? classificationModels : models;
    const latestForView =
      activeView === "ocr-models"
        ? {
            any: latestModels.ocrPaddle || latestModels.ocrTesseract || "",
            byType: {
              PaddleOCR: latestModels.ocrPaddle || "",
              Tesseract: latestModels.ocrTesseract || "",
            },
          }
        : latestModels;
    // 現在OCR推論で使用中のモデル名を解決（"latest" 指定時は実体のモデル名へ）
    const toBase = (value) => String(value || "").split("/").pop();
    const inferenceInUseModel =
      inferEngine === "tesseract"
        ? inferTesseractModel === "latest"
          ? toBase(latestModels.ocrTesseract)
          : inferTesseractModel
        : inferEngine === "paddleocr"
          ? inferPaddleModel === "latest"
            ? toBase(latestModels.ocrPaddle)
            : inferPaddleModel
          : inferEngine === "custom"
            ? inferModel === "latest"
              ? toBase(latestModels.any)
              : inferModel
            : "";
    view = (
      <ModelsView
        projectId={projectId}
        models={modelItems}
        modelInfos={modelInfos}
        latest={latestForView}
        onRefresh={() => loadModels(projectId)}
        onDeleteSelected={deleteSelectedModels}
        aliases={modelAliases}
        onAliasChange={persistModelAlias}
        evalHistory={modelEvalHistory}
        inferenceInUseModel={inferenceInUseModel}
        inferenceInUseEngine={inferEngine}
        onUseForInference={(name) => {
          const engine = String(modelInfos?.[name]?.engine || "");
          const family = String(modelInfos?.[name]?.training_family || "classification");
          if (engine === "tesseract") {
            setInferEngine("tesseract");
            setInferTesseractModel(name);
          } else if (family === "ocr") {
            setInferEngine("paddleocr");
            setInferPaddleModel(name);
          } else {
            setInferEngine("custom");
            setInferModel(name);
          }
          notify("success", `推論使用モデルを ${modelAliases[name] || name} に設定しました`);
        }}
        onOpenEvaluation={(name) => {
          if (String(modelInfos?.[name]?.engine || "") === "tesseract") {
            setOcrEvalTrainedModel(name);
          }
          setActiveView("ocr-eval");
        }}
        onCreateTrainingPlan={(plan) => {
          // 次回学習提案からの設定引き継ぎ（学習は開始しない。学習画面でユーザーが編集・実行する）
          if (plan.iterations) setEpochs(plan.iterations);
          if (plan.ratios) {
            setTrainRatio(plan.ratios.train);
            setValRatio(plan.ratios.val);
            setTestRatio(plan.ratios.test);
          }
          setTessExperimentName(plan.experimentName || "");
          setTessParentModelId(plan.parentModelId || "");
          setTessTrainingNote(plan.note || "");
          setActiveView("ocr-training");
          notify("info", "提案内容を学習設定へ反映しました。内容を確認・編集してから学習を開始してください");
        }}
        experimentsByModel={experimentsByModel}
        onOpenExperiment={(experimentId) => {
          setFocusExperimentId(experimentId);
          setActiveView("experiments");
        }}
        detailRequest={modelDetailRequest}
        releaseStatuses={releases.statuses}
      />
    );
  }

  if (activeView === "experiments") {
    view = (
      <ExperimentsView
        projectId={projectId}
        experiments={experiments}
        loading={experimentsLoading}
        onRefresh={() => loadExperiments(projectId)}
        onUpdateExperiment={updateExperiment}
        onToggleAnalysis={async (experimentId, enabled) => {
          // 分析対象ON/OFF（失敗・途中停止・デバッグ実験を推薦・相関から除外する）
          try {
            const data = await request(`/api/experiments/${encodeURIComponent(experimentId)}/analysis`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ project_id: projectId, enabled }),
            });
            if (data?.item) {
              setExperiments((prev) => prev.map((row) => (row.experiment_id === experimentId ? { ...row, ...data.item } : row)));
            }
          } catch (error) {
            notify("error", `分析対象の切替に失敗しました: ${error.message}`);
          }
        }}
        onOpenModel={(name) => {
          // Experiment → 生成モデル（モデル管理のカルテを開く）
          setModelDetailRequest({ name, seq: Date.now() });
          setActiveView("ocr-models");
        }}
        focusExperimentId={focusExperimentId}
      />
    );
  }

  if (activeView === "releases") {
    view = (
      <ReleasesView
        projectId={projectId}
        releases={releases}
        experiments={experiments}
        modelInfos={modelInfos}
        loading={releasesLoading}
        onRefresh={() => loadReleases(projectId)}
        onSetStatus={async (model, status) => {
          try {
            await request("/api/releases/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ project_id: projectId, model, status }),
            });
            await loadReleases(projectId);
          } catch (error) {
            notify("error", `ステータス変更に失敗しました: ${error.message}`);
          }
        }}
        onPromote={async (model, { note, author, version }) => {
          try {
            const data = await request("/api/releases/promote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ project_id: projectId, model, note, author, version }),
            });
            notify("success", `Productionへ昇格しました: ${model} (v${data?.version})`);
            await loadReleases(projectId);
          } catch (error) {
            notify("error", `昇格に失敗しました: ${error.message}`);
          }
        }}
        onRollback={async (version, author) => {
          try {
            const data = await request("/api/releases/rollback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ project_id: projectId, version, author }),
            });
            notify("success", `v${version} へロールバックしました（新Version v${data?.version}）`);
            await loadReleases(projectId);
          } catch (error) {
            notify("error", `ロールバックに失敗しました: ${error.message}`);
          }
        }}
        onOpenModel={(name) => {
          setModelDetailRequest({ name, seq: Date.now() });
          setActiveView("ocr-models");
        }}
      />
    );
  }

  if (["inference", "ocr-inference", "cls-inference"].includes(activeView)) {
    const inferenceModels = activeView === "ocr-inference" ? ocrModels : classificationModels;
    view = (
      <InferenceView
        engine={inferEngine}
        setEngine={setInferEngine}
        easyocrLangs={inferEasyOcrLangs}
        setEasyocrLangs={setInferEasyOcrLangs}
        easyocrLanguageOptions={EASYOCR_LANGUAGE_OPTIONS}
        includeLowercase={inferIncludeLowercase}
        setIncludeLowercase={setInferIncludeLowercase}
        modelType={inferModelType}
        setModelType={setInferModelType}
        modelTypes={modelTypes}
        model={inferModel}
        setModel={setInferModel}
        models={inferenceModels}
        paddleModel={inferPaddleModel}
        setPaddleModel={setInferPaddleModel}
        paddleModels={paddleOcrModelOptions}
        tesseractModel={inferTesseractModel}
        setTesseractModel={setInferTesseractModel}
        tesseractModels={tesseractModels}
        latestModels={latestModels}
        onFileChange={selectInferenceFile}
        fileName={inferFileName}
        previewUrl={inferPreviewUrl}
        rotation={inferRotation}
        onRotate={() => setInferRotation((prev) => (prev + 90) % 360)}
        onRun={runInference}
        loading={inferLoading}
        result={inferResult}
        preprocessMode={inferPreprocessMode}
        setPreprocessMode={setInferPreprocessMode}
        effectivePreprocessMode={inferEffectivePreprocessMode}
        preprocessRecorded={inferTessPreRecorded}
      />
    );
  }

  if (activeView === "rapid-ocr") {
    view = (
      <RapidOCRView
        projectId={projectId}
        imageVersion={imageVersion}
        preprocessPresetName={selectedPreset}
        onOpenPreprocess={() => {
          setPreprocessReturnView("rapid-ocr");
          setActiveView("preprocess");
        }}
        images={currentImages}
        selectedImageName={selectedImage?.image || ""}
        onSelectImageName={(name) => {
          const idx = images.findIndex((item) => item.image === name);
          if (idx >= 0) setSelectedIndex(idx);
        }}
        engine={inferEngine}
        setEngine={setInferEngine}
        modelType={inferModelType}
        setModelType={setInferModelType}
        modelTypes={modelTypes}
        model={inferModel}
        setModel={setInferModel}
        models={classificationModels}
        paddleModel={inferPaddleModel}
        setPaddleModel={setInferPaddleModel}
        paddleModels={paddleOcrModelOptions}
        tesseractModel={inferTesseractModel}
        setTesseractModel={setInferTesseractModel}
        tesseractModels={tesseractModels}
        easyocrLangs={inferEasyOcrLangs}
        setEasyocrLangs={setInferEasyOcrLangs}
        easyocrLanguageOptions={EASYOCR_LANGUAGE_OPTIONS}
        includeLowercase={inferIncludeLowercase}
        setIncludeLowercase={setInferIncludeLowercase}
        preprocessEnabled={rapidPreprocessEnabled}
        setPreprocessEnabled={setRapidPreprocessEnabled}
        preprocessOverrides={rapidPreprocessOverrides}
      />
    );
  }

  if (activeView === "ocr-batch") {
    view = (
      <OcrBatchView
        projectId={projectId}
        engine={inferEngine}
        setEngine={setInferEngine}
        modelType={inferModelType}
        setModelType={setInferModelType}
        modelTypes={modelTypes}
        model={inferModel}
        setModel={setInferModel}
        models={classificationModels}
        paddleModel={inferPaddleModel}
        setPaddleModel={setInferPaddleModel}
        paddleModels={paddleOcrModelOptions}
        tesseractModel={inferTesseractModel}
        setTesseractModel={setInferTesseractModel}
        tesseractModels={tesseractModels}
        easyocrLangs={inferEasyOcrLangs}
        setEasyocrLangs={setInferEasyOcrLangs}
        easyocrLanguageOptions={EASYOCR_LANGUAGE_OPTIONS}
        includeLowercase={inferIncludeLowercase}
        setIncludeLowercase={setInferIncludeLowercase}
        preprocessEnabled={rapidPreprocessEnabled}
        setPreprocessEnabled={setRapidPreprocessEnabled}
        preprocessOverrides={rapidPreprocessOverrides}
      />
    );
  }

  if (["evaluation", "cls-evaluation"].includes(activeView)) {
    view = (
      <EvaluationView
        dataset={evalDataset}
        datasetOptions={evalDatasetOptions}
        setDataset={setEvalDataset}
        model={evalModel}
        setModel={setEvalModel}
        modelType={evalModelType}
        setModelType={setEvalModelType}
        modelTypes={modelTypes}
        models={classificationModels}
        latestModels={latestModels}
        useOverrides={evalUseOverrides}
        setUseOverrides={setEvalUseOverrides}
        loading={evalLoading}
        result={evalResult}
        onEvaluate={runEvaluation}
      />
    );
  }

  if (activeView === "ocr-eval") {
    view = (
      <OcrEvaluationView
        imageDir={ocrEvalImageDir}
        setImageDir={setOcrEvalImageDir}
        onBrowseImageDir={browseOcrEvalImageDir}
        gtCsv={ocrEvalGtCsv}
        setGtCsv={setOcrEvalGtCsv}
        onBrowseGtCsv={browseOcrEvalGtCsv}
        includeBase={ocrEvalIncludeBase}
        setIncludeBase={setOcrEvalIncludeBase}
        trainedModel={ocrEvalTrainedModel}
        setTrainedModel={setOcrEvalTrainedModel}
        tesseractModels={tesseractModels}
        whitelistMode={ocrEvalWhitelistMode}
        setWhitelistMode={setOcrEvalWhitelistMode}
        whitelistCustom={ocrEvalWhitelistCustom}
        setWhitelistCustom={setOcrEvalWhitelistCustom}
        whitelistDefault={TESSERACT_WHITELIST_DEFAULT}
        onRun={runOcrEvaluation}
        loading={ocrEvalLoading}
        result={ocrEvalResult}
        onExportCsv={exportOcrEvalCsv}
        datasets={ocrEvalDatasets}
        selectedDatasetId={ocrEvalDatasetId}
        onSelectDataset={selectOcrEvalDataset}
        onDeleteDataset={deleteOcrEvalDataset}
        onRenameDataset={renameOcrEvalDataset}
        overlap={ocrEvalOverlap}
        evalHistory={modelEvalHistory}
        projectId={projectId}
        preprocessSource={ocrEvalPreSource}
        onChangePreprocessSource={setOcrEvalPreSource}
        preprocessCustom={ocrEvalPreCustom}
        onChangePreprocessCustom={setOcrEvalPreCustom}
        step5Preprocess={step5EvalPreprocess}
        modelInfos={modelInfos}
      />
    );
  }

  const imageBuilderStepMap = {
    "image-builder-step1": 1,
    "image-builder-step2": 2,
    "image-builder-step3": 3,
    "image-builder-step4": 4,
    "image-builder-step5": 5,
  };
  const activeImageBuilderStep = imageBuilderStepMap[activeView];

  if (activeImageBuilderStep) {
    view = (
      <TrainingImageBuilderView
        projectId={projectId}
        activeStep={activeImageBuilderStep}
        onStepChange={(step) => {
          const nextView = `image-builder-step${step}`;
          setActiveView(nextView);
        }}
        // Step5（評価用データ作成）用。OCR設定はStep5専用（localStorage別キー）で、
        // ここからはモデル一覧・辞書・プロジェクト共通の前処理オーバーライドのみ渡す
        onOpenEvaluation={openEvaluationWithDataset}
        labelingPreprocessOverrides={labelingPreprocessOverrides}
        candidateDict={candidateDict}
        paddleModels={paddleOcrModelOptions}
        tesseractModels={tesseractModels}
      />
    );
  }

  const showWorkflow = [
    "dashboard",
    "images",
    "preprocess",
    "labeling",
    "training",
    "ocr-training",
    "cls-training",
    "models",
    "ocr-models",
    "cls-models",
    "inference",
    "ocr-inference",
    "cls-inference",
    "rapid-ocr",
    "ocr-batch",
    "ocr-eval",
    "evaluation",
    "cls-evaluation",
  ].includes(activeView);
  const suppressRapidOcrInferenceNotice =
    activeView === "rapid-ocr" && /^推論結果:\s*/.test(String(notice?.text || ""));
  // OCR学習画面と学習画像作成Step3はデスクトップ(xl=1280px以上)でビューポート内へ収める
  // （ページ縦スクロールなし・内部スクロールのみ。Step3は画像領域を最大化するため）。
  // 固定px差し引き(calc)ではなく main→section→ビュー の親Flex残り高さ継承で実現する
  const fitViewport =
    activeView === "ocr-training" ||
    activeView === "image-builder-step3" ||
    activeView === "image-builder-step5" ||
    activeView === "ocr-eval";

  return (
    <div className="min-h-screen bg-transparent text-text">
      <Sidebar
        active={activeView}
        onChange={setActiveView}
        onExitApp={exitApplication}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapsed}
      />

      <main
        className={`${sidebarCollapsed ? "ml-14" : "ml-64"} ${
          fitViewport ? "xl:flex xl:h-dvh xl:min-h-0 xl:flex-col xl:overflow-hidden" : ""
        } min-h-screen px-6 py-4 transition-[margin-left] duration-200`}
      >
        {/* タイトル行・ワークフローは固定領域（ビューポート固定時に縮めない） */}
        <div className={fitViewport ? "xl:shrink-0" : ""}>
          <Header
            title={currentMeta.title}
            subtitle={`${currentMeta.subtitle} / プロジェクト: ${projectId}`}
            status={jobStatus}
            labelProgress={
              activeView === "labeling"
                ? {
                    labeled: labeledCount,
                    total: images.length,
                  }
                : null
            }
          />
          {showWorkflow ? <WorkflowProgress steps={workflowSteps} activeView={activeView} onNavigate={setActiveView} /> : null}
          {EXPERIMENTAL_VIEWS.has(activeView) ? <ExperimentalNotice className="mt-4" /> : null}
        </div>

        <section
          className={`mt-6 ${
            fitViewport ? "xl:mt-4 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden" : ""
          }`}
        >
          {/* 1画面の例外でアプリ全体が消えないよう画面単位で捕捉（key=画面IDで切替時に自動リセット）。
              学習画像作成のStep1〜4は同一コンポーネントのため単一key（Step遷移で選択画像・検出結果を消さない） */}
          <ViewErrorBoundary
            key={viewBoundaryKey(activeView)}
            viewName={viewMeta[activeView]?.title || activeView}
            onBackToDashboard={() => setActiveView("dashboard")}
          >
            {view}
          </ViewErrorBoundary>
        </section>

        {!notice || suppressRapidOcrInferenceNotice ? null : (
          <div
            className={`fixed bottom-5 right-6 rounded-lg border px-4 py-2 text-sm ${
              notice.kind === "success"
                ? "border-success/30 bg-success/10 text-success"
                : notice.kind === "error"
                  ? "border-danger/30 bg-danger/10 text-danger"
                  : "border-border bg-card text-muted"
            }`}
          >
            {notice.text}
          </div>
        )}
      </main>
    </div>
  );
}
