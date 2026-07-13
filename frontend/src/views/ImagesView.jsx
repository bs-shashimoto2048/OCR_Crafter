import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import Card from "../components/Card";
import Button from "../components/Button";
import { thumbnailUrl } from "../lib/api";

const LIST_ROW_HEIGHT = 64;
const CARD_ROW_HEIGHT = 240;
const CARD_MIN_WIDTH = 200;

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
        className={`h-6 px-2 text-[11px] transition-shadow duration-200 ${feedbackClass(90)}`}
        disabled={busy}
        onClick={() => onRotate(imageName, 90)}
        title="時計回りに90度回転"
        aria-label="時計回りに90度回転"
      >
        {busy && feedback?.angle === 90 ? "回転中…" : "90°回転"}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className={`h-6 px-2 text-[11px] transition-shadow duration-200 ${feedbackClass(180)}`}
        disabled={busy}
        onClick={() => onRotate(imageName, 180)}
        title="180度回転"
        aria-label="180度回転"
      >
        {busy && feedback?.angle === 180 ? "回転中…" : "180°回転"}
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

// カード表示の1枚
const ImageCard = memo(function ImageCard({ item, shape, thumbSrc, rotateFeedback, onRotate, onOpenLabeling }) {
  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card/60">
      <div className="relative h-28 shrink-0">
        <Thumbnail src={thumbSrc} alt={item.image} className="h-full w-full" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition duration-200 group-hover:opacity-100">
          <Button size="sm" onClick={() => onOpenLabeling(item.image)}>
            ラベル編集を開く
          </Button>
        </div>
      </div>
      <div className="space-y-0.5 p-2.5">
        <p className="truncate text-xs font-medium text-text" title={item.image}>
          {item.image}
        </p>
        <p className="truncate text-[11px] text-muted">ラベル: {item.label || "-"}</p>
        <p className="text-[11px] text-muted">サイズ: {shape || "--"}</p>
        <div className="flex gap-1.5 pt-1">
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
