import { useEffect, useRef, useState } from "react";

// 手動マスク補正の画像エディタ（OCR前処理専用）。
// object-contain 表示の letterbox 余白を除外し、クリック/ドラッグ座標を
// 元画像に対する正規化座標(0-1)へ変換して扱う。元画像ファイルは変更しない。

function displayedImageBox(imgEl, containerEl) {
  if (!imgEl || !containerEl || !imgEl.naturalWidth || !imgEl.naturalHeight) {
    return null;
  }
  const cw = containerEl.clientWidth;
  const ch = containerEl.clientHeight;
  const scale = Math.min(cw / imgEl.naturalWidth, ch / imgEl.naturalHeight);
  const width = imgEl.naturalWidth * scale;
  const height = imgEl.naturalHeight * scale;
  return { left: (cw - width) / 2, top: (ch - height) / 2, width, height };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

// region マスクの表示用 bbox（source_size 正規化）
function regionBboxPercent(mask) {
  const [srcW, srcH] = mask.source_size || [1, 1];
  const [x1, y1, x2, y2] = mask.bbox || [0, 0, srcW, srcH];
  return {
    left: (x1 / srcW) * 100,
    top: (y1 / srcH) * 100,
    width: ((x2 - x1) / srcW) * 100,
    height: ((y2 - y1) / srcH) * 100,
  };
}

export default function ManualMaskEditor({
  title,
  subtitle,
  src,
  enabled = false,
  editMode = "off", // off | rect | point
  masks = [],
  masksVisible = true,
  pendingRegion = null,
  selectedIndex = -1,
  analyzing = false,
  onSelect,
  onAddRect,
  onUpdateRect,
  onPointClick,
}) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [imgBox, setImgBox] = useState(null);
  const [draftRect, setDraftRect] = useState(null); // ドラッグ中の新規矩形（正規化）

  // 画像ロード・リサイズで実描画領域を再計算
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const update = () => setImgBox(displayedImageBox(imgRef.current, container));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [src]);

  function eventToNormPoint(e) {
    const container = containerRef.current;
    const box = displayedImageBox(imgRef.current, container);
    if (!container || !box) return null;
    const rect = container.getBoundingClientRect();
    const px = e.clientX - rect.left - box.left;
    const py = e.clientY - rect.top - box.top;
    if (px < 0 || py < 0 || px > box.width || py > box.height) {
      return null; // letterbox余白・画像外は無効
    }
    return { x: clamp01(px / box.width), y: clamp01(py / box.height) };
  }

  function startDrag(state) {
    dragRef.current = state;
    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", handleDragEnd);
  }

  function handleDragMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = eventToNormPoint(e);
    if (!point) return;
    if (drag.mode === "create") {
      setDraftRect({
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        width: Math.abs(point.x - drag.start.x),
        height: Math.abs(point.y - drag.start.y),
      });
    } else if (drag.mode === "move") {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      setDraftRect({
        index: drag.index,
        x: clamp01(drag.orig.x + dx),
        y: clamp01(drag.orig.y + dy),
        width: drag.orig.width,
        height: drag.orig.height,
      });
    } else if (drag.mode === "resize") {
      setDraftRect({
        index: drag.index,
        x: drag.orig.x,
        y: drag.orig.y,
        width: Math.max(0.01, point.x - drag.orig.x),
        height: Math.max(0.01, point.y - drag.orig.y),
      });
    }
  }

  function handleDragEnd() {
    const drag = dragRef.current;
    dragRef.current = null;
    window.removeEventListener("mousemove", handleDragMove);
    window.removeEventListener("mouseup", handleDragEnd);
    setDraftRect((current) => {
      if (drag && current) {
        if (drag.mode === "create" && current.width > 0.005 && current.height > 0.005) {
          onAddRect?.({ x: current.x, y: current.y, width: current.width, height: current.height });
        } else if ((drag.mode === "move" || drag.mode === "resize") && drag.index != null) {
          onUpdateRect?.(drag.index, {
            x: current.x,
            y: current.y,
            width: current.width,
            height: current.height,
          });
        }
      }
      return null;
    });
  }

  function handleMouseDown(e) {
    if (!enabled || editMode !== "rect") return;
    const point = eventToNormPoint(e);
    if (!point) return;
    e.preventDefault();
    startDrag({ mode: "create", start: point });
  }

  function handleMaskMouseDown(e, index, mask) {
    if (!enabled || mask.type !== "rect") {
      onSelect?.(index);
      return;
    }
    const point = eventToNormPoint(e);
    if (!point) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(index);
    startDrag({ mode: "move", index, start: point, orig: { ...mask } });
  }

  function handleResizeMouseDown(e, index, mask) {
    const point = eventToNormPoint(e);
    if (!point) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag({ mode: "resize", index, start: point, orig: { ...mask } });
  }

  function handleClick(e) {
    if (!enabled || editMode !== "point" || analyzing) return;
    const point = eventToNormPoint(e);
    if (!point) return;
    onPointClick?.(point.x, point.y);
  }

  const cursor = !enabled || editMode === "off" ? "default" : editMode === "rect" ? "crosshair" : "copy";

  function maskStyleClass(mask, index) {
    if (mask.enabled === false) return "border-slate-400/50 bg-slate-400/15";
    if (index === selectedIndex) return "border-accent bg-accent/30";
    return "border-blue-400/70 bg-blue-400/20";
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card/60 p-2 backdrop-blur-md">
      <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
        <p className="shrink-0 text-xs font-semibold text-text">{title}</p>
        <p className="truncate text-[11px] text-muted">
          {enabled && editMode !== "off"
            ? editMode === "rect"
              ? "ドラッグで矩形マスクを追加（登録済みはドラッグ移動・右下ハンドルでサイズ変更）"
              : analyzing
                ? "黒領域を解析中..."
                : "黒い塊をクリックすると連結領域を検出します"
            : subtitle}
        </p>
      </div>
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 rounded-lg border border-border bg-[#3b444f]/40 p-1"
        style={{ cursor }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      >
        {src ? (
          <img
            ref={imgRef}
            src={src}
            alt={title}
            draggable={false}
            onLoad={() => setImgBox(displayedImageBox(imgRef.current, containerRef.current))}
            className="h-full w-full select-none rounded-md object-contain"
          />
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-muted">画像がありません</p>
        )}

        {imgBox && src ? (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${imgBox.left + 4}px`,
              top: `${imgBox.top + 4}px`,
              width: `${imgBox.width}px`,
              height: `${imgBox.height}px`,
            }}
          >
            {/* 登録済みマスク（青半透明 / 無効=灰 / 選択=強調） */}
            {masksVisible
              ? masks.map((mask, index) => {
                  const isDragTarget = draftRect?.index === index;
                  const rect =
                    mask.type === "rect"
                      ? isDragTarget
                        ? draftRect
                        : mask
                      : null;
                  const style =
                    mask.type === "rect"
                      ? {
                          left: `${rect.x * 100}%`,
                          top: `${rect.y * 100}%`,
                          width: `${rect.width * 100}%`,
                          height: `${rect.height * 100}%`,
                        }
                      : (() => {
                          const b = regionBboxPercent(mask);
                          return { left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%` };
                        })();
                  return (
                    <div
                      key={index}
                      className={`pointer-events-auto absolute rounded-sm border-2 ${maskStyleClass(mask, index)}`}
                      style={style}
                      title={mask.type === "rect" ? `矩形マスク #${index + 1}` : `黒領域マスク #${index + 1}`}
                      onMouseDown={(e) => handleMaskMouseDown(e, index, mask)}
                    >
                      {mask.type === "rect" && index === selectedIndex && enabled ? (
                        <span
                          className="absolute bottom-0 right-0 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-full border border-white/80 bg-accent"
                          onMouseDown={(e) => handleResizeMouseDown(e, index, mask)}
                        />
                      ) : null}
                    </div>
                  );
                })
              : null}

            {/* ドラッグ中の新規矩形（黄） */}
            {draftRect && draftRect.index == null ? (
              <div
                className="absolute rounded-sm border-2 border-amber-300 bg-amber-300/25"
                style={{
                  left: `${draftRect.x * 100}%`,
                  top: `${draftRect.y * 100}%`,
                  width: `${draftRect.width * 100}%`,
                  height: `${draftRect.height * 100}%`,
                }}
              />
            ) : null}

            {/* ポイント指定の検出候補（黄） */}
            {pendingRegion?.bbox ? (
              (() => {
                const b = regionBboxPercent(pendingRegion);
                return (
                  <div
                    className="absolute rounded-sm border-2 border-amber-300 bg-amber-300/25"
                    style={{ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%` }}
                    title="検出された黒領域（確定前）"
                  />
                );
              })()
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
