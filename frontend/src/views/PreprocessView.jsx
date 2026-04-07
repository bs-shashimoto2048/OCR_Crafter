import Card from "../components/Card";
import ImagePreview from "../components/ImagePreview";
import PreprocessPanel from "../components/PreprocessPanel";
import ResultBadge from "../components/ResultBadge";
import { imageUrl } from "../lib/api";

export default function PreprocessView({
  projectId,
  imageVersion,
  images,
  selectedImage,
  onSelectImage,
  defaultParams,
  predictEngine,
  setPredictEngine,
  predictModel,
  setPredictModel,
  predictModelType,
  setPredictModelType,
  predictEasyOcrLangs,
  setPredictEasyOcrLangs,
  easyocrLanguageOptions,
  modelTypes,
  models,
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
  function toggleEasyOcrLang(lang) {
    setPredictEasyOcrLangs((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.includes(lang)) {
        return list.filter((item) => item !== lang);
      }
      return [...list, lang];
    });
  }

  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)_360px] gap-4">
      <Card title="画像一覧" subtitle="プレビュー対象を選択">
        <div className="space-y-2 max-h-[72vh] overflow-auto pr-1">
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
                    : "border-border bg-[#333d49] text-muted hover:text-text"
                }`}
              >
                <div className="mb-2 overflow-hidden rounded-md border border-border bg-[#3a4450] p-1">
                  <img src={thumbSrc} alt={item.image} className="h-20 w-full object-contain" loading="lazy" />
                </div>
                <div className="truncate font-medium">{item.image}</div>
                <div className="mt-1 text-[11px] text-muted">種別: {item.type || "--"}</div>
              </button>
            );
          })}
          {images.length === 0 && <div className="text-sm text-muted">画像がありません</div>}
        </div>
      </Card>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
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
        </div>

        <ResultBadge
          loading={loading}
          prediction={preview?.prediction || ""}
          confidence={preview?.confidence}
          modelType={preview?.predict_model_type}
          modelName={preview?.predict_model_name}
          engine={preview?.predict_engine}
          error={error || preview?.predict_error || ""}
        />

        <Card title="推論テスト設定" subtitle="前処理プレビューの推論エンジン設定">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="app-label">エンジン</label>
              <select value={predictEngine} onChange={(e) => setPredictEngine(e.target.value)} className="app-select">
                <option value="custom">カスタムモデル</option>
                <option value="easyocr">EasyOCR</option>
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
              </>
            ) : (
              <div className="col-span-2">
                <label className="app-label">EasyOCR 言語</label>
                <div className="grid grid-cols-6 gap-2 rounded-lg border border-border bg-[#333d49] p-2">
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
        </Card>
      </div>

      <PreprocessPanel
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
