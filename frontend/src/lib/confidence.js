// OCR Confidence の共通表示フォーマッタ。
// 内部値の仕様: 0.0〜1.0 の数値、取得不能は null（バックエンドが null を返す）。
// null / undefined / 非数値は 0% へ偽装せず fallback（既定 "--"）で表示する。
export function formatConfidencePercent(confidence, fallback = "--") {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return fallback;
  }
  return `${(confidence * 100).toFixed(1)}%`;
}
