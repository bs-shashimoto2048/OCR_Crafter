"""Evaluation Dispatcher（Multi-engine Evaluation API, Issue #67）。

Design #61（docs/design/MULTI_ENGINE_EVALUATION_API.md）・ADR-0003で確定したArchitecture
（共通Evaluation Runner + Engine別Predictor）のうち、`engine_id → Engine Predictor`への
橋渡し（Dispatch）のみを実装する。本モジュールの責務は次の3つに限定される。

- Engine別Predictorの登録（`register`）
- engine_idからPredictorを解決する（`resolve`）。Backend Engine Registry
  （`engine_registry.py`）・Engine Capability（`engine_capability.py`）の
  `supports_evaluation`を参照するのは本Dispatcherのみであり、Predictor側からは参照しない
- `resolve()`で得たPredictorの`recognize()`を呼ぶだけの橋渡し（`dispatch`）

以下は一切行わない（Predictor実装・Runner・API・Job・UI・Benchmark・DBの責務）:
OCR実行・model load・推論処理・画像読込・Dataset探索・API処理・結果保存・履歴保存・
Job管理・Benchmark Variant判定。

依存先はBackend Engine Registry（`engine_registry.py`）・Engine Capability
（`engine_capability.py`）・Evaluation共通型（`evaluation_types.py`）のみ。
Tesseract/PaddleOCR/EasyOCR/TrOCR固有コード、`ocr_evaluation.py`、Runner、Benchmarkへは
一切依存しない（`evaluation_types.py`はRunner・Dispatcher・各Predictorのいずれからも参照
できる独立した葉モジュールであり、Runnerモジュール自体への依存ではない。Issue #73で
`EnginePredictor.recognize()`の戻り値型を`Any`から`PredictionResult`へ具体化した際に追加）。
"""

from __future__ import annotations

from typing import Any, Optional, Protocol

from .engine_registry import EngineRegistry, create_default_registry, resolve_engine_id
from .evaluation_types import PredictionResult


class EvaluationDispatcherError(Exception):
    """Evaluation Dispatcher関連の基底例外。"""


class UnknownEvaluationEngineError(EvaluationDispatcherError):
    """Backend Engine Registryに存在しないengine_id。"""


class UnsupportedEvaluationEngineError(EvaluationDispatcherError):
    """Backend Engine Registryには存在するが、`capability.supports_evaluation=False`のengine_id。"""


class EnginePredictor(Protocol):
    """Engine別評価Predictorの最小Interface。

    `dispatch()`は`recognize()`の引数の形状を一切関知せず、そのまま橋渡しするだけである
    （OCR処理・画像読込・モデルloadはPredictor実装側の責務）。戻り値型は`PredictionResult`
    （`evaluation_types.py`）へIssue #73で具体化したが、これは静的な型注釈にすぎず、
    実行時の型強制ではない（`Protocol`は`@runtime_checkable`ではないため`isinstance()`に
    よる検証はできない。実行時の契約検証はRunner側の`isinstance(prediction, PredictionResult)`
    チェック＝Sample Failure Boundaryが担う）。Capability（`supports_evaluation`等）は
    Dispatcher側でのみ参照し、Predictor自身は参照・保持しない。
    """

    engine_id: str

    def recognize(self, *args: Any, **kwargs: Any) -> PredictionResult: ...


class EvaluationDispatcher:
    """`engine_id → Engine Predictor`への橋渡しのみを行う。

    Backend Engine Registry・Engine CapabilityのみへDependencyを持つ（Tesseract/PaddleOCR/
    EasyOCR/TrOCR固有コード、`ocr_evaluation.py`、Runner、Benchmarkには一切依存しない）。
    """

    def __init__(self, registry: Optional[EngineRegistry] = None) -> None:
        # registry省略時はBackendの既定4エンジン（tesseract/paddleocr/easyocr/trocr）を
        # 登録済みのRegistryを都度生成する（engine_registry.pyの設計方針＝モジュールレベルの
        # 共有グローバルRegistryを持たない、に合わせる）。テストでは差し替え可能。
        self._registry = registry if registry is not None else create_default_registry()
        self._predictors: dict[str, EnginePredictor] = {}

    @staticmethod
    def _normalize_key(engine_id: Any) -> str:
        return str(engine_id).strip().lower()

    def register(self, engine_id: str, predictor: EnginePredictor) -> None:
        """engine_idに対してPredictorを登録する（重複登録・engine_id不一致は拒否）。

        Backend Engine Registryへの存在確認・Capability確認はここでは行わない
        （`resolve()`の責務）。register()自体はBackend Registryの内容に関わらず
        任意のengine_id文字列を受け付ける（テスト用途を含め柔軟にするため）。

        Issue #69（Evaluation Runner）でPredictorを実利用する最初のIssueとなったことを
        受け、engine_id引数と`predictor.engine_id`の一致検証を追加した（Issue #67時点の
        Future Work）。誤ったキーで登録されたPredictorがdispatch経路で気付かれないまま
        使われることを防ぐ。
        """
        key = self._normalize_key(engine_id)
        if key in self._predictors:
            raise EvaluationDispatcherError(f"predictor already registered for engine: {key!r}")
        if self._normalize_key(predictor.engine_id) != key:
            raise EvaluationDispatcherError(
                f"predictor.engine_id ({predictor.engine_id!r}) does not match "
                f"the registration key ({key!r})"
            )
        self._predictors[key] = predictor

    def resolve(self, engine_id: str) -> EnginePredictor:
        """engine_idからPredictorを解決する。

        判定順序:

        1. Backend Engine Registryに存在するengine_idか（`resolve_engine_id()`）
           → 存在しなければ `UnknownEvaluationEngineError`
        2. `capability.supports_evaluation`が`True`か
           → `False`なら `UnsupportedEvaluationEngineError`
        3. 本Dispatcherへ登録済みのPredictorが存在するか
           → 無ければ `EvaluationDispatcherError`
              （Backend Registry上は既知・評価対応でも、`register()`をまだ呼んでいない状態。
              「Registryに存在しないEngine」＝Unknownとは別の状態のため区別する）
        """
        normalized = resolve_engine_id(engine_id, registry=self._registry)
        if normalized is None:
            raise UnknownEvaluationEngineError(f"unknown evaluation engine: {engine_id!r}")

        descriptor = self._registry.get(normalized)
        if not descriptor.capability.supports_evaluation:
            raise UnsupportedEvaluationEngineError(f"engine does not support evaluation: {normalized!r}")

        try:
            return self._predictors[normalized]
        except KeyError:
            raise EvaluationDispatcherError(
                f"no predictor registered for engine: {normalized!r}（register()を先に呼ぶ必要がある）"
            ) from None

    def dispatch(self, engine_id: str, *args: Any, **kwargs: Any) -> Any:
        """`resolve()`で得たPredictorの`recognize()`を呼ぶだけ（OCR処理はここでは行わない）。

        `predictor input`（*args/**kwargs）の形状には一切関知せず、そのまま`recognize()`へ
        転送する。
        """
        predictor = self.resolve(engine_id)
        return predictor.recognize(*args, **kwargs)
