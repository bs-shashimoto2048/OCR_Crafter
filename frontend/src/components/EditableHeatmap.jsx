import { useEffect, useMemo, useRef, useState } from "react";

function toHalfWidthAlnum(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getColor(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return "#94a3b8";
  const value = Number(score);
  if (value > 0.9) return "#22c55e";
  if (value > 0.75) return "#eab308";
  return "#ef4444";
}

export default function EditableHeatmap({
  text,
  scores,
  onChange,
  onConfirm,
  maxLength = 32,
  appendChar = "A",
  focusRequest = 0,
  focusIndex = 0,
}) {
  const [value, setValue] = useState(String(text || ""));
  const [activeIndex, setActiveIndex] = useState(null);
  const list = useMemo(() => (Array.isArray(scores) ? scores : []), [scores]);
  const forceActiveIndexRef = useRef(null);
  const lastFocusRequestRef = useRef(focusRequest);

  useEffect(() => {
    const next = String(text || "");
    setValue(next);
    if (!next) {
      setActiveIndex(null);
      forceActiveIndexRef.current = null;
      return;
    }
    if (forceActiveIndexRef.current !== null) {
      const forced = Number(forceActiveIndexRef.current);
      forceActiveIndexRef.current = null;
      setActiveIndex(Math.max(0, Math.min(next.length - 1, forced)));
      return;
    }
    setActiveIndex((prev) => {
      // 編集中はフォーカス位置を維持し、外部更新時のみ再計算する
      if (prev !== null) {
        return Math.max(0, Math.min(next.length - 1, prev));
      }
      const lowIndex = list.findIndex((score) => score !== null && score !== undefined && Number(score) < 0.75);
      return lowIndex >= 0 && lowIndex < next.length ? lowIndex : 0;
    });
  }, [text, list]);

  useEffect(() => {
    if (lastFocusRequestRef.current === focusRequest) return;
    lastFocusRequestRef.current = focusRequest;
    const forced = Number(focusIndex);
    forceActiveIndexRef.current = Number.isFinite(forced) ? forced : 0;
    if (value.length > 0) {
      const index = Math.max(0, Math.min(value.length - 1, Number(forceActiveIndexRef.current) || 0));
      forceActiveIndexRef.current = null;
      setActiveIndex(index);
    }
  }, [focusRequest, focusIndex, value.length]);

  function applyCharAt(index, raw) {
    const char = toHalfWidthAlnum(raw).slice(-1);
    if (!char) return;
    const chars = value.split("");
    chars[index] = char;
    const next = chars.join("");
    setValue(next);
    onChange?.(next);
    setActiveIndex(index);
  }

  function handleCharChange(index, raw) {
    applyCharAt(index, raw);
  }

  function handleCharKeyDown(event, index) {
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const normalized = toHalfWidthAlnum(event.key).slice(-1);
      event.preventDefault();
      if (normalized) {
        applyCharAt(index, normalized);
      }
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex(Math.min(value.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex(Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm?.();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      setActiveIndex(Math.max(0, index - 1));
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      return;
    }
  }

  function handleAppendChar() {
    if (value.length >= Number(maxLength)) return;
    const nextChar = toHalfWidthAlnum(appendChar).slice(0, 1) || "A";
    const next = `${value}${nextChar}`;
    const nextIndex = next.length - 1;
    forceActiveIndexRef.current = nextIndex;
    setValue(next);
    onChange?.(next);
    setActiveIndex(nextIndex);
  }

  function handleRemoveChar() {
    if (value.length <= 0) return;
    const next = value.slice(0, -1);
    setValue(next);
    onChange?.(next);
    if (!next) {
      setActiveIndex(null);
      return;
    }
    setActiveIndex(Math.min(next.length - 1, activeIndex ?? next.length - 1));
  }

  return (
    <div className="flex flex-wrap items-end gap-1.5">
      {value.split("").map((char, index) => {
        const rawScore = list[index];
        const hasScore = rawScore !== null && rawScore !== undefined && !Number.isNaN(Number(rawScore));
        const score = hasScore ? Number(rawScore) : null;
        const color = getColor(score);
        const low = hasScore && Number(score) <= 0.75;
        const isActive = activeIndex === index;

        return (
          <div key={index} className="w-7 text-center">
            {isActive ? (
              <input
                autoFocus
                value={char}
                maxLength={1}
                onChange={(event) => handleCharChange(index, event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onPaste={(event) => {
                  event.preventDefault();
                  const pasted = event.clipboardData?.getData("text") || "";
                  applyCharAt(index, pasted);
                }}
                onKeyDown={(event) => handleCharKeyDown(event, index)}
                inputMode="latin"
                lang="en"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="h-8 w-7 rounded border border-border bg-card/70 text-center text-lg font-semibold text-text outline-none ring-1 ring-accent/60"
                title={hasScore ? `score: ${Number(score).toFixed(2)}` : "score: N/A"}
                style={{ imeMode: "disabled" }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`h-8 w-7 cursor-pointer rounded text-lg ${low ? "font-semibold" : "font-medium"}`}
                style={{ color }}
                title={hasScore ? `score: ${Number(score).toFixed(2)}` : "score: N/A"}
              >
                {char}
              </button>
            )}
            <div className="mt-1 h-1 w-full rounded-sm" style={{ backgroundColor: color }} />
          </div>
        );
      })}
      {value.length < Number(maxLength) ? (
        <button
          type="button"
          onClick={handleAppendChar}
          className="h-8 w-8 rounded border border-border bg-card/70 text-lg font-semibold text-accent transition hover:bg-card"
          title="末尾に1文字追加"
        >
          +
        </button>
      ) : null}
      {value.length > 0 ? (
        <button
          type="button"
          onClick={handleRemoveChar}
          className="h-8 w-8 rounded border border-border bg-card/70 text-lg font-semibold text-danger transition hover:bg-card"
          title="末尾を1文字削除"
        >
          -
        </button>
      ) : null}
    </div>
  );
}
