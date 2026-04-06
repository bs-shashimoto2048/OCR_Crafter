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
      <Card title="Labeling" subtitle="画像がありません。Images画面で取り込んでください。">
        <p className="text-sm text-muted">No image selected.</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-[1.5fr_1fr] gap-6">
      <Card title="Preview" subtitle={`${selected.image} / ${imageShapes[selected.image] || "--"}`}>
        <div className="rounded-xl border border-border bg-[#333d49] p-3">
          <img
            src={imageUrl(selected.image, projectId, imageVersion)}
            alt={selected.image}
            className="h-[420px] w-full rounded-lg object-contain"
          />
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={onPrev}>
            Previous
          </Button>
          <Button variant="secondary" onClick={onNext}>
            Next
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-8 gap-2">
          {images.map((item, idx) => (
            <button
              key={item.image}
              onClick={() => onSelectIndex(idx)}
              className={`h-10 rounded-lg border text-xs transition ${
                idx === selectedIndex
                  ? "border-accent bg-accent/15 text-blue-200"
                  : "border-border bg-[#333d49] text-muted hover:text-text"
              }`}
              title={item.image}
            >
              {idx + 1}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Label Editor" subtitle="複数文字 / 英数字入力に対応">
        <label className="app-label">Current Label</label>
        <input
          value={labelValue}
          onChange={(e) => onLabelChange(e.target.value)}
          className="app-input mb-4"
          placeholder="Label text..."
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
              Back
            </Button>
          </div>

          <div className="grid grid-cols-12 gap-1.5">
            <Button size="sm" variant="secondary" className="col-span-2 h-9 text-xs" onClick={onClear}>
              Clear
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="col-span-8 h-9 text-xs tracking-wide"
              onClick={() => onAppendChar(" ")}
            >
              Space
            </Button>
            <Button size="sm" className="col-span-2 h-9 text-xs" onClick={onSave}>
              Enter
            </Button>
          </div>
        </div>

        <Button className="mt-4 w-full" onClick={onSave}>
          Save Label
        </Button>
      </Card>
    </div>
  );
}
