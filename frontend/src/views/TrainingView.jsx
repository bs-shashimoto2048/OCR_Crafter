import { useMemo, useState } from "react";
import Card from "../components/Card";
import Button from "../components/Button";

export default function TrainingView({
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
  onPreprocess,
  onBuildDataset,
  onStartTraining,
  canTrain,
  jobId,
  jobStatus,
  logs,
  workflowState,
}) {
  const [showImportantOnly, setShowImportantOnly] = useState(false);
  const preprocessed = Boolean(workflowState?.preprocessed);
  const datasetBuilt = Boolean(workflowState?.datasetBuilt);
  const trainingStarted = Boolean(workflowState?.trainingStarted);
  const isRunning = jobStatus === "queued" || jobStatus === "running";
  const isCompleted = jobStatus === "completed";
  const isFailed = jobStatus === "failed";

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

  return (
    <div className="grid grid-cols-[3fr_7fr] gap-6">
      <Card title="学習パラメータ" subtitle="ResNet18ベース分類モデル">
        <div className="space-y-4">
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
        </div>
      </Card>

      <Card title="学習ログ" subtitle="学習状態をリアルタイムで表示します">
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

        <div className="h-[360px] overflow-auto rounded-lg border border-border bg-card/60 backdrop-blur-md p-3 font-mono text-xs text-slate-200">
          {filteredLogs.length === 0 ? (
            <p className="text-muted">ログはまだありません。</p>
          ) : (
            filteredLogs.map((line, idx) => {
              const level = logLevel(line);
              return (
                <p
                  key={`${line}-${idx}`}
                  className={`mb-1 rounded px-1.5 py-0.5 ${
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
