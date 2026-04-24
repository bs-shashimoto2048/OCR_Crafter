import { useEffect, useMemo, useRef, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import { API_BASE } from "../lib/api";
import { PADDLEOCR_OFFICIAL_MODELS_TOOLTIP } from "../lib/paddleocrOfficialTooltip";

const BATCH_TEXT_MIN_LENGTH = 1;
const BATCH_TEXT_MAX_LENGTH = 12;

function parseApiErrorText(text, fallback = "バッチ推論に失敗しました") {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  try {
    const payload = JSON.parse(raw);
    const detail = payload?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) return detail.map((v) => String(v)).join(", ");
  } catch {
    // ignore non-json response
  }
  return raw;
}

function normalizePredictError(message) {
  const text = String(message || "");
  if (text.includes("No model found for type") || text.includes("model not found")) {
    return "カスタムモデルが見つかりません。先にモデル学習を行うか、エンジンをPaddleOCR/EasyOCRに切り替えてください。";
  }
  if (text.includes("invalid preprocess_overrides_json")) {
    return "前処理設定の送信形式が不正です。前処理設定を確認して再実行してください。";
  }
  if (text.includes("not inference-exported")) {
    return "選択したPaddleOCRモデルは推論用にexportされていません。モデル変換（export）を実行してください。";
  }
  if (text.includes("No exported PaddleOCR model found")) {
    return "利用可能なPaddleOCRモデルがありません。学習完了後にexport済みモデルを用意してください。";
  }
  if (text.includes("No available model hosting platforms detected")) {
    return "公式PaddleOCRモデルの取得先に接続できません。ネットワーク接続を確認するか、事前にモデルキャッシュを配置してください。";
  }
  if (text.includes("unsupported image format")) {
    return "サポート外の画像形式です。png/jpg/webp などで再実行してください。";
  }
  return text || "バッチ推論に失敗しました";
}

function toHalfWidthAlnum(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function classifyDraftState(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return { kind: "invalid" };
  if (!/^[A-Z0-9]+$/.test(normalized)) return { kind: "invalid" };
  if (normalized.length < BATCH_TEXT_MIN_LENGTH || normalized.length > BATCH_TEXT_MAX_LENGTH) {
    return { kind: "incomplete" };
  }
  return { kind: "valid" };
}

function resolveBatchExpectedLength(row) {
  const fromPrediction = String(row?.prediction || "").trim().length;
  if (fromPrediction > BATCH_TEXT_MAX_LENGTH) return fromPrediction;
  return BATCH_TEXT_MAX_LENGTH;
}

function resolveBatchValid(row) {
  if (typeof row?.valid === "boolean") return row.valid;
  if (typeof row?.is_valid === "boolean") return row.is_valid;
  return classifyDraftState(row?.corrected ?? row?.prediction ?? "").kind === "valid";
}

function formatConfidencePercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const ratio = num <= 1 ? num : num / 100;
  if (!Number.isFinite(ratio)) return "-";
  return `${Math.max(0, Math.min(100, ratio * 100)).toFixed(1)}%`;
}

function normalizeConfidencePercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const ratio = num <= 1 ? num : num / 100;
  if (!Number.isFinite(ratio)) return null;
  return Math.max(0, Math.min(100, ratio * 100));
}

function confidenceTextClass(value) {
  const score = normalizeConfidencePercent(value);
  if (score == null) return "text-muted";
  if (score > 95) return "text-emerald-300";
  if (score >= 90) return "text-amber-300";
  return "text-red-300";
}

