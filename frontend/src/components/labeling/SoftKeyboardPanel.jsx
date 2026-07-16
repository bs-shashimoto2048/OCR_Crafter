// ソフトキーボード（既存ラベル編集とStep5で共通利用）。文字構成・入力動作は既存仕様のまま。
import Button from "../Button";

const keyRows = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

export default function SoftKeyboardPanel({ isUppercase, onAppendChar, onBackspace, onClear, onToggleCase }) {
  return (
    <details className="group mt-2 rounded-lg border border-border/80 bg-card/45">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden="true">
          ▶
        </span>
        ⌨ ソフトキーボード
      </summary>
      <div className="space-y-1.5 px-2.5 pb-2.5">
        <div className="grid grid-cols-10 gap-1.5">
          {keyRows[0].map((key) => (
            <Button key={key} size="sm" variant="secondary" className="h-8 px-0 text-xs" onClick={() => onAppendChar(key)}>
              {key}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-10 gap-1.5 pl-3">
          {keyRows[1].map((key) => {
            const label = isUppercase ? key.toUpperCase() : key.toLowerCase();
            return (
              <Button key={key} size="sm" variant="secondary" className="h-8 px-0 text-xs" onClick={() => onAppendChar(label)}>
                {label}
              </Button>
            );
          })}
        </div>
        <div className="grid grid-cols-10 gap-1.5 pl-8">
          {keyRows[2].map((key) => {
            const label = isUppercase ? key.toUpperCase() : key.toLowerCase();
            return (
              <Button key={key} size="sm" variant="secondary" className="h-8 px-0 text-xs" onClick={() => onAppendChar(label)}>
                {label}
              </Button>
            );
          })}
        </div>
        <div className="grid grid-cols-12 gap-1.5">
          <Button size="sm" variant={isUppercase ? "primary" : "secondary"} className="col-span-2 h-8 text-xs" onClick={onToggleCase}>
            {isUppercase ? "ABC" : "abc"}
          </Button>
          <div className="col-span-8 grid grid-cols-7 gap-1.5">
            {keyRows[3].map((key) => {
              const label = isUppercase ? key.toUpperCase() : key.toLowerCase();
              return (
                <Button key={key} size="sm" variant="secondary" className="h-8 px-0 text-xs" onClick={() => onAppendChar(label)}>
                  {label}
                </Button>
              );
            })}
          </div>
          <Button size="sm" variant="secondary" className="col-span-2 h-8 text-xs" onClick={onBackspace}>
            戻す
          </Button>
        </div>
        <div className="grid grid-cols-12 gap-1.5">
          <Button size="sm" variant="secondary" className="col-span-2 h-8 text-xs" onClick={onClear}>
            クリア
          </Button>
          <Button size="sm" variant="secondary" className="col-span-10 h-8 text-xs tracking-wide" onClick={() => onAppendChar(" ")}>
            スペース
          </Button>
        </div>
      </div>
    </details>
  );
}
