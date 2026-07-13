import { useEffect, useMemo, useRef, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import { request } from "../lib/api";

const RESIZE_OPTIONS = [640, 1280, 1536, 1920, 2048];
const IMAGE_BUILDER_STATE_STORAGE_KEY = "ocr_image_builder_last_state_v1";
const HEIC_EXTENSIONS = [".heic", ".heif"];
const IMAGE_ZOOM_MIN = 0.1;
const IMAGE_ZOOM_MAX = 4.0;

// YOLO検出専用の前処理設定（OCR前処理とは独立）。初期値は元画像を変化させない
const DETECT_PREPROCESS_DEFAULTS = {
  rotation: 0,
  crop_unit: "px",
  crop_top: 0,
  crop_bottom: 0,
  crop_left: 0,
  crop_right: 0,
  brightness: 1.0,
  contrast: 1.0,
  sharpen: false,
  sharpen_strength: 1.0,
  resize_width: "",
  resize_height: "",
  keep_aspect_ratio: true,
  grayscale: false,
};
const DETECT_PREPROCESS_STORAGE_KEY = "ocr_detection_preprocess_by_project_v1";

// サーバー送信用の設定オブジェクトを構築。無変換設定なら null（=従来どおり元画像で処理）
function buildDetectPreprocessPayload(p) {
  const toInt = (v) => {
    const n = Number.parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const payload = {
    rotation: Number(p.rotation) || 0,
    crop_unit: p.crop_unit === "percent" ? "percent" : "px",
    crop_top: Math.max(0, Number(p.crop_top) || 0),
    crop_bottom: Math.max(0, Number(p.crop_bottom) || 0),
    crop_left: Math.max(0, Number(p.crop_left) || 0),
    crop_right: Math.max(0, Number(p.crop_right) || 0),
    brightness: Number(p.brightness) || 1.0,
    contrast: Number(p.contrast) || 1.0,
    sharpen: Boolean(p.sharpen),
    sharpen_strength: Number(p.sharpen_strength) || 1.0,
    resize_width: toInt(p.resize_width),
    resize_height: toInt(p.resize_height),
    keep_aspect_ratio: Boolean(p.keep_aspect_ratio),
    grayscale: Boolean(p.grayscale),
  };
  const noop =
    payload.rotation % 360 === 0 &&
    payload.crop_top === 0 &&
    payload.crop_bottom === 0 &&
    payload.crop_left === 0 &&
    payload.crop_right === 0 &&
    Math.abs(payload.brightness - 1.0) < 1e-6 &&
    Math.abs(payload.contrast - 1.0) < 1e-6 &&
    !payload.sharpen &&
    payload.resize_width === null &&
    payload.resize_height === null &&
    !payload.grayscale;
  return noop ? null : payload;
}
const RESIZE_AXES = ["width", "height"];
const COPY_PASTE_OFFSET = 12;
const SERIES_FILTER_ALL = "__all__";

function loadImageBuilderState() {
  const defaults = {
    resizeLongSide: 1280,
    resizeAxis: "width",
    useResize: true,
    modelSelection: "yolo11n.pt",
    customModelPath: "",
    confThreshold: 0.25,
    mergeOverlaps: true,
    mergeIouThreshold: 0.5,
    outputDir: "",
    cropHeight: 32,
  };
  try {
    const raw = localStorage.getItem(IMAGE_BUILDER_STATE_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const resizeLongSide = RESIZE_OPTIONS.includes(Number(parsed?.resizeLongSide))
      ? Number(parsed.resizeLongSide)
      : defaults.resizeLongSide;
    const useResize = typeof parsed?.useResize === "boolean" ? parsed.useResize : defaults.useResize;
    const resizeAxis =
      typeof parsed?.resizeAxis === "string" && RESIZE_AXES.includes(parsed.resizeAxis)
        ? parsed.resizeAxis
        : defaults.resizeAxis;
    const modelSelection =
      typeof parsed?.modelSelection === "string" && parsed.modelSelection.trim()
        ? parsed.modelSelection
        : defaults.modelSelection;
    const customModelPath = typeof parsed?.customModelPath === "string" ? parsed.customModelPath : defaults.customModelPath;
    const confThresholdNum = Number(parsed?.confThreshold);
    const confThreshold =
      Number.isFinite(confThresholdNum) && confThresholdNum >= 0.01 && confThresholdNum <= 0.99
        ? confThresholdNum
        : defaults.confThreshold;
    const mergeOverlaps = typeof parsed?.mergeOverlaps === "boolean" ? parsed.mergeOverlaps : defaults.mergeOverlaps;
    const mergeIouThresholdNum = Number(parsed?.mergeIouThreshold);
    const mergeIouThreshold =
      Number.isFinite(mergeIouThresholdNum) && mergeIouThresholdNum >= 0.0 && mergeIouThresholdNum <= 1.0
        ? mergeIouThresholdNum
        : defaults.mergeIouThreshold;
    const outputDir = typeof parsed?.outputDir === "string" ? parsed.outputDir : defaults.outputDir;
    const cropHeightNum = Number(parsed?.cropHeight);
    const cropHeight =
      Number.isFinite(cropHeightNum) && cropHeightNum >= 8 && cropHeightNum <= 512
        ? Math.round(cropHeightNum)
        : defaults.cropHeight;
    return {
      resizeLongSide,
      resizeAxis,
      useResize,
      modelSelection,
      customModelPath,
      confThreshold,
      mergeOverlaps,
      mergeIouThreshold,
      outputDir,
      cropHeight,
    };
  } catch {
    return defaults;
  }
}

function formatConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return num.toFixed(2);
}

export default function TrainingImageBuilderView({ projectId, activeStep = 1, onStepChange }) {
  const initialState = useMemo(() => loadImageBuilderState(), []);
  const bboxItemRefs = useRef(new Map());
  const pendingFocusBboxIdRef = useRef(null);
  const imageRef = useRef(null);
  const imageViewportRef = useRef(null);
  // 画像上シングルクリックによる選択変更の直近記録（ダブルクリック時の復元用）
  const lastImageClickToggleRef = useRef({ id: null, at: 0, prevSelection: null });
  // UI上の選択状態（操作対象）。有効/無効(row.selected=保存対象)とは独立して管理する
  const [selectedUiIds, setSelectedUiIds] = useState([]);
  const clickTimerRef = useRef(null);
  const dragStateRef = useRef(null);

  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [rawPreviewUrl, setRawPreviewUrl] = useState("");
  const [originalSize, setOriginalSize] = useState(null);

  const [resizeLongSide, setResizeLongSide] = useState(initialState.resizeLongSide);
  const [resizeAxis, setResizeAxis] = useState(initialState.resizeAxis);
  const [useResize, setUseResize] = useState(initialState.useResize);

  // YOLO検出前処理（プロジェクト単位で保存）とプレビュー表示状態
  const [detectPreprocess, setDetectPreprocess] = useState({ ...DETECT_PREPROCESS_DEFAULTS });
  const [imagePreviewMode, setImagePreviewMode] = useState("original");
  const [detectPreviewUrl, setDetectPreviewUrl] = useState("");
  const [detectPreviewLoading, setDetectPreviewLoading] = useState(false);
  // 検出実行時に使用した前処理（クロップ出力の座標整合のため保持）
  const [detectUsedPreprocess, setDetectUsedPreprocess] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DETECT_PREPROCESS_STORAGE_KEY);
      const map = raw ? JSON.parse(raw) : {};
      setDetectPreprocess({ ...DETECT_PREPROCESS_DEFAULTS, ...(map?.[projectId] || {}) });
    } catch {
      setDetectPreprocess({ ...DETECT_PREPROCESS_DEFAULTS });
    }
  }, [projectId]);

  function updateDetectPreprocess(patch) {
    setDetectPreprocess((prev) => {
      const next = { ...prev, ...patch };
      try {
        const raw = localStorage.getItem(DETECT_PREPROCESS_STORAGE_KEY);
        const map = raw ? JSON.parse(raw) : {};
        map[projectId] = next;
        localStorage.setItem(DETECT_PREPROCESS_STORAGE_KEY, JSON.stringify(map));
      } catch {
        // localStorage が使えない環境では保存なしで動作継続
      }
      return next;
    });
  }

  const detectPreprocessPayload = buildDetectPreprocessPayload(detectPreprocess);
  const detectPreprocessKey = JSON.stringify(detectPreprocessPayload);

  // 前処理後プレビュー（300msデバウンスで既存のresize-previewを利用）
  useEffect(() => {
    if (activeStep !== 2 || imagePreviewMode !== "preprocessed" || !file) {
      return undefined;
    }
    const payload = buildDetectPreprocessPayload(detectPreprocess);
    if (!payload) {
      setDetectPreviewUrl("");
      return undefined;
    }
    const timer = setTimeout(async () => {
      setDetectPreviewLoading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("resize_long_side", String(resizeLongSide));
        form.append("use_resize", String(useResize));
        form.append("resize_axis", String(resizeAxis));
        form.append("detect_preprocess_json", JSON.stringify(payload));
        const res = await fetch(
          `${import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000"}/image-builder/resize-preview`,
          { method: "POST", body: form }
        );
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        setDetectPreviewUrl(data.image_data_url || "");
      } catch {
        setDetectPreviewUrl("");
      } finally {
        setDetectPreviewLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, imagePreviewMode, file, resizeLongSide, useResize, resizeAxis, detectPreprocessKey]);
  const [resizeLoading, setResizeLoading] = useState(false);
  const [resizePreview, setResizePreview] = useState(null);

  const [yoloModels, setYoloModels] = useState({ items: [], local_models: [], builtin_models: [], local_dir: "" });
  const [modelSelection, setModelSelection] = useState(initialState.modelSelection);
  const [customModelPath, setCustomModelPath] = useState(initialState.customModelPath);
  const [confThreshold, setConfThreshold] = useState(initialState.confThreshold);
  const [mergeOverlaps, setMergeOverlaps] = useState(initialState.mergeOverlaps);
  const [mergeIouThreshold, setMergeIouThreshold] = useState(initialState.mergeIouThreshold);
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState(null);
  const [detections, setDetections] = useState([]);

  const [outputDir, setOutputDir] = useState(initialState.outputDir);
  const [cropHeight, setCropHeight] = useState(initialState.cropHeight);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [focusedBboxId, setFocusedBboxId] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editingBboxId, setEditingBboxId] = useState(null);
  const [bboxUndoStack, setBboxUndoStack] = useState([]);
  const [step3PaneHeight, setStep3PaneHeight] = useState(0);
  const [imageZoom, setImageZoom] = useState(1);
  const [copiedBboxes, setCopiedBboxes] = useState([]);
  const [seriesFilter, setSeriesFilter] = useState(SERIES_FILTER_ALL);

  function cloneDetections(rows) {
    return (rows || []).map((row) => ({ ...row }));
  }

  function pushUndoSnapshot(sourceRows) {
    const snapshot = cloneDetections(sourceRows);
    setBboxUndoStack((prev) => [...prev.slice(-29), snapshot]);
  }

  function undoDetections() {
    setBboxUndoStack((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const snapshot = prev[prev.length - 1];
      setDetections(cloneDetections(snapshot));
      return prev.slice(0, -1);
    });
  }

  useEffect(() => {
    try {
      const payload = {
        resizeLongSide,
        resizeAxis,
        useResize,
        modelSelection,
        customModelPath,
        confThreshold,
        mergeOverlaps,
        mergeIouThreshold,
        outputDir,
        cropHeight,
      };
      localStorage.setItem(IMAGE_BUILDER_STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore persistence failure.
    }
  }, [
    resizeLongSide,
    resizeAxis,
    useResize,
    modelSelection,
    customModelPath,
    confThreshold,
    mergeOverlaps,
    mergeIouThreshold,
    outputDir,
    cropHeight,
  ]);

  useEffect(() => {
    let ignore = false;
    async function loadYoloModels() {
      if (!projectId) return;
      try {
        const data = await request(`/image-builder/yolo-models?project_id=${encodeURIComponent(projectId)}`);
        if (ignore) return;
        setYoloModels(data);
        if (Array.isArray(data.items) && data.items.length > 0) {
          setModelSelection((prev) => {
            if (!prev) {
              return data.items[0];
            }
            if (prev === "__custom__") {
              return prev;
            }
            return data.items.includes(prev) ? prev : data.items[0];
          });
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
      if (rawPreviewUrl && rawPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(rawPreviewUrl);
      }
    };
  }, [rawPreviewUrl]);

  const selectedCount = useMemo(() => detections.filter((row) => row.selected).length, [detections]);
  const seriesCounts = useMemo(() => {
    const counts = new Map();
    detections.forEach((row) => {
      const key = String(row.label || "").trim() || "(unlabeled)";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [detections]);
  const seriesOptions = useMemo(() => Array.from(seriesCounts.keys()).sort((a, b) => a.localeCompare(b)), [seriesCounts]);
  const filteredDetections = useMemo(() => {
    if (seriesFilter === SERIES_FILTER_ALL) {
      return detections;
    }
    return detections.filter((row) => (String(row.label || "").trim() || "(unlabeled)") === seriesFilter);
  }, [detections, seriesFilter]);
  const currentImageDataUrl = detectResult?.image_data_url || resizePreview?.image_data_url || rawPreviewUrl || "";
  // Step2 で「前処理後」表示を選んだ場合は検出前処理プレビューを表示（未取得時は元画像）
  const displayImageDataUrl =
    activeStep === 2 && imagePreviewMode === "preprocessed" && detectPreviewUrl ? detectPreviewUrl : currentImageDataUrl;
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

  function eventToImagePoint(clientX, clientY) {
    const imgEl = imageRef.current;
    if (!imgEl || !currentImageSize) {
      return null;
    }
    const rect = imgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const x = ((clientX - rect.left) * currentImageSize[0]) / rect.width;
    const y = ((clientY - rect.top) * currentImageSize[1]) / rect.height;
    return {
      x: Math.max(0, Math.min(currentImageSize[0], x)),
      y: Math.max(0, Math.min(currentImageSize[1], y)),
    };
  }

  function clampBox(box) {
    const minSize = 6;
    const maxW = currentImageSize?.[0] || 1;
    const maxH = currentImageSize?.[1] || 1;
    let x1 = Math.max(0, Math.min(maxW, Number(box.x1)));
    let y1 = Math.max(0, Math.min(maxH, Number(box.y1)));
    let x2 = Math.max(0, Math.min(maxW, Number(box.x2)));
    let y2 = Math.max(0, Math.min(maxH, Number(box.y2)));
    if (x2 - x1 < minSize) {
      if (x1 + minSize <= maxW) {
        x2 = x1 + minSize;
      } else {
        x1 = Math.max(0, x2 - minSize);
      }
    }
    if (y2 - y1 < minSize) {
      if (y1 + minSize <= maxH) {
        y2 = y1 + minSize;
      } else {
        y1 = Math.max(0, y2 - minSize);
      }
    }
    return {
      ...box,
      x1,
      y1,
      x2,
      y2,
      width: Math.max(0, x2 - x1),
      height: Math.max(0, y2 - y1),
    };
  }

  function startBboxDrag(e, id, mode, handle = "") {
    if (!editMode) {
      return;
    }
    const point = eventToImagePoint(e.clientX, e.clientY);
    if (!point) {
      return;
    }
    const target = detections.find((row) => row.id === id);
    if (!target) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    pushUndoSnapshot(detections);
    dragStateRef.current = {
      id,
      mode,
      handle,
      startX: point.x,
      startY: point.y,
      original: { ...target },
    };
  }

  function deleteBbox(id) {
    pushUndoSnapshot(detections);
    setDetections((prev) => prev.filter((row) => row.id !== id));
    if (editingBboxId === id) {
      setEditingBboxId(null);
    }
    if (focusedBboxId === id) {
      setFocusedBboxId(null);
    }
  }

  function getCopySourceRows() {
    if (editingBboxId != null) {
      const target = detections.find((row) => row.id === editingBboxId);
      if (target) return [target];
    }
    if (focusedBboxId != null) {
      const target = detections.find((row) => row.id === focusedBboxId);
      if (target) return [target];
    }
    return detections.filter((row) => row.selected);
  }

  function copyBboxes() {
    const sourceRows = getCopySourceRows();
    if (sourceRows.length === 0) {
      setFail("コピー対象のROIがありません");
      return;
    }
    setCopiedBboxes(sourceRows.map((row) => ({ ...row })));
    setOk(`${sourceRows.length}件のROIをコピーしました`);
  }

  function pasteBboxes() {
    if (!currentImageSize) {
      setFail("貼り付け先の画像がありません");
      return;
    }
    if (copiedBboxes.length === 0) {
      setFail("貼り付けるROIがありません");
      return;
    }

    const currentMaxId = detections.reduce((m, row) => Math.max(m, Number(row.id) || 0), 0);
    const pastedRows = copiedBboxes.map((row, idx) => {
      const x1 = Number(row.x1) + COPY_PASTE_OFFSET;
      const y1 = Number(row.y1) + COPY_PASTE_OFFSET;
      const x2 = Number(row.x2) + COPY_PASTE_OFFSET;
      const y2 = Number(row.y2) + COPY_PASTE_OFFSET;
      return clampBox({
        ...row,
        id: currentMaxId + idx + 1,
        x1,
        y1,
        x2,
        y2,
        width: Math.max(0, x2 - x1),
        height: Math.max(0, y2 - y1),
        selected: true,
      });
    });

    pushUndoSnapshot(detections);
    setDetections((prev) => [...prev, ...pastedRows]);
    const firstId = pastedRows[0]?.id ?? null;
    if (firstId != null) {
      setEditingBboxId(firstId);
      focusBboxCard(firstId);
    }
    setOk(`${pastedRows.length}件のROIを貼り付けました`);
  }

  // 画像上クリック: UI選択のみ変更（有効/無効は変更しない）。additive=Ctrl/Cmd押下時は複数選択の追加/解除
  function handleBoxSelect(id, additive) {
    setSelectedUiIds((prev) => {
      const has = prev.includes(id);
      if (additive) {
        return has ? prev.filter((item) => item !== id) : [...prev, id];
      }
      return has && prev.length === 1 ? [] : [id];
    });
  }

  function scheduleBBoxClick(e, id) {
    const additive = Boolean(e?.ctrlKey || e?.metaKey);
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = setTimeout(() => {
      // ダブルクリック判定用に、クリック前の選択状態を記録しておく（復元用）
      lastImageClickToggleRef.current = { id, at: Date.now(), prevSelection: selectedUiIds };
      handleBoxSelect(id, additive);
      focusBboxCard(id);
      clickTimerRef.current = null;
    }, 220);
  }

  function handleBBoxDoubleClick(e, id) {
    e.preventDefault();
    e.stopPropagation();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    // ダブルクリックは編集開始のみ。1回目のクリックで選択状態が変わってしまっていた場合は元へ戻す
    const lastToggle = lastImageClickToggleRef.current;
    if (lastToggle.id === id && Array.isArray(lastToggle.prevSelection) && Date.now() - lastToggle.at < 700) {
      setSelectedUiIds(lastToggle.prevSelection);
      lastImageClickToggleRef.current = { id: null, at: 0, prevSelection: null };
    }
    setEditMode(true);
    setEditingBboxId(id);
    focusBboxCard(id);
  }

  function deleteSelectedBboxes() {
    const targetIds = new Set(selectedUiIds);
    const targets = detections.filter((row) => targetIds.has(row.id));
    if (targets.length === 0) {
      return;
    }
    const ok = window.confirm(
      `選択中のBBOX ${targets.length}件を削除しますか？\nこの操作は「元に戻す」で復元できます。`
    );
    if (!ok) {
      return;
    }
    pushUndoSnapshot(detections);
    setDetections((prev) => prev.filter((row) => !targetIds.has(row.id)));
    setSelectedUiIds([]);
    if (editingBboxId != null && targetIds.has(editingBboxId)) {
      setEditingBboxId(null);
    }
    if (focusedBboxId != null && targetIds.has(focusedBboxId)) {
      setFocusedBboxId(null);
    }
    setOk(`${targets.length}件のBBOXを削除しました`);
  }

  function handleCanvasDoubleClick(e) {
    if (activeStep !== 3 || !editMode || !currentImageSize) {
      return;
    }
    const point = eventToImagePoint(e.clientX, e.clientY);
    if (!point) {
      return;
    }
    // Added ROI should start as a horizontal box for OCR text strings.
    const defaultH = Math.max(20, currentImageSize[1] * 0.08);
    const defaultW = Math.max(defaultH * 2.8, currentImageSize[0] * 0.18, 56);
    const maxW = currentImageSize[0];
    const maxH = currentImageSize[1];
    let x1 = point.x - defaultW / 2;
    let y1 = point.y - defaultH / 2;
    let x2 = point.x + defaultW / 2;
    let y2 = point.y + defaultH / 2;
    if (x1 < 0) {
      x2 += -x1;
      x1 = 0;
    }
    if (y1 < 0) {
      y2 += -y1;
      y1 = 0;
    }
    if (x2 > maxW) {
      x1 -= x2 - maxW;
      x2 = maxW;
    }
    if (y2 > maxH) {
      y1 -= y2 - maxH;
      y2 = maxH;
    }
    const nextId = detections.reduce((m, row) => Math.max(m, Number(row.id) || 0), 0) + 1;
    const next = clampBox({
      id: nextId,
      x1,
      y1,
      x2,
      y2,
      width: x2 - x1,
      height: y2 - y1,
      confidence: 1.0,
      label: "manual",
      class_id: -1,
      selected: true,
    });
    pushUndoSnapshot(detections);
    setDetections((prev) => [...prev, next]);
    setEditingBboxId(nextId);
    focusBboxCard(nextId);
  }

  function focusBboxCard(id) {
    pendingFocusBboxIdRef.current = id;
    setFocusedBboxId(id);
    if (activeStep !== 3) {
      goStep(3);
      return;
    }
    requestAnimationFrame(() => {
      const target = bboxItemRefs.current.get(id);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      target.focus({ preventScroll: true });
      pendingFocusBboxIdRef.current = null;
    });
  }

  async function onFileChange(event) {
    const next = event.target.files?.[0];
    if (!next) return;
    const ext = (next.name || "").toLowerCase();
    const isHeic = HEIC_EXTENSIONS.some((suffix) => ext.endsWith(suffix));

    if (rawPreviewUrl && rawPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(rawPreviewUrl);
    }

    setFile(next);
    setFileName(next.name);
    setRawPreviewUrl("");
    setResizePreview(null);
    setDetectResult(null);
    setDetections([]);
    setSeriesFilter(SERIES_FILTER_ALL);
    setBboxUndoStack([]);
    setEditingBboxId(null);
    setFocusedBboxId(null);
    setImageZoom(1);
    setExportResult(null);
    goStep(1);
    setMessage("");
    setError("");
    setOriginalSize(null);

    if (isHeic) {
      try {
        const form = new FormData();
        form.append("file", next);
        form.append("resize_long_side", String(resizeLongSide));
        form.append("use_resize", "false");
        form.append("resize_axis", String(resizeAxis));
        const res = await fetch(`${import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000"}/image-builder/resize-preview`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          throw new Error((await res.text()) || "HEIC画像のプレビュー生成に失敗しました");
        }
        const data = await res.json();
        setRawPreviewUrl(data.image_data_url || "");
        setOriginalSize(Array.isArray(data.original_size) ? data.original_size : null);
        setOk("HEIC画像を読み込みました");
      } catch (e) {
        setFail(e.message || "HEIC画像の読み込みに失敗しました");
      }
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(next);
    setRawPreviewUrl(nextPreviewUrl);

    const img = new window.Image();
    img.onload = () => {
      setOriginalSize([img.naturalWidth || img.width, img.naturalHeight || img.height]);
    };
    img.onerror = () => {
      setOriginalSize(null);
    };
    img.src = nextPreviewUrl;
  }

  function handleImageWheel(e) {
    if (!e.ctrlKey) {
      return;
    }
    const viewport = imageViewportRef.current;
    const imgEl = imageRef.current;
    if (!viewport || !imgEl) {
      return;
    }
    // カーソルが表示中の画像（BBoxオーバーレイ含む領域）の上にある場合のみズームする
    const imgRect = imgEl.getBoundingClientRect();
    const overImage =
      e.clientX >= imgRect.left && e.clientX <= imgRect.right && e.clientY >= imgRect.top && e.clientY <= imgRect.bottom;
    if (!overImage) {
      return;
    }
    // ネイティブリスナー(passive: false)経由なので preventDefault が効き、ブラウザ全体のズームを抑止できる
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const contentX = viewport.scrollLeft + pointerX;
    const contentY = viewport.scrollTop + pointerY;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;

    setImageZoom((prev) => {
      const next = Math.max(IMAGE_ZOOM_MIN, Math.min(IMAGE_ZOOM_MAX, prev * factor));
      const ratio = next / prev;
      requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, contentX * ratio - pointerX);
        viewport.scrollTop = Math.max(0, contentY * ratio - pointerY);
      });
      return next;
    });
  }

  const handleImageWheelRef = useRef(handleImageWheel);
  handleImageWheelRef.current = handleImageWheel;

  // React の onWheel は passive のため preventDefault が効かずブラウザズームが発動してしまう。
  // Step3 の間だけネイティブ wheel リスナー(passive: false)を viewport に登録する
  useEffect(() => {
    if (activeStep !== 3) {
      return undefined;
    }
    const viewport = imageViewportRef.current;
    if (!viewport) {
      return undefined;
    }
    const listener = (event) => handleImageWheelRef.current(event);
    viewport.addEventListener("wheel", listener, { passive: false });
    return () => viewport.removeEventListener("wheel", listener);
  }, [activeStep]);

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
      form.append("resize_axis", String(resizeAxis));
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
      setSeriesFilter(SERIES_FILTER_ALL);
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
      form.append("resize_axis", String(resizeAxis));
      form.append("model", modelName);
      form.append("conf_threshold", String(confThreshold));
      form.append("merge_overlaps", String(mergeOverlaps));
      form.append("merge_iou_threshold", String(mergeIouThreshold));
      form.append("project_id", projectId);
      // 検出前処理が有効な場合のみ適用（無変換設定なら従来どおり元画像で検出）
      if (detectPreprocessPayload) {
        form.append("detect_preprocess_json", JSON.stringify(detectPreprocessPayload));
      }
      const res = await fetch(`${import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000"}/image-builder/detect`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error((await res.text()) || "YOLO検出に失敗しました");
      }
      const data = await res.json();
      setDetectResult(data);
      // クロップ出力時に同じ前処理を適用するため、検出時点の設定を保持
      setDetectUsedPreprocess(detectPreprocessPayload);
      setDetections((data.detections || []).map((row) => ({ ...row, selected: row.selected !== false })));
      setSeriesFilter(SERIES_FILTER_ALL);
      setBboxUndoStack([]);
      setEditingBboxId(null);
      setFocusedBboxId(null);
      setExportResult(null);
      setOk(`検出完了: ${data.count}件`);
    } catch (e) {
      setFail(e.message);
    } finally {
      setDetecting(false);
    }
  }

  // 有効/無効（保存対象）の切替。一覧右端のチェックボックスからのみ呼び出す
  function handleBoxEnabledChange(id) {
    setDetections((prev) => prev.map((row) => (row.id === id ? { ...row, selected: !row.selected } : row)));
  }

  // BBOX削除・再検出などで存在しなくなった id をUI選択から取り除く
  useEffect(() => {
    setSelectedUiIds((prev) => {
      const alive = prev.filter((id) => detections.some((row) => row.id === id));
      return alive.length === prev.length ? prev : alive;
    });
  }, [detections]);

  useEffect(() => {
    if (activeStep !== 3) {
      return;
    }
    const pendingId = pendingFocusBboxIdRef.current;
    if (!pendingId) {
      return;
    }
    const target = bboxItemRefs.current.get(pendingId);
    if (!target) {
      return;
    }
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      target.focus({ preventScroll: true });
      pendingFocusBboxIdRef.current = null;
    });
  }, [activeStep, detections]);

  useEffect(() => {
    function onMouseMove(ev) {
      const drag = dragStateRef.current;
      if (!drag) {
        return;
      }
      const point = eventToImagePoint(ev.clientX, ev.clientY);
      if (!point) {
        return;
      }
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      setDetections((prev) =>
        prev.map((row) => {
          if (row.id !== drag.id) {
            return row;
          }
          const original = drag.original;
          if (drag.mode === "move") {
            const w = Number(original.width || original.x2 - original.x1);
            const h = Number(original.height || original.y2 - original.y1);
            let x1 = Number(original.x1) + dx;
            let y1 = Number(original.y1) + dy;
            let x2 = x1 + w;
            let y2 = y1 + h;
            if (x1 < 0) {
              x2 += -x1;
              x1 = 0;
            }
            if (y1 < 0) {
              y2 += -y1;
              y1 = 0;
            }
            if (x2 > (currentImageSize?.[0] || 1)) {
              x1 -= x2 - (currentImageSize?.[0] || 1);
              x2 = currentImageSize?.[0] || 1;
            }
            if (y2 > (currentImageSize?.[1] || 1)) {
              y1 -= y2 - (currentImageSize?.[1] || 1);
              y2 = currentImageSize?.[1] || 1;
            }
            return clampBox({ ...row, x1, y1, x2, y2 });
          }
          let x1 = Number(original.x1);
          let y1 = Number(original.y1);
          let x2 = Number(original.x2);
          let y2 = Number(original.y2);
          if (drag.handle.includes("w")) x1 += dx;
          if (drag.handle.includes("e")) x2 += dx;
          if (drag.handle.includes("n")) y1 += dy;
          if (drag.handle.includes("s")) y2 += dy;
          return clampBox({ ...row, x1, y1, x2, y2 });
        })
      );
    }

    function onMouseUp() {
      dragStateRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [currentImageSize]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      dragStateRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeStep !== 3) {
      setStep3PaneHeight(0);
      return;
    }

    const target = imageViewportRef.current;
    if (!target) {
      return;
    }

    const updateHeight = () => {
      const next = Math.round(target.getBoundingClientRect().height);
      if (next > 0) {
        setStep3PaneHeight(next);
      }
    };

    updateHeight();

    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => updateHeight());
      observer.observe(target);
    } else {
      window.addEventListener("resize", updateHeight);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener("resize", updateHeight);
      }
    };
  }, [activeStep]);

  useEffect(() => {
    if (activeStep !== 3) {
      return;
    }

    function onKeyDown(ev) {
      const target = ev.target;
      if (
        target &&
        typeof target.tagName === "string" &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName.toUpperCase())
      ) {
        return;
      }
      if (target && target.isContentEditable) {
        return;
      }

      const key = String(ev.key || "").toLowerCase();
      const withModifier = !!(ev.ctrlKey || ev.metaKey);

      if (withModifier && key === "c") {
        ev.preventDefault();
        copyBboxes();
        return;
      }
      if (withModifier && key === "v") {
        ev.preventDefault();
        pasteBboxes();
        return;
      }

      if (key !== "delete" && key !== "backspace") {
        return;
      }

      const candidateId =
        editingBboxId != null
          ? editingBboxId
          : focusedBboxId != null
            ? focusedBboxId
            : null;
      if (candidateId != null && detections.some((row) => row.id === candidateId)) {
        ev.preventDefault();
        deleteBbox(candidateId);
        return;
      }
      // 編集中・フォーカス中が無い場合は選択中BBOXを一括削除（確認・Undoは上部ボタンと同一挙動）
      if (selectedUiIds.length > 0) {
        ev.preventDefault();
        deleteSelectedBboxes();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeStep, detections, selectedUiIds, editingBboxId, focusedBboxId, copiedBboxes, currentImageSize]);

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
      form.append("resize_axis", String(resizeAxis));
      form.append("boxes_json", JSON.stringify(selectedBoxes));
      form.append("output_dir", outputDir.trim());
      form.append("crop_height", String(cropHeight));
      // 検出時に使用した前処理と同一設定でBBOX座標系を一致させる
      if (detectUsedPreprocess) {
        form.append("detect_preprocess_json", JSON.stringify(detectUsedPreprocess));
      }
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
  const displaySize = currentImageSize || originalSize;
  const displaySizeLabel = displaySize ? `${displaySize[0]} x ${displaySize[1]}` : "--";
  const originalSizeLabel = originalSize ? `${originalSize[0]} x ${originalSize[1]}` : "--";
  const resizedSize = detectResult?.resized_size || resizePreview?.resized_size || (!useResize ? originalSize : null);
  const resizedSizeLabel = resizedSize ? `${resizedSize[0]} x ${resizedSize[1]}` : "--";
  const imageSubtitle = fileName
    ? `${fileName}  |  元: ${originalSizeLabel}  /  リサイズ後: ${resizedSizeLabel}`
    : "画像未選択";
  const isStep3Active = activeStep === 3;
  const rightPaneClass = isStep3Active ? "flex min-h-0 flex-col gap-3 overflow-hidden" : "space-y-3";
  const rightPaneContentClass = isStep3Active
    ? "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
    : "space-y-3";
  const rightPaneStyle = isStep3Active && step3PaneHeight > 0 ? { height: `${step3PaneHeight}px` } : undefined;
  const imageRenderWidth =
    isStep3Active && currentImageSize
      ? `${Math.max(1, Math.round(Number(currentImageSize[0]) * imageZoom))}px`
      : undefined;

  useEffect(() => {
    if (seriesFilter === SERIES_FILTER_ALL) {
      return;
    }
    if (!seriesOptions.includes(seriesFilter)) {
      setSeriesFilter(SERIES_FILTER_ALL);
    }
  }, [seriesFilter, seriesOptions]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_560px] gap-4">
      <div>
        <Card
          title="作業画像"
          subtitle={imageSubtitle}
          actions={
            <div className="flex items-center gap-2">
              {activeStep === 2 ? (
                <div className="inline-flex rounded-lg border border-border bg-card/45 p-0.5">
                  <Button
                    size="sm"
                    variant={imagePreviewMode === "original" ? "primary" : "ghost"}
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setImagePreviewMode("original")}
                  >
                    元画像
                  </Button>
                  <Button
                    size="sm"
                    variant={imagePreviewMode === "preprocessed" ? "primary" : "ghost"}
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setImagePreviewMode("preprocessed")}
                    title={detectPreprocessPayload ? "検出前処理を適用した画像を表示します" : "検出前処理がすべて無効のため元画像と同じです"}
                  >
                    前処理後{detectPreviewLoading ? "…" : ""}
                  </Button>
                </div>
              ) : null}
              <div className="rounded-md border border-border bg-card/55 px-2 py-1 text-xs text-slate-200">
                サイズ: {displaySizeLabel}
              </div>
            </div>
          }
        >
          <div
            ref={imageViewportRef}
            className="max-h-[78vh] overflow-auto rounded-xl border border-border bg-card/55 p-3"
          >
            {displayImageDataUrl ? (
              <div
                className={isStep3Active ? "relative w-max" : "relative mx-auto w-full max-w-[980px]"}
                style={isStep3Active ? { width: imageRenderWidth } : undefined}
                onDoubleClick={handleCanvasDoubleClick}
              >
                <img
                  ref={imageRef}
                  src={displayImageDataUrl}
                  alt="preview"
                  className={isStep3Active ? "block h-auto rounded-md" : "block h-auto w-full rounded-md"}
                  style={isStep3Active ? { width: "100%", maxWidth: "none" } : undefined}
                  draggable={false}
                />
                {detections.map((row) => {
                  const left = (Number(row.x1) / imageWidth) * 100;
                  const top = (Number(row.y1) / imageHeight) * 100;
                  const width = (Number(row.width) / imageWidth) * 100;
                  const height = (Number(row.height) / imageHeight) * 100;
                  const active = row.selected;
                  const isUiSelected = selectedUiIds.includes(row.id);
                  const isEditing = editMode && editingBboxId === row.id;
                  return (
                    <div
                      key={row.id}
                      onClick={(e) => {
                        if (isStep3Active) {
                          scheduleBBoxClick(e, row.id);
                        }
                      }}
                      onDoubleClick={(e) => {
                        if (isStep3Active) {
                          handleBBoxDoubleClick(e, row.id);
                        }
                      }}
                      onMouseDown={(e) => {
                        if (isStep3Active) {
                          startBboxDrag(e, row.id, "move");
                        }
                      }}
                      className={`absolute rounded-sm border-2 text-left ${
                        isEditing
                          ? "border-amber-300"
                          : active
                            ? "border-emerald-300"
                            : "border-slate-300/55"
                      } ${isUiSelected && !isEditing ? "ring-2 ring-accent/80" : ""}`}
                      style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                      title={`#${row.id} conf=${formatConfidence(row.confidence)}`}
                    >
                      {isEditing ? (
                        <>
                          {[
                            ["nw", "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
                            ["ne", "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
                            ["sw", "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
                            ["se", "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
                          ].map(([handle, cls]) => (
                            <span
                              key={handle}
                              className={`absolute h-3 w-3 rounded-full border border-white/70 bg-accent/60 shadow-sm ${cls}`}
                              onMouseDown={(e) => {
                                if (isStep3Active) {
                                  startBboxDrag(e, row.id, "resize", handle);
                                }
                              }}
                            />
                          ))}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-20 text-center text-sm text-muted">右側ステップ1で画像を選択してください</div>
            )}
            {isStep3Active ? (
              <p className="mt-2 text-xs text-muted">Ctrl + スクロール: 拡大/縮小（{Math.round(imageZoom * 100)}%）</p>
            ) : null}
          </div>
        </Card>
      </div>

      <div className={rightPaneClass} style={rightPaneStyle}>
        <div className="grid grid-cols-4 gap-2 rounded-xl border border-border bg-card/45 p-2">
          {stepProgress.map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => goStep(step.id)}
              className={`rounded-lg border px-2 py-1 text-center text-xs font-semibold ${
                activeStep === step.id
                  ? "border-accent bg-accent/20 text-blue-100"
                  : step.done
                    ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                    : "border-border bg-card/60 text-muted hover:text-text"
              }`}
            >
              <div>Step {step.id}</div>
              <div>{step.label}</div>
            </button>
          ))}
        </div>

        <div className={rightPaneContentClass}>
          {activeStep === 1 ? (
            <Card title="1. 画像指定とリサイズ" subtitle={step1Done ? "完了" : "長手を指定サイズに合わせる"}>
              <div className="space-y-3">
                <input
                  type="file"
                  accept="image/*,.heic,.HEIC,.heif,.HEIF"
                  onChange={onFileChange}
                  className="app-input h-auto py-2"
                />
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
                  <label className="app-label">リサイズ基準</label>
                  <div className="flex items-center gap-4 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
                    <label className="inline-flex items-center gap-2 text-sm text-text">
                      <input
                        type="radio"
                        name="resize-axis"
                        value="width"
                        checked={resizeAxis === "width"}
                        onChange={(e) => setResizeAxis(e.target.value)}
                        disabled={!useResize}
                      />
                      幅
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-text">
                      <input
                        type="radio"
                        name="resize-axis"
                        value="height"
                        checked={resizeAxis === "height"}
                        onChange={(e) => setResizeAxis(e.target.value)}
                        disabled={!useResize}
                      />
                      高さ
                    </label>
                  </div>
                </div>
                <div>
                  <label className="app-label">基準サイズ</label>
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
                  <Button onClick={() => goStep(2)} disabled={!file}>
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
                <details className="group rounded-lg border border-border bg-card/45">
                  <summary className="flex cursor-pointer select-none items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
                    <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden="true">
                      ▶
                    </span>
                    検出前処理
                    <span className={`ml-auto text-[10px] font-normal ${detectPreprocessPayload ? "text-emerald-300" : "text-muted"}`}>
                      {detectPreprocessPayload ? "適用中" : "無効（元画像のまま）"}
                    </span>
                  </summary>
                  <div className="space-y-2.5 px-2.5 pb-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="app-label">回転</label>
                        <select
                          className="app-select"
                          value={detectPreprocess.rotation}
                          onChange={(e) => updateDetectPreprocess({ rotation: Number(e.target.value) })}
                        >
                          <option value={0}>0°</option>
                          <option value={90}>90°</option>
                          <option value={180}>180°</option>
                          <option value={270}>270°</option>
                        </select>
                      </div>
                      <div>
                        <label className="app-label">トリミング単位</label>
                        <select
                          className="app-select"
                          value={detectPreprocess.crop_unit}
                          onChange={(e) => updateDetectPreprocess({ crop_unit: e.target.value })}
                        >
                          <option value="px">ピクセル</option>
                          <option value="percent">割合（%）</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="app-label">トリミング（上 / 下 / 左 / 右）</label>
                      <div className="grid grid-cols-4 gap-2">
                        {["crop_top", "crop_bottom", "crop_left", "crop_right"].map((key, idx) => (
                          <input
                            key={key}
                            type="number"
                            min={0}
                            className="app-input"
                            value={detectPreprocess[key]}
                            onChange={(e) => updateDetectPreprocess({ [key]: e.target.value })}
                            title={["上", "下", "左", "右"][idx]}
                            placeholder={["上", "下", "左", "右"][idx]}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="app-label">明るさ: {Number(detectPreprocess.brightness).toFixed(2)}</label>
                      <input
                        type="range"
                        min={0.2}
                        max={2.0}
                        step={0.05}
                        value={detectPreprocess.brightness}
                        onChange={(e) => updateDetectPreprocess({ brightness: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="app-label">コントラスト: {Number(detectPreprocess.contrast).toFixed(2)}</label>
                      <input
                        type="range"
                        min={0.2}
                        max={2.0}
                        step={0.05}
                        value={detectPreprocess.contrast}
                        onChange={(e) => updateDetectPreprocess({ contrast: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="inline-flex items-center gap-2 text-sm text-text">
                        <input
                          type="checkbox"
                          checked={detectPreprocess.sharpen}
                          onChange={(e) => updateDetectPreprocess({ sharpen: e.target.checked })}
                        />
                        シャープ化
                      </label>
                      <label className="app-label mt-1">
                        強度: {Number(detectPreprocess.sharpen_strength).toFixed(1)}
                      </label>
                      <input
                        type="range"
                        min={0.1}
                        max={3.0}
                        step={0.1}
                        value={detectPreprocess.sharpen_strength}
                        onChange={(e) => updateDetectPreprocess({ sharpen_strength: Number(e.target.value) })}
                        className="w-full"
                        disabled={!detectPreprocess.sharpen}
                      />
                    </div>
                    <div>
                      <label className="app-label">リサイズ（幅 / 高さ・空欄で未指定）</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          min={1}
                          className="app-input"
                          value={detectPreprocess.resize_width}
                          onChange={(e) => updateDetectPreprocess({ resize_width: e.target.value })}
                          placeholder="幅(px)"
                        />
                        <input
                          type="number"
                          min={1}
                          className="app-input"
                          value={detectPreprocess.resize_height}
                          onChange={(e) => updateDetectPreprocess({ resize_height: e.target.value })}
                          placeholder="高さ(px)"
                        />
                      </div>
                      <label className="mt-1 inline-flex items-center gap-2 text-sm text-text">
                        <input
                          type="checkbox"
                          checked={detectPreprocess.keep_aspect_ratio}
                          onChange={(e) => updateDetectPreprocess({ keep_aspect_ratio: e.target.checked })}
                        />
                        アスペクト比を維持
                      </label>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={detectPreprocess.grayscale}
                        onChange={(e) => updateDetectPreprocess({ grayscale: e.target.checked })}
                      />
                      グレースケール
                    </label>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() => updateDetectPreprocess({ ...DETECT_PREPROCESS_DEFAULTS })}
                    >
                      検出前処理をリセット
                    </Button>
                  </div>
                </details>

                <details open className="group rounded-lg border border-border bg-card/45">
                  <summary className="flex cursor-pointer select-none items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
                    <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden="true">
                      ▶
                    </span>
                    YOLO設定
                  </summary>
                  <div className="space-y-3 px-2.5 pb-2.5">
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
                <label className="inline-flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={mergeOverlaps}
                    onChange={(e) => setMergeOverlaps(e.target.checked)}
                  />
                  重なりBBoxを統合する
                </label>
                <div>
                  <label className="app-label">統合IoU閾値: {mergeIouThreshold.toFixed(2)}</label>
                  <input
                    type="range"
                    min={0.1}
                    max={0.95}
                    step={0.01}
                    value={mergeIouThreshold}
                    onChange={(e) => setMergeIouThreshold(Number(e.target.value))}
                    className="w-full"
                    disabled={!mergeOverlaps}
                  />
                </div>
                  </div>
                </details>

                <div className="flex gap-2">
                  <Button onClick={runDetect} disabled={!file || detecting}>
                    {detecting ? "検出中..." : "検出実行"}
                  </Button>
                  <Button onClick={() => goStep(3)} disabled={!step2Done}>
                    次へ
                  </Button>
                </div>
                {detectResult ? (
                  <p className="text-xs text-muted">
                    検出件数: {detectResult.count}
                    {typeof detectResult.raw_count === "number" && typeof detectResult.merged_count === "number"
                      ? ` (統合前 ${detectResult.raw_count} → 統合後 ${detectResult.merged_count})`
                      : ""}
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {activeStep === 3 ? (
            <Card
              title="3. Bounding Box選択"
              subtitle={step3Done ? "完了" : "保存対象をチェック"}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="whitespace-nowrap px-2"
                  variant={editMode ? "primary" : "secondary"}
                  onClick={() => {
                    setEditMode((prev) => !prev);
                    if (editMode) {
                      setEditingBboxId(null);
                    }
                  }}
                >
                  {editMode ? "編集モード: ON" : "編集モード: OFF"}
                </Button>
                <Button
                  size="sm"
                  className="whitespace-nowrap px-2"
                  variant="secondary"
                  onClick={undoDetections}
                  disabled={bboxUndoStack.length === 0}
                >
                  元に戻す
                </Button>
                <Button
                  size="sm"
                  className="whitespace-nowrap px-2"
                  variant="secondary"
                  onClick={copyBboxes}
                  disabled={detections.length === 0}
                >
                  コピー
                </Button>
                <Button
                  size="sm"
                  className="whitespace-nowrap px-2"
                  variant="secondary"
                  onClick={pasteBboxes}
                  disabled={copiedBboxes.length === 0}
                >
                  貼り付け
                </Button>
                <Button
                  size="sm"
                  className="whitespace-nowrap px-2"
                  variant="secondary"
                  onClick={() => setSelectedUiIds(detections.map((row) => row.id))}
                  disabled={detections.length === 0}
                >
                  すべて選択
                </Button>
                <Button
                  size="sm"
                  className="whitespace-nowrap px-2"
                  variant="secondary"
                  onClick={() => setSelectedUiIds([])}
                  disabled={selectedUiIds.length === 0}
                >
                  選択解除
                </Button>
                <Button
                  size="sm"
                  className="whitespace-nowrap px-2"
                  variant="danger"
                  onClick={deleteSelectedBboxes}
                  disabled={selectedUiIds.length === 0}
                  title="選択中のBBOXをまとめて削除します（元に戻すで復元可能）"
                >
                  選択中を削除
                </Button>
                <span className="text-xs text-muted">
                  選択: {selectedUiIds.length} / 有効: {selectedCount} / 総数: {detections.length}
                </span>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <label className="text-xs text-muted">Series Filter</label>
                <select
                  className="app-select h-8 max-w-[260px] py-0 text-xs"
                  value={seriesFilter}
                  onChange={(e) => setSeriesFilter(e.target.value)}
                >
                  <option value={SERIES_FILTER_ALL}>All ({detections.length})</option>
                  {seriesOptions.map((name) => (
                    <option key={name} value={name}>
                      {name} ({seriesCounts.get(name) || 0})
                    </option>
                  ))}
                </select>
              </div>
              <p className="mb-2 text-xs text-muted">
                画像上のクリックは選択のみ（有効／無効は変わりません）。有効／無効は一覧右端のチェックボックスでのみ切り替えます。
              </p>
              <div className="min-h-0 flex-1 space-y-1 overflow-auto rounded-lg border border-border bg-card/45 p-2">
                {filteredDetections.length === 0 ? (
                  <p className="text-xs text-muted">検出結果がありません</p>
                ) : (
                  filteredDetections.map((row) => (
                    <div
                      key={row.id}
                      ref={(el) => {
                        if (el) {
                          bboxItemRefs.current.set(row.id, el);
                        } else {
                          bboxItemRefs.current.delete(row.id);
                        }
                      }}
                      tabIndex={-1}
                      className={`flex items-center justify-between rounded-md border px-2 py-1 text-xs ${
                        focusedBboxId === row.id
                          ? "border-accent/80 ring-2 ring-accent/60"
                          : row.selected
                            ? "border-emerald-400/60 text-emerald-200"
                            : "border-red-400/60 text-red-200"
                      } ${selectedUiIds.includes(row.id) ? "bg-accent/10" : ""}`}
                    >
                      <span className="truncate">
                        #{row.id} {row.label}
                      </span>
                      <span className="ml-2">{formatConfidence(row.confidence)}</span>
                      <div className="ml-2 flex items-center gap-1">
                        <button
                          type="button"
                          className="rounded border border-border px-1 text-[10px] text-slate-200"
                          onClick={() => {
                            setEditMode(true);
                            setEditingBboxId(row.id);
                            focusBboxCard(row.id);
                          }}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="rounded border border-danger/50 px-1 text-[10px] text-danger"
                          onClick={() => deleteBbox(row.id)}
                        >
                          削除
                        </button>
                        <input
                          type="checkbox"
                          checked={!!row.selected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => handleBoxEnabledChange(row.id)}
                          aria-label={row.selected ? `#${row.id} このBBOXを無効にする` : `#${row.id} このBBOXを有効にする`}
                          title={row.selected ? "このBBOXを無効にする" : "このBBOXを有効にする"}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-3 rounded-lg border border-border bg-card/45 px-3 py-2 text-xs text-muted">
                <p className="mb-1 font-semibold text-slate-200">操作方法</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>クリック: BBOXの選択／選択解除</li>
                  <li>Ctrl/Cmd + クリック: 複数選択</li>
                  <li>ダブルクリック: 編集開始（有効状態は変わりません）</li>
                  <li>編集モードONで画像の空白部分をダブルクリック: 新規BBOX追加</li>
                  <li>ドラッグ: BBOXを移動</li>
                  <li>四隅ハンドル: サイズ変更</li>
                  <li>Ctrl/Cmd + C: コピー / Ctrl/Cmd + V: 貼り付け</li>
                  <li>Delete: 編集中・フォーカス中のBBOXを削除（無ければ選択中を確認のうえ一括削除）</li>
                  <li>有効／無効: 一覧右端のチェックボックスでのみ切替</li>
                </ul>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" className="whitespace-nowrap px-2" onClick={() => goStep(4)} disabled={!step3Done}>
                    次へ
                  </Button>
                  <Button size="sm" className="whitespace-nowrap px-2" variant="secondary" onClick={() => goStep(2)}>
                    戻る
                  </Button>
                </div>
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
                <div className="flex items-center justify-between gap-2">
                  <Button onClick={exportCrops} disabled={exporting || selectedCount === 0}>
                    {exporting ? "出力中..." : "選択Bounding Boxを出力"}
                  </Button>
                  <Button variant="secondary" onClick={() => goStep(3)}>
                    前へ
                  </Button>
                </div>
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
