import { useEffect, useMemo, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";
import { API_BASE } from "../lib/api";

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

// 評価履歴（{セット名: {percent}}）を表示順の配列へ
function evalEntriesOf(evalHistory, name) {
  const record = evalHistory?.[name];
  if (!record || typeof record !== "object") return [];
  return Object.entries(record)
    .filter(([, v]) => Number.isFinite(Number(v?.percent)))
    .sort((a, b) => String(b[1]?.at || "").localeCompare(String(a[1]?.at || "")))
    .slice(0, 3)
    .map(([label, v]) => ({ label, percent: Number(v.percent) }));
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

function StatusBadge({ status }) {
  const cls =
    status === "使用中"
      ? "border-accent/50 bg-accent/15 text-blue-200"
      : status === "最新"
        ? "border-success/30 bg-success/10 text-success"
        : status === "Export済"
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

  function statusOf(name) {
    if (name && name === inferenceInUseModel) return "使用中";
    if (latestNames.has(name)) return "最新";
    if (exportReady(name)) return "Export済";
    return "過去モデル";
  }

  const filteredModels = useMemo(() => {
    const search = filterSearch.trim().toLowerCase();
    return models.filter((name) => {
      if (search && !name.toLowerCase().includes(search) && !String(aliases[name] || "").toLowerCase().includes(search)) {
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

  // 右ペイン: モデル詳細
  function renderDetail(name) {
    const info = infoOf(name);
    const counts = datasetCounts(name);
    const entries = evalEntriesOf(evalHistory, name);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
          <div>
            <p className="truncate text-sm font-semibold text-text" title={name}>
              {displayName(name)}
            </p>
            {aliases[name] ? (
              <p className="truncate text-[10px] text-muted" title={name}>
                {name}
              </p>
            ) : null}
            <div className="mt-1">
              <StatusBadge status={statusOf(name)} />
            </div>
          </div>

          <div className="space-y-1 rounded-lg border border-border bg-card/45 px-2.5 py-2">
            <DetailRow label="Engine" value={engineLabelOf(engineName(name), trainingFamily(name))} />
            <DetailRow label="方式" value={familyLabelOf(trainingFamily(name))} />
            <DetailRow label="ベースモデル" value={info.base_lang || "-"} />
            <DetailRow label="Charset" value={info.charset || "-"} />
            <DetailRow label="Iteration" value={iterationText(name)} />
            <DetailRow label="Train / Val / Test" value={`${counts.train} / ${counts.val} / ${counts.test}`} />
            <DetailRow label="Augmentation" value={augText(name)} />
            <DetailRow label="学習時間" value={info.training_duration || "-"} />
            <DetailRow label="作成日時" value={formatDateTime(createdAt(name))} />
            <DetailRow label="Export状態" value={exportReady(name) ? "Export済" : "未Export"} />
          </div>

          <div className="space-y-1 rounded-lg border border-border bg-card/45 px-2.5 py-2">
            <DetailRow label="traineddata" value={info.traineddata_path || "-"} />
            <DetailRow label="json" value={name.endsWith(".json") ? name : info.meta_path || "-"} />
            <DetailRow label="Export先" value={info.export_dir || info.inference_dir || (exportReady(name) ? "export済" : "-")} />
          </div>

          <div className="rounded-lg border border-border bg-card/45 px-2.5 py-2">
            <p className="mb-1 text-[11px] font-semibold text-text">評価結果</p>
            {entries.length > 0 ? (
              <div className="space-y-1.5">
                {entries.map((entry) => (
                  <div key={entry.label}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="truncate text-muted" title={entry.label}>
                        {entry.label}
                      </span>
                      <span className={`font-semibold ${evalColorClass(entry.percent)}`}>{entry.percent}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-sm bg-border/40">
                      <div
                        className={`h-full rounded-sm ${evalBarClass(entry.percent)}`}
                        style={{ width: `${Math.max(0, Math.min(100, entry.percent))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted">評価未実施（モデル評価画面で実行すると表示されます）</p>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/45 px-2.5 py-2">
            <p className="mb-1 text-[11px] font-semibold text-text">表示名（Alias）</p>
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

  // 右ペイン: 比較（最大3件）
  function renderCompare() {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {compareTargets.map((name) => {
          const counts = datasetCounts(name);
          const entries = evalEntriesOf(evalHistory, name);
          return (
            <div key={name} className="rounded-lg border border-border bg-card/45 px-2.5 py-2">
              <p className="truncate text-xs font-semibold text-text" title={name}>
                {displayName(name)}
              </p>
              <div className="mt-1 space-y-0.5">
                <DetailRow label="Engine" value={engineLabelOf(engineName(name), trainingFamily(name))} />
                <DetailRow label="Iteration" value={iterationText(name)} />
                <DetailRow label="データ" value={`${counts.train} / ${counts.val} / ${counts.test}`} />
                <DetailRow label="作成" value={formatDateTime(createdAt(name))} />
                <DetailRow label="状態" value={statusOf(name)} />
              </div>
              <div className="mt-1">
                <EvalBadges entries={entries} />
              </div>
            </div>
          );
        })}
        {compareTargets.length === 0 ? <p className="text-xs text-muted">一覧でモデルを選択してください。</p> : null}
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-238px)] min-h-[480px] grid-cols-[minmax(0,7fr)_minmax(300px,3fr)] gap-3">
      {/* 左: サマリー + フィルタ + 一覧 */}
      <div className="flex min-h-0 flex-col gap-2">
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
            placeholder="検索（モデル名 / 表示名）"
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

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#2f3841]/95 backdrop-blur">
              <tr className="border-b border-border text-left text-muted">
                <th className="w-8 px-2 py-2 font-medium" />
                <th className="px-2 py-2 font-medium">モデル名</th>
                <th className="px-2 py-2 font-medium">Engine</th>
                <th className="px-2 py-2 font-medium">方式</th>
                <th className="px-2 py-2 font-medium">作成日</th>
                <th className="px-2 py-2 font-medium">評価</th>
                <th className="px-2 py-2 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.map((name) => {
                const checked = selectedModels.includes(name);
                const active = detailModel === name && !compareMode;
                return (
                  <tr
                    key={name}
                    onClick={() => openDetail(name)}
                    className={`cursor-pointer border-b border-border/80 transition ${
                      active ? "bg-accent/15" : "hover:bg-[#3b444e]/65"
                    }`}
                  >
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleOne(name, e.target.checked)}
                        aria-label={`${name} を比較・削除対象に選択`}
                        title="比較・削除対象として選択（比較は先頭3件まで）"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <p className="truncate text-text" title={name}>
                        {displayName(name)}
                      </p>
                      {aliases[name] ? (
                        <p className="truncate text-[10px] text-muted" title={name}>
                          {name}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-muted">{engineLabelOf(engineName(name), trainingFamily(name))}</td>
                    <td className="px-2 py-2 text-muted">{familyLabelOf(trainingFamily(name))}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted">{formatDateTime(createdAt(name))}</td>
                    <td className="px-2 py-2">
                      <EvalBadges entries={evalEntriesOf(evalHistory, name)} />
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={statusOf(name)} />
                    </td>
                  </tr>
                );
              })}
              {filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">
                    条件に一致するモデルがありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* 右: モデル詳細 / 比較 */}
      <Card
        title={compareMode ? "モデル比較" : "モデル詳細"}
        subtitle={compareMode ? `選択中 ${compareTargets.length} 件（最大3件）` : detailModel ? "一覧クリックで切替" : "一覧のモデルをクリック"}
        className="flex h-full min-h-0 flex-col"
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
