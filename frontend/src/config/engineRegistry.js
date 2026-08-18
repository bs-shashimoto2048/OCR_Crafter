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
//
// trainingSupported/trainingSelectable/supportedDevices/trainingPanel/snapshotTypeは
// Refactor「TrainingView Migration」（Feature #53）で追加した。値は
// src/app/services/engine_capability.py::BUILTIN_CAPABILITIES（supports_training/
// supports_cpu/supports_cuda）および既存TrainingView.jsxの実装済み挙動と一致させている
// （推測で新規Capabilityを作らない）。custom（分類モデル）はOCRタイプ選択肢の対象外・
// Engine Capability未登録のため、これらのフィールドは持たない（undefined=非該当）。
const ENGINE_REGISTRY = {
  [ENGINE_ID_TESSERACT]: {
    id: ENGINE_ID_TESSERACT,
    label: "Tesseract",
    displayName: "Tesseract",
    color: "sky",
    downloadType: "single_file",
    trainingSupported: true,
    trainingSelectable: true,
    supportedDevices: ["cpu"],
    trainingPanel: "tesseract",
    snapshotType: "tesseract",
  },
  [ENGINE_ID_PADDLEOCR]: {
    id: ENGINE_ID_PADDLEOCR,
    label: "PaddleOCR",
    displayName: "PaddleOCR",
    color: "violet",
    downloadType: "zip",
    trainingSupported: true,
    trainingSelectable: true,
    supportedDevices: ["cpu", "gpu"],
    trainingPanel: "paddleocr",
    snapshotType: "generic",
  },
  [ENGINE_ID_EASYOCR]: {
    id: ENGINE_ID_EASYOCR,
    label: "EasyOCR",
    displayName: "EasyOCR",
    color: "amber",
    downloadType: "none",
    // EasyOCRは推論のみ対応（学習未実装）。ドロップダウンには表示するが学習は実行できない
    // （既存TrainingView.jsxの挙動をそのまま踏襲。trainingSupported=falseがその区別）
    trainingSupported: false,
    trainingSelectable: true,
    supportedDevices: [],
    trainingPanel: "unsupported",
    snapshotType: "generic",
  },
  [ENGINE_ID_TROCR]: {
    id: ENGINE_ID_TROCR,
    label: "TrOCR",
    displayName: "TrOCR",
    color: "emerald",
    downloadType: "directory_or_ref",
    // TrOCR学習Backend（Feature #92/#94/#96）が実装されたため、Training UI統合
    // （Feature #98）でtrainingSupported/trainingSelectableをtrueへ変更した。
    // trainingPanel="trocr"はTrainingView.jsxの新設パネル分岐に対応する
    trainingSupported: true,
    trainingSelectable: true,
    supportedDevices: ["cpu", "gpu"],
    trainingPanel: "trocr",
    snapshotType: "generic",
  },
  [ENGINE_ID_CUSTOM]: {
    id: ENGINE_ID_CUSTOM,
    label: "カスタム",
    displayName: "カスタム（分類）",
    color: "slate",
    downloadType: "single_file",
  },
};

// Registry内部状態は呼び出し側から一切変更できない（PR #54レビューMajor #1対応）。
// supportedDevices配列を持つエントリのみ、配列自体とエントリ本体をfreezeする
// （汎用のdeepFreeze utilityは導入せず、本Registryが実際に持つ配列フィールドに限定する）。
for (const entry of Object.values(ENGINE_REGISTRY)) {
  if (Array.isArray(entry.supportedDevices)) {
    Object.freeze(entry.supportedDevices);
  }
  Object.freeze(entry);
}
Object.freeze(ENGINE_REGISTRY);

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

// 学習可否（実行可能か）。未登録・custom等、フィールドを持たないエンジンはfalse
// （「学習可能と誤認させない」を既定とする）。
export function isEngineTrainingSupported(value) {
  return Boolean(getEngineEntry(value)?.trainingSupported);
}

// 学習画面のエンジン選択肢に表示してよいか。
export function isEngineTrainingSelectable(value) {
  return Boolean(getEngineEntry(value)?.trainingSelectable);
}

// 学習エンジン選択肢の一覧（表示順・{id, label}）。trainingSelectable=trueのみを含む。
// 表示順は学習画面の既存UIに合わせた固定順（PaddleOCR→Tesseract→EasyOCR→TrOCR）であり、
// Registry定義順（tesseract→paddleocr→...）とは独立させている
// （表示順は「学習エンジン選択」という利用文脈固有の情報であり、Registryエントリ自体の
// 汎用フィールドにはしない。ENGINE_REGISTRY_DESIGN.md 9章参照）。
const TRAINING_SELECTABLE_ORDER = [ENGINE_ID_PADDLEOCR, ENGINE_ID_TESSERACT, ENGINE_ID_EASYOCR, ENGINE_ID_TROCR];

export function getTrainingSelectableEngines() {
  return TRAINING_SELECTABLE_ORDER.map((id) => ENGINE_REGISTRY[id])
    .filter((entry) => entry?.trainingSelectable)
    .map((entry) => ({ id: entry.id, label: entry.label }));
}

// 学習時にサポートされる演算デバイスID一覧（"cpu" | "gpu"）。未登録・未対応は空配列。
// Registry内部の配列（frozen）をそのまま返さず、呼び出しごとに新しい配列を返す
// （戻り値を変更してもRegistry内部・以降の呼び出し結果へ影響しない）。
export function getEngineSupportedDevices(value) {
  const devices = getEngineEntry(value)?.supportedDevices;
  return Array.isArray(devices) ? [...devices] : [];
}

// 指定デバイスIDをそのエンジンの学習でサポートするか。
export function isEngineDeviceSupported(value, deviceId) {
  return getEngineSupportedDevices(value).includes(deviceId);
}

// 学習画面の「エンジン固有設定」パネル種別（"paddleocr" | "tesseract" | "trocr" | "unsupported"）。
// 未登録エンジンはnull（呼び出し側は"unsupported"と同様に安全側へフォールバックすること。
// PaddleOCR設定への暗黙フォールバックは行わない）。
export function getEngineTrainingPanel(value) {
  return getEngineEntry(value)?.trainingPanel ?? null;
}

// ジョブスナップショット表示の種別（"tesseract" | "generic"）。未登録エンジンはnull
// （呼び出し側は"generic"と同様、既存の共通項目のみを表示すること）。
export function getEngineSnapshotType(value) {
  return getEngineEntry(value)?.snapshotType ?? null;
}
