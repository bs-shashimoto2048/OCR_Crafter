# [Feature] Evaluation Dispatcher

Issue: [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)（Multi-engine Evaluation API Architecture、Completed・Closed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: [#68](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/68)（Squash Merge済み。Squash Commit: `83e4eec`）

**状態**: **Completed**・Closed。

**マージ前レビュー結果**: Blocker 0件・Major 0件・Minor 2件・Suggestion 3件、Conclusion: Approve推奨（レビュー内容に基づき承認・マージ済み）。Minor/SuggestionはProductionコードを変更せず、下記「Future Work」へ記録した。

**前提の訂正（実装開始時点）**: 本Featureの実装開始時点では、Issue #65（Common Evaluation Metric Calculator）/ PR #66 はいずれもOpenのままでありmainへは未反映であった。本Feature（Evaluation Dispatcher）はDependency制約上、Backend Engine Registry・Capability以外（`evaluation_metrics.py`を含む）に一切依存しない設計であるため、PR #66の未マージ状態が本Issueの実装を妨げないことを確認した上で、当時のmain（PR #66を含まない状態）からブランチを作成して着手した。**その後、Issue #65 / PR #66はSquash Merge済み（Merge Commit: `b2de141`）でありCompleted・Closedである。** 本Feature（Evaluation Dispatcher）はmain最新化のためのrebaseを実施済みで、PR #66由来の`evaluation_metrics.py`とは競合しない（Dispatcherは引き続き`evaluation_metrics.py`に依存しない）。

## Dispatcher設計

新規: `src/app/services/evaluation_dispatcher.py`（純粋なDispatch層、クラス1つ）。

公開API:

```python
class EvaluationDispatcher:
    def __init__(self, registry: EngineRegistry | None = None) -> None: ...
    def register(self, engine_id: str, predictor: EnginePredictor) -> None: ...
    def resolve(self, engine_id: str) -> EnginePredictor: ...
    def dispatch(self, engine_id: str, *args, **kwargs) -> Any: ...
```

### resolve()の判定順序

1. Backend Engine Registry（`engine_registry.py::resolve_engine_id()`）に存在するengine_idか → 存在しなければ`UnknownEvaluationEngineError`
2. `capability.supports_evaluation`が`True`か → `False`なら`UnsupportedEvaluationEngineError`
3. 本Dispatcherに`register()`済みのPredictorが存在するか → 無ければ`EvaluationDispatcherError`（Backend Registry上は既知・評価対応だが`register()`をまだ呼んでいない状態。「Registryに存在しないEngine」＝Unknownとは別の状態として区別した）

### register()の設計

Backend Engine Registryへの存在確認は行わない（`resolve()`の責務）。任意のengine_id文字列を受け付ける（テスト用途を含め柔軟にするため）。engine_idは`str(engine_id).strip().lower()`で正規化して保持キーとするため、大小文字違いの重複登録も検出する。

### Custom Engineの扱い

Backend Engine Registry（`create_default_registry()`）には`tesseract`/`paddleocr`/`easyocr`/`trocr`の4エンジンのみが登録されており、`custom`は登録されていない。そのため`dispatcher.resolve("custom")`は`capability.supports_evaluation=False`による`UnsupportedEvaluationEngineError`ではなく、Registry未登録による`UnknownEvaluationEngineError`を送出する。task.mdの「Customは`supports_evaluation=False`扱いで構わない」という記述に対し、実際の送出例外は`Unknown`側になる点を明記する（いずれも評価対象から除外されるという結果は同じであり、機能上の問題はない）。

### Capability利用

Backend `EngineCapability.supports_evaluation`を参照するのは`EvaluationDispatcher.resolve()`のみ。`EnginePredictor`はCapabilityを一切参照・保持しない（Dispatcherが唯一の参照元という要件を満たす）。

現状の実際の値（`engine_capability.py`のBuiltin Capability）: `tesseract`のみ`supports_evaluation=True`、`paddleocr`/`easyocr`/`trocr`は`False`（既存`ocr_evaluation.py`がTesseractのみ実装している事実と一致）。

#### Capability実値（`create_default_registry()`で検証済み）

| Engine    | Registry登録 | supports_evaluation | resolve結果                        |
| --------- | ---------: | ------------------: | -------------------------------- |
| tesseract |        yes |                true | 登録済Predictorを返す                  |
| paddleocr |        yes |               false | UnsupportedEvaluationEngineError |
| easyocr   |        yes |               false | UnsupportedEvaluationEngineError |
| trocr     |        yes |               false | UnsupportedEvaluationEngineError |
| custom    |         no |                該当なし | UnknownEvaluationEngineError     |

#### 責務

- Dispatcher: `register`/`resolve`/`dispatch`
- Predictor: `Protocol`のみ（実装クラスなし）
- Runner: 未実装
- OCR実行: 未実装
- API接続: 未実装

### EnginePredictor Interface

```python
class EnginePredictor(Protocol):
    engine_id: str
    def recognize(self, *args: Any, **kwargs: Any) -> Any: ...
```

`typing.Protocol`による構造的型付け（`docs/design/ENGINE_REGISTRY.md`のHandler設計と同じ方針）。`recognize()`の引数・戻り値の形状は本Issueでは規定しない（`dispatch()`はそのまま転送するのみ）。実装クラスは作成していない（次のPredictor実装Issueの責務）。

### Dependency

`evaluation_dispatcher.py`は`engine_registry.py`（`EngineRegistry`/`create_default_registry`/`resolve_engine_id`）のみをimportする。Tesseract/PaddleOCR/EasyOCR/TrOCR固有コード・`ocr_evaluation.py`・`benchmark.py`・`predict.py`・`job_runner.py`・`model_registry.py`への依存が無いことを、モジュールのソースコードを直接検査するテスト（`test_dispatcher_module_has_no_ocr_engine_dependencies`）で確認している。

## Scope

今回実装したのは`EvaluationDispatcher`（`register`/`resolve`/`dispatch`）と`EnginePredictor` Protocolのみ。OCR実行・Predictor実装・Runner・API・Job・UI・Benchmark・DB・Filesystem・モデル読込・推論処理はいずれも含まない。

## 未実装範囲（Scope外）

- Engine別Predictor実装（Tesseract/PaddleOCR/EasyOCR/TrOCR）
- Evaluation Runner
- `POST /api/ocr/evaluate`のAPI接続変更
- `src/app/main.py`・`src/app/services/ocr_evaluation.py`・`frontend/`の変更
- TrOCR評価実装
- Evaluation UI変更
- Benchmark変更
- Schema変更（`src/app/schemas.py`は無変更）

## 次のIssue

Evaluation Runner（Issue [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)、**Completed**・Closed。PR [#70](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/70)、Merge Commit: `c5bd7eb`）。その次はEngine別Predictor実装（Tesseract Predictor Adapterを含む。Common Evaluation Metric Calculator（Issue #65）を利用する最初のPredictorとなる想定）。

## Future Work（マージ前レビューMinor/Suggestion指摘）

PR #68マージ前レビューで挙がった指摘。いずれもBlocker・Majorではなく、今回のマージは妨げない（Productionコードは今回変更していない）。

- ~~**Minor**: `register(engine_id, predictor)`が、渡された`engine_id`引数と`predictor.engine_id`属性の一致を検証していない（キーと属性が食い違って登録される可能性がある）。~~ **解消済み（Issue [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)「Evaluation Runner」で対応）**: `EvaluationDispatcher.register()`へ整合性検証を追加し、不一致時は`EvaluationDispatcherError`を送出する（既存20件のDispatcherテストは無修正のまま成功、新規2件を追加）。詳細は[EVALUATION_RUNNER_69.md](EVALUATION_RUNNER_69.md)参照。
- **Minor**: `dispatch()`の「Backend Registry上はsupportedだが`register()`未実施」ケース（`EvaluationDispatcherError`を送出しPredictorを呼ばないこと）を直接検証する専用テストが無い（`resolve()`側のみ検証済み）
- **Suggestion**: 「register()未実施」ケースの例外を、汎用`EvaluationDispatcherError`ではなく専用の`PredictorNotRegisteredError`として分離する案
- **Suggestion**: `test_dispatcher_module_has_no_ocr_engine_dependencies`のDependency検査を、単純な部分文字列一致からASTベースのimport解析へ強化する案
- **Suggestion**: `resolve()`/`dispatch()`に`None`・空文字engine_idを渡した場合の挙動を明示的にテストする案

## テスト

`tests/test_evaluation_dispatcher.py`（新規20テスト）。register/resolve/capability/dispatch/exception/Predictor Protocol/Dependencyの各カテゴリを網羅。Mock Predictorのみ使用、実OCR処理なし。既存`tests/test_evaluation_metrics.py`（46件）・`tests/test_cer_metrics.py`（7件）・`src/app/schemas.py`関連テストは無修正のまま全件成功を確認済み。
