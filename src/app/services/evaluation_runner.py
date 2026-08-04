"""Common Evaluation Runner（Multi-engine Evaluation API, Issue #69）。

Design #61（docs/design/MULTI_ENGINE_EVALUATION_API.md）・ADR-0003で確定したArchitecture
（共通Evaluation Runner + Engine別Predictor）のうち、`EvaluationDispatcher`（Issue #67）・
`EnginePredictor`・Common Evaluation Metric Calculator（Issue #65）・Common Evaluation
Schema（Issue #63）を接続する共通Evaluation Loopのみを実装する。

Runnerが担当するもの: Predictorを1回だけ解決・Dataset全Sampleの順次処理・Predictor呼び出し・
Sample Result生成・エラーSample生成・Metrics/Confusion集計・timing・warnings・Result組み立て・
`sample_count`同期。

Runnerが担当しないもの（Predictor実装・Runner外の責務）: Engine固有モデルload・Engine固有前処理・
Datasetディレクトリ探索・GT CSV読込・API Request解析・HTTP Error変換・DB保存・履歴保存・
Job管理・Benchmark・UI。実Predictor実装・API接続・Job化は本Issueでは一切行わない。
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional, Sequence

from ..schemas import OcrEvaluationResult, OcrEvaluationSampleResult
from .evaluation_dispatcher import EvaluationDispatcher
from .evaluation_metrics import aggregate_confusions, calculate_evaluation_metrics, calculate_sample_metrics


@dataclass(frozen=True)
class EvaluationInputSample:
    """Runnerへの最小入力単位。Path存在確認は行わない（画像読込はPredictor側の責務）。"""

    image: str
    ground_truth: str


@dataclass(frozen=True)
class PredictionResult:
    """Predictor（`EnginePredictor.recognize()`）がRunnerへ返すことを期待する最小出力契約。

    `evaluation_dispatcher.py`の`EnginePredictor` Protocol自体は本Issueで変更しない
    （`recognize(*args, **kwargs) -> Any`のまま。実Predictorがまだ存在しないため型を
    強制する必要が薄く、Scope上もDispatcher変更はengine_id整合性検証のみに限定する）。
    本Runnerは、Predictorの戻り値がこの`PredictionResult`であることを前提として扱う
    （将来のPredictor実装Issueが従うべき契約として、ここで明確化する）。
    """

    text: str
    confidence: Optional[float] = None
    engine_details: Optional[Mapping[str, Any]] = None


def _sanitize_error(exc: BaseException) -> str:
    """Sample単位推論エラーの安全なエラーメッセージを生成する。

    採用方針: 例外クラス名のみを保持し、例外メッセージ本文（`str(exc)`）は一切含めない。
    Path・Hugging Faceトークン・ローカルユーザー名・内部Stack Traceが例外メッセージに
    含まれていても、クラス名だけを使うことで情報漏洩の可能性を構造的に排除できる。
    実Predictor実装Issueで具体的なエラー内容の必要性が判明した場合に、個別のSanitizer
    （Path/トークン/ユーザー名の除去）を追加するかどうかを再検討する。
    """
    return type(exc).__name__


def _default_now() -> datetime:
    return datetime.now(timezone.utc)


class EvaluationRunner:
    """`EvaluationDispatcher`で解決した`EnginePredictor`を使い、複数Sampleを評価する共通Loop。"""

    def __init__(
        self,
        dispatcher: EvaluationDispatcher,
        *,
        now: Optional[Callable[[], datetime]] = None,
        perf_counter: Optional[Callable[[], float]] = None,
    ) -> None:
        # RegistryをRunnerが直接参照しない・PredictorをRunnerが直接生成しない設計のため、
        # DispatcherをコンストラクタでDIし、resolve()経由でのみPredictorを得る。
        self._dispatcher = dispatcher
        # テストでのclock注入を可能にする（未指定時は実時刻・実perf_counterを使用）。
        self._now = now or _default_now
        self._perf_counter = perf_counter or time.perf_counter

    def run(
        self,
        *,
        engine_id: str,
        samples: Sequence[EvaluationInputSample],
        model_ref: Optional[str] = None,
        dataset_id: Optional[str] = None,
        predictor_args: Optional[Mapping[str, Any]] = None,
    ) -> OcrEvaluationResult:
        # predictor_argsは呼び出し側のMappingを変更しないよう、ここで独立したdictへコピーする。
        args = dict(predictor_args) if predictor_args else {}

        # Predictorはrun開始時に1回だけresolve()する（TrOCR等のbuild-once設計を前提に、
        # 全Sampleで同一Predictorインスタンスを再利用する）。Unknown/Unsupported Engine・
        # 未register等の「Run開始前エラー」はここでそのまま上位へ伝播させる
        # （Sample単位のrecognize()例外とは区別し、tryで囲まない）。
        predictor = self._dispatcher.resolve(engine_id)

        run_started_at = self._now()
        run_start_counter = self._perf_counter()

        sample_results: list[OcrEvaluationSampleResult] = []
        confusion_pairs: list[tuple[str, str]] = []
        failed_count = 0
        missing_confidence_count = 0

        for sample in samples:
            sample_start_counter = self._perf_counter()
            try:
                prediction = predictor.recognize(sample.image, **args)
            except Exception as exc:  # noqa: BLE001 - Sample単位エラーとして意図的に全例外を捕捉する
                duration_ms = _elapsed_ms(sample_start_counter, self._perf_counter())
                sample_results.append(
                    OcrEvaluationSampleResult(
                        image=sample.image,
                        ground_truth=sample.ground_truth,
                        prediction=None,
                        exact_match=None,
                        edit_distance=None,
                        cer=None,
                        confidence=None,
                        error=_sanitize_error(exc),
                        duration_ms=duration_ms,
                    )
                )
                failed_count += 1
                continue

            duration_ms = _elapsed_ms(sample_start_counter, self._perf_counter())
            if prediction.confidence is None:
                missing_confidence_count += 1
            sample_results.append(
                calculate_sample_metrics(
                    image=sample.image,
                    ground_truth=sample.ground_truth,
                    prediction=prediction.text,
                    confidence=prediction.confidence,
                    duration_ms=duration_ms,
                )
            )
            # Confusionは成功Sampleからのみ集計する（失敗Sampleはprediction自体が存在しないため対象外）。
            confusion_pairs.append((sample.ground_truth, prediction.text))

        # metrics.sample_countをCanonicalとする方針（Issue #65）に合わせ、result.sample_countと
        # 常に一致させる。失敗Sampleも含めた全件を渡すことで両者を自然に一致させる
        # （calculate_evaluation_metrics()はedit_distance=Noneのサンプルをsample_countには含めつつ
        # CERのdist_total/ref_totalからは除外する設計であり、この既存挙動をそのまま利用する）。
        metrics = calculate_evaluation_metrics(sample_results)
        confusions = aggregate_confusions(confusion_pairs)

        run_finished_at = self._now()
        run_duration_ms = _elapsed_ms(run_start_counter, self._perf_counter())

        warnings = _build_warnings(
            total=len(samples),
            failed_count=failed_count,
            missing_confidence_count=missing_confidence_count,
        )

        return OcrEvaluationResult(
            evaluation_id=str(uuid.uuid4()),
            engine_id=engine_id,
            model_ref=model_ref,
            dataset_id=dataset_id,
            started_at=run_started_at.isoformat(),
            finished_at=run_finished_at.isoformat(),
            duration_ms=run_duration_ms,
            sample_count=len(samples),
            metrics=metrics,
            samples=sample_results,
            confusions=confusions,
            warnings=warnings,
            # Predictorが返すengine_detailsは今回統合しない（捏造しないという方針を優先し、
            # 単一のRun全体を代表する値へ集約する妥当な方法が今回定まらないため空dictのまま返す）。
            engine_details={},
        )


def _elapsed_ms(start_counter: float, end_counter: float) -> float:
    return round((end_counter - start_counter) * 1000, 3)


def _build_warnings(*, total: int, failed_count: int, missing_confidence_count: int) -> list[str]:
    if total == 0:
        return ["evaluation dataset was empty"]
    warnings: list[str] = []
    if failed_count > 0:
        warnings.append(f"{failed_count} samples failed during inference")
    if missing_confidence_count > 0:
        warnings.append(f"confidence was unavailable for {missing_confidence_count} samples")
    return warnings
