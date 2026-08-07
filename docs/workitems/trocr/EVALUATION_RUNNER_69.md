# [Feature] Evaluation Runner

Issue: [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61) / Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)（Common Evaluation Schema、Completed） / Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)（Common Evaluation Metric Calculator、Completed） / Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)（Evaluation Dispatcher、Completed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: [#70](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/70)（Squash Merge済み。Squash Commit: `c5bd7eb`）

**状態**: **Completed**・Closed。

**マージ前レビュー結果（初回）**: Blocker 0件・Major 1件・Minor 2件・Suggestion 3件、Conclusion: Changes Requested。Major #1（Sample単位の`try`/`except`が`predictor.recognize()`の呼び出し自体にしか及んでおらず、戻り値の契約違反や`calculate_sample_metrics()`のSchema Validation失敗でRun全体が中断していた問題）を是正（`fix: isolate evaluation sample failures (#69)`）。

**マージ前レビュー結果（修正後・再レビュー）**: Blocker 0件・Major 0件・Minor 2件・Suggestion 0件、Conclusion: Approve推奨。Major #1の解消を確認。残るMinor 2件は本節末尾「Future Work」へ記録し、Productionコードの追加修正は行っていない。

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

## Sample失敗時（Sample単位エラー・Sample Failure Boundary）

**マージ前レビューMajor #1の是正（本節を更新）**: 当初実装では`try`/`except`が
`predictor.recognize()`の呼び出しのみを保護しており、その戻り値を処理する後続コード
（`PredictionResult`かどうかの検証・`.text`/`.confidence`の取得・`calculate_sample_metrics()`
の呼び出し）は保護対象外だった。そのため、Predictorが`PredictionResult`以外（生文字列・
`None`・`dict`等）を返した場合や、`calculate_sample_metrics()`自体がSchema Validationで
失敗した場合（不正な型・非有限値・負のduration等）に、そのSampleの処理どころか**Run全体が
例外で中断し、それまでの全Sampleの結果が失われる**という問題があった。

**Sample Failure Boundary**を、以下の一連の処理全体を1つの`try`で囲む形へ拡張した。

```text
1. predictor.recognize()の呼び出し
2. 戻り値がPredictionResultであることの検証（isinstance）
3. PredictionResultからのtext/confidence取得
4. calculate_sample_metrics()の呼び出し（Schema Validationを含む）
```

この範囲内で発生したいかなる`Exception`も、そのSample1件のみの失敗として隔離し、Run全体は
中断せず後続Sampleの処理を継続する。

```text
prediction=None / exact_match=None / edit_distance=None / cer=None / confidence=None
error=<安全なメッセージ> / duration_msは計測
```

### Predictor戻り値契約の検証

`recognize()`の戻り値が`PredictionResult`のインスタンスであることを`isinstance()`で明示的に
検証する。**暗黙変換は一切行わない**（生文字列を`PredictionResult(text=...)`へ自動的に
包み直す、`dict`から`text`/`confidence`キーを探して復元する、等は行わない）。契約に反する
戻り値（生文字列・`None`・`dict`・`tuple`・任意のオブジェクト）は`TypeError`を送出し、
Sample Failure Boundaryの範囲内であるため即座にSample failureへ変換される。

### Run開始前エラー と Sample単位エラーの区別

**Run開始前エラー**（そのまま上位へ伝播、Runは開始しない）:

- `UnknownEvaluationEngineError`
- `UnsupportedEvaluationEngineError`
- `EvaluationDispatcherError`（Predictor未register含む）

上記はすべて`dispatcher.resolve(engine_id)`（`run()`冒頭、Sampleループの外）で発生しうるため、
Runnerは意図的にこの呼び出しを`try`で囲まない。

**Sample単位エラー**（Resultへ記録して継続。`Exception`のみを捕捉し`BaseException`
＝`KeyboardInterrupt`/`SystemExit`等は握りつぶさずそのまま伝播する）:

- `predictor.recognize()`中の例外
- 戻り値が`PredictionResult`ではない場合の契約違反（`TypeError`）
- `calculate_sample_metrics()`中の例外（型不正・Schema Validation失敗を含む）

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

### Clock injectionとSample Failure Boundaryの関係（マージ前レビュー対応）

`time.perf_counter()`は本番環境ではmonotonic（単調増加）であり、逆行することは原理上ない。
負のdurationを`max(0, ...)`等で握りつぶす実装は**意図的に追加していない**（推測でタイミング値を
補正しない）。

テストで注入したclockが逆行し、結果として負の`duration_ms`が計算された場合、その値は
`OcrEvaluationSampleResult.duration_ms`（`ge=0.0`）のSchema Validationで拒否される。この
`ValidationError`はSample Failure Boundaryの範囲内で発生するため、他の契約違反・型不正と
同様にSample failureへ変換される。clock injectionはテスト決定性のためだけの仕組みであり、
本番のmonotonic clockでは到達し得ない状態を区別する専用の「Runner infrastructure error」
経路は、複雑さを正当化できないため今回は追加していない。

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

**`dispatcher.resolve(engine_id)`はSample総数に関わらず必ず1回実行される**（前述「Predictor解決・
再利用」参照）。そのため`samples=[]`であっても、Unknown Engine・Unsupported Engine・Predictor
未registerであればEmpty Datasetでも失敗する（`recognize()`は0回のまま、上記のRun開始前エラーが
そのまま伝播する）。「Empty DatasetならPredictor不要」という代替案と比較した結果、resolve()を
先に行う判断を維持した。理由: (1) resolve()自体は軽量な処理（Registry存在確認・Capability確認・
登録済みPredictor辞書lookup）であり、Empty Datasetであっても実行コストは無視できる。(2) Unknown
Engine・Unsupported Engine・未register設定ミスを、Dataset内容に関わらず即座に検知できる方が、
Datasetが空のときだけ設定ミスが見逃されるより一貫性がある。

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

`tests/test_evaluation_runner.py`（34テスト。初回実装時24件 + マージ前レビューMajor #1是正で
10件追加）。Empty Dataset/Success/Predictor Reuse/Errors/Predictor contract violation/
Post-recognize failure/All malformed predictions/BaseException/Metrics/Confusion/Result/
Immutability/Dispatcher整合性の各カテゴリを網羅。Mock PredictorとFake Clockのみ使用、実OCR
処理なし。既存`tests/test_evaluation_dispatcher.py`（22件、うちengine_id整合性検証2件を
Issue #69初回実装時に追加）・`tests/test_evaluation_metrics.py`（46件）・
`tests/test_evaluation_schema.py`（88件）・`tests/test_cer_metrics.py`（7件）は無修正のまま
全件成功を確認済み。

### マージ前レビューMajor #1是正（Sample Failure Boundaryの拡張）

PR #70のマージ前レビューで指摘されたMajor #1（`predictor.recognize()`の呼び出し自体しか
`try`/`except`で保護されておらず、戻り値の後続処理で発生した例外がRun全体を中断していた）を
是正した。修正対象は`src/app/services/evaluation_runner.py`のみ（`EvaluationDispatcher`
Productionコードは今回変更しない）。詳細は上記「Sample失敗時（Sample単位エラー・Sample
Failure Boundary）」参照。追加した10件のテストで、Predictor契約違反（生文字列/`None`/dict）・
`calculate_sample_metrics()`起因のpost-recognize failure・全Sample契約違反・
`KeyboardInterrupt`/`SystemExit`の非捕捉を検証した。修正後の再レビューでMajor #1の解消を確認
（Blocker 0件・Major 0件・Minor 2件・Suggestion 0件、Approve推奨）。

## Future Work（マージ前レビューMinor指摘・既存Future Work）

いずれもBlocker・Majorではなく、今回のマージは妨げない。

### Minor 1（修正後レビューで新規発見）

Injected clockが同一Sample内で連続して逆行した場合、`except`ハンドラ内で失敗Sample用に
計算する`duration_ms`自体も負値となり、`OcrEvaluationSampleResult`構築時のSchema Validation
Errorが（`except`ハンドラ自身の処理であるため）どの`try`にも保護されずRun全体へ伝播する
可能性がある。

ただし:

- Productionの`time.perf_counter()`はmonotonicであり、この状態は原理上到達不能
- コミット済み`FakeClock`テストヘルパーも単調増加のみで、どのテストもこの経路を踏まない
- 現時点では修正不要

Tesseract Predictor Adapterまたは実クロックでの実運用接続時に、実害がないことを再確認する。

### Minor 2（修正後レビューで新規発見）

malformed Predictor resultの永続テスト（`tests/test_evaluation_runner.py`）は現在、以下を
parametrizeでカバーしている。

- raw string
- None
- dict

`tuple`（`(text, confidence)`形式。既存Tesseract評価の慣習に近い形）については、マージ前
レビュー時に手動実測（`isinstance(prediction, PredictionResult)`により正しくSample failureへ
変換されることを確認済み）したが、専用の永続テストは追加していない。Future Workとして
追加候補を記録する。

### 既存Future Work（Issue #67から継続）

- `EnginePredictor` Protocolの戻り値`Any`を`PredictionResult`へ具体化する検討
  （Tesseract Predictor Adapter着手前に再検討する）
- `PredictionResult.engine_details`の`OcrEvaluationResult.engine_details`への統合方針
  （複数Sampleの`engine_details`をどう集約するかが未確定なため、今回は常に空dictを返す）
- `EvaluationDispatcher.register()`が`predictor.engine_id`属性が完全に欠損している場合に
  意図した`EvaluationDispatcherError`ではなく素の`AttributeError`を送出する問題
  （今回は`evaluation_dispatcher.py`を変更しないため未対応のまま。Dispatcher側のFuture Work
  として継続）
