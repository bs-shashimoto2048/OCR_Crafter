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
export function findModelInfo(name, models) {
  if (!name || !Array.isArray(models)) {
    return null;
  }
  return models.find((row) => row && row.name === name) || null;
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
