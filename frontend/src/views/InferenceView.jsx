import Card from "../components/Card";
import Button from "../components/Button";

export default function InferenceView({
  engine,
  setEngine,
  easyocrLangs,
  setEasyocrLangs,
  easyocrLanguageOptions,
  modelType,
  setModelType,
  modelTypes,
  model,
  setModel,
  models,
  latestModels,
  onFileChange,
  fileName,
  previewUrl,
  rotation,
  onRotate,
  onRun,
  loading,
  result,
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
    engine !== "custom"
      ? "EasyOCR"
      : model === "latest"
        ? basename(latestByType[modelType] || latestAny) || "該当モデルなし"
        : model;

  return (
    <div className="grid grid-cols-[4fr_6fr] gap-6">
      <Card title="画像アップロード" subtitle="1枚画像を選択して推論します">
        <div className="space-y-4">
          <div>
            <label className="app-label">推論エンジン</label>
            <select value={engine} onChange={(e) => setEngine(e.target.value)} className="app-select">
              <option value="custom">カスタムモデル</option>
              <option value="easyocr">EasyOCR</option>
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
          ) : (
            <div>
              <label className="app-label">EasyOCR 言語</label>
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
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card/60 backdrop-blur-md p-8 text-center">
              <p className="text-xs uppercase tracking-[0.18em] text-muted">予測結果</p>
              <p className="mt-3 text-7xl font-semibold text-text">{result.prediction}</p>
            </div>

            <div>
              <div className="mb-2 flex justify-between text-sm text-muted">
                <span>信頼度</span>
                <span>{(Number(result.confidence || 0) * 100).toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-[#3f4854]/65">
                <div
                  className="h-2 rounded-full bg-accent transition-all duration-200"
                  style={{ width: `${Math.max(4, Number(result.confidence || 0) * 100)}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/60 backdrop-blur-md p-3 text-xs text-muted">
              <p>エンジン: {engineLabel(result.engine || "custom")}</p>
              <p className="truncate">モデル: {result.model_path}</p>
              <p>種別: {result.model_type}</p>
              <p>名前: {result.model_name || "-"}</p>
              {result.engine === "easyocr" ? (
                <p>言語: {(result.easyocr_languages || []).join(", ") || "-"}</p>
              ) : null}
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
