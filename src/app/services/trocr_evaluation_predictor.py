"""TrOCR Evaluation Predictor Adapter（Multi-engine Evaluation API, Issue #77）。

**目的はTrOCR評価処理を新規に作ることではない。** 既存のTrOCR単一画像推論コア
（`trocr_engine.py::TrOCREngine`）を、`EvaluationRunner`（Issue #69）が利用できる
`EnginePredictor`へそのまま橋渡しするだけのAdapterである。

```text
既存TrOCR単一画像推論（TrOCREngine.load() → predict_file()）
        ↓
TrOCREvaluationPredictor（本モジュール。橋渡しのみ）
        ↓
EvaluationDispatcher / EvaluationRunnerから利用可能
```

## 実装前調査の結論（既存TrOCR推論経路）

```text
predict.py::_predict_with_trocr(image_source, model_ref)
    → TrOCREngine.load(model_ref)      # Processor/Model構築（重量物、Hugging Face from_pretrained）
        → TrOCREngine.predict_file(path) / .predict(image)
            → PIL.Image.open() → RGB変換
            → processor(images=..., return_tensors="pt") → pixel_values
            → pixel_values.to(device)
            → model.generate(pixel_values)（torch.inference_mode()内）
            → processor.batch_decode(generated_ids, skip_special_tokens=True)
            → text.strip()
    → TrOCRResult(text=..., model_ref=...)  # confidence/bbox属性を持たない
```

**重大な既存事実（build-once要件との関係）**: `predict.py::_predict_with_trocr()`は
呼び出しのたびに`TrOCREngine.load(model_ref)`を呼び直す（同関数docstring:
「TrOCREngineのインスタンスは呼び出しのたびにload()し直す（本Issueのスコープで新規
キャッシュは作らない）」。既存の意図的な仕様であり、単一画像推論テスト画面向けには
問題にならないが、Evaluationの「1回build・複数回recognize」という要件には適さない。
そのため**本Predictorは`_predict_with_trocr()`を呼ばない**。代わりに、`TrOCREngine`
自体が既に「`load()`で1回ロードし、同一インスタンスの`predict()`/`predict_file()`を
繰り返し呼ぶことでモデルを再利用する」設計（`trocr_engine.py`のクラスdocstring参照。
`tests/test_trocr_engine.py::test_same_engine_instance_does_not_reload_on_repeated_predict`
で実証済み）になっているため、本Predictorは`TrOCREngine.load()`をconstructor時に1回だけ
呼び、以降は同一インスタンスの`predict_file()`をSampleごとに呼ぶだけで、既存クラスの
build-once契約をそのまま利用できる（既存推論ロジックの複製・再実装は一切不要）。

## Model resolution

`model_registry.py`にTrOCR用のmodel resolution関数は存在しない（grep確認済み）。
`benchmark.py`にもTrOCR用の実行経路は存在しない（grep確認済み）。既存
`_predict_with_trocr()`は、呼び出し側が渡した`model`パラメータ（Hugging Face Hub ID・
ローカルディレクトリパス）を`model_ref`としてそのまま`TrOCREngine.load()`へ渡すのみで、
`resolve_model_path()`/`resolve_ocr_model_meta()`のような既存Resolverは一切適用しない
（他3エンジンと異なり、統一Model Resolverが存在しないという既存の事実。ISSUE_MAP.md
Future Work「TrOCRのmodel_ref解決」参照）。**本Predictorも同じ事実をそのまま反映し、
Evaluation専用の新しいResolverを新設しない。** `"latest"`等の特殊値のフォールバック
（PaddleOCRにはあるがTrOCRには存在しない）も発明しない——`model`は呼び出し側が
明示的に指定する必須引数とし、指定が無効な場合は`TrOCREngine.load()`自身が送出する
`ValueError`（None/空文字/空白のみ）をそのまま伝播させる。

## Predictorへ移す責務 / 既存のまま再利用する責務

- **Predictorへ移す責務**: `EnginePredictor` Protocol適合（`engine_id`/`recognize()`）、
  `EvaluationDispatcher`への登録可能性、`PredictionResult`への変換、Predictor構築
  （build-once）のタイミングでの`TrOCREngine.load()`呼び出し
- **既存`TrOCREngine`をそのまま再利用する責務**: model/processor構築（`load()`）・
  画像読込/RGB変換・`processor()`呼び出し・device移動・`model.generate()`・
  `batch_decode()`・空白除去。いずれも新規実装しない
- **Runnerに残す責務**（Issue #69で確定済み、本Issueでは変更しない）: Predictorのresolve
  （1回）・Sample反復・Sample Failure Boundary・Metrics/Confusion集計・timing・warnings

## confidence / bbox

`TrOCRResult`は`confidence`属性を一切持たない（`trocr_engine.py`のモジュールdocstring
「TrOCR標準の`generate()`は文字単位confidenceを直接返さず、算出方法は未解決事項の
まま」・`tests/test_trocr_engine.py::test_result_has_no_confidence_attribute`で確認済み）。
本Predictorは`confidence=None`を常に返す。**softmax max値・token probability平均・
sequence scoreへの独自変換など、新しいconfidence定義を一切発明しない**（0.0/1.0での
代用も行わない）。同様に`TrOCRResult`はbboxを持たず、`PredictionResult`にもbboxフィールドは
存在しないため、bboxに関する処理は一切行わない。

## preprocessing

Predictorは前処理を一切実行しない。`image`引数はファイルパスとして
`TrOCREngine.predict_file()`へそのまま渡す（画像読込・RGB変換は既存`TrOCREngine`の
責務、Tesseract/PaddleOCR/EasyOCR Predictor Adapterと同じ「前処理はPredictor外」という
契約）。

## engine_details

他Predictor Adapterと同じ理由で、常に`None`とする。`EvaluationRunner`は現時点で
`engine_details`を`OcrEvaluationResult`へ統合しないため利用先が無く、model_ref
（Hugging Face Hub ID・ローカルパス）・device等を格納すると将来の露出リスクになるため
設定しない。
"""

