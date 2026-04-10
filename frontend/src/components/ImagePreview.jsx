import Card from "./Card";

export default function ImagePreview({ title, subtitle, src, loading }) {
  return (
    <Card title={title} subtitle={subtitle} className="p-4">
      <div className="rounded-xl border border-border bg-card/60 backdrop-blur-md p-2">
        {loading ? (
          <div className="flex h-56 items-center justify-center text-sm text-muted">読み込み中...</div>
        ) : src ? (
          <img src={src} alt={title} className="h-56 w-full rounded-lg object-contain" />
        ) : (
          <div className="flex h-56 items-center justify-center text-sm text-muted">画像がありません</div>
        )}
      </div>
    </Card>
  );
}
