"""Legacy Metadata Adapter（既存Metadata形式をCanonical ModelMetadataへ変換する）。

docs/design/MODEL_METADATA_ARCHITECTURE.md 6.6（Adapter）のうち、本Issue（Legacy
Metadata Adapter、Migration Phase 1の残り）で実装する範囲のみを対象とする。

設計方針:
- 各Adapterの責務は「Legacy形式のdict → ModelMetadata」の変換のみ。Filesystemへの
  アクセス（`Path.exists`/`glob`/`os.walk`等）は一切行わない（Reader/Writerの責務）
- Adapter内で独自のValidationは書かない。変換結果は必ず`ModelMetadata.from_dict()`
  （Canonical Schema、Feature #14/#32）へ委譲し、Validationはそちらに一本化する
- Engine判定は`ModelMetadata.from_dict()`が内部で使う`engine_registry.resolve_engine_id()`
  にすべて委ねる（Adapter側でengine名を推測・変換・フォールバックしない）
- `model_id`はLegacy形式のファイル内容から一意に決定できない（`.tess.json`は保持せず、
  `.ocr.json`の`name`は拡張子を除いたファイル名断片に過ぎない）ため、呼び出し側
  （将来のReader/Catalog、本Issueの対象外）が解決した値を明示的に渡す前提とする
- `OCRMetadataAdapter`/`TesseractMetadataAdapter`/`InferenceMetadataAdapter`は将来
  増える他形式（Adapter追加）を見据え、`LegacyMetadataAdapter`から独立したクラスとして
  分離するが、Factory・Registry・Plugin・DIといった動的解決の仕組みは導入しない
  （既知3形式の固定的なif/elif分岐のみ）
"""

from __future__ import annotations

from typing import Any, Mapping

from .model_metadata import ModelMetadata

LEGACY_FORMAT_OCR_JSON = "ocr_json"
LEGACY_FORMAT_TESS_JSON = "tess_json"
LEGACY_FORMAT_INFERENCE_MODEL_JSON = "inference_model_json"

KNOWN_LEGACY_FORMATS = (
    LEGACY_FORMAT_OCR_JSON,
    LEGACY_FORMAT_TESS_JSON,
    LEGACY_FORMAT_INFERENCE_MODEL_JSON,
)


class UnsupportedLegacyMetadataError(ValueError):
    """未対応のLegacy Metadata形式が指定された（既知3形式以外）。

    Engineが不正/未登録であることを示す`InvalidModelMetadataError`（
    `ModelMetadata.from_dict()`由来）とは異なる概念であるため、別の例外として区別する。
    """


def _adapt_via(data: Any, build_canonical: "Any") -> ModelMetadata:
    """`data`がMappingでなければ、フィールド読取り（`.get()`）を試みず`data`自体をそのまま
    `ModelMetadata.from_dict()`へ渡す。

    Adapterは独自にValidationを書かない方針のため、「Mappingでない」という型不正の判定・
    エラーメッセージも自前で作らず、既存の`from_dict()`（`isinstance(data, Mapping)`チェック）
    にそのまま委譲する。これが無いと`data.get(...)`呼び出し自体が無関係な`AttributeError`を
    送出してしまい、呼び出し側から見た例外の一貫性が崩れる。
    """
    if not isinstance(data, Mapping):
        return ModelMetadata.from_dict(data)
    return ModelMetadata.from_dict(build_canonical(data))


class OCRMetadataAdapter:
    """`.ocr.json`（PaddleOCR等の学習成果物メタ、`ocr_pipeline.py::_register_ocr_model()`が
    生成する形式）をModelMetadataへ変換する。
    """

    @staticmethod
    def _build_canonical(data: Mapping[str, Any], model_id: str, source: str) -> dict[str, Any]:
        return {
            "model_id": model_id,
            "engine_id": data.get("engine"),
            "model_type": data.get("model_type"),
            "created_at": data.get("created_at"),
            # inference_dir（Export後の推論用ディレクトリ）を優先し、無ければmodel_dirへ
            "artifact_path": data.get("inference_dir") or data.get("model_dir"),
            "dataset_id": data.get("dataset_id"),
            "source": source,
        }

    @staticmethod
    def adapt(data: Mapping[str, Any], *, model_id: str, source: str = "training") -> ModelMetadata:
        """`source`の既定値は`"training"`（Adapterを直接呼ぶ場合の既定。Feature #34時点の挙動を
        後方互換で維持する）。Metadata Reader（Feature #36）はこれを`"backfill"`で上書きする
        （[METADATA_READER_DESIGN_NOTES.md](../../workitems/model-metadata/METADATA_READER_DESIGN_NOTES.md)
        の決定どおり、既存モデルへの遡及読み取りであるため）。
        """
        return _adapt_via(data, lambda d: OCRMetadataAdapter._build_canonical(d, model_id, source))


