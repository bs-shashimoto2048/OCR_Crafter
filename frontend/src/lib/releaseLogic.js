// モデルリリース管理の純ロジック。
// リリース判定（Productionへ昇格する前の確認情報）・昇格時の安全性警告・本番比較・
// バージョン提案を、実験カルテ（experimentAnalysis.normalizeExperiment済み）と
// /api/releases の状態から組み立てる。

import { analysisExclusionReason, comparisonQuality } from "./experimentAnalysis.js";

// ステータス表示（色はUI側でこのidに対応させる）
export const RELEASE_STATUSES = ["Draft", "Validated", "Candidate", "Production", "Archived"];
export const RELEASE_STATUS_LABELS = {
  Draft: "Draft（学習直後）",
  Validated: "Validated（評価完了）",
  Candidate: "Candidate（本番候補）",
  Production: "Production（使用中）",
  Archived: "Archived（旧モデル）",
};

const pct = (value, digits = 1) => (value === null || value === undefined ? "未記録" : `${(value * 100).toFixed(digits)}%`);

// リリース判定（§3）: Production昇格前に表示する確認情報。
// experiment = 対象モデルの実験（normalizeExperiment済み・無ければnull）
export function releaseJudgement(experiment) {
  const e = experiment || null;
  return [
    { label: "CER", value: e ? pct(e.cer) : "評価未実施" },
    { label: "文字正解率", value: e ? pct(e.charAccuracy) : "評価未実施" },
    { label: "完全一致率", value: e && e.accuracyPercent !== null ? `${e.accuracyPercent}%` : "評価未実施" },
    { label: "Experiment", value: e?.id || "未記録" },
    { label: "Evaluation Group", value: e?.comparableGroup || "なし" },
    { label: "評価データ数", value: e?.evalProfile?.imageCount ?? "未記録" },
    { label: "前処理Hash", value: e?.preprocessHash ? `${e.preprocessSummary || ""}（${e.preprocessShort}）` : "未記録" },
  ];
}

// 昇格時の安全性警告（§9）。禁止はしない=警告文のリストを返す。
// candidate/production = normalizeExperiment済みの実験（無ければnull）、groupBasisCount = 候補のCG内の比較可能実験数
export function promoteWarnings({ candidate, production, groupBasisCount = null }) {
  const warnings = [];
  if (!candidate) {
    warnings.push("評価未実施です（この候補モデルの実験・評価が見つかりません）");
    return warnings;
  }
  if (candidate.cer === null) {
    warnings.push("CERがありません（評価を実行してから昇格することを推奨します）");
  }
  const exclusion = analysisExclusionReason(candidate);
  if (exclusion) {
    warnings.push("Scientific Modeの分析対象外です（" + exclusion + "）");
  }
  if (production && candidate.comparableGroup && production.comparableGroup && candidate.comparableGroup !== production.comparableGroup) {
    warnings.push(`現在のProductionとComparable Groupが異なります（${production.comparableGroup} → ${candidate.comparableGroup}）。CER差は直接比較できません`);
  }
  if (production) {
    const quality = comparisonQuality([candidate, production]);
    if (quality && quality.stars <= 2) {
      warnings.push(`Productionとの比較品質が低い（${quality.starsLabel} ${quality.label}）`);
    }
  }
  if (groupBasisCount !== null && groupBasisCount < 5) {
    warnings.push(`比較可能Experimentが${groupBasisCount}件です（5件未満のため評価は参考値）`);
  }
  return warnings;
}

// 本番比較（§8）: Production と Candidate の差分行
export function productionComparison(candidate, production) {
  if (!candidate || !production) return [];
  const delta = (a, b, scale = 100) =>
    a === null || b === null ? "比較不可" : `${((a - b) * scale >= 0 ? "+" : "")}${((a - b) * scale).toFixed(1)}pt`;
  return [
    {
      label: "CER差（候補 − Production。負=改善）",
      value: delta(candidate.cer, production.cer),
      improved: candidate.cer !== null && production.cer !== null ? candidate.cer < production.cer : null,
    },
    {
      label: "完全一致率差",
      value:
        candidate.accuracyPercent === null || production.accuracyPercent === null
          ? "比較不可"
          : `${(candidate.accuracyPercent - production.accuracyPercent >= 0 ? "+" : "")}${(candidate.accuracyPercent - production.accuracyPercent).toFixed(1)}pt`,
      improved:
        candidate.accuracyPercent !== null && production.accuracyPercent !== null
          ? candidate.accuracyPercent > production.accuracyPercent
          : null,
    },
    {
      label: "前処理差",
      value:
        candidate.preprocessHash && production.preprocessHash
          ? candidate.preprocessHash === production.preprocessHash
            ? "同一"
            : `異なる（${production.preprocessShort} → ${candidate.preprocessShort}）`
          : "未記録あり",
    },
    { label: "Experiment差", value: `${production.id || "未記録"} → ${candidate.id || "未記録"}` },
    {
      label: "Evaluation差",
      value:
        candidate.evaluationHash && production.evaluationHash
          ? candidate.evaluationHash === production.evaluationHash
            ? "同一条件評価"
            : "評価条件が異なる"
          : "未記録あり",
    },
  ];
}

// 実験一覧からモデル名→実験（最新）を引く（リリース画面の判定・比較用）
export function experimentByModel(experiments, model) {
  let found = null;
  for (const e of experiments || []) {
    if ((e.models || []).includes(model)) found = e;
  }
  return found;
}
