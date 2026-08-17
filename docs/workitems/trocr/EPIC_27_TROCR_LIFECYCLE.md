# [Epic] TrOCR学習・評価・Benchmark・Release Gate統合

Issue: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)

Parent: なし（[Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)の後続Epic。Epic #1は既存OCR推論経路へのTrOCR統合が完了し、Closed 2026-07-31）

**責務の範囲（2026-07-31整理）**: 本Epicは**TrOCR固有**のライフサイクル（Training/Evaluation/Benchmark/Release Gate）のみを扱う。`ModelMetadata`の既存コードへの本格配線（生成・保存・Models連携・Inference連携・Evaluation連携・旧モデル管理方式からの移行）は、TrOCRに限らない別責務のため、[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure）で扱う。本Epicの「TrOCR学習成果物の保存」は、Epic #28の決定（`ModelMetadata`経由か既存`.ocr.json`/`.tess.json`パターン踏襲か）を前提として進める。

## 背景

[Epic #1（Transformer OCR対応基盤とTrOCR統合）](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)により、TrOCRは既存OCR推論経路（OCR Pipeline / 既存OCR推論API / Frontend推論画面）へ統合済みである。

```text
Engine Registry → resolve_engine_id() → OCR Pipeline → {PaddleOCR, EasyOCR, Tesseract, TrOCR}
```

ユーザーはFrontendからTrOCRを選択し、モデル参照（Hugging Face model ID・ローカルパス、または登録済みモデルからの選択）を指定して推論を実行できる。

一方、TrOCRの**学習・評価・Benchmark比較・Release Gate（本番リリース判定）**は未着手である。Epic #1のスコープが「既存推論経路への統合」に整理されたことに伴い、これらは本Epic（Epic #27）へ引き継いだ。

## 目的

- TrOCRをOCR Crafterの学習対象へ追加できる構成を確立する
- TrOCRの評価（CER等の指標）を既存フローへ統合する
- TrOCRをBenchmark Runner/Benchmark Centerでの比較対象に含める
- TrOCRモデルをRelease Gate（Draft/Validated/Candidate/Production/Archived）の対象に含める
- 既存OCRエンジン（Tesseract/PaddleOCR/EasyOCR）の学習・評価・Benchmark・Release Gateの動作に回帰がない設計にする

## Progress

⬜ Training（`services/trocr_pipeline.py`学習Backend。Hugging Face Transformers経由、`VisionEncoderDecoderModel`+`Seq2SeqTrainer`。公式`unilm/trocr`（fairseq）は不採用。詳細は[ARCHITECTURE_DRAFT.md](ARCHITECTURE_DRAFT.md)・[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)参照）

Evaluation（評価連携の方針決定・confidence算出方法の確定。`ocr_evaluation.py`のTesseract専用制約への対応可否を含む）

```text
Evaluation
  ✅ Multi-engine Evaluation API Design
  ✅ Common Evaluation Schema
  ✅ Common Metric Calculator
  ✅ Evaluation Dispatcher
  ✅ Evaluation Runner
  ✅ Tesseract Predictor Adapter
  ✅ PaddleOCR Predictor
  ✅ EasyOCR Predictor
  ✅ TrOCR Predictor
  ⬜ Multi-engine API Integration
  ⏸ Evaluation UI Integration（Backend完了後、Epic #46で再開）
  ⬜ Cleanup
```

Multi-engine Evaluation API Design（Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)、**Completed**・Closed。PR [#62](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/62)をSquash Merge・mainへ反映済み、Merge Commit: `34aea57`）。採用Architecture: 共通Evaluation Runner + Engine別Predictorへ分離、canonical engine_idによるDispatcher、Benchmark Variant Keyとは別責務として維持、既存APIを後方互換で拡張。成果物: [MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)・[ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md)。

Common Evaluation Schema実装（Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)、**Completed**・Closed。PR [#64](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/64)をSquash Merge・mainへ反映済み、Merge Commit: `4663dd0`）。`OcrEvalTarget.options`（ターゲット単位のEngine固有オプション）と、`OcrEvaluationMetrics`/`OcrEvaluationSampleResult`/`OcrEvaluationConfusion`/`OcrEvaluationResult`（後続Runnerが使う内部共通Result Schema）を実装。count系はstrict int、float系はint/floatのみ許可しbool・数値文字列・非有限値（NaN/Infinity/-Infinity）を拒否、confidenceはnullableで実測`0.0`を許可。`options`/`engine_details`のJSON serializable性はAPI Integration境界の責務、`sample_count`重複はRunnerで整合方針を確定する暫定方針のまま。既存API・Dispatcher・Predictor・Metric Calculatorは無変更（未配線）。クリーン環境ではIssue #8のみ既知の失敗として残る（無関係）。詳細は[COMMON_EVALUATION_SCHEMA_63.md](COMMON_EVALUATION_SCHEMA_63.md)参照。

Common Evaluation Metric Calculator実装（Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)、**Completed**・Closed。PR [#66](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/66)をSquash Merge・mainへ反映済み、Merge Commit: `b2de141`）。`src/app/services/evaluation_metrics.py`を新設し、`calculate_sample_metrics`/`calculate_evaluation_metrics`/`aggregate_confusions`を実装。CERは既存仕様どおりマイクロ平均、character_accuracyは負値許容、confusionは`from→expected`/`to→predicted`変換。`sample_count`重複は`metrics.sample_count`をCanonicalとする方針を確定。既存`ocr_evaluation.py`への配線は見送り（logger名互換問題を含めTesseract Predictor Adapter Issueへ持ち越し）。詳細・Future Work（レビューMinor5件）は[COMMON_EVALUATION_METRICS_65.md](COMMON_EVALUATION_METRICS_65.md)参照。次の実装対象はEvaluation Dispatcher（Feature #67、詳細は次段落参照）。

Evaluation Dispatcher実装（Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)、**Completed**・Closed。PR [#68](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/68)をSquash Merge・mainへ反映済み、Merge Commit: `83e4eec`）。`src/app/services/evaluation_dispatcher.py`を新設し`EvaluationDispatcher`（register/resolve/dispatchのみ）と`EnginePredictor` Protocolを実装。Backend `EngineCapability.supports_evaluation`を初めて参照（Dispatcherのみ）。tesseractのみ`supports_evaluation=True`、paddleocr/easyocr/trocrは登録済みだが`supports_evaluation=False`（Unsupported Engineは`UnsupportedEvaluationEngineError`）、customはBackend Engine Registry未登録のため`UnknownEvaluationEngineError`。**Evaluation DispatcherとEvaluation Runnerは別責務・別完了項目として扱う**（Dispatcherのみ実装済み、Runnerは未着手）。Backend Engine Registry・Capability以外への依存なし（Predictor実装・Runner・API・UIは未着手）。マージ前レビューはBlocker/Majorなし・Minor 2件/Suggestion 3件（Future Workへ記録、Productionコード変更なし）でApprove。詳細・Future Workは[EVALUATION_DISPATCHER_67.md](EVALUATION_DISPATCHER_67.md)参照。次の実装対象はEvaluation Runner。

Evaluation Runner実装（Feature [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)、**Completed**・Closed。PR [#70](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/70)をSquash Merge・mainへ反映済み、Merge Commit: `c5bd7eb`）。`src/app/services/evaluation_runner.py`を新設し、Dispatcher・Predictor・Metric Calculator・Common Schemaを接続する共通Evaluation Loopを実装。`resolve()`をrun開始時に1回だけ呼びPredictorを全Sampleで再利用（TrOCRのbuild-once設計前提）。malformedな`PredictionResult`（生文字列/`None`/dict/tuple等）・`calculate_sample_metrics()`のSchema Validation失敗を含むSample単位の異常はSample Failure Boundaryで隔離しRunを継続（`BaseException`は捕捉しない）。Unknown/Unsupported Engine・未registerは「Run開始前エラー」として上位へ伝播し区別する。エラーメッセージは例外クラス名のみ保持。`result.sample_count == metrics.sample_count`（失敗Sampleを含む入力総数、CER/exact match/confusionからは除外）。Issue #67のFuture Workだった`register()`のengine_id整合性検証も本Issueで`EvaluationDispatcher.register()`へ追加した（既存Dispatcherテストは無修正のまま成功）。修正後の再レビューはBlocker/Majorなし・Minor 2件（Future Workへ記録）でApprove。Predictor実装・API接続・Job化は未着手。詳細は[EVALUATION_RUNNER_69.md](EVALUATION_RUNNER_69.md)参照。次の実装対象はTesseract Predictor Adapter。

Tesseract Evaluation Predictor Adapter実装（Feature [#71](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/71)、**Completed**・Closed。PR [#72](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/72)をSquash Merge・mainへ反映済み、Merge Commit: `f8c7883`）。`src/app/services/tesseract_evaluation_predictor.py`を新設し、既存Tesseract評価推論経路（`ocr_evaluation.py::build_recognizer`）を`EnginePredictor`としてEvaluation Runnerから利用可能にした。新しいModel Resolver・PSM/whitelist優先順位・前処理ロジックは実装せず既存処理をそのまま再利用（既存Tesseract評価結果は無変更）。build-oneはmodel解決関連のみで、実OCR実行はSample単位のまま。confidence取得不能時は`None`を保持（捏造しない）。engine_detailsは常に`None`（利用先なし・Path露出回避）。モデル解決失敗はPredictor construction時に伝播（Run開始前エラー相当）、OCR失敗はRunnerのSample Failure Boundaryが隔離する。`EnginePredictor` Protocolの`Any`戻り値は具体化しなかった（案B、循環import回避）。マージ前レビューはBlocker/Majorなし・Minor 3件/Suggestion 1件（Future Workへ記録）でApprove。詳細は[TESSERACT_EVALUATION_PREDICTOR_71.md](TESSERACT_EVALUATION_PREDICTOR_71.md)参照。次の実装対象はPaddleOCR Evaluation Predictor。

PaddleOCR Evaluation Predictor実装（Feature [#73](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/73)、**Completed**・Closed。PR [#74](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/74)をSquash Merge・mainへ反映済み、Merge Commit: `b1749f7`）。`src/app/services/paddleocr_evaluation_predictor.py`を新設し、既存PaddleOCR推論経路（`predict.py`のreader構築ヘルパー・`_run_paddleocr()`。専用の評価経路は既存になく、`benchmark.py`が使う同じヘルパーを直接再利用）を`EnginePredictor`化した。official/custom判定は既存`_predict_with_paddleocr()`と同一順序、BenchmarkのVariant Key軸は持ち込まずcanonical engine_id="paddleocr"の1つに統一。既存の「複数検出結果のうち最大confidence採用」ルールをそのまま踏襲（confidenceは常にfloat、検出0件時は0.0）。2つ目の実Predictor追加にあたり`PredictionResult`を`evaluation_types.py`へ切り出し（Issue #71 Future Work解消）、`EnginePredictor.recognize()`の戻り値型も具体化した（循環importなし）。`paddleocr.supports_evaluation`を`True`へ変更（API自動有効化なしを確認済み）。マージ前レビューでCI環境依存の1件（paddleocr未インストールCI環境でのtest不具合）を検出、Productionコードは変更せずtest側でmodule stubによりCI非依存化して修正（Blocker/Majorなし、Approve）。既存`POST /api/predict`・`ocr_evaluation.py`・`benchmark.py`は無変更。詳細は[PADDLEOCR_EVALUATION_PREDICTOR_73.md](PADDLEOCR_EVALUATION_PREDICTOR_73.md)参照。次の実装対象はEasyOCR Evaluation Predictor。

EasyOCR Evaluation Predictor実装（Feature [#75](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/75)、**Completed**・Closed。PR [#76](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/76)をSquash Merge・mainへ反映済み、Merge Commit: `1d5923a`）。`src/app/services/easyocr_evaluation_predictor.py`を新設し、既存EasyOCR推論経路（`predict.py`の`_get_easyocr_reader`/`_run_easyocr`。専用の評価経路もBenchmark用の実行経路も既存になし）を`EnginePredictor`化した。実装前調査でEasyOCRにはPaddleOCRのようなcustom/学習済みモデル解決が存在しない（official Readerのみ）ことを確認し、PaddleOCRのcustom model設計は持ち込んでいない。既存の「最大confidence採用」ルールをそのまま踏襲（confidenceは常にfloat、検出0件時は0.0）。PaddleOCR Issue #73のCI環境依存の教訓を踏まえ、本Predictorは`_get_easyocr_reader()`という単一の既存関数のみに依存し独自の`import easyocr`を持たない設計とした（module stub不要でCI非依存にテスト可能）。`easyocr.supports_evaluation`を`True`へ変更（API自動有効化なしを確認済み）。マージ前レビューはBlocker/Majorなし・Minor 1件/Suggestion 2件（Future Workへ記録）でApprove。既存`POST /api/predict`・`ocr_evaluation.py`・`benchmark.py`は無変更。詳細は[EASYOCR_EVALUATION_PREDICTOR_75.md](EASYOCR_EVALUATION_PREDICTOR_75.md)参照。次の実装対象はTrOCR Evaluation Predictor。

TrOCR Evaluation Predictor実装（Feature [#77](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/77)、**Completed**・Closed。PR [#78](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/78)をSquash Merge・mainへ反映済み、Merge Commit: `28c1bcf`）。`src/app/services/trocr_evaluation_predictor.py`を新設し、既存TrOCR単一画像推論コア（`trocr_engine.py::TrOCREngine`）を`EnginePredictor`化した。既存`predict.py::_predict_with_trocr()`は呼び出しのたびに`TrOCREngine.load()`し直す設計のためこの関数は呼ばず、`TrOCREngine`自身のbuild-once契約（`load()`で1回・`predict_file()`を繰り返し呼ぶ）を直接利用。TrOCR用のmodel resolutionは既存に存在しないため、Evaluation専用の新Resolverや`"latest"`等の特殊値フォールバックは発明していない。confidenceは`TrOCRResult`が属性自体を持たないため常に`None`（独自変換なし）。`trocr.supports_evaluation`を`True`へ変更した結果、既定Registry登録済みの4エンジン（tesseract/paddleocr/easyocr/trocr）全てがTrueとなった（API自動有効化なしを確認済み）。マージ前レビューはBlocker/Majorなし・Minor 2件/Suggestion 1件（Future Workへ記録）でApprove。既存`POST /api/predict`・`ocr_evaluation.py`・`benchmark.py`・`trocr_engine.py`は無変更。詳細は[TROCR_EVALUATION_PREDICTOR_77.md](TROCR_EVALUATION_PREDICTOR_77.md)参照。次の実装対象はMulti-engine API Integration。

⬜ Benchmark（Benchmark Runner/Benchmark Centerへの`ENGINE_CATALOG`/`ENGINE_BUILDERS`登録）

⬜ Release Gate（`release_gate.py`のモデル対象へTrOCRを含める）

⬜ Frontend（Training UI・Evaluation UIへのTrOCR対応。`TrainingView.jsx`の既存ドロップダウンへTrOCR選択肢を追加）

⬜ Documentation（ユーザーマニュアル・チュートリアル。学習成果物ができてから実用的な内容を書く）

**Model Metadata本格連携（ModelMetadataの生成・保存・Models/Inference/Evaluation連携・旧モデル管理方式からの移行）は、本Epicのスコープ外。[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure）の責務。** 本Epicで学習成果物の保存方式を決める際は、Epic #28の決定を前提とする（詳細は[Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)・[ISSUE_MAP.md](ISSUE_MAP.md)の「Future Work」参照）。

## 対象範囲候補

- TrOCR学習Backend
- Dataset連携
- Experiment Tracking連携
- TrOCR評価
- Benchmark Runner連携
- Benchmark Center連携
- Release Gate連携
- Training UI / Evaluation UI
- テスト
- ユーザーマニュアル・チュートリアル

## 対象外（現時点）

- PARSeq/ABINet/ViTSTR/Donut等、TrOCR以外の新規Recognitionエンジン
- 文書レイアウト解析
- 既存OCRエンジン（Tesseract/PaddleOCR/EasyOCR）の学習・評価・Benchmark・Release Gateロジックの全面再設計
- `ModelMetadata`の既存コードへの本格配線（生成・保存・Models/Inference/Evaluation連携・旧モデル管理方式からの移行。[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)の責務）

## 完了条件

- TrOCR学習が実行できる
- TrOCRモデルを保存・識別できる（保存方式は[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)の`ModelMetadata`実運用化方針、または既存`.ocr.json`/`.tess.json`パターン踏襲のいずれかに従う）
- TrOCRモデル評価が実行できる
- Datasetとの系譜を追跡できる
- Experimentとの系譜を追跡できる
- Benchmark関連画面と整合する
- Release Gateの対象に含まれる
- 既存OCRエンジンへ回帰がない
- ユーザー向けドキュメントが整備されている

## 子Issue

未作成。[ISSUE_MAP.md](ISSUE_MAP.md)のPhase4（Training/Evaluation）・Phase6（Benchmark）を参照し、順次作成する。

## 前提Epic

[Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Transformer OCR対応基盤とTrOCR統合。既存推論経路へのTrOCR統合完了、Closed）

## 関連Epic（別責務）

[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure）。`ModelMetadata`の生成・保存・Models連携・Inference連携・Evaluation連携・旧モデル管理方式からの移行を扱う、TrOCRに限らない別責務のEpic。Investigation（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)）完了、Migration計画は[MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)参照。

## 関連資料

`docs/workitems/trocr/`（Issue Map・設計ドキュメントをEpic #1と共有）
