# [Feature] PaddleOCR Evaluation Predictor

Issue: [#73](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/73)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)（Common Evaluation Schema、Completed） / Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)（Common Evaluation Metric Calculator、Completed） / Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)（Evaluation Dispatcher、Completed） / Feature [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)（Evaluation Runner、Completed） / Feature [#71](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/71)（Tesseract Evaluation Predictor Adapter、Completed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: [#74](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/74)（Open・レビュー待ち）

**状態**: Implemented, PR review pending。

## 最重要原則

本Featureの目的は「新しいPaddleOCR評価実装を作ること」ではない。

```text
既存PaddleOCR推論経路
        ↓
PaddleOCR Evaluation Predictor（本Issue、橋渡しのみ）
        ↓
EvaluationDispatcher / EvaluationRunner
```

既存推論の意味論は変えていない。既存`POST /api/predict`にはまだ接続しない。

## 実装前調査（既存PaddleOCR推論経路）

Tesseractと異なり、`ocr_evaluation.py::build_recognizer()`はPaddleOCRに対応していない
（`engine=="tesseract"`以外は`ValueError`を送出する）。そのため**PaddleOCR専用の評価経路は
既存コードに存在しなかった**。実コード調査の結果、以下3箇所にPaddleOCR関連処理が分散している
ことを確認した。

| 処理 | 所在 | 本Issueでの扱い |
| --- | --- | --- |
| engine resolution | `predict.py::_predict_with_paddleocr()`の`resolved_engine_id == "paddleocr"`分岐 | 対象外（API層の責務） |
| official model一覧 | `predict.py::OFFICIAL_PADDLEOCR_REC_MODELS` | そのまま再利用 |
| official/custom判定 | `predict.py::_predict_with_paddleocr()`の`official_requested = requested_model in OFFICIAL_PADDLEOCR_REC_MODELS`分岐 | 同一ロジックをPredictor constructorで再現（新規Variant軸は追加しない） |
| custom/trained model resolution | `model_registry.py::resolve_ocr_model_meta(project_id, model, engine="paddleocr", inference_ready_only=True)` | そのまま再利用 |
| model directory検証 | `predict.py::_is_paddle_rec_inference_dir()` | そのまま再利用 |
| reader構築（object construction） | `predict.py::_get_paddle_text_recognition_reader()`（キャッシュ付き取得）・`_create_paddleocr_instance()`（バージョン差異吸収）。**`benchmark.py::_build_paddleocr_runner`/`_build_paddleocr_custom_runner`が既に同じヘルパーで`recognize(image_path)->(text,confidence)`を実装済み**（Variant Key軸`paddleocr_official`/`paddleocr_custom`の下） | そのまま再利用（`predict.py`から直接import。`benchmark.py`には依存しない） |
| device/language | `PaddleOCR(lang=..., use_angle_cls=...)`引数 | Predictor constructor引数として保持（build-once） |
| preprocessing | `predict.py::_prepare_ocr_input_path()`等（複数variant再試行を含む、推論テスト画面専用） | Predictorへ持ち込まない（下記「preprocessing」参照） |
| image読込 | PaddleOCR reader自身が画像パスを読み込む（`reader.ocr(path)`） | そのまま（Predictorは読込処理を持たない） |
| inference | `predict.py::_run_paddleocr(reader, path, use_angle_cls)` | そのまま再利用（新規実装しない） |
| text extraction | `_run_paddleocr()`内、複数検出結果から**最大confidenceの1件を採用**する既存ルール | そのまま再利用（再実装しない） |
| confidence extraction | `_run_paddleocr()`内、検出0件時は`0.0`（Noneではない） | そのまま再利用（既存の実際の契約） |
| error handling | `_run_paddleocr()`は例外を握りつぶさず送出（既存動作） | そのまま再利用 |

### 責務分離

- **Predictorへ移す責務**: `EnginePredictor`適合・`EvaluationDispatcher`登録可能性・
  `PredictionResult`への変換・build-oneタイミングでのofficial/custom判定とreader構築
- **既存helperをそのまま再利用する責務**: `_create_paddleocr_instance`・
  `_get_paddle_text_recognition_reader`・`_run_paddleocr`・`_is_paddle_rec_inference_dir`・
  `OFFICIAL_PADDLEOCR_REC_MODELS`（`predict.py`）、`resolve_ocr_model_meta`
  （`model_registry.py`）
- **API Integrationまで残す責務**: 複数ターゲット横断の評価前処理plan、`POST /api/predict`
  との接続、`predict.py::_predict_with_paddleocr()`固有の多段階variant再試行・文字単位
  confidence gate・business rule検証（これらはEvaluationの意味論には含まれない）

## Predictor

新規: `src/app/services/paddleocr_evaluation_predictor.py`。

```python
class PaddleOCREvaluationPredictor:
    engine_id = "paddleocr"

    def __init__(
        self,
        project_id: Optional[str],
        model: str = "latest",
        language: str = "en",
        use_angle_cls: bool = False,
    ) -> None: ...

    def recognize(self, image: str, **kwargs: Any) -> PredictionResult: ...
```

`PredictionResult`は既存の共通型（Issue #73で`evaluation_types.py`へ切り出し。下記
「PredictionResult依存方向」参照）をそのまま利用する。新DTOは作らない。

## Official / Custom（Benchmark Variant Keyを持ち込まない）

既存`_predict_with_paddleocr()`と同一の判定順序を再現した。

```text
1. requested_model が OFFICIAL_PADDLEOCR_REC_MODELS に含まれる → official
2. 含まれない → resolve_ocr_model_meta() で自作/学習済みモデルとして解決を試みる
3. 解決できず、かつ requested_model が ""/"latest" → OFFICIAL_PADDLEOCR_REC_MODELS[0] へフォールバック（既存仕様）
4. 解決できず、かつ requested_model がそれ以外 → FileNotFoundError
```

**Benchmark（`benchmark.py::ENGINE_CATALOG`）の`paddleocr_official`/`paddleocr_custom`という
Variant Key軸は持ち込んでいない。** Evaluationはcanonical engine_id="paddleocr"の1つのみ。
official/customの区別は`model`引数の値で決まり、`is_official`属性として保持するのみ
（Dispatcherへ登録する`engine_id`には一切影響しない）。

## Build-once

Predictor construction時（`__init__`）に1回だけ行うもの:

- official/custom判定・`resolve_ocr_model_meta()`によるmodel解決
- `_is_paddle_rec_inference_dir()`によるexport済み検証（custom時）
- reader取得（`_get_paddle_text_recognition_reader()`。キャッシュ済みでなければ
  `_create_paddleocr_instance()`経由でPaddleOCRオブジェクトを構築＝重みload）

`recognize()`（Sampleごと）で行うもの:

- `_run_paddleocr()`の呼び出し（実際のOCR実行はSample単位でしか行えない処理）

`tests/test_paddleocr_evaluation_predictor.py::test_build_once_reader_constructed_exactly_once`
で、reader構築（heavy initializer）がconstructor時に1回のみであり、3回の`recognize()`呼び出しで
再構築されないことを実測確認した。

## text aggregation / confidence

既存`_run_paddleocr()`の集約ルールをそのまま踏襲し、再実装しない。

- 複数検出結果（複数box/word）がある場合、**最大confidenceの1件を採用**する（既存ルール。
  平均やjoinではない）
- 検出0件時は`prediction=""`・`confidence=0.0`（既存ルール。Noneではない）
- **既存`_run_paddleocr()`はconfidenceを常にfloatで返し、Noneを返すことはない。** これは
  Tesseractの`recognize_line()`（`Optional[float]`、取得不能時は`None`）とは異なる既存の
  実際の契約差であり、本Predictorが新たに0.0を捏造しているわけではない（既存事実をそのまま
  反映しただけ）
- NaN/Infinityが理論上返り得るかを調査した。`_run_paddleocr()`は`float(rec_scores[idx])`等
  で変換しており、DB由来ではなくPaddleOCR自身のスコア出力（通常0.0-1.0の実数）であるため、
  Tesseractの「TSV文字列を`float()`で変換」ケースほどの理論的リスクはないが、ゼロではない。
  仮に非有限値が返っても、Common Evaluation Schema（`_reject_non_finite`）が拒否し、
  RunnerのSample Failure Boundaryで隔離されることを確認済み（Issue #71 Minor 2と同型の
  安全網が既に機能する）

## preprocessing

Predictorは前処理を一切実行しない。`image`引数は前処理済みの画像パスを前提とする
（Tesseract Predictor Adapterと同じ契約）。複数target横断の評価前処理plan
（`predict.py::_predict_with_paddleocr()`の多段階variant再試行等）は、Evaluation固有の
plan概念として持ち込まず、当面API Integration Issue側の責務のまま維持する。

## PredictionResult依存方向（Issue #71 Future Work Minor 3の解消）

Issue #71で`Predictor → evaluation_runner.py::PredictionResult`という依存方向が記録されていた
（全PredictorがRunnerモジュールへ依存する構造）。2つ目の実Predictorが入る本Issueで、**案B
（第三モジュールへの切り出し）を実施した。**

- 新規: `src/app/services/evaluation_types.py`。`PredictionResult`をここへ移動
- `evaluation_runner.py`: ローカル定義を削除し`from .evaluation_types import PredictionResult`
  へ変更。**既存import（`from .evaluation_runner import PredictionResult`）との後方互換のため
  再エクスポートする**（`__all__`に含め、実際に同一クラスオブジェクトであることをテストで確認）
- `evaluation_dispatcher.py`: `EnginePredictor.recognize()`の戻り値型注釈を`Any`から
  `PredictionResult`へ具体化（`from .evaluation_types import PredictionResult`を追加）。
  **`evaluation_types.py`は他のEvaluation関連モジュールを一切importしない独立した葉モジュール
  のため、この変更によるDispatcher⇄Runnerの循環importは発生しない**（実測確認済み）
- `tesseract_evaluation_predictor.py`: importを`from .evaluation_runner import PredictionResult`
  から`from .evaluation_types import PredictionResult`へ変更（1行のみ。テスト・docstringの
  他の記述は変更不要）
- `paddleocr_evaluation_predictor.py`（本Issue、新規）: 最初から`evaluation_types.py`から
  importする

### 影響範囲（実装前に想定した「広い変更」には該当しなかった）

再エクスポートにより、`tests/test_evaluation_runner.py`・`tests/test_tesseract_evaluation_predictor.py`
はいずれも無修正で成功する（`from .evaluation_runner import PredictionResult`は引き続き解決
する）。変更が必要だったのは新規1ファイル（`evaluation_types.py`）＋既存3ファイルの各1〜数行
（`evaluation_runner.py`のクラス定義削除+import追加、`evaluation_dispatcher.py`のimport追加+型
注釈変更、`tesseract_evaluation_predictor.py`のimport1行変更）のみであり、Runner/Dispatcher/
Tesseract Predictorの**動作**は一切変更していない（全既存テストが無修正のまま成功したことで
確認済み）。「広い変更が必要」には該当しなかったため、実装前の停止・報告は行わず実装した。

## EnginePredictor Protocol型具体化

`PredictionResult`の切り出しにより循環import無しで具体化可能となったため、
`recognize(*args: Any, **kwargs: Any) -> Any`から`recognize(*args: Any, **kwargs: Any) -> PredictionResult`
へ変更した。**これは静的な型注釈のみの変更であり、実行時の型強制ではない**
（`Protocol`は`@runtime_checkable`ではないため`isinstance()`検証はできない。実行時の契約検証は
引き続きRunner側の`isinstance(prediction, PredictionResult)`＝Sample Failure Boundaryが担う）。
Dispatcher/Runner/Tesseract Predictor/PaddleOCR Predictorの既存テストはいずれも無修正のまま
全件成功することを確認済み（型注釈変更のみで実行時動作に影響がないことの実測確認）。

## Dispatcher Capability変更

Backend Engine Registryの`paddleocr.supports_evaluation`を`False`から`True`へ変更した
（`src/app/services/engine_capability.py::_paddleocr_capability()`）。

- `supports_evaluation`を参照する箇所は`evaluation_dispatcher.py::EvaluationDispatcher.resolve()`
  のみであることを確認済み（Issue #67時点から変わらず）。他のAPI・Frontend・Benchmarkは
  この値を一切参照しないため、**Capability変更がAPI自動有効化につながることはない**
  （既存`POST /api/predict`・`POST /api/ocr/evaluate`は無変更のまま）
- 既存`tests/test_evaluation_dispatcher.py::test_capability_unsupported_with_real_default_registry`
  はpaddleocrを対象から除外し（easyocr/trocrのみ残す）、新規
  `test_capability_supported_with_real_default_registry_tesseract_and_paddleocr`で
  tesseract・paddleocr双方が`supports_evaluation=True`であることを検証する形へ更新した
- easyocr/trocrは引き続き`supports_evaluation=False`、customはBackend Registry未登録のため
  引き続きUnknown扱い（変更なし）

## engine_details

Tesseract Predictor Adapter（Issue #71）と同じ理由で、常に`None`とする。

- `EvaluationRunner`は現時点で`engine_details`を`OcrEvaluationResult`へ統合しない
- model_dir等のファイルシステムPath・ローカルユーザーPath・GPU device詳細・秘密情報を
  格納しない。将来必要になれば、利用先が定まった段階でFuture Workとして追加を検討する

## Dispatcher登録・Runner接続

グローバルdefault Dispatcherへの自動登録は今回実装しない（API Integration Issueでcomposition
rootを決める）。テストでは`dispatcher.register("paddleocr", predictor)`してから
`EvaluationRunner`経由で実行できることを確認した。resolve回数=1・Predictor再利用・
recognize呼び出し回数=Sample数・success/failure/confidence/metrics/confusion/warningsの
接続をテストで確認済み（Tesseract Predictor Adapterと同じ既存Runner機構をそのまま利用）。

## Tesseract回帰

PaddleOCR追加によりTesseract Predictorが壊れていないことを確認した。

- `tests/test_tesseract_evaluation_predictor.py`（17件）は無修正のまま全件成功
- `tests/test_evaluation_dispatcher.py`（Capability関連2件を更新した22件）
- `tests/test_evaluation_runner.py`（34件）・`tests/test_evaluation_metrics.py`（46件）・
  `tests/test_evaluation_schema.py`（88件）・`tests/test_cer_metrics.py`（7件）はいずれも
  無修正のまま全件成功
- `tests/test_benchmark.py`（PaddleOCR自作モデルAdapterテストを含む）も無修正のまま全件成功
  （`benchmark.py`自体は無変更）

## API未配線・Predictor未実装

`POST /api/predict`・`POST /api/ocr/evaluate`への接続、`src/app/main.py`の変更、EasyOCR/TrOCR
Predictor実装は本Issueに含まない。実PaddleOCRモデルのダウンロード・ネットワーク・GPUに
依存しないよう、全テストはreader構築ヘルパーをmockしている。

## 次のIssue

EasyOCR Evaluation Predictor（既存EasyOCR推論経路をAdapter化する想定）。

## Scope外（本Issueでは行わない）

- Tesseract Predictor再変更
- EasyOCR/TrOCR Predictor実装
- `POST /api/predict`・`POST /api/ocr/evaluate`のAPI接続変更
- Evaluation UI変更
- Benchmark変更（`benchmark.py`は無変更）
- Job化
- Issue #8修正

## テスト

`tests/test_paddleocr_evaluation_predictor.py`（新規28テスト）。`_get_paddle_text_recognition_reader`・
`resolve_ocr_model_meta`・`_is_paddle_rec_inference_dir`・`_create_paddleocr_instance`をmock。
`_run_paddleocr`自体はmockせず実関数を使用し、Mock readerの`.ocr()`戻り値のみを差し替えることで、
既存の解析・集約ロジックを変更なく検証した。カテゴリ: Basics（engine_id/PredictionResult/text/
confidence None・0.0/engine_details）・Resolution/Build（official/custom/model resolution/
build-once/heavy initializer1回）・Output（single result/multi-result aggregation/Unicode/
empty result）・Error（constructor failure/recognize failure/malformed underlying result/
exception propagation）・Integration（Dispatcher register/resolve/Runner success/failure/
Predictor reuse）・Capability（paddleocr=True/tesseract=True維持/easyocr・trocr=False維持/
custom Unknown維持）。

既存テスト（無修正のまま全件成功を確認済み）:

- `tests/test_tesseract_evaluation_predictor.py`（17件）
- `tests/test_evaluation_runner.py`（34件）
- `tests/test_evaluation_metrics.py`（46件）
- `tests/test_evaluation_schema.py`（88件）
- `tests/test_cer_metrics.py`（7件）
- `tests/test_benchmark.py`・`tests/test_engine_capability.py`（PaddleOCR/Capability関連の既存回帰確認）

## Production変更範囲

新規:

- `src/app/services/evaluation_types.py`
- `src/app/services/paddleocr_evaluation_predictor.py`
- `tests/test_paddleocr_evaluation_predictor.py`

最小限の既存ファイル変更:

- `src/app/services/engine_capability.py`（`paddleocr.supports_evaluation=True`）
- `src/app/services/evaluation_dispatcher.py`（`PredictionResult`型具体化・import追加）
- `src/app/services/evaluation_runner.py`（`PredictionResult`定義を`evaluation_types.py`へ移動、再エクスポート）
- `src/app/services/tesseract_evaluation_predictor.py`（import1行変更）
- `tests/test_evaluation_dispatcher.py`（Capability関連2件更新）

`src/app/main.py`・`src/app/predict.py`・`src/app/services/ocr_evaluation.py`・
`src/app/services/benchmark.py`・`src/app/schemas.py`・`frontend/`はいずれも無変更。
