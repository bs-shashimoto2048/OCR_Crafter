import { useEffect, useRef, useState } from "react";

import Button from "./Button";
import Card from "./Card";
import {
  PREPROCESS_SECTIONS,
  appliesToLabel,
  itemChanged,
  itemStatusLabel,
  itemVisible,
  sectionChangedCount,
  sectionResetPatch,
  sectionStatusLabel,
  thresholdDependency,
  visibleItems,
} from "../lib/preprocessSchema";

// 実処理順（settings.yaml pipelines）に沿ったセクション構成・基本/詳細モード・設定検索・
// 変更済み表示を持つ前処理設定パネル。スキーマ（lib/preprocessSchema.js）が
// 表示可否・検索一致・変更検知の単一の情報源。

// 項目ラッパー: 見出しだけでON/OFF・変更済み・対象種別が分かるようにする
function Item({ def, params, defaults, children }) {
  const status = itemStatusLabel(def, params);
  const changed = itemChanged(def, params, defaults || {});
  const applies = appliesToLabel(def);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/60 p-3 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold tracking-normal text-blue-300">{def.label}</p>
        {status ? (
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
              status === "ON" ? "border-success/40 bg-success/10 text-success" : "border-border bg-card/60 text-muted"
            }`}
          >
            {status}
          </span>
        ) : null}
        {applies ? <span className="text-[10px] text-muted">{applies}</span> : null}
        {changed ? (
          <span className="ml-auto shrink-0 text-[10px] font-semibold text-amber-300" title="既定値から変更されています">
            ●変更済み
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// アコーディオングループ（展開状態はプロジェクト単位で保存。検索中は一致セクションを強制展開）
function Group({ id, title, note, statusLabel, changedCount, forceOpen, open, onToggle, onReset, children }) {
  return (
    <details
      open={forceOpen || open}
      data-section={id}
      className="group rounded-xl border border-border bg-card/45"
      onToggle={(e) => {
        if (!forceOpen) onToggle?.(id, e.currentTarget.open);
      }}
    >
      <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
        <span className="text-xs text-muted transition-transform group-open:rotate-90" aria-hidden="true">
          ▶
        </span>
        {title}
        {statusLabel ? (
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
              statusLabel.includes("ON") && !statusLabel.startsWith("0/") && statusLabel !== "OFF"
                ? "border-success/40 bg-success/10 text-success"
                : "border-border bg-card/60 text-muted"
            }`}
          >
            {statusLabel}
          </span>
        ) : null}
        {changedCount > 0 ? <span className="text-[10px] font-semibold text-amber-300">変更{changedCount}件</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {note ? <span className="hidden text-[10px] font-normal text-muted min-[1500px]:inline">{note}</span> : null}
          {changedCount > 0 && onReset ? (
            <button
              type="button"
              className="rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted transition-colors hover:border-danger/60 hover:text-danger"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onReset(id);
              }}
              title="このセクションを既定値へ戻します"
            >
              リセット
            </button>
          ) : null}
        </span>
      </summary>
      <div className="space-y-2.5 px-2.5 pb-2.5">{children}</div>
    </details>
  );
}

