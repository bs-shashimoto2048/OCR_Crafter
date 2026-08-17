"""EasyOCR Evaluation Predictor Adapter（Multi-engine Evaluation API, Issue #75）。

**目的はEasyOCR評価処理を新規に作ることではない。** 既存のEasyOCR推論経路（`predict.py`の
Reader構築・OCR実行ヘルパー）を、`EvaluationRunner`（Issue #69）が利用できる`EnginePredictor`
へそのまま橋渡しするだけのAdapterである。

```text
既存EasyOCR推論経路（Reader構築・OCR実行・confidence取得）
        ↓
EasyOCREvaluationPredictor（本モジュール。橋渡しのみ）
        ↓
EvaluationDispatcher / EvaluationRunnerから利用可能
```

新しいOCR出力parser・新しいconfidence計算式・新しいbbox並び替え・新しいtext join方式は
一切実装しない。既存の`_run_easyocr()`（`predict.py`）をそのまま呼び出し、戻り値の
`(text, confidence)`を`PredictionResult`へ包み直すだけである。既存`POST /api/predict`・
`predict.py::_predict_with_easyocr()`（複数前処理variantによる再試行・文字単位confidence
gate・小文字制御等を含む推論テスト画面向けの豊富なロジック）はいずれも無変更（本モジュール
から一切呼び出さない・変更しない）。

## 実装前調査の結論（既存EasyOCR推論経路）

| 項目 | 事実 |
| --- | --- |
| Inference entry point | `predict.py::_predict_with_easyocr()`（`/predict`のengine分岐から呼ばれる） |
| Reader生成箇所 | `predict.py::_get_easyocr_reader(languages)` |
| Reader cache | あり。`_EASYOCR_READER_CACHE`（`(tuple(languages), use_gpu)`をキーとするプロセス内dict） |
| language設定 | `languages: list[str]`（`_normalize_ocr_languages()`で正規化、未指定時`["en"]`） |
| device/GPU設定 | `torch.cuda.is_available()`で自動判定（呼び出し側から明示指定不可。既存仕様） |
| official/custom | **officialのみ**。`easyocr.Reader`を直接生成するのみで、PaddleOCRのような
  カスタム学習済みモデル解決（`.ocr.json`等）は存在しない（`model_registry.py`にEasyOCR用の
  custom解決関数は無く、`resolve_ocr_model_meta(engine="easyocr")`のような呼び出しも
  コードベースに存在しないことをgrepで確認済み）。PaddleOCRのcustom model設計は
  コピーしていない |
| image入力方式 | パス文字列ではなく、自前でグレースケールnumpy配列へ変換して渡す
  （`Image.open(input_path).convert("L")`→`np.array()`。cv2.imread非依存、
  `tests/test_easyocr_input.py`参照） |
| text取得方法 | `reader.readtext(image_array, detail=1, paragraph=False)`の戻り値
  （`(bbox, text, confidence)`のタプル列）から`text`を抽出 |
| confidence取得方法 | 同上の`confidence`をそのままfloatとして保持 |
| 複数result集約方式 | **最大confidenceの1件を採用**（`_run_easyocr()`内の
  `max(parsed_results, key=confidence)`。全件joinでもfirst resultでもない。PaddleOCRの
  「最大confidence採用」ルールと結果的に同じだが、これは実コード確認の結果でありPaddleOCRの
  ルールをコピーしたものではない） |
| empty result | `prediction=""`・`confidence=0.0`（Noneではない。既存の実際の契約） |
| preprocessing | Predictorへ持ち込まない（下記「preprocessing」参照） |
| error handling | `_run_easyocr()`は例外を握りつぶさず送出（既存動作） |

## Reader構築とCI環境依存（PaddleOCR Issue #73の教訓を反映）

PaddleOCR Evaluation Predictor（Issue #73）では、`Predictor.__init__()`内で
`_get_paddle_text_recognition_reader()`（キャッシュ取得）がNoneを返す場合の
フォールバックとして、Predictor自身が`from paddleocr import PaddleOCR`という
**独自の直接import**を追加で持っていたため、マージ前レビューで「paddleocr未インストール
CI環境でこのフォールバックpathのテストが失敗する」というCI環境依存の不具合が発覚した。

**本Predictorはこの問題を構造的に回避している。** EasyOCRの既存Reader取得は
`_get_easyocr_reader()`という単一の関数に完全に閉じており、実際の`import easyocr`も
キャッシュ確認もフォールバック構築もすべてこの関数の内部で完結する
（`predict.py`側で既にテスト済みの既存コード）。本Predictorは`_get_easyocr_reader()`を
呼び出すだけで、独自の`import easyocr`やフォールバック構築ロジックを一切持たない。
そのため、テストで`_get_easyocr_reader()`をmockしさえすれば、`easyocr`パッケージの
実インストール有無に一切依存せずConstructor全体を検証できる（PaddleOCRのような
`sys.modules["easyocr"]`のmodule stubは本Predictorでは不要）。

## 責務分担

- **Predictorへ移す責務**: `EnginePredictor` Protocol適合（`engine_id`/`recognize()`）、
  `EvaluationDispatcher`への登録可能性、`PredictionResult`への変換、Predictor構築
  （build-once）のタイミングでのReader取得
- **既存helperをそのまま再利用する責務**: `predict.py`の`_get_easyocr_reader`
  （languages/use_gpuをキーとするキャッシュ付きReader取得）・`_run_easyocr`
  （OCR実行＋パース＋「複数検出結果のうち最大confidenceを採用」既存の集約ルール）・
  `_normalize_ocr_languages`（language一覧の正規化）。いずれも新規実装しない
- **既存`predict.py::_predict_with_easyocr()`へ当面残す責務（Predictorへ持ち込まない）**:
  複数前処理variant（base/contrast/blur/strong）による再試行・小文字制御（allowlist）・
  文字単位confidence gate・business rule検証・majority-vote候補選択。これらは推論テスト
  画面（`/predict`）向けのUX上の妥当性検証ロジックであり、Evaluationの
  「recognizeしてground_truthと比較する」という意味論には含まれない
- **Runnerに残す責務**（Issue #69で確定済み、本Issueでは変更しない）: Predictorのresolve
  （1回）・Sample反復・Sample Failure Boundary・Metrics/Confusion集計・timing・warnings

## preprocessing

Predictorは前処理を一切実行しない。`image`引数は前処理済みの画像パスを前提とする
（Tesseract/PaddleOCR Predictor Adapterと同じ契約）。複数target横断の評価前処理plan・
小文字制御用allowlistは、Evaluation固有のplan概念として持ち込まず、当面API Integration
Issue側の責務のまま維持する。

## engine_details

Tesseract/PaddleOCR Predictor Adapterと同じ理由で、常に`None`とする。
`EvaluationRunner`は現時点で`engine_details`を`OcrEvaluationResult`へ統合しないため
利用先が無く、model cache path・GPU内部情報等を格納すると将来の露出リスクになるため
設定しない。
"""

