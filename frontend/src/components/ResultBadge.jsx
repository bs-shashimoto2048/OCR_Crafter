const ENGINE_LABELS = {
  easyocr: "EasyOCR",
  paddleocr: "PaddleOCR",
  tesseract: "Tesseract",
};

function engineLabelOf(engine) {
  return ENGINE_LABELS[String(engine || "").toLowerCase()] || (engine ? String(engine) : "カスタムモデル");
}

function confidenceLabel(confidence) {
  return typeof confidence === "number" ? `${(confidence * 100).toFixed(1)}%` : "--";
}

// 比較行（モデル1〜3共通のコンパクト行）。skipped=重複スキップ(黄) / error=失敗(赤)
function ComparisonRow({ index, engine, model, prediction, confidence, error, skipped }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 ${
        skipped
          ? "border-amber-400/40 bg-amber-400/10"
          : error
            ? "border-danger/40 bg-danger/10"
            : "border-border bg-card/45"
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-[10px] text-muted">
          {index}. {engineLabelOf(engine)}
          {model ? ` / ${model}` : ""}
        </p>
        {skipped ? (
          <p className="text-xs text-amber-200">{error || "同一設定のためスキップ"}</p>
        ) : error ? (
          <p className="break-all text-xs text-danger">{error}</p>
        ) : (
          <p className="truncate text-xl font-semibold leading-tight text-text">{prediction || "--"}</p>
        )}
      </div>
      <p className="shrink-0 text-sm font-semibold text-accent">{error || skipped ? "" : confidenceLabel(confidence)}</p>
    </div>
  );
}

// 最終画像直下に置く推論結果カード。
// comparisons（モデル2/3の結果）がある場合は比較リスト、無ければ従来の単一表示
export default function ResultBadge({
  loading,
  prediction,
  confidence,
  modelType,
  modelName,
  engine,
  error,
  warning,
  comparisons = [],
}) {
  const engineLabel = engineLabelOf(engine);
  const hasComparisons = Array.isArray(comparisons) && comparisons.length > 0;

  return (
    <div className="shrink-0 rounded-xl border border-border bg-card/60 px-3 py-2 backdrop-blur-md">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 px-0.5">
        <p className="text-xs font-semibold text-text">推論結果</p>
        <p className="text-[10px] text-muted">最終画像に対するOCR</p>
      </div>
      {loading ? (
        <div className="text-sm text-muted">プレビュー推論を実行中...</div>
      ) : hasComparisons ? (
        <div className="space-y-1.5">
          <ComparisonRow
            index={1}
            engine={engine}
            model={modelName || modelType || ""}
            prediction={prediction}
            confidence={confidence}
            error={error}
          />
          {comparisons.map((item, idx) => (
            <ComparisonRow
              key={idx}
              index={idx + 2}
              engine={item.engine}
              model={item.model}
              prediction={item.prediction}
              confidence={item.confidence}
              error={item.error}
              skipped={item.skipped}
            />
          ))}
        </div>
      ) : error ? (
        <div className="whitespace-pre-line rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-sm text-danger">
          {error}
        </div>
      ) : prediction ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted">予測ラベル</p>
            <p className="truncate text-2xl font-semibold leading-tight text-text">{prediction}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted">
              信頼度 <span className="text-base font-semibold text-accent">{confidenceLabel(confidence)}</span>
            </p>
            <p className="text-[11px] text-muted">
              Engine {engineLabel} / Model {modelName || modelType || "--"}
            </p>
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted">プレビュー結果はありません。</div>
      )}
      {!loading && warning ? (
        <p className="mt-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">{warning}</p>
      ) : null}
    </div>
  );
}
