"""Engine Capability（OCRエンジンの機能差異を宣言的に表現する共通データ型）。

docs/design/ENGINE_CAPABILITY.md のスキーマ設計をPythonの型付き実装へ落とし込む。

設計方針（同ドキュメントより）:
- Capability = そのエンジン実装が「原理的に何をできるか」（静的・エンジン単位）
- Metadata（services/以下の別モジュールで今後実装）= ある1つの学習済みモデルが
  「実際に何であるか」（動的・モデルインスタンス単位）。実際の学習言語・charset・
  ライセンス等はここに含めない
- 既存3エンジン（Tesseract/PaddleOCR/EasyOCR）の `if/elif` 分岐（predict.py等）は
  本モジュールでは一切変更・参照しない。Capabilityは新規追加分の参照用データであり、
  既存コードからの利用は別Issue（Engine Registry）で扱う
- TrOCRはまだ実装されていないため、Capabilityの値は一次資料
  （docs/workitems/trocr/ARCHITECTURE_DRAFT.md）に基づく設計時点の想定であり、
  未検証の項目は推測補完せず False / 空リスト / None のまま残す
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Mapping

ENGINE_ID_TESSERACT = "tesseract"
ENGINE_ID_PADDLEOCR = "paddleocr"
ENGINE_ID_EASYOCR = "easyocr"
ENGINE_ID_TROCR = "trocr"

# 現時点で定義済みのEngine ID一覧。将来のエンジン追加時はここへ定数を足すだけでよく、
# EngineCapability自体の構造変更は不要（engine_idはstr型のため未知のIDも許容する）。
KNOWN_ENGINE_IDS: tuple[str, ...] = (
    ENGINE_ID_TESSERACT,
    ENGINE_ID_PADDLEOCR,
    ENGINE_ID_EASYOCR,
    ENGINE_ID_TROCR,
)


@dataclass(frozen=True)
class EngineCapability:
    """OCRエンジンの機能差異を表す不変（frozen）データ。1エンジン実装につき1インスタンス。

    フィールド構成は docs/design/ENGINE_CAPABILITY.md の9カテゴリ
    （基本情報/学習/推論/評価/Export/Hardware/Language/Dataset/Metadata連携）に対応する。
    """

    # --- 基本情報 ---
    engine_id: str
    display_name: str
    description: str = ""
    version: str = "1.0.0"
    framework: str = ""
    license: str = ""
    supported_platforms: tuple[str, ...] = field(default_factory=tuple)

    # --- 学習 ---
    supports_training: bool = False
    supports_resume_training: bool = False
    supports_finetuning: bool = False
    supports_custom_dataset: bool = False
    supports_custom_charset: bool = False
    supports_dictionary: bool = False
    supports_augmentation: bool = False
    supports_mixed_precision: bool = False
    supports_distributed_training: bool = False

    # --- 推論 ---
    supports_inference: bool = True
    supports_batch_inference: bool = False
    supports_streaming: bool = False
    supports_beam_search: bool = False
    supports_confidence: bool = False
    supports_dictionary_postprocess: bool = False
    supports_orientation: bool = False
    supports_detection: bool = False
    supports_recognition: bool = True
    supports_layout: bool = False

    # --- 評価 ---
    supports_evaluation: bool = False
    supports_character_accuracy: bool = False
    supports_word_accuracy: bool = False
    supports_cer: bool = False
    supports_wer: bool = False
    supports_confusion_matrix: bool = False

    # --- Export ---
    supports_export: bool = False
    supported_export_formats: tuple[str, ...] = field(default_factory=tuple)
    supports_onnx: bool = False
    supports_torchscript: bool = False
    supports_quantization: bool = False

    # --- Hardware ---
    supports_cpu: bool = True
    supports_cuda: bool = False
    supports_mps: bool = False
    supports_directml: bool = False
    minimum_vram: int | None = None
    recommended_vram: int | None = None

    # --- Language ---
    supported_languages: tuple[str, ...] = field(default_factory=tuple)
    supports_multilingual: bool = False
    supports_unicode: bool = False
    supports_vertical_text: bool = False
    supports_handwriting: bool = False

    # --- Dataset ---
    accepted_dataset_types: tuple[str, ...] = field(default_factory=tuple)
    required_annotations: tuple[str, ...] = field(default_factory=tuple)
    required_image_format: tuple[str, ...] = field(default_factory=tuple)

    # --- Metadata連携（Engine CapabilityとModel Metadataを繋ぐ唯一の連携ポイント） ---
    required_metadata: tuple[str, ...] = field(default_factory=tuple)
    optional_metadata: tuple[str, ...] = field(default_factory=tuple)

    # frozenでも要素の追加・削除ができてしまう可変な list を混入させない
    # （from_dict経由でJSON由来のlistが渡された場合も含め、常にtupleへ矯正する）。
    _SEQUENCE_FIELDS = (
        "supported_platforms",
        "supported_export_formats",
        "supported_languages",
        "accepted_dataset_types",
        "required_annotations",
        "required_image_format",
        "required_metadata",
        "optional_metadata",
    )

    def __post_init__(self) -> None:
        for name in self._SEQUENCE_FIELDS:
            value = getattr(self, name)
            if not isinstance(value, tuple):
                object.__setattr__(self, name, tuple(value))

    def to_dict(self) -> dict[str, Any]:
        """辞書へシリアライズする（JSON保存・将来のAPI応答等に利用できる）。"""
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EngineCapability":
        """to_dict() で得た辞書からEngineCapabilityを復元する。未知キーは無視する。"""
        known_fields = {f.name for f in dataclasses.fields(cls)}
        filtered = {k: v for k, v in data.items() if k in known_fields}
        return cls(**filtered)


def _tesseract_capability() -> EngineCapability:
    return EngineCapability(
        engine_id=ENGINE_ID_TESSERACT,
        display_name="Tesseract",
        description="外部実行ファイル（lstmtraining）によるLSTM学習・行認識エンジン",
        framework="",
        license="Apache-2.0",
        supported_platforms=["windows"],
        supports_training=True,
        supports_finetuning=True,
        supports_custom_dataset=True,
        supports_custom_charset=True,
        supports_augmentation=True,
        supports_batch_inference=True,
        supports_confidence=True,
        supports_dictionary_postprocess=True,
        supports_orientation=True,
        supports_recognition=True,
        supports_evaluation=True,
        supports_character_accuracy=True,
        supports_cer=True,
        supports_confusion_matrix=True,
        supports_export=True,
        supported_export_formats=["traineddata"],
        supports_cpu=True,
        supports_handwriting=True,
        accepted_dataset_types=["line_image_text_pair"],
        required_annotations=["text"],
        required_image_format=["png"],
        required_metadata=["engine", "charset", "checkpoint"],
        optional_metadata=["language", "training_config", "dataset", "experiment", "metrics"],
    )


def _paddleocr_capability() -> EngineCapability:
    return EngineCapability(
        engine_id=ENGINE_ID_PADDLEOCR,
        display_name="PaddleOCR",
        description="外部リポジトリ（external/PaddleOCR）のスクリプトをサブプロセス実行して学習する認識専用エンジン",
        framework="paddlepaddle",
        license="Apache-2.0",
        supported_platforms=["windows"],
        supports_training=True,
        supports_finetuning=True,
        supports_custom_dataset=True,
        supports_custom_charset=True,
        supports_augmentation=True,
        supports_mixed_precision=True,
        supports_batch_inference=True,
        supports_confidence=True,
        supports_dictionary_postprocess=True,
        supports_orientation=True,
        supports_recognition=True,
        supports_evaluation=True,
        supports_export=True,
        supported_export_formats=["paddle_inference"],
        supports_cpu=True,
        supports_cuda=True,
        accepted_dataset_types=["line_image_text_pair"],
        required_annotations=["text"],
        required_image_format=["png"],
        required_metadata=["engine", "checkpoint"],
        optional_metadata=[
            "charset",
            "language",
            "training_config",
            "dataset",
            "experiment",
            "metrics",
            "export_format",
        ],
    )


def _easyocr_capability() -> EngineCapability:
    return EngineCapability(
        engine_id=ENGINE_ID_EASYOCR,
        display_name="EasyOCR",
        description="推論専用ライブラリ。独自の検出+認識パイプラインを内包し学習機能を持たない",
        framework="pytorch",
        license="Apache-2.0",
        supported_platforms=["windows"],
        supports_batch_inference=True,
        supports_confidence=True,
        supports_dictionary_postprocess=True,
        supports_orientation=True,
        supports_detection=True,
        supports_recognition=True,
        supports_evaluation=True,
        supports_cpu=True,
        supports_cuda=True,
        supports_multilingual=True,
        supports_handwriting=True,
    )


def _trocr_capability() -> EngineCapability:
    return EngineCapability(
        engine_id=ENGINE_ID_TROCR,
        display_name="TrOCR",
        description=(
            "Hugging Face TransformersのVisionEncoderDecoderModelによる"
            "End-to-End文字認識エンジン（未実装、Capabilityのみ定義）"
        ),
        framework="transformers",
        license="MIT",
        supported_platforms=[],
        supports_training=True,
        supports_resume_training=True,
        supports_finetuning=True,
        supports_custom_dataset=True,
        supports_mixed_precision=True,
        supports_batch_inference=True,
        supports_beam_search=True,
        supports_dictionary_postprocess=True,
        supports_orientation=True,
        supports_recognition=True,
        supports_export=True,
        supported_export_formats=["safetensors", "pytorch_bin"],
        supports_cpu=True,
        supports_cuda=True,
        supported_languages=["en"],
        supports_handwriting=True,
        accepted_dataset_types=["line_image_text_pair"],
        required_annotations=["text"],
        required_image_format=["png"],
        required_metadata=["engine", "checkpoint", "processor", "tokenizer", "license"],
        optional_metadata=["language", "training_config", "dataset", "experiment", "metrics"],
    )


# 既知エンジンのCapability一覧。今回はこのモジュール単体で完結させ、
# Engine Registry（別Issue）からの参照・既存if/elif分岐への配線は行わない。
# MappingProxyTypeで読み取り専用にし、外部からのキー追加・削除・値の差し替えを防ぐ
# （値自体のEngineCapabilityはfrozen dataclassのため、これで全体が変更不可になる）。
BUILTIN_CAPABILITIES: Mapping[str, EngineCapability] = MappingProxyType(
    {
        ENGINE_ID_TESSERACT: _tesseract_capability(),
        ENGINE_ID_PADDLEOCR: _paddleocr_capability(),
        ENGINE_ID_EASYOCR: _easyocr_capability(),
        ENGINE_ID_TROCR: _trocr_capability(),
    }
)


def get_builtin_capability(engine_id: str) -> EngineCapability:
    """既知エンジンのCapabilityを返す。未知のengine_idは KeyError。"""
    return BUILTIN_CAPABILITIES[engine_id]
