"""Metadata Reader（Canonical/Legacy Metadataファイルを読み込みModelMetadataを返す）。

docs/design/MODEL_METADATA_ARCHITECTURE.md 6.7（Reader）のうち、本Issue（Metadata
Reader、Migration Phase 2）で実装する範囲のみを対象とする。

設計方針:
- Readerは渡された単一のPath（1ファイル）を読み込むのみ。`glob`/`os.walk`/ディレクトリ
  スキャン・複数ファイルの列挙は行わない（Model Catalogの責務、本Issue対象外）
- Canonical sidecar（`<model>.model_metadata.json`、Architecture 6.2）は
  `ModelMetadata.from_dict()`へ直接委譲する
- Legacy形式（`.ocr.json`/`.tess.json`/`.trocr.json`/`inference_model.json`）は
  `legacy_metadata_adapter.LegacyMetadataAdapter`へ委譲する（Reader自身は変換ロジックを
  持たない）。形式判定はファイル名のみで行う（内容を見て推測しない）
- `.trocr.json`はIssue #110（TrOCR Legacy Metadata Adapter Compatibility）で追加。
  `.ocr.json`/`.tess.json`と同じ`source`既定値（`"backfill"`）で扱う
- Validationは一切自前で書かず、最終的に必ず`ModelMetadata.from_dict()`（Adapter経由も
  含め）に委ねる
- Metadataの保存・更新・削除・Model Catalogの更新は行わない（Writer/Catalogの責務）

Design Decision（METADATA_READER_DESIGN_NOTES.md、本Issueで決定・実装）:
- `inference_model_id`優先順位: 呼び出し側が`model_id`を明示指定した場合はそれを優先する。
  指定が無い場合のみ、`inference_model.json`内の`inference_model_id`へfallbackする
  （`.ocr.json`/`.tess.json`にはこのフィールドが無いため対象外。fallbackもできない場合は
  `model_id=None`のまま`LegacyMetadataAdapter`へ渡し、`ModelMetadata.from_dict()`の既存
  Validationが欠損として拒否する）
- `source`（training/backfill）: Readerは既存モデルへの遡及的な読み取りであるため、
  Legacy OCR/Tesseract変換時は`source="backfill"`を既定値とする（Adapterを直接呼ぶ場合の
  既定値`"training"`とは区別する。呼び出し側が明示指定すれば上書きできる）
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Optional, Union

from .legacy_metadata_adapter import (
    LEGACY_FORMAT_INFERENCE_MODEL_JSON,
    LEGACY_FORMAT_OCR_JSON,
    LEGACY_FORMAT_TESS_JSON,
    LEGACY_FORMAT_TROCR_JSON,
    LegacyMetadataAdapter,
    UnsupportedLegacyMetadataError,
)
from .model_metadata import ModelMetadata

# Canonical sidecarファイルの命名規則（Architecture 6.2で決定済み）。
# 例: digits_20260101.tess.json.model_metadata.json / resnet_20260101.pt.model_metadata.json
CANONICAL_METADATA_SIDECAR_SUFFIX = ".model_metadata.json"

PathLike = Union[str, Path]


class MetadataReadError(OSError):
    """Metadataファイルの読込・JSON解析に失敗した（存在しない・権限無し・不正なJSON等）。

    `UnsupportedLegacyMetadataError`（形式が未対応）・`InvalidModelMetadataError`
    （内容がValidationに違反）とは異なる、I/Oレベルの問題を表す。元の例外は
    `__cause__`（`raise ... from e`）で保持する。
    """


def _read_json_file(path: Path) -> Any:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise MetadataReadError(f"failed to read metadata file: {path}") from e
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise MetadataReadError(f"failed to parse metadata file as JSON: {path}") from e


class MetadataReader:
    """Canonical/Legacy Metadataファイルを読み込み、`ModelMetadata`を返す唯一のReader。

    ```
    Canonical Metadata → ModelMetadata
    Legacy Metadata → LegacyMetadataAdapter → ModelMetadata
    ```
    """

    @staticmethod
    def read_canonical(path: PathLike) -> ModelMetadata:
        """Canonical sidecarファイルを読み込む。`schema_version`検証は`from_dict()`へ委譲する。"""
        payload = _read_json_file(Path(path))
        return ModelMetadata.from_dict(payload)

    @staticmethod
    def read_legacy(
        path: PathLike,
        legacy_format: str,
        *,
        model_id: Optional[str] = None,
        source: str = "backfill",
    ) -> ModelMetadata:
        """Legacyファイルを読み込み、`LegacyMetadataAdapter`へ委譲する。

        `model_id`省略時、`legacy_format`が`inference_model_json`であればファイル内の
        `inference_model_id`へfallbackする（Design Decision）。それ以外の形式でfallback
        できる値が無い場合は`None`のまま渡し、`ModelMetadata.from_dict()`の既存Validationに
        欠損として判定させる（Reader自身で「必須」を判定しない）。
        """
        payload = _read_json_file(Path(path))
        resolved_model_id = model_id
        if resolved_model_id is None and legacy_format == LEGACY_FORMAT_INFERENCE_MODEL_JSON:
            if isinstance(payload, Mapping):
                fallback = payload.get("inference_model_id")
                if fallback:
                    resolved_model_id = str(fallback)

        if legacy_format in (LEGACY_FORMAT_OCR_JSON, LEGACY_FORMAT_TESS_JSON, LEGACY_FORMAT_TROCR_JSON):
            return LegacyMetadataAdapter.adapt(
                legacy_format, payload, model_id=resolved_model_id, source=source
            )
        return LegacyMetadataAdapter.adapt(legacy_format, payload, model_id=resolved_model_id)

    @staticmethod
    def read(path: PathLike, *, model_id: Optional[str] = None) -> ModelMetadata:
        """ファイル名からCanonical/Legacyの別・Legacy形式種別を判定し、適切な経路で読み込む。

        判定はファイル名のみで行う（内容を見て推測しない）。既知のいずれのパターンにも
        一致しない場合は`UnsupportedLegacyMetadataError`を送出する。
        """
        name = Path(path).name
        if name.endswith(CANONICAL_METADATA_SIDECAR_SUFFIX):
            return MetadataReader.read_canonical(path)
        if name.endswith(".ocr.json"):
            return MetadataReader.read_legacy(path, LEGACY_FORMAT_OCR_JSON, model_id=model_id)
        if name.endswith(".tess.json"):
            return MetadataReader.read_legacy(path, LEGACY_FORMAT_TESS_JSON, model_id=model_id)
        if name.endswith(".trocr.json"):
            return MetadataReader.read_legacy(path, LEGACY_FORMAT_TROCR_JSON, model_id=model_id)
        if name == "inference_model.json":
            return MetadataReader.read_legacy(path, LEGACY_FORMAT_INFERENCE_MODEL_JSON, model_id=model_id)
        raise UnsupportedLegacyMetadataError(f"unrecognized metadata file name: {name!r}")
