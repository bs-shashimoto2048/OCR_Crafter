import { useEffect, useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import { request } from "../lib/api";

const RESIZE_OPTIONS = [640, 1280, 1536, 1920, 2048];

function formatConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return num.toFixed(2);
}

export default function TrainingImageBuilderView({ projectId, activeStep = 1, onStepChange }) {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [rawPreviewUrl, setRawPreviewUrl] = useState("");
  const [originalSize, setOriginalSize] = useState(null);

  const [resizeLongSide, setResizeLongSide] = useState(1280);
  const [useResize, setUseResize] = useState(true);
  const [resizeLoading, setResizeLoading] = useState(false);
  const [resizePreview, setResizePreview] = useState(null);

  const [yoloModels, setYoloModels] = useState({ items: [], local_models: [], builtin_models: [], local_dir: "" });
  const [modelSelection, setModelSelection] = useState("yolo11n.pt");
  const [customModelPath, setCustomModelPath] = useState("");
  const [confThreshold, setConfThreshold] = useState(0.25);
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState(null);
  const [detections, setDetections] = useState([]);

  const [outputDir, setOutputDir] = useState("");
  const [cropHeight, setCropHeight] = useState(32);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    async function loadYoloModels() {
      if (!projectId) return;
      try {
        const data = await request(`/image-builder/yolo-models?project_id=${encodeURIComponent(projectId)}`);
        if (ignore) return;
        setYoloModels(data);
        if (Array.isArray(data.items) && data.items.length > 0) {
          setModelSelection((prev) => (prev ? prev : data.items[0]));
        }
      } catch (e) {
        if (!ignore) {
          setError(e.message);
        }
      }
    }
    loadYoloModels();
    return () => {
      ignore = true;
    };
  }, [projectId]);

  useEffect(() => {
    return () => {
      if (rawPreviewUrl) {
        URL.revokeObjectURL(rawPreviewUrl);
      }
    };
  }, [rawPreviewUrl]);

  const selectedCount = useMemo(() => detections.filter((row) => row.selected).length, [detections]);
  const currentImageDataUrl = detectResult?.image_data_url || resizePreview?.image_data_url || rawPreviewUrl || "";
  const currentImageSize = detectResult?.resized_size || resizePreview?.resized_size || null;
  const step1Done = Boolean(file && (!useResize || resizePreview?.resized_size || detectResult || exportResult));
  const step2Done = Boolean(detectResult);
  const step3Done = Boolean(step2Done && selectedCount > 0);
  const step4Done = Boolean(exportResult?.count);

  const stepProgress = [
    { id: 1, label: "画像指定", done: step1Done },
    { id: 2, label: "YOLO検出", done: step2Done },
    { id: 3, label: "BBox選択", done: step3Done },
    { id: 4, label: "出力", done: step4Done },
  ];

  function setFail(msg) {
    setError(msg);
    setMessage("");
  }

  function setOk(msg) {
    setMessage(msg);
    setError("");
  }

  function goStep(step) {
    if (typeof onStepChange === "function") {
      onStepChange(step);
    }
  }

  function onFileChange(event) {
    const next = event.target.files?.[0];
    if (!next) return;
    const nextPreviewUrl = URL.createObjectURL(next);
    if (rawPreviewUrl) {
      URL.revokeObjectURL(rawPreviewUrl);
    }
    setFile(next);
    setFileName(next.name);
    setRawPreviewUrl(nextPreviewUrl);
    setResizePreview(null);
    setDetectResult(null);
    setDetections([]);
    setExportResult(null);
    goStep(1);
    setMessage("");
    setError("");
    setOriginalSize(null);

    const img = new window.Image();
    img.onload = () => {
      setOriginalSize([img.naturalWidth || img.width, img.naturalHeight || img.height]);
    };
    img.onerror = () => {
      setOriginalSize(null);
    };
    img.src = nextPreviewUrl;
  }

  async function runResizePreview() {
    if (!file) {
      setFail("画像を選択してください");
      return;
    }
    setResizeLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("resize_long_side", String(resizeLongSide));
      form.append("use_resize", String(useResize));
      const res = await fetch(`${import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000"}/image-builder/resize-preview`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error((await res.text()) || "リサイズに失敗しました");
      }
      const data = await res.json();
      setResizePreview(data);
      setDetectResult(null);
      setDetections([]);
      setExportResult(null);
      setOk(`リサイズ完了: ${data.resized_size?.[0]} x ${data.resized_size?.[1]}`);
      goStep(2);
    } catch (e) {
      setFail(e.message);
    } finally {
      setResizeLoading(false);
    }
  }

  async function runDetect() {
    if (!projectId) {
      setFail("プロジェクトを選択してください");
      return;
    }
    if (!file) {
      setFail("画像を選択してください");
      return;
    }
    const modelName = modelSelection === "__custom__" ? customModelPath.trim() : modelSelection;
    if (!modelName) {
      setFail("YOLOモデルを選択してください");
      return;
    }
    setDetecting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("resize_long_side", String(resizeLongSide));
      form.append("use_resize", String(useResize));
      form.append("model", modelName);
      form.append("conf_threshold", String(confThreshold));
      form.append("project_id", projectId);
      const res = await fetch(`${import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000"}/image-builder/detect`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error((await res.text()) || "YOLO検出に失敗しました");
      }
      const data = await res.json();
      setDetectResult(data);
      setDetections((data.detections || []).map((row) => ({ ...row, selected: row.selected !== false })));
      setExportResult(null);
      setOk(`検出完了: ${data.count}件`);
    } catch (e) {
      setFail(e.message);
    } finally {
      setDetecting(false);
    }
  }

  function toggleDetection(id) {
    setDetections((prev) => prev.map((row) => (row.id === id ? { ...row, selected: !row.selected } : row)));
  }

  async function browseOutputDir() {
    try {
      const data = await request("/dialogs/select-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: outputDir || null }),
      });
      if (data.path) {
        setOutputDir(data.path);
      }
    } catch (e) {
      setFail(e.message);
    }
  }

  async function browseModelFile() {
    try {
      const initialDir = customModelPath && customModelPath.includes("/")
        ? customModelPath.slice(0, customModelPath.lastIndexOf("/")) || null
        : null;
      const data = await request("/dialogs/select-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: initialDir }),
      });
      if (data.path) {
        setCustomModelPath(data.path);
      }
    } catch (e) {
      setFail(e.message);
    }
  }

  async function exportCrops() {
    if (!file) {
      setFail("画像を選択してください");
      return;
    }
    if (!outputDir.trim()) {
      setFail("保存先パスを指定してください");
      return;
    }
    const selectedBoxes = detections.filter((row) => row.selected);
    if (selectedBoxes.length === 0) {
      setFail("保存対象のBounding Boxを1つ以上選択してください");
      return;
    }
    setExporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("resize_long_side", String(resizeLongSide));
      form.append("use_resize", String(useResize));
      form.append("boxes_json", JSON.stringify(selectedBoxes));
      form.append("output_dir", outputDir.trim());
      form.append("crop_height", String(cropHeight));
      const res = await fetch(`${import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000"}/image-builder/export`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error((await res.text()) || "クロップ出力に失敗しました");
      }
      const data = await res.json();
      setExportResult(data);
      setOk(`出力完了: ${data.count}枚`);
      goStep(4);
    } catch (e) {
      setFail(e.message);
    } finally {
      setExporting(false);
    }
  }

  const imageWidth = currentImageSize?.[0] || 1;
  const imageHeight = currentImageSize?.[1] || 1;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_560px] gap-4">
      <Card title="作業画像" subtitle={fileName || "画像未選択"}>
        <div className="max-h-[78vh] overflow-auto rounded-xl border border-border bg-card/55 p-3">
          {currentImageDataUrl ? (
            <div className="relative mx-auto w-full max-w-[980px]">
              <img src={currentImageDataUrl} alt="preview" className="block h-auto w-full rounded-md" />
              {detections.map((row) => {
                const left = (Number(row.x1) / imageWidth) * 100;
                const top = (Number(row.y1) / imageHeight) * 100;
                const width = (Number(row.width) / imageWidth) * 100;
                const height = (Number(row.height) / imageHeight) * 100;
                const active = row.selected;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => toggleDetection(row.id)}
                    className={`absolute rounded-sm border-2 text-left ${
                      active ? "border-emerald-300" : "border-red-300"
                    }`}
                    style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                    title={`#${row.id} conf=${formatConfidence(row.confidence)}`}
                  >
                    <span
                      className={`absolute left-0 top-0 -translate-y-full rounded-sm px-1 py-0.5 text-[11px] font-semibold text-black ${
                        active ? "bg-emerald-300" : "bg-red-300"
                      }`}
                    >
                      #{row.id} {formatConfidence(row.confidence)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-20 text-center text-sm text-muted">右側ステップ1で画像を選択してください</div>
          )}
        </div>
      </Card>

      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2 rounded-xl border border-border bg-card/45 p-2">
          {stepProgress.map((step) => (
            <div
              key={step.id}
              className={`rounded-lg border px-2 py-1 text-center text-xs font-semibold ${
                activeStep === step.id
                  ? "border-accent bg-accent/20 text-blue-100"
                  : step.done
                    ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                    : "border-border bg-card/60 text-muted"
              }`}
            >
              <div>Step {step.id}</div>
              <div>{step.label}</div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {activeStep === 1 ? (
            <Card title="1. 画像指定とリサイズ" subtitle={step1Done ? "完了" : "長手を指定サイズに合わせる"}>
              <div className="space-y-3">
                <input type="file" accept="image/*" onChange={onFileChange} className="app-input h-auto py-2" />
                <p className="text-xs text-muted">
                  元画像サイズ: {originalSize ? `${originalSize[0]} x ${originalSize[1]}` : "--"}
                </p>
                <label className="inline-flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={useResize}
                    onChange={(e) => {
                      const nextValue = e.target.checked;
                      setUseResize(nextValue);
                      setResizePreview(null);
                      setDetectResult(null);
                      setDetections([]);
                      setExportResult(null);
                    }}
                  />
                  リサイズを適用する
                </label>
                <div>
                  <label className="app-label">長手サイズ</label>
                  <select
                    className="app-select"
                    value={resizeLongSide}
                    onChange={(e) => setResizeLongSide(Number(e.target.value))}
                    disabled={!useResize}
                  >
                    {RESIZE_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                {!useResize ? <p className="text-xs text-muted">原寸のまま次の工程へ進めます。</p> : null}
                <div className="flex gap-2">
                  <Button onClick={runResizePreview} disabled={!file || resizeLoading}>
                    {resizeLoading ? "処理中..." : useResize ? "リサイズ反映" : "原寸を反映"}
                  </Button>
                  <Button variant="secondary" onClick={() => goStep(2)} disabled={!file}>
                    次へ
                  </Button>
                </div>
                {resizePreview?.resized_size ? (
                  <p className="text-xs text-muted">
                    処理後サイズ: {resizePreview.resized_size[0]} x {resizePreview.resized_size[1]}
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {activeStep === 2 ? (
            <Card title="2. YOLO検出" subtitle={step2Done ? "完了" : "モデル選択 + 閾値で推論"}>
              <div className="space-y-3">
                <div>
                  <label className="app-label">YOLOモデル</label>
                  <select
                    className="app-select"
                    value={modelSelection}
                    onChange={(e) => setModelSelection(e.target.value)}
                  >
                    {(yoloModels.items || []).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    <option value="__custom__">カスタムパスを入力</option>
                  </select>
                </div>
                {modelSelection === "__custom__" ? (
                  <div>
                    <label className="app-label">モデルパス</label>
                    <div className="flex gap-2">
                      <input
                        className="app-input"
                        value={customModelPath}
                        onChange={(e) => setCustomModelPath(e.target.value)}
                        placeholder="/path/to/yolo.pt"
                      />
                      <Button type="button" variant="secondary" onClick={browseModelFile}>
                        Browse
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div>
                  <label className="app-label">検出閾値: {confThreshold.toFixed(2)}</label>
                  <input
                    type="range"
                    min={0.01}
                    max={0.99}
                    step={0.01}
                    value={confThreshold}
                    onChange={(e) => setConfThreshold(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={runDetect} disabled={!file || detecting}>
                    {detecting ? "検出中..." : "検出実行"}
                  </Button>
                  <Button variant="secondary" onClick={() => goStep(3)} disabled={!step2Done}>
                    次へ
                  </Button>
                </div>
                {detectResult ? <p className="text-xs text-muted">検出件数: {detectResult.count}</p> : null}
              </div>
            </Card>
          ) : null}

          {activeStep === 3 ? (
            <Card title="3. Bounding Box選択" subtitle={step3Done ? "完了" : "保存対象をチェック"}>
              <div className="mb-2 flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setDetections((prev) => prev.map((row) => ({ ...row, selected: true })))}
                  disabled={detections.length === 0}
                >
                  全選択
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setDetections((prev) => prev.map((row) => ({ ...row, selected: false })))}
                  disabled={detections.length === 0}
                >
                  全解除
                </Button>
              </div>
              <p className="mb-2 text-xs text-muted">選択件数: {selectedCount} / {detections.length}</p>
              <p className="mb-2 text-xs text-muted">画像上のBounding Boxクリックでも選択を切り替えできます。</p>
              <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-border bg-card/45 p-2">
                {detections.length === 0 ? (
                  <p className="text-xs text-muted">検出結果がありません</p>
                ) : (
                  detections.map((row) => (
                    <label
                      key={row.id}
                      className={`flex items-center justify-between rounded-md border px-2 py-1 text-xs ${
                        row.selected ? "border-emerald-400/60 text-emerald-200" : "border-red-400/60 text-red-200"
                      }`}
                    >
                      <span className="truncate">
                        #{row.id} {row.label}
                      </span>
                      <span className="ml-2">{formatConfidence(row.confidence)}</span>
                      <input type="checkbox" checked={!!row.selected} onChange={() => toggleDetection(row.id)} />
                    </label>
                  ))
                )}
              </div>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => goStep(4)} disabled={!step3Done}>
                  次へ
                </Button>
              </div>
            </Card>
          ) : null}

          {activeStep === 4 ? (
            <Card title="4. クロップ出力" subtitle={step4Done ? "完了" : "選択Bounding Boxを指定高さで保存"}>
              <div className="space-y-3">
                <div>
                  <label className="app-label">保存先パス</label>
                  <div className="flex gap-2">
                    <input
                      className="app-input"
                      value={outputDir}
                      onChange={(e) => setOutputDir(e.target.value)}
                      placeholder="/path/to/output"
                    />
                    <Button variant="secondary" onClick={browseOutputDir}>
                      Browse
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="app-label">出力高さ(px)</label>
                  <input
                    className="app-input"
                    type="number"
                    min={8}
                    max={512}
                    value={cropHeight}
                    onChange={(e) => setCropHeight(Number(e.target.value))}
                  />
                </div>
                <Button onClick={exportCrops} disabled={exporting || selectedCount === 0}>
                  {exporting ? "出力中..." : "選択Bounding Boxを出力"}
                </Button>
                {exportResult ? (
                  <p className="text-xs text-muted">
                    出力: {exportResult.count}枚 / 桁数: {exportResult.digits} / 保存先: {exportResult.output_dir}
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {(message || error) && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                error ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success"
              }`}
            >
              {error || message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
