import { useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";

function MetricCard({ label, value, subValue }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 backdrop-blur-md p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-text">{value}</p>
      {subValue ? <p className="mt-1 text-sm text-muted">{subValue}</p> : null}
    </div>
  );
}

export default function EvaluationView({
  dataset,
  datasetOptions,
  setDataset,
  model,
  setModel,
  modelType,
  setModelType,
  modelTypes,
  models,
  latestModels,
  useOverrides,
  setUseOverrides,
  loading,
  result,
  onEvaluate,
}) {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [classFilter, setClassFilter] = useState("");
  const normalizedDatasetOptions = useMemo(() => {
    if (!Array.isArray(datasetOptions)) {
      return [];
    }
    return datasetOptions.filter((item) => item === "val" || item === "test");
  }, [datasetOptions]);
  const latestAny = String(latestModels?.any || "");
  const latestByType = latestModels?.byType || {};

  function basename(path) {
    if (!path) return "";
    const parts = String(path).split("/");
    return parts[parts.length - 1];
  }

  function datasetLabel(value) {
    if (value === "val") return "検証";
    if (value === "test") return "テスト";
    return value || "-";
  }

  const classOptions = useMemo(() => {
    const fromAccuracy = Object.keys(result?.per_class_accuracy || {});
    if (fromAccuracy.length > 0) {
      return fromAccuracy;
    }
    const fromSamples = [...new Set((result?.samples || []).flatMap((x) => [x.gt, x.pred]))];
    return fromSamples.filter(Boolean).sort();
  }, [result]);

  const rows = useMemo(() => {
    const items = result?.samples || [];
    return items.filter((row) => {
      if (onlyErrors && row.correct) {
        return false;
      }
      if (classFilter && row.gt !== classFilter && row.pred !== classFilter) {
        return false;
      }
      return true;
    });
  }, [result, onlyErrors, classFilter]);

  const preprocessConfigLine = useMemo(() => {
    const cfg = result?.preprocess_config;
    if (!cfg || typeof cfg !== "object") {
      return "";
    }
    try {
      return JSON.stringify(cfg);
    } catch {
      return "";
    }
  }, [result]);

  const evaluationSummaryText = useMemo(() => {
    if (!result) {
      return "";
    }
    return `評価完了: 正解率 ${(Number(result.accuracy || 0) * 100).toFixed(1)}%`;
  }, [result]);

  function accuracyColor(value) {
    const ratio = Math.max(0, Math.min(1, Number(value || 0)));
    // 0%: red(0deg) -> 100%: green(120deg)
    const hue = Math.round(ratio * 120);
    return `hsl(${hue} 78% 58%)`;
  }

  const resolvedModelName =
    model === "latest" ? basename(latestByType[modelType] || latestAny) || "該当モデルなし" : model;

  return (
    <div className="space-y-4">
      <Card title="評価" subtitle="精度を定量評価します">
        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="app-label">データセット</label>
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
              className="app-select"
              disabled={normalizedDatasetOptions.length === 0}
            >
              {normalizedDatasetOptions.length === 0 ? (
                <option value="">評価可能データなし</option>
              ) : (
                normalizedDatasetOptions.map((item) => (
                  <option key={item} value={item}>
                    {datasetLabel(item)}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="app-label">モデル</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="app-select">
              <option value="latest">最新</option>
              {models.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="app-label">最新選択時の種別</label>
            <select
              value={modelType}
              onChange={(e) => setModelType(e.target.value)}
              className="app-select"
              disabled={model !== "latest"}
            >
              {modelTypes.length === 0 ? (
                <option value={modelType}>{modelType || "既定"}</option>
              ) : (
                modelTypes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={useOverrides}
                onChange={(e) => setUseOverrides(e.target.checked)}
              />
              前処理設定を適用
            </label>
          </div>
          <div className="flex items-end justify-end">
            <Button onClick={onEvaluate} disabled={loading || normalizedDatasetOptions.length === 0}>
              {loading ? "評価中..." : "評価実行"}
            </Button>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-border bg-card/45 p-2 text-xs text-muted">
          評価に使用されるモデル: <span className="font-semibold text-text">{resolvedModelName}</span>
        </div>
        {normalizedDatasetOptions.length === 0 ? (
          <p className="mt-2 text-xs text-amber-200">
            評価対象データがありません。ラベル保存後に「データセット作成」を実行してください。
          </p>
        ) : null}
      </Card>

      <div className="rounded-lg border border-border bg-card/60 backdrop-blur-md p-3">
        <label className="app-label">このプロジェクトの前処理設定（コピー用）</label>
        <input
          className="app-input font-mono text-xs"
          readOnly
          value={preprocessConfigLine || "評価実行後に表示されます。"}
          onFocus={(e) => e.target.select()}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          label="正解率"
          value={`${(Number(result?.accuracy || 0) * 100).toFixed(2)}%`}
          subValue={`モデル: ${result?.model_name || "-"}`}
        />
        <MetricCard label="正解数 / 総数" value={`${result?.correct ?? 0} / ${result?.total ?? 0}`} />
        <MetricCard
          label="データセット"
          value={datasetLabel(result?.dataset)}
          subValue={`プロジェクト: ${result?.project_id || "-"}`}
        />
      </div>

      <div className="grid grid-cols-[1.2fr_1fr] gap-4">
        <Card title="混同行列" subtitle="クラス間の誤分類を確認">
          {result?.confusion_matrix_data_url ? (
            <img
              src={result.confusion_matrix_data_url}
              alt="混同行列"
              className="w-full rounded-lg border border-border bg-card/60 backdrop-blur-md"
            />
          ) : (
            <div className="rounded-lg border border-border bg-card/60 backdrop-blur-md p-8 text-center text-muted">
              評価後に表示されます。
            </div>
          )}
        </Card>

        <Card title="クラス別正解率" subtitle="クラスごとの精度">
          <div className="max-h-[360px] overflow-auto pr-1">
            {Object.entries(result?.per_class_accuracy || {}).length === 0 ? (
              <p className="text-sm text-muted">データがありません。</p>
            ) : (
              Object.entries(result.per_class_accuracy).map(([label, acc]) => (
                <div key={label} className="mb-2 rounded-lg border border-border bg-card/60 backdrop-blur-md px-3 py-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text">{label}</span>
                    <span style={{ color: accuracyColor(acc) }}>{(Number(acc) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card
        title="認識一覧"
        subtitle="フィルタで絞り込み"
        actions={
          evaluationSummaryText ? (
            <span className="text-sm font-semibold text-emerald-300">{evaluationSummaryText}</span>
          ) : null
        }
      >
        <div className="mb-3 grid grid-cols-3 gap-3">
          <div>
            <label className="app-label">特定クラス</label>
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="app-select">
              <option value="">すべて</option>
              {classOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <label className="inline-flex items-end gap-2 text-sm text-text pb-2">
            <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
            誤認識のみ
          </label>
          <div className="flex items-end justify-end text-sm text-muted">表示件数: {rows.length}</div>
        </div>

        <div className="max-h-[520px] overflow-auto pr-1">
          <div className="grid grid-cols-3 gap-3">
            {rows.map((row, idx) => (
              <div key={`${row.image}-${idx}`} className="rounded-lg border border-border bg-card/60 backdrop-blur-md p-3">
                {row.thumbnail_data_url ? (
                  <img
                    src={row.thumbnail_data_url}
                    alt={row.image}
                    className="mb-2 h-28 w-full rounded-md border border-border object-contain"
                  />
                ) : null}
                <p className="truncate text-xs text-muted">{row.image}</p>
                <p className="mt-1 text-sm text-text">
                  正解 <span className="font-semibold">{row.gt}</span> / 予測{" "}
                  <span className={`font-semibold ${row.correct ? "text-success" : "text-danger"}`}>{row.pred}</span>
                </p>
                <p className="text-xs text-muted">信頼度 {(Number(row.confidence || 0) * 100).toFixed(1)}%</p>
              </div>
            ))}
            {rows.length === 0 ? <p className="text-sm text-muted">該当データがありません。</p> : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
