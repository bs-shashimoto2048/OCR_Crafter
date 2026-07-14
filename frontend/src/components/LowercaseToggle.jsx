import { lowercaseToggleApplicable } from "../lib/lowercase";

// EasyOCR/PaddleOCR共通の「小文字を出力に含める」チェックボックス。
// ラテン文字言語（英語など）以外の設定では表示しない（日本語等には適用しない）。
export default function LowercaseToggle({ engine, langs, value, onChange, className = "" }) {
  if (!lowercaseToggleApplicable(engine, langs)) {
    return null;
  }
  const checked = value !== false;
  return (
    <div className={className}>
      <label className="inline-flex items-center gap-2 text-xs text-text">
        <input type="checkbox" checked={checked} onChange={(e) => onChange?.(e.target.checked)} />
        小文字を出力に含める
      </label>
      <p className="param-hint">
        {checked ? "大文字・小文字を区別して出力します。" : "英字の出力を大文字へ統一します。"}
      </p>
    </div>
  );
}
