// プロジェクトテンプレート定義（新規プロジェクト作成時の初期値セット）。
//
// 方針:
// - テンプレートは「初期値」を設定するだけで、作成後はすべて通常どおり変更できる（設定を固定しない）
// - id は内部識別子（表示名を変えても互換性が壊れない）。version はテンプレート更新時に上げる
//   （既存プロジェクトへ自動反映しない。作成時点の {templateId, templateVersion} を記録として保存）
// - preprocessOverrides: App の DEFAULT_PREPROCESS_PARAMS への部分上書き（前処理の初期値として
//   localStorage `ocr_preprocess_params_by_project_v1` へ保存される）。空={}なら従来の標準設定のまま
// - recommended: 学習・評価画面で使う推奨設定（表示・案内用。各画面の設定を強制しない）
// - ユーザー独自テンプレートは将来拡張（この配列へ定義を足すだけで項目が増やせる構造）

export const PROJECT_TEMPLATES = [
  {
    id: "standard",
    version: 1,
    name: "標準プロジェクト",
    icon: "□",
    description: "OCR Crafterの標準設定から開始します。",
    recommendedEngine: "",
    characterSet: "",
    useCases: ["テンプレートを使わず標準設定で開始", "従来の新規プロジェクト作成と同等"],
    yoloEnabled: false,
    tags: ["標準"],
    preprocessOverrides: {},
    recommended: {},
    guidance: [],
  },
  {
    id: "alphanumeric-ocr",
    version: 1,
    name: "英数字OCR",
    icon: "A1",
    description: "型式、製品番号、シリアル番号などの英数字認識向けです。",
    recommendedEngine: "tesseract",
    characterSet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    useCases: ["製品番号", "型式", "シリアル番号", "英大文字・小文字・数字"],
    yoloEnabled: false,
    tags: ["英数字", "単行"],
    // 単行OCR向け前処理（固定しきい値の二値化・傾き補正。標準に近い構成）
    preprocessOverrides: {
      threshold_type: "binary",
      threshold_value: 128,
      deskew_enabled: true,
    },
    recommended: {
      engine: "tesseract",
      charset: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      psm: 7,
      caseSensitive: true, // 大文字・小文字を区別（GTを大文字化しない）
      evaluation: { primary: "exact_match", secondary: "cer", exactMatchEnabled: true },
      notes: ["不要な日本語文字セットは含めない", "PSM 7（単一行）相当で運用"],
    },
    guidance: ["学習画面のcharsetへ英数字のみを設定してください（日本語文字は含めない）"],
  },
  {
    id: "japanese-ocr",
    version: 1,
    name: "日本語OCR",
    icon: "あ",
    description: "漢字・かな・英数字が混在する日本語文字列の認識向けです。",
    recommendedEngine: "paddleocr",
    characterSet: "日本語（漢字・ひらがな・カタカナ）＋英数字",
    useCases: ["銘板", "帳票", "ラベル", "漢字・かな・英数字混在"],
    yoloEnabled: false,
    tags: ["日本語"],
    // 日本語向け前処理（二値化を初期OFF=Unicode文字の細部を潰さない）
    preprocessOverrides: {
      threshold_type: "none",
      stroke_boost_enabled: false,
    },
    recommended: {
      engine: "paddleocr",
      model: "日本語認識モデル（PaddleOCR公式）",
      evaluation: { primary: "cer", secondary: "exact_match", exactMatchEnabled: true },
      notes: ["Unicode文字列を保持（NFKC等で正規化しない）", "CERを主評価指標・完全一致率は補助指標"],
    },
    guidance: ["推論・評価はPaddleOCR（日本語モデル）を選択してください"],
  },
  {
    id: "nameplate-ocr",
    version: 1,
    name: "銘板OCR",
    icon: "銘",
    description: "配電盤や機器に使用される銘板文字列の認識向けです。",
    recommendedEngine: "paddleocr",
    characterSet: "日本語＋英数字（短い文字列）",
    useCases: ["配電盤銘板", "機器名称", "型式", "管理番号"],
    yoloEnabled: false,
    tags: ["銘板", "短文"],
    // コントラスト・照明ムラ補正を有効化し、二値化は初期OFF（過剰適用しない）
    preprocessOverrides: {
      illumination_enabled: true,
      local_contrast_enabled: true,
      threshold_type: "none",
    },
    recommended: {
      engine: "paddleocr",
      evaluation: { primary: "cer", secondary: "exact_match", exactMatchEnabled: true },
      notes: [
        "CERを主評価指標・完全一致率を重要指標として併記",
        "評価データは学習データから分離して作成してください（データ準備 > 評価データ）",
        "辞書補正・外字置換はOCR修正画面の候補辞書で後から設定できます",
      ],
    },
    guidance: ["評価データは学習データと分離して作成してください", "辞書補正はOCR修正画面の候補辞書で設定できます"],
  },
  {
    id: "handwritten-ocr",
    version: 1,
    name: "手書きOCR",
    icon: "手",
    description: "筆記体や手書き文字の学習・評価向けです。",
    recommendedEngine: "tesseract",
    characterSet: "手書き英字・筆記体・記号（文字セットを明示管理）",
    useCases: ["手書き英字", "筆記体", "手書き記号", "少数文字クラス"],
    yoloEnabled: false,
    tags: ["手書き", "Fine-tuning"],
    // 回転補正＋軽度ノイズ除去。過度な二値化を避ける（Otsu自動）
    preprocessOverrides: {
      deskew_enabled: true,
      denoise_method: "gaussian",
      denoise_ksize: 1,
      threshold_type: "otsu",
    },
    recommended: {
      engine: "tesseract",
      training: "Fine-tuning前提（Tesseract LSTM）",
      caseSensitive: true,
      augmentation: "弱い（データ拡張は弱めの初期値）",
      evaluation: { primary: "cer", secondary: "exact_match", exactMatchEnabled: true },
      notes: ["文字セット（charset）を明示的に管理する（例: A-Z0-9klt+-）", "CERと完全一致率の両方を確認"],
    },
    guidance: ["学習時のデータ拡張プリセットは「弱い」から始めてください"],
  },
  {
    id: "ocr-yolo",
    version: 1,
    name: "OCR＋YOLO",
    icon: "Y",
    description: "画像内の文字領域をYOLOで検出し、切り出した画像をOCRへ使用します。",
    recommendedEngine: "",
    characterSet: "任意（OCRエンジンは後から選択）",
    useCases: ["現場撮影画像", "複数ラベルを含む画像", "元画像からOCR対象領域を検出"],
    yoloEnabled: true,
    tags: ["YOLO", "領域検出", "OCR画像作成"],
    preprocessOverrides: {},
    recommended: {
      workflow: "画像指定・リサイズ → YOLO検出 → Bounding Box選択 → クロップ出力 → 学習データ作成",
      notes: ["OCRエンジンは切り出し後に選択できます"],
    },
    guidance: ["まず「データ準備 > OCR画像作成 > 画像指定・リサイズ」から開始してください"],
  },
];

