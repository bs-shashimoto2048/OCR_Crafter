import Button from "./Button";

// 共通Empty State。「データなし」だけでなく、説明＋次に行う操作＋ボタンを提示する。
// テーブル内で使う場合は <tr><td colSpan={n}><EmptyState .../></td></tr> で包む。
export default function EmptyState({ title, description, actionLabel, onAction, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "px-3 py-5" : "px-4 py-8"}`}>
      <span
        aria-hidden="true"
        className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/60 text-base text-muted"
      >
        ⊘
      </span>
      <p className="text-[13px] font-semibold text-text">{title}</p>
      {description ? <p className="mt-1 max-w-md text-[12px] leading-relaxed text-muted">{description}</p> : null}
      {actionLabel && onAction ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
