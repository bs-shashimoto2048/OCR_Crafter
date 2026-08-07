# ADR-0003: Multi-engine Evaluation Architecture

- **Status**: Accepted
- **Date**: 2026-08-03（Proposed）/ 2026-08-03（Accepted）
- **Related Issue**: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)（Multi-engine Evaluation API Architecture、**Completed**・Closed） / Parent Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27) / Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46) / Design [#59](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/59)
- **Related PR**: [#62](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/62)（Squash Merge済み。Squash Commit: `34aea57`） / [#64](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/64)（Common Evaluation Schema実装、Squash Merge済み。Squash Commit: `4663dd0`） / [#66](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/66)（Common Evaluation Metric Calculator実装、Squash Merge済み。Squash Commit: `b2de141`） / [#68](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/68)（Evaluation Dispatcher実装、Squash Merge済み。Squash Commit: `83e4eec`） / [#70](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/70)（Evaluation Runner実装、Squash Merge済み。Squash Commit: `c5bd7eb`） / [#72](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/72)（Tesseract Evaluation Predictor Adapter実装、Squash Merge済み。Squash Commit: `f8c7883`） / [#74](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/74)（PaddleOCR Evaluation Predictor実装、Open・レビュー待ち）

> 本ADRはDesign Issue #61の成果物であり、調査結果の詳細は[docs/design/MULTI_ENGINE_EVALUATION_API.md](../design/MULTI_ENGINE_EVALUATION_API.md)を前提とする。PR #62のレビュー承認・mainへのSquash Mergeを受けて、本ADRのStatusを**Proposed→Accepted**へ変更した。以降、本ADRの決定は正式な設計判断として扱う。
>
> **Implementation Status（2026-08-03）**:
>
> ```text
> Architecture: Completed
> Evaluation Schema: Completed
> Common Metric Calculator: Completed
> Evaluation Dispatcher: Completed (Issue #67 / PR #68)
> Evaluation Runner: Completed (Issue #69 / PR #70)
> Tesseract Predictor Adapter: Completed (Issue #71 / PR #72)
> PaddleOCR Predictor: Implemented, PR review pending (Issue #73)
> EasyOCR Predictor: Not Started
> TrOCR Predictor: Not Started
> Multi-engine API Integration: Not Started
> Evaluation UI Integration: Blocked by Backend implementation
> Cleanup: Not Started
> ```
>
> Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)「Common Evaluation Schema実装」は**Completed**・Closed（PR [#64](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/64)をSquash Merge・mainへ反映済み、Merge Commit: `4663dd0`）。`OcrEvalTarget.options`（ターゲット単位のEngine固有オプション）、`OcrEvaluationMetrics`/`OcrEvaluationSampleResult`/`OcrEvaluationConfusion`/`OcrEvaluationResult`（内部共通Result Schema）を実装済み。既存`POST /api/ocr/evaluate`のresponse_model・返却dictは無変更（未配線）。次の実装対象はCommon Metric Calculator。詳細は[docs/workitems/trocr/COMMON_EVALUATION_SCHEMA_63.md](../workitems/trocr/COMMON_EVALUATION_SCHEMA_63.md)参照。
>
> **PR #64レビュー指摘対応（数値Validation強化）**: 共通Result Schemaの数値項目（count系: `sample_count`/`exact_match_count`/`edit_distance`/`confusion.count`、float系: `exact_match_rate`/`cer`/`character_accuracy`/`confidence`/`duration_ms`）へ、(1) NaN/Infinity/-Infinityの明示的な拒否、(2) 数値文字列（`"5"`等）の暗黙変換の廃止（count系はstrict int、float系はint/floatのみ許可）を追加した。既存Request Schema（`OcrEvalTarget`/`OcrEvaluateRequest`の`psm`等）は対象外。`confidence=None`/`confidence=0.0`/`cer>1`/`character_accuracy<0`/`duration_ms=0`は引き続き許可する。また、クリーン環境（`outputs/app.db`退避）ではIssue #8（`test_dataset_registry.py::test_register_ocr_model_records_dataset_lineage`）が本PRと無関係な既知の失敗として残ることを確認済み（本PRでは修正しない）。
>
> Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)「Common Evaluation Metric Calculator」は**Completed**・Closed（PR [#66](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/66)をSquash Merge・mainへ反映済み、Merge Commit: `b2de141`）。`src/app/services/evaluation_metrics.py`を新設し、既存Tesseractと同一のNFC正規化・trim・Levenshtein edit operations・sample単位CER/完全一致/edit distance・マイクロ平均CER・`character_accuracy = 1 - CER`・confusion集計を実装。`OcrEvaluationResult.sample_count`と`metrics.sample_count`の重複は**`metrics.sample_count`をCanonicalとする**方針を確定。既存Tesseract評価経路（`ocr_evaluation.py`）への配線は行っていない（logger名互換問題により実装を移設せず独立実装とし、既存実装との出力一致は直接比較テストで担保。**logger名の互換問題（U+FFFD警告の出力元logger名不一致）はTesseract Predictor Adapter Issueで解決する**）。confusionの決定的sort（count降順→kind→expected→predicted）は本Calculator内でのみ導入したものであり、**既存API（`POST /api/ocr/evaluate`）の`confusions`/`confusions_full`の並び順へはまだ反映されていない**。クリーン環境ではIssue #8のみ既知の失敗として残る（本Featureとは無関係）。
>
> **Future Work（PR #66レビューMinor指摘）**: (1) 新Calculator単独でのU+FFFD loggerテスト追加候補（`caplog.at_level(..., logger="src.app.services.evaluation_metrics")`）、(2) 空GTサンプルのedit distanceがAggregate分子（`dist_total`）へ加算される既存仕様の明文化、(3) Tesseract Adapter Issue着手時のlogger移行方針の具体化、(4) `ocr_evaluation.py`との重複実装（`normalize_compare`/`levenshtein_ops`）解消、(5) confusion top-N（既存APIの`confusions`相当）適用はRunner責務として整理。詳細は[docs/workitems/trocr/COMMON_EVALUATION_METRICS_65.md](../workitems/trocr/COMMON_EVALUATION_METRICS_65.md)参照。
>
> Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)「Evaluation Dispatcher」は**Completed**・Closed（PR [#68](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/68)をSquash Merge・mainへ反映済み、Merge Commit: `83e4eec`）。`src/app/services/evaluation_dispatcher.py`を新設し、`EvaluationDispatcher`（`register`/`resolve`/`dispatch`のみ）と`EnginePredictor` Protocolを実装。Backend `EngineCapability.supports_evaluation`を初めて参照する実装であり、Dispatcherのみが参照しPredictor側は参照しない設計とした。実際の値はtesseractのみ`supports_evaluation=True`、paddleocr/easyocr/trocrはRegistry登録済みだが`supports_evaluation=False`、customはBackend Engine Registry未登録。Unknown Engineは`UnknownEvaluationEngineError`、Unsupported Engine（Capability上`supports_evaluation=False`）は`UnsupportedEvaluationEngineError`を送出する。**Evaluation DispatcherとEvaluation Runnerは別責務・別完了項目として扱う**（Dispatcherのみ実装済み、Runnerは未着手）。Backend Engine Registry・Capability以外への依存はない（Predictor実装・Runner・API・Benchmark等は未着手）。マージ前レビューはBlocker/Majorなし・Minor 2件/Suggestion 3件（Future Workへ記録、Productionコード変更なし）でApprove。詳細は[docs/workitems/trocr/EVALUATION_DISPATCHER_67.md](../workitems/trocr/EVALUATION_DISPATCHER_67.md)参照。次の実装対象はEvaluation Runner。
>
> Feature [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)「Evaluation Runner」は**Completed**・Closed（PR [#70](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/70)をSquash Merge・mainへ反映済み、Merge Commit: `c5bd7eb`）。`src/app/services/evaluation_runner.py`を新設し、`EvaluationDispatcher`（Issue #67）・`EnginePredictor`・Common Evaluation Metric Calculator（Issue #65）・Common Evaluation Schema（Issue #63）を接続する共通Evaluation Loopを実装。`dispatcher.resolve(engine_id)`をrun開始時に1回だけ呼び、以降は解決済みPredictorを全Sampleで再利用する（TrOCRのbuild-once設計を前提とし、`dispatch()`をSampleごとに呼ぶ設計は採用しなかった）。Predictor出力契約として`PredictionResult`（`text`/`confidence`/`engine_details`）を`evaluation_runner.py`側で定義したが、`EnginePredictor` Protocol自体（`evaluation_dispatcher.py`）は変更していない。Sample単位の失敗（`recognize()`の例外・`PredictionResult`契約違反・`calculate_sample_metrics()`のSchema Validation失敗を一体として扱うSample Failure Boundary）は失敗Sampleとして記録しRunを継続する一方、Unknown/Unsupported Engine・未registerといった解決失敗は「Run開始前エラー」としてそのまま上位へ伝播させ区別する。**マージ前レビューMajor #1（`recognize()`呼び出し自体しか保護されておらず、Predictorの契約違反等でRun全体が中断していた問題）を是正し、`try`/`except`の範囲を戻り値の契約検証・`calculate_sample_metrics()`呼び出しまで拡張した（`BaseException`は引き続き捕捉しない）。** エラーメッセージは例外クラス名のみを保持し、例外メッセージ本文は含めない（情報漏洩の構造的排除）。`metrics.sample_count`は入力Sample総数と一致させ（失敗Sampleも含めて`calculate_evaluation_metrics()`へ渡す既存設計をそのまま利用）、`result.sample_count`との同期を自然に満たす。Confusionは成功Sampleのみから全件（top-N制限なし）を集計する。あわせて、Issue #67のFuture Workであった`register(engine_id, predictor)`と`predictor.engine_id`の整合性検証を`EvaluationDispatcher.register()`へ追加した（案1採用。既存Dispatcherテストは無修正のまま成功）。Predictor実装・API接続・Job化は未着手。修正後の再レビューはBlocker/Majorなし・Minor 2件（Future Workへ記録、Productionコード追加修正なし）でApprove。クリーン環境ではIssue #8のみ既知の失敗として残る（本Featureとは無関係）。詳細は[docs/workitems/trocr/EVALUATION_RUNNER_69.md](../workitems/trocr/EVALUATION_RUNNER_69.md)参照。次の実装対象はTesseract Predictor Adapter。
>
> Feature [#71](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/71)「Tesseract Evaluation Predictor Adapter」は**Completed**・Closed（PR [#72](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/72)をSquash Merge・mainへ反映済み、Merge Commit: `f8c7883`）。`src/app/services/tesseract_evaluation_predictor.py`を新設し、既存Tesseract評価推論経路（`ocr_evaluation.py::build_recognizer`→`tesseract_pipeline.py::recognize_line`）を`EnginePredictor`として`EvaluationRunner`（Issue #69）から利用可能にした。新しいModel Resolver・新しいPSM/whitelist優先順位・新しい前処理ロジックは実装せず、既存`build_recognizer()`をそのまま呼び出すのみ（既存Tesseract評価結果は無変更）。build-oneで解決するのはTesseract実行ファイル・tessdata_dir/lang・学習後モデルの`training_preprocess`メタ情報のみで、実際のOCR実行（`recognize_line()`）はSample単位のまま。confidence取得不能時は既存仕様どおり`None`を保持し`0.0`で捏造しない。`engine_details`は現時点では常に`None`（Runnerが統合しないため利用先がなく、ファイルシステムPathの不用意な露出も避ける）。`build_recognizer()`起因のモデル解決失敗はPredictor construction時にそのまま伝播（Run開始前エラー相当）、`recognize_line()`起因のOCR失敗は`recognize()`から握りつぶさず伝播させ、Runnerの既存Sample Failure Boundaryが隔離する。`EnginePredictor` Protocolの戻り値`Any`は具体化しなかった（案B採用。`PredictionResult`が`evaluation_runner.py`にあるため、Dispatcher側の型注釈を具体化するとDispatcher⇄Runner循環importになる。**型の第三モジュール（例: `evaluation_types.py`）への切り出しはFuture Workとし、PaddleOCR/EasyOCR/TrOCR Predictor追加前後で再検討する**）。既存`POST /api/ocr/evaluate`・`ocr_evaluation.py`・`evaluation_dispatcher.py`・`evaluation_runner.py`は無変更。マージ前レビューはBlocker/Majorなし・Minor 3件/Suggestion 1件（Future Workへ記録、Productionコード追加修正なし）でApprove。クリーン環境ではIssue #8のみ既知の失敗として残る（本Featureとは無関係）。詳細は[docs/workitems/trocr/TESSERACT_EVALUATION_PREDICTOR_71.md](../workitems/trocr/TESSERACT_EVALUATION_PREDICTOR_71.md)参照。次の実装対象はPaddleOCR Evaluation Predictor。
>
> Feature [#73](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/73)「PaddleOCR Evaluation Predictor」にて`src/app/services/paddleocr_evaluation_predictor.py`を新設し、既存PaddleOCR推論経路（`predict.py`のreader構築・`_run_paddleocr()`。`ocr_evaluation.py::build_recognizer()`はPaddleOCR未対応のため専用の評価経路は既存になく、`benchmark.py::_build_paddleocr_runner`/`_build_paddleocr_custom_runner`が既に使う同じヘルパーを直接再利用した）を`EnginePredictor`として`EvaluationRunner`から利用可能にした（**Implemented, PR review pending**）。新しいModel Resolver・新しいconfidence集約式は実装せず、既存`_create_paddleocr_instance`/`_get_paddle_text_recognition_reader`/`_run_paddleocr`/`_is_paddle_rec_inference_dir`/`OFFICIAL_PADDLEOCR_REC_MODELS`（`predict.py`）・`resolve_ocr_model_meta`（`model_registry.py`）をそのまま呼び出すのみ。official/customの判定は既存`_predict_with_paddleocr()`と同一順序を再現したが、Benchmarkの`paddleocr_official`/`paddleocr_custom`というVariant Key軸は持ち込まず、canonical engine_id="paddleocr"の1つに統一した。既存`_run_paddleocr()`の「複数検出結果のうち最大confidence採用」ルールをそのまま踏襲し、confidenceは常にfloat（検出0件時は`0.0`。Noneを返すことはない——Tesseractの`Optional[float]`とは異なる既存の実際の契約差）。**2つ目の実Predictor追加にあたり、Issue #71のFuture Work（`Predictor → evaluation_runner.py::PredictionResult`という依存方向）を是正し、`PredictionResult`を独立した葉モジュール`evaluation_types.py`へ切り出した**（`evaluation_runner.py`は既存import互換のため再エクスポート、既存テストは無修正のまま成功）。あわせて`EnginePredictor.recognize()`の戻り値型を`Any`から`PredictionResult`へ具体化した（循環importなし。静的型注釈のみで実行時動作は変えていない）。Backend Engine Registryの`paddleocr.supports_evaluation`を`False`から`True`へ変更した（参照箇所は`EvaluationDispatcher.resolve()`のみでありAPI自動有効化は発生しないことを確認済み）。既存`POST /api/predict`・`POST /api/ocr/evaluate`・`ocr_evaluation.py`・`benchmark.py`は無変更。詳細は[docs/workitems/trocr/PADDLEOCR_EVALUATION_PREDICTOR_73.md](../workitems/trocr/PADDLEOCR_EVALUATION_PREDICTOR_73.md)参照。次の実装対象はEasyOCR Evaluation Predictor。

## Context

現行の`POST /api/ocr/evaluate`（`src/app/services/ocr_evaluation.py::evaluate_ocr`/`build_recognizer`）はTesseract専用実装であり、PaddleOCR/EasyOCR/TrOCRを評価対象にできない。これはTrOCR固有の課題ではなく、[ADR-0001](ADR-0001_Trocr_Architecture.md)で「PaddleOCRも含む既存の積み残し」と明記された、以前からの技術的負債である。

モデル解決も、Tesseract（評価・Benchmarkで共通化済み）・PaddleOCR（評価未対応、Benchmark/Inferenceで別々に実装）・TrOCR（解決層自体が無い）という3種類に分散しており、統一されていない。Backend `EngineCapability`には`supports_evaluation`等の評価Capabilityが既に定義済みだが、実際に参照する箇所が存在しない。

## Decision

**評価処理を「共通Evaluation Loop（Runner）＋ Engine別Predictor」という構成へ一般化し、既存`POST /api/ocr/evaluate`はエンドポイントを変えずにこの一般化された内部実装のAdapterとして維持する。**

要約:

- **Architecture**: `EvaluationDispatcher`（canonical engine_id→`PredictorBuilder`の登録表）→ `EnginePredictor`（1回build・複数回`recognize(image_path)->(text, confidence|None)`）→ `EvaluationRunner`（既存の正規化・Levenshtein・CER・confusion集計ロジックをそのまま踏襲する共通処理）
- **Dispatcherのキー軸**: canonical engine_id（`tesseract`/`paddleocr`/`easyocr`/`trocr`）。Benchmarkの`ENGINE_CATALOG`が使うVariant Key軸とは意図的に分離し、混同しない
- **Custom（分類モデル）は評価対象に含めない**（テキスト認識ではないためCER評価が成立せず、backend Engine Registryにも未登録）
- **confidence/bboxは捏造しない**: 取得できないEngine（TrOCR）は`null`許可、`0.0`代用禁止。UIは`--`表示（既存`TrOCREngine`の設計原則をそのまま踏襲）
- **Model Resolution**: 統一Inference Resolverの完成を前提としない。各PredictorBuilderが既存のEngine別解決ヘルパー（`resolve_tesseract_model_meta`/`resolve_ocr_model_meta`/TrOCRの素通し）をそのまま利用する。Models API（ADR-0002）配線待ちには依存させない
- **Request/Result Schema**: 既存`OcrEvalTarget`へターゲット単位のEngine固有オプション（`psm`/`charset`等）を追加する形で拡張し、Discriminated Unionのような大きな構造変更は行わない。Result側は`evaluation_id`/タイミング/`error`（画像単位）を新設するが、既存フィールドは変更しない
- **後方互換**: 新規エンドポイントは追加しない（`POST /api/ocr/evaluate`を維持・拡張）。既存デフォルト呼び出し（Tesseractのみ2ターゲット）は変更前と同一のResponse構造を返す
- **Benchmarkとの責務境界**: 統合しない。Evaluation=1モデル×1Dataset詳細分析、Benchmark Runner=複数Variant横断比較、Benchmark Center=保存済み結果閲覧、という既存の役割分担を維持する
- **Sync/Async**: 本Phaseでは同期APIを維持する。既存の`job_type="evaluation"`非同期経路の詳細は別途調査（未決事項）

詳細な設計・比較案・Migration Planは[MULTI_ENGINE_EVALUATION_API.md](../design/MULTI_ENGINE_EVALUATION_API.md)を参照。

## Alternatives Considered

1. **Engineごとに評価処理を丸ごと個別実装**（案A）
   - 却下理由: 共通の正規化・Levenshtein・CER・confusion集計ロジックが重複し、Tesseractの既存の実証済み挙動をコピーし直す必要があり回帰リスクが高い
2. **既存`predict_from_image()`へ全面委譲**（案C）
   - 却下理由: `predict_from_image()`はInference画面向けの単発推論用に設計されており、TrOCRは呼び出しごとにモデルを再ロードする実装であるため、評価ループでの繰り返し呼び出しに適さない
3. **Benchmarkの`ENGINE_BUILDERS`をそのまま再利用**（案D）
   - 却下理由: BenchmarkはVariant Key軸（モデル取得元）で構成されており、Evaluationのcanonical engine_id軸とは異なる。契約の形（`recognize(image_path)->(text,confidence)`）は参考にするが、実装をそのまま共有すると軸の混同を招く
4. **新規`POST /api/evaluations`エンドポイントの追加**
   - 却下理由: 既存`targets`が既に多エンジン前提の構造を持つため新設の必然性が薄く、2エンドポイントの並行メンテ負担が生じる
