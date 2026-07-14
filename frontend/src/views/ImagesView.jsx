import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import Card from "../components/Card";
import Button from "../components/Button";
import { thumbnailUrl } from "../lib/api";

const LIST_ROW_HEIGHT = 64;
// OCR画像は横長のためカードも横長比率（幅広め・低め）にする
const CARD_ROW_HEIGHT = 220;
const CARD_MIN_WIDTH = 250;

// サムネイル1枚。直接 img src + loading="lazy" 方式（仮想化でDOMは表示範囲のみなので
// 同時リクエストはブラウザの接続管理に任せる）。読込中スケルトン / 失敗時は自動再試行2回 + 手動再読込
const Thumbnail = memo(function Thumbnail({ src, alt, className }) {
  const [status, setStatus] = useState("loading"); // loading | loaded | error
  const [retryCount, setRetryCount] = useState(0);

  // src（画像やキャッシュキー）が変わったら状態をリセット
  useEffect(() => {
    setStatus("loading");
    setRetryCount(0);
  }, [src]);

  if (status === "error") {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-card/60 text-[10px] text-muted ${className}`}>
        <span>画像を読み込めません</span>
        <Button
          size="sm"
          variant="secondary"
          className="h-5 px-1.5 text-[10px]"
          onClick={() => {
            setStatus("loading");
            setRetryCount((prev) => prev + 1);
          }}
        >
          再読込
        </Button>
      </div>
    );
  }

  const activeSrc = retryCount > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${retryCount}` : src;

  return (
    <div className={`relative bg-card/60 ${className}`}>
      {status === "loading" ? <div className="absolute inset-0 animate-pulse rounded bg-border/30" /> : null}
      <img
        key={activeSrc}
        src={activeSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setStatus("loaded")}
        onError={() => {
          if (retryCount < 2) {
            // 自動再試行は最大2回まで
            setRetryCount((prev) => prev + 1);
          } else {
            setStatus("error");
          }
        }}
        className={`h-full w-full object-contain ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
});

// 回転操作ボタン（一覧・カード共用）。押下中=青グロー / 成功=緑グロー / 失敗=赤グロー、処理中は両ボタン無効
const ROTATE_FEEDBACK_CLASS = {
  processing: "!border-accent/70 !text-blue-200 shadow-[0_0_0_1px_rgba(96,165,250,0.55),0_0_10px_rgba(96,165,250,0.45)]",
  success: "!border-emerald-400/70 !text-emerald-200 shadow-[0_0_0_1px_rgba(52,211,153,0.55),0_0_10px_rgba(52,211,153,0.45)]",
  error: "!border-red-400/70 !text-red-200 shadow-[0_0_0_1px_rgba(248,113,113,0.55),0_0_12px_rgba(248,113,113,0.5)]",
};

// 90°=青 / 180°=オレンジで色分け。押下時は約200msの光る演出（scale + brightness + shadow）
const ROTATE_PRESS_CLASS =
  "transition-[box-shadow,transform,filter,border-color] duration-200 active:scale-[0.98] active:brightness-125";

const RotateButtons = memo(function RotateButtons({ imageName, feedback, onRotate }) {
  const busy = feedback?.status === "processing";

  function feedbackClass(angle) {
    if (feedback?.angle !== angle) return "";
    return ROTATE_FEEDBACK_CLASS[feedback.status] || "";
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className={`h-6 w-16 px-0 text-[11px] !border-sky-400/60 !text-sky-300 active:shadow-[0_0_10px_rgba(56,189,248,0.6)] ${ROTATE_PRESS_CLASS} ${feedbackClass(90)}`}
        disabled={busy}
        onClick={() => onRotate(imageName, 90)}
        title="時計回りに90度回転"
        aria-label="時計回りに90度回転"
      >
        {busy && feedback?.angle === 90 ? "回転中…" : "↻90°"}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className={`h-6 w-16 px-0 text-[11px] !border-amber-500/60 !text-amber-300 active:shadow-[0_0_10px_rgba(251,146,60,0.6)] ${ROTATE_PRESS_CLASS} ${feedbackClass(180)}`}
        disabled={busy}
        onClick={() => onRotate(imageName, 180)}
        title="180度回転"
        aria-label="180度回転"
      >
        {busy && feedback?.angle === 180 ? "回転中…" : "↺180°"}
      </Button>
    </>
  );
});

// 一覧の1行（メタ情報が変わらない限り再レンダリングしない）
const ImageRow = memo(function ImageRow({ item, shape, thumbSrc, rotateFeedback, onRotate, onOpenLabeling }) {
  return (
    <div className="flex h-full items-center gap-3 border-b border-border/50 px-2">
      <Thumbnail src={thumbSrc} alt={item.image} className="h-12 w-28 shrink-0 rounded border border-border" />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-text hover:text-accent"
        onClick={() => onOpenLabeling(item.image)}
        title={`${item.image}（クリックでラベル編集）`}
      >
        {item.image}
      </button>
      <span className="w-32 shrink-0 truncate text-xs text-[#adff5d]" title={item.label || "-"}>
        {item.label || "-"}
      </span>
      <span className="w-24 shrink-0 text-xs text-muted">{shape || "--"}</span>
      <span className="w-14 shrink-0 text-center">
        {item.label ? (
          <span className="rounded-full border border-emerald-400/50 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
            済
          </span>
        ) : (
          <span className="text-[10px] text-muted">未</span>
        )}
      </span>
      <div className="flex shrink-0 gap-1.5">
        <RotateButtons imageName={item.image} feedback={rotateFeedback} onRotate={onRotate} />
      </div>
    </div>
  );
});

// カード表示の1枚。優先順位: 画像 → ラベル → ファイル名/サイズ → 回転ボタン
const ImageCard = memo(function ImageCard({ item, shape, thumbSrc, rotateFeedback, onRotate, onOpenLabeling }) {
  const label = String(item.label || "").trim();
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card/60 transition duration-200 hover:z-10 hover:scale-[1.02] hover:border-slate-500 hover:shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
      {/* 画像（カード内で最大領域。object-contain / 上下中央） */}
      <div className="relative min-h-0 flex-1">
        <Thumbnail src={thumbSrc} alt={item.image} className="h-full w-full" />
        {/* ラベル済みバッジ（右上）: 済=🟢 / 未=🟡 */}
        <span
          className="absolute right-1.5 top-1 text-[11px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
          title={label ? "ラベル済み" : "未ラベル"}
          aria-label={label ? "ラベル済み" : "未ラベル"}
        >
          {label ? "🟢" : "🟡"}
        </span>
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition duration-200 group-hover:opacity-100">
          <Button size="sm" onClick={() => onOpenLabeling(item.image)}>
            ラベル編集を開く
          </Button>
        </div>
      </div>
      <div className="shrink-0 space-y-1 p-2">
        {/* ラベル（最重要情報。薄緑バッジ + 18px太字） */}
        {label ? (
          <p
            className="truncate rounded-md border border-emerald-400/25 bg-emerald-400/15 px-2 py-0.5 text-lg font-bold leading-6 text-emerald-300"
            title={label}
          >
            {label}
          </p>
        ) : (
          <p className="truncate rounded-md border border-border/60 bg-card/45 px-2 py-0.5 text-lg font-bold leading-6 text-muted/70">
            未ラベル
          </p>
        )}
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
          <span className="truncate" title={item.image}>
            {item.image}
          </span>
          <span className="shrink-0 text-right">{shape || "--"}</span>
        </div>
        <div className="flex gap-1.5">
          <RotateButtons imageName={item.image} feedback={rotateFeedback} onRotate={onRotate} />
        </div>
      </div>
    </div>
  );
});

export default function ImagesView({
  projectId,
  sourceDir,
  setSourceDir,
  onBrowseDir,
  onImport,
  onRefresh,
  onRotate,
  imageVersion,
  imageVersions = {},
  images,
  imageShapes,
  onOpenLabeling,
}) {
  const [viewMode, setViewMode] = useState("list");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [unlabeledOnly, setUnlabeledOnly] = useState(false);
  // 画像単位の回転フィードバック: { [imageName]: { angle, status: processing|success|error } }
  const [rotateFeedbacks, setRotateFeedbacks] = useState({});
  const feedbackTimersRef = useRef({});
  const scrollRef = useRef(null);

  const handleRotate = useCallback(
    async (imageName, angle) => {
      // 同一画像の処理中は連打を無視（ボタンも無効化されている）
      if (feedbackTimersRef.current[imageName] === "processing") {
        return;
      }
      feedbackTimersRef.current[imageName] = "processing";
      setRotateFeedbacks((prev) => ({ ...prev, [imageName]: { angle, status: "processing" } }));
      const ok = await onRotate(imageName, angle);
      setRotateFeedbacks((prev) => ({ ...prev, [imageName]: { angle, status: ok ? "success" : "error" } }));
      feedbackTimersRef.current[imageName] = "done";
      // 成功は500ms緑グロー、失敗は1.2秒赤グローの後に通常へ戻す
      setTimeout(() => {
        delete feedbackTimersRef.current[imageName];
        setRotateFeedbacks((prev) => {
          const next = { ...prev };
          delete next[imageName];
          return next;
        });
      }, ok ? 500 : 1200);
    },
    [onRotate]
  );

  // 検索は300msデバウンス
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filteredImages = useMemo(() => {
    let result = images;
    if (search) {
      result = result.filter(
        (item) => item.image.toLowerCase().includes(search) || String(item.label || "").toLowerCase().includes(search)
      );
    }
    if (unlabeledOnly) {
      result = result.filter((item) => !String(item.label || "").trim());
    }
    return result;
  }, [images, search, unlabeledOnly]);

  // 条件変更時はスクロールを先頭へ
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [search, unlabeledOnly, viewMode, projectId]);

  // カード表示の列数（コンテナ幅から算出）
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const update = () => setColumns(Math.max(1, Math.floor(el.clientWidth / CARD_MIN_WIDTH)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rowCount = viewMode === "list" ? filteredImages.length : Math.ceil(filteredImages.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (viewMode === "list" ? LIST_ROW_HEIGHT : CARD_ROW_HEIGHT),
    overscan: 4,
  });

  // 回転時は対象画像だけキャッシュキー(imageVersions[name])が進み、その1枚のみ再取得される
  function thumbSrcOf(name) {
    return thumbnailUrl(name, projectId, imageVersions[name] ?? imageVersion ?? 0);
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex h-[calc(100vh-238px)] min-h-[440px] flex-col gap-3">
      <Card title="画像取り込み" subtitle="外部ディレクトリから project/raw にコピーします" className="shrink-0">
        <div className="flex gap-3">
          <input
            value={sourceDir}
            onChange={(e) => setSourceDir(e.target.value)}
            placeholder="画像フォルダのパス"
            className="app-input min-w-0 flex-1"
          />
          <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={onBrowseDir}>
            Browse
          </Button>
          <Button className="shrink-0 whitespace-nowrap" onClick={onImport}>
            取り込み
          </Button>
          <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={onRefresh}>
            更新
          </Button>
        </div>
      </Card>

      <Card
        title="画像一覧"
        subtitle={`全${images.length}件 / 表示中 ${filteredImages.length}件`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="検索（ファイル名 / ラベル）"
            className="app-input h-8 w-56 text-xs"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-text">
            <input type="checkbox" checked={unlabeledOnly} onChange={(e) => setUnlabeledOnly(e.target.checked)} />
            未ラベルのみ
          </label>
          <div className="ml-auto inline-flex rounded-lg border border-border bg-card/45 p-0.5">
            <Button
              size="sm"
              variant={viewMode === "list" ? "primary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setViewMode("list")}
            >
              一覧
            </Button>
            <Button
              size="sm"
              variant={viewMode === "card" ? "primary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setViewMode("card")}
            >
              カード
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60 bg-card/40">
          {filteredImages.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted">
              {images.length === 0 ? (
                <div>
                  <p className="mb-2 text-text">画像が未登録です</p>
                  <ol className="inline-block list-decimal space-y-1 pl-5 text-left text-sm text-muted">
                    <li>「Browse」で画像フォルダを選択</li>
                    <li>「取り込み」を実行</li>
                    <li>取り込み後にラベル編集へ進む</li>
                  </ol>
                </div>
              ) : (
                "条件に一致する画像がありません"
              )}
            </div>
          ) : (
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
              {virtualItems.map((virtualRow) => {
                if (viewMode === "list") {
                  const item = filteredImages[virtualRow.index];
                  return (
                    <div
                      key={item.image}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <ImageRow
                        item={item}
                        shape={imageShapes[item.image]}
                        thumbSrc={thumbSrcOf(item.image)}
                        rotateFeedback={rotateFeedbacks[item.image]}
                        onRotate={handleRotate}
                        onOpenLabeling={onOpenLabeling}
                      />
                    </div>
                  );
                }
                const start = virtualRow.index * columns;
                const rowItems = filteredImages.slice(start, start + columns);
                return (
                  <div
                    key={`row-${virtualRow.index}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                      display: "grid",
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                      gap: "10px",
                      padding: "5px 8px",
                    }}
                  >
                    {rowItems.map((item) => (
                      <ImageCard
                        key={item.image}
                        item={item}
                        shape={imageShapes[item.image]}
                        thumbSrc={thumbSrcOf(item.image)}
                        rotateFeedback={rotateFeedbacks[item.image]}
                        onRotate={handleRotate}
                        onOpenLabeling={onOpenLabeling}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
