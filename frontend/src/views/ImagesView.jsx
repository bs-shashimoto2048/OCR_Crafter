import Card from "../components/Card";
import Button from "../components/Button";
import { imageUrl } from "../lib/api";

export default function ImagesView({
  projectId,
  sourceDir,
  setSourceDir,
  onBrowseDir,
  onImport,
  onRefresh,
  onRotate,
  imageVersion,
  images,
  imageShapes,
  onOpenLabeling,
}) {
  return (
    <div className="space-y-6">
      <Card title="画像取り込み" subtitle="外部ディレクトリから project/raw にコピーします">
        <div className="flex gap-3">
          <input
            value={sourceDir}
            onChange={(e) => setSourceDir(e.target.value)}
            placeholder="画像フォルダのパス"
            className="app-input min-w-0 flex-1"
          />
          <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={onBrowseDir}>
            参照
          </Button>
          <Button className="shrink-0 whitespace-nowrap" onClick={onImport}>
            取り込み
          </Button>
          <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={onRefresh}>
            更新
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {images.map((item) => (
          <Card key={item.image} hover className="group p-0 overflow-hidden">
            <div className="relative">
              <img
                src={imageUrl(item.image, projectId, imageVersion)}
                alt={item.image}
                className="h-44 w-full object-contain bg-[#333d49] p-2"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition duration-200 group-hover:opacity-100">
                <Button size="sm" onClick={() => onOpenLabeling(item.image)}>
                  ラベル編集を開く
                </Button>
              </div>
            </div>
            <div className="space-y-1 p-4">
              <p className="truncate text-sm font-medium text-text">{item.image}</p>
              <p className="text-xs text-muted">ラベル: {item.label || "-"}</p>
              <p className="text-xs text-muted">サイズ: {imageShapes[item.image] || "--"}</p>
              <div className="pt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => onRotate(item.image, -90)}>
                  左回転
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onRotate(item.image, 90)}>
                  右回転
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
