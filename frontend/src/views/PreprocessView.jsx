import { useEffect, useRef, useState } from "react";
import { DEFAULT_PREPROCESS_UI_STATE } from "../lib/preprocessUiState";

import Button from "../components/Button";
import Card from "../components/Card";
import ImagePreview from "../components/ImagePreview";
import LowercaseToggle from "../components/LowercaseToggle";
import ManualMaskEditor from "../components/ManualMaskEditor";
import PreprocessPanel from "../components/PreprocessPanel";
import ResultBadge from "../components/ResultBadge";
import { imageUrl, request } from "../lib/api";

export default function PreprocessView({
  projectId,
  imageVersion,
  extraSlots = [],
  onExtraSlotsChange,
  extraPreviews = [],
  onManualMasksSaved,
  returnView,
  onReturn,
  images,
  selectedImage,
  onSelectImage,
  defaultParams,
  predictEngine,
  setPredictEngine,
  predictModel,
  setPredictModel,
  predictPaddleModel,
  setPredictPaddleModel,
  predictTesseractModel,
  setPredictTesseractModel,
  predictModelType,
  setPredictModelType,
  predictEasyOcrLangs,
  setPredictEasyOcrLangs,
  predictIncludeLowercase,
  setPredictIncludeLowercase,
  easyocrLanguageOptions,
  modelTypes,
  models,
  paddleModels,
  tesseractModels,
  latestModels,
  params,
  onParamsChange,
  preview,
  loading,
  error,
  presetName,
  setPresetName,
  presets,
  selectedPreset,
  setSelectedPreset,
  onSavePreset,
  onLoadPreset,
  uiState = DEFAULT_PREPROCESS_UI_STATE,
  onUiStateChange,
  predictPsm = 7,
  setPredictPsm,
  predictWhitelist = "",
  setPredictWhitelist,
}) {
  const latestAny = String(latestModels?.any || "");
  const latestByType = latestModels?.byType || {};
  const engineNames = { custom: "カスタムモデル", easyocr: "EasyOCR", paddleocr: "PaddleOCR", tesseract: "Tesseract" };
  const engineDisplayLabel = engineNames[predictEngine] || predictEngine;

  // ---- 手動マスク補正（マスクは画像単位でサーバー保存） ----
  const [manualMasksMap, setManualMasksMap] = useState({});
  const [masksVisible, setMasksVisible] = useState(true);
  const [maskSelectedIndex, setMaskSelectedIndex] = useState(-1);
  const [pendingRegion, setPendingRegion] = useState(null);
  const [pendingRect, setPendingRect] = useState(null);
  const [maskAnalyzing, setMaskAnalyzing] = useState(false);
  const [maskError, setMaskError] = useState("");
  const [maskNotice, setMaskNotice] = useState("");
  const [maskUndoStack, setMaskUndoStack] = useState([]);
  const [maskRedoStack, setMaskRedoStack] = useState([]);
  const analyzeSeqRef = useRef(0);
  const maskConfirmingRef = useRef(false);
  const maskNoticeTimerRef = useRef(null);

  const manualMaskEnabled = Boolean(params.manual_mask_enabled);
  // 指定方式は設定として保存（保存値あり→復元 / 未設定→黒領域ポイント指定）
  const maskEditMode = params.manual_mask_mode === "rect" ? "rect" : "point";
  const setMaskEditMode = (mode) => onParamsChange((prev) => ({ ...prev, manual_mask_mode: mode }));
  const currentMasks = manualMasksMap?.[selectedImage]?.manual_masks || [];

  function showMaskNotice(text) {
    setMaskNotice(text);
    if (maskNoticeTimerRef.current) {
      clearTimeout(maskNoticeTimerRef.current);
    }
    maskNoticeTimerRef.current = setTimeout(() => setMaskNotice(""), 2000);
  }

  useEffect(() => () => {
    if (maskNoticeTimerRef.current) {
      clearTimeout(maskNoticeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let active = true;
    request(`/images/manual-masks?project_id=${encodeURIComponent(projectId || "default")}`)
      .then((data) => {
        if (active) {
          setManualMasksMap(data?.items || {});
        }
      })
      .catch(() => {
        if (active) {
          setManualMasksMap({});
        }
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  // 画像・プロジェクト切替時は編集途中状態を破棄（古い解析結果が新画像へ載らないように）
  useEffect(() => {
    analyzeSeqRef.current += 1;
    setPendingRegion(null);
    setPendingRect(null);
    setMaskSelectedIndex(-1);
    setMaskError("");
    setMaskUndoStack([]);
    setMaskRedoStack([]);
  }, [selectedImage, projectId]);

  async function persistMasks(nextMasks) {
    setManualMasksMap((prev) => ({ ...prev, [selectedImage]: { manual_masks: nextMasks } }));
    try {
      await request(`/images/${encodeURIComponent(selectedImage)}/manual-masks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, manual_masks: nextMasks }),
      });
      setMaskError("");
      onManualMasksSaved?.();
    } catch (err) {
      setMaskError(`マスクの保存に失敗しました: ${err.message}`);
    }
  }

  function applyMasks(nextMasks) {
    setMaskUndoStack((prev) => [...prev.slice(-49), currentMasks]);
    setMaskRedoStack([]);
    persistMasks(nextMasks);
  }

  function undoMasks() {
    if (maskUndoStack.length === 0) return;
    const snapshot = maskUndoStack[maskUndoStack.length - 1];
    setMaskUndoStack((prev) => prev.slice(0, -1));
    setMaskRedoStack((prev) => [...prev.slice(-49), currentMasks]);
    persistMasks(snapshot);
  }

  function redoMasks() {
    if (maskRedoStack.length === 0) return;
    const snapshot = maskRedoStack[maskRedoStack.length - 1];
    setMaskRedoStack((prev) => prev.slice(0, -1));
    setMaskUndoStack((prev) => [...prev.slice(-49), currentMasks]);
    persistMasks(snapshot);
  }

  async function analyzeMaskPoint(x, y) {
    if (!selectedImage) return;
    const seq = ++analyzeSeqRef.current;
    setPendingRect(null); // 候補は同時に1つだけ
    setMaskAnalyzing(true);
    setMaskError("");
    try {
      const data = await request(`/images/${encodeURIComponent(selectedImage)}/analyze-mask-region`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          x,
          y,
          threshold: Number(params.manual_mask_threshold) || 80,
        }),
      });
      if (seq !== analyzeSeqRef.current) return; // 古い解析結果は破棄
      if (data?.found) {
        setPendingRegion(data);
      } else {
        setPendingRegion(null);
        setMaskError(data?.reason || "黒領域が見つかりませんでした");
      }
    } catch (err) {
      if (seq === analyzeSeqRef.current) {
        setPendingRegion(null);
        setMaskError(`領域解析に失敗しました: ${err.message}`);
      }
    } finally {
      if (seq === analyzeSeqRef.current) {
        setMaskAnalyzing(false);
      }
    }
  }

  const hasPendingCandidate = Boolean(pendingRect || pendingRegion?.found);

  // 候補（矩形/黒領域）を確定。連打・repeat中の重複登録を防ぐため候補は即時クリアする
  function confirmPendingCandidate() {
    if (maskConfirmingRef.current) return false;
    maskConfirmingRef.current = true;
    try {
      if (pendingRect) {
        const rect = pendingRect;
        setPendingRect(null);
        applyMasks([...currentMasks, { type: "rect", ...rect, enabled: true }]);
        showMaskNotice("マスクを追加しました");
        return true;
      }
      if (pendingRegion?.found) {
        const region = pendingRegion;
        setPendingRegion(null);
        applyMasks([
          ...currentMasks,
          {
            type: "region",
            rle: region.rle,
            source_size: region.source_size,
            bbox: region.bbox,
            area_px: region.area_px,
            area_ratio: region.area_ratio,
            enabled: true,
          },
        ]);
        showMaskNotice("マスクを追加しました");
        return true;
      }
      return false;
    } finally {
      maskConfirmingRef.current = false;
    }
  }

  function cancelPendingCandidate() {
    if (!hasPendingCandidate) return false;
    setPendingRect(null);
    setPendingRegion(null);
    return true;
  }

  // Enter=候補確定 / Esc=候補取消 / Ctrl+Z・Ctrl+Y=マスクUndo/Redo。
  // フォーム部品へフォーカス中は通常のキー操作を優先する
  useEffect(() => {
    function isFormElementFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        el.isContentEditable
      );
    }

    function handleKeyDown(e) {
      if (!manualMaskEnabled) return;
      if (isFormElementFocused()) return;
      const key = e.key;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (key === "z" || key === "Z")) {
        if (e.shiftKey) {
          if (maskRedoStack.length > 0) {
            e.preventDefault();
            redoMasks();
          }
        } else if (maskUndoStack.length > 0) {
          e.preventDefault();
          undoMasks();
        }
        return;
      }
      if (mod && (key === "y" || key === "Y")) {
        if (maskRedoStack.length > 0) {
          e.preventDefault();
          redoMasks();
        }
        return;
      }
      if (key === "Enter") {
        if (e.repeat) return; // 長押しrepeatは無視
        if (!hasPendingCandidate) return; // 候補なしなら何もしない
        e.preventDefault();
        confirmPendingCandidate();
        return;
      }
      if (key === "Escape") {
        if (cancelPendingCandidate()) {
          e.preventDefault();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function updateExtraSlot(index, patch) {
    onExtraSlotsChange?.(extraSlots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }

  function addExtraSlot() {
    if (extraSlots.length >= 2) {
      return;
    }
    onExtraSlotsChange?.([...extraSlots, { engine: "tesseract", model: "eng", langs: "en" }]);
  }

  function removeExtraSlot(index) {
    onExtraSlotsChange?.(extraSlots.filter((_, i) => i !== index));
  }

  // 中央の推論結果欄に渡す比較行（モデル2/3）。失敗・重複はそのスロットだけ表示する
  const comparisonResults = extraSlots.map((slot, i) => {
    const p = extraPreviews?.[i] || {};
    return {
      engine: engineNames[p.engine || slot.engine] || p.engine || slot.engine,
      model: p.modelName || (slot.engine === "easyocr" ? "" : slot.model || ""),
      prediction: p.prediction || "",
      confidence: p.confidence,
      skipped: Boolean(p.duplicate),
      error: p.duplicate ? "同一設定のためスキップ" : p.error || "",
    };
  });

  function basename(path) {
    if (!path) return "";
    const parts = String(path).split("/");
    return parts[parts.length - 1];
  }

  function toggleEasyOcrLang(lang) {
    setPredictEasyOcrLangs((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.includes(lang)) {
        return list.filter((item) => item !== lang);
      }
      return [...list, lang];
    });
  }

  const resolvedModelName =
    predictEngine === "custom"
      ? predictModel === "latest"
        ? basename(latestByType[predictModelType] || latestAny) || "該当モデルなし"
        : predictModel
      : predictEngine === "paddleocr"
        ? predictPaddleModel === "latest"
          ? basename(latestModels?.ocrPaddle || "") || "PaddleOCR既定モデル"
          : predictPaddleModel
        : predictEngine === "tesseract"
          ? predictTesseractModel === "latest"
            ? "Tesseract最新モデル"
            : predictTesseractModel === "eng"
              ? "eng.traineddata（標準英語モデル）"
              : predictTesseractModel
          : "EasyOCR";

  // 前回のOCR結果との差分表示（プレビュー右下）。画像切替時はリセット
  const prevPredictionRef = useRef({ image: "", prediction: "" });
  const currentPrediction = String(preview?.prediction || "");
  useEffect(() => {
    if (loading) return;
    const entry = prevPredictionRef.current;
    if (entry.image !== selectedImage) {
      prevPredictionRef.current = { image: selectedImage, prediction: currentPrediction, before: "" };
      return;
    }
    if (entry.prediction !== currentPrediction) {
      prevPredictionRef.current = { image: selectedImage, prediction: currentPrediction, before: entry.prediction };
    }
  }, [loading, selectedImage, currentPrediction]);
  const previousPrediction = prevPredictionRef.current.image === selectedImage ? prevPredictionRef.current.before || "" : "";
  // 中間画像は最終画像と異なる場合のみ折りたたみで表示（現構成では通常同一のため重複表示しない）
  const interimDiffers = Boolean(
    preview?.interim_data_url && preview?.processed_data_url && preview.interim_data_url !== preview.processed_data_url
  );

  return (
    // レイアウト: 1280px以上=3カラム（一覧|プレビュー|設定・ビューポート内固定）/
    // 1024〜1279px=一覧|プレビューの2カラム＋設定を下段全幅 / 1024px未満（縦長含む）=縦積み。
    // プレビュー列は minmax(420px,…) の実用最小幅を確保し、数十pxへ潰れる構成を廃止
    <div className="grid grid-cols-1 gap-3 min-[1024px]:grid-cols-[minmax(180px,230px)_minmax(420px,1fr)] min-[1280px]:h-[calc(100vh-238px)] min-[1280px]:min-h-[440px] min-[1280px]:grid-cols-[minmax(180px,18fr)_minmax(440px,45fr)_minmax(340px,37fr)]">
      <Card title="画像一覧" subtitle="プレビュー対象を選択" className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 max-h-[40vh] min-[1024px]:max-h-[60vh] min-[1280px]:max-h-none">
          {images.map((item) => {
            const active = item.image === selectedImage;
            const thumbSrc = imageUrl(item.image, projectId, imageVersion);
            return (
              <button
                key={item.image}
                onClick={() => onSelectImage(item.image)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                  active
                    ? "border-accent bg-accent/15 text-blue-200"
                    : "border-border bg-card/60 backdrop-blur-md text-muted hover:text-text"
                }`}
              >
                <div className="mb-2 overflow-hidden rounded-md border border-border bg-[#3b444f]/80 p-1">
                  <img src={thumbSrc} alt={item.image} className="h-20 w-full object-contain" loading="lazy" />
                </div>
                <div className="truncate font-medium">{item.image}</div>
                <div className="mt-1 text-[11px] text-muted">種別: {item.type || "--"}</div>
                {active && !loading && preview?.prediction ? (
                  <div className="mt-1 truncate text-[11px] font-semibold text-accent">OCR: {preview.prediction}</div>
                ) : null}
              </button>
            );
          })}
          {images.length === 0 && <div className="text-sm text-muted">画像がありません</div>}
        </div>
      </Card>

      <div className="flex min-h-0 flex-col gap-2">
        <ManualMaskEditor
          title="元画像"
          subtitle={selectedImage || "--"}
          src={selectedImage ? imageUrl(selectedImage, projectId, imageVersion) : ""}
          enabled={manualMaskEnabled}
          editMode={manualMaskEnabled ? maskEditMode : "off"}
          masks={currentMasks}
          masksVisible={masksVisible}
          pendingRegion={pendingRegion}
          pendingRect={pendingRect}
          selectedIndex={maskSelectedIndex}
          analyzing={maskAnalyzing}
          onSelect={setMaskSelectedIndex}
          onDraftRect={(rect) => {
            setPendingRegion(null);
            setPendingRect(rect);
          }}
          onUpdateRect={(index, patch) =>
            applyMasks(currentMasks.map((mask, i) => (i === index ? { ...mask, ...patch } : mask)))
          }
          onPointClick={analyzeMaskPoint}
        />
        <ImagePreview
          title="処理後画像"
          subtitle={[
            preview?.type ? `種別: ${preview.type}` : "",
            preview?.ratio !== undefined ? `比率: ${preview.ratio}` : "",
          ]
            .filter(Boolean)
            .join(" / ") || "--"}
          src={preview?.processed_data_url || ""}
          loading={loading}
        />
        {/* 中間画像は最終画像と異なる場合のみ表示（通常のパイプライン構成では同一のため重複を出さない） */}
        {interimDiffers ? (
          <details className="rounded-xl border border-border bg-card/45">
            <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-semibold text-text">
              中間画像を表示
            </summary>
            <div className="px-2 pb-2">
              <ImagePreview title="中間画像" subtitle={preview?.type ? `種別: ${preview.type}` : "--"} src={preview?.interim_data_url || ""} loading={loading} />
            </div>
          </details>
        ) : null}

        <ResultBadge
          loading={loading}
          prediction={preview?.prediction || ""}
          confidence={preview?.confidence}
          modelType={preview?.predict_model_type}
          modelName={preview?.predict_model_name}
          engine={preview?.predict_engine}
          error={error || preview?.predict_error || ""}
          warning={preview?.predict_model_warning || ""}
          comparisons={comparisonResults}
        />
        {/* 処理時間（キャッシュヒット時は表示）と前回のOCR結果との差 */}
        {!loading && preview ? (
          <p className="shrink-0 px-1 text-[11px] tabular-nums text-muted">
            {preview.__cached
              ? "処理時間: キャッシュ利用（再処理なし）"
              : Number.isFinite(preview.__elapsed_ms)
                ? `処理時間: ${preview.__elapsed_ms}ms`
                : ""}
            {previousPrediction && previousPrediction !== currentPrediction ? (
              <span className="ml-2">
                前回: <span className="text-amber-200">{previousPrediction}</span> → 今回:{" "}
                <span className="text-text">{currentPrediction || "(空)"}</span>
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <PreprocessPanel
        inferenceSummary={predictEngine === "easyocr" ? "EasyOCR" : `${engineDisplayLabel} / ${resolvedModelName}`}
        focusInference={Boolean(returnView)}
        manualMaskSection={
          <div className="space-y-2.5 rounded-xl border border-border bg-card/60 p-3 backdrop-blur-md">
            <p className="param-hint">
              不要な黒い塊や影を塗りつぶしてOCRの誤認識を防ぎます。マスクは表示中の画像ごとに保存され、元画像ファイルは変更しません。
            </p>
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={manualMaskEnabled}
                onChange={(e) => onParamsChange((prev) => ({ ...prev, manual_mask_enabled: e.target.checked }))}
              />
              手動マスク補正を有効にする
            </label>

            <div className="rounded-lg border border-border bg-card/45 p-2 text-[11px] leading-relaxed text-muted">
              操作:
              <br />
              ・{maskEditMode === "rect" ? "矩形をドラッグして候補を作成" : "黒領域をクリックして候補を検出"}
              <br />
              ・Enter: 候補を確定
              <br />
              ・Esc: 候補を取消
            </div>

            {maskNotice ? (
              <p className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">
                {maskNotice}
              </p>
            ) : null}
            {maskError ? <p className="text-xs text-danger">{maskError}</p> : null}

            <div>
              <label className="app-label">指定方式</label>
              <div className="flex gap-3 rounded-lg border border-border bg-card/45 p-2 text-xs text-text">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="mask-edit-mode"
                    checked={maskEditMode === "rect"}
                    onChange={() => setMaskEditMode("rect")}
                    disabled={!manualMaskEnabled}
                  />
                  矩形範囲（ドラッグ）
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="mask-edit-mode"
                    checked={maskEditMode === "point"}
                    onChange={() => setMaskEditMode("point")}
                    disabled={!manualMaskEnabled}
                  />
                  黒領域ポイント指定
                </label>
              </div>
              <p className="param-hint">
                {maskEditMode === "rect"
                  ? "左の元画像上をドラッグして矩形候補を作成し、Enterまたはボタンで確定します。"
                  : "左の元画像上の黒い塊をクリックすると、つながった黒領域を候補として検出します。"}
              </p>
            </div>

            {maskEditMode === "point" ? (
              <div>
                <label className="app-label">黒判定しきい値: {params.manual_mask_threshold ?? 80}</label>
                <p className="param-hint">この値以下の暗さの画素を「黒」とみなして連結領域を検出します。</p>
                <input
                  type="range"
                  min="0"
                  max="255"
                  step="1"
                  value={params.manual_mask_threshold ?? 80}
                  onChange={(e) =>
                    onParamsChange((prev) => ({ ...prev, manual_mask_threshold: Number(e.target.value) }))
                  }
                  className="w-full"
                  disabled={!manualMaskEnabled}
                />
              </div>
            ) : null}

            <div>
              <label className="app-label">塗りつぶし方式</label>
              <div className="flex gap-3 rounded-lg border border-border bg-card/45 p-2 text-xs text-text">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="mask-fill"
                    checked={(params.manual_mask_fill || "white") === "white"}
                    onChange={() =>
                      onParamsChange((prev) => ({ ...prev, manual_mask_fill: "white", manual_mask_timing: "post" }))
                    }
                    disabled={!manualMaskEnabled}
                  />
                  白で塗りつぶし
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="mask-fill"
                    checked={params.manual_mask_fill === "background"}
                    onChange={() =>
                      onParamsChange((prev) => ({ ...prev, manual_mask_fill: "background", manual_mask_timing: "pre" }))
                    }
                    disabled={!manualMaskEnabled}
                  />
                  周辺背景色で塗りつぶし
                </label>
              </div>
              <p className="param-hint">
                方式に合わせて適用タイミングを自動設定します（白=二値化後 / 周辺背景色=二値化前）。必要なら下で変更できます。
              </p>
            </div>

            <div>
              <label className="app-label">適用タイミング</label>
              <div className="flex gap-3 rounded-lg border border-border bg-card/45 p-2 text-xs text-text">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="mask-timing"
                    checked={(params.manual_mask_timing || "post") === "post"}
                    onChange={() => onParamsChange((prev) => ({ ...prev, manual_mask_timing: "post" }))}
                    disabled={!manualMaskEnabled}
                  />
                  後段マスク（二値化の後に適用）
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="mask-timing"
                    checked={params.manual_mask_timing === "pre"}
                    onChange={() => onParamsChange((prev) => ({ ...prev, manual_mask_timing: "pre" }))}
                    disabled={!manualMaskEnabled}
                  />
                  前段マスク（二値化より前に適用）
                </label>
              </div>
              <p className="param-hint">
                前段=二値化より前（周辺背景色で塗る場合に有効）/ 後段=二値化の後（白で塗る場合に有効）。
              </p>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-text">
              <input type="checkbox" checked={masksVisible} onChange={(e) => setMasksVisible(e.target.checked)} />
              マスクを画像上に表示
            </label>

            {pendingRect ? (
              <div className="rounded-lg border border-amber-300/60 bg-amber-300/10 p-2 text-xs text-text">
                <p className="font-semibold text-amber-200">矩形候補（未確定）</p>
                <p className="mt-1 text-muted">
                  左 {(pendingRect.x * 100).toFixed(1)}% / 上 {(pendingRect.y * 100).toFixed(1)}% / 幅{" "}
                  {(pendingRect.width * 100).toFixed(1)}% / 高さ {(pendingRect.height * 100).toFixed(1)}%
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" className="flex-1" onClick={confirmPendingCandidate}>
                    この領域を追加（Enter）
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1" onClick={cancelPendingCandidate}>
                    キャンセル（Esc）
                  </Button>
                </div>
              </div>
            ) : null}

            {pendingRegion?.found ? (
              <div className="rounded-lg border border-amber-300/60 bg-amber-300/10 p-2 text-xs text-text">
                <p className="font-semibold text-amber-200">検出された黒領域（未確定）</p>
                <p className="mt-1 text-muted">
                  面積: {pendingRegion.area_px}px（画像の{(pendingRegion.area_ratio * 100).toFixed(1)}%）
                </p>
                {pendingRegion.too_large ? (
                  <p className="mt-1 text-amber-200">
                    ⚠ 領域が画像の25%以上あります。文字ごと消えないか確認してから追加してください。
                  </p>
                ) : null}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" className="flex-1" onClick={confirmPendingCandidate}>
                    この領域を追加（Enter）
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1" onClick={cancelPendingCandidate}>
                    キャンセル（Esc）
                  </Button>
                </div>
              </div>
            ) : null}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="app-label mb-0">登録マスク（{currentMasks.length}件）</label>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={undoMasks}
                    disabled={maskUndoStack.length === 0}
                    title="マスクの直前の操作を取り消します"
                  >
                    元に戻す
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={redoMasks}
                    disabled={maskRedoStack.length === 0}
                    title="取り消した操作をやり直します"
                  >
                    やり直す
                  </Button>
                </div>
              </div>
              {currentMasks.length === 0 ? (
                <p className="text-xs text-muted">この画像にはマスクが登録されていません。</p>
              ) : (
                <div className="space-y-1">
                  {currentMasks.map((mask, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
                        index === maskSelectedIndex ? "border-accent bg-accent/10" : "border-border bg-card/45"
                      }`}
                    >
                      <button
                        className="min-w-0 flex-1 truncate text-left text-text"
                        onClick={() => setMaskSelectedIndex(index)}
                        title="クリックで選択（矩形は画像上で移動・サイズ変更できます）"
                      >
                        #{index + 1} {mask.type === "rect" ? "矩形" : `黒領域（${mask.area_px ?? "--"}px）`}
                      </button>
                      <label className="inline-flex shrink-0 items-center gap-1 text-muted">
                        <input
                          type="checkbox"
                          checked={mask.enabled !== false}
                          onChange={(e) =>
                            applyMasks(
                              currentMasks.map((m, i) => (i === index ? { ...m, enabled: e.target.checked } : m))
                            )
                          }
                        />
                        有効
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 shrink-0 px-1.5 text-[11px] text-danger"
                        onClick={() => applyMasks(currentMasks.filter((_, i) => i !== index))}
                      >
                        削除
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {currentMasks.length > 0 ? (
                <Button
                  size="sm"
                  variant="danger"
                  className="mt-2 w-full"
                  onClick={() => {
                    if (window.confirm("この画像の登録マスクをすべて削除します。よろしいですか？")) {
                      applyMasks([]);
                    }
                  }}
                >
                  すべて削除
                </Button>
              ) : null}
            </div>
          </div>
        }
        inferenceSettings={
          <>
            <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="app-label">エンジン</label>
              <select value={predictEngine} onChange={(e) => setPredictEngine(e.target.value)} className="app-select">
                <option value="custom">カスタムモデル</option>
                <option value="easyocr">EasyOCR</option>
                <option value="paddleocr">PaddleOCR</option>
                <option value="tesseract">Tesseract</option>
              </select>
            </div>
            {predictEngine === "custom" ? (
              <>
                <div>
                  <label className="app-label">モデル</label>
                  <select
                    value={predictModel}
                    onChange={(e) => setPredictModel(e.target.value)}
                    className="app-select"
                  >
                    <option value="latest">最新</option>
                    {models.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                {predictModel === "latest" ? (
                  <div>
                    <label className="app-label">最新選択時のモデル種別</label>
                    <select
                      value={predictModelType}
                      onChange={(e) => setPredictModelType(e.target.value)}
                      className="app-select"
                    >
                      {modelTypes.length === 0 ? (
                        <option value={predictModelType}>{predictModelType || "既定"}</option>
                      ) : (
                        modelTypes.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                ) : null}
                {models.length === 0 ? (
                  <p className="col-span-2 text-xs text-amber-200">
                    カスタムモデルがありません。学習完了までは EasyOCR を使ってプレビューできます。
                  </p>
                ) : null}
              </>
            ) : predictEngine === "paddleocr" ? (
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="app-label">PaddleOCRモデル</label>
                  <select
                    value={predictPaddleModel}
                    onChange={(e) => setPredictPaddleModel(e.target.value)}
                    className="app-select"
                  >
                    <option value="latest">最新</option>
                    {paddleModels.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="app-label">PaddleOCR 言語</label>
                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card/60 backdrop-blur-md p-2">
                    {easyocrLanguageOptions.map((lang) => (
                      <label key={lang} className="inline-flex items-center gap-2 text-xs text-text">
                        <input
                          type="checkbox"
                          checked={Array.isArray(predictEasyOcrLangs) ? predictEasyOcrLangs.includes(lang) : false}
                          onChange={() => toggleEasyOcrLang(lang)}
                        />
                        {lang}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ) : predictEngine === "tesseract" ? (
              <div className="col-span-2 space-y-2">
                <div>
                  <label className="app-label">Tesseractモデル</label>
                  <select
                    value={predictTesseractModel}
                    onChange={(e) => setPredictTesseractModel(e.target.value)}
                    className="app-select"
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="app-label">PSM</label>
                    <input
                      type="number"
                      min="0"
                      max="13"
                      value={predictPsm}
                      onChange={(e) => setPredictPsm?.(Number(e.target.value))}
                      className="app-input"
                    />
                  </div>
                  <div>
                    <label className="app-label">Whitelist（空=モデル既定）</label>
                    <input
                      value={predictWhitelist}
                      onChange={(e) => setPredictWhitelist?.(e.target.value)}
                      className="app-input"
                      placeholder="例: ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted">
                  eng.traineddata は Tesseract 標準の英語モデル（学習前ベースライン）です。推論時 whitelist は
                  実運用で出現する文字に合わせて設定します（既定: A-Z + 0-9 + k,l,t）・単一行想定（PSM既定 7）。
                </p>
                <p className="text-xs text-muted">
                  推論には Tesseract 本体のインストールが必要です（学習には lstmtraining / combine_tessdata
                  なども必要）。導入手順は docs/11_TESSERACT_CHECKLIST.md を参照してください。
                </p>
                {(tesseractModels || []).length === 0 ? (
                  <p className="text-xs text-amber-200">
                    学習済みTesseractモデルがありません。eng.traineddata（標準英語モデル）を選択するか、学習画面で
                    Tesseract学習を完了してください。
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="col-span-2">
                <label className="app-label">{predictEngine === "paddleocr" ? "PaddleOCR 言語" : "EasyOCR 言語"}</label>
                <div className="grid grid-cols-6 gap-2 rounded-lg border border-border bg-card/60 backdrop-blur-md p-2">
                  {easyocrLanguageOptions.map((lang) => (
                    <label key={lang} className="inline-flex items-center gap-2 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={Array.isArray(predictEasyOcrLangs) ? predictEasyOcrLangs.includes(lang) : false}
                        onChange={() => toggleEasyOcrLang(lang)}
                      />
                      {lang}
                    </label>
                  ))}
                </div>
              </div>
            )}
            </div>
            <LowercaseToggle
              className="mt-3 rounded-lg border border-border bg-card/45 p-2"
              engine={predictEngine}
              langs={predictEasyOcrLangs}
              value={predictIncludeLowercase}
              onChange={setPredictIncludeLowercase}
            />
            <div className="mt-3 rounded-lg border border-border bg-card/45 p-2 text-xs text-muted">
              実際に使用される推論先: <span className="font-semibold text-text">{resolvedModelName}</span>
            </div>

            {extraSlots.map((slot, index) => (
              <div key={index} className="mt-3 rounded-lg border border-border bg-card/45 p-2">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-text">比較モデル{index + 2}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-danger"
                    onClick={() => removeExtraSlot(index)}
                    title={`比較モデル${index + 2}を削除します`}
                  >
                    削除
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="app-label">エンジン</label>
                    <select
                      value={slot.engine}
                      onChange={(e) =>
                        updateExtraSlot(index, {
                          engine: e.target.value,
                          model: e.target.value === "tesseract" ? "eng" : "latest",
                        })
                      }
                      className="app-select"
                    >
                      <option value="tesseract">Tesseract</option>
                      <option value="paddleocr">PaddleOCR</option>
                      <option value="easyocr">EasyOCR</option>
                    </select>
                  </div>
                  {slot.engine === "tesseract" ? (
                    <div>
                      <label className="app-label">モデル</label>
                      <select
                        value={slot.model || "eng"}
                        onChange={(e) => updateExtraSlot(index, { model: e.target.value })}
                        className="app-select"
                      >
                        <option value="latest">最新（学習済み）</option>
                        <option value="eng">eng.traineddata</option>
                        {(tesseractModels || []).map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : slot.engine === "paddleocr" ? (
                    <div>
                      <label className="app-label">モデル</label>
                      <select
                        value={slot.model || "latest"}
                        onChange={(e) => updateExtraSlot(index, { model: e.target.value })}
                        className="app-select"
                      >
                        <option value="latest">最新</option>
                        {paddleModels.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="app-label">言語（カンマ区切り）</label>
                      <input
                        value={slot.langs || "en"}
                        onChange={(e) => updateExtraSlot(index, { langs: e.target.value })}
                        className="app-input"
                        placeholder="en"
                      />
                    </div>
                  )}
                </div>
                <LowercaseToggle
                  className="mt-2"
                  engine={slot.engine}
                  langs={slot.engine === "easyocr" || slot.engine === "paddleocr" ? slot.langs || "en" : ""}
                  value={slot.includeLowercase !== false}
                  onChange={(v) => updateExtraSlot(index, { includeLowercase: v })}
                />
                {extraPreviews?.[index]?.duplicate ? (
                  <p className="mt-1.5 text-[11px] text-amber-200">
                    他のスロットと同一設定のため推論をスキップしました
                  </p>
                ) : null}
              </div>
            ))}
            {extraSlots.length < 2 ? (
              <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={addExtraSlot}>
                比較モデルを追加（最大3つ）
              </Button>
            ) : null}
          </>
        }
        headerAction={
          returnView ? (
            <Button size="sm" variant="secondary" onClick={() => onReturn?.()} title="元の画面へ戻ります">
              {returnView === "rapid-ocr" ? "× OCR修正へ戻る" : "× ラベル編集へ戻る"}
            </Button>
          ) : null
        }
        params={params}
        defaultParams={defaultParams}
        onParamsChange={onParamsChange}
        presetName={presetName}
        setPresetName={setPresetName}
        presets={presets}
        selectedPreset={selectedPreset}
        setSelectedPreset={setSelectedPreset}
        onSavePreset={onSavePreset}
        onLoadPreset={onLoadPreset}
        uiState={uiState}
        onUiStateChange={onUiStateChange}
        previewType={preview?.type || ""}
      />
    </div>
  );
}
