# [Feature] Evaluation Runner

Issue: [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61) / Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)（Common Evaluation Schema、Completed） / Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)（Common Evaluation Metric Calculator、Completed） / Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)（Evaluation Dispatcher、Completed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: [#70](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/70)（Open・レビュー待ち）

**状態**: Implemented, PR review pending。

## Runnerの責務

新規: `src/app/services/evaluation_runner.py`。

```text
Evaluation Input Samples
        ↓
DispatcherでPredictor解決（run開始時に1回だけ）
        ↓
各SampleをPredictorへ渡す
        ↓
Sample Result生成（Common Metric Calculator利用）
        ↓
Common Metric Calculatorで集計
        ↓
OcrEvaluationResult生成
```

担当するもの: Predictor解決（1回）・Dataset全Sampleの順次処理・Predictor呼び出し・
prediction/confidence受領・Sample Result生成・エラーSample生成・Metrics集計・Confusion集計・
timing・warnings・Result組み立て・`sample_count`同期。

担当しないもの: Engine固有モデルload・Engine固有前処理・Datasetディレクトリ探索・GT CSV読込・
API Request解析・HTTP Error変換・DB保存・履歴保存・Job管理・Benchmark・UI。

## 公開API

```python
class EvaluationRunner:
    def __init__(
        self,
        dispatcher: EvaluationDispatcher,
        *,
        now: Callable[[], datetime] | None = None,
        perf_counter: Callable[[], float] | None = None,
    ) -> None: ...

    def run(
        self,
        *,
        engine_id: str,
        samples: Sequence[EvaluationInputSample],
        model_ref: str | None = None,
        dataset_id: str | None = None,
        predictor_args: Mapping[str, Any] | None = None,
    ) -> OcrEvaluationResult: ...
```

`now`/`perf_counter`はテストでのFake Clock注入用（未指定時は実時刻・`time.perf_counter`を使用）。

## 入力Schema

```python
@dataclass(frozen=True)
class EvaluationInputSample:
    image: str
    ground_truth: str
```

`sample_id`・`metadata`は今回の責務（Evaluation Loopの接続）に不要なため追加しなかった。
Path存在確認は行わない（画像読込はPredictor側の責務）。新しいPydantic Schemaは追加していない
（Runner内部型はdataclassのみで十分と判断）。

## Predictor出力契約（`PredictionResult`）

```python
@dataclass(frozen=True)
class PredictionResult:
    text: str
    confidence: float | None = None
    engine_details: Mapping[str, Any] | None = None
```

**`EnginePredictor` Protocol自体（`evaluation_dispatcher.py`）は変更していない**
（`recognize(*args, **kwargs) -> Any`のまま）。実Predictor実装がまだ存在せず、Protocol型を
強制する必要性が薄いことに加え、Scope上もDispatcherへの変更はengine_id整合性検証のみに限定した
ため。本Runnerは、Predictorの戻り値が`PredictionResult`であることを前提として扱う契約として、
`evaluation_runner.py`側でのみ定義した（将来のPredictor実装Issueが従うべき契約）。

- confidenceはnullable。未取得を`0.0`で補完しない
- bboxは必須化しない（`PredictionResult`に含めない）
- `engine_details`はPredictor側で任意提供。今回は統合方針が定まらないため、
  Result側の`engine_details`は空dictのまま返す（下記「engine_details」参照）

## Predictor解決・再利用

- `EvaluationDispatcher`をコンストラクタでDI（RegistryをRunnerが直接参照しない・
  PredictorをRunnerが直接生成しない）
- `dispatcher.resolve(engine_id)`を`run()`開始時に1回だけ呼び、以降は解決済みPredictorを
  全Sampleで再利用する（TrOCRのbuild-once設計を前提に、Sampleごとのresolve/dispatchは行わない）
- **`dispatch()`を毎Sample呼ぶ設計を採用しなかった理由**: (1) `dispatch()`は内部で毎回
  `resolve()`（Registry存在確認・Capability確認・登録済みPredictor辞書lookup）を実行するため、
  Sample数だけ無駄な検証を繰り返すことになる。(2) Unknown/Unsupported/未registerという
  「Run開始前エラー」を、最初のSample処理を待たずRun開始時点で即座に検知したい
  （後述「Run開始前エラー」参照）。(3) ADR-0003が定めるPredictorの「1回build・複数回recognize」
  という設計原則と、明示的なresolve 1回のほうが対応が取りやすい

## Sample成功時

`calculate_sample_metrics()`（Issue #65）を利用し、RunnerでCER/edit distanceを再実装しない。

```text
image / ground_truth / prediction / exact_match / edit_distance / cer / confidence /
duration_ms / error=None
```

## Sample失敗時（Sample単位エラー）

Predictorの`recognize()`が例外を送出しても、Run全体は中断しない。失敗Sampleとして記録し、
残りのSampleの処理を継続する。

```text
prediction=None / exact_match=None / edit_distance=None / cer=None / confidence=None
error=<安全なメッセージ> / duration_msは計測
```

### Run開始前エラー と Sample単位エラーの区別

**Run開始前エラー**（そのまま上位へ伝播、Runは開始しない）:

- `UnknownEvaluationEngineError`
- `UnsupportedEvaluationEngineError`
- `EvaluationDispatcherError`（Predictor未register含む）

上記はすべて`dispatcher.resolve(engine_id)`（`run()`冒頭、Sampleループの外）で発生しうるため、
Runnerは意図的にこの呼び出しを`try`で囲まない。

**Sample単位エラー**（Resultへ記録して継続）:

- `predictor.recognize()`中の例外（全例外クラスを対象。特定の例外型に限定しない）

## Error Message方針

採用: `<ExceptionClassName>`のみ（例: `"RuntimeError"`）。例外メッセージ本文（`str(exc)`）は
**一切含めない**。

理由: Path・Hugging Faceトークン・ローカルユーザー名・内部Stack Traceが例外メッセージ内に
含まれていても、クラス名だけを使うことで情報漏洩の可能性を構造的に排除できる（個別の
Path/トークン/ユーザー名Sanitizerを実装する必要がない）。実Predictor実装Issueで、
より具体的なエラー内容（診断性）が必要と判明した場合に、個別のSanitizerを追加するかどうかを
改めて判断する。

## Timing

- Sample: `duration_ms`（`time.perf_counter()`の差分、`round(x, 3)`）
- Run: `started_at`/`finished_at`（timezone-aware UTC `datetime`を`.isoformat()`でstring化。
  Common Schemaはstring保持のためISO 8601へ変換）・`duration_ms`
- `now`/`perf_counter`をコンストラクタ引数として注入可能にし、テストではFake Clockを使用
  （実時刻・実`perf_counter`に依存しない決定的なテストを実現）

## Metrics集計方針（sample_count）

**採用: 案A相当（`metrics.sample_count = 入力総数`）。**

失敗Sampleも含めた全Sample（成功+失敗）を`calculate_evaluation_metrics()`へそのまま渡す。
Issue #65の実装は、`edit_distance=None`のサンプル（Runnerが構築する真のエラーSample）を
「`sample_count`には含めるが、CERのdist_total/ref_totalからは除外する」設計を**既に持っている**
（`evaluation_metrics.py`のdocstringに明記済み）。この既存の設計をそのまま利用することで、
Runner側で失敗Sampleを特別扱いする再実装をせずに、`metrics.sample_count == 入力総数`を
自然に満たせる。`exact_match`が`None`のサンプルは非一致として扱われる（`exact_match_count`に
加算されない）ため、失敗Sampleは完全一致率の分母には入るが分子には入らない
（既存Tesseract相当の「失敗は不正解扱い」という直感と整合する）。

## sample_count同期

```text
result.sample_count == result.metrics.sample_count
```

上記「Metrics集計方針」の採用（全Sampleをそのまま`calculate_evaluation_metrics()`へ渡す）により、
両者は常に「入力Sample総数」で一致する。失敗Sampleを個別に除外・別集計する必要がないため、
矛盾は生じない。

## Confusion

成功Sampleの`(ground_truth, prediction)`ペアのみを`aggregate_confusions()`（Issue #65）へ渡す。
RunnerでLevenshteinを再実装しない。**top-N制限は今回行わず、全件を`list[OcrEvaluationConfusion]`
として返す。** 既存API（`POST /api/ocr/evaluate`）のtop10相当の制限は、API Integration実装時に
別途適用する方針とする（本Runnerの責務としない）。

## Warnings

Run継続可能な事象のみを対象とし、Sample数だけ重複追加しない（決定的に生成する）。

```text
"evaluation dataset was empty"                              # 入力Sample総数が0件のときのみ
"<N> samples failed during inference"                        # 失敗Sample件数（>0のときのみ）
"confidence was unavailable for <N> samples"                  # 成功SampleでNone件数（>0のときのみ）
```

Empty Datasetの場合は`["evaluation dataset was empty"]`のみを返し、他のwarningは付与しない
（Sampleが1件も処理されていないため）。

## engine_details

Predictorが返す`PredictionResult.engine_details`は、今回**統合しない**（`OcrEvaluationSampleResult`
Schema自体にengine_details相当のフィールドが存在せず、Run全体を代表する単一dictへ集約する妥当な
方法も今回定まらないため）。Resultの`engine_details`は捏造せず、常に空dict`{}`を返す。

## evaluation_id

`str(uuid.uuid4())`で生成する（`src/app/main.py`の既存`job_id`生成規則と同じ方式）。DB登録は
行わない。外部状態へ依存しない一意な文字列。

## Empty Dataset

`samples=[]`を許可する。`calculate_evaluation_metrics([])`の既存仕様（Issue #65）をそのまま利用し、
Runner独自の値を作らない。

```text
sample_count=0 / metrics.sample_count=0 / exact_match_count=0 / exact_match_rate=0.0 /
cer=None / character_accuracy=None / samples=[] / confusions=[] /
warnings=["evaluation dataset was empty"]
```

## Dispatcher engine_id整合性検証（Issue #67 Future Workの再検討）

Issue #67で残した「`register(engine_id, predictor)`と`predictor.engine_id`の一致検証」を、
Runnerが実際にPredictorを利用する最初のIssueとなる本Issueで確認・実装した。

**採用: 案1（`EvaluationDispatcher.register()`へ整合性検証を追加）。**

`evaluation_dispatcher.py::EvaluationDispatcher.register()`へ、正規化済みの`engine_id`引数と
`predictor.engine_id`（同じく正規化して比較）が一致しない場合に`EvaluationDispatcherError`を
送出する検証を追加した（新規例外クラスは追加しない。過剰な例外追加を避けるため既存の
`EvaluationDispatcherError`を再利用）。既存20件のDispatcherテストはすべて無修正のまま成功する
（すべてのMock Predictorが元々`engine_id`と登録キーを一致させていたため）。新規に2件のテスト
（一致成功・不一致でraise）を`tests/test_evaluation_dispatcher.py`へ追加した。

## API未配線・Predictor未実装

`POST /api/ocr/evaluate`への接続、`src/app/main.py`の変更、Engine別Predictor実装
（Tesseract/PaddleOCR/EasyOCR/TrOCR）は本Issueに含まない。実Predictorが存在しないため、
本Runnerのテストは全てMock Predictorを使用する。

## 次のIssue

Engine別Predictor実装（Tesseract Predictor Adapterを最初に着手する想定。Common Evaluation
Metric Calculator（Issue #65）を実際に配線する最初のPredictorとなる）。

## Scope外（本Issueでは行わない）

- Engine別Predictor実装（Tesseract/PaddleOCR/EasyOCR/TrOCR）
- `POST /api/ocr/evaluate`のAPI接続変更
- TrOCR評価実装
- Evaluation UI変更
- Benchmark変更
- Job化
- Schema変更（`src/app/schemas.py`は無変更）
- Issue #8修正

## テスト

`tests/test_evaluation_runner.py`（新規24テスト）。Empty Dataset/Success/Predictor Reuse/
Errors/Metrics/Result/Immutability/Dispatcher整合性の各カテゴリを網羅。Mock PredictorとFake
Clockのみ使用、実OCR処理なし。既存`tests/test_evaluation_dispatcher.py`（22件、うちengine_id
整合性検証2件を今回追加）・`tests/test_evaluation_metrics.py`（46件）・
`tests/test_evaluation_schema.py`（88件）・`tests/test_cer_metrics.py`（7件）は無修正のまま
全件成功を確認済み。
