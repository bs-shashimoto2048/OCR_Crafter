import Card from "../components/Card";
import Button from "../components/Button";

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "-";
}

// モデル別評価履歴（{model: {dataset: {percent, at}}}）を新しい順の行へ平坦化する
function flattenEvalHistory(evalHistory) {
  const rows = [];
  for (const [model, datasets] of Object.entries(evalHistory || {})) {
    for (const [dataset, entry] of Object.entries(datasets || {})) {
      rows.push({
        model,
        dataset,
        percent: Number(entry?.percent),
        at: String(entry?.at || ""),
      });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  return rows;
}

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
}) {
  const targets = Array.isArray(result?.targets) ? result.targets : [];
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const comparison = result?.comparison || null;
  const canRun = String(imageDir || "").trim() !== "" && String(gtCsv || "").trim() !== "" && !loading;
  const mismatchRows = rows.filter((row) => (row.results || []).some((r) => !r.match));
  const selectedDataset = datasets.find((row) => row.id === selectedDatasetId) || null;
  const historyRows = flattenEvalHistory(evalHistory);

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

  return (
    <div className="grid grid-cols-[4fr_6fr] gap-4">
      <Card title="評価設定" subtitle="学習前後のモデルを同一データで比較評価します">
        <div className="space-y-3">
          {/* 評価データセット（Step5で作成したデータを選択すると image_dir / gt_csv が自動反映される） */}
          <div className="rounded-xl border border-border/80 bg-card/45 p-3">
            <label className="app-label">評価データセット</label>
            <div className="flex gap-2">
              <select
                className="app-select flex-1"
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

          {/* 画像フォルダ・CSVパス（データセット選択時は自動設定されるため折り畳み） */}
          <details open={!selectedDataset} className="group rounded-xl border border-border/80 bg-card/45">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-text transition hover:bg-card/70 [&::-webkit-details-marker]:hidden">
              <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden="true">
                ▶
              </span>
              詳細設定（画像フォルダ・正解CSVのパス）
              {selectedDataset ? <span className="ml-auto text-[10px] font-normal text-muted">データセットから自動設定済み</span> : null}
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
                <p>形式: 1列目 <code>filename</code>（画像ファイル名）、2列目 <code>text</code>（正解文字列）。</p>
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
              <span className="font-semibold text-slate-200">eng.traineddata</span> = Tesseract 標準の英語モデル（未学習のベースライン）。学習後モデルと同一データで比較し、改善度を測ります。
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
                <p className="mt-1 text-xs text-amber-200">
                  学習済みTesseractモデルがありません。学習完了後に評価できます。
                </p>
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

          <Button variant="primary" className="w-full" onClick={onRun} disabled={!canRun}>
            {loading ? "評価中..." : "評価を実行"}
          </Button>

          {/* 評価履歴（モデル×評価データセットの両軸で比較できる平坦テーブル） */}
          {historyRows.length > 0 ? (
            <div className="rounded-xl border border-border/80 bg-card/45 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">評価履歴</p>
              <div className="dark-scroll max-h-48 overflow-y-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead className="sticky top-0 bg-card/90 text-left text-muted backdrop-blur">
                    <tr>
                      <th className="px-1.5 py-1 font-medium">モデル</th>
                      <th className="px-1.5 py-1 font-medium">評価データセット</th>
                      <th className="px-1.5 py-1 font-medium">Accuracy</th>
                      <th className="px-1.5 py-1 font-medium">日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.slice(0, 50).map((row) => (
                      <tr key={`${row.model}-${row.dataset}-${row.at}`} className="border-t border-border/50">
                        <td className="min-w-0 max-w-[10rem] truncate px-1.5 py-1 text-text" title={row.model}>
                          {row.model}
                        </td>
                        <td className="min-w-0 max-w-[9rem] truncate px-1.5 py-1 text-muted" title={row.dataset}>
                          {row.dataset}
                        </td>
                        <td className="px-1.5 py-1 font-semibold text-text">
                          {Number.isFinite(row.percent) ? `${row.percent}%` : "-"}
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

      <Card
        title="評価結果"
        subtitle="認識率・改善率・誤認識一覧"
        actions={
          <Button size="sm" variant="secondary" onClick={onExportCsv} disabled={!result}>
            CSV出力
          </Button>
        }
      >
        {!result ? (
          <p className="text-muted">評価を実行すると結果が表示されます。</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted">
              画像 {result.count} 件を評価（CSV {result.gt_count} 行 / 画像未検出 {result.skipped_missing_image} 件）
              {result.dataset ? (
                <span className="ml-2 text-blue-200">
                  評価データセット: {result.dataset.dataset_name}（{result.dataset.image_count}枚 /{" "}
                  {String(result.dataset.created_at || "").slice(0, 16).replace("T", " ")}）
                </span>
              ) : null}
            </div>

            {comparison ? (
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
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
                  <p className="text-[10px] text-muted/70">正解数 {comparison.correct_delta >= 0 ? "+" : ""}{comparison.correct_delta}</p>
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

            <table className="w-full text-sm">
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

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                誤認識一覧（{mismatchRows.length} 件）
              </p>
              <div className="max-h-[380px] overflow-auto rounded-lg border border-border">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-card/90 text-left text-muted backdrop-blur">
                    <tr>
                      <th className="px-2 py-2 font-medium">画像</th>
                      <th className="px-2 py-2 font-medium">正解</th>
                      {targets.map((t) => (
                        <th key={t.label} className="px-2 py-2 font-medium">
                          {t.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mismatchRows.map((row) => (
                      <tr key={row.image} className="border-t border-border/70">
                        <td className="px-2 py-2 text-muted break-all">{row.image}</td>
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
  );
}
