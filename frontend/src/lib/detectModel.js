// 学習画像作成 Step2（YOLO検出）のモデル選択・結果表示の純ロジック。
// 保存済みモデル選択が一覧から消えた際に黙って別モデルへ置き換わり、
// 「検出0件＝壊れたように見える」問題への対策として切り出した。

// 保存済み選択がモデル一覧に存在しないか（カスタムパス選択・一覧未取得は対象外）
export function isModelMissing(selection, items) {
  if (!selection || selection === "__custom__") {
    return false;
  }
  if (!Array.isArray(items) || items.length === 0) {
    return false;
  }
  return !items.includes(selection);
}

// APIエラーレスポンス（{"detail": "..."} 等）から人が読める理由文を取り出す
export function extractDetectErrorDetail(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    return "";
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }
  } catch {
    // JSONでなければそのまま本文を返す
  }
  return text;
}

// 検出失敗時のユーザー向けメッセージ（理由＋確認ヒント）
export function formatDetectFailureMessage(rawText) {
  const detail = extractDetectErrorDetail(rawText);
  return `YOLO検出に失敗しました。理由: ${detail || "不明"}（モデルファイルと検出前処理設定を確認してください）`;
}

// 検出完了メッセージ。0件は「正常終了・検出0件」であることを明示し、処理失敗と区別する
export function formatDetectResultMessage(count) {
  const num = Number(count) || 0;
  if (num <= 0) {
    return "検出結果: 0件（処理は正常終了。モデル・検出閾値・検出前処理設定を確認してください）";
  }
  return `検出完了: ${num}件`;
}

// モデル取得元（source）の短い表示名。select内バッジ・Step3スナップショット用
export function modelSourceLabel(source) {
  switch (source) {
    case "project":
      return "プロジェクト";
    case "common":
      return "共通";
    case "builtin":
      return "標準";
    case "path":
      return "パス指定";
    default:
      return "不明";
  }
}

// モデル取得元の説明的な表示名（使用モデル情報カード用）
export function modelSourceCardLabel(source) {
  switch (source) {
    case "project":
      return "プロジェクトモデル";
    case "common":
      return "共通モデル";
    case "builtin":
      return "Ultralytics標準モデル";
    case "path":
      return "カスタムパス指定";
    default:
      return "不明";
  }
}

// モデル一覧（yolo-models の models）から名前で取得元情報を引く。無ければ null
// （project→common→builtin の並び順のため、同名は project 優先で見つかる）
export function findModelInfo(name, models) {
  if (!name || !Array.isArray(models)) {
    return null;
  }
  return models.find((row) => row && row.name === name) || null;
}

// 取得元＋名前で厳密に引く（同名モデルが複数取得元にある場合は選択した取得元を必ず使用する）
export function findModelBySource(models, source, name) {
  if (!name || !source || !Array.isArray(models)) {
    return null;
  }
  return models.find((row) => row && row.name === name && row.source === source) || null;
}

// select の option value（取得元と名前の組。取得元をまたぐ同名モデルを区別する）
export function buildModelValue(source, name) {
  return `${source || ""}|${name || ""}`;
}

// option value から {source, name} を復元。区切りが無い旧形式は source 未確定として扱う
export function parseModelValue(value) {
  const text = String(value ?? "");
  const index = text.indexOf("|");
  if (index < 0) {
    return { source: "", name: text };
  }
  return { source: text.slice(0, index), name: text.slice(index + 1) };
}

// 取得元ごとにグループ化（select の optgroup 表示用）
export function groupModelsBySource(models) {
  const groups = { project: [], common: [], builtin: [] };
  for (const row of Array.isArray(models) ? models : []) {
    if (row && groups[row.source]) {
      groups[row.source].push(row);
    }
  }
  return groups;
}

// そのモデルで検出を実行できるか（標準モデルは取得済みのときだけ使用可能）
export function canDetectWithModel(info) {
  if (!info) {
    return false;
  }
  if (info.source === "builtin") {
    return info.downloaded === true;
  }
  return true;
}

// Confidence値の色分けクラス（Step3のBBox一覧・選択中パネル用）。
// 0.90以上=緑 / 0.70〜0.89=水色 / 0.50〜0.69=黄 / 0.30〜0.49=オレンジ / 0.29以下=赤 / 不明=muted
export function confidenceToneClass(value) {
  const num = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(num)) {
    return "text-muted";
  }
  if (num >= 0.9) return "text-emerald-300";
  if (num >= 0.7) return "text-sky-300";
  if (num >= 0.5) return "text-yellow-300";
  if (num >= 0.3) return "text-orange-300";
  return "text-red-300";
}

// ミリ秒を「0.72秒」形式へ整形（null/undefined/非数値は "--"。Number(null)=0 の誤変換を防ぐ）
export function formatMillisAsSeconds(ms) {
  if (ms === null || ms === undefined || ms === "") {
    return "--";
  }
  const num = Number(ms);
  if (!Number.isFinite(num) || num < 0) {
    return "--";
  }
  return `${(num / 1000).toFixed(2)}秒`;
}
