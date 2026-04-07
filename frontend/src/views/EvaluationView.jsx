import { useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";

function MetricCard({ label, value, subValue }) {
  return (
    <div className="rounded-lg border border-border bg-[#333d49] p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-text">{value}</p>
      {subValue ? <p className="mt-1 text-sm text-muted">{subValue}</p> : null}
    </div>
  );
}

export default function EvaluationView({
  dataset,
  setDataset,
  model,
  setModel,
  modelType,
  setModelType,
  modelTypes,
  models,
  useOverrides,
  setUseOverrides,
  loading,
  result,
  onEvaluate,
}) {
  const [onlyErrors, setOnlyErrors] = useState(true);
  const [classFilter, setClassFilter] = useState("");

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

  return (
    <div className="space-y-4">
      <Card title="評価" subtitle="精度を定量評価します">
        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="app-label">データセット</label>
            <select value={dataset} onChange={(e) => setDataset(e.target.value)} className="app-select">
              <option value="val">検証</option>
              <option value="test">テスト</option>
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
            <Button onClick={onEvaluate} disabled={loading}>
              {loading ? "評価中..." : "評価実行"}
            </Button>
          </div>
        </div>
      </Card>

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
              className="w-full rounded-lg border border-border bg-[#333d49]"
            />
          ) : (
            <div className="rounded-lg border border-border bg-[#333d49] p-8 text-center text-muted">
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
                <div key={label} className="mb-2 rounded-lg border border-border bg-[#333d49] px-3 py-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text">{label}</span>
                    <span className="text-muted">{(Number(acc) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card title="誤認識一覧" subtitle="フィルタで絞り込み">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
            誤認識のみ
          </label>
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
          <div className="flex items-end justify-end text-sm text-muted">表示件数: {rows.length}</div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {rows.map((row, idx) => (
            <div key={`${row.image}-${idx}`} className="rounded-lg border border-border bg-[#333d49] p-3">
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
      </Card>
    </div>
  );
}