from __future__ import annotations

from typing import Any, Optional

from .evaluation_types import PredictionResult
from .trocr_engine import TrOCREngine


class TrOCREvaluationPredictor:
    """既存TrOCR推論コア（`TrOCREngine`）を`EnginePredictor`として`EvaluationRunner`へ接続するAdapter。"""

    engine_id = "trocr"

    def __init__(
        self,
        project_id: Optional[str] = None,
        model: str = "",
        device: Optional[str] = None,
        local_files_only: bool = False,
    ) -> None:
        """Predictorを構築する（build-once）。

        `TrOCREngine.load()`（Processor/Model構築＝Hugging Face `from_pretrained()`・
        device移動）を、ここで1回だけ行う。`EvaluationRunner`は本Predictorを`run()`
        開始時に1回だけ`resolve()`し、以降は同一インスタンスを全Sampleで再利用する前提
        のため、Sampleごとに再構築しない設計に合わせる（Tesseract/PaddleOCR/EasyOCR
        Predictor Adapterと同じbuild-once前提。ただしTrOCRの場合は`TrOCREngine`自身が
        既にこの「1回load・複数回predict」契約を持つクラスであるため、本Predictorは
        単にそれを1回呼ぶだけでよい）。

        `model`（`model_ref`）は必須の実質的な引数である。他3エンジンと異なり、TrOCRには
        `"latest"`等の特殊値によるフォールバックや`resolve_ocr_model_meta()`のような
        Model Registry解決が既存経路に存在しないため、本Predictorもそれらを発明しない。
        `model`が空文字・None・空白のみの場合は`TrOCREngine.load()`が送出する
        `ValueError`をそのまま伝播させる。

        `project_id`は現時点でモデル解決に使用しない（TrOCRのmodel_refはHugging Face
        Hub ID・ローカルパスであり、project単位のModel Registryとは無関係のため）。
        将来API Integration Issueで他Engineと呼び出し規約を揃えるためだけに引数として
        保持する。

        `transformers`パッケージ未インストール時・Processor/Model構築失敗時・device
        初期化失敗時は、`TrOCREngine.load()`が送出する`TrOCRDependencyError`/
        `TrOCRModelLoadError`（いずれも`TrOCRError`のサブクラス、`RuntimeError`基底）
        をそのまま伝播する。これはPredictor構築時点＝`EvaluationDispatcher.register()`・
        `EvaluationRunner.run()`より前のエラーであり、画像単位のOCR失敗（Sample単位
        エラー）とは明確に区別される。
        """
        self.project_id = project_id
        self._engine = TrOCREngine.load(model, device=device, local_files_only=local_files_only)

    def recognize(self, image: str, **kwargs: Any) -> PredictionResult:
        """既存`TrOCREngine.predict_file()`をそのまま呼び出し、結果を`PredictionResult`へ包み直す。

        `image`は画像パス（前処理済みの画像パスを前提。前処理plan自体はPredictorの
        責務外）。画像読込・RGB変換・generate・decodeはすべて既存`TrOCREngine`が行い、
        本Predictorでは一切再実装しない。`confidence`は既存`TrOCRResult`が持たない
        属性であるため常に`None`（捏造しない）。`engine_details`も常に`None`。

        `**kwargs`は`EnginePredictor` Protocolとの整合のために受け付けるが、本Adapterは
        現時点でSample単位の追加引数を必要としない（model/device/local_files_onlyは
        build-once時に確定済みであり、Sampleごとにmodelを切り替える設計は採用しない）
        ため使用しない。

        既存`TrOCREngine.predict_file()`が送出する例外（画像読込失敗・前処理失敗・
        generate失敗・decode失敗等、`ValueError`/`FileNotFoundError`/`TrOCRInferenceError`）
        は、ここで握りつぶさずそのまま送出する。`EvaluationRunner`のSample Failure
        Boundaryがこれを捕捉し、該当Sample1件のみの失敗として隔離する（Run全体は
        中断しない）。空文字・confidence=0への変換、エラー文字列のprediction textへの
        混入はいずれも行わない。
        """
        result = self._engine.predict_file(image)
        return PredictionResult(text=result.text, confidence=None, engine_details=None)