export default function PreprocessPanel({
  headerAction = null,
  inferenceSettings = null,
  inferenceSummary = "",
  focusInference = false,
  manualMaskSection = null,
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
  uiState = { mode: "basic", openSections: ["input", "brightness", "threshold"] },
  onUiStateChange,
  previewType = "",
}) {
  const presetKeys = Object.keys(presets);
  const inferenceRef = useRef(null);
  // 設定検索（保存しない・入力中はセクション自動展開）
  const [query, setQuery] = useState("");
  const mode = uiState.mode === "advanced" ? "advanced" : "basic";
  const openSections = new Set(uiState.openSections || []);
  const searching = query.trim().length > 0;
  const ctx = { mode, query, params };

  // ラベル編集の「推論設定を開く」から遷移した場合はOCR結果確認を展開して見える位置へ
  useEffect(() => {
    if (!focusInference || !inferenceRef.current) {
      return;
    }
    inferenceRef.current.open = true;
    inferenceRef.current.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [focusInference]);

  function update(key, value) {
    onParamsChange((prev) => ({ ...prev, [key]: value }));
  }

  function setMode(nextMode) {
    onUiStateChange?.({ ...uiState, mode: nextMode });
  }

  function toggleSection(id, open) {
    const next = new Set(uiState.openSections || []);
    if (open) next.add(id);
    else next.delete(id);
    onUiStateChange?.({ ...uiState, openSections: [...next] });
  }

  function resetSection(sectionId) {
    const section = PREPROCESS_SECTIONS.find((s) => s.id === sectionId);
    if (!section || !defaultParams) return;
    onParamsChange((prev) => ({ ...prev, ...sectionResetPatch(section, defaultParams) }));
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

  const section = (id) => PREPROCESS_SECTIONS.find((s) => s.id === id);
  const def = (sectionId, itemId) => section(sectionId).items.find((i) => i.id === itemId);
  const show = (sectionId, itemId) => itemVisible(def(sectionId, itemId), section(sectionId), ctx);
  const sectionVisible = (id) => visibleItems(section(id), ctx).length > 0;
  const groupProps = (id) => {
    const s = section(id);
    return {
      id,
      title: s.title,
      note: s.note,
      statusLabel: sectionStatusLabel(s, params),
      changedCount: sectionChangedCount(s, params, defaultParams || {}),
      forceOpen: searching,
      open: openSections.has(id),
      onToggle: toggleSection,
      onReset: resetSection,
    };
  };
  const itemProps = (sectionId, itemId) => ({ def: def(sectionId, itemId), params, defaults: defaultParams });
  // 固定セクション（OCR結果確認・プリセット）の検索一致
  const fixedMatches = (text) => !searching || text.toLowerCase().includes(query.trim().toLowerCase());

  const th = thresholdDependency(params.threshold_type);
  const maskDisabled = !params.manual_mask_enabled;

  return (
    <Card
      title="前処理パラメータ"
      subtitle="リアルタイム調整（300msデバウンス）"
      className="preprocess-panel flex h-full min-h-0 flex-col min-[1024px]:col-span-2 min-[1280px]:col-span-1"
      actions={headerAction}
    >
      {/* 上部ツールバー: 基本/詳細モード切替＋設定検索（値はモード切替で失われない） */}
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="表示モード">
          <button
            type="button"
            className={`px-2.5 py-1 text-xs font-semibold transition ${
              mode === "basic" ? "bg-accent/25 text-blue-200" : "bg-card/60 text-muted hover:text-text"
            }`}
            onClick={() => setMode("basic")}
          >
            基本
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 text-xs font-semibold transition ${
              mode === "advanced" ? "bg-accent/25 text-blue-200" : "bg-card/60 text-muted hover:text-text"
            }`}
            onClick={() => setMode("advanced")}
          >
            詳細
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="設定を検索（例: しきい値 / CLAHE / 傾き）"
          className="app-input h-7 min-w-0 flex-1 text-xs"
          aria-label="設定を検索"
        />
      </div>

      <div className="scroll-stable min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {/* ① 入力・分岐 */}
        {sectionVisible("input") ? (
          <Group {...groupProps("input")}>
            {show("input", "ratio_threshold") ? (
              <Item {...itemProps("input", "ratio_threshold")}>
                <label className="app-label">比率しきい値: {params.ratio_threshold.toFixed(2)}</label>
                <p className="param-hint">
                  幅÷高さがこの値以上でwide（横長文字）、未満でsingle（単一文字）と判定します。値を下げると横長判定が増えます。
                  {previewType ? `（表示中の画像: ${previewType}）` : ""}
                </p>
                <input
                  type="range"
                  min="0.8"
                  max="4.0"
                  step="0.05"
                  value={params.ratio_threshold}
                  onChange={(e) => update("ratio_threshold", Number(e.target.value))}
                  className="w-full"
                />
              </Item>
            ) : null}
          </Group>
        ) : null}

        {/* ② 明るさ・コントラスト（処理順 1〜6） */}
        {sectionVisible("brightness") ? (
          <Group {...groupProps("brightness")}>
            {show("brightness", "grayscale") ? (
              <Item {...itemProps("brightness", "grayscale")}>
                <p className="param-hint">常に最初に実行されます（設定はありません）。</p>
              </Item>
            ) : null}
            {show("brightness", "illumination") ? (
              <Item {...itemProps("brightness", "illumination")}>
                <p className="param-hint">影・照明ムラ・背景濃淡を二値化前に均一化します。</p>
                <label className="inline-flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={Boolean(params.illumination_enabled)}
                    onChange={(e) => update("illumination_enabled", e.target.checked)}
                  />
                  有効
                </label>
                <label className="app-label mt-2">方式</label>
                <select
                  value={params.illumination_method || "gaussian"}
                  onChange={(e) => update("illumination_method", e.target.value)}
                  className="app-select"
                  disabled={!params.illumination_enabled}
                >
                  <option value="gaussian">Gaussian背景補正</option>
                  <option value="rolling_ball">Rolling Ball背景補正（近似）</option>
                  <option value="retinex">Retinex</option>
                </select>
                <label className="app-label mt-2">背景サイズ: {params.illumination_background_size ?? 81}</label>
                <p className="param-hint">文字より大きな値を指定してください。</p>
                <input
                  type="range"
                  min="15"
                  max="201"
                  step="2"
                  value={params.illumination_background_size ?? 81}
                  onChange={(e) => update("illumination_background_size", Number(e.target.value))}
                  className="w-full"
                  disabled={!params.illumination_enabled}
                />
                <label className="app-label mt-2">補正強度: {Number(params.illumination_strength ?? 1).toFixed(2)}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={params.illumination_strength ?? 1}
                  onChange={(e) => update("illumination_strength", Number(e.target.value))}
                  className="w-full"
                  disabled={!params.illumination_enabled}
                />
              </Item>
            ) : null}
            {show("brightness", "gamma") ? (
              <Item {...itemProps("brightness", "gamma")}>
                <p className="param-hint">明るさカーブを調整します。1.0で変化なし。</p>
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
                  disabled={!params.gamma_enabled}
                />
              </Item>
            ) : null}
            {show("brightness", "clahe") ? (
              <Item {...itemProps("brightness", "clahe")}>
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
              </Item>
            ) : null}
            {show("brightness", "local_contrast") ? (
              <Item {...itemProps("brightness", "local_contrast")}>
                <p className="param-hint">文字周辺だけコントラストを上げます（CLAHEと同系の処理）。</p>
                <label className="inline-flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={params.local_contrast_enabled}
                    onChange={(e) => update("local_contrast_enabled", e.target.checked)}
                  />
                  有効
                </label>
                <label className="app-label mt-2">クリップ上限: {Number(params.local_contrast_clip_limit || 2).toFixed(1)}</label>
                <input
                  type="range"
                  min="1.0"
                  max="8.0"
                  step="0.1"
                  value={params.local_contrast_clip_limit}
                  onChange={(e) => update("local_contrast_clip_limit", Number(e.target.value))}
                  className="w-full"
                  disabled={!params.local_contrast_enabled}
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
                  disabled={!params.local_contrast_enabled}
                />
              </Item>
            ) : null}
            {show("brightness", "hist_equalize") ? (
              <Item {...itemProps("brightness", "hist_equalize")}>
                <p className="param-hint">画像全体の明暗分布を均します。</p>
                <label className="inline-flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={params.hist_equalize_enabled}
                    onChange={(e) => update("hist_equalize_enabled", e.target.checked)}
                  />
                  有効
                </label>
              </Item>
            ) : null}
          </Group>
        ) : null}

        {/* ③ 鮮明化（処理順 7〜9） */}
        {sectionVisible("sharpness") ? (
          <Group {...groupProps("sharpness")}>
            {show("sharpness", "bilateral") ? (
              <Item {...itemProps("sharpness", "bilateral")}>
                <p className="param-hint">輪郭を保ちながらノイズを減らします。</p>
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
                  disabled={!params.bilateral_enabled}
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
                  disabled={!params.bilateral_enabled}
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
                  disabled={!params.bilateral_enabled}
                />
              </Item>
            ) : null}
            {show("sharpness", "sharpen") ? (
              <Item {...itemProps("sharpness", "sharpen")}>
                <p className="param-hint">輪郭を強調して文字の境界を見やすくします。</p>
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
                  disabled={!params.sharpen_enabled}
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
                  disabled={!params.sharpen_enabled}
                />
              </Item>
            ) : null}
            {show("sharpness", "unsharp") ? (
              <Item {...itemProps("sharpness", "unsharp")}>
                <p className="param-hint">ぼかしとの差分で輪郭を強調します。</p>
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
                  disabled={!params.unsharp_enabled}
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
                  disabled={!params.unsharp_enabled}
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
                  disabled={!params.unsharp_enabled}
                />
              </Item>
            ) : null}
          </Group>
        ) : null}

        {/* ④ 二値化（処理順 11） */}
        {sectionVisible("threshold") ? (
          <Group {...groupProps("threshold")}>
            {show("threshold", "threshold_type") ? (
              <Item {...itemProps("threshold", "threshold_type")}>
                <p className="param-hint">白黒への分離方法です。「なし」はグレースケールのまま後段へ渡します。</p>
                <select
                  value={params.threshold_type}
                  onChange={(e) => update("threshold_type", e.target.value)}
                  className="app-select"
                >
                  <option value="none">なし（二値化しない）</option>
                  <option value="binary">固定しきい値</option>
                  <option value="otsu">大津法</option>
                  <option value="adaptive">適応的しきい値</option>
                </select>
              </Item>
            ) : null}
            {show("threshold", "threshold_value") ? (
              <Item {...itemProps("threshold", "threshold_value")}>
                <label className="app-label">しきい値: {params.threshold_value}</label>
                {!th.valueEnabled ? (
                  <p className="param-hint">固定しきい値を選択したときのみ使用されます（現在は無効）。</p>
                ) : (
                  <p className="param-hint">値を上げると黒（文字側）が増えます。</p>
                )}
                <input
                  type="range"
                  min="0"
                  max="255"
                  step="1"
                  value={params.threshold_value}
                  onChange={(e) => update("threshold_value", Number(e.target.value))}
                  className="w-full"
                  disabled={!th.valueEnabled}
                />
              </Item>
            ) : null}
            {th.adaptiveVisible && show("threshold", "threshold_adaptive") ? (
              <Item {...itemProps("threshold", "threshold_adaptive")}>
                <p className="param-hint">近傍block sizeごとにしきい値を決めます。Cは差し引く定数です。</p>
                <label className="app-label">block size: {params.threshold_block_size ?? 35}</label>
                <input
                  type="range"
                  min="3"
                  max="99"
                  step="2"
                  value={params.threshold_block_size ?? 35}
                  onChange={(e) => update("threshold_block_size", Number(e.target.value))}
                  className="w-full"
                />
                <label className="app-label">C: {params.threshold_c ?? 11}</label>
                <input
                  type="range"
                  min="-20"
                  max="40"
                  step="1"
                  value={params.threshold_c ?? 11}
                  onChange={(e) => update("threshold_c", Number(e.target.value))}
                  className="w-full"
                />
              </Item>
            ) : null}
          </Group>
        ) : null}

        {/* ⑤ マスク・形状補正（処理順 10・12〜15） */}
        {sectionVisible("shape") ? (
          <Group {...groupProps("shape")}>
            {show("shape", "manual_mask") && manualMaskSection ? (
              <Item {...itemProps("shape", "manual_mask")}>{manualMaskSection}</Item>
            ) : null}
            {show("shape", "morph") ? (
              <Item {...itemProps("shape", "morph")}>
                <p className="param-hint">クローズは欠け埋め、オープンは小ノイズ除去に有効です（二値化の直後に実行）。</p>
                <label className="inline-flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={params.morph_enabled}
                    onChange={(e) => update("morph_enabled", e.target.checked)}
                  />
                  有効
                </label>
                <label className="app-label mt-2">方式</label>
                <select
                  value={params.morph_method}
                  onChange={(e) => update("morph_method", e.target.value)}
                  className="app-select"
                  disabled={!params.morph_enabled}
                >
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
                  disabled={!params.morph_enabled}
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
                  disabled={!params.morph_enabled}
                />
              </Item>
            ) : null}
            {show("shape", "stroke_boost") ? (
              <Item {...itemProps("shape", "stroke_boost")}>
                <p className="param-hint">欠けた線を補う処理です。強すぎると文字が潰れます。</p>
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
                  disabled={!params.stroke_boost_enabled}
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
                  disabled={!params.stroke_boost_enabled}
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
                  disabled={!params.stroke_boost_enabled}
                />
              </Item>
            ) : null}
            {show("shape", "deskew") ? (
              <Item {...itemProps("shape", "deskew")}>
                <p className="param-hint">斜め画像を水平に補正します（wide画像のみ・形状補正の最後に実行）。</p>
                <label className="inline-flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={params.deskew_enabled}
                    onChange={(e) => update("deskew_enabled", e.target.checked)}
                  />
                  有効
                </label>
              </Item>
            ) : null}
          </Group>
        ) : null}

        {/* ⑥ 出力整形（処理順 16〜18） */}
        {sectionVisible("output") ? (
          <Group {...groupProps("output")}>
            {show("output", "crop_margin") ? (
              <Item {...itemProps("output", "crop_margin")}>
                <p className="param-hint">文字領域の外側余白を自動カットします。</p>
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
                  disabled={!params.crop_margin_enabled}
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
                  disabled={!params.crop_margin_enabled}
                />
              </Item>
            ) : null}
            {show("output", "resize") ? (
              <Item {...itemProps("output", "resize")}>
                <label className="app-label">単一文字サイズ（single）</label>
                <input
                  type="number"
                  min="16"
                  max="256"
                  value={params.single_size}
                  onChange={(e) => update("single_size", Number(e.target.value))}
                  className="app-input"
                />
                <label className="app-label mt-2">横長文字の高さ（wide）</label>
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
                  アスペクト比を維持（wide）
                </label>
              </Item>
            ) : null}
            {show("output", "pad") ? (
              <Item {...itemProps("output", "pad")}>
                <p className="param-hint">single画像はリサイズ前に白背景の正方形へ自動パディングされます（設定はありません）。</p>
              </Item>
            ) : null}
            {show("output", "denoise") ? (
              <Item {...itemProps("output", "denoise")}>
                <p className="param-hint">背景ノイズを減らします（wideは最終工程・singleは余白カット前に実行）。</p>
                <label className="app-label">方式</label>
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
              </Item>
            ) : null}
          </Group>
        ) : null}

        {/* ⑦ OCR結果確認（旧・推論設定。前処理パラメータではなくプレビュー確認用の推論条件） */}
        {inferenceSettings && fixedMatches("ocr結果確認 推論 エンジン モデル whitelist psm") ? (
          <details ref={inferenceRef} data-section="ocr" className="group rounded-xl border border-border bg-card/45" open={searching || undefined}>
            <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
              <span className="text-xs text-muted transition-transform group-open:rotate-90" aria-hidden="true">
                ▶
              </span>
              OCR結果確認
              <span className="ml-auto truncate text-[11px] font-normal text-muted" title={inferenceSummary}>
                {inferenceSummary}
              </span>
            </summary>
            <div className="px-2.5 pb-2.5">
              <p className="param-hint mb-2">
                プレビューのOCR結果に使う推論条件です（前処理のパラメータではありません。学習・評価には影響しません）。
              </p>
              {inferenceSettings}
            </div>
          </details>
        ) : null}

        {/* ⑧ プリセット */}
        {fixedMatches("プリセット preset 保存") ? (
          <Group
            id="preset"
            title="プリセット"
            note=""
            statusLabel=""
            changedCount={0}
            forceOpen={searching}
            open={openSections.has("preset")}
            onToggle={toggleSection}
          >
            <div className="space-y-2 rounded-xl border border-border bg-card/60 p-3 backdrop-blur-md">
              <p className="param-hint">現在の調整値をプロジェクト単位で保存・再利用できます。</p>
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
            </div>
          </Group>
        ) : null}
      </div>

      <div className="mt-2 flex shrink-0 items-center gap-2 border-t border-border pt-2">
        <Button className="flex-1" size="sm" variant="secondary" onClick={onSavePreset}>
          プリセット保存
        </Button>
        <Button className="flex-1" size="sm" variant="danger" onClick={resetAll} title="すべての前処理パラメータを既定値へ戻します">
          すべてリセット
        </Button>
      </div>
    </Card>
  );
}
