// 学習データセットの準備状態・表示用フィールドを算出する純粋関数群。
// Dataset ID は永続化された値ではなく、フォルダ名（作成順のタイムスタンプ）から都度導出する表示専用値。
// meta.json（Dataset Format）・分割計算・Split Seedの意味は一切変更しない。
//
// mode: "split"（新規作成/ラベルデータから。Train/Val/Testへ分割）
//     | "unsplit"（OCRログからの再学習作成。分割せず1ファイルへまとめる従来仕様）

export function deriveOcrDatasetId(datasetRoot) {
  const raw = String(datasetRoot || "").trim();
  if (!raw) return "-";
  const name = raw.split(/[\\/]/).filter(Boolean).slice(-1)[0] || "";
  if (!name) return "-";
  return name.startsWith("DS-") ? name : `DS-${name}`;
}

// 状態（未作成 / 作成中 / 作成済み / 失敗）。作成中・失敗はApp.jsx側の一時状態、
// 作成済みはディスク実体（datasetInfo）の有無で判定する。
export function deriveOcrDatasetStatus({ hasInfo = false, creating = false, failed = false } = {}) {
  if (creating) return { key: "creating", label: "作成中" };
  if (failed) return { key: "failed", label: "失敗" };
  if (hasInfo) return { key: "created", label: "作成済み" };
  return { key: "not_created", label: "未作成" };
}

function splitCounts(datasetInfo) {
  const counts = datasetInfo?.counts || {};
  return {
    train: Number(counts.train ?? 0) || 0,
    val: Number(counts.val ?? 0) || 0,
    test: Number(counts.test ?? 0) || 0,
  };
}

// 作成済みデータ表示ブロック用の派生値一式（Dataset ID/作成日時/文字セット/Split Seed/前処理Hash/保存先/状態）
export function buildOcrDatasetDisplay(datasetInfo, { creating = false, failed = false } = {}) {
  const status = deriveOcrDatasetStatus({ hasInfo: Boolean(datasetInfo), creating, failed });
  const datasetRoot = String(datasetInfo?.dataset_root || "");
  const hasSplitCounts = Boolean(datasetInfo?.counts);
  const counts = splitCounts(datasetInfo);
  return {
    status,
    mode: hasSplitCounts ? "split" : "unsplit",
    datasetId: datasetInfo ? deriveOcrDatasetId(datasetRoot) : "-",
    datasetRoot: datasetRoot || "-",
    createdAt: datasetInfo?.created_at ? String(datasetInfo.created_at).replace("T", " ").slice(0, 19) : "-",
    charset: datasetInfo?.charset || "-",
    seed: datasetInfo?.seed ?? "-",
    trainingPreprocessHash: datasetInfo?.training_preprocess_hash || "未記録",
    counts,
    unsplitCount: Number(datasetInfo?.count ?? 0) || 0,
  };
}

// サマリー表示（次回学習設定）用: 「学習データ / 1,000件 / Train 700 / Validation 200 / Test 100 / 準備済み」形式。
// 未作成・作成中・失敗はすべて「未準備」（作成済みで件数>0の場合のみ準備済み）
export function buildOcrDatasetSummary({ datasetInfo, creating = false, failed = false } = {}) {
  const status = deriveOcrDatasetStatus({ hasInfo: Boolean(datasetInfo), creating, failed });
  const hasSplitCounts = Boolean(datasetInfo?.counts);
  const { train, val, test } = splitCounts(datasetInfo);
  const unsplitTotal = Number(datasetInfo?.count ?? 0) || 0;
  const total = hasSplitCounts ? train + val + test : unsplitTotal;
  const ready = status.key === "created" && total > 0;
  return {
    status,
    ready,
    mode: hasSplitCounts ? "split" : "unsplit",
    total,
    train,
    val,
    test,
    headline: ready ? "準備済み" : "未準備",
  };
}

// 学習前処理（前処理設定画面）の実行状況サマリー。「前処理は終わっているか」を一目で
// 確認できるようにするための表示専用の派生値（GET /api/ocr/training-preprocess/current の
// training_preprocess/training_preprocess_hash/executed/executed_at/processed_image_countから
// 組み立てる。新規API・判定基準は追加しない）。
//
// 3状態（v1.0.0で2状態から変更）:
// - recorded: 設定記録あり（training_preprocess/training_preprocess_hash/executedのいずれかが有効）
// - processed_without_snapshot: 前処理済み画像はあるが設定記録が無い（履歴保存機能導入前の旧プロジェクト）
// - not_processed: 前処理画像自体が無い（本当に未実行）
//
// 「未実行」という文言はprocessed_without_snapshot（実際には前処理済み）と混同するため使用しない。
export function buildTrainingPreprocessStatus(current) {
  const hasRecord = Boolean(current?.training_preprocess) || Boolean(current?.training_preprocess_hash) || Boolean(current?.executed);
  const processedImageCount = Number(current?.processed_image_count ?? 0) || 0;
  const executedAtRaw = String(current?.executed_at || "");
  const executedAt = executedAtRaw ? executedAtRaw.replace("T", " ").slice(0, 19) : "-";

  if (hasRecord) {
    return { status: "recorded", label: "前処理済み・設定記録あり", processedImageCount, executedAt };
  }
  if (processedImageCount > 0) {
    return { status: "processed_without_snapshot", label: "前処理済み・設定記録なし", processedImageCount, executedAt: "-" };
  }
  return { status: "not_processed", label: "前処理画像なし", processedImageCount: 0, executedAt: "-" };
}
