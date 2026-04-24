import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../components/Card";
import Button from "../components/Button";

const OCR_CHARSET_DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export default function TrainingView({
  trainingMode = "all",
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
  ocrDatasetInfo,
  onCreateSelectedOcrDataset,
  onPreprocess,
  onBuildDataset,
  onStartTraining,
  onStartOcrTraining,
  canTrain,
  canStartOcrTraining,
  jobId,
  jobStatus,
  logs,
  workflowState,
}) {
  const [showImportantOnly, setShowImportantOnly] = useState(false);
  const [paramsCollapsed, setParamsCollapsed] = useState(false);
  const logContainerRef = useRef(null);
  const preprocessed = Boolean(workflowState?.preprocessed);
  const datasetBuilt = Boolean(workflowState?.datasetBuilt);
  const trainingStarted = Boolean(workflowState?.trainingStarted);
  const isRunning = jobStatus === "queued" || jobStatus === "running";
  const isCompleted = jobStatus === "completed";
  const isFailed = jobStatus === "failed";
  const canToggleParams = trainingStarted || isRunning || isCompleted || isFailed;

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
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      const line = String(logs[i] || "");
      const jp = line.match(/残り\s*([0-9:]+)/);
      if (jp?.[1]) return jp[1];
      const en = line.match(/eta:\s*([0-9:]+)/i);
      if (en?.[1]) return en[1];
    }
    return "-";
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

  const trainingFamilyLabel = trainingFamily === "ocr" ? "OCR認識モデル" : "分類モデル";
  const statusText = statusLabel(jobStatus);
  const statusToneClass = isRunning
    ? "border-accent/60 bg-accent/15 text-blue-100"
    : isCompleted
      ? "border-success/60 bg-success/15 text-emerald-100"
      : isFailed
        ? "border-danger/60 bg-danger/15 text-red-100"
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
      className={`grid h-[calc(100vh-260px)] min-h-[560px] items-stretch gap-6 ${
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
        >
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-xl border border-border/80 bg-gradient-to-br from-[#4a5d73]/45 via-[#394553]/70 to-[#2f3943]/90 p-4 shadow-card">
              <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-accent/20 blur-2xl" />
              <div className="relative">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200/90">Model Build Dashboard</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
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
                <div className="space-y-3 rounded-xl border border-border/80 bg-card/45 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">モデル設定</p>
                  <div>
                    <label className="app-label">モデル種別</label>
                    <select
                      value={modelType}
                      onChange={(e) => setModelType(e.target.value)}
                      className="app-select"
                    >
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
                      <input
                        type="number"
                        value={epochs}
                        onChange={(e) => setEpochs(e.target.value)}
                        className="app-input"
                      />
                    </div>
                    <div>
                      <label className="app-label">バッチサイズ</label>
                      <input
                        type="number"
                        value={batchSize}
                        onChange={(e) => setBatchSize(e.target.value)}
                        className="app-input"
                      />
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
                </div>

                <div className="space-y-3 rounded-xl border border-border/80 bg-card/45 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">データ分割</p>
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
                </div>

                <div className="rounded-xl border border-border/80 bg-card/45 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">実行</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant={preprocessed ? "primary" : "secondary"}
                      className={preprocessed ? "!bg-success hover:!bg-emerald-500 text-white" : ""}
                      onClick={onPreprocess}
                    >
                      前処理
                    </Button>
                    <Button
                      variant={datasetBuilt ? "primary" : "secondary"}
                      className={datasetBuilt ? "!bg-success hover:!bg-emerald-500 text-white" : ""}
                      onClick={onBuildDataset}
                    >
                      データセット作成
                    </Button>
                    <Button
                      variant={trainingVariant}
                      className={trainingClassName}
                      onClick={onStartTraining}
                      disabled={!canTrain}
                    >
                      学習開始
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3 rounded-xl border border-border/80 bg-card/45 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">OCR設定</p>
                  <div className="grid grid-cols-[7fr_3fr] gap-2">
                    <div>
                      <label className="app-label">OCRタイプ</label>
                      <select value={ocrEngine} onChange={(e) => setOcrEngine(e.target.value)} className="app-select">
                        <option value="paddleocr">PaddleOCR（学習可）</option>
                        <option value="easyocr">EasyOCR（推論専用）</option>
                      </select>
                    </div>
                    <div>
                      <label className="app-label">最大文字数</label>
                      <input
                        type="number"
                        className="app-input"
                        value={ocrMaxTextLength}
                        onChange={(e) => setOcrMaxTextLength(e.target.value)}
                        disabled={ocrEngine === "easyocr"}
                      />
                    </div>
                  </div>
                </div>

                {ocrEngine === "easyocr" ? (
                  <div className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-100">
                    EasyOCR はこのUIでは学習対象外です。推論画面でのみ利用できます。
                  </div>
                ) : (
                  <>
                    <div className="space-y-3 rounded-xl border border-border/80 bg-card/45 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">入力仕様</p>
                      <div>
                        <label className="app-label">文字セット（charset）</label>
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
                    </div>

                    <div className="space-y-3 rounded-xl border border-border/80 bg-card/45 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">拡張と学習条件</p>
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
                      <div className="rounded-lg border border-border bg-card/40 p-3 text-xs text-muted">
                        <p className="font-medium text-text">Augmentation内容（ランダム適用）</p>
                        <p>コントラスト変化 / 軽微ガウシアンブラー / ガウシアンノイズ / 微小回転（±1〜2度）</p>
                        <p>強度1〜3で適用確率・強さが上がります（目安: 適用確率 0.35 / 0.55 / 0.75）。</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="app-label">エポック数</label>
                          <input
                            type="number"
                            className="app-input"
                            value={epochs}
                            onChange={(e) => setEpochs(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="app-label">バッチサイズ</label>
                          <input
                            type="number"
                            className="app-input"
                            value={batchSize}
                            onChange={(e) => setBatchSize(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-border/80 bg-card/45 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">データセット生成</p>
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
                      ) : null}

                      <div>
                        <label className="app-label">学習データディレクトリ</label>
                        <input
                          className="app-input"
                          value={ocrDatasetDir}
                          readOnly
                          placeholder="データ作成後に自動設定されます"
                        />
                        <p className="mt-1 text-xs text-muted">
                          先に学習データ作成を実行してください。作成後にこのパスへ自動反映されます。
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/80 bg-card/45 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">実行</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={onCreateSelectedOcrDataset}>
                          {ocrDatasetCreateMode === "from_logs" ? "再学習データ作成" : "新規学習データ作成"}
                        </Button>
                        <Button
                          variant={trainingVariant}
                          className={trainingClassName}
                          onClick={onStartOcrTraining}
                          disabled={!canStartOcrTraining}
                        >
                          OCR学習開始
                        </Button>
                      </div>
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
                )}
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
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs xl:grid-cols-4">
          <div className="rounded-lg border border-border/80 bg-card/55 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted/80">Status</p>
            <p className="mt-1 font-semibold text-text">{statusText}</p>
          </div>
          <div className="rounded-lg border border-border/80 bg-card/55 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted/80">Job ID</p>
            <p className="mt-1 truncate font-semibold text-text">{jobId || "-"}</p>
          </div>
          <div className="rounded-lg border border-border/80 bg-card/55 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted/80">ETA</p>
            <p className="mt-1 font-semibold text-text">{latestEta}</p>
          </div>
          <div className="rounded-lg border border-border/80 bg-card/55 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted/80">Visible Logs</p>
            <p className="mt-1 font-semibold text-text">{filteredLogs.length}</p>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between text-xs">
          <label className="inline-flex items-center gap-2 rounded-md border border-border/80 bg-card/55 px-2 py-1 text-muted">
            <input
              type="checkbox"
              checked={showImportantOnly}
              onChange={(e) => setShowImportantOnly(e.target.checked)}
            />
            重要イベントのみ表示
          </label>
          <span className="text-muted">総ログ: {logs.length}件</span>
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
