// OCR Benchmark Suite の純ロジック（画像単位ケースのフィルタ・ページング・履歴比較の警告）。
// サーバー側（services/benchmark.py）がLeaderboard・用途別ベストを計算し、
// ここではUI表示のための加工のみを行う（CER計算等の重複実装をしない）。

// 画像単位比較のフィルタ定義（only_correct はエンジン選択が必要）
export const CASE_FILTERS = [
  { key: "all", label: "全件" },
  { key: "any_failed", label: "どれか失敗" },
  { key: "mismatch", label: "Engine間不一致" },
  { key: "all_wrong", label: "全Engine不正解" },
  { key: "only_correct", label: "特定Engineのみ正解" },
];

function engineEntries(caseRow) {
  return Object.entries(caseRow?.engines || {});
}

// ケースフィルタ。filter=only_correct のときは engineKey（そのEngineだけ正解）を指定する
export function filterCases(cases, filter, engineKey = "") {
  const rows = Array.isArray(cases) ? cases : [];
  if (!filter || filter === "all") return rows;
  return rows.filter((row) => {
    const entries = engineEntries(row);
    if (entries.length === 0) return false;
    if (filter === "any_failed") {
      return entries.some(([, r]) => r?.failed);
    }
    if (filter === "mismatch") {
      const predictions = new Set(entries.map(([, r]) => String(r?.prediction ?? "")));
      return predictions.size > 1;
    }
    if (filter === "all_wrong") {
      return entries.every(([, r]) => !r?.match);
    }
    if (filter === "only_correct") {
      if (!engineKey) return false;
      const target = row?.engines?.[engineKey];
      if (!target?.match) return false;
      return entries.every(([key, r]) => key === engineKey || !r?.match);
    }
    return true;
  });
}

// ページング（大量ケース表を一度に描画しない）。page は1始まり
export function pageCases(rows, page = 1, pageSize = 50) {
  const list = Array.isArray(rows) ? rows : [];
  const size = Math.max(1, Number(pageSize) || 50);
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  return {
    rows: list.slice((current - 1) * size, current * size),
    page: current,
    totalPages,
    total: list.length,
  };
}

// 履歴比較: Profile Hashが異なるBenchmark同士は同一条件の比較ではない（警告・禁止はしない）
export function profileMismatchWarning(a, b) {
  const hashA = String(a?.profile?.profile_hash || "");
  const hashB = String(b?.profile?.profile_hash || "");
  if (!hashA || !hashB) {
    return "Profile Hashが記録されていないBenchmarkが含まれます。同一条件かどうか判定できません。";
  }
  if (hashA !== hashB) {
    return "⚠ 比較条件（Profile）が異なります。データセット・エンジン条件が同一ではないため、結果を直接比較できません。";
  }
  return "";
}

// 用途別ベストの表示定義（キー→日本語ラベル）
export const PURPOSE_LABELS = {
  best_accuracy: "最高精度（CER最小）",
  best_exact_match: "完全一致率 最高",
  fastest: "最速（MeanTime最小）",
  fewest_failures: "最少失敗",
  best_balance: "バランス最良",
};

// ms表示（null=データなしは "-"。0へ偽装しない）
export function formatMs(value) {
  if (value === null || value === undefined) return "-";
  return `${Number(value).toFixed(1)}ms`;
}

// CER等の割合表示（null=未算出は "-"）
export function formatRate(value, digits = 2) {
  if (value === null || value === undefined) return "-";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}
