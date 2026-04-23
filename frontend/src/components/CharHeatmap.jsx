function getColor(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return "#94a3b8";
  const value = Number(score);
  if (value > 0.9) return "#22c55e";
  if (value > 0.75) return "#eab308";
  return "#ef4444";
}

export default function CharHeatmap({ text, scores }) {
  const value = String(text || "");
  const list = Array.isArray(scores) ? scores : [];
  if (!value) return null;

  return (
    <div className="flex flex-wrap items-end gap-1.5">
      {value.split("").map((char, index) => {
        const rawScore = list[index];
        const hasScore = rawScore !== null && rawScore !== undefined && !Number.isNaN(Number(rawScore));
        const score = hasScore ? Number(rawScore) : null;
        const color = getColor(score);
        return (
          <div key={`${char}-${index}`} className="w-6 text-center">
            <div
              className={`text-lg ${hasScore && Number(score) <= 0.75 ? "font-semibold" : "font-medium"}`}
              style={{ color }}
              title={hasScore ? `score: ${Number(score).toFixed(2)}` : "score: N/A"}
            >
              {char}
            </div>
            <div className="mt-1 h-1 w-full rounded-sm" style={{ backgroundColor: color }} />
          </div>
        );
      })}
    </div>
  );
}
