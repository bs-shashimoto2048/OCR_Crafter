// ラベル編集の候補表示・3画像表示の共通部品（既存ラベル編集とStep5で共通利用）。
// 表示仕様（色分け・差分・並び・高さ固定）は既存ラベル編集の実装を移設したもので変更しない。
import { engineLabelOf } from "../../lib/ocrCandidates";

// OCR候補と現在ラベルの差分を1文字ずつ色付け表示する。
// highlightClass で差分文字の色を変更できる（既定=黄。辞書候補では蛍光緑を使用）
export function DiffText({ candidate, current, highlightClass = "text-amber-300" }) {
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
export const DICT_DIFF_HIGHLIGHT_CLASS = "text-[#adff5d] drop-shadow-[0_0_4px_rgba(173,255,93,0.55)]";

// スロット1〜3共通の候補行（高さ固定の1行構成）。成功=採用ボタン付き / dimmed=再推論中の前回値
export function CandidateRow({ index, engine, modelName, prediction, confidence, current, onAdopt, dimmed, lowercaseLabel = "" }) {
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
export function CandidateMessageRow({ index, header, message, tone = "muted" }) {
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

// 辞書からの近似候補セクション（類似度・由来Engine・差分・Alt+n採用。仕様は既存ラベル編集と同一）
export function DictionaryCandidatesSection({ dictionaryCandidates, sourceName, loading, onAdopt }) {
  if (dictionaryCandidates === null) {
    return null;
  }
  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">辞書からの近似候補</p>
        <span className="truncate text-[10px] text-muted" title={sourceName}>
          {sourceName || ""}
        </span>
      </div>
      {loading ? (
        <p className="px-1 text-xs text-muted">OCR実行中...</p>
      ) : dictionaryCandidates.length === 0 ? (
        <p className="px-1 text-xs text-muted">辞書内に近い候補はありません</p>
      ) : (
        <div className="space-y-1.5">
          {dictionaryCandidates.map((candidate, index) => (
            <button
              key={candidate.entry}
              type="button"
              onClick={() => onAdopt?.(candidate.entry)}
              title={`辞書候補をクリックで現在ラベルへ反映 (Alt+${index + 1})。差分はOCR結果（${candidate.sourceText}）との比較`}
              className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 text-left backdrop-blur-md transition hover:border-accent/60 hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <span className="w-4 shrink-0 text-[10px] text-muted">{index + 1}.</span>
              <span className="w-44 shrink-0 truncate text-[10px] text-muted" title={`元候補: ${candidate.source}`}>
                類似度 {(candidate.score * 100).toFixed(1)}%{candidate.source ? ` / ${candidate.source}` : ""}
              </span>
              <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                <DiffText candidate={candidate.entry} current={candidate.sourceText} highlightClass={DICT_DIFF_HIGHLIGHT_CLASS} />
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
  );
}

// OCR再実行ボタン（押下発光→成功=緑/失敗=赤のフィードバック。実行中は連打不可）
export function OcrRerunButton({ loading, feedback, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title="現在の画像でOCRを再実行します"
      aria-label="現在の画像でOCRを再実行"
      className={`inline-flex h-7 items-center justify-center rounded-lg border px-3 text-[11px] font-semibold transition-[box-shadow,background-color,border-color] duration-200 disabled:cursor-not-allowed disabled:opacity-50 !border-accent/60 !bg-accent/15 !text-blue-200 hover:!bg-accent/25 ${
        feedback === "press"
          ? "shadow-[0_0_0_1px_rgba(96,165,250,0.55),0_0_10px_rgba(96,165,250,0.45)]"
          : feedback === "success"
            ? "!border-emerald-400/70 !text-emerald-200 shadow-[0_0_0_1px_rgba(52,211,153,0.55),0_0_10px_rgba(52,211,153,0.45)]"
            : feedback === "error"
              ? "!border-red-400/70 !text-red-200 shadow-[0_0_0_1px_rgba(248,113,113,0.55),0_0_12px_rgba(248,113,113,0.5)]"
              : ""
      }`}
    >
      {loading ? (
        <>
          <span className="mr-1 inline-block animate-spin" aria-hidden="true">
            ↻
          </span>
          OCR実行中...
        </>
      ) : (
        <>↻ OCR再実行</>
      )}
    </button>
  );
}

// 中央プレビューの1段分（元画像 / 中間画像 / 最終画像）。倍率は3段共通。
// zoomPercent="fit" のときは表示領域の高さを3段で分け合い、縦横比を保ってフィット表示する
export function StageImage({ title, description, src, zoomPercent, imgRef }) {
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
export function renderedImageWidth(img) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const boxWidth = img.clientWidth;
  const boxHeight = img.clientHeight;
  if (!boxWidth || !boxHeight) return null;
  const scale = Math.min(boxWidth / img.naturalWidth, boxHeight / img.naturalHeight);
  return img.naturalWidth * scale;
}
