import Button from "./Button";
import Card from "./Card";

function Section({ title, children }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-[#333d49] p-3">
      <p className="text-sm font-semibold tracking-normal text-blue-300">{title}</p>
      {children}
    </div>
  );
}

export default function PreprocessPanel({
  params,
  defaultParams,
  onParamsChange,
  presetName,
  setPresetName,
  presets,
  selectedPreset,
  setSelectedPreset,
  onSavePreset,
  onLoadPreset,
}) {
  const presetKeys = Object.keys(presets);

  function update(key, value) {
    onParamsChange((prev) => ({ ...prev, [key]: value }));
  }

  function resetAll() {
    if (!defaultParams) {
      return;
    }
    const ok = window.confirm("前処理パラメータをすべてデフォルト値に戻します。よろしいですか？");
    if (!ok) {
      return;
    }
    onParamsChange({ ...defaultParams });
  }

  return (
    <Card
      title="前処理パラメータ"
      subtitle="リアルタイム調整（300msデバウンス）"
      className="preprocess-panel sticky top-24 flex h-[calc(100vh-10rem)] flex-col"
      actions={
        <Button type="button" variant="danger" size="sm" onClick={resetAll}>
          全項目リセット
        </Button>
      }
    >
      <div className="scroll-stable min-h-0 space-y-3 overflow-y-auto pr-1">
        <Section title="分岐設定">
          <label className="app-label">比率しきい値: {params.ratio_threshold.toFixed(2)}</label>
          <p className="param-hint">値を下げると横長判定が増え、上げると単一文字判定が増えます。</p>
          <input
            type="range"
            min="0.8"
            max="4.0"
            step="0.05"
            value={params.ratio_threshold}
            onChange={(e) => update("ratio_threshold", Number(e.target.value))}
            className="w-full"
          />
        </Section>

        <Section title="単一文字設定">
          <label className="app-label">サイズ</label>
          <p className="param-hint">大きいほど細部を残しやすくなりますが、処理コストは増えます。</p>
          <input
            type="number"
            min="16"
            max="256"
            value={params.single_size}
            onChange={(e) => update("single_size", Number(e.target.value))}
            className="app-input"
          />
        </Section>

        <Section title="横長文字設定">
          <label className="app-label">高さ</label>
          <p className="param-hint">高さを上げると文字が見やすくなりますが、ノイズも拾いやすくなります。</p>
          <input
            type="number"
            min="16"
            max="128"
            value={params.wide_height}
            onChange={(e) => update("wide_height", Number(e.target.value))}
            className="app-input"
          />
          <label className="mt-2 inline-flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={params.wide_keep_ratio}
              onChange={(e) => update("wide_keep_ratio", e.target.checked)}
            />
            アスペクト比を維持
          </label>
        </Section>

        <Section title="二値化">
          <label className="app-label">方式</label>
          <p className="param-hint">白黒への分離方法です。固定しきい値は値で文字の太さが変わります。</p>
          <select
            value={params.threshold_type}
            onChange={(e) => update("threshold_type", e.target.value)}
            className="app-select"
          >
            <option value="otsu">大津法</option>
            <option value="binary">固定しきい値</option>
            <option value="adaptive">適応的しきい値</option>
          </select>
          <label className="app-label mt-2">しきい値: {params.threshold_value}</label>
          <input
            type="range"
            min="0"
            max="255"
            step="1"
            value={params.threshold_value}
            onChange={(e) => update("threshold_value", Number(e.target.value))}
            className="w-full"
          />
        </Section>

        <Section title="CLAHE">
          <p className="param-hint">局所コントラストを強調します。強すぎるとザラつきが増えます。</p>
          <label className="app-label">クリップ上限: {params.clahe_clip_limit.toFixed(1)}</label>
          <input
            type="range"
            min="1.0"
            max="8.0"
            step="0.1"
            value={params.clahe_clip_limit}
            onChange={(e) => update("clahe_clip_limit", Number(e.target.value))}
            className="w-full"
          />
          <label className="app-label">タイルサイズ: {params.clahe_tile_grid_size}</label>
          <input
            type="range"
            min="2"
            max="32"
            step="1"
            value={params.clahe_tile_grid_size}
            onChange={(e) => update("clahe_tile_grid_size", Number(e.target.value))}
            className="w-full"
          />
        </Section>

        <Section title="シャープ化">
          <p className="param-hint">輪郭を強調して文字の境界を見やすくします。強すぎるとノイズも強調されます。</p>
          <label className="inline-flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={params.sharpen_enabled}
              onChange={(e) => update("sharpen_enabled", e.target.checked)}
            />
            有効
          </label>
          <label className="app-label mt-2">強さ: {params.sharpen_amount.toFixed(1)}</label>
          <input
            type="range"
            min="0.2"
            max="3.0"
            step="0.1"
            value={params.sharpen_amount}
            onChange={(e) => update("sharpen_amount", Number(e.target.value))}
            className="w-full"
          />

          <label className="app-label mt-2">ぼかし半径: {params.sharpen_sigma.toFixed(1)}</label>
          <input
            type="range"
            min="0.5"
            max="3.0"
            step="0.1"
            value={params.sharpen_sigma}
            onChange={(e) => update("sharpen_sigma", Number(e.target.value))}
            className="w-full"
          />
        </Section>

        <Section title="掠れ補正">
          <p className="param-hint">欠けた線を補う処理です。強すぎると文字が潰れるので少しずつ上げてください。</p>
          <label className="inline-flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={params.stroke_boost_enabled}
              onChange={(e) => update("stroke_boost_enabled", e.target.checked)}
            />
            有効
          </label>
          <label className="app-label mt-2">補正方式</label>
          <select
            value={params.stroke_boost_method}
            onChange={(e) => update("stroke_boost_method", e.target.value)}
            className="app-select"
          >
            <option value="close">欠け埋め</option>
            <option value="dilate">太らせる</option>
            <option value="open">細かなノイズ除去</option>
            <option value="erode">細らせる</option>
          </select>

          <label className="app-label mt-2">カーネルサイズ: {params.stroke_boost_ksize}</label>
          <input
            type="range"
            min="1"
            max="11"
            step="2"
            value={params.stroke_boost_ksize}
            onChange={(e) => update("stroke_boost_ksize", Number(e.target.value))}
            className="w-full"
          />

          <label className="app-label mt-2">反復回数: {params.stroke_boost_iterations}</label>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            value={params.stroke_boost_iterations}
            onChange={(e) => update("stroke_boost_iterations", Number(e.target.value))}
            className="w-full"
          />
        </Section>

        <Section title="ノイズ除去">
          <label className="app-label">方式</label>
          <p className="param-hint">背景ノイズを減らします。強すぎると細い線が消えることがあります。</p>
          <select
            value={params.denoise_method}
            onChange={(e) => update("denoise_method", e.target.value)}
            className="app-select"
          >
            <option value="median">メディアン</option>
            <option value="gaussian">ガウシアン</option>
          </select>
          <label className="app-label mt-2">カーネルサイズ: {params.denoise_ksize}</label>
          <input
            type="range"
            min="1"
            max="11"
            step="2"
            value={params.denoise_ksize}
            onChange={(e) => update("denoise_ksize", Number(e.target.value))}
            className="w-full"
          />
        </Section>

        <Section title="傾き補正">
          <p className="param-hint">斜め画像を水平に補正します。既に水平ならオフのほうが安定する場合があります。</p>
          <label className="inline-flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={params.deskew_enabled}
              onChange={(e) => update("deskew_enabled", e.target.checked)}
            />
            有効
          </label>
        </Section>

        <Section title="プリセット">
          <p className="param-hint">現在の調整値を保存・再利用できます。</p>
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="プリセット名"
            className="app-input"
          />
          <Button className="mt-2 w-full" variant="secondary" onClick={onSavePreset}>
            プリセット保存
          </Button>
          <select
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
            className="app-select mt-2"
          >
            <option value="">プリセットを選択</option>
            {presetKeys.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <Button className="mt-2 w-full" variant="secondary" onClick={onLoadPreset}>
            プリセット読込
          </Button>
        </Section>
      </div>
    </Card>
  );
}
