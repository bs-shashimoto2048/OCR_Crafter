import Card from "../components/Card";
import Button from "../components/Button";
import { imageUrl } from "../lib/api";

const keyRows = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

export default function LabelingView({
  projectId,
  imageVersion,
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
  const selected = images[selectedIndex] || null;

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
          <div className="rounded-xl border border-border bg-[#333d49] p-3">
            <img
              src={imageUrl(selected.image, projectId, imageVersion)}
              alt={selected.image}
              className="h-[420px] w-full rounded-lg object-contain"
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
            value={labelValue}
            onChange={(e) => onLabelChange(e.target.value)}
            className="app-input mb-4"
            placeholder="ラベル文字列を入力"
          />

          <div className="space-y-2 rounded-xl border border-border bg-[#333d49] p-3">
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
              <Button size="sm" className="col-span-2 h-9 text-xs" onClick={onSave}>
                ラベル保存
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="画像リスト" subtitle="ファイル名と設定ラベルを確認">
        <div className="max-h-[80vh] space-y-2 overflow-auto pr-1">
          {images.map((item, idx) => {
            const currentLabel = String(labelDrafts?.[item.image] ?? item.label ?? "").trim();
            const isSet = currentLabel !== "";
            return (
              <button
                key={item.image}
                onClick={() => onSelectIndex(idx)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  idx === selectedIndex
                    ? "border-accent bg-accent/15"
                    : "border-border bg-[#333d49] hover:border-slate-500"
                }`}
              >
                <div className="mb-2 overflow-hidden rounded-md border border-border bg-[#3a4450] p-1">
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
                <p className="mt-1 truncate text-xs text-muted">
                  ラベル: {isSet ? currentLabel : "-"}
                </p>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
