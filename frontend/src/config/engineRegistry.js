// EngineRegistry（フロントエンド専用の静的エンジン設定）。
//
// docs/ENGINE_REGISTRY_DESIGN.md 6章のデータ構造案に基づく最小実装（Feature: Engine Registry Core）。
// 本Feature（Registry本体・Label/表示名/Color/DownloadType取得のみ）の対象外:
// - TrainingView / ModelsView / Benchmark系画面への移行（既存の分岐はまだ本Registryを参照しない）
// - TrOCRモデルの追加（trocrエントリ自体はTrOCR「UI」対応のためのプレースホルダーであり、
//   学習・推論の実装状況を変えるものではない）
// - Models API（src/app/services/models_api.py）の変更
//
// frontend/src/lib/engineResolution.js（既存、OCR4エンジンのid正規化＋表示ラベルのみ）とは
// 意図的に独立させている。ENGINE_REGISTRY_DESIGN.md 5章の通りengineResolution.jsは
// customを扱わないため、customを含む本Registryをその上に無理に重ねるより、
// 呼び出し側を一切変更しない自己完結したモジュールとして追加する方が本Featureのスコープ
// （小さくレビュー可能なPR）に合う。既存ファイルとの統合要否は将来のFeatureで判断する。

export const ENGINE_ID_TESSERACT = "tesseract";
export const ENGINE_ID_PADDLEOCR = "paddleocr";
export const ENGINE_ID_EASYOCR = "easyocr";
export const ENGINE_ID_TROCR = "trocr";
export const ENGINE_ID_CUSTOM = "custom";

// color・downloadTypeの実際の値は、実UIへの適用（画面移行）を伴う後続Featureが
// 存在しない現時点では暫定値である（ENGINE_REGISTRY_DESIGN.md 6章「具体値は今回決定しない」を
// 踏まえた仮置き）。本Featureはこれらの値をどの画面にも適用しない（値を返す関数を
// 追加するのみ）ため、実際に画面へ反映する段階で改めて確定させる想定。
const ENGINE_REGISTRY = {
  [ENGINE_ID_TESSERACT]: {
    id: ENGINE_ID_TESSERACT,
    label: "Tesseract",
    displayName: "Tesseract",
    color: "sky",
    downloadType: "single_file",
  },
  [ENGINE_ID_PADDLEOCR]: {
    id: ENGINE_ID_PADDLEOCR,
    label: "PaddleOCR",
    displayName: "PaddleOCR",
    color: "violet",
    downloadType: "zip",
  },
  [ENGINE_ID_EASYOCR]: {
    id: ENGINE_ID_EASYOCR,
    label: "EasyOCR",
    displayName: "EasyOCR",
    color: "amber",
    downloadType: "none",
  },
  [ENGINE_ID_TROCR]: {
    id: ENGINE_ID_TROCR,
    label: "TrOCR",
    displayName: "TrOCR",
    color: "emerald",
    downloadType: "directory_or_ref",
  },
  [ENGINE_ID_CUSTOM]: {
    id: ENGINE_ID_CUSTOM,
    label: "カスタム",
    displayName: "カスタム（分類）",
    color: "slate",
    downloadType: "single_file",
  },
};

const KNOWN_ENGINE_IDS = Object.keys(ENGINE_REGISTRY);

// 前後空白の除去・小文字化のみを正規化として行う（別名/alias変換は行わない）。
// engineResolution.js::normalizeEngineId()と同じ方針だが、customも既知として扱う点が異なる。
function normalize(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || !KNOWN_ENGINE_IDS.includes(normalized)) {
    return null;
  }
  return normalized;
}

// 登録済みengine idの一覧（表示順を意識せず、Registry定義順をそのまま返す）。
export function listEngineIds() {
  return [...KNOWN_ENGINE_IDS];
}

// 指定engineのRegistryエントリ全体。未登録・不正な値はnull。
export function getEngineEntry(value) {
  const id = normalize(value);
  return id ? ENGINE_REGISTRY[id] : null;
}

// Label取得。「表示名取得」（getEngineDisplayName）と同じ値を返す
// （ENGINE_REGISTRY_DESIGN.md時点でlabel/displayNameを区別する具体的な使い分けが
// 未確定なため、本Featureでは同一値の別名アクセサとして提供する）。未登録はnull。
export function getEngineLabel(value) {
  return getEngineEntry(value)?.label ?? null;
}

// 表示名取得。
export function getEngineDisplayName(value) {
  return getEngineEntry(value)?.displayName ?? null;
}

// Color取得（Tailwind標準カラー名の文字列。プロジェクト独自トークンではない。暫定値）。
export function getEngineColor(value) {
  return getEngineEntry(value)?.color ?? null;
}

// DownloadType取得（"single_file" | "zip" | "none" | "directory_or_ref"）。
export function getEngineDownloadType(value) {
  return getEngineEntry(value)?.downloadType ?? null;
}
