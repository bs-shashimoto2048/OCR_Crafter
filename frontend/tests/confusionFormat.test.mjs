// 混同表示フォーマット（lib/confusionFormat.js）のテスト。
// 特殊文字・制御文字・不正文字の安全な表示と、旧形式からの後方互換変換を検証する。
import test from "node:test";
import assert from "node:assert/strict";

import {
  charCodepoints,
  confusionCharInfo,
  confusionLabel,
  confusionTitle,
  formatConfusionChar,
  normalizeConfusionKind,
  normalizeConfusions,
} from "../src/lib/confusionFormat.js";

test("confusionLabel: 通常置換・脱落・挿入の表示形式（∅ではなく[空文字]・矢印前後に空白）", () => {
  assert.equal(confusionLabel({ kind: "sub", from: "0", to: "O" }), "0 → O");
  assert.equal(confusionLabel({ kind: "del", from: "Y", to: "" }), "Y → [空文字]");
  assert.equal(confusionLabel({ kind: "ins", from: "", to: "1" }), "[空文字] → 1");
  // ∅は表示に使わない
  assert.ok(!confusionLabel({ kind: "del", from: "Y", to: "" }).includes("∅"));
});

test("formatConfusionChar: 空白・制御文字の可視化（[〜]表記・空文字とスペースを区別）", () => {
  assert.equal(formatConfusionChar(""), "[空文字]"); // 値なし
  assert.equal(formatConfusionChar(" "), "[半角空白]"); // 半角スペース
  assert.equal(formatConfusionChar("　"), "[全角空白]"); // 全角スペース（半角と区別）
  assert.equal(formatConfusionChar("\t"), "[タブ]"); // タブ
  assert.equal(formatConfusionChar("\n"), "[改行]"); // 改行
  assert.equal(formatConfusionChar("\r"), "[復帰]"); // 復帰
  assert.equal(formatConfusionChar("\0"), "[NUL]"); // NULL
  assert.equal(formatConfusionChar(""), "U+0007"); // その他の制御文字
  assert.equal(formatConfusionChar(""), "U+009F"); // C1制御文字
});

test("formatConfusionChar: 通常文字はそのまま（日本語・記号・補助平面文字）", () => {
  assert.equal(formatConfusionChar("あ"), "あ"); // 日本語
  assert.equal(formatConfusionChar("→"), "→"); // 矢印記号そのものもデータとしては通常文字
  assert.equal(formatConfusionChar("#"), "#"); // 記号
  assert.equal(formatConfusionChar("𠮷"), "𠮷"); // 補助平面文字（サロゲートペアを壊さない）
  assert.equal(formatConfusionChar("🍣"), "🍣"); // 絵文字
});

test("formatConfusionChar: U+FFFD・孤立サロゲートは安全なUnicode表記へ", () => {
  assert.equal(formatConfusionChar("�"), "U+FFFD"); // 置換文字
  assert.equal(formatConfusionChar("\ud800"), "U+D800"); // 孤立サロゲート
});

test("半角スペースを含む置換の表示（[半角空白] → A）", () => {
  assert.equal(confusionLabel({ kind: "sub", from: " ", to: "A" }), "[半角空白] → A");
});

test("confusionTitle: 種別の意味と特殊文字の説明をツールチップ化", () => {
  assert.equal(confusionTitle({ kind: "del", from: "Y", to: "" }), "脱落：正解にある「Y」をOCRが読み飛ばしました。");
  assert.equal(confusionTitle({ kind: "ins", from: "", to: "1" }), "挿入：正解にはない「1」がOCR結果へ余分に追加されました。");
  assert.equal(confusionTitle({ kind: "sub", from: "0", to: "O" }), "置換：正解の「0」をOCRが「O」と認識しました。");
  // U+FFFDにはコードポイントと種別の補足が付く
  const title = confusionTitle({ kind: "sub", from: "�", to: "N" });
  assert.ok(title.includes("文字コード：U+FFFD"));
  assert.ok(title.includes("Unicode置換文字"));
});

test("confusionCharInfo: 通常文字はnull・特殊文字は説明付き", () => {
  assert.equal(confusionCharInfo("A"), null);
  assert.ok(confusionCharInfo("　").includes("全角スペース"));
  assert.ok(confusionCharInfo("\t").includes("タブ"));
});

test("charCodepoints: CSV用のU+XXXX表記", () => {
  assert.equal(charCodepoints("Y"), "U+0059");
  assert.equal(charCodepoints("N"), "U+004E");
  assert.equal(charCodepoints("0"), "U+0030");
  assert.equal(charCodepoints(""), ""); // 空文字は空欄
  assert.equal(charCodepoints("𠮷"), "U+20BB7"); // 補助平面はコードポイント単位
  assert.equal(charCodepoints("AB"), "U+0041 U+0042"); // 複数文字はスペース区切り
});

test("normalizeConfusions: 構造化配列はkind別名も正規化して通す", () => {
  const rows = normalizeConfusions([
    { kind: "substitution", from: "0", to: "O", count: 10 },
    { kind: "deletion", from: "Y", to: "", count: 5 },
    { kind: "insertion", from: "", to: "N", count: 7 },
    { kind: "sub", from: "8", to: "B", count: 3 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["sub", "del", "ins", "sub"]
  );
  assert.equal(rows[0].count, 10);
  assert.equal(normalizeConfusionKind("DELETION"), "del");
});

test("normalizeConfusions: 旧・文字列キー形式（後方互換）を構造化へ変換", () => {
  const rows = normalizeConfusions({ "Y→": 5, "→N": 7, "0→O": 10 });
  assert.deepEqual(rows, [
    { kind: "del", from: "Y", to: "", count: 5 },
    { kind: "ins", from: "", to: "N", count: 7 },
    { kind: "sub", from: "0", to: "O", count: 10 },
  ]);
});

test("normalizeConfusions: 不正値は空配列（エラーにしない）", () => {
  assert.deepEqual(normalizeConfusions(null), []);
  assert.deepEqual(normalizeConfusions(undefined), []);
  assert.deepEqual(normalizeConfusions("Y→N"), []);
  assert.deepEqual(normalizeConfusions([null, { kind: "sub", from: "a", to: "b", count: 1 }]).length, 1);
});

test("JSON保存・再読込の往復で文字が変化しない（構造化形式）", () => {
  const original = [
    { kind: "sub", from: "　", to: " ", count: 2 }, // 全角→半角スペース
    { kind: "del", from: "\t", to: "", count: 1 },
    { kind: "sub", from: "𠮷", to: "吉", count: 1 }, // 補助平面
    { kind: "sub", from: "�", to: "N", count: 1 }, // U+FFFD（そのまま保持される）
  ];
  const roundTripped = normalizeConfusions(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(roundTripped, original);
});

test("後方互換: 旧∅表記の文字列キーも新表示（[空文字]）へ変換される", () => {
  const rows = normalizeConfusions({ "∅→1": 7, "Y→∅": 5 });
  assert.deepEqual(rows, [
    { kind: "ins", from: "", to: "1", count: 7 },
    { kind: "del", from: "Y", to: "", count: 5 },
  ]);
  assert.equal(confusionLabel(rows[0]), "[空文字] → 1");
  assert.equal(confusionLabel(rows[1]), "Y → [空文字]");
  // 内部データへ表示文字列を保存しない（from/toは空文字のまま）
  assert.equal(rows[0].from, "");
  assert.equal(rows[1].to, "");
});
