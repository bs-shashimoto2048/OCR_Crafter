import { useEffect, useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import ModelIdBadge from "../components/ModelIdBadge";
import { API_BASE, request } from "../lib/api";
import { buildExperimentDiff, normalizeExperiment, resolveAnalysisScope } from "../lib/experimentAnalysis";
import {
  RELEASE_STATUS_LABELS,
  experimentByModel,
  productionComparison,
  promoteWarnings,
  releaseJudgement,
} from "../lib/releaseLogic";
import {
  RULE_RESULT_LABELS,
  VERDICT_LABELS,
  canSubmitPromote,
  formToPolicy,
  overrideRequired,
  policyToForm,
} from "../lib/releaseGate";

const SCROLL_AREA = "dark-scroll [overscroll-behavior:contain] [scrollbar-gutter:stable]";

function statusChipClass(status) {
  if (status === "Production") return "border-success/40 bg-success/10 text-success";
  if (status === "Candidate") return "border-accent/50 bg-accent/15 text-blue-200";
  if (status === "Validated") return "border-border bg-card/60 text-text";
  if (status === "Archived") return "border-border/60 bg-card/40 text-muted";
  return "border-border/60 bg-card/40 text-muted"; // Draft
}

function dateLabel(value) {
  return value ? String(value).slice(0, 16).replace("T", " ") : "-";
}

export default function ReleasesView({
  projectId,
  releases = { production: "", statuses: {}, history: [] },
  experiments = [],
  modelInfos = {},
  loading = false,
  onRefresh,
  onSetStatus,
  onPromote,
  onRollback,
  onOpenModel,
}) {
  const items = useMemo(() => experiments.map(normalizeExperiment), [experiments]);
  const production = releases.production || "";
  const productionExp = useMemo(() => experimentByModel(items, production), [items, production]);
  const statuses = releases.statuses || {};
  const history = releases.history || [];
  const modelNames = Object.keys(statuses).filter((name) => !statuses[name]?.missing);

  // 昇格パネル（候補モデル選択→リリース判定・警告・Release Note入力）
  const [promoteTarget, setPromoteTarget] = useState("");
  const [releaseNote, setReleaseNote] = useState("");
  const [author, setAuthor] = useState("");
  const [versionInput, setVersionInput] = useState("");
  // Release Gate（サーバー判定）＋例外承認（FAIL時のみ必須）
  const [gate, setGate] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  useEffect(() => {
    setGate(null);
    setOverrideReason("");
    setApprovedBy("");
    if (!promoteTarget) return;
    let cancelled = false;
    request(`/api/releases/gate?project_id=${encodeURIComponent(projectId)}&model=${encodeURIComponent(promoteTarget)}`)
      .then((data) => {
        if (!cancelled) setGate(data);
      })
      .catch(() => {
        if (!cancelled) setGate(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoteTarget, projectId]);

  // Release Policy編集（プロジェクト毎のGateルール設定）
  const [policyForm, setPolicyForm] = useState(null);
  const [policyError, setPolicyError] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  async function loadPolicy() {
    try {
      const data = await request(`/api/releases/policy?project_id=${encodeURIComponent(projectId)}`);
      setPolicyForm(policyToForm(data?.policy));
      setPolicyError("");
    } catch (error) {
      setPolicyError(`Policyの取得に失敗しました: ${error.message}`);
    }
  }
  async function savePolicy() {
    const { policy, error } = formToPolicy(policyForm);
    if (error) {
      setPolicyError(error);
      return;
    }
    try {
      const data = await request("/api/releases/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, policy }),
      });
      setPolicyForm(policyToForm(data?.policy));
      setPolicyError("");
      if (promoteTarget) {
        const gateData = await request(
          `/api/releases/gate?project_id=${encodeURIComponent(projectId)}&model=${encodeURIComponent(promoteTarget)}`
        );
        setGate(gateData);
      }
    } catch (error) {
      setPolicyError(`Policyの保存に失敗しました: ${error.message}`);
    }
  }
  const candidateExp = useMemo(() => experimentByModel(items, promoteTarget), [items, promoteTarget]);
  const judgement = useMemo(() => releaseJudgement(candidateExp), [candidateExp]);
  const candidateScope = useMemo(
    () => resolveAnalysisScope(items, { scientificMode: true, groupId: candidateExp?.comparableGroup || "" }),
    [items, candidateExp]
  );
  const warnings = useMemo(
    () =>
      promoteTarget
        ? promoteWarnings({
            candidate: candidateExp,
            production: productionExp,
            groupBasisCount: candidateExp?.comparableGroup ? candidateScope.basisCount : null,
          })
        : [],
    [promoteTarget, candidateExp, productionExp, candidateScope]
  );
  const comparisonRows = useMemo(() => productionComparison(candidateExp, productionExp), [candidateExp, productionExp]);
  // 比較品質（本番比較の補足として昇格パネルへ表示）は promoteWarnings 内で判定済み

  // Model Card表示
  const [modelCard, setModelCard] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);
  async function loadModelCard() {
    setCardLoading(true);
    try {
      const data = await request(`/api/releases/model_card?project_id=${encodeURIComponent(projectId)}`);
      setModelCard(data);
    } catch (error) {
      setModelCard({ markdown: `取得に失敗しました: ${error.message}` });
    } finally {
      setCardLoading(false);
    }
  }

  // Version比較（Release History内の2バージョンの実験条件差分）
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const versionDiff = useMemo(() => {
    const entryA = history.find((h) => h.version === compareA);
    const entryB = history.find((h) => h.version === compareB);
    if (!entryA || !entryB) return null;
    const expA = experimentByModel(items, entryA.model);
    const expB = experimentByModel(items, entryB.model);
    if (!expA || !expB) return { rows: [], note: "実験記録が見つからないため条件差分を表示できません" };
    return { rows: buildExperimentDiff([expA, expB]), a: entryA, b: entryB };
  }, [compareA, compareB, history, items]);

  function submitPromote() {
    if (!promoteTarget) return;
    onPromote?.(promoteTarget, {
      note: releaseNote,
      author,
      version: versionInput.trim() || null,
      override_reason: overrideReason.trim(),
      approved_by: approvedBy.trim(),
    });
    setPromoteTarget("");
    setReleaseNote("");
    setVersionInput("");
    setOverrideReason("");
    setApprovedBy("");
  }

  const modelIdOf = (name) => modelInfos?.[name]?.model_id || "";
  const cerOf = (name) => {
    const e = experimentByModel(items, name);
    return e && e.cer !== null ? `${(e.cer * 100).toFixed(1)}%` : "-";
  };

  return (
    <div className="space-y-4">
      {/* ① 現在のProduction */}
      <Card
        title="Production（現在使用中）"
        subtitle="1プロジェクトにつきProductionは1モデルだけです"
        actions={
          <div className="flex gap-2">
            {production ? (
              <>
                <Button size="sm" variant="secondary" onClick={loadModelCard} disabled={cardLoading}>
                  {cardLoading ? "生成中..." : "Model Card"}
                </Button>
                <a
                  href={`${API_BASE}/api/releases/deployment_package?project_id=${encodeURIComponent(projectId)}`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-card/60 px-3 text-xs font-semibold text-text transition hover:bg-card/80"
                  title="traineddata・設定JSON・前処理Snapshot・Release Note・Model CardをZIPでExport"
                >
                  Deployment Package
                </a>
              </>
            ) : null}
            <Button size="sm" variant="secondary" onClick={onRefresh} disabled={loading}>
              更新
            </Button>
          </div>
        }
      >
        {production ? (
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 transition hover:border-success/70"
              onClick={() => onOpenModel?.(production)}
              title="モデル管理でカルテを開く"
            >
              <ModelIdBadge modelId={modelIdOf(production)} size="md" />
              <span className="text-text">{production}</span>
            </button>
            <span className="model-id-font model-id-text--lg text-success">v{statuses[production]?.version || "-"}</span>
            {history.find((h) => h.model === production) ? (
              <span className="text-muted">
                リリース: {dateLabel(history.find((h) => h.model === production)?.released_at)}
                {history.find((h) => h.model === production)?.author
                  ? ` / ${history.find((h) => h.model === production).author}`
                  : ""}
              </span>
            ) : null}
            {productionExp ? (
              <span className="text-muted">
                CER <span className="font-semibold text-emerald-300">{cerOf(production)}</span> / {productionExp.id} /{" "}
                {productionExp.comparableGroup || "グループなし"}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-muted">Productionモデルがありません。下の一覧から昇格してください。</p>
        )}
        {modelCard ? (
          <details open className="mt-3 rounded-lg border border-border/70 bg-card/45 px-3 py-2">
            <summary className="cursor-pointer select-none text-[13px] font-semibold text-text">
              Model Card（自動生成・Markdown）
            </summary>
            <pre className={`mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-black/25 p-3 text-[11px] leading-5 text-slate-200 ${SCROLL_AREA}`}>
              {modelCard.markdown}
            </pre>
          </details>
        ) : null}
      </Card>

      {/* ② モデル別ステータスと昇格 */}
      <Card title="モデルステータス" subtitle="Draft（学習直後）→ Validated（評価完了）→ Candidate（本番候補）→ Production。旧Productionは自動でArchivedになります">
        <div className={`max-h-[40vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                <th className="px-2 py-1.5 font-medium">モデル</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5 font-medium">Version</th>
                <th className="px-2 py-1.5 font-medium">CER</th>
                <th className="px-2 py-1.5 font-medium">Experiment</th>
                <th className="px-2 py-1.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {modelNames.map((name) => {
                const record = statuses[name] || {};
                const experiment = experimentByModel(items, name);
                const isProduction = record.status === "Production";
                return (
                  <tr key={name} className={`border-t border-border/60 ${isProduction ? "bg-success/5" : ""}`}>
                    <td className="min-w-0 max-w-[18rem] px-2 py-1.5">
                      <button type="button" className="flex min-w-0 items-center gap-1.5" onClick={() => onOpenModel?.(name)} title={name}>
                        <ModelIdBadge modelId={modelIdOf(name)} size="sm" />
                        <span className="min-w-0 truncate text-text">{name}</span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {isProduction ? (
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusChipClass("Production")}`}>Production</span>
                      ) : (
                        <select
                          className="app-select h-7 w-auto py-0 text-[11px]"
                          value={record.status || "Draft"}
                          onChange={(e) => onSetStatus?.(name, e.target.value)}
                          title={RELEASE_STATUS_LABELS[record.status || "Draft"]}
                        >
                          <option value="Draft">Draft</option>
                          <option value="Validated">Validated</option>
                          <option value="Candidate">Candidate</option>
                          <option value="Archived">Archived</option>
                        </select>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-text">{record.version ? `v${record.version}` : "-"}</td>
                    <td className="px-2 py-1.5 font-semibold text-emerald-300">{cerOf(name)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted">{experiment?.id || "-"}</td>
                    <td className="px-2 py-1.5">
                      {!isProduction ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => {
                            setPromoteTarget(name);
                            setReleaseNote("");
                          }}
                        >
                          Productionへ昇格
                        </Button>
                      ) : (
                        <span className="text-[11px] text-success">使用中</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {modelNames.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted">
                    モデルがありません（学習完了後に表示されます）
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* 昇格前チェック（リリース判定・安全性警告・本番比較・Release Note） */}
        {promoteTarget ? (
          <div className="mt-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
            <p className="text-[14px] font-semibold text-text">
              Productionへ昇格: <span className="text-blue-200">{promoteTarget}</span>
            </p>
            {/* リリース判定（§3） */}
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] md:grid-cols-4">
              {judgement.map((row) => (
                <div key={row.label}>
                  <span className="text-muted">{row.label}: </span>
                  <span className="text-text">{row.value}</span>
                </div>
              ))}
            </div>
            {/* 安全性警告（§9。禁止はしない） */}
            {warnings.length > 0 ? (
              <div className="mt-2 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2">
                <p className="text-[12px] font-semibold text-amber-200">警告（昇格は可能ですが確認してください）</p>
                {warnings.map((warning) => (
                  <p key={warning} className="mt-0.5 text-[12px] leading-relaxed text-amber-100/90">
                    ・{warning}
                  </p>
                ))}
              </div>
            ) : null}
            {/* Release Gate判定（サーバー判定。FAILは例外承認なしで昇格不可） */}
            {gate ? (
              <div className="mt-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
                <p className="text-[12px] font-semibold text-muted">
                  Release Gate判定:{" "}
                  <span
                    className={
                      VERDICT_LABELS[gate.verdict]?.tone === "success"
                        ? "text-success"
                        : VERDICT_LABELS[gate.verdict]?.tone === "danger"
                          ? "text-danger"
                          : VERDICT_LABELS[gate.verdict]?.tone === "warning"
                            ? "text-amber-200"
                            : "text-muted"
                    }
                  >
                    {VERDICT_LABELS[gate.verdict]?.label || gate.verdict}
                  </span>
                  {!gate.policy_configured ? <span className="ml-2 text-[11px] text-muted">（Release Policy未設定=ルールなし）</span> : null}
                </p>
                {(gate.rules || []).length > 0 ? (
                  <div className={`mt-1 max-h-48 overflow-auto ${SCROLL_AREA}`}>
                    <table className="min-w-full text-[11px] tabular-nums">
                      <thead className="text-left text-muted">
                        <tr>
                          <th className="px-1.5 py-1 font-medium">Rule</th>
                          <th className="px-1.5 py-1 font-medium">Expected</th>
                          <th className="px-1.5 py-1 font-medium">Actual</th>
                          <th className="px-1.5 py-1 font-medium">Result</th>
                          <th className="px-1.5 py-1 font-medium">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gate.rules.map((rule) => (
                          <tr key={rule.rule} className="border-t border-border/40">
                            <td className="whitespace-nowrap px-1.5 py-1 text-text">{rule.rule}</td>
                            <td className="max-w-[14rem] truncate px-1.5 py-1 text-muted" title={String(rule.expected)}>
                              {String(rule.expected)}
                            </td>
                            <td className="max-w-[14rem] truncate px-1.5 py-1 text-text" title={String(rule.actual)}>
                              {String(rule.actual)}
                            </td>
                            <td className="whitespace-nowrap px-1.5 py-1">
                              <span
                                className={
                                  rule.result === "pass"
                                    ? "text-success"
                                    : rule.result === "fail"
                                      ? "text-danger"
                                      : rule.result === "warning"
                                        ? "text-amber-200"
                                        : "text-muted"
                                }
                              >
                                {RULE_RESULT_LABELS[rule.result] || rule.result}
                              </span>
                            </td>
                            <td className="min-w-0 max-w-[20rem] truncate px-1.5 py-1 text-muted" title={rule.message}>
                              {rule.message}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {overrideRequired(gate.verdict) ? (
                  <div className="mt-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2">
                    <p className="text-[12px] font-semibold text-danger">
                      FAIL判定のため、昇格には例外承認（Override理由と承認者の両方）が必要です
                    </p>
                    <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px]">
                      <input
                        className="app-input h-8 text-xs"
                        placeholder="Override理由（必須。例: 顧客要望による暫定リリース）"
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                      />
                      <input
                        className="app-input h-8 text-xs"
                        placeholder="承認者（必須）"
                        value={approvedBy}
                        onChange={(e) => setApprovedBy(e.target.value)}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-muted">承認時、不合格ルールのスナップショットがRelease Historyへ記録されます</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* 本番比較（§8） */}
            {comparisonRows.length > 0 ? (
              <div className="mt-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
                <p className="mb-1 text-[12px] font-semibold text-muted">本番比較（Production → 候補）</p>
                {comparisonRows.map((row) => (
                  <p key={row.label} className="text-[13px]">
                    <span className="text-muted">{row.label}: </span>
                    <span className={row.improved === true ? "text-success" : row.improved === false ? "text-danger" : "text-text"}>
                      {row.value}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px_140px]">
              <textarea
                className="app-input min-h-[60px] text-xs"
                placeholder="Release Note（必須。例: CERを31.2→28.7へ改善 / CLAHE追加 / Iteration10000へ変更）"
                value={releaseNote}
                onChange={(e) => setReleaseNote(e.target.value)}
              />
              <input
                className="app-input h-8 text-xs"
                placeholder="Author（任意）"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
              <input
                className="app-input h-8 text-xs"
                placeholder="Version（空=自動）"
                value={versionInput}
                onChange={(e) => setVersionInput(e.target.value)}
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={submitPromote}
                disabled={
                  !canSubmitPromote({
                    verdict: gate?.verdict || "PASS",
                    note: releaseNote,
                    overrideReason,
                    approvedBy,
                  })
                }
                title={
                  !releaseNote.trim()
                    ? "Release Noteは必須です"
                    : overrideRequired(gate?.verdict) && (!overrideReason.trim() || !approvedBy.trim())
                      ? "FAIL判定のためOverride理由と承認者が必要です"
                      : ""
                }
              >
                昇格を実行
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPromoteTarget("")}>
                キャンセル
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {/* ③ Release Policy（プロジェクト毎のGateルール設定） */}
      <Card
        title="Release Policy（Gateルール）"
        subtitle="Productionへ昇格するモデルが満たすべき基準。未設定の項目はルール無効（従来どおり制限なし）"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const next = !policyOpen;
              setPolicyOpen(next);
              if (next && !policyForm) loadPolicy();
            }}
          >
            {policyOpen ? "閉じる" : "Policyを編集"}
          </Button>
        }
      >
        {policyOpen && policyForm ? (
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
              {[
                ["maxCerPct", "Max CER（%）"],
                ["minCharAccuracyPct", "Min 文字正解率（%）"],
                ["minExactMatchPct", "Min 完全一致率（%）"],
                ["minEvalImages", "Min 評価画像数"],
                ["maxFailed", "Max Failed（BM）"],
                ["maxBenchmarkRank", "Max BM順位"],
                ["minComparisonQuality", "Min 比較品質（1-5）"],
              ].map(([key, label]) => (
                <label key={key} className="text-[11px] text-muted">
                  {label}
                  <input
                    type="number"
                    className="app-input mt-0.5 h-8 w-full text-xs"
                    value={key === "maxBenchmarkRank" ? policyForm.maxBenchmarkRank ?? "" : policyForm[key] ?? ""}
                    placeholder="未設定"
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, [key === "maxBenchmarkRank" ? "maxBenchmarkRank" : key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 text-[12px] text-text">
                <input
                  type="checkbox"
                  checked={policyForm.noCerRegression}
                  onChange={(e) => setPolicyForm({ ...policyForm, noCerRegression: e.target.checked })}
                />
                Production比CER悪化なし
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-text">
                <input
                  type="checkbox"
                  checked={policyForm.requireSameEvaluationHash}
                  onChange={(e) => setPolicyForm({ ...policyForm, requireSameEvaluationHash: e.target.checked })}
                />
                ProductionとEvaluation Hash同一
              </label>
              {["tesseract", "paddleocr"].map((engine) => (
                <label key={engine} className="flex items-center gap-1.5 text-[12px] text-text">
                  <input
                    type="checkbox"
                    checked={policyForm.allowedEngines.includes(engine)}
                    onChange={(e) =>
                      setPolicyForm({
                        ...policyForm,
                        allowedEngines: e.target.checked
                          ? [...policyForm.allowedEngines, engine]
                          : policyForm.allowedEngines.filter((item) => item !== engine),
                      })
                    }
                  />
                  許可エンジン: {engine}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <label className="text-[11px] text-muted">
                必須文字（空=ルール無効）
                <input
                  className="app-input mt-0.5 h-8 w-full text-xs"
                  placeholder="例: 0O1Il5S"
                  value={policyForm.requiredChars}
                  onChange={(e) => setPolicyForm({ ...policyForm, requiredChars: e.target.value })}
                />
              </label>
              <label className="text-[11px] text-muted">
                必須文字の最低正解率（%）
                <input
                  type="number"
                  className="app-input mt-0.5 h-8 w-full text-xs"
                  value={policyForm.requiredCharsMinAccuracyPct}
                  onChange={(e) => setPolicyForm({ ...policyForm, requiredCharsMinAccuracyPct: e.target.value })}
                />
              </label>
              <label className="text-[11px] text-muted" title="1行1ルール。0→O:fail（1件でもFAIL） / 1→I:warning:2（3件以上で警告）">
                Critical Confusions（1行1ルール・warning/fail選択）
                <textarea
                  className="app-input mt-0.5 min-h-[52px] w-full text-xs"
                  placeholder={"0→O:fail\n1→I:warning"}
                  value={policyForm.criticalConfusionsText}
                  onChange={(e) => setPolicyForm({ ...policyForm, criticalConfusionsText: e.target.value })}
                />
              </label>
            </div>
            {policyError ? <p className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-danger">{policyError}</p> : null}
            <Button size="sm" onClick={savePolicy}>
              Policyを保存
            </Button>
          </div>
        ) : (
          <p className="text-[12px] text-muted">
            「Policyを編集」で基準（Max CER・必須文字・Critical Confusions等）を設定できます。FAIL判定のモデルは例外承認なしで昇格できません。
          </p>
        )}
      </Card>

      {/* ④ Release History（Version比較・Rollback） */}
      <Card title="Release History" subtitle="Productionリリースの履歴（新しい順）。RollbackはVersionを維持し新しいRelease IDで記録されます">
        <div className={`max-h-[40vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                <th className="px-2 py-1.5 font-medium">比較</th>
                <th className="px-2 py-1.5 font-medium">Release ID</th>
                <th className="px-2 py-1.5 font-medium">Version</th>
                <th className="px-2 py-1.5 font-medium">Model</th>
                <th className="px-2 py-1.5 font-medium">Release Date</th>
                <th className="px-2 py-1.5 font-medium">Author</th>
                <th className="px-2 py-1.5 font-medium">Reason</th>
                <th className="px-2 py-1.5 font-medium">Rollback</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={`${entry.version}-${entry.released_at}`} className="border-t border-border/60">
                  <td className="px-2 py-1.5">
                    <label className="mr-1 text-[10px] text-muted">
                      A
                      <input type="radio" name="release-compare-a" className="ml-0.5" checked={compareA === entry.version} onChange={() => setCompareA(entry.version)} />
                    </label>
                    <label className="text-[10px] text-muted">
                      B
                      <input type="radio" name="release-compare-b" className="ml-0.5" checked={compareB === entry.version} onChange={() => setCompareB(entry.version)} />
                    </label>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className="model-id-font model-id-text--sm text-muted">{entry.release_id || "-"}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className="model-id-font model-id-text--sm text-blue-200">v{entry.version}</span>
                    {entry.rollback ? (
                      <span className="ml-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-1 py-0.5 text-[9px] text-amber-200">
                        Rollback
                      </span>
                    ) : null}
                    {entry.override ? (
                      <span
                        className="ml-1 rounded-full border border-danger/40 bg-danger/10 px-1 py-0.5 text-[9px] text-danger"
                        title={`Override: ${entry.override.reason}（承認: ${entry.override.approved_by} / ${String(entry.override.approved_at || "").slice(0, 16).replace("T", " ")}）`}
                      >
                        Override
                      </span>
                    ) : null}
                  </td>
                  <td className="min-w-0 max-w-[14rem] truncate px-2 py-1.5 text-text" title={entry.model}>
                    {entry.model}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted">{dateLabel(entry.released_at)}</td>
                  <td className="px-2 py-1.5 text-muted">{entry.author || "-"}</td>
                  <td className="min-w-0 max-w-[18rem] truncate px-2 py-1.5 text-text" title={entry.note}>
                    {entry.note}
                  </td>
                  <td className="px-2 py-1.5">
                    {entry.model !== production ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => {
                          if (window.confirm(`Productionを v${entry.version}（${entry.model}）へ戻します。よろしいですか？`)) {
                            onRollback?.(entry.version, author);
                          }
                        }}
                      >
                        このVersionへ戻す
                      </Button>
                    ) : (
                      <span className="text-[11px] text-success">現行</span>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">
                    リリース履歴がありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Version比較（§12）: 選択した2バージョンの実験条件差分 */}
        {versionDiff ? (
          <div className="mt-3 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
            <p className="mb-1.5 text-[13px] font-semibold text-text">
              Version比較: v{compareA} ↔ v{compareB}
            </p>
            {versionDiff.note ? (
              <p className="text-[12px] text-muted">{versionDiff.note}</p>
            ) : (
              <div className="comparison-table-wrap">
                <table className="w-full text-[12px]">
                  <tbody>
                    {versionDiff.rows
                      .filter((row) => row.changed)
                      .map((row) => (
                        <tr key={row.key} className="border-t border-border/40 bg-amber-400/10">
                          <td className="px-2 py-1 font-semibold text-amber-200">{row.label}</td>
                          <td className="px-2 py-1 text-text">{row.values[0]}</td>
                          <td className="px-2 py-1 text-text">{row.values[1]}</td>
                        </tr>
                      ))}
                    {versionDiff.rows.filter((row) => row.changed).length === 0 ? (
                      <tr>
                        <td className="px-2 py-2 text-muted">条件差分なし（同一条件のリリースです）</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
