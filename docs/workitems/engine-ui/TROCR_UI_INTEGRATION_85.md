# TrOCR UI Integration 作業記録

Related: Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46)（Engine UI Generalization） / Feature [#85](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/85)（TrOCR UI Integration） / Feature [#83](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/83)（Evaluation UI Implementation、[EVALUATION_UI_IMPLEMENTATION_83.md](EVALUATION_UI_IMPLEMENTATION_83.md)） / InferenceViewのTrOCR対応（Issue #23、既存） / Refactor [#51](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/51)（ModelsView Migration） / Refactor [#53](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/53)（TrainingView Migration） / Refactor [#57](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/57)（BenchmarkCenterView Label Migration）

**状態**: Completed・Closed。

## 目的

Epic #46（Engine UI Generalization）の最終項目「TrOCR UI Integration」について、実コードを調査し、Issue #83（Evaluation UI Implementation）で既に実装済みの内容と、Epic #46完了に必要な残差を確定する。TrOCR専用UIを新規に作ることを前提とせず、必要最小限の実装のみ行う。

## 調査結果

Epic #46の背景（issues/46本文）が対象とする3画面（モデル管理・学習・評価画面）＋既存のInferenceView（推論テスト画面）について、実コードを確認した結果は以下のとおり。

| 画面 | TrOCR対応状況 | 根拠 |
|---|---|---|
| `ModelsView.jsx`（モデル管理） | ✅ 対応済み（Refactor #51） | Engine表示ラベル・Download種別（`directory_or_ref`）を含め`engineRegistry.js`経由のRegistry駆動。trocr専用のハードコード分岐は無い |
| `TrainingView.jsx`（学習） | ✅ 対応済み（意図的に非表示、Refactor #53） | `trainingSelectable: false`（Backend TrOCR学習が未実装のため）によりOCRタイプ選択肢に出さない。これは「TrOCR UI未対応」ではなく「学習未実装という事実の表現」であり、正しい状態 |
| `InferenceView.jsx`（推論テスト） | ✅ 対応済み（既存、Issue #23） | Engine選択・登録済みモデル選択（`trocrModelSource="metadata"`）/手動model_ref入力・実行ボタンの検証（`trocrModelRefMissing`/`trocrMetadataValidationError`）が実装済み。Backend `/predict`（`predict.py::_predict_with_trocr()`）は`model`（model_ref）のみを受け取り、`device`/`local_files_only`は存在しない既存契約のため、UIもこれらを提供しない（省略ではなく契約どおり） |
| `OcrEvaluationView.jsx`（モデル評価） | ✅ 対応済み（Issue #83） | Engine選択・モデル指定方法・`device`/`local_files_only`（Backend `TrOCREvaluationPredictor`が実際に受け取るオプションのため、Inferenceとは異なる） |
| `BenchmarkCenterView.jsx`（結果閲覧） | ✅ 対応済み（Refactor #57、既存） | 全Engineを`getEngineLabel()`経由で表示するデータ駆動実装のため、TrOCRの評価結果が存在すれば無改修で表示できる |
| `BenchmarkView.jsx`（Benchmark実行） | ⬜ 未対応（Out of Scope） | Backend `benchmark.py::ENGINE_CATALOG`にtrocrエントリが存在しないため、実行自体が不可能。Issue #85の Out of Scope「Benchmark generalization」に該当し、対象外 |

### Inference/Evaluation間のTrOCR state分離

`App.jsx`を確認し、推論テスト画面（`inferTrocrModelRef`/`inferTrocrModelSource`/`inferTrocrSelectedModel`）とモデル評価画面（`ocrEvalTrocrModelRef`/`ocrEvalTrocrModelSource`/`ocrEvalTrocrSelectedModel`/`ocrEvalTrocrDevice`/`ocrEvalTrocrLocalFilesOnly`）が完全に別のuseStateとして定義され、それぞれの画面コンポーネントへ独立して渡されていることを確認した（Issue #83実装時点で既に分離済み）。登録済みモデル一覧（`trocrModels`、`extractTrocrModels()`由来）のみ、読み取り専用の共有データとして両画面へ同じ値を渡す（選択state・model_ref入力とは異なる性質のため、意図的に共有）。

この分離を`frontend/tests/trocrStateIsolation.test.mjs`（新規）で静的検証として固定化した（App.jsxの実ソースに対し、両画面用stateが個別に存在し、互いのJSX propsへ混入していないことを確認）。

### Backend TrOCR API契約の整合

- 推論（`POST /predict`、`predict.py::_predict_with_trocr()`）: `model`（model_ref）のみ。`TrOCREngine.load(model_ref)`を呼び出しごとに再実行する既存の意図的な仕様（`device`指定不可、`local_files_only`指定不可）
- 評価（`POST /api/ocr/evaluate`、`services/trocr_evaluation_predictor.py::TrOCREvaluationPredictor`）: `model`/`device`/`local_files_only`。build-once（`TrOCREngine.load()`を1回だけ呼び再利用）

両者は意図的に異なる契約であり（推論テスト画面向けの都度reload方式 vs 評価向けのbuild-once方式、Issue #77のPredictor実装時点で確定済み）、UIの差異（Inferenceにdevice/local_files_onlyが無い）はこの既存契約を正しく反映した結果であり、UI側の実装漏れではない。

## 結論

**Epic #46「TrOCR UI Integration」の完了条件は、Issue #83（Evaluation UI Implementation）と既存のInferenceView TrOCR対応（Issue #23）・Registry移行（Refactor #51/#53/#57）により、既に満たされている。** 追加のProductionコード変更は不要と判断した。

本Issueでの実装は、この調査結果の記録（本ドキュメント）と、Inference/Evaluation間のTrOCR state分離を保証する回帰テストの追加のみとした。

## Tests

- `frontend/tests/trocrStateIsolation.test.mjs`（新規、5件）: Inference/Evaluation画面のTrOCR state分離をApp.jsxソースに対する静的検証で確認
- `frontend/package.json`のtestスクリプトへ追加
- `npm run build && npm test`: 675件全pass（既存670件+新規5件）
- Backend: 無変更のため確認のみ。`python -m pytest -q` は既知Issue #8以外の新規failureがないことを確認

## Scope外として触れなかった事項

- `BenchmarkView.jsx`のTrOCR Variant Key対応（Backend `ENGINE_CATALOG`にtrocrエントリが無いため、Benchmark Runner自体の対応が前提。Issue #85 Out of Scope「Benchmark generalization」）
- `RapidOCRView.jsx`/`OcrBatchView.jsx`（Epic #46の対象3画面＋InferenceViewに含まれない画面。Issue #85 Out of Scope「無関係なUI全面改修」）
- Models APIのHTTPエンドポイント配線（ADR-0002 Phase 3、別Epic）
- TrOCR学習本体（Backend未実装、Epic #27の責務）

## Future Work（Scope外として記録のみ）

- `TrainingView.jsx`の実行時設定スナップショット表示コメント（1587行付近）に残る「未登録Engine（TrOCR等）」という表現は、TrOCRが実際にはRegistry登録済みであるため若干古い（Refactor #53以前の名残と推測される）。動作に影響しないコメントのみの軽微な不整合であり、本Issueでは修正しない（無関係な既存ファイルへの修正を持ち込まない方針のため）