class TesseractMetadataAdapter:
    """`.tess.json`（Tesseract学習成果物メタ、`tesseract_pipeline.py::register_tesseract_model()`
    が生成する形式）をModelMetadataへ変換する。
    """

    @staticmethod
    def _build_canonical(data: Mapping[str, Any], model_id: str, source: str) -> dict[str, Any]:
        return {
            "model_id": model_id,
            "engine_id": data.get("engine"),
            "model_type": data.get("model_type"),
            "created_at": data.get("created_at"),
            # tessdata_dir（traineddata配置先）を優先し、無ければmodel_dirへ
            "artifact_path": data.get("tessdata_dir") or data.get("model_dir"),
            "dataset_id": data.get("dataset_id"),
            "source": source,
        }

    @staticmethod
    def adapt(data: Mapping[str, Any], *, model_id: str, source: str = "training") -> ModelMetadata:
        """`source`の既定値は`OCRMetadataAdapter.adapt()`と同じ理由で`"training"`。"""
        return _adapt_via(data, lambda d: TesseractMetadataAdapter._build_canonical(d, model_id, source))


class InferenceMetadataAdapter:
    """`inference_model.json`（推論使用モデルの選択状態、`services/inference_model.py`が
    生成する形式）をModelMetadataへ変換する。

    この形式は学習成果物メタではなく「現在選択中のモデル」を指すプロジェクト単位の
    フラットレコードであるため、`source`（training/backfillの区別）は対応する概念が
    存在せず、Noneのまま扱う（存在しない値を想像で補わない）。
    """

    @staticmethod
    def _build_canonical(data: Mapping[str, Any], model_id: str) -> dict[str, Any]:
        return {
            "model_id": model_id,
            "engine_id": data.get("engine"),
            # "model"は選択中モデルの参照（ファイル名またはmodel_ref相当）。Resolver層の
            # model_ref/artifact_path分離（Architecture 6.5・6.10）は後続Issueの責務であり、
            # 本Adapterでは最も近い既存フィールドartifact_pathへ割り当てる
            "artifact_path": data.get("model"),
            "updated_at": data.get("updated_at"),
        }

    @staticmethod
    def adapt(data: Mapping[str, Any], *, model_id: str) -> ModelMetadata:
        return _adapt_via(data, lambda d: InferenceMetadataAdapter._build_canonical(d, model_id))


class LegacyMetadataAdapter:
    """Legacy Metadata（`.ocr.json`/`.tess.json`/`inference_model.json`）からModelMetadataへの
    変換の入口。実際の変換は各専用Adapterへ委譲する。

    ```
    LegacyMetadataAdapter
        │
        ├── OCRMetadataAdapter
        ├── TesseractMetadataAdapter
        └── InferenceMetadataAdapter
    ```

    将来Adapterが増えることを前提に専用クラスへ分離しているが、動的な登録・解決の仕組み
    （Factory/Registry/Plugin/DI）は導入しない。`adapt()`は既知3形式の固定的なif/elif分岐
    のみで委譲先を決定する。
    """

    @staticmethod
    def from_ocr_json(data: Mapping[str, Any], *, model_id: str, source: str = "training") -> ModelMetadata:
        return OCRMetadataAdapter.adapt(data, model_id=model_id, source=source)

    @staticmethod
    def from_tess_json(data: Mapping[str, Any], *, model_id: str, source: str = "training") -> ModelMetadata:
        return TesseractMetadataAdapter.adapt(data, model_id=model_id, source=source)

    @staticmethod
    def from_inference_model_json(data: Mapping[str, Any], *, model_id: str) -> ModelMetadata:
        return InferenceMetadataAdapter.adapt(data, model_id=model_id)

    @staticmethod
    def adapt(legacy_format: str, data: Mapping[str, Any], *, model_id: str, source: str = "training") -> ModelMetadata:
        """`legacy_format`（既知3形式のいずれか）に応じて適切な専用Adapterへ委譲する。

        既知3形式以外が指定された場合は`UnsupportedLegacyMetadataError`を送出する
        （Engine不正等の`InvalidModelMetadataError`とは異なる、形式自体が未対応という意味）。
        `source`は`inference_model_json`には適用されない（この形式に対応する概念が無いため）。
        """
        if legacy_format == LEGACY_FORMAT_OCR_JSON:
            return LegacyMetadataAdapter.from_ocr_json(data, model_id=model_id, source=source)
        if legacy_format == LEGACY_FORMAT_TESS_JSON:
            return LegacyMetadataAdapter.from_tess_json(data, model_id=model_id, source=source)
        if legacy_format == LEGACY_FORMAT_INFERENCE_MODEL_JSON:
            return LegacyMetadataAdapter.from_inference_model_json(data, model_id=model_id)
        raise UnsupportedLegacyMetadataError(
            f"unsupported legacy metadata format: {legacy_format!r} (known: {KNOWN_LEGACY_FORMATS!r})"
        )
