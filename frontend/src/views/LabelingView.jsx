import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../components/Card";
import Button from "../components/Button";
import { imageUrl, processedImageUrl, request } from "../lib/api";

const keyRows = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

const ENGINE_LABELS = { tesseract: "Tesseract", paddleocr: "PaddleOCR", easyocr: "EasyOCR", custom: "カスタムモデル" };

function engineLabelOf(engine) {
  return ENGINE_LABELS[String(engine || "").toLowerCase()] || (engine ? String(engine) : "--");
}

// OCR候補と現在ラベルの差分を1文字ずつ色付け表示する
function DiffText({ candidate, current }) {
  const chars = String(candidate || "").split("");
  const base = String(current || "");
  return (
    <span className="font-mono text-lg font-semibold tracking-wide">
      {chars.map((ch, idx) => (
        <span key={idx} className={ch === base[idx] ? "text-text" : "text-amber-300"}>
          {ch}
        </span>
      ))}
      {base.length > chars.length ? <span className="text-amber-300/70">…</span> : null}
    </span>
  );
}

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
function StageImage({ title, description, src, zoomPercent }) {
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
            <img src={src} alt={title} className="h-full w-full rounded-md object-contain" />
          </div>
        ) : (
          <img src={src} alt={title} className="h-auto max-w-none rounded-md" style={{ width: `${zoomPercent}%` }} />
        )
      ) : (
        <p className="px-0.5 py-2 text-xs text-muted">画像がありません</p>
      )}
    </div>
  );
}

// スロット1〜3共通の候補行（高さ固定の1行構成）。成功=採用ボタン付き / dimmed=再推論中の前回値
function CandidateRow({ index, engine, modelName, prediction, confidence, current, onAdopt, dimmed }) {
  const header = `${engineLabelOf(engine)}${modelName ? ` / ${modelName}` : ""}`;
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
      <span className="shrink-0 text-[11px] font-semibold text-accent">
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
  const selected = images[selectedIndex] || null;
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
      const signatureOf = (f) => `${f?.engine}|${f?.model}|${f?.easyocr_langs}`;
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
        if (!prediction && data?.predict_error) {
          setOcrError(String(data.predict_error));
        }
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

  async function saveAndNext() {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await Promise.resolve(onSave());
      onNext();
    } finally {
      savingRef.current = false;
    }
  }

  function adoptText(text) {
    if (text) {
      onLabelChange(text);
      labelInputRef.current?.focus();
    }
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

      {/* 中央: プレビュー画像（主役）+ 入力 + 操作 */}
      <div className="flex min-h-0 flex-col gap-2">
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
            />
          </div>
        </div>

        <div className="shrink-0 rounded-xl border border-border bg-card/60 p-3 backdrop-blur-md">
          <label className="app-label">現在のラベル</label>
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
                saveAndNext();
              }
            }}
            className="app-input mb-2 h-12 font-mono text-[26px] font-semibold tracking-[0.12em]"
            placeholder="ラベル文字列を入力（Enterで保存して次へ）"
          />

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
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setOcrReloadTick((prev) => prev + 1)}
                  disabled={ocrLoading}
                  title="現在画像に対して全スロットを再推論します"
                >
                  OCR再実行
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveAndNext} title="ラベルを保存して次の画像へ (Enter)">
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
              ソフトキーボード
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
        </div>
      </Card>
    </div>
  );
}
