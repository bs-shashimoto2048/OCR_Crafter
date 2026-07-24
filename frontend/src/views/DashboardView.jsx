import { useMemo, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";
import { imageUrl, interimImageUrl, processedImageUrl, thumbnailUrl } from "../lib/api";
import { templateOriginLabel } from "../config/projectTemplates";
import {
  SORT_COLUMNS,
  currentStepLabel as rowCurrentStepLabel,
  formatBenchmarkCount,
  formatBestCer,
  formatProductionModel,
  matchesSearch,
  projectStateBadge,
  quickActionEnabled,
  rowProgressPercent,
  sortProjectIds,
} from "../lib/dashboardProjectList";

// 「続きから作業」の遷移先（既存の view id をそのまま使用）。stepId はワークフロー進捗との対応
const QUICK_ACTIONS = [
  { id: "images", stepId: "images", icon: "📷", label: "画像取込み" },
  { id: "preprocess", stepId: "preprocess", icon: "🛠", label: "前処理設定" },
  { id: "labeling", stepId: "labeling", icon: "🏷", label: "ラベル編集" },
  { id: "ocr-training", stepId: "ocr-training", icon: "🧠", label: "データ作成・学習" },
  { id: "ocr-eval", stepId: "evaluation", icon: "📈", label: "評価" },
];

// プロジェクト一覧の行クイックアクション（既存画面への遷移のみ・新規APIは使用しない）
const ROW_QUICK_ACTIONS = [
  { id: "open", icon: "📂", label: "開く", viewId: null },
  { id: "train", icon: "🧠", label: "学習", viewId: "ocr-training" },
  { id: "evaluate", icon: "📈", label: "評価", viewId: "ocr-eval" },
  { id: "benchmark", icon: "🏁", label: "Benchmark", viewId: "benchmark" },
  { id: "report", icon: "📄", label: "レポート", viewId: "reports" },
];

const STAGE_LABELS = {
  processed: "前処理後の最終画像",
  interim: "中間画像",
  raw: "取り込み済み元画像",
};

function StatItem({ label, value, accent }) {
  return (
    <div className="flex items-baseline justify-center gap-1.5 rounded-lg border border-border bg-card/45 px-2 py-1">
      <span className={`text-base font-semibold leading-tight ${accent ? "text-emerald-300" : "text-text"}`}>{value}</span>
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  );
}

// プロジェクト代表サムネイル1枚。読み込み失敗時は元画像へフォールバックし、カード全体は壊さない
function ProjectThumb({ item, projectId, imageVersion, stage, onOpen }) {
  const [rawFallback, setRawFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const useRaw = rawFallback || stage === "raw";
  const src = useRaw
    ? imageUrl(item.image, projectId, imageVersion)
    : stage === "interim"
      ? interimImageUrl(item.image, projectId, imageVersion)
      : processedImageUrl(item.image, projectId, imageVersion, item.type || "");
  return (
    <button
      type="button"
      onClick={() => onOpen?.(item.image)}
      title={`${item.image}（クリックで前処理設定画面で開く）`}
      className="h-14 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-[#3b444f]/40 p-1 transition hover:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      {failed ? (
        <span className="flex h-full items-center justify-center text-[10px] text-muted">読込不可</span>
      ) : (
        <img
          src={src}
          alt={item.image}
          loading="lazy"
          onError={() => {
            if (!useRaw) {
              setRawFallback(true);
            } else {
              setFailed(true);
            }
          }}
          className="h-full w-full rounded object-contain"
        />
      )}
    </button>
  );
}

// 一覧行のサムネイル（約64×40）。優先順位: ①現在ダッシュボードで使用中の代表画像
// （選択中プロジェクトのpreviewItems先頭）②プロジェクトの最初の画像（サーバー生成サムネイル）
// ③EmptyStateアイコン（共通コンポーネントと同じ⊘表記）
function RowThumb({ pid, selected, currentPreviewImage, sampleImage, imageVersion }) {
  const [failed, setFailed] = useState(false);
  const representativeImage = selected ? currentPreviewImage : null;
  const src = representativeImage
    ? imageUrl(representativeImage, pid, imageVersion)
    : sampleImage
      ? thumbnailUrl(sampleImage, pid, 0, 64, 40)
      : "";

  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex h-9 w-11 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card/60 text-sm text-muted"
      >
        ⊘
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-9 w-11 shrink-0 rounded-lg border border-border/70 bg-[#3b444f]/40 object-contain"
    />
  );
}

