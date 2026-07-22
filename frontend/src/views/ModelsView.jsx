import { useEffect, useMemo, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";
import InfoTooltip from "../components/InfoTooltip";
import ModelIdBadge from "../components/ModelIdBadge";
import { API_BASE } from "../lib/api";
import { HELP_TEXTS } from "../lib/helpTexts";
import { historyPreprocessLabel } from "../lib/evalHistory";
import {
  MODEL_BADGE_LABELS,
  correctTotalLabel,
  formatSignedValue,
  latestEvalOf,
  matchesModelSearch,
  modelBadges,
  modelEvalEntries,
  whitelistLabelOf,
} from "../lib/modelEval";
import { confusionTitle } from "../lib/confusionFormat";
import {
  DIFF_CLASSIFICATION_LABELS,
  TRAINING_CONDITION_ROWS,
  buildComparabilityNotes,
  buildConditionDiffSummaries,
  buildNextTrainingProposals,
  normalizeTrainingCondition,
} from "../lib/trainingCompare";
import {
  PREPROCESS_COMPARISON_ROWS,
  buildPreprocessNotes,
  diffTrainingPreprocess,
  normalizeTrainingPreprocess,
  preprocessDetailRows,
  preprocessMatchLabels,
  preprocessRowValue,
  trainingPreprocessSummary,
} from "../lib/preprocessCompare";
import {
  COMPARE_METRICS,
  buildCompareColorMap,
  buildConditionComparison,
  buildConfusionComparison,
  buildModelComparison,
  buildWinLoss,
  confusionLabel,
  formatBestDiff,
  formatMetricValue,
  getComparisonModelLabel,
  metricValue,
  recommendModel,
} from "../lib/modelCompare";

// 0〜1の比率を%表示（null=未記録）
function ratioPct(value, digits = 1) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "未記録";
}

function basename(path) {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1];
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ja-JP", { hour12: false });
}

function parseApiErrorText(text, fallback = "ダウンロードに失敗しました") {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  try {
    const payload = JSON.parse(raw);
    const detail = payload?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) return detail.map((v) => String(v)).join(", ");
  } catch {
    // ignore non-json
  }
  return raw;
}

function parseDownloadFilename(contentDisposition, fallback) {
  const value = String(contentDisposition || "");
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded && encoded[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return fallback;
    }
  }
  const plain = value.match(/filename=\"?([^\";]+)\"?/i);
  if (plain && plain[1]) {
    return plain[1];
  }
  return fallback;
}

// モデル一覧の共有列定義（ヘッダーと各データ行の両方へ適用。個別に異なる幅を設定しない）。
// 選択32px（大きめチェックボックス用）/ モデル名=minmax(320px,420px)の上限付き / Engine80 /
// 方式85 / 作成日140 / 評価140 / 状態70
// （モデル名の視認性向上（15px表示）のため他列を詰めて名前列へ幅を配分。最小合計847px=
// 1920px時の左ペインへ内部横スクロールなしで収まる。モデル名は上限420pxで余った幅
// いっぱいまで伸ばさず、Engine列との間に大きな空白を作らない）
export const MODEL_LIST_GRID_COLUMNS = "32px minmax(300px, 420px) 80px 85px 140px 140px 70px";

const ENGINE_LABELS = { tesseract: "Tesseract", easyocr: "EasyOCR", custom: "カスタム" };

function engineLabelOf(engine, family) {
  if (family === "ocr" && engine !== "tesseract") return "PaddleOCR";
  return ENGINE_LABELS[String(engine || "").toLowerCase()] || (engine || "-");
}

function familyLabelOf(family) {
  return ["ocr", "tesseract"].includes(family) ? "OCR認識" : "分類";
}

// 評価%の色分け: 40%以上=緑 / 20〜39%=黄 / 20%未満=赤
function evalColorClass(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return "text-muted";
  if (value >= 40) return "text-emerald-300";
  if (value >= 20) return "text-amber-300";
  return "text-red-400";
}

function evalBarClass(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return "bg-muted/40";
  if (value >= 40) return "bg-emerald-400/80";
  if (value >= 20) return "bg-amber-400/80";
  return "bg-red-400/80";
}

// 評価履歴の上位3件（サマリーカード・比較用の簡易表示。詳細はモデルカルテで表示）
function evalEntriesOf(evalHistory, name) {
  return modelEvalEntries(evalHistory, name)
    .slice(0, 3)
    .map((row) => ({ label: row.dataset, percent: row.percent }));
}

// 推奨バッジ（🟢推奨 / 🏆Best Accuracy / 🔴ベースライン。評価履歴から自動判定・高さ固定）
function ModelBadgeChips({ names }) {
  if (!names || names.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {names.map((key) => {
        const def = MODEL_BADGE_LABELS[key];
        if (!def) return null;
        return (
          <span
            key={key}
            title={def.title}
            className="inline-flex h-5 items-center gap-0.5 whitespace-nowrap rounded-full border border-border/70 bg-card/60 px-1.5 text-[10px] text-text"
          >
            <span aria-hidden="true">{def.icon}</span>
            {def.label}
          </span>
        );
      })}
    </span>
  );
}

// 一覧の評価セル: CER主指標＋完全一致率・正解/総数・評価日時（一覧だけで性能比較できる情報量にする）
function ListEvalCell({ latest }) {
  if (!latest) return <span className="text-muted">--</span>;
  const ct = correctTotalLabel(latest);
  return (
    <div className="text-[11px] leading-4 tabular-nums">
      <p>
        {latest.cer !== null ? (
          <span className="font-semibold text-text">CER {(latest.cer * 100).toFixed(1)}%</span>
        ) : (
          <span className={`font-semibold ${evalColorClass(latest.percent)}`}>{latest.percent}%</span>
        )}
        {ct !== "未記録" ? <span className="ml-1 text-muted">（{ct}）</span> : null}
      </p>
      <p className="text-muted">
        一致 {Number.isFinite(latest.percent) ? `${latest.percent}%` : "-"} /{" "}
        {latest.at ? latest.at.slice(0, 16).replace("T", " ") : "-"}
      </p>
    </div>
  );
}

function EvalBadges({ entries }) {
  if (!entries.length) return <span className="text-muted">--</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <span key={entry.label} className="truncate text-[11px]" title={`${entry.label}: ${entry.percent}%`}>
          <span className="text-muted">{entry.label} </span>
          <span className={`font-semibold ${evalColorClass(entry.percent)}`}>{entry.percent}%</span>
        </span>
      ))}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-2 text-[11px]">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="break-all text-right font-medium text-text" title={String(value ?? "-")}>
        {value ?? "-"}
      </span>
    </div>
  );
}

// モデルカルテ用: セクション見出し（16px。?ヘルプ付き）
function SectionTitle({ children, help }) {
  return (
    <p className="mb-2 flex items-center text-base font-semibold text-text">
      {children}
      {help ? <InfoTooltip {...help} align="left" /> : null}
    </p>
  );
}

// モデルカルテ用: ラベル（13px・muted）と値（15px・太字）にメリハリを付けた行
function SpecRow({ label, value, help, valueClass = "text-text" }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className="flex shrink-0 items-center text-[13px] text-muted">
        {label}
        {help ? <InfoTooltip {...help} align="left" /> : null}
      </span>
      <span className={`break-all text-right text-[15px] font-semibold tabular-nums ${valueClass}`} title={String(value ?? "-")}>
        {value ?? "-"}
      </span>
    </div>
  );
}

// モデルカルテ用: 評価サマリーカード（数字を主役に大きく表示。未記録はmuted）
function SummaryStatCard({ label, count, colorClass, help }) {
  const missing = count === null || count === undefined;
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-2 py-2 text-center">
      <p className="flex items-center justify-center text-[12px] leading-4 text-muted">
        {label}
        {help ? <InfoTooltip {...help} /> : null}
      </p>
      <p className={`mt-1 text-xl font-bold leading-6 tabular-nums ${missing ? "text-[13px] font-medium text-muted" : colorClass}`}>
        {missing ? "未記録" : `${count}件`}
      </p>
    </div>
  );
}

function StatusBadge({ status }) {
  const cls =
    status === "使用中" || status === "Candidate"
      ? "border-accent/50 bg-accent/15 text-blue-200"
      : status === "最新" || status === "Production"
        ? "border-success/30 bg-success/10 text-success"
        : status === "Export済" || status === "Validated"
          ? "border-border bg-card/60 text-text"
          : "border-border/60 bg-card/40 text-muted";
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{status}</span>;
}

