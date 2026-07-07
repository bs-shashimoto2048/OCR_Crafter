import { useEffect, useMemo, useRef, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import EditableHeatmap from "../components/EditableHeatmap";
import { API_BASE, imageUrl, request } from "../lib/api";

const BUSINESS_PATTERN = /^[A-Z0-9]{8}$/;
const FORBIDDEN = new Set(["AAAAAAAA", "00000000"]);
const STATUS_LABELS = {
  all: "全て",
  unprocessed: "未処理",
  confirmed: "確定",
  pending: "保留",
};
const STATUS_FILTERS = ["all", "unprocessed", "confirmed", "pending"];

function validateText(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return { valid: false, reason: "empty_text" };
  if (!BUSINESS_PATTERN.test(normalized)) return { valid: false, reason: "pattern_mismatch" };
  if (FORBIDDEN.has(normalized)) return { valid: false, reason: "banned_pattern" };
  return { valid: true, reason: null };
}

function classifyDraftState(value, expectedLength = 8) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return { kind: "invalid", reason: "empty_text" };
  if (FORBIDDEN.has(normalized)) return { kind: "invalid", reason: "banned_pattern" };
  if (!/^[A-Z0-9]+$/.test(normalized)) return { kind: "invalid", reason: "invalid_character" };
  if (Number(expectedLength) > 0 && normalized.length !== Number(expectedLength)) {
    return { kind: "incomplete", reason: "length_mismatch" };
  }
  return { kind: "valid", reason: null };
}

function parseApiErrorText(text, fallback = "推論に失敗しました") {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  try {
    const payload = JSON.parse(raw);
    const detail = payload?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) return detail.map((v) => String(v)).join(", ");
  } catch {
    // ignore non-json response
  }
  return raw;
}

function normalizePredictError(message) {
  const text = String(message || "");
  if (text.includes("No model found for type") || text.includes("model not found")) {
    return "カスタムモデルが見つかりません。先にモデル学習を行うか、エンジンをPaddleOCR/EasyOCRに切り替えてください。";
  }
  if (text.includes("invalid preprocess_overrides_json")) {
    return "前処理設定の送信形式が不正です。前処理設定を開き直して再実行してください。";
  }
  if (text.includes("unsupported image format")) {
    return "サポート外の画像形式です。png/jpg/webp などで再実行してください。";
  }
  return text || "推論に失敗しました";
}

