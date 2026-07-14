// OCR候補辞書: テキストファイルの解析と、OCR結果に対する近似候補検索。
//
// ラベル編集画面の補助候補表示用（推論・学習へは注入しない）。
// 将来のバッチ推論でも raw_prediction / dictionary_candidate / dictionary_similarity を
// 出力できるよう、UIに依存しない純関数として実装している。

export const DICT_FILE_MAX_BYTES = 5 * 1024 * 1024; // ファイル上限: 5MB
export const DICT_LINE_MAX_LENGTH = 256; // 1行上限: 256文字
export const DICT_DEFAULT_MAX_CANDIDATES = 3;
export const DICT_DEFAULT_MIN_SIMILARITY_PERCENT = 60;
export const DICT_DEFAULT_MAX_LENGTH_DIFF = 2; // 許容文字数差（ゴースト文字を考慮して±2）

// OCRで混同しやすい文字ペア（置換コストを通常より軽くする）
const CONFUSION_PAIRS = [
  ["O", "0"],
  ["I", "1"],
  ["I", "l"],
  ["L", "l"],
  ["S", "5"],
  ["B", "8"],
  ["Z", "2"],
  ["G", "6"],
  ["T", "7"],
  ["C", "G"],
  ["K", "k"],
  ["T", "t"],
];
const CONFUSION_COST = 0.4; // 混同文字の置換コスト
const CASE_COST = 0.2; // 大文字・小文字だけの差の置換コスト

const confusionSet = new Set();
for (const [a, b] of CONFUSION_PAIRS) {
  confusionSet.add(a + b);
  confusionSet.add(b + a);
  // 大小文字違いの表記（例: b↔8）も同じ混同として扱う
  confusionSet.add(a.toLowerCase() + b.toLowerCase());
  confusionSet.add(b.toLowerCase() + a.toLowerCase());
  confusionSet.add(a.toUpperCase() + b.toUpperCase());
  confusionSet.add(b.toUpperCase() + a.toUpperCase());
}

// ---- 1. テキストファイル解析（1行1候補） ----

// 制御文字・デコード失敗(U+FFFD)を含む行は不正行として除外する
const INVALID_LINE_PATTERN = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\ufffd]");

export function parseCandidateDictionary(text) {
  const stripped = String(text || "").replace(new RegExp("^\\ufeff"), ""); // BOM除去
  const lines = stripped.split(/\r\n|\r|\n/); // CRLF / LF / CR 対応
  // 末尾の改行による見かけ上の空行は件数に含めない
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const seen = new Set();
  const entries = [];
  let emptySkipped = 0;
  let duplicateSkipped = 0;
  let invalidSkipped = 0;
  for (const rawLine of lines) {
    const value = rawLine.trim(); // 前後空白除去
    if (!value) {
      emptySkipped += 1;
      continue;
    }
    if (value.length > DICT_LINE_MAX_LENGTH || INVALID_LINE_PATTERN.test(value)) {
      invalidSkipped += 1;
      continue;
    }
    if (seen.has(value)) {
      duplicateSkipped += 1;
      continue;
    }
    seen.add(value);
    entries.push(value); // 大文字・小文字と読込順序を保持
  }
  return {
    entries,
    validCount: entries.length,
    emptySkipped,
    duplicateSkipped,
    invalidSkipped,
  };
}

// ---- 2. OCR向け重み付き編集距離 ----

function substitutionCost(a, b) {
  if (a === b) {
    return 0;
  }
  let cost = 1;
  if (a.toLowerCase() === b.toLowerCase()) {
    cost = Math.min(cost, CASE_COST);
  }
  if (confusionSet.has(a + b)) {
    cost = Math.min(cost, CONFUSION_COST);
  }
  return cost;
}

export function weightedOcrDistance(source, candidate) {
  const a = String(source || "");
  const b = String(candidate || "");
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = new Array(cols);
  let current = new Array(cols);
  for (let j = 0; j < cols; j += 1) {
    prev[j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    current[0] = i;
    for (let j = 1; j < cols; j += 1) {
      current[j] = Math.min(
        prev[j] + 1, // 削除
        current[j - 1] + 1, // 挿入
        prev[j - 1] + substitutionCost(a[i - 1], b[j - 1]) // 置換
      );
    }
    [prev, current] = [current, prev];
  }
  return prev[cols - 1];
}

// 0〜1へ正規化した類似度
export function similarityScore(source, candidate) {
  const a = String(source || "");
  const b = String(candidate || "");
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, 1 - weightedOcrDistance(a, b) / maxLength));
}

// ---- 3. 近似候補検索（複数OCR結果 → 辞書候補を統合） ----

// ocrSources: [{ text, source }] 各OCRモデルの結果とラベル
// entries: 辞書候補文字列（読込順）
// 戻り値: [{ entry, score, similarity, source, sourceText, order }] スコア降順（同点はファイル順）
export function searchDictionaryCandidates(ocrSources, entries, options = {}) {
  const {
    maxCandidates = DICT_DEFAULT_MAX_CANDIDATES,
    minSimilarity = DICT_DEFAULT_MIN_SIMILARITY_PERCENT / 100,
    maxLengthDiff = DICT_DEFAULT_MAX_LENGTH_DIFF,
    suffixLength = 2, // 末尾suffix（kt/lt等）の一致を加点。kt/ltへのハードコードはしない
    suffixBonus = 0.05,
  } = options;

  const sources = (ocrSources || [])
    .map((item) => ({ text: String(item?.text || "").trim(), source: String(item?.source || "") }))
    .filter((item) => item.text);
  if (sources.length === 0 || !Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const best = new Map(); // 辞書文字列単位で統合し、最も高い類似度と由来を保持
  entries.forEach((entry, order) => {
    for (const src of sources) {
      if (Math.abs(src.text.length - entry.length) > maxLengthDiff) {
        continue; // 長さが大きく異なる候補は除外
      }
      const similarity = similarityScore(src.text, entry);
      let score = similarity;
      if (
        suffixLength > 0 &&
        src.text.length >= suffixLength &&
        entry.length >= suffixLength &&
        src.text.slice(-suffixLength).toLowerCase() === entry.slice(-suffixLength).toLowerCase()
      ) {
        score = Math.min(1, score + suffixBonus);
      }
      if (score < minSimilarity) {
        continue;
      }
      const existing = best.get(entry);
      if (!existing || score > existing.score) {
        best.set(entry, { entry, score, similarity, source: src.source, sourceText: src.text, order });
      }
    }
  });

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(1, maxCandidates));
}
