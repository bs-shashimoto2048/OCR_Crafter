"""Engine非依存の共通評価指標計算（Multi-engine Evaluation API, Issue #65）。

Design #61（docs/design/MULTI_ENGINE_EVALUATION_API.md）・ADR-0003で確定したArchitecture
（共通Evaluation Runner + Engine別Predictor）のうち、Runnerが内部で使うMetric Calculatorのみを
実装する。本モジュールはEngineを知らない。次を一切行わない: Engine ID判定・モデルload・画像読込・
推論・Dataset探索・API処理・結果保存・履歴保存（Runner/Predictor/Dispatcher/APIは別Issueの責務）。

既存 `src/app/services/ocr_evaluation.py` の `_normalize_compare`/`levenshtein_ops` と
アルゴリズム上完全に同一の実装を提供するが、意図的に「移設」ではなく本モジュール独自の実装として
用意した。理由: `ocr_evaluation.py::_normalize_compare` はU+FFFD検出時に
`logging.getLogger("src.app.services.ocr_evaluation")` へ警告を出力しており、既存テスト
（`tests/test_cer_metrics.py::test_normalize_compare_logs_replacement_char`）はこのlogger名を
`caplog.at_level(..., logger="src.app.services.ocr_evaluation")` で明示的に指定している。
仮に実装を本モジュールへ移設し`ocr_evaluation.py`側をimportへ置き換えると、警告の出力元logger名が
`src.app.services.evaluation_metrics`へ変わり、上記テストが壊れる。この副作用のない独立実装とし、
既存実装との出力一致は`tests/test_evaluation_metrics.py`のCompatibilityテストで直接検証する。
`ocr_evaluation.py`・`benchmark.py`は本Issueで一切変更しない（Tesseract Predictor Adapter Issueで
配線するかどうかを改めて判断する）。
"""

import logging
import unicodedata
from collections import Counter
from typing import Optional

from ..schemas import OcrEvaluationConfusion, OcrEvaluationMetrics, OcrEvaluationSampleResult

logger = logging.getLogger(__name__)


def normalize_compare(text: str) -> str:
    """比較用にテキストを正規化する（trim + Unicode NFCのみ。大小文字・全角半角は変換しない）。

    既存 `ocr_evaluation.py::_normalize_compare` と同一仕様。大文字(A-Z)と小文字筆記体(k/l/t)の
    読み分けを測るため大小変換は行わない。NFKCは半角/全角・記号を同一視して文字の意味を変えるため
    使用しない（大小文字・半角/全角・0とO・1とI・異体字・記号の種類も同一視しない）。
    """
    normalized = unicodedata.normalize("NFC", str(text or "")).strip()
    if "�" in normalized:
        # U+FFFD（Unicode置換文字）は上流のデコード時点で元の文字が失われており復元できない。
        # 集計・表示はそのままU+FFFDとして扱い、原因調査用にログへ残す
        logger.warning("評価文字列にU+FFFD（Unicode置換文字）が含まれています。元の文字は復元できません: %r", normalized)
    return normalized


