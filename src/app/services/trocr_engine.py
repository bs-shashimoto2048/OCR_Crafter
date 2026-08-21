"""TrOCR推論コア（Hugging Face Transformersを利用した単画像文字認識）。

docs/design/TROCR_BACKEND.md のうち、本Issue（TrOCR Backend単画像推論コア）で
実装する範囲のみを対象とする。

設計方針:
- `transformers`はoptional dependency。モジュールのトップレベルではimportせず、
  実際に使う箇所でのみ遅延importする（既存の`predict.py::_get_easyocr_reader()`と
  同じ「try/except ImportError → 明確なRuntimeError系例外」パターンを踏襲する）。
  これにより、transformers未導入でも本モジュール以外の既存Backend（Tesseract/
  PaddleOCR/EasyOCR処理・アプリ起動）には一切影響しない
- import時にモデルをロードしない。`TrOCREngine.load()`を呼んで初めてロードする
- グローバルSingleton・グローバルモデルキャッシュは持たない。モデルの再利用は
  「同一`TrOCREngine`インスタンスを使い回す」ことでのみ行う
- Engine Capability/Engine Registry/Model Metadataへは接続しない（本Issueの
  スコープ外）。`trocr`は既にEngine Registryへ登録済みだが、そこから
  `TrOCREngine`を生成するFactoryは実装しない
- confidence・bboxは返さない。TrOCR標準の`generate()`は文字単位confidenceを
  直接返さず、算出方法は未解決事項のまま（ARCHITECTURE_DRAFT.md参照）。
  推測で埋めない
- Dataset管理・学習・評価・BBOX検出・画像分割・APIレスポンス作成・DB保存・
  Model Registry登録・Model Metadata保存・Benchmark記録は責務外
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError


class TrOCRError(RuntimeError):
    """TrOCR推論コア関連のエラーの基底クラス。"""


class TrOCRDependencyError(TrOCRError):
    """transformers等、必要な依存関係が導入されていない。"""


class TrOCRModelLoadError(TrOCRError):
    """Processor/Modelのロード、またはdeviceへの移動に失敗した。"""


class TrOCRInferenceError(TrOCRError):
    """推論（前処理/generate/decode）に失敗した。"""


@dataclass(frozen=True)
class TrOCRResult:
    """単一画像に対するTrOCR推論結果。

    confidence・bboxは意図的に持たない（捏造しない。詳細はモジュールdocstring参照）。
    """

    text: str
    engine_id: str = "trocr"
    model_ref: str | None = None


def _resolve_device(device: str | None) -> str:
    """device指定を解決する。

    None: CUDAが利用可能なら"cuda"、そうでなければ"cpu"。
    明示指定: "cpu"または"cuda"/"cuda:N"のみ許可。それ以外の文字列は
    ValueErrorで明確に拒否する。"cuda"系を指定したのにCUDAが利用不可の場合、
    黙って"cpu"へフォールバックせずTrOCRModelLoadErrorを送出する
    （"cuda:N"のNの妥当性自体は、実際に`model.to()`した際にtorch側の
    エラーとして表面化させ、ここでは重複した構文チェックを行わない）。
    """
    import torch  # torchは既存の必須依存のため、easyocr等とは異なり遅延import不要

    if device is None:
        return "cuda" if torch.cuda.is_available() else "cpu"

    if not isinstance(device, str):
        raise ValueError(f"device must be a string or None, got {type(device)!r}")

    normalized = device.strip().lower()
    if not normalized:
        raise ValueError(f"device must not be empty: {device!r}")
    if normalized != "cpu" and not normalized.startswith("cuda"):
        raise ValueError(f"unsupported device: {device!r}")
    if normalized.startswith("cuda") and not torch.cuda.is_available():
        raise TrOCRModelLoadError(
            f"device={device!r} was requested but CUDA is not available on this machine"
        )
    return normalized


def _load_processor(model_ref: str, *, local_files_only: bool) -> Any:
    """`model_ref`のTrOCR Processor（image processor + tokenizer）をロードする。

    Issue #164（TrOCR End-to-End Production Workflow Validation）で実際に
    Hugging Face Hub上の公式TrOCR checkpoint（`microsoft/trocr-*`）を使って
    fine-tuneを試みたところ、`transformers==5.14.1`の`AutoProcessor`/
    `AutoTokenizer`が、これら公式checkpoint（いずれも`tokenizer.json`＝fast
    tokenizerのシリアライズ済みファイルを同梱しない、2023年以前の形式）の
    tokenizerを解決できず、次のいずれかの形で失敗することを確認した:

    - `AutoProcessor.from_pretrained()`が例外を送出せず、**tokenizerを持たない
      image processorのみ**（`DeiTImageProcessor`等）を返す（`vocab.json`+
      `merges.txt`形式・`sentencepiece.bpe.model`形式のいずれでも再現）
    - `AutoTokenizer.from_pretrained()`は明示的に`ValueError`
      （"Couldn't instantiate the backend tokenizer..."）を送出する

    一方、tokenizer_config.jsonが明示する**具象のslow tokenizerクラス**
    （`RobertaTokenizer`/`XLMRobertaTokenizer`等）を直接`from_pretrained()`
    すれば正しくロードできることを同じcheckpointで実証済み（Auto解決層の
    fast tokenizer自動変換パスにのみ問題があり、tokenizer実装自体は健全）。

    このため、まず通常の`AutoProcessor.from_pretrained()`を試し、得られた
    processorが**`BaseImageProcessor`のインスタンス**（＝tokenizerを伴わない
    image processor単体）である場合のみ、image processorとtokenizerを
    個別にロードして`TrOCRProcessor`を組み立てるフォールバックを行う。
    `transformers.image_processing_utils.BaseImageProcessor`のインスタンスか
    どうかで判定するのは、実際に壊れて返ってくる`DeiTImageProcessor`等は
    必ずこの基底クラスを継承する一方、正常な`TrOCRProcessor`（image_processor
    とtokenizerを内包する複合Processor）はこの基底クラスを継承しない
    ためであり、かつ本モジュールの単体テストが使うfake processor（plain
    Pythonオブジェクト。利用箇所ごとに異なる属性のみ実装し、他は意図的に
    持たない）もこの基底クラスを継承しないため、fakeの属性の有無に関わらず
    誤ってフォールバック対象にすることがない（属性の有無で判定する方式は
    各テストファイルのfake形状の違いにより誤検出することを実際に確認済み）。
    ローカル保存済みcheckpoint（学習後に`save_pretrained()`したもの等）は
    通常`tokenizer.json`を含むため、フォールバックへは入らず従来どおり
    `AutoProcessor`のみで完結する。
    """
    from transformers import AutoImageProcessor, AutoProcessor, TrOCRProcessor
    from transformers.image_processing_utils import BaseImageProcessor
    from transformers.models.auto.tokenization_auto import get_tokenizer_config

    try:
        processor = AutoProcessor.from_pretrained(model_ref, local_files_only=local_files_only)
        if not isinstance(processor, BaseImageProcessor):
            return processor
    except Exception:  # noqa: BLE001 — フォールバックへ進む（本体の例外は握り潰さず、フォールバックも失敗した場合にのみ後段で送出される）
        pass

    image_processor = AutoImageProcessor.from_pretrained(model_ref, local_files_only=local_files_only)
    tokenizer_config = get_tokenizer_config(model_ref, local_files_only=local_files_only)
    tokenizer_class_name = tokenizer_config.get("tokenizer_class")
    if not tokenizer_class_name:
        raise TrOCRModelLoadError(
            f"could not determine tokenizer_class from tokenizer_config.json for model_ref={model_ref!r}"
        )

    import transformers as transformers_module

    tokenizer_class = getattr(transformers_module, tokenizer_class_name, None)
    if tokenizer_class is None:
        raise TrOCRModelLoadError(
            f"unknown tokenizer_class {tokenizer_class_name!r} for model_ref={model_ref!r}"
        )
    tokenizer = tokenizer_class.from_pretrained(model_ref, local_files_only=local_files_only)
    return TrOCRProcessor(image_processor=image_processor, tokenizer=tokenizer)


def _backfill_config_token_ids(model: Any) -> None:
    """`model.config.pad_token_id`/`decoder_start_token_id`が欠けている場合、
    `model.generation_config`から補完する。

    Issue #164（TrOCR End-to-End Production Workflow Validation）で実際に学習を
    実行したところ、`VisionEncoderDecoderModel.forward()`（`labels`指定時に
    `decoder_input_ids`を`shift_tokens_right(labels, self.config.pad_token_id,
    self.config.decoder_start_token_id)`で組み立てる、`transformers`自身の
    docstring例にも明記されている標準的な使い方）が、`self.config.pad_token_id`
    に対し`AttributeError`（`'VisionEncoderDecoderConfig' object has no
    attribute 'pad_token_id'`）を送出することを確認した。これは、この
    `transformers`バージョンで`pad_token_id`/`decoder_start_token_id`が
    generation関連fieldとして`config`から`generation_config`側へ集約されている
    一方、`VisionEncoderDecoderModel.forward()`自体は依然`self.config`側を
    直接参照するために生じるgap（`generation_config`には正しい値が保持されて
    いることを確認済み）。既に`config`側に値がある場合は上書きしない
    （将来この`transformers`側のgapが解消された場合も無害。上書きし得るのは
    生成専用のtoken ID 2種のみで、他のモデル出力・学習semanticsには影響しない）。
    """
    generation_config = getattr(model, "generation_config", None)
    config = getattr(model, "config", None)
    if generation_config is None or config is None:
        return
    for field in ("pad_token_id", "decoder_start_token_id"):
        if getattr(config, field, None) is not None:
            continue
        value = getattr(generation_config, field, None)
        if value is not None:
            setattr(config, field, value)


class TrOCREngine:
    """TrOCR互換モデルをロードし、単一画像の文字認識を行う推論コア。

    `TrOCREngine.load(model_ref)`で生成し、同一インスタンスの`predict()`/
    `predict_file()`を繰り返し呼ぶことでモデルを再利用する。直接の
    コンストラクタ呼び出しは`load()`が返すインスタンスの複製目的以外では想定しない。
    """

    def __init__(self, *, processor: Any, model: Any, device: str, model_ref: str) -> None:
        self._processor = processor
        self._model = model
        self._device = device
        self._model_ref = model_ref

    @property
    def device(self) -> str:
        return self._device

    @property
    def model_ref(self) -> str:
        return self._model_ref

    @property
    def processor(self) -> Any:
        """ロード済みProcessor本体（Issue #92: TrOCR Training Backend Coreが再利用する）。

        `load()`のmodel_ref解決・device解決・transformers依存guardを複製せず、本Engineの
        build-once契約をそのまま学習にも適用するために公開する。推論（`predict()`/
        `predict_file()`）の既存契約・戻り値は変更しない。
        """
        return self._processor

    @property
    def model(self) -> Any:
        """ロード済みModel本体（Issue #92参照。用途は`processor`と同じ）。"""
        return self._model

    @classmethod
    def load(
        cls,
        model_ref: str,
        *,
        device: str | None = None,
        local_files_only: bool = False,
    ) -> "TrOCREngine":
        """Processor/Modelをロードし、指定deviceへ移動済みのTrOCREngineを返す。

        model_refはHugging Face Hub上のmodel ID・ローカルディレクトリパスの
        いずれも受け付ける（`from_pretrained()`にそのまま渡す）。特定のmodel ID
        （例: "microsoft/trocr-base-printed"）を既定値として固定することはしない。
        """
        if model_ref is None:
            raise ValueError("model_ref must not be None")
        if not isinstance(model_ref, str):
            raise ValueError(f"model_ref must be a string, got {type(model_ref)!r}")
        normalized_ref = model_ref.strip()
        if not normalized_ref:
            raise ValueError("model_ref must not be empty or whitespace-only")

        resolved_device = _resolve_device(device)

        try:
            import transformers  # noqa: F401
            from transformers import VisionEncoderDecoderModel
        except ImportError as e:
            raise TrOCRDependencyError(
                "transformers is not installed. Please run: pip install transformers"
            ) from e

        try:
            processor = _load_processor(normalized_ref, local_files_only=local_files_only)
        except Exception as e:  # noqa: BLE001
            raise TrOCRModelLoadError(
                f"failed to load TrOCR processor for model_ref={normalized_ref!r}: {e}"
            ) from e

        try:
            model = VisionEncoderDecoderModel.from_pretrained(normalized_ref, local_files_only=local_files_only)
        except Exception as e:  # noqa: BLE001
            raise TrOCRModelLoadError(
                f"failed to load TrOCR model for model_ref={normalized_ref!r}: {e}"
            ) from e

        try:
            model = model.to(resolved_device)
        except Exception as e:  # noqa: BLE001
            raise TrOCRModelLoadError(
                f"failed to move TrOCR model to device={resolved_device!r} for model_ref={normalized_ref!r}: {e}"
            ) from e

        _backfill_config_token_ids(model)

        model.eval()

        return cls(processor=processor, model=model, device=resolved_device, model_ref=normalized_ref)

    def predict(self, image: "Image.Image") -> TrOCRResult:
        """PIL画像1枚を認識し、TrOCRResultを返す。"""
        if image is None:
            raise ValueError("image must not be None")
        if not isinstance(image, Image.Image):
            raise ValueError(f"image must be a PIL.Image.Image, got {type(image)!r}")

        rgb_image = image.convert("RGB")  # 新規オブジェクトを返す。元画像は変更しない

        import torch  # 既存の必須依存

        try:
            pixel_values = self._processor(images=rgb_image, return_tensors="pt").pixel_values
        except Exception as e:  # noqa: BLE001
            raise TrOCRInferenceError(
                f"failed to preprocess image for model_ref={self._model_ref!r}: {e}"
            ) from e

        pixel_values = pixel_values.to(self._device)

        try:
            with torch.inference_mode():
                generated_ids = self._model.generate(pixel_values)
        except Exception as e:  # noqa: BLE001
            raise TrOCRInferenceError(
                f"failed to generate text for model_ref={self._model_ref!r}: {e}"
            ) from e

        try:
            decoded = self._processor.batch_decode(generated_ids, skip_special_tokens=True)
            text = decoded[0]
        except Exception as e:  # noqa: BLE001
            raise TrOCRInferenceError(
                f"failed to decode generated text for model_ref={self._model_ref!r}: {e}"
            ) from e

        # 前後空白は除去する。空文字自体は捏造せず、そのまま正常な結果として返す
        return TrOCRResult(text=text.strip(), model_ref=self._model_ref)

    def predict_file(self, path: "str | Path") -> TrOCRResult:
        """画像ファイルを開いて認識する。predict()の薄いラッパー。"""
        if path is None:
            raise ValueError("path must not be None")

        resolved_path = Path(path)
        if not resolved_path.exists():
            raise FileNotFoundError(f"image file not found: {resolved_path}")
        if resolved_path.is_dir():
            raise ValueError(f"path must be a file, not a directory: {resolved_path}")

        try:
            with Image.open(resolved_path) as opened:
                opened.load()
                image = opened.copy()
        except (UnidentifiedImageError, OSError) as e:
            raise ValueError(f"failed to open image file: {resolved_path}: {e}") from e

        return self.predict(image)
