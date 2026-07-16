import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import Button from "../components/Button";
import {
  CandidateMessageRow,
  CandidateRow,
  DictionaryCandidatesSection,
  OcrRerunButton,
  renderedImageWidth,
  StageImage,
} from "../components/labeling/CandidateParts";
import LabelMainInput from "../components/labeling/LabelMainInput";
import SoftKeyboardPanel from "../components/labeling/SoftKeyboardPanel";
import useLabelingShortcuts from "../components/labeling/useLabelingShortcuts";
import { API_BASE, request } from "../lib/api";
import { searchDictionaryCandidates } from "../lib/candidateDictionary";
import {
  computeEvalCounts,
  cropKey,
  EVAL_SERIES_ALL,
  evaluateCreateReadiness,
  filterEvalItems,
  nextRotation,
} from "../lib/evaluationBuilder";
import {
  EVAL_ALIGN_STORAGE_KEY,
  readLabelTextAlign,
  writeLabelTextAlign,
} from "../lib/labelAlign";
import { decideNextImageIndex } from "../lib/labelNavigation";
import { engineLabelOf, lowercaseLabelOf, predictSignature } from "../lib/ocrCandidates";

const LIST_ROW_HEIGHT = 56;
// 回転連打・画像切替の連続操作でOCRリクエストが多重化しないためのデバウンス
const OCR_DEBOUNCE_MS = 300;

// 評価候補クロップの画像URL（回転はサーバー側でその場適用。rotationがURLへ入るため対象行だけ再取得される）
function cropImageUrl(projectId, item, rotation, maxSide = 0) {
  const params = new URLSearchParams({
    project_id: projectId || "default",
    export_id: item.exportId,
    filename: item.filename,
    rotation: String(rotation || 0),
  });
  if (maxSide > 0) {
    params.set("max_side", String(maxSide));
  }
  return `${API_BASE}/image-builder/evaluation/crop?${params.toString()}`;
}

