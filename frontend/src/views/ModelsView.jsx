import { useEffect, useMemo, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";

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

export default function ModelsView({ models, modelInfos, latest, onRefresh, onDeleteSelected }) {
  const latestAny = basename(latest.any || "");
  const latestByType = latest.byType || {};
  const latestNames = new Set(Object.values(latestByType).map((path) => basename(path)).filter(Boolean));
  const [selectedModels, setSelectedModels] = useState([]);
  if (latestAny) {
    latestNames.add(latestAny);
  }

  useEffect(() => {
    setSelectedModels((prev) => prev.filter((name) => models.includes(name)));
  }, [models]);

  const allSelected = useMemo(
    () => models.length > 0 && selectedModels.length === models.length,
    [models, selectedModels]
  );

  function toggleAll(checked) {
    if (checked) {
      setSelectedModels([...models]);
      return;
    }
    setSelectedModels([]);
  }

  function toggleOne(name, checked) {
    setSelectedModels((prev) => {
      if (checked) {
        if (prev.includes(name)) {
          return prev;
        }
        return [...prev, name];
      }
      return prev.filter((item) => item !== name);
    });
  }

  async function handleDeleteSelected() {
    if (selectedModels.length === 0) {
      return;
    }
    const previewList = selectedModels.slice(0, 3).join(", ");
    const hasMore = selectedModels.length > 3 ? ` ほか${selectedModels.length - 3}件` : "";
    const ok = window.confirm(
      `選択した ${selectedModels.length} 件のモデルを削除します。\n対象: ${previewList}${hasMore}\nこの操作は取り消せません。続行しますか？`
    );
    if (!ok) {
      return;
    }
    const typed = window.prompt("確認のため DELETE と入力してください。", "");
    if (typed !== "DELETE") {
      return;
    }
    await onDeleteSelected(selectedModels);
    setSelectedModels([]);
  }

  function modelTypeFromName(name) {
    const infoType = modelInfos?.[name]?.model_type;
    if (infoType) {
      return infoType;
    }
    const stem = name.replace(/\.pt$/i, "");
    const idx = stem.indexOf("_");
    if (idx <= 0) return "不明";
    return stem.slice(0, idx);
  }

  function trainingFamily(name) {
    return modelInfos?.[name]?.training_family || "classification";
  }

  function engineName(name) {
    return modelInfos?.[name]?.engine || "custom";
  }

  function createdAt(name) {
    return modelInfos?.[name]?.created_at || modelInfos?.[name]?.modified_at || "";
  }

  function ratioText(name) {
    const ratio = modelInfos?.[name]?.dataset_split_ratio;
    if (!ratio) {
      return "-";
    }
    const tr = Number(ratio.train || 0);
    const vr = Number(ratio.val || 0);
    const ter = Number(ratio.test || 0);
    if (tr <= 0 && vr <= 0 && ter <= 0) {
      return "-";
    }
    const formatRatio = (value) => {
      const num = Number(value || 0);
      if (!Number.isFinite(num)) return "0";
      return num.toFixed(4).replace(/\.?0+$/, "");
    };
    return `${formatRatio(tr)} / ${formatRatio(vr)} / ${formatRatio(ter)}`;
  }

  function countText(name) {
    const counts = modelInfos?.[name]?.dataset_split_counts;
    if (!counts) {
      return "-";
    }
    const train = Number(counts.train || 0);
    const val = Number(counts.val || 0);
    const test = Number(counts.test || 0);
    if (train <= 0 && val <= 0 && test <= 0) {
      return "-";
    }
    return `${train} / ${val} / ${test}`;
  }

  return (
    <Card
      title="モデル一覧"
      subtitle="最新モデルを優先表示"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="danger"
            onClick={handleDeleteSelected}
            disabled={selectedModels.length === 0}
          >
            選択削除
          </Button>
          <Button variant="secondary" onClick={onRefresh}>
            更新
          </Button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg border border-border bg-card/60 backdrop-blur-md p-3">
          <p className="text-muted">最新（全体）</p>
          <p className="mt-1 truncate text-text">{latestAny || "-"}</p>
        </div>
        {Object.entries(latestByType).map(([type, value]) => (
          <div key={type} className="rounded-lg border border-border bg-card/60 backdrop-blur-md p-3">
            <p className="text-muted">最新 {type}</p>
            <p className="mt-1 truncate text-text">{basename(value) || "-"}</p>
          </div>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="w-10 px-2 py-3 font-medium">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleAll(e.target.checked)}
                aria-label="すべて選択"
              />
            </th>
            <th className="px-2 py-3 font-medium">モデルファイル</th>
            <th className="px-2 py-3 font-medium">種別</th>
            <th className="px-2 py-3 font-medium">方式</th>
            <th className="px-2 py-3 font-medium">エンジン</th>
            <th className="px-2 py-3 font-medium">作成日</th>
            <th className="px-2 py-3 font-medium">比率 / 件数(train/val/test)</th>
            <th className="px-2 py-3 font-medium">状態</th>
          </tr>
        </thead>
        <tbody>
          {models.map((name) => {
            const isLatest = latestNames.has(name);
            const checked = selectedModels.includes(name);
            const ratio = ratioText(name);
            const counts = countText(name);
            return (
              <tr key={name} className="border-b border-border/80 transition hover:bg-[#3b444e]/65">
                <td className="px-2 py-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleOne(name, e.target.checked)}
                    aria-label={`${name} を選択`}
                  />
                </td>
                <td className="px-2 py-3 text-text">{name}</td>
                <td className="px-2 py-3 text-muted">{modelTypeFromName(name)}</td>
                <td className="px-2 py-3 text-muted">{trainingFamily(name)}</td>
                <td className="px-2 py-3 text-muted">{engineName(name)}</td>
                <td className="px-2 py-3 text-muted">{formatDateTime(createdAt(name))}</td>
                <td className="px-2 py-3 text-muted">
                  <div className="flex items-center gap-2">
                    <span>{ratio}</span>
                    <span className="text-text">|</span>
                    <span>{counts === "-" ? "-" : `${counts} 件`}</span>
                  </div>
                </td>
                <td className="px-2 py-3">
                  {isLatest ? (
                    <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-xs text-success">
                      最新
                    </span>
                  ) : (
                    <span className="text-muted">過去モデル</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
