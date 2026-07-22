// 前処理設定画面の情報設計スキーマ。
// セクション（実処理パイプライン順）・項目メタ（表示名/対象キー/検索語/基本・詳細区分/対象画像種別）を
// 一元定義し、検索・基本/詳細モード・変更済み検知・見出しバッジをここから導出する。
// 実処理順の根拠: config/settings.yaml pipelines（wide基準。single差はitemのappliesToで表現）。

// セクション定義（表示順=実処理順）
export const PREPROCESS_SECTIONS = [
  {
    id: "input",
    title: "入力・分岐",
    note: "工程実行前の画像種別判定",
    items: [
      {
        id: "ratio_threshold",
        label: "比率しきい値",
        keys: ["ratio_threshold"],
        keywords: ["分岐", "画像タイプ", "single", "wide", "横長", "判定"],
        basic: true,
      },
    ],
  },
  {
    id: "brightness",
    title: "明るさ・コントラスト",
    note: "処理順 1〜6（グレースケール→照明ムラ→Gamma→CLAHE→局所→平坦化）",
    items: [
      {
        id: "grayscale",
        label: "グレースケール",
        keys: [],
        keywords: ["gray", "白黒"],
        basic: true,
        info: true, // 常時実行（設定なし）の情報表示
      },
      {
        id: "illumination",
        label: "照明ムラ補正",
        keys: ["illumination_enabled", "illumination_method", "illumination_background_size", "illumination_strength"],
        keywords: ["影", "背景", "ムラ", "retinex", "gaussian", "rolling"],
        basic: true,
        enabledKey: "illumination_enabled",
      },
      {
        id: "gamma",
        label: "ガンマ補正",
        keys: ["gamma_enabled", "gamma_value"],
        keywords: ["gamma", "明るさ", "カーブ"],
        basic: false,
        enabledKey: "gamma_enabled",
      },
      {
        id: "clahe",
        label: "CLAHE",
        keys: ["clahe_clip_limit", "clahe_tile_grid_size"],
        keywords: ["clahe", "コントラスト", "clip", "タイル"],
        basic: true,
        appliesTo: "wide",
      },
      {
        id: "local_contrast",
        label: "局所コントラスト",
        keys: ["local_contrast_enabled", "local_contrast_clip_limit", "local_contrast_tile_grid_size"],
        keywords: ["コントラスト", "局所", "clahe"],
        basic: false,
        enabledKey: "local_contrast_enabled",
      },
      {
        id: "hist_equalize",
        label: "ヒストグラム平坦化",
        keys: ["hist_equalize_enabled"],
        keywords: ["ヒストグラム", "平坦化", "明暗"],
        basic: false,
        enabledKey: "hist_equalize_enabled",
      },
    ],
  },
  {
    id: "sharpness",
    title: "鮮明化",
    note: "処理順 7〜9（バイラテラル→シャープ→アンシャープ）",
    items: [
      {
        id: "bilateral",
        label: "バイラテラルノイズ除去",
        keys: ["bilateral_enabled", "bilateral_diameter", "bilateral_sigma_color", "bilateral_sigma_space"],
        keywords: ["ノイズ", "輪郭", "bilateral", "シグマ"],
        basic: false,
        enabledKey: "bilateral_enabled",
      },
      {
        id: "sharpen",
        label: "シャープ化",
        keys: ["sharpen_enabled", "sharpen_amount", "sharpen_sigma"],
        keywords: ["シャープ", "輪郭", "強調", "sharpen"],
        basic: false,
        enabledKey: "sharpen_enabled",
      },
      {
        id: "unsharp",
        label: "アンシャープマスク",
        keys: ["unsharp_enabled", "unsharp_amount", "unsharp_radius", "unsharp_threshold"],
        keywords: ["シャープ", "unsharp", "輪郭"],
        basic: false,
        enabledKey: "unsharp_enabled",
      },
    ],
  },
  {
    id: "threshold",
    title: "二値化",
    note: "処理順 11（手動マスク 前→二値化→後）",
    items: [
      {
        id: "threshold_type",
        label: "二値化方式",
        keys: ["threshold_type"],
        keywords: ["二値化", "otsu", "大津", "binary", "adaptive", "しきい値", "なし"],
        basic: true,
      },
      {
        // 常時表示・binary以外ではdisabled（Otsu等で無視される値を操作可能なまま残さない）
        id: "threshold_value",
        label: "固定しきい値",
        keys: ["threshold_value"],
        keywords: ["しきい値", "threshold", "固定"],
        basic: true,
      },
      {
        id: "threshold_adaptive",
        label: "適応的パラメータ（block size / C）",
        keys: ["threshold_block_size", "threshold_c"],
        keywords: ["adaptive", "block", "適応"],
        basic: false,
        dependsOn: { key: "threshold_type", value: "adaptive" },
      },
    ],
  },
  {
    id: "shape",
    title: "マスク・形状補正",
    note: "処理順 10・12〜15（前マスク→二値化→後マスク→モルフォロジー→掠れ補正→傾き補正）",
    items: [
      {
        id: "manual_mask",
        label: "手動マスク補正",
        keys: ["manual_mask_enabled", "manual_mask_mode", "manual_mask_fill", "manual_mask_timing", "manual_mask_threshold"],
        keywords: ["マスク", "塗りつぶし", "黒領域", "矩形"],
        basic: true,
        enabledKey: "manual_mask_enabled",
      },
      {
        id: "morph",
        label: "オープン/クローズ処理",
        keys: ["morph_enabled", "morph_method", "morph_ksize", "morph_iterations"],
        keywords: ["morphology", "モルフォロジー", "クローズ", "オープン", "カーネル"],
        basic: true,
        enabledKey: "morph_enabled",
      },
      {
        id: "stroke_boost",
        label: "掠れ補正",
        keys: ["stroke_boost_enabled", "stroke_boost_method", "stroke_boost_ksize", "stroke_boost_iterations"],
        keywords: ["掠れ", "欠け", "太らせ", "stroke"],
        basic: false,
        enabledKey: "stroke_boost_enabled",
      },
      {
        id: "deskew",
        label: "傾き補正",
        keys: ["deskew_enabled"],
        keywords: ["傾き", "deskew", "回転", "水平"],
        basic: true,
        enabledKey: "deskew_enabled",
        appliesTo: "wide",
      },
    ],
  },
  {
    id: "output",
    title: "出力整形",
    note: "処理順 16〜18（余白トリミング→リサイズ/Pad→ノイズ除去）",
    items: [
      {
        id: "crop_margin",
        label: "余白トリミング",
        keys: ["crop_margin_enabled", "crop_margin_threshold", "crop_margin_margin"],
        keywords: ["余白", "トリミング", "crop"],
        basic: false,
        enabledKey: "crop_margin_enabled",
      },
      {
        id: "resize",
        label: "リサイズ",
        keys: ["single_size", "wide_height", "wide_keep_ratio"],
        keywords: ["リサイズ", "サイズ", "高さ", "アスペクト"],
        basic: true,
      },
      {
        id: "pad",
        label: "Pad（正方形化）",
        keys: [],
        keywords: ["pad", "正方形"],
        basic: false,
        info: true,
        appliesTo: "single",
      },
      {
        id: "denoise",
        label: "ノイズ除去",
        keys: ["denoise_method", "denoise_ksize"],
        keywords: ["ノイズ", "メディアン", "ガウシアン", "denoise"],
        basic: true,
      },
    ],
  },
];

