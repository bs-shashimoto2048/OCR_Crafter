import { useEffect, useMemo, useRef, useState } from "react";

import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import WorkflowProgress from "./components/WorkflowProgress";
import DashboardView from "./views/DashboardView";
import ImagesView from "./views/ImagesView";
import LabelingView from "./views/LabelingView";
import TrainingView from "./views/TrainingView";
import ModelsView from "./views/ModelsView";
import InferenceView from "./views/InferenceView";
import PreprocessView from "./views/PreprocessView";
import EvaluationView from "./views/EvaluationView";
import TrainingImageBuilderView from "./views/TrainingImageBuilderView";
import RapidOCRView from "./views/RapidOCRView";
import OcrBatchView from "./views/OcrBatchView";
import { API_BASE, imageUrl, request } from "./lib/api";

const viewMeta = {
  dashboard: { title: "ダッシュボード", subtitle: "OCR学習ワークフロー全体を管理" },
  images: { title: "画像", subtitle: "画像取り込みと一覧確認" },
  preprocess: { title: "前処理設定", subtitle: "前処理パラメータ設定とプレビュー" },
  labeling: { title: "ラベル編集", subtitle: "数字ラベル編集" },
  training: { title: "学習", subtitle: "学習ジョブ実行とログ監視" },
  "ocr-training": { title: "学習", subtitle: "OCR認識モデル: OCRデータ作成・学習" },
  "cls-training": { title: "学習", subtitle: "分割学習モデル: 前処理・データセット作成・学習" },
  models: { title: "モデル", subtitle: "保存済みモデル管理" },
  "ocr-models": { title: "モデル", subtitle: "OCR認識モデルの管理" },
  "cls-models": { title: "モデル", subtitle: "分割学習モデルの管理" },
  inference: { title: "推論", subtitle: "画像推論と精度確認" },
  "ocr-inference": { title: "推論", subtitle: "OCR認識モデルで推論" },
  "cls-inference": { title: "推論", subtitle: "分割学習モデルで推論" },
  evaluation: { title: "評価", subtitle: "精度評価と誤認識分析" },
  "cls-evaluation": { title: "評価", subtitle: "分割学習モデルの精度評価" },
  "rapid-ocr": { title: "OCR修正", subtitle: "キーボード中心でOCR結果を素早く修正" },
  "ocr-batch": { title: "バッチ推論", subtitle: "OCR認識モデルで複数画像を一括推論" },
  "image-builder-step1": { title: "学習画像作成", subtitle: "Step1: 画像指定とリサイズ" },
  "image-builder-step2": { title: "学習画像作成", subtitle: "Step2: YOLO検出" },
  "image-builder-step3": { title: "学習画像作成", subtitle: "Step3: Bounding Box選択" },
  "image-builder-step4": { title: "学習画像作成", subtitle: "Step4: クロップ出力" },
};

