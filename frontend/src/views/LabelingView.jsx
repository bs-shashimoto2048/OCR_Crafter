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

export default function LabelingView({
  projectId,
  imageVersion,
  preprocessOverrides,
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
  const [listMode, setListMode] = useState("card");
  const [previewSrc, setPreviewSrc] = useState("");
  const listRef = useRef(null);
  const itemRefs = useRef([]);
  const labelInputRef = useRef(null);
  const saveButtonRef = useRef(null);
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
    itemEl.focus({ preventScroll: true });
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
        return;
      }
      try {
        const data = await request("/preprocess/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: selected.image,
            project_id: projectId,
            overrides: preprocessOverrides || null,
          }),
        });
        if (cancelled) {
          return;
        }
        const nextSrc =
          data?.processed_data_url ||
          processedImageUrl(selected.image, projectId, imageVersion, selected.type || "");
        setPreviewSrc(nextSrc);
      } catch {
        if (cancelled) {
          return;
        }
        setPreviewSrc(processedImageUrl(selected.image, projectId, imageVersion, selected.type || ""));
      }
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [selected?.image, selected?.type, projectId, imageVersion, preprocessOverrides]);

  if (!selected) {
    return (
      <Card title="ラベル編集" subtitle="画像がありません。画像画面で取り込んでください。">
        <p className="text-sm text-muted">画像が選択されていません。</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-[1.5fr_1fr] gap-6">
      <div className="space-y-6">
        <Card title="プレビュー" subtitle={`${selected.image} / ${imageShapes[selected.image] || "--"}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted">表示倍率</span>
            {zoomLevels.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={zoomPercent === level ? "primary" : "secondary"}
                className="h-8 px-2 text-xs"
                onClick={() => setZoomPercent(level)}
              >
                {level}%
              </Button>
            ))}
          </div>

          <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card/60 backdrop-blur-md p-3">
            <img
              src={previewSrc || processedImageUrl(selected.image, projectId, imageVersion, selected.type || "")}
              alt={selected.image}
              className="mx-auto h-auto max-w-none rounded-lg"
              style={{ width: `${zoomPercent}%` }}
            />
          </div>

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={onPrev}>
              前へ
            </Button>
            <Button variant="secondary" onClick={onNext}>
              次へ
            </Button>
          </div>
        </Card>

        <Card title="ラベルエディタ" subtitle="複数文字 / 英数字入力に対応">
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
                saveButtonRef.current?.click();
              }
            }}
            className="app-input mb-4"
            placeholder="ラベル文字列を入力"
          />

          <div className="space-y-2 rounded-xl border border-border bg-card/60 backdrop-blur-md p-3">
            <div className="grid grid-cols-10 gap-1.5">
              {keyRows[0].map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant="secondary"
                  className="h-9 px-0 text-xs"
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
                    className="h-9 px-0 text-xs"
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
                    className="h-9 px-0 text-xs"
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
                className="col-span-2 h-9 text-xs"
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
                      className="h-9 px-0 text-xs"
                      onClick={() => onAppendChar(label)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
              <Button size="sm" variant="secondary" className="col-span-2 h-9 text-xs" onClick={onBackspace}>
                戻す
              </Button>
            </div>

            <div className="grid grid-cols-12 gap-1.5">
              <Button size="sm" variant="secondary" className="col-span-2 h-9 text-xs" onClick={onClear}>
                クリア
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="col-span-8 h-9 text-xs tracking-wide"
                onClick={() => onAppendChar(" ")}
              >
                スペース
              </Button>
              <Button ref={saveButtonRef} size="sm" className="col-span-2 h-9 text-xs" onClick={onSave}>
                ラベル保存
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="画像リスト"
        subtitle="ファイル名と設定ラベルを確認"
        actions={
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-lg border border-border bg-card/45 p-1">
              <Button
                size="sm"
                variant={listMode === "card" ? "primary" : "ghost"}
                className="h-7 px-2 text-[11px]"
                onClick={() => setListMode("card")}
              >
                カード
              </Button>
              <Button
                size="sm"
                variant={listMode === "table" ? "primary" : "ghost"}
                className="h-7 px-2 text-[11px]"
                onClick={() => setListMode("table")}
              >
                一覧
              </Button>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-text">
              <input
                type="checkbox"
                checked={showUnlabeledOnly}
                onChange={(e) => setShowUnlabeledOnly(e.target.checked)}
              />
              未ラベルのみ
            </label>
          </div>
        }
      >
        <div ref={listRef} className="max-h-[80vh] overflow-auto pr-1">
          {listMode === "card" ? (
            <div className="space-y-2">
              {visibleEntries.map(({ item, originalIndex, savedLabel, draftLabel, isSet }, idx) => {
                return (
                  <button
                    key={item.image}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    onClick={() => onSelectIndex(originalIndex)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      originalIndex === selectedIndex
                        ? "border-accent bg-accent/15"
                        : "border-border bg-card/60 backdrop-blur-md hover:border-slate-500"
                    }`}
                  >
                    <div className="mb-2 overflow-hidden rounded-md border border-border bg-[#3b444f]/80 p-1">
                      <img
                        src={imageUrl(item.image, projectId, imageVersion)}
                        alt={item.image}
                        className="h-20 w-full object-contain"
                        loading="lazy"
                      />
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium text-text" title={item.image}>
                        {item.image}
                      </p>
                      {isSet ? (
                        <span className="rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                          済
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-red-400">未</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">ラベル</p>
                    <p className="truncate text-base font-semibold text-lime-300">
                      {isSet ? savedLabel : draftLabel || "-"}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card/55 backdrop-blur-md">
              <div className="grid grid-cols-[minmax(0,1fr)_140px_54px] gap-2 border-b border-border/70 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <span>ファイル名</span>
                <span>ラベル</span>
                <span className="text-center">状態</span>
              </div>
              <div className="divide-y divide-border/50">
                {visibleEntries.map(({ item, originalIndex, savedLabel, draftLabel, isSet }, idx) => (
                  <button
                    key={item.image}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    onClick={() => onSelectIndex(originalIndex)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_140px_54px] items-center gap-2 px-3 py-2 text-left text-xs transition ${
                      originalIndex === selectedIndex ? "bg-accent/15" : "hover:bg-accent/10"
                    }`}
                  >
                    <span className="truncate text-text" title={item.image}>
                      {item.image}
                    </span>
                    <span className="truncate font-semibold text-lime-300">{isSet ? savedLabel : draftLabel || "-"}</span>
                    <span className={`text-center font-semibold ${isSet ? "text-emerald-300" : "text-red-400"}`}>
                      {isSet ? "済" : "未"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {visibleEntries.length === 0 ? (
            <div className="rounded-xl border border-border bg-card/60 backdrop-blur-md px-3 py-6 text-center text-sm text-muted">
              表示対象の画像がありません
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
