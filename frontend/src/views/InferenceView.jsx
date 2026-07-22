import Card from "../components/Card";
import Button from "../components/Button";
import CharHeatmap from "../components/CharHeatmap";
import LowercaseToggle from "../components/LowercaseToggle";

export default function InferenceView({
  engine,
  setEngine,
  easyocrLangs,
  setEasyocrLangs,
  easyocrLanguageOptions,
  includeLowercase,
  setIncludeLowercase,
  modelType,
  setModelType,
  modelTypes,
  model,
  setModel,
  models,
  paddleModel,
  setPaddleModel,
  paddleModels,
  tesseractModel,
  setTesseractModel,
  tesseractModels,
  latestModels,
  onFileChange,
  fileName,
  previewUrl,
  rotation,
  onRotate,
  onRun,
  loading,
  result,
  preprocessMode = "",
  setPreprocessMode,
  effectivePreprocessMode = "",
  preprocessRecorded = false,
}) {
  const latestAny = String(latestModels?.any || "");
  const latestByType = latestModels?.byType || {};

  function basename(path) {
    if (!path) return "";
    const parts = String(path).split("/");
    return parts[parts.length - 1];
  }

  function engineLabel(value) {
    if (value === "easyocr") return "EasyOCR";
    if (value === "paddleocr") return "PaddleOCR";
    if (value === "tesseract") return "Tesseract";
    return "カスタムモデル";
  }

  function toggleEasyOcrLang(lang) {
    setEasyocrLangs((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.includes(lang)) {
        return list.filter((item) => item !== lang);
      }
      return [...list, lang];
    });
  }

  const resolvedModelName =
    engine === "custom"
      ? model === "latest"
        ? basename(latestByType[modelType] || latestAny) || "該当モデルなし"
        : model
      : engine === "paddleocr"
        ? paddleModel === "latest"
          ? basename(latestModels?.ocrPaddle || "") || "PaddleOCR既定モデル"
          : paddleModel
        : engine === "tesseract"
          ? tesseractModel === "latest"
            ? "Tesseract最新モデル"
            : tesseractModel
          : "EasyOCR";
  // null=取得不能（whitelist指定時のTesseract等）。0%へ偽装せず "--" 表示にする
  const confidenceAvailable = typeof result?.confidence === "number" && Number.isFinite(result.confidence);
  const confidenceValue = confidenceAvailable ? result.confidence : 0;
  const confidencePercentLabel = confidenceAvailable ? `${(confidenceValue * 100).toFixed(1)}%` : "--";
  const isLowConfidence = confidenceAvailable && confidenceValue < 0.9;
  const isValid = result ? Boolean(result.valid ?? true) : true;
  const validationReason = result?.validation?.reason || null;
  const resultText = String(result?.text ?? result?.prediction ?? "");
  const heatScores = Array.isArray(result?.char_confidence_normalized)
    ? result?.char_confidence_normalized
    : result?.char_scores;

  return (
    <div className="grid grid-cols-[4fr_6fr] gap-4">
      <Card title="画像アップロード" subtitle="1枚画像を選択して推論します">
        <div className="space-y-3">
          <div>
            <label className="app-label">推論エンジン</label>
            <select value={engine} onChange={(e) => setEngine(e.target.value)} className="app-select">
              <option value="custom">カスタムモデル</option>
              <option value="easyocr">EasyOCR</option>
              <option value="paddleocr">PaddleOCR</option>
              <option value="tesseract">Tesseract</option>
            </select>
          </div>

          {engine === "custom" ? (
            <>
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

              {model === "latest" ? (
                <div>
                  <label className="app-label">最新選択時のモデル種別</label>
                  <select
                    value={modelType}
                    onChange={(e) => setModelType(e.target.value)}
                    className="app-select"
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
              ) : null}
              {models.length === 0 ? (
                <p className="text-xs text-amber-200">
                  カスタムモデルがありません。学習画面で学習完了後に推論できます。
                </p>
              ) : null}
            </>
          ) : engine === "paddleocr" ? (
            <>
              <div>
                <label className="app-label">PaddleOCRモデル</label>
                <select
                  value={paddleModel}
                  onChange={(e) => setPaddleModel(e.target.value)}
                  className="app-select"
                >
                  <option value="latest">最新</option>
                  {paddleModels.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="app-label">PaddleOCR 言語</label>
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card/60 backdrop-blur-md p-2">
                  {easyocrLanguageOptions.map((lang) => (
                    <label key={lang} className="inline-flex items-center gap-2 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={Array.isArray(easyocrLangs) ? easyocrLangs.includes(lang) : false}
                        onChange={() => toggleEasyOcrLang(lang)}
                      />
                      {lang}
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : engine === "tesseract" ? (
            <>
              <div>
                <label className="app-label">Tesseractモデル</label>
                <select
                  value={tesseractModel}
                  onChange={(e) => setTesseractModel(e.target.value)}
                  className="app-select"
                >
                  <option value="latest">最新</option>
                  {(tesseractModels || []).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              {(tesseractModels || []).length === 0 ? (
                <p className="text-xs text-amber-200">
                  学習済みTesseractモデルがありません。学習画面でTesseract学習を完了後に推論できます。
                </p>
              ) : null}
              {/* 推論前処理（既定=モデルの学習時前処理。学習条件と異なる入力を与えないため） */}
              <div>
                <label className="app-label">推論前処理</label>
                <select
                  value={preprocessMode || (preprocessRecorded ? "training" : "none")}
                  onChange={(e) => setPreprocessMode?.(e.target.value)}
                  className="app-select"
                >
                  <option value="training">モデルの学習時前処理（推奨）</option>
                  <option value="manual">手動設定（現在の前処理設定を適用）</option>
                  <option value="none">なし（OCR入力整形のみ）</option>
                </select>
                {!preprocessRecorded && (preprocessMode || "training") === "training" ? (
                  <p className="mt-1 text-xs text-amber-200">
                    このモデルには学習時前処理の記録がありません。手動設定または「なし」を選択してください。
                  </p>
                ) : null}
                {effectivePreprocessMode === "training" ? (
                  <p className="mt-1 text-xs text-muted">学習時と同じ前処理を適用してから推論します。</p>
                ) : null}
              </div>
            </>
          ) : (
            <div>
              <label className="app-label">{engine === "paddleocr" ? "PaddleOCR 言語" : "EasyOCR 言語"}</label>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card/60 backdrop-blur-md p-2">
                {easyocrLanguageOptions.map((lang) => (
                  <label key={lang} className="inline-flex items-center gap-2 text-xs text-text">
                    <input
                      type="checkbox"
                      checked={Array.isArray(easyocrLangs) ? easyocrLangs.includes(lang) : false}
                      onChange={() => toggleEasyOcrLang(lang)}
                    />
                    {lang}
                  </label>
                ))}
              </div>
            </div>
          )}

          <LowercaseToggle
            className="rounded-lg border border-border bg-card/45 p-2"
            engine={engine}
            langs={easyocrLangs}
            value={includeLowercase}
            onChange={setIncludeLowercase}
          />

          <div className="rounded-lg border border-border bg-card/45 p-2 text-xs text-muted">
            実際に使用される推論先: <span className="font-semibold text-text">{resolvedModelName}</span>
          </div>

          <div>
            <label className="app-label">画像</label>
            <input type="file" accept="image/*" onChange={onFileChange} className="block w-full text-sm text-muted" />
          </div>

          {previewUrl ? (
            <img
              src={previewUrl}
              alt="preview"
              className="h-56 w-full rounded-lg border border-border object-contain"
              style={{ transform: `rotate(${Number(rotation || 0)}deg)` }}
            />
          ) : null}

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onRotate} disabled={!fileName || loading}>
              90°回転
            </Button>
            <span className="text-xs text-muted">現在: {Number(rotation || 0)}°</span>
          </div>

          <Button onClick={onRun} disabled={!fileName || loading}>
            {loading ? "推論中..." : "推論実行"}
          </Button>
        </div>
      </Card>

      <Card title="推論結果" subtitle="推論結果を大きく表示します">
        {result ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card/60 backdrop-blur-md p-8 text-center">
              <p className="text-xs uppercase tracking-[0.18em] text-muted">予測結果</p>
              <p className="mt-3 text-7xl font-semibold tracking-[0.08em] text-text">{resultText}</p>
              <div className="mt-3 flex justify-center">
                <CharHeatmap text={resultText} scores={heatScores} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-1 font-semibold ${
                    isValid ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                  }`}
                >
                  {isValid ? "valid" : "invalid"}
                </span>
                <span
                  className={`rounded-full px-2 py-1 font-semibold ${
                    isLowConfidence ? "bg-amber-500/20 text-amber-300" : "bg-sky-500/20 text-sky-300"
                  }`}
                >
                  信頼度 {confidencePercentLabel}
                </span>
              </div>
            </div>

            <div>
              <div className="mb-2 flex justify-between text-sm text-muted">
                <span>信頼度</span>
                <span>{confidencePercentLabel}</span>
              </div>
              <div className="h-2 rounded-full bg-[#3f4854]/65">
                <div
                  className={`h-2 rounded-full transition-all duration-200 ${isLowConfidence ? "bg-amber-400" : "bg-accent"}`}
                  style={{ width: `${confidenceAvailable ? Math.max(4, confidenceValue * 100) : 0}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/60 backdrop-blur-md p-3 text-xs text-muted">
              <p>エンジン: {engineLabel(result.engine || "custom")}</p>
              <p className="truncate">モデル: {result.model_path}</p>
              <p>種別: {result.model_type}</p>
              <p>名前: {result.model_name || "-"}</p>
              {result.engine === "easyocr" || result.engine === "paddleocr" ? (
                <p>言語: {(result.easyocr_languages || result.paddleocr_languages || []).join(", ") || "-"}</p>
              ) : null}
              {result.validation ? <p>検証結果: {isValid ? "正常" : "要確認"}</p> : null}
              {validationReason ? <p>検証理由: {validationReason}</p> : null}
              {result.inference_preprocess ? (
                <p>
                  推論前処理:{" "}
                  {result.inference_preprocess.mode === "training"
                    ? `学習時前処理（${String(result.inference_preprocess.preprocess_hash || "").slice(7, 15) || "-"}）`
                    : result.inference_preprocess.mode === "manual"
                      ? "手動設定（現在の前処理設定）"
                      : "なし（OCR入力整形のみ）"}
                </p>
              ) : null}
              {result.retry_performed ? <p>再OCR: 実行 ({result.retry_used ? "再OCR結果を採用" : "初回結果を採用"})</p> : null}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card/60 backdrop-blur-md p-8 text-center text-muted">
            推論結果はここに表示されます。
          </div>
        )}
      </Card>
    </div>
  );
}
