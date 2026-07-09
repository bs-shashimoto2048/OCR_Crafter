// 前処理画面のコンパクト推論結果表示（1〜2行に集約）
export default function ResultBadge({ loading, prediction, confidence, modelType, modelName, engine, error, warning }) {
  const engineLabel =
    engine === "easyocr"
      ? "EasyOCR"
      : engine === "paddleocr"
        ? "PaddleOCR"
        : engine === "tesseract"
          ? "Tesseract"
          : "カスタムモデル";

  if (error) {
    return (
      <div className="shrink-0 whitespace-pre-line rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">
        {error}
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
              信頼度 <span className="text-base font-semibold text-accent">
                {typeof confidence === "number" ? `${(confidence * 100).toFixed(1)}%` : "--"}
              </span>
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