// 一覧の1行（memo化: 対象行のstate変更時のみ再描画し、1000件でも回転・入力・OCRが全件再描画にならない）
const EvalListRow = memo(function EvalListRow({ projectId, item, state, isCurrent, onSelect, onToggleChecked }) {
  const label = String(state.label || "");
  const rotation = nextRotation(state.rotation, 0);
  const checked = state.checked !== false;
  return (
    <div
      onClick={() => onSelect(item.key)}
      className={`flex h-[52px] cursor-pointer items-center gap-2 rounded-lg border px-2 text-xs ${
        isCurrent ? "border-accent/80 bg-accent/10 ring-1 ring-accent/50" : "border-border/70 bg-card/45 hover:bg-card/70"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleChecked(item.key)}
        title={checked ? "評価対象から外す" : "評価対象にする"}
      />
      {item.exists === false ? (
        <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded border border-danger/50 text-[10px] text-danger">
          なし
        </span>
      ) : (
        <img
          src={cropImageUrl(projectId, item, rotation, 160)}
          alt={item.filename}
          className="h-10 w-16 shrink-0 rounded border border-border/60 bg-card object-contain"
          loading="lazy"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[10px] text-muted" title={`${item.exportId}/${item.filename}`}>
          {item.filename}
          {item.series ? <span className="ml-1">[{item.series}]</span> : null}
          {rotation ? <span className="ml-1 tabular-nums">{rotation}°</span> : null}
        </p>
        <p className={`truncate text-sm ${label.trim() ? "font-semibold text-lime-300" : "text-amber-100"}`}>
          {label.trim() ? label : "未入力"}
        </p>
      </div>
    </div>
  );
});

export default function EvaluationDatasetBuilder({
  projectId,
  stepProgress,
  onStepChange,
  preprocessOverrides = null,
  predictParams = null,
  extraPredictParams = [],
  candidateDict = null,
}) {
  const [items, setItems] = useState([]);
  // 画像単位の編集状態: {label, rotation, checked}。バックエンドの editing_state.json と同期
  const [itemState, setItemState] = useState({});
  const [currentKey, setCurrentKey] = useState("");
  const [seriesFilter, setSeriesFilter] = useState(EVAL_SERIES_ALL);
  const [unlabeledOnly, setUnlabeledOnly] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdResult, setCreatedResult] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const stateLoadedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const labelInputRef = useRef(null);
  const savingRef = useRef(false);

  // ラベル配置（Step5専用キーでプロジェクト単位保存。既存ラベル編集のキーとは混在させない）
  const [labelTextAlign, setLabelTextAlign] = useState("center");
  useEffect(() => {
    setLabelTextAlign(readLabelTextAlign(EVAL_ALIGN_STORAGE_KEY, projectId));
  }, [projectId]);
  function updateLabelTextAlign(value) {
    setLabelTextAlign(value);
    writeLabelTextAlign(EVAL_ALIGN_STORAGE_KEY, projectId, value);
  }

  // ソフトキーボード用（既存ラベル編集と同じ操作。状態はStep5ローカル）
  const [isUppercase, setIsUppercase] = useState(true);

  // 3画像プレビュー・OCR候補（既存ラベル編集と同じ表示部品。取得APIは /api/ocr/preview-file）
  const zoomLevels = [25, 50, 100, 150, 200];
  const [zoomPercent, setZoomPercent] = useState("fit");
  const finalImageRef = useRef(null);
  const [finalImageWidth, setFinalImageWidth] = useState(null);
  const [previewSrc, setPreviewSrc] = useState("");
  const [interimSrc, setInterimSrc] = useState("");
  const [previewMeta, setPreviewMeta] = useState(null);
  const [ocrCandidate, setOcrCandidate] = useState(null);
  const [ocrMeta, setOcrMeta] = useState(null);
  const [extraCandidates, setExtraCandidates] = useState([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [ocrReloadTick, setOcrReloadTick] = useState(0);
  const [rerunFeedback, setRerunFeedback] = useState(null);
  const rerunRequestedRef = useRef(false);
  const rerunFeedbackTimerRef = useRef(null);
  const predictParamsKey = JSON.stringify(predictParams || {});
  const extraParamsKey = JSON.stringify(extraPredictParams || []);

  function setOk(text) {
    setMessage(text);
    setError("");
  }

  function setFail(text) {
    setError(text);
    setMessage("");
  }

  function setRerunFeedbackTimed(kind, durationMs) {
    setRerunFeedback(kind);
    if (rerunFeedbackTimerRef.current) {
      clearTimeout(rerunFeedbackTimerRef.current);
    }
    rerunFeedbackTimerRef.current = setTimeout(() => setRerunFeedback(null), durationMs);
  }

  function finishRerunFeedback(ok) {
    if (!rerunRequestedRef.current) {
      return;
    }
    rerunRequestedRef.current = false;
    setRerunFeedbackTimed(ok ? "success" : "error", ok ? 600 : 1200);
  }

  useEffect(
    () => () => {
      if (rerunFeedbackTimerRef.current) {
        clearTimeout(rerunFeedbackTimerRef.current);
      }
    },
    []
  );

  // 候補（Step4出力マニフェスト）と途中保存状態の読み込み。プロジェクト切替で全て入れ替える
  useEffect(() => {
    let ignore = false;
    stateLoadedRef.current = false;
    setItems([]);
    setItemState({});
    setCurrentKey("");
    setSeriesFilter(EVAL_SERIES_ALL);
    setUnlabeledOnly(false);
    setDatasetName("");
    setCreatedResult(null);
    setMessage("");
    setError("");
    async function load() {
      if (!projectId) return;
      setLoading(true);
      try {
        const [candidates, stateRes] = await Promise.all([
          request(`/image-builder/evaluation/candidates?project_id=${encodeURIComponent(projectId)}`),
          request(`/image-builder/evaluation/state?project_id=${encodeURIComponent(projectId)}`),
        ]);
        if (ignore) return;
        const flat = [];
        for (const exp of candidates?.exports || []) {
          for (const crop of exp.crops || []) {
            flat.push({
              key: cropKey(crop.export_id, crop.filename),
              exportId: crop.export_id,
              filename: crop.filename,
              series: crop.series || "",
              bboxId: crop.bbox_id ?? null,
              exists: crop.exists !== false,
              sourceImage: exp.source_image || "",
              createdAt: exp.created_at || "",
            });
          }
        }
        setItems(flat);
        const saved = stateRes?.state || {};
        setItemState(saved.items && typeof saved.items === "object" ? saved.items : {});
        setSeriesFilter(typeof saved.seriesFilter === "string" ? saved.seriesFilter : EVAL_SERIES_ALL);
        setUnlabeledOnly(Boolean(saved.unlabeledOnly));
        setDatasetName(typeof saved.datasetName === "string" ? saved.datasetName : "");
        const savedCurrent = typeof saved.currentKey === "string" ? saved.currentKey : "";
        setCurrentKey(savedCurrent && flat.some((row) => row.key === savedCurrent) ? savedCurrent : flat[0]?.key || "");
        stateLoadedRef.current = true;
      } catch (e) {
        if (!ignore) {
          setFail(`評価候補の読み込みに失敗しました: ${e.message}`);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [projectId]);

  // 途中保存（editing_state.json）。連続編集をまとめるため800msデバウンス
  useEffect(() => {
    if (!stateLoadedRef.current || !projectId) {
      return undefined;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      persistEditingState().catch(() => {
        // 途中保存失敗は編集継続を妨げない（明示保存・作成時にエラー表示される）
      });
    }, 800);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, itemState, currentKey, seriesFilter, unlabeledOnly, datasetName]);

  function persistEditingState(overrideState = null) {
    return request("/image-builder/evaluation/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        state: overrideState || { items: itemState, currentKey, seriesFilter, unlabeledOnly, datasetName },
      }),
    });
  }

  const seriesOptions = useMemo(() => {
    const set = new Set(items.map((row) => row.series).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const visibleItems = useMemo(
    () => filterEvalItems(items, itemState, { series: seriesFilter, unlabeledOnly }),
    [items, itemState, seriesFilter, unlabeledOnly]
  );
  const counts = useMemo(() => computeEvalCounts(items, itemState), [items, itemState]);
  const readiness = useMemo(() => evaluateCreateReadiness(items, itemState), [items, itemState]);

  const currentItem = useMemo(() => items.find((row) => row.key === currentKey) || null, [items, currentKey]);
  const currentState = (currentItem && itemState[currentItem.key]) || {};
  const currentRotation = nextRotation(currentState.rotation, 0);
  const currentLabel = String(currentState.label || "");

  // 前後移動・保存して次への対象一覧（評価対象チェック済みのみ。フィルタ適用後の表示順）
  const navVisibleKeys = useMemo(
    () => visibleItems.filter((row) => (itemState[row.key] || {}).checked !== false).map((row) => row.key),
    [visibleItems, itemState]
  );
  const navAllKeys = useMemo(
    () => items.filter((row) => (itemState[row.key] || {}).checked !== false).map((row) => row.key),
    [items, itemState]
  );

  const virtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_HEIGHT,
    overscan: 8,
  });

  // 最終画像の実描画幅を追跡（入力欄の幅を追従させる。既存ラベル編集と同一仕様）
  useEffect(() => {
    const img = finalImageRef.current;
    if (!img) {
      setFinalImageWidth(null);
      return undefined;
    }
    const update = () => setFinalImageWidth(renderedImageWidth(img));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(img);
    img.addEventListener("load", update);
    return () => {
      observer.disconnect();
      img.removeEventListener("load", update);
    };
  }, [currentItem?.key, zoomPercent, previewSrc]);

  // OCR候補の取得（/api/ocr/preview-file。回転後の評価画像を入力とし、回転・画像切替はデバウンス）。
  // 古いレスポンスは requestKey ガードで破棄する（画像A実行中に画像Bへ移動してもAの結果を表示しない）
  useEffect(() => {
    if (!currentItem || currentItem.exists === false || !projectId) {
      setPreviewSrc("");
      setInterimSrc("");
      setPreviewMeta(null);
      setOcrCandidate(null);
      setOcrMeta(null);
      setExtraCandidates([]);
      setOcrError("");
      setOcrLoading(false);
      return undefined;
    }
    let cancelled = false;
    const requestKey = `${currentItem.key}|r${currentRotation}`;
    setOcrLoading(true);
    setOcrError("");

    const timer = setTimeout(async () => {
      const buildForm = (fields) => {
        const form = new FormData();
        form.append("project_id", projectId);
        form.append("export_id", currentItem.exportId);
        form.append("filename", currentItem.filename);
        form.append("rotation", String(currentRotation));
        if (preprocessOverrides) {
          form.append("overrides_json", JSON.stringify(preprocessOverrides));
        }
        form.append("engine", String(fields?.engine || "custom"));
        form.append("model", String(fields?.model || "latest"));
        if (fields?.model_type) {
          form.append("model_type", String(fields.model_type));
        }
        form.append("easyocr_langs", String(fields?.easyocr_langs || "en"));
        form.append("include_lowercase", String(fields?.include_lowercase !== false));
        return form;
      };
      const callPreview = async (fields) => {
        const res = await fetch(`${API_BASE}/api/ocr/preview-file`, { method: "POST", body: buildForm(fields) });
        if (!res.ok) {
          throw new Error((await res.text()) || "OCR候補の取得に失敗しました");
        }
        return res.json();
      };

      // 比較スロット（モデル2/3）も同時に推論する。重複設定はスキップし、失敗は行単位で保持（既存仕様）
      const seenSignatures = new Set([predictSignature(predictParams || {})]);
      const extraPromise = Promise.all(
        (extraPredictParams || []).map(async (fields) => {
          const signature = predictSignature(fields);
          if (seenSignatures.has(signature)) {
            return { skipped: true, engine: fields?.engine || "", modelName: "" };
          }
          seenSignatures.add(signature);
          try {
            const d = await callPreview(fields);
            const prediction = String(d?.prediction || "").trim();
            return {
              prediction,
              confidence: typeof d?.confidence === "number" ? d.confidence : null,
              engine: d?.predict_engine || fields?.engine || "",
              modelName: d?.predict_model_name || "",
              error: !prediction && d?.predict_error ? String(d.predict_error) : "",
            };
          } catch (err) {
            return { error: String(err?.message || err), engine: fields?.engine || "", modelName: "" };
          }
        })
      );

      try {
        const data = await callPreview(predictParams || {});
        if (cancelled) return;
        setPreviewSrc(data?.processed_data_url || "");
        setInterimSrc(data?.interim_data_url || "");
        setPreviewMeta({ type: data?.type || "", ratio: data?.ratio });
        const prediction = String(data?.prediction || "").trim();
        setOcrCandidate(
          prediction
            ? {
                text: prediction,
                confidence: typeof data?.confidence === "number" ? data.confidence : null,
                engine: data?.predict_engine || "",
              }
            : null
        );
        setOcrMeta({
          engine: data?.predict_engine || predictParams?.engine || "",
          modelName: data?.predict_model_name || "",
        });
        const rerunFailed = !prediction && Boolean(data?.predict_error);
        if (rerunFailed) {
          setOcrError(String(data.predict_error));
        }
        finishRerunFeedback(!rerunFailed);
      } catch (err) {
        if (cancelled) return;
        setPreviewSrc("");
        setInterimSrc("");
        setPreviewMeta(null);
        setOcrCandidate(null);
        setOcrMeta({ engine: predictParams?.engine || "", modelName: "" });
        setOcrError(String(err?.message || err || "不明なエラー"));
        finishRerunFeedback(false);
      } finally {
        if (!cancelled) {
          setOcrLoading(false);
        }
      }
      const extras = await extraPromise;
      if (!cancelled) {
        setExtraCandidates(extras);
      }
    }, OCR_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // requestKey は currentItem.key + rotation の合成（依存はその構成要素で表現）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem?.key, currentItem?.exists, currentRotation, projectId, predictParamsKey, extraParamsKey, ocrReloadTick]);

  // 辞書からの近似候補（既存ラベル編集と同じ純ロジック・同じ設定を使用）
  const dictionaryCandidates = useMemo(() => {
    const entries = candidateDict?.entries || [];
    if (entries.length === 0) {
      return null;
    }
    const sources = [];
    if (ocrCandidate?.text) {
      sources.push({ text: ocrCandidate.text, source: engineLabelOf(ocrMeta?.engine) });
    }
    for (const item of extraCandidates || []) {
      if (item?.prediction) {
        sources.push({ text: item.prediction, source: engineLabelOf(item.engine) });
      }
    }
    return searchDictionaryCandidates(sources, entries, {
      maxCandidates: candidateDict?.max_candidates ?? 3,
      minSimilarity: (candidateDict?.min_similarity ?? 60) / 100,
    });
  }, [candidateDict, ocrCandidate, extraCandidates, ocrMeta]);

  function patchItemState(key, patch) {
    setItemState((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
  }

  function setCurrentLabel(text) {
    if (!currentItem) return;
    patchItemState(currentItem.key, { label: text });
  }

  function adoptText(text) {
    if (text) {
      setCurrentLabel(text);
      labelInputRef.current?.focus();
    }
  }

  // Esc: 最上位の有効候補を採用（モデル1が有効ならモデル1、無ければモデル2/3の先頭の有効候補）
  function adoptTopCandidate() {
    const top = ocrCandidate?.text || extraCandidates.find((c) => c?.prediction)?.prediction || "";
    adoptText(top);
  }

  function rotateCurrent(delta) {
    if (!currentItem || currentItem.exists === false) return;
    patchItemState(currentItem.key, { rotation: nextRotation(currentState.rotation, delta) });
  }

  // 保存: editing_state を即時flushする（失敗時はfalseを返し、保存して次へは移動しない）
  async function saveCurrentLabel() {
    if (!currentItem) return false;
    try {
      await persistEditingState();
      setOk(`保存しました: ${currentItem.filename}`);
      return true;
    } catch (e) {
      setFail(`ラベル保存に失敗しました: ${e.message}`);
      return false;
    }
  }

  // 保存して次へ: 保存前に表示一覧から次画像を確定→保存成功後に移動（既存labelNavigationを共通利用。
  // 未入力のみ表示で保存後に現在画像が一覧から消えても1件飛ばさない）
  async function saveAndNext() {
    if (savingRef.current || !currentItem) return;
    savingRef.current = true;
    try {
      const nextIndex = decideNextImageIndex(navAllKeys, navVisibleKeys, currentItem.key);
      const saved = await saveCurrentLabel();
      if (!saved) {
        return; // 保存失敗時は現在画像に留まる
      }
      if (nextIndex !== null) {
        setCurrentKey(navAllKeys[nextIndex]);
        labelInputRef.current?.focus();
      }
    } finally {
      savingRef.current = false;
    }
  }

  // 前へ/次へ: 表示中（フィルタ適用後）の評価対象一覧内で移動（Series外へ移動しない）
  function moveBy(deltaStep) {
    if (navVisibleKeys.length === 0) return;
    const index = navVisibleKeys.indexOf(currentKey);
    const base = index >= 0 ? index : 0;
    const next = Math.max(0, Math.min(navVisibleKeys.length - 1, base + deltaStep));
    setCurrentKey(navVisibleKeys[next]);
  }

  // ショートカット（既存ラベル編集と同一の共通hook）
  useLabelingShortcuts({
    onSave: saveCurrentLabel,
    onPrev: () => moveBy(-1),
    onNext: () => moveBy(1),
    onSaveAndNext: saveAndNext,
    onAdoptTopCandidate: adoptTopCandidate,
    dictionaryCandidates,
    onAdoptText: adoptText,
  });

  async function createDataset() {
    const targets = items.filter((row) => (itemState[row.key] || {}).checked !== false);
    if (targets.length === 0) {
      setFail("評価対象画像がありません");
      return;
    }
    if (readiness.unlabeled > 0) {
      setFail(`未入力の正解ラベルが${readiness.unlabeled}件あります。`);
      return;
    }
    if (readiness.missing > 0) {
      setFail(`出力フォルダの画像が${readiness.missing}件見つかりません。評価対象から外してください。`);
      return;
    }
    setCreating(true);
    try {
      const payload = {
        project_id: projectId,
        dataset_name: datasetName,
        items: targets.map((row) => ({
          export_id: row.exportId,
          filename: row.filename,
          label: String((itemState[row.key] || {}).label || ""),
          rotation: nextRotation((itemState[row.key] || {}).rotation, 0),
          series: row.series,
          source_image: row.sourceImage,
          bbox_id: row.bboxId,
        })),
        editing_state: { items: itemState, currentKey, seriesFilter, unlabeledOnly, datasetName },
      };
      const data = await request("/image-builder/evaluation/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setCreatedResult(data);
      setOk(`評価用データを${data.image_count}件作成しました: ${data.dataset_id}`);
    } catch (e) {
      setFail(`評価データセット作成に失敗しました: ${e.message}`);
    } finally {
      setCreating(false);
    }
  }

  const rawModelName = String(ocrMeta?.modelName || "");
  const isLatestModel = String(predictParams?.model || "") === "latest";
  const modelDisplay =
    String(ocrMeta?.engine || "").toLowerCase() === "easyocr"
      ? "--"
      : isLatestModel
        ? "最新モデル"
        : rawModelName || String(predictParams?.model || "--");

  return (
    <div className="flex h-[calc(100vh-238px)] min-h-[560px] flex-col gap-2">
      {/* Stepナビ（既存と同形式） */}
      <div className="grid shrink-0 grid-cols-5 gap-2 rounded-xl border border-border bg-card/45 p-2">
        {stepProgress.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={() => onStepChange(step.id)}
            className={`rounded-lg border px-2 py-1 text-center text-xs font-semibold ${
              step.id === 5
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

      <div className="flex min-h-0 flex-1 gap-2">
        {/* 左: 評価対象画像一覧（仮想スクロール） */}
        <div className="flex w-[280px] shrink-0 flex-col gap-1.5 rounded-xl border border-border bg-card/45 p-2">
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px]">
            <select className="app-select h-6 min-w-0 flex-1 py-0 text-[11px]" value={seriesFilter} onChange={(e) => setSeriesFilter(e.target.value)}>
              <option value={EVAL_SERIES_ALL}>All ({items.length})</option>
              {seriesOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <label className="inline-flex shrink-0 items-center gap-1 text-text">
              <input type="checkbox" checked={unlabeledOnly} onChange={(e) => setUnlabeledOnly(e.target.checked)} />
              未のみ
            </label>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-6 flex-1 px-1 text-[10px]"
              onClick={() =>
                setItemState((prev) => {
                  const next = { ...prev };
                  visibleItems.forEach((row) => {
                    next[row.key] = { ...(next[row.key] || {}), checked: true };
                  });
                  return next;
                })
              }
              disabled={visibleItems.length === 0}
            >
              すべて選択
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-6 flex-1 px-1 text-[10px]"
              onClick={() =>
                setItemState((prev) => {
                  const next = { ...prev };
                  visibleItems.forEach((row) => {
                    next[row.key] = { ...(next[row.key] || {}), checked: false };
                  });
                  return next;
                })
              }
              disabled={visibleItems.length === 0}
            >
              すべて解除
            </Button>
          </div>
          <div ref={scrollRef} className="dark-scroll min-h-0 flex-1 overflow-y-auto">
            {visibleItems.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted">
                {loading ? "読み込み中..." : items.length === 0 ? "評価候補がありません（Step4でクロップ出力してください）" : "フィルタ一致なし"}
              </p>
            ) : (
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const item = visibleItems[virtualRow.index];
                  return (
                    <div
                      key={item.key}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="py-0.5"
                    >
                      <EvalListRow
                        projectId={projectId}
                        item={item}
                        state={itemState[item.key] || {}}
                        isCurrent={item.key === currentKey}
                        onSelect={setCurrentKey}
                        onToggleChecked={(key) =>
                          setItemState((prev) => ({
                            ...prev,
                            [key]: { ...(prev[key] || {}), checked: (prev[key] || {}).checked === false },
                          }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <p className="shrink-0 text-right text-[10px] text-muted">
            表示 {visibleItems.length} / {items.length}
          </p>
        </div>

        {/* 中央: 3画像（元/中間/最終）+ 現在のラベル + OCR候補 + 辞書候補（既存ラベル編集と同構成） */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card/60 p-2 backdrop-blur-md">
            <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2 px-1">
              <p className="truncate text-xs font-semibold text-text">
                {currentItem ? currentItem.filename : "画像未選択"}
                {previewMeta?.type ? <span className="ml-2 font-normal text-muted">種別: {previewMeta.type}</span> : null}
                {previewMeta?.ratio !== undefined && previewMeta?.ratio !== null ? (
                  <span className="ml-2 font-normal text-muted">比率: {previewMeta.ratio}</span>
                ) : null}
              </p>
              <div className="flex items-center gap-1">
                <span className="mr-1 text-[11px] text-muted">倍率（3画像共通）</span>
                <Button
                  size="sm"
                  variant={zoomPercent === "fit" ? "primary" : "secondary"}
                  className="h-6 px-1.5 text-[11px]"
                  onClick={() => setZoomPercent("fit")}
                  title="3画像を表示領域内へ自動フィットします"
                >
                  自動
                </Button>
                {zoomLevels.map((level) => (
                  <Button
                    key={level}
                    size="sm"
                    variant={zoomPercent === level ? "primary" : "secondary"}
                    className="h-6 px-1.5 text-[11px]"
                    onClick={() => setZoomPercent(level)}
                  >
                    {level}%
                  </Button>
                ))}
              </div>
            </div>
            <div
              className={`min-h-0 flex-1 rounded-lg border border-border bg-[#3b444f]/40 p-2 ${
                zoomPercent === "fit" ? "flex flex-col gap-2 overflow-hidden" : "space-y-2 overflow-auto"
              }`}
            >
              <StageImage
                title="元画像"
                description="評価用画像（ユーザー回転適用後）。OCR前処理はこの画像を入力とします"
                src={currentItem && currentItem.exists !== false ? cropImageUrl(projectId, currentItem, currentRotation) : ""}
                zoomPercent={zoomPercent}
              />
              <StageImage
                title="中間画像"
                description="主要な前処理を適用した途中確認画像（前処理設定により最終画像と同一になる場合があります）"
                src={interimSrc}
                zoomPercent={zoomPercent}
              />
              <StageImage
                title="最終画像"
                description="OCR推論へ入力される最終処理画像"
                src={previewSrc}
                zoomPercent={zoomPercent}
                imgRef={finalImageRef}
              />
            </div>
          </div>

          <div className="dark-scroll max-h-[46%] shrink-0 overflow-y-auto rounded-xl border border-border bg-card/60 p-2 backdrop-blur-md">
            <LabelMainInput
              value={currentLabel}
              onChange={setCurrentLabel}
              onSubmit={saveAndNext}
              align={labelTextAlign}
              onAlignChange={updateLabelTextAlign}
              widthPx={finalImageWidth}
              inputRef={labelInputRef}
            />

            <div className="mb-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">OCR候補</p>
                <div className="flex items-center gap-2">
                  <span className="hidden text-[10px] text-muted lg:inline">
                    差分は<span className="text-amber-300">黄色</span> / Escで最上位の有効候補を採用
                  </span>
                  <OcrRerunButton
                    loading={ocrLoading}
                    feedback={rerunFeedback}
                    onClick={() => {
                      rerunRequestedRef.current = true;
                      setRerunFeedbackTimed("press", 300);
                      setOcrReloadTick((prev) => prev + 1);
                    }}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                {ocrCandidate?.text ? (
                  <CandidateRow
                    index={1}
                    engine={ocrMeta?.engine}
                    modelName={rawModelName || (modelDisplay !== "--" ? modelDisplay : "")}
                    prediction={ocrCandidate.text}
                    confidence={ocrCandidate.confidence}
                    current={currentLabel}
                    onAdopt={adoptText}
                    dimmed={ocrLoading}
                    lowercaseLabel={lowercaseLabelOf(predictParams)}
                  />
                ) : ocrLoading ? (
                  <CandidateMessageRow index={1} header={engineLabelOf(predictParams?.engine)} message="OCR実行中..." />
                ) : ocrError ? (
                  <CandidateMessageRow
                    index={1}
                    header={engineLabelOf(ocrMeta?.engine)}
                    message={`OCR候補取得失敗: ${ocrError}（推論設定を確認してください）`}
                    tone="danger"
                  />
                ) : (
                  <CandidateMessageRow index={1} header={engineLabelOf(ocrMeta?.engine)} message="OCR候補なし" />
                )}
                {[0, 1].map((slotIndex) => {
                  const rowIndex = slotIndex + 2;
                  if (slotIndex >= (extraPredictParams?.length || 0)) {
                    return (
                      <CandidateMessageRow key={rowIndex} message="比較スロット未設定（前処理設定画面で追加できます）" tone="empty" />
                    );
                  }
                  const item = extraCandidates?.[slotIndex];
                  const headerText =
                    item?.engine || item?.modelName
                      ? `${engineLabelOf(item.engine)}${item.modelName ? ` / ${item.modelName}` : ""}`
                      : engineLabelOf(extraPredictParams[slotIndex]?.engine);
                  if (item?.prediction) {
                    return (
                      <CandidateRow
                        key={rowIndex}
                        index={rowIndex}
                        engine={item.engine}
                        modelName={item.modelName}
                        prediction={item.prediction}
                        confidence={item.confidence}
                        current={currentLabel}
                        onAdopt={adoptText}
                        dimmed={ocrLoading}
                        lowercaseLabel={lowercaseLabelOf(extraPredictParams[slotIndex])}
                      />
                    );
                  }
                  if (ocrLoading) {
                    return <CandidateMessageRow key={rowIndex} index={rowIndex} header={headerText} message="OCR実行中..." />;
                  }
                  if (item?.skipped) {
                    return (
                      <CandidateMessageRow key={rowIndex} index={rowIndex} header={headerText} message="同一設定のためスキップ" tone="amber" />
                    );
                  }
                  if (item?.error) {
                    return <CandidateMessageRow key={rowIndex} index={rowIndex} header={headerText} message={item.error} tone="danger" />;
                  }
                  return <CandidateMessageRow key={rowIndex} index={rowIndex} header={headerText} message="OCR候補なし" />;
                })}
              </div>

              <DictionaryCandidatesSection
                dictionaryCandidates={dictionaryCandidates}
                sourceName={candidateDict?.source_name}
                loading={ocrLoading}
                onAdopt={adoptText}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" className="px-6" onClick={saveAndNext} title="ラベルを保存して次の画像へ (Enter)">
                保存して次へ
              </Button>
              <Button variant="secondary" onClick={saveCurrentLabel} title="ラベルを保存 (Ctrl+S)">
                保存
              </Button>
              <Button variant="secondary" onClick={() => moveBy(-1)} title="前の画像へ (Ctrl+←)">
                前へ
              </Button>
              <Button variant="secondary" onClick={() => moveBy(1)} title="次の画像へ (Ctrl+→)">
                次へ
              </Button>
              <span className="ml-auto hidden text-[11px] text-muted xl:inline">
                Enter=保存して次へ / Ctrl+S=保存 / Ctrl+←→=移動 / Esc=候補採用 / Alt+1〜3=辞書候補
              </span>
            </div>

            <SoftKeyboardPanel
              isUppercase={isUppercase}
              onAppendChar={(ch) => setCurrentLabel(currentLabel + ch)}
              onBackspace={() => setCurrentLabel(currentLabel.slice(0, -1))}
              onClear={() => setCurrentLabel("")}
              onToggleCase={() => setIsUppercase((prev) => !prev)}
            />
          </div>
        </div>

        {/* 右: 評価画像情報・回転・データセット作成 */}
        <div className="flex w-[280px] shrink-0 flex-col gap-2 rounded-xl border border-border bg-card/45 p-3 text-xs">
          <p className="text-[11px] font-semibold text-muted">評価画像情報</p>
          {currentItem ? (
            <>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-muted">ファイル名</span>
                <span className="min-w-0 truncate font-mono text-text" title={`${currentItem.exportId}/${currentItem.filename}`}>
                  {currentItem.filename}
                </span>
                <span className="text-muted">Series</span>
                <span className="text-text">{currentItem.series || "-"}</span>
                <span className="text-muted">元画像</span>
                <span className="min-w-0 truncate text-text" title={currentItem.sourceImage}>
                  {currentItem.sourceImage || "-"}
                </span>
                <span className="text-muted">回転</span>
                <span className="tabular-nums text-text">{currentRotation}°</span>
              </div>
              {/* 回転は評価用コピーへのみ反映（Step4の学習画像は変更しない）。回転後にOCR候補は自動再取得 */}
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => rotateCurrent(90)} disabled={currentItem.exists === false}>
                  ↻ 90°
                </Button>
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => rotateCurrent(180)} disabled={currentItem.exists === false}>
                  ↺ 180°
                </Button>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-text">
                <input
                  type="checkbox"
                  checked={currentState.checked !== false}
                  onChange={() => patchItemState(currentItem.key, { checked: currentState.checked === false })}
                />
                この画像を評価対象にする
              </label>
              {currentItem.exists === false ? (
                <p className="text-danger">画像ファイルが見つかりません（出力フォルダを確認してください）</p>
              ) : null}
            </>
          ) : (
            <p className="text-muted">{loading ? "評価候補を読み込み中..." : "一覧から画像を選択してください"}</p>
          )}

          <div className="mt-auto space-y-2 border-t border-border/60 pt-2">
            <div>
              <label className="app-label">データセット名</label>
              <input
                className="app-input h-7 py-0 font-mono text-xs"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="未入力は日時で自動命名"
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={createDataset}
              disabled={!readiness.ok || creating}
              title={
                readiness.unlabeled > 0
                  ? `未入力の正解ラベルが${readiness.unlabeled}件あります。`
                  : readiness.missing > 0
                    ? "出力フォルダに見つからない画像があります"
                    : undefined
              }
            >
              {creating ? "作成中..." : "正解CSVを作成"}
            </Button>
            {counts.unlabeled > 0 ? (
              <p className="text-[11px] text-amber-100">
                未入力の正解ラベルが{counts.unlabeled}件あります。
                <button type="button" className="ml-1 underline" onClick={() => setUnlabeledOnly(true)}>
                  未入力のみ表示
                </button>
              </p>
            ) : null}
            {createdResult ? (
              <p className="truncate text-[11px] text-emerald-200" title={createdResult.dataset_dir}>
                作成完了: {createdResult.dataset_id}（{createdResult.image_count}件）
              </p>
            ) : null}
            <Button size="sm" variant="secondary" className="w-full" onClick={() => onStepChange(4)}>
              Step4へ戻る
            </Button>
          </div>
        </div>
      </div>

      {/* 下: ステータスバー */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs tabular-nums">
        <span>
          評価対象 <span className="font-semibold text-text">{counts.target}</span>
        </span>
        <span>
          登録済み <span className="font-semibold text-emerald-300">{counts.labeled}</span>
        </span>
        <span>
          未入力 <span className={`font-semibold ${counts.unlabeled > 0 ? "text-amber-300" : "text-text"}`}>{counts.unlabeled}</span>
        </span>
        <span>
          回転済み <span className="font-semibold text-text">{counts.rotated}</span>
        </span>
        {readiness.missing > 0 ? <span className="text-danger">画像なし {readiness.missing}</span> : null}
        {(message || error) && (
          <span className={`ml-auto min-w-0 truncate ${error ? "text-danger" : "text-success"}`} title={error || message}>
            {error || message}
          </span>
        )}
      </div>
    </div>
  );
}
