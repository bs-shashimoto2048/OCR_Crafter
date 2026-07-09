// 前処理画面の縦積みプレビュー。親(flexカラム)の高さを3枚で分け合い、
// 横長画像を幅いっぱいに大きく表示する（倍率は object-contain で従来どおり）。
export default function ImagePreview({ title, subtitle, src, loading }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card/60 p-2 backdrop-blur-md">
      <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
        <p className="shrink-0 text-xs font-semibold text-text">{title}</p>
        <p className="truncate text-[11px] text-muted">{subtitle}</p>
      </div>
      <div className="min-h-0 flex-1 rounded-lg border border-border bg-[#3b444f]/40 p-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">読み込み中...</div>
        ) : src ? (
          <img src={src} alt={title} className="h-full w-full rounded-md object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">画像がありません</div>
        )}
      </div>
    </div>
  );
}
