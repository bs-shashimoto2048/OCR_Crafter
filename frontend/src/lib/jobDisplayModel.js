// Frontend Job一覧・詳細表示契約の部分共通化（Issue #131）。
//
// Architecture Investigation #123（Completed）は、Training Job（Job System A:
// training_jobsテーブル+subprocess）とJobManager Job（Job System B:
// job_manager.py+SQLite、Issue #127でSQLite移行済み）のBackend統合（execution model /
// persistence / cancellation semantics）は現時点で非推奨と結論づけ、Option C（Shared Job
// Facade）の第一歩として、まずFrontendの「表示」契約だけを部分共通化することを推奨した。
//
// 本モジュールはその第一歩であり、以下のみを扱う純粋関数群である:
//   - 両Systemのraw job shapeを、共通のJobDisplayModelへ正規化するmapping
//   - 一覧/詳細UIで重複していたstatus label・progress・時刻・duration表示の共通formatting
//
// 明示的に扱わないもの（Design Principles、Issue #131参照）:
//   - execution model・persistence・cancellation semantics自体の統合（別系統のまま）
//   - polling cadenceの統一（TrainingViewは固定間隔・JobsViewは可変間隔のまま）
//   - Training固有のlog parsing進捗（parseTrainingProgress等、trainingLog.js）の置き換え
//     （本モジュールは計算済みのprogress値を受け取るのみで、自ら再計算しない）
//
// rawStatus（backendの実際の値）は必ず保持し、canonical categoryへのmappingは
// 表示専用の追加情報として提供する（既存語彙を書き換えない）。

export const JOB_DISPLAY_SOURCES = ["training", "job_manager"];

// UI表示用canonical category。Issue #131の例示（queued/running/success/failed/
// cancelled/interrupted）に加え、System Bの`cancel_requested`（停止要求受付済み・
// 再度キャンセル不可・再実行不可という既存UIの区別）を保持するため`cancelling`を追加した。
export const CANONICAL_JOB_STATUSES = [
  "queued",
  "running",
  "cancelling",
  "success",
  "failed",
  "cancelled",
  "interrupted",
  "unknown",
];

// System A（`training_jobs`テーブル、main.pyの実際の語彙。#123/#125調査で確定済み）
const TRAINING_STATUS_TO_CANONICAL = {
  queued: "queued",
  running: "running",
  completed: "success",
  failed: "failed",
  stopped: "cancelled",
};

// System B（`job_manager.py::JOB_STATUSES`、#127調査で確定済み）
const JOB_MANAGER_STATUS_TO_CANONICAL = {
  queued: "queued",
  running: "running",
  succeeded: "success",
  failed: "failed",
  cancel_requested: "cancelling",
  cancelled: "cancelled",
  interrupted: "interrupted",
};

function toCanonicalStatus(source, rawStatus) {
  const table = source === "training" ? TRAINING_STATUS_TO_CANONICAL : JOB_MANAGER_STATUS_TO_CANONICAL;
  return table[rawStatus] || "unknown";
}

// rawStatus単体をcanonical categoryへ写像する（job object全体を組み立てずに
// status labelだけを引きたい呼び出し元向けの薄いラッパー）。
export function mapStatusToCanonical(source, rawStatus) {
  if (!JOB_DISPLAY_SOURCES.includes(source)) {
    throw new Error(`unknown job display source: ${source}`);
  }
  return toCanonicalStatus(source, rawStatus);
}

// キャンセル可否: 両System共通で「queued/running（cancel_requestedより前）」のみ
// 実行中止操作が可能、という既存UIのルール（JobsView.jsx・TrainingView.jsxの既存
// ボタン表示条件と同一）。呼び出すendpoint/実際のsemantics（OS process kill vs
// cooperative cancel）はここでは扱わない＝呼び出し元がsource discriminatorで分岐する。
function canCancelForCategory(category) {
  return category === "queued" || category === "running";
}

// 再実行可否: 終端状態（success/failed/cancelled/interrupted）のみ。
// JobsView.jsxの既存の再実行ボタン表示条件と同一。
function canRetryForCategory(category) {
  return category === "success" || category === "failed" || category === "cancelled" || category === "interrupted";
}

