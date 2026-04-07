import Card from "./Card";

export default function ResultBadge({ loading, prediction, confidence, modelType, modelName, engine, error }) {
  const engineLabel = engine === "easyocr" ? "EasyOCR" : "カスタムモデル";

  if (error) {
    return (
      <Card title="推論結果" subtitle="プレビュー推論">
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
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
    </Card>
  );
}
