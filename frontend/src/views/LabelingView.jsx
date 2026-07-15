import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../components/Card";
import Button from "../components/Button";
import { imageUrl, processedImageUrl, request } from "../lib/api";
import {
  DICT_FILE_MAX_BYTES,
  parseCandidateDictionary,
  searchDictionaryCandidates,
} from "../lib/candidateDictionary";
import { decideNextImageIndex } from "../lib/labelNavigation";
import { lowercaseToggleApplicable } from "../lib/lowercase";

// 候補ヘッダーへ付ける「小文字: ON/OFF」表示（EasyOCR/PaddleOCR × ラテン言語時のみ）
function lowercaseLabelOf(fields) {
  if (!lowercaseToggleApplicable(fields?.engine, fields?.easyocr_langs)) {
    return "";
  }
  return fields?.include_lowercase !== false ? "小文字: ON" : "小文字: OFF";
}

const keyRows = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

const ENGINE_LABELS = { tesseract: "Tesseract", paddleocr: "PaddleOCR", easyocr: "EasyOCR", custom: "カスタムモデル" };

// 現在のラベルの文字位置（プロジェクト別に localStorage 保存。未設定=中央）
const LABEL_TEXT_ALIGN_STORAGE_KEY = "ocr_label_text_align_by_project_v1";
const LABEL_TEXT_ALIGN_VALUES = new Set(["left", "center", "right"]);
// 配置ボタンの循環順（中央→左→右→中央…）と表示名
const LABEL_TEXT_ALIGN_ORDER = ["center", "left", "right"];
const LABEL_TEXT_ALIGN_LABELS = { center: "中央", left: "左", right: "右" };

function readLabelTextAlign(projectId) {
  try {
    const map = JSON.parse(localStorage.getItem(LABEL_TEXT_ALIGN_STORAGE_KEY) || "{}");
    const value = map?.[projectId];
    return LABEL_TEXT_ALIGN_VALUES.has(value) ? value : "center";
  } catch {
    return "center";
  }
}

