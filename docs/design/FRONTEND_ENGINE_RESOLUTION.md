# Frontend Engine判定 設計

Related: [ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](ENGINE_REGISTRY.md) / [FEATURE_ENGINE_RESOLUTION.md](../workitems/trocr/FEATURE_ENGINE_RESOLUTION.md)（Backend側、Refactor #11）/ Bug [#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)

## 背景

Backend側は Refactor [#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11) で「未知Engineをtesseract以外＝PaddleOCRとみなす」暗黙フォールバックを`resolve_engine_id()`（Engine Registry経由の明示的判定、未知値は`"unknown"`）へ統一済み。

Frontendには、Backendが今後どんなEngine一覧を持つかを問い合わせるAPIが無いため、Backend Engine RegistryをそのままFrontendへ移植・参照することはできない。そのため、Frontendには**Backendとは独立した、最小限のEngine ID正規化ロジック**を置く。

## 対象

- `frontend/src/lib/engineResolution.js`（新設）: `normalizeEngineId()` / `engineDisplayLabel()`
- `frontend/src/views/ModelsView.jsx::engineLabelOf()`
- `frontend/src/lib/inferenceModel.js::resolveInferenceEngine()` / `resolveRestoredInferenceSelection()`
- `frontend/src/App.jsx::switchInferenceModel()` および推論使用モデル復元処理

## 設計方針

- **既知Engineは4つのみ**: `paddleocr` / `easyocr` / `tesseract` / `trocr`（Backend Engine Registryの`BUILTIN_CAPABILITIES`と同じ4エンジン）。それ以外の文字列は正規化できず`"unknown"`とする
- **`custom`（分類モデル）はEngine Registry未登録のため`normalizeEngineId()`では扱わない**。呼び出し側（`engineLabelOf()`/`resolveInferenceEngine()`/`resolveRestoredInferenceSelection()`）が、`engine`未指定または明示的に`"custom"`の場合を個別に判定する
- **未知Engineを既知Engineへ暗黙変換しない**。表示は「不明」（既存UI規約。`frontend/src/lib/detectModel.js::modelSourceLabel()`等と同じデフォルト文言）、推論実行は停止する
- **Backend実装を複製しない**。Python版`resolve_engine_id()`のRegistry参照・EngineDescriptor等は持ち込まず、正規化＋表示ラベルのみの最小実装とする
- **TrOCRの認識とUI対応は分離する**。`trocr`は既知Engine IDとして正規化・ラベル表示できるが、Engine選択UI（学習・推論・評価画面のドロップダウン等）へは追加しない。TrOCR UI対応は別Issue・別PRとする

## `normalizeEngineId(value)`

```javascript
const KNOWN_ENGINE_IDS = ["paddleocr", "easyocr", "tesseract", "trocr"];

export function normalizeEngineId(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "unknown";
  return KNOWN_ENGINE_IDS.includes(normalized) ? normalized : "unknown";
}
```

正規化は前後空白のトリムと小文字化のみ（Backend`resolve_engine_id()`と同じ方針）。別名（alias）変換は行わない。`null`/`undefined`/非文字列/空文字/空白のみ/未登録の値は、いずれも`"unknown"`。

## `engineDisplayLabel(value)`

既知4Engineの表示ラベル（`Tesseract`/`PaddleOCR`/`EasyOCR`/`TrOCR`）を返す。未知は「不明」。`custom`はここでは扱わない（呼び出し側の`engineLabelOf()`が個別に「カスタム」を返す）。

## 修正箇所ごとの挙動

### `ModelsView.jsx::engineLabelOf(engine)`

修正前: `family === "ocr" && engine !== "tesseract"` を無条件で`"PaddleOCR"`と表示（EasyOCR・trocr・未知値のいずれも巻き込む）。

修正後: `engine`が`"custom"`なら「カスタム」、それ以外は`engineDisplayLabel(engine)`（既知4Engineのラベル、未知は「不明」）。`training_family`引数は不要になったため削除した（表示判定にfamilyを使わない）。

### `inferenceModel.js::resolveInferenceEngine(modelInfo)`

修正前: `engine === "tesseract"`のみ個別に信頼し、それ以外は`training_family === "ocr"`なら無条件`"paddleocr"`。

修正後: `engine`未指定または`"custom"`なら`"custom"`、それ以外は`normalizeEngineId(engine)`（既知4Engineの正規ID、または`"unknown"`）。`training_family`は参照しなくなった。

### `inferenceModel.js::resolveRestoredInferenceSelection(savedModel, infoMap)`

修正前: `savedEngine === "tesseract" ? ... : savedEngine === "paddleocr" ? ... : "custom"`。`engine`未指定（旧保存データ、後方互換）と「未登録の値」の両方が`"custom"`に丸められていた。

修正後: `engine`未指定または明示的に`"custom"`なら`"custom"`（後方互換を維持）。それ以外は`normalizeEngineId(engine)`。未登録の値は`"unknown"`のまま返し、`"custom"`へ暗黙変換しない。

### `App.jsx::switchInferenceModel(name)`

`resolveInferenceEngine()`の結果が`"unknown"`なら、API呼び出し（`POST /api/ocr/inference/model`）前に停止し、既存の`notify("error", ...)`で「このモデルのOCRエンジンを判定できません。」を表示する。PaddleOCRとして誤って送信しない。

### 推論使用モデル復元処理（`App.jsx`のプロジェクト読み込み内）

`resolveRestoredInferenceSelection()`の結果が`found: true`かつ`engine: "unknown"`の場合、状態を復元せず「前回使用していた推論モデルのOCRエンジンを判定できません。」を通知する。保存済み`inference_model.json`は書き換えない。

## 対象外（本ドキュメントの範囲外）

- Engine選択UIへのTrOCR追加
- Backend Engine RegistryのAPI経由取得（Future Work）
- Model Metadata連携

## Future Work

- Backend Engine RegistryをAPI経由でFrontendへ提供する案（Engine一覧・表示名・Capabilityの単一情報源化）。現時点ではFrontend側に最小限の正規化ロジックを個別に持つ設計とし、API追加は行わない