export default function ModelsView({
  projectId = "default",
  models,
  modelInfos,
  latest,
  onRefresh,
  onDeleteSelected,
  aliases = {},
  onAliasChange,
  evalHistory = {},
  inferenceInUseModel = "",
  inferenceInUseEngine = "",
  onUseForInference,
  onOpenEvaluation,
  onCreateTrainingPlan,
  // 実験管理との連携: モデル名→実験IDの対応と「このモデルを作成したExperiment」リンク
  experimentsByModel = {},
  onOpenExperiment,
  // 実験管理からの「生成モデルを開く」リクエスト（{name, seq}。seq変化でカルテを開く）
  detailRequest = null,
  // リリース管理: モデル別のStatus/Version（{model: {status, version}}。未設定=Draft相当で非表示）
  releaseStatuses = {},
}) {
  const latestAny = basename(latest.any || "");
  const latestByType = latest.byType || {};
  const latestNames = new Set(Object.values(latestByType).map((path) => basename(path)).filter(Boolean));
  if (latestAny) {
    latestNames.add(latestAny);
  }

  const [selectedModels, setSelectedModels] = useState([]);
  const [detailModel, setDetailModel] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  // 混同比較の全件展開（初期=TOP8のみ）
  const [confusionExpanded, setConfusionExpanded] = useState(false);
  const [downloadingModelName, setDownloadingModelName] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterEngine, setFilterEngine] = useState("all");
  const [filterFamily, setFilterFamily] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [aliasDraft, setAliasDraft] = useState("");

  useEffect(() => {
    setSelectedModels((prev) => prev.filter((name) => models.includes(name)));
    setDetailModel((prev) => (prev && models.includes(prev) ? prev : ""));
  }, [models]);

  useEffect(() => {
    setAliasDraft(detailModel ? aliases[detailModel] || "" : "");
  }, [detailModel, aliases]);

  function infoOf(name) {
    return modelInfos?.[name] || {};
  }

  function trainingFamily(name) {
    return infoOf(name).training_family || "classification";
  }

  function engineName(name) {
    return infoOf(name).engine || "custom";
  }

  function createdAt(name) {
    return infoOf(name).created_at || infoOf(name).modified_at || "";
  }

  function exportReady(name) {
    return Boolean(infoOf(name).ocr_inference_ready);
  }

  function isOcrFamily(name) {
    return ["ocr", "tesseract"].includes(trainingFamily(name));
  }

  function displayName(name) {
    return aliases[name] || name;
  }

  // 管理No（M0001形式・作成順・OCR Crafter内で一意）。旧レスポンス等で未付与なら空
  function modelIdOf(name) {
    return infoOf(name).model_id || "";
  }

  // 管理No表示チップ（共通 ModelIdBadge のラッパー。ホバーで「管理No：M0004 / モデル名」）
  function ModelIdChip({ name, size = "sm", className = "" }) {
    const id = modelIdOf(name);
    if (!id) return null;
    return <ModelIdBadge modelId={id} size={size} title={`管理No：${id}\nモデル名：${name}`} className={className} />;
  }

  function statusOf(name) {
    // リリースステータス（Production/Candidate等）を最優先表示（Draftは従来表示のまま）
    const release = releaseStatuses?.[name]?.status;
    if (release && release !== "Draft") return release;
    if (name && name === inferenceInUseModel) return "使用中";
    if (latestNames.has(name)) return "最新";
    if (exportReady(name)) return "Export済";
    return "過去モデル";
  }

  // 推奨バッジ（評価履歴から自動判定）
  const badgeMap = useMemo(() => modelBadges(evalHistory, models), [evalHistory, models]);

  const filteredModels = useMemo(() => {
    return models.filter((name) => {
      // モデル名・別名に加えて管理No（M0004等）でも検索可能
      if (!matchesModelSearch(filterSearch, { name, alias: aliases[name], modelId: modelIdOf(name) })) {
        return false;
      }
      if (filterEngine !== "all" && engineLabelOf(engineName(name), trainingFamily(name)) !== filterEngine) {
        return false;
      }
      if (filterFamily !== "all" && familyLabelOf(trainingFamily(name)) !== filterFamily) {
        return false;
      }
      if (filterStatus !== "all" && statusOf(name) !== filterStatus) {
        return false;
      }
      return true;
    });
  }, [models, aliases, filterSearch, filterEngine, filterFamily, filterStatus, modelInfos, inferenceInUseModel]);

  const engineOptions = useMemo(() => {
    const set = new Set(models.map((name) => engineLabelOf(engineName(name), trainingFamily(name))));
    return [...set].sort();
  }, [models, modelInfos]);

  function toggleOne(name, checked) {
    setSelectedModels((prev) => {
      if (checked) {
        return prev.includes(name) ? prev : [...prev, name];
      }
      return prev.filter((item) => item !== name);
    });
  }

  async function deleteModels(names) {
    if (names.length === 0) return;
    const previewList = names.slice(0, 3).join(", ");
    const hasMore = names.length > 3 ? ` ほか${names.length - 3}件` : "";
    const ok = window.confirm(
      `選択した ${names.length} 件のモデルを削除します。\n対象: ${previewList}${hasMore}\nこの操作は取り消せません。続行しますか？`
    );
    if (!ok) return;
    const typed = window.prompt("確認のため DELETE と入力してください。", "");
    if (typed !== "DELETE") return;
    await onDeleteSelected(names);
    setSelectedModels([]);
    setDetailModel((prev) => (names.includes(prev) ? "" : prev));
  }

  async function handleDownload(name) {
    setDownloadingModelName(name);
    try {
      const response = await fetch(
        `${API_BASE}/api/models/download/${encodeURIComponent(name)}?project_id=${encodeURIComponent(projectId || "default")}`
      );
      if (!response.ok) {
        throw new Error(parseApiErrorText(await response.text()));
      }
      const blob = await response.blob();
      const fallbackName = name.endsWith(".pt")
        ? name
        : name.endsWith(".tess.json")
          ? `${name.replace(/\.tess\.json$/i, "")}.traineddata`
          : `${name.replace(/\.ocr\.json$/i, "")}.inference.zip`;
      const filename = parseDownloadFilename(response.headers.get("content-disposition"), fallbackName);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      window.alert(parseApiErrorText(error?.message || ""));
    } finally {
      setDownloadingModelName("");
    }
  }

  function openDetail(name) {
    setCompareMode(false);
    setDetailModel(name);
  }

  // 実験管理からの遷移リクエスト（seq変化のたびに対象モデルのカルテを開く）
  useEffect(() => {
    if (detailRequest?.name) {
      openDetail(detailRequest.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRequest?.seq]);

  function canDownload(name) {
    return !isOcrFamily(name) || exportReady(name);
  }

  // サマリーカード（推論使用モデル / 最新モデル）共通描画
  function SummaryCard({ title, name, emptyText, highlight }) {
    const entries = name ? evalEntriesOf(evalHistory, name) : [];
    return (
      <div
        className={`min-w-0 flex-1 rounded-xl border px-3 py-2 backdrop-blur-md ${
          highlight ? "border-accent/50 bg-accent/10" : "border-border bg-card/60"
        }`}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</p>
        {name ? (
          <>
            <p className="mt-0.5 truncate text-base font-semibold text-text" title={name}>
              {displayName(name)}
            </p>
            {aliases[name] ? (
              <p className="truncate text-[10px] text-muted" title={name}>
                {name}
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
              <span>Engine: {engineLabelOf(engineName(name), trainingFamily(name))}</span>
              <span>作成: {formatDateTime(createdAt(name))}</span>
              <StatusBadge status={statusOf(name)} />
            </div>
            {entries.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
                {entries.map((entry) => (
                  <span key={entry.label}>
                    <span className="text-muted">{entry.label} </span>
                    <span className={`font-semibold ${evalColorClass(entry.percent)}`}>{entry.percent}%</span>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="h-6 px-2 text-[11px]"
                disabled={name === inferenceInUseModel}
                onClick={() => onUseForInference?.(name)}
                title={name === inferenceInUseModel ? "すでに推論で使用中です" : "このモデルをOCR推論で使用します"}
              >
                推論に使用
              </Button>
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => onOpenEvaluation?.(name)}>
                モデル評価
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-6 px-2 text-[11px]"
                disabled={!canDownload(name) || downloadingModelName === name}
                onClick={() => handleDownload(name)}
              >
                {downloadingModelName === name ? "取得中..." : "ダウンロード"}
              </Button>
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => openDetail(name)}>
                詳細
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted">{emptyText}</p>
        )}
      </div>
    );
  }

  const compareTargets = selectedModels.slice(0, 3);

  function iterationText(name) {
    const params = infoOf(name).ocr_training_params || {};
    const iter = Number(params.max_iterations || 0);
    if (iter > 0) return iter;
    const epochs = Number(params.epochs || 0);
    return epochs > 0 ? `${epochs} epochs` : "-";
  }

  function datasetCounts(name) {
    const counts = infoOf(name).dataset_split_counts || infoOf(name).ocr_dataset_counts || {};
    return {
      train: Number(counts.train || 0) || "-",
      val: Number(counts.val || 0) || "-",
      test: Number(counts.test || 0) || "-",
    };
  }

  function augText(name) {
    const aug = infoOf(name).ocr_augmentation || {};
    if (aug?.enabled === null || aug?.enabled === undefined) return "-";
    return aug.enabled ? `ON（強度 ${Number(aug.strength || 0) || "-"}）` : "OFF";
  }

  // 学習画像数（Train+Val+Testの合計。カウント不明は"-"）
  function trainingImageTotal(name) {
    const counts = infoOf(name).dataset_split_counts || infoOf(name).ocr_dataset_counts || {};
    const total = Number(counts.train || 0) + Number(counts.val || 0) + Number(counts.test || 0);
    return total > 0 ? total : "-";
  }

  function modelSizeText(name) {
    const size = Number(infoOf(name).model_size_mb);
    return Number.isFinite(size) && size > 0 ? `${size} MB` : "-";
  }

  // 右ペイン: モデル詳細（モデルカルテ: モデル情報→最新評価→評価条件→評価履歴。
  // 上部は内容高（不足時のみ内部スクロール）、評価履歴が残り高を使い内部スクロールする）
  function renderDetail(name) {
    const info = infoOf(name);
    const counts = datasetCounts(name);
    const latest = latestEvalOf(evalHistory, name);
    const historyEntries = modelEvalEntries(evalHistory, name);
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="dark-scroll min-h-0 flex-[0_1_auto] space-y-3 overflow-y-auto pr-0.5 [overscroll-behavior:contain]">
          {/* カルテヘッダー（このモデル自身の状態のみ。Best/Recommended等の比較バッジは比較画面へ集約） */}
          <div>
            <p className="flex min-w-0 items-center gap-2 text-lg font-semibold leading-6 text-text" title={name}>
              <ModelIdChip name={name} size="md" />
              <span className="min-w-0 truncate">{displayName(name)}</span>
            </p>
            {aliases[name] ? (
              <p className="truncate text-[11px] text-muted" title={name}>
                {name}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <StatusBadge status={statusOf(name)} />
            </div>
          </div>

          {/* ① 最新評価（画面の主役。CERを最大サイズで表示し「このモデルは良いのか」に即答する） */}
          <div className="rounded-lg border border-border bg-card/45 px-3 py-3">
            <div className="flex items-baseline justify-between">
              <SectionTitle help={HELP_TEXTS.cer}>最新評価</SectionTitle>
              <span className="text-[11px] text-muted">{latest?.at ? latest.at.slice(0, 16).replace("T", " ") : ""}</span>
            </div>
            {latest ? (
              <>
                <div className="text-center">
                  <p className="flex items-center justify-center text-[13px] text-muted">
                    {latest.cer !== null ? "CER" : "完全一致率（CER未記録）"}
                    <InfoTooltip {...(latest.cer !== null ? HELP_TEXTS.cer : HELP_TEXTS.exactMatch)} />
                  </p>
                  {latest.cer !== null ? (
                    <p className="text-[32px] font-bold leading-tight tabular-nums text-emerald-300">
                      {(latest.cer * 100).toFixed(1)}%
                    </p>
                  ) : (
                    <p className={`text-[32px] font-bold leading-tight tabular-nums ${evalColorClass(latest.percent)}`}>
                      {latest.percent}%
                    </p>
                  )}
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-border/40">
                  <div
                    className={`h-full rounded-sm ${evalBarClass(latest.charAccuracy !== null ? latest.charAccuracy * 100 : latest.percent)}`}
                    style={{
                      width: `${Math.max(0, Math.min(100, latest.charAccuracy !== null ? latest.charAccuracy * 100 : latest.percent))}%`,
                    }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="text-center">
                    <p className="flex items-center justify-center text-[13px] text-muted">
                      文字正解率
                      <InfoTooltip {...HELP_TEXTS.charAccuracy} />
                    </p>
                    <p className="mt-0.5 text-lg font-bold leading-6 tabular-nums text-text">{ratioPct(latest.charAccuracy)}</p>
                  </div>
                  <div className="text-center">
                    <p className="flex items-center justify-center text-[13px] text-muted">
                      完全一致率
                      <InfoTooltip {...HELP_TEXTS.exactMatch} />
                    </p>
                    <p className="mt-0.5 text-lg font-bold leading-6 tabular-nums text-blue-300">
                      {correctTotalLabel(latest)}
                      {Number.isFinite(Number(latest.percent)) ? `（${latest.percent}%）` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-0.5 border-t border-border/50 pt-2">
                  <SpecRow
                    label="誤認識"
                    value={latest.mismatch === null ? "未記録" : `${latest.mismatch}件`}
                    valueClass={latest.mismatch === null ? "text-muted" : "text-danger"}
                  />
                  <SpecRow
                    label="CER改善（学習前比）"
                    help={HELP_TEXTS.cerImprovement}
                    value={
                      latest.cerDelta === null
                        ? "未記録"
                        : `${latest.cerDelta > 0 ? "+" : ""}${(latest.cerDelta * 100).toFixed(1)}pt / 相対 ${ratioPct(latest.cerRelativeImprovement)}`
                    }
                    valueClass={
                      latest.cerDelta === null
                        ? "text-muted"
                        : latest.cerDelta < 0
                          ? "text-success"
                          : latest.cerDelta > 0
                            ? "text-danger"
                            : "text-text"
                    }
                  />
                </div>
              </>
            ) : (
              <p className="text-[13px] text-muted">評価未実施（モデル評価画面で実行すると表示されます）</p>
            )}
          </div>

          {/* ② 評価サマリー（学習前比の内訳をカード化。数字を主役に大きく表示） */}
          {latest ? (
            <div className="rounded-lg border border-border bg-card/45 px-3 py-3">
              <SectionTitle help={HELP_TEXTS.improvedRegressed}>評価サマリー（学習前比）</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                <SummaryStatCard label="改善" count={latest.improved} colorClass="text-success" />
                <SummaryStatCard label="同等" count={latest.unchanged} colorClass="text-text" />
                <SummaryStatCard label="悪化" count={latest.regressed} colorClass="text-danger" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <SummaryStatCard
                  label="完全一致へ改善"
                  count={latest.perfectFixed}
                  colorClass="text-success"
                  help={HELP_TEXTS.perfectTransition}
                />
                <SummaryStatCard label="完全一致から悪化" count={latest.perfectRegressed} colorClass="text-danger" />
              </div>
            </div>
          ) : null}

          {/* ③ 混同TOP5（最新評価のLevenshteinアラインメント由来。縦2行チップの横並び） */}
          {latest && (latest.confusions || []).length > 0 ? (
            <div className="rounded-lg border border-border bg-card/45 px-3 py-3">
              <SectionTitle help={HELP_TEXTS.confusionTop}>混同TOP5</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {(latest.confusions || []).slice(0, 5).map((c) => (
                  <span
                    key={`${c.kind}-${c.from}-${c.to}`}
                    className="inline-flex min-w-[3.5rem] flex-col items-center rounded-md border border-border/70 bg-card/60 px-2 py-1 tabular-nums"
                    title={confusionTitle(c)}
                  >
                    <span className="confusion-glyphs text-[14px] font-semibold text-text">{confusionLabel(c)}</span>
                    <span className="text-[11px] text-muted">{c.count}件</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* ④ 評価条件（最新評価で実際に使用した条件） */}
          {latest ? (
            <div className="rounded-lg border border-border bg-card/45 px-3 py-3">
              <SectionTitle>評価条件</SectionTitle>
              <SpecRow label="評価データセット" value={latest.dataset || "未記録"} />
              <SpecRow label="評価画像数" value={latest.total === null ? "未記録" : latest.total} />
              <SpecRow label="OCR前処理" value={historyPreprocessLabel(latest)} help={HELP_TEXTS.ocrPreprocess} />
              <SpecRow label="Whitelist" value={whitelistLabelOf(latest.whitelist)} help={HELP_TEXTS.whitelist} />
              <SpecRow label="評価日時" value={latest.at ? latest.at.slice(0, 16).replace("T", " ") : "未記録"} />
            </div>
          ) : null}

          {/* ⑤ モデル情報（このモデル自身の学習条件・実体情報） */}
          <div className="rounded-lg border border-border bg-card/45 px-3 py-3">
            <SectionTitle>モデル情報</SectionTitle>
            {/* 管理Noは共通の等幅フォント（ModelIdBadgeと同一スタック）で表示 */}
            <SpecRow label="管理No" value={modelIdOf(name) || "-"} valueClass="model-id-font model-id-text--md text-text" />
            {/* リリースステータス（Draft/Validated/Candidate/Production/Archived）とVersion */}
            <SpecRow
              label="リリースStatus"
              value={`${releaseStatuses?.[name]?.status || "Draft"}${releaseStatuses?.[name]?.version ? `（v${releaseStatuses[name].version}）` : ""}`}
            />
            {/* このモデルを作成したExperiment（実験管理へ遷移） */}
            <div className="flex items-start justify-between gap-3 py-0.5">
              <span className="flex shrink-0 items-center text-[13px] text-muted">Experiment</span>
              {experimentsByModel[name] ? (
                <button
                  type="button"
                  className="model-id-font model-id-text--md text-blue-200 underline-offset-2 hover:underline"
                  onClick={() => onOpenExperiment?.(experimentsByModel[name])}
                  title="このモデルを作成したExperimentを実験管理で開きます"
                >
                  {experimentsByModel[name]}
                </button>
              ) : (
                <span className="text-[15px] font-semibold text-muted">未記録</span>
              )}
            </div>
            <SpecRow label="Engine" value={engineLabelOf(engineName(name), trainingFamily(name))} />
            <SpecRow label="方式" value={familyLabelOf(trainingFamily(name))} />
            <SpecRow label="ベースモデル" value={info.base_lang || "-"} help={HELP_TEXTS.baseModel} />
            <SpecRow label="Charset" value={info.charset || "-"} />
            <SpecRow label="Iteration" value={iterationText(name)} help={HELP_TEXTS.iteration} />
            <SpecRow label="学習画像数" value={trainingImageTotal(name)} />
            <SpecRow label="Train / Val / Test" value={`${counts.train} / ${counts.val} / ${counts.test}`} />
            <SpecRow label="Augmentation" value={augText(name)} />
            {/* 学習時前処理（前処理スナップショット由来の要約。旧モデル=未記録） */}
            <SpecRow
              label="学習前処理"
              value={trainingPreprocessSummary(normalizeTrainingPreprocess(info)) || "未記録"}
              help={HELP_TEXTS.trainingPreprocess}
            />
            <SpecRow label="モデルサイズ" value={modelSizeText(name)} />
            <SpecRow label="学習時間" value={info.training_duration || "-"} />
            <SpecRow label="学習日時" value={formatDateTime(createdAt(name))} />
            <SpecRow label="Export状態" value={exportReady(name) ? "Export済" : "未Export"} />
          </div>

          <div className="space-y-1 rounded-lg border border-border bg-card/45 px-3 py-2.5">
            <DetailRow label="traineddata" value={info.traineddata_path || "-"} />
            <DetailRow label="json" value={name.endsWith(".json") ? name : info.meta_path || "-"} />
            <DetailRow label="Export先" value={info.export_dir || info.inference_dir || (exportReady(name) ? "export済" : "-")} />
          </div>

          <div className="rounded-lg border border-border bg-card/45 px-3 py-2.5">
            <p className="mb-1 text-[13px] font-semibold text-text">表示名（Alias）</p>
            <div className="flex gap-1.5">
              <input
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                placeholder="例: v3（実画像強化）"
                className="app-input h-7 flex-1 text-xs"
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-[11px]"
                onClick={() => onAliasChange?.(name, aliasDraft)}
              >
                保存
              </Button>
            </div>
          </div>
        </div>

        {/* ⑥ 評価履歴: 残り高を使って内部スクロール（ヘッダーはsticky固定） */}
        <div className="mt-3 flex min-h-[120px] flex-1 flex-col rounded-lg border border-border bg-card/45 px-3 py-2.5">
          <p className="mb-1.5 shrink-0 text-base font-semibold text-text">評価履歴（{historyEntries.length}件）</p>
          {historyEntries.length > 0 ? (
            <div className="dark-scroll min-h-0 flex-1 overflow-auto [overscroll-behavior:contain] [scrollbar-gutter:stable]">
              <table className="w-full text-[12px] tabular-nums">
                <thead className="sticky top-0 z-10 bg-[#333c46] text-left text-muted">
                  <tr>
                    <th className="px-1.5 py-1.5 font-medium">日時</th>
                    <th className="px-1.5 py-1.5 font-medium">CER</th>
                    <th className="px-1.5 py-1.5 font-medium">文字</th>
                    <th className="px-1.5 py-1.5 font-medium">一致</th>
                    <th className="px-1.5 py-1.5 font-medium">正解</th>
                    <th className="px-1.5 py-1.5 font-medium">改善</th>
                    <th className="px-1.5 py-1.5 font-medium">悪化</th>
                    <th className="px-1.5 py-1.5 font-medium">前処理</th>
                  </tr>
                </thead>
                <tbody>
                  {historyEntries.map((row) => (
                    <tr key={`${row.datasetKey}-${row.at}`} className="border-t border-border/50">
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-muted" title={`${row.dataset} / ${row.at}`}>
                        {row.at ? row.at.slice(5, 16).replace("T", " ") : "-"}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 font-semibold text-emerald-300">
                        {row.cer !== null ? ratioPct(row.cer) : "未記録"}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-text">
                        {row.charAccuracy !== null ? ratioPct(row.charAccuracy) : "-"}
                      </td>
                      <td className={`px-1.5 py-1.5 font-semibold ${evalColorClass(row.percent)}`}>{row.percent}%</td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-text">{correctTotalLabel(row)}</td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-success">
                        {row.improved === null ? "-" : `${row.improved}件`}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-danger">
                        {row.regressed === null ? "-" : `${row.regressed}件`}
                      </td>
                      <td className="min-w-0 max-w-[5rem] truncate px-1.5 py-1.5 text-muted" title={historyPreprocessLabel(row)}>
                        {historyPreprocessLabel(row)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[13px] text-muted">評価未実施</p>
          )}
        </div>

        <div className="mt-2 shrink-0 space-y-1.5 border-t border-border/60 pt-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={name === inferenceInUseModel}
              onClick={() => onUseForInference?.(name)}
            >
              推論に使用
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onOpenEvaluation?.(name)}>
              モデル評価
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!canDownload(name) || downloadingModelName === name}
              onClick={() => handleDownload(name)}
            >
              {downloadingModelName === name ? "取得中..." : "ダウンロード"}
            </Button>
            <Button size="sm" variant="danger" onClick={() => deleteModels([name])}>
              削除
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 右ペイン: 比較ダッシュボード（最大3件・CER中心・管理No主体）。
  // 固定領域=警告/推奨モデル/主要3指標カード、スクロール領域=改善・悪化比較/評価条件/混同比較/指標別結果/総合勝利数/モデル詳細情報
  function renderCompare() {
    if (compareTargets.length === 0) {
      return <p className="text-xs text-muted">一覧でモデルを選択してください。</p>;
    }
    const comparison = buildModelComparison(evalHistory, compareTargets);
    const winLoss = buildWinLoss(comparison);
    const recommended = recommendModel(comparison, winLoss);
    const conditions = buildConditionComparison(comparison);
    const allConfusions = buildConfusionComparison(comparison, Infinity);
    const confusionRows = confusionExpanded ? allConfusions : allConfusions.slice(0, 8);
    const confusionMax = Math.max(1, ...allConfusions.flatMap((row) => row.counts.filter((v) => v !== null)));
    const shortName = (name) => {
      const label = displayName(name);
      return label.length > 14 ? `${label.slice(0, 13)}…` : label;
    };
    // 比較画面は管理No主体・ファイル名は補助表示（未付与の旧レスポンスは従来の短縮名へフォールバック）
    const compareLabel = (name) => modelIdOf(name) || shortName(name);
    const compareTitle = (name) => (modelIdOf(name) ? `${modelIdOf(name)} → ${name}` : name);
    // カード等の補助モデル名は日時形式へ短縮（例: tess_20260715_131053.tess.json → 20260715_131053）。
    // 元のファイル名はtitle（ホバー）で確認できる
    const shortFileLabel = (name) => getComparisonModelLabel(displayName(name));
    // モデル識別色（比較表示順に固定: 1番目=ブルー/2番目=オレンジ/3番目=パープル。
    // 全セクションで同じマップを共有。評価結果の良否色（最良=緑/悪化=赤）とは併用しない別役割）
    const colorMap = buildCompareColorMap(compareTargets);
    const colorOf = (name) => colorMap[name];
    const bestText = "font-semibold text-emerald-300";
    // 学習条件比較・条件差分・次回学習提案（lib/trainingCompare.js の純ロジック）
    const conditionOf = (name) => normalizeTrainingCondition(infoOf(name));
    const latestOfModel = (name) => latestEvalOf(evalHistory, name);
    const diffSummaries = buildConditionDiffSummaries({
      targets: compareTargets,
      labelOf: compareLabel,
      conditionOf,
      latestOf: latestOfModel,
    });
    const comparabilityNotes = buildComparabilityNotes({ targets: compareTargets, labelOf: compareLabel, conditionOf });
    // 学習前処理比較（前処理スナップショット由来。旧モデルは未記録表示・推測しない）
    const preOf = (name) => normalizeTrainingPreprocess(infoOf(name));
    const preList = compareTargets.map(preOf);
    const preMatchLabels = preprocessMatchLabels(preList);
    const preprocessNotes = buildPreprocessNotes({ targets: compareTargets, labelOf: compareLabel, preOf });
    // 前処理差分（隣接ペア。両方記録ありのペアのみ判定できる）
    const preDiffs = compareTargets.slice(1).map((name, index) => ({
      from: compareTargets[index],
      to: name,
      ...diffTrainingPreprocess(preList[index], preList[index + 1]),
    }));
    const proposals = buildNextTrainingProposals({
      targets: compareTargets,
      labelOf: compareLabel,
      conditionOf,
      latestOf: latestOfModel,
      conditionsMatch: conditions.match,
    });
    // 「この条件で学習設定を作成」: 学習画面へ設定を引き継ぐ（学習は開始しない）
    const createTrainingPlan = (proposal) => {
      const ref = proposal.settings?.referenceModel;
      const refCounts = ref ? conditionOf(ref)?.splitCounts : null;
      let ratios = null;
      if (refCounts) {
        const total = refCounts.train + refCounts.val + refCounts.test;
        const round1 = (v) => Math.round((v / total) * 10) / 10;
        const candidate = { train: round1(refCounts.train), val: round1(refCounts.val), test: round1(refCounts.test) };
        if (Math.abs(candidate.train + candidate.val + candidate.test - 1) < 1e-6) ratios = candidate;
      }
      onCreateTrainingPlan?.({
        experimentName: proposal.title,
        parentModelId: ref ? modelIdOf(ref) : "",
        iterations: proposal.settings?.iterations || null,
        ratios,
        note: [
          `比較提案「${proposal.title}」より作成（変更項目: ${proposal.changedLabel}）`,
          ...proposal.lines.map((line) => `${line.label}: ${line.value}`),
        ].join("\n"),
      });
    };
    // 主要3指標（カード表示）と改善・悪化比較（画像単位の学習前比）の行定義
    const mainMetrics = ["cer", "charAccuracy", "percent"].map((key) => COMPARE_METRICS.find((m) => m.key === key));
    const mainHelp = { cer: HELP_TEXTS.cer, charAccuracy: HELP_TEXTS.charAccuracy, percent: HELP_TEXTS.exactMatch };
    const deltaRows = [
      { key: "improved", label: "改善件数", better: "max", help: HELP_TEXTS.improvedRegressed },
      { key: "unchanged", label: "同等件数", better: null },
      { key: "regressed", label: "悪化件数", better: "min" },
      { key: "perfectFixed", label: "完全一致へ改善", better: "max", help: HELP_TEXTS.perfectTransition },
      { key: "perfectRegressed", label: "完全一致から悪化", better: "min" },
      { key: "cerRelativeImprovement", label: "CER相対改善率", better: "max", ratioPct: true, help: HELP_TEXTS.cerRelativeImprovement },
    ].map((def) => {
      const values = comparison.columns.map((col) => {
        const v = col.latest?.[def.key];
        return Number.isFinite(v) ? v : null;
      });
      const numeric = values.filter((v) => v !== null);
      const best =
        def.better && numeric.length >= 2 ? (def.better === "min" ? Math.min(...numeric) : Math.max(...numeric)) : null;
      return { ...def, values, best };
    });
    const fmtDelta = (def, value) => {
      if (value === null) return "未記録";
      return def.ratioPct ? `${(value * 100).toFixed(1)}%` : `${value}`;
    };
    const maxWins = Math.max(1, ...comparison.columns.map((col) => winLoss.wins[col.model] || 0));
    const winsSorted = [...comparison.columns].sort((a, b) => (winLoss.wins[b.model] || 0) - (winLoss.wins[a.model] || 0));
    // 横スクロール表の共通クラス（指標名列はsticky固定・管理Noは常に表示）
    // 項目列は120〜145pxを確保しsticky固定（モデル値列が潰れないよう横スクロールと併用）
    const stickyLabel =
      "sticky left-0 z-10 min-w-[120px] max-w-[145px] whitespace-nowrap bg-[#333c46] px-2 py-1.5 text-left text-[13px] font-normal text-muted";
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 固定領域: 凡例 + 警告 + 推奨モデル + 主要3指標カード
            （画面が低い場合のみ内部スクロールし、下の詳細分析の最低高を確保する） */}
        <div className="dark-scroll min-h-0 flex-[0_1_auto] space-y-2 overflow-y-auto pr-0.5 [overscroll-behavior:contain]">
          {/* 凡例（モデル識別色。ファイル名はホバーで確認） */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
            {compareTargets.map((name) => (
              <span key={name} className="inline-flex items-center gap-1 text-[12px]" title={compareTitle(name)}>
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(name) }} />
                <ModelIdBadge modelId={compareLabel(name)} size="sm" color={colorOf(name)} />
              </span>
            ))}
          </div>
          {conditions.match === false ? (
            <div className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2">
              <p className="text-[13px] font-semibold text-amber-200">注意</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-amber-100/90">
                選択モデル間で{conditions.mismatched.join("・")}が一致していません。比較結果は参考値として確認してください。
              </p>
            </div>
          ) : null}

          {/* 比較結果の要約: 推奨モデル（勝利数→CER→文字正解率。Accuracy単独では決めない）。
              管理No主表示＋ファイル名補助を1行に収め、理由は最大1行のコンパクト表示 */}
          {recommended ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-[13px] text-amber-200">推奨モデル</span>
                <ModelIdBadge
                  modelId={compareLabel(recommended.model)}
                  size="lg"
                  color={colorOf(recommended.model)}
                  title={compareTitle(recommended.model)}
                  className="shrink-0 leading-6"
                />
                <span className="min-w-0 truncate text-[12px] text-amber-100/70" title={recommended.model}>
                  {shortFileLabel(recommended.model)}
                </span>
              </div>
              {recommended.reasons.length > 0 ? (
                <p className="mt-0.5 truncate text-[12px] text-amber-100/90" title={recommended.reasons.join("・")}>
                  {recommended.reasons.length > 3
                    ? `${recommended.reasons.slice(0, 3).map((r) => r.replace(/最良$/, "")).join("・")}など${recommended.reasons.length}項目で最良`
                    : `${recommended.reasons.join("・")}`}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[13px] text-muted">評価済みのモデルがありません（モデル評価画面で実行してください）</p>
          )}

          {/* 主要3指標カード（モデルごと。最良との差分を併記。
              minmax(0,1fr)でペインを押し広げず、右ペインが狭い場合はコンテナクエリで縦並びへ） */}
          <div className="comparison-cards" style={{ "--cols": comparison.columns.length }}>
            {comparison.columns.map((col, index) => (
              <div
                key={col.model}
                className="comparison-card rounded-lg border border-border bg-card/45"
                style={{ borderTop: `3px solid ${colorOf(col.model)}` }}
              >
                <p className="truncate leading-6" title={compareTitle(col.model)}>
                  <ModelIdBadge modelId={compareLabel(col.model)} size="lg" color={colorOf(col.model)} />
                </p>
                <p className="truncate text-[11px] text-muted" title={col.model}>
                  {shortFileLabel(col.model)}
                </p>
                {/* 主要3指標を横3列で表示（縦積みしない=カード高さを約1/3へ削減）。
                    値(22px)の直下に略称ラベル＋差分（一致は正解/総数）を小さく表示 */}
                <div className="mt-1.5 grid grid-cols-3 gap-1 border-t border-border/50 pt-1.5 text-center">
                  {mainMetrics.map((metric) => {
                    const row = comparison.rows.find((r) => r.metric.key === metric.key);
                    const value = metricValue(metric, col.latest);
                    const diff = formatBestDiff(metric, col.latest, row.best);
                    const shortLabel = metric.key === "cer" ? "CER" : metric.key === "charAccuracy" ? "文字" : "一致";
                    const subText =
                      metric.key === "percent"
                        ? col.latest?.correct !== null && col.latest?.correct !== undefined
                          ? `${col.latest.correct} / ${col.latest.total}`
                          : diff || ""
                        : diff || "";
                    return (
                      <div key={metric.key} className="min-w-0">
                        {value === null ? (
                          <p className="text-[14px] font-medium leading-6 text-muted">—</p>
                        ) : (
                          <p
                            className={`truncate text-[20px] font-bold leading-6 tabular-nums ${
                              diff === "最良" ? "text-emerald-300" : "text-text"
                            }`}
                          >
                            {metric.key === "percent" ? `${value}%` : formatMetricValue(metric, col.latest)}
                          </p>
                        )}
                        <p className="flex items-center justify-center text-[13px] text-muted">
                          {shortLabel}
                          <InfoTooltip {...mainHelp[metric.key]} align={index === 0 ? "left" : "right"} />
                        </p>
                        <p
                          className={`truncate text-[12px] tabular-nums ${
                            value === null ? "text-muted" : diff === "最良" && metric.key !== "percent" ? "text-emerald-300" : "text-muted"
                          }`}
                        >
                          {value === null ? "未記録" : subText}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* スクロール領域: 詳細分析（主要指標を確認したままスクロールできる） */}
        <div className="dark-scroll mt-2 min-h-[150px] flex-1 space-y-3 overflow-y-auto border-t border-border/50 pt-2 pr-0.5 [overscroll-behavior:contain]">
          {/* 改善・悪化比較（画像単位の学習前比） */}
          <div className="rounded-lg border border-border bg-card/45 px-2.5 py-2.5">
            <p className="mb-1.5 flex items-center text-[15px] font-semibold text-text">
              改善・悪化比較
              <InfoTooltip {...HELP_TEXTS.improvedRegressed} align="left" />
            </p>
            <div className="comparison-table-wrap">
              <table className="w-full text-[14px] tabular-nums">
                <thead>
                  <tr>
                    <th className={stickyLabel}></th>
                    {comparison.columns.map((col) => (
                      <th
                        key={col.model}
                        className="whitespace-nowrap px-2 py-1.5 text-left"
                        title={compareTitle(col.model)}
                      >
                        <ModelIdBadge modelId={compareLabel(col.model)} size="md" color={colorOf(col.model)} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deltaRows.map((def) => (
                    <tr key={def.key} className="border-t border-border/50">
                      <td className={stickyLabel}>
                        <span className="flex items-center">
                          {def.label}
                          {def.help ? <InfoTooltip {...def.help} align="left" /> : null}
                        </span>
                      </td>
                      {def.values.map((value, index) => {
                        const isBest = value !== null && def.best !== null && value === def.best;
                        const color = value === null ? "text-muted" : isBest ? bestText : "text-text";
                        return (
                          <td key={comparison.columns[index].model} className={`whitespace-nowrap px-2 py-1.5 text-[15px] ${value === null ? "text-[13px]" : ""} ${color}`}>
                            {fmtDelta(def, value)}
                            {isBest ? <span className="ml-1 align-middle text-[11px] text-emerald-300/80">最良</span> : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ⑤ 学習条件比較（何を変えて学習したかをモデル間で比較。旧モデルの未記録項目は「未記録」表示） */}
          <div className="rounded-lg border border-border bg-card/45 px-2.5 py-2.5">
            <p className="mb-1.5 text-[15px] font-semibold text-text">学習条件比較</p>
            {comparabilityNotes.length > 0 ? (
              <div className="mb-2 rounded-lg border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5">
                <p className="text-[12px] font-semibold text-amber-200">注意</p>
                {comparabilityNotes.map((note) => (
                  <p key={note} className="mt-0.5 text-[12px] leading-relaxed text-amber-100/90">
                    {note}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="comparison-table-wrap">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={stickyLabel}></th>
                    {compareTargets.map((name) => (
                      <th
                        key={name}
                        className="min-w-[135px] whitespace-nowrap px-2 py-1.5 text-left align-top"
                        title={compareTitle(name)}
                      >
                        <ModelIdBadge modelId={compareLabel(name)} size="md" color={colorOf(name)} />
                        {/* ヘッダー補足はファイル名の日時短縮表示（元名はホバーで確認） */}
                        <span className="block max-w-[10rem] truncate text-[10px] font-normal text-muted">{shortFileLabel(name)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TRAINING_CONDITION_ROWS.map((row) => (
                    <tr key={row.key} className="border-t border-border/50">
                      <td className={stickyLabel}>
                        <span className="flex items-center">
                          {row.label}
                          {row.helpKey && HELP_TEXTS[row.helpKey] ? <InfoTooltip {...HELP_TEXTS[row.helpKey]} align="left" /> : null}
                        </span>
                      </td>
                      {compareTargets.map((name) => {
                        const text = row.value(conditionOf(name));
                        return (
                          <td
                            key={name}
                            className={`min-w-0 max-w-[12rem] truncate px-2 py-1.5 text-[13px] ${text === "未記録" ? "text-muted" : "text-text"}`}
                            title={text}
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ⑤-2 学習前処理比較（前処理スナップショット由来。要約は表・詳細は折りたたみ。旧モデル=未記録） */}
          <div className="rounded-lg border border-border bg-card/45 px-2.5 py-2.5">
            <p className="mb-1.5 flex items-center gap-2 text-[15px] font-semibold text-text">
              学習前処理比較
              {preList.length >= 2 && preList.every((p) => p.recorded) && new Set(preList.map((p) => p.hash)).size === 1 ? (
                <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-normal text-success">
                  学習時前処理一致
                </span>
              ) : null}
            </p>
            {preprocessNotes.length > 0 ? (
              <div className="mb-2 rounded-lg border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5">
                <p className="text-[12px] font-semibold text-amber-200">注意</p>
                {preprocessNotes.map((note) => (
                  <p key={note} className="mt-0.5 text-[12px] leading-relaxed text-amber-100/90">
                    {note}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="comparison-table-wrap">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={stickyLabel}></th>
                    {compareTargets.map((name) => (
                      <th
                        key={name}
                        className="min-w-[135px] whitespace-nowrap px-2 py-1.5 text-left align-top"
                        title={compareTitle(name)}
                      >
                        <ModelIdBadge modelId={compareLabel(name)} size="md" color={colorOf(name)} />
                        <span className="block max-w-[10rem] truncate text-[10px] font-normal text-muted">{shortFileLabel(name)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border/50">
                    <td className={stickyLabel}>前処理一致</td>
                    {compareTargets.map((name, index) => (
                      <td
                        key={name}
                        className={`px-2 py-1.5 text-[13px] ${
                          preMatchLabels[index] === "同一"
                            ? "font-semibold text-success"
                            : preMatchLabels[index] === "異なる"
                              ? "font-semibold text-amber-300"
                              : "text-muted"
                        }`}
                      >
                        {preMatchLabels[index]}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t border-border/50">
                    <td className={stickyLabel}>前処理ハッシュ</td>
                    {compareTargets.map((name, index) => (
                      <td
                        key={name}
                        className={`px-2 py-1.5 font-mono text-[12px] ${preList[index].recorded ? "text-text" : "text-muted"}`}
                        title={preList[index].hash || "未記録"}
                      >
                        {preList[index].hashShort || "未記録"}
                      </td>
                    ))}
                  </tr>
                  {PREPROCESS_COMPARISON_ROWS.map((row) => (
                    <tr key={row.key} className="border-t border-border/50">
                      <td className={stickyLabel}>{row.label}</td>
                      {compareTargets.map((name, index) => {
                        const text = preprocessRowValue(row, preList[index]);
                        return (
                          <td
                            key={name}
                            className={`min-w-0 max-w-[12rem] truncate px-2 py-1.5 text-[13px] ${text === "未記録" ? "text-muted" : "text-text"}`}
                            title={text}
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 前処理差分（隣接ペアの変更点のみ抽出。両方記録ありのペアだけ判定できる） */}
            {preDiffs.some((diff) => diff.comparable) ? (
              <div className="mt-2 space-y-1.5">
                <p className="text-[12px] font-semibold text-muted">前処理差分</p>
                {preDiffs.map((diff) => (
                  <div key={`${diff.from}-${diff.to}`} className="rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5">
                    <p className="text-[13px]">
                      <ModelIdBadge modelId={compareLabel(diff.from)} size="md" color={colorOf(diff.from)} />
                      <span className="text-muted"> → </span>
                      <ModelIdBadge modelId={compareLabel(diff.to)} size="md" color={colorOf(diff.to)} />
                    </p>
                    {!diff.comparable ? (
                      <p className="text-[12px] text-muted">未記録モデルを含むため差分を判定できません。</p>
                    ) : diff.changes.length === 0 ? (
                      <p className="text-[12px] text-success">前処理差分なし</p>
                    ) : (
                      <div className="mt-0.5">
                        <p className="text-[12px] font-semibold text-muted">変更</p>
                        {diff.changes.map((change) => (
                          <p key={change.key} className="text-[13px] text-text">
                            ・{change.label}：{change.from} → {change.to}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            {/* 前処理詳細（折りたたみ。工程順・有効状態・パラメータ・ハッシュ・スナップショットID・作成日時） */}
            <details className="mt-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5">
              <summary className="cursor-pointer select-none text-[13px] font-semibold text-text">前処理詳細</summary>
              <div className="mt-1.5 space-y-2">
                {compareTargets.map((name, index) => {
                  const pre = preList[index];
                  return (
                    <div key={name} className="rounded-lg border border-border/60 bg-card/55 px-2.5 py-2">
                      <p className="text-[13px]">
                        <ModelIdBadge modelId={compareLabel(name)} size="md" color={colorOf(name)} />
                        <span className="ml-2 text-[11px] font-normal text-muted">{shortFileLabel(name)}</span>
                      </p>
                      {!pre.recorded ? (
                        <p className="mt-0.5 text-[12px] text-muted">学習時前処理：未記録（旧モデル）</p>
                      ) : (
                        <>
                          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                            <span className="text-muted">スナップショットID</span>
                            <span className="text-text">{pre.snapshotId || "-"}</span>
                            <span className="text-muted">作成日時</span>
                            <span className="text-text">{formatDateTime(pre.createdAt)}</span>
                            <span className="text-muted">前処理ハッシュ</span>
                            <span className="break-all font-mono text-text">{pre.hash}</span>
                            <span className="text-muted">対象種別</span>
                            <span className="text-text">{pre.imageTypes.join(", ") || "-"}</span>
                          </div>
                          <div className="comparison-table-wrap mt-1.5">
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="text-left text-muted">
                                  <th className="px-1.5 py-1 font-medium">#</th>
                                  <th className="px-1.5 py-1 font-medium">工程</th>
                                  <th className="px-1.5 py-1 font-medium">有効</th>
                                  <th className="px-1.5 py-1 font-medium">パラメータ</th>
                                </tr>
                              </thead>
                              <tbody>
                                {preprocessDetailRows(pre).map((row, rowIndex) => (
                                  <tr key={`${row.name}-${rowIndex}`} className="border-t border-border/40">
                                    <td className="px-1.5 py-0.5 tabular-nums text-muted">{rowIndex + 1}</td>
                                    <td className="px-1.5 py-0.5 text-text">{row.name}</td>
                                    <td className={`px-1.5 py-0.5 ${row.enabled ? "text-success" : "text-muted"}`}>
                                      {row.enabled ? "ON" : "OFF"}
                                    </td>
                                    <td className="min-w-0 max-w-[18rem] truncate px-1.5 py-0.5 text-muted" title={row.params}>
                                      {row.params || "-"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <details className="mt-1">
                            <summary className="cursor-pointer select-none text-[11px] text-muted hover:text-text">JSONを表示</summary>
                            <pre className="dark-scroll mt-1 max-h-48 overflow-auto rounded border border-border/60 bg-black/25 p-2 text-[10px] leading-4 text-slate-200">
                              {JSON.stringify(pre.raw, null, 2)}
                            </pre>
                          </details>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          </div>

          {/* ⑥ 条件差分の要約（隣接ペアの変更項目・性能変化・判定。単一条件比較/複数条件変更を明示） */}
          {diffSummaries.length > 0 ? (
            <div className="rounded-lg border border-border bg-card/45 px-2.5 py-2.5">
              <p className="mb-1.5 text-[15px] font-semibold text-text">条件差分の要約</p>
              <div className="space-y-2">
                {diffSummaries.map((summary) => (
                  <div key={summary.pair} className="rounded-lg border border-border/70 bg-card/60 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px]">
                        <ModelIdBadge modelId={compareLabel(summary.from)} size="md" color={colorOf(summary.from)} />
                        <span className="text-muted"> → </span>
                        <ModelIdBadge modelId={compareLabel(summary.to)} size="md" color={colorOf(summary.to)} />
                      </span>
                      <span
                        className={`flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
                          summary.classification === "single"
                            ? "border-success/40 bg-success/10 text-success"
                            : summary.classification === "multi"
                              ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                              : "border-border bg-card/60 text-muted"
                        }`}
                      >
                        {DIFF_CLASSIFICATION_LABELS[summary.classification]}
                        {summary.classification === "single" ? <InfoTooltip {...HELP_TEXTS.singleConditionCompare} /> : null}
                        {summary.classification === "multi" ? <InfoTooltip {...HELP_TEXTS.multiConditionChange} /> : null}
                      </span>
                      <span className="text-[12px] text-muted">変更項目：{summary.changeCount}件</span>
                    </div>
                    {summary.changes.length > 0 ? (
                      <div className="mt-1.5">
                        <p className="text-[12px] font-semibold text-muted">変更</p>
                        {summary.changes.map((change) => (
                          <p key={change.key} className="text-[13px] text-text">
                            ・{change.label}：{change.from} → {change.to}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {summary.results.length > 0 ? (
                      <div className="mt-1.5">
                        <p className="text-[12px] font-semibold text-muted">結果</p>
                        {summary.results.map((result) => (
                          <p key={result.label} className="text-[13px] tabular-nums text-text">
                            ・{result.label}：{result.from} → {result.to}（
                            <span className={result.improved ? "text-success" : result.worsened ? "text-danger" : "text-muted"}>
                              {result.delta}
                            </span>
                            ）
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-1.5">
                      <p className="text-[12px] font-semibold text-muted">判定</p>
                      <p className="text-[13px] leading-relaxed text-text">{summary.verdict}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ⑦ 次回学習の提案（ルールベースの比較実験候補。断定しない） */}
          {proposals.length > 0 ? (
            <div className="rounded-lg border border-border bg-card/45 px-2.5 py-2.5">
              <p className="mb-1 text-[15px] font-semibold text-text">次回学習の提案</p>
              <p className="mb-2 text-[12px] leading-relaxed text-muted">
                この提案は比較結果に基づく実験候補です。性能向上を保証するものではありません。
              </p>
              <div className="space-y-2">
                {proposals.map((proposal, index) => (
                  <div key={proposal.id} className="rounded-lg border border-border/70 bg-card/60 px-2.5 py-2">
                    <p className="text-[14px] font-semibold text-text">
                      候補{String.fromCharCode(65 + index)}：{proposal.title}
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {proposal.lines.map((line) => (
                        <div key={line.label} className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-[12px] text-muted">{line.label}</span>
                          <span className="min-w-0 break-all text-right text-[13px] text-text">{line.value}</span>
                        </div>
                      ))}
                    </div>
                    {proposal.settings && onCreateTrainingPlan ? (
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2.5 text-[12px]"
                          onClick={() => createTrainingPlan(proposal)}
                          title="学習画面へ設定を引き継ぎます（学習はまだ開始しません）"
                        >
                          この条件で学習設定を作成
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ⑧ 評価条件（比較の前提確認。警告対象=データセット/前処理/Whitelist/画像数） */}
          <div className="rounded-lg border border-border bg-card/45 px-2.5 py-2.5">
            <p className="mb-1.5 flex items-center gap-2 text-[15px] font-semibold text-text">
              評価条件
              {conditions.match === true ? (
                <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-normal text-success">
                  評価条件一致
                </span>
              ) : null}
            </p>
            <div className="comparison-table-wrap">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={stickyLabel}></th>
                    {comparison.columns.map((col) => (
                      <th
                        key={col.model}
                        className="whitespace-nowrap px-2 py-1.5 text-left"
                        title={compareTitle(col.model)}
                      >
                        <ModelIdBadge modelId={compareLabel(col.model)} size="md" color={colorOf(col.model)} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conditions.rows.map((row) => (
                    <tr key={row.key} className="border-t border-border/50">
                      <td className={stickyLabel}>
                        <span className="flex items-center">
                          {row.label}
                          {row.key === "preprocess" ? <InfoTooltip {...HELP_TEXTS.ocrPreprocess} align="left" /> : null}
                          {row.key === "whitelist" ? <InfoTooltip {...HELP_TEXTS.whitelist} align="left" /> : null}
                        </span>
                      </td>
                      {row.values.map((value, index) => (
                        <td
                          key={comparison.columns[index].model}
                          className="min-w-0 max-w-[12rem] truncate px-2 py-1.5 text-[13px] text-text"
                          title={value}
                        >
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ⑨ 混同比較（全モデル合計の多い順。横棒で件数を可視化・0件は棒なし。初期折りたたみ） */}
          {allConfusions.length > 0 ? (
            <details className="rounded-lg border border-border bg-card/45 px-2.5 py-2.5">
              <summary className="cursor-pointer select-none text-[15px] font-semibold text-text">
                混同比較{confusionExpanded ? `（全${allConfusions.length}件）` : " TOP8"}
              </summary>
              <div className="mb-1.5 mt-1.5 flex items-center justify-between">
                <span className="flex items-center text-[12px] text-muted">
                  誤認識の組み合わせ比較
                  <InfoTooltip {...HELP_TEXTS.confusionCompare} align="left" />
                </span>
                {allConfusions.length > 8 ? (
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5 text-[12px] text-muted transition-colors hover:border-accent/60 hover:text-accent"
                    onClick={() => setConfusionExpanded((v) => !v)}
                  >
                    {confusionExpanded ? "TOP8のみ" : "すべて表示"}
                  </button>
                ) : null}
              </div>
              <div className="space-y-2.5">
                {confusionRows.map((row) => (
                  <div key={`${row.kind}-${row.from}-${row.to}`}>
                    <p
                      className="confusion-glyphs text-[14px] font-semibold text-text"
                      title={`${confusionTitle(row)}\n全モデル合計 ${row.total}件`}
                    >
                      {row.label}
                    </p>
                    <div className="mt-0.5 space-y-0.5">
                      {row.counts.map((count, index) => (
                        <div key={comparison.columns[index].model} className="flex items-center gap-1.5">
                          <ModelIdBadge
                            modelId={compareLabel(comparison.columns[index].model)}
                            size="sm"
                            color={colorOf(comparison.columns[index].model)}
                            title={compareTitle(comparison.columns[index].model)}
                            className="w-14 truncate"
                          />
                          <span className="w-10 shrink-0 text-right text-[13px] tabular-nums text-text">
                            {count === null ? "—" : `${count}件`}
                          </span>
                          <div className="min-w-0 flex-1">
                            {count !== null && count > 0 ? (
                              <div
                                className="h-2.5 rounded-sm"
                                style={{
                                  width: `${Math.max(3, (count / confusionMax) * 100)}%`,
                                  backgroundColor: colorOf(comparison.columns[index].model),
                                }}
                              />
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {/* ⑩ 指標別結果・総合勝利数（初期折りたたみ。同率最良は全モデルを併記・同率でも各モデルへ1勝） */}
          <details className="rounded-lg border border-border bg-card/45 px-2.5 py-2.5">
            <summary className="cursor-pointer select-none text-[15px] font-semibold text-text">指標別結果・総合勝利数</summary>
            <p className="mb-1 mt-1.5 text-[13px] font-semibold text-muted">指標別結果</p>
            <table className="w-full text-[13px]">
              <tbody>
                {winLoss.rows.map((row) => (
                  <tr key={row.metric.key} className="border-t border-border/50 first:border-t-0">
                    <td className="whitespace-nowrap py-1.5 pr-2 text-[13px] text-muted">{row.metric.label}</td>
                    <td className="py-1.5 text-[14px] font-semibold">
                      {row.winners.length > 0 ? (
                        row.winners.map((w, i) => (
                          <span key={w}>
                            {i > 0 ? <span className="font-normal text-muted"> / </span> : null}
                            <ModelIdBadge modelId={compareLabel(w)} size="sm" color={colorOf(w)} title={compareTitle(w)} />
                          </span>
                        ))
                      ) : (
                        <span className="font-normal text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 総合勝利数（推奨モデル判定と同じ勝利数。横棒で差を可視化） */}
            <p className="mb-1.5 mt-2 border-t border-border/50 pt-2 text-[13px] font-semibold text-muted">総合勝利数</p>
            <div className="space-y-1.5">
              {winsSorted.map((col) => {
                const wins = winLoss.wins[col.model] || 0;
                // 棒はモデル識別色を維持（最多だけ緑にしない）。最多は「最多」ラベルで示す
                const isTop = wins > 0 && wins === maxWins;
                return (
                  <div key={col.model} className="flex items-center gap-2">
                    <ModelIdBadge
                      modelId={compareLabel(col.model)}
                      size="md"
                      color={colorOf(col.model)}
                      title={compareTitle(col.model)}
                      className="w-14 truncate"
                    />
                    <span className="w-10 shrink-0 text-right text-lg font-bold tabular-nums text-text">{wins}</span>
                    <span className="shrink-0 text-[12px] text-muted">勝</span>
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      {wins > 0 ? (
                        <div
                          className="h-3 rounded-sm"
                          style={{ width: `${(wins / maxWins) * 100}%`, backgroundColor: colorOf(col.model) }}
                        />
                      ) : null}
                      {isTop ? <span className="shrink-0 text-[11px] text-emerald-300">最多</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>

          {/* ⑪ モデル詳細情報（比較時の優先度が低いため初期は折り畳み） */}
          <details className="rounded-lg border border-border bg-card/45 px-2.5 py-2.5">
            <summary className="cursor-pointer select-none text-[15px] font-semibold text-text">モデル詳細情報</summary>
            <div className="comparison-table-wrap mt-2">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={stickyLabel}></th>
                    {compareTargets.map((name) => (
                      <th key={name} className="whitespace-nowrap px-2 py-1.5 text-left align-top" title={compareTitle(name)}>
                        <ModelIdBadge modelId={compareLabel(name)} size="md" color={colorOf(name)} />
                        <span className="mt-0.5 block max-w-[9rem] truncate text-[11px] font-normal text-muted" title={name}>
                          {displayName(name)}
                        </span>
                        <ModelBadgeChips names={badgeMap[name]} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Engine", value: (name) => engineLabelOf(engineName(name), trainingFamily(name)) },
                    { label: "方式", value: (name) => familyLabelOf(trainingFamily(name)) },
                    { label: "ベースモデル", value: (name) => infoOf(name).base_lang || "-", help: HELP_TEXTS.baseModel },
                    { label: "Iteration", value: (name) => iterationText(name), help: HELP_TEXTS.iteration },
                    { label: "学習画像数", value: (name) => trainingImageTotal(name) },
                    {
                      label: "Train / Val / Test",
                      value: (name) => {
                        const counts = datasetCounts(name);
                        return `${counts.train} / ${counts.val} / ${counts.test}`;
                      },
                    },
                    { label: "Charset", value: (name) => infoOf(name).charset || "-" },
                    { label: "Augmentation", value: (name) => augText(name) },
                    { label: "モデルサイズ", value: (name) => modelSizeText(name) },
                    { label: "学習日時", value: (name) => formatDateTime(createdAt(name)) },
                  ].map((row) => (
                    <tr key={row.label} className="border-t border-border/50">
                      <td className={stickyLabel}>
                        <span className="flex items-center">
                          {row.label}
                          {row.help ? <InfoTooltip {...row.help} align="left" /> : null}
                        </span>
                      </td>
                      {compareTargets.map((name) => (
                        <td
                          key={name}
                          className="min-w-[130px] max-w-[14rem] truncate px-2 py-1.5 text-[14px] font-medium text-text"
                          title={String(row.value(name))}
                        >
                          {row.value(name)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    );
  }

  return (
    // 右=比較・分析の主領域として広く確保: 1600px以上=左1.2fr:右1fr（≈54.5:45.5）/
    // 1366〜1599px=左1.05fr:右1fr（≈51:49）/ 1366px未満=右ペインを下段へ縦積み。
    // 両列とも minmax(0,…) で固定幅を持たず連続的に収縮（縦積み時は固定高を外して自然高）
    <div className="grid w-full min-w-0 grid-cols-1 gap-3 min-[1366px]:h-[calc(100vh-238px)] min-[1366px]:min-h-[480px] min-[1366px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] min-[1600px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      {/* 左: サマリー + フィルタ + 一覧（min-w-0でグリッド収縮を妨げない） */}
      <div className="flex min-h-0 min-w-0 flex-col gap-2">
        <div className="flex shrink-0 gap-2">
          <SummaryCard
            title="推論使用モデル"
            name={inferenceInUseModel && models.includes(inferenceInUseModel) ? inferenceInUseModel : inferenceInUseModel || ""}
            emptyText={
              inferenceInUseEngine === "easyocr"
                ? "EasyOCR（学習モデルを使用しない推論設定です）"
                : "推論使用モデルが未設定です。一覧から「推論に使用」で設定できます。"
            }
            highlight
          />
          <SummaryCard title="最新モデル" name={latestAny} emptyText="学習済みモデルがありません。" />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card/50 px-2.5 py-1.5 backdrop-blur-md">
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="検索（管理No / モデル名 / 表示名）"
            className="app-input h-7 w-48 text-xs"
          />
          <select value={filterEngine} onChange={(e) => setFilterEngine(e.target.value)} className="app-select h-7 w-32 text-xs">
            <option value="all">Engine: 全て</option>
            {engineOptions.map((engine) => (
              <option key={engine} value={engine}>
                {engine}
              </option>
            ))}
          </select>
          <select value={filterFamily} onChange={(e) => setFilterFamily(e.target.value)} className="app-select h-7 w-32 text-xs">
            <option value="all">方式: 全て</option>
            <option value="OCR認識">OCR認識</option>
            <option value="分類">分類</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="app-select h-7 w-32 text-xs">
            <option value="all">状態: 全て</option>
            <option value="使用中">使用中</option>
            <option value="最新">最新</option>
            <option value="Export済">Export済</option>
            <option value="過去モデル">過去モデル</option>
          </select>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={selectedModels.length === 0}
              onClick={() => {
                setCompareMode(true);
                setDetailModel("");
              }}
              title="チェックしたモデル（最大3件）を右ペインで比較します"
            >
              比較（{Math.min(selectedModels.length, 3)}/3）
            </Button>
            <Button size="sm" variant="danger" disabled={selectedModels.length === 0} onClick={() => deleteModels(selectedModels)}>
              削除
            </Button>
            <Button size="sm" variant="secondary" onClick={onRefresh}>
              更新
            </Button>
          </div>
        </div>

        <div className="max-h-[60vh] min-h-0 flex-1 overflow-auto rounded-xl border border-border/60 min-[1366px]:max-h-none">
          {/* 一覧はCSS Grid（ヘッダーと各行で MODEL_LIST_GRID_COLUMNS を共有）。
              モデル名列は minmax(280px,400px) の上限付き=余った幅いっぱいまで伸ばさず、
              モデル名〜Engine間に大きな空白を作らない（長い名前はtruncate＋titleで全文確認） */}
          <div className="min-w-full text-sm">
            <div
              className="sticky top-0 z-10 grid border-b border-border bg-[#2f3841]/95 text-left text-muted backdrop-blur"
              style={{ gridTemplateColumns: MODEL_LIST_GRID_COLUMNS }}
            >
              <span className="px-2 py-2 font-medium" />
              <span className="px-2 py-2 font-medium">モデル名</span>
              <span className="px-2 py-2 font-medium">Engine</span>
              <span className="px-2 py-2 font-medium">方式</span>
              <span className="px-2 py-2 font-medium">作成日</span>
              <span className="px-2 py-2 font-medium">評価</span>
              <span className="px-2 py-2 font-medium">状態</span>
            </div>
            {filteredModels.map((name) => {
              const checked = selectedModels.includes(name);
              const active = detailModel === name && !compareMode;
              return (
                <div
                  key={name}
                  onClick={() => openDetail(name)}
                  className={`grid cursor-pointer items-center border-b border-border/80 transition ${
                    active ? "bg-accent/15" : "hover:bg-[#3b444e]/65"
                  }`}
                  style={{ gridTemplateColumns: MODEL_LIST_GRID_COLUMNS }}
                >
                  <span className="flex items-center px-1.5 py-2" onClick={(e) => e.stopPropagation()}>
                    {/* 視認性・クリックしやすさのため大きめ（20px）のチェックボックス */}
                    <input
                      type="checkbox"
                      className="h-5 w-5 cursor-pointer"
                      checked={checked}
                      onChange={(e) => toggleOne(name, e.target.checked)}
                      aria-label={`${name} を比較・削除対象に選択`}
                      title="比較・削除対象として選択（比較は先頭3件まで）"
                    />
                  </span>
                  <span className="min-w-0 px-2 py-2">
                    {/* 一覧は管理No＋モデル名のみ（Best/Recommended等の比較バッジは比較画面へ集約）。
                        モデル名は15px・管理No（通しナンバー）は共通ModelIdBadge（等幅12px/600・最低幅48px）。
                        gap-2（8px）で管理Noとモデル名が一続きに見えないよう分離し、バッジは縮めない */}
                    <p className="flex min-w-0 items-center gap-2 text-[15px] text-text" title={name}>
                      <ModelIdChip name={name} />
                      <span className="min-w-0 truncate">{displayName(name)}</span>
                    </p>
                    {aliases[name] ? (
                      <p className="truncate text-[11px] text-muted" title={name}>
                        {name}
                      </p>
                    ) : null}
                  </span>
                  <span className="px-2 py-2 text-muted">{engineLabelOf(engineName(name), trainingFamily(name))}</span>
                  <span className="px-2 py-2 text-muted">{familyLabelOf(trainingFamily(name))}</span>
                  <span className="whitespace-nowrap px-2 py-2 text-muted">{formatDateTime(createdAt(name))}</span>
                  <span className="min-w-0 px-2 py-2">
                    <ListEvalCell latest={latestEvalOf(evalHistory, name)} />
                  </span>
                  <span className="px-2 py-2">
                    <StatusBadge status={statusOf(name)} />
                  </span>
                </div>
              );
            })}
            {filteredModels.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">条件に一致するモデルがありません</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* 右: モデル詳細 / 比較（model-side-pane=幅コンテナ。固定最低幅なし・利用可能幅へ自動フィット） */}
      <Card
        title={compareMode ? "モデル比較" : "モデル詳細"}
        subtitle={compareMode ? `選択中 ${compareTargets.length}件 / 最大3件` : detailModel ? "一覧クリックで切替" : "一覧のモデルをクリック"}
        className="model-side-pane flex h-full min-h-0 flex-col"
      >
        {compareMode ? (
          renderCompare()
        ) : detailModel ? (
          renderDetail(detailModel)
        ) : (
          <p className="text-sm text-muted">
            一覧のモデルをクリックすると詳細を表示します。チェックボックスで最大3件を選び「比較」で並べて確認できます。
          </p>
        )}
      </Card>
    </div>
  );
}