from __future__ import annotations

from typing import Any, Optional

from ..predict import _get_easyocr_reader, _normalize_ocr_languages, _run_easyocr
from .evaluation_types import PredictionResult


class EasyOCREvaluationPredictor:
    """既存EasyOCR推論経路を`EnginePredictor`として`EvaluationRunner`へ接続するAdapter。"""

    engine_id = "easyocr"

    def __init__(
        self,
        project_id: Optional[str] = None,
        languages: Optional[list[str]] = None,
    ) -> None:
        """Predictorを構築する（build-once）。

        Reader取得（`_get_easyocr_reader()`。未キャッシュなら`easyocr.Reader(...)`の
        構築＝重みload、既キャッシュならそのまま返す）を、ここで1回だけ行う。
        `EvaluationRunner`は本Predictorを`run()`開始時に1回だけ`resolve()`し、以降は
        同一インスタンスを全Sampleで再利用する前提のため、Sampleごとに再構築しない設計に
        合わせる（Tesseract/PaddleOCR Predictor Adapterと同じbuild-once前提）。

        `project_id`は現時点でモデル解決に使用しない（実装前調査のとおり、EasyOCRには
        既存のcustom/学習済みモデル解決が存在せず、officialな`easyocr.Reader`のみを
        サポートする既存仕様をそのまま維持するため）。将来API Integration Issueで
        Predictor構築規約を他Engineと揃える際の一貫性のためだけに引数として保持する。

        `easyocr`パッケージ未インストール時は`_get_easyocr_reader()`が送出する
        `RuntimeError`をそのまま伝播する。これはPredictor構築時点＝
        `EvaluationDispatcher.register()`・`EvaluationRunner.run()`より前のエラーで
        あり、画像単位のOCR失敗（Sample単位エラー）とは明確に区別される。
        """
        self.project_id = project_id
        self.languages = _normalize_ocr_languages(languages)
        self._reader, self._use_gpu = _get_easyocr_reader(self.languages)

    def recognize(self, image: str, **kwargs: Any) -> PredictionResult:
        """既存`_run_easyocr()`をそのまま呼び出し、結果を`PredictionResult`へ包み直す。

        `image`は画像パス（前処理済みの画像パスを前提。前処理plan自体はPredictorの
        責務外）。テキスト集約は既存`_run_easyocr()`のルール（複数検出結果のうち
        最大confidenceの1件を採用）をそのまま踏襲し、本Predictorでは再実装しない。
        confidenceは既存仕様どおりそのまま保持する。**既存`_run_easyocr()`は
        confidenceを常にfloatで返し（検出0件時は`0.0`）、Noneを返すことはない**
        （Tesseractの`recognize_line()`とは異なる既存の実際の契約であり、本Predictorが
        新たに0.0を捏造しているわけではない）。

        `**kwargs`は`EnginePredictor` Protocolとの整合のために受け付けるが、本Adapterは
        現時点でSample単位の追加引数を必要としない（languageはbuild-once時に確定済み、
        allowlist等の小文字制御はEvaluation固有のplanとして持ち込まない）ため使用しない。

        既存`_run_easyocr()`が送出する例外（画像読込失敗・OCR実行失敗等）は、ここで
        握りつぶさずそのまま送出する。`EvaluationRunner`のSample Failure Boundaryが
        これを捕捉し、該当Sample1件のみの失敗として隔離する（Run全体は中断しない）。
        """
        prediction, confidence, _parsed_results = _run_easyocr(self._reader, image)
        return PredictionResult(text=prediction, confidence=confidence, engine_details=None)