// 内部IDでテンプレートを取得する。不明なIDは標準テンプレートへ安全にフォールバック
export function getTemplateById(templateId) {
  return PROJECT_TEMPLATES.find((t) => t.id === templateId) || PROJECT_TEMPLATES[0];
}

// テンプレートの前処理初期値を既定パラメータへ適用する（部分上書き・元は変更しない）。
// 戻り値は通常のパラメータオブジェクトで、作成後はすべて変更可能（固定しない）
export function applyTemplatePreprocess(defaults, template) {
  return { ...defaults, ...((template && template.preprocessOverrides) || {}) };
}

// ---------- 作成元テンプレートの記録（プロジェクト情報表示用） ----------
// localStorage `ocr_project_template_by_project_v1` = {[projectId]: {templateId, templateVersion, templateName, appliedAt}}
// テンプレート更新（version上げ）は既存プロジェクトの記録へ自動反映しない（作成時点の値を保持）

export const PROJECT_TEMPLATE_STORAGE_KEY = "ocr_project_template_by_project_v1";

export function readTemplateRecords(storage) {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!target) return {};
  try {
    const parsed = JSON.parse(target.getItem(PROJECT_TEMPLATE_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function recordProjectTemplate(projectId, template, storage, now = "") {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!target || !projectId) return;
  const records = readTemplateRecords(target);
  records[projectId] = {
    templateId: template.id,
    templateVersion: template.version,
    templateName: template.name,
    appliedAt: now || new Date().toISOString(),
  };
  try {
    target.setItem(PROJECT_TEMPLATE_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 保存失敗は無視（表示が「記録なし」になるだけで動作へ影響しない）
  }
}

// プロジェクト情報表示用のラベル。記録なし（既存プロジェクト等）=「記録なし」・standard=「標準設定」
export function templateOriginLabel(record) {
  if (!record || !record.templateId) {
    return { origin: "記録なし", version: "" };
  }
  if (record.templateId === "standard") {
    return { origin: "標準設定", version: String(record.templateVersion || "") };
  }
  return { origin: String(record.templateName || record.templateId), version: String(record.templateVersion || "") };
}
