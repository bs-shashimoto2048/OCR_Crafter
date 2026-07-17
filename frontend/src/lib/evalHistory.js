// モデル評価履歴（localStorage `ocr_model_eval_history_by_project_v1`）の表示用純ロジック。
// 形式: {model: {datasetLabel: {percent, at, pre?}}}
// pre（前処理情報 {source, summary}）は後から追加されたフィールドで、
// 無い旧履歴は「未記録」として扱う（後方互換・エラーにしない）。

export function flattenEvalHistory(evalHistory) {
  const rows = [];
  for (const [model, datasets] of Object.entries(evalHistory || {})) {
    for (const [dataset, entry] of Object.entries(datasets || {})) {
      const pre = entry && typeof entry.pre === "object" && entry.pre !== null ? entry.pre : null;
      const num = (value) =>
        value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
      rows.push({
        model,
        dataset,
        percent: Number(entry?.percent),
        at: String(entry?.at || ""),
        preSource: pre ? String(pre.source || "") : "",
        preSummary: pre ? String(pre.summary || "") : "",
        // CER主指標（旧形式はnull=未記録）
        cer: num(entry?.cer),
        charAccuracy: num(entry?.char_accuracy),
      });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  return rows;
}

// 履歴の前処理列表示（旧形式=pre無しは「未記録」）
export function historyPreprocessLabel(row) {
  if (!row || (!row.preSource && !row.preSummary)) {
    return "未記録";
  }
  if (row.preSource === "none") {
    return "なし";
  }
  const source = row.preSource === "step5" ? "Step5" : row.preSource === "custom" ? "カスタム" : row.preSource;
  return row.preSummary ? `${source}: ${row.preSummary}` : source;
}
