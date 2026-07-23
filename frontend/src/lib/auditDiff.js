// 監査ログのBefore/After差分表示用の純ロジック。
// ネストしたオブジェクトはトップレベルキー単位で比較し、値はJSON表示する。

function stringify(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// Before/Afterの全キーを列挙し、{key, before, after, changed} の行を返す。
// どちらもnull（記録なし）の場合は空配列。
export function buildAuditDiff(before, after) {
  const beforeObj = before && typeof before === "object" && !Array.isArray(before) ? before : null;
  const afterObj = after && typeof after === "object" && !Array.isArray(after) ? after : null;
  if (beforeObj === null && afterObj === null) {
    // オブジェクトでない値（配列・文字列等）はそのまま1行で表示
    if (before === null && before === undefined && after === null) return [];
    if ((before ?? null) === null && (after ?? null) === null) return [];
    return [
      {
        key: "(value)",
        before: stringify(before),
        after: stringify(after),
        changed: stringify(before) !== stringify(after),
      },
    ];
  }
  const keys = [...new Set([...Object.keys(beforeObj || {}), ...Object.keys(afterObj || {})])];
  return keys.map((key) => {
    const beforeText = stringify(beforeObj?.[key]);
    const afterText = stringify(afterObj?.[key]);
    return { key, before: beforeText, after: afterText, changed: beforeText !== afterText };
  });
}

// 監査アクションの日本語ラベル（基本13種＋バックアップ復元・保持期間削除）
export const AUDIT_ACTION_LABELS = {
  project_create: "プロジェクト作成",
  project_delete: "プロジェクト削除",
  preprocess_run: "前処理実行",
  dataset_create: "データセット作成",
  training_start: "学習開始",
  model_delete: "モデル削除",
  release_status_change: "リリースStatus変更",
  release_promote: "Production昇格",
  release_rollback: "Rollback",
  release_policy_update: "Release Policy変更",
  benchmark_run: "Benchmark実行",
  job_cancel: "Jobキャンセル",
  job_retry: "Job再実行",
  backup_restore: "バックアップ復元",
  retention_cleanup: "保持期間による削除",
  job_finished: "Job完了",
  evaluation_run: "モデル評価実行",
  experiment_update: "Experiment変更",
  analysis_toggle: "分析対象ON/OFF",
  backup_create: "バックアップ作成",
  deployment_export: "Deployment Export",
  restore_failed: "復元失敗",
  report_generate: "レポート生成",
  report_delete: "レポート削除",
};
