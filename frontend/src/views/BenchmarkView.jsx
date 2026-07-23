import { useMemo, useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import { API_BASE, request } from "../lib/api";
import {
  CASE_FILTERS,
  PURPOSE_LABELS,
  filterCases,
  formatMs,
  formatRate,
  pageCases,
  profileMismatchWarning,
} from "../lib/benchmarkLogic";

const SCROLL_AREA = "dark-scroll [overscroll-behavior:contain] [scrollbar-gutter:stable]";
const PAGE_SIZE = 50;

function shortHash(hash) {
  const value = String(hash || "").replace(/^sha256:/, "");
  return value ? value.slice(0, 8) : "-";
}

export default function BenchmarkView({
  projectId,
  items = [],
  balanceWeights = { accuracy: 0.7, speed: 0.2, stability: 0.1 },
  engines = [],
  ocrModels = [],
  loading = false,
  onRefresh,
  onRun,
  onUpdateWeights,
  onOpenJobs,
}) {
  // 実行フォーム
  const [form, setForm] = useState({ name: "", image_dir: "", gt_csv: "", dataset_id: "", warmup_runs: 1, psm: 7, whitelist: "" });
  const [selectedEngines, setSelectedEngines] = useState({
    tesseract_model: false,
    tesseract_base: true,
    paddleocr_official: false,
    paddleocr_custom: false,
  });
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedPaddleModel, setSelectedPaddleModel] = useState("");
  // 前処理（全エンジン共通・開始時に一度だけ適用。実効HashがProfile Hashへ含まれる）
  const [preprocessMode, setPreprocessMode] = useState("none");
  const [manualPre, setManualPre] = useState({ grayscale: true, binarize: false, binarize_method: "otsu", threshold: 127 });
  const [trainingPreModel, setTrainingPreModel] = useState("");
  // 詳細・ケース表示
  const [detail, setDetail] = useState(null);
  const [caseFilter, setCaseFilter] = useState("all");
  const [caseEngine, setCaseEngine] = useState("");
  const [casePage, setCasePage] = useState(1);
  // 履歴比較（A/B）
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  // 重み編集
  const [weightsDraft, setWeightsDraft] = useState(null);

  const tessModels = useMemo(
    () => ocrModels.filter((m) => String(m?.name || m).endsWith(".tess.json")).map((m) => String(m?.name || m)),
    [ocrModels]
  );
  const paddleModels = useMemo(
    () => ocrModels.filter((m) => String(m?.name || m).endsWith(".ocr.json")).map((m) => String(m?.name || m)),
    [ocrModels]
  );

  async function openDetail(benchmarkId) {
    try {
      const data = await request(`/api/benchmarks/${encodeURIComponent(benchmarkId)}?project_id=${encodeURIComponent(projectId)}`);
      setDetail(data?.item || null);
      setCaseFilter("all");
      setCaseEngine("");
      setCasePage(1);
    } catch {
      setDetail(null);
    }
  }

  function buildRunPayload() {
    const specs = [];
    if (selectedEngines.tesseract_model && selectedModel) {
      specs.push({ engine: "tesseract_model", model: selectedModel, psm: Number(form.psm) || 7, whitelist: form.whitelist === "" ? null : form.whitelist });
    }
    if (selectedEngines.tesseract_base) {
      specs.push({ engine: "tesseract_base", psm: Number(form.psm) || 7, whitelist: form.whitelist === "" ? null : form.whitelist });
    }
    if (selectedEngines.paddleocr_official) {
      specs.push({ engine: "paddleocr_official" });
    }
    if (selectedEngines.paddleocr_custom && selectedPaddleModel) {
      specs.push({ engine: "paddleocr_custom", model: selectedPaddleModel });
    }
    let preprocess = null;
    if (preprocessMode === "manual") {
      preprocess = { mode: "manual", settings: { ...manualPre, threshold: Number(manualPre.threshold) || 127 } };
    } else if (preprocessMode === "training") {
      preprocess = { mode: "training", model: trainingPreModel };
    } else if (preprocessMode === "project") {
      preprocess = { mode: "project" };
    }
    return {
      name: form.name,
      image_dir: form.image_dir,
      gt_csv: form.gt_csv,
      dataset_id: form.dataset_id,
      warmup_runs: Number(form.warmup_runs) || 0,
      engines: specs,
      preprocess,
    };
  }

  const filteredCases = useMemo(
    () => filterCases(detail?.cases || [], caseFilter, caseEngine),
    [detail, caseFilter, caseEngine]
  );
  const paged = useMemo(() => pageCases(filteredCases, casePage, PAGE_SIZE), [filteredCases, casePage]);
  const engineKeys = useMemo(() => (detail?.results || []).map((r) => r.engine_key), [detail]);

  const benchA = items.find((i) => i.benchmark_id === compareA);
  const benchB = items.find((i) => i.benchmark_id === compareB);
  const compareWarning = benchA && benchB ? profileMismatchWarning(benchA, benchB) : "";

  return (
    <div className="space-y-4">
      <Card
        title="Benchmark実行"
        subtitle="同一データ・同一条件で複数エンジンを公平比較します（実行はジョブ管理経由・非同期）"
        actions={
          <Button size="sm" variant="secondary" onClick={onOpenJobs}>
            ジョブ管理を開く
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className="app-input h-8 text-xs" placeholder="Benchmark名（任意）" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="app-input h-8 text-xs" placeholder="データセットID（任意）" value={form.dataset_id} onChange={(e) => setForm({ ...form, dataset_id: e.target.value })} />
            </div>
            <input className="app-input h-8 w-full text-xs" placeholder="評価画像フォルダ（例: data/projects/xxx/outputs/eval_xxx/images）" value={form.image_dir} onChange={(e) => setForm({ ...form, image_dir: e.target.value })} />
            <input className="app-input h-8 w-full text-xs" placeholder="正解CSV（画像名,正解文字列）" value={form.gt_csv} onChange={(e) => setForm({ ...form, gt_csv: e.target.value })} />
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] text-muted">
                PSM（Tesseract）
                <input type="number" className="app-input mt-0.5 h-8 w-full text-xs" value={form.psm} onChange={(e) => setForm({ ...form, psm: e.target.value })} />
              </label>
              <label className="text-[11px] text-muted">
                Whitelist（空=なし）
                <input className="app-input mt-0.5 h-8 w-full text-xs" value={form.whitelist} onChange={(e) => setForm({ ...form, whitelist: e.target.value })} />
              </label>
              <label className="text-[11px] text-muted" title="ウォームアップは統計へ含めず回数のみ記録します（公平性）">
                ウォームアップ回数
                <input type="number" min="0" className="app-input mt-0.5 h-8 w-full text-xs" value={form.warmup_runs} onChange={(e) => setForm({ ...form, warmup_runs: e.target.value })} />
              </label>
            </div>
            {/* 前処理（全エンジン共通・開始時に一度だけ適用。実効HashがProfile Hashへ含まれる） */}
            <div className="rounded-lg border border-border bg-card/45 px-2 py-1.5">
              <p className="mb-1 text-[11px] font-semibold text-muted" title="前処理済み画像は開始時に一度だけ生成し、全エンジンへ同じ最終入力を渡します">
                前処理（全エンジン共通）
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select className="app-select h-8 text-xs" value={preprocessMode} onChange={(e) => setPreprocessMode(e.target.value)}>
                  <option value="none">なし（元画像のまま）</option>
                  <option value="manual">手動設定（グレースケール・二値化）</option>
                  <option value="training">学習時前処理（モデルの記録）</option>
                  <option value="project">プロジェクトの現在の前処理</option>
                </select>
                {preprocessMode === "manual" ? (
                  <>
                    <label className="flex items-center gap-1 text-[11px] text-text">
                      <input type="checkbox" checked={manualPre.grayscale} onChange={(e) => setManualPre({ ...manualPre, grayscale: e.target.checked })} />
                      グレースケール
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-text">
                      <input type="checkbox" checked={manualPre.binarize} onChange={(e) => setManualPre({ ...manualPre, binarize: e.target.checked })} />
                      二値化
                    </label>
                    {manualPre.binarize ? (
                      <>
                        <select className="app-select h-8 text-xs" value={manualPre.binarize_method} onChange={(e) => setManualPre({ ...manualPre, binarize_method: e.target.value })}>
                          <option value="otsu">Otsu</option>
                          <option value="fixed">固定しきい値</option>
                        </select>
                        {manualPre.binarize_method === "fixed" ? (
                          <input type="number" min="0" max="255" className="app-input h-8 w-20 text-xs" value={manualPre.threshold} onChange={(e) => setManualPre({ ...manualPre, threshold: e.target.value })} />
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : null}
                {preprocessMode === "training" ? (
                  <select className="app-select h-8 text-xs" value={trainingPreModel} onChange={(e) => setTrainingPreModel(e.target.value)}>
                    <option value="">前処理の由来モデルを選択...</option>
                    {tessModels.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-muted">対象エンジン（未導入のエンジンは選択不可）</p>
            {engines.map((engine) => {
              const selectable = engine.implemented && engine.available;
              return (
                <div key={engine.key} className={`rounded-lg border px-2 py-1.5 ${selectable ? "border-border bg-card/45" : "border-border/50 bg-card/25 opacity-70"}`}>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      disabled={!selectable}
                      checked={Boolean(selectedEngines[engine.key])}
                      onChange={(e) => setSelectedEngines({ ...selectedEngines, [engine.key]: e.target.checked })}
                    />
                    <span className={selectable ? "text-text" : "text-muted"}>{engine.label}</span>
                    {!engine.implemented || !engine.available ? (
                      <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">
                        {engine.availability_note || "未導入・利用不可"}
                      </span>
                    ) : engine.availability_note ? (
                      <span className="rounded-full border border-border/60 bg-card/40 px-2 py-0.5 text-[10px] text-muted">
                        {engine.availability_note}
                      </span>
                    ) : null}
                  </label>
                  {engine.key === "tesseract_model" && selectedEngines.tesseract_model ? (
                    <select className="app-select mt-1 h-8 w-full text-xs" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                      <option value="">登録モデルを選択...</option>
                      {tessModels.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {engine.key === "paddleocr_custom" && selectedEngines.paddleocr_custom ? (
                    <select className="app-select mt-1 h-8 w-full text-xs" value={selectedPaddleModel} onChange={(e) => setSelectedPaddleModel(e.target.value)}>
                      <option value="">自作PaddleOCRモデルを選択...</option>
                      {paddleModels.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <p className="mt-0.5 pl-6 text-[10px] text-muted">{engine.description}</p>
                </div>
              );
            })}
            <Button size="sm" onClick={() => onRun?.(buildRunPayload())} disabled={loading}>
              Benchmarkを実行（Job作成）
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title={`Benchmark履歴（${items.length}件）`}
        subtitle="行クリックで詳細（Leaderboard・画像単位比較・CSV）を表示"
        actions={
          <Button size="sm" variant="secondary" onClick={onRefresh} disabled={loading}>
            {loading ? "更新中..." : "更新"}
          </Button>
        }
      >
        <div className={`max-h-[30vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
          <table className="min-w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
              <tr>
                <th className="px-2 py-1.5 font-medium">比較A/B</th>
                <th className="px-2 py-1.5 font-medium">Benchmark ID</th>
                <th className="px-2 py-1.5 font-medium">名前</th>
                <th className="px-2 py-1.5 font-medium">実行日時</th>
                <th className="px-2 py-1.5 font-medium">エンジン数</th>
                <th className="px-2 py-1.5 font-medium">1位（CER最小）</th>
                <th className="px-2 py-1.5 font-medium">Profile</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const top = (item.results || [])[0];
                return (
                  <tr key={item.benchmark_id} className={`cursor-pointer border-t border-border/60 hover:bg-card/60 ${detail?.benchmark_id === item.benchmark_id ? "bg-accent/10" : ""}`} onClick={() => openDetail(item.benchmark_id)}>
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <label className="mr-1 text-[10px] text-muted">
                        A<input type="radio" name="bmA" className="ml-0.5" checked={compareA === item.benchmark_id} onChange={() => setCompareA(item.benchmark_id)} />
                      </label>
                      <label className="text-[10px] text-muted">
                        B<input type="radio" name="bmB" className="ml-0.5" checked={compareB === item.benchmark_id} onChange={() => setCompareB(item.benchmark_id)} />
                      </label>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="model-id-font model-id-text--sm text-blue-200">{item.benchmark_id}</span>
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-1.5 text-text">{item.name || "-"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted">{String(item.created_at || "").slice(5, 16).replace("T", " ")}</td>
                    <td className="px-2 py-1.5 text-muted">{(item.results || []).length}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-success">
                      {top ? `${top.label}（CER ${formatRate(top.cer)}）` : "-"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-muted" title={item.profile?.profile_hash}>
                      {shortHash(item.profile?.profile_hash)}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
                    Benchmark履歴がありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {benchA && benchB ? (
          <div className="mt-2 rounded-lg border border-border bg-card/45 px-3 py-2 text-xs">
            <p className="font-semibold text-muted">履歴比較: {benchA.benchmark_id} vs {benchB.benchmark_id}</p>
            {compareWarning ? <p className="mt-1 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-amber-200">{compareWarning}</p> : <p className="mt-1 text-success">Profile一致（同一条件の比較です）</p>}
            <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2">
              {[benchA, benchB].map((bench) => (
                <div key={bench.benchmark_id} className="rounded border border-border/60 px-2 py-1">
                  <p className="text-muted">{bench.benchmark_id} {bench.name || ""}</p>
                  {(bench.results || []).map((r) => (
                    <p key={r.engine_key} className="tabular-nums text-text">
                      {r.label}: CER {formatRate(r.cer)} / 完全一致 {formatRate(r.exact_match_rate)} / 失敗{r.failed}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {detail ? (
        <Card
          title={`Leaderboard: ${detail.benchmark_id}${detail.name ? `（${detail.name}）` : ""}`}
          subtitle={`CER昇順（同率は 完全一致率降順 → 失敗数昇順 → 平均時間昇順） / 前処理: ${
            detail.preprocess?.mode && detail.preprocess.mode !== "none"
              ? `${detail.preprocess.mode}（${shortHash(detail.preprocess.hash)}）`
              : "なし"
          }`}
          actions={
            <div className="flex gap-1.5">
              {["summary", "cases", "confusions"].map((kind) => (
                <a
                  key={kind}
                  className="rounded-lg border border-border bg-card/60 px-2 py-1 text-[11px] text-blue-200 hover:bg-card"
                  href={`${API_BASE}/api/benchmarks/${encodeURIComponent(detail.benchmark_id)}/export?kind=${kind}&project_id=${encodeURIComponent(projectId)}`}
                >
                  {kind} CSV（Excel対応）
                </a>
              ))}
            </div>
          }
        >
          <div className={`overflow-x-auto rounded-lg border border-border ${SCROLL_AREA}`}>
            <table className="min-w-full text-xs tabular-nums">
              <thead className="bg-card/90 text-left text-muted">
                <tr>
                  {["#", "エンジン", "CER", "文字正解率", "完全一致率", "正解", "置換/挿入/脱落", "失敗", "Cold Start", "平均", "P50", "P95", "PeakMem", "Balance"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(detail.results || []).map((r) => (
                  <tr key={r.engine_key} className={`border-t border-border/60 ${r.rank === 1 ? "bg-success/5" : ""}`}>
                    <td className="px-2 py-1.5 text-muted">{r.rank}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-text">{r.label}</td>
                    <td className={`px-2 py-1.5 ${r.rank === 1 ? "font-semibold text-success" : "text-text"}`}>{formatRate(r.cer)}</td>
                    <td className="px-2 py-1.5 text-muted">{formatRate(r.char_accuracy)}</td>
                    <td className="px-2 py-1.5 text-muted">{formatRate(r.exact_match_rate)}</td>
                    <td className="px-2 py-1.5 text-muted">{r.correct}/{r.total}</td>
                    <td className="px-2 py-1.5 text-muted">{r.substitutions}/{r.insertions}/{r.deletions}</td>
                    <td className={`px-2 py-1.5 ${r.failed ? "text-danger" : "text-muted"}`}>{r.failed}</td>
                    <td className="px-2 py-1.5 text-muted">{r.cold_start_seconds}s{r.warmup_runs ? `（WU${r.warmup_runs}）` : ""}</td>
                    <td className="px-2 py-1.5 text-muted">{formatMs(r.mean_time_ms)}</td>
                    <td className="px-2 py-1.5 text-muted">{formatMs(r.p50_time_ms)}</td>
                    <td className="px-2 py-1.5 text-muted">{formatMs(r.p95_time_ms)}</td>
                    <td className="px-2 py-1.5 text-muted">{r.peak_memory_mb === null || r.peak_memory_mb === undefined ? "取得不能" : `${r.peak_memory_mb}MB`}</td>
                    <td className="px-2 py-1.5 text-muted">
                      {(detail.purpose_picks?.scores || []).find((s) => s.engine_key === r.engine_key)?.balance_score ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 用途別ベスト＋バランス式・重み設定 */}
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-xs">
              <p className="mb-1 font-semibold text-muted">用途別ベスト</p>
              {Object.entries(PURPOSE_LABELS).map(([key, label]) => (
                <p key={key} className="text-text">
                  <span className="text-muted">{label}: </span>
                  {detail.purpose_picks?.[key] || "-"}
                </p>
              ))}
              <p className="mt-1 border-t border-border/50 pt-1 text-[10px] text-muted">{detail.purpose_picks?.balance_formula}</p>
            </div>
            <div className="rounded-lg border border-border bg-card/45 px-3 py-2 text-xs">
              <p className="mb-1 font-semibold text-muted">バランス重み（プロジェクト設定・合計1へ正規化）</p>
              <div className="flex flex-wrap items-end gap-2">
                {["accuracy", "speed", "stability"].map((key) => (
                  <label key={key} className="text-[11px] text-muted">
                    {key === "accuracy" ? "精度" : key === "speed" ? "速度" : "安定性"}
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      className="app-input mt-0.5 h-8 w-20 text-xs"
                      value={(weightsDraft || balanceWeights)[key]}
                      onChange={(e) => setWeightsDraft({ ...(weightsDraft || balanceWeights), [key]: e.target.value })}
                    />
                  </label>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!weightsDraft}
                  onClick={() => {
                    onUpdateWeights?.(weightsDraft);
                    setWeightsDraft(null);
                  }}
                >
                  保存
                </Button>
              </div>
            </div>
          </div>

          {/* 画像単位比較（フィルタ＋ページング） */}
          <div className="mt-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
              <p className="font-semibold text-muted">画像単位比較（{paged.total}件）</p>
              <select className="app-select h-8 text-xs" value={caseFilter} onChange={(e) => { setCaseFilter(e.target.value); setCasePage(1); }}>
                {CASE_FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              {caseFilter === "only_correct" ? (
                <select className="app-select h-8 text-xs" value={caseEngine} onChange={(e) => { setCaseEngine(e.target.value); setCasePage(1); }}>
                  <option value="">Engineを選択...</option>
                  {engineKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              ) : null}
              <span className="ml-auto flex items-center gap-1 text-muted">
                <Button size="sm" variant="secondary" disabled={paged.page <= 1} onClick={() => setCasePage(paged.page - 1)}>
                  前へ
                </Button>
                {paged.page}/{paged.totalPages}
                <Button size="sm" variant="secondary" disabled={paged.page >= paged.totalPages} onClick={() => setCasePage(paged.page + 1)}>
                  次へ
                </Button>
              </span>
            </div>
            <div className={`max-h-[40vh] overflow-auto rounded-lg border border-border ${SCROLL_AREA}`}>
              <table className="min-w-full text-xs tabular-nums">
                <thead className="sticky top-0 z-10 bg-card/90 text-left text-muted backdrop-blur">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">画像</th>
                    <th className="px-2 py-1.5 font-medium">正解</th>
                    {engineKeys.map((key) => (
                      <th key={key} className="whitespace-nowrap px-2 py-1.5 font-medium">{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((row) => (
                    <tr key={row.image} className="border-t border-border/60">
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted">{row.image}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-text">{row.expected}</td>
                      {engineKeys.map((key) => {
                        const engineCase = row.engines?.[key];
                        return (
                          <td key={key} className="whitespace-nowrap px-2 py-1.5">
                            {engineCase ? (
                              <span className={engineCase.failed ? "text-danger" : engineCase.match ? "text-success" : "text-amber-200"}>
                                {engineCase.failed ? "失敗" : engineCase.prediction || "(空)"}
                                <span className="ml-1 text-[10px] text-muted">{formatMs(engineCase.time_ms)}</span>
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