// 基本モードで表示する項目ID（basic: true の項目）
export function isBasicItem(item) {
  return item.basic === true;
}

// 依存条件（例: 固定しきい値は threshold_type=binary のときだけ表示）
export function itemDependencySatisfied(item, params) {
  if (!item.dependsOn) return true;
  return String(params?.[item.dependsOn.key] ?? "") === item.dependsOn.value;
}

// 検索一致（表示名・内部キー・検索語・セクション名。空クエリは全件一致）
export function itemMatchesQuery(item, section, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.label, item.id, ...(item.keys || []), ...(item.keywords || []), section.title]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

// 項目の表示可否（モード・検索・依存条件をまとめて判定）。
// 依存条件を満たす項目は基本モードでも表示する（adaptive選択時のblock size等）
export function itemVisible(item, section, { mode = "advanced", query = "", params = {} } = {}) {
  if (!itemMatchesQuery(item, section, query)) return false;
  if (!itemDependencySatisfied(item, params)) return false;
  if (mode === "basic" && !isBasicItem(item) && !item.dependsOn) return false;
  return true;
}

// セクション内の表示項目（0件のセクションは非表示にする）
export function visibleItems(section, options) {
  return section.items.filter((item) => itemVisible(item, section, options));
}

// 変更済み判定（既定値との差）。keysのいずれかが既定値と異なれば変更済み
export function itemChanged(item, params = {}, defaults = {}) {
  return (item.keys || []).some((key) => {
    const a = params[key];
    const b = defaults[key];
    if (a === undefined) return false;
    return String(a) !== String(b);
  });
}

// セクションの変更件数（見出しの「変更n件」表示用）
export function sectionChangedCount(section, params, defaults) {
  return section.items.filter((item) => itemChanged(item, params, defaults)).length;
}

// セクションのON/OFF要約バッジ（enabledKeyを持つ項目のON数。無い場合は空文字）
export function sectionStatusLabel(section, params = {}) {
  const toggles = section.items.filter((item) => item.enabledKey);
  if (toggles.length === 0) return "";
  const on = toggles.filter((item) => Boolean(params[item.enabledKey])).length;
  if (toggles.length === 1) return on > 0 ? "ON" : "OFF";
  return `${on}/${toggles.length} ON`;
}

// 項目単位のON/OFFラベル（見出しだけで状態が分かるように）
export function itemStatusLabel(item, params = {}) {
  if (!item.enabledKey) return "";
  return params[item.enabledKey] ? "ON" : "OFF";
}

// セクションを既定値へ戻すための差分（keysに含まれるパラメータのみ既定へ）
export function sectionResetPatch(section, defaults = {}) {
  const patch = {};
  for (const item of section.items) {
    for (const key of item.keys || []) {
      if (key in defaults) patch[key] = defaults[key];
    }
  }
  return patch;
}

// 対象画像種別ラベル（wide/singleのみの工程を見出し付近へ表示）
export function appliesToLabel(item) {
  if (item.appliesTo === "wide") return "wide画像のみ";
  if (item.appliesTo === "single") return "single画像のみ";
  return "";
}

// 二値化方式の依存状態（無視される値を操作可能なまま残さない）
export function thresholdDependency(thresholdType) {
  const type = String(thresholdType || "binary");
  return {
    valueEnabled: type === "binary",
    adaptiveVisible: type === "adaptive",
  };
}
