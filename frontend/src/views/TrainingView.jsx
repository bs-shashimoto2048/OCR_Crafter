import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Card from "../components/Card";
import Button from "../components/Button";
import { PADDLEOCR_OFFICIAL_MODELS_TOOLTIP } from "../lib/paddleocrOfficialTooltip";
import { autoTestRatio, normalizeRatioInput, summarizeRatios } from "../lib/ratio";
import AugmentationSettingsPanel from "../components/AugmentationSettingsPanel";
import { augCategorySummaryLabel } from "../lib/augmentationSettings";
import {
  UI_TRAINING_STATE_LABELS,
  classifyLogLine,
  computeEtaSeconds,
  computeProgressPercent,
  deriveUiTrainingState,
  formatDuration,
  isImportantLogLine,
  parseTrainingProgress,
  summarizeImportantEvents,
} from "../lib/trainingLog";

const OCR_CHARSET_DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
// Tesseract学習対象文字セット（A-Z / 0-9 / 小文字筆記体 k,l,t）
const TESSERACT_CHARSET_DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt";

// 次回学習の設定モーダルのタブ（4カテゴリ。設定値・保存処理は従来のstateを共有する）
const NEXT_SETTINGS_TABS = [
  { id: "split", label: "データ分割" },
  { id: "augmentation", label: "オーグメンテーション" },
  { id: "params", label: "学習パラメータ" },
  { id: "engine", label: "エンジン設定" },
];
// 最後に開いた設定カテゴリの保存キー（初期表示の維持用。UI状態のみで設定値は含まない）
const NEXT_SETTINGS_TAB_STORAGE_KEY = "ocr_training_settings_tab_v1";

// ラベル横の ⓘ ヘルプ（title属性によるツールチップ表示）
function InfoHint({ text }) {
  return (
    <span title={text} className="ml-1 inline-block cursor-help align-middle text-[11px] text-accent" aria-label="ヘルプ">
      ⓘ
    </span>
  );
}

