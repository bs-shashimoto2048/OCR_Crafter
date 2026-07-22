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
        // 評価前処理モード・ハッシュ・学習時前処理との一致（旧形式はnull=未記録）
        preMode: pre && pre.mode ? String(pre.mode) : "",
        preHash: pre && pre.hash ? String(pre.hash) : "",
        preMatch: entry?.preprocess_match === true ? true : entry?.preprocess_match === false ? false : null,
        // CER主指標（旧形式はnull=未記録）
        cer: num(entry?.cer),
        charAccuracy: num(entry?.char_accuracy),
      });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  return rows;
}

// 履歴の前処理列表示（旧形式=pre無しは「未記録」）。
// 学習時前処理モードは一致状態（不一致=⚠）も併記する
export function historyPreprocessLabel(row) {
  if (!row || (!row.preSource && !row.preSummary)) {
    return "未記録";
  }
  if (row.preSource === "training" || row.preSource === "training_individual") {
    const base = row.preSource === "training_individual" ? "学習時前処理（個別）" : "学習時前処理";
    return row.preMatch === false ? `⚠${base}` : base;
  }
  if (row.preSource === "none") {
    return row.preMatch === false ? "⚠なし（学習時と不一致）" : "なし";
  }
  const source = row.preSource === "step5" ? "Step5" : row.preSource === "custom" ? "カスタム" : row.preSource;
  const label = row.preSummary ? `${source}: ${row.preSummary}` : source;
  return row.preMatch === false ? `⚠${label}` : label;
}
