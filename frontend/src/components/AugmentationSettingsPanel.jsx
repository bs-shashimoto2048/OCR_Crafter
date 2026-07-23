import { useState } from "react";

import Button from "./Button";
import InfoTooltip from "./InfoTooltip";
import { AUG_PRESET_LABELS } from "../lib/augmentation";
import {
  AUG_CATEGORIES,
  AUG_STRENGTH_LABELS,
  MULTIPLIER_TOOLTIP,
  buildAugSummary,
  clampAugValue,
  clampProbability,
  enabledAugItemLabels,
  isAugmentationOff,
  recommendedAugmentationState,
  resetAugmentationState,
  setAugItemEnabled,
  setAugItemValue,
} from "../lib/augmentationSettings";

// オーグメンテーション設定パネル（次回学習の設定 > オーグメンテーションタブ）。
// 設定キー・保存形式・生成ロジックは既存のまま（lib/augmentation.js 形式）。UI表示のみ再構成する。
// レイアウト: ヘッダー（適用モード・生成倍率・推奨/リセット）→ 設定一覧(70%)+プレビュー(30%) → 設定サマリー。
// 横幅が足りない場合（lg未満）は1カラムへ切り替える。
export default function AugmentationSettingsPanel({
  augmentation,
  onChange,
  disabled = false,
  preview = null,
  previewLoading = false,
  onRegeneratePreview,
  trainCount = null,
}) {
  const off = isAugmentationOff(augmentation);
  const summary = buildAugSummary(augmentation, trainCount);
  const appliedLabels = enabledAugItemLabels(augmentation);
  const [sampleCount, setSampleCount] = useState(3);

  // 推奨設定の適用（即上書きせず確認する）
  function applyRecommended() {
    if (window.confirm("現在のオーグメンテーション設定を推奨設定（弱い・OCR文字を壊しにくい値）で置き換えますか？")) {
      onChange?.(recommendedAugmentationState());
    }
  }

  // リセット（既定=「なし」へ戻す）
  function applyReset() {
    if (window.confirm("オーグメンテーション設定をリセットして「なし」へ戻しますか？")) {
      onChange?.(resetAugmentationState());
    }
  }

  return (
    <div className="space-y-3">
      {/* ヘッダー: 適用モード・生成倍率・推奨設定 */}
      <div className="space-y-2 rounded-xl border border-border/80 bg-card/45 p-3">
        <div>
          <p className="text-sm font-semibold text-text">オーグメンテーション設定</p>
          <p className="text-xs text-muted">
            学習時に適用する画像変換を設定します（Trainのみへ適用。Validation・Test・評価データ・正解ラベルは変更されません）
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40 min-w-0">
            <label className="app-label" htmlFor="aug-mode-select">
              適用モード
              <InfoTooltip
                title="適用モード"
                body="なし=オーグメンテーションを使用しません / 弱い=OCR文字を壊しにくい推奨値を一括適用 / カスタム=項目ごとに個別編集します。"
              />
            </label>
            <select
              id="aug-mode-select"
              className="app-select"
              value={augmentation?.preset || "none"}
              disabled={disabled}
              onChange={(e) => {
                const preset = e.target.value;
                if (preset === "weak") {
                  onChange?.(recommendedAugmentationState());
                } else {
                  onChange?.({ ...(augmentation || resetAugmentationState()), preset });
                }
              }}
            >
              {Object.entries(AUG_PRESET_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40 min-w-0">
            <label className="app-label" htmlFor="aug-multiplier-select">
              生成倍率
              <InfoTooltip title="生成倍率" body={MULTIPLIER_TOOLTIP} />
            </label>
            <select
              id="aug-multiplier-select"
              className="app-select"
              value={String(augmentation?.multiplier ?? 1.5)}
              disabled={disabled || off}
              onChange={(e) => onChange?.({ ...augmentation, multiplier: Number(e.target.value) })}
            >
              <option value="1.5">1.5倍</option>
              <option value="2">2.0倍</option>
              <option value="3">3.0倍</option>
            </select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" disabled={disabled} onClick={applyRecommended}>
              推奨設定を適用
            </Button>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={applyReset}>
              設定をリセット
            </Button>
          </div>
        </div>
        {off ? (
          <p className="rounded-lg border border-border/70 bg-card/55 px-3 py-2 text-xs text-muted">
            適用モードが「なし」のため、オーグメンテーションは適用されません。項目を編集するには「弱い」または「カスタム」を選択してください。
          </p>
        ) : null}
      </div>

      {/* 設定一覧(70%) + プレビュー(30%)。横幅不足時は1カラム */}
      <div className="grid grid-cols-1 items-start gap-3 min-[1600px]:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        {/* 設定一覧（カテゴリ別） */}
        <div className="min-w-0 space-y-3">
          {AUG_CATEGORIES.map((category) => (
            <section key={category.id} aria-label={category.label} className="rounded-xl border border-border/80 bg-card/45 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">{category.label}</p>
              <div className="space-y-1.5">
                {category.items.map((def) => {
                  const entry = augmentation?.[def.key] || {};
                  const enabled = !off && Boolean(entry.enabled);
                  const rowDisabled = disabled || off;
                  const probabilityPercent = Math.round(clampProbability(entry.probability ?? 0.3) * 100);
                  return (
                    <div
                      key={def.key}
                      className={`grid grid-cols-1 gap-1.5 rounded-lg border py-2 pl-2.5 pr-2 transition min-[1600px]:grid-cols-[minmax(0,1fr)_auto] min-[1600px]:items-center ${
                        enabled
                          ? "border-accent/50 border-l-4 border-l-accent bg-accent/5"
                          : "border-border/60 border-l-4 border-l-transparent bg-card/40"
                      }`}
                    >
                      {/* 項目名＋説明（無効時も読める状態を維持） */}
                      <div className={`min-w-0 ${enabled ? "" : "opacity-60"}`}>
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-text">
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={rowDisabled}
                            aria-describedby={`aug-desc-${def.key}`}
                            onChange={(e) => onChange?.(setAugItemEnabled(augmentation, def.key, e.target.checked))}
                          />
                          <span>{def.label}</span>
                          <InfoTooltip title={def.label} body={def.tooltip} />
                        </label>
                        <p id={`aug-desc-${def.key}`} className="mt-0.5 pl-6 text-[11px] text-muted">
                          {def.description}
                        </p>
                      </div>
                      {/* 入力欄（単位・意味を明示。無効時はdisabledで値は保持） */}
                      <div className={`flex flex-wrap items-center gap-2 pl-6 text-[12px] min-[1600px]:pl-0 ${enabled ? "" : "opacity-60"}`}>
                        <label className="inline-flex items-center gap-1 whitespace-nowrap text-muted">
                          確率 (%)
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="5"
                            className="app-input w-16 min-w-0 px-2 py-1 text-[12px]"
                            value={probabilityPercent}
                            disabled={rowDisabled || !enabled}
                            onChange={(e) =>
                              onChange?.(
                                setAugItemValue(augmentation, def, { probability: clampProbability(Number(e.target.value) / 100) })
                              )
                            }
                          />
                        </label>
                        {def.input.type === "degrees" ? (
                          <label className="inline-flex items-center gap-1 whitespace-nowrap text-muted">
                            範囲 ±(°)
                            <input
                              type="number"
                              min={def.input.min}
                              max={def.input.max}
                              step={def.input.step}
                              className="app-input w-16 min-w-0 px-2 py-1 text-[12px]"
                              value={entry[def.input.valueKey] ?? def.input.fallback}
                              disabled={rowDisabled || !enabled}
                              onChange={(e) =>
                                onChange?.(
                                  setAugItemValue(augmentation, def, { [def.input.valueKey]: clampAugValue(def, e.target.value) })
                                )
                              }
                            />
                          </label>
                        ) : null}
                        {def.input.type === "percent" ? (
                          <label className="inline-flex items-center gap-1 whitespace-nowrap text-muted">
                            範囲 ±(%)
                            <input
                              type="number"
                              min={Math.round(def.input.min * 100)}
                              max={Math.round(def.input.max * 100)}
                              step={Math.round(def.input.step * 100)}
                              className="app-input w-16 min-w-0 px-2 py-1 text-[12px]"
                              value={Math.round((entry[def.input.valueKey] ?? def.input.fallback) * 100)}
                              disabled={rowDisabled || !enabled}
                              onChange={(e) =>
                                onChange?.(
                                  setAugItemValue(augmentation, def, {
                                    [def.input.valueKey]: clampAugValue(def, Number(e.target.value) / 100),
                                  })
                                )
                              }
                            />
                          </label>
                        ) : null}
                        {def.input.type === "strength" ? (
                          <label className="inline-flex items-center gap-1 whitespace-nowrap text-muted">
                            強度
                            <select
                              className="app-select w-16 min-w-0 px-2 py-1 text-[12px]"
                              value={entry[def.input.valueKey] || def.input.fallback}
                              disabled={rowDisabled || !enabled}
                              onChange={(e) => onChange?.(setAugItemValue(augmentation, def, { [def.input.valueKey]: e.target.value }))}
                            >
                              {Object.entries(AUG_STRENGTH_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* プレビュー（右カラム。設定一覧のスクロール中も見えるようsticky） */}
        <aside
          aria-label="オーグメンテーションプレビュー"
          className="min-w-0 space-y-2 rounded-xl border border-border/80 bg-card/45 p-3 min-[1600px]:sticky min-[1600px]:top-0"
        >
          <p className="text-sm font-semibold text-text">プレビュー</p>
          <div className="flex items-end gap-2">
            <div className="w-24">
              <label className="app-label" htmlFor="aug-sample-count">
                サンプル数
              </label>
              <select
                id="aug-sample-count"
                className="app-select"
                value={String(sampleCount)}
                disabled={disabled}
                onChange={(e) => setSampleCount(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}枚
                  </option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 whitespace-nowrap"
              disabled={disabled || off || Boolean(previewLoading)}
              onClick={() => onRegeneratePreview?.(sampleCount)}
              title="ランダムなサンプル画像へ現在の設定を適用します（実行のたびに別サンプル・別の変換結果になります）"
            >
              {previewLoading ? "生成中..." : "プレビューを再生成"}
            </Button>
          </div>
          {appliedLabels.length > 0 ? (
            <div className="text-[11px] text-muted">
              適用される変換: <span className="text-text">{appliedLabels.join(" / ")}</span>
            </div>
          ) : null}
          {/* 更新結果は支援技術へも通知する */}
          <div aria-live="polite" className={off ? "opacity-50" : ""}>
            {preview?.items?.length ? (
              <div className="space-y-2">
                {preview.items.map((item) => (
                  <div key={item.image_name} className="min-w-0 rounded-lg border border-border/70 bg-card/55 p-1.5">
                    <p className="truncate text-[11px] text-muted" title={item.image_name}>
                      {item.image_name}（{item.label}）
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <p className="text-[10px] text-muted">元画像</p>
                        <img src={item.original} alt="元画像" className="h-12 w-full rounded border border-border/60 object-contain" />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted">適用例</p>
                        <img src={item.augmented} alt="適用後" className="h-12 w-full rounded border border-border/60 object-contain" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted">
                プレビューはまだ生成されていません。
                <br />
                「プレビューを再生成」を押すと、ランダムなサンプルへ現在の設定を適用した例を表示します。
              </p>
            )}
          </div>
          <p className="text-[10px] text-muted">
            プレビューは確認用の例です（実行のたびにランダム）。実際の学習時にはTrain画像ごとに個別へ適用されます。
          </p>
        </aside>
      </div>

      {/* 設定サマリー */}
      <div className="rounded-xl border border-border/80 bg-card/45 p-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">設定サマリー</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] md:grid-cols-4">
          <div>
            <dt className="text-muted">適用項目数</dt>
            <dd className="font-semibold tabular-nums text-text">
              {summary.enabled} / {summary.total}
            </dd>
          </div>
          <div>
            <dt className="text-muted">平均適用確率</dt>
            <dd className="font-semibold tabular-nums text-text">
              {summary.avgProbabilityPercent == null ? "--" : `${summary.avgProbabilityPercent}%`}
            </dd>
          </div>
          <div>
            <dt className="text-muted">生成倍率</dt>
            <dd className="font-semibold tabular-nums text-text">{summary.multiplier == null ? "--" : `${summary.multiplier}倍`}</dd>
          </div>
          <div>
            <dt className="text-muted">推定追加枚数</dt>
            <dd className="font-semibold tabular-nums text-text">
              {summary.addedCount != null
                ? `約${summary.addedCount}枚（+${summary.increasePercent}%）`
                : summary.increasePercent > 0
                  ? `約${summary.increasePercent}%増加`
                  : "増加なし"}
            </dd>
          </div>
        </dl>
        <p className="mt-1.5 text-[11px] text-muted">推定値は目安です。実際の生成枚数はデータ内容により変動します。</p>
      </div>
    </div>
  );
}
