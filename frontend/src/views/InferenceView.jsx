import Card from "../components/Card";
import Button from "../components/Button";

export default function InferenceView({
  modelType,
  setModelType,
  onFileChange,
  fileName,
  previewUrl,
  onRun,
  loading,
  result,
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-6">
      <Card title="Upload Image" subtitle="1枚画像を選択して推論します">
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
            <label className="app-label">Image</label>
            <input type="file" accept="image/*" onChange={onFileChange} className="block w-full text-sm text-muted" />
            <p className="mt-2 truncate text-xs text-muted">{fileName || "No file selected"}</p>
          </div>

          {previewUrl ? (
            <img src={previewUrl} alt="preview" className="h-56 w-full rounded-lg border border-border object-contain" />
          ) : null}

          <Button onClick={onRun} disabled={!fileName || loading}>
            {loading ? "Running..." : "Run Inference"}
          </Button>
        </div>
      </Card>

      <Card title="Result" subtitle="推論結果を大きく表示します">
        {result ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-[#333d49] p-8 text-center">
              <p className="text-xs uppercase tracking-[0.18em] text-muted">Prediction</p>
              <p className="mt-3 text-7xl font-semibold text-text">{result.prediction}</p>
            </div>

            <div>
              <div className="mb-2 flex justify-between text-sm text-muted">
                <span>Confidence</span>
                <span>{(Number(result.confidence || 0) * 100).toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-[#3f4b59]">
                <div
                  className="h-2 rounded-full bg-accent transition-all duration-200"
                  style={{ width: `${Math.max(4, Number(result.confidence || 0) * 100)}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-[#333d49] p-3 text-xs text-muted">
              <p className="truncate">Model: {result.model_path}</p>
              <p>Type: {result.model_type}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-[#333d49] p-8 text-center text-muted">
            推論結果はここに表示されます。
          </div>
        )}
      </Card>
    </div>
  );
}
