# TrOCR Evaluation Registered-model Selection 作業記録

Related: Bug [#121](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/121) / Feature [#119](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/119)（Training → Evaluation → Benchmark Workflow Handoff、Completed） / Feature [#98](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/98)（TrOCR Training UI Integration） / Feature [#104](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/104) / Feature [#110](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/110)

**状態**: Completed / Closed。PR [#122](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/122)、Squash Commit `7a591d8`でマージ済み。

## 目的

Issue #119の実装前調査で確認した既存バグを修正する。TrOCR Evaluationの「登録済みモデルから選択」モードが実運用上常に空リストになる問題を、既存の`GET /api/trocr/models`契約をそのまま再利用して解消する。

## 実装前調査（Mandatory Investigation）

### 1. `OcrEvaluationView.jsx`のengine別model selection state

`trocrModelSource`（"metadata"=登録済み選択／"manual"=直接入力）・`trocrSelectedModel`・`trocrModelRef`・`trocrModels`（登録済み一覧、propとして受け取る）。View自体はデータソースを意識せず、渡された`trocrModels`配列（`{name, modelRef}`形状）をそのまま描画・検証に使う。

### 2. App.jsxからEvaluationへ渡されるmodel list

`App.jsx`は従来、TrOCR用に**2つの独立した変数**を持っていた。

- `trocrModels`（`lib/trocrModelMetadata.js::extractTrocrModels(models, modelInfos, modelAliases)`。`GET /models/info`由来）— **InferenceView・OcrEvaluationViewへ渡されていた**
- `trocrTrainedModels`（`lib/trocrTrainedModels.js::mapTrocrTrainedModels(trocrTrainedModelItems)`。`GET /api/trocr/models`由来）— **TrainingView・BenchmarkViewへ渡されていた**

`extractTrocrModels()`は`modelInfos`（`/models/info`の応答）から`engine==="trocr"`のものを抽出する実装だが、`model_registry.py::list_model_infos()`は`.trocr.json`を一切globしない（Issue #96で意図的に未統合、`.pt`/`.ocr.json`/`.tess.json`のみ対象）。したがって`trocrModels`は**実運用上常に空配列**になる。`lib/trocrModelMetadata.js`自身のモジュールdocstringにも「TrOCR学習・モデル登録の仕組みが実装されるまでの既知の状態」と記載されていたが、TrOCR学習（Issue #90-#106）は既に実装済みであり、このコメント自体が古くなっていた。

### 3. Tesseract/PaddleOCR/EasyOCR/TrOCRで利用しているmodel listing API

| Engine | API | 備考 |
|---|---|---|
| Tesseract | `GET /models/info`（`.tess.json`） | 正常動作 |
| PaddleOCR | `GET /models/info`（`.ocr.json`） | 正常動作 |
| EasyOCR | なし（学習・登録経路自体が無い） | 該当なし |
| TrOCR | 従来: `GET /models/info`経由の`extractTrocrModels()`（Inference/Evaluation、**バグ**）／`GET /api/trocr/models`経由の`mapTrocrTrainedModels()`（Training/Benchmark、正常動作） | 本Issueで一本化 |

### 4. `GET /api/trocr/models` response shape

`list_trocr_models()`（`trocr_model_registry.py`、Issue #96）が`.trocr.json`sidecarの生payloadをそのまま返す。`items: [{name, engine, model_dir, base_model_ref, project_id, job_id, dataset_root, dataset_id, epochs, batch_size, learning_rate, final_loss, created_at}, ...]`。`mapTrocrTrainedModels()`は`{name, modelRef: model_dir, label}`へ変換する（`model_dir`は`TrOCREngine.load()`/`TrOCREvaluationPredictor`がそのまま受け取れる既存契約、Issue #96）。

### 5. TrOCR Inference/Training/Benchmarkでのregistered-model UI実装

- Training（`TrainingView.jsx`、Issue #98）・Benchmark（`BenchmarkView.jsx`、Issue #102）はいずれも`trocrTrainedModels`（`GET /api/trocr/models`由来）を使用しており、正常に動作する
- **InferenceView.jsx（Issue #85）も本Issue調査により、Evaluationと全く同じバグ（`trocrModels`経由）を持っていることを発見した**。Issue #121本文は「Inference/Training/Benchmarkでは扱えるが、Evaluationのみ壊れている」という前提だったが、実コード調査でこれが誤りであることが判明した。ユーザーへ確認のうえ、本Issueのスコープを**Evaluation・Inference両方の修正**へ拡張することとした

### 6. Issue #119のhandoff logic

Training→Evaluation handoff（`App.jsx::sendTrainingResultToEvaluation()`）は、TrOCRについて常にmanualモード（`ocrEvalTrocrModelSource: "manual"`）で`model_dir`を直接設定していた（当時はEvaluationのmetadataモードが機能しないための回避策）。Evaluation→Benchmark handoff（`sendEvaluationResultToBenchmark()`）は`trocrModelSource==="metadata"`の場合`resolveSelectedTrocrModelRef(trocrModels, ...)`を呼んでいたが、`trocrModels`が常に空のため常に解決失敗していた（本Issueの修正により、このパスも副次的に正しく動作するようになる）。

### 7. Evaluation requestへ最終的に渡す`model`/`model_ref`の意味

`lib/ocrEvalEngine.js::buildOcrEvalTargets()`のtrocr分岐: `trocrModelSource==="metadata"`なら`resolveSelectedTrocrModelRef(trocrModels, trocrSelectedModel)`、`"manual"`なら`normalizeTrocrModelRef(trocrModelRef)`。いずれも最終的に`model_dir`相当の文字列を`POST /api/ocr/evaluate`の`model`フィールドへ渡す。データソースが変わっても、この関数自体・Backend契約は無変更。

## Design Decisions

1. **App.jsxの`trocrModels`変数を廃止し、`trocrTrainedModels`（`GET /api/trocr/models`由来）へ統合する**。両変数は同じ形状（`{name, label, modelRef}`）の登録済みモデル一覧であり、Training/Benchmarkが既に正しく使っているデータソースへ、Inference/Evaluationも合わせるのが最小かつ一貫した修正である
2. **`InferenceView.jsx`/`OcrEvaluationView.jsx`/`lib/ocrEvalEngine.js`はコード変更しない**。これらは`trocrModels`という名前のpropを`{name, modelRef}`形状の配列として汎用的に扱っており、データソースに依存しない。App.jsxが渡す値を差し替えるだけで修正が完結する（新しいUI patternを作らない、既存contractの再利用を優先する）
3. **`lib/trocrModelMetadata.js::extractTrocrModels()`は削除しない**。他に呼び出し元が無くなるが、モジュール自体・既存テスト（`trocrModelMetadata.test.mjs`）は無変更のまま残す（Issue本文のOut of Scope「UI全面redesign」を踏まえ、不要なコード削除は本Issueの目的に必須ではないため）
4. **Training→Evaluation handoff（Issue #119）はmanualモードのまま維持する**。Issue #121本文は「本Issueで解消されるためregistered modeへ更新してよい」としているが、job_id一致で既に解決済みの`model_dir`をmanualモードで直接設定する方が、登録済み一覧の再取得タイミングに依存せず確実である（Issue #119実装時の判断を維持）。Evaluation→Benchmark handoffの`metadataモード`解決は、コード変更なしに本Issueの修正で副次的に正しく動作するようになる

## Production Changes

- `frontend/src/App.jsx`:
  - `lib/trocrModelMetadata.js`からの`extractTrocrModels`インポートを削除（`resolveSelectedTrocrModelRef`/`trocrMetadataValidationError`は引き続き使用）
  - `trocrModels`（`extractTrocrModels()`由来）のuseMemoを削除し、既存の`trocrTrainedModels`（`mapTrocrTrainedModels()`由来）へ統合
  - `inferTrocrModelSourceEffective`・Inference実行時のTrOCR model_ref解決（旧`trocrModels`参照2箇所）・Evaluation実行時の`isTrocrEvalModelUnresolved()`呼び出し・Evaluation→Benchmark handoffの`trocrModels`引数・`<InferenceView>`/`<OcrEvaluationView>`への`trocrModels`prop、いずれも`trocrTrainedModels`を参照するよう統一

`InferenceView.jsx`・`OcrEvaluationView.jsx`・`lib/ocrEvalEngine.js`・`lib/trocrModelMetadata.js`・Backend（`main.py`・`trocr_model_registry.py`・`ocr_evaluation.py`・`evaluation_dispatcher.py`）はいずれも無変更。

## Compatibility

- Tesseract/PaddleOCR/EasyOCRのEvaluation/Inference model selectorは無変更（`trocrModels`/`trocrTrainedModels`以外のstate・propは触れていない）
- Manual modeの動作（値の保持・切替）は無変更
- Issue #119のTraining→Evaluation handoffは無変更（manualモードのまま、動作継続）
- 既存の`trocrModelMetadata.js`・そのテストは無変更のまま存続する（`extractTrocrModels()`は他に呼び出し元が無くなったが、削除していないため既存テストは全件パスし続ける）

## Tests

`frontend/tests/trocrStateIsolation.test.mjs`の既存テスト1件を更新した（`trocrModels`変数の廃止・`trocrTrainedModels`への統合を反映）。

- InferenceView/OcrEvaluationViewの既存render test（`inferenceView.render.test.mjs`/`ocrEvaluationView.render.test.mjs`、Issue #85/#83時点で作成済み）は、View自体が`trocrModels`propを汎用的に扱う設計であることを裏付けており、**一覧が空の場合／一覧がある場合の両方の表示を既に検証済み**であった。これはバグがView側ではなくApp.jsx側のデータ配線にのみ存在したことの証左であり、Viewコンポーネント自体の新規テストは不要と判断した
- Issue #119の`lib/evaluationBenchmarkHandoff.js`の既存テスト（`trocr: metadataモードは登録済みモデル一覧から解決する`）は、正しい形状のデータが渡された場合の解決ロジックを既に検証済みであり、本Issueの修正によりこの経路が実際に機能するようになる（コード変更・テスト変更は不要）

実行結果:

```
cd frontend && npm test
# 731 passed

cd frontend && npm run build
# 成功
```

Backend変更が無いため、`python -m pytest -q`の再実行は不要と判断した（Frontend専用の修正であることを`git diff --stat main -- src/`で確認済み、差分0）。

## Scope外（Out of Scope、実施しなかったこと）

- Epic #28 Consumer Migration
- `model_registry.py`全面再設計
- Evaluation architecture統合
- TrOCR Training/Benchmark/Release Gate変更
- UI全面redesign
- `lib/trocrModelMetadata.js::extractTrocrModels()`の削除（呼び出し元が無くなったが、モジュール自体は残置）

## Future Work

- `lib/trocrModelMetadata.js::extractTrocrModels()`は本Issューの修正後、App.jsx内に呼び出し元が無くなった（コード上はdead codeとなるが削除していない）。将来的に完全に不要と判断されれば、モジュール・対応テスト（`trocrModelMetadata.test.mjs`）ごと削除する別Issueを検討してもよい
- Issue #119のTraining→Evaluation handoffを、本Issューの修正を踏まえてregistered modeへ切り替える案も検討したが、job_id解決済みの値をmanualモードで直接渡す方が確実なため見送った（§Design Decisions #4参照）。将来的にUXの観点でregistered modeへの統一が望ましいと判断されれば、別途検討する
