import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../components/Card";
import Button from "../components/Button";
import { PADDLEOCR_OFFICIAL_MODELS_TOOLTIP } from "../lib/paddleocrOfficialTooltip";

const OCR_CHARSET_DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
// Tesseract学習対象文字セット（A-Z / 0-9 / 小文字筆記体 k,l,t）
const TESSERACT_CHARSET_DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt";

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
  ocrMaxTextLength,
  setOcrMaxTextLength,
  ocrImageShape,
  setOcrImageShape,
  ocrUseAugmentation,
  setOcrUseAugmentation,
  ocrAugStrength,
  setOcrAugStrength,
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
  logs,
  workflowState,
}) {
  const [showImportantOnly, setShowImportantOnly] = useState(false);
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

  function statusLabel(value) {
    if (value === "queued") return "待機中";
    if (value === "running") return "実行中";
    if (value === "completed") return "完了";
    if (value === "failed") return "失敗";
    if (value === "stopped") return "停止";
    if (value === "idle") return "未実行";
    return value || "-";
  }

  function logLevel(line) {
    const text = String(line || "").toLowerCase();
    if (text.includes("failed") || text.includes("error") || text.includes("失敗") || text.includes("例外")) {
      return "error";
    }
    if (text.includes("completed") || text.includes("success") || text.includes("完了")) {
      return "success";
    }
    if (text.includes("warning") || text.includes("警告") || text.includes("missing") || text.includes("0件")) {
      return "warn";
    }
    return "info";
  }

  const filteredLogs = useMemo(() => {
    if (!showImportantOnly) {
      return logs;
    }
    return logs.filter((line) => logLevel(line) !== "info");
  }, [logs, showImportantOnly]);

  const latestEta = useMemo(() => {
    function parseTimestamp(value) {
      const match = String(value || "").match(/\[(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})\]/);
      if (!match) return null;
      const [, y, m, d, hh, mm, ss] = match;
      const parsed = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    const progressRows = [];
    let rawEta = "-";
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      const line = String(logs[i] || "");
      const progress = line.match(/epoch:\s*\[(\d+)\/(\d+)\].*global_step:\s*(\d+)/i);
      if (progress) {
        const ts = parseTimestamp(line);
        const currentEpoch = Number(progress[1]);
        const totalEpochs = Number(progress[2]);
        const globalStep = Number(progress[3]);
        if (ts && Number.isFinite(currentEpoch) && Number.isFinite(totalEpochs) && Number.isFinite(globalStep)) {
          progressRows.push({ ts, currentEpoch, totalEpochs, globalStep });
        }
      }
      const jp = line.match(/残り\s*([0-9:]+)/);
      if (jp?.[1] && rawEta === "-") rawEta = jp[1];
      const en = line.match(/eta:\s*([0-9:]+)/i);
      if (en?.[1] && rawEta === "-") rawEta = en[1];
    }

    if (progressRows.length >= 2) {
      const latest = progressRows[0];
      const earliest = progressRows[progressRows.length - 1];
      const elapsedSec = Math.max(1, Math.round((latest.ts.getTime() - earliest.ts.getTime()) / 1000));
      const completedSteps = Math.max(1, latest.globalStep - earliest.globalStep);
      const inferredStepsPerEpoch = Math.max(1, Math.round(latest.globalStep / Math.max(latest.currentEpoch, 1)));
      const totalSteps = Math.max(latest.globalStep, inferredStepsPerEpoch * latest.totalEpochs);
      const remainingSteps = Math.max(0, totalSteps - latest.globalStep);
      const remainingSec = Math.round((elapsedSec / completedSteps) * remainingSteps);
      const hours = Math.floor(remainingSec / 3600);
      const minutes = Math.floor((remainingSec % 3600) / 60);
      const seconds = remainingSec % 60;
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return rawEta;
  }, [logs]);

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
    const el = logContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredLogs]);

  useEffect(() => {
    if (!canToggleParams) {
      setParamsCollapsed(false);
    }
  }, [canToggleParams]);

  const ratioSummary = useMemo(() => {
    const train = Number(trainRatio);
    const val = Number(valRatio);
    const test = Number(testRatio);
    if (!Number.isFinite(train) || !Number.isFinite(val) || !Number.isFinite(test)) {
      return { total: "-", valid: false };
    }
    const total = train + val + test;
    const valid = train > 0 && val >= 0 && test >= 0 && Math.abs(total - 1.0) < 1e-6;
    return { total: total.toFixed(2), valid };
  }, [trainRatio, valRatio, testRatio]);

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
  const statusText = statusLabel(jobStatus);
  const statusToneClass = isRunning
    ? "border-accent/60 bg-accent/15 text-blue-100"
    : isCompleted
      ? "border-success/60 bg-success/15 text-emerald-100"
      : isFailed
        ? "border-danger/60 bg-danger/15 text-red-100"
        : isStopped
          ? "border-amber-300/40 bg-amber-300/10 text-amber-100"
        : "border-border bg-card/70 text-muted";

  function logRowClass(level) {
    if (level === "error") return "border-danger/30 bg-danger/10 text-red-100";
    if (level === "success") return "border-success/30 bg-success/10 text-emerald-100";
    if (level === "warn") return "border-amber-300/35 bg-amber-300/10 text-amber-100";
    return "border-border/70 bg-card/55 text-slate-100";
  }

  function logDotClass(level) {
    if (level === "error") return "bg-danger";
    if (level === "success") return "bg-success";
    if (level === "warn") return "bg-amber-300";
    return "bg-accent/80";
  }

  return (
    <div
      className={`grid h-[calc(100vh-175px)] min-h-[560px] items-stretch gap-4 ${
        paramsCollapsed ? "grid-cols-1" : "grid-cols-[3fr_7fr]"
      }`}
    >
      {!paramsCollapsed ? (
        <Card
          title="学習パラメータ"
          subtitle={
            trainingMode === "ocr"
              ? "OCR認識モデルの学習を実行します"
              : trainingMode === "classification"
                ? "分割学習モデルの学習を実行します"
                : "分類モデルとOCRモデルを切り替えて学習できます"
          }
          className="flex min-h-0 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
            <div className="relative overflow-hidden rounded-xl border border-border/80 bg-gradient-to-br from-[#4a5d73]/45 via-[#394553]/70 to-[#2f3943]/90 p-3 shadow-card">
              <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-accent/20 blur-2xl" />
              <div className="relative">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200/90">Model Build Dashboard</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-white/10 bg-black/15 px-2 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-300/80">方式</p>
                    <p className="mt-1 text-sm font-semibold text-slate-100">{trainingFamilyLabel}</p>
                  </div>
                  <div className={`rounded-lg border px-2 py-2 ${statusToneClass}`}>
                    <p className="text-[10px] uppercase tracking-wide text-slate-200/80">状態</p>
                    <p className="mt-1 text-sm font-semibold">{statusText}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/15 px-2 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-300/80">ETA</p>
                    <p className="mt-1 text-sm font-semibold text-slate-100">{latestEta}</p>
                  </div>
                </div>
              </div>
            </div>

            {trainingMode === "all" ? (
              <div className="rounded-xl border border-border/80 bg-card/50 p-3">
                <label className="app-label">学習方式</label>
                <select value={trainingFamily} onChange={(e) => setTrainingFamily(e.target.value)} className="app-select">
                  <option value="classification">分類モデル（classification）</option>
                  <option value="ocr">OCR認識モデル（ocr）</option>
                </select>
              </div>
            ) : (
              <div className="rounded-xl border border-border/80 bg-card/60 p-3 text-sm text-text">
                学習方式:{" "}
                <span className="font-semibold">
                  {trainingMode === "ocr" ? "OCR認識モデル（ocr）" : "分類モデル（classification）"}
                </span>
              </div>
            )}

            {trainingFamily === "classification" ? (
              <>
                <div className="space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">1. データ準備</p>
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
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">2. 初期重み</p>
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
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">3. 学習パラメータ</p>
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
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">4. 実行</p>
                  <Button
                    variant={clsNextAction === "train" ? trainingVariant : "secondary"}
                    className={`${clsNextAction === "train" ? trainingClassName : ""} w-full`}
                    onClick={clsNextAction === "preprocess" ? onPreprocess : clsNextAction === "dataset" ? onBuildDataset : onStartTraining}
                    disabled={clsNextAction === "train" ? !canTrain || !clsHasInitModel : false}
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
                <div className="space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">共通設定</p>
                  <div className="grid grid-cols-2 gap-2">
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
                    <div>
                      <label className="app-label">
                        データ分割
                        <InfoHint text="Train / Validation / Test の分割比率（合計1.00）。Tesseractでは Train→train.list / Validation→eval.list / Test→評価用 として使われます。" />
                      </label>
                      <div className="grid grid-cols-3 gap-1">
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={trainRatio}
                          onChange={(e) => setTrainRatio(e.target.value)}
                          className="app-input"
                          title="Train 比率"
                        />
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={valRatio}
                          onChange={(e) => setValRatio(e.target.value)}
                          className="app-input"
                          title="Validation 比率"
                        />
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={testRatio}
                          onChange={(e) => setTestRatio(e.target.value)}
                          className="app-input"
                          title="Test 比率"
                        />
                      </div>
                      <p className={`mt-1 text-[11px] ${ratioSummary.valid ? "text-muted" : "text-amber-100"}`}>
                        Train/Val/Test 合計: {ratioSummary.total}
                        {ratioSummary.valid ? "" : "（1.00 になるよう調整してください）"}
                      </p>
                    </div>
                    <div>
                      <label className="app-label">
                        学習回数
                        <InfoHint text="学習の繰り返し回数です。PaddleOCR / EasyOCR では Epoch 数、Tesseract では Iteration 数として使用します。Tesseractでは一般的に500〜3000程度で学習します。" />
                      </label>
                      <input
                        type="number"
                        className="app-input"
                        value={epochs}
                        onChange={(e) => setEpochs(e.target.value)}
                        disabled={ocrEngine === "easyocr"}
                      />
                      <p className="mt-1 text-[11px] text-muted">エンジンに応じて Epoch または Iteration として処理されます。</p>
                    </div>
                    <div>
                      <label className="app-label">
                        出力先
                        <InfoHint text="学習済みモデルの保存先です（変更不可）。" />
                      </label>
                      <input className="app-input" value={`data/projects/${projectId || "<project>"}/models/`} readOnly />
                    </div>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">1. データ準備</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="app-label">OCRタイプ</label>
                      <select value={ocrEngine} onChange={(e) => setOcrEngine(e.target.value)} className="app-select">
                        <option value="paddleocr">PaddleOCR（学習可）</option>
                        <option value="tesseract">Tesseract（学習可 / A-Z・0-9・筆記体klt）</option>
                        <option value="easyocr">EasyOCR（推論専用）</option>
                      </select>
                    </div>
                    <div>
                      <label className="app-label">学習データ作成方法</label>
                      <select value={ocrDatasetCreateMode} onChange={(e) => setOcrDatasetCreateMode(e.target.value)} className="app-select">
                        <option value="new">新規作成（ラベルデータから）</option>
                        <option value="from_logs">再学習作成（OCRログから）</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="app-label">
                        演算デバイス
                        <InfoHint text="学習に使用する演算デバイスです。auto はGPUが利用可能な場合にGPUを使用します。TesseractはCPUのみ対応しています。" />
                      </label>
                      <div className="grid h-8 grid-cols-3 gap-1.5">
                        {[
                          {
                            value: "auto",
                            label: "Auto",
                            // 選択可能なボタンは色付きで発光させる（Auto=青）
                            glow: "border-accent/80 bg-card/60 text-blue-200 shadow-[0_0_10px_rgba(88,166,255,0.55)] hover:bg-accent/20",
                            selectedClass: "border-accent bg-accent text-white shadow-[0_0_14px_rgba(88,166,255,0.75)]",
                            selectable: !isTesseractEngine && ocrEngine !== "easyocr",
                            hint: "GPUが利用可能ならGPUを使用します",
                          },
                          {
                            value: "cpu",
                            label: "CPU",
                            glow: "border-cyan-400/80 bg-card/60 text-cyan-100 shadow-[0_0_10px_rgba(34,211,238,0.55)] hover:bg-cyan-400/15",
                            selectedClass: "border-cyan-300 bg-cyan-500/80 text-white shadow-[0_0_14px_rgba(34,211,238,0.75)]",
                            selectable: ocrEngine !== "easyocr",
                            hint: "CPUで学習します",
                          },
                          {
                            value: "gpu",
                            label: "GPU",
                            glow: "border-emerald-400/80 bg-card/60 text-emerald-100 shadow-[0_0_10px_rgba(52,211,153,0.6)] hover:bg-emerald-400/15",
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
                                    : "cursor-not-allowed border-border/50 bg-card/40 text-muted/40"
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
                  ) : null}
                </div>

                <details open className="rounded-xl border border-border/80 bg-card/45 p-3">
                  <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">
                    エンジン固有設定（{ocrEngine === "paddleocr" ? "PaddleOCR" : isTesseractEngine ? "Tesseract" : "EasyOCR"}）
                  </summary>
                  <div className="mt-2 space-y-2">
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
                        <select value={ocrInitSourceType} onChange={(e) => setOcrInitSourceType(e.target.value)} className="app-select">
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
                          <select value={ocrInitSourceValue} onChange={(e) => setOcrInitSourceValue(e.target.value)} className="app-select">
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
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="app-label">保存間隔（epoch）</label>
                          <input
                            type="number"
                            min="1"
                            className="app-input"
                            value={ocrSaveEpochStep}
                            onChange={(e) => setOcrSaveEpochStep(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="app-label">Train num_workers</label>
                          <input
                            type="number"
                            min="0"
                            className="app-input"
                            value={ocrTrainNumWorkers}
                            onChange={(e) => setOcrTrainNumWorkers(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="app-label">Eval num_workers</label>
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
                            <select className="app-select" value={ocrChannel} onChange={(e) => updateOcrImageShape({ c: e.target.value })}>
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
                        <label className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/55 px-3 py-2 text-sm text-text">
                          <input
                            type="checkbox"
                            checked={Boolean(ocrUseAugmentation)}
                            onChange={(e) => setOcrUseAugmentation(e.target.checked)}
                          />
                          Augmentationを使用
                        </label>
                        <div>
                          <label className="app-label">Aug強度 (1-3)</label>
                          <input
                            type="number"
                            min="1"
                            max="3"
                            className="app-input"
                            value={ocrAugStrength}
                            onChange={(e) => setOcrAugStrength(e.target.value)}
                            disabled={!ocrUseAugmentation}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="app-label">
                            バッチサイズ
                            <InfoHint text="1ステップで処理する画像枚数です。Batch自動最適化がONの場合はVRAM基準で調整されます。" />
                          </label>
                          <input type="number" className="app-input" value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
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
                </details>

                {ocrEngine !== "easyocr" ? (
                  <>
                    <div className="space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">2. 実行</p>
                      <Button
                        variant={ocrNextAction === "train" ? trainingVariant : "secondary"}
                        className={`${ocrNextAction === "train" ? trainingClassName : ""} w-full`}
                        onClick={ocrNextAction === "dataset" ? onCreateSelectedOcrDataset : onStartOcrTraining}
                        disabled={ocrNextAction === "train" ? !canStartOcrTraining || !ocrHasInitModel : false}
                      >
                        {ocrNextAction === "dataset"
                          ? ocrDatasetCreateMode === "from_logs"
                            ? "次アクション: 再学習データ作成"
                            : "次アクション: 新規学習データ作成"
                          : "次アクション: OCR学習開始"}
                      </Button>
                      {!ocrHasInitModel ? (
                        <p className="text-xs text-amber-100">OCR Fine-tuneを選択中です。初期モデルを指定してください。</p>
                      ) : null}
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
                      {ocrDatasetReady ? (
                        <Button variant="secondary" className="w-full" onClick={onCreateSelectedOcrDataset}>
                          データを再作成
                        </Button>
                      ) : null}
                    </div>

                    {ocrDatasetInfo ? (
                      <div className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs text-blue-100">
                        <p>作成済みデータ: {ocrDatasetInfo.dataset_root || "-"}</p>
                        {ocrDatasetInfo.counts ? (
                          <p>
                            件数 train/val/test: {ocrDatasetInfo.counts?.train ?? 0}/{ocrDatasetInfo.counts?.val ?? 0}/
                            {ocrDatasetInfo.counts?.test ?? 0}
                          </p>
                        ) : (
                          <p>件数: {ocrDatasetInfo.count ?? 0}</p>
                        )}
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
        title="学習ログ"
        subtitle="学習状態をリアルタイムで表示します"
        className="flex h-full min-h-0 flex-col"
        actions={
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border bg-card/60 px-2 py-1 text-xs text-muted">
              残り時間: <span className="font-semibold text-text">{latestEta}</span>
            </span>
            {isRunning ? (
              <>
                <Button size="sm" variant="danger" onClick={onStopTraining}>
                  学習停止
                </Button>
                <Button size="sm" variant="danger" onClick={onStopTrainingAndDelete}>
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
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-baseline gap-1.5 rounded-md border border-border/80 bg-card/55 px-2 py-1">
            <span className="text-[10px] uppercase tracking-wide text-muted/80">Status</span>
            <span className="font-semibold text-text">{statusText}</span>
          </span>
          <span className="flex min-w-0 items-baseline gap-1.5 rounded-md border border-border/80 bg-card/55 px-2 py-1">
            <span className="text-[10px] uppercase tracking-wide text-muted/80">Job ID</span>
            <span className="max-w-[180px] truncate font-semibold text-text">{jobId || "-"}</span>
          </span>
          <span className="flex items-baseline gap-1.5 rounded-md border border-border/80 bg-card/55 px-2 py-1">
            <span className="text-[10px] uppercase tracking-wide text-muted/80">ETA</span>
            <span className="font-semibold text-text">{latestEta}</span>
          </span>
          <span className="flex items-baseline gap-1.5 rounded-md border border-border/80 bg-card/55 px-2 py-1">
            <span className="text-[10px] uppercase tracking-wide text-muted/80">Visible</span>
            <span className="font-semibold text-text">{filteredLogs.length}</span>
          </span>
          <span className="ml-auto flex items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-md border border-border/80 bg-card/55 px-2 py-1 text-muted">
              <input
                type="checkbox"
                checked={showImportantOnly}
                onChange={(e) => setShowImportantOnly(e.target.checked)}
              />
              重要イベントのみ表示
            </label>
            <span className="text-muted">総ログ: {logs.length}件</span>
          </span>
        </div>

        <div
          ref={logContainerRef}
          className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-gradient-to-b from-card/65 to-card/45 p-3 font-mono text-xs"
        >
          {filteredLogs.length === 0 ? (
            <p className="text-muted">ログはまだありません。</p>
          ) : (
            filteredLogs.map((line, idx) => {
              const level = logLevel(line);
              return (
                <div
                  key={`${line}-${idx}`}
                  className={`mb-1.5 flex items-start gap-2 rounded-md border px-2 py-1 ${logRowClass(level)}`}
                >
                  <span className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full ${logDotClass(level)}`} />
                  <p className="flex-1 whitespace-pre-wrap break-all leading-5">{line}</p>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
