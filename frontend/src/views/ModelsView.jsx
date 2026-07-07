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

export default function ModelsView({ projectId = "default", models, modelInfos, latest, onRefresh, onDeleteSelected }) {
  const latestAny = basename(latest.any || "");
  const latestByType = latest.byType || {};
  const latestNames = new Set(Object.values(latestByType).map((path) => basename(path)).filter(Boolean));
  const [selectedModels, setSelectedModels] = useState([]);
  const [downloadingModelName, setDownloadingModelName] = useState("");
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

  // OCR認識モデル（PaddleOCR: training_family=ocr / Tesseract: training_family=tesseract）
  function isOcrFamily(name) {
    return ["ocr", "tesseract"].includes(trainingFamily(name));
  }

  function engineName(name) {
    return modelInfos?.[name]?.engine || "custom";
  }

  function createdAt(name) {
    return modelInfos?.[name]?.created_at || modelInfos?.[name]?.modified_at || "";
  }

  const allOcr = useMemo(
    () => models.length > 0 && models.every((name) => isOcrFamily(name)),
    [models, modelInfos]
  );

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

  function ocrPreprocessText(name) {
    const info = modelInfos?.[name] || {};
    const preprocess = info?.ocr_preprocess || {};
    const shape = Array.isArray(preprocess.image_shape) && preprocess.image_shape.length > 0
      ? preprocess.image_shape.join(",")
      : Array.isArray(info.image_shape) && info.image_shape.length > 0
        ? info.image_shape.join(",")
        : "-";
    const charset = String(preprocess.charset || info.charset || "").trim() || "-";
    const maxTextLength = Number(preprocess.max_text_length || info.max_text_length || 0);
    const imageTypes = Array.isArray(preprocess.image_types) && preprocess.image_types.length > 0
      ? preprocess.image_types.join(",")
      : "-";
    return `shape=${shape}, charset=${charset}, max_len=${maxTextLength > 0 ? maxTextLength : "-"}, types=${imageTypes}`;
  }

  function ocrTrainingText(name) {
    const params = modelInfos?.[name]?.ocr_training_params || {};
    const epochs = Number(params.epochs || 0);
    const batchSize = Number(params.batch_size || 0);
    const lr = Number(params.learning_rate || 0);
    const lrText = Number.isFinite(lr) && lr > 0 ? lr : "-";
    return `epochs=${epochs > 0 ? epochs : "-"}, batch=${batchSize > 0 ? batchSize : "-"}, lr=${lrText}`;
  }

  function ocrAugText(name) {
    const aug = modelInfos?.[name]?.ocr_augmentation || {};
    if (aug?.enabled === null || aug?.enabled === undefined) {
      return "aug=-";
    }
    const enabled = Boolean(aug.enabled);
    const strength = Number(aug.strength || 0);
    return `aug=${enabled ? "ON" : "OFF"}, strength=${strength > 0 ? strength : "-"}`;
  }

  function ocrDataText(name) {
    const counts = modelInfos?.[name]?.ocr_dataset_counts || {};
    const train = Number(counts.train || 0);
    const val = Number(counts.val || 0);
    const test = Number(counts.test || 0);
    const total = Number(counts.total || 0);
    if (train > 0 || val > 0 || test > 0) {
      return `data=${train}/${val}/${test}`;
    }
    if (total > 0) {
      return `data=total ${total}`;
    }
    return "data=-";
  }

  function ocrExportText(name) {
    const ready = Boolean(modelInfos?.[name]?.ocr_inference_ready);
    return `export=${ready ? "ready" : "not_ready"}`;
  }

  function tesseractDetailLines(name) {
    const info = modelInfos?.[name] || {};
    const params = info.ocr_training_params || {};
    const counts = info.dataset_split_counts || {};
    const maxIter = Number(params.max_iterations || 0);
    // 旧a-z学習モデルも .tess.json の meta.charset をそのまま表示（継承）
    const charset = String(info.charset || "").trim() || "-";
    const train = Number(counts.train || 0);
    const val = Number(counts.val || 0);
    return [
      `traineddata=${info.traineddata_path || "-"}`,
      `charset=${charset}`,
      `base=${info.base_lang || "-"}, max_iter=${maxIter > 0 ? maxIter : "-"}, data=${train}/${val} | ${ocrExportText(name)}`,
    ];
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
      const message = parseApiErrorText(error?.message || "");
      window.alert(message);
    } finally {
      setDownloadingModelName("");
    }
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
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <div className="flex min-w-0 items-baseline gap-2 rounded-lg border border-border bg-card/60 px-3 py-1.5 backdrop-blur-md">
          <span className="shrink-0 text-muted">最新（全体）</span>
          <span className="truncate text-text">{latestAny || "-"}</span>
        </div>
        {Object.entries(latestByType).map(([type, value]) => (
          <div key={type} className="flex min-w-0 items-baseline gap-2 rounded-lg border border-border bg-card/60 px-3 py-1.5 backdrop-blur-md">
            <span className="shrink-0 text-muted">最新 {type}</span>
            <span className="truncate text-text">{basename(value) || "-"}</span>
          </div>
        ))}
      </div>

      <div className="max-h-[calc(100vh-230px)] overflow-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-[#2f3841]/95 backdrop-blur">
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
            <th className="px-2 py-3 font-medium">{allOcr ? "前処理 / 学習 / Aug / データ / Export" : "比率 / 件数(train/val/test)"}</th>
            <th className="px-2 py-3 font-medium">取得</th>
            <th className="px-2 py-3 font-medium">状態</th>
          </tr>
        </thead>
        <tbody>
          {models.map((name) => {
            const isLatest = latestNames.has(name);
            const checked = selectedModels.includes(name);
            const ratio = ratioText(name);
            const counts = countText(name);
            const isOcr = isOcrFamily(name);
            const isTesseract = engineName(name) === "tesseract";
            const exportReady = Boolean(modelInfos?.[name]?.ocr_inference_ready);
            const canDownload = !isOcr || exportReady;
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
                  {isTesseract ? (
                    <div className="flex flex-col gap-1">
                      {tesseractDetailLines(name).map((line, lineIdx) => (
                        <span key={lineIdx} className="break-all">
                          {line}
                        </span>
                      ))}
                    </div>
                  ) : isOcr ? (
                    <div className="flex flex-col gap-1">
                      <span>{ocrPreprocessText(name)}</span>
                      <span>{ocrTrainingText(name)}</span>
                      <span>
                        {ocrAugText(name)} | {ocrDataText(name)} | {ocrExportText(name)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span>{ratio}</span>
                      <span className="text-text">|</span>
                      <span>{counts === "-" ? "-" : `${counts} 件`}</span>
                    </div>
                  )}
                </td>
                <td className="px-2 py-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canDownload || downloadingModelName === name}
                    onClick={() => handleDownload(name)}
                    title={!canDownload ? "推論用export後にダウンロード可能です" : "モデルをダウンロード"}
                  >
                    {downloadingModelName === name ? "取得中..." : "DL"}
                  </Button>
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
      </div>
    </Card>
  );
}