def levenshtein_ops(expected: str, predicted: str) -> tuple[int, list[tuple[str, str, str]]]:
    """Levenshtein編集距離とアラインメント操作を返す（既存 `ocr_evaluation.py::levenshtein_ops` と同一実装）。

    戻り値: (編集距離, 操作リスト)。操作は
    ("sub", 正解文字, 予測文字) = 置換 / ("del", 正解文字, "") = 脱落 / ("ins", "", 予測文字) = 挿入。
    DP+バックトレースの純Python実装（評価文字列は短いため追加依存なしで十分高速。新規依存関係なし）。
    """
    a = str(expected or "")
    b = str(predicted or "")
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    ops: list[tuple[str, str, str]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + (0 if a[i - 1] == b[j - 1] else 1):
            if a[i - 1] != b[j - 1]:
                ops.append(("sub", a[i - 1], b[j - 1]))
            i -= 1
            j -= 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            ops.append(("del", a[i - 1], ""))
            i -= 1
        else:
            ops.append(("ins", "", b[j - 1]))
            j -= 1
    ops.reverse()
    return dp[n][m], ops


def calculate_sample_metrics(
    image: str,
    ground_truth: str,
    prediction: str,
    *,
    confidence: Optional[float] = None,
    duration_ms: Optional[float] = None,
    error: Optional[str] = None,
) -> OcrEvaluationSampleResult:
    """1件のground_truth/predictionから exact_match / edit_distance / cer を計算する。

    image・confidence・duration_ms・errorはCalculatorが持たない情報のため、呼び出し側
    （Runner）が既知の値を引数で渡す（未指定=None）。推論例外等の真のエラーSampleを表現する場合
    （prediction自体が得られない場合）は、本関数を呼ばずRunnerが直接
    `OcrEvaluationSampleResult(prediction=None, error=...)`を構築すること
    （既存評価は推論結果を常に文字列として得ており、空文字列は通常のpredictionとして計算される
    ＝エラー状態ではない。本関数はこの既存挙動に合わせ、predictionを常に文字列として要求する）。
    """
    if not isinstance(ground_truth, str):
        raise TypeError(f"ground_truthは文字列である必要があります: {type(ground_truth)!r}")
    if not isinstance(prediction, str):
        raise TypeError(f"predictionは文字列である必要があります: {type(prediction)!r}")

    expected_cmp = normalize_compare(ground_truth)
    pred_cmp = normalize_compare(prediction)
    # 既存実装と同じ完全一致判定: 空文字列predictionは常に不一致（空正解との偶然一致を防ぐ）
    exact_match = bool(prediction.strip()) and pred_cmp == expected_cmp
    distance, _ops = levenshtein_ops(expected_cmp, pred_cmp)
    ref_len = len(expected_cmp)
    # CER: 正解文字数が0の場合は既存仕様どおりNoneとする（0除算を行わない。分母0を勝手に決めない）
    cer = round(distance / ref_len, 4) if ref_len > 0 else None

    return OcrEvaluationSampleResult(
        image=image,
        ground_truth=ground_truth,
        prediction=prediction,
        exact_match=exact_match,
        edit_distance=distance,
        cer=cer,
        confidence=confidence,
        error=error,
        duration_ms=duration_ms,
    )


def calculate_evaluation_metrics(samples: list[OcrEvaluationSampleResult]) -> OcrEvaluationMetrics:
    """複数サンプルからAggregate指標を計算する。

    CERは既存仕様どおり**マイクロ平均**（全edit_distance合計 ÷ 全ground_truth文字数合計）であり、
    サンプルごとのCER平均ではない。character_accuracy = 1 - cer（cer>1のとき負値を許容、0へ
    clampしない）。0件Datasetでは既存仕様に合わせ exact_match_rate=0.0・cer=None
    （sample_count=0時のaccuracyフォールバックが既存実装で0.0であるため。cerはref_total=0のため
    Noneのまま。両者が異なる既定値になる非対称は既存仕様どおりであり意図的に維持する）。

    `edit_distance`が`None`のサンプル（Runnerが構築した真のエラーSample）は、`sample_count`には
    含めるが、CERのdist_total/ref_total双方から除外する（不完全な値を集計に混入させない）。
    `exact_match`が`None`のサンプルは非一致として扱う（`exact_match_count`に加算しない）。
    """
    if not isinstance(samples, list) or not all(isinstance(s, OcrEvaluationSampleResult) for s in samples):
        raise TypeError("samplesはOcrEvaluationSampleResultのlistである必要があります")

    sample_count = len(samples)
    exact_match_count = sum(1 for s in samples if s.exact_match is True)

    dist_total = 0
    ref_total = 0
    for s in samples:
        if s.edit_distance is None:
            continue
        dist_total += s.edit_distance
        ref_total += len(normalize_compare(s.ground_truth))

    exact_match_rate = round(exact_match_count / sample_count, 4) if sample_count > 0 else 0.0
    cer = round(dist_total / ref_total, 4) if ref_total > 0 else None
    character_accuracy = round(1.0 - cer, 4) if cer is not None else None

    return OcrEvaluationMetrics(
        sample_count=sample_count,
        exact_match_count=exact_match_count,
        exact_match_rate=exact_match_rate,
        cer=cer,
        character_accuracy=character_accuracy,
    )


def aggregate_confusions(pairs: list[tuple[str, str]]) -> list[OcrEvaluationConfusion]:
    """複数(ground_truth, prediction)ペアからConfusionを集計する。

    kind（sub/del/ins。既存実装の短縮表記をそのまま使う）・expected（既存dictの'from'）・
    predicted（既存dictの'to'）・countを持つ`OcrEvaluationConfusion`のリストを返す。
    insertion/deletionはexpected/predictedの一方が空文字になる（既存仕様どおり、Noneへ変換しない）。

    並び順はcount降順、同countはkind→expected→predictedの決定的sortとする（既存APIの
    `Counter.most_common()`はcount降順のみでtie-breakは不定だが、本Calculatorは未配線の新規
    モジュールであり既存API `POST /api/ocr/evaluate` のconfusions/confusions_fullの並び順には
    一切影響しない。テストを安定させるための決定的sortを本モジュール内でのみ導入する）。
    """
    if not isinstance(pairs, list):
        raise TypeError("pairsはlistである必要があります")

    counter: "Counter[tuple[str, str, str]]" = Counter()
    for pair in pairs:
        ground_truth, prediction = pair
        if not isinstance(ground_truth, str) or not isinstance(prediction, str):
            raise TypeError("pairsの各要素はground_truth/predictionともに文字列である必要があります")
        expected_cmp = normalize_compare(ground_truth)
        pred_cmp = normalize_compare(prediction)
        _distance, ops = levenshtein_ops(expected_cmp, pred_cmp)
        for op in ops:
            counter[op] += 1

    items = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0][0], kv[0][1], kv[0][2]))
    return [
        OcrEvaluationConfusion(kind=kind, expected=expected, predicted=predicted, count=count)
        for (kind, expected, predicted), count in items
    ]
