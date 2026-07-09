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

export default function LabelingView({
  projectId,
  imageVersion,
  preprocessOverrides,
  predictParams,
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
  const [zoomPercent, setZoomPercent] = useState(100);
  const [showUnlabeledOnly, setShowUnlabeledOnly] = useState(false);
  const [listMode, setListMode] = useState("table");
  const [previewSrc, setPreviewSrc] = useState("");
  const [ocrCandidate, setOcrCandidate] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [ocrReloadTick, setOcrReloadTick] = useState(0);
  const predictParamsKey = JSON.stringify(predictParams || {});
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
        setOcrCandidate(null);
        setOcrError("");
        setOcrLoading(false);
        return;
      }
      setOcrLoading(true);
      setOcrError("");
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
        if (!prediction && data?.predict_error) {
          setOcrError(String(data.predict_error));
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPreviewSrc(processedImageUrl(selected.image, projectId, imageVersion, selected.type || ""));
        setOcrCandidate(null);
        setOcrError(String(error?.message || error || "不明なエラー"));
      } finally {
        if (!cancelled) {
          setOcrLoading(false);
        }
      }
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [selected?.image, selected?.type, projectId, imageVersion, preprocessOverrides, predictParamsKey, ocrReloadTick]);

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

  function adoptCandidate() {
    if (ocrCandidate?.text) {
      onLabelChange(ocrCandidate.text);
      labelInputRef.current?.focus();
    }
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
        adoptCandidate();
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

  const confidencePercent =
    typeof ocrCandidate?.confidence === "number" ? `${(ocrCandidate.confidence * 100).toFixed(1)}%` : "--";

  return (
    <div className="grid h-[calc(100vh-238px)] min-h-[460px] grid-cols-[240px_minmax(0,1fr)_240px] gap-3">
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
            </p>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[11px] text-muted">倍率</span>
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
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-[#3b444f]/40 p-2">
            <img
              src={previewSrc || processedImageUrl(selected.image, projectId, imageVersion, selected.type || "")}
              alt={selected.image}
              className="mx-auto h-auto max-w-none rounded-lg"
              style={{ width: `${zoomPercent}%` }}
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
            className="app-input mb-2 text-xl font-semibold tracking-[0.1em]"
            placeholder="ラベル文字列を入力（Enterで保存して次へ）"
          />

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

      {/* 右: OCR候補（固定表示） */}
      <Card
        title="OCR候補"
        subtitle="クリックまたはEscで採用"
        className="flex h-full min-h-0 flex-col"
        actions={
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-[11px]"
            onClick={() => setOcrReloadTick((prev) => prev + 1)}
            disabled={ocrLoading}
            title="現在画像に対してOCR候補を再取得します"
          >
            OCR再実行
          </Button>
        }
      >
        {ocrLoading ? (
          <p className="text-sm text-muted">OCR実行中...</p>
        ) : ocrCandidate?.text ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={adoptCandidate}
              title="クリックで現在ラベルへ反映 (Esc)"
              className="w-full rounded-xl border border-border bg-card/60 px-3 py-2.5 text-left backdrop-blur-md transition hover:border-accent/60 hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <DiffText candidate={ocrCandidate.text} current={labelValue} />
            </button>
            <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-xs text-muted">
              <p>
                信頼度 <span className="text-sm font-semibold text-accent">{confidencePercent}</span>
              </p>
              {ocrCandidate.engine ? <p className="mt-0.5">Engine: {ocrCandidate.engine}</p> : null}
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              現在ラベルと異なる文字は<span className="text-amber-300">黄色</span>で表示されます。
            </p>
          </div>
        ) : ocrError ? (
          <div className="space-y-2">
            <p className="whitespace-pre-line break-all rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              OCR候補取得失敗: {ocrError}
            </p>
            <p className="text-[11px] leading-relaxed text-muted">
              推論エンジンは前処理設定画面の「推論設定」と共通です。カスタムモデル未学習の場合は
              前処理設定画面でエンジンを EasyOCR / Tesseract 等へ切り替えてください。
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">OCR候補なし</p>
        )}
      </Card>
    </div>
  );
}
