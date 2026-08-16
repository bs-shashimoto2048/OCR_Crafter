"""Common Evaluation Runner（Multi-engine Evaluation API, Issue #69）。

Design #61（docs/design/MULTI_ENGINE_EVALUATION_API.md）・ADR-0003で確定したArchitecture
（共通Evaluation Runner + Engine別Predictor）のうち、`EvaluationDispatcher`（Issue #67）・
`EnginePredictor`・Common Evaluation Metric Calculator（Issue #65）・Common Evaluation
Schema（Issue #63）を接続する共通Evaluation Loopのみを実装する。

Runnerが担当するもの: Predictorを1回だけ解決・Dataset全Sampleの順次処理・Predictor呼び出し・
Predictor戻り値契約（`PredictionResult`）の検証・Sample Result生成・エラーSample生成・
Metrics/Confusion集計・timing・warnings・Result組み立て・`sample_count`同期。

Sample Failure Boundary: 1Sampleあたりの`try`/`except`は、`recognize()`の呼び出しだけでなく、
戻り値の契約検証・値の取得・`calculate_sample_metrics()`の呼び出しまでを一体として保護する。
Predictorが契約に反する値を返した場合や、Schema Validationが失敗した場合も、そのSample1件の
失敗として隔離し、Run全体を中断しない（Unknown/Unsupported Engine・Predictor未register等の
「Run開始前エラー」は区別してそのまま上位へ伝播させる）。

Runnerが担当しないもの（Predictor実装・Runner外の責務）: Engine固有モデルload・Engine固有前処理・
Datasetディレクトリ探索・GT CSV読込・API Request解析・HTTP Error変換・DB保存・履歴保存・
Job管理・Benchmark・UI。実Predictor実装・API接続・Job化は本Issueでは一切行わない。

`PredictionResult`はIssue #73で`.evaluation_types`モジュールへ切り出した（全PredictorがRunner
モジュールへ依存する構造を是正するため）。本モジュールは既存importとの後方互換のため
`PredictionResult`を引き続き再エクスポートする（`from .evaluation_runner import PredictionResult`
は今後も動作する）。
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
from .evaluation_types import PredictionResult  # noqa: F401 - 既存importとの後方互換のため再エクスポートする

__all__ = ["EvaluationInputSample", "EvaluationRunner", "PredictionResult"]


@dataclass(frozen=True)
class EvaluationInputSample:
    """Runnerへの最小入力単位。Path存在確認は行わない（画像読込はPredictor側の責務）。"""

    image: str
    ground_truth: str


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
            # Sample Failure Boundary: recognize()の呼び出しだけでなく、戻り値の契約検証
            # （PredictionResultであること）・値の取得・calculate_sample_metrics()（型検証・
            # Schema検証を含む）まで、このSampleの処理全体を1つのtryで保護する。1 Sampleの
            # 異常（Predictorの契約違反・不正な戻り値・Schema Validation失敗等）が後続Sampleの
            # 処理やRun全体を中断しないようにするため（Issue #69レビューMajor #1の是正）。
            try:
                prediction = predictor.recognize(sample.image, **args)
                # Predictorの戻り値契約を明示的に検証する。PredictionResult以外（生文字列・
                # None・dict・tuple等）は暗黙変換せず、Sample failureとして扱う
                # （raw stringをPredictionResult(text=...)へ勝手に補完しない）。
                if not isinstance(prediction, PredictionResult):
                    raise TypeError(
                        f"predictor.recognize() did not return a PredictionResult "
                        f"(got {type(prediction).__name__})"
                    )
                duration_ms = _elapsed_ms(sample_start_counter, self._perf_counter())
                sample_result = calculate_sample_metrics(
                    image=sample.image,
                    ground_truth=sample.ground_truth,
                    prediction=prediction.text,
                    confidence=prediction.confidence,
                    duration_ms=duration_ms,
                )
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

            # ここに到達するのは成功Sampleのみ（confidence欠損カウント・Confusion集計対象は
            # 成功Sampleに限定する）。
            if sample_result.confidence is None:
                missing_confidence_count += 1
            sample_results.append(sample_result)
            # Confusionは成功Sampleからのみ集計する（失敗Sampleはprediction自体が存在しないため対象外）。
            confusion_pairs.append((sample.ground_truth, sample_result.prediction))

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
    """`perf_counter`の差分をmsへ変換する。

    負のdurationを`max(0, ...)`等で握りつぶすことは意図的に行わない。本番環境の
    `time.perf_counter()`はmonotonicであり逆行しないため、負の差分は原理上発生しない。
    テストで注入したclockが逆行した場合、この関数自体は単に負の値を返す（推測で補正しない）。
    その負の値は`OcrEvaluationSampleResult.duration_ms`（`ge=0.0`）のSchema Validationで
    拒否され、Sample Failure Boundary（`EvaluationRunner.run()`のtry/except）内で発生した
    他の例外と同様にSample failureへ変換される。clock injectionはテスト決定性のためだけの
    仕組みであり、Predictor/Sample処理の失敗と区別する専用の「Runner infrastructure error」
    経路は今回追加しない（本番のmonotonic clockでは到達しない状態を区別する複雑さを
    正当化できないため）。
    """
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
