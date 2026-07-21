// 混同（置換/脱落/挿入）の表示用フォーマット純ロジック。
// 内部データは {kind, from, to, count} の構造化形式を正とし（∅や矢印などの表示記号を保存しない）、
// 表示記号への変換はこのモジュールでのみ行う。制御文字・不正文字は安全なUnicode表記へフォールバックする。

// kind の正規化（旧・別名形式も受け付ける）
const KIND_ALIASES = {
  sub: "sub",
  substitution: "sub",
  del: "del",
  deletion: "del",
  ins: "ins",
  insertion: "ins",
};

export function normalizeConfusionKind(kind) {
  return KIND_ALIASES[String(kind || "").toLowerCase()] || "sub";
}

export const CONFUSION_KIND_LABELS = { sub: "置換", del: "脱落", ins: "挿入" };

// コードポイント表記（"U+0059"。複数文字はスペース区切り・空文字は""）
export function charCodepoints(value) {
  const text = String(value ?? "");
  if (text === "") return "";
  return Array.from(text)
    .map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
    .join(" ");
}

// 1コードポイントの表示変換（表示できない・紛らわしい文字を可視化する）。
// 記号（␠・⇥等）はフォント依存で読みづらいため、日本語の[〜]表記で明示する
function formatSingleChar(ch) {
  const code = ch.codePointAt(0);
  if (ch === " ") return "[半角空白]";
  if (ch === "　") return "[全角空白]"; // 半角と区別する
  if (ch === "\t") return "[タブ]";
  if (ch === "\n") return "[改行]";
  if (ch === "\r") return "[復帰]";
  if (code === 0) return "[NUL]";
  if (ch === "�") return "U+FFFD"; // 置換文字（元の文字は失われている）
  // 孤立サロゲート（JSのUTF-16で対がないもの）
  if (code >= 0xd800 && code <= 0xdfff) return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  // その他の制御文字（C0/C1）はU+XXXX表記
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
    return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return ch;
}

// 表示用の文字変換。空文字は[空文字]（∅は数学記号やΦに見え直感的でないため不使用）、
// 制御文字等は可視化表記へ。内部データは変更せず表示時のみ変換する。
// サロゲートペア（絵文字・補助平面文字）を壊さないよう Array.from でコードポイント単位に分割する
export function formatConfusionChar(value) {
  const text = String(value ?? "");
  if (text === "") return "[空文字]";
  return Array.from(text).map(formatSingleChar).join("");
}

// 特殊文字の説明（ツールチップ補足用）。通常文字はnull
export function confusionCharInfo(value) {
  const text = String(value ?? "");
  if (text === "") return null;
  const chars = Array.from(text);
  const specials = chars.filter((ch) => formatSingleChar(ch) !== ch);
  if (specials.length === 0) return null;
  const describe = (ch) => {
    const code = ch.codePointAt(0);
    if (ch === "�") return "Unicode置換文字（元の文字は復元不能）";
    if (ch === " ") return "半角スペース";
    if (ch === "　") return "全角スペース";
    if (ch === "\t") return "タブ";
    if (ch === "\n") return "改行";
    if (ch === "\r") return "復帰";
    if (code === 0) return "NULL";
    if (code >= 0xd800 && code <= 0xdfff) return "孤立サロゲート";
    return "制御文字";
  };
  return specials.map((ch) => `文字コード：${charCodepoints(ch)} / 種別：${describe(ch)}`).join("\n");
}

// 混同表示ラベル（例: "0 → O" / "Y → [空文字]" / "[空文字] → N"）
export function confusionLabel(c) {
  return `${formatConfusionChar(c?.from)} → ${formatConfusionChar(c?.to)}`;
}

// アクセシビリティ用ツールチップ本文（種別の意味＋特殊文字の説明）
export function confusionTitle(c) {
  const kind = normalizeConfusionKind(c?.kind);
  const from = formatConfusionChar(c?.from);
  const to = formatConfusionChar(c?.to);
  let base;
  if (kind === "del") {
    base = `脱落：正解にある「${from}」をOCRが読み飛ばしました。`;
  } else if (kind === "ins") {
    base = `挿入：正解にはない「${to}」がOCR結果へ余分に追加されました。`;
  } else {
    base = `置換：正解の「${from}」をOCRが「${to}」と認識しました。`;
  }
  const extras = [confusionCharInfo(c?.from), confusionCharInfo(c?.to)].filter(Boolean);
  return extras.length > 0 ? `${base}\n${extras.join("\n")}` : base;
}

// 旧形式（文字列キー "Y→"/"→N"/"0→O" の件数マップ）→構造化形式への変換（読み込み時のみ・ベストエフォート。
// 矢印文字そのものを含む文字列は正しく分割できない場合があるため、新規保存では文字列キー形式を使わないこと）
function parseLegacyConfusionKey(key, count) {
  const text = String(key ?? "");
  const index = text.indexOf("→");
  if (index < 0) return null;
  // 旧表示形式の "∅"（空を表す記号）は内部の空文字へ戻す（例: "∅→1" / "Y→∅"）
  const from = text.slice(0, index).replace(/^∅$/, "");
  const to = text.slice(index + 1).replace(/^∅$/, "");
  const kind = from === "" ? "ins" : to === "" ? "del" : "sub";
  return { kind, from, to, count: Number(count) || 0 };
}

// 混同データの正規化: 構造化配列はkindを正規化して通し、旧形式（オブジェクトマップ）は構造化形式へ変換する。
// それ以外（null・不正値）は空配列
export function normalizeConfusions(raw) {
  if (Array.isArray(raw)) {
    return raw
      .filter((c) => c && typeof c === "object")
      .map((c) => ({
        kind: normalizeConfusionKind(c.kind),
        from: String(c.from ?? ""),
        to: String(c.to ?? ""),
        count: Number(c.count) || 0,
      }));
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .map(([key, count]) => parseLegacyConfusionKey(key, count))
      .filter(Boolean);
  }
  return [];
}