const PRESET_STORAGE_KEY = "ocr_preprocess_presets_v1";
const PREPROCESS_PARAMS_BY_PROJECT_STORAGE_KEY = "ocr_preprocess_params_by_project_v1";
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
const FIXED_PADDLE_OCR_REPO_DIR = "/Users/hashimoto/vscode/_app/ocr_crafter/external/PaddleOCR";
const DEFAULT_PREPROCESS_PARAMS = {
  ratio_threshold: 1.6,
  single_size: 64,
  wide_height: 48,
  wide_keep_ratio: true,
  threshold_type: "binary",
  threshold_value: 128,
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

export default function App() {
  const [activeView, setActiveView] = useState("dashboard");
  const [notice, setNotice] = useState(null);

  const [projects, setProjects] = useState([]);
  const [projectSummaries, setProjectSummaries] = useState({});
  const [projectId, setProjectId] = useState("");
  const [newProjectId, setNewProjectId] = useState("");

  const [sourceDir, setSourceDir] = useState("");
  const [images, setImages] = useState([]);
  const [labelDrafts, setLabelDrafts] = useState({});
  const [labelUppercase, setLabelUppercase] = useState(false);
  const [imageShapes, setImageShapes] = useState({});
  const [imageVersion, setImageVersion] = useState(0);
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
  const [epochs, setEpochs] = useState(50);
  const [batchSize, setBatchSize] = useState(16);
  const [learningRate, setLearningRate] = useState(0.001);
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState("idle");
  const [jobFamily, setJobFamily] = useState("classification");
  const [logs, setLogs] = useState([]);

  const [ocrEngine, setOcrEngine] = useState("paddleocr");
  const [ocrCharset, setOcrCharset] = useState(OCR_CHARSET_DEFAULT);
  const [ocrMaxTextLength, setOcrMaxTextLength] = useState(8);
  const [ocrImageShape, setOcrImageShape] = useState("3,48,320");
  const [ocrUseAugmentation, setOcrUseAugmentation] = useState(false);
  const [ocrAugStrength, setOcrAugStrength] = useState(1);
  const [ocrDatasetDir, setOcrDatasetDir] = useState("");
  const [ocrDatasetInfo, setOcrDatasetInfo] = useState(null);
  const [ocrFromLogsOnlyInvalid, setOcrFromLogsOnlyInvalid] = useState(true);
  const [ocrFromLogsIncludeCorrected, setOcrFromLogsIncludeCorrected] = useState(true);

  const [models, setModels] = useState([]);
  const [modelInfos, setModelInfos] = useState({});
  const [latestModels, setLatestModels] = useState({ any: "", byType: {}, ocrPaddle: "" });
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
        return info.training_family === "ocr" && info.engine === "paddleocr";
      }),
    [models, modelInfos]
  );
  const ocrModels = useMemo(
    () =>
      models.filter((name) => {
        const info = modelInfos[name] || {};
        return info.training_family === "ocr";
      }),
    [models, modelInfos]
  );

  const [inferModelType, setInferModelType] = useState("square");
  const [inferModel, setInferModel] = useState("latest");
  const [inferEngine, setInferEngine] = useState("custom");
  const [inferEasyOcrLangs, setInferEasyOcrLangs] = useState(["en"]);
  const [inferPaddleModel, setInferPaddleModel] = useState("latest");
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
  const [preprocessPredictModelType, setPreprocessPredictModelType] = useState("square");
  const [preprocessPredictEasyOcrLangs, setPreprocessPredictEasyOcrLangs] = useState(["en"]);
  const [preprocessPreview, setPreprocessPreview] = useState(null);
  const [preprocessLoading, setPreprocessLoading] = useState(false);
  const [preprocessError, setPreprocessError] = useState("");
  const [preprocessPresets, setPreprocessPresets] = useState({});
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [rapidPreprocessEnabled, setRapidPreprocessEnabled] = useState(true);

  const lastStatusRef = useRef("");
  const lastMessageRef = useRef("");
  const stopPollingRef = useRef(false);
  const preprocessParamsByProjectRef = useRef({});
  const skipPreprocessPersistRef = useRef(false);
  const noticeTimerRef = useRef(null);

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

  function buildPreprocessOverrides(params) {
    return {
      preprocess: {
        ratio_threshold: Number(params.ratio_threshold),
        operations: {
          threshold: {
            type: params.threshold_type,
            value: Number(params.threshold_value),
          },
          clahe: {
            clip_limit: Number(params.clahe_clip_limit),
            tile_grid_size: Number(params.clahe_tile_grid_size),
          },
          sharpen: {
            enabled: Boolean(params.sharpen_enabled),
            amount: Number(params.sharpen_amount),
            sigma: Number(params.sharpen_sigma),
          },
          gamma: {
            enabled: Boolean(params.gamma_enabled),
            value: Number(params.gamma_value),
          },
          morph: {
            enabled: Boolean(params.morph_enabled),
            method: params.morph_method,
            ksize: Number(params.morph_ksize),
            iterations: Number(params.morph_iterations),
          },
          unsharp: {
            enabled: Boolean(params.unsharp_enabled),
            amount: Number(params.unsharp_amount),
            radius: Number(params.unsharp_radius),
            threshold: Number(params.unsharp_threshold),
          },
          bilateral: {
            enabled: Boolean(params.bilateral_enabled),
            diameter: Number(params.bilateral_diameter),
            sigma_color: Number(params.bilateral_sigma_color),
            sigma_space: Number(params.bilateral_sigma_space),
          },
          local_contrast: {
            enabled: Boolean(params.local_contrast_enabled),
            clip_limit: Number(params.local_contrast_clip_limit),
            tile_grid_size: Number(params.local_contrast_tile_grid_size),
          },
          crop_margin: {
            enabled: Boolean(params.crop_margin_enabled),
            threshold: Number(params.crop_margin_threshold),
            margin: Number(params.crop_margin_margin),
          },
          hist_equalize: {
            enabled: Boolean(params.hist_equalize_enabled),
          },
          stroke_boost: {
            enabled: Boolean(params.stroke_boost_enabled),
            method: params.stroke_boost_method,
            ksize: Number(params.stroke_boost_ksize),
            iterations: Number(params.stroke_boost_iterations),
          },
          denoise: {
            method: params.denoise_method,
            ksize: Number(params.denoise_ksize),
          },
          deskew: {
            enabled: Boolean(params.deskew_enabled),
          },
          resize: {
            single: Number(params.single_size),
            wide_height: Number(params.wide_height),
            keep_ratio: Boolean(params.wide_keep_ratio),
          },
        },
      },
    };
  }

  function persistPreprocessPresets(next) {
    setPreprocessPresets(next);
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
  }

  async function loadProjects(preferredProjectId = projectId) {
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

  async function loadImages(targetProjectId = projectId) {
    if (!targetProjectId) {
      setImages([]);
      setLabelDrafts({});
      setSelectedIndex(0);
      return;
    }
    const pid = encodeURIComponent(targetProjectId);
    const data = await request(`/images?project_id=${pid}`);
    const items = data.items || [];
    setImages(items);

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
      setLatestModels({ any: "", byType: {}, ocrPaddle: "" });
      setModelTypes([]);
      return;
    }
    const pid = encodeURIComponent(targetProjectId);
    const [modelsData, typesData, infosData] = await Promise.all([
      request(`/models?project_id=${pid}`),
      request(`/model-types?project_id=${pid}`),
      request(`/models/info?project_id=${pid}`).catch(() => ({ items: [] })),
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
    setLatestModels({ any: latestAny, byType, ocrPaddle: latestOcrPaddle });
  }

  async function refreshAll(targetProjectId = projectId) {
    if (!targetProjectId) {
      setImages([]);
      setLabelDrafts({});
      setSelectedIndex(0);
      setModels([]);
      setModelInfos({});
      setLatestModels({ any: "", byType: {}, ocrPaddle: "" });
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
    refreshAll(projectId).catch((error) => notify("error", error.message));
  }, [projectId]);

  useEffect(() => {
    setWorkflowState({
      refreshed: false,
      preprocessed: false,
      datasetBuilt: false,
      trainingStarted: false,
    });
    resetTrainingLog();
  }, [projectId]);

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
    if (inferPaddleModel !== "latest" && !ocrPaddleModels.includes(inferPaddleModel)) {
      setInferPaddleModel("latest");
    }
    if (evalModel !== "latest" && !classificationModels.includes(evalModel)) {
      setEvalModel("latest");
    }
    if (preprocessPredictModel !== "latest" && !classificationModels.includes(preprocessPredictModel)) {
      setPreprocessPredictModel("latest");
    }
    if (preprocessPredictPaddleModel !== "latest" && !ocrPaddleModels.includes(preprocessPredictPaddleModel)) {
      setPreprocessPredictPaddleModel("latest");
    }
  }, [
    classificationModels,
    ocrPaddleModels,
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setPreprocessPresets(parsed);
      }
    } catch {
      // ignore invalid local storage payload
    }
  }, []);

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

  useEffect(() => {
    if (activeView !== "preprocess") {
      return undefined;
    }
    if (!projectId || !preprocessImage) {
      setPreprocessPreview(null);
      return undefined;
    }

    setPreprocessLoading(true);
    setPreprocessError("");

    const timer = setTimeout(async () => {
      try {
        const data = await request("/preprocess/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: preprocessImage,
            project_id: projectId,
            overrides: buildPreprocessOverrides(preprocessParams),
            engine: preprocessPredictEngine,
            model:
              preprocessPredictEngine === "custom"
                ? preprocessPredictModel
                : preprocessPredictEngine === "paddleocr"
                  ? preprocessPredictPaddleModel
                  : "latest",
            model_type:
              preprocessPredictEngine === "custom" && preprocessPredictModel === "latest"
                ? preprocessPredictModelType
                : null,
            easyocr_langs:
              preprocessPredictEngine === "easyocr" || preprocessPredictEngine === "paddleocr"
                ? (preprocessPredictEasyOcrLangs.length > 0 ? preprocessPredictEasyOcrLangs.join(",") : "en")
                : "en",
          }),
        });
        setPreprocessPreview(data);
      } catch (error) {
        setPreprocessPreview(null);
        setPreprocessError(error.message);
      } finally {
        setPreprocessLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [
    activeView,
    projectId,
    preprocessImage,
    preprocessParams,
    preprocessPredictEngine,
    preprocessPredictModel,
    preprocessPredictPaddleModel,
    preprocessPredictModelType,
    preprocessPredictEasyOcrLangs,
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
        setJobStatus(data.status || "unknown");

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
      if ((key === "Enter" || key === "NumpadEnter") && !event.isComposing) {
        event.preventDefault();
        saveLabel(selected.image).catch(() => null);
        return;
      }
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

  const selectedImage = images[selectedIndex] || null;
  const selectedLabel = selectedImage ? labelDrafts[selectedImage.image] ?? "" : "";
  const labelingPreprocessOverrides = useMemo(
    () => buildPreprocessOverrides(preprocessParams),
    [preprocessParams]
  );
  const rapidPreprocessOverrides = useMemo(
    () => buildPreprocessOverrides(preprocessParams),
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

  const canTrain = workflowState.datasetBuilt && savedLabeledCount > 0;
  const canStartOcrTraining = ocrEngine === "paddleocr" && String(ocrDatasetDir || "").trim() !== "";
  const workflowSteps = useMemo(() => {
    const labelDone = images.length > 0 && savedLabeledCount === images.length;
    const defs = [
      { id: "images", label: "画像取込", done: images.length > 0, meta: `${images.length}件` },
      { id: "preprocess", label: "前処理", done: workflowState.preprocessed },
      { id: "labeling", label: "ラベル", done: labelDone, meta: `${savedLabeledCount}/${images.length}` },
      { id: "dataset", label: "データセット", done: workflowState.datasetBuilt },
      {
        id: "training",
        label: "学習",
        done: jobStatus === "completed",
        running: jobStatus === "running" || jobStatus === "queued",
        error: jobStatus === "failed",
      },
      { id: "evaluation", label: "評価", done: Boolean(evalResult) },
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
  }, [images.length, savedLabeledCount, workflowState.preprocessed, workflowState.datasetBuilt, jobStatus, evalResult]);

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
      return;
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
      setImageVersion((prev) => prev + 1);
      setWorkflowState((prev) => ({
        refreshed: prev.refreshed,
        preprocessed: false,
        datasetBuilt: false,
        trainingStarted: false,
      }));
      notify("success", `${imageName} を回転しました（${angle > 0 ? "+" : ""}${angle}°）`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function saveLabel(imageName) {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
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
      setSelectedIndex((prev) => {
        const currentIndex = images.findIndex((item) => item.image === imageName);
        const base = currentIndex >= 0 ? currentIndex : prev;
        return Math.min(base + 1, Math.max(images.length - 1, 0));
      });
      notify("success", `ラベル保存: ${imageName} -> ${value || "(空)"}`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function runPreprocess() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    resetTrainingLog("前処理を再実行します");
    try {
      const data = await request("/preprocess/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
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
      const imageShape = parseOcrImageShape(ocrImageShape);
      const payload = {
        project_id: projectId,
        image_types: ["wide"],
        charset: (ocrCharset || OCR_CHARSET_DEFAULT).toUpperCase(),
        max_text_length: Number(ocrMaxTextLength),
        image_shape: imageShape,
        use_augmentation: Boolean(ocrUseAugmentation),
        aug_strength: Number(ocrAugStrength),
        train_ratio: Number(trainRatio),
        val_ratio: Number(valRatio),
        test_ratio: Number(testRatio),
        output_dir: null,
        overwrite: false,
      };
      const data = await request("/api/ocr/dataset/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setOcrDatasetInfo(data);
      setOcrDatasetDir(data.dataset_root || "");
      resetTrainingLog("OCRデータセットを作成します");
      pushLog(
        `OCRデータ作成: train=${data?.counts?.train ?? 0}, val=${data?.counts?.val ?? 0}, test=${data?.counts?.test ?? 0}`
      );
      notify("success", "OCRデータセットを作成しました");
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function createOcrDatasetFromLogs() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    try {
      const imageShape = parseOcrImageShape(ocrImageShape);
      const payload = {
        project_id: projectId,
        only_invalid: Boolean(ocrFromLogsOnlyInvalid),
        include_corrected: Boolean(ocrFromLogsIncludeCorrected),
        max_text_length: Number(ocrMaxTextLength),
        charset: (ocrCharset || OCR_CHARSET_DEFAULT).toUpperCase(),
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

  async function startTraining() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    try {
      const data = await request("/train/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          model_type: modelType,
          epochs: Number(epochs),
          batch_size: Number(batchSize),
          learning_rate: Number(learningRate),
        }),
      });

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

  async function startOcrTraining() {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    if (ocrEngine !== "paddleocr") {
      notify("error", "EasyOCR は学習対象外です。PaddleOCRを選択してください。");
      return;
    }
    try {
      const imageShape = parseOcrImageShape(ocrImageShape);
      resetTrainingLog(`OCR学習開始要求: プロジェクト=${projectId}`);
      const payload = {
        project_id: projectId,
        engine: "paddleocr",
        dataset_dir: ocrDatasetDir,
        paddle_repo_dir: FIXED_PADDLE_OCR_REPO_DIR,
        charset: (ocrCharset || OCR_CHARSET_DEFAULT).toUpperCase(),
        max_text_length: Number(ocrMaxTextLength),
        image_shape: imageShape,
        batch_size: Number(batchSize),
        epochs: Number(epochs),
      };
      const data = await request("/api/ocr/train/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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
      notify("info", `OCR学習キューに追加しました (${data.job_id})`);
      setActiveView("ocr-training");
    } catch (error) {
      notify("error", error.message);
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
      } else if (inferEngine === "easyocr") {
        formData.append("easyocr_langs", inferEasyOcrLangs.length > 0 ? inferEasyOcrLangs.join(",") : "en");
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

  async function deleteSelectedModels(modelNames) {
    if (!projectId) {
      notify("error", "プロジェクトを作成または選択してください");
      return;
    }
    const names = Array.isArray(modelNames) ? modelNames.filter(Boolean) : [];
    if (names.length === 0) {
      return;
    }

    try {
      const pid = encodeURIComponent(projectId);
      await Promise.all(
        names.map((name) =>
          request(`/models/${encodeURIComponent(name)}?project_id=${pid}`, {
            method: "DELETE",
          })
        )
      );
      await loadModels(projectId);
      notify("success", `${names.length} 件のモデルを削除しました`);
      pushLog(`モデル削除: ${names.join(", ")}`);
    } catch (error) {
      notify("error", error.message);
    }
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
        overrides: evalUseOverrides ? buildPreprocessOverrides(preprocessParams) : null,
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
        imagesCount={images.length}
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
        images={images}
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
        images={images}
        selectedImage={preprocessImage}
        onSelectImage={setPreprocessImage}
        defaultParams={DEFAULT_PREPROCESS_PARAMS}
        predictEngine={preprocessPredictEngine}
        setPredictEngine={setPreprocessPredictEngine}
        predictModel={preprocessPredictModel}
        setPredictModel={setPreprocessPredictModel}
        predictPaddleModel={preprocessPredictPaddleModel}
        setPredictPaddleModel={setPreprocessPredictPaddleModel}
        predictModelType={preprocessPredictModelType}
        setPredictModelType={setPreprocessPredictModelType}
        predictEasyOcrLangs={preprocessPredictEasyOcrLangs}
        setPredictEasyOcrLangs={setPreprocessPredictEasyOcrLangs}
        easyocrLanguageOptions={EASYOCR_LANGUAGE_OPTIONS}
        modelTypes={modelTypes}
        models={classificationModels}
        paddleModels={ocrPaddleModels}
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
      />
    );
  }

  if (activeView === "labeling") {
    view = (
      <LabelingView
        projectId={projectId}
        imageVersion={imageVersion}
        preprocessOverrides={labelingPreprocessOverrides}
        images={images}
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
        onSave={() => (selectedImage ? saveLabel(selectedImage.image) : Promise.resolve())}
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
        ocrEngine={ocrEngine}
        setOcrEngine={setOcrEngine}
        ocrCharset={ocrCharset}
        setOcrCharset={setOcrCharset}
        ocrMaxTextLength={ocrMaxTextLength}
        setOcrMaxTextLength={setOcrMaxTextLength}
        ocrImageShape={ocrImageShape}
        setOcrImageShape={setOcrImageShape}
        ocrUseAugmentation={ocrUseAugmentation}
        setOcrUseAugmentation={setOcrUseAugmentation}
        ocrAugStrength={ocrAugStrength}
        setOcrAugStrength={setOcrAugStrength}
        ocrDatasetDir={ocrDatasetDir}
        setOcrDatasetDir={setOcrDatasetDir}
        ocrDatasetInfo={ocrDatasetInfo}
        ocrFromLogsOnlyInvalid={ocrFromLogsOnlyInvalid}
        setOcrFromLogsOnlyInvalid={setOcrFromLogsOnlyInvalid}
        ocrFromLogsIncludeCorrected={ocrFromLogsIncludeCorrected}
        setOcrFromLogsIncludeCorrected={setOcrFromLogsIncludeCorrected}
        onBrowseOcrDatasetDir={browseOcrDatasetDirectory}
        onCreateOcrDataset={createOcrDataset}
        onCreateOcrDatasetFromLogs={createOcrDatasetFromLogs}
        onPreprocess={runPreprocess}
        onBuildDataset={buildDataset}
        onStartTraining={startTraining}
        onStartOcrTraining={startOcrTraining}
        canTrain={canTrain}
        canStartOcrTraining={canStartOcrTraining}
        jobId={jobId}
        jobStatus={jobStatus}
        logs={logs}
        workflowState={workflowState}
      />
    );
  }

  if (["models", "ocr-models", "cls-models"].includes(activeView)) {
    const modelItems = activeView === "ocr-models" ? ocrModels : activeView === "cls-models" ? classificationModels : models;
    const latestForView =
      activeView === "ocr-models"
        ? { any: latestModels.ocrPaddle || "", byType: { ocr: latestModels.ocrPaddle || "" } }
        : latestModels;
    view = (
      <ModelsView
        models={modelItems}
        modelInfos={modelInfos}
        latest={latestForView}
        onRefresh={() => loadModels(projectId)}
        onDeleteSelected={deleteSelectedModels}
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
        modelType={inferModelType}
        setModelType={setInferModelType}
        modelTypes={modelTypes}
        model={inferModel}
        setModel={setInferModel}
        models={inferenceModels}
        paddleModel={inferPaddleModel}
        setPaddleModel={setInferPaddleModel}
        paddleModels={ocrPaddleModels}
        latestModels={latestModels}
        onFileChange={selectInferenceFile}
        fileName={inferFileName}
        previewUrl={inferPreviewUrl}
        rotation={inferRotation}
        onRotate={() => setInferRotation((prev) => (prev + 90) % 360)}
        onRun={runInference}
        loading={inferLoading}
        result={inferResult}
      />
    );
  }

  if (activeView === "rapid-ocr") {
    view = (
      <RapidOCRView
        projectId={projectId}
        imageVersion={imageVersion}
        images={images}
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
        paddleModels={ocrPaddleModels}
        easyocrLangs={inferEasyOcrLangs}
        setEasyocrLangs={setInferEasyOcrLangs}
        easyocrLanguageOptions={EASYOCR_LANGUAGE_OPTIONS}
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
        paddleModels={ocrPaddleModels}
        easyocrLangs={inferEasyOcrLangs}
        setEasyocrLangs={setInferEasyOcrLangs}
        easyocrLanguageOptions={EASYOCR_LANGUAGE_OPTIONS}
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

  const imageBuilderStepMap = {
    "image-builder-step1": 1,
    "image-builder-step2": 2,
    "image-builder-step3": 3,
    "image-builder-step4": 4,
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
    "evaluation",
    "cls-evaluation",
  ].includes(activeView);
  const suppressRapidOcrInferenceNotice =
    activeView === "rapid-ocr" && /^推論結果:\s*/.test(String(notice?.text || ""));

  return (
    <div className="min-h-screen bg-transparent text-text">
      <Sidebar active={activeView} onChange={setActiveView} onExitApp={exitApplication} />

      <main className="ml-64 min-h-screen px-8 py-6">
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
        {showWorkflow ? <WorkflowProgress steps={workflowSteps} /> : null}

        <section className="mt-6">{view}</section>

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
