import { useEffect, useMemo, useRef, useState } from "react";

import Button from "./components/Button";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import DashboardView from "./views/DashboardView";
import ImagesView from "./views/ImagesView";
import LabelingView from "./views/LabelingView";
import TrainingView from "./views/TrainingView";
import ModelsView from "./views/ModelsView";
import InferenceView from "./views/InferenceView";
import { API_BASE, imageUrl, request } from "./lib/api";

const viewMeta = {
  dashboard: { title: "Dashboard", subtitle: "OCR学習ワークフロー全体を管理" },
  images: { title: "Images", subtitle: "画像取り込みと一覧確認" },
  labeling: { title: "Labeling", subtitle: "数字ラベル編集" },
  training: { title: "Training", subtitle: "学習ジョブ実行とログ監視" },
  models: { title: "Models", subtitle: "保存済みモデル管理" },
  inference: { title: "Inference", subtitle: "画像推論と精度確認" },
};

function nowLabel() {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

export default function App() {
  const [activeView, setActiveView] = useState("dashboard");
  const [notice, setNotice] = useState({ kind: "info", text: "Ready" });

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [newProjectId, setNewProjectId] = useState("");

  const [sourceDir, setSourceDir] = useState("");
  const [images, setImages] = useState([]);
  const [labelDrafts, setLabelDrafts] = useState({});
  const [labelUppercase, setLabelUppercase] = useState(false);
  const [imageShapes, setImageShapes] = useState({});
  const [imageVersion, setImageVersion] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [modelType, setModelType] = useState("square");
  const [epochs, setEpochs] = useState(5);
  const [batchSize, setBatchSize] = useState(32);
  const [learningRate, setLearningRate] = useState(0.001);
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState("idle");
  const [logs, setLogs] = useState([]);

  const [models, setModels] = useState([]);
  const [latestModels, setLatestModels] = useState({ square: "", wide: "" });

  const [inferModelType, setInferModelType] = useState("square");
  const [inferFile, setInferFile] = useState(null);
  const [inferFileName, setInferFileName] = useState("");
  const [inferPreviewUrl, setInferPreviewUrl] = useState("");
  const [inferLoading, setInferLoading] = useState(false);
  const [inferResult, setInferResult] = useState(null);

  const lastStatusRef = useRef("");
  const stopPollingRef = useRef(false);

  function pushLog(line) {
    setLogs((prev) => [...prev.slice(-120), `[${nowLabel()}] ${line}`]);
  }

  function notify(kind, text) {
    setNotice({ kind, text });
  }

  async function loadProjects(preferredProjectId = projectId) {
    const data = await request("/projects");
    const items = data.items || [];
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
      setLatestModels({ square: "", wide: "" });
      return;
    }
    const pid = encodeURIComponent(targetProjectId);
    const data = await request(`/models?project_id=${pid}`);
    setModels(data.items || []);

    const latestSquare = await request(`/models/latest?project_id=${pid}&model_type=square`)
      .then((r) => r.model || "")
      .catch(() => "");
    const latestWide = await request(`/models/latest?project_id=${pid}&model_type=wide`)
      .then((r) => r.model || "")
      .catch(() => "");

    setLatestModels({ square: latestSquare, wide: latestWide });
  }

  async function refreshAll(targetProjectId = projectId) {
    if (!targetProjectId) {
      setImages([]);
      setLabelDrafts({});
      setSelectedIndex(0);
      setModels([]);
      setLatestModels({ square: "", wide: "" });
      return;
    }
    await Promise.all([loadImages(targetProjectId), loadModels(targetProjectId)]);
  }

  useEffect(() => {
    loadProjects().catch((error) => notify("error", error.message));
  }, []);

  useEffect(() => {
    if (!projectId) {
      refreshAll("").catch((error) => notify("error", error.message));
      return;
    }
    refreshAll(projectId).catch((error) => notify("error", error.message));
  }, [projectId]);

  useEffect(() => {
    setImageShapes({});
  }, [projectId]);

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
        const data = await request(`/train/${jobId}`);
        setJobStatus(data.status || "unknown");

        if (data.status && data.status !== lastStatusRef.current) {
          pushLog(`training status: ${data.status}`);
          lastStatusRef.current = data.status;
        }

        if (data.message) {
          pushLog(`message: ${data.message}`);
        }

        if (data.status === "completed") {
          notify("success", "Training completed");
          loadModels(data.project_id || projectId).catch(() => null);
          stopPollingRef.current = true;
        }

        if (data.status === "failed") {
          notify("error", "Training failed");
          stopPollingRef.current = true;
        }
      } catch (error) {
        pushLog(`poll error: ${error.message}`);
      }
    };

    const timer = setInterval(poll, 2000);
    poll().catch(() => null);

    return () => {
      stopPollingRef.current = true;
      clearInterval(timer);
    };
  }, [jobId, projectId]);

  useEffect(() => {
    if (activeView !== "labeling") {
      return undefined;
    }

    const selected = images[selectedIndex];
    if (!selected) {
      return undefined;
    }

    const onKeyDown = (event) => {
      const key = event.key;
      if (/^[a-zA-Z0-9]$/.test(key)) {
        event.preventDefault();
        setLabelDrafts((prev) => ({
          ...prev,
          [selected.image]: `${prev[selected.image] || ""}${key}`,
        }));
        return;
      }

      if (key === "Enter") {
        event.preventDefault();
        saveLabel(selected.image).catch(() => null);
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

  const labeledCount = useMemo(
    () => images.filter((item) => String(labelDrafts[item.image] || item.label || "").trim() !== "").length,
    [images, labelDrafts]
  );

  const canTrain = images.length > 0;

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
      notify("success", `Project created: ${data.project_id}`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function deleteProject() {
    if (!projectId) {
      notify("error", "削除対象の project が選択されていません");
      return;
    }

    const confirmed = window.confirm(
      `Project "${projectId}" を削除します。\nraw / annotations / models / dataset を含むデータが削除されます。続行しますか？`
    );
    if (!confirmed) {
      return;
    }

    try {
      const data = await request(`/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      notify("success", `Project deleted: ${data.project_id}`);
      pushLog(`project deleted: ${data.project_id} (jobs=${data.deleted_jobs ?? 0})`);
      const result = await loadProjects();
      await refreshAll(result.nextProjectId);
      setActiveView("dashboard");
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function importImages() {
    if (!projectId) {
      notify("error", "project を作成または選択してください");
      return;
    }
    if (!sourceDir.trim()) {
      notify("error", "Please input source directory");
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
      notify("success", `Imported ${data.copied} images`);
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
        notify("success", `Selected: ${data.path}`);
      } else {
        notify("info", "フォルダ選択がキャンセルされました");
      }
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function rotateImage(imageName, angle) {
    if (!projectId) {
      notify("error", "project を作成または選択してください");
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
      notify("success", `${imageName} rotated (${angle > 0 ? "+" : ""}${angle}°)`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function saveLabel(imageName) {
    if (!projectId) {
      notify("error", "project を作成または選択してください");
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
      notify("success", `Saved label ${imageName} -> ${value || "(empty)"}`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function runPreprocess() {
    if (!projectId) {
      notify("error", "project を作成または選択してください");
      return;
    }
    try {
      const data = await request("/preprocess/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      notify("success", `Preprocessed ${data.count} images`);
      pushLog(`preprocess done: ${data.count}`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function buildDataset() {
    if (!projectId) {
      notify("error", "project を作成または選択してください");
      return;
    }
    try {
      const data = await request("/dataset/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, train_ratio: 0.7, val_ratio: 0.2, test_ratio: 0.1 }),
      });
      notify(
        "success",
        `Dataset built train=${data.counts.train} val=${data.counts.val} test=${data.counts.test}`
      );
      pushLog(`dataset built: ${JSON.stringify(data.counts)}`);
    } catch (error) {
      notify("error", error.message);
    }
  }

  async function startTraining() {
    if (!projectId) {
      notify("error", "project を作成または選択してください");
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
      lastStatusRef.current = "";
      pushLog(`training requested: project=${projectId} job=${data.job_id}`);
      notify("info", `Training queued (${data.job_id})`);
      setActiveView("training");
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
    setInferResult(null);
  }

  async function runInference() {
    if (!projectId) {
      notify("error", "project を作成または選択してください");
      return;
    }
    if (!inferFile) {
      notify("error", "画像ファイルを選択してください");
      return;
    }

    const formData = new FormData();
    formData.append("file", inferFile);
    formData.append("model_type", inferModelType);
    formData.append("project_id", projectId);

    setInferLoading(true);
    try {
      const response = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Inference failed");
      }

      const result = await response.json();
      setInferResult(result);
      notify("success", `Prediction: ${result.prediction}`);
    } catch (error) {
      notify("error", error.message);
    } finally {
      setInferLoading(false);
    }
  }

  const currentMeta = viewMeta[activeView] || viewMeta.dashboard;

  let view = null;
  if (activeView === "dashboard") {
    view = (
      <DashboardView
        imagesCount={images.length}
        labeledCount={labeledCount}
        modelCount={models.length}
        onRefresh={() => refreshAll(projectId)}
        onPreprocess={runPreprocess}
        onBuildDataset={buildDataset}
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

  if (activeView === "labeling") {
    view = (
      <LabelingView
        projectId={projectId}
        imageVersion={imageVersion}
        images={images}
        selectedIndex={selectedIndex}
        onSelectIndex={setSelectedIndex}
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

  if (activeView === "training") {
    view = (
      <TrainingView
        modelType={modelType}
        setModelType={setModelType}
        epochs={epochs}
        setEpochs={setEpochs}
        batchSize={batchSize}
        setBatchSize={setBatchSize}
        learningRate={learningRate}
        setLearningRate={setLearningRate}
        onPreprocess={runPreprocess}
        onBuildDataset={buildDataset}
        onStartTraining={startTraining}
        canTrain={canTrain}
        jobId={jobId}
        jobStatus={jobStatus}
        logs={logs}
      />
    );
  }

  if (activeView === "models") {
    view = <ModelsView models={models} latest={latestModels} onRefresh={() => loadModels(projectId)} />;
  }

  if (activeView === "inference") {
    view = (
      <InferenceView
        modelType={inferModelType}
        setModelType={setInferModelType}
        onFileChange={selectInferenceFile}
        fileName={inferFileName}
        previewUrl={inferPreviewUrl}
        onRun={runInference}
        loading={inferLoading}
        result={inferResult}
      />
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <Sidebar active={activeView} onChange={setActiveView} />

      <main className="ml-64 min-h-screen px-8 py-6">
        <div className="mb-4 flex items-center justify-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <span className="text-xs uppercase tracking-wide text-muted">Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="app-select w-52">
            {projects.length === 0 && (
              <option value="" disabled>
                (no projects)
              </option>
            )}
            {projects.map((pid) => (
              <option key={pid} value={pid}>
                {pid}
              </option>
            ))}
          </select>
          <input
            value={newProjectId}
            onChange={(e) => setNewProjectId(e.target.value)}
            className="app-input w-44"
            placeholder="new-project"
          />
          <Button variant="secondary" onClick={createProject}>
            Create
          </Button>
          <Button variant="danger" onClick={deleteProject} disabled={!projectId}>
            Delete
          </Button>
        </div>

        <Header title={currentMeta.title} subtitle={`${currentMeta.subtitle} / Project: ${projectId}`} status={jobStatus} />

        <section className="mt-6">{view}</section>

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
      </main>
    </div>
  );
}
