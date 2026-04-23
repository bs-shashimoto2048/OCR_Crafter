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
  setOcrDatasetDir,
  ocrFromLogsOnlyInvalid,
  setOcrFromLogsOnlyInvalid,
  ocrFromLogsIncludeCorrected,
  setOcrFromLogsIncludeCorrected,
  ocrDatasetInfo,
  onBrowseOcrDatasetDir,
  onCreateOcrDataset,
  onCreateOcrDatasetFromLogs,
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
          {trainingMode === "all" ? (
            <div>
              <label className="app-label">学習方式</label>
              <select value={trainingFamily} onChange={(e) => setTrainingFamily(e.target.value)} className="app-select">
                <option value="classification">分類モデル（classification）</option>
                <option value="ocr">OCR認識モデル（ocr）</option>
              </select>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card/60 p-3 text-sm text-text">
              学習方式:{" "}
              <span className="font-semibold">
                {trainingMode === "ocr" ? "OCR認識モデル（ocr）" : "分類モデル（classification）"}
              </span>
            </div>
          )}

          {trainingFamily === "classification" ? (
            <>
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
              <p className="text-xs text-muted">合計が 1.00 になるように設定してください。</p>

              <div className="flex flex-wrap gap-2">
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
            </>
          ) : (
            <>
              <div>
                <label className="app-label">OCRタイプ</label>
                <select value={ocrEngine} onChange={(e) => setOcrEngine(e.target.value)} className="app-select">
                  <option value="paddleocr">PaddleOCR（学習可）</option>
                  <option value="easyocr">EasyOCR（推論専用）</option>
                </select>
              </div>

              {ocrEngine === "easyocr" ? (
                <div className="rounded-lg border border-border bg-card/60 p-3 text-sm text-muted">
                  EasyOCR はこのUIでは学習対象外です。推論画面でのみ利用できます。
                </div>
              ) : (
                <>
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
                    <label className="app-label">最大文字長（max_text_length）</label>
                    <input
                      type="number"
                      className="app-input"
                      value={ocrMaxTextLength}
                      onChange={(e) => setOcrMaxTextLength(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="app-label">画像形状（image_shape: C,H,W）</label>
                    <input
                      className="app-input"
                      value={ocrImageShape}
                      onChange={(e) => setOcrImageShape(e.target.value)}
                      placeholder="1,48,320 or 3,48,320"
                    />
                    <p className="mt-1 text-xs text-muted">Cは 1（グレースケール）または 3（RGB）を指定できます。</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="inline-flex items-center gap-2 text-sm text-text">
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

                  <div>
                    <label className="app-label">学習データディレクトリ</label>
                    <div className="flex items-center gap-2">
                      <input
                        className="app-input"
                        value={ocrDatasetDir}
                        onChange={(e) => setOcrDatasetDir(e.target.value)}
                        placeholder="/path/to/ocr_dataset"
                      />
                      <Button variant="secondary" onClick={onBrowseOcrDatasetDir}>
                        参照
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      通常は「OCRデータ作成」を実行すると自動で設定されます（手動指定も可能）。
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={onCreateOcrDataset}>
                      OCRデータ作成
                    </Button>
                    <Button variant="secondary" onClick={onCreateOcrDatasetFromLogs}>
                      ログ再学習データ作成
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

                  {ocrDatasetInfo ? (
                    <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted">
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
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>ジョブID: {jobId || "-"}</span>
          <span>状態: {statusLabel(jobStatus)}</span>
        </div>
        <div className="mb-3 flex items-center justify-between text-xs">
          <label className="inline-flex items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={showImportantOnly}
              onChange={(e) => setShowImportantOnly(e.target.checked)}
            />
            重要イベントのみ表示
          </label>
          <span className="text-muted">表示: {filteredLogs.length}件</span>
        </div>

        <div
          ref={logContainerRef}
          className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card/60 backdrop-blur-md p-3 font-mono text-xs text-slate-200"
        >
          {filteredLogs.length === 0 ? (
            <p className="text-muted">ログはまだありません。</p>
          ) : (
            filteredLogs.map((line, idx) => {
              const level = logLevel(line);
              return (
                <p
                  key={`${line}-${idx}`}
                  className={`mb-1 rounded px-1.5 py-0.5 whitespace-pre ${
                    level === "error"
                      ? "bg-danger/20 text-red-100"
                      : level === "success"
                        ? "bg-success/20 text-emerald-100"
                        : level === "warn"
                          ? "bg-amber-400/20 text-amber-100"
                          : "text-slate-100"
                  }`}
                >
                  {line}
                </p>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
