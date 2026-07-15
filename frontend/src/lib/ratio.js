// データ分割比率（Train/Val/Test）の入力ユーティリティ（OCR学習画面 プロジェクト設定）。
// 数値入力のスピナー・矢印キー操作で生じる浮動小数点誤差（例: 0.30000000000000004）を
// 画面へ出さないため、状態更新時に小数第1位へ丸める。

// 入力文字列を小数第1位へ丸めて返す。
// 入力途中の文字列（空・"-"・"0."など末尾ドット）はそのまま返し、タイピングを妨げない。
export function normalizeRatioInput(raw) {
  const text = String(raw ?? "");
  if (text === "" || text === "-" || /^-?\d*\.$/.test(text)) {
    return text;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return text;
  }
  return String(Math.round(value * 10) / 10);
}

// Train/Val/Test の合計が1.0かを許容誤差つきで検証し、表示用の合計文字列と共に返す。
// 厳密比較では 0.7+0.2+0.1 = 0.9999999999999999 が不合格になるため epsilon を使う。
export function summarizeRatios(trainRatio, valRatio, testRatio, epsilon = 1e-4) {
  const train = Number(trainRatio);
  const val = Number(valRatio);
  const test = Number(testRatio);
  if (!Number.isFinite(train) || !Number.isFinite(val) || !Number.isFinite(test)) {
    return { total: "-", valid: false };
  }
  const total = train + val + test;
  const valid = train > 0 && val >= 0 && test >= 0 && Math.abs(total - 1.0) < epsilon;
  return { total: total.toFixed(2), valid };
}
