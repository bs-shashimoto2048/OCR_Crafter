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

// 比較行（モデル1〜3共通のコンパクト行）
function ComparisonRow({ index, engine, model, prediction, confidence, error }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/45 px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-[10px] text-muted">
          {index}. {engineLabelOf(engine)}
          {model ? ` / ${model}` : ""}
        </p>
        {error ? (
          <p className="break-all text-xs text-danger">{error}</p>
        ) : (
          <p className="truncate text-xl font-semibold leading-tight text-text">{prediction || "--"}</p>
        )}
      </div>
      <p className="shrink-0 text-sm font-semibold text-accent">{error ? "" : confidenceLabel(confidence)}</p>
    </div>
  );
}

// 前処理画面のコンパクト推論結果表示。
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

  if (error && !hasComparisons) {
    return (
      <div className="shrink-0 whitespace-pre-line rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">
        {error}
      </div>
    );
  }

  if (hasComparisons) {
    return (
      <div className="shrink-0 space-y-1.5 rounded-xl border border-border bg-card/60 px-3 py-2 backdrop-blur-md">
        {loading ? (
          <div className="text-sm text-muted">プレビュー推論を実行中...</div>
        ) : (
          <>
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
              />
            ))}
          </>
        )}
        {!loading && warning ? (
          <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">{warning}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="shrink-0 rounded-xl border border-border bg-card/60 px-4 py-2.5 backdrop-blur-md">
      {loading ? (
        <div className="text-sm text-muted">プレビュー推論を実行中...</div>
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
