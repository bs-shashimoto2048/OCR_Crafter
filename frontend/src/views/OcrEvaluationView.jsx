import { useEffect, useId, useMemo, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";
import { API_BASE, request } from "../lib/api";
import { flattenEvalHistory, historyPreprocessLabel } from "../lib/evalHistory";
import {
  DEFAULT_EVAL_PREPROCESS,
  evalPreprocessRequestJson,
  evalPreprocessSourceLabel,
  evalPreprocessSummary,
  normalizeEvalPreprocess,
} from "../lib/evalPreprocess";

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "-";
}

// 内部スクロール領域の共通クラス（連鎖スクロール防止＋スクロールバー分の幅揺れ防止）
const SCROLL_AREA = "dark-scroll [overscroll-behavior:contain] [scrollbar-gutter:stable]";

export default function OcrEvaluationView({
  imageDir,
  setImageDir,
  onBrowseImageDir,
  gtCsv,
  setGtCsv,
  onBrowseGtCsv,
  includeBase,
  setIncludeBase,
  trainedModel,
  setTrainedModel,
  tesseractModels,
  whitelistMode,
  setWhitelistMode,
  whitelistCustom,
  setWhitelistCustom,
  whitelistDefault,
  onRun,
  loading,
  result,
  onExportCsv,
  datasets = [],
  selectedDatasetId = "",
  onSelectDataset,
  onDeleteDataset,
  onRenameDataset,
  overlap = null,
  evalHistory = {},
  projectId = "default",
  preprocessSource = "none",
  onChangePreprocessSource,
  preprocessCustom = DEFAULT_EVAL_PREPROCESS,
  onChangePreprocessCustom,
  step5Preprocess = DEFAULT_EVAL_PREPROCESS,
}) {
  const targets = Array.isArray(result?.targets) ? result.targets : [];
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const comparison = result?.comparison || null;
  const canRun = String(imageDir || "").trim() !== "" && String(gtCsv || "").trim() !== "" && !loading;
  const mismatchRows = rows.filter((row) => (row.results || []).some((r) => !r.match));
  const selectedDataset = datasets.find((row) => row.id === selectedDatasetId) || null;
  const historyRows = flattenEvalHistory(evalHistory);
  const overrideBodyId = useId();

  // 表示・編集対象の前処理値（step5=参照表示 / custom=編集可 / none=既定値を無効表示）
  const displayedPre = normalizeEvalPreprocess(
    preprocessSource === "custom" ? preprocessCustom : preprocessSource === "step5" ? step5Preprocess : DEFAULT_EVAL_PREPROCESS
  );
  const preEditable = preprocessSource === "custom";
  const preSummaryText = `${evalPreprocessSourceLabel(preprocessSource)} / ${
    preprocessSource === "none" ? "前処理なし" : evalPreprocessSummary(displayedPre)
  }`;

  // 詳細設定（上書き）アコーディオン
  const [overrideOpen, setOverrideOpen] = useState(false);

  // 小型プレビュー（評価画像フォルダの先頭画像から選択・手動更新。大きな画像領域は追加しない）
  const [sampleFiles, setSampleFiles] = useState([]);
  const [sampleName, setSampleName] = useState("");
  const [previewProcessed, setPreviewProcessed] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  useEffect(() => {
    // アコーディオンを開いたときにサンプル一覧を取得（imageDir変更でリセット）
    setSampleFiles([]);
    setSampleName("");
    setPreviewProcessed("");
    setPreviewError("");
    if (!overrideOpen || !String(imageDir || "").trim()) {
      return undefined;
    }
    let ignore = false;
    request(`/image-builder/evaluation/directory-images?directory=${encodeURIComponent(imageDir)}`)
      .then((data) => {
        if (ignore) return;
        const names = (data?.images || []).map((row) => row.filename).slice(0, 50);
        setSampleFiles(names);
        setSampleName(names[0] || "");
      })
      .catch(() => {
        if (!ignore) setSampleFiles([]);
      });
    return () => {
      ignore = true;
    };
  }, [overrideOpen, imageDir]);

  async function updatePreview() {
    if (!sampleName || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const form = new FormData();
      form.append("project_id", projectId || "default");
      form.append("source_directory", imageDir);
      form.append("filename", sampleName);
      form.append("rotation", "0");
      const preJson = evalPreprocessRequestJson(displayedPre);
      if (preJson && preprocessSource !== "none") {
        form.append("eval_preprocess_json", preJson);
      }
      form.append("slots_json", "[]"); // プレビューのみ（OCR推論なし）
      const res = await fetch(`${API_BASE}/api/ocr/preview-file/batch`, { method: "POST", body: form });
      if (!res.ok) {
        throw new Error((await res.text()) || "プレビューの取得に失敗しました");
      }
      const data = await res.json();
      setPreviewProcessed(data?.processed_data_url || "");
    } catch (e) {
      setPreviewProcessed("");
      setPreviewError(String(e?.message || e));
    } finally {
      setPreviewLoading(false);
    }
  }

  function patchCustomPre(patch) {
    onChangePreprocessCustom?.({ ...normalizeEvalPreprocess(preprocessCustom), ...patch });
  }

  function handleDelete() {
    if (!selectedDataset) return;
    const ok = window.confirm(
      `${selectedDataset.name}\n${selectedDataset.image_count}枚\n\n本当に削除しますか？\n（images / ground_truth.csv / metadata / editing_state をまとめて削除します）`
    );
    if (ok) {
      onDeleteDataset?.(selectedDataset.id);
    }
  }

  function handleRename() {
    if (!selectedDataset) return;
    const next = window.prompt("新しいデータセット名（英数字・ハイフン・アンダースコア）", selectedDataset.name);
    if (next && next !== selectedDataset.name) {
      onRenameDataset?.(selectedDataset.id, next);
    }
  }

  // 結果に紐づく「実際に適用した」前処理（サーバー応答のecho。UI選択中の値ではない）
  const resultPreLabel = useMemo(() => {
    if (!result) return "";
    if (result.preprocess_source === undefined) return "未記録（旧形式の結果）";
    const source = evalPreprocessSourceLabel(result.preprocess_source);
    return result.eval_preprocess ? `${source} / ${evalPreprocessSummary(result.eval_preprocess)}` : source;
  }, [result]);

  return (
    // xl以上はビューポート内固定（ページスクロールなし・内部スクロールのみ）。xl未満は従来の縦積み/通常フロー
    <div className="flex flex-col gap-4 xl:h-full xl:min-h-0 xl:flex-1 xl:overflow-hidden">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(360px,2fr)_minmax(0,3fr)] xl:min-h-0 xl:flex-1 xl:overflow-hidden">
        {/* 左: 評価設定（上=内部スクロール領域 / 下=実行ボタン・履歴の固定領域） */}
        <Card
          title="評価設定"
          subtitle="学習前後のモデルを同一データで比較評価します"
          className="xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden"
        >
          <div className={`space-y-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1 ${SCROLL_AREA}`}>
            {/* 評価データセット（Step5で作成したデータを選択すると image_dir / gt_csv が自動反映される） */}
            <div className="rounded-xl border border-border/80 bg-card/45 p-3">
              <label className="app-label">評価データセット</label>
              <div className="flex gap-2">
                <select
                  className="app-select min-w-0 flex-1"
                  value={selectedDatasetId}
                  onChange={(e) => onSelectDataset?.(e.target.value)}
                >
                  <option value="">手動指定（下の詳細設定でパスを入力）</option>
                  {datasets.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}（{row.image_count}枚）
                    </option>
                  ))}
                </select>
                <Button variant="secondary" size="sm" className="h-8" onClick={handleRename} disabled={!selectedDataset}>
                  名前変更
                </Button>
                <Button variant="danger" size="sm" className="h-8" onClick={handleDelete} disabled={!selectedDataset}>
                  削除
                </Button>
              </div>
              {selectedDataset ? (
                <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs tabular-nums">
                  <span className="text-muted">画像数</span>
                  <span className="text-text">{selectedDataset.image_count}</span>
                  <span className="text-muted">ラベル数</span>
                  <span className="text-text">{selectedDataset.label_count}</span>
                  <span className="text-muted">Series</span>
                  <span className="min-w-0 truncate text-text" title={(selectedDataset.series || []).join(", ")}>
                    {(selectedDataset.series || []).join(", ") || "-"}
                  </span>
                  <span className="text-muted">作成日時</span>
                  <span className="text-text">{String(selectedDataset.created_at || "").replace("T", " ")}</span>
                  <span className="text-muted">回転済み枚数</span>
                  <span className="text-text">{selectedDataset.rotated_count}</span>
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted">
                  {datasets.length === 0
                    ? "評価データセットがありません（学習画像作成 Step5 で作成できます）"
                    : "データセットを選択すると画像フォルダとCSVが自動設定されます"}
                </p>
              )}
              {/* 学習データとの重複警告（sha256 → 元画像+BBoxID → ファイル名 の優先順で判定） */}
              {overlap && overlap.overlap_count > 0 ? (
                <div className="mt-2 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                  <p className="font-semibold">⚠ 学習データと重複しています（評価結果が実際より高くなる可能性があります）</p>
                  <p className="mt-0.5 tabular-nums">
                    重複 {overlap.overlap_count}枚 / 学習画像 {overlap.training_image_count}枚 / 評価画像{" "}
                    {overlap.evaluation_image_count}枚
                  </p>
                </div>
              ) : null}
            </div>

            {/* OCR評価条件（前処理はStep5と共通定義。UIで選択→評価APIへ送信し全画像へ同一適用） */}
            <div className="rounded-xl border border-border/80 bg-card/45 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">OCR評価条件</p>
              <label className="app-label">OCRプロファイル</label>
              <select
                className="app-select"
                value={preprocessSource}
                onChange={(e) => onChangePreprocessSource?.(e.target.value)}
              >
                <option value="none">前処理なし（従来どおり）</option>
                <option value="step5">Step5既定（保存済みのStep5前処理設定）</option>
                <option value="custom">カスタム（この画面で指定）</option>
              </select>
              <label className="mt-2 inline-flex h-5 cursor-pointer items-center gap-1.5 text-xs text-text">
                <input
                  type="checkbox"
                  checked={preprocessSource === "step5"}
                  onChange={(e) => onChangePreprocessSource?.(e.target.checked ? "step5" : "custom")}
                />
                Step5の前処理設定と同期する
              </label>
              {/* 設定サマリー（閉じていても現在の評価条件が分かる。長い場合は省略+ツールチップ） */}
              <p className="mt-1 min-w-0 truncate text-[11px] text-muted" title={preSummaryText}>
                使用中: {preSummaryText}
              </p>

              {/* 詳細設定（上書き）アコーディオン */}
              <button
                type="button"
                className="mt-2 flex w-full items-center gap-1.5 rounded-lg border border-border/70 bg-card/55 px-2 py-1.5 text-left text-xs font-semibold text-text transition hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-accent/70"
                aria-expanded={overrideOpen}
                aria-controls={overrideBodyId}
                onClick={() => setOverrideOpen((prev) => !prev)}
              >
                <span className={`text-[10px] text-muted transition-transform ${overrideOpen ? "rotate-90" : ""}`} aria-hidden="true">
                  ▶
                </span>
                詳細設定（上書き）
                <span className="ml-auto min-w-0 truncate text-[10px] font-normal text-muted" title={preSummaryText}>
                  {overrideOpen ? "" : preSummaryText}
                </span>
              </button>
              {overrideOpen ? (
                <div
                  id={overrideBodyId}
                  tabIndex={0}
                  className={`mt-2 min-h-[120px] max-h-[40vh] space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-card/40 p-2 text-xs ${SCROLL_AREA}`}
                >
                  {preprocessSource === "step5" ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11px] text-blue-200">
                      <span>Step5で保存された前処理設定を参照表示中（編集不可）</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-6 shrink-0 px-2 text-[10px]"
                        onClick={() => {
                          onChangePreprocessCustom?.(normalizeEvalPreprocess(step5Preprocess));
                          onChangePreprocessSource?.("custom");
                        }}
                      >
                        上書きを有効化
                      </Button>
                    </div>
                  ) : null}
                  {preprocessSource === "none" ? (
                    <p className="text-[11px] text-muted">
                      前処理なしを選択中です。編集するには「カスタム」プロファイルへ切り替えてください。
                    </p>
                  ) : null}
                  <label className={`inline-flex h-5 items-center gap-1.5 ${preEditable ? "cursor-pointer text-text" : "text-muted"}`}>
                    <input
                      type="checkbox"
                      disabled={!preEditable}
                      checked={displayedPre.grayscale === true}
                      onChange={(e) => patchCustomPre({ grayscale: e.target.checked })}
                    />
                    グレースケール
                  </label>
                  <div>
                    <label className="app-label">二値化</label>
                    <select
                      className="app-select h-7 py-0 text-xs"
                      disabled={!preEditable}
                      value={displayedPre.binarize ? displayedPre.binarizeMethod : "none"}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "none") {
                          patchCustomPre({ binarize: false });
                        } else {
                          patchCustomPre({ binarize: true, binarizeMethod: v });
                        }
                      }}
                    >
                      <option value="none">なし</option>
                      <option value="otsu">大津の二値化</option>
                      <option value="fixed">固定しきい値</option>
                    </select>
                  </div>
                  <div>
                    <label className="app-label">しきい値（固定しきい値のみ）</label>
                    <input
                      type="number"
                      min={0}
                      max={255}
                      step={1}
                      className="app-input h-7 py-0 text-xs"
                      disabled={!preEditable || !displayedPre.binarize || displayedPre.binarizeMethod !== "fixed"}
                      value={displayedPre.threshold}
                      onChange={(e) => patchCustomPre({ threshold: Number(e.target.value) })}
                    />
                  </div>
                  <p className="text-[10px] text-muted">
                    設定項目はStep5の評価データOCR前処理と共通です（処理定義・適用順も共通）。
                  </p>

                  {/* 小型プレビュー（手動更新。前処理適用後のOCR入力を確認する） */}
                  <div className="border-t border-border/50 pt-2">
                    <p className="mb-1 text-[11px] font-semibold text-muted">前処理プレビュー</p>
                    {sampleFiles.length === 0 ? (
                      <p className="text-[10px] text-muted">
                        {String(imageDir || "").trim()
                          ? "画像フォルダからサンプルを取得できませんでした"
                          : "評価用画像フォルダを設定するとプレビューできます"}
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <select
                            className="app-select h-6 min-w-0 flex-1 py-0 text-[11px]"
                            value={sampleName}
                            onChange={(e) => setSampleName(e.target.value)}
                          >
                            {sampleFiles.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 shrink-0 px-2 text-[10px]"
                            onClick={updatePreview}
                            disabled={previewLoading || !sampleName}
                          >
                            {previewLoading ? "生成中..." : "プレビュー更新"}
                          </Button>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[10px] text-muted">元画像</p>
                            <img
                              src={`${API_BASE}/image-builder/evaluation/directory-image?directory=${encodeURIComponent(imageDir)}&filename=${encodeURIComponent(sampleName)}&max_side=200`}
                              alt="元画像"
                              className="max-h-16 rounded border border-border/60 bg-white object-contain"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted">前処理後（OCR入力）</p>
                            {previewProcessed ? (
                              <img
                                src={previewProcessed}
                                alt="前処理後"
                                className="max-h-16 rounded border border-border/60 bg-white object-contain"
                              />
                            ) : (
                              <p className="text-[10px] text-muted/70">[プレビュー更新]で生成</p>
                            )}
                          </div>
                        </div>
                        {previewError ? <p className="mt-1 text-[10px] text-danger">{previewError}</p> : null}
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* 画像フォルダ・CSVパス（データセット選択時は自動設定されるため折り畳み） */}
            <details open={!selectedDataset} className="group rounded-xl border border-border/80 bg-card/45">
              <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
                <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden="true">
                  ▶
                </span>
                詳細設定（画像フォルダ・正解CSVのパス）
                {selectedDataset ? (
                  <span className="ml-auto text-[10px] font-normal text-muted">データセットから自動設定済み</span>
                ) : null}
              </summary>
              <div className="space-y-3 px-3 pb-3">
                <div>
                  <label className="app-label">評価用画像フォルダ</label>
                  <div className="flex gap-2">
                    <input
                      className="app-input flex-1"
                      value={imageDir}
                      onChange={(e) => setImageDir(e.target.value)}
                      placeholder="画像フォルダのパス"
                    />
                    <Button variant="secondary" onClick={onBrowseImageDir}>
                      参照
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="app-label">正解CSV（画像名, 正解文字列）</label>
                  <div className="flex gap-2">
                    <input
                      className="app-input flex-1"
                      value={gtCsv}
                      onChange={(e) => setGtCsv(e.target.value)}
                      placeholder="gt.csv のパス"
                    />
                    <Button variant="secondary" onClick={onBrowseGtCsv}>
                      参照
                    </Button>
                  </div>
                  <details className="mt-1 text-xs text-muted">
                    <summary className="cursor-pointer select-none text-muted/90 hover:text-text">
                      CSVの形式・記載ルールを表示（filename,text / 大文字小文字は区別）
                    </summary>
                    <div className="mt-1 space-y-1">
                      <p>
                        形式: 1列目 <code>filename</code>（画像ファイル名）、2列目 <code>text</code>（正解文字列）。
                      </p>
                      <pre className="overflow-x-auto rounded-md border border-border/70 bg-black/25 px-2 py-1 text-[11px] leading-5 text-slate-200">{`filename,text
sample_001.png,kt
sample_002.png,lt
sample_003.png,CHYBkt`}</pre>
                      <ul className="list-disc pl-4">
                        <li>画像フォルダ内のファイル名と <code>filename</code> が一致すること</li>
                        <li>
                          <code>text</code> は実運用の表記どおりに記載（例: <code>CHYBkt</code>）。
                          大文字と小文字は区別して評価されます（<code>KT</code> と <code>kt</code> は別物）
                        </li>
                        <li>ヘッダ行あり推奨（先頭が <code>filename</code>/<code>image</code> 等なら自動スキップ）</li>
                        <li>UTF-8 推奨</li>
                      </ul>
                    </div>
                  </details>
                </div>
              </div>
            </details>

            <div className="space-y-3 rounded-xl border border-border/80 bg-card/45 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200/90">評価対象モデル</p>
              <label className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/55 px-3 py-2 text-sm text-text">
                <input type="checkbox" checked={Boolean(includeBase)} onChange={(e) => setIncludeBase(e.target.checked)} />
                学習前モデル（eng.traineddata）を含めて比較する
              </label>
              <p className="text-xs text-muted">
                <span className="font-semibold text-slate-200">eng.traineddata</span> = Tesseract
                標準の英語モデル（未学習のベースライン）。学習後モデルと同一データで比較し、改善度を測ります。
              </p>
              <div>
                <label className="app-label">学習後モデル</label>
                <select className="app-select" value={trainedModel} onChange={(e) => setTrainedModel(e.target.value)}>
                  <option value="latest">latest（最新）</option>
                  {(tesseractModels || []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {(tesseractModels || []).length === 0 ? (
                  <p className="mt-1 text-xs text-amber-200">学習済みTesseractモデルがありません。学習完了後に評価できます。</p>
                ) : null}
              </div>
            </div>

            <div>
              <label className="app-label">評価時 whitelist</label>
              <select
                className="app-select"
                value={whitelistMode || "default"}
                onChange={(e) => setWhitelistMode(e.target.value)}
              >
                <option value="default">実運用（既定: A-Z + 0-9 + k,l,t）</option>
                <option value="none">whitelistなし（探索制約なし）</option>
                <option value="custom">カスタム（任意の文字を指定）</option>
              </select>
              {whitelistMode === "custom" ? (
                <input
                  className="app-input mt-2"
                  value={whitelistCustom}
                  onChange={(e) => setWhitelistCustom(e.target.value)}
                  placeholder={whitelistDefault}
                />
              ) : null}
              <p className="mt-1 text-xs text-muted">
                whitelist は推論時の探索制約です。実運用条件での測定には既定を使用してください。
              </p>
            </div>
          </div>

          {/* 下部固定領域: 実行ボタン・評価履歴（画面高が低くても評価実行へ到達できる） */}
          <div className="mt-3 shrink-0 space-y-3">
            <Button variant="primary" className="w-full" onClick={onRun} disabled={!canRun}>
              {loading ? "評価中..." : "評価を実行"}
            </Button>
            {loading ? (
              <div className="space-y-1">
                <p className="text-center text-[11px] text-muted">
                  評価実行中...（画像を順に前処理→推論→集計しています。件数×モデル数に応じて時間がかかります）
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-border/60">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/80" />
                </div>
              </div>
            ) : null}

            {/* 評価履歴（モデル×評価データセット×前処理で比較できる平坦テーブル） */}
            {historyRows.length > 0 ? (
              <div className="rounded-xl border border-border/80 bg-card/45 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">評価履歴</p>
                <div className={`max-h-40 overflow-y-auto ${SCROLL_AREA}`}>
                  <table className="w-full text-xs tabular-nums">
                    <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
                      <tr>
                        <th className="px-1.5 py-1 font-medium">モデル</th>
                        <th className="px-1.5 py-1 font-medium">評価データセット</th>
                        <th className="px-1.5 py-1 font-medium">Accuracy</th>
                        <th className="px-1.5 py-1 font-medium">前処理</th>
                        <th className="px-1.5 py-1 font-medium">日時</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.slice(0, 50).map((row) => (
                        <tr key={`${row.model}-${row.dataset}-${row.at}`} className="border-t border-border/50">
                          <td className="min-w-0 max-w-[8rem] truncate px-1.5 py-1 text-text" title={row.model}>
                            {row.model}
                          </td>
                          <td className="min-w-0 max-w-[7rem] truncate px-1.5 py-1 text-muted" title={row.dataset}>
                            {row.dataset}
                          </td>
                          <td className="px-1.5 py-1 font-semibold text-text">
                            {Number.isFinite(row.percent) ? `${row.percent}%` : "-"}
                          </td>
                          <td
                            className="min-w-0 max-w-[7rem] truncate px-1.5 py-1 text-muted"
                            title={historyPreprocessLabel(row)}
                          >
                            {historyPreprocessLabel(row)}
                          </td>
                          <td className="px-1.5 py-1 text-muted">{row.at ? row.at.slice(0, 16).replace("T", " ") : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        {/* 右: 評価結果（誤認識一覧だけが残り高を使用し内部スクロール） */}
        <Card
          title="評価結果"
          subtitle="認識率・改善率・誤認識一覧"
          className="xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden"
          actions={
            <Button size="sm" variant="secondary" onClick={onExportCsv} disabled={!result}>
              CSV出力
            </Button>
          }
        >
          {!result ? (
            <p className="text-muted">
              {loading ? "評価実行中です。完了すると結果が表示されます..." : "評価を実行すると結果が表示されます。"}
            </p>
          ) : (
            <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1">
              <div className="shrink-0 rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted">
                画像 {result.count} 件を評価（CSV {result.gt_count} 行 / 画像未検出 {result.skipped_missing_image} 件）
                {result.dataset ? (
                  <span className="ml-2 text-blue-200">
                    評価データセット: {result.dataset.dataset_name}（{result.dataset.image_count}枚 /{" "}
                    {String(result.dataset.created_at || "").slice(0, 16).replace("T", " ")}）
                  </span>
                ) : null}
                {/* 評価実行時にサーバーが実際に適用した前処理（UI選択中の値ではない） */}
                <span className="ml-2 min-w-0 text-emerald-200" title={resultPreLabel}>
                  評価条件: {resultPreLabel}
                </span>
              </div>

              {comparison ? (
                <div className="grid shrink-0 grid-cols-2 gap-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border/80 bg-card/55 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted/80">学習前モデル 認識率</p>
                    <p className="mt-1 text-lg font-semibold text-text">{pct(comparison.base_accuracy)}</p>
                    <p className="text-[10px] text-muted/70">eng.traineddata</p>
                  </div>
                  <div className="rounded-lg border border-success/50 bg-success/10 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted/80">学習後モデル 認識率</p>
                    <p className="mt-1 text-lg font-semibold text-success">{pct(comparison.trained_accuracy)}</p>
                    <p className="text-[10px] text-muted/70">{comparison.trained_label}</p>
                  </div>
                  <div className="rounded-lg border border-border/80 bg-card/55 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted/80">増減</p>
                    <p className="mt-1 text-lg font-semibold text-text">{comparison.delta_percent}pt</p>
                    <p className="text-[10px] text-muted/70">
                      正解数 {comparison.correct_delta >= 0 ? "+" : ""}
                      {comparison.correct_delta}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/80 bg-card/55 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted/80">改善率</p>
                    <p className="mt-1 text-lg font-semibold text-text">
                      {comparison.improvement_rate === null || comparison.improvement_rate === undefined
                        ? "-"
                        : pct(comparison.improvement_rate)}
                    </p>
                    <p className="text-[10px] text-muted/70">増減 ÷ 学習前</p>
                  </div>
                </div>
              ) : null}

              <table className="w-full shrink-0 text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-2 py-2 font-medium">モデル</th>
                    <th className="px-2 py-2 font-medium">認識率</th>
                    <th className="px-2 py-2 font-medium">正解 / 総数</th>
                    <th className="px-2 py-2 font-medium">誤認識</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.label} className="border-b border-border/70">
                      <td className="px-2 py-2 text-text">{t.label}</td>
                      <td className="px-2 py-2 text-text">{t.accuracy_percent}%</td>
                      <td className="px-2 py-2 text-muted">
                        {t.correct} / {t.total}
                      </td>
                      <td className="px-2 py-2 text-muted">{t.mismatch_count} 件</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 誤認識一覧: 残り高いっぱいに伸縮し、縦横とも内部スクロール（ヘッダーはsticky固定） */}
              <div className="flex flex-col xl:min-h-0 xl:flex-1">
                <p className="mb-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
                  誤認識一覧（{mismatchRows.length} 件）
                </p>
                <div
                  tabIndex={0}
                  className={`max-h-[380px] overflow-auto rounded-lg border border-border xl:max-h-none xl:min-h-0 xl:flex-1 ${SCROLL_AREA}`}
                >
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
                      <tr>
                        <th className="min-w-[8rem] px-2 py-2 font-medium">画像</th>
                        <th className="min-w-[5rem] px-2 py-2 font-medium">正解</th>
                        {targets.map((t) => (
                          <th key={t.label} className="min-w-[6rem] px-2 py-2 font-medium">
                            {t.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mismatchRows.map((row) => (
                        <tr key={row.image} className="border-t border-border/70">
                          <td className="break-all px-2 py-2 text-muted">{row.image}</td>
                          <td className="px-2 py-2 font-semibold text-text">{row.expected}</td>
                          {(row.results || []).map((r) => (
                            <td
                              key={`${row.image}-${r.model_label}`}
                              className={`px-2 py-2 ${r.match ? "text-success" : "text-danger"}`}
                            >
                              {r.prediction || "(空)"}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {mismatchRows.length === 0 ? (
                        <tr>
                          <td colSpan={2 + targets.length} className="px-3 py-6 text-center text-muted">
                            誤認識はありません
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
