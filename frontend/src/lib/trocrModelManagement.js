// TrOCR Model Management Parity（Issue #141）の純粋関数群。
//
// `/models/info`（`model_registry.py::list_model_infos()`）は`.trocr.json`を一切
// globしない（Issue #96で意図的に未統合、Investigation #108・Issue #121で再確認済み）。
// 本Issueでは`/models/info`自体を変更せず（既存2エンジンへの回帰リスクを避けるため）、
// 既に取得済みの`GET /api/trocr/models`（`list_trocr_models()`の薄いラッパー、Issue #96/#98）
// をFrontend側でModelsViewの`models`/`modelInfos`形状へマージする。

// TrOCRモデル（`GET /api/trocr/models`由来のsidecar payload）をModelsViewが期待する
// modelInfos 1件分の形状へ変換する。
//
// training_familyには既存の"ocr"/"tesseract"のいずれとも異なる"trocr"を設定する。
// ModelsView.jsx::isOcrFamily()は["ocr","tesseract"]のみを判定するため、これにより
// canDownload()/isModelAvailableForInference()（共通式 `!isOcrFamily(name) ||
// exportReady(name)`）がTrOCRに対して常にtrueになる。TrOCRは登録（sidecar書込）自体が
// 完了マーカーであり、PaddleOCRのような別途Export手順を持たないため（既存の分類モデル
// と同じ「Export概念なし」の扱いに揃える。ocr_inference_ready等のOCR系専用フィールドを
// 参照させない）。
export function mapTrocrModelToInfo(item) {
  return {
    name: String(item?.name || ""),
    engine: "trocr",
    training_family: "trocr",
    model_type: String(item?.model_type || "ocr"),
    created_at: String(item?.created_at || ""),
    dataset_id: String(item?.dataset_id || ""),
    job_id: String(item?.job_id || ""),
    base_model_ref: String(item?.base_model_ref || ""),
  };
}

// modelItems（モデル名の配列、`GET /models`由来）とinfoMap（modelInfos辞書、
// `GET /models/info`由来）へ、登録済みTrOCRモデルをマージする。
//
// 既に同名エントリが存在する場合は上書きしない（Tesseract/PaddleOCRの既存エントリを
// 誤って置き換えないための保守的な挙動）。戻り値は新しい配列/オブジェクト
// （引数は変更しない）。
export function mergeTrocrModelsIntoList(modelItems, infoMap, trocrItems) {
  const names = [...(Array.isArray(modelItems) ? modelItems : [])];
  const info = { ...(infoMap || {}) };
  for (const item of Array.isArray(trocrItems) ? trocrItems : []) {
    const name = String(item?.name || "").trim();
    if (!name || info[name]) {
      continue;
    }
    names.push(name);
    info[name] = mapTrocrModelToInfo(item);
  }
  return { modelItems: [...names].sort(), modelInfos: info };
}
