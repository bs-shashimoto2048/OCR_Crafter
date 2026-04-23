import { useEffect, useMemo, useRef, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import { API_BASE } from "../lib/api";

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

function classifyDraftState(value, expectedLength = 8) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return { kind: "invalid" };
  if (!/^[A-Z0-9]+$/.test(normalized)) return { kind: "invalid" };
  if (Number(expectedLength) > 0 && normalized.length !== Number(expectedLength)) {
    return { kind: "incomplete" };
  }
  return { kind: "valid" };
}

function resolveBatchExpectedLength(row) {
  const fromValidation = Number(row?.validation?.max_text_length || 0);
  if (fromValidation > 0) return fromValidation;
  const fromPrediction = String(row?.prediction || "").trim().length;
  if (fromPrediction > 0) return fromPrediction;
  return 8;
}

function resolveBatchValid(row) {
  if (typeof row?.valid === "boolean") return row.valid;
  if (typeof row?.is_valid === "boolean") return row.is_valid;
  const expectedLength = resolveBatchExpectedLength(row);
  return classifyDraftState(row?.corrected ?? row?.prediction ?? "", expectedLength).kind === "valid";
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
    const valid = batchRows.filter((row) => Boolean(row.is_valid)).length;
    return {
      total,
      valid,
      invalid: Math.max(0, total - valid),
    };
  }, [batchRows]);

  const filteredBatchRows = useMemo(() => {
    const keyword = String(batchSearch || "").trim().toLowerCase();
    return batchRows.filter((row) => {
      if (batchFilterInvalid && row.is_valid) return false;
      if (!keyword) return true;
      const text = `${row.file_name || ""} ${row.prediction || ""} ${row.corrected || ""}`.toLowerCase();
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

      const formData = new FormData();
      for (const f of files) {
        formData.append("files", f);
      }
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

      const response = await fetch(`${API_BASE}/api/ocr/predict/batch`, { method: "POST", body: formData });
      if (!response.ok) {
        const message = parseApiErrorText(await response.text(), "バッチ推論に失敗しました");
        throw new Error(normalizePredictError(message));
      }

      const data = await response.json();
      const rows = (data.items || []).map((row, idx) => {
        const corrected = toHalfWidthAlnum(row.prediction || "");
        const expected_length = resolveBatchExpectedLength(row);
        return {
          ...row,
          corrected,
          expected_length,
          is_valid: resolveBatchValid({ ...row, corrected, expected_length }),
          preview_url: previewUrls[idx] || "",
        };
      });
      setBatchRows(rows);
      setNotice(`バッチ推論完了: ${rows.length}件`);
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
                  <label className="app-label">PaddleOCRモデル</label>
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
              <span className="rounded-full border border-border px-2 py-1 text-muted">総数: {batchSummary.total}</span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                valid: {batchSummary.valid}
              </span>
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-200">
                invalid: {batchSummary.invalid}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="inline-flex items-center gap-2 rounded border border-border px-2 py-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={batchFilterInvalid}
                  onChange={(e) => setBatchFilterInvalid(e.target.checked)}
                />
                invalidのみ表示
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
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card/90 text-left text-xs text-muted backdrop-blur">
                <tr>
                  <th className="px-3 py-2">プレビュー</th>
                  <th className="px-3 py-2">OCR結果</th>
                  <th className="px-3 py-2">画像</th>
                  <th className="px-3 py-2">valid</th>
                  <th className="px-3 py-2">修正</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatchRows.map((row, idx) => {
                  const rowValid = Boolean(row.is_valid);
                  return (
                    <tr key={`${row.file_name}-${idx}`} className={`border-t border-border/70 ${rowValid ? "" : "bg-red-500/5"}`}>
                      <td className="px-3 py-2">
                        {row.preview_url ? (
                          <img
                            src={row.preview_url}
                            alt={row.file_name || `batch-${idx + 1}`}
                            className="h-14 w-24 rounded border border-border/70 bg-card/70 object-contain p-1"
                          />
                        ) : (
                          <span className="text-xs text-muted">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{row.prediction}</td>
                      <td className="px-3 py-2 text-muted">{row.file_name}</td>
                      <td className={`px-3 py-2 ${rowValid ? "text-emerald-300" : "text-red-300"}`}>
                        {rowValid ? "valid" : "invalid"}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="app-input"
                          value={row.corrected}
                          onChange={(e) => {
                            const value = toHalfWidthAlnum(e.target.value);
                            setBatchRows((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      corrected: value,
                                      is_valid: classifyDraftState(value, Number(item.expected_length || 8)).kind === "valid",
                                    }
                                  : item
                              )
                            );
                          }}
                        />
                      </td>
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
        </div>
      </div>
    </Card>
  );
}