export default function TrainingView({
  trainingMode = "all",
  projectId,
  trainingFamily,
  setTrainingFamily,
  modelType,
  setModelType,
  modelTypes,
  trainRatio,
  setTrainRatio,
  valRatio,
  setValRatio,
  testRatio,
  setTestRatio,
  epochs,
  setEpochs,
  batchSize,
  setBatchSize,
  learningRate,
  setLearningRate,
  clsInitSourceType,
  setClsInitSourceType,
  clsInitSourceValue,
  setClsInitSourceValue,
  freezeBackboneEpochs,
  setFreezeBackboneEpochs,
  backboneLrScale,
  setBackboneLrScale,
  classificationInitModelOptions,
  savedLabeledCount,
  ocrEngine,
  setOcrEngine,
  ocrCharset,
  setOcrCharset,
  experimentName,
  setExperimentName,
  parentModelId,
  setParentModelId,
  trainingNote,
  setTrainingNote,
  ocrMaxTextLength,
  setOcrMaxTextLength,
  ocrImageShape,
  setOcrImageShape,
  ocrAugmentation,
  setOcrAugmentation,
  ocrAugPreview,
  ocrAugPreviewLoading,
  onPreviewAugmentation,
  ocrSplitSeed,
  setOcrSplitSeed,
  ocrSplitPreview,
  ocrSplitPreviewLoading,
  onPreviewSplit,
  ratioError,
  ocrDatasetDir,
  ocrDatasetCreateMode,
  setOcrDatasetCreateMode,
  ocrFromLogsOnlyInvalid,
  setOcrFromLogsOnlyInvalid,
  ocrFromLogsIncludeCorrected,
  setOcrFromLogsIncludeCorrected,
  ocrInitSourceType,
  setOcrInitSourceType,
  ocrInitSourceValue,
  setOcrInitSourceValue,
  ocrInitModelOptions,
  ocrOfficialInitModelOptions,
  ocrTrainDevice,
  setOcrTrainDevice,
  ocrTrainNumWorkers,
  setOcrTrainNumWorkers,
  ocrEvalNumWorkers,
  setOcrEvalNumWorkers,
  ocrSaveEpochStep,
  setOcrSaveEpochStep,
  ocrAutoBatchSize,
  setOcrAutoBatchSize,
  ocrUseAmp,
  setOcrUseAmp,
  ocrPinMemory,
  setOcrPinMemory,
  ocrPersistentWorkers,
  setOcrPersistentWorkers,
  systemCheck,
  onApplyOcrTrainingPreset,
  ocrDatasetInfo,
  onCreateSelectedOcrDataset,
  onPreprocess,
  onBuildDataset,
  onStartTraining,
  onStartOcrTraining,
  onStopTraining,
  onStopTrainingAndDelete,
  canTrain,
  canStartOcrTraining,
  jobId,
  jobStatus,
  jobInfo = null,
  stopRequested = false,
  startPending = false,
  onOpenModels,
  onOpenInference,
  logs,
  workflowState,
}) {
  const [paramsCollapsed, setParamsCollapsed] = useState(false);
  const [showOcrOfficialModelHelp, setShowOcrOfficialModelHelp] = useState(false);
  const logContainerRef = useRef(null);
  const preprocessed = Boolean(workflowState?.preprocessed);
  const datasetBuilt = Boolean(workflowState?.datasetBuilt);
  const trainingStarted = Boolean(workflowState?.trainingStarted);
  const isRunning = jobStatus === "queued" || jobStatus === "running";
  const isCompleted = jobStatus === "completed";
  const isFailed = jobStatus === "failed";
  const isStopped = jobStatus === "stopped";
  const canToggleParams = trainingStarted || isRunning || isCompleted || isFailed || isStopped;

  // ---- 学習状態の導出とログ解析（lib/trainingLog.js の純関数） ----
  const trainingProgress = useMemo(() => parseTrainingProgress(logs), [logs]);
  // UI状態: idle/preparing/training/stopping/completed/failed/cancelled
  const uiTrainingState = startPending
    ? "preparing"
    : deriveUiTrainingState(jobStatus, {
        hasIterationLog: trainingProgress.iteration !== null,
        stopRequested,
      });
  // 日本語表示ラベル（共通定義 UI_TRAINING_STATE_LABELS が唯一のソース。未知状態は「状態不明」）
  const statusLabel = UI_TRAINING_STATE_LABELS[uiTrainingState] ?? "状態不明";
  // 「次回学習の設定」の開閉。ユーザー操作後はポーリング・状態変化でも開閉を維持する（null=未操作）
  const [settingsToggled, setSettingsToggled] = useState(null);
  const nextSettingsOpen = settingsToggled ?? (uiTrainingState === "idle" && !jobInfo);
  // 次回学習の設定モーダル（null=閉 / タブID=開）。最後に開いたカテゴリを保存し初期表示を維持する
  const [settingsTab, setSettingsTab] = useState(null);
  function openSettingsTab(tabId) {
    setSettingsTab(tabId);
    try {
      window.localStorage?.setItem(NEXT_SETTINGS_TAB_STORAGE_KEY, tabId);
    } catch {
      // 保存失敗（容量等）は無視（表示状態はメモリ側で維持される）
    }
  }
  function closeSettingsModal() {
    setSettingsTab(null);
  }
  // Escでモーダルを閉じる
  useEffect(() => {
    if (!settingsTab) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setSettingsTab(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsTab]);
  // 実行時設定（ジョブスナップショット）の開閉。低い画面でも次回学習設定の高さを確保するため初期は閉じる
  const [runtimeSettingsOpen, setRuntimeSettingsOpen] = useState(false);
  // 詳細ログの開閉。開時は右ペインの高さを重要イベントと分割する（右カード全体の高さは変えない）
  const [detailLogOpen, setDetailLogOpen] = useState(false);
  // OCR学習画面(ocr-training)のみビューポート固定レイアウトを適用（親App側のFlex残り高さを継承する）
  const fitViewport = trainingMode === "ocr";
  const eventsRef = useRef(null);
  useEffect(() => {
    if (!UI_TRAINING_STATE_LABELS[uiTrainingState] || uiTrainingState === "unknown") {
      // 未知状態はidleへ偽装せず警告を残す（バックエンドの状態追加時の検知用）
      console.warn(`未対応の学習状態: ${jobStatus} (ui: ${uiTrainingState})`);
    }
  }, [uiTrainingState, jobStatus]);
  // preparing/training/stopping 中は設定変更・データ再作成・再開始を禁止する
  const settingsLocked = ["preparing", "training", "stopping"].includes(uiTrainingState);
  // 最大iteration: ログ（Paddleのepoch総数）優先、無ければジョブ設定（Tesseractは epochs=max_iterations を流用）
  const maxIterations =
    trainingProgress.maxFromLog ?? (Number.isFinite(Number(jobInfo?.epochs)) && Number(jobInfo?.epochs) > 0 ? Number(jobInfo.epochs) : null);
  const progressPercent = computeProgressPercent(trainingProgress.iteration, maxIterations);
  const etaSeconds = computeEtaSeconds(trainingProgress.samples, maxIterations);
  // 縦型タイムライン用の整形済み重要イベント（生ログ全文は詳細ログで確認）
  const importantEvents = useMemo(() => summarizeImportantEvents(logs, maxIterations), [logs, maxIterations]);
  // 進捗バーの色: 実行中=青 / 完了=緑 / 失敗=赤 / 停止=黄
  const progressBarClass =
    uiTrainingState === "completed"
      ? "bg-success"
      : uiTrainingState === "failed"
        ? "bg-danger"
        : uiTrainingState === "cancelled"
          ? "bg-amber-400"
          : "bg-accent";

  // 重要イベントの自動追従: 利用者が最下部付近を見ている場合のみ追従し、
  // 過去のイベントを読んでいる間は勝手にスクロールしない（ページ全体もスクロールしない）
  useEffect(() => {
    const el = eventsRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [importantEvents]);

  // 経過時間（実行中のみ5秒ごとに更新）
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 5000);
    setNowMs(Date.now());
    return () => clearInterval(timer);
  }, [isRunning, jobId]);
  const jobStartedAtMs = useMemo(() => {
    const raw = String(jobInfo?.created_at || "");
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [jobInfo?.created_at]);
  const elapsedSeconds = isRunning && jobStartedAtMs ? Math.max(0, Math.round((nowMs - jobStartedAtMs) / 1000)) : null;
  // 学習時間: 実行中=経過時間 / 終了済み=開始→最終更新の実時間 / それ以外=null（--表示）
  const displayDurationSeconds = useMemo(() => {
    if (isRunning) {
      return elapsedSeconds;
    }
    if (!jobStartedAtMs || !jobInfo?.updated_at) {
      return null;
    }
    if (!["completed", "failed", "stopped"].includes(String(jobInfo?.status || jobStatus))) {
      return null;
    }
    const ended = Date.parse(String(jobInfo.updated_at));
    if (!Number.isFinite(ended) || ended < jobStartedAtMs) {
      return null;
    }
    return Math.round((ended - jobStartedAtMs) / 1000);
  }, [isRunning, elapsedSeconds, jobStartedAtMs, jobInfo?.updated_at, jobInfo?.status, jobStatus]);

  let trainingVariant = "secondary";
  let trainingClassName = "";
  if (isRunning) {
    trainingVariant = "primary";
  } else if (isCompleted) {
    trainingVariant = "primary";
    trainingClassName = "!bg-success hover:!bg-emerald-500 text-white";
  } else if (isFailed) {
    trainingVariant = "danger";
  } else if (trainingStarted) {
    trainingVariant = "primary";
  }

  // 詳細ログのフィルタ: all=すべて / important=重要イベントのみ / problem=警告・エラー
  // （表示切替のみでログデータ自体は保持する）
  const [logFilter, setLogFilter] = useState("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const filteredLogs = useMemo(() => {
    if (logFilter === "important") {
      return logs.filter(isImportantLogLine);
    }
    if (logFilter === "problem") {
      return logs.filter((line) => {
        const level = classifyLogLine(line);
        return level === "error" || level === "warn";
      });
    }
    return logs;
  }, [logs, logFilter]);

  const [ocrChannel, ocrHeight, ocrWidth] = useMemo(() => {
    const [c = "", h = "", w = ""] = String(ocrImageShape || "").split(",");
    return [c || "1", h || "48", w || "320"];
  }, [ocrImageShape]);

  function updateOcrImageShape(next) {
    const merged = {
      c: ocrChannel,
      h: ocrHeight,
      w: ocrWidth,
      ...next,
    };
    setOcrImageShape(`${merged.c},${merged.h},${merged.w}`);
  }

  useEffect(() => {
    if (!autoScroll) return;
    const el = logContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredLogs, autoScroll]);

  useEffect(() => {
    if (!canToggleParams) {
      setParamsCollapsed(false);
    }
  }, [canToggleParams]);

  // 合計1.0の検証は許容誤差つき（0.7+0.2+0.1の浮動小数点誤差を吸収。lib/ratio.js参照）
  const ratioSummary = useMemo(
    () => summarizeRatios(trainRatio, valRatio, testRatio),
    [trainRatio, valRatio, testRatio]
  );

  const clsTrainingMode = clsInitSourceType === "scratch" ? "scratch" : "finetune";
  const clsNeedsInitModel = clsInitSourceType === "classification_model";
  const clsHasInitModel = !clsNeedsInitModel || String(clsInitSourceValue || "").trim() !== "";
  const clsFreezeEpochs = Number(freezeBackboneEpochs);
  const showFreezeWarning = clsTrainingMode === "finetune" && Number.isFinite(clsFreezeEpochs) && clsFreezeEpochs <= 0;
  const showScratchSmallDataWarning =
    clsTrainingMode === "scratch" &&
    Number.isFinite(Number(savedLabeledCount || 0)) &&
    Number(savedLabeledCount || 0) > 0 &&
    Number(savedLabeledCount || 0) < 80;
  const clsNextAction = !preprocessed ? "preprocess" : !datasetBuilt ? "dataset" : "train";

  const ocrHasInitModel = ocrInitSourceType === "scratch" || String(ocrInitSourceValue || "").trim() !== "";
  const ocrDatasetReady = String(ocrDatasetDir || "").trim() !== "";
  // 次回学習の設定のカテゴリサマリー表示用ラベル
  const engineDisplayLabel = ocrEngine === "paddleocr" ? "PaddleOCR" : ocrEngine === "tesseract" ? "Tesseract" : "EasyOCR";
  const engineSummaryLabel =
    ocrEngine === "tesseract"
      ? "eng.traineddata / PSM 7"
      : ocrEngine === "easyocr"
        ? "学習対象外（推論専用）"
        : `初期化: ${ocrInitSourceType === "scratch" ? "scratch" : "既存OCRモデル"} / Batch ${batchSize || "-"}`;
  const ocrNextAction = ocrDatasetReady ? "train" : "dataset";
  const osFamily = String(systemCheck?.os_family || "").trim().toLowerCase();
  const recommendedProfile = String(systemCheck?.recommended_profile || "").trim();
  const gpuAvailable = Boolean(systemCheck?.gpu_available);
  const paddlePathValid = Boolean(systemCheck?.paddleocr_path_valid);
  const trainWorkersNum = Number.parseInt(String(ocrTrainNumWorkers || 0), 10) || 0;
  const evalWorkersNum = Number.parseInt(String(ocrEvalNumWorkers || 0), 10) || 0;
  const batchNum = Number.parseInt(String(batchSize || 0), 10) || 0;
  const isMacSafe = osFamily === "macos" || recommendedProfile === "Mac Safe";
  const gpuName = String(systemCheck?.gpu_name || "").trim();
  const vramValue = Number(systemCheck?.vram_gb || 0);
  const vramLabel = Number.isFinite(vramValue) && vramValue > 0 ? `${vramValue.toFixed(1)}GB` : "";
  const selectedRuntimePresetKey = useMemo(() => {
    const presets = systemCheck?.presets;
    if (!presets || typeof presets !== "object") {
      return "";
    }
    const normalizedDevice = String(ocrTrainDevice || "").trim().toLowerCase();
    const normalizedBatch = Number.parseInt(String(batchSize || 0), 10) || 0;
    const normalizedTrainWorkers = Number.parseInt(String(ocrTrainNumWorkers || 0), 10) || 0;
    const normalizedEvalWorkers = Number.parseInt(String(ocrEvalNumWorkers || 0), 10) || 0;
    const normalizedSaveEpochStep = Number.parseInt(String(ocrSaveEpochStep || 0), 10) || 0;

    const matches = (key) => {
      const preset = presets?.[key];
      if (!preset || typeof preset !== "object") {
        return false;
      }
      return (
        normalizedDevice === String(preset.device || "").trim().toLowerCase() &&
        Boolean(ocrAutoBatchSize) === Boolean(preset.auto_batch_size) &&
        normalizedTrainWorkers === (Number.parseInt(String(preset.train_num_workers || 0), 10) || 0) &&
        normalizedEvalWorkers === (Number.parseInt(String(preset.eval_num_workers || 0), 10) || 0) &&
        normalizedBatch === (Number.parseInt(String(preset.batch_size || 0), 10) || 0) &&
        normalizedSaveEpochStep === (Number.parseInt(String(preset.save_epoch_step || 0), 10) || 0) &&
        Boolean(ocrUseAmp) === Boolean(preset.use_amp) &&
        Boolean(ocrPinMemory) === Boolean(preset.pin_memory) &&
        Boolean(ocrPersistentWorkers) === Boolean(preset.persistent_workers)
      );
    };

    if (matches("mac_safe")) return "mac_safe";
    if (matches("rtx_train")) return "rtx_train";
    return "";
  }, [
    systemCheck,
    ocrTrainDevice,
    batchSize,
    ocrTrainNumWorkers,
    ocrEvalNumWorkers,
    ocrSaveEpochStep,
    ocrAutoBatchSize,
    ocrUseAmp,
    ocrPinMemory,
    ocrPersistentWorkers,
  ]);
  const gpuCapableMode = ocrTrainDevice === "gpu" || (ocrTrainDevice === "auto" && gpuAvailable);
  const ampEnabled = Boolean(ocrUseAmp) && gpuCapableMode;
  const batchModeLabel = Boolean(ocrAutoBatchSize) && gpuCapableMode ? "自動" : "手動";
  const showMacWorkerWarning = isMacSafe && (trainWorkersNum > 1 || evalWorkersNum > 1);
  const showMemoryRiskWarning = isMacSafe && (batchNum > 8 || trainWorkersNum > 1 || evalWorkersNum > 1);

  const isTesseractEngine = ocrEngine === "tesseract";
  const trainingFamilyLabel = trainingFamily === "ocr" ? "OCR認識モデル" : "分類モデル";
  const statusToneClass = isRunning
    ? "border-accent/60 bg-accent/15 text-blue-100"
    : isCompleted
      ? "border-success/60 bg-success/15 text-emerald-100"
      : isFailed
        ? "border-danger/60 bg-danger/15 text-red-100"
        : isStopped
          ? "border-amber-300/40 bg-amber-300/10 text-amber-100"
        : "border-border bg-card/70 text-muted";

  return (
    // デスクトップ(xl=1280px以上)は親section(Flex)の残り高さを継承して内部スクロールのみ（ページ縦スクロールなし）。
    // 固定px差し引き(calc)は環境で狂うため使わない。1280px未満は縦積み+ページ縦スクロール。横スクロールは詳細ログ内のみ
    <div
      className={`grid items-start gap-4 overflow-x-hidden ${
        fitViewport
          ? "xl:min-h-0 xl:flex-1 xl:grid-rows-[minmax(0,1fr)] xl:items-stretch xl:overflow-hidden"
          : ""
      } ${
        paramsCollapsed
          ? "grid-cols-1"
          : "grid-cols-1 xl:grid-cols-[minmax(420px,35fr)_minmax(0,65fr)]"
      }`}
    >
      {!paramsCollapsed ? (
        <Card
          title="学習パラメータ"
          subtitle={
            trainingMode === "ocr"
              ? "OCR認識モデルの学習を実行します"
              : trainingMode === "classification"
                ? "実験機能（分割学習）の学習を実行します"
                : "分類モデルとOCRモデルを切り替えて学習できます"
          }
          className={`flex min-h-0 min-w-0 flex-col ${fitViewport ? "xl:overflow-hidden" : ""}`}
        >
          {/* 左ペイン: 実行概要/実行時設定/学習方式/実行操作=固定、次回学習の設定=残り高さで内部スクロール */}
          <div className="flex min-h-0 flex-1 flex-col space-y-2.5">
            {/* 実行概要（2列グリッド・日本語統一） */}
            <div className="shrink-0 rounded-xl border border-border/80 bg-card/55 p-3">
              <p className="text-[15px] font-semibold text-text">実行概要</p>
              <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-muted">方式</span>
                <span className="font-semibold text-text">{trainingFamilyLabel}</span>
                <span className="text-muted">状態</span>
                <span>
                  <span className={`rounded-full border px-2 py-0.5 text-sm font-semibold ${statusToneClass}`}>{statusLabel}</span>
                </span>
                <span className="text-muted">学習時間</span>
                <span className="font-semibold text-text">{formatDuration(displayDurationSeconds)}</span>
              </div>
            </div>

            {/* 実行時設定（ジョブ開始時のスナップショット・読み取り専用）。
                低い画面でも次回学習設定の高さを確保するため折り畳み可能（初期は閉・1行サマリー表示。情報は開けば全て見える） */}
            {jobInfo ? (
              <div className="shrink-0 rounded-xl border border-border/80 bg-card/55">
                <button
                  type="button"
                  onClick={() => setRuntimeSettingsOpen((prev) => !prev)}
                  className="flex w-full cursor-pointer select-none items-center gap-1.5 rounded-xl px-3 py-2 text-left text-[15px] font-semibold text-text transition hover:bg-card/70"
                >
                  <span
                    className={`text-xs text-muted transition-transform ${runtimeSettingsOpen ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                  実行時設定
                  <span className="ml-auto min-w-0 truncate text-[11px] font-normal text-muted">
                    {runtimeSettingsOpen
                      ? "このジョブ開始時の値（読み取り専用）"
                      : `${
                          String(jobInfo.engine || "") === "tesseract"
                            ? "Tesseract"
                            : String(jobInfo.engine || "") === "paddleocr"
                              ? "PaddleOCR"
                              : jobInfo.engine || "--"
                        }・${String(jobInfo.dataset_dir || "--").split(/[\\/]/).slice(-1)[0] || "--"}`}
                  </span>
                </button>
                <div className={runtimeSettingsOpen ? "grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 pb-3 text-sm" : "hidden"}>
                  <span className="text-muted">OCRタイプ</span>
                  <span className="font-semibold text-text">
                    {String(jobInfo.engine || "") === "tesseract" ? "Tesseract" : String(jobInfo.engine || "") === "paddleocr" ? "PaddleOCR" : jobInfo.engine || "--"}
                  </span>
                  <span className="text-muted">Base Model</span>
                  <span className="min-w-0 truncate text-text" title={String(jobInfo.init_source_value || "")}>
                    {jobInfo.init_source_value || "--"}
                  </span>
                  {String(jobInfo.engine || "") === "tesseract" ? (
                    <>
                      <span className="text-muted">PSM</span>
                      <span className="text-text">{jobInfo.max_text_length ?? "--"}</span>
                      <span className="text-muted">最大iteration</span>
                      <span className="text-text">{Number(jobInfo.epochs || 0).toLocaleString() || "--"}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-muted">最大文字数</span>
                      <span className="text-text">{jobInfo.max_text_length ?? "--"}</span>
                      <span className="text-muted">エポック数</span>
                      <span className="text-text">{Number(jobInfo.epochs || 0).toLocaleString() || "--"}</span>
                    </>
                  )}
                  <span className="text-muted">Charset</span>
                  <span className="min-w-0 break-all font-mono text-[12px] text-text">{jobInfo.charset || "--"}</span>
                  <span className="text-muted">データセット</span>
                  <span className="min-w-0 truncate font-mono text-[12px] text-text" title={String(jobInfo.dataset_dir || "")}>
                    {String(jobInfo.dataset_dir || "--").split(/[\\/]/).slice(-1)[0] || "--"}
                  </span>
                </div>
              </div>
            ) : null}

            {/* 学習方式の固定表示は実行概要の「方式」行と重複するため、切替が必要なallモードのみ表示
                （低い画面で次回学習設定の高さを確保するための統合。タスク仕様） */}
            {trainingMode === "all" ? (
              <div className="shrink-0 rounded-xl border border-border/80 bg-card/50 p-3">
                <label className="app-label">学習方式</label>
                <select value={trainingFamily} onChange={(e) => setTrainingFamily(e.target.value)} className="app-select">
                  <option value="classification">分類モデル（classification）</option>
                  <option value="ocr">OCR認識モデル（ocr）</option>
                </select>
              </div>
            ) : null}

            {trainingFamily === "classification" ? (
              <>
                <div className="space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">データ準備</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="app-label">学習比率</label>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={trainRatio}
                        onChange={(e) => setTrainRatio(e.target.value)}
                        className="app-input"
                      />
                    </div>
                    <div>
                      <label className="app-label">検証比率</label>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={valRatio}
                        onChange={(e) => setValRatio(e.target.value)}
                        className="app-input"
                      />
                    </div>
                    <div>
                      <label className="app-label">テスト比率</label>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={testRatio}
                        onChange={(e) => setTestRatio(e.target.value)}
                        className="app-input"
                      />
                    </div>
                  </div>
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      ratioSummary.valid
                        ? "border-success/45 bg-success/10 text-emerald-100"
                        : "border-amber-300/40 bg-amber-300/10 text-amber-100"
                    }`}
                  >
                    比率合計: {ratioSummary.total} {ratioSummary.valid ? "(OK)" : "(1.00 になるよう調整してください)"}
                  </div>
                  <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted">
                    <p>
                      状態: 前処理 {preprocessed ? "完了" : "未実行"} / データセット {datasetBuilt ? "完了" : "未作成"} / 保存済みラベル{" "}
                      {Number(savedLabeledCount || 0)}件
                    </p>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">初期重み</p>
                  <div>
                    <label className="app-label">初期化方式</label>
                    <select value={clsInitSourceType} onChange={(e) => setClsInitSourceType(e.target.value)} className="app-select">
                      <option value="scratch">scratch</option>
                      <option value="imagenet">imagenet（推奨）</option>
                      <option value="classification_model">既存モデル</option>
                    </select>
                  </div>
                  {clsInitSourceType === "classification_model" ? (
                    <div>
                      <label className="app-label">初期モデル</label>
                      <select
                        value={clsInitSourceValue}
                        onChange={(e) => setClsInitSourceValue(e.target.value)}
                        className="app-select"
                      >
                        <option value="">選択してください</option>
                        <option value="latest">latest（最新）</option>
                        {(classificationInitModelOptions || []).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-success/35 bg-success/10 px-3 py-2 text-xs text-emerald-100">
                    推奨: init=imagenet / freeze=1 / backbone_lr_scale=0.1
                  </div>
                  {showFreezeWarning ? (
                    <div className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                      freeze=0 は上級設定です。初期重みの破壊リスクが上がります。
                    </div>
                  ) : null}
                  {showScratchSmallDataWarning ? (
                    <div className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                      少量データでは scratch より imagenet / 既存モデルの Fine-tune を推奨します。
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">学習パラメータ</p>
                  <div>
                    <label className="app-label">モデル種別</label>
                    <select value={modelType} onChange={(e) => setModelType(e.target.value)} className="app-select">
                      {modelTypes.length === 0 ? (
                        <option value={modelType}>{modelType || "既定"}</option>
                      ) : (
                        modelTypes.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="app-label">エポック数</label>
                      <input type="number" value={epochs} onChange={(e) => setEpochs(e.target.value)} className="app-input" />
                    </div>
                    <div>
                      <label className="app-label">バッチサイズ</label>
                      <input type="number" value={batchSize} onChange={(e) => setBatchSize(e.target.value)} className="app-input" />
                    </div>
                    <div>
                      <label className="app-label">学習率</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={learningRate}
                        onChange={(e) => setLearningRate(e.target.value)}
                        className="app-input"
                      />
                    </div>
                  </div>
                  {clsTrainingMode === "finetune" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="app-label">凍結エポック</label>
                        <select
                          value={freezeBackboneEpochs}
                          onChange={(e) => setFreezeBackboneEpochs(e.target.value)}
                          className="app-select"
                        >
                          <option value="0">0（上級）</option>
                          <option value="1">1（推奨）</option>
                          <option value="3">3（安全）</option>
                        </select>
                      </div>
                      <div>
                        <label className="app-label">Backbone LR倍率</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          max="1"
                          value={backboneLrScale}
                          onChange={(e) => setBackboneLrScale(e.target.value)}
                          className="app-input"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">実行</p>
                  <Button
                    variant={clsNextAction === "train" ? trainingVariant : "secondary"}
                    className={`${clsNextAction === "train" ? trainingClassName : ""} w-full`}
                    onClick={clsNextAction === "preprocess" ? onPreprocess : clsNextAction === "dataset" ? onBuildDataset : onStartTraining}
                    disabled={isRunning || (clsNextAction === "train" ? !canTrain || !clsHasInitModel : false)}
                    title={isRunning ? "学習実行中は開始できません" : undefined}
                  >
                    {clsNextAction === "preprocess"
                      ? "次アクション: 前処理を実行"
                      : clsNextAction === "dataset"
                        ? "次アクション: データセット作成"
                        : "次アクション: 学習開始"}
                  </Button>
                  {!clsHasInitModel ? (
                    <p className="text-xs text-amber-100">既存モデルFine-tuneを選択中です。初期モデルを指定してください。</p>
                  ) : null}
                  <div className="space-y-2">
                    {isRunning ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="danger" className="w-full" onClick={onStopTraining}>
                          学習停止
                        </Button>
                        <Button variant="danger" className="w-full" onClick={onStopTrainingAndDelete}>
                          停止して削除
                        </Button>
                      </div>
                    ) : null}
                    {clsNextAction !== "preprocess" ? (
                      <Button variant="secondary" className="w-full" onClick={onPreprocess}>
                        前処理のみ実行
                      </Button>
                    ) : null}
                    {clsNextAction !== "dataset" ? (
                      <Button variant="secondary" className="w-full" onClick={onBuildDataset}>
                        データセット作成のみ実行
                      </Button>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* 次回学習に使う編集設定。実行時設定（スナップショット）と区別するため折り畳みに分離。
                    detailsはFlex子として本文へ高さが伝わらない（Chromiumの内部スロット構造）ため、
                    button+Flex本文のstate制御アコーディオンで実装する。
                    開時は左ペインの残り高さ(flex-1)を本文が受け取り、この本文だけ内部スクロールする（閉時は他領域が詰まる） */}
                <section
                  className={`min-w-0 rounded-xl border border-border/80 bg-card/45 ${
                    nextSettingsOpen
                      ? `flex min-h-0 flex-col ${fitViewport ? "xl:min-h-[120px] xl:flex-1 xl:overflow-hidden" : ""}`
                      : "shrink-0"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSettingsToggled(!nextSettingsOpen)}
                    className="flex w-full shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-xl px-3 py-2 text-left text-[15px] font-semibold text-text transition hover:bg-card/70"
                  >
                    <span
                      className={`text-xs text-muted transition-transform ${nextSettingsOpen ? "rotate-90" : ""}`}
                      aria-hidden="true"
                    >
                      ▶
                    </span>
                    次回学習の設定
                    <span className="ml-auto text-[11px] font-normal text-muted">
                      {settingsLocked ? "学習実行中は変更できません" : "データ分割・オーグメンテーション・学習パラメータ・エンジン設定"}
                    </span>
                  </button>
                  {/* 本文はカテゴリサマリーのみ（狭い左カラムで全設定を直接編集しない）。詳細編集はモーダルのタブで行う */}
                  <div
                    className={
                      nextSettingsOpen
                        ? "next-training-settings-body scroll-stable dark-scroll min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-2.5 pb-2.5"
                        : "hidden"
                    }
                  >
                    <p className="rounded-lg border border-accent/25 bg-accent/10 px-2.5 py-1.5 text-[11px] leading-5 text-blue-100">
                      ここで変更した設定は、次回の学習から適用されます。完了済みの学習結果には影響しません。
                    </p>
                    {[
                      {
                        id: "split",
                        label: "データ分割",
                        summary: `${trainRatio} / ${valRatio} / ${testRatio}`,
                        sub: `Split Seed: ${ocrSplitSeed ?? 42}`,
                      },
                      {
                        id: "augmentation",
                        label: "オーグメンテーション",
                        summary: augCategorySummaryLabel(ocrAugmentation),
                        sub: "",
                      },
                      {
                        id: "params",
                        label: "学習パラメータ",
                        summary: `${engineDisplayLabel} / ${isTesseractEngine ? "Iteration" : "Epoch"} ${epochs}`,
                        sub: `演算デバイス: ${isTesseractEngine ? "CPU" : ocrTrainDevice}`,
                      },
                      { id: "engine", label: "エンジン設定", summary: engineSummaryLabel, sub: "" },
                    ].map((row) => (
                      <div key={row.id} className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-semibold text-text">{row.label}</p>
                          <p className="truncate text-[11px] text-muted" title={row.summary}>
                            {row.summary}
                          </p>
                          {row.sub ? <p className="truncate text-[11px] text-muted">{row.sub}</p> : null}
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="shrink-0"
                          onClick={() => openSettingsTab(row.id)}
                          aria-haspopup="dialog"
                          title={`${row.label}の設定を開きます`}
                        >
                          編集
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>

                {/* 次回学習の設定モーダル（4カテゴリのタブ切替。設定値・保存処理は従来のstateをそのまま共有し、View ID・ルートは変更しない）。
                    祖先のbackdrop-filter等でposition:fixedの基準がずれないよう、document.bodyへポータル描画する */}
                {settingsTab && typeof document !== "undefined" ? (
                  createPortal(
                  <div
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-label="次回学習の設定"
                    onMouseDown={(e) => {
                      if (e.target === e.currentTarget) closeSettingsModal();
                    }}
                  >
                    <div className="flex max-h-[92vh] w-full min-w-0 max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-[#262c34] shadow-2xl">
                      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-text">次回学習の設定</p>
                          <p className="text-[11px] text-muted">
                            ここで変更した設定は、次回の学習から適用されます。完了済みの学習結果には影響しません。
                            {settingsLocked ? "（学習実行中のため変更できません）" : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={closeSettingsModal}
                          aria-label="閉じる"
                          title="閉じる（Esc）"
                          className="rounded-lg px-2 py-1 text-lg leading-none text-muted transition hover:bg-card/70 hover:text-text"
                        >
                          ×
                        </button>
                      </div>
                      <div role="tablist" aria-label="設定カテゴリ" className="flex flex-wrap gap-1 border-b border-border/70 px-4 pt-2">
                        {NEXT_SETTINGS_TABS.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            id={`settings-tab-${tab.id}`}
                            aria-selected={settingsTab === tab.id}
                            aria-controls={`settings-panel-${tab.id}`}
                            onClick={() => openSettingsTab(tab.id)}
                            className={`rounded-t-lg border-b-2 px-3 py-2 text-[13px] font-semibold transition ${
                              settingsTab === tab.id
                                ? "border-accent bg-card/50 text-text"
                                : "border-transparent text-muted hover:bg-card/40 hover:text-text"
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      <div className="dark-scroll min-h-0 flex-1 overflow-y-auto p-4">
                        <fieldset
                          disabled={settingsLocked}
                          className={settingsLocked ? "opacity-70" : ""}
                          title={settingsLocked ? "学習実行中は設定を変更できません。" : undefined}
                        >
                          {settingsTab === "split" ? (
                            <div role="tabpanel" id="settings-panel-split" aria-labelledby="settings-tab-split" className="space-y-3">
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <div>
                                  <label className="app-label">
                                    プロジェクト
                                    <InfoHint text="学習対象のプロジェクトです。プロジェクト画面で切り替えできます。" />
                                  </label>
                                  <input className="app-input" value={projectId || ""} readOnly placeholder="未選択" />
                                </div>
                                <div>
                                  <label className="app-label">
                                    学習データ
                                    <InfoHint text="学習に使用するデータセットのディレクトリです。データ作成後に自動設定されます。" />
                                  </label>
                                  <input className="app-input" value={ocrDatasetDir} readOnly placeholder="データ作成後に自動設定されます" />
                                </div>
                              </div>
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <div>
                                  <label className="app-label">学習データ作成方法</label>
                                  <select
                                    value={ocrDatasetCreateMode}
                                    onChange={(e) => setOcrDatasetCreateMode(e.target.value)}
                                    className="app-select"
                                  >
                                    <option value="new">新規作成（ラベルデータから）</option>
                                    <option value="from_logs">再学習作成（OCRログから）</option>
                                  </select>
                                </div>
                                {ocrDatasetCreateMode === "from_logs" ? (
                                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card/40 p-3 text-xs text-muted">
                                    <label className="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(ocrFromLogsOnlyInvalid)}
                                        onChange={(e) => setOcrFromLogsOnlyInvalid(e.target.checked)}
                                      />
                                      invalidのみ対象
                                    </label>
                                    <label className="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(ocrFromLogsIncludeCorrected)}
                                        onChange={(e) => setOcrFromLogsIncludeCorrected(e.target.checked)}
                                      />
                                      correctedを優先
                                    </label>
                                  </div>
                                ) : (
                                  <p className="self-end pb-2 text-xs text-muted">
                                    ラベル付け済みデータから学習データを新規作成します（作成は「実行操作」から実行）。
                                  </p>
                                )}
                              </div>
                              <div className="min-w-0 md:max-w-xl">
                                <label className="app-label">
                                  データ分割
                                  <InfoHint text="Train / Validation / Test の分割比率（合計1.00）。0.05単位で変更でき、TestはTrain・Validationから自動計算されます（Test = 1.0 − Train − Val）。枚数は最大剰余法で算出され合計が必ず有効画像数と一致します。Tesseractでは Train→train.list / Validation→eval.list / Test→評価用 として使われます。" />
                                </label>
                                {/* 0.05単位入力。Testは自動計算（方式A）で合計エラーを構造的に防ぐ */}
                                <div className="grid grid-cols-3 gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={trainRatio}
                                    onChange={(e) => {
                                      const next = normalizeRatioInput(e.target.value);
                                      setTrainRatio(next);
                                      setTestRatio(autoTestRatio(next, valRatio));
                                    }}
                                    className="app-input min-w-0 px-2"
                                    title="Train 比率"
                                  />
                                  <input
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={valRatio}
                                    onChange={(e) => {
                                      const next = normalizeRatioInput(e.target.value);
                                      setValRatio(next);
                                      setTestRatio(autoTestRatio(trainRatio, next));
                                    }}
                                    className="app-input min-w-0 px-2"
                                    title="Validation 比率"
                                  />
                                  <input
                                    type="number"
                                    value={testRatio}
                                    readOnly
                                    className="app-input min-w-0 px-2 opacity-80"
                                    title="Test 比率（自動計算: 1.0 − Train − Val）"
                                  />
                                </div>
                                <p className={`mt-1 text-[11px] ${ratioSummary.valid ? "text-muted" : "text-amber-100"}`}>
                                  Train/Val/Test 合計: {ratioSummary.total}
                                  {ratioSummary.valid ? "（Testは自動計算）" : "（1.00 になるよう調整してください）"}
                                </p>
                                {ratioError ? (
                                  <p role="alert" className="mt-1 text-[11px] text-red-300">
                                    {ratioError}
                                  </p>
                                ) : null}
                                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                                  <div>
                                    <label className="app-label">
                                      Split Seed
                                      <InfoHint text="データ分割（シャッフル）に使う乱数の種です。同じ画像集合・同じ比率・同じSeedなら分割結果が完全に再現されます。モデルメタへ保存され学習条件比較で確認できます。" />
                                    </label>
                                    <input
                                      type="number"
                                      className="app-input"
                                      value={ocrSplitSeed ?? 42}
                                      onChange={(e) => setOcrSplitSeed?.(e.target.value)}
                                    />
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-9 whitespace-nowrap px-2.5 text-[12px]"
                                    disabled={Boolean(ocrSplitPreviewLoading)}
                                    onClick={() => onPreviewSplit?.()}
                                    title="現在の条件（charset・比率）での入力/有効画像数と分割予定枚数を確認します"
                                  >
                                    {ocrSplitPreviewLoading ? "確認中..." : "分割枚数を確認"}
                                  </Button>
                                </div>
                                {ocrSplitPreview ? (
                                  <div
                                    aria-live="polite"
                                    className="mt-2 rounded-lg border border-border/70 bg-card/55 px-2.5 py-2 text-[12px] tabular-nums"
                                  >
                                    <p className="text-text">
                                      入力画像数 {ocrSplitPreview.input_count}枚 / 有効画像数 {ocrSplitPreview.valid_count}枚
                                      {ocrSplitPreview.input_count - ocrSplitPreview.valid_count > 0
                                        ? ` / 除外 ${ocrSplitPreview.input_count - ocrSplitPreview.valid_count}枚`
                                        : ""}
                                    </p>
                                    {ocrSplitPreview.input_count - ocrSplitPreview.valid_count > 0 ? (
                                      <p className="text-muted">
                                        除外内訳: 対象外タイプ {ocrSplitPreview.skipped?.type ?? 0} / ラベル不正（charset外・空）{" "}
                                        {ocrSplitPreview.skipped?.invalid_label ?? 0} / 元画像なし{" "}
                                        {ocrSplitPreview.skipped?.missing_source ?? 0}
                                      </p>
                                    ) : null}
                                    <p className="mt-0.5 text-text">
                                      予定: Train {ocrSplitPreview.counts?.train}枚（
                                      {((ocrSplitPreview.counts?.train / Math.max(1, ocrSplitPreview.valid_count)) * 100).toFixed(2)}
                                      %）/ Val {ocrSplitPreview.counts?.val}枚 / Test {ocrSplitPreview.counts?.test}枚 = 合計{" "}
                                      {(ocrSplitPreview.counts?.train ?? 0) +
                                        (ocrSplitPreview.counts?.val ?? 0) +
                                        (ocrSplitPreview.counts?.test ?? 0)}
                                      枚
                                    </p>
                                    <p className="text-muted">
                                      分割方式: 画像単位（設定比率と実枚数比率は端数処理でわずかに異なる場合があります）
                                    </p>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {settingsTab === "augmentation" ? (
                            <div role="tabpanel" id="settings-panel-augmentation" aria-labelledby="settings-tab-augmentation">
                              <AugmentationSettingsPanel
                                augmentation={ocrAugmentation}
                                onChange={setOcrAugmentation}
                                disabled={settingsLocked}
                                preview={ocrAugPreview}
                                previewLoading={ocrAugPreviewLoading}
                                onRegeneratePreview={(count) => onPreviewAugmentation?.(count)}
                                trainCount={ocrSplitPreview?.counts?.train ?? null}
                              />
                            </div>
                          ) : null}

                          {settingsTab === "params" ? (
                            <div role="tabpanel" id="settings-panel-params" aria-labelledby="settings-tab-params" className="space-y-3">
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <div>
                                  <label className="app-label">OCRタイプ</label>
                                  <select value={ocrEngine} onChange={(e) => setOcrEngine(e.target.value)} className="app-select">
                                    <option value="paddleocr">PaddleOCR（学習可）</option>
                                    <option value="tesseract">Tesseract（学習可 / A-Z・0-9・筆記体klt）</option>
                                    <option value="easyocr">EasyOCR（推論専用）</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="app-label">
                                    {isTesseractEngine ? "最大イテレーション" : "学習回数"}
                                    <InfoHint text="学習の繰り返し回数です。PaddleOCR / EasyOCR では Epoch 数、Tesseract では Iteration 数として使用します。Tesseractでは一般的に500〜3000程度で学習します。" />
                                  </label>
                                  <input
                                    type="number"
                                    className="app-input"
                                    value={epochs}
                                    onChange={(e) => setEpochs(e.target.value)}
                                    disabled={ocrEngine === "easyocr"}
                                  />
                                  <p className="mt-1 text-[11px] text-muted">
                                    {isTesseractEngine
                                      ? "TesseractではEpochではなくIterationとして処理されます。1500はFine-tuning向けの初期値です。"
                                      : "Epochとして処理されます"}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <label className="app-label">
                                  演算デバイス
                                  <InfoHint text="学習に使用する演算デバイスです。auto はGPUが利用可能な場合にGPUを使用します。TesseractはCPUのみ対応しています。" />
                                </label>
                                <div className="grid h-8 max-w-md grid-cols-3 gap-1.5">
                                  {[
                                    {
                                      value: "auto",
                                      label: "Auto",
                                      // 選択可能なボタンは色付きで発光させる（Auto=青）。未選択でも背景をカードより明るくし操作可能と分かるようにする
                                      glow: "border-accent/80 bg-slate-700/70 text-blue-200 shadow-[0_0_10px_rgba(88,166,255,0.55)] hover:bg-accent/20",
                                      selectedClass: "border-accent bg-accent text-white shadow-[0_0_14px_rgba(88,166,255,0.75)]",
                                      selectable: !isTesseractEngine && ocrEngine !== "easyocr",
                                      hint: "GPUが利用可能ならGPUを使用します",
                                    },
                                    {
                                      value: "cpu",
                                      label: "CPU",
                                      glow: "border-cyan-400/80 bg-slate-700/70 text-cyan-100 shadow-[0_0_10px_rgba(34,211,238,0.55)] hover:bg-cyan-400/15",
                                      selectedClass: "border-cyan-300 bg-cyan-500/80 text-white shadow-[0_0_14px_rgba(34,211,238,0.75)]",
                                      selectable: ocrEngine !== "easyocr",
                                      hint: "CPUで学習します",
                                    },
                                    {
                                      value: "gpu",
                                      label: "GPU",
                                      glow: "border-emerald-400/80 bg-slate-700/70 text-emerald-100 shadow-[0_0_10px_rgba(52,211,153,0.6)] hover:bg-emerald-400/15",
                                      selectedClass: "border-emerald-300 bg-emerald-500/80 text-white shadow-[0_0_14px_rgba(52,211,153,0.8)]",
                                      // GPUハードが検出されていれば選択可能として点灯する
                                      // （torch/paddleのCUDA対応状況は実行時に解決されるためUIではブロックしない）
                                      selectable:
                                        !isTesseractEngine &&
                                        ocrEngine !== "easyocr" &&
                                        Boolean(systemCheck?.gpu_available || systemCheck?.gpu_name),
                                      hint: systemCheck?.gpu_name
                                        ? `GPUで学習します（${systemCheck.gpu_name}）`
                                        : systemCheck?.gpu_available
                                          ? "GPUで学習します"
                                          : "GPUが検出されていません",
                                    },
                                  ].map((opt) => {
                                    // Tesseract は CPU 固定（CPUのみ点灯・選択表示、クリック不可）
                                    const fixedCpu = isTesseractEngine && opt.value === "cpu";
                                    const selected = isTesseractEngine ? opt.value === "cpu" : ocrTrainDevice === opt.value;
                                    const clickable = opt.selectable && !isTesseractEngine;
                                    const lit = opt.selectable || fixedCpu;
                                    return (
                                      <button
                                        key={opt.value}
                                        type="button"
                                        title={isTesseractEngine && opt.value !== "cpu" ? "TesseractはCPUのみ対応しています" : opt.hint}
                                        disabled={!clickable}
                                        onClick={() => clickable && setOcrTrainDevice(opt.value)}
                                        className={`rounded-lg border text-xs font-semibold transition ${
                                          selected
                                            ? opt.selectedClass
                                            : lit
                                              ? opt.glow
                                              : // 無効: 暗い背景+低コントラスト+発光なし（未選択の発光ボタンと明確に区別）
                                                "cursor-not-allowed border-slate-600 bg-slate-800/80 text-slate-500"
                                        } ${!clickable && lit ? "cursor-default" : ""}`}
                                      >
                                        {opt.label}
                                      </button>
                                    );
                                  })}
                                </div>
                                {isTesseractEngine ? (
                                  <p className="mt-1 text-[11px] text-muted">TesseractはCPUのみ対応しています。</p>
                                ) : null}
                              </div>
                              <div className="md:max-w-md">
                                <label className="app-label">
                                  出力先
                                  <InfoHint text="学習済みモデルの保存先です（変更不可）。" />
                                </label>
                                <input className="app-input" value={`data/projects/${projectId || "<project>"}/models/`} readOnly />
                              </div>
                            </div>
                          ) : null}

                          {settingsTab === "engine" ? (
                            <div role="tabpanel" id="settings-panel-engine" aria-labelledby="settings-tab-engine" className="space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">
                                エンジン固有設定（{ocrEngine === "paddleocr" ? "PaddleOCR" : isTesseractEngine ? "Tesseract" : "EasyOCR"}）
                              </p>
                              {ocrEngine === "easyocr" ? (
                                <div className="rounded-lg border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-100">
                                  EasyOCR はこのUIでは学習対象外です。推論画面でのみ利用できます。
                                </div>
                              ) : isTesseractEngine ? (
                                <>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="app-label">
                                        Base Model
                                        <InfoHint text="fine-tune のベースとなる公式学習済みモデルです（固定）。" />
                                      </label>
                                      <input className="app-input" value="eng.traineddata" readOnly />
                                    </div>
                                    <div>
                                      <label className="app-label">
                                        PSM
                                        <InfoHint text="Tesseractのページセグメンテーションモードです。1行テキスト向けの 7 に固定されています。" />
                                      </label>
                                      <input className="app-input" value="7" readOnly />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="app-label">
                                      学習対象文字セット（Charset）
                                      <InfoHint text="学習対象の文字セットです。charset外の文字を含むラベルは学習から除外されます（文字削除はしません）。" />
                                    </label>
                                    <input
                                      className="app-input"
                                      value={ocrCharset}
                                      onChange={(e) =>
                                        // Tesseractは大文字と小文字筆記体(k/l/t)を区別するため大小変換しない
                                        setOcrCharset(e.target.value)
                                      }
                                      placeholder={TESSERACT_CHARSET_DEFAULT}
                                    />
                                    <p className="mt-1 text-xs text-muted">
                                      既定: A-Z / 0-9 / 小文字筆記体 k,l,t。charset外の文字を含むラベルは学習から除外されます（文字削除はしません）。
                                    </p>
                                  </div>
                                  <div>
                                    <label className="app-label">
                                      Whitelist
                                      <InfoHint text="推論時に許可する文字の一覧（既定値）です。学習内容には影響しません。" />
                                    </label>
                                    <input className="app-input" value={TESSERACT_CHARSET_DEFAULT} readOnly />
                                    <p className="mt-1 text-xs text-muted">推論時whitelist（既定）</p>
                                  </div>
                                  {/* 実験情報（モデルメタへ保存し、モデル比較の学習条件比較で表示。未入力=未記録） */}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="app-label">
                                        実験名
                                        <InfoHint text="この学習の目的が分かる名前です（例: Iteration 15000）。モデルメタへ保存され、モデル比較の学習条件比較で表示されます。" />
                                      </label>
                                      <input
                                        className="app-input"
                                        value={experimentName ?? ""}
                                        onChange={(e) => setExperimentName?.(e.target.value)}
                                        placeholder="例: Iteration検証"
                                      />
                                    </div>
                                    <div>
                                      <label className="app-label">
                                        親モデル（管理No）
                                        <InfoHint text="このモデルの学習開始時に参照した直前のモデルの管理Noです。派生関係の追跡用で、学習内容には影響しません（ベース直学習は空欄）。" />
                                      </label>
                                      <input
                                        className="app-input"
                                        value={parentModelId ?? ""}
                                        onChange={(e) => setParentModelId?.(e.target.value)}
                                        placeholder="例: M0003（任意）"
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="app-label">
                                      学習メモ
                                      <InfoHint text="前回から変更した内容などの自由記述です。モデルメタへ保存され、学習条件比較で表示されます。" />
                                    </label>
                                    <textarea
                                      className="app-input min-h-[64px] py-1.5"
                                      value={trainingNote ?? ""}
                                      onChange={(e) => setTrainingNote?.(e.target.value)}
                                      placeholder="例: Iterationのみ変更（他条件は前回と同一）"
                                    />
                                  </div>
                                  <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-blue-100">
                                    公式 <span className="font-semibold">eng.traineddata</span> をベースに LSTM を fine-tune します。
                                    学習対象文字: A-Z / 0-9 / 小文字筆記体 k,l,t
                                  </div>
                                  <p className="text-xs text-muted">
                                    学習には外部ツール（tesseract / lstmtraining / combine_tessdata）と eng.traineddata が必要です。
                                    未導入の場合は学習開始時に導入手順つきでエラーになります。
                                  </p>
                                </>
                              ) : (
                                <>
                                  <div className="space-y-2 rounded-lg border border-border/70 bg-card/50 p-3">
                                    <p className="text-xs font-semibold text-slate-100">初期重み</p>
                                    <div>
                                      <label className="app-label">初期化方式</label>
                                      <select
                                        value={ocrInitSourceType}
                                        onChange={(e) => setOcrInitSourceType(e.target.value)}
                                        className="app-select"
                                      >
                                        <option value="scratch">scratch</option>
                                        <option value="ocr_model">既存OCRモデル（Fine-tune）</option>
                                      </select>
                                    </div>
                                    {ocrInitSourceType === "ocr_model" ? (
                                      <div>
                                        <div className="flex items-center justify-between gap-3">
                                          <label className="app-label">初期モデル</label>
                                          <button
                                            type="button"
                                            className="text-xs font-medium text-accent underline underline-offset-2 transition hover:opacity-80"
                                            onClick={() => setShowOcrOfficialModelHelp((current) => !current)}
                                            aria-expanded={showOcrOfficialModelHelp}
                                          >
                                            {showOcrOfficialModelHelp ? "説明を隠す" : "公式モデルの説明を表示"}
                                          </button>
                                        </div>
                                        <select
                                          value={ocrInitSourceValue}
                                          onChange={(e) => setOcrInitSourceValue(e.target.value)}
                                          className="app-select"
                                        >
                                          <option value="">選択してください</option>
                                          {Array.isArray(ocrInitModelOptions) && ocrInitModelOptions.length > 0 ? (
                                            <>
                                              <option value="latest">latest（作成済み最新）</option>
                                              {ocrInitModelOptions.map((name) => (
                                                <option key={name} value={name}>
                                                  {name}（作成済み）
                                                </option>
                                              ))}
                                            </>
                                          ) : null}
                                          {(ocrOfficialInitModelOptions || []).map((name) => (
                                            <option key={`official-${name}`} value={name}>
                                              {name}（公式）
                                            </option>
                                          ))}
                                        </select>
                                        {showOcrOfficialModelHelp ? (
                                          <div className="mt-2 whitespace-pre-line rounded-lg border border-border/80 bg-card/55 px-3 py-2 text-xs leading-6 text-muted">
                                            {PADDLEOCR_OFFICIAL_MODELS_TOOLTIP}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="space-y-2 rounded-lg border border-border/70 bg-card/50 p-3">
                                    <p className="text-xs font-semibold text-slate-100">学習パラメータ</p>
                                    <div className="space-y-2 rounded-lg border border-border/80 bg-card/55 p-3">
                                      <p className="text-xs font-semibold text-slate-100">実行プロファイル</p>
                                      <div className="grid grid-cols-2 gap-2">
                                        <Button
                                          variant={selectedRuntimePresetKey === "mac_safe" ? "primary" : "secondary"}
                                          className="w-full"
                                          onClick={() => onApplyOcrTrainingPreset("mac_safe")}
                                        >
                                          Mac Safe
                                        </Button>
                                        <Button
                                          variant={selectedRuntimePresetKey === "rtx_train" ? "primary" : "secondary"}
                                          className="w-full"
                                          onClick={() => onApplyOcrTrainingPreset("rtx_train")}
                                        >
                                          RTX Train
                                        </Button>
                                      </div>
                                      {recommendedProfile ? (
                                        <p className="text-xs text-muted">
                                          推奨: <span className="font-semibold text-text">{recommendedProfile}</span>
                                          {" / "}GPU利用可否: {gpuAvailable ? "利用可能" : "利用不可"}
                                        </p>
                                      ) : null}
                                      {!paddlePathValid ? (
                                        <p className="text-xs text-red-200">
                                          PaddleOCR パスを確認してください（`PADDLEOCR_PATH` または settings.yaml）。
                                        </p>
                                      ) : null}
                                    </div>
                                    {/* ラベルは日本語＋折り返し禁止（whitespace-nowrap）で3項目の高さを揃える。
                                        内部キー（save_epoch_step / train・eval num_workers）は変更せずInfoHintで示す */}
                                    <div className="grid grid-cols-3 gap-2">
                                      <div className="min-w-0">
                                        <label className="app-label whitespace-nowrap">
                                          エポック数
                                          <InfoHint text="チェックポイントを保存するエポック間隔です（内部キー: save_epoch_step）。学習回数そのものはプロジェクト設定の「学習回数」で指定します。" />
                                        </label>
                                        <input
                                          type="number"
                                          min="1"
                                          className="app-input"
                                          value={ocrSaveEpochStep}
                                          onChange={(e) => setOcrSaveEpochStep(e.target.value)}
                                        />
                                      </div>
                                      <div className="min-w-0">
                                        <label className="app-label whitespace-nowrap">
                                          学習ワーカー数
                                          <InfoHint text="学習データ読み込みの並列プロセス数です（内部キー: train num_workers）。Mac環境では0〜1推奨です。" />
                                        </label>
                                        <input
                                          type="number"
                                          min="0"
                                          className="app-input"
                                          value={ocrTrainNumWorkers}
                                          onChange={(e) => setOcrTrainNumWorkers(e.target.value)}
                                        />
                                      </div>
                                      <div className="min-w-0">
                                        <label className="app-label whitespace-nowrap">
                                          評価ワーカー数
                                          <InfoHint text="評価データ読み込みの並列プロセス数です（内部キー: eval num_workers）。Mac環境では0〜1推奨です。" />
                                        </label>
                                        <input
                                          type="number"
                                          min="0"
                                          className="app-input"
                                          value={ocrEvalNumWorkers}
                                          onChange={(e) => setOcrEvalNumWorkers(e.target.value)}
                                        />
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <label className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/55 px-3 py-2 text-sm text-text">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(ocrAutoBatchSize)}
                                          onChange={(e) => setOcrAutoBatchSize(e.target.checked)}
                                          disabled={ocrTrainDevice === "cpu"}
                                        />
                                        Batch自動最適化（VRAM基準）
                                      </label>
                                      <label className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/55 px-3 py-2 text-sm text-text">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(ocrUseAmp)}
                                          onChange={(e) => setOcrUseAmp(e.target.checked)}
                                          disabled={ocrTrainDevice === "cpu"}
                                        />
                                        AMP（混合精度）
                                      </label>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <label className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/55 px-3 py-2 text-sm text-text">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(ocrPinMemory)}
                                          onChange={(e) => setOcrPinMemory(e.target.checked)}
                                          disabled={ocrTrainDevice === "cpu"}
                                        />
                                        pin_memory
                                      </label>
                                      <label className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/55 px-3 py-2 text-sm text-text">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(ocrPersistentWorkers)}
                                          onChange={(e) => setOcrPersistentWorkers(e.target.checked)}
                                          disabled={ocrTrainDevice === "cpu" || trainWorkersNum <= 0}
                                        />
                                        persistent_workers
                                      </label>
                                    </div>
                                    <div className="rounded-lg border border-border/80 bg-card/55 px-3 py-3 text-sm leading-6 text-slate-100">
                                      <p>
                                        GPU: {gpuAvailable ? (gpuName || "CUDA GPU") : "利用不可"}
                                        {gpuAvailable && vramLabel ? ` (${vramLabel})` : ""}
                                      </p>
                                      <p>Batch: {batchNum > 0 ? `${batchNum}（${batchModeLabel}）` : "-"}</p>
                                      <p>
                                        Workers: train {trainWorkersNum} / eval {evalWorkersNum}
                                      </p>
                                      <p>AMP: {ampEnabled ? "ON" : "OFF"}</p>
                                    </div>
                                    {showMacWorkerWarning ? (
                                      <p className="text-xs text-amber-100">
                                        Mac環境では num_workers を 0〜1 推奨です。高すぎるとメモリ不足の原因になります。
                                      </p>
                                    ) : null}
                                    {showMemoryRiskWarning ? (
                                      <p className="text-xs text-amber-100">
                                        現在設定はメモリ不足の可能性があります。Mac Safe プリセットへの切替を推奨します。
                                      </p>
                                    ) : null}
                                    <div>
                                      <label className="app-label">
                                        文字セット（charset）
                                        <InfoHint text="学習対象の文字セットです。PaddleOCRでは大文字に正規化されます。" />
                                      </label>
                                      <input
                                        className="app-input"
                                        value={ocrCharset}
                                        onChange={(e) => setOcrCharset(e.target.value.toUpperCase())}
                                        placeholder={OCR_CHARSET_DEFAULT}
                                      />
                                    </div>
                                    <div>
                                      <label className="app-label">画像形状</label>
                                      <div className="grid grid-cols-3 gap-2">
                                        <div>
                                          <label className="app-label">Channel</label>
                                          <select
                                            className="app-select"
                                            value={ocrChannel}
                                            onChange={(e) => updateOcrImageShape({ c: e.target.value })}
                                          >
                                            <option value="1">1 (Gray)</option>
                                            <option value="3">3 (RGB)</option>
                                          </select>
                                        </div>
                                        <div>
                                          <label className="app-label">Height [px]</label>
                                          <input
                                            type="number"
                                            className="app-input"
                                            value={ocrHeight}
                                            onChange={(e) => updateOcrImageShape({ h: e.target.value })}
                                            placeholder="48"
                                          />
                                        </div>
                                        <div>
                                          <label className="app-label">Width [px]</label>
                                          <input
                                            type="number"
                                            className="app-input"
                                            value={ocrWidth}
                                            onChange={(e) => updateOcrImageShape({ w: e.target.value })}
                                            placeholder="320"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="app-label">
                                          バッチサイズ
                                          <InfoHint text="1ステップで処理する画像枚数です。Batch自動最適化がONの場合はVRAM基準で調整されます。" />
                                        </label>
                                        <input
                                          type="number"
                                          className="app-input"
                                          value={batchSize}
                                          onChange={(e) => setBatchSize(e.target.value)}
                                        />
                                      </div>
                                      <div>
                                        <label className="app-label">
                                          最大文字数
                                          <InfoHint text="1ラベルあたりの最大文字数（max_text_length）です。" />
                                        </label>
                                        <input
                                          type="number"
                                          className="app-input"
                                          value={ocrMaxTextLength}
                                          onChange={(e) => setOcrMaxTextLength(e.target.value)}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : null}
                        </fieldset>
                      </div>
                    </div>
                  </div>,
                  document.body
                  )
                ) : null}

                {ocrEngine !== "easyocr" ? (
                  <>
                    {/* 実行操作は左ペイン末尾の固定領域（設定をスクロールしても常に見える。position:fixedは不使用） */}
                    <div className="shrink-0 space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
                      <p className="text-[15px] font-semibold text-text">実行操作</p>

                      {/* 主ボタン: UI状態（idle/preparing/training/stopping/completed/failed/cancelled）に連動 */}
                      {!ocrDatasetReady ? (
                        <Button
                          variant="secondary"
                          className="w-full"
                          onClick={onCreateSelectedOcrDataset}
                          disabled={settingsLocked}
                        >
                          {ocrDatasetCreateMode === "from_logs" ? "再学習データを作成" : "新規学習データを作成"}
                        </Button>
                      ) : uiTrainingState === "preparing" ? (
                        <Button className="w-full" disabled>
                          <span className="mr-1 inline-block animate-spin" aria-hidden="true">↻</span>
                          学習準備中...
                        </Button>
                      ) : uiTrainingState === "training" ? (
                        <Button className="w-full" disabled>
                          <span className="mr-1 inline-block animate-spin" aria-hidden="true">↻</span>
                          OCR学習中
                        </Button>
                      ) : uiTrainingState === "stopping" ? (
                        <Button className="w-full" disabled>
                          停止処理中...
                        </Button>
                      ) : uiTrainingState === "completed" ? (
                        <div className="space-y-2">
                          <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 p-2 text-xs text-emerald-200">
                            学習が完了しました
                            {jobInfo?.model_path ? (
                              <p className="mt-0.5 truncate text-emerald-100/80" title={String(jobInfo.model_path)}>
                                保存先: {String(jobInfo.model_path)}
                              </p>
                            ) : null}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button className="w-full" onClick={() => onOpenModels?.()}>
                              学習結果を確認
                            </Button>
                            <Button variant="secondary" className="w-full" onClick={() => onOpenInference?.()}>
                              推論で試す
                            </Button>
                          </div>
                          <Button
                            variant="secondary"
                            className="w-full"
                            disabled={!canStartOcrTraining || !ocrHasInitModel}
                            onClick={() => {
                              if (window.confirm("同じ設定でOCR学習を再実行します。よろしいですか？")) {
                                onStartOcrTraining();
                              }
                            }}
                          >
                            同じ設定で再学習
                          </Button>
                        </div>
                      ) : uiTrainingState === "failed" ? (
                        <div className="space-y-2">
                          <div className="rounded-lg border border-red-400/40 bg-red-400/10 p-2 text-xs text-red-200">
                            学習に失敗しました
                            {jobInfo?.message ? <p className="mt-0.5 break-all text-red-100/80">原因: {String(jobInfo.message)}</p> : null}
                          </div>
                          <Button
                            className="w-full"
                            disabled={!canStartOcrTraining || !ocrHasInitModel}
                            onClick={onStartOcrTraining}
                          >
                            再実行
                          </Button>
                        </div>
                      ) : uiTrainingState === "cancelled" ? (
                        <Button
                          className="w-full"
                          disabled={!canStartOcrTraining || !ocrHasInitModel}
                          onClick={onStartOcrTraining}
                        >
                          学習を再実行
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          disabled={!canStartOcrTraining || !ocrHasInitModel}
                          onClick={onStartOcrTraining}
                        >
                          OCR学習を開始
                        </Button>
                      )}
                      {!ocrHasInitModel ? (
                        <p className="text-xs text-amber-100">OCR Fine-tuneを選択中です。初期モデルを指定してください。</p>
                      ) : null}

                      {/* 開始日時のみ表示（状態・進捗の詳細は右の「学習状況」カードに集約し重複表示しない） */}
                      {uiTrainingState !== "idle" && jobInfo?.created_at ? (
                        <p className="text-xs text-muted">
                          開始日時: {String(jobInfo.created_at).replace("T", " ").slice(0, 19)}
                        </p>
                      ) : null}

                      {isRunning || uiTrainingState === "stopping" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="danger"
                            className="w-full"
                            onClick={onStopTraining}
                            disabled={uiTrainingState === "stopping"}
                            title="ジョブを停止します。生成済みのログ・checkpoint・学習データは保持します。"
                          >
                            学習停止
                          </Button>
                          <Button
                            variant="danger"
                            className="w-full"
                            onClick={onStopTrainingAndDelete}
                            disabled={uiTrainingState === "stopping"}
                            title="ジョブを停止し、この実行で生成したチェックポイント・モデル・学習ログを削除します（他のジョブのモデルには影響しません）。"
                          >
                            停止して削除
                          </Button>
                        </div>
                      ) : null}
                      {ocrDatasetReady ? (
                        <Button
                          variant="secondary"
                          className="w-full"
                          onClick={onCreateSelectedOcrDataset}
                          disabled={settingsLocked}
                          title={settingsLocked ? "学習実行中はデータを再作成できません。" : "学習データを作り直します"}
                        >
                          データを再作成
                        </Button>
                      ) : null}
                    </div>

                    {ocrDatasetInfo ? (
                      // 1行表示で左ペインの固定領域を節約（フルパスはTooltipで確認できる）
                      <div className="shrink-0 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-blue-100">
                        <p className="truncate" title={String(ocrDatasetInfo.dataset_root || "-")}>
                          作成済みデータ: {String(ocrDatasetInfo.dataset_root || "-").split(/[\\/]/).slice(-1)[0] || "-"}
                          {ocrDatasetInfo.counts
                            ? `（train/val/test: ${ocrDatasetInfo.counts?.train ?? 0}/${ocrDatasetInfo.counts?.val ?? 0}/${ocrDatasetInfo.counts?.test ?? 0}）`
                            : `（件数: ${ocrDatasetInfo.count ?? 0}）`}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </div>
        </Card>
      ) : null}

      <Card
        title="学習状況"
        subtitle="要約・重要イベント・詳細ログ"
        className={`flex min-h-0 min-w-0 flex-col ${fitViewport ? "xl:overflow-hidden" : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {isRunning || uiTrainingState === "stopping" ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={onStopTraining}
                  disabled={uiTrainingState === "stopping"}
                  title="ジョブを停止します。生成済みのログ・checkpoint・学習データは保持します。"
                >
                  学習停止
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={onStopTrainingAndDelete}
                  disabled={uiTrainingState === "stopping"}
                  title="ジョブを停止し、この実行で生成したチェックポイント・モデル・学習ログを削除します（他のジョブのモデルには影響しません）。"
                >
                  停止して削除
                </Button>
              </>
            ) : null}
            {canToggleParams ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setParamsCollapsed((prev) => !prev)}
              >
                {paramsCollapsed ? "学習パラメータを表示" : "学習パラメータを折りたたむ"}
              </Button>
            ) : null}
          </div>
        }
      >
        {/* 学習状況サマリー（コンパクト構成・固定領域。数値は等幅数字で揺れ防止。取得できない項目は -- 表示） */}
        <div className="mb-3 shrink-0 rounded-xl border border-border/80 bg-card/55 p-3 tabular-nums">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] font-semibold text-text">
              進捗
              <span className="ml-3 font-mono text-sm text-text">
                {trainingProgress.iteration !== null
                  ? `${trainingProgress.iteration.toLocaleString()} / ${maxIterations ? maxIterations.toLocaleString() : "--"}`
                  : uiTrainingState === "preparing"
                    ? "学習準備中"
                    : "--"}
              </span>
            </p>
            <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${statusToneClass}`}>{statusLabel}</span>
          </div>
          {progressPercent !== null ? (
            <div className="mt-2">
              <div className="h-2 rounded-full bg-[#3f4854]/65">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${progressBarClass}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="mt-0.5 text-right text-xs text-muted">{progressPercent.toFixed(1)}%</p>
            </div>
          ) : null}
          <div className="mt-2 grid min-w-0 grid-cols-2 gap-x-6 gap-y-1.5 text-sm xl:grid-cols-4">
            <div className="min-w-0">
              <p className="text-xs text-muted">最新BCER</p>
              <p className="font-semibold text-text">{trainingProgress.bcer !== null ? `${trainingProgress.bcer}%` : "--"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted">経過時間</p>
              <p className="font-semibold text-text">{formatDuration(displayDurationSeconds)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted">推定残り時間</p>
              <p className="font-semibold text-text">{isRunning ? formatDuration(etaSeconds) : "--"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted">Job ID</p>
              <p className="truncate font-mono text-xs text-text" title={jobId || ""}>{jobId || "--"}</p>
            </div>
            <div className="col-span-2 min-w-0 xl:col-span-4">
              <p className="text-xs text-muted">最終checkpoint</p>
              <p className="truncate font-mono text-xs text-text" title={trainingProgress.checkpoint || ""}>
                {trainingProgress.checkpoint || "--"}
              </p>
            </div>
          </div>
        </div>

        {/* 重要イベント（縦型タイムライン・右ペインの残り高さへ伸縮。生ログ全文は詳細ログへ） */}
        <div className="mb-3 flex min-h-0 min-w-0 flex-col rounded-xl border border-border/80 bg-card/55 p-3 xl:flex-1">
          <p className="mb-2 shrink-0 text-[15px] font-semibold text-text">重要イベント</p>
          <div
            ref={eventsRef}
            className="scroll-stable dark-scroll max-h-[50vh] min-h-[180px] min-w-0 flex-1 overflow-y-auto overflow-x-hidden xl:max-h-none"
          >
            {importantEvents.length === 0 ? (
              <p className="text-sm text-muted">イベントはまだありません。</p>
            ) : (
              importantEvents.slice(-30).map((event, idx) => (
                <div key={`${event.time}-${idx}`} className="flex gap-3 border-b border-border/40 py-1.5 last:border-b-0">
                  <span className="w-16 shrink-0 pt-0.5 font-mono text-xs text-muted/80">{event.time || "--:--:--"}</span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-semibold ${
                        event.level === "error"
                          ? "text-red-300"
                          : event.level === "warn"
                            ? "text-amber-300"
                            : event.level === "success"
                              ? "text-emerald-300"
                              : "text-slate-100"
                      }`}
                    >
                      {event.kind}
                    </p>
                    {event.details.map((detail, detailIdx) => (
                      <p key={detailIdx} className="break-words text-xs leading-5 text-muted">
                        {detail}
                      </p>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 詳細ログ（ターミナル形式・初期は閉じる。開時は右ペイン内で高さを分割し、右カード全体は伸ばさない）。
            detailsはFlex子として本文へ高さが伝わらないため、button+Flex本文のstate制御アコーディオンで実装する */}
        <section
          className={`min-w-0 rounded-xl border border-border/80 bg-card/55 ${
            detailLogOpen ? "flex min-h-[160px] flex-col overflow-hidden xl:flex-[0_1_45%]" : "shrink-0"
          }`}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs font-semibold text-text">
            <button
              type="button"
              onClick={() => setDetailLogOpen(!detailLogOpen)}
              className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-left transition hover:text-blue-200"
            >
              <span
                className={`text-[10px] text-muted transition-transform ${detailLogOpen ? "rotate-90" : ""}`}
                aria-hidden="true"
              >
                ▶
              </span>
              詳細ログ
            </button>
            <span className="ml-auto flex flex-wrap items-center gap-2 font-normal">
              <span className="inline-flex rounded-lg border border-border bg-card/45 p-0.5">
                {[
                  ["all", "すべて"],
                  ["important", "重要のみ"],
                  ["problem", "警告・エラー"],
                ].map(([key, label]) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={logFilter === key ? "primary" : "ghost"}
                    className="h-5 px-1.5 text-[10px]"
                    onClick={() => setLogFilter(key)}
                  >
                    {label}
                  </Button>
                ))}
              </span>
              <label className="inline-flex items-center gap-1 text-[10px] text-muted">
                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
                自動スクロール
              </label>
              <Button
                size="sm"
                variant="secondary"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => {
                  const el = logContainerRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }}
              >
                最新行へ
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-5 px-1.5 text-[10px]"
                title="表示中のログをクリップボードへコピーします"
                onClick={() => {
                  navigator.clipboard?.writeText(filteredLogs.join("\n")).catch(() => null);
                }}
              >
                コピー
              </Button>
              <span className="text-[10px] text-muted">
                {filteredLogs.length} / {logs.length}件
              </span>
            </span>
          </div>
          <div
            ref={logContainerRef}
            className={
              detailLogOpen
                ? "dark-scroll h-[320px] min-h-0 select-text overflow-auto overscroll-contain border-t border-border/60 bg-[#1d2229] px-2.5 py-2 font-mono text-[12px] leading-[18px] xl:h-auto xl:flex-1"
                : "hidden"
            }
          >
            {filteredLogs.length === 0 ? (
              <p className="text-muted">ログはまだありません。</p>
            ) : (
              filteredLogs.map((line, idx) => {
                const level = classifyLogLine(line);
                return (
                  <div
                    key={idx}
                    className={`whitespace-pre ${
                      level === "error"
                        ? "text-red-300"
                        : level === "warn"
                          ? "text-amber-300"
                          : level === "success"
                            ? "text-emerald-300"
                            : "text-slate-300/85"
                    }`}
                  >
                    {line}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </Card>
    </div>
  );
}
