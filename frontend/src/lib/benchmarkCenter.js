// Benchmark Center（既存資産の横断比較ビュー）の純ロジック。
// 新しい評価ロジックは実装しない——比較・勝敗判定・推奨は既存の lib/modelCompare.js を
// そのまま再利用する（buildModelComparison/buildWinLoss/recommendModel/COMPARE_METRICS）。
// このファイルは「Experiment由来の評価結果を modelCompare.js が期待する形へ変換する」
// アダプター役と、Benchmark Center固有の表示専用ロジック（フィルタ・並び替え・
// レーダーチャート・推移グラフ・CSV/Markdown/JSON出力）のみを持つ。

// 比較行（services/benchmark_center.py list_comparable_models の1件）を
// lib/modelEval.js の normalizeEvalEntry が読める生データ形式へ変換し、
// 既存の latestEvalOf/buildModelComparison をそのまま呼べるようにする。
// 評価の無いモデルはキー自体を作らない（推測補完しない）。
export function buildEvalHistoryFromRows(rows) {
  const history = {};
  for (const row of rows || []) {
    if (!row.evaluation) continue;
    history[row.model_name] = {
      benchmark_center: {
        percent: row.evaluation.accuracy_percent,
        at: row.evaluation.evaluated_at || "",
        cer: row.evaluation.cer,
        char_accuracy: row.evaluation.char_accuracy,
        dataset: row.dataset_name,
        confusions: row.evaluation.confusions || [],
      },
    };
  }
  return history;
}

// Precision/Recall/F1/WER/推論速度は、既存のどの評価ロジックにも算出処理が無いため
// 提供しない（新しい評価ロジックを作らないという方針のため）。比較表では「未対応」表示にする。
export const UNAVAILABLE_METRIC_LABELS = ["WER", "Precision", "Recall", "F1", "推論速度"];

