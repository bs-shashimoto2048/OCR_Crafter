// OCR候補辞書（解析・重み付き距離・近似検索）の回帰テスト。
// 実行: npm test（node --test）
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseCandidateDictionary,
  searchDictionaryCandidates,
  similarityScore,
  weightedOcrDistance,
} from "../src/lib/candidateDictionary.js";

// ---- ファイル解析 ----

test("1行1候補で読み込める（LF）", () => {
  const parsed = parseCandidateDictionary("CHYBkt\nCHYBlt\nAB12kt\n");
  assert.deepEqual(parsed.entries, ["CHYBkt", "CHYBlt", "AB12kt"]);
  assert.equal(parsed.validCount, 3);
});

test("CRLFでも同じ結果になる", () => {
  const lf = parseCandidateDictionary("CHYBkt\nAB12kt\n");
  const crlf = parseCandidateDictionary("CHYBkt\r\nAB12kt\r\n");
  assert.deepEqual(crlf.entries, lf.entries);
});

test("BOM付きUTF-8の先頭BOMを除去する", () => {
  const bom = String.fromCharCode(0xfeff);
  const parsed = parseCandidateDictionary(`${bom}CHYBkt\nAB12kt`);
  assert.deepEqual(parsed.entries, ["CHYBkt", "AB12kt"]);
});

test("空行は除外して件数を数える", () => {
  const parsed = parseCandidateDictionary("CHYBkt\n\n  \nAB12kt");
  assert.deepEqual(parsed.entries, ["CHYBkt", "AB12kt"]);
  assert.equal(parsed.emptySkipped, 2);
});

test("前後空白を除去する", () => {
  const parsed = parseCandidateDictionary("  CHYBkt \n\tAB12kt\t");
  assert.deepEqual(parsed.entries, ["CHYBkt", "AB12kt"]);
});

test("重複行を除外して件数を数える", () => {
  const parsed = parseCandidateDictionary("CHYBkt\nAB12kt\nCHYBkt");
  assert.deepEqual(parsed.entries, ["CHYBkt", "AB12kt"]);
  assert.equal(parsed.duplicateSkipped, 1);
});

test("大文字・小文字は保持し、別候補として扱う", () => {
  const parsed = parseCandidateDictionary("CHYBkt\nCHYBKT");
  assert.deepEqual(parsed.entries, ["CHYBkt", "CHYBKT"]);
});

test("制御文字を含む不正行は除外する", () => {
  const parsed = parseCandidateDictionary(`CHYBkt\nBADLINE\nAB12kt`);
  assert.deepEqual(parsed.entries, ["CHYBkt", "AB12kt"]);
  assert.equal(parsed.invalidSkipped, 1);
});

test("256文字を超える行は不正行として除外する", () => {
  const parsed = parseCandidateDictionary(`${"A".repeat(300)}\nCHYBkt`);
  assert.deepEqual(parsed.entries, ["CHYBkt"]);
  assert.equal(parsed.invalidSkipped, 1);
});

// ---- 距離計算 ----

test("混同文字の置換は無関係な置換より高スコア", () => {
  const pairs = [
    ["O", "0"],
    ["I", "1"],
    ["I", "l"],
    ["S", "5"],
    ["B", "8"],
    ["Z", "2"],
  ];
  for (const [a, b] of pairs) {
    const confused = similarityScore(`AB${a}CD`, `AB${b}CD`);
    const unrelated = similarityScore(`AB${a}CD`, "ABXCD");
    assert.ok(confused > unrelated, `${a}<->${b} should score higher than unrelated`);
  }
});

test("CHY8KT → CHYBkt は無関係文字列より高スコア", () => {
  assert.ok(similarityScore("CHY8KT", "CHYBkt") > similarityScore("CHY8KT", "XYZWQP"));
  // 8→B(混同) + K→k, T→t(大小文字) = 0.8 → 1 - 0.8/6
  assert.ok(Math.abs(weightedOcrDistance("CHY8KT", "CHYBkt") - 0.8) < 1e-9);
});

test("大小文字だけの差（CHYBKT → CHYBkt）はさらに高スコア", () => {
  const caseOnly = similarityScore("CHYBKT", "CHYBkt");
  const withConfusion = similarityScore("CHY8KT", "CHYBkt");
  assert.ok(caseOnly > withConfusion);
  assert.ok(caseOnly > 0.9);
});

// ---- 並び順・検索 ----

const DICT = ["CHYBkt", "CHYBlt", "CHY8lt", "AB12kt"];

test("task.mdの例: CHY8KT → CHYBkt, CHY8lt, CHYBlt の順", () => {
  const results = searchDictionaryCandidates([{ text: "CHY8KT", source: "Tesseract" }], DICT, {
    maxCandidates: 3,
    minSimilarity: 0.6,
  });
  assert.deepEqual(
    results.map((r) => r.entry),
    ["CHYBkt", "CHY8lt", "CHYBlt"]
  );
});

test("同一スコアはファイル順を維持する", () => {
  const results = searchDictionaryCandidates([{ text: "AAKT", source: "" }], ["BBkt", "CCkt"], {
    minSimilarity: 0,
  });
  assert.deepEqual(
    results.map((r) => r.entry),
    ["BBkt", "CCkt"]
  );
});

test("最低類似度未満は除外され、0件になり得る", () => {
  const results = searchDictionaryCandidates([{ text: "CHY8KT", source: "" }], ["QWZXVN"], {
    minSimilarity: 0.6,
  });
  assert.equal(results.length, 0);
});

test("最大候補数を超えない", () => {
  const results = searchDictionaryCandidates([{ text: "CHY8KT", source: "" }], DICT, {
    maxCandidates: 2,
    minSimilarity: 0,
  });
  assert.equal(results.length, 2);
});

test("長さ差が許容を超える候補は除外する", () => {
  const results = searchDictionaryCandidates([{ text: "CHY8KT", source: "" }], ["CHY8KTXXXX"], {
    minSimilarity: 0,
    maxLengthDiff: 2,
  });
  assert.equal(results.length, 0);
});

test("複数OCR候補由来の同一辞書候補は最高類似度で統合される", () => {
  const results = searchDictionaryCandidates(
    [
      { text: "CHY8KT", source: "EasyOCR" },
      { text: "CHYBKT", source: "Tesseract" },
    ],
    ["CHYBkt"],
    { minSimilarity: 0 }
  );
  assert.equal(results.length, 1);
  // CHYBKT（大小文字差のみ）の方が類似度が高いので、その由来が採用される
  assert.equal(results[0].source, "Tesseract");
  assert.equal(results[0].sourceText, "CHYBKT");
});

test("suffix一致（kt/lt等の末尾2文字）が加点され上位になる", () => {
  const results = searchDictionaryCandidates([{ text: "CHYBKT", source: "" }], ["CHYBlt", "CHYBkt"], {
    minSimilarity: 0,
  });
  assert.equal(results[0].entry, "CHYBkt");
});

test("辞書が空・OCR結果が空なら候補なし", () => {
  assert.deepEqual(searchDictionaryCandidates([{ text: "ABC", source: "" }], []), []);
  assert.deepEqual(searchDictionaryCandidates([], ["ABC"]), []);
  assert.deepEqual(searchDictionaryCandidates([{ text: "", source: "" }], ["ABC"]), []);
});