export default function OcrBatchView({
  projectId,
  engine,
  setEngine,
  modelType,
  setModelType,
  modelTypes,
  model,
  setModel,
  models,
  paddleModel,
  setPaddleModel,
  paddleModels,
  easyocrLangs,
  setEasyocrLangs,
  easyocrLanguageOptions,
  preprocessEnabled,
  setPreprocessEnabled,
  preprocessOverrides,
}) {
  const [notice, setNotice] = useState("");
  const [batchFolderName, setBatchFolderName] = useState("");
  const [batchFiles, setBatchFiles] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchRows, setBatchRows] = useState([]);
  const [batchFilterInvalid, setBatchFilterInvalid] = useState(false);
  const [batchSearch, setBatchSearch] = useState("");
  const [langPanelOpen, setLangPanelOpen] = useState(false);
  const previewUrlsRef = useRef([]);
  const folderInputRef = useRef(null);

  const allowedExtensions = useMemo(
    () => new Set([".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp", ".ppm", ".pgm"]),
    []
  );

  function isImageFile(file) {
    const mime = String(file?.type || "").toLowerCase();
    if (mime.startsWith("image/")) return true;
    const name = String(file?.name || "").toLowerCase();
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
    return allowedExtensions.has(ext);
  }

  function relativeName(file) {
    return String(file?.webkitRelativePath || file?.name || "");
  }

  function normalizeFolderFiles(files) {
    return Array.from(files || [])
      .filter(Boolean)
      .filter((file) => isImageFile(file))
      .sort((a, b) => relativeName(a).localeCompare(relativeName(b), "en"));
  }

  function toggleEasyOcrLang(lang) {
    setEasyocrLangs((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.includes(lang)) return list.filter((item) => item !== lang);
      return [...list, lang];
    });
  }

  const batchSummary = useMemo(() => {
    const total = batchRows.length;
    const done = batchRows.filter((row) => row.status === "done").length;
    const valid = batchRows.filter((row) => row.status === "done" && Boolean(row.is_valid)).length;
    const errored = batchRows.filter((row) => row.status === "error").length;
    return {
      total,
      done,
      valid,
      invalid: Math.max(0, done - valid),
      errored,
    };
  }, [batchRows]);

  const filteredBatchRows = useMemo(() => {
    const keyword = String(batchSearch || "").trim().toLowerCase();
    return batchRows.filter((row) => {
      if (batchFilterInvalid) {
        if (row.status === "pending") return false;
        if (row.status === "done" && row.is_valid) return false;
      }
      if (!keyword) return true;
      const text = `${row.file_name || ""} ${row.prediction || ""} ${row.corrected || ""} ${row.error || ""}`.toLowerCase();
      return text.includes(keyword);
    });
  }, [batchRows, batchFilterInvalid, batchSearch]);
  const selectedLangLabel = useMemo(() => {
    const langs = Array.isArray(easyocrLangs) ? easyocrLangs.filter(Boolean) : [];
    return langs.length > 0 ? langs.join(", ") : "-";
  }, [easyocrLangs]);

  async function runBatch(files) {
    if (!projectId || !files || files.length === 0) return;
    setBatchLoading(true);
    try {
      for (const url of previewUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // noop
        }
      }
      previewUrlsRef.current = [];
      const previewUrls = files.map((file) => URL.createObjectURL(file));
      previewUrlsRef.current = previewUrls;

      const initialRows = files.map((file, idx) => ({
        file_name: relativeName(file),
        prediction: "",
        corrected: "",
        expected_length: 8,
        is_valid: false,
        status: "pending",
        error: "",
        preview_url: previewUrls[idx] || "",
        processed_preview_url: "",
      }));
      setBatchRows(initialRows);
      setNotice(`バッチ推論中: 0/${files.length}`);

      let successCount = 0;
      for (let idx = 0; idx < files.length; idx += 1) {
        const file = files[idx];
        const formData = new FormData();
        formData.append("file", file);
        formData.append("project_id", projectId);
        formData.append("engine", engine);
        formData.append("apply_preprocess", preprocessEnabled ? "true" : "false");
        if (preprocessEnabled && preprocessOverrides) {
          formData.append("preprocess_overrides_json", JSON.stringify(preprocessOverrides));
        }
        if (engine === "custom") {
          formData.append("model", model);
          if (model === "latest" && modelType) formData.append("model_type", modelType);
        } else if (engine === "paddleocr") {
          formData.append("model", paddleModel || "latest");
          formData.append("easyocr_langs", (easyocrLangs || []).join(",") || "en");
        } else {
          formData.append("easyocr_langs", (easyocrLangs || []).join(",") || "en");
        }

        try {
          const response = await fetch(`${API_BASE}/predict`, { method: "POST", body: formData });
          if (!response.ok) {
            const message = parseApiErrorText(await response.text(), "バッチ推論に失敗しました");
            throw new Error(normalizePredictError(message));
          }
          const result = await response.json();
          const prediction = toHalfWidthAlnum(result.prediction || result.text || "");
          const corrected = prediction;
          const expected_length = resolveBatchExpectedLength({ ...result, prediction });
          const is_valid = resolveBatchValid({ ...result, prediction, corrected, expected_length });
          setBatchRows((prev) =>
            prev.map((row, i) =>
              i === idx
                ? {
                    ...row,
                    ...result,
                    prediction,
                    corrected,
                    expected_length,
                    is_valid,
                    status: "done",
                    error: "",
                    processed_preview_url: result.preprocess_preview_data_url || "",
                  }
                : row
            )
          );
          successCount += 1;
        } catch (e) {
          const errorText = normalizePredictError(e.message);
          setBatchRows((prev) =>
            prev.map((row, i) =>
              i === idx
                ? {
                    ...row,
                    prediction: "",
                    corrected: "",
                    is_valid: false,
                    status: "error",
                    error: errorText,
                  }
                : row
            )
          );
        }
        setNotice(`バッチ推論中: ${idx + 1}/${files.length}`);
      }

      setNotice(`バッチ推論完了: ${successCount}/${files.length}件成功`);
    } catch (e) {
      setNotice(normalizePredictError(e.message));
    } finally {
      setBatchLoading(false);
    }
  }

  function clearBatch() {
    for (const url of previewUrlsRef.current) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // noop
      }
    }
    previewUrlsRef.current = [];
    setBatchFiles([]);
    setBatchFolderName("");
    setBatchRows([]);
    setBatchSearch("");
    setBatchFilterInvalid(false);
    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  }

  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // noop
        }
      }
      previewUrlsRef.current = [];
    };
  }, []);

  function onDropFiles(event) {
    event.preventDefault();
    const files = normalizeFolderFiles(event.dataTransfer?.files || []);
    if (files.length === 0) return;
    const firstPath = String(files[0]?.webkitRelativePath || "");
    const folderName = firstPath.includes("/") ? firstPath.split("/")[0] : "";
    setBatchFolderName(folderName);
    setBatchFiles(files);
    setNotice(`${files.length}件を読み込みました。バッチ推論実行を押してください。`);
  }

  return (
    <Card title="バッチ推論" subtitle="フォルダ配下の画像を一括推論して結果を確認・修正">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4 space-y-3">
          <div className="rounded-lg border border-border bg-card/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">推論設定</p>
            <div className="mt-2 space-y-2">
              <div>
                <label className="app-label">エンジン</label>
                <select className="app-select" value={engine} onChange={(e) => setEngine(e.target.value)}>
                  <option value="custom">カスタム</option>
                  <option value="easyocr">EasyOCR</option>
                  <option value="paddleocr">PaddleOCR</option>
                </select>
              </div>

              {engine === "custom" ? (
                <div>
                  <label className="app-label">モデル</label>
                  <select className="app-select" value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="latest">最新</option>
                    {models.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              ) : engine === "paddleocr" ? (
                <div>
                  <label className="app-label app-tooltip-label" data-tooltip={PADDLEOCR_OFFICIAL_MODELS_TOOLTIP}>
                    PaddleOCRモデル
                  </label>
                  <select className="app-select" value={paddleModel} onChange={(e) => setPaddleModel(e.target.value)}>
                    <option value="latest">最新</option>
                    {paddleModels.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {engine === "custom" && model === "latest" ? (
                <div>
                  <label className="app-label">モデル種別</label>
                  <select className="app-select" value={modelType} onChange={(e) => setModelType(e.target.value)}>
                    {modelTypes.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {engine !== "custom" ? (
                <div className="rounded-lg border border-border bg-card/50 p-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-semibold text-text hover:bg-card/70"
                    onClick={() => setLangPanelOpen((prev) => !prev)}
                  >
                    <span>
                      言語 (
                      <span className="text-emerald-300">{selectedLangLabel}</span>
                      )
                    </span>
                    <span className="text-sm text-muted" aria-hidden="true">
                      {langPanelOpen ? "▾" : "▸"}
                    </span>
                  </button>
                  {langPanelOpen ? (
                    <div className="mt-2 grid grid-cols-4 gap-2 px-2 text-xs text-text">
                      {easyocrLanguageOptions.map((lang) => (
                        <label key={lang} className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={Array.isArray(easyocrLangs) ? easyocrLangs.includes(lang) : false}
                            onChange={() => toggleEasyOcrLang(lang)}
                          />
                          {lang}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <label className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(preprocessEnabled)}
                  onChange={(e) => setPreprocessEnabled?.(e.target.checked)}
                />
                前処理設定を適用
                <span className="ml-1 text-xs text-muted">※３. 前処理設定の処理を施します。</span>
              </label>
            </div>
          </div>

          <div
            className="rounded-lg border border-dashed border-border bg-card/50 p-4 text-sm text-muted"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropFiles}
          >
            フォルダ選択またはドラッグ&ドロップで画像を読み込み
            <div className="mt-3 space-y-2">
              <input
                ref={folderInputRef}
                type="file"
                multiple
                accept="image/*"
                webkitdirectory=""
                directory=""
                className="hidden"
                disabled={batchLoading}
                onChange={(e) => {
                  const files = normalizeFolderFiles(e.target.files || []);
                  if (files.length === 0) {
                    setBatchFiles([]);
                    setBatchFolderName("");
                    return;
                  }
                  const firstPath = String(files[0]?.webkitRelativePath || "");
                  const folderName = firstPath.includes("/") ? firstPath.split("/")[0] : "";
                  setBatchFolderName(folderName);
                  setBatchFiles(files);
                  setNotice(`${files.length}件を読み込みました。バッチ推論実行を押してください。`);
                }}
              />
              <Button
                variant="secondary"
                onClick={() => folderInputRef.current?.click()}
                disabled={batchLoading}
              >
                フォルダ選択
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card/50 p-3 text-xs text-muted">
            <p>選択フォルダ: {batchFolderName || "-"}</p>
            <p className="mt-1">選択画像: {batchFiles.length}件</p>
            {batchFiles.length > 0 ? (
              <div className="mt-2 max-h-28 space-y-1 overflow-auto pr-1">
                {batchFiles.map((file, idx) => (
                  <p key={`${relativeName(file)}-${idx}`} className="truncate">
                    {idx + 1}. {relativeName(file)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-1">フォルダを選択してください</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runBatch(batchFiles)} disabled={batchLoading || batchFiles.length === 0}>
              {batchLoading ? "バッチ推論実行中..." : "バッチ推論実行"}
            </Button>
            <Button variant="secondary" onClick={clearBatch} disabled={batchLoading && batchRows.length === 0}>
              クリア
            </Button>
          </div>
          {notice ? <p className="text-xs text-muted">{notice}</p> : null}
        </div>

        <div className="col-span-8">
          <div className="mb-2 rounded-lg border border-border bg-card/40 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-border px-2 py-1 text-muted">
                対象画像: {batchSummary.total}件
              </span>
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-accent">
                推論完了: {batchSummary.done}件
              </span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                妥当: {batchSummary.valid}件
              </span>
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-200">
                要確認(条件外): {batchSummary.invalid}件
              </span>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
                推論失敗: {batchSummary.errored}件
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="inline-flex items-center gap-2 rounded border border-border px-2 py-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={batchFilterInvalid}
                  onChange={(e) => setBatchFilterInvalid(e.target.checked)}
                />
                要確認/失敗のみ表示
              </label>
              <input
                className="app-input h-8 text-xs"
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
                placeholder="ファイル名/結果で検索"
              />
            </div>
          </div>

          <div className="h-[600px] overflow-auto rounded-lg border border-border">
            <table className="min-w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[150px]" />
                <col className="w-[150px]" />
                <col className="w-[180px]" />
                <col className="w-[120px]" />
                <col />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-card/90 text-left text-xs text-muted backdrop-blur">
                <tr>
                  <th className="px-2 py-2">サムネ(元画像)</th>
                  <th className="px-2 py-2">サムネ(処理後)</th>
                  <th className="px-2 py-2">OCR結果</th>
                  <th className="px-2 py-2">信頼スコア</th>
                  <th className="px-3 py-2">画像名</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatchRows.map((row, idx) => {
                  const rowStatus = String(row.status || "done");
                  const isPending = rowStatus === "pending";
                  const isHardError = rowStatus === "error";
                  const isInvalid = rowStatus === "done" && !Boolean(row.is_valid);
                  return (
                    <tr
                      key={`${row.file_name}-${idx}`}
                      className={`border-t border-border/70 ${isPending ? "" : isHardError || isInvalid ? "bg-red-500/5" : ""}`}
                    >
                      <td className="px-2 py-2 align-top">
                        {row.preview_url ? (
                          <img
                            src={row.preview_url}
                            alt={row.file_name || `batch-${idx + 1}`}
                            className="h-20 w-32 rounded border border-border/70 bg-card/70 object-contain p-1"
                          />
                        ) : (
                          <span className="text-xs text-muted">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {row.processed_preview_url ? (
                          <img
                            src={row.processed_preview_url}
                            alt={`${row.file_name || `batch-${idx + 1}`}-processed`}
                            className="h-20 w-32 rounded border border-border/70 bg-card/70 object-contain p-1"
                          />
                        ) : (
                          <span className="text-xs text-muted">{isPending ? "処理中..." : "-"}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-middle text-center">
                        {isPending ? (
                          <span className="text-sm text-muted">推論中...</span>
                        ) : isHardError ? (
                          <span className="text-sm text-danger">{row.error || "error"}</span>
                        ) : (
                          <span className="text-base font-bold tracking-wide">{row.prediction}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-middle text-center">
                        {isPending || isHardError ? (
                          <span className="text-sm text-muted">-</span>
                        ) : (
                          <span className={`text-sm font-semibold ${confidenceTextClass(row.confidence)}`}>
                            {formatConfidencePercent(row.confidence)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted break-all">{row.file_name}</td>
                    </tr>
                  );
                })}
                {filteredBatchRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted">
                      {batchRows.length === 0 ? "バッチ結果はここに表示されます" : "条件に一致する結果がありません"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="mt-2 rounded-md border border-border/70 bg-card/45 px-3 py-2 text-xs text-muted">
            <span className="font-semibold text-amber-300">注意:</span>{" "}
            <span className="font-semibold text-cyan-300">信頼スコア</span> は
            「OCRがこの結果らしいと判断した強さ」です。{" "}
            <span className="font-semibold text-red-300">正解率</span> ではありません。
            値が高くても、<span className="font-semibold text-red-300">必ず正解とは限りません</span>。
          </p>
        </div>
      </div>
    </Card>
  );
}
