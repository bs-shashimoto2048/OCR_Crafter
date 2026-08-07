"""Tesseract Evaluation Predictor Adapter（Multi-engine Evaluation API, Issue #71）。

**目的はTesseract評価処理を新規に作ることではない。** 既存のTesseract評価推論経路
（`ocr_evaluation.py::build_recognizer` → `tesseract_pipeline.py::recognize_line`）を、
`EvaluationRunner`（Issue #69）が利用できる`EnginePredictor`へそのまま橋渡しするだけの
Adapterである。

```text
既存Tesseract固有処理（model解決・OCR実行・confidence取得）
        ↓
TesseractEvaluationPredictor（本モジュール。橋渡しのみ）
        ↓
EvaluationRunnerから利用可能
```

新しいModel Resolver・新しいPSM/whitelist優先順位・新しい前処理ロジックは一切実装しない。
既存の`build_recognizer()`をそのまま呼び出し、戻り値の`(text, confidence)`タプルを
`PredictionResult`へ包み直すだけである。既存`POST /api/ocr/evaluate`（`ocr_evaluation.py`）
・既存Tesseract評価結果は無変更（本モジュールから一切呼び出さない・変更しない）。

## 責務分担（実装前調査の結論）

- **Predictorへ移す責務**: `EnginePredictor` Protocol適合（`engine_id`/`recognize()`）、
  `EvaluationDispatcher`への登録可能性、`PredictionResult`への変換、Predictor構築（build-once）
  のタイミングでの既存`build_recognizer()`呼び出し
- **Runnerに残す責務**（Issue #69で確定済み・本Issueでは変更しない）: Predictorのresolve
  （1回）・Sample反復・Sample Failure Boundary・Metrics/Confusion集計・timing・warnings
- **既存`ocr_evaluation.py`に当面残す責務**: GT CSV読込・画像探索・複数ターゲット横断の
  評価前処理計画（`resolve_evaluation_preprocess_plan`。manual/training/training_individual
  のグループ化は単一Predictorの責務ではなく、複数ターゲットを横断してAPI層が決める概念のため）・
  既存`POST /api/ocr/evaluate`のResponse構築。本Predictorの`recognize(image, ...)`が受け取る
  `image`は、既存評価経路が`rec["recognize"](processed_image_path)`へ渡すのと同じ
  「OCR実行可能な状態まで前処理済みの画像パス」を前提とする（前処理plan自体はAPI Integration
  Issueで決める）
"""

from __future__ import annotations

from typing import Any, Optional

from .evaluation_types import PredictionResult
from .ocr_evaluation import build_recognizer
from .tesseract_pipeline import DEFAULT_PSM, TESSERACT_WHITELIST_DEFAULT


class TesseractEvaluationPredictor:
    """既存Tesseract評価推論経路を`EnginePredictor`として`EvaluationRunner`へ接続するAdapter。"""

    engine_id = "tesseract"

    def __init__(
        self,
        project_id: Optional[str],
        model: str = "latest",
        charset: str = TESSERACT_WHITELIST_DEFAULT,
        psm: int = DEFAULT_PSM,
    ) -> None:
        """Predictorを構築する（build-once）。

        既存`ocr_evaluation.py::build_recognizer()`をそのまま呼び出し、Tesseract実行ファイル
        解決・tessdata_dir/lang解決・（学習後モデルの場合）モデルメタ情報読込を、ここで1回だけ
        行う。`EvaluationRunner`は本Predictorを`run()`開始時に1回だけresolve()し、以降は同一
        インスタンスを全Sampleで再利用する前提のため、Sampleごとに再解決しない設計に合わせる。

        `build_recognizer()`が送出する例外（Tesseract実行ファイル未検出の`RuntimeError`、
        学習後モデルが見つからない`FileNotFoundError`等）はここでそのまま伝播する。これは
        Predictor構築時点＝`EvaluationDispatcher.register()`・`EvaluationRunner.run()`より前の
        エラーであり、画像単位のOCR失敗（Sample単位エラー）とは明確に区別される
        （呼び出し側＝将来のAPI Integration Issueが構成する場所で処理する）。

        charset/psmは既存`evaluate_ocr()`と同じくRequest値をそのまま使う（既存実装には
        Tesseractモデルメタ情報によるcharset/psmの上書き優先順位は存在しないため、新たな
        優先順位ロジックは実装しない。学習時前処理メタ情報は別概念であり`training_preprocess`
        として保持するのみ）。
        """
        recognizer = build_recognizer(project_id, {"engine": "tesseract", "model": model}, charset, int(psm))
        # Sample単位でしか安全に行えない処理（実際のOCR実行）以外は、すべてここで解決済み。
        self._recognize_line = recognizer["recognize"]
        self.model_label: str = recognizer["label"]
        self.model: str = recognizer["model"]
        self.is_base: bool = bool(recognizer["is_base"])
        # 学習時前処理メタ情報（build-once時に解決済み。Predictor自身は前処理を実行しない）。
        # 評価前処理計画（manual/training/training_individual）はAPI Integration Issueが
        # 複数ターゲット横断で決める責務であり、本Predictorはこの情報を保持するだけに留める。
        self.training_preprocess: Optional[dict[str, Any]] = recognizer.get("training_preprocess")
        self.training_preprocess_hash: Optional[str] = recognizer.get("training_preprocess_hash")

    def recognize(self, image: str, **kwargs: Any) -> PredictionResult:
        """既存`recognize_line()`をそのまま呼び出し、結果を`PredictionResult`へ包み直す。

        `image`は前処理済みの画像パス（既存評価経路と同じ契約）。正規化・比較・CER計算は
        行わない（`EvaluationRunner`が`calculate_sample_metrics()`経由で行う責務）。
        `**kwargs`は`EnginePredictor` Protocolとの整合のために受け付けるが、本Adapterは
        現時点でSample単位の追加引数を必要としない（PSM/charsetはbuild-once時に確定済み）
        ため使用しない。

        既存`recognize_line()`が送出する例外（Tesseract実行失敗の`RuntimeError`等）は、
        ここで握りつぶさずそのまま送出する。`EvaluationRunner`のSample Failure Boundaryが
        これを捕捉し、該当Sample1件のみの失敗として隔離する（Run全体は中断しない）。
        confidenceが取得できない場合（whitelist指定時のTesseract既知挙動）は、既存仕様どおり
        `0.0`で代用せず`None`をそのまま保持する（捏造禁止）。
        """
        text, confidence = self._recognize_line(image)
        # engine_detailsは今回意図的に設定しない（None）。理由:
        # (1) EvaluationRunnerは現時点でPredictionResult.engine_detailsをResultへ統合しない
        #     （Issue #69で確定済み）ため、設定しても現状は捨てられるだけで利用先がない。
        # (2) tessdata_dir等のファイルシステムPathをここへ格納すると、将来Runnerが
        #     engine_detailsを統合するようになった際にAPIレスポンス経由で内部Pathが
        #     意図せず露出するリスクがある。利用先が定まってから、必要な情報だけを
        #     選んで追加する。
        return PredictionResult(text=text, confidence=confidence, engine_details=None)
