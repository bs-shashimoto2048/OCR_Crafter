import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  buildDirectoryItems,
  computeEvalCounts,
  cropKey,
  EVAL_SERIES_ALL,
  evaluateCreateReadiness,
  filterEvalItems,
  nextRotation,
} from "../lib/evaluationBuilder";
import { buildOcrRunKey, createLruCache, shouldAutoRunOcr } from "../lib/evalOcrRun";
import {
  evalOcrSlotRequestFields,
  migrateEvalOcrSlots,
  normalizeEvalOcrSlot,
  readEvalOcrAutoRun,
  readEvalOcrSlots,
  writeEvalOcrAutoRun,
  writeEvalOcrSlots,
} from "../lib/evalOcrSettings";
import {
  DEFAULT_EVAL_PREPROCESS,
  EVAL_BINARIZE_METHODS,
  evalPreprocessRequestJson,
  readEvalPreprocess,
  writeEvalPreprocess,
} from "../lib/evalPreprocess";
import {
  EVAL_ALIGN_STORAGE_KEY,
  readLabelTextAlign,
  writeLabelTextAlign,
} from "../lib/labelAlign";
import { decideNextImageIndex } from "../lib/labelNavigation";
import { lowercaseToggleApplicable } from "../lib/lowercase";
import { engineLabelOf, lowercaseLabelOf, predictSignature } from "../lib/ocrCandidates";

const LIST_ROW_HEIGHT = 56;
// 回転連打・前処理変更の連続操作でプレビュー/自動OCRリクエストが多重化しないためのデバウンス
const OCR_DEBOUNCE_MS = 300;
// 一覧行memoを壊さないための共通空state（`|| {}` は毎レンダー新オブジェクトになり全行再描画の原因になる）
const EMPTY_ROW_STATE = Object.freeze({});
// フロント側OCR結果キャッシュの上限（画像を行き来したとき同一条件なら即表示）
const OCR_RESULT_CACHE_LIMIT = 30;

// 評価候補画像のURL（回転はサーバー側でその場適用。rotationがURLへ入るため対象行だけ再取得される）
// Step4クロップ=マニフェスト解決 / フォルダ画像=フォルダ直下のみ解決
function cropImageUrl(projectId, item, rotation, maxSide = 0) {
  const params = new URLSearchParams();
  let endpoint = "/image-builder/evaluation/crop";
  if (item.source === "directory") {
    endpoint = "/image-builder/evaluation/directory-image";
    params.set("directory", item.directory || "");
    params.set("filename", item.filename);
  } else {
    params.set("project_id", projectId || "default");
    params.set("export_id", item.exportId);
    params.set("filename", item.filename);
  }
  params.set("rotation", String(rotation || 0));
  if (maxSide > 0) {
    params.set("max_side", String(maxSide));
  }
  return `${API_BASE}${endpoint}?${params.toString()}`;
}

