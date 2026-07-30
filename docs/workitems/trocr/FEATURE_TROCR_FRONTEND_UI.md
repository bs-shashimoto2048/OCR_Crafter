# [Feature] FrontendへTrOCR選択UIを追加

Parent Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

Related: [FEATURE_TROCR_API_INTEGRATION.md](FEATURE_TROCR_API_INTEGRATION.md)（Feature #20）/ [FEATURE_FRONTEND_ENGINE_RESOLUTION.md](FEATURE_FRONTEND_ENGINE_RESOLUTION.md)（Bug #12）

Issue [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)の実装記録。

## 実装結果（2026-07-30）

### 事前調査で判明した内容

- 既存OCR推論UIから`POST /predict`を直接呼ぶ箇所は3つ（`fetch(\`${API_BASE}/predict\`...)`）: `App.jsx::runInference()`（`InferenceView.jsx`用）、`OcrBatchView.jsx`、`RapidOCRView.jsx`（後者は実際には別エンドポイント`/api/ocr/preview-file/batch`を使用）
- `InferenceView.jsx`（「推論」テスト画面）が、Section 1で示された`engine`/`model`/`image`を直接指定して`POST /predict`を呼ぶ、最も単純で直接的な既存OCR推論UIと判断し、今回の対象とした
- `InferenceView`/`RapidOCRView`/`OcrBatchView`の3画面は、App.jsx側の同一state（`inferEngine`/`inferModel`/`inferPaddleModel`/`inferTesseractModel`/`inferEasyOcrLangs`）を共有している。**既知の制約**として、`InferenceView`でTrOCRを選択した後に`OcrBatchView`/`RapidOCRView`へ画面遷移すると、これら2画面の独自Engine選択肢（`custom`/`easyocr`/`paddleocr`/`tesseract`のみ）にはTrOCRが無いため、共有stateの値`"trocr"`がそのままドロップダウンの表示と一致しない状態になりうる。両画面とも推論失敗を行単位/スロット単位で捕捉する既存のエラーハンドリングを持つため、アプリ全体がクラッシュすることはないが、確認済みの未対応領域としてFuture Workへ記録する（詳細は本ファイル末尾）
- `InferenceView.jsx`のEngine選択ドロップダウン（`<select>`)はハードコードされた`<option>`の並び（`normalizeEngineId()`等は未使用）。表示ラベルはコンポーネント内のローカル関数`engineLabel()`が別に持っていた（`ModelsView.jsx::engineLabelOf()`や`lib/engineResolution.js`とは独立した3つ目の重複実装だった）
- `model` state: `custom`はmodels一覧からの選択（`inferModel`）、`paddleocr`/`tesseract`は同様に選択式（`inferPaddleModel`/`inferTesseractModel`）。**自由入力可能な既存stateは無い**ため、TrOCR用に新規state（`inferTrocrModelRef`）を追加した
- API呼び出し経路: `InferenceView`の「推論実行」ボタン → `App.jsx::runInference()` → `FormData`構築 → `fetch(\`${API_BASE}/predict\`, {method: "POST", body: formData})`
- プロジェクト保存・復元: 「推論に使用（本番モデル）」の保存・復元（`inferEngine`とは別のstate、Issue #12で対応済み）とは独立した、テスト画面専用の一時的なUI状態のため、TrOCRのmodel_ref入力値の永続化は行っていない（対象外として明記）
- Frontendテスト基盤: `node --test`。`package.json`が明示的ファイルリストを使用しているため新規テストファイルを登録した

### 実装内容

`frontend/src/lib/engineResolution.js`/`inferenceModel.js`は既存のもの（Issue #12実装分）をそのまま再利用し、新しいEngine正規化処理は作らなかった。

- **`frontend/src/lib/inferenceModel.js`**: `normalizeTrocrModelRef(value)`（前後空白除去、既定値なし）/ `trocrModelRefMissing(engine, trocrModelRef)`（engine=trocrかつ未入力・空白のみでtrue）を新設
- **`frontend/src/views/InferenceView.jsx`**:
  - Engine選択肢へ`<option value="trocr">TrOCR</option>`を追加
  - `engine === "trocr"`のときだけ、モデル参照（Hugging Face model ID・ローカルパス）の自由入力欄を表示。説明文とHub取得可能性の注記を表示
  - ローカル関数`engineLabel()`を`lib/engineResolution.js::engineDisplayLabel()`を呼ぶ実装へ置き換え（`custom`のみ個別分岐、重複ロジックを解消）
  - 「実際に使用される推論先」表示へtrocr分岐を追加（未入力時は「未入力」、入力済みは前後空白除去済みの値）
  - 「推論実行」ボタンの`disabled`条件へ`trocrModelRefMissing(engine, trocrModelRef)`を追加し、model_ref未入力時はAPI呼び出し前に無効化。入力欄下に赤字の必須案内も表示