export function matchesBenchmarkCenterFilters(row, filters = {}) {
  const query = String(filters.query || "").trim().toLowerCase();
  if (filters.datasetId && row.dataset_id !== filters.datasetId) return false;
  if (filters.engine && row.engine !== filters.engine) return false;
  if (
    filters.preprocessVersion !== undefined &&
    filters.preprocessVersion !== null &&
    filters.preprocessVersion !== "" &&
    Number(row.preprocess_version) !== Number(filters.preprocessVersion)
  ) {
    return false;
  }
  if (filters.experimentId && row.experiment_id !== filters.experimentId) return false;
  if (query) {
    const haystack = [row.model_name, row.dataset_name, row.dataset_id, row.experiment_id, row.engine]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

const SORT_ACCESSORS = {
  model_name: (row) => row.model_name.toLowerCase(),
  engine: (row) => row.engine.toLowerCase(),
  model_size_mb: (row) => (Number.isFinite(row.model_size_mb) ? row.model_size_mb : Infinity),
  cer: (row) => (Number.isFinite(row.evaluation?.cer) ? row.evaluation.cer : Infinity),
  accuracy_percent: (row) => (Number.isFinite(row.evaluation?.accuracy_percent) ? row.evaluation.accuracy_percent : -Infinity),
};

// key未対応時は入力順のまま返す（不要な例外を出さない）
export function sortBenchmarkRows(rows, key, dir = "asc") {
  const list = Array.isArray(rows) ? [...rows] : [];
  const accessor = SORT_ACCESSORS[key];
  if (!accessor) return list;
  const factor = dir === "desc" ? -1 : 1;
  return list.sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}

// モデルサイズ最小（既存の評価ロジックとは無関係の単純比較。新しい評価ロジックではない）
export function bestModelSize(rows) {
  const withSize = (rows || []).filter((row) => Number.isFinite(row.model_size_mb));
  if (withSize.length === 0) return null;
  return withSize.reduce((best, row) => (row.model_size_mb < best.model_size_mb ? row : best), withSize[0]);
}

// レーダーチャート軸: 要求仕様はAccuracy/Precision/Recall/F1だが、Precision/Recall/F1は
// 既存のどの評価ロジックにも算出処理が無いため提供できない（新しい評価ロジックを作らない
// という方針のため）。実在する3指標（完全一致率・CER・文字正解率）で代替する
export const RADAR_AXES = [
  { key: "percent", label: "完全一致率", fromEval: (e) => e.percent },
  { key: "cerInverted", label: "CER精度（100-CER%）", fromEval: (e) => (Number.isFinite(e.cer) ? 100 - e.cer * 100 : null) },
  { key: "charAccuracy", label: "文字正解率", fromEval: (e) => (Number.isFinite(e.charAccuracy) ? e.charAccuracy * 100 : null) },
];

export function buildRadarSeries(rows, evalHistoryLatestOf) {
  return (rows || [])
    .map((row) => {
      const latest = evalHistoryLatestOf(row.model_name);
      if (!latest) return null;
      const values = RADAR_AXES.map((axis) => {
        const v = axis.fromEval(latest);
        return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
      });
      return { modelName: row.model_name, values };
    })
    .filter(Boolean);
}

// 推移グラフ: Experiment順（experiment_id文字列昇順=作成順）にAccuracy/CERを並べる
export function buildTrendByExperiment(rows) {
  return (rows || [])
    .filter((row) => row.experiment_id && row.evaluation)
    .sort((a, b) => a.experiment_id.localeCompare(b.experiment_id))
    .map((row) => ({
      experimentId: row.experiment_id,
      modelName: row.model_name,
      accuracyPercent: row.evaluation.accuracy_percent,
      cerPercent: Number.isFinite(row.evaluation.cer) ? row.evaluation.cer * 100 : null,
    }));
}

// ---------- レポート出力（CSV / Markdown / JSON） ----------

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsvLines(rows) {
  const header = [
    "model_name",
    "engine",
    "dataset_id",
    "dataset_name",
    "experiment_id",
    "preprocess_version",
    "model_size_mb",
    "accuracy_percent",
    "cer",
    "char_accuracy",
  ];
  const lines = [header.map(escapeCsv).join(",")];
  for (const row of rows || []) {
    lines.push(
      [
        row.model_name,
        row.engine,
        row.dataset_id,
        row.dataset_name,
        row.experiment_id,
        row.preprocess_version ?? "",
        row.model_size_mb ?? "",
        row.evaluation?.accuracy_percent ?? "",
        row.evaluation?.cer ?? "",
        row.evaluation?.char_accuracy ?? "",
      ]
        .map(escapeCsv)
        .join(",")
    );
  }
  return lines;
}

function fmtPct(value, digits = 1) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : "未対応";
}

// Markdown例（task.md記載の形式に準拠: 見出し→Dataset→Best Accuracy→Best CER）
export function toMarkdownReport(rows, { datasetLabel = "", bestAccuracyRow = null, bestCerRow = null } = {}) {
  const lines = ["# Benchmark Report", ""];
  if (datasetLabel) {
    lines.push("## Dataset", "", datasetLabel, "");
  }
  lines.push("## Best Accuracy", "");
  lines.push(
    bestAccuracyRow
      ? `${bestAccuracyRow.model_name} ${fmtPct(bestAccuracyRow.evaluation?.accuracy_percent)}`
      : "評価済みモデルがありません"
  );
  lines.push("", "## Best CER", "");
  lines.push(
    bestCerRow
      ? `${bestCerRow.model_name} ${Number.isFinite(bestCerRow.evaluation?.cer) ? bestCerRow.evaluation.cer.toFixed(3) : "未対応"}`
      : "評価済みモデルがありません"
  );
  lines.push("", "## 比較対象モデル", "");
  for (const row of rows || []) {
    const cer = Number.isFinite(row.evaluation?.cer) ? row.evaluation.cer.toFixed(3) : "未評価";
    const acc = fmtPct(row.evaluation?.accuracy_percent);
    lines.push(`- ${row.model_name}（${row.engine}）: Accuracy ${acc} / CER ${cer}`);
  }
  return lines.join("\n");
}

export function toJsonReport(rows, meta = {}) {
  return JSON.stringify({ ...meta, models: rows || [] }, null, 2);
}

// ---------- 推薦（既存のwin-count推薦=recommendModelを「総合」にそのまま利用。
//             Accuracy重視/CER重視/軽量重視は単純な最良値抽出で、新しい評価ロジックではない） ----------

export function buildBenchmarkRecommendations(rows) {
  const withEval = (rows || []).filter((row) => row.evaluation);
  const cards = [];
  if (withEval.length > 0) {
    const bestAcc = withEval.reduce((best, row) =>
      (row.evaluation.accuracy_percent ?? -Infinity) > (best.evaluation.accuracy_percent ?? -Infinity) ? row : best
    );
    cards.push({ id: "accuracy", title: "Accuracy重視", modelName: bestAcc.model_name, value: fmtPct(bestAcc.evaluation.accuracy_percent) });
    const bestCer = withEval.reduce((best, row) =>
      (row.evaluation.cer ?? Infinity) < (best.evaluation.cer ?? Infinity) ? row : best
    );
    cards.push({
      id: "cer",
      title: "CER重視",
      modelName: bestCer.model_name,
      value: Number.isFinite(bestCer.evaluation.cer) ? bestCer.evaluation.cer.toFixed(3) : "未対応",
    });
  }
  const sized = bestModelSize(rows);
  if (sized) {
    cards.push({ id: "size", title: "軽量重視（モデルサイズ最小）", modelName: sized.model_name, value: `${sized.model_size_mb}MB` });
  }
  return cards;
}