// 一覧・情報パネルで使うフルパス表示（Step4=export_id/ファイル名、フォルダ=フォルダ\ファイル名）
function itemSourceTitle(item) {
  return item.source === "directory" ? `${item.directory || ""}\\${item.filename}` : `${item.exportId}/${item.filename}`;
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
        <p className="truncate font-mono text-[10px] text-muted" title={itemSourceTitle(item)}>
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
  candidateDict = null,
  onOpenEvaluation = null,
  paddleModels = [],
  tesseractModels = [],
}) {
  // 評価画像の取得方法: step4=Step4出力（従来動作） / directory=任意フォルダ
  const [sourceMode, setSourceMode] = useState("step4");
  const [step4Items, setStep4Items] = useState([]);
  const [directoryPath, setDirectoryPath] = useState("");
  const [directoryItems, setDirectoryItems] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const items = sourceMode === "directory" ? directoryItems : step4Items;
  // 画像単位の編集状態: {label, rotation, checked}。バックエンドの editing_state.json と同期
  // （キーは step4=<export_id>/<filename> / directory=__dir__/<filename> で衝突しない）
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
  // OCR結果はフロント側LRUキャッシュへ「実行条件キー」単位で保持し、表示はキー一致分のみ。
  // 画像・回転・前処理・スロット設定が変わると自動でキャッシュミス=「要再実行」表示になる
  const resultsCacheRef = useRef(createLruCache(OCR_RESULT_CACHE_LIMIT));
  const [resultsVersion, setResultsVersion] = useState(0);
  // フェッチ全体が失敗した場合の一時表示（LRUへは入れずOCR再実行で自然にリトライさせる）
  const [transientResults, setTransientResults] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const ocrAbortRef = useRef(null);
  const previewAbortRef = useRef(null);
  const [rerunFeedback, setRerunFeedback] = useState(null);
  const rerunRequestedRef = useRef(false);
  const rerunFeedbackTimerRef = useRef(null);
  // 回転ボタンの押下フィードバック（90/180。300msで消灯）
  const [rotateFlash, setRotateFlash] = useState(null);
  const rotateFlashTimerRef = useRef(null);

  // Step5専用OCR設定（最大3モデル。ラベル編集の推論設定とは独立し localStorage 別キーへ保存。
  // 旧単一設定キー ocr_eval_preview_settings_by_project_v1 は読み込み時にモデル1へ自動移行）
  const [ocrSlots, setOcrSlots] = useState(() => migrateEvalOcrSlots(null, null));
  // 「画像切替・回転後にOCRを自動実行」（既定ON・保存済みfalseは尊重。連続操作終了後に1回だけ実行）
  const [ocrAutoRun, setOcrAutoRun] = useState(true);
  // Step5専用OCR前処理（グレースケール・二値化。OCR候補生成用の推論入力にのみ適用し、
  // 評価用画像・作成データセット・学習画像へは反映しない）
  const [evalPreprocess, setEvalPreprocess] = useState({ ...DEFAULT_EVAL_PREPROCESS });
  useEffect(() => {
    setOcrSlots(readEvalOcrSlots(projectId));
    setOcrAutoRun(readEvalOcrAutoRun(projectId));
    setEvalPreprocess(readEvalPreprocess(projectId));
  }, [projectId]);
  // stateは入力途中の値をそのまま保持（空欄が即既定値へ戻ると編集できないため）。
  // 正規化は保存時とリクエスト生成時に行う
  function updateOcrSlot(index, patch) {
    setOcrSlots((prev) => {
      const next = prev.map((slot, i) => (i === index ? { ...slot, ...patch } : slot));
      writeEvalOcrSlots(projectId, next);
      return next;
    });
  }
  function updateEvalPreprocess(patch) {
    setEvalPreprocess((prev) => {
      const next = { ...prev, ...patch };
      writeEvalPreprocess(projectId, next);
      return next;
    });
  }
  // 実行計画: スロット番号順を維持し、有効スロットの実効設定（エンジン非対応項目は既定値へ正規化）で
  // 重複判定する。重複スロットは推論せずスキップ表示のみ
  const slotPlans = useMemo(() => {
    const seen = new Set();
    return ocrSlots.map((slot, index) => {
      const normalized = normalizeEvalOcrSlot(slot);
      if (!normalized.enabled) {
        return { index, enabled: false };
      }
      const fields = evalOcrSlotRequestFields(normalized);
      const signature = predictSignature(fields);
      const duplicate = seen.has(signature);
      seen.add(signature);
      return { index, enabled: true, duplicate, fields };
    });
  }, [ocrSlots]);
  const enabledPlans = useMemo(() => slotPlans.filter((plan) => plan.enabled), [slotPlans]);
  const evalPreprocessJson = useMemo(() => evalPreprocessRequestJson(evalPreprocess), [evalPreprocess]);
  function updateOcrAutoRun(value) {
    setOcrAutoRun(value === true);
    writeEvalOcrAutoRun(projectId, value === true);
  }
  // 有効スロット設定の内容キー（OCR実行条件キーの構成要素）
  const slotFieldsKey = useMemo(() => JSON.stringify(enabledPlans.map((plan) => plan.fields)), [enabledPlans]);

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
      if (rotateFlashTimerRef.current) {
        clearTimeout(rotateFlashTimerRef.current);
      }
    },
    []
  );

  // フォルダ直下の画像一覧を取得して評価候補アイテムへ変換（サブフォルダは対象外）
  async function fetchDirectoryItems(path) {
    const data = await request(`/image-builder/evaluation/directory-images?directory=${encodeURIComponent(path)}`);
    return buildDirectoryItems(data?.directory || path, (data?.images || []).map((row) => row.filename));
  }

  // 候補（Step4出力マニフェスト）と途中保存状態の読み込み。プロジェクト切替で全て入れ替える
  useEffect(() => {
    let ignore = false;
    stateLoadedRef.current = false;
    setSourceMode("step4");
    setStep4Items([]);
    setDirectoryPath("");
    setDirectoryItems([]);
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
        setStep4Items(flat);
        const saved = stateRes?.state || {};
        setItemState(saved.items && typeof saved.items === "object" ? saved.items : {});
        setSeriesFilter(typeof saved.seriesFilter === "string" ? saved.seriesFilter : EVAL_SERIES_ALL);
        setUnlabeledOnly(Boolean(saved.unlabeledOnly));
        setDatasetName(typeof saved.datasetName === "string" ? saved.datasetName : "");
        const savedCurrent = typeof saved.currentKey === "string" ? saved.currentKey : "";
        // 取得方法・フォルダパスを復元（旧stateはsourceModeなし=step4で従来動作）
        const savedMode = saved.sourceMode === "directory" ? "directory" : "step4";
        const savedDir = typeof saved.directoryPath === "string" ? saved.directoryPath : "";
        setSourceMode(savedMode);
        setDirectoryPath(savedDir);
        if (savedMode === "directory" && savedDir) {
          try {
            const dirItems = await fetchDirectoryItems(savedDir);
            if (ignore) return;
            setDirectoryItems(dirItems);
            setCurrentKey(
              savedCurrent && dirItems.some((row) => row.key === savedCurrent) ? savedCurrent : dirItems[0]?.key || ""
            );
          } catch (e) {
            if (ignore) return;
            setFail(`フォルダ画像の読み込みに失敗しました: ${e.message}`);
          }
        } else {
          setCurrentKey(savedCurrent && flat.some((row) => row.key === savedCurrent) ? savedCurrent : flat[0]?.key || "");
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // 変更差分がない場合は書き込まない（不要なJSON化・通信・ファイル書込を避ける）
      if (JSON.stringify(buildEditingState()) === lastSavedStateRef.current) {
        return;
      }
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
  }, [projectId, itemState, currentKey, seriesFilter, unlabeledOnly, datasetName, sourceMode, directoryPath]);

  // 永続化するのはラベル・回転・評価対象・現在画像・フィルタ・データセット名・取得方法のみ。
  // OCR候補・base64画像・ローディング/エラー状態は保存しない
  function buildEditingState() {
    return { items: itemState, currentKey, seriesFilter, unlabeledOnly, datasetName, sourceMode, directoryPath };
  }

  const lastSavedStateRef = useRef("");
  function persistEditingState(overrideState = null) {
    const state = overrideState || buildEditingState();
    const stateText = JSON.stringify(state);
    return request("/image-builder/evaluation/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        state,
      }),
    }).then((res) => {
      lastSavedStateRef.current = stateText;
      return res;
    });
  }

  // 取得方法の切替（各モードの一覧・編集状態は保持し、現在画像だけ切替先の先頭へ移す）
  function switchSourceMode(mode) {
    if (mode === sourceMode) return;
    setSourceMode(mode);
    setSeriesFilter(EVAL_SERIES_ALL);
    setUnlabeledOnly(false);
    const list = mode === "directory" ? directoryItems : step4Items;
    setCurrentKey(list[0]?.key || "");
  }

  // フォルダ選択ダイアログ（既存 /dialogs/select-directory を共通利用）
  async function browseDirectory() {
    try {
      const data = await request("/dialogs/select-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: directoryPath || null }),
      });
      if (data.path) setDirectoryPath(data.path);
    } catch (e) {
      setFail(`フォルダ選択に失敗しました: ${e.message}`);
    }
  }

  // 指定フォルダの画像を一覧化（[画像を読み込む]ボタン）
  async function loadDirectoryImages() {
    const path = directoryPath.trim();
    if (!path) {
      setFail("評価画像フォルダを指定してください");
      return;
    }
    setDirectoryLoading(true);
    try {
      const dirItems = await fetchDirectoryItems(path);
      setDirectoryItems(dirItems);
      setCurrentKey((prev) => (dirItems.some((row) => row.key === prev) ? prev : dirItems[0]?.key || ""));
      setOk(`フォルダから${dirItems.length}件の画像を読み込みました`);
    } catch (e) {
      setDirectoryItems([]);
      setFail(`フォルダ画像の読み込みに失敗しました: ${e.message}`);
    } finally {
      setDirectoryLoading(false);
    }
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
  const currentState = (currentItem && itemState[currentItem.key]) || EMPTY_ROW_STATE;
  const currentRotation = nextRotation(currentState.rotation, 0);
  const currentLabel = String(currentState.label || "");

  // OCR実行条件キー: 画像・回転・Step5専用前処理・有効スロット設定のいずれかが変わると別キーになる
  const runKey = currentItem ? buildOcrRunKey(currentItem.key, currentRotation, evalPreprocessJson, slotFieldsKey) : "";
  // 表示するOCR結果: 実行条件キーに一致するキャッシュ結果（同一条件はAPIを呼ばず即時表示）
  const displayedResults = useMemo(() => {
    if (!runKey) {
      return null;
    }
    const cached = resultsCacheRef.current.get(runKey);
    if (cached) {
      return cached;
    }
    return transientResults && transientResults.key === runKey ? transientResults.results : null;
    // resultsVersion はキャッシュ更新の通知用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, resultsVersion, transientResults]);
  // 自動OCRが発火予定か（キャッシュヒット時は発火しない）。プレビュー二重取得の回避と
  // 「認識中...」表示の判定に使う
  const willAutoRun = shouldAutoRunOcr({
    autoRun: ocrAutoRun,
    hasItem: Boolean(currentItem),
    itemExists: currentItem?.exists,
    enabledCount: enabledPlans.length,
    hasCachedResult: Boolean(displayedResults),
  });

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
  // バッチAPI用フォーム（plans=[] でプレビューのみ=OCR推論なし）
  function buildBatchFormFor(item, rotation, plans, includeImages = true) {
    const form = new FormData();
    form.append("project_id", projectId);
    if (item.source === "directory") {
      form.append("source_directory", item.directory || "");
    } else {
      form.append("export_id", item.exportId);
    }
    form.append("filename", item.filename);
    form.append("rotation", String(rotation));
    if (preprocessOverrides) {
      form.append("overrides_json", JSON.stringify(preprocessOverrides));
    }
    // Step5専用OCR前処理（グレースケール・二値化）。空文字=未指定（従来動作）
    if (evalPreprocessJson) {
      form.append("eval_preprocess_json", evalPreprocessJson);
    }
    form.append(
      "slots_json",
      JSON.stringify(plans.filter((plan) => !plan.duplicate).map((plan) => ({ slot: plan.index + 1, ...plan.fields })))
    );
    if (!includeImages) {
      form.append("include_images", "false");
    }
    return form;
  }

  async function fetchBatch(plans, signal) {
    const res = await fetch(`${API_BASE}/api/ocr/preview-file/batch`, {
      method: "POST",
      body: buildBatchFormFor(currentItem, currentRotation, plans),
      signal,
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "OCR候補の取得に失敗しました");
    }
    return res.json();
  }

  // バッチ応答をスロット順の表示行へ変換（重複はスキップ行・行単位エラー保持）
  function mapBatchResults(plans, data) {
    const rows = Array.isArray(data?.results) ? data.results : [];
    return plans.map((plan) => {
      if (plan.duplicate) {
        return { slotIndex: plan.index, fields: plan.fields, skipped: true };
      }
      const row = rows.find((r) => Number(r?.slot) === plan.index + 1) || {};
      const prediction = String(row.prediction || "").trim();
      return {
        slotIndex: plan.index,
        fields: plan.fields,
        prediction,
        confidence: typeof row.confidence === "number" ? row.confidence : null,
        engine: row.engine || plan.fields.engine,
        modelName: row.model_name || "",
        error: row.error ? String(row.error) : "",
      };
    });
  }

  // 中間・最終画像の反映済みキー（画像key+回転+Step5前処理）。OCRバッチが画像も返すため、
  // 自動OCR後にプレビューだけ再取得する無駄なリクエストを防ぐ
  const lastPreviewKeyRef = useRef("");
  const previewKey = currentItem ? JSON.stringify([currentItem.key, currentRotation, evalPreprocessJson]) : "";

  function applyPreviewImages(data, appliedKey) {
    setPreviewSrc(data?.processed_data_url || "");
    setInterimSrc(data?.interim_data_url || "");
    setPreviewMeta({ type: data?.type || "", ratio: data?.ratio });
    lastPreviewKeyRef.current = appliedKey || "";
  }

  // プレビュー更新（前処理のみ・OCR推論なし）。画像切替では元画像・ラベル・回転を即時表示し、
  // 中間・最終画像はここで非同期更新する。連続操作はデバウンスし、旧リクエストはAbortControllerで中止。
  // 自動OCRが発火予定の場合はOCRバッチ応答が画像も運ぶためここでは取得しない（重複リクエスト回避）
  useEffect(() => {
    if (!currentItem || currentItem.exists === false || !projectId) {
      setPreviewSrc("");
      setInterimSrc("");
      setPreviewMeta(null);
      lastPreviewKeyRef.current = "";
      return undefined;
    }
    if (lastPreviewKeyRef.current === previewKey) {
      return undefined; // 反映済み（OCRバッチ応答から適用済みの場合を含む）
    }
    if (willAutoRun) {
      return undefined;
    }
    const controller = new AbortController();
    previewAbortRef.current?.abort();
    previewAbortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchBatch([], controller.signal);
        if (controller.signal.aborted) return;
        applyPreviewImages(data, previewKey);
      } catch {
        if (!controller.signal.aborted) {
          setPreviewSrc("");
          setInterimSrc("");
          setPreviewMeta(null);
        }
      }
    }, OCR_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, currentItem?.exists, projectId, willAutoRun]);

  // OCR再実行（手動または自動ON時）。有効な最大3スロットをバッチAPIへ1リクエストで送り、
  // サーバー側で「前処理1回＋スロット順に逐次推論（同時実行数1）」する。結果はrunKey単位でキャッシュ
  async function runOcr() {
    if (!currentItem || currentItem.exists === false || !projectId || enabledPlans.length === 0 || ocrLoading) {
      return;
    }
    const keyAtStart = runKey;
    const plansAtStart = enabledPlans;
    ocrAbortRef.current?.abort();
    const controller = new AbortController();
    ocrAbortRef.current = controller;
    const previewKeyAtStart = previewKey;
    setOcrLoading(true);
    try {
      const data = await fetchBatch(plansAtStart, controller.signal);
      if (controller.signal.aborted) return;
      // 中間・最終画像はレスポンス直下に1回だけ含まれる（スロット結果へは含めない）
      applyPreviewImages(data, previewKeyAtStart);
      const results = mapBatchResults(plansAtStart, data);
      if (results.every((row) => !row.error)) {
        resultsCacheRef.current.set(keyAtStart, results);
        setResultsVersion((v) => v + 1);
        setTransientResults(null);
        // 性能に余裕があれば次の1画像だけ先読み（キャッシュ作成のみ・UIは変えない）
        prefetchNextOcr(plansAtStart);
      } else {
        // エラーを含む結果はLRUへ入れず一時表示のみ（同一条件でもOCR再実行で再試行できる）
        setTransientResults({ key: keyAtStart, results });
      }
      finishRerunFeedback(results.some((row) => row.prediction));
    } catch (err) {
      if (controller.signal.aborted) return;
      setTransientResults({
        key: keyAtStart,
        results: plansAtStart.map((plan) => ({
          slotIndex: plan.index,
          fields: plan.fields,
          error: String(err?.message || err),
        })),
      });
      finishRerunFeedback(false);
    } finally {
      if (ocrAbortRef.current === controller) {
        setOcrLoading(false);
      }
    }
  }
  const runOcrRef = useRef(runOcr);
  runOcrRef.current = runOcr;

  // 先読み: 現在画像のOCR完了後、表示一覧の次の1画像だけアイドル時にOCR結果キャッシュを作る。
  // 条件: 自動OCR有効・次画像あり・同一条件が未キャッシュ。UI状態は変更しない（キャッシュのみ）。
  // 画像data URLは不要のため include_images=false で転送を削減する
  const prefetchAbortRef = useRef(null);
  function prefetchNextOcr(plans) {
    if (!ocrAutoRun || plans.length === 0) {
      return;
    }
    const index = navVisibleKeys.indexOf(currentKey);
    const nextKey = index >= 0 ? navVisibleKeys[index + 1] : undefined;
    if (!nextKey) {
      return;
    }
    const nextItem = items.find((row) => row.key === nextKey);
    if (!nextItem || nextItem.exists === false) {
      return;
    }
    const nextRot = nextRotation((itemState[nextKey] || {}).rotation, 0);
    const nextRunKey = buildOcrRunKey(nextKey, nextRot, evalPreprocessJson, slotFieldsKey);
    if (resultsCacheRef.current.has(nextRunKey)) {
      return;
    }
    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    // 現在画像の操作を優先するため少し遅らせる（その間に操作が続けば中止される）
    setTimeout(async () => {
      if (controller.signal.aborted) {
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/ocr/preview-file/batch`, {
          method: "POST",
          body: buildBatchFormFor(nextItem, nextRot, plans, false),
          signal: controller.signal,
        });
        if (!res.ok || controller.signal.aborted) {
          return;
        }
        const data = await res.json();
        if (controller.signal.aborted) {
          return;
        }
        const results = mapBatchResults(plans, data);
        if (results.every((row) => !row.error)) {
          resultsCacheRef.current.set(nextRunKey, results);
          setResultsVersion((v) => v + 1);
        }
      } catch {
        // 先読みの失敗は無視（通常の自動OCRで改めて実行される）
      }
    }, 400);
  }

  // 画像・回転・設定の変更時: 実行中のOCRリクエストを中止（古い結果の反映防止・不要な通信の中断）
  useEffect(() => {
    if (ocrAbortRef.current) {
      ocrAbortRef.current.abort();
      ocrAbortRef.current = null;
      setOcrLoading(false);
    }
  }, [runKey]);

  // アンマウント時は進行中の通信を中止する
  useEffect(
    () => () => {
      ocrAbortRef.current?.abort();
      previewAbortRef.current?.abort();
      prefetchAbortRef.current?.abort();
    },
    []
  );

  // 自動実行（既定ON）: 画像選択・前へ/次へ・保存して次へ・90°/180°回転・前処理/OCR設定変更の
  // 連続操作終了後（300msデバウンス）に1回だけ実行。同一条件の結果がキャッシュ済みなら
  // APIを呼ばず即時表示（shouldAutoRunOcrがfalseになる）。古いタイマーはcleanupで破棄
  useEffect(() => {
    if (!willAutoRun) {
      return undefined;
    }
    const timer = setTimeout(() => {
      runOcrRef.current?.();
    }, OCR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [willAutoRun, runKey, resultsVersion]);

  // 辞書からの近似候補（既存ラベル編集と同じ純ロジック・同じ辞書設定を使用。
  // 最大3スロットのOCR結果すべてを入力とし、同一候補は既存ロジック内で最高類似度へ統合される）
  const dictionaryCandidates = useMemo(() => {
    const entries = candidateDict?.entries || [];
    if (entries.length === 0) {
      return null;
    }
    const sources = [];
    for (const plan of enabledPlans) {
      const row = (displayedResults || []).find((r) => r.slotIndex === plan.index);
      if (row?.prediction) {
        sources.push({ text: row.prediction, source: engineLabelOf(row.engine || plan.fields.engine) });
      }
    }
    return searchDictionaryCandidates(sources, entries, {
      maxCandidates: candidateDict?.max_candidates ?? 3,
      minSimilarity: (candidateDict?.min_similarity ?? 60) / 100,
    });
  }, [candidateDict, displayedResults, enabledPlans]);

  function patchItemState(key, patch) {
    setItemState((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
  }

  // 一覧行のチェック切替（useCallbackで安定化し、memo化した行の不要な再描画を防ぐ）
  const handleToggleChecked = useCallback((key) => {
    setItemState((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), checked: (prev[key] || {}).checked === false },
    }));
  }, []);

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

  // Esc: 最上位の有効OCR候補を採用（スロット番号順で最初に成功した候補。Confidence順ではない）
  function adoptTopCandidate() {
    for (const plan of enabledPlans) {
      const row = (displayedResults || []).find((r) => r.slotIndex === plan.index);
      if (row?.prediction) {
        adoptText(row.prediction);
        return;
      }
    }
  }

  function rotateCurrent(delta) {
    if (!currentItem || currentItem.exists === false) return;
    patchItemState(currentItem.key, { rotation: nextRotation(currentState.rotation, delta) });
  }

  // OCR候補ヘッダーの回転ボタン: 回転適用（プレビュー・OCRは自動更新）＋300msの押下発光。
  // 連打時はデバウンス＋cancelledガードで最後の回転状態だけがOCRへ反映される。ラベル入力値は保持
  function rotateWithFeedback(delta) {
    if (!currentItem || currentItem.exists === false) return;
    rotateCurrent(delta);
    setRotateFlash(delta);
    if (rotateFlashTimerRef.current) {
      clearTimeout(rotateFlashTimerRef.current);
    }
    rotateFlashTimerRef.current = setTimeout(() => setRotateFlash(null), 300);
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
        // step4は従来のペイロードのまま（後方互換）。directoryはsource+source_directoryで指定
        items: targets.map((row) =>
          row.source === "directory"
            ? {
                source: "directory",
                source_directory: row.directory,
                filename: row.filename,
                label: String((itemState[row.key] || {}).label || ""),
                rotation: nextRotation((itemState[row.key] || {}).rotation, 0),
              }
            : {
                export_id: row.exportId,
                filename: row.filename,
                label: String((itemState[row.key] || {}).label || ""),
                rotation: nextRotation((itemState[row.key] || {}).rotation, 0),
                series: row.series,
                source_image: row.sourceImage,
                bbox_id: row.bboxId,
              }
        ),
        editing_state: buildEditingState(),
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

  // 候補行のモデル表示（EasyOCR=言語 / それ以外=応答のモデル名 or 設定値）
  function slotModelLabel(fields, responseModelName) {
    if (String(fields?.engine || "") === "easyocr") {
      return String(fields?.easyocr_langs || "en");
    }
    if (responseModelName) {
      return responseModelName;
    }
    return String(fields?.model || "") === "latest" ? "最新モデル" : String(fields?.model || "--");
  }

  // 候補行の付加情報（EasyOCR/PaddleOCR=小文字ON/OFF、Tesseract=PSM）
  function slotInfoLabel(fields) {
    if (String(fields?.engine || "") === "tesseract") {
      return `PSM ${fields?.psm || 7}`;
    }
    return lowercaseLabelOf(fields);
  }

  return (
    // xl以上はビューポート内固定（App fitViewport連携・ページスクロールなし。内部スクロールは左一覧とOCR候補のみ）。
    // xl未満は従来どおりの高さ計算（ページスクロール許容）
    <div className="flex h-[calc(100vh-238px)] min-h-[560px] flex-col gap-2 xl:h-auto xl:min-h-0 xl:flex-1 xl:overflow-hidden">
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

      {/* 評価画像の取得方法（Step4出力=従来動作 / 任意フォルダ=追加機能） */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card/45 px-3 py-2 text-xs">
        <span className="shrink-0 font-semibold text-muted">評価画像の取得方法</span>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-text">
          <input
            type="radio"
            name="eval-source-mode"
            checked={sourceMode === "step4"}
            onChange={() => switchSourceMode("step4")}
          />
          Step4で作成した画像
        </label>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-text">
          <input
            type="radio"
            name="eval-source-mode"
            checked={sourceMode === "directory"}
            onChange={() => switchSourceMode("directory")}
          />
          フォルダから読み込む
        </label>
        {sourceMode === "directory" ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <label className="shrink-0 text-muted">評価画像フォルダ</label>
            <input
              className="app-input h-7 min-w-[200px] flex-1 py-0 font-mono text-xs"
              value={directoryPath}
              onChange={(e) => setDirectoryPath(e.target.value)}
              placeholder="画像フォルダのパス"
            />
            <Button size="sm" variant="secondary" className="h-7" onClick={browseDirectory}>
              参照
            </Button>
            <Button
              size="sm"
              className="h-7"
              onClick={loadDirectoryImages}
              disabled={directoryLoading || !directoryPath.trim()}
            >
              {directoryLoading ? "読み込み中..." : "画像を読み込む"}
            </Button>
            <span className="shrink-0 tabular-nums text-muted">
              画像数 <span className="font-semibold text-text">{directoryItems.length}</span>
            </span>
            <span className="shrink-0 text-[10px] text-muted" title="サブフォルダは対象外です">
              対応形式: PNG / JPG / JPEG / BMP / TIFF / WEBP（サブフォルダ対象外）
            </span>
          </div>
        ) : null}
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
          <div ref={scrollRef} className="dark-scroll min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            {visibleItems.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted">
                {loading || directoryLoading
                  ? "読み込み中..."
                  : items.length === 0
                    ? sourceMode === "directory"
                      ? "フォルダを指定して「画像を読み込む」を押してください"
                      : "評価候補がありません（Step4でクロップ出力してください）"
                    : "フィルタ一致なし"}
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
                        state={itemState[item.key] || EMPTY_ROW_STATE}
                        isCurrent={item.key === currentKey}
                        onSelect={setCurrentKey}
                        onToggleChecked={handleToggleChecked}
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

        {/* 中央: 画像プレビュー(約45%) → OCR候補(約40%・内部スクロール) → 入力欄(内容高さ・常時表示)。
            固定pxではなくflex-basisの割合で残り高さを配分する */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-h-[140px] shrink basis-[45%] flex-col rounded-xl border border-border bg-card/60 p-2 backdrop-blur-md">
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
                description="回転後の評価画像（Step5専用OCR前処理は反映しません。保存されるのはこの画像です）"
                src={currentItem && currentItem.exists !== false ? cropImageUrl(projectId, currentItem, currentRotation) : ""}
                zoomPercent={zoomPercent}
              />
              <StageImage
                title="中間画像"
                description="Step5専用OCR前処理（グレースケール・二値化）を含む途中確認画像"
                src={interimSrc}
                zoomPercent={zoomPercent}
              />
              <StageImage
                title="最終画像"
                description="OCR推論へ実際に渡される最終処理画像"
                src={previewSrc}
                zoomPercent={zoomPercent}
                imgRef={finalImageRef}
              />
            </div>
          </div>

          {/* OCR候補（Step5専用OCR設定で取得。スクロールするのは左一覧とこの領域のみ） */}
          <div className="dark-scroll min-h-[150px] shrink grow basis-[40%] overflow-y-auto rounded-xl border border-border bg-card/60 p-2 backdrop-blur-md [scrollbar-gutter:stable]">
            {/* 見出し行: 回転→OCR候補更新→採用 を1つの視線範囲で完結させる（回転ボタンはここへ集約） */}
            <div className="mb-1 flex h-7 shrink-0 items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">OCR候補</p>
              <div className="flex items-center gap-1.5">
                <span className="hidden text-[10px] text-muted xl:inline">
                  差分は<span className="text-amber-300">黄色</span> / Escで最上位の有効候補を採用
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className={`h-7 px-2 text-[11px] transition-shadow duration-200 ${
                    rotateFlash === 90
                      ? "!border-accent/70 !text-blue-200 shadow-[0_0_0_1px_rgba(96,165,250,0.55),0_0_10px_rgba(96,165,250,0.45)]"
                      : ""
                  }`}
                  onClick={() => rotateWithFeedback(90)}
                  disabled={!currentItem || currentItem.exists === false}
                  title="時計回りに90°回転（評価用コピーへのみ反映。回転後にOCR候補を自動再取得）"
                >
                  ↻ 90°
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className={`h-7 px-2 text-[11px] transition-shadow duration-200 ${
                    rotateFlash === 180
                      ? "!border-violet-400/70 !text-violet-200 shadow-[0_0_0_1px_rgba(167,139,250,0.55),0_0_10px_rgba(167,139,250,0.45)]"
                      : ""
                  }`}
                  onClick={() => rotateWithFeedback(180)}
                  disabled={!currentItem || currentItem.exists === false}
                  title="180°回転（評価用コピーへのみ反映。回転後にOCR候補を自動再取得）"
                >
                  ↺ 180°
                </Button>
                <OcrRerunButton
                  loading={ocrLoading}
                  feedback={rerunFeedback}
                  onClick={() => {
                    rerunRequestedRef.current = true;
                    setRerunFeedbackTimed("press", 300);
                    runOcr();
                  }}
                />
              </div>
            </div>
            {/* 行の出現・消失で高さが揺れないよう最小高さを確保。表示はスロット番号順（Confidence順へ並べ替えない） */}
            <div className="min-h-[44px] space-y-1.5">
              {enabledPlans.length === 0 ? (
                <CandidateMessageRow message="有効なOCRモデルがありません（評価データOCR設定で有効化してください）" tone="empty" />
              ) : ocrLoading || willAutoRun ? (
                // 自動OCRの待機・実行中（画像・ラベル入力は通常どおり操作できる）
                enabledPlans.map((plan, order) => (
                  <CandidateMessageRow
                    key={plan.index}
                    index={order + 1}
                    header={`${engineLabelOf(plan.fields.engine)} / ${slotModelLabel(plan.fields, "")}`}
                    message="認識中..."
                  />
                ))
              ) : !displayedResults ? (
                // 自動実行OFF時: 変更後は「要再実行」状態（[OCR再実行]押下で取得）
                <CandidateMessageRow
                  message="設定または画像が変更されました。OCR候補を更新してください（[OCR再実行]を押す）。"
                  tone="amber"
                />
              ) : (
                enabledPlans.map((plan, order) => {
                  const rowIndex = order + 1;
                  const row = displayedResults.find((r) => r.slotIndex === plan.index);
                  const header = `${engineLabelOf(plan.fields.engine)} / ${slotModelLabel(plan.fields, row?.modelName)}`;
                  if (plan.duplicate || row?.skipped) {
                    return (
                      <CandidateMessageRow
                        key={plan.index}
                        index={rowIndex}
                        header={header}
                        message="他のOCR設定と同一のためスキップしました"
                        tone="amber"
                      />
                    );
                  }
                  if (row?.prediction) {
                    return (
                      <CandidateRow
                        key={plan.index}
                        index={rowIndex}
                        engine={row.engine}
                        modelName={slotModelLabel(plan.fields, row.modelName)}
                        prediction={row.prediction}
                        confidence={row.confidence}
                        current={currentLabel}
                        onAdopt={adoptText}
                        dimmed={false}
                        lowercaseLabel={slotInfoLabel(plan.fields)}
                      />
                    );
                  }
                  if (row?.error) {
                    return (
                      <CandidateMessageRow
                        key={plan.index}
                        index={rowIndex}
                        header={header}
                        message={`OCR候補取得失敗: ${row.error}`}
                        tone="danger"
                      />
                    );
                  }
                  return <CandidateMessageRow key={plan.index} index={rowIndex} header={header} message="OCR候補なし" />;
                })
              )}
            </div>

            <DictionaryCandidatesSection
              dictionaryCandidates={dictionaryCandidates}
              sourceName={candidateDict?.source_name}
              loading={ocrLoading}
              onAdopt={adoptText}
            />

            <SoftKeyboardPanel
              isUppercase={isUppercase}
              onAppendChar={(ch) => setCurrentLabel(currentLabel + ch)}
              onBackspace={() => setCurrentLabel(currentLabel.slice(0, -1))}
              onClear={() => setCurrentLabel("")}
              onToggleCase={() => setIsUppercase((prev) => !prev)}
            />
          </div>

          {/* 入力欄+操作ボタン（常時表示・内容高さ） */}
          <div className="shrink-0 rounded-xl border border-border bg-card/60 p-2 backdrop-blur-md">
            <LabelMainInput
              value={currentLabel}
              onChange={setCurrentLabel}
              onSubmit={saveAndNext}
              align={labelTextAlign}
              onAlignChange={updateLabelTextAlign}
              widthPx={finalImageWidth}
              inputRef={labelInputRef}
            />
            <div className="flex h-9 flex-wrap items-center gap-2">
              <Button size="sm" className="h-8 px-6" onClick={saveAndNext} title="ラベルを保存して次の画像へ (Enter)">
                保存して次へ
              </Button>
              <Button size="sm" variant="secondary" className="h-8" onClick={saveCurrentLabel} title="ラベルを保存 (Ctrl+S)">
                保存
              </Button>
              <Button size="sm" variant="secondary" className="h-8" onClick={() => moveBy(-1)} title="前の画像へ (Ctrl+←)">
                前へ
              </Button>
              <Button size="sm" variant="secondary" className="h-8" onClick={() => moveBy(1)} title="次の画像へ (Ctrl+→)">
                次へ
              </Button>
              <span className="ml-auto hidden text-[11px] text-muted xl:inline">
                Enter=保存して次へ / Ctrl+S=保存 / Ctrl+←→=移動 / Esc=候補採用 / Alt+1〜3=辞書候補
              </span>
            </div>
          </div>
        </div>

        {/* 右: 固定幅・内部のみスクロール。画像情報/回転/評価対象/データセット/作成ボタンは常時見える */}
        <div className="flex w-[280px] shrink-0 flex-col rounded-xl border border-border bg-card/45 text-xs">
          <div className="dark-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3 [scrollbar-gutter:stable]">
          <p className="text-[11px] font-semibold text-muted">評価画像情報</p>
          {currentItem ? (
            <>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-muted">ファイル名</span>
                <span className="min-w-0 truncate font-mono text-text" title={itemSourceTitle(currentItem)}>
                  {currentItem.filename}
                </span>
                {currentItem.source === "directory" ? (
                  <>
                    <span className="text-muted">フォルダ</span>
                    <span className="min-w-0 truncate font-mono text-text" title={currentItem.directory}>
                      {currentItem.directory || "-"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-muted">Series</span>
                    <span className="text-text">{currentItem.series || "-"}</span>
                    <span className="text-muted">元画像</span>
                    <span className="min-w-0 truncate text-text" title={currentItem.sourceImage}>
                      {currentItem.sourceImage || "-"}
                    </span>
                  </>
                )}
                <span className="text-muted">回転</span>
                <span className="tabular-nums text-text">{currentRotation}°</span>
              </div>
              {/* 回転ボタンはOCR候補見出しへ移動（ここは現在角度の表示のみ。角度は上の情報グリッドに表示） */}
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

          {/* Step5専用OCR前処理（保存先: ocr_eval_preprocess_settings_by_project_v1。
              OCR候補生成用の推論入力にのみ適用し、評価用画像・作成データには一切反映しない） */}
          <div className="space-y-1.5 border-t border-border/60 pt-2">
            <p className="text-[11px] font-semibold text-muted">評価データOCR前処理</p>
            <p className="text-[10px] leading-4 text-muted">
              OCR候補の生成時だけ適用します。
              <br />
              評価用画像・作成データには反映しません。
            </p>
            <label className="inline-flex h-5 cursor-pointer items-center gap-1.5 text-text">
              <input
                type="checkbox"
                checked={evalPreprocess.grayscale === true}
                onChange={(e) => updateEvalPreprocess({ grayscale: e.target.checked })}
              />
              グレースケール
            </label>
            <label className="inline-flex h-5 cursor-pointer items-center gap-1.5 text-text">
              <input
                type="checkbox"
                checked={evalPreprocess.binarize === true}
                onChange={(e) => updateEvalPreprocess({ binarize: e.target.checked })}
              />
              二値化
            </label>
            {evalPreprocess.binarize ? (
              <div className="space-y-1.5 pl-5">
                <div>
                  <label className="app-label">方式</label>
                  <select
                    className="app-select h-7 py-0 text-xs"
                    value={evalPreprocess.binarizeMethod}
                    onChange={(e) => updateEvalPreprocess({ binarizeMethod: e.target.value })}
                  >
                    {EVAL_BINARIZE_METHODS.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="app-label">しきい値（固定しきい値のみ）</label>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    step={1}
                    className="app-input h-7 py-0 text-xs"
                    value={evalPreprocess.threshold}
                    disabled={evalPreprocess.binarizeMethod !== "fixed"}
                    onChange={(e) => updateEvalPreprocess({ threshold: Number(e.target.value) })}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Step5専用OCR設定（最大3モデル。保存先: ocr_eval_preview_slots_by_project_v1。
              ラベル編集の推論設定とは独立） */}
          <div className="space-y-1.5 border-t border-border/60 pt-2">
            <p className="text-[11px] font-semibold text-muted">評価データOCR設定</p>
            {/* 既定ON（旧バージョンでOFF保存済みの場合は尊重）。連続操作終了後（300msデバウンス）に
                1回だけ実行し、同一条件のキャッシュがあればAPIを呼ばず即時表示する */}
            <label className="inline-flex min-h-5 cursor-pointer items-start gap-1.5 text-[11px] text-text">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={ocrAutoRun === true}
                onChange={(e) => updateOcrAutoRun(e.target.checked)}
              />
              画像切替・回転後にOCRを自動実行
            </label>
            {ocrSlots.map((slot, index) => {
              const engine = slot.engine || "paddleocr";
              const slotLowercaseApplicable = lowercaseToggleApplicable(
                engine,
                engine === "easyocr" || engine === "paddleocr" ? slot.easyocrLangs : "en"
              );
              return (
                <div
                  key={index}
                  className={`space-y-1 rounded-lg border p-1.5 ${
                    slot.enabled ? "border-border/80 bg-card/40" : "border-border/40 opacity-75"
                  }`}
                >
                  <label className="flex h-5 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-text">
                    <input
                      type="checkbox"
                      checked={slot.enabled === true}
                      onChange={(e) => updateOcrSlot(index, { enabled: e.target.checked })}
                    />
                    モデル{index + 1}
                    {!slot.enabled ? <span className="ml-auto text-[10px] font-normal text-muted">無効</span> : null}
                  </label>
                  {slot.enabled ? (
                    <>
                      <div>
                        <label className="app-label">Engine</label>
                        <select
                          className="app-select h-7 py-0 text-xs"
                          value={engine}
                          onChange={(e) => updateOcrSlot(index, { engine: e.target.value })}
                        >
                          <option value="paddleocr">PaddleOCR</option>
                          <option value="tesseract">Tesseract</option>
                          <option value="easyocr">EasyOCR</option>
                        </select>
                      </div>
                      {engine === "paddleocr" ? (
                        <div>
                          <label className="app-label">Model</label>
                          <select
                            className="app-select h-7 py-0 text-xs"
                            value={slot.paddleModel}
                            onChange={(e) => updateOcrSlot(index, { paddleModel: e.target.value })}
                          >
                            <option value="latest">latest（最新）</option>
                            {paddleModels
                              .filter((name) => name !== "latest")
                              .map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                          </select>
                        </div>
                      ) : null}
                      {engine === "tesseract" ? (
                        <>
                          <div>
                            <label className="app-label">Model</label>
                            <select
                              className="app-select h-7 py-0 text-xs"
                              value={slot.tesseractModel}
                              onChange={(e) => updateOcrSlot(index, { tesseractModel: e.target.value })}
                            >
                              <option value="latest">latest（最新）</option>
                              {tesseractModels
                                .filter((name) => name !== "latest")
                                .map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <div>
                            <label className="app-label">PSM（既定7=単一行）</label>
                            <input
                              type="number"
                              min={1}
                              max={13}
                              step={1}
                              className="app-input h-7 py-0 text-xs"
                              value={slot.psm}
                              onChange={(e) => updateOcrSlot(index, { psm: Number(e.target.value) })}
                            />
                          </div>
                        </>
                      ) : null}
                      {engine === "easyocr" || engine === "paddleocr" ? (
                        <div>
                          <label className="app-label">Language（カンマ区切り）</label>
                          <input
                            className="app-input h-7 py-0 font-mono text-xs"
                            value={slot.easyocrLangs}
                            onChange={(e) => updateOcrSlot(index, { easyocrLangs: e.target.value })}
                            placeholder="en"
                          />
                        </div>
                      ) : null}
                      {engine === "tesseract" || engine === "easyocr" ? (
                        <div>
                          <label className="app-label">whitelist（空=既定）</label>
                          <input
                            className="app-input h-7 py-0 font-mono text-xs"
                            value={slot.whitelist}
                            onChange={(e) => updateOcrSlot(index, { whitelist: e.target.value })}
                            placeholder={engine === "tesseract" ? "モデル既定のcharset" : "制限なし（小文字設定に従う）"}
                            title="推論時の探索文字を制限します（Tesseract=whitelist / EasyOCR=allowlist）"
                          />
                        </div>
                      ) : null}
                      {engine === "easyocr" || engine === "paddleocr" ? (
                        <label
                          className={`inline-flex h-5 items-center gap-1.5 ${
                            slotLowercaseApplicable ? "cursor-pointer text-text" : "text-muted"
                          }`}
                          title={slotLowercaseApplicable ? undefined : "ラテン言語設定でのみ有効です"}
                        >
                          <input
                            type="checkbox"
                            disabled={!slotLowercaseApplicable}
                            checked={slot.includeLowercase !== false}
                            onChange={(e) => updateOcrSlot(index, { includeLowercase: e.target.checked })}
                          />
                          小文字を出力に含める
                        </label>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
            <p className="text-[10px] text-muted">前処理: プロジェクト共通のOCR前処理設定＋上の評価データOCR前処理を適用</p>
          </div>
          </div>

          <div className="shrink-0 space-y-2 border-t border-border/60 p-3">
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
              <>
                <p className="truncate text-[11px] text-emerald-200" title={createdResult.dataset_dir}>
                  作成完了: {createdResult.dataset_id}（{createdResult.image_count}件）
                </p>
                {/* 作成したデータセットを自動選択した状態でモデル評価画面を開く（Phase3導線） */}
                {onOpenEvaluation ? (
                  <Button size="sm" className="w-full" onClick={() => onOpenEvaluation(createdResult)}>
                    モデル評価へ
                  </Button>
                ) : null}
              </>
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
