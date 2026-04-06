import Card from "../components/Card";
import Button from "../components/Button";

export default function TrainingView({
  modelType,
  setModelType,
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
  return (
    <div className="grid grid-cols-[1fr_1.2fr] gap-6">
      <Card title="Training Parameters" subtitle="ResNet18ベース分類モデル">
        <div className="space-y-4">
          <div>
            <label className="app-label">Model Type</label>
            <select
              value={modelType}
              onChange={(e) => setModelType(e.target.value)}
              className="app-select"
            >
              <option value="square">square</option>
              <option value="wide">wide</option>
            </select>
          </div>

          <div>
            <label className="app-label">Epochs</label>
            <input
              type="number"
              value={epochs}
              onChange={(e) => setEpochs(e.target.value)}
              className="app-input"
            />
          </div>

          <div>
            <label className="app-label">Batch Size</label>
            <input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
              className="app-input"
            />
          </div>

          <div>
            <label className="app-label">Learning Rate</label>
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
              Preprocess
            </Button>
            <Button variant="secondary" onClick={onBuildDataset}>
              Build Dataset
            </Button>
            <Button onClick={onStartTraining} disabled={!canTrain}>
              Start Training
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Training Logs" subtitle="学習状態をリアルタイムで表示します">
        <div className="mb-3 flex items-center justify-between text-xs text-muted">
          <span>Job ID: {jobId || "-"}</span>
          <span>Status: {jobStatus}</span>
        </div>

        <div className="h-[360px] overflow-auto rounded-lg border border-border bg-[#333d49] p-3 font-mono text-xs text-slate-200">
          {logs.length === 0 ? (
            <p className="text-muted">No logs yet.</p>
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
