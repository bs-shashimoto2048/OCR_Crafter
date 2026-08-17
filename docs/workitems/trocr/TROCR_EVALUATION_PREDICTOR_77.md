# [Feature] TrOCR Evaluation Predictor

Issue: [#77](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/77)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61) / Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)（Common Evaluation Schema、Completed） / Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)（Common Evaluation Metric Calculator、Completed） / Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)（Evaluation Dispatcher、Completed） / Feature [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)（Evaluation Runner、Completed） / Feature [#71](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/71)（Tesseract Evaluation Predictor Adapter、Completed） / Feature [#73](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/73)（PaddleOCR Evaluation Predictor、Completed） / Feature [#75](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/75)（EasyOCR Evaluation Predictor、Completed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: [#78](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/78)（Squash Merge済み。Squash Commit: `28c1bcf3ce53753bc14d64912502a0b238437ab0`）

**状態**: **Completed**・Closed。

**マージ前レビュー結果**: Blocker 0件・Major 0件・Minor 2件・Suggestion 1件、Conclusion: Approve推奨。Minor/SuggestionはProductionコードを変更せず、下記「Future Work」へ記録した。

## 最重要原則

本Featureの目的は「新しいTrOCR評価処理を作ること」ではない。

```text
既存TrOCR単一画像推論経路
        ↓
TrOCR Evaluation Predictor（本Issue、橋渡しのみ）
        ↓
EvaluationDispatcher / EvaluationRunner
```

既存推論の意味論は変えていない。既存`POST /api/predict`にはまだ接続しない。

## 実装前調査（既存TrOCR推論経路）

```text
predict.py::_predict_with_trocr(image_source, model_ref)
    → TrOCREngine.load(model_ref)      # Processor/Model構築（重量物、Hugging Face from_pretrained）
        → TrOCREngine.predict_file(path) / .predict(image)
            → PIL.Image.open() → RGB変換
            → processor(images=..., return_tensors="pt") → pixel_values
            → pixel_values.to(device)
            → model.generate(pixel_values)（torch.inference_mode()内）
            → processor.batch_decode(generated_ids, skip_special_tokens=True)
            → text.strip()
    → TrOCRResult(text=..., model_ref=...)  # confidence/bbox属性を持たない
```

**発見（build-once要件との関係）**: `predict.py::_predict_with_trocr()`は呼び出しのたびに
`TrOCREngine.load(model_ref)`を呼び直す（同関数docstringで明記済みの既存の意図的仕様。
単一画像推論テスト画面向けには問題にならないが、Evaluationの「1回build・複数回recognize」
という要件には適さない）。**そのため本Predictorは`_predict_with_trocr()`を呼ばない。**
代わりに、`TrOCREngine`自体が既に「`load()`で1回ロードし、同一インスタンスの
`predict()`/`predict_file()`を繰り返し呼ぶことでモデルを再利用する」設計
（`trocr_engine.py`のクラスdocstring、`tests/test_trocr_engine.py::
test_same_engine_instance_does_not_reload_on_repeated_predict`で実証済み）になっている
ため、本Predictorは`TrOCREngine.load()`をconstructor時に1回だけ呼び、以降は同一インスタンス
の`predict_file()`をSampleごとに呼ぶだけで、既存クラスのbuild-once契約をそのまま利用できる
（既存推論ロジックの複製・再実装は不要）。

## Model resolution

`model_registry.py`にTrOCR用のmodel resolution関数は存在しない（grep確認済み）。
`benchmark.py`にもTrOCR用の実行経路は存在しない（grep確認済み）。既存
`_predict_with_trocr()`は、呼び出し側が渡した`model`パラメータ（Hugging Face Hub ID・
ローカルディレクトリパス）を`model_ref`としてそのまま`TrOCREngine.load()`へ渡すのみで、
`resolve_model_path()`/`resolve_ocr_model_meta()`のような既存Resolverは一切適用しない
（他3エンジンと異なり、統一Model Resolverが存在しないという既存の事実。
[ISSUE_MAP.md](ISSUE_MAP.md)のFuture Work「TrOCRのmodel_ref解決」参照）。**本Predictorも
同じ事実をそのまま反映し、Evaluation専用の新しいResolverを新設しない。** `"latest"`等の
特殊値のフォールバック（PaddleOCRにはあるがTrOCRには存在しない）も発明しない——`model`は
呼び出し側が明示的に指定する必須引数とし、指定が無効な場合は`TrOCREngine.load()`自身が
送出する`ValueError`（None/空文字/空白のみ）をそのまま伝播させる。

## Predictor

新規: `src/app/services/trocr_evaluation_predictor.py`。

```python
class TrOCREvaluationPredictor:
    engine_id = "trocr"

    def __init__(
        self,
        project_id: Optional[str] = None,
        model: str = "",
        device: Optional[str] = None,
        local_files_only: bool = False,
    ) -> None: ...

    def recognize(self, image: str, **kwargs: Any) -> PredictionResult: ...
```

`PredictionResult`は既存の共通型（`evaluation_types.py`）をそのまま利用する。新DTOは
作らない。

## Build-once

`__init__`（build-once）で行うもの:

- `TrOCREngine.load(model, device=device, local_files_only=local_files_only)`の呼び出し
  （Processor/Model構築＝Hugging Face `from_pretrained()`・device移動・重みload）

`recognize()`（Sampleごと）で行うもの:

- `self._engine.predict_file(image)`の呼び出し（画像読込・RGB変換・generate・decodeを
  含む、実際のOCR実行はSample単位でしか行えない処理）

`tests/test_trocr_evaluation_predictor.py::test_load_exactly_once_on_construction`・
`test_multiple_recognize_does_not_reload`・`test_runner_multiple_samples_does_not_reload`
で、Processor/Model構築（heavy initializer）がconstructor時に1回のみであり、複数回の
`recognize()`呼び出しやRunner経由の複数Sample処理でも再構築されないことを実測確認した。

## image / preprocessing

Predictorは前処理を一切実行しない。`image`引数は画像パスとして`TrOCREngine.predict_file()`
へそのまま渡す（画像読込・RGB変換は既存`TrOCREngine`の責務、Tesseract/PaddleOCR/EasyOCR
Predictor Adapterと同じ「前処理はPredictor外」という契約）。

## generation / decode

`model.generate()`・`processor.batch_decode(..., skip_special_tokens=True)`・前後空白の
`strip()`はすべて既存`TrOCREngine.predict()`内で完結しており、本Predictorは一切関与しない。
既存経路に存在しないgeneration optionは追加していない。

## confidence / bbox

`TrOCRResult`は`confidence`属性を一切持たない（`trocr_engine.py`のモジュールdocstring
「TrOCR標準の`generate()`は文字単位confidenceを直接返さず、算出方法は未解決事項の
まま」・`tests/test_trocr_engine.py::test_result_has_no_confidence_attribute`で確認済み）。
本Predictorは`confidence=None`を常に返す。**softmax max値・token probability平均・
sequence scoreへの独自変換など、新しいconfidence定義を一切発明していない**（0.0/1.0での
代用も行っていない）。同様に`TrOCRResult`はbboxを持たず、`PredictionResult`にもbboxフィールドは
存在しないため、bboxに関する処理は一切行っていない。

## engine_details

他Predictor Adapterと同じ理由で、常に`None`とする。`EvaluationRunner`は現時点で
`engine_details`を`OcrEvaluationResult`へ統合しないため利用先が無く、model_ref
（Hugging Face Hub ID・ローカルパス）・device等を格納すると将来の露出リスクになるため
設定しない。

## error propagation

- **constructor時**: `transformers`パッケージ未インストール（`TrOCRDependencyError`）・
  Processor/Model構築失敗（`TrOCRModelLoadError`）・device初期化失敗・無効な`model`
  （`ValueError`）は、`TrOCREngine.load()`が送出する例外をそのまま伝播する（握りつぶさない）。
  これはPredictor構築時点＝`EvaluationDispatcher.register()`・`EvaluationRunner.run()`より
  前のエラーであり、画像単位のOCR失敗（Sample単位エラー）とは明確に区別される
- **recognize時**: 画像読込失敗（`ValueError`/`FileNotFoundError`）・前処理/generate/decode
  失敗（`TrOCRInferenceError`）はいずれも`recognize()`から握りつぶさず伝播させ、
  `EvaluationRunner`の既存Sample Failure Boundaryが隔離する（Run全体は中断しない）。
  空文字・confidence=0への変換、エラー文字列のprediction textへの混入はいずれも行っていない

## Dispatcher Capability変更

Backend Engine Registryの`trocr.supports_evaluation`を`False`から`True`へ変更した
（`src/app/services/engine_capability.py::_trocr_capability()`）。

- `supports_evaluation`を参照する箇所は`evaluation_dispatcher.py::EvaluationDispatcher.resolve()`
  のみであることを確認済み（Issue #67時点から変わらず）。他のAPI・Frontend・Benchmarkは
  この値を一切参照しないため、**Capability変更がAPI自動有効化につながることはない**
  （既存`POST /api/predict`・`POST /api/ocr/evaluate`は無変更のまま）
- 変更後、Backend既定Registryに登録済みの4エンジン（tesseract/paddleocr/easyocr/trocr）は
  いずれも`supports_evaluation=True`となった。「登録済みだがUnsupported」なEngineの実例は
  もう存在しない（`custom`はRegistry未登録のためUnknownのまま）
- 既存`tests/test_evaluation_dispatcher.py::test_capability_unsupported_with_real_default_registry`
  を`test_no_unsupported_engine_remains_in_real_default_registry`へ改名し、4エンジン全てが
  `supports_evaluation=True`であることを検証する形へ更新した
- `tests/test_paddleocr_evaluation_predictor.py`・`tests/test_easyocr_evaluation_predictor.py`の
  `test_capability_trocr_still_false`もそれぞれ更新し、trocrがresolve可能になったことを
  確認する形へ変更した

## Dispatcher登録・Runner接続

グローバルdefault Dispatcherへの自動登録は今回実装しない（API Integration Issueでcomposition
rootを決める）。テストでは`dispatcher.register("trocr", predictor)`してから
`EvaluationRunner`経由で実行できることを確認した。resolve回数=1・Predictor再利用・
recognize呼び出し回数=Sample数・success/failure/confidence/metrics/confusion/warningsの
接続をテストで確認済み（Tesseract/PaddleOCR/EasyOCR Predictor Adapterと同じ既存Runner機構を
そのまま利用）。confidenceが常にNoneのため、既存Runnerの「confidence欠損warning」
（`_build_warnings()`、無変更）が機能することも確認した。

## Existing predictor回帰

TrOCR追加によりTesseract/PaddleOCR/EasyOCR Predictorが壊れていないことを確認した。

- `tests/test_tesseract_evaluation_predictor.py`（17件）は無修正のまま全件成功
- `tests/test_paddleocr_evaluation_predictor.py`（Capability関連1件を更新した28件）
- `tests/test_easyocr_evaluation_predictor.py`（Capability関連1件を更新した25件）
- `tests/test_evaluation_dispatcher.py`（Capability関連1件を改名・更新した22件）
- `tests/test_evaluation_runner.py`（34件）・`tests/test_evaluation_metrics.py`（46件）・
  `tests/test_evaluation_schema.py`（88件）・`tests/test_cer_metrics.py`（7件）・
  `tests/test_engine_capability.py`はいずれも無修正のまま全件成功
- `tests/test_trocr_engine.py`（既存TrOCR推論コアの単体テスト）・
  `tests/test_api_trocr_inference.py`・`tests/test_predict_trocr_pipeline.py`・
  `tests/test_benchmark.py`も無修正のまま全件成功（既存TrOCR推論経路・Benchmarkは無変更）

## API未配線・Predictor未実装

`POST /api/predict`・`POST /api/ocr/evaluate`への接続、`src/app/main.py`の変更は本Issueに
含まない。実TrOCRモデルのダウンロード・Hugging Face network access・GPU/CUDAに依存しない
よう、全テストは`transformers.AutoProcessor`/`VisionEncoderDecoderModel`の`from_pretrained`
をmockしている（`transformers`パッケージ自体はCIの必須依存として導入済み。
`requirements-ci.txt`のコメント参照。paddleocr/easyocrとは異なりPaddleOCR Issue #73型の
CI環境依存は生じない）。

## Future Work（マージ前レビューMinor/Suggestion指摘）

PR #78マージ前レビューで挙がった指摘。いずれもBlocker・Majorではなく、今回のマージは妨げない（Productionコードは今回変更していない）。

### Minor 1

`tests/test_trocr_evaluation_predictor.py::test_recognize_image_read_failure_propagates`が
`pytest.raises(Exception)`という広すぎる例外型で検証しており、実際に送出される
`FileNotFoundError`（`trocr_engine.py::predict_file()`が明示的に送出する型）を具体的に
assertしていない。将来`pytest.raises(FileNotFoundError)`への厳格化候補として記録する。

### Minor 2

既存`TrOCREngine.predict_file()`を直接呼んだ結果とPredictor経由の結果を、同一fake設定下で
比較する互換性テストが未追加（PaddleOCR/EasyOCR Predictorの
`test_existing_run_easyocr_helper_untouched`等に相当するテストが無い）。`recognize()`は
`self._engine.predict_file(image)`への1行委譲のみで分岐が無いため実質的なロジックの乖離余地は
低いが、将来の回帰防止テスト候補として記録する。

### Suggestion

`test_no_network_or_model_download_dependency`と`test_load_exactly_once_on_construction`の
assertionが重複気味（ほぼ同一のfake呼び出し回数チェック）。将来の可読性向上のため、統合または
観点の明確な分離を検討する（機能上の問題なし）。

## 次のIssue

Multi-engine API Integration（4エンジン全てのPredictorが揃ったため、`POST /api/ocr/evaluate`
をDispatcher/Runnerへ接続する想定）。

## Scope外（本Issueでは行わない）

- Tesseract/PaddleOCR/EasyOCR Predictor再変更
- Multi-engine API Integration
- `POST /api/predict`・`POST /api/ocr/evaluate`のAPI接続変更
- Evaluation UI変更
- Benchmark変更
- Job化
- TrOCR training変更
- Dataset仕様変更
- Schema変更
- Metrics変更
- Issue #8修正

## テスト

`tests/test_trocr_evaluation_predictor.py`（新規34テスト）。`transformers.AutoProcessor`/
`VisionEncoderDecoderModel`の`from_pretrained`をmock（`tests/test_trocr_engine.py`と同じ
規約）。`TrOCREngine.load()`/`predict_file()`自体はmockせず実関数を使用し、fake
transformersクラスの戻り値のみを差し替えることで、既存のbuild-once・画像読込・
generate/decodeロジックを変更なく検証した。カテゴリ: Basics（engine_id/PredictionResult/
confidence None/engine_details None）・Model resolution/Build（model_ref/local_files_only/
device伝播・"latest"等の特殊値非対応・custom resolution非介在）・build-once（constructor時
1回・複数recognizeで再loadなし・Runner複数Sampleで再loadなし）・image/generate/decode
（RGB変換・Unicode・strip・empty result）・Error（transformers未インストール・
Processor/Model構築失敗・画像読込失敗・processor/generate/decode失敗の伝播）・
Integration（Dispatcher register/resolve/Runner success/failure/Predictor reuse/
confidence欠損warning/sample_count一致）・Capability（trocr=True/他3エンジン維持/
custom Unknown維持）・Regression（network/model downloadへの非依存確認）。

## Production変更範囲

新規:

- `src/app/services/trocr_evaluation_predictor.py`
- `tests/test_trocr_evaluation_predictor.py`

最小限の既存ファイル変更:

- `src/app/services/engine_capability.py`（`trocr.supports_evaluation=True`）
- `tests/test_evaluation_dispatcher.py`（Capability関連テスト1件改名・更新）
- `tests/test_paddleocr_evaluation_predictor.py`（Capability関連テスト1件更新）
- `tests/test_easyocr_evaluation_predictor.py`（Capability関連テスト1件更新）

`src/app/main.py`・`src/app/predict.py`・`src/app/services/ocr_evaluation.py`・
`src/app/services/benchmark.py`・`src/app/services/evaluation_runner.py`・
`src/app/services/evaluation_dispatcher.py`・`src/app/services/evaluation_metrics.py`・
`src/app/services/evaluation_types.py`・`src/app/services/trocr_engine.py`・
`src/app/schemas.py`・`frontend/`はいずれも無変更。
