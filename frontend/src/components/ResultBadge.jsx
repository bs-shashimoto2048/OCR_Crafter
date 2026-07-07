import Card from "./Card";

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
      <Card title="推論結果" subtitle="プレビュー推論">
        <div className="whitespace-pre-line rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      </Card>
    );
  }

  return (
    <Card title="推論結果" subtitle="プレビュー推論">
      {loading ? (
        <div className="text-sm text-muted">プレビュー推論を実行中...</div>
      ) : prediction ? (
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">予測ラベル</p>
            <p className="text-3xl font-semibold text-text">{prediction}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted">信頼度</p>
            <p className="text-lg font-semibold text-accent">
              {typeof confidence === "number" ? `${(confidence * 100).toFixed(1)}%` : "--"}
            </p>
            <p className="text-xs text-muted">エンジン: {engineLabel}</p>
            <p className="text-xs text-muted">モデル種別: {modelType || "--"}</p>
            <p className="text-xs text-muted">モデル名: {modelName || "--"}</p>
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted">プレビュー結果はありません。</div>
      )}
      {!loading && warning ? (
        <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
          {warning}
        </div>
      ) : null}
    </Card>
  );
}
