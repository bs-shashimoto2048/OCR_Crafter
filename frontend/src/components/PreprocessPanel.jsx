import Button from "./Button";
import Card from "./Card";

function Section({ title, children }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/60 backdrop-blur-md p-3">
      {title ? <p className="text-sm font-semibold tracking-normal text-blue-300">{title}</p> : null}
      {children}
    </div>
  );
}

// アコーディオングループ。基本設定・二値化のみ初期展開、それ以外は閉じた状態
function Group({ title, defaultOpen = false, children }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-border bg-card/45">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
        <span className="text-xs text-muted transition-transform group-open:rotate-90" aria-hidden="true">
          ▶
        </span>
        {title}
      </summary>
      <div className="space-y-2.5 px-2.5 pb-2.5">{children}</div>
    </details>
  );
}

export default function PreprocessPanel({
  headerAction = null,
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
      className="preprocess-panel flex h-full min-h-0 flex-col"
      actions={headerAction}
    >
      <div className="scroll-stable min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        <Group title="基本設定" defaultOpen>
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
        </Group>

        <Group title="二値化" defaultOpen>
          <Section>
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
        </Group>

        <Group title="単一文字設定">
          <Section>
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
        </Group>

        <Group title="横長文字設定">
          <Section>
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
        </Group>

        <Group title="鮮明化・補正">
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

          <Section title="アンシャープマスク">
            <p className="param-hint">ぼかしとの差分で輪郭を強調します。線をくっきりさせたい時に有効です。</p>
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={params.unsharp_enabled}
                onChange={(e) => update("unsharp_enabled", e.target.checked)}
              />
              有効
            </label>
            <label className="app-label mt-2">強さ: {Number(params.unsharp_amount || 0).toFixed(1)}</label>
            <input
              type="range"
              min="0.1"
              max="3.0"
              step="0.1"
              value={params.unsharp_amount}
              onChange={(e) => update("unsharp_amount", Number(e.target.value))}
              className="w-full"
            />
            <label className="app-label">半径: {Number(params.unsharp_radius || 1).toFixed(1)}</label>
            <input
              type="range"
              min="0.3"
              max="4.0"
              step="0.1"
              value={params.unsharp_radius}
              onChange={(e) => update("unsharp_radius", Number(e.target.value))}
              className="w-full"
            />
            <label className="app-label">しきい値: {params.unsharp_threshold}</label>
            <input
              type="range"
              min="0"
              max="64"
              step="1"
              value={params.unsharp_threshold}
              onChange={(e) => update("unsharp_threshold", Number(e.target.value))}
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
        </Group>

        <Group title="ノイズ除去">
          <Section>
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

          <Section title="バイラテラルノイズ除去">
            <p className="param-hint">輪郭を保ちながらノイズを減らします。文字境界を残したいときに使います。</p>
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={params.bilateral_enabled}
                onChange={(e) => update("bilateral_enabled", e.target.checked)}
              />
              有効
            </label>
            <label className="app-label mt-2">直径: {params.bilateral_diameter}</label>
            <input
              type="range"
              min="1"
              max="15"
              step="1"
              value={params.bilateral_diameter}
              onChange={(e) => update("bilateral_diameter", Number(e.target.value))}
              className="w-full"
            />
            <label className="app-label">色差シグマ: {params.bilateral_sigma_color}</label>
            <input
              type="range"
              min="5"
              max="150"
              step="1"
              value={params.bilateral_sigma_color}
              onChange={(e) => update("bilateral_sigma_color", Number(e.target.value))}
              className="w-full"
            />
            <label className="app-label">距離シグマ: {params.bilateral_sigma_space}</label>
            <input
              type="range"
              min="5"
              max="150"
              step="1"
              value={params.bilateral_sigma_space}
              onChange={(e) => update("bilateral_sigma_space", Number(e.target.value))}
              className="w-full"
            />
          </Section>
        </Group>

        <Group title="その他（詳細設定）">
          <Section title="ガンマ補正">
            <p className="param-hint">明るさカーブを調整します。1.0で変化なし、低すぎると白飛びしやすくなります。</p>
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={params.gamma_enabled}
                onChange={(e) => update("gamma_enabled", e.target.checked)}
              />
              有効
            </label>
            <label className="app-label mt-2">ガンマ値: {Number(params.gamma_value || 1).toFixed(2)}</label>
            <input
              type="range"
              min="0.4"
              max="2.5"
              step="0.05"
              value={params.gamma_value}
              onChange={(e) => update("gamma_value", Number(e.target.value))}
              className="w-full"
            />
          </Section>

          <Section title="局所コントラスト">
            <p className="param-hint">文字周辺だけコントラストを上げます。背景ムラが強い画像に有効です。</p>
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={params.local_contrast_enabled}
                onChange={(e) => update("local_contrast_enabled", e.target.checked)}
              />
              有効
            </label>
            <label className="app-label mt-2">
              クリップ上限: {Number(params.local_contrast_clip_limit || 2).toFixed(1)}
            </label>
            <input
              type="range"
              min="1.0"
              max="8.0"
              step="0.1"
              value={params.local_contrast_clip_limit}
              onChange={(e) => update("local_contrast_clip_limit", Number(e.target.value))}
              className="w-full"
            />
            <label className="app-label">タイルサイズ: {params.local_contrast_tile_grid_size}</label>
            <input
              type="range"
              min="2"
              max="32"
              step="1"
              value={params.local_contrast_tile_grid_size}
              onChange={(e) => update("local_contrast_tile_grid_size", Number(e.target.value))}
              className="w-full"
            />
          </Section>

          <Section title="ヒストグラム平坦化">
            <p className="param-hint">画像全体の明暗分布を均します。コントラスト不足の画像を補正します。</p>
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={params.hist_equalize_enabled}
                onChange={(e) => update("hist_equalize_enabled", e.target.checked)}
              />
              有効
            </label>
          </Section>

          <Section title="オープン/クローズ処理">
            <p className="param-hint">クローズは欠け埋め、オープンは小ノイズ除去に有効です。</p>
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={params.morph_enabled}
                onChange={(e) => update("morph_enabled", e.target.checked)}
              />
              有効
            </label>
            <label className="app-label mt-2">方式</label>
            <select value={params.morph_method} onChange={(e) => update("morph_method", e.target.value)} className="app-select">
              <option value="close">クローズ</option>
              <option value="open">オープン</option>
            </select>
            <label className="app-label mt-2">カーネルサイズ: {params.morph_ksize}</label>
            <input
              type="range"
              min="1"
              max="11"
              step="2"
              value={params.morph_ksize}
              onChange={(e) => update("morph_ksize", Number(e.target.value))}
              className="w-full"
            />
            <label className="app-label">反復回数: {params.morph_iterations}</label>
            <input
              type="range"
              min="1"
              max="4"
              step="1"
              value={params.morph_iterations}
              onChange={(e) => update("morph_iterations", Number(e.target.value))}
              className="w-full"
            />
          </Section>

          <Section title="余白トリミング">
            <p className="param-hint">文字領域の外側余白を自動カットします。周辺ノイズがある画像に有効です。</p>
            <label className="inline-flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={params.crop_margin_enabled}
                onChange={(e) => update("crop_margin_enabled", e.target.checked)}
              />
              有効
            </label>
            <label className="app-label mt-2">背景しきい値: {params.crop_margin_threshold}</label>
            <input
              type="range"
              min="180"
              max="254"
              step="1"
              value={params.crop_margin_threshold}
              onChange={(e) => update("crop_margin_threshold", Number(e.target.value))}
              className="w-full"
            />
            <label className="app-label">余白マージン: {params.crop_margin_margin}px</label>
            <input
              type="range"
              min="0"
              max="20"
              step="1"
              value={params.crop_margin_margin}
              onChange={(e) => update("crop_margin_margin", Number(e.target.value))}
              className="w-full"
            />
          </Section>
        </Group>

        <Group title="プリセット">
          <Section>
            <p className="param-hint">現在の調整値を保存・再利用できます。保存は下部の「プリセット保存」ボタンから行えます。</p>
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="プリセット名"
              className="app-input"
            />
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
        </Group>
      </div>

      <div className="mt-2 flex shrink-0 items-center gap-2 border-t border-border pt-2">
        <Button className="flex-1" size="sm" variant="secondary" onClick={onSavePreset}>
          プリセット保存
        </Button>
        <Button className="flex-1" size="sm" variant="danger" onClick={resetAll}>
          リセット
        </Button>
      </div>
    </Card>
  );
}