- **`frontend/src/App.jsx`**:
  - 新規state`inferTrocrModelRef`/`setInferTrocrModelRef`（初期値は空文字。既定TrOCRモデルはハードコードしない）
  - `runInference()`冒頭で`trocrModelRefMissing(inferEngine, inferTrocrModelRef)`をチェックし、trueなら`notify("error", "TrOCRモデル参照を入力してください。")`のうえAPI呼び出し前に停止
  - `engine === "trocr"`のとき、`formData.append("model", trimmedTrocrModelRef)`（既存の`model`フィールドをそのまま使用。TrOCR専用フィールドは追加していない）。`"latest"`の自動変換・既定モデルの自動設定は行っていない

### model_refの送信

既存の`model`Formフィールドへ、利用者が入力した値をそのまま（前後空白のみ除去して）渡す。`trocr_model`等のTrOCR専用フィールドは追加していない。API（`POST /predict`）自体は無変更。

### 結果表示

既存の結果表示（`InferenceView`右側「推論結果」カード）をそのまま利用。TrOCR専用の結果コンポーネントは作成していない。`confidence: null`は既存の「取得不能」表示（`--`）にそのまま乗り、0%や100%として捏造しない。`char_scores: []`も既存の`CharHeatmap`コンポーネントがそのまま処理する（空配列は元々想定済み）。

### Model Metadata・Engine Registryとの関係

- Model Metadataへは接続していない。モデル一覧からのTrOCR自動選択・`artifact_path`解決・`model_id`解決は行っていない。利用者はmodel_refを直接入力する
- Backend Engine Registry APIは未実装のまま。Frontend側の固定選択肢へ`trocr`を最小限追加したのみで、Registry連携・Engine一覧取得APIの追加は行っていない

## 目的

既存のOCR推論UIからTrOCRを選択し、TrOCRのモデル参照を指定して既存`POST /predict`へ送信できるようにする。

## 対象

- TrOCRを既存Engine選択肢へ追加
- TrOCR選択時のモデル参照入力
- model_refの必須検証
- 既存`model`フィールドへの受け渡し
- 既存`POST /predict`の利用
- 推論結果の既存表示
- Frontend単体テスト
- 必要最小限のコンポーネントテスト
- ドキュメント更新

## 対象外

- Backend変更
- API変更
- TrOCR専用API
- Model Metadata Adapter
- モデル一覧からのTrOCR自動選択
- `artifact_path`解決
- Hugging Faceモデル検索
- モデルダウンロード機能
- Engine Registry API
- TrOCR学習
- TrOCR評価
- Benchmark
- Release Gate
- Engineキャッシュ
- Issue #8修正
- `OcrBatchView.jsx`/`RapidOCRView.jsx`へのTrOCR対応（Future Work、下記参照）
- モデル参照の永続化（プロジェクト保存・復元）

## テスト

- `frontend/tests/inferenceModel.test.mjs`（既存ファイルへ追加）: `normalizeTrocrModelRef()`の前後空白除去・null/undefined/空文字/空白のみ、`trocrModelRefMissing()`のtrocr時必須検証・他Engineへの非影響
- `frontend/tests/inferenceView.render.test.mjs`（新設）: Engine選択肢へのTrOCR追加・既存3Engine選択肢の維持・TrOCR選択時のみモデル参照入力欄表示・他Engine選択時は非表示・model_ref未入力/空白のみ時の実行ボタン無効化・入力済み時の有効化・「実際に使用される推論先」表示・結果表示（confidence=null/char_scores=[]でクラッシュしない、捏造しない）
- 回帰: 既存533件のFrontendテスト（Issue #12まで）がすべて変更なしで通過することを確認

## 受け入れ条件

- [x] 既存Engine選択UIから`trocr`を選択できる
- [x] TrOCR選択時のみモデル参照入力欄が表示される
- [x] モデル参照未入力（空文字・空白のみ）はAPI呼び出し前に停止しエラー表示する
- [x] 既存`POST /predict`（`engine=trocr`・`model=<入力値>`）で推論結果が既存表示形式で返る
- [x] 既存3Engine（PaddleOCR/EasyOCR/Tesseract）に回帰がない
- [x] 新規テストが追加され通過する
- [x] ドキュメントが更新されている

## Future Work（本Issueで発見・対象外とした事項）

- **`OcrBatchView.jsx`/`RapidOCRView.jsx`へのTrOCR対応**: 両画面は`InferenceView.jsx`と同じApp.jsx共有stateを参照するが、独自のEngine選択肢・FormData構築ロジックを持ち、いずれもTrOCRを追加していない。`InferenceView`でTrOCRを選択した状態のままこれらの画面へ遷移した場合、共有stateの値がそれらのドロップダウンの選択肢と一致しない状態になりうる（クラッシュはしない。行/スロット単位の既存エラーハンドリングで捕捉される）。対応する場合は両画面へ同様のUI追加が必要
- **Backend Engine RegistryのAPI化**（Bug #12から継続）
- **モデル参照の永続化**: 現状はテスト画面の一時的なUI状態としてのみ保持し、プロジェクト保存・復元の対象にしていない。Model Metadata連携時に再検討する

## 補足資料

- [FEATURE_TROCR_API_INTEGRATION.md](FEATURE_TROCR_API_INTEGRATION.md)
- [FEATURE_FRONTEND_ENGINE_RESOLUTION.md](FEATURE_FRONTEND_ENGINE_RESOLUTION.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