function formatShortDateTime(value) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RatioCell({ done, total }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : null;
  return (
    <div className="leading-tight">
      <p className="text-text">{total > 0 ? `${done} / ${total}` : "-"}</p>
      {percent !== null ? <p className="text-[10px] text-muted">{percent}%</p> : null}
    </div>
  );
}

export default function DashboardView({
  projectId,
  projects,
  projectSummaries,
  onSelectProject,
  onOpenCreate,
  templateRecord = null,
  templateRecords = null,
  onDeleteProject,
  onNavigate,
  onOpenImageInPreprocess,
  workflowSteps = [],
  currentStepLabel = "",
  images = [],
  imageVersion = 0,
  imagesCount,
  labeledCount,
  modelCount,
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const currentSummary = projectSummaries?.[projectId] || {};
  const ocrConfirmedCount = Number(currentSummary.ocr_confirmed || 0);
  const imageStage = String(currentSummary.image_stage || (imagesCount > 0 ? "raw" : "none"));

  // 進捗率: 画像取込 / ラベル付け / OCR修正 / モデル作成 の4要素を均等配分で概算
  const progressPercent = useMemo(() => {
    if (!imagesCount) return 0;
    const labeledRatio = Math.min(1, labeledCount / imagesCount);
    const ocrRatio = Math.min(1, ocrConfirmedCount / imagesCount);
    const modelScore = modelCount > 0 ? 1 : 0;
    return Math.round(((1 + labeledRatio + ocrRatio + modelScore) / 4) * 100);
  }, [imagesCount, labeledCount, ocrConfirmedCount, modelCount]);

  // 代表サムネイル: ファイル名順から等間隔に最大4枚（再レンダリングで入れ替わらない安定選択）
  const previewItems = useMemo(() => {
    if (!Array.isArray(images) || images.length === 0) return [];
    const count = Math.min(4, images.length);
    const picks = [];
    const used = new Set();
    for (let i = 0; i < count; i += 1) {
      const index = Math.min(images.length - 1, Math.floor((i * images.length) / count));
      if (!used.has(index) && images[index]?.image) {
        used.add(index);
        picks.push(images[index]);
      }
    }
    return picks;
  }, [images]);

  // 検索: プロジェクト名（既存互換）＋テンプレート名＋Productionモデル＋状態
  const filteredProjects = useMemo(() => {
    const keyword = search.trim();
    if (!keyword) return projects;
    return projects.filter((pid) => {
      const summary = projectSummaries?.[pid] || {};
      const origin = templateOriginLabel(templateRecords?.[pid]).origin;
      const stateLabel = projectStateBadge(summary, pid === projectId)?.label || "";
      return matchesSearch(pid, summary, origin, stateLabel, keyword);
    });
  }, [projects, search, projectSummaries, templateRecords, projectId]);

  // ソート: 既存の並び（sortKey未指定）を維持しつつ、列ヘッダークリックで並び替える
  const sortedProjects = useMemo(
    () => sortProjectIds(filteredProjects, projectSummaries, sortKey, sortDir),
    [filteredProjects, projectSummaries, sortKey, sortDir]
  );

  function toggleSort(key) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
      return;
    }
    // 3回目のクリックで既存の並びへ戻す
    setSortKey(null);
    setSortDir("desc");
  }

  // 行クリック・クイックアクション: プロジェクトを開いてから対象画面へ遷移する（新規APIは使わない）
  function openProjectInView(pid, viewId) {
    onSelectProject(pid);
    if (viewId) onNavigate?.(viewId);
  }

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
          {projectId ? (
            <p className="mt-0.5 text-[11px] text-muted">
              作成元テンプレート: {templateOriginLabel(templateRecord).origin}
              {templateOriginLabel(templateRecord).version ? `（テンプレートバージョン: ${templateOriginLabel(templateRecord).version}）` : ""}
            </p>
          ) : null}

          {imagesCount > 0 ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <span className="shrink-0 text-[11px] text-muted">進捗</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-border/40">
                  <div className="h-full rounded-sm bg-accent/80" style={{ width: `${progressPercent}%` }} />
                </div>
                <span className="shrink-0 text-sm font-semibold text-accent">{progressPercent}%</span>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-2">
                <StatItem label="画像" value={imagesCount} />
                <StatItem label="ラベル" value={labeledCount} />
                <StatItem label="OCR修正" value={ocrConfirmedCount} accent />
                <StatItem label="モデル" value={modelCount} />
              </div>

              {previewItems.length > 0 ? (
                <div className="mt-2">
                  <div className="flex gap-1.5">
                    {previewItems.map((item) => (
                      <ProjectThumb
                        key={`${projectId}::${item.image}`}
                        item={item}
                        projectId={projectId}
                        imageVersion={imageVersion}
                        stage={imageStage}
                        onOpen={onOpenImageInPreprocess}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-muted">表示: {STAGE_LABELS[imageStage] || STAGE_LABELS.raw}</p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="mt-2.5 rounded-lg border border-border bg-card/45 px-4 py-3 text-center">
                <p className="text-sm text-text">画像がありません</p>
                <p className="mt-0.5 text-xs text-muted">最初に画像を取り込みましょう</p>
                <Button size="sm" className="mt-2" onClick={() => onNavigate?.("images")}>
                  📷 画像取込みへ
                </Button>
              </div>
              <div className="mt-2.5 grid grid-cols-4 gap-2">
                <StatItem label="画像" value={imagesCount} />
                <StatItem label="ラベル" value={labeledCount} />
                <StatItem label="OCR修正" value={ocrConfirmedCount} accent />
                <StatItem label="モデル" value={modelCount} />
              </div>
            </>
          )}
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
            className="app-input h-8 w-64 text-xs"
            placeholder="検索（プロジェクト名・テンプレート・Production・状態）"
          />
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={onOpenCreate} title="テンプレートを選んで新規プロジェクトを作成します">
              新規プロジェクト
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/60 bg-card/40">
          {filteredProjects.length === 0 ? (
            projects.length === 0 ? (
              <EmptyState
                title="プロジェクトがありません"
                description="最初のプロジェクトを作成しましょう。用途別テンプレート（英数字OCR・日本語OCR・銘板OCRなど）から初期設定を選べます。"
                actionLabel="新規プロジェクトを作成"
                onAction={onOpenCreate}
              />
            ) : (
              <p className="px-3 py-8 text-center text-sm text-muted">検索条件に一致するプロジェクトがありません。</p>
            )
          ) : (
            <table className="w-full min-w-[860px] table-fixed text-sm">
              <thead className="sticky top-0 z-10 bg-[#2f3841]/95 backdrop-blur">
                <tr className="border-b border-border text-left text-[11px] text-muted">
                  <th className="w-14 px-1.5 py-2 font-medium" />
                  <th className="w-[132px] px-1.5 py-2 font-medium">プロジェクト</th>
                  <th className="w-[64px] px-1 py-2 text-center font-medium">状態</th>
                  <th className="w-[62px] px-1 py-2 text-center font-medium">Production</th>
                  <SortableTh col={SORT_COLUMNS[0]} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} width="w-[70px]" />
                  <SortableTh col={SORT_COLUMNS[1]} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} width="w-10" />
                  <SortableTh col={SORT_COLUMNS[2]} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} width="w-14" />
                  <SortableTh col={SORT_COLUMNS[3]} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} width="w-10" />
                  <th className="w-14 whitespace-nowrap px-1 py-2 text-center font-medium">Benchmark</th>
                  <SortableTh col={SORT_COLUMNS[4]} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} width="w-14" />
                  <SortableTh col={SORT_COLUMNS[5]} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} width="w-16" />
                  <th className="w-[136px] px-1 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedProjects.map((pid) => {
                  const selected = pid === projectId;
                  const summary = projectSummaries?.[pid] || {};
                  const totalImages = Number(summary.images || 0);
                  const progress = rowProgressPercent(summary);
                  const stateBadge = projectStateBadge(summary, selected);
                  const origin = templateOriginLabel(templateRecords?.[pid]);
                  const stepLabel = rowCurrentStepLabel(summary);
                  return (
                    <tr
                      key={pid}
                      role="button"
                      tabIndex={0}
                      aria-label={`プロジェクト ${pid} を開く（状態: ${stateBadge?.label || "-"}）`}
                      onClick={() => openProjectInView(pid, null)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openProjectInView(pid, null);
                        }
                      }}
                      className={`h-16 cursor-pointer border-b border-border/60 align-middle transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-inset ${
                        selected ? "bg-accent/10" : "hover:bg-accent/5"
                      }`}
                    >
                      <td className={`px-2 py-1.5 ${selected ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"}`}>
                        <RowThumb
                          pid={pid}
                          selected={selected}
                          currentPreviewImage={previewItems[0]?.image}
                          sampleImage={summary.sample_image}
                          imageVersion={imageVersion}
                        />
                      </td>
                      <td className="min-w-0 px-2 py-1.5">
                        <div className="flex items-center gap-1 truncate">
                          <span className={selected ? "text-accent" : "text-transparent"} aria-hidden="true">
                            ★
                          </span>
                          <span className="truncate font-semibold text-text" title={pid}>
                            {pid}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate pl-3.5 text-[10px] text-muted" title={origin.origin}>
                          {origin.origin}
                          {origin.version ? ` (v${origin.version})` : ""}
                        </p>
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        {stateBadge ? (
                          <span
                            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${stateBadge.className}`}
                          >
                            <span aria-hidden="true">{stateBadge.dot}</span>
                            {stateBadge.label}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        {summary.production_model ? (
                          <div className="leading-tight">
                            <p className="text-[9px] uppercase tracking-wide text-muted">Production</p>
                            <p className="font-semibold text-text" title={summary.production_model}>
                              {formatProductionModel(summary)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-center text-muted">{formatShortDateTime(summary.updated_at)}</td>
                      <td className="px-1 py-1.5 text-center text-muted">{totalImages}</td>
                      <td className="px-1 py-1.5 text-center text-muted">
                        <RatioCell done={Number(summary.labeled || 0)} total={totalImages} />
                      </td>
                      <td className="px-1 py-1.5 text-center text-muted">{Number(summary.models || 0)}</td>
                      <td className="px-1 py-1.5 text-center text-muted">{formatBenchmarkCount(summary)}</td>
                      <td className="px-2 py-1.5 text-center font-semibold text-text">{formatBestCer(summary)}</td>
                      <td className="px-1 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-10 shrink-0 overflow-hidden rounded-sm bg-border/40">
                            <div className="h-full rounded-sm bg-accent/80" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="shrink-0 text-[11px] font-semibold text-accent">{progress}%</span>
                        </div>
                        <p className="mt-0.5 truncate text-[10px] text-muted">{stepLabel}</p>
                      </td>
                      <td className="px-1 py-1.5 text-right" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          {ROW_QUICK_ACTIONS.map((action) => {
                            const enabled = action.id === "open" ? !selected : quickActionEnabled(action.id, summary);
                            return (
                              <button
                                key={action.id}
                                type="button"
                                disabled={!enabled}
                                aria-label={`${pid} を${action.label}へ`}
                                title={`${action.label}${enabled ? "" : "（対象データがありません）"}`}
                                onClick={() => openProjectInView(pid, action.viewId)}
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
                                  enabled
                                    ? "border-border/70 bg-card/60 text-text hover:border-accent/50 hover:text-accent"
                                    : "cursor-not-allowed border-border/40 bg-card/30 text-muted/50"
                                }`}
                              >
                                <span aria-hidden="true">{action.icon}</span>
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            aria-label={`${pid} を削除`}
                            title="削除"
                            onClick={() => onDeleteProject(pid)}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-danger/50 bg-danger/10 text-[10px] text-danger transition hover:bg-danger/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/70"
                          >
                            <span aria-hidden="true">🗑</span>
                          </button>
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

// ソート可能な列見出し（クリックで降順→昇順→既定の並びの順に切り替え）
function SortableTh({ col, sortKey, sortDir, onToggle, width = "w-16" }) {
  const active = sortKey === col.key;
  return (
    <th className={`${width} whitespace-nowrap px-1 py-2 text-center font-medium`}>
      <button
        type="button"
        onClick={() => onToggle(col.key)}
        title={`${col.label}で並び替え`}
        aria-label={`${col.label}で並び替え${active ? `（現在${sortDir === "desc" ? "降順" : "昇順"}）` : ""}`}
        className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded px-0.5 py-0.5 text-[11px] transition hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
          active ? "text-accent" : "text-muted"
        }`}
      >
        {col.label}
        <span aria-hidden="true" className="text-[9px]">
          {active ? (sortDir === "desc" ? "▼" : "▲") : "⇅"}
        </span>
      </button>
    </th>
  );
}
