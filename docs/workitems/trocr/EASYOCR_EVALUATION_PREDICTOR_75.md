# [Feature] EasyOCR Evaluation Predictor

Issue: [#75](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/75)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)（Common Evaluation Schema、Completed） / Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)（Common Evaluation Metric Calculator、Completed） / Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)（Evaluation Dispatcher、Completed） / Feature [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)（Evaluation Runner、Completed） / Feature [#71](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/71)（Tesseract Evaluation Predictor Adapter、Completed） / Feature [#73](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/73)（PaddleOCR Evaluation Predictor、Completed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: （作成後追記）

**状態**: Implemented, PR review pending。

## 最重要原則

本Featureの目的は「新しいEasyOCR評価処理を作ること」ではない。

```text
既存EasyOCR推論経路
        ↓
EasyOCR Evaluation Predictor（本Issue、橋渡しのみ）
        ↓
EvaluationDispatcher / EvaluationRunner
```

既存推論の意味論は変えていない。既存`POST /api/predict`にはまだ接続しない。

## 実装前調査（既存EasyOCR推論経路）

Tesseract・PaddleOCRと異なり、`ocr_evaluation.py::build_recognizer()`はEasyOCRにも対応
していない（`engine=="tesseract"`以外は`ValueError`を送出する）。そのため**EasyOCR専用の
評価経路は既存コードに存在しなかった**。実コード調査の結果は以下のとおり。

| 項目 | 事実 |
| --- | --- |
| Inference entry point | `predict.py::_predict_with_easyocr()`（`/predict`のengine分岐から呼ばれる） |
| Reader生成箇所 | `predict.py::_get_easyocr_reader(languages)` |
| Reader cache有無 | あり。`_EASYOCR_READER_CACHE`（`(tuple(languages), use_gpu)`をキーとするプロセス内dict） |
| language設定 | `languages: list[str]`（`_normalize_ocr_languages()`で正規化、未指定時`["en"]`） |
| device/GPU設定 | `torch.cuda.is_available()`で自動判定（呼び出し側から明示指定不可。既存仕様のまま） |
| official modelのみか | **はい**。`easyocr.Reader(languages, gpu=use_gpu)`を直接生成するのみ |
| custom/trained model対応有無 | **無い**。`model_registry.py`にEasyOCR用のcustom解決関数は存在せず、`resolve_ocr_model_meta(engine="easyocr")`のような呼び出しもコードベースに存在しないことをgrepで確認済み。PaddleOCRのcustom model設計はコピーしていない |
| image入力方式 | パス文字列ではなく、自前でグレースケールnumpy配列へ変換して渡す（`Image.open(input_path).convert("L")`→`np.array()`。cv2.imread非依存、`tests/test_easyocr_input.py`で確認済みの既存仕様） |
| text取得方法 | `reader.readtext(image_array, detail=1, paragraph=False)`の戻り値（`(bbox, text, confidence)`のタプル列）から`text`を抽出 |
| confidence取得方法 | 同上の`confidence`をそのままfloatとして保持 |
| 複数result集約方式 | **最大confidenceの1件を採用**（`_run_easyocr()`内の`max(parsed_results, key=confidence)`。全件joinでもfirst resultでもline順でもbbox順でもない。PaddleOCRの「最大confidence採用」ルールと結果的に同じだが、これは実コード確認の結果でありPaddleOCRのルールをコピーしたものではない） |
| empty resultの扱い | `prediction=""`・`confidence=0.0`（Noneではない。既存の実際の契約） |
| preprocessing | Predictorへ持ち込まない（下記「preprocessing」参照） |
| error handling | `_run_easyocr()`は例外を握りつぶさず送出（既存動作） |

## Existing EasyOCR capability（事実確認）

`EasyOCR custom/trained model`が現行実装に存在するかを確認した。

- `model_registry.py`全体をgrepし、EasyOCR用のcustom model解決関数（PaddleOCRの
  `resolve_ocr_model_meta(engine="paddleocr")`に相当するもの）が**存在しない**ことを確認した
- `predict.py::_predict_with_easyocr()`は`_get_easyocr_reader(languages)`を呼ぶのみで、
  model参照・model_dir・学習済みモデルファイルのいずれも扱わない
- 結論: **既存仕様どおりofficial Readerのみをサポートする。** PaddleOCRのcustom model設計
  （`official_requested`判定・`resolve_ocr_model_meta()`・`_is_paddle_rec_inference_dir()`等）
  は本Predictorへ一切持ち込んでいない

## Predictor

新規: `src/app/services/easyocr_evaluation_predictor.py`。

```python
class EasyOCREvaluationPredictor:
    engine_id = "easyocr"

    def __init__(
        self,
        project_id: Optional[str] = None,
        languages: Optional[list[str]] = None,
    ) -> None: ...

    def recognize(self, image: str, **kwargs: Any) -> PredictionResult: ...
```

`PredictionResult`は既存の共通型（`src/app/services/evaluation_types.py`、Issue #73で切り出し
済み）をそのまま利用する。新しいDTOは作らない。`project_id`は現時点でモデル解決に使用しない
（custom modelが存在しないため）が、将来API Integration Issueで他Engineと呼び出し規約を揃える
ためだけに引数として保持する。

## Reader build-once

`__init__`（build-once）で行うもの:

- `_get_easyocr_reader(languages)`の呼び出し（未キャッシュなら`easyocr.Reader(...)`の構築＝
  重みload、既キャッシュならそのまま返す）

`recognize()`（Sampleごと）で行うもの:

- `_run_easyocr()`の呼び出し（実際のOCR実行はSample単位でしか行えない処理）

`tests/test_easyocr_evaluation_predictor.py::test_build_once_reader_constructed_exactly_once`
で、Reader構築（heavy initializer）がconstructor時に1回のみであり、3回の`recognize()`呼び出し
で再構築されないことを実測確認した。また`test_cached_reader_is_reused_across_predictors`で、
既存`_get_easyocr_reader()`自身のキャッシュ（languages/use_gpuキー）が引き続き機能しており、
Predictor側はその有無を意識せず戻り値をそのまま保持するだけであることも確認した。

## Model download / network / CI環境依存の回避（PaddleOCR Issue #73の教訓）

PaddleOCR Evaluation Predictor（Issue #73）では、`Predictor.__init__()`内で
`_get_paddle_text_recognition_reader()`（キャッシュ取得）がNoneを返す場合のフォールバックとして
Predictor自身が`from paddleocr import PaddleOCR`という**独自の直接import**を追加で持っていた
ため、マージ前レビューで「paddleocr未インストールCI環境でこのフォールバックpathのテストが
失敗する」というCI環境依存の不具合が発覚した（詳細は
[PADDLEOCR_EVALUATION_PREDICTOR_73.md](PADDLEOCR_EVALUATION_PREDICTOR_73.md)参照）。

**本Predictorはこの問題を構造的に回避している。** EasyOCRの既存Reader取得は
`_get_easyocr_reader()`という単一の関数に完全に閉じており、実際の`import easyocr`もキャッシュ
確認もフォールバック構築もすべてこの関数の内部で完結する（`predict.py`側で既にテスト済みの
既存コード）。本Predictorは`_get_easyocr_reader()`を呼び出すだけで、独自の`import easyocr`や
フォールバック構築ロジックを一切持たない。そのため`tests/test_easyocr_evaluation_predictor.py`
は`_get_easyocr_reader()`をmockするだけで、`easyocr`パッケージの実インストール有無・network・
GPU・実model weightsのいずれにも一切依存せずConstructor全体（package unavailable時の
`RuntimeError`伝播を含む）を検証できる。PaddleOCRのような`sys.modules["easyocr"]`への
module stubは本Predictorでは不要である（`test_constructor_failure_when_package_unavailable`
参照）。

## 既存Inference helper再利用（禁止事項の遵守確認）

以下は再実装していないことを確認済み。

- OCR出力parser: `_run_easyocr()`をそのまま呼び出す（本モジュールに独自parserなし）
- confidence計算式: `_run_easyocr()`の戻り値をそのまま保持（本モジュールに独自計算式なし）
- bbox並び替え: `_run_easyocr()`内の処理のみ（本モジュールはbboxに一切触れない）
- text join方式: 新設していない（既存の「最大confidence1件採用」をそのまま踏襲）

`tests/test_easyocr_evaluation_predictor.py::test_existing_run_easyocr_helper_untouched`で、
既存`_run_easyocr()`を直接呼び出した場合とPredictor経由で呼び出した場合とで、同一Mock
reader出力に対して同一の`(text, confidence)`を返すことを直接比較検証した。

## text aggregation / confidence

既存`_run_easyocr()`の集約ルールをそのまま踏襲し、再実装しない。

- 複数検出結果がある場合、**最大confidenceの1件を採用**する（既存ルール。全件joinでも
  first resultでもline順でもない）
- 検出0件時は`prediction=""`・`confidence=0.0`（既存ルール。Noneではない）
- **既存`_run_easyocr()`はconfidenceを常にfloatで返し、Noneを返すことはない。** これは
  Tesseractの`recognize_line()`（`Optional[float]`、取得不能時は`None`）とは異なる既存の
  実際の契約差であり、本Predictorが新たに0.0を捏造しているわけではない
- 非有限値（NaN/Infinity）が理論上返り得るかを調査した。`_run_easyocr()`は
  `float(row[2])`で変換しており、easyocr自身のスコア出力（通常0.0-1.0の実数）であるため
  理論的リスクは低いが、ゼロではない。仮に非有限値が返っても、Common Evaluation Schema
  （`_reject_non_finite`）が拒否し、RunnerのSample Failure Boundaryで隔離されることを
  確認済み（Issue #71 Minor 2・Issue #73と同型の安全網が既に機能する）

## preprocessing

Predictorは前処理を一切実行しない。`image`引数は前処理済みの画像パスを前提とする
（Tesseract/PaddleOCR Predictor Adapterと同じ契約）。複数target横断の評価前処理plan・
小文字制御用allowlistは、Evaluation固有のplan概念として持ち込まず、当面API Integration
Issue側の責務のまま維持する。

## error propagation

- **constructor時**: `easyocr`パッケージ未インストール・Reader構築失敗は、
  `_get_easyocr_reader()`が送出する`RuntimeError`をそのまま伝播する（握りつぶさない）。
  これはPredictor構築時点＝`EvaluationDispatcher.register()`・`EvaluationRunner.run()`より
  前のエラーであり、画像単位のOCR失敗（Sample単位エラー）とは明確に区別される
- **recognize時**: 画像読込失敗（`Image.open()`の例外）・OCR実行失敗・malformed result由来の
  例外はいずれも`recognize()`から握りつぶさず伝播させ、`EvaluationRunner`の既存Sample
  Failure Boundaryが隔離する（Run全体は中断しない）。空文字への正常フォールバックはしない
  （検出0件時の`prediction=""`のみが正常系であり、それ以外の失敗を空文字で隠さない）

## engine_details

Tesseract/PaddleOCR Predictor Adapterと同じ理由で、常に`None`とする。

- `EvaluationRunner`は現時点で`engine_details`を`OcrEvaluationResult`へ統合しない
- model cache path・user path・model download path・GPU内部情報・Reader object state等、
  必要性が無い情報は一切格納しない

## Dispatcher Capability変更

Backend Engine Registryの`easyocr.supports_evaluation`を`False`から`True`へ変更した
（`src/app/services/engine_capability.py::_easyocr_capability()`）。

- `supports_evaluation`を参照する箇所は`evaluation_dispatcher.py::EvaluationDispatcher.resolve()`
  のみであることを確認済み（Issue #67時点から変わらず）。他のAPI・Frontend・Benchmarkは
  この値を一切参照しないため、**Capability変更がAPI自動有効化につながることはない**
  （既存`POST /api/predict`・`POST /api/ocr/evaluate`は無変更のまま）
- 既存`tests/test_evaluation_dispatcher.py::test_capability_unsupported_with_real_default_registry`
  はeasyocrを対象から除外し（trocrのみ残す）、
  `test_capability_supported_with_real_default_registry_tesseract_paddleocr_and_easyocr`
  へ改名してtesseract・paddleocr・easyocr全てが`supports_evaluation=True`であることを
  検証する形へ更新した
- 同様に`tests/test_paddleocr_evaluation_predictor.py::test_capability_easyocr_trocr_still_false`
  を`test_capability_trocr_still_false`へ改名し、easyocrを対象から除外した
- 変更後期待値: `tesseract=True` / `paddleocr=True` / `easyocr=True` / `trocr=False` /
  customはBackend Registry未登録のためUnknown扱い（変更なし）

## Dispatcher登録・Runner接続

グローバルdefault Dispatcherへの自動登録は今回実装しない（API Integration Issueでcomposition
rootを決める）。テストでは`dispatcher.register("easyocr", predictor)`してから
`EvaluationRunner`経由で実行できることを確認した。resolve回数=1・Predictor再利用・
recognize呼び出し回数=Sample数・success/failure/confidence/metrics/confusion/warningsの
接続をテストで確認済み（Tesseract/PaddleOCR Predictor Adapterと同じ既存Runner機構をそのまま
利用）。Runner本体のsemantic変更は行っていない。

## API未配線

`POST /api/predict`・`POST /api/ocr/evaluate`への接続、`src/app/main.py`の変更、TrOCR
Predictor実装は本Issueに含まない。実EasyOCRモデルのダウンロード・ネットワーク・GPUに
依存しないよう、全テストはReader取得ヘルパーをmockしている。

## 次のIssue

TrOCR Evaluation Predictor（既存TrOCR推論経路をAdapter化する想定。confidence/bboxが
常に`None`/フィールド無しであることの確認が中心になる見込み）。

## Scope外（本Issueでは行わない）

- Tesseract/PaddleOCR Predictor再変更
- TrOCR Predictor実装
- `POST /api/predict`・`POST /api/ocr/evaluate`のAPI接続変更
- Evaluation UI変更
- Benchmark変更（`benchmark.py`は無変更。そもそもEasyOCR用のBenchmark Runnerは
  「未導入・利用不可」のまま既存カタログに記載されており、本Issueで変更しない）
- Job化
- Issue #8修正

## テスト

`tests/test_easyocr_evaluation_predictor.py`（新規25テスト）。`_get_easyocr_reader`をmock。
`_run_easyocr`自体はmockせず実関数を使用し、Mock reader（`.readtext()`）の戻り値のみを
差し替えることで、既存の解析・集約ロジックを変更なく検証した。`_run_easyocr()`が内部で
`Image.open()`により画像ファイルを実際に開くため、`tmp_path`で実画像ファイルを用意している
（`tests/test_easyocr_input.py`と同じ規約）。カテゴリ: Basics（engine_id/PredictionResult/text/
confidence 0.0/engine_details）・Build（languages正規化/build-once/heavy initializer1回/
cached Reader再利用/package unavailable時のRuntimeError）・Output（single result/
multi-result aggregation/Unicode/empty result）・Error（recognize failure/malformed
underlying result/image read failure/exception propagation）・Integration（Dispatcher
register/resolve/Runner success/failure/Predictor reuse）・Capability（easyocr=True/
tesseract・paddleocr=True維持/trocr=False維持/custom Unknown維持）・Regression（既存
`_run_easyocr()`との直接比較による互換性確認）。

既存テスト（無修正のまま全件成功を確認済み、Capability関連の一部は本Issueで更新）:

- `tests/test_tesseract_evaluation_predictor.py`（17件、無修正）
- `tests/test_evaluation_runner.py`（34件、無修正）
- `tests/test_evaluation_metrics.py`（46件、無修正）
- `tests/test_evaluation_schema.py`（88件、無修正）
- `tests/test_cer_metrics.py`（7件、無修正）
- `tests/test_engine_capability.py`（無修正）
- `tests/test_easyocr_input.py`（無修正。既存EasyOCR入力方式の回帰確認）
- `tests/test_benchmark.py`（無修正。`benchmark.py`は本Issueで無変更のため）
- `tests/test_evaluation_dispatcher.py`（Capability関連2件を更新: easyocrをUnsupported対象
  から除外し、Supported対象へ追加）
- `tests/test_paddleocr_evaluation_predictor.py`（Capability関連1件を更新:
  `test_capability_easyocr_trocr_still_false`→`test_capability_trocr_still_false`へ改名し
  easyocrを対象から除外）

## Production変更範囲

新規:

- `src/app/services/easyocr_evaluation_predictor.py`
- `tests/test_easyocr_evaluation_predictor.py`

最小限の既存ファイル変更:

- `src/app/services/engine_capability.py`（`easyocr.supports_evaluation=True`）
- `tests/test_evaluation_dispatcher.py`（Capability関連2件更新）
- `tests/test_paddleocr_evaluation_predictor.py`（Capability関連1件更新）

`src/app/main.py`・`src/app/predict.py`・`src/app/services/ocr_evaluation.py`・
`src/app/services/benchmark.py`・`src/app/services/evaluation_runner.py`・
`src/app/services/evaluation_dispatcher.py`・`src/app/services/evaluation_metrics.py`・
`src/app/services/evaluation_types.py`・`src/app/schemas.py`・`frontend/`・`requirements*.txt`・
DBはいずれも無変更。