function toHalfWidthAlnum(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function resolveSingleStatus({
  currentResult,
  currentDraftState,
  currentLowConfidence,
  isDraftAligned,
}) {
  if (!currentResult) {
    return { kind: "waiting", label: "判定待ち" };
  }

  if (!isDraftAligned) {
    if (currentDraftState.kind === "invalid") return { kind: "invalid", label: "invalid" };
    if (currentDraftState.kind === "incomplete") return { kind: "incomplete", label: "要補完" };
    return { kind: "editing", label: "編集中" };
  }

  const valid = typeof currentResult?.valid === "boolean" ? currentResult.valid : true;
  if (!valid) {
    const reason = String(currentResult?.validation?.reason || "");
    if (reason === "invalid_length" || reason === "pattern_mismatch") {
      return { kind: "incomplete", label: "要補完" };
    }
    if (reason === "low_confidence" || currentLowConfidence) {
      return { kind: "low", label: "低信頼" };
    }
    return { kind: "invalid", label: "invalid" };
  }

  if (currentLowConfidence) {
    return { kind: "low", label: "低信頼" };
  }
  return { kind: "valid", label: "valid" };
}

export default function RapidOCRView({
  projectId,
  imageVersion,
  images,
  selectedImageName,
  onSelectImageName,
  engine,
  setEngine,
  modelType,
  setModelType,
  modelTypes,
  model,
  setModel,
  models,
  paddleModel,
  setPaddleModel,
  paddleModels,
  tesseractModel,
  setTesseractModel,
  tesseractModels,
  easyocrLangs,
  setEasyocrLangs,
  easyocrLanguageOptions,
  preprocessEnabled,
  setPreprocessEnabled,
  preprocessOverrides,
}) {
  const [cache, setCache] = useState({});
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingSet, setPendingSet] = useState(() => new Set());
  const [notice, setNotice] = useState("");
  const [confirmedDrafts, setConfirmedDrafts] = useState({});
  const [statusFilter, setStatusFilter] = useState("unprocessed");
  const [langPanelOpen, setLangPanelOpen] = useState(false);
  const [heatmapFocusTick, setHeatmapFocusTick] = useState(0);

  const inputRef = useRef(null);
  const listRef = useRef(null);
  const itemRefs = useRef({});
  const pendingPredictRef = useRef({});
  const prevStatusFilterRef = useRef("unprocessed");
  const focusHeatmapFirstRef = useRef(false);
  const preprocessOverridesKey = useMemo(
    () => JSON.stringify(preprocessOverrides || {}),
    [preprocessOverrides]
  );

  const selectedIndex = useMemo(() => {
    if (!Array.isArray(images) || images.length === 0) return 0;
    const idx = images.findIndex((item) => item.image === selectedImageName);
    return idx >= 0 ? idx : 0;
  }, [images, selectedImageName]);
  const current = images[selectedIndex] || null;
  const currentName = current?.image || "";
  const currentCacheKey = currentName
    ? `${projectId}::${currentName}::${engine}::${model}::${modelType}::${paddleModel}::${(easyocrLangs || []).join(",")}::pp:${
        preprocessEnabled ? "1" : "0"
      }::ov:${preprocessOverridesKey}`
    : "";
  const currentResult = currentCacheKey ? cache[currentCacheKey] : null;
  const currentResultText = String(currentResult?.text ?? currentResult?.prediction ?? "");
  const currentHeatScores = Array.isArray(currentResult?.char_confidence_normalized)
    ? currentResult?.char_confidence_normalized
    : currentResult?.char_scores;
  const expectedLength = Number(currentResult?.validation?.max_text_length || currentResult?.max_text_length || currentResultText.length || 8);

  const currentDraftState = useMemo(
    () => classifyDraftState(draft, expectedLength),
    [draft, expectedLength]
  );
  const selectedLangLabel = useMemo(() => {
    const langs = Array.isArray(easyocrLangs) ? easyocrLangs.filter(Boolean) : [];
    return langs.length > 0 ? langs.join(", ") : "-";
  }, [easyocrLangs]);
  const imageStatusMap = useMemo(() => {
    const next = {};
    for (const item of images) {
      const imageName = String(item?.image || "");
      if (!imageName) continue;
      if (pendingSet.has(imageName)) {
        next[imageName] = "pending";
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(confirmedDrafts, imageName)) {
        next[imageName] = "confirmed";
        continue;
      }
      next[imageName] = "unprocessed";
    }
    return next;
  }, [images, pendingSet, confirmedDrafts]);
  const progressStats = useMemo(() => {
    const total = images.length;
    let confirmed = 0;
    let pending = 0;
    let unprocessed = 0;
    for (const item of images) {
      const status = imageStatusMap[item.image] || "unprocessed";
      if (status === "confirmed") confirmed += 1;
      else if (status === "pending") pending += 1;
      else unprocessed += 1;
    }
    return { total, confirmed, pending, unprocessed };
  }, [images, imageStatusMap]);
  const filteredImages = useMemo(
    () => images.filter((item) => statusFilter === "all" || imageStatusMap[item.image] === statusFilter),
    [images, statusFilter, imageStatusMap]
  );
  const currentImageStatus = currentName ? imageStatusMap[currentName] || "unprocessed" : "unprocessed";
  const filteredPosition = useMemo(() => {
    if (!currentName) return 0;
    const idx = filteredImages.findIndex((item) => item.image === currentName);
    return idx >= 0 ? idx + 1 : 0;
  }, [filteredImages, currentName]);
  const currentConfidence = Number(currentResult?.confidence || 0);
  const currentLowConfidence = currentConfidence < 0.9;
  const draftNormalized = String(draft || "").trim().toUpperCase();
  const resultNormalized = String(currentResultText || "").trim().toUpperCase();
  const isDraftAligned = draftNormalized === resultNormalized;
  const singleStatus = useMemo(
    () =>
      resolveSingleStatus({
        currentResult,
        currentDraftState,
        currentLowConfidence,
        isDraftAligned,
      }),
    [currentResult, currentDraftState, currentLowConfidence, isDraftAligned]
  );
  const rightPaneRows = useMemo(() => {
    return filteredImages.map((item) => {
      const imageName = String(item?.image || "");
      const key = `${projectId}::${imageName}::${engine}::${model}::${modelType}::${paddleModel}::${(easyocrLangs || []).join(
        ","
      )}::pp:${preprocessEnabled ? "1" : "0"}::ov:${preprocessOverridesKey}`;
      const cached = cache[key];
      const status = imageStatusMap[imageName] || "unprocessed";
      const predicted = toHalfWidthAlnum(cached?.text ?? cached?.prediction ?? "");
      const confirmed = toHalfWidthAlnum(confirmedDrafts[imageName] || "");
      const inlineDraft = imageName === currentName ? toHalfWidthAlnum(draft || "") : "";
      const edited = inlineDraft || confirmed;
      return {
        imageName,
        status,
        predicted,
        edited,
        confidence: Number(cached?.confidence || 0),
        valid: typeof cached?.valid === "boolean" ? cached.valid : null,
      };
    });
  }, [
    filteredImages,
    projectId,
    engine,
    model,
    modelType,
    paddleModel,
    easyocrLangs,
    preprocessEnabled,
    preprocessOverridesKey,
    cache,
    imageStatusMap,
    confirmedDrafts,
    currentName,
    draft,
  ]);

  function getNextFilteredImageName(fromImageName, direction = 1) {
    if (!Array.isArray(images) || images.length === 0) return null;
    const step = direction >= 0 ? 1 : -1;
    const start = images.findIndex((item) => item.image === fromImageName);
    if (start < 0) return null;
    for (let i = start + step; i >= 0 && i < images.length; i += step) {
      const candidate = images[i];
      const status = imageStatusMap[candidate.image] || "unprocessed";
      if (statusFilter === "all" || status === statusFilter) {
        return candidate.image;
      }
    }
    return null;
  }

  function toggleEasyOcrLang(lang) {
    setEasyocrLangs((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.includes(lang)) return list.filter((item) => item !== lang);
      return [...list, lang];
    });
  }

  useEffect(() => {
    if (engine === "custom" && (!models || models.length === 0)) {
      setEngine?.("paddleocr");
      setNotice("カスタムモデル未作成のため、PaddleOCRに切り替えました。");
    }
  }, [engine, models, setEngine]);

  useEffect(() => {
    if (!projectId || !Array.isArray(images)) return;
    let active = true;
    const imageNames = new Set(images.map((item) => String(item?.image || "")));
    request(`/api/ocr/log/state?project_id=${encodeURIComponent(projectId)}`)
      .then((data) => {
        if (!active) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const nextPending = new Set();
        const nextConfirmed = {};
        for (const row of items) {
          const imageName = String(row?.image || "");
          if (!imageName || !imageNames.has(imageName)) continue;
          const status = String(row?.status || "");
          const text = toHalfWidthAlnum(row?.text || "");
          if (status === "pending") {
            nextPending.add(imageName);
          } else if (status === "confirmed") {
            nextConfirmed[imageName] = text;
          }
        }
        setPendingSet(nextPending);
        setConfirmedDrafts(nextConfirmed);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [projectId, images]);

  useEffect(() => {
    if (prevStatusFilterRef.current === statusFilter) {
      return;
    }
    prevStatusFilterRef.current = statusFilter;
    if (!onSelectImageName) return;
    const first = images.find((item) => statusFilter === "all" || imageStatusMap[item.image] === statusFilter);
    if (first?.image) {
      onSelectImageName(first.image);
    } else {
      setNotice(`「${STATUS_LABELS[statusFilter]}」に該当する画像がありません`);
    }
  }, [statusFilter, images, imageStatusMap, onSelectImageName]);

  async function runSinglePredict(imageName) {
    if (!imageName || !projectId) return null;
    const key = `${projectId}::${imageName}::${engine}::${model}::${modelType}::${paddleModel}::${(easyocrLangs || []).join(
      ","
    )}::pp:${preprocessEnabled ? "1" : "0"}::ov:${preprocessOverridesKey}`;
    if (cache[key]) return cache[key];
    if (pendingPredictRef.current[key]) return pendingPredictRef.current[key];

    const task = (async () => {
      let result;
      if (preprocessEnabled) {
        const previewData = await request("/preprocess/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: imageName,
            project_id: projectId,
            overrides: preprocessOverrides || null,
            engine,
            model: engine === "custom" ? model : engine === "paddleocr" ? paddleModel || "latest" : "latest",
            model_type: engine === "custom" && model === "latest" ? modelType : null,
            easyocr_langs: (easyocrLangs || []).join(",") || "en",
          }),
        });
        result = {
          text: String(previewData?.prediction ?? ""),
          prediction: String(previewData?.prediction ?? ""),
          confidence: Number(previewData?.confidence || 0),
          validation: previewData?.predict_validation || null,
          valid: Boolean(previewData?.predict_valid),
          char_scores: previewData?.predict_char_scores || [],
          char_confidence_normalized: previewData?.predict_char_confidence_normalized || [],
          model_name: previewData?.predict_model_name || "",
          model_type: previewData?.predict_model_type || "",
          engine: previewData?.predict_engine || engine,
          model_warning: previewData?.predict_model_warning || "",
          retry_used: Boolean(previewData?.predict_retry_used),
          multi_ocr: Boolean(previewData?.predict_multi_ocr),
          _processed_preview_data_url: previewData?.processed_data_url || "",
        };
        if (previewData?.predict_error) {
          const errorMessage = normalizePredictError(previewData.predict_error);
          result.validation = { valid: false, reason: errorMessage };
          if (!String(result.prediction || "").trim()) {
            throw new Error(errorMessage);
          }
        }
      } else {
        const imageResp = await fetch(imageUrl(imageName, projectId, imageVersion));
        if (!imageResp.ok) {
          throw new Error(`画像取得失敗: ${imageName}`);
        }
        const blob = await imageResp.blob();
        const upload = new File([blob], imageName, { type: blob.type || "image/png" });
        const formData = new FormData();
        formData.append("file", upload);
        formData.append("engine", engine);
        formData.append("project_id", projectId);
        formData.append("apply_preprocess", "false");
        if (engine === "custom") {
          formData.append("model", model);
          if (model === "latest" && modelType) formData.append("model_type", modelType);
        } else if (engine === "paddleocr") {
          formData.append("model", paddleModel || "latest");
          formData.append("easyocr_langs", (easyocrLangs || []).join(",") || "en");
        } else if (engine === "tesseract") {
          formData.append("model", tesseractModel || "latest");
        } else {
          formData.append("easyocr_langs", (easyocrLangs || []).join(",") || "en");
        }

        const response = await fetch(`${API_BASE}/predict`, { method: "POST", body: formData });
        if (!response.ok) {
          const message = parseApiErrorText(await response.text(), "推論に失敗しました");
          throw new Error(normalizePredictError(message));
        }
        result = await response.json();
      }
      result = { ...result, _cache_key: key };
      setCache((prev) => ({ ...prev, [key]: result }));
      return result;
    })();

    pendingPredictRef.current[key] = task;
    try {
      return await task;
    } finally {
      delete pendingPredictRef.current[key];
    }
  }

  useEffect(() => {
    if (!currentName) return;
    setTouched(false);
    setDraft("");
    setNotice("");
    runSinglePredict(currentName)
      .then((result) => {
        if (!result) return;
        const confirmed = confirmedDrafts[currentName];
        setDraft(toHalfWidthAlnum(confirmed ?? result.text ?? result.prediction ?? ""));
        if (focusHeatmapFirstRef.current) {
          setHeatmapFocusTick((prev) => prev + 1);
          focusHeatmapFirstRef.current = false;
        }
      })
      .catch((e) => setNotice(normalizePredictError(e.message)));
  }, [
    currentName,
    engine,
    model,
    modelType,
    paddleModel,
    projectId,
    imageVersion,
    easyocrLangs,
    preprocessEnabled,
    preprocessOverridesKey,
    confirmedDrafts,
  ]);

  useEffect(() => {
    if (!currentName || touched) return;
    const preferred = toHalfWidthAlnum(confirmedDrafts[currentName] ?? currentResultText);
    if (currentResult && preferred !== draft) {
      setDraft(preferred);
    }
  }, [currentName, currentResult, currentResultText, draft, touched, confirmedDrafts]);

  useEffect(() => {
    const nextName = getNextFilteredImageName(currentName, 1);
    if (!nextName) return;
    runSinglePredict(nextName).catch(() => null);
  }, [
    currentName,
    selectedIndex,
    images,
    engine,
    model,
    modelType,
    paddleModel,
    projectId,
    imageVersion,
    easyocrLangs,
    preprocessEnabled,
    preprocessOverridesKey,
    statusFilter,
    imageStatusMap,
  ]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [currentName]);

  useEffect(() => {
    if (!currentName) return;
    const listEl = listRef.current;
    const rowEl = itemRefs.current[currentName];
    if (!listEl || !rowEl) return;
    const top = rowEl.offsetTop - listEl.offsetTop;
    listEl.scrollTo({ top, behavior: "smooth" });
  }, [currentName, rightPaneRows]);

  async function saveCurrent({ skipped = false } = {}) {
    if (!currentName || !projectId || saving) return;
    const ocr = currentResult || {};
    const corrected = toHalfWidthAlnum(draft || "");
    const validation = validateText(corrected);
    const predicted = toHalfWidthAlnum(ocr.text ?? ocr.prediction ?? "");
    const payload = {
      project_id: projectId,
      image_path: currentName,
      predicted_text: predicted,
      corrected_text: skipped || corrected === predicted ? null : corrected,
      confidence: Number(ocr.confidence || 0),
      is_valid: skipped ? false : validation.valid,
      reason: skipped ? "skipped" : validation.reason || (ocr.validation?.reason ?? null),
      model_name: ocr.model_name || null,
      engine: ocr.engine || engine,
      char_scores: Array.isArray(ocr.char_scores) ? ocr.char_scores : null,
      used_retry: Boolean(ocr.retry_used),
      multi_ocr: Boolean(ocr.multi_ocr),
      extra: {
        ui_source: "rapid_ocr",
        original_prediction: predicted,
      },
    };
    setSaving(true);
    try {
      await request("/api/ocr/log/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const resolveStatusForNavigation = (imageName) => {
        if (imageName === currentName) {
          return skipped ? "pending" : "confirmed";
        }
        if (pendingSet.has(imageName)) return "pending";
        if (Object.prototype.hasOwnProperty.call(confirmedDrafts, imageName)) return "confirmed";
        return "unprocessed";
      };
      const matchesFilter = (status) => statusFilter === "all" || status === statusFilter;
      if (skipped) {
        setPendingSet((prev) => new Set(prev).add(currentName));
        setConfirmedDrafts((prev) => {
          if (!Object.prototype.hasOwnProperty.call(prev, currentName)) return prev;
          const next = { ...prev };
          delete next[currentName];
          return next;
        });
      } else {
        setPendingSet((prev) => {
          const next = new Set(prev);
          next.delete(currentName);
          return next;
        });
        setConfirmedDrafts((prev) => ({ ...prev, [currentName]: corrected }));
      }
      setNotice(skipped ? "保留として記録しました" : "修正を保存しました");
      if (!skipped) {
        focusHeatmapFirstRef.current = true;
      }
      if (onSelectImageName && images.length > 0) {
        let nextName = null;
        for (let i = selectedIndex + 1; i < images.length; i += 1) {
          const candidate = images[i];
          if (!candidate?.image) continue;
          if (matchesFilter(resolveStatusForNavigation(candidate.image))) {
            nextName = candidate.image;
            break;
          }
        }
        if (nextName) {
          onSelectImageName(nextName);
        } else {
          const firstMatch = images.find((item) => item?.image && matchesFilter(resolveStatusForNavigation(item.image)));
          if (firstMatch?.image) {
            onSelectImageName(firstMatch.image);
          } else if (!skipped) {
            setHeatmapFocusTick((prev) => prev + 1);
            focusHeatmapFirstRef.current = false;
          }
        }
      }
    } catch (e) {
      setNotice(normalizePredictError(e.message));
    } finally {
      setSaving(false);
    }
  }

  function onInputKeyDown(event) {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (event.shiftKey) {
        saveCurrent({ skipped: true });
      } else {
        saveCurrent({ skipped: false });
      }
      return;
    }
    if (event.key === "Backspace" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setTouched(true);
      setDraft("");
    }
  }

  function statusChipClass() {
    if (singleStatus.kind === "waiting") return "bg-slate-500/20 text-slate-200";
    if (singleStatus.kind === "invalid") return "bg-red-500/25 text-red-200";
    if (singleStatus.kind === "incomplete" || singleStatus.kind === "low") return "bg-amber-500/25 text-amber-200";
    if (singleStatus.kind === "editing") return "bg-blue-500/25 text-blue-200";
    return "bg-emerald-500/25 text-emerald-200";
  }

  function rowStatusChipClass(status) {
    if (status === "confirmed") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
    if (status === "pending") return "border-amber-500/40 bg-amber-500/15 text-amber-200";
    return "border-border bg-card/70 text-muted";
  }

  return (
    <div className="space-y-6">
      <div className="grid h-[calc(100vh-175px)] min-h-[640px] grid-cols-[1.5fr_1fr] gap-4">
        <Card title="作業画像 / OCR結果入力" subtitle="" className="flex min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-hidden">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="app-label">対象画像</label>
                <select
                  className="app-select"
                  value={filteredImages.some((item) => item.image === currentName) ? currentName : ""}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    if (nextName && onSelectImageName) {
                      onSelectImageName(nextName);
                    }
                  }}
                >
                  {filteredImages.length === 0 ? <option value="">該当画像なし</option> : null}
                  {filteredImages.map((item) => {
                    const status = imageStatusMap[item.image] || "unprocessed";
                    return (
                      <option key={item.image} value={item.image}>
                        {item.image}（{STATUS_LABELS[status] || status}）
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(preprocessEnabled)}
                    onChange={(e) => setPreprocessEnabled?.(e.target.checked)}
                  />
                  前処理設定を適用
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="app-label">エンジン</label>
                <select className="app-select" value={engine} onChange={(e) => setEngine(e.target.value)}>
                  <option value="custom">カスタム</option>
                  <option value="easyocr">EasyOCR</option>
                  <option value="paddleocr">PaddleOCR</option>
                  <option value="tesseract">Tesseract</option>
                </select>
              </div>
              {engine === "custom" ? (
                <div>
                  <label className="app-label">モデル</label>
                  <select className="app-select" value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="latest">最新</option>
                    {models.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              ) : engine === "paddleocr" ? (
                <div>
                  <label className="app-label">PaddleOCRモデル</label>
                  <select className="app-select" value={paddleModel} onChange={(e) => setPaddleModel(e.target.value)}>
                    <option value="latest">最新</option>
                    {paddleModels.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              ) : engine === "tesseract" ? (
                <div>
                  <label className="app-label">Tesseractモデル（.traineddata）</label>
                  <select
                    className="app-select"
                    value={tesseractModel}
                    onChange={(e) => setTesseractModel(e.target.value)}
                  >
                    <option value="latest">最新（学習済み）</option>
                    <option value="eng">eng.traineddata（標準英語モデル）</option>
                    {(tesseractModels || []).map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div />
              )}
            </div>

            {engine === "custom" && model === "latest" ? (
              <div>
                <label className="app-label">モデル種別</label>
                <select className="app-select" value={modelType} onChange={(e) => setModelType(e.target.value)}>
                  {modelTypes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {engine !== "custom" && engine !== "tesseract" ? (
              <div className="rounded-lg border border-border bg-card/50 p-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-semibold text-text hover:bg-card/70"
                  onClick={() => setLangPanelOpen((prev) => !prev)}
                >
                  <span>
                    言語 (
                    <span className="text-emerald-300">{selectedLangLabel}</span>
                    )
                  </span>
                  <span className="text-sm text-muted" aria-hidden="true">
                    {langPanelOpen ? "▾" : "▸"}
                  </span>
                </button>
                {langPanelOpen ? (
                  <div className="mt-2 grid grid-cols-4 gap-2 px-2 text-xs text-text">
                    {easyocrLanguageOptions.map((lang) => (
                      <label key={lang} className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={Array.isArray(easyocrLangs) ? easyocrLangs.includes(lang) : false}
                          onChange={() => toggleEasyOcrLang(lang)}
                        />
                        {lang}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="min-h-[160px] flex-1 rounded-lg border border-border bg-card/60 p-2">
              {currentName ? (
                <img
                  src={
                    preprocessEnabled && currentResult?._processed_preview_data_url
                      ? currentResult._processed_preview_data_url
                      : imageUrl(currentName, projectId, imageVersion)
                  }
                  alt={currentName}
                  className="h-full w-full rounded object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted">画像がありません</div>
              )}
            </div>

            <div className="min-h-0 overflow-auto pr-1">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusChipClass()}`}>
                    {singleStatus.label}
                  </div>
                  <span className="text-xs text-muted">
                    {filteredPosition}/{filteredImages.length || 0} / 総数: {progressStats.total}
                  </span>
                  <span className="text-xs text-muted">状態: {STATUS_LABELS[currentImageStatus] || currentImageStatus}</span>
                </div>

                <input
                  ref={inputRef}
                  className="app-input text-3xl tracking-[0.15em] font-semibold"
                  value={draft}
                  onChange={(e) => {
                    setTouched(true);
                    setDraft(toHalfWidthAlnum(e.target.value));
                  }}
                  onKeyDown={onInputKeyDown}
                  placeholder="OCR結果"
                  inputMode="latin"
                  lang="en"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  style={{ imeMode: "disabled" }}
                />

                <div className="rounded-lg border border-border bg-card/60 p-3">
                  <p className="mb-2 text-xs text-muted">ヒートマップ（クリックで1文字編集）</p>
                  <EditableHeatmap
                    text={draft || currentResultText}
                    scores={currentHeatScores}
                    maxLength={Math.max(expectedLength, (draft || currentResultText).length + 8)}
                    appendChar="A"
                    focusRequest={heatmapFocusTick}
                    focusIndex={0}
                    onConfirm={() => saveCurrent({ skipped: false })}
                    onChange={(nextText) => {
                      setTouched(true);
                      setDraft(toHalfWidthAlnum(nextText || ""));
                    }}
                  />
                </div>

                <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted">
                  <p>
                    信頼度: {(Number(currentResult?.confidence || 0) * 100).toFixed(1)}%
                    {!isDraftAligned ? "（元推論）" : ""}
                  </p>
                  {currentResult?.model_warning ? <p className="mt-1 text-amber-300">{currentResult.model_warning}</p> : null}
                  {currentResult?.validation?.reason ? <p>理由: {currentResult.validation.reason}</p> : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => saveCurrent({ skipped: false })} disabled={!currentName || saving}>
                    確定して次へ
                  </Button>
                  <Button variant="secondary" onClick={() => saveCurrent({ skipped: true })} disabled={!currentName || saving}>
                    保留して次へ
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (!onSelectImageName || images.length === 0) return;
                      const prevName = getNextFilteredImageName(currentName, -1);
                      if (prevName) onSelectImageName(prevName);
                    }}
                    disabled={!getNextFilteredImageName(currentName, -1)}
                  >
                    前へ
                  </Button>
                </div>
                {notice ? <p className="text-xs text-muted">{notice}</p> : null}
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="画像リスト"
          subtitle=""
          className="flex min-h-0 flex-col"
          actions={
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((filterKey) => {
                const active = statusFilter === filterKey;
                return (
                  <button
                    key={filterKey}
                    type="button"
                    onClick={() => setStatusFilter(filterKey)}
                    className={`rounded px-3 py-1 text-xs font-semibold transition ${
                      active
                        ? "border border-accent/60 bg-accent/20 text-accent"
                        : "border border-border bg-card/70 text-muted hover:bg-card"
                    }`}
                  >
                    {STATUS_LABELS[filterKey]}
                  </button>
                );
              })}
            </div>
          }
        >
          <div className="flex min-h-0 flex-1 flex-col space-y-3">
            <div className="rounded-lg border border-border bg-card/60 p-3">
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <span
                  className={`rounded border border-border px-2 py-0.5 ${
                    statusFilter === "all" ? "text-emerald-300" : ""
                  }`}
                >
                  総数: {progressStats.total}
                </span>
                <span
                  className={`rounded border border-border px-2 py-0.5 ${
                    statusFilter === "unprocessed" ? "text-emerald-300" : ""
                  }`}
                >
                  未処理: {progressStats.unprocessed}
                </span>
                <span
                  className={`rounded border border-border px-2 py-0.5 ${
                    statusFilter === "confirmed" ? "text-emerald-300" : ""
                  }`}
                >
                  確定: {progressStats.confirmed}
                </span>
                <span
                  className={`rounded border border-border px-2 py-0.5 ${
                    statusFilter === "pending" ? "text-emerald-300" : ""
                  }`}
                >
                  保留: {progressStats.pending}
                </span>
              </div>
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-auto pr-1">
              <div className="space-y-2">
                {rightPaneRows.map((row) => {
                  const isActive = row.imageName === currentName;
                  return (
                    <button
                      key={row.imageName}
                      ref={(el) => {
                        itemRefs.current[row.imageName] = el;
                      }}
                      type="button"
                      onClick={() => onSelectImageName?.(row.imageName)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        isActive
                          ? "border-accent bg-accent/15"
                          : "border-border bg-card/60 backdrop-blur-md hover:border-slate-500"
                      }`}
                    >
                      <div className="flex gap-3">
                        <img
                          src={imageUrl(row.imageName, projectId, imageVersion)}
                          alt={row.imageName}
                          className="h-14 w-20 shrink-0 rounded border border-border object-contain bg-card/70 p-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-text">{row.imageName}</p>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${rowStatusChipClass(row.status)}`}>
                              {STATUS_LABELS[row.status] || row.status}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted">
                            推論: <span className="text-slate-100">{row.predicted || "-"}</span>
                          </p>
                          <p className="truncate text-xs text-muted">
                            編集:{" "}
                            <span className="font-semibold text-[#adff5d]">{row.edited || (row.status === "pending" ? "保留" : "-")}</span>
                          </p>
                          <p className="text-[11px] text-muted">
                            信頼度: {(row.confidence * 100).toFixed(1)}% / 判定:{" "}
                            {row.valid === null ? "-" : row.valid ? "valid" : "invalid"}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {rightPaneRows.length === 0 ? (
                  <div className="rounded-lg border border-border bg-card/60 p-4 text-sm text-muted">
                    条件に一致する画像がありません
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
