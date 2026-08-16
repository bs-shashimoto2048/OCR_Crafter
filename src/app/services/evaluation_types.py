"""Multi-engine Evaluation APIの共通型（Issue #73で切り出し）。

`PredictionResult`は元々`evaluation_runner.py`に定義されていたが、Tesseract Predictor
Adapter（Issue #71）に続きPaddleOCR Predictor（Issue #73）が2つ目の実Predictorとして
追加されるにあたり、「全PredictorがRunnerモジュールへ依存する」という構造（Issue #71の
Future Work Minor 3）を是正するため、Runner・Dispatcher・Predictorのいずれからも参照できる
独立した葉モジュールへ切り出した。

このモジュールは他のEvaluation関連モジュール（`evaluation_dispatcher.py`・
`evaluation_runner.py`・各Predictor）を一切importしない（循環import防止）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional


@dataclass(frozen=True)
class PredictionResult:
    """Predictor（`EnginePredictor.recognize()`）がRunnerへ返すことを期待する最小出力契約。

    `EnginePredictor` Protocol（`evaluation_dispatcher.py`）の戻り値型としても参照される。
    Runnerは、Predictorの戻り値がこの`PredictionResult`であることを`isinstance()`で検証する
    （Sample Failure Boundary、Issue #69）。
    """

    text: str
    confidence: Optional[float] = None
    engine_details: Optional[Mapping[str, Any]] = None
