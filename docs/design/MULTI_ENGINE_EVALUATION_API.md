# Multi-engine Evaluation API Architecture

Related: Issue [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)（Design: Multi-engine Evaluation API Architecture、**Completed**・Closed） / ADR [0003（Accepted）](../adr/ADR-0003_Multi_Engine_Evaluation.md) / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46)（Engine UI Generalization） / Design [#59](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/59) / [docs/EVALUATION_UI_GENERALIZATION.md](../EVALUATION_UI_GENERALIZATION.md) / ADR [0001](../adr/ADR-0001_Trocr_Architecture.md) / ADR [0002](../adr/ADR-0002_Unified_Model_Metadata.md) / [docs/design/ENGINE_REGISTRY.md](ENGINE_REGISTRY.md) / [docs/design/ENGINE_CAPABILITY.md](ENGINE_CAPABILITY.md) / [docs/design/TROCR_BACKEND.md](TROCR_BACKEND.md)

**本ドキュメントは調査・設計のみを対象とする。実装（Dispatcher実装・Evaluator実装・API変更・TrOCR評価実装・Engine Registry変更・Models API変更・OcrEvaluationView変更・Benchmark変更）は一切行わない。**

**状態（2026-08-03）**: **Architecture: Accepted**。Issue #61はCompleted・Closed。PR [#62](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/62)をSquash Merge・mainへ反映済み（Merge Commit: `34aea57`）。本ドキュメントの設計判断（7章の採用Architecture＝案B「共通Evaluation Runner + Engine別Predictor」、13章のModel Resolution方針、16章の後方互換方針＝既存APIを維持・拡張）は[ADR-0003（Accepted）](../adr/ADR-0003_Multi_Engine_Evaluation.md)として正式に確定した。

**Evaluation UIの一般化（`OcrEvaluationView.jsx`等）はBackend実装完了待ち**（Epic #46側、責務境界は変更なし）。

**Common Evaluation Schema: Completed**（Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)、19章のPhase 3に相当。**Completed**・Closed。PR [#64](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/64)をSquash Merge・mainへ反映済み、Merge Commit: `4663dd0`）。`OcrEvalTarget.options`・`OcrEvaluationMetrics`/`OcrEvaluationSampleResult`/`OcrEvaluationConfusion`/`OcrEvaluationResult`を実装。count系はstrict int、float系はint/floatのみ許可し、bool・数値文字列・非有限値（NaN/Infinity/-Infinity）を拒否する（既存Request Schemaの`psm`等は対象外）。confidenceはnullableで実測`0.0`を許可、`options`/`engine_details`のJSON serializable性はAPI Integration境界の責務とし本Schemaでは検証しない。`sample_count`の重複（Result/metrics）はRunnerで整合方針を確定する暫定方針のまま。既存APIは無変更・未配線。クリーン環境ではIssue #8のみ既知の失敗として残る（本Featureとは無関係）。詳細は[docs/workitems/trocr/COMMON_EVALUATION_SCHEMA_63.md](../workitems/trocr/COMMON_EVALUATION_SCHEMA_63.md)参照。

**Common Metric Calculator: Completed**（Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)、19章のPhase 2〜3に相当。**Completed**・Closed。PR [#66](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/66)をSquash Merge・mainへ反映済み、Merge Commit: `b2de141`）。`src/app/services/evaluation_metrics.py`を新設し、`normalize_compare`/`levenshtein_ops`（既存`ocr_evaluation.py`と出力一致をテストで直接検証、logger名の副作用を避けるため独立実装として用意）、`calculate_sample_metrics`/`calculate_evaluation_metrics`/`aggregate_confusions`（Common Evaluation Schemaを出力に利用）を実装。CERは既存仕様どおりマイクロ平均、character_accuracyは負値許容、confusionは`from→expected`/`to→predicted`変換。`sample_count`重複は`metrics.sample_count`をCanonicalとする方針を確定（Result全体は本Issueでは生成しない）。既存Tesseract評価（`ocr_evaluation.py`）への配線は見送り、**logger名の互換問題（U+FFFD警告の出力元logger名不一致）を含めTesseract Predictor Adapter Issueへ持ち越し**。confusionの決定的sortは本Calculator内のみで、**既存API（`POST /api/ocr/evaluate`）の並び順へはまだ反映されていない**。クリーン環境ではIssue #8のみ既知の失敗として残る（本Featureとは無関係）。詳細・Future Work（レビューMinor指摘5件）は[docs/workitems/trocr/COMMON_EVALUATION_METRICS_65.md](../workitems/trocr/COMMON_EVALUATION_METRICS_65.md)参照。Issue分割案（19章）は確定版として整理済み。

**Evaluation Dispatcher: Completed**（Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)、7章の採用Architectureにおける`EvaluationDispatcher`部分に相当。**Completed**・Closed。PR [#68](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/68)をSquash Merge・mainへ反映済み、Merge Commit: `83e4eec`）。`src/app/services/evaluation_dispatcher.py`を新設し、`register`/`resolve`/`dispatch`のみを実装。Backend `EngineCapability.supports_evaluation`を初めて参照（Dispatcherのみが参照、Predictor側は参照しない。canonical engine_idで解決し、Predictorインスタンス自体はRegistryへ保持しない）。実際の値はtesseractのみ`supports_evaluation=True`、paddleocr/easyocr/trocrはRegistry登録済みだが`supports_evaluation=False`。Unknown Engine（`custom`はBackend Registry未登録のため該当）は`UnknownEvaluationEngineError`、Unsupported Engineは`UnsupportedEvaluationEngineError`。**Evaluation DispatcherとEvaluation Runnerは別責務・別完了項目であり、Runnerは本ドキュメント時点で未着手（Not Started）。** Backend Engine Registry・Capability以外への依存はない。既存`POST /api/ocr/evaluate`は無変更・未配線。マージ前レビューはBlocker/Majorなし・Minor 2件/Suggestion 3件（Future Workへ記録、Productionコード変更なし）でApprove。クリーン環境ではIssue #8のみ既知の失敗として残る（本Featureとは無関係）。詳細は[docs/workitems/trocr/EVALUATION_DISPATCHER_67.md](../workitems/trocr/EVALUATION_DISPATCHER_67.md)参照。次の実装対象はEvaluation Runner。

**Evaluation Runner: Completed**（Feature [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)、7章の採用Architectureにおける`EvaluationRunner`部分に相当。**Completed**・Closed。PR [#70](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/70)をSquash Merge・mainへ反映済み、Merge Commit: `c5bd7eb`）。`src/app/services/evaluation_runner.py`を新設し、`EvaluationDispatcher`（Issue #67）・`EnginePredictor`・Common Evaluation Metric Calculator（Issue #65）・Common Evaluation Schema（Issue #63）を接続する共通Evaluation Loopを実装。`dispatcher.resolve(engine_id)`をrun開始時に1回だけ呼びPredictorを全Sampleで再利用する（TrOCRのbuild-once設計を前提。`dispatch()`を毎Sample呼ぶ設計は不採用）。Predictor出力契約`PredictionResult`（`text`/`confidence`/`engine_details`）を`evaluation_runner.py`側で定義したが、`EnginePredictor` Protocol自体は変更していない。Sample単位の失敗（`recognize()`の例外・戻り値が`PredictionResult`契約に反する場合・`calculate_sample_metrics()`のSchema Validation失敗を含む一連の処理）は失敗Sampleとして記録しRunを継続、Unknown/Unsupported Engine・未registerは「Run開始前エラー」としてそのまま上位へ伝播（区別する）。**マージ前レビューMajor #1の是正として、Sample単位の`try`/`except`の範囲を`recognize()`呼び出しのみから、戻り値の契約検証・`calculate_sample_metrics()`呼び出しまで拡張し、Predictorの契約違反1件でRun全体が中断しないようにした（`BaseException`は捕捉しない）。** エラーメッセージは例外クラス名のみを保持（メッセージ本文は含めない）。`metrics.sample_count`は入力Sample総数と一致し（失敗Sampleも含めて`calculate_evaluation_metrics()`へ渡す既存設計を利用）、`result.sample_count`との同期を自然に満たす。Confusionは成功Sampleのみから全件（top-N制限なし）を集計する。あわせて、Issue #67のFuture Workであった`register(engine_id, predictor)`と`predictor.engine_id`の整合性検証を`EvaluationDispatcher.register()`へ追加した（既存Dispatcherテストは無修正のまま成功）。Predictor実装・API接続・Job化は未着手。修正後の再レビューはBlocker/Majorなし・Minor 2件（Future Workへ記録）でApprove。詳細は[docs/workitems/trocr/EVALUATION_RUNNER_69.md](../workitems/trocr/EVALUATION_RUNNER_69.md)参照。次の実装対象はTesseract Predictor Adapter。

**Tesseract Evaluation Predictor Adapter: Completed**（Feature [#71](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/71)、**Completed**・Closed。PR [#72](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/72)をSquash Merge・mainへ反映済み、Merge Commit: `f8c7883`）。`src/app/services/tesseract_evaluation_predictor.py`を新設し、既存Tesseract評価推論経路（`ocr_evaluation.py::build_recognizer`→`tesseract_pipeline.py::recognize_line`）を`EnginePredictor`として`EvaluationRunner`から利用可能にした。新しいModel Resolver・PSM/whitelist優先順位・前処理ロジックは実装せず既存`build_recognizer()`をそのまま再利用（既存Tesseract評価結果は無変更）。build-oneはTesseract実行ファイル・tessdata_dir/lang・学習後モデルの`training_preprocess`メタ情報のみで、実OCR実行（`recognize_line()`）はSample単位のまま。confidence取得不能時は既存仕様どおり`None`を保持（捏造しない）。`engine_details`は現時点では常に`None`（利用先がなく、ファイルシステムPathの露出も避ける）。モデル解決失敗はPredictor construction時にそのまま伝播（Run開始前エラー相当）、OCR失敗は`recognize()`から伝播させRunnerの既存Sample Failure Boundaryが隔離する。`EnginePredictor` Protocolの戻り値`Any`は具体化しなかった（案B。Dispatcher⇄Runner循環import回避のため、型の第三モジュール切り出しはFuture Work）。既存`POST /api/ocr/evaluate`・`ocr_evaluation.py`・`evaluation_dispatcher.py`・`evaluation_runner.py`は無変更。マージ前レビューはBlocker/Majorなし・Minor 3件/Suggestion 1件（Future Workへ記録）でApprove。詳細は[docs/workitems/trocr/TESSERACT_EVALUATION_PREDICTOR_71.md](../workitems/trocr/TESSERACT_EVALUATION_PREDICTOR_71.md)参照。次の実装対象はPaddleOCR Evaluation Predictor。

**PaddleOCR Evaluation Predictor: Completed**（Feature [#73](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/73)、**Completed**・Closed。PR [#74](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/74)をSquash Merge・mainへ反映済み、Merge Commit: `b1749f7`）。`src/app/services/paddleocr_evaluation_predictor.py`を新設し、既存PaddleOCR推論経路（`predict.py`のreader構築ヘルパー・`_run_paddleocr()`。`ocr_evaluation.py::build_recognizer()`はPaddleOCR未対応のため専用評価経路が既存になく、`benchmark.py`が既に使う同じヘルパーを直接再利用した）を`EnginePredictor`化した。新しいModel Resolver・confidence集約式は実装せず既存ヘルパーをそのまま再利用。official/custom判定は既存`_predict_with_paddleocr()`と同一順序を再現しつつ、Benchmarkの`paddleocr_official`/`paddleocr_custom`というVariant Key軸は持ち込まずcanonical engine_id="paddleocr"の1つに統一。既存`_run_paddleocr()`の「複数検出結果のうち最大confidence採用」ルールをそのまま踏襲し、confidenceは常にfloat（検出0件時は0.0。Tesseractの`Optional[float]`とは異なる既存の実際の契約差）。**2つ目の実Predictor追加にあたり、`PredictionResult`を独立した葉モジュール`evaluation_types.py`へ切り出し（Issue #71 Future Work Minor 3の解消）、`EnginePredictor.recognize()`の戻り値型も`Any`から`PredictionResult`へ具体化した**（循環importなし、既存テストは無修正のまま成功）。Backend Engine Registryの`paddleocr.supports_evaluation`を`False`から`True`へ変更した（参照箇所は`resolve()`のみでAPI自動有効化なしを確認済み）。マージ前レビューでCI環境依存の1件（paddleocr未インストールCI環境でfallback reader construction testが失敗）を検出し、Productionコードは変更せずtest側でmodule stubによりCI非依存化して修正済み。既存`POST /api/predict`・`POST /api/ocr/evaluate`・`ocr_evaluation.py`・`benchmark.py`は無変更。詳細は[docs/workitems/trocr/PADDLEOCR_EVALUATION_PREDICTOR_73.md](../workitems/trocr/PADDLEOCR_EVALUATION_PREDICTOR_73.md)参照。次の実装対象はEasyOCR Evaluation Predictor。

**EasyOCR Evaluation Predictor: Completed**（Feature [#75](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/75)、**Completed**・Closed。PR [#76](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/76)をSquash Merge・mainへ反映済み、Merge Commit: `1d5923a`）。`src/app/services/easyocr_evaluation_predictor.py`を新設し、既存EasyOCR推論経路（`predict.py`の`_get_easyocr_reader`/`_run_easyocr`。専用の評価経路もBenchmark用の実行経路も既存になし）を`EnginePredictor`化した。実装前調査でEasyOCRにはPaddleOCRのようなcustom/学習済みモデル解決が存在しない（official Readerのみ）ことを確認し、PaddleOCRのcustom model設計は持ち込んでいない。既存`_run_easyocr()`の「複数検出結果のうち最大confidence採用」ルールをそのまま踏襲し、confidenceは常にfloat（検出0件時は0.0）。**PaddleOCR Issue #73のCI環境依存の教訓を踏まえ、本Predictorは`_get_easyocr_reader()`という単一の既存関数のみに依存し独自の`import easyocr`を持たない設計とした**（module stub不要でCI非依存にテスト可能。`sys.modules["easyocr"]=None`での実測を含めCI非依存性を直接確認済み）。Backend Engine Registryの`easyocr.supports_evaluation`を`False`から`True`へ変更した（参照箇所は`resolve()`のみでAPI自動有効化なしを確認済み）。マージ前レビューはBlocker/Majorなし・Minor 1件/Suggestion 2件（Future Workへ記録、Productionコード追加修正なし）でApprove。既存`POST /api/predict`・`POST /api/ocr/evaluate`・`ocr_evaluation.py`・`benchmark.py`は無変更。詳細は[docs/workitems/trocr/EASYOCR_EVALUATION_PREDICTOR_75.md](../workitems/trocr/EASYOCR_EVALUATION_PREDICTOR_75.md)参照。次の実装対象はTrOCR Evaluation Predictor。

**TrOCR Evaluation Predictor: Completed**（Feature [#77](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/77)、**Completed**・Closed。PR [#78](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/78)をSquash Merge・mainへ反映済み、Merge Commit: `28c1bcf`）。`src/app/services/trocr_evaluation_predictor.py`を新設し、既存TrOCR単一画像推論コア（`trocr_engine.py::TrOCREngine`）を`EnginePredictor`化した。既存`predict.py::_predict_with_trocr()`は呼び出しのたびに`TrOCREngine.load()`し直す設計（本Issueスコープ外の既存仕様）のためこの関数は呼ばず、`TrOCREngine`自身が持つ「`load()`で1回ロード・同一インスタンスの`predict()`/`predict_file()`を繰り返し呼ぶ」build-once契約を直接利用した。`model_registry.py`・`benchmark.py`いずれにもTrOCR用のmodel resolutionは存在しないことを確認し、Evaluation専用の新しいResolverや`"latest"`等の特殊値フォールバックは発明していない。`TrOCRResult`はconfidence/bbox属性を一切持たないため、confidenceは常に`None`（独自変換なし）、bboxも扱わない。Backend Engine Registryの`trocr.supports_evaluation`を`False`から`True`へ変更した結果、既定Registry登録済みの4エンジン全て（tesseract/paddleocr/easyocr/trocr）が`supports_evaluation=True`となった（参照箇所は`resolve()`のみでAPI自動有効化なしを確認済み）。マージ前レビューはBlocker/Majorなし・Minor 2件/Suggestion 1件（Future Workへ記録、Productionコード追加修正なし）でApprove。既存`POST /api/predict`・`POST /api/ocr/evaluate`・`ocr_evaluation.py`・`benchmark.py`・`trocr_engine.py`は無変更。詳細は[docs/workitems/trocr/TROCR_EVALUATION_PREDICTOR_77.md](../workitems/trocr/TROCR_EVALUATION_PREDICTOR_77.md)参照。次の実装対象はMulti-engine API Integration。

**Multi-engine Evaluation API Integration: Implemented, PR review pending**（Feature [#79](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/79)）。既存`POST /api/ocr/evaluate`の`ocr_evaluation.py::evaluate_ocr()`は1行も変更せず、全targetが`engine="tesseract"`のリクエストは無条件に既存経路を通す（既存呼び出し元は実コード調査の結果100%tesseractのみだったため完全に後方互換）。1つでも非Tesseractエンジンを含むリクエストのみ、新設`src/app/services/evaluation_multi_engine.py::run_multi_engine_evaluation()`（Composition Root `build_predictor()` + target単位で新規生成する`EvaluationDispatcher`/`EvaluationRunner`）へルーティングする。Predictorはrequestごと・target単位でbuild-once（グローバルSingletonは新設しない）。前処理は既存`preprocess_ocr_image()`によるTesseract固有のCRNN入力整形を新経路では行わず、`none`（無加工）/`manual`（Engine非依存の`apply_eval_preprocess()`のみ）の2モードに限定し、`training`/`training_individual`（Tesseract学習後モデルの`training_preprocess`メタデータに依存する概念）は非Tesseractエンジンを含むリクエストでは明示的に拒否する（Future Work）。Responseは新規DTOを追加せず、`targets[]`/`rows[]`/`comparison`という既存キー命名に寄せた辞書へ変換する（`comparison`はEngine横断で一般化しないため常に`None`、Future Work）。`main.py`へ`UnknownEvaluationEngineError`/`UnsupportedEvaluationEngineError`/`EvaluationDispatcherError`→400のerror mappingを追加。既存`ocr_evaluation.py`・`evaluation_runner.py`・`evaluation_dispatcher.py`・`evaluation_metrics.py`・4つのPredictor・`schemas.py`・`frontend/`は無変更。詳細は[docs/workitems/trocr/MULTI_ENGINE_EVALUATION_API_INTEGRATION_79.md](../workitems/trocr/MULTI_ENGINE_EVALUATION_API_INTEGRATION_79.md)参照。

---

## 1. 目的

現行の`POST /api/ocr/evaluate`はTesseract専用実装であり、PaddleOCR/EasyOCR/TrOCRを評価できない。これはADR-0001でも「TrOCR固有の課題ではなく、PaddleOCRも含む既存の積み残し」と明記されている、以前からの技術的負債である（[ADR-0001](../adr/ADR-0001_Trocr_Architecture.md):116-119）。

本ドキュメントは、以下の共通アーキテクチャを実装なしで確定する。

```text
Evaluation Request
        ↓
Evaluation Dispatcher
        ↓
Engine別Evaluator（Predictor）
        ├── Tesseract
        ├── PaddleOCR
        ├── EasyOCR
        └── TrOCR
        ↓
共通Evaluation Result
```

確定する内容: 現行APIの事実／Tesseract固有処理／共通化可能な評価処理／Engine Dispatcherの責務／Engine別Evaluatorの責務／共通Request・Response Schema／Metric Schema／TrOCR評価方式／Benchmarkとの責務境界／後方互換Migration／実装Issue分割。

---

## 2. 現行実装

### 2.1 Endpoint

- URL: `POST /api/ocr/evaluate`（`src/app/main.py:4757`）
- 関数: `api_ocr_evaluate(req: OcrEvaluateRequest, request: Request) -> dict[str, Any]`（`main.py:4758`）
- `def`（同期）。`async def`ではない。明示的なThread Pool呼び出し（`run_in_threadpool`等）・`BackgroundTasks`利用なし（FastAPI/Starletteの暗黙外部スレッドプールで実行されるのみ）
- `response_model`指定なし（`main.py`全体で`response_model=`は0件）。戻り値は素の`dict`（型注釈`-> dict[str, Any]`はFastAPIによる検証を受けない）
- Request Bodyは`OcrEvaluateRequest`（Pydanticモデル、暗黙のBody）。`Form`/`Query`/`UploadFile`は使用しない（`image_dir`/`gt_csv`はサーバー側パス文字列であり、マルチパートアップロードではない）
- 成功時、`_record_audit_safe(...)`で監査ログを記録（`main.py:4778-4788`。失敗しても例外を握りつぶし応答に影響しない）

### 2.2 Request（`OcrEvaluateRequest`/`OcrEvalTarget`、`src/app/schemas.py:230-262`）

| Field | 型 | 必須 | Tesseract固有 | 共通化可能 | 利用箇所 |
|---|---:|---:|---:|---:|---|
| `project_id` | `Optional[str]`（既定`"default"`） | 否 | 否 | ✅ | 全体 |
| `image_dir` | `str` | ✅ | 否 | ✅ | 評価用画像フォルダ |
| `gt_csv` | `str` | ✅ | 否 | ✅ | 正解CSV（画像名,正解文字列） |
| `targets` | `list[OcrEvalTarget]`（既定=`[{engine:"tesseract",model:"eng"},{engine:"tesseract",model:"latest"}]`） | 否 | 既定値のみ | ✅（構造は既にengine別リスト） | 評価対象リスト |
| `targets[].engine` | `str`（既定`"tesseract"`） | 否 | 既定値のみ | ✅ | 評価エンジン（docstring「現状tesseract」） |
| `targets[].model` | `str`（既定`"latest"`） | 否 | 値の語彙がTesseract前提（`eng`/`.tess.json`/`latest`） | 要設計 | モデル参照 |
| `charset` | `str`（既定=実運用whitelist） | 否 | ✅ | 否 | Tesseract whitelist（他エンジンに等価概念なし） |
| `psm` | `int`（既定`7`、0-13） | 否 | ✅ | 否 | Tesseract Page Segmentation Mode |
| `eval_preprocess` | `Optional[dict]` | 否 | 否 | ✅ | 評価前処理（grayscale/binarize等、エンジン非依存） |
| `preprocess_source` | `Optional[str]`（既定`"none"`） | 否 | 否 | ✅ | 前処理設定の由来 |
| `preprocess_mode` | `Optional[str]` | 否 | 概念は共通だが実データはTesseractのみ | 要設計 | 評価前処理モード（`training`モードは現状Tesseractモデルメタの`training_preprocess`にのみ依拠） |

**重要な発見**: `targets`は既に「エンジン別ペアのリスト」という多エンジン前提の構造を持っている。多エンジン化のボトルネックはRequest Schemaの構造ではなく、(1) `charset`/`psm`がリクエスト全体に対して1つしかない（ターゲットごとに異なるエンジン固有オプションを渡せない）こと、(2) Backendの`build_recognizer()`がTesseract以外を`ValueError`で拒否すること、の2点である。

### 2.3 Response

**フォーマルなSchemaは存在しない**（`response_model`なし、`evaluate_ocr()`が返す素の`dict`をそのまま返却、`main.py:4789`）。実際のキー構造（`src/app/services/ocr_evaluation.py:580-604`）:

```text
{
  project_id, image_dir, gt_csv, charset, psm,
  count, gt_count, skipped_missing_image,
  preprocess_source, eval_preprocess, preprocess_mode,
  evaluation_preprocess: {...}, preprocess_warnings: [...],
  targets: [
    { label, engine, model, is_base, total, correct, accuracy, accuracy_percent,
      mismatch_count, cer, cer_percent, char_accuracy, char_accuracy_percent,
      edit_distance_total, ref_length_total,
      confusions: [...], confusions_full: [...], char_stats: {...},
      training_preprocess_hash, preprocess_match, mismatches: [...] }
  ],
  rows: [
    { image, expected, results: [
      { model_label, engine, model, prediction, confidence, match,
        edit_distance, sub_count, del_count, ins_count } ] }
  ],
  comparison: { base_label, trained_label, base_accuracy, trained_accuracy, ...,
                cer_delta, cer_relative_improvement, improved, unchanged, regressed, ... } | null
}
```

`history id`・`output path`・`timing`（latency）フィールドは**存在しない**（後述6章で確認）。

### 2.4 Tesseract固有処理

- Modelの解決（`.traineddata`ベース or `.tess.json`学習後モデル）、`tessdata_dir`/`lang`、Tesseract CLIサブプロセス呼び出し（`recognize_line`、`tesseract_pipeline.py`経由。`pytesseract`は不使用）
- `charset`（whitelist）・`psm`のリクエストパラメータ、および評価時にそのままTesseract CLIへ渡す仕組み
- ベースモデルエイリアス判定（`eng`/`base`/`eng.traineddata`等）
- 学習時前処理（`training_preprocess`/`training_preprocess_hash`）はTesseractモデルメタにのみ存在

### 2.5 Error Handling

- `FileNotFoundError` → HTTP 404（`main.py:4772-4773`）
- `ValueError` → HTTP 400（`main.py:4774-4775`）
- `RuntimeError` → HTTP 400（`main.py:4776-4777`）
- 上記は本プロジェクト全体の規約（他エンドポイントと同一パターン）
- グローバル`HTTPException`ハンドラ（`main.py:278-286`）が`{error_code, message, details, related_id}`へ統一整形
- グローバルcatch-allミドルウェア（`main.py:291-299`）が未捕捉例外をHTTP 500へ変換し、スタックトレースや内部パスを応答へ含めない（ログのみに記録）
- `ocr_evaluation.py`内部で送出される例外: `FileNotFoundError`（モデル未検出・GT CSV欠落・画像フォルダ欠落）、`ValueError`（未対応engine・GT CSV空・不正preprocess_mode・学習時前処理欠落/不一致・評価対象0件）。`RuntimeError`は`tesseract_pipeline.py`側（Tesseract実行ファイル欠落・非ゼロ終了コード等）から伝播

### 2.6 同期／非同期の現状

現行`api_ocr_evaluate`は同期直接呼び出しのみだが、**既存Job Infrastructureにも`job_type="evaluation"`の非同期経路が既に存在する**ことを確認した（`tests/test_e2e_uat.py:159-162`、`POST /api/jobs`に`job_type: "evaluation"`, `params: {image_dir, gt_csv, targets}`を渡し、`job.result_summary.targets[0].cer`を検証）。この非同期経路の内部実装（`job_runner.py`側の具体的な処理）は本Issueでは調査対象に含めておらず、**実装Issueで詳細確認が必要**（14章参照）。

---

## 3. 問題点

1. `ocr_evaluation.py::build_recognizer()`がTesseract以外を`ValueError`で拒否する単一`if`分岐であり、拡張ポイントが無い（`ocr_evaluation.py:133-140`、コメント「将来: elif engine == "paddleocr": ...」が設計待ちであることを示す）
2. `charset`/`psm`がRequest全体で1つしかなく、ターゲットごとに異なるエンジン固有オプションを表現できない
3. モデル参照解決がTesseract（`ocr_evaluation.py`/`benchmark.py`で共通化済み）・PaddleOCR（`benchmark.py`と`predict.py`が別々に`resolve_ocr_model_meta`を呼ぶ重複実装）・TrOCR（解決層自体が存在せず`model_ref`を素通し）で3種類バラバラに実装されている
4. `evaluate_ocr()`は「共通化可能」（GT読込・Levenshtein・CER・confusion集計）と「Tesseract固有」（認識器構築・前処理サイズのTesseract CRNN前提値）が1関数に混在している
5. Backend Engine Registry/Capabilityには`supports_evaluation`等の評価Capabilityが既に定義されているが（`engine_capability.py:81-86`）、実際にこれを参照して評価対象を判定する箇所が存在しない（未消費のまま）
6. タイミング（処理時間）計測が一切実装されていない
7. WER/Precision/Recall/F1は未実装のまま（後述6章で確認）

---

## 4. Engine別対応状況

| Engine | 推論経路 | Model参照 | Confidence | 評価可能 | 追加実装 |
|---|---|---|---|---:|---|
| Tesseract | `recognize_line()`（Tesseract CLIサブプロセス、`tesseract_pipeline.py`） | `.traineddata`（base）/ `.tess.json`（学習後、`model_registry.resolve_tesseract_model_meta`） | あり | ✅ 実装済み | なし |
| PaddleOCR | `_run_paddleocr()`（`predict.py:573-642`）。`benchmark.py`が既に再利用（`_build_paddleocr_runner`/`_build_paddleocr_custom_runner`） | 公式: `OFFICIAL_PADDLEOCR_REC_MODELS`固定名 / カスタム: `.ocr.json`（`resolve_ocr_model_meta(engine="paddleocr")`） | あり | 配線のみで可能 | `_build_paddleocr_recognizer()`を`ocr_evaluation.py`へ追加（`benchmark.py`の実装を参考に） |
| EasyOCR | `_run_easyocr()`（`predict.py:279-310`、Reader キャッシュあり） | 公式`easyocr.Reader`のみ（カスタムモデル無し。学習未実装） | あり | 配線のみで可能 | `_build_easyocr_recognizer()`を追加（公式/カスタム分岐が不要な分Tesseract/PaddleOCRより単純） |
| TrOCR | `TrOCREngine.load(model_ref).predict()`/`.predict_file()`（`trocr_engine.py`）。単一画像のみ、バッチ未実装 | HF Hub ID／ローカルディレクトリを`from_pretrained()`へそのまま渡す（Model Metadata/Engine Registry経由の解決なし） | **なし**（意図的に持たない設計。`trocr_engine.py:18-20`「推測・捏造した値を返すぐらいなら、confidenceフィールド自体を持たせない」） | Predictorアダプタ新設で可能 | 「1回build→複数回recognize」のインスタンス再利用Predictorを新設（`TrOCREngine.load()`自体はこの再利用を前提に設計済み。ただし現行`predict.py::_predict_with_trocr()`は呼び出しごとに`load()`し直す実装であり、この呼び出しパターンをそのままEvaluationへ流用しない） |
| Custom（分類モデル） | CNN画像分類（`predict.py:1071-1141`）、OCR文字認識ではない | PyTorchチェックポイント直接読込 | あり（ただしクラス分類のsoftmax値、テキスト認識confidenceではない） | 対象外 | 追加しない（テキスト認識でないためCER/Levenshteinベースの評価が成立しない。backend Engine Registryにも未登録＝`resolve_engine_id("custom")`は`None`。フロントエンド`evalOcrSettings.js::EVAL_OCR_ENGINES`も既に`custom`/`trocr`を除外済み） |

Benchmarkの`ENGINE_BUILDERS`（`benchmark.py:319-324`）は`recognize(image_path) -> (text, confidence)`という共通契約を既に4種のBuilderで実証済みであり、これは新Evaluation Dispatcherが踏襲すべき実証済みパターンである（ただしBenchmarkはVariant Key軸、Evaluationはcanonical engine_id軸という軸の違いは維持する。14章参照）。

---

## 5. Architecture比較

### 5.1 `ocr_evaluation.py`の責務分解（要旨）

| 関数 | 分類 | 備考 |
|---|---:|---|
| `_normalize_compare` | 共通化可能 | NFC正規化＋trim。エンジン非依存の純粋関数 |
| `levenshtein_ops` | 共通化可能 | 汎用Levenshtein編集距離＋操作列復元 |
| `_read_gt_csv` | 共通化可能 | 汎用CSV読込 |
| `_resolve_image` | 共通化可能 | 汎用ファイル解決 |
| `_build_tesseract_recognizer` | Tesseract固有 | `tessdata_dir`/`lang`/`.tess.json`規約に全面依存 |
| `build_recognizer` | 要設計 | まさに一般化の拡張点（現状Tesseractのみ分岐） |
| `resolve_evaluation_preprocess_plan` | 要設計 | ロジック構造は汎用だが、依拠する`training_preprocess`は現状Tesseractのみが供給 |
| `evaluate_ocr` | 要設計（混合） | GT読込・統計集計（共通化可能）と、認識器実行・前処理サイズのTesseract CRNN前提値（`ocr_evaluation.py:391,404,406`のハードコード）・base/trained2値比較構造（Tesseract固有寄り）が混在 |

（詳細は本ドキュメント末尾の調査結果、および`docs/workitems/trocr/MULTI_ENGINE_EVALUATION_API_61.md`を参照）

### 5.2 比較観点と4案

| 観点 | 案A（Engineごとに評価全体を実装） | 案B（共通Evaluation Loop + Engine別Predictor） | 案C（既存`predict_from_image()`へ全面委譲） | 案D（Benchmark Engine Builderを再利用） |
|---|---|---|---|---|
| 既存コード再利用 | 低（共通集計ロジックをコピーor継承で複製） | 高（`_normalize_compare`/`levenshtein_ops`/集計ロジックをそのまま抽出） | 中（推論部分は再利用できるが評価ループ自体は新規） | 高（`recognize()`契約は実証済み） |
| 回帰リスク | 高（Tesseractの既存挙動をコピーし直す必要） | 低（既存`evaluate_ocr`の内部構造を素直に分割するのみ） | 高（`predict_from_image()`はTrOCRを毎回reloadする等、評価ループ向けに設計されていない） | 中（Variant Key軸との混同リスク） |
| Model再利用 | Evaluatorごとに個別実装が必要 | Predictorが1回build・複数回recognizeを担う契約で自然に表現できる | 不可（`_predict_with_trocr`は呼び出しごとにreload、`trocr_engine.py:969,972`） | 可能（Benchmarkの`ENGINE_BUILDERS`は既にbuild-once契約） |
| Engine固有設定 | Evaluator内に埋め込み、拡張のたびに全体へ影響 | Predictor構築（build）関数に閉じ込められ、共通Loopに影響しない | Inference画面向けの設定形状に引きずられる | Variant Key（モデル取得元）向けの設定形状であり、Evaluationのengine_id軸とは別物 |
| テスト容易性 | 低（共通ロジックの重複テストが必要） | 高（共通Loopをモック Predictorで1回テスト、各Predictorは推論部分のみテスト） | 低（Inference画面の関心事と混在） | 中（Benchmark向けテストとの責務混同リスク） |
| Benchmarkとの責務混同 | なし | なし（契約の形だけ参考にし、軸は別） | なし | あり（Variant Key軸をEvaluationのengine_id軸へ持ち込むリスク） |
| 将来Engine追加 | Evaluator全体を新規実装 | Predictor 1つ追加のみ | Inference側の対応が前提 | Benchmark側の追加が前提（Evaluationには直接反映されない） |
| TrOCR loadコスト | 個別対応が必要 | Predictor構築時に1回load、以降`predict_file()`を使い回す設計と自然に一致 | 不利（毎回reload） | Benchmark側は既にbuild-once対応済みだが、Evaluationへの直接転用は軸違いのため不可 |
| confidence差異 | Evaluatorごとにばらつく恐れ | Predictorの戻り値契約（`confidence: float\|None`）で統一、捏造禁止を型で表現 | 同様に表現可能だが評価用途に最適化されていない | 同様の契約だがBenchmark側の変更が必要になる |
| Dataset処理共通化 | 個別実装 | 完全共通化（Runner側に1箇所） | 個別実装（Inference画面はDataset概念を持たない） | 個別実装（Benchmarkは別データソース） |

### 5.3 推奨案

**案B（共通Evaluation Loop + Engine別Predictor）を採用する。**

理由: (1) `evaluate_ocr()`の内部構造は既に「認識器（recognizer）のクロージャをループで呼び、統計を集計する」という案Bと同型の形をしている（現状はTesseractのみが唯一の分岐のため見えにくいが、素直な分割で実現できる）。(2) 共通ロジック（正規化・Levenshtein・CER・confusion・char_stats）は5章5.1の分析で既に「共通化可能」と判定済みであり、書き直しが不要。(3) `TrOCREngine.load()`は「1回load・複数回predict」を前提に設計されており（`trocr_engine.py:95-97`）、案Bの「build-once Predictor」契約と自然に一致する。(4) Benchmarkの`ENGINE_BUILDERS`パターン（案D）は契約の形として参考にするが、Variant Key軸をそのまま持ち込むと14章で確定するEngine軸の区別（Evaluation=canonical engine_id、Benchmark=Variant Key）を破壊するため、**契約の形は踏襲し、実装は別モジュールとして持つ**。(5) 案C（`predict_from_image()`への全面委譲）はTrOCRの毎回reload等、評価ループのパフォーマンス・責務に適さないため不採用。

---

## 6. 現行Metric調査

実コード（`ocr_evaluation.py`）とテスト（`tests/test_cer_metrics.py`）から確認した実装事実。

| Metric | 状態 | 定義（実装どおり） |
|---|---:|---|
| CER | 実装済み | `Σ edit_distance / Σ len(ground_truth_chars)`（**マイクロ平均**。画像ごとのCER平均ではない。`ocr_evaluation.py:476-479`、`tests/test_cer_metrics.py:93-104`で確認） |
| Character Accuracy | 実装済み | `1 - CER`（`ocr_evaluation.py:494-495`、テスト確認済み） |
| Exact Match Rate | 実装済み | `correct / total`（空文字同士は不一致扱い。`ocr_evaluation.py:429,473-475`） |
| Sample/Correct/Error Count | 実装済み | `total`/`correct`/`mismatch_count`として保持 |
| Confusion Matrix | 実装済み | Levenshteinアライメントから`sub`/`del`/`ins`を集計、上位10件（`confusions`）と全件（`confusions_full`、Release Gate用） |
| Substitution/Insertion/Deletion | 実装済み | 画像単位で`sub_count`/`del_count`/`ins_count` |
| Processing Time / Average Latency | **未実装** | `ocr_evaluation.py`にタイミング計測コードは一切存在しない（grep確認済み） |
| Confidence | 実装済み（passthrough） | 認識器の戻り値をそのまま`None`許容で伝播。**ターゲット単位の集計（平均等）は未実装** |
| WER | **未実装** | grep確認済み |
| Precision | **未実装** | grep確認済み |
| Recall | **未実装** | grep確認済み |
| F1 | **未実装** | grep確認済み |

**0除算・空文字・空Dataset**:
- `ref_total == 0` → `cer = None`（`ocr_evaluation.py:479`。ガードは`if...else`であり`try/except ZeroDivisionError`ではない）
- `total == 0`（ターゲット単位） → `accuracy = 0.0`（フォールバック。ただし現状の呼び出し経路では到達しない防御的コード）
- GT CSVが空 → `ValueError`（`_read_gt_csv:161`）
- 評価対象画像が0件 → `ValueError`（`evaluate_ocr:466-469`）
- **未テストの分岐あり**: `ref_total==0`（正解文字列が全て空）を実際にテストで確認したケースは見つからなかった。実装Issueでのテスト追加候補とする（19章参照）

比較（正規化）の既存仕様（変更しないこと）: **大文字小文字を区別する**（`_normalize_compare`はNFC正規化＋trimのみで大小文字変換なし。cursive `k/l/t`と大文字を区別する必要があるため意図的）／全角半角は正規化しない／Unicode正規化はNFCのみ／whitelistは比較時ではなく推論（Tesseract内部）時に適用される。

---

## 7. 採用Architecture

```text
EvaluationService（既存 evaluate_ocr の一般化。既存APIから見た薄いオーケストレーター）
        ↓
EvaluationDispatcher（canonical engine_id → PredictorBuilder の登録表）
        ↓
EnginePredictor（Engine別。1回build、複数回recognize）
        ├── TesseractPredictor（既存 _build_tesseract_recognizer を薄くラップ）
        ├── PaddleOCRPredictor（既存 predict.py / benchmark.py の推論経路を再利用）
        ├── EasyOCRPredictor（既存 predict.py の推論経路を再利用）
        └── TrOCRPredictor（TrOCREngine.load() を1回のみ呼び出し）
        ↓
EvaluationRunner（既存 evaluate_ocr の共通集計ロジックをそのまま踏襲: 正規化・Levenshtein・CER・confusion・char_stats・base/trained比較）
        ↓
EvaluationResult（共通Schema、10章）
```

既存`services`構成に合わせ、`EvaluationDispatcher`/`EnginePredictor`はBenchmarkの`ENGINE_BUILDERS`と対をなす新規モジュール（例: `services/ocr_evaluation.py`内、または`services/evaluation/`配下）として実装する想定とし、Registry本体（`engine_registry.py`）へEvaluator/Predictorのインスタンスは持たせない（9章）。

---

## 8. Dispatcher

### 8.1 責務

- canonical engine_id（`tesseract`/`paddleocr`/`easyocr`/`trocr`）ごとに登録された`PredictorBuilder`を呼び出し、`EnginePredictor`を構築する
- 未登録engine_id、またはCapability上評価未対応（`EngineCapability.supports_evaluation=False`）の場合は`UnsupportedEvaluationEngineError`（17章）を送出する
- Benchmarkの`ENGINE_BUILDERS`（`benchmark.py:319-324`）と同型の「登録表（dict）」を持つが、**キーはVariant Keyではなくcanonical engine_id**とする（14章の軸の区別を維持するため）

### 8.2 案（擬似コード）

```python
PredictorBuilder = Callable[[str, "OcrEvalTarget"], "EnginePredictor"]

class EvaluationDispatcher:
    def __init__(self) -> None:
        self._builders: dict[str, PredictorBuilder] = {}

    def register(self, engine_id: str, builder: PredictorBuilder) -> None: ...

    def build(self, project_id: str, target: "OcrEvalTarget") -> "EnginePredictor":
        engine_id = resolve_engine_id(target.engine)  # 既存 engine_registry.resolve_engine_id() を再利用
        if engine_id is None or engine_id not in self._builders:
            raise UnsupportedEvaluationEngineError(target.engine)
        capability = get_builtin_capability(engine_id)
        if not capability.supports_evaluation:
            raise UnsupportedEvaluationEngineError(target.engine)
        return self._builders[engine_id](project_id, target)
```

---

## 9. Evaluator Interface

### 9.1 採用インターフェース（Predictor + Runner分離案）

```python
@dataclass(frozen=True)
class RecognitionResult:
    text: str
    confidence: float | None  # 捏造禁止。取得不能ならNone（0.0で代用しない）

class EnginePredictor(Protocol):
    engine_id: str
    def recognize(self, image_path: str) -> RecognitionResult: ...

class EvaluationRunner:
    def run(
        self,
        gt_rows: list[tuple[str, str]],       # (image_name, expected_text)
        predictors: dict[str, EnginePredictor], # label -> predictor
        ...
    ) -> "EvaluationResult":
        ...  # 既存 evaluate_ocr の集計ロジックをそのまま踏襲
```

`docs/design/ENGINE_REGISTRY.md:108-117`は既に将来構想として`EvaluationHandler` Protocol（`def evaluate(self, project_id, model, dataset) -> EvaluationResult`）を定義済みだが、「本Issueでは設計のみ、既存`ocr_evaluation.py`の書き換えは行わない」と明記されている。本ドキュメントの`EnginePredictor`/`EvaluationRunner`分離は、この既存構想と矛盾しない——`EvaluationHandler`を「1エンジン分の評価を丸ごと担う高レベルAPI」、`EnginePredictor`を「その内部でRunnerから呼ばれる低レベル推論関数」として位置づけることで、将来`EvaluationHandler`を実装する際に内部で`EvaluationRunner`+`EnginePredictor`を利用する形に自然に発展できる。

### 9.2 比較案（再掲）

単画像推論とMetrics計算を分離する案（`EvaluationPredictor.load/predict` + `EvaluationRunner.run`）を採用。Engineごとに評価全体を実装する案（`class Evaluator: def evaluate(request) -> result`のみを持つ形）は、5章の比較のとおり不採用。

---

## 10. Request Schema設計

### 10.1 共通項目（現状維持）

`project_id`/`image_dir`/`gt_csv`/`targets`/`eval_preprocess`/`preprocess_source`/`preprocess_mode` は全Engineで意味が同じであり変更しない。

### 10.2 Engine固有項目とoptions設計

比較した4案:

1. **`options: dict`**: 柔軟だが型安全性・OpenAPIドキュメントの明確さを失い、キー名の誤字が静かに無視されるリスクがある
2. **Engine別Nested Schema**（`tesseract_options`/`trocr_options`をRequest直下に追加）: OpenAPI上は明確だが、「ターゲットごとに異なるオプション」という実態（例: 複数のTesseractターゲットでPSMを変えたい場合）を表現しにくい
3. **Discriminated Union**（ターゲットごとに専用のoptions sub-object）: 最も実態に忠実（`benchmark.py`の`ENGINE_CATALOG`が既に`profile_keys`をカタログエントリ単位で持たせている前例と整合）だが、`schemas.py`の既存フラットスタイルからの乖離が大きい
4. **現行API維持 + 新API追加**: スキーマ変更を避けられるが、2つのAPIを長期的に並行メンテする負担が生じる。`targets`が既に多エンジン前提の構造を持つため、新規エンドポイントを追加する必然性は薄い

**推奨: 案3を軽量化した折衷案（`OcrEvalTarget`へオプションフィールドを追加）**。`charset`/`psm`を`OcrEvalTarget`へ**追加のOptionalフィールド**として持たせ、未指定時は現行のRequestレベル既定値（後方互換）を使う。TrOCR等の他エンジン固有オプション（例: `local_files_only`/`device`）も同様に`OcrEvalTarget`への追加Optionalフィールドとして持たせ、当該エンジン以外のPredictorはそれらを単純に無視する（Protocol構造的型付けというプロジェクトの既存スタイル、`docs/design/ENGINE_REGISTRY.md`のProtocol指向と整合）。これにより、Pydantic Discriminated Unionのような重い仕組みを導入せずに、ターゲット単位のエンジン固有オプションを表現できる。

### 10.3 実在しない項目の扱い

`dataset_id`のような、現状の`evaluate_ocr()`に存在しない概念は捏造しない（`image_dir`/`gt_csv`という現行の直接パス指定を維持する）。

---

## 11. Result Schema設計

### 11.1 共通Result

```text
evaluation_id       # 新規。現状は履歴IDが一切存在しない（6章で確認）。永続化方式は別途Job/History連携で決定（20章）
engine_id           # 既存 targets[].engine を踏襲
model_ref           # 既存 targets[].model を踏襲
started_at / finished_at / duration_ms  # 新規。現状タイミング計測は一切ない（6章）
sample_count        # 既存 total 相当
metrics             # 既存 accuracy/cer/char_accuracy 等
samples             # 既存 rows/mismatches 相当
confusions          # 既存 confusions/confusions_full を踏襲
warnings            # 既存 preprocess_warnings を踏襲
engine_details       # Engine固有情報（後述）
```

`dataset_id`は、現行APIが`image_dir`/`gt_csv`という直接パスのみを受け取り、Dataset登録機構との連携が現状無い（未確認・未検証）ため、本Phaseでは追加しない（20章Future Work）。

### 11.2 共通Sample Result

```text
image, ground_truth, prediction, exact_match, edit_distance, cer,
confidence, error, duration_ms
```

`error`は**新規追加**。現行実装は画像1件の認識で例外が起きた場合の挙動がRunnerレベルで捕捉されておらず（Tesseractの場合はCLI呼び出しが同期的で、失敗は主に認識器構築時のRuntimeErrorとして表面化するため、画像単位の部分失敗という状況が実質的に起きない）、新Dispatcher構成でPaddleOCR/EasyOCR/TrOCRを追加する際に「1画像の推論失敗で評価全体を中断させない」ため、Runnerが画像単位で例外を捕捉し`error`フィールドへ記録する設計とする。Tesseractのみを使う既存の呼び出しでは、この分岐が実質的に発生しないためNo-opであり後方互換を壊さない。

### 11.3 confidence方針

- `null`を許可する
- **捏造禁止**（推測値を返さない）
- `0.0`での代用禁止
- UIでは`--`等の表示（Frontend側の対応。本ドキュメントはBackendのみ対象）
- 既存の`ocr_evaluation.py:451-452`のコメント・`TrOCREngine`の設計方針（`trocr_engine.py:18-20`）と完全に一致する、既存の確立された原則をそのまま踏襲するのみで新規の方針ではない

### 11.4 bbox

共通Schemaに含めない（必須化しない）。TrOCRは検出を行わない認識専用モデルのためbboxを返さない設計であり（`trocr_engine.py`）、この制約を歪めない。

### 11.5 Engine固有情報

`engine_details: dict`として保持する。現状Tesseractのみが持つ`training_preprocess_hash`/`preprocess_match`は、他Engineに等価概念が無いため共通Schemaへ昇格させず`engine_details`内に留める。`is_base`（ベースモデルか学習後モデルか）は概念上Engine非依存のため共通Schemaに残す。

---

## 12. Metrics責務

```text
Engine Predictor
    ↓
RecognitionResult(text, confidence)
    ↓
共通Metrics Calculator（_normalize_compare + levenshtein_ops + 集計）
    ↓
EvaluationResult
```

既存評価仕様を変更しない。以下は6章の調査結果に基づく、維持すべき互換処理:

- CER・confusion集計は共通Calculatorへ移せる（既に汎用実装であることを確認済み）
- 比較は**大文字小文字を区別**（既存仕様、cursive文字の区別に必要）
- **全角半角は正規化しない**（既存テストが明示的に確認）
- Unicode正規化は**NFCのみ**
- whitelistは推論（Tesseract内部）時に適用、比較タイミングには影響しない。他Engineには等価概念が無いため、Predictor側の任意オプションとして扱い、Runner側の比較ロジックは変更しない
- 空文字・空Datasetの挙動（2章2.6・6章）は変更しない

---

## 13. Model Resolution

### 13.1 現状

- Tesseract: `_build_tesseract_recognizer`が`resolve_tesseract_model_meta`を呼ぶ。`benchmark.py`はこの関数をそのまま再利用（重複なし）。ただし`predict.py::_predict_with_tesseract`は独自の別実装
- PaddleOCR: `benchmark.py`と`predict.py`がそれぞれ独立して`resolve_ocr_model_meta(engine="paddleocr")`を呼ぶ（重複実装、フォールバックロジックが微妙に異なる）
- TrOCR: 解決層が存在せず、`model_ref`（HF Hub ID／ローカルパス）を呼び出し側がそのまま渡す
- 「Inference Resolver」という統一概念はコードベースに存在しない（grep確認済み）
- `ModelsAPI`/`ModelCatalog`はメタデータレコード（`model_id`/`engine_id`/`artifact_path`等）の読み書きのみを提供し、「ロード可能な参照」への解決は行わない。かつHTTPエンドポイントへの配線は無い（ADR-0002確認済み）

### 13.2 判断: Inference Resolverの完成を前提とするか

**前提としない。** 各EngineのPredictorBuilderは、既存のEngine別解決ヘルパー（`resolve_tesseract_model_meta`/`resolve_ocr_model_meta`/TrOCRの素通し）をそのまま利用して自己解決する。これはBenchmarkが既に採用している方式と同じであり、Models API配線待ち（ADR-0002 Phase 3、現状停止中）に本Dispatcherを依存させない。統一的な「Inference Resolver」の新設・3実装の重複解消は、価値はあるが本Issueの必須事項ではなく、Future Work（20章）とする。

---

## 14. 同期／非同期実行

現行は同期API（2.6節）。ただし`POST /api/jobs`に`job_type="evaluation"`を渡す非同期経路が既にテストで存在を確認できた（`tests/test_e2e_uat.py:159-162`）。この経路の内部実装詳細（`job_runner.py`側の処理、進捗・キャンセル対応の有無）は本Issueでは未調査であり、**実装Issue（Phase 2以降）で確認が必要な未決事項**とする。

比較観点（一般論としての整理。詳細実装は未調査のため確定的な結論を避ける）:

- 後方互換: 同期APIの維持は必須（既存Frontend呼び出しを壊さない）
- UI変更量: 同期のまま維持すれば`OcrEvaluationView.jsx`側の変更は最小
- タイムアウト/キャンセル/進捗表示: PaddleOCR/TrOCRのモデルロードコストが加わると同期呼び出しが長時間化するリスクがあり、既存Job Infrastructureとの統合が望ましい
- GPU占有: TrOCRのモデルロードコストを考えると、複数評価の同時実行はGPUメモリ競合のリスクがある

**推奨方針（本Phase）**: 同期`POST /api/ocr/evaluate`はそのまま維持しつつ内部をDispatcher/Runnerへ一般化する（後方互換優先）。既存の`job_type="evaluation"`経路の実装を先に確認したうえで、大規模Dataset・低速Engine（TrOCR等）を扱う場合の非同期化はその経路の拡張で対応する方針としたい。**この判断の確定には`job_runner.py`の実装調査が別途必要**であり、本Issueでは「同期APIをこのPhaseで置き換えない」という後方互換上の結論のみを確定する。

---

## 15. Benchmarkとの責務境界

現状の実装事実に基づく（変更しない）:

| | Evaluation API | Benchmark Runner | Benchmark Center |
|---|---|---|---|
| 対象 | 1モデル×1Dataset | 複数Variant×同一Dataset | 保存済み結果 |
| Engineの軸 | canonical engine_id（`targets[].engine`） | Backend `ENGINE_CATALOG`のVariant Key | canonical engine_id |
| 詳細度 | サンプル単位の詳細・confusion・エラー分析・学習前後比較 | 横断比較・Leaderboard・A/B比較 | 横断検索・比較設定の保存 |
| 実行 | あり | あり | なし（閲覧専用） |

**画面・APIを無理に統合しない**（Epic #46 Design #59・`BENCHMARK_ENGINE_REGISTRY_DESIGN.md`で既に確定済みの方針を踏襲）。

共通Metric Calculatorの共有可能性: `ocr_evaluation.py`のCER/confusion集計ロジックが共通化可能であることは6章で確認したが、`benchmark.py`側が独自のメトリクス計算を持つか、共有可能なロジックを重複実装しているかは本Issueでは未調査（`benchmark.py`の`ENGINE_BUILDERS`/`ENGINE_CATALOG`周辺のみ調査対象とした）。**Future Workとして、両者のMetric Calculatorの統合可能性を別途調査する**（20章）。

---

## 16. Backward Compatibility

比較した3案:

1. **既存`POST /api/ocr/evaluate`を拡張**: `targets`が既に多エンジン前提の構造を持つため、追加コストが低い
2. **新規`POST /api/evaluations`**: 新設の必然性が薄く、2エンドポイントの並行メンテ負担が生じる
3. **内部Serviceのみ一般化し、既存APIはAdapterとして維持**: 内部実装の一般化は必須

**推奨: 案1と案3の組み合わせを採用する（案2は不採用）。** 内部を`EvaluationDispatcher`/`EvaluationRunner`へ一般化しつつ、既存エンドポイントのURLは変更せず、Request/Response Schemaを後方互換な形で拡張する。既存クライアント（デフォルトの2ターゲットTesseract呼び出し）は、追加フィールドがすべてOptionalであるため、変更前と同一の挙動・同一のResponse構造を得られる。

---

## 17. Error Handling（設計）

過剰な例外分割を避け、最小限の新規例外のみ追加する。

- `UnsupportedEvaluationEngineError(ValueError)`: 未登録engine_id、またはCapability上評価未対応の場合（既存の`build_recognizer`の`ValueError("unsupported engine for evaluation: ...")`を型付けし、既存の400マッピングをそのまま維持）
- `EvaluationModelLoadError(RuntimeError)`: モデル解決・ロード失敗（Tesseract CLI起動失敗・TrOCRモデルロード失敗等を統一。既存の400マッピング（`RuntimeError`→400、`main.py:4776-4777`）をそのまま維持）
- 既存の`FileNotFoundError`（→404）・`ValueError`（→400）はそのまま入力検証（Dataset/GT CSV欠落・空CSV・不正preprocess_mode等）に使い続ける
- `EvaluationInputError`/`EvaluationInferenceError`/`EvaluationMetricError`/`EvaluationPersistenceError`のような細分化は行わない（過剰な例外分割）。現行コードの失敗モードは「入力検証」「Engine未対応」「モデルロード」の3種に集約でき、それぞれ既存の`ValueError`/`UnsupportedEvaluationEngineError`/`EvaluationModelLoadError`で表現できる
- 画像単位の推論エラーはRunnerが捕捉し、サンプルの`error`フィールドへ記録する（11.2節。評価全体を中断させない設計変更だが、既存Tesseractのみの呼び出しでは実質No-op）
- HTTP変換方針は現行と同一（`main.py`の404/400/400トリアージ＋グローバルcatch-all 500）を維持し、新規のHTTP例外ハンドラは追加しない（新例外は既存例外のサブクラスのため自動的に同じマッピングに乗る）

---

## 18. Test Strategy

実装Issueごとに以下を最低限用意する。CIでは実モデル・ネットワーク・大規模Datasetを使用しない方針を維持する（既存`tests/test_tesseract_e2e.py`の`skipif`パターンを踏襲）。

### Dispatcher
- known engine（登録済みかつCapability対応）
- unknown engine（未登録engine_id）
- unsupported engine（登録済みだがCapability非対応）
- Handler未登録

### Tesseract互換（既存`tests/test_cer_metrics.py`をリグレッションベースラインとする）
- 現行結果との一致（CER micro-average・confusion集計・比較オブジェクトの各フィールドが既存値と一致することを確認）
- PSM・whitelistの既存挙動維持
- before/after（base/trained）比較
- confusion・error sample

### TrOCR
- Engine mock（実モデル・ネットワーク不使用）
- Model loadが評価run中に1回のみ発生すること（`TrOCREngine.load()`呼び出し回数のアサーション）
- 複数画像でインスタンスを再利用できること
- confidence/bboxが常に`None`/フィールド無しであること（捏造されていないことの確認）
- `model_ref`（HF ID/ローカルパス）の伝播
- 依存関係エラー（`TrOCRDependencyError`相当）・推論エラーのハンドリング
- ネットワーク不使用（`local_files_only`相当の挙動）

### Schema
- Request validation（Optionalフィールドの既定値、既存デフォルト値との一致）
- Result round trip
- confidence optional
- `engine_details`の型
- 未知フィールドの扱い

### API
- 既存デフォルト呼び出し（Tesseractのみ2ターゲット）が変更前と同一のResponse構造を返すこと（後方互換の直接検証）
- HTTP status（404/400/500）
- Engine固有options
- 不正パス・モデル未検出・空Dataset

---

## 19. Migration Plan

実コードの実態（`targets`が既に多エンジン前提の構造を持つこと、PaddleOCR/EasyOCRは推論経路が既存で低リスク、TrOCRはconfidence/bboxを持たない設計が既に確立していること）に合わせ、task設計時点の想定から順序・内容を補正した。

```text
Phase 1: 共通Schema・Dispatcher設計（本Issue #61。ドキュメントのみ）

Phase 2: TesseractEvaluatorをAdapter化
  既存 _build_tesseract_recognizer / evaluate_ocr から EnginePredictor/EvaluationRunner へ分割。
  動作無変更、既存テスト（tests/test_cer_metrics.py 等）が無修正のまま全件成功することを受け入れ条件とする。

Phase 3: Request/Result Schema拡張
  OcrEvalTargetへターゲット単位のEngine固有オプション（psm/charsetの移設含む）を追加。
  Result Schemaへ evaluation_id/timing/error 等の新規フィールドを追加。
  既存トップレベルcharset/psmは「ターゲット未指定時の既定値」として後方互換維持。

Phase 4: PaddleOCREvaluator・EasyOCREvaluator追加
  既存 predict.py / benchmark.py の推論経路を再利用。confidenceをそのまま伝播。
  低リスク（推論経路は実証済み、公式/カスタムモデル解決も既存ヘルパーを再利用するのみ）。

Phase 5: TrOCREvaluator追加
  TrOCREngine.load()を評価run開始時に1回のみ呼び出すPredictorを新設。
  confidence/bboxは常にNone/フィールド無し。Epic #27のBackend Evaluation対応として位置づける。

Phase 6: 既存API拡張（新規エンドポイント追加はしない）
  POST /api/ocr/evaluateがマルチEngineのtargetsを受け付けるようDispatcherへ接続。
  同期実行のまま維持（14章の非同期化判断は別途 job_runner.py 調査後）。

Phase 7: OcrEvaluationView.jsxとの接続（Epic #46）
  Engine選択UI追加・per-engine options条件表示。Design #59で確定済みの依存関係のとおり、
  本Phase完了後にEpic #46側で着手する。

Phase 8: Cleanup
  Benchmark ENGINE_BUILDERSとの重複解消の要否を検討。
  旧Tesseract専用ハードコード経路の整理。
```

Epic #46との接続タイミング: Phase 7（PaddleOCR/EasyOCR/TrOCR Evaluatorが揃い、Backend APIが安定した後）。Backend Evaluation APIが先、UI一般化が後、という既存の依存関係（Design #59・Epic #46/#27の責務境界）をそのまま踏襲する。

---

## 20. Security・運用（設計メモ）

- **任意ローカルパス／Path traversal**: `image_dir`/`gt_csv`は現状も任意サーバーパスを受け付ける（既存の挙動）。新規パスバリデーションを追加するかは本Issueでは確認できておらず、実装Issueで既存の path 検証有無を確認する
- **Hugging Face remote model download**: `TrOCREngine`は`model_ref`をそのまま`from_pretrained()`へ渡す。評価用途では`local_files_only=True`を既定とし、明示的な設定が無い限りネットワーク経由のモデル取得を行わない方針を推奨する。`trust_remote_code`は有効化しない
- **Hub認証**: 未調査。プライベートモデル参照が将来必要になった場合に別途検討する
- **大容量モデル／GPUメモリ／同時実行**: TrOCRモデルロードのコストを踏まえ、同一GPUでの評価runの同時実行は避ける方針を推奨する（詳細な排他制御方式は実装Issueで検討）
- **Model cache**: TrOCRは評価run開始時に1回のみロードし、run終了までインスタンスを保持する（9章のPredictor契約どおり）。既存`predict.py::_predict_with_trocr`の「毎回reload」パターンはEvaluationへ持ち込まない
- **Dataset/output path**: 現状「output path」という概念自体が存在しない（Responseに含まれない）。将来的な結果永続化（20章Future Work）を追加する際に改めてパス安全性を検討する
- **ログへの絶対パス出力**: 現行Responseは`image_dir`/`gt_csv`の解決済み絶対パスをそのままエコーバックしている（既存の挙動）。これを変更すると後方互換を壊すため本Phaseでは維持するが、新規フィールドで同様のパターンを広げないことを推奨する
- **エラーメッセージへの内部情報露出**: 既存のグローバルcatch-allハンドラ（`main.py:291-299`）が内部詳細を応答へ含めない設計を既に持っており、新規例外もこの既存経路にそのまま乗せる（17章）
- **信頼できないModel**: モデルの真正性検証は現状どのEngineにも存在せず、本設計でも新規に導入しない（ローカル完結ツールという性質上、過剰な対策は行わない）
- **offline環境**: `TrOCREngine`は`local_files_only`を既にサポートしており、評価用途でもこれを活用する

---

## 21. 未決事項（要設計・要調査のまま残すもの）

- `POST /api/jobs`の`job_type="evaluation"`経路の内部実装詳細（14章）
- `benchmark.py`側のMetric計算ロジックがEvaluationと共有可能か（15章）
- Path traversal等、既存の`image_dir`/`gt_csv`検証の有無（20章）
- Hub認証・プライベートモデル対応の要否（20章）
- 評価結果の永続化方式（`evaluation_id`をどう払い出し、どこに保存するか）

これらは実装Issue側で個別に調査・確定する。

---

## 22. Future Work

- 共通Metric Calculatorの`benchmark.py`との統合可能性調査
- Tesseract/PaddleOCR/TrOCRのモデル解決3実装の統合（統一Inference Resolverの新設）——ただし本Issueの前提ではない（13章）
- WER/Precision/Recall/F1の要否再検討（現状要望なし、未実装のまま据え置き）
- Confidence集計（ターゲット単位の平均等）の要否検討
- `custom`（分類モデル）を評価対象に含めるかどうかの再検討（現状スコープ外、4章）
- Backend `EngineRegistry`/`EngineCapability`とフロントエンド`engineRegistry.js`の統合要否（ADR-0002で「現時点では統合しない」と確認済み、本ドキュメントもこれを変更しない）
- `EngineCapability.supports_evaluation`等のフラグを、各Evaluator実装Issューの完了に合わせて更新していく運用（Phase 4/5の一部として）
