import Button from "../components/Button";
import Card from "../components/Card";
import ImagePreview from "../components/ImagePreview";
import PreprocessPanel from "../components/PreprocessPanel";
import ResultBadge from "../components/ResultBadge";
import { imageUrl } from "../lib/api";

export default function PreprocessView({
  projectId,
  imageVersion,
  extraSlots = [],
  onExtraSlotsChange,
  extraPreviews = [],
  returnView,
  onReturn,
  images,
  selectedImage,
  onSelectImage,
  defaultParams,
  predictEngine,
  setPredictEngine,
  predictModel,
  setPredictModel,
  predictPaddleModel,
  setPredictPaddleModel,
  predictTesseractModel,
  setPredictTesseractModel,
  predictModelType,
  setPredictModelType,
  predictEasyOcrLangs,
  setPredictEasyOcrLangs,
  easyocrLanguageOptions,
  modelTypes,
  models,
  paddleModels,
  tesseractModels,
  latestModels,
  params,
  onParamsChange,
  preview,
  loading,
  error,
  presetName,
  setPresetName,
  presets,
  selectedPreset,
  setSelectedPreset,
  onSavePreset,
  onLoadPreset,
}) {
  const latestAny = String(latestModels?.any || "");
  const latestByType = latestModels?.byType || {};
  const engineNames = { custom: "カスタムモデル", easyocr: "EasyOCR", paddleocr: "PaddleOCR", tesseract: "Tesseract" };
  const engineDisplayLabel = engineNames[predictEngine] || predictEngine;

  function updateExtraSlot(index, patch) {
    onExtraSlotsChange?.(extraSlots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }

  function addExtraSlot() {
    if (extraSlots.length >= 2) {
      return;
    }
    onExtraSlotsChange?.([...extraSlots, { engine: "tesseract", model: "eng", langs: "en" }]);
  }

  function removeExtraSlot(index) {
    onExtraSlotsChange?.(extraSlots.filter((_, i) => i !== index));
  }

  // 中央の推論結果欄に渡す比較行（モデル2/3）。失敗・重複はそのスロットだけ表示する
  const comparisonResults = extraSlots.map((slot, i) => {
    const p = extraPreviews?.[i] || {};
    return {
      engine: engineNames[p.engine || slot.engine] || p.engine || slot.engine,
      model: p.modelName || (slot.engine === "easyocr" ? "" : slot.model || ""),
      prediction: p.prediction || "",
      confidence: p.confidence,
      skipped: Boolean(p.duplicate),
      error: p.duplicate ? "同一設定のためスキップ" : p.error || "",
    };
  });

  function basename(path) {
    if (!path) return "";
    const parts = String(path).split("/");
    return parts[parts.length - 1];
  }

  function toggleEasyOcrLang(lang) {
    setPredictEasyOcrLangs((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.includes(lang)) {
        return list.filter((item) => item !== lang);
      }
      return [...list, lang];
    });
  }

  const resolvedModelName =
    predictEngine === "custom"
      ? predictModel === "latest"
        ? basename(latestByType[predictModelType] || latestAny) || "該当モデルなし"
        : predictModel
      : predictEngine === "paddleocr"
        ? predictPaddleModel === "latest"
          ? basename(latestModels?.ocrPaddle || "") || "PaddleOCR既定モデル"
          : predictPaddleModel
        : predictEngine === "tesseract"
          ? predictTesseractModel === "latest"
            ? "Tesseract最新モデル"
            : predictTesseractModel === "eng"
              ? "eng.traineddata（標準英語モデル）"
              : predictTesseractModel
          : "EasyOCR";

  return (
    <div className="grid h-[calc(100vh-238px)] min-h-[440px] grid-cols-[minmax(180px,18fr)_minmax(0,45fr)_minmax(320px,37fr)] gap-3">
      <Card title="画像一覧" subtitle="プレビュー対象を選択" className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {images.map((item) => {
            const active = item.image === selectedImage;
            const thumbSrc = imageUrl(item.image, projectId, imageVersion);
            return (
              <button
                key={item.image}
                onClick={() => onSelectImage(item.image)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                  active
                    ? "border-accent bg-accent/15 text-blue-200"
                    : "border-border bg-card/60 backdrop-blur-md text-muted hover:text-text"
                }`}
              >
                <div className="mb-2 overflow-hidden rounded-md border border-border bg-[#3b444f]/80 p-1">
                  <img src={thumbSrc} alt={item.image} className="h-20 w-full object-contain" loading="lazy" />
                </div>
                <div className="truncate font-medium">{item.image}</div>
                <div className="mt-1 text-[11px] text-muted">種別: {item.type || "--"}</div>
                {active && !loading && preview?.prediction ? (
                  <div className="mt-1 truncate text-[11px] font-semibold text-accent">OCR: {preview.prediction}</div>
                ) : null}
              </button>
            );
          })}
          {images.length === 0 && <div className="text-sm text-muted">画像がありません</div>}
        </div>
      </Card>

      <div className="flex min-h-0 flex-col gap-2">
        <ImagePreview
          title="元画像"
          subtitle={selectedImage || "--"}
          src={selectedImage ? imageUrl(selectedImage, projectId, imageVersion) : ""}
          loading={false}
        />
        <ImagePreview
          title="中間画像"
          subtitle={preview?.type ? `種別: ${preview.type}` : "--"}
          src={preview?.interim_data_url || ""}
          loading={loading}
        />
        <ImagePreview
          title="最終画像"
          subtitle={preview?.ratio !== undefined ? `比率: ${preview.ratio}` : "--"}
          src={preview?.processed_data_url || ""}
          loading={loading}
        />

        <ResultBadge
          loading={loading}
          prediction={preview?.prediction || ""}
          confidence={preview?.confidence}
          modelType={preview?.predict_model_type}
          modelName={preview?.predict_model_name}
          engine={preview?.predict_engine}
          error={error || preview?.predict_error || ""}
          warning={preview?.predict_model_warning || ""}
          comparisons={comparisonResults}
        />

      </div>

      <PreprocessPanel
        inferenceSummary={predictEngine === "easyocr" ? "EasyOCR" : `${engineDisplayLabel} / ${resolvedModelName}`}
        focusInference={Boolean(returnView)}
        inferenceSettings={
          <>
            <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="app-label">エンジン</label>
              <select value={predictEngine} onChange={(e) => setPredictEngine(e.target.value)} className="app-select">
                <option value="custom">カスタムモデル</option>
                <option value="easyocr">EasyOCR</option>
                <option value="paddleocr">PaddleOCR</option>
                <option value="tesseract">Tesseract</option>
              </select>
            </div>
            {predictEngine === "custom" ? (
              <>
                <div>
                  <label className="app-label">モデル</label>
                  <select
                    value={predictModel}
                    onChange={(e) => setPredictModel(e.target.value)}
                    className="app-select"
                  >
                    <option value="latest">最新</option>
                    {models.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                {predictModel === "latest" ? (
                  <div>
                    <label className="app-label">最新選択時のモデル種別</label>
                    <select
                      value={predictModelType}
                      onChange={(e) => setPredictModelType(e.target.value)}
                      className="app-select"
                    >
                      {modelTypes.length === 0 ? (
                        <option value={predictModelType}>{predictModelType || "既定"}</option>
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
                  <p className="col-span-2 text-xs text-amber-200">
                    カスタムモデルがありません。学習完了までは EasyOCR を使ってプレビューできます。
                  </p>
                ) : null}
              </>
            ) : predictEngine === "paddleocr" ? (
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="app-label">PaddleOCRモデル</label>
                  <select
                    value={predictPaddleModel}
                    onChange={(e) => setPredictPaddleModel(e.target.value)}
                    className="app-select"
                  >
                    <option value="latest">最新</option>
                    {paddleModels.map((name) => (
                      <option key={name} value={name}>
                        {name}
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
                          checked={Array.isArray(predictEasyOcrLangs) ? predictEasyOcrLangs.includes(lang) : false}
                          onChange={() => toggleEasyOcrLang(lang)}
                        />
                        {lang}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ) : predictEngine === "tesseract" ? (
              <div className="col-span-2 space-y-2">
                <div>
                  <label className="app-label">Tesseractモデル</label>
                  <select
                    value={predictTesseractModel}
                    onChange={(e) => setPredictTesseractModel(e.target.value)}
                    className="app-select"
                  >
                    <option value="latest">最新（学習済み）</option>
                    <option value="eng">eng.traineddata（標準英語モデル）</option>
                    {(tesseractModels || []).map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted">
                  eng.traineddata は Tesseract 標準の英語モデル（学習前ベースライン）です。推論時 whitelist は
                  実運用で出現する文字に合わせて設定します（既定: A-Z + 0-9 + k,l,t）・単一行想定（--psm 7）。
                </p>
                <p className="text-xs text-muted">
                  推論には Tesseract 本体のインストールが必要です（学習には lstmtraining / combine_tessdata
                  なども必要）。導入手順は docs/11_TESSERACT_CHECKLIST.md を参照してください。
                </p>
                {(tesseractModels || []).length === 0 ? (
                  <p className="text-xs text-amber-200">
                    学習済みTesseractモデルがありません。eng.traineddata（標準英語モデル）を選択するか、学習画面で
                    Tesseract学習を完了してください。
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="col-span-2">
                <label className="app-label">{predictEngine === "paddleocr" ? "PaddleOCR 言語" : "EasyOCR 言語"}</label>
                <div className="grid grid-cols-6 gap-2 rounded-lg border border-border bg-card/60 backdrop-blur-md p-2">
                  {easyocrLanguageOptions.map((lang) => (
                    <label key={lang} className="inline-flex items-center gap-2 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={Array.isArray(predictEasyOcrLangs) ? predictEasyOcrLangs.includes(lang) : false}
                        onChange={() => toggleEasyOcrLang(lang)}
                      />
                      {lang}
                    </label>
                  ))}
                </div>
              </div>
            )}
            </div>
            <div className="mt-3 rounded-lg border border-border bg-card/45 p-2 text-xs text-muted">
              実際に使用される推論先: <span className="font-semibold text-text">{resolvedModelName}</span>
            </div>

            {extraSlots.map((slot, index) => (
              <div key={index} className="mt-3 rounded-lg border border-border bg-card/45 p-2">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-text">比較モデル{index + 2}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-danger"
                    onClick={() => removeExtraSlot(index)}
                    title={`比較モデル${index + 2}を削除します`}
                  >
                    削除
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="app-label">エンジン</label>
                    <select
                      value={slot.engine}
                      onChange={(e) =>
                        updateExtraSlot(index, {
                          engine: e.target.value,
                          model: e.target.value === "tesseract" ? "eng" : "latest",
                        })
                      }
                      className="app-select"
                    >
                      <option value="tesseract">Tesseract</option>
                      <option value="paddleocr">PaddleOCR</option>
                      <option value="easyocr">EasyOCR</option>
                    </select>
                  </div>
                  {slot.engine === "tesseract" ? (
                    <div>
                      <label className="app-label">モデル</label>
                      <select
                        value={slot.model || "eng"}
                        onChange={(e) => updateExtraSlot(index, { model: e.target.value })}
                        className="app-select"
                      >
                        <option value="latest">最新（学習済み）</option>
                        <option value="eng">eng.traineddata</option>
                        {(tesseractModels || []).map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : slot.engine === "paddleocr" ? (
                    <div>
                      <label className="app-label">モデル</label>
                      <select
                        value={slot.model || "latest"}
                        onChange={(e) => updateExtraSlot(index, { model: e.target.value })}
                        className="app-select"
                      >
                        <option value="latest">最新</option>
                        {paddleModels.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="app-label">言語（カンマ区切り）</label>
                      <input
                        value={slot.langs || "en"}
                        onChange={(e) => updateExtraSlot(index, { langs: e.target.value })}
                        className="app-input"
                        placeholder="en"
                      />
                    </div>
                  )}
                </div>
                {extraPreviews?.[index]?.duplicate ? (
                  <p className="mt-1.5 text-[11px] text-amber-200">
                    他のスロットと同一設定のため推論をスキップしました
                  </p>
                ) : null}
              </div>
            ))}
            {extraSlots.length < 2 ? (
              <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={addExtraSlot}>
                比較モデルを追加（最大3つ）
              </Button>
            ) : null}
          </>
        }
        headerAction={
          returnView ? (
            <Button size="sm" variant="secondary" onClick={() => onReturn?.()} title="元の画面へ戻ります">
              {returnView === "rapid-ocr" ? "× OCR修正へ戻る" : "× ラベル編集へ戻る"}
            </Button>
          ) : null
        }
        params={params}
        defaultParams={defaultParams}
        onParamsChange={onParamsChange}
        presetName={presetName}
        setPresetName={setPresetName}
        presets={presets}
        selectedPreset={selectedPreset}
        setSelectedPreset={setSelectedPreset}
        onSavePreset={onSavePreset}
        onLoadPreset={onLoadPreset}
      />
    </div>
  );
}