function writeLabelTextAlign(projectId, value) {
  try {
    const raw = localStorage.getItem(LABEL_TEXT_ALIGN_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[projectId] = value;
    localStorage.setItem(LABEL_TEXT_ALIGN_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage が使えない環境では保存なしで動作継続
  }
}

function engineLabelOf(engine) {
  return ENGINE_LABELS[String(engine || "").toLowerCase()] || (engine ? String(engine) : "--");
}

// OCR候補と現在ラベルの差分を1文字ずつ色付け表示する。
// highlightClass で差分文字の色を変更できる（既定=黄。辞書候補では蛍光緑を使用）
function DiffText({ candidate, current, highlightClass = "text-amber-300" }) {
  const chars = String(candidate || "").split("");
  const base = String(current || "");
  return (
    <span className="font-mono text-lg font-semibold tracking-wide">
      {chars.map((ch, idx) => (
        <span key={idx} className={ch === base[idx] ? "text-text" : highlightClass}>
          {ch}
        </span>
      ))}
      {base.length > chars.length ? <span className={`opacity-70 ${highlightClass}`}>…</span> : null}
    </span>
  );
}

// 辞書からの近似候補の差分文字色（蛍光緑。軽いグローで注目しやすくする）
const DICT_DIFF_HIGHLIGHT_CLASS = "text-[#adff5d] drop-shadow-[0_0_4px_rgba(173,255,93,0.55)]";

// 右ペイン「現在の前処理設定」のカテゴリ（読み取り専用）。OFF値は薄く表示
function SummarySection({ title, defaultOpen = false, items }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-border bg-card/45">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden="true">
          ▶
        </span>
        {title}
      </summary>
      <div className="space-y-0.5 px-3 pb-2">
        {items.map(([label, value], index) => (
          <div key={index} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="shrink-0 text-muted">{label}</span>
            <span className={`truncate font-medium ${String(value) === "OFF" ? "text-muted/60" : "text-text"}`} title={String(value)}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

function PreprocessSummary({ params }) {
  if (!params) {
    return <p className="text-sm text-muted">前処理設定を取得できませんでした。</p>;
  }
  const on = (v) => (v ? "ON" : "OFF");
  const num = (v, digits = 2) => Number(v ?? 0).toFixed(digits);
  const thresholdNames = { otsu: "大津法", binary: "固定しきい値", adaptive: "適応的しきい値" };
  const denoiseNames = { median: "メディアン", gaussian: "ガウシアン" };
  const strokeNames = { close: "欠け埋め", dilate: "太らせる", open: "細かなノイズ除去", erode: "細らせる" };
  const morphNames = { close: "クローズ", open: "オープン" };
  const illuminationNames = { gaussian: "Gaussian", rolling_ball: "Rolling Ball（近似）", retinex: "Retinex" };
  const sharpenGroupActive = Boolean(
    params.sharpen_enabled || params.unsharp_enabled || params.stroke_boost_enabled || params.illumination_enabled
  );
  const otherActive = Boolean(
    params.gamma_enabled || params.local_contrast_enabled || params.hist_equalize_enabled || params.morph_enabled || params.crop_margin_enabled
  );
  return (
    <div className="space-y-1.5">
      <SummarySection
        title="基本設定"
        defaultOpen
        items={[
          ["比率しきい値", num(params.ratio_threshold)],
          ["傾き補正", on(params.deskew_enabled)],
        ]}
      />
      <SummarySection
        title="二値化"
        defaultOpen
        items={[
          ["方式", thresholdNames[params.threshold_type] || params.threshold_type || "--"],
          ["しきい値", params.threshold_value ?? "--"],
        ]}
      />
      <SummarySection
        title="手動マスク補正"
        defaultOpen={Boolean(params.manual_mask_enabled)}
        items={[
          [
            "手動マスク補正",
            params.manual_mask_enabled
              ? `ON（${params.manual_mask_fill === "background" ? "周辺背景色" : "白"} / ${
                  params.manual_mask_timing === "pre" ? "二値化前" : "二値化後"
                }）`
              : "OFF",
          ],
        ]}
      />
      <SummarySection title="単一文字設定" items={[["サイズ", params.single_size ?? "--"]]} />
      <SummarySection
        title="横長文字設定"
        items={[
          ["高さ", params.wide_height ?? "--"],
          ["アスペクト比維持", on(params.wide_keep_ratio)],
        ]}
      />
      <SummarySection
        title="鮮明化・補正"
        defaultOpen={sharpenGroupActive}
        items={[
          [
            "照明ムラ補正",
            params.illumination_enabled
              ? `ON（${illuminationNames[params.illumination_method] || params.illumination_method}）`
              : "OFF",
          ],
          ["CLAHE", `clip ${num(params.clahe_clip_limit, 1)} / tile ${params.clahe_tile_grid_size ?? "--"}`],
          ["シャープ化", params.sharpen_enabled ? `ON（強さ ${num(params.sharpen_amount, 1)}）` : "OFF"],
          ["アンシャープマスク", params.unsharp_enabled ? `ON（強さ ${num(params.unsharp_amount, 1)}）` : "OFF"],
          [
            "掠れ補正",
            params.stroke_boost_enabled
              ? `ON（${strokeNames[params.stroke_boost_method] || params.stroke_boost_method}）`
              : "OFF",
          ],
        ]}
      />
      <SummarySection
        title="ノイズ除去"
        defaultOpen={Boolean(params.bilateral_enabled)}
        items={[
          ["方式", denoiseNames[params.denoise_method] || params.denoise_method || "--"],
          ["カーネルサイズ", params.denoise_ksize ?? "--"],
          ["バイラテラル", on(params.bilateral_enabled)],
        ]}
      />
      <SummarySection
        title="その他"
        defaultOpen={otherActive}
        items={[
          ["ガンマ補正", params.gamma_enabled ? `ON（${num(params.gamma_value)}）` : "OFF"],
          ["局所コントラスト", on(params.local_contrast_enabled)],
          ["ヒストグラム平坦化", on(params.hist_equalize_enabled)],
          ["オープン/クローズ", params.morph_enabled ? `ON（${morphNames[params.morph_method] || params.morph_method}）` : "OFF"],
          ["余白トリミング", on(params.crop_margin_enabled)],
        ]}
      />
    </div>
  );
}

// 中央プレビューの1段分（元画像 / 中間画像 / 最終画像）。倍率は3段共通。
// zoomPercent="fit" のときは表示領域の高さを3段で分け合い、縦横比を保ってフィット表示する
function StageImage({ title, description, src, zoomPercent, imgRef }) {
  const fit = zoomPercent === "fit";
  return (
    <div className={fit ? "flex min-h-0 flex-1 flex-col" : ""}>
      <div className="mb-1 flex shrink-0 flex-wrap items-baseline gap-2 px-0.5">
        <p className="shrink-0 text-[11px] font-semibold text-text">{title}</p>
        <p className="truncate text-[10px] text-muted" title={description}>{description}</p>
      </div>
      {src ? (
        fit ? (
          <div className="min-h-0 flex-1">
            <img ref={imgRef} src={src} alt={title} className="h-full w-full rounded-md object-contain" />
          </div>
        ) : (
          <img ref={imgRef} src={src} alt={title} className="h-auto max-w-none rounded-md" style={{ width: `${zoomPercent}%` }} />
        )
      ) : (
        <p className="px-0.5 py-2 text-xs text-muted">画像がありません</p>
      )}
    </div>
  );
}

// object-fit: contain を考慮した画像の実描画幅（px）。
// fit表示: 要素ボックス内で contain 縮尺した幅 / 倍率表示: h-auto でボックス比=画像比のため同式で要素幅に一致する
function renderedImageWidth(img) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const boxWidth = img.clientWidth;
  const boxHeight = img.clientHeight;
  if (!boxWidth || !boxHeight) return null;
  const scale = Math.min(boxWidth / img.naturalWidth, boxHeight / img.naturalHeight);
  return img.naturalWidth * scale;
}

// スロット1〜3共通の候補行（高さ固定の1行構成）。成功=採用ボタン付き / dimmed=再推論中の前回値
function CandidateRow({ index, engine, modelName, prediction, confidence, current, onAdopt, dimmed, lowercaseLabel = "" }) {
  const header = `${engineLabelOf(engine)}${modelName ? ` / ${modelName}` : ""}${lowercaseLabel ? ` / ${lowercaseLabel}` : ""}`;
  return (
    <button
      type="button"
      onClick={() => onAdopt?.(prediction)}
      title={`${header} の候補をクリックで現在ラベルへ反映`}
      className={`flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 text-left backdrop-blur-md transition hover:border-accent/60 hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <span className="w-4 shrink-0 text-[10px] text-muted">{index}.</span>
      <span className="w-44 shrink-0 truncate text-[10px] text-muted" title={header}>
        {header}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
        <DiffText candidate={prediction} current={current} />
      </span>
      <span
        className="shrink-0 text-[11px] font-semibold text-accent"
        title="各OCRエンジンが返す推論信頼度です。エンジン間で算出方式は異なります。取得できない場合（Tesseractのwhitelist指定時等）は -- 表示になります。"
      >
        {typeof confidence === "number" ? `${(confidence * 100).toFixed(1)}%` : "--"}
      </span>
      <span className="shrink-0 rounded-md border border-accent/50 bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200">
        採用
      </span>
    </button>
  );
}

// 候補行と同じ高さのメッセージ行（実行中 / エラー / スキップ / 候補なし / 未設定）
function CandidateMessageRow({ index, header, message, tone = "muted" }) {
  const toneClass =
    tone === "danger"
      ? "border-danger/40 bg-danger/10 text-danger"
      : tone === "amber"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : tone === "empty"
          ? "border-dashed border-border/40 text-muted/50"
          : "border-border bg-card/45 text-muted";
  return (
    <div className={`flex h-10 items-center gap-2 rounded-lg border px-2.5 ${toneClass}`}>
      {index ? <span className="w-4 shrink-0 text-[10px] text-muted">{index}.</span> : null}
      {header ? (
        <span className="w-44 shrink-0 truncate text-[10px] text-muted" title={header}>
          {header}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-xs" title={message}>
        {message}
      </span>
    </div>
  );
}

export default function LabelingView({
  projectId,
  imageVersion,
  preprocessOverrides,
  preprocessParams,
  predictParams,
  extraPredictParams = [],
  candidateDict = null,
  onCandidateDictChange,
  onOpenPreprocess,
  images,
  selectedIndex,
  onSelectIndex,
  labelDrafts,
  labelValue,
  onLabelChange,
  onAppendChar,
  onBackspace,
  onClear,
  isUppercase,
  onToggleCase,
  onSave,
  onPrev,
  onNext,
  imageShapes,
}) {
  const zoomLevels = [25, 50, 100, 150, 200];
  // "fit" = 高さ自動（3画像を表示領域内へ収める）。数値 = 従来の幅基準倍率（内部スクロール）
  const [zoomPercent, setZoomPercent] = useState("fit");
  // 現在のラベルの文字位置（left/center/right。プロジェクト切替で復元）
  const [labelTextAlign, setLabelTextAlign] = useState("center");
  // 最終画像の実描画幅（px）。入力欄の幅をこれへ追従させる（nullの間はカード全幅）
  const finalImageRef = useRef(null);
  const [finalImageWidth, setFinalImageWidth] = useState(null);
  // OCR再実行ボタンの状態フィードバック: press=押下発光 / success=緑 / error=赤（短時間で通常へ戻す）
  const [rerunFeedback, setRerunFeedback] = useState(null);
  const rerunRequestedRef = useRef(false);
  const rerunFeedbackTimerRef = useRef(null);

  function setRerunFeedbackTimed(kind, durationMs) {
    setRerunFeedback(kind);
    if (rerunFeedbackTimerRef.current) {
      clearTimeout(rerunFeedbackTimerRef.current);
    }
    rerunFeedbackTimerRef.current = setTimeout(() => setRerunFeedback(null), durationMs);
  }

  // 再実行ボタン起点のロード完了時のみ成功/失敗フィードバックを出す（画像切替の通常ロードでは出さない）
  function finishRerunFeedback(ok) {
    if (!rerunRequestedRef.current) {
      return;
    }
    rerunRequestedRef.current = false;
    setRerunFeedbackTimed(ok ? "success" : "error", ok ? 600 : 1200);
  }

  useEffect(() => () => {
    if (rerunFeedbackTimerRef.current) {
      clearTimeout(rerunFeedbackTimerRef.current);
    }
  }, []);
  const [showUnlabeledOnly, setShowUnlabeledOnly] = useState(false);
  const [listMode, setListMode] = useState("table");
  const [previewSrc, setPreviewSrc] = useState("");
  // 中間画像（前処理途中の確認画像）と種別・比率などのプレビュー情報
  const [interimSrc, setInterimSrc] = useState("");
  const [previewMeta, setPreviewMeta] = useState(null);
  const [ocrCandidate, setOcrCandidate] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [ocrReloadTick, setOcrReloadTick] = useState(0);
  // 実際に推論に使用された Engine / Model（レスポンス優先、無ければ設定値）
  const [ocrMeta, setOcrMeta] = useState(null);
  // 比較スロット（モデル2/3）の推論結果
  const [extraCandidates, setExtraCandidates] = useState([]);
  const predictParamsKey = JSON.stringify(predictParams || {});
  const extraParamsKey = JSON.stringify(extraPredictParams || []);
  const listRef = useRef(null);
  const itemRefs = useRef([]);
  const labelInputRef = useRef(null);
  const savingRef = useRef(false);
  const [savingAndAdvancing, setSavingAndAdvancing] = useState(false);
  const selected = images[selectedIndex] || null;

  // 文字位置をプロジェクト単位で復元・保存（リロード後も維持）
  useEffect(() => {
    setLabelTextAlign(readLabelTextAlign(projectId));
  }, [projectId]);

  // 最終画像の実描画幅を追跡（読込完了・倍率変更・ウィンドウ/サイドバー等のリサイズで再計算）。
  // 倍率切替でimg要素が作り直されるため、依存に画像・倍率・srcを含めて監視を張り直す
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
  }, [selected?.image, zoomPercent, previewSrc]);

  function updateLabelTextAlign(value) {
    const next = LABEL_TEXT_ALIGN_VALUES.has(value) ? value : "center";
    setLabelTextAlign(next);
    writeLabelTextAlign(projectId, next);
  }

  // 配置ボタン: 押すたびに 中央→左→右→中央 を循環。押下時は短く青発光する
  const [alignFlash, setAlignFlash] = useState(false);
  const alignFlashTimerRef = useRef(null);

  function cycleLabelTextAlign() {
    const currentIndex = LABEL_TEXT_ALIGN_ORDER.indexOf(labelTextAlign);
    const next = LABEL_TEXT_ALIGN_ORDER[(currentIndex + 1) % LABEL_TEXT_ALIGN_ORDER.length];
    updateLabelTextAlign(next);
    setAlignFlash(true);
    if (alignFlashTimerRef.current) {
      clearTimeout(alignFlashTimerRef.current);
    }
    alignFlashTimerRef.current = setTimeout(() => setAlignFlash(false), 300);
  }

  useEffect(() => () => {
    if (alignFlashTimerRef.current) {
      clearTimeout(alignFlashTimerRef.current);
    }
  }, []);

  const nextAlign = LABEL_TEXT_ALIGN_ORDER[(LABEL_TEXT_ALIGN_ORDER.indexOf(labelTextAlign) + 1) % 3];
  const visibleEntries = useMemo(() => {
    const entries = images.map((item, originalIndex) => {
      const savedLabel = String(item.label ?? "").trim();
      const draftLabel = String(labelDrafts?.[item.image] ?? item.label ?? "").trim();
      const isSet = savedLabel !== "";
      return { item, originalIndex, savedLabel, draftLabel, isSet };
    });
    if (!showUnlabeledOnly) {
      return entries;
    }
    return entries.filter((entry) => !entry.isSet);
  }, [images, labelDrafts, showUnlabeledOnly]);

  useEffect(() => {
    itemRefs.current = [];
  }, [showUnlabeledOnly, visibleEntries.length, listMode]);

  useEffect(() => {
    if (!showUnlabeledOnly) {
      return;
    }
    const current = images[selectedIndex];
    if (!current) {
      return;
    }
    const currentSavedLabel = String(current.label ?? "").trim();
    if (currentSavedLabel === "") {
      return;
    }
    if (visibleEntries.length > 0) {
      onSelectIndex(visibleEntries[0].originalIndex);
    }
  }, [showUnlabeledOnly, images, selectedIndex, labelDrafts, visibleEntries, onSelectIndex]);

  useEffect(() => {
    const listEl = listRef.current;
    const visibleIndex = visibleEntries.findIndex((entry) => entry.originalIndex === selectedIndex);
    if (visibleIndex < 0) {
      return;
    }
    const itemEl = itemRefs.current[visibleIndex];
    if (!listEl || !itemEl) {
      return;
    }

    const top = itemEl.offsetTop - listEl.offsetTop;
    listEl.scrollTo({ top, behavior: "smooth" });
  }, [selectedIndex, visibleEntries]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const input = labelInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      const len = input.value?.length ?? 0;
      input.setSelectionRange(len, len);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected?.image]);

  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      if (!selected?.image || !projectId) {
        setPreviewSrc("");
        setInterimSrc("");
        setPreviewMeta(null);
        setOcrCandidate(null);
        setExtraCandidates([]);
        setOcrError("");
        setOcrLoading(false);
        return;
      }
      setOcrLoading(true);
      setOcrError("");

      // 比較スロット（モデル2/3）も同時に推論する。重複設定はスキップし、失敗は行単位で保持
      const signatureOf = (f) =>
        `${f?.engine}|${f?.model}|${f?.easyocr_langs}|lc:${f?.include_lowercase !== false ? "1" : "0"}`;
      const seenSignatures = new Set([signatureOf(predictParams || {})]);
      const extraPromise = Promise.all(
        (extraPredictParams || []).map(async (fields) => {
          const signature = signatureOf(fields);
          if (seenSignatures.has(signature)) {
            return { skipped: true, engine: fields?.engine || "", modelName: "" };
          }
          seenSignatures.add(signature);
          try {
            const d = await request("/preprocess/preview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                image: selected.image,
                project_id: projectId,
                overrides: preprocessOverrides || null,
                ...fields,
              }),
            });
            const prediction = String(d?.prediction || "").trim();
            return {
              prediction,
              confidence: typeof d?.confidence === "number" ? d.confidence : null,
              engine: d?.predict_engine || fields?.engine || "",
              modelName: d?.predict_model_name || "",
              error: !prediction && d?.predict_error ? String(d.predict_error) : "",
            };
          } catch (error) {
            return { error: String(error?.message || error), engine: fields?.engine || "", modelName: "" };
          }
        })
      );

      try {
        const data = await request("/preprocess/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: selected.image,
            project_id: projectId,
            overrides: preprocessOverrides || null,
            // 前処理画面と同じ推論設定（engine/model/model_type/easyocr_langs）で候補を取得する
            ...(predictParams || {}),
          }),
        });
        if (cancelled) {
          return;
        }
        const nextSrc =
          data?.processed_data_url ||
          processedImageUrl(selected.image, projectId, imageVersion, selected.type || "");
        setPreviewSrc(nextSrc);
        setInterimSrc(data?.interim_data_url || "");
        setPreviewMeta({ type: data?.type || "", ratio: data?.ratio });
        // プレビューAPIが返す推論結果をOCR候補として活用する（追加のOCR処理は行わない）
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
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPreviewSrc(processedImageUrl(selected.image, projectId, imageVersion, selected.type || ""));
        setInterimSrc("");
        setPreviewMeta(null);
        setOcrCandidate(null);
        setOcrMeta({ engine: predictParams?.engine || "", modelName: "" });
        setOcrError(String(error?.message || error || "不明なエラー"));
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
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [selected?.image, selected?.type, projectId, imageVersion, preprocessOverrides, predictParamsKey, extraParamsKey, ocrReloadTick]);

  // 「保存して次へ」の唯一の実装（Enter・ボタン共通）。
  // 1. 保存前の表示一覧から次画像を画像名で1回だけ確定（方式A）
  // 2. 保存し、成功を待つ（失敗時は現在画像に留まる）
  // 3. 確定しておいた画像へ移動（保存で「未編集のみ」から現在画像が消えても飛ばさない）
  async function saveAndNext() {
    if (savingRef.current) return;
    const currentName = selected?.image;
    if (!currentName) return;
    savingRef.current = true;
    setSavingAndAdvancing(true);
    try {
      const nextIndex = decideNextImageIndex(
        images.map((item) => item.image),
        visibleEntries.map((entry) => entry.item.image),
        currentName
      );
      const saved = await Promise.resolve(onSave());
      if (saved === false) {
        return; // 保存失敗時は次へ進まない
      }
      if (nextIndex !== null) {
        onSelectIndex(nextIndex);
      }
    } finally {
      savingRef.current = false;
      setSavingAndAdvancing(false);
    }
  }

  function adoptText(text) {
    if (text) {
      onLabelChange(text);
      labelInputRef.current?.focus();
    }
  }

  // 辞書からの近似候補（全OCR候補を検索元に、辞書文字列単位で統合）。
  // 辞書未選択時は null（セクション非表示）。OCR結果が変わった時だけ再計算する
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

  // ---- OCR候補辞書（右サイドバーから直接ファイル選択。プロジェクト単位で保存） ----
  const dictFileInputRef = useRef(null);
  const [dictError, setDictError] = useState("");
  const dictEntries = candidateDict?.entries || [];
  const dictStats = candidateDict?.stats || null;

  async function handleDictFileSelected(file) {
    if (!file) return;
    if (file.size > DICT_FILE_MAX_BYTES) {
      setDictError("ファイルが大きすぎます（上限5MB）");
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      let encoding = "UTF-8";
      let text = new TextDecoder("utf-8").decode(buffer);
      if (text.charCodeAt(0) === 0xfeff) {
        encoding = "UTF-8 (BOM)";
      }
      if (text.includes("�")) {
        // UTF-8として壊れる場合はShift_JISを試す（実ファイルの文字コード差異対応）
        try {
          const sjis = new TextDecoder("shift_jis").decode(buffer);
          if (!sjis.includes("�")) {
            text = sjis;
            encoding = "Shift_JIS";
          }
        } catch {
          // shift_jis非対応環境ではUTF-8のまま処理する
        }
      }
      if (text.includes(String.fromCharCode(0))) {
        throw new Error("バイナリファイルの可能性があるため読み込めません");
      }
      const parsed = parseCandidateDictionary(text);
      if (parsed.entries.length === 0) {
        throw new Error("有効な候補が1件もありません（1行1候補のテキストファイルを選択してください）");
      }
      onCandidateDictChange?.({
        ...candidateDict,
        source_name: file.name,
        entries: parsed.entries,
        stats: {
          encoding,
          valid: parsed.validCount,
          empty_skipped: parsed.emptySkipped,
          duplicate_skipped: parsed.duplicateSkipped,
          invalid_skipped: parsed.invalidSkipped,
        },
      });
      setDictError("");
    } catch (e) {
      setDictError(`読み込みに失敗しました: ${e.message}`);
    }
  }

  function clearDict() {
    onCandidateDictChange?.({ ...candidateDict, source_name: "", entries: [], stats: null });
    setDictError("");
  }

  // Esc: 最上位の有効候補を採用（モデル1が有効ならモデル1、無ければモデル2/3の先頭の有効候補）
  function adoptTopCandidate() {
    const top = ocrCandidate?.text || extraCandidates.find((c) => c?.prediction)?.prediction || "";
    adoptText(top);
  }

  // ⑧ キーボードショートカット: Ctrl+S=保存 / Ctrl+←→=画像移動 / Esc=OCR候補採用
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.isComposing) {
        return;
      }
      if (event.ctrlKey && !event.altKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        onSave();
        return;
      }
      if (event.ctrlKey && event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
        return;
      }
      if (event.ctrlKey && event.key === "ArrowLeft") {
        event.preventDefault();
        onPrev();
        return;
      }
      // Enter=保存して次へ（ボタンクリックと同じ saveAndNext に一本化）。
      // 入力欄フォーカス時は入力欄自身の onKeyDown が処理するためここでは扱わない
      if ((event.key === "Enter" || event.key === "NumpadEnter") && !event.ctrlKey) {
        const target = event.target;
        const isEditableTarget =
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT");
        if (isEditableTarget) {
          return;
        }
        if (target instanceof HTMLElement && target.tagName === "BUTTON") {
          return; // ボタン上のEnterはクリックとして発火するため二重実行しない
        }
        if (event.repeat) {
          return; // 長押しrepeatは無視
        }
        event.preventDefault();
        saveAndNext();
        return;
      }
      // Alt+1〜5: 辞書からの近似候補を採用（Esc=OCR候補採用とは競合しない）
      if (event.altKey && !event.ctrlKey && !event.metaKey && /^[1-5]$/.test(event.key)) {
        const candidate = dictionaryCandidates?.[Number(event.key) - 1];
        if (candidate) {
          event.preventDefault();
          adoptText(candidate.entry);
        }
        return;
      }
      if (event.key === "Escape") {
        adoptTopCandidate();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!selected) {
    return (
      <Card title="ラベル編集" subtitle="画像がありません。画像画面で取り込んでください。">
        <p className="text-sm text-muted">画像が選択されていません。</p>
      </Card>
    );
  }

  const engineKey = String(ocrMeta?.engine || "").toLowerCase();
  const rawModelName = String(ocrMeta?.modelName || "");
  const isLatestModel = String(predictParams?.model || "") === "latest";
  const modelDisplay =
    engineKey === "easyocr"
      ? "--"
      : isLatestModel
        ? "最新モデル"
        : rawModelName || String(predictParams?.model || "--");

  return (
    <div className="grid h-[calc(100vh-238px)] min-h-[460px] grid-cols-[240px_minmax(0,1fr)_300px] gap-3">
      {/* 左: 画像一覧（この列だけスクロール） */}
      <Card
        title="画像一覧"
        subtitle={`${images.length}件`}
        className="flex h-full min-h-0 flex-col"
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-border bg-card/45 p-0.5">
            <Button
              size="sm"
              variant={listMode === "table" ? "primary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setListMode("table")}
            >
              一覧
            </Button>
            <Button
              size="sm"
              variant={listMode === "card" ? "primary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setListMode("card")}
            >
              カード
            </Button>
          </div>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-text">
            <input
              type="checkbox"
              checked={showUnlabeledOnly}
              onChange={(e) => setShowUnlabeledOnly(e.target.checked)}
            />
            未のみ
          </label>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
          {listMode === "card" ? (
            <div className="space-y-2">
              {visibleEntries.map(({ item, originalIndex, savedLabel, draftLabel, isSet }, idx) => (
                <button
                  key={item.image}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  onClick={() => onSelectIndex(originalIndex)}
                  className={`w-full rounded-xl border p-2 text-left transition ${
                    originalIndex === selectedIndex
                      ? "border-accent bg-accent/15"
                      : "border-border bg-card/60 backdrop-blur-md hover:border-slate-500"
                  }`}
                >
                  <div className="mb-1.5 overflow-hidden rounded-md border border-border bg-[#3b444f]/80 p-1">
                    <img
                      src={imageUrl(item.image, projectId, imageVersion)}
                      alt={item.image}
                      className="h-14 w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <p className="truncate text-xs font-medium text-text" title={item.image}>
                    {item.image}
                  </p>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-lime-300">
                      {isSet ? savedLabel : draftLabel || "-"}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-semibold ${isSet ? "text-emerald-300" : "text-red-400"}`}
                    >
                      {isSet ? "🟢保存済" : "未"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border bg-card/55 backdrop-blur-md">
              {visibleEntries.map(({ item, originalIndex, savedLabel, draftLabel, isSet }, idx) => (
                <button
                  key={item.image}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  onClick={() => onSelectIndex(originalIndex)}
                  className={`w-full px-2.5 py-1.5 text-left transition ${
                    originalIndex === selectedIndex ? "bg-accent/15" : "hover:bg-accent/10"
                  }`}
                >
                  <p className="truncate text-xs text-text" title={item.image}>
                    {item.image}
                  </p>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-lime-300">
                      {isSet ? savedLabel : draftLabel || "-"}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-semibold ${isSet ? "text-emerald-300" : "text-red-400"}`}
                    >
                      {isSet ? "🟢保存済" : "未"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {visibleEntries.length === 0 ? (
            <div className="rounded-xl border border-border bg-card/60 backdrop-blur-md px-3 py-6 text-center text-sm text-muted">
              表示対象の画像がありません
            </div>
          ) : null}
        </div>
      </Card>

      {/* 中央: プレビュー画像（主役）+ 入力 + 操作。gapを詰めて画像と入力ラベルを縦比較しやすくする */}
      <div className="flex min-h-0 flex-col gap-1.5">
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card/60 p-2 backdrop-blur-md">
          <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2 px-1">
            <p className="truncate text-xs font-semibold text-text">
              {selected.image}
              <span className="ml-2 font-normal text-muted">{imageShapes[selected.image] || "--"}</span>
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
              description="取り込み時の未加工画像"
              src={imageUrl(selected.image, projectId, imageVersion)}
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
              src={previewSrc || processedImageUrl(selected.image, projectId, imageVersion, selected.type || "")}
              zoomPercent={zoomPercent}
              imgRef={finalImageRef}
            />
          </div>
        </div>

        {/* 画像パネルと同じ p-2 余白にして、入力欄の左右位置を画像表示エリアと一致させる */}
        <div className="shrink-0 rounded-xl border border-border bg-card/60 p-2 backdrop-blur-md">
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <label className="app-label mb-0">現在のラベル</label>
            <Button
              size="sm"
              variant="secondary"
              className={`h-6 shrink-0 px-2 text-[11px] transition-shadow duration-200 ${
                alignFlash
                  ? "!border-accent/70 !text-blue-200 shadow-[0_0_0_1px_rgba(96,165,250,0.55),0_0_10px_rgba(96,165,250,0.45)]"
                  : ""
              }`}
              onClick={cycleLabelTextAlign}
              title={`現在は${LABEL_TEXT_ALIGN_LABELS[labelTextAlign]}揃えです。押すと${LABEL_TEXT_ALIGN_LABELS[nextAlign]}揃えに変更します。`}
              aria-label={`現在は${LABEL_TEXT_ALIGN_LABELS[labelTextAlign]}揃えです。押すと${LABEL_TEXT_ALIGN_LABELS[nextAlign]}揃えに変更します。`}
            >
              ≡ 配置: {LABEL_TEXT_ALIGN_LABELS[labelTextAlign]}
            </Button>
          </div>
          {/* 入力欄は最終画像の実描画幅に合わせて中央配置（画像と左右端を揃えて比較しやすくする） */}
          <div className="mb-2 flex justify-center">
            <input
              ref={labelInputRef}
              value={labelValue}
              onChange={(e) => onLabelChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent?.isComposing) {
                  return;
                }
                if (e.key === "Enter" || e.key === "NumpadEnter") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.repeat) {
                    return; // 長押しrepeatは無視（連打での多重実行防止）
                  }
                  saveAndNext();
                }
              }}
              className="app-input label-main-input min-h-[72px] !bg-[#f4f5f7] px-4 font-mono !text-[#111827] placeholder:!text-slate-400"
              style={{
                textAlign: labelTextAlign,
                // 実描画幅が取れるまではカード全幅。小画像でも入力しやすいよう最低320px（親幅は超えない）
                width: finalImageWidth ? `${Math.round(finalImageWidth)}px` : "100%",
                minWidth: "min(320px, 100%)",
                maxWidth: "100%",
                // プレースホルダーだけ入力欄幅に応じて縮小（16〜28px。入力済み文字は38px固定）
                "--label-placeholder-size": `${Math.round(
                  Math.max(16, Math.min(28, (finalImageWidth || 560) * 0.05))
                )}px`,
              }}
              placeholder="ラベル文字列を入力"
            />
          </div>

          <div className="mb-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">OCR候補</p>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] text-muted lg:inline">
                  差分は<span className="text-amber-300">黄色</span> / Escで最上位の有効候補を採用
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className={`h-7 px-3 text-[11px] font-semibold !border-accent/60 !bg-accent/15 !text-blue-200 transition-[box-shadow,background-color,border-color] duration-200 hover:!bg-accent/25 ${
                    rerunFeedback === "press"
                      ? "shadow-[0_0_0_1px_rgba(96,165,250,0.55),0_0_10px_rgba(96,165,250,0.45)]"
                      : rerunFeedback === "success"
                        ? "!border-emerald-400/70 !text-emerald-200 shadow-[0_0_0_1px_rgba(52,211,153,0.55),0_0_10px_rgba(52,211,153,0.45)]"
                        : rerunFeedback === "error"
                          ? "!border-red-400/70 !text-red-200 shadow-[0_0_0_1px_rgba(248,113,113,0.55),0_0_12px_rgba(248,113,113,0.5)]"
                          : ""
                  }`}
                  onClick={() => {
                    rerunRequestedRef.current = true;
                    setRerunFeedbackTimed("press", 300);
                    setOcrReloadTick((prev) => prev + 1);
                  }}
                  disabled={ocrLoading}
                  title="現在の画像でOCRを再実行します"
                  aria-label="現在の画像でOCRを再実行"
                >
                  {ocrLoading ? (
                    <>
                      <span className="mr-1 inline-block animate-spin" aria-hidden="true">
                        ↻
                      </span>
                      OCR実行中...
                    </>
                  ) : (
                    <>↻ OCR再実行</>
                  )}
                </Button>
              </div>
            </div>
            {/* 常に3行分の高さで固定表示（成功/実行中/エラー/未設定でも画面が揺れない） */}
            <div className="space-y-1.5">
              {ocrCandidate?.text ? (
                <CandidateRow
                  index={1}
                  engine={ocrMeta?.engine}
                  modelName={rawModelName || (modelDisplay !== "--" ? modelDisplay : "")}
                  prediction={ocrCandidate.text}
                  confidence={ocrCandidate.confidence}
                  current={labelValue}
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
                    <CandidateMessageRow
                      key={rowIndex}
                      message="比較スロット未設定（前処理設定画面で追加できます）"
                      tone="empty"
                    />
                  );
                }
                const item = extraCandidates?.[slotIndex];
                const headerText = item?.engine || item?.modelName
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
                      current={labelValue}
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

            {/* 辞書からの近似候補（OCR候補辞書を選択している場合のみ表示） */}
            {dictionaryCandidates !== null ? (
              <div className="mt-2 border-t border-border pt-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">辞書からの近似候補</p>
                  <span className="truncate text-[10px] text-muted" title={candidateDict?.source_name}>
                    {candidateDict?.source_name || ""}
                  </span>
                </div>
                {ocrLoading ? (
                  <p className="px-1 text-xs text-muted">OCR実行中...</p>
                ) : dictionaryCandidates.length === 0 ? (
                  <p className="px-1 text-xs text-muted">辞書内に近い候補はありません</p>
                ) : (
                  <div className="space-y-1.5">
                    {dictionaryCandidates.map((candidate, index) => (
                      <button
                        key={candidate.entry}
                        type="button"
                        onClick={() => adoptText(candidate.entry)}
                        title={`辞書候補をクリックで現在ラベルへ反映 (Alt+${index + 1})。差分はOCR結果（${candidate.sourceText}）との比較`}
                        className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 text-left backdrop-blur-md transition hover:border-accent/60 hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                      >
                        <span className="w-4 shrink-0 text-[10px] text-muted">{index + 1}.</span>
                        <span className="w-44 shrink-0 truncate text-[10px] text-muted" title={`元候補: ${candidate.source}`}>
                          類似度 {(candidate.score * 100).toFixed(1)}%{candidate.source ? ` / ${candidate.source}` : ""}
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                          <DiffText
                            candidate={candidate.entry}
                            current={candidate.sourceText}
                            highlightClass={DICT_DIFF_HIGHLIGHT_CLASS}
                          />
                        </span>
                        <span className="shrink-0 text-[10px] text-muted">Alt+{index + 1}</span>
                        <span className="shrink-0 rounded-md border border-accent/50 bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200">
                          採用
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              className="px-6"
              onClick={saveAndNext}
              disabled={savingAndAdvancing}
              title="ラベルを保存して次の画像へ (Enter)"
            >
              保存して次へ
            </Button>
            <Button variant="secondary" onClick={onSave} title="ラベルを保存 (Ctrl+S)">
              保存
            </Button>
            <Button variant="secondary" onClick={onPrev} title="前の画像へ (Ctrl+←)">
              前へ
            </Button>
            <Button variant="secondary" onClick={onNext} title="次の画像へ (Ctrl+→)">
              次へ
            </Button>
            <span className="ml-auto hidden text-[11px] text-muted xl:inline">
              Enter=保存して次へ / Ctrl+S=保存 / Ctrl+←→=移動 / Esc=候補採用
            </span>
          </div>

          <details className="group mt-2 rounded-lg border border-border/80 bg-card/45">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
              <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden="true">
                ▶
              </span>
              ⌨ ソフトキーボード
            </summary>
            <div className="space-y-1.5 px-2.5 pb-2.5">
              <div className="grid grid-cols-10 gap-1.5">
                {keyRows[0].map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant="secondary"
                    className="h-8 px-0 text-xs"
                    onClick={() => onAppendChar(key)}
                  >
                    {key}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-10 gap-1.5 pl-3">
                {keyRows[1].map((key) => {
                  const label = isUppercase ? key.toUpperCase() : key.toLowerCase();
                  return (
                    <Button
                      key={key}
                      size="sm"
                      variant="secondary"
                      className="h-8 px-0 text-xs"
                      onClick={() => onAppendChar(label)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
              <div className="grid grid-cols-10 gap-1.5 pl-8">
                {keyRows[2].map((key) => {
                  const label = isUppercase ? key.toUpperCase() : key.toLowerCase();
                  return (
                    <Button
                      key={key}
                      size="sm"
                      variant="secondary"
                      className="h-8 px-0 text-xs"
                      onClick={() => onAppendChar(label)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
              <div className="grid grid-cols-12 gap-1.5">
                <Button
                  size="sm"
                  variant={isUppercase ? "primary" : "secondary"}
                  className="col-span-2 h-8 text-xs"
                  onClick={onToggleCase}
                >
                  {isUppercase ? "ABC" : "abc"}
                </Button>
                <div className="col-span-8 grid grid-cols-7 gap-1.5">
                  {keyRows[3].map((key) => {
                    const label = isUppercase ? key.toUpperCase() : key.toLowerCase();
                    return (
                      <Button
                        key={key}
                        size="sm"
                        variant="secondary"
                        className="h-8 px-0 text-xs"
                        onClick={() => onAppendChar(label)}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
                <Button size="sm" variant="secondary" className="col-span-2 h-8 text-xs" onClick={onBackspace}>
                  戻す
                </Button>
              </div>
              <div className="grid grid-cols-12 gap-1.5">
                <Button size="sm" variant="secondary" className="col-span-2 h-8 text-xs" onClick={onClear}>
                  クリア
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="col-span-10 h-8 text-xs tracking-wide"
                  onClick={() => onAppendChar(" ")}
                >
                  スペース
                </Button>
              </div>
            </div>
          </details>
        </div>
      </div>

      {/* 右: 現在の前処理設定（表示専用。変更は前処理設定画面で行う） */}
      <Card
        title="現在の前処理設定"
        subtitle="表示のみ / 変更は前処理設定画面"
        className="flex h-full min-h-0 flex-col"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onOpenPreprocess?.()}
            title="前処理設定画面で前処理パラメータ・推論設定を変更できます"
          >
            ⚙ 前処理設定を開く
          </Button>
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          <PreprocessSummary params={preprocessParams} />

          {/* OCR候補辞書（設定元はこの画面のみ。初期は閉じた状態） */}
          <details className="group mt-2 rounded-lg border border-border bg-card/45">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
              <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden="true">
                ▶
              </span>
              OCR候補辞書
              <span className="ml-auto truncate text-[10px] font-normal text-muted" title={candidateDict?.source_name}>
                {dictEntries.length > 0 ? candidateDict?.source_name : "未選択"}
              </span>
            </summary>
            <div
              className="space-y-2 px-2.5 pb-2.5"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleDictFileSelected(e.dataTransfer?.files?.[0]);
              }}
            >
              <p className="param-hint">
                1行1候補のテキストファイル（.txt）から、OCR候補の下へ近似候補を表示します。ここへTXTをドラッグしても読み込めます。
              </p>
              <input
                ref={dictFileInputRef}
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  handleDictFileSelected(file);
                  e.target.value = ""; // 同じファイルを選び直せるようにする
                }}
              />
              {dictError ? <p className="text-xs text-danger">{dictError}</p> : null}
              {dictEntries.length > 0 ? (
                <>
                  <div className="space-y-0.5 rounded-lg border border-border bg-card/45 p-2 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">選択中</span>
                      <span className="truncate font-semibold text-text" title={candidateDict?.source_name}>
                        {candidateDict?.source_name || "--"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">候補数</span>
                      <span className="font-semibold text-text">{(dictStats?.valid ?? dictEntries.length).toLocaleString()}件</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">文字コード</span>
                      <span className="font-semibold text-text">{dictStats?.encoding || "--"}</span>
                    </div>
                    {(dictStats?.empty_skipped || 0) + (dictStats?.duplicate_skipped || 0) + (dictStats?.invalid_skipped || 0) >
                    0 ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted">除外</span>
                        <span className="text-muted">
                          空行{dictStats?.empty_skipped || 0} / 重複{dictStats?.duplicate_skipped || 0} / 不正
                          {dictStats?.invalid_skipped || 0}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" className="flex-1" onClick={() => dictFileInputRef.current?.click()}>
                      選び直す
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={clearDict}>
                      選択解除
                    </Button>
                  </div>
                  <div>
                    <label className="app-label">最大候補数: {candidateDict?.max_candidates ?? 3}</label>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      step="1"
                      value={candidateDict?.max_candidates ?? 3}
                      onChange={(e) =>
                        onCandidateDictChange?.({ ...candidateDict, max_candidates: Number(e.target.value) })
                      }
                      className="w-full"
                    />
                    <label className="app-label mt-1">最低類似度: {candidateDict?.min_similarity ?? 60}%</label>
                    <input
                      type="range"
                      min="30"
                      max="95"
                      step="5"
                      value={candidateDict?.min_similarity ?? 60}
                      onChange={(e) =>
                        onCandidateDictChange?.({ ...candidateDict, min_similarity: Number(e.target.value) })
                      }
                      className="w-full"
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted">辞書未選択（従来のOCR候補のみ表示されます）</p>
                  <Button size="sm" variant="secondary" className="w-full" onClick={() => dictFileInputRef.current?.click()}>
                    ファイルを選択
                  </Button>
                </>
              )}
            </div>
          </details>
        </div>
      </Card>
    </div>
  );
}
