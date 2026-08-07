# [Feature] Tesseract Evaluation Predictor Adapter

Issue: [#71](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/71)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61) / Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)（Common Evaluation Schema、Completed） / Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)（Common Evaluation Metric Calculator、Completed） / Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)（Evaluation Dispatcher、Completed） / Feature [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)（Evaluation Runner、Completed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: 作成後に追記

**状態**: Implemented, PR review pending。

## 最重要原則

本Featureの目的は「新しいTesseract評価処理を作ること」ではない。既存のTesseract評価挙動を
維持したまま、以下の境界を作るだけである。

```text
既存Tesseract固有処理（model解決・OCR実行・confidence取得）
        ↓
Tesseract Evaluation Predictor Adapter（本Issue、橋渡しのみ）
        ↓
EvaluationRunnerから利用可能
```

既存`POST /api/ocr/evaluate`にはまだ接続しない。既存Tesseract評価結果（`ocr_evaluation.py`の
出力）は一切変更しない（本Adapterから呼び出すのみで、既存関数自体は無変更）。

## 実装前調査（Existing Tesseract path）

現在のTesseract評価（`src/app/services/ocr_evaluation.py`）における各処理の所在を確認した。

| 処理 | 所在 |
| --- | --- |
| Tesseract実行ファイル解決 | `tesseract_pipeline.py::ensure_tesseract_inference_tool()` |
| base model（`eng.traineddata`）解決 | `tesseract_pipeline.py::resolve_base_traineddata()` |
| 学習後model（`.tess.json`）解決 | `model_registry.py::resolve_tesseract_model_meta()` |
| model解決の統合（base/trained分岐） | `ocr_evaluation.py::_build_tesseract_recognizer()`（`build_recognizer()`経由で公開） |
| PSM / charset(whitelist) | `evaluate_ocr()`の引数としてRequestからそのまま`build_recognizer()`へ渡される（モデルメタ情報による上書きは存在しない） |
| 学習時前処理metadata（`training_preprocess`/`training_preprocess_hash`） | `_build_tesseract_recognizer()`が学習後モデルのメタから読込・保持 |
| 画像前処理（前処理plan適用） | `evaluate_ocr()`内`_prepare_eval_input()`。複数ターゲット横断の前処理plan（`resolve_evaluation_preprocess_plan()`）に依存 |
| OCR実行 | `tesseract_pipeline.py::recognize_line()`（TSV出力→`(text, confidence)`） |
| confidence取得 | `recognize_line()`内`aggregate_word_confidences()`。whitelist指定時の既知の全0挙動は`None`（取得不能）として扱う |
| normalize処理（比較用） | `ocr_evaluation.py::_normalize_compare()`（`src.app.services.ocr_evaluation`のlogger名でU+FFFD警告を出力） |
| error handling | `evaluate_ocr()`の画像単位ループは`try/finally`（一時ファイル削除のみ）で、`try/except`によるSample単位エラー処理は**存在しない**（`recognize()`が例外を送出すればそのまま`evaluate_ocr()`全体が中断する既存挙動） |

### 責務分担の結論

- **Predictorへ移す責務**: `EnginePredictor`適合（`engine_id`/`recognize()`）・`EvaluationDispatcher`への登録可能性・`PredictionResult`への変換・build-onceタイミングでの`build_recognizer()`呼び出し
- **Runnerに残す責務**（Issue #69で確定済み、本Issueでは変更しない）: resolve（1回）・Sample反復・Sample Failure Boundary・Metrics/Confusion集計・timing・warnings
- **既存`ocr_evaluation.py`に当面残す責務**: GT CSV読込・画像探索・複数ターゲット横断の評価前処理plan解決（`resolve_evaluation_preprocess_plan`）・既存`POST /api/ocr/evaluate`のResponse構築。**評価前処理plan自体は複数ターゲットを横断する概念であり、単一Predictorの責務にはできない**（API Integration Issueで、複数Predictorへ前処理済み画像を配る役割をどこに置くか決める）

### 既存経路との互換戦略

Adapterは`ocr_evaluation.py::build_recognizer()`をそのまま呼び出す（新しいModel Resolverを作らない）。`recognize(image, **kwargs)`の`image`引数は、既存評価経路が`rec["recognize"](processed_image_path)`へ渡すのと同じ「OCR実行可能な状態まで前処理済みの画像パス」を前提とする。テストでは`build_recognizer()`をmockし、Adapter経由の呼び出しが既存の`recognize`クロージャと完全に同じ引数・同じ戻り値になることを確認した（詳細は「テスト」節参照）。

## Predictor

新規: `src/app/services/tesseract_evaluation_predictor.py`。

```python
class TesseractEvaluationPredictor:
    engine_id = "tesseract"

    def __init__(
        self,
        project_id: Optional[str],
        model: str = "latest",
        charset: str = TESSERACT_WHITELIST_DEFAULT,
        psm: int = DEFAULT_PSM,
    ) -> None: ...

    def recognize(self, image: str, **kwargs: Any) -> PredictionResult: ...
```

`PredictionResult`は`EvaluationRunner`（Issue #69）の既存型をそのまま利用する。新しい類似DTOは作らない。

- `text`: `recognize_line()`の`predicted`をそのまま保持
- `confidence`: `recognize_line()`の`confidence`をそのまま保持。**取得不能時は`None`のまま**
  （`0.0`で捏造しない。既存`ocr_evaluation.py`の`confidence`同様の仕様）
- `engine_details`: 常に`None`（下記「engine_details方針」参照）

## Build once / reuse

`__init__`（build-once）で解決するもの:

- Tesseract実行ファイルパス（`ensure_tesseract_inference_tool()`）
- tessdata_dir・lang（base/trained分岐、`resolve_base_traineddata()`/`resolve_tesseract_model_meta()`）
- 学習後モデルの場合の`training_preprocess`/`training_preprocess_hash`メタ情報

`recognize()`（Sampleごと）で行うもの:

- `recognize_line()`の呼び出し（実際のOCR実行はSample単位でしか行えない処理）

`EvaluationRunner`は本Predictorを`run()`開始時に1回だけ`resolve()`し、以降は同一インスタンスを全Sampleで再利用する前提（Issue #69）に合わせ、モデル解決は`build_recognizer()`呼び出し1回のみで完結する。

## Dispatcher登録

グローバルdefault Dispatcherへの自動登録は今回実装しない（API Integration Issueでcomposition rootを決める）。テストでは`dispatcher.register("tesseract", predictor)`してから`EvaluationRunner`経由で実行できることを確認した。

## logger問題（Issue #65で保留、再確認）

Issue #65で保留された「`ocr_evaluation.py::_normalize_compare()`は`src.app.services.ocr_evaluation`のlogger名でU+FFFD警告を出力し、`tests/test_cer_metrics.py::test_normalize_compare_logs_replacement_char`がこのlogger名を明示的に期待する」問題を再確認した。

**結論: 本Adapterは`_normalize_compare()`（正規化・比較処理）を一切呼び出さない。** `TesseractEvaluationPredictor.recognize()`は`recognize_line()`の戻り値（`text`, `confidence`）をそのまま`PredictionResult`へ包むだけであり、正規化・比較・CER計算はRunner側（`EvaluationRunner`→`calculate_sample_metrics()`）が担当する。したがって、Adapter化によって既存logger挙動を変更する必要は**発生しなかった**。`evaluation_metrics.py::normalize_compare()`（`src.app.services.evaluation_metrics`のlogger名）との重複実装は、Issue #65で決定済みの方針どおり今回も解消しない（`ocr_evaluation.py`のMetric処理を本Issueで置換することはしない）。`tests/test_cer_metrics.py`は無修正のまま全件成功することを確認済み（テスト結果参照）。

## engine_details方針

`PredictionResult.engine_details`は常に`None`とする（Tesseract固有情報を設定しない）。理由:

1. `EvaluationRunner`は現時点で`engine_details`を`OcrEvaluationResult`へ統合しない（Issue #69で確定済み）ため、設定しても現状は捨てられるだけで利用先がない
2. `tessdata_dir`等のファイルシステムPathをここへ格納すると、将来Runnerが`engine_details`を統合するようになった際に、APIレスポンス経由で内部Pathが意図せず露出するリスクがある
3. 「機密Pathを不用意に入れない・model filesystem pathを外部Response用情報として扱わない・APIに出る前提で設計しない」という方針を優先し、利用先が定まってから必要な情報だけを選んで追加する

## Error handling（Run開始前エラー と Sample単位エラーの区別）

- **Predictor construction失敗**（`build_recognizer()`が送出する`RuntimeError`（Tesseract実行ファイル未検出等）・`FileNotFoundError`（学習後モデル未検出等））は、`__init__`からそのまま伝播する。これは`EvaluationDispatcher.register()`・`EvaluationRunner.run()`より前に発生するエラーであり、Sample failureへは変換しない（呼び出し側＝将来のAPI Integration Issueが構成する場所で処理する）
- **画像単位OCR失敗**（`recognize_line()`が送出する`RuntimeError`（Tesseractプロセス失敗等））は、`recognize()`から握りつぶさずそのまま送出する。`EvaluationRunner`のSample Failure Boundary（Issue #69の修正後レビューで確立済み）がこれを捕捉し、該当Sample1件のみの失敗として隔離する（Run全体は中断しない）

## EnginePredictor Protocol（Issue #69 Future Workの再確認）

Issue #69で残した「`EnginePredictor.recognize()`の戻り値`Any`を`PredictionResult`へ具体化する検討」を、実Predictorを初めて追加する本Issueで再調査した。

**採用: 案B（Protocolは`Any`のまま維持し、Adapter実装のみが`PredictionResult`を返す）。**

理由:

- `PredictionResult`は`evaluation_runner.py`に定義されている。`evaluation_dispatcher.py`側のProtocol型注釈をそこへ具体化すると、Dispatcher → Runner方向のimportが発生し、Runner → Dispatcher（既存の`from .evaluation_dispatcher import EvaluationDispatcher`）と合わせて循環importになる
- 型を具体化するには、`PredictionResult`をDispatcher・Runner双方から参照できる第三の場所（例: 新規`predictor_types.py`）へ移動する必要があり、これは本Issueのスコープ（Tesseract Adapter追加）を超える設計変更である
- 実行時の安全性は既にRunner側の`isinstance(prediction, PredictionResult)`検証（Issue #69）で担保されている。型注釈が`Any`のままでも、契約違反はRuntimeで確実にSample failureへ変換される

Future Workとして記録: `PredictionResult`（および将来的な`EnginePredictor`の型引数）を、Dispatcher・Runner双方が依存できる独立モジュール（例: `evaluation_types.py`）へ切り出す設計変更を、PaddleOCR/EasyOCR/TrOCR Predictor追加時に改めて検討する。

## Dispatcher predictor.engine_id属性欠損（Scope外）

`TesseractEvaluationPredictor`には`engine_id = "tesseract"`をクラス属性として持たせているため、Issue #67で指摘された「`predictor.engine_id`属性欠損時に`AttributeError`が送出される」問題には該当しない。`EvaluationDispatcher`の汎用的な例外改善自体は今回Scope外のまま（Dispatcher側のFuture Work）。

## Injected clock（Issue #69 Future Workの再確認）

本番の`time.perf_counter()`はmonotonicであることを確認した。Tesseract Predictor実装によって新しいclock関連の問題は発生しない（Predictorはtimingに一切関与しない。timingは`EvaluationRunner`側の責務のまま）。`EvaluationRunner`のProductionコードは今回変更していない。

## tuple malformed result test（Issue #69 Future Workの再確認）

`TesseractEvaluationPredictor.recognize()`は必ず`PredictionResult`を返す設計のため、本Issueで`EvaluationRunner`のtuple戻り値テストを追加する必要はない。Future Workのまま維持する。

## Scope外（本Issueでは行わない）

- `POST /api/ocr/evaluate`の新Runner接続
- response_model追加
- PaddleOCR/EasyOCR/TrOCR Predictor実装
- Evaluation UI変更
- Benchmark変更
- Evaluation Job化
- Inference Resolver統一
- Models API変更
- Issue #8修正

## テスト

`tests/test_tesseract_evaluation_predictor.py`（新規17テスト）。`ocr_evaluation.py::build_recognizer`をmockし、実Tesseractバイナリ・実モデルへ依存しない。カテゴリ: 基本契約（`engine_id`/`PredictionResult`）・confidence方針（`None`保持）・engine_details（常に`None`）・PSM/whitelist伝播・model resolution（base/trained/エラー伝播）・helper例外の非握りつぶし・build-once/reuse（同一Predictorを複数Sampleで利用）・Dispatcher登録・Runner経由実行・Runner Sample Failure Boundaryとの接続・既存`build_recognizer()`出力との完全一致（互換性確認）。

既存テスト（無修正のまま全件成功を確認済み）:

- `tests/test_cer_metrics.py`（7件）
- `tests/test_evaluation_runner.py`（34件）
- `tests/test_evaluation_dispatcher.py`（22件）
- `tests/test_evaluation_metrics.py`（46件）
- `tests/test_evaluation_schema.py`（88件）

## Production変更範囲

新規追加のみ（既存ファイルは無変更）:

- `src/app/services/tesseract_evaluation_predictor.py`（新規）
- `tests/test_tesseract_evaluation_predictor.py`（新規）

`src/app/services/ocr_evaluation.py`・`evaluation_dispatcher.py`・`evaluation_runner.py`・`main.py`・`frontend/`はいずれも無変更。Runner/Dispatcherへの変更は不要だった。
