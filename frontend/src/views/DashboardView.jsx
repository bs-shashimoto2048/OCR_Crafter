import { useEffect, useMemo, useRef, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";
import { imageUrl, interimImageUrl, processedImageUrl, thumbnailUrl } from "../lib/api";
import { templateOriginLabel } from "../config/projectTemplates";
import {
  SORT_COLUMNS,
  benchmarkQuickActionTooltip,
  computeHealthBadge,
  currentStepLabel as rowCurrentStepLabel,
  formatBalanceScore,
  formatBestCer,
  formatExactMatch,
  formatP95,
  formatProductionModel,
  formatRelativeTime,
  hasLatestBenchmark,
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

// プロジェクトカードのクイックアクション。Primary（開く）を最優先操作として強調し、
// Secondary（学習・評価・Benchmark・Report）は控えめな見た目にする（既存画面への遷移のみ・新規APIは使用しない）
const PRIMARY_CARD_ACTION = { id: "open", icon: "▶", label: "開く", viewId: null };
const SECONDARY_CARD_ACTIONS = [
  { id: "train", icon: "🧠", label: "学習", viewId: "ocr-training" },
  { id: "evaluate", icon: "📈", label: "評価", viewId: "ocr-eval" },
  { id: "benchmark", icon: "🧪", label: "Benchmark", viewId: "benchmark" },
  { id: "report", icon: "📄", label: "Report", viewId: "reports" },
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

// カードのサムネイル（約64×48）。優先順位: ①現在ダッシュボードで使用中の代表画像
// （選択中プロジェクトのpreviewItems先頭）②プロジェクトの最初の画像（サーバー生成サムネイル）
// ③EmptyStateアイコン（共通コンポーネントと同じ⊘表記）。画像がプロジェクトの識別子になるため大きめに表示する
function CardThumb({ pid, selected, currentPreviewImage, sampleImage, imageVersion }) {
  const [failed, setFailed] = useState(false);
  const representativeImage = selected ? currentPreviewImage : null;
  const src = representativeImage
    ? imageUrl(representativeImage, pid, imageVersion)
    : sampleImage
      ? thumbnailUrl(sampleImage, pid, 0, 64, 48)
      : "";

  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card/60 text-lg text-muted"
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
      className="h-12 w-16 shrink-0 rounded-lg border border-border/70 bg-[#3b444f]/40 object-contain"
    />
  );
}

function formatShortDateTime(value) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// カード右上の「・・・」メニュー（削除の誤操作防止のため独立させる）
function CardMenu({ pid, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${pid} のその他の操作`}
        title="その他の操作"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition hover:bg-card/70 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <span aria-hidden="true">・・・</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-7 z-20 min-w-[112px] overflow-hidden rounded-lg border border-border bg-[#2f3841] py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            aria-label={`${pid} を削除`}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-danger transition hover:bg-danger/15"
          >
            🗑 削除
          </button>
        </div>
      ) : null}
    </div>
  );
}

// 品質・性能グループ内の1指標（emphasizeで品質・性能を データ より視覚的に強調する）
function CardStat({ label, value, emphasize }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-1.5 rounded-lg border px-2 py-1 ${
        emphasize ? "border-emerald-400/30 bg-emerald-500/10" : "border-border bg-card/45"
      }`}
    >
      <span className="text-[12px] text-muted">{label}</span>
      <span className={`text-[15px] font-bold leading-tight ${emphasize ? "text-emerald-200" : "text-text"}`}>{value}</span>
    </div>
  );
}

// プロジェクト管理カード1枚分。カード全体クリック＝「開く」と同じ動作
function ProjectCard({ pid, selected, summary, origin, currentPreviewImage, imageVersion, onOpen, onQuickAction, onDelete }) {
  const stateBadge = projectStateBadge(summary, selected);
  const healthBadge = computeHealthBadge(summary);
  const progress = rowProgressPercent(summary);
  const stepLabel = rowCurrentStepLabel(summary);
  const exactMatch = formatExactMatch(summary);
  const totalImages = Number(summary.images || 0);
  const relativeTime = formatRelativeTime(summary.updated_at);

  function renderSecondaryAction(action) {
    const enabled = quickActionEnabled(action.id, summary);
    const title =
      action.id === "benchmark"
        ? benchmarkQuickActionTooltip(summary)
        : `${action.label}${enabled ? "" : "（対象データがありません）"}`;
    return (
      <button
        key={action.id}
        type="button"
        disabled={!enabled}
        aria-label={`${pid} を${action.label}へ`}
        title={title}
        onClick={() => onQuickAction(pid, action.viewId)}
        className={`flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
          enabled
            ? "border-border/70 bg-card/45 text-muted hover:border-accent/40 hover:text-text"
            : "cursor-not-allowed border-border/40 bg-card/30 text-muted/50"
        }`}
      >
        <span aria-hidden="true">{action.icon}</span>
        <span className="truncate">{action.label}</span>
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`プロジェクト ${pid} を開く（状態: ${stateBadge?.label || "-"}、Health: ${healthBadge.label}）`}
      onClick={() => onOpen(pid, null)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(pid, null);
        }
      }}
      className={`flex min-h-[380px] cursor-pointer flex-col rounded-xl border p-3 transition-transform duration-150 hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:hover:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
        selected ? "border-accent/60 bg-accent/10" : "border-border bg-card/45 hover:border-accent/40"
      }`}
    >
      {/* ヘッダー */}
      <div className="flex items-start gap-2">
        <CardThumb
          pid={pid}
          selected={selected}
          currentPreviewImage={currentPreviewImage}
          sampleImage={summary.sample_image}
          imageVersion={imageVersion}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[22px] font-bold leading-tight text-text" title={pid}>
            {pid}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {stateBadge ? (
              <span
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-semibold ${stateBadge.className}`}
              >
                <span aria-hidden="true">{stateBadge.dot}</span>
                {stateBadge.label}
              </span>
            ) : null}
            <span className="truncate text-[12px] text-muted" title={origin.origin}>
              {origin.origin}
              {origin.version ? ` (v${origin.version})` : ""}
            </span>
          </div>
        </div>
        {/* Productionは右上へ独立表示（誤操作防止のため「・・・」メニューとは別要素） */}
        <div className="flex shrink-0 items-start gap-1.5">
          {summary.production_model ? (
            <div className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-right leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Production</p>
              <p className="text-[15px] font-bold text-emerald-200">{formatProductionModel(summary)}</p>
            </div>
          ) : (
            <p className="mt-1.5 whitespace-nowrap text-[12px] text-muted">Productionなし</p>
          )}
          <CardMenu pid={pid} onDelete={() => onDelete(pid)} />
        </div>
      </div>

      {/* 品質情報: データ／品質／性能を横並びの3列にし、品質・性能をemphasizeで視覚的に強調する */}
      <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-border/60 bg-card/30 p-2">
        <div className="space-y-1">
          <p className="text-[13px] font-medium text-muted">データ</p>
          <CardStat label="画像" value={totalImages} />
          <CardStat label="ラベル" value={Number(summary.labeled || 0)} />
          <CardStat label="モデル" value={Number(summary.models || 0)} />
        </div>
        <div className="space-y-1">
          <p className="text-[13px] font-semibold text-text">品質</p>
          <CardStat label="Best CER" value={formatBestCer(summary)} emphasize />
          {exactMatch !== null ? <CardStat label="Exact Match" value={exactMatch} emphasize /> : null}
        </div>
        <div className="space-y-1">
          <p className="text-[13px] font-semibold text-text">性能</p>
          {hasLatestBenchmark(summary) ? (
            <>
              <CardStat label="Balance" value={formatBalanceScore(summary)} emphasize />
              <CardStat label="P95" value={formatP95(summary)} emphasize />
              <CardStat label="実施回数" value={`${Number(summary.benchmark_count || 0)}回`} />
            </>
          ) : (
            <div className="rounded-lg border border-border bg-card/45 px-2 py-1.5">
              <p className="text-[12px] text-muted">Benchmark未実施</p>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onQuickAction(pid, "benchmark");
                }}
                className="mt-0.5 text-[12px] font-semibold text-accent hover:underline"
              >
                Benchmarkを実行 →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 進捗: 現在の工程名をバー上部へ・バーを太く・%を大きく右側表示 */}
      <div className="mt-2">
        <p className="text-[14px] font-semibold text-text">{stepLabel || "—"}</p>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-border/40">
            <div className="h-full rounded-sm bg-accent/80" style={{ width: `${progress}%` }} />
          </div>
          <span className="shrink-0 text-base font-bold text-accent">{progress}%</span>
        </div>
      </div>

      {/* クイックアクション: Primary（開く）を強調し、Secondaryは控えめに（誤操作防止のため削除は「・・・」メニューへ分離済み） */}
      <div className="mt-2 flex flex-1 flex-col justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          disabled={selected}
          aria-label={`${pid} を${PRIMARY_CARD_ACTION.label}へ`}
          title={selected ? "現在使用中のプロジェクトです" : PRIMARY_CARD_ACTION.label}
          onClick={() => onQuickAction(pid, PRIMARY_CARD_ACTION.viewId)}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[15px] font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
            selected ? "cursor-not-allowed bg-accent/40" : "bg-accent shadow-[0_4px_14px_rgba(88,166,255,0.32)] hover:bg-[#79b8ff]"
          }`}
        >
          <span aria-hidden="true">{PRIMARY_CARD_ACTION.icon}</span>
          {PRIMARY_CARD_ACTION.label}
        </button>
        <div className="grid grid-cols-2 gap-1.5">{SECONDARY_CARD_ACTIONS.map(renderSecondaryAction)}</div>
      </div>

      {/* フッター */}
      <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-[12px] text-muted">
        <div className="leading-tight">
          <p>{relativeTime || "—"}</p>
          <p>{formatShortDateTime(summary.updated_at)}</p>
        </div>
        <span
          title={[healthBadge.label, ...(healthBadge.reasons || [])].join("\n")}
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-semibold ${healthBadge.className}`}
        >
          <span aria-hidden="true">{healthBadge.dot}</span>
          {healthBadge.label}
        </span>
      </div>
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

  // 検索: プロジェクト名（既存互換）＋テンプレート名＋Productionモデル＋状態＋Health
  const filteredProjects = useMemo(() => {
    const keyword = search.trim();
    if (!keyword) return projects;
    return projects.filter((pid) => {
      const summary = projectSummaries?.[pid] || {};
      const origin = templateOriginLabel(templateRecords?.[pid]).origin;
      const stateLabel = projectStateBadge(summary, pid === projectId)?.label || "";
      const healthLabel = computeHealthBadge(summary).label;
      return matchesSearch(pid, summary, origin, stateLabel, keyword, healthLabel);
    });
  }, [projects, search, projectSummaries, templateRecords, projectId]);

  // ソート: 既存の並び（sortKey未指定）を維持しつつ、並び替えUIで並び替える
  const sortedProjects = useMemo(
    () => sortProjectIds(filteredProjects, projectSummaries, sortKey, sortDir),
    [filteredProjects, projectSummaries, sortKey, sortDir]
  );

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

      {/* 下段: プロジェクト一覧（カードビュー。この領域のみ内部スクロール） */}
      <Card title="プロジェクト一覧" subtitle={`${projects.length}件`} className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="app-input h-8 w-64 text-xs"
            placeholder="検索（プロジェクト名・テンプレート・Production・状態・Health）"
          />
          <select
            value={sortKey || ""}
            onChange={(event) => setSortKey(event.target.value || null)}
            aria-label="並び替え項目"
            title="並び替え項目"
            className="app-select h-8 text-xs"
          >
            <option value="">既定の並び</option>
            {SORT_COLUMNS.map((col) => (
              <option key={col.key} value={col.key}>
                {col.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!sortKey}
            onClick={() => setSortDir((dir) => (dir === "desc" ? "asc" : "desc"))}
            aria-label={`並び替え方向を切り替え（現在${sortDir === "desc" ? "降順" : "昇順"}）`}
            title="並び替え方向を切り替え"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card/45 text-xs text-muted transition hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            <span aria-hidden="true">{sortDir === "desc" ? "▼" : "▲"}</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={onOpenCreate} title="テンプレートを選んで新規プロジェクトを作成します">
              新規プロジェクト
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/60 bg-card/40 p-3">
          {filteredProjects.length === 0 ? (
            projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
                <span
                  aria-hidden="true"
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border/70 bg-card/60 text-2xl text-muted"
                >
                  ⊘
                </span>
                <div>
                  <p className="text-base font-semibold text-text">プロジェクトがありません</p>
                  <p className="mt-1 max-w-md text-sm text-muted">
                    最初のプロジェクトを作成しましょう。用途別テンプレート（英数字OCR・日本語OCR・銘板OCRなど）から初期設定を選べます。
                  </p>
                </div>
                <Button size="lg" className="mt-1 px-8" onClick={onOpenCreate}>
                  新規プロジェクトを作成
                </Button>
              </div>
            ) : (
              <p className="px-3 py-8 text-center text-sm text-muted">検索条件に一致するプロジェクトがありません。</p>
            )
          ) : (
            <div className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2 min-[1920px]:grid-cols-3">
              {sortedProjects.map((pid) => {
                const selected = pid === projectId;
                const summary = projectSummaries?.[pid] || {};
                const origin = templateOriginLabel(templateRecords?.[pid]);
                return (
                  <ProjectCard
                    key={pid}
                    pid={pid}
                    selected={selected}
                    summary={summary}
                    origin={origin}
                    currentPreviewImage={previewItems[0]?.image}
                    imageVersion={imageVersion}
                    onOpen={openProjectInView}
                    onQuickAction={openProjectInView}
                    onDelete={onDeleteProject}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
