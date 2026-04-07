import Card from "../components/Card";
import Button from "../components/Button";

export default function TrainingView({
  modelType,
  setModelType,
  modelTypes,
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
}) {
  function statusLabel(value) {
    if (value === "queued") return "待機中";
    if (value === "running") return "実行中";
    if (value === "completed") return "完了";
    if (value === "failed") return "失敗";
    if (value === "idle") return "未実行";
    return value || "-";
  }

  return (
    <div className="grid grid-cols-[1fr_1.2fr] gap-6">
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

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onPreprocess}>
              前処理
            </Button>
            <Button variant="secondary" onClick={onBuildDataset}>
              データセット作成
            </Button>
            <Button onClick={onStartTraining} disabled={!canTrain}>
              学習開始
            </Button>
          </div>
        </div>
      </Card>

      <Card title="学習ログ" subtitle="学習状態をリアルタイムで表示します">
        <div className="mb-3 flex items-center justify-between text-xs text-muted">
          <span>ジョブID: {jobId || "-"}</span>
          <span>状態: {statusLabel(jobStatus)}</span>
        </div>

        <div className="h-[360px] overflow-auto rounded-lg border border-border bg-[#333d49] p-3 font-mono text-xs text-slate-200">
          {logs.length === 0 ? (
            <p className="text-muted">ログはまだありません。</p>
          ) : (
            logs.map((line, idx) => (
              <p key={`${line}-${idx}`} className="mb-1">
                {line}
              </p>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
