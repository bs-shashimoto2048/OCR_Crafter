import { useMemo, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";

// 「続きから作業」の遷移先（既存の view id をそのまま使用）
const QUICK_ACTIONS = [
  { id: "images", icon: "📷", label: "画像取込み" },
  { id: "preprocess", icon: "🛠", label: "前処理設定" },
  { id: "labeling", icon: "🏷", label: "ラベル編集" },
  { id: "ocr-training", icon: "🧠", label: "データ作成・学習" },
  { id: "ocr-eval", icon: "📈", label: "評価" },
];

function StatItem({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-border bg-card/45 px-3 py-1.5 text-center">
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`text-lg font-semibold leading-tight ${accent ? "text-emerald-300" : "text-text"}`}>{value}</p>
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

  return (
    <div className="flex h-[calc(100vh-238px)] min-h-[440px] flex-col gap-3">
      {/* 上段: 現在のプロジェクト + 続きから作業 */}
      <div className="grid shrink-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
        <Card title="現在のプロジェクト" subtitle="使用中" className="flex flex-col">
          <p className="truncate text-xl font-semibold text-text" title={projectId}>
            {projectId || "-"}
          </p>
          {imagesCount > 0 ? (
            <>
              <div className="mt-2 grid grid-cols-4 gap-2">
                <StatItem label="画像" value={imagesCount} />
                <StatItem label="ラベル" value={labeledCount} />
                <StatItem label="OCR修正" value={ocrConfirmedCount} accent />
                <StatItem label="モデル" value={modelCount} />
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>Progress</span>
                  <span className="font-semibold text-accent">{progressPercent}%</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-border/40">
                  <div className="h-full rounded-sm bg-accent/80" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            </>
          ) : (
            <div className="mt-3 rounded-lg border border-border bg-card/45 px-4 py-5 text-center">
              <p className="text-sm text-text">画像がありません。</p>
              <p className="mt-1 text-xs text-muted">最初に画像を取り込みましょう。</p>
              <Button className="mt-3" onClick={() => onNavigate?.("images")}>
                📷 画像取込み
              </Button>
            </div>
          )}
        </Card>

        <Card title="続きから作業" subtitle="次の工程へ1クリックで移動" className="flex flex-col">
          <div className="grid grid-cols-1 gap-1.5">
            {QUICK_ACTIONS.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant="secondary"
                className="justify-start"
                onClick={() => onNavigate?.(action.id)}
              >
                <span className="mr-1.5" aria-hidden="true">
                  {action.icon}
                </span>
                {action.label}
              </Button>
            ))}
          </div>
          {currentStepLabel ? (
            <p className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted">
              現在の工程: <span className="font-semibold text-accent">{currentStepLabel}</span>
            </p>
          ) : null}
        </Card>
      </div>

      {/* 下段: プロジェクト一覧（この領域のみ内部スクロール） */}
      <Card title="プロジェクト一覧" subtitle={`${projects.length}件`} className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="app-input h-8 w-48 text-xs"
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
              className="app-input h-8 w-48 text-xs"
              placeholder="新規プロジェクト名"
            />
            <Button size="sm" variant="secondary" onClick={onCreateProject}>
              新規作成
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          {filteredProjects.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              {projects.length === 0
                ? "プロジェクトがありません。右上の入力欄から作成してください。"
                : "検索条件に一致するプロジェクトがありません。"}
            </p>
          ) : (
            <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border bg-card/55 backdrop-blur-md">
              {filteredProjects.map((pid) => {
                const selected = pid === projectId;
                const summary = projectSummaries?.[pid] || {};
                return (
                  <div
                    key={pid}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectProject(pid)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectProject(pid);
                      }
                    }}
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-left transition ${
                      selected ? "bg-accent/15" : "hover:bg-accent/10"
                    }`}
                  >
                    <span className="w-4 shrink-0 text-center text-sm" aria-hidden="true">
                      {selected ? "★" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text" title={pid}>
                      {pid}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted sm:inline">
                      画像{Number(summary.images || 0)} | ラベル{Number(summary.labeled || 0)} | 修正
                      {Number(summary.ocr_confirmed || 0)} | モデル{Number(summary.models || 0)}
                    </span>
                    {selected ? (
                      <span className="shrink-0 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                        🟢 使用中
                      </span>
                    ) : (
                      <span className="w-[68px] shrink-0" aria-hidden="true" />
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      className="h-6 px-2 text-[11px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteProject(pid);
                      }}
                    >
                      削除
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
