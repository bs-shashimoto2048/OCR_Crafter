# [Bug] Frontendの未知Engine判定がPaddleOCRへ暗黙フォールバックする

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: [FEATURE_ENGINE_RESOLUTION.md](FEATURE_ENGINE_RESOLUTION.md)（Refactor #11、Backend側）/ [FRONTEND_ENGINE_RESOLUTION.md](../../design/FRONTEND_ENGINE_RESOLUTION.md)

Issue [#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)の実装記録。

## 実装結果（2026-07-30）

### 修正前の暗黙PaddleOCRフォールバック

- `ModelsView.jsx::engineLabelOf(engine, family)`: `family === "ocr" && engine !== "tesseract"`を無条件で`"PaddleOCR"`と表示
- `inferenceModel.js::resolveInferenceEngine(modelInfo)`: `engine === "tesseract"`以外は`training_family === "ocr"`なら無条件`"paddleocr"`

いずれも、実際の`engine`値（EasyOCR・将来のTrOCR・未知の値）に関わらず、OCR系（tesseract以外）を一律PaddleOCRとみなしていた。

調査の過程で、同種の暗黙変換をもう1つ発見した。

- `inferenceModel.js::resolveRestoredInferenceSelection(savedModel, infoMap)`: `savedEngine === "tesseract" ? ... : savedEngine === "paddleocr" ? ... : "custom"`。こちらは未知値を`"custom"`へ丸めていた（PaddleOCRではないが、同じ「未知値を既知の値へ暗黙変換する」バグの一種のため、今回まとめて修正した）

### 修正後のunknown扱い

`frontend/src/lib/engineResolution.js`を新設し、正規化・表示ラベルの共通ロジックを1箇所に集約した。

```javascript
const KNOWN_ENGINE_IDS = ["paddleocr", "easyocr", "tesseract", "trocr"];

export function normalizeEngineId(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "unknown";
  return KNOWN_ENGINE_IDS.includes(normalized) ? normalized : "unknown";
}

export function engineDisplayLabel(value) {
  const normalized = normalizeEngineId(value);
  return normalized === "unknown" ? "不明" : ENGINE_DISPLAY_LABELS[normalized];
}
```

- 既知4Engine（`paddleocr`/`easyocr`/`tesseract`/`trocr`）以外は`"unknown"`
- `null`/`undefined`/非文字列/空文字/空白のみも`"unknown"`
- 別名（alias）変換・PaddleOCR等への暗黙フォールバックは行わない

### 正規化対象Engine

`paddleocr` / `easyocr` / `tesseract` / `trocr`（Backend Engine Registryの`BUILTIN_CAPABILITIES`と同じ4エンジン）。`custom`（分類モデル）はEngine Registry未登録のため対象外とし、呼び出し側で個別に扱う（後方互換を維持）。

### 表示ラベル

`engineLabelOf(engine)`（`ModelsView.jsx`、`family`引数は不要になったため削除）:

- 既知4Engine → `Tesseract`/`PaddleOCR`/`EasyOCR`/`TrOCR`
- `custom` → `カスタム`
- 未知値 → `不明`（既存UI規約。`frontend/src/lib/detectModel.js::modelSourceLabel()`等と同じデフォルト文言）

### 推論時のunknown停止

- `App.jsx::switchInferenceModel(name)`: `resolveInferenceEngine()`が`"unknown"`を返した場合、API呼び出し（`POST /api/ocr/inference/model`）前に停止し、`notify("error", "このモデルのOCRエンジンを判定できません。")`を表示する。PaddleOCRとして送信しない
- 推論使用モデル復元処理（`App.jsx`のプロジェクト読み込み内）: `resolveRestoredInferenceSelection()`が`found: true`かつ`engine: "unknown"`を返した場合、状態を復元せず`notify("error", "前回使用していた推論モデルのOCRエンジンを判定できません。")`を表示する。保存済み`inference_model.json`は書き換えない

### Backend Resolutionとの考え方の整合

Backend（`resolve_engine_id()`、Refactor #11）と同じ方針を踏襲した。

- 正規化は前後空白のトリム＋小文字化のみ（別名変換なし）
- 未知値は既知Engineへ暗黙変換せず、明示的な"unknown"として返す
- 呼び出し側がunknownを検出して処理を止める（Backendは`or "unknown"`で呼び出し元に判定させる。Frontendも同様に呼び出し側で分岐する）

### Backend Registryを直接移植していないこと

`src/app/services/engine_registry.py`の`EngineRegistry`/`EngineDescriptor`/`BUILTIN_CAPABILITIES`等はFrontendへ移植・複製していない。`frontend/src/lib/engineResolution.js`は、正規化＋表示ラベルのみを持つ独立した最小実装であり、Backendの`EngineCapability`（9カテゴリの機能フラグ等）とは無関係。

### TrOCRは認識可能だが選択UI未対応であること

`trocr`は`normalizeEngineId()`/`engineDisplayLabel()`の既知Engineとして認識・ラベル表示できる（既存モデルデータに`engine="trocr"`が含まれた場合に誤分類しない）。ただし、学習・推論・評価画面のEngine選択ドロップダウンへは追加していない。TrOCR UIは別Issue・別PRとする。

## 対象

- Frontend Engine判定ロジックの調査
- Engine名の正規化
- 既知Engine判定
- 未知Engineの明示的な扱い
- 既存表示・推論パラメータ生成への影響確認
- Frontend単体テスト
- ドキュメント更新

## 対象外

- TrOCR選択UI
- TrOCRモデル入力UI
- Backend変更
- API変更
- Engine一覧API
- Backend RegistryのFrontend移植
- Model Metadata連携
- Issue #8修正

## テスト

- `frontend/tests/engineResolution.test.mjs`（新設）: `normalizeEngineId()`/`engineDisplayLabel()`の正規化・既知4Engine・未知値・不正型の網羅
- `frontend/tests/inferenceModel.test.mjs`（既存ファイルへ追加）: `resolveInferenceEngine()`のeasyocr/trocr/未知値ケース、`resolveRestoredInferenceSelection()`のtrocr・未知値・明示的customケース（既存の後方互換テストは変更せず維持）
- 回帰: 既存のTesseract/PaddleOCR/customケースのテストは変更なしで通過することを確認

## 受け入れ条件

- [x] 未知Engineを暗黙にPaddleOCRへ変換していない
- [x] 未知Engineを暗黙にcustomへ変換していない（`resolveRestoredInferenceSelection()`）
- [x] 空値・customをPaddleOCRへ変換していない
- [x] unknown時にAPIへPaddleOCR等を送信しない
- [x] 未知Engineで推論・復元処理を停止する
- [x] 既存3Engine（Tesseract/PaddleOCR/EasyOCR）の挙動を変えていない
- [x] `trocr`を既知Engine IDとして認識できる
- [x] TrOCR選択UI・TrOCRモデル入力UIを追加していない
- [x] Backend Registryを移植していない
- [x] APIを変更していない
- [x] Model Metadataへ接続していない
- [x] 新規テストが追加され通過する
- [x] 既存Frontendテストに回帰がない
- [x] `npm run build`成功
- [x] Backendテストスイートに影響がない（Issue #8起因の既知失敗を除く。Backend自体は無変更）

## 補足資料

- [FRONTEND_ENGINE_RESOLUTION.md](../../design/FRONTEND_ENGINE_RESOLUTION.md)
- [FEATURE_ENGINE_RESOLUTION.md](FEATURE_ENGINE_RESOLUTION.md)