/**
 * raw job object（training_jobsレコード、またはjob_managerレコード）を
 * 共通のJobDisplayModelへ正規化する。
 *
 * @param {"training"|"job_manager"} source
 * @param {object} raw - backendのraw job object（存在しないフィールドはundefinedのまま渡してよい）
 * @param {object} [options]
 * @param {number|null} [options.progressOverride] - System A向け。parseTrainingProgress等の
 *   既存log parsing結果から計算済みのprogress（0-100 or null）を渡す。System Aのraw job
 *   にはprogress相当のフィールドが無いため、本関数はこれ以外の方法でprogressを捏造しない。
 * @returns {object|null} JobDisplayModel。rawが無ければnull。
 */
export function toJobDisplayModel(source, raw, options = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (!JOB_DISPLAY_SOURCES.includes(source)) {
    throw new Error(`unknown job display source: ${source}`);
  }

  const isTraining = source === "training";
  const rawStatus = String((isTraining ? raw.status : raw.status) || "");
  const category = toCanonicalStatus(source, rawStatus);

  const id = String((isTraining ? raw.id : raw.job_id) || "") || null;
  const type = isTraining ? raw.training_family ?? null : raw.job_type ?? null;
  const engine = isTraining ? raw.engine ?? null : null;

  let progress = null;
  if (isTraining) {
    const override = options.progressOverride;
    progress = override === null || override === undefined ? null : Number(override);
  } else if (raw.progress !== null && raw.progress !== undefined) {
    progress = Number(raw.progress);
  }
  if (progress !== null && !Number.isFinite(progress)) {
    progress = null;
  }

  const message = raw.message || null;
  const error = isTraining
    ? (category === "failed" ? raw.message || null : null)
    : raw.error_summary || null;

  return {
    id,
    source,
    type,
    engine,
    displayStatus: category,
    rawStatus,
    progress,
    message,
    error,
    createdAt: raw.created_at || null,
    // System A（training_jobs）にはstarted_at/finished_atが無く、updated_atのみ存在する。
    // System B（job_manager）はstarted_at/finished_atのみでupdated_atが無い。
    // 存在しない値は捏造せずnullのままにする。
    startedAt: isTraining ? null : raw.started_at || null,
    updatedAt: isTraining ? raw.updated_at || null : null,
    finishedAt: isTraining ? null : raw.finished_at || null,
    canCancel: canCancelForCategory(category),
    canRetry: canRetryForCategory(category),
    canOpenDetails: true,
  };
}

// 表示用ラベル（既存語彙、JobsView.jsx::JOB_STATUS_LABELSと同じ日本語。
// canonical categoryに対する共通ラベルとして再利用する）
export const CANONICAL_JOB_STATUS_LABELS = {
  queued: "待機中",
  running: "実行中",
  cancelling: "キャンセル要求中",
  success: "成功",
  failed: "失敗",
  cancelled: "キャンセル済",
  interrupted: "中断（再起動）",
  unknown: "状態不明",
};

// 状態バッジの配色クラス（既存JobsView.jsx::statusChipClassと同じ配色ルールを
// canonical categoryベースへ一般化したもの。既存の見た目を変更しない）
export function jobStatusBadgeClass(category) {
  if (category === "running") return "border-accent/50 bg-accent/15 text-blue-200";
  if (category === "success") return "border-success/40 bg-success/10 text-success";
  if (category === "failed") return "border-danger/40 bg-danger/10 text-danger";
  if (category === "cancelling" || category === "interrupted") return "border-amber-400/50 bg-amber-400/10 text-amber-200";
  return "border-border/60 bg-card/40 text-muted";
}

// 日時表示（既存JobsView.jsx::dateLabelと同一。"YYYY-MM-DDThh:mm:ss..." → "MM-DD hh:mm"）
export function formatJobTimestamp(value) {
  return value ? String(value).slice(5, 16).replace("T", " ") : "-";
}

// 実行時間（開始〜終了 / 実行中は開始〜現在）。既存JobsView.jsx::jobDurationと同一の
// 計算ロジックだが、JobDisplayModel（startedAt/finishedAt）を入力に取る。
export function formatJobDuration(displayModel) {
  const start = displayModel?.startedAt ? new Date(displayModel.startedAt).getTime() : null;
  if (!start || Number.isNaN(start)) return "-";
  const end = displayModel?.finishedAt ? new Date(displayModel.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}
