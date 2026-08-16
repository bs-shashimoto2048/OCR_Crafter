"""PaddleOCR Evaluation Predictor Adapter（Multi-engine Evaluation API, Issue #73）。

**目的はPaddleOCR評価処理を新規に作ることではない。** 既存のPaddleOCR推論経路（`predict.py`の
reader構築・OCR実行ヘルパー、および`benchmark.py`が同じヘルパーを使って実装済みの
`recognize(image_path) -> (text, confidence)`パターン）を、`EvaluationRunner`（Issue #69）が
利用できる`EnginePredictor`へそのまま橋渡しするだけのAdapterである。

```text
既存PaddleOCR推論経路（model解決・reader構築・OCR実行・confidence取得）
        ↓
PaddleOCREvaluationPredictor（本モジュール。橋渡しのみ）
        ↓
EvaluationDispatcher / EvaluationRunnerから利用可能
```

新しいModel Resolver・新しいconfidence集約式・新しい前処理ロジックは一切実装しない。
既存の`_run_paddleocr()`（`predict.py`）をそのまま呼び出し、戻り値の`(text, confidence)`を
`PredictionResult`へ包み直すだけである。既存`POST /api/predict`・`predict.py::_predict_with_paddleocr()`
（多段階の前処理variant再試行・文字単位confidence gate等を含む推論テスト画面向けの豊富な
ロジック）・既存Benchmark（`benchmark.py::ENGINE_BUILDERS`）はいずれも無変更（本モジュールから
一切呼び出さない・変更しない）。

## 責務分担（実装前調査の結論）

- **Predictorへ移す責務**: `EnginePredictor` Protocol適合（`engine_id`/`recognize()`）、
  `EvaluationDispatcher`への登録可能性、`PredictionResult`への変換、Predictor構築
  （build-once）のタイミングでのreader構築・model解決
- **既存helperをそのまま再利用する責務**: `predict.py`の`_create_paddleocr_instance`
  （バージョン差異吸収済みのPaddleOCRインスタンス生成）・`_get_paddle_text_recognition_reader`
  （TextRecognitionリーダーのキャッシュ付き取得）・`_run_paddleocr`（OCR実行＋TSV/dict形式の
  解析＋「複数検出結果のうち最大confidenceを採用する」既存の集約ルール）・
  `_is_paddle_rec_inference_dir`（推論エクスポート済みディレクトリの検証）・
  `OFFICIAL_PADDLEOCR_REC_MODELS`（公式モデル名一覧）。`model_registry.py::resolve_ocr_model_meta`
  （自作/学習済みモデルのメタ情報解決）。いずれも新規実装しない
- **既存`predict.py::_predict_with_paddleocr()`へ当面残す責務（Predictorへ持ち込まない）**:
  複数前処理variant（base/contrast/blur/strong）による再試行・文字単位confidence gate・
  business rule検証・majority-vote候補選択。これらは推論テスト画面（`/predict`）向けの
  UX上の妥当性検証ロジックであり、Evaluationの「recognizeしてground_truthと比較する」という
  意味論には含まれない（Design #61の`recognize(image_path) -> (text, confidence)`契約どおり）
- **Runnerに残す責務**（Issue #69で確定済み、本Issueでは変更しない）: Predictorのresolve
  （1回）・Sample反復・Sample Failure Boundary・Metrics/Confusion集計・timing・warnings

## Official / Custom（Benchmark Variant Keyを持ち込まない）

既存`_predict_with_paddleocr()`と同じ判定を用いる: 指定`model`が`OFFICIAL_PADDLEOCR_REC_MODELS`
に含まれれば公式モデル、含まれなければ`resolve_ocr_model_meta()`で自作/学習済みモデルとして
解決する（`model`が`""`/`"latest"`かつ自作モデルが見つからない場合のみ、公式モデルの先頭
（`OFFICIAL_PADDLEOCR_REC_MODELS[0]`）へフォールバックする。既存挙動と同一）。

**Benchmark（`benchmark.py::ENGINE_CATALOG`）の`paddleocr_official`/`paddleocr_custom`という
Variant Key軸は持ち込まない。** Evaluationはcanonical engine_id="paddleocr"の1つのみであり、
official/customの区別はconstructor引数`model`の値によって決まる（Predictorインスタンスの
`is_official`属性として保持するのみ）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from ..predict import (
    OFFICIAL_PADDLEOCR_REC_MODELS,
    _create_paddleocr_instance,
    _get_paddle_text_recognition_reader,
    _is_paddle_rec_inference_dir,
    _prepare_paddle_runtime_env,
    _run_paddleocr,
)
from .evaluation_types import PredictionResult
from .model_registry import resolve_ocr_model_meta


class PaddleOCREvaluationPredictor:
    """既存PaddleOCR推論経路を`EnginePredictor`として`EvaluationRunner`へ接続するAdapter。"""

    engine_id = "paddleocr"

    def __init__(
        self,
        project_id: Optional[str],
        model: str = "latest",
        language: str = "en",
        use_angle_cls: bool = False,
    ) -> None:
        """Predictorを構築する（build-once）。

        Model解決・reader構築（PaddleOCRオブジェクト生成・重みload）を、ここで1回だけ行う。
        `EvaluationRunner`は本Predictorを`run()`開始時に1回だけresolve()し、以降は同一
        インスタンスを全Sampleで再利用する前提のため、Sampleごとに再解決・再構築しない設計に
        合わせる（Tesseract Predictor Adapter・TrOCRのbuild-once設計と同じ前提）。

        `model`が`OFFICIAL_PADDLEOCR_REC_MODELS`に含まれれば公式モデル、含まれなければ
        `resolve_ocr_model_meta()`で自作/学習済みモデルとして解決する（既存
        `_predict_with_paddleocr()`と同一の判定順序）。モデル解決・reader構築の失敗
        （`FileNotFoundError`・`RuntimeError`）はここでそのまま伝播する。これはPredictor
        構築時点＝`EvaluationDispatcher.register()`・`EvaluationRunner.run()`より前のエラーで
        あり、画像単位のOCR失敗（Sample単位エラー）とは明確に区別される。
        """
        requested_model = (model or "latest").strip()
        official_requested = requested_model in OFFICIAL_PADDLEOCR_REC_MODELS
        model_meta = (
            None
            if official_requested
            else resolve_ocr_model_meta(
                project_id=project_id, model=requested_model, engine="paddleocr", inference_ready_only=True
            )
        )
        if model_meta is None and not official_requested:
            if requested_model not in {"", "latest"}:
                raise FileNotFoundError(f"paddleocr model not found: {requested_model}")
            # 既存_predict_with_paddleocr()と同じフォールバック: 自作モデルが無い環境でも
            # latest指定でプレビューできるよう、公式認識モデルの先頭へフォールバックする。
            requested_model = OFFICIAL_PADDLEOCR_REC_MODELS[0]
            official_requested = True

        model_dir: Optional[Path] = None
        if model_meta is None:
            self.model: str = requested_model
            self.is_official: bool = True
        else:
            model_dir_raw = str(model_meta.get("model_dir") or model_meta.get("inference_dir") or "").strip()
            if not model_dir_raw:
                raise RuntimeError(
                    f"selected model '{requested_model}' has no inference directory. "
                    "Please run model export first."
                )
            model_dir = Path(model_dir_raw)
            if not _is_paddle_rec_inference_dir(model_dir):
                raise RuntimeError(
                    f"selected model '{requested_model}' is not inference-exported. "
                    "Please run model export first."
                )
            self.model = str(model_meta.get("name") or requested_model)
            self.is_official = False

        # Sample単位でしか安全に行えない処理（実際のOCR実行）以外は、すべてここで解決済み。
        reader = _get_paddle_text_recognition_reader(
            model_dir=model_dir, model_name=(requested_model if official_requested else None)
        )
        if reader is None:
            _prepare_paddle_runtime_env()
            try:
                from paddleocr import PaddleOCR  # type: ignore
            except ImportError as e:
                raise RuntimeError(
                    "paddleocr is not installed. Please run: pip install paddleocr paddlepaddle"
                ) from e
            if official_requested:
                reader = _create_paddleocr_instance(
                    PaddleOCR,
                    lang=language,
                    use_angle_cls=use_angle_cls,
                    text_recognition_model_name=requested_model,
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
            else:
                reader = _create_paddleocr_instance(
                    PaddleOCR,
                    lang=language,
                    use_angle_cls=use_angle_cls,
                    rec_model_dir=str(model_dir),
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
        self._reader = reader
        self._use_angle_cls = use_angle_cls

    def recognize(self, image: str, **kwargs: Any) -> PredictionResult:
        """既存`_run_paddleocr()`をそのまま呼び出し、結果を`PredictionResult`へ包み直す。

        `image`は画像パス（既存`benchmark.py`のPaddleOCR Runnerと同じ契約。前処理plan自体は
        Predictorの責務外——Tesseract Predictor Adapterと同様、複数target横断の評価前処理は
        当面API Integration Issueが決める責務のまま）。テキスト集約は既存`_run_paddleocr()`の
        ルール（複数検出結果のうち最大confidenceの1件を採用）をそのまま踏襲し、本Predictorでは
        再実装しない。confidenceは既存仕様どおりそのまま保持する。**既存`_run_paddleocr()`は
        confidenceを常にfloatで返し（検出0件時は`0.0`）、Noneを返すことはない**（Tesseractの
        `recognize_line()`とは異なる既存の実際の契約であり、本Predictorが新たに0.0を捏造して
        いるわけではない）。

        `**kwargs`は`EnginePredictor` Protocolとの整合のために受け付けるが、本Adapterは
        現時点でSample単位の追加引数を必要としない（language/use_angle_clsはbuild-once時に
        確定済み）ため使用しない。

        既存`_run_paddleocr()`が送出する例外は、ここで握りつぶさずそのまま送出する。
        `EvaluationRunner`のSample Failure Boundaryがこれを捕捉し、該当Sample1件のみの失敗
        として隔離する（Run全体は中断しない）。
        """
        prediction, confidence, _parsed_results = _run_paddleocr(self._reader, image, use_angle_cls=self._use_angle_cls)
        # engine_detailsは今回意図的に設定しない（None）。理由はTesseract Predictor Adapter
        # （Issue #71）と同じ: (1) EvaluationRunnerは現時点でPredictionResult.engine_detailsを
        # Resultへ統合しないため利用先がない。(2) model_dir等のファイルシステムPathをここへ
        # 格納すると、将来Runnerが統合するようになった際に内部Pathが意図せず露出するリスクがある。
        return PredictionResult(text=prediction, confidence=confidence, engine_details=None)
