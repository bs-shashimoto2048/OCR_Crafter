import { useMemo, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";

// 「続きから作業」の遷移先（既存の view id をそのまま使用）。stepId はワークフロー進捗との対応
const QUICK_ACTIONS = [
  { id: "images", stepId: "images", icon: "📷", label: "画像取込み" },
  { id: "preprocess", stepId: "preprocess", icon: "🛠", label: "前処理設定" },
  { id: "labeling", stepId: "labeling", icon: "🏷", label: "ラベル編集" },
  { id: "ocr-training", stepId: "ocr-training", icon: "🧠", label: "データ作成・学習" },
  { id: "ocr-eval", stepId: "evaluation", icon: "📈", label: "評価" },
];

function StatItem({ label, value, accent }) {
  return (
    <div className="flex items-baseline justify-center gap-1.5 rounded-lg border border-border bg-card/45 px-2 py-1">
      <span className={`text-base font-semibold leading-tight ${accent ? "text-emerald-300" : "text-text"}`}>{value}</span>
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  );
}

export default function DashboardView({
  projectId,
  projects,
  projectSummaries,
  newProjectId,
  onNewProjectIdChange,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onNavigate,
  workflowSteps = [],
  currentStepLabel = "",
  imagesCount,
  labeledCount,
  modelCount,
}) {
  const [search, setSearch] = useState("");
  const currentSummary = projectSummaries?.[projectId] || {};
  const ocrConfirmedCount = Number(currentSummary.ocr_confirmed || 0);

  // 進捗率: 画像取込 / ラベル付け / OCR修正 / モデル作成 の4要素を均等配分で概算
  const progressPercent = useMemo(() => {
    if (!imagesCount) return 0;
    const labeledRatio = Math.min(1, labeledCount / imagesCount);
    const ocrRatio = Math.min(1, ocrConfirmedCount / imagesCount);
    const modelScore = modelCount > 0 ? 1 : 0;
    return Math.round(((1 + labeledRatio + ocrRatio + modelScore) / 4) * 100);
  }, [imagesCount, labeledCount, ocrConfirmedCount, modelCount]);

  const filteredProjects = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter((pid) => pid.toLowerCase().includes(keyword));
  }, [projects, search]);

  function stepStatusOf(stepId) {
    const step = workflowSteps.find((item) => item.id === stepId);
    return step?.status || "todo";
  }

  function quickCardClass(status) {
    if (status === "current" || status === "running") {
      return "border-accent/60 bg-accent/15 text-blue-100";
    }
    if (status === "done") {
      return "border-success/40 bg-success/10 text-success";
    }
    return "border-border bg-card/45 text-text hover:border-accent/40";
  }

  function quickCountOf(actionId) {
    if (actionId === "images") return imagesCount > 0 ? `${imagesCount}件` : "";
    if (actionId === "labeling") return imagesCount > 0 ? `${labeledCount} / ${imagesCount}` : "";
    if (actionId === "ocr-training") return modelCount > 0 ? `モデル ${modelCount}` : "";
    return "";
  }

  return (
    <div className="flex h-[calc(100vh-238px)] min-h-[440px] flex-col gap-3">
      {/* 上段: 現在のプロジェクト(55%) + 続きから作業(45%) */}
      <div className="grid shrink-0 grid-cols-[minmax(0,55fr)_minmax(0,45fr)] gap-3">
        <Card title="現在のプロジェクト" className="flex flex-col">
          <div className="flex items-center gap-2">
            <p className="truncate text-2xl font-semibold text-text" title={projectId}>
              {projectId || "-"}
            </p>
            <span className="shrink-0 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              使用中
            </span>
          </div>

          {imagesCount > 0 ? (
            <div className="mt-2.5">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] text-muted">進捗</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-border/40">
                  <div className="h-full rounded-sm bg-accent/80" style={{ width: `${progressPercent}%` }} />
                </div>
                <span className="shrink-0 text-sm font-semibold text-accent">{progressPercent}%</span>
              </div>
            </div>
          ) : (
            <div className="mt-2.5 rounded-lg border border-border bg-card/45 px-4 py-3 text-center">
              <p className="text-sm text-text">画像がありません</p>
              <p className="mt-0.5 text-xs text-muted">最初に画像を取り込みましょう</p>
              <Button size="sm" className="mt-2" onClick={() => onNavigate?.("images")}>
                📷 画像取込みへ
              </Button>
            </div>
          )}

          <div className="mt-2.5 grid grid-cols-4 gap-2">
            <StatItem label="画像" value={imagesCount} />
            <StatItem label="ラベル" value={labeledCount} />
            <StatItem label="OCR修正" value={ocrConfirmedCount} accent />
            <StatItem label="モデル" value={modelCount} />
          </div>
        </Card>

        <Card
          title="続きから作業"
          className="flex flex-col"
          actions={
            currentStepLabel ? (
              <span className="text-[11px] text-muted">
                現在の工程: <span className="font-semibold text-accent">{currentStepLabel}</span>
              </span>
            ) : null
          }
        >
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK_ACTIONS.map((action, index) => {
              const status = stepStatusOf(action.stepId);
              const count = quickCountOf(action.id);
              const isLastOdd = index === QUICK_ACTIONS.length - 1 && QUICK_ACTIONS.length % 2 === 1;
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onNavigate?.(action.id)}
                  title={`${action.label}の画面へ移動`}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${quickCardClass(status)} ${
                    isLastOdd ? "col-span-2" : ""
                  }`}
                >
                  <span className="text-base" aria-hidden="true">
                    {action.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  {count ? <span className="shrink-0 text-[11px] font-normal opacity-80">{count}</span> : null}
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* 下段: プロジェクト一覧（この領域のみ内部スクロール） */}
      <Card title="プロジェクト一覧" subtitle={`${projects.length}件`} className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex shrink-0 items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="app-input h-8 w-56 text-xs"
            placeholder="検索（プロジェクト名）"
          />
          <div className="ml-auto flex items-center gap-2">
            <input
              value={newProjectId}
              onChange={(event) => onNewProjectIdChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCreateProject();
                }
              }}
              className="app-input h-8 w-44 text-xs"
              placeholder="新規プロジェクト名"
            />
            <Button size="sm" variant="secondary" onClick={onCreateProject}>
              作成
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60 bg-card/40">
          {filteredProjects.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              {projects.length === 0
                ? "プロジェクトがありません。右上の入力欄から作成してください。"
                : "検索条件に一致するプロジェクトがありません。"}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#2f3841]/95 backdrop-blur">
                <tr className="border-b border-border text-left text-[11px] text-muted">
                  <th className="w-8 px-2 py-2 font-medium" />
                  <th className="px-2 py-2 font-medium">プロジェクト名</th>
                  <th className="w-16 px-2 py-2 text-center font-medium">画像</th>
                  <th className="w-16 px-2 py-2 text-center font-medium">ラベル</th>
                  <th className="w-16 px-2 py-2 text-center font-medium">OCR修正</th>
                  <th className="w-16 px-2 py-2 text-center font-medium">モデル</th>
                  <th className="w-20 px-2 py-2 text-center font-medium">状態</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((pid) => {
                  const selected = pid === projectId;
                  const summary = projectSummaries?.[pid] || {};
                  return (
                    <tr
                      key={pid}
                      onClick={() => onSelectProject(pid)}
                      className={`h-10 cursor-pointer border-b border-border/60 transition ${
                        selected ? "bg-accent/10" : "hover:bg-accent/5"
                      }`}
                    >
                      <td className={`px-2 py-1.5 text-center ${selected ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"}`}>
                        <span className={selected ? "text-accent" : "text-transparent"} aria-hidden="true">
                          ★
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="block truncate font-semibold text-text" title={pid}>
                          {pid}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center text-muted">{Number(summary.images || 0)}</td>
                      <td className="px-2 py-1.5 text-center text-muted">{Number(summary.labeled || 0)}</td>
                      <td className="px-2 py-1.5 text-center text-emerald-300/90">{Number(summary.ocr_confirmed || 0)}</td>
                      <td className="px-2 py-1.5 text-center text-muted">{Number(summary.models || 0)}</td>
                      <td className="px-2 py-1.5 text-center">
                        {selected ? (
                          <span className="rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                            使用中
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 px-2 text-[11px]"
                            disabled={selected}
                            onClick={() => onSelectProject(pid)}
                          >
                            開く
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => onDeleteProject(pid)}
                          >
                            削除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
