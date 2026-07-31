"""Model Catalog（ディレクトリを走査してModelMetadata一覧を提供する唯一のCatalog）。

docs/design/MODEL_METADATA_ARCHITECTURE.md 6.9（Model Catalog）のうち、本Issue
（Model Catalog、Migration Phase 3）で実装する範囲のみを対象とする。

設計方針:
- Directory探索（`iterdir`等）はCatalogのみが行う。`MetadataReader`（Feature #36）へは
  常に単一のPathのみを渡す（Readerへ探索責務を持たせない。Reader/Writer自体への
  機能追加は本Issueで行わない）
- 同一モデルについてCanonical sidecar（`<model>.model_metadata.json`）とLegacyファイルの
  両方が存在する場合、必ずCanonicalを採用しLegacyは無視する（読み取り込みマージはしない、
  Architecture 6.7/6.8の既存方針と整合）
- Canonicalが存在しない場合のみ、対応するLegacyファイルを`MetadataReader.read_legacy()`
  経由で採用する
- 同一`model_id`はCatalog内で一意にする（重複排除。走査順で先に見つかった方を採用する）
- CatalogはValidationを書かない。ファイルの読込・変換は常に`MetadataReader`（延いては
  `ModelMetadata.from_dict()`/`LegacyMetadataAdapter`）へ委譲する
- `ModelCatalogError`はディレクトリ探索エラー（対象ディレクトリが存在しない・権限無し・
  model_idが見つからない等）のみを表す。Reader由来の例外
  （`MetadataReadError`/`InvalidModelMetadataError`/`UnsupportedLegacyMetadataError`）は
  握りつぶさず、そのまま呼び出し側へ伝播させる

スコープ決定（本Issueの範囲外とした事項、詳細はdocs/workitems/model-metadata/MODEL_CATALOG_DESIGN_NOTES.md参照）:
- `inference_model.json`（プロジェクトルート直下の「現在選択中モデル」を指すポインタで
  あり、モデル成果物そのものではない）は本Catalogの`list()`対象に含めない
- `.pt`（分類モデル）のLegacy変換は、対応する`LegacyMetadataAdapter`が存在しないため
  対象外（Feature #34時点の既存の制約を引き継ぐ。Canonical sidecarが別途書き込まれて
  いれば`<name>.pt.model_metadata.json`として通常どおり検出される）
- Legacyファイルのみが存在する（Canonical未書込の）モデルのmodel_idは、既存の
  `data/model_ids.json`（M0001形式）への配線をまだ行わず、暫定的にLegacyファイル自身の
  ファイル名をmodel_idとして採用する（`model_registry.py`との統合は将来のIssueで判断する）
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Union

from .legacy_metadata_adapter import (
    LEGACY_FORMAT_OCR_JSON,
    LEGACY_FORMAT_TESS_JSON,
)
from .metadata_reader import CANONICAL_METADATA_SIDECAR_SUFFIX, MetadataReader
from .model_metadata import ModelMetadata

PathLike = Union[str, Path]

_LEGACY_SUFFIX_FORMATS = (
    (".ocr.json", LEGACY_FORMAT_OCR_JSON),
    (".tess.json", LEGACY_FORMAT_TESS_JSON),
)


class ModelCatalogError(LookupError):
    """Model Catalogのディレクトリ探索・検索に関するエラー（対象ディレクトリが存在しない・
    権限無し・指定model_idが見つからない等）。

    Reader由来の例外（`MetadataReadError`/`InvalidModelMetadataError`/
    `UnsupportedLegacyMetadataError`）とは異なる概念であり、それらは握りつぶさず
    そのまま伝播させる（本例外へ変換しない）。
    """


def _legacy_format_for(name: str) -> Optional[str]:
    for suffix, legacy_format in _LEGACY_SUFFIX_FORMATS:
        if name.endswith(suffix):
            return legacy_format
    return None


class ModelCatalog:
    """指定ディレクトリを走査し、`ModelMetadata`一覧を提供する唯一のCatalog。

    ```
    Directory → Metadata File一覧 → MetadataReader → ModelMetadata[]
    ```
    """

    def __init__(self, directory: PathLike) -> None:
        self._directory = Path(directory)

    def _iter_entries(self):
        try:
            return sorted(self._directory.iterdir(), key=lambda p: p.name)
        except OSError as e:
            raise ModelCatalogError(f"failed to scan directory: {self._directory}") from e

    def _scan(self) -> list[ModelMetadata]:
        canonical_bases: dict[str, Path] = {}
        legacy_candidates: list[tuple[Path, str]] = []

        for entry in self._iter_entries():
            if not entry.is_file():
                continue
            name = entry.name
            if name.endswith(CANONICAL_METADATA_SIDECAR_SUFFIX):
                base_name = name[: -len(CANONICAL_METADATA_SIDECAR_SUFFIX)]
                if base_name not in canonical_bases:
                    canonical_bases[base_name] = entry
                continue
            legacy_format = _legacy_format_for(name)
            if legacy_format is not None:
                legacy_candidates.append((entry, legacy_format))

        results: dict[str, ModelMetadata] = {}

        # Canonicalを優先して採用する（走査順で先に見つかったmodel_idが勝つ）
        for sidecar_path in canonical_bases.values():
            metadata = MetadataReader.read_canonical(sidecar_path)
            if metadata.model_id not in results:
                results[metadata.model_id] = metadata

        # Canonicalが存在しないbaseのみ、Legacyを採用する（マージしない・Legacyは無視）
        for legacy_path, legacy_format in legacy_candidates:
            if legacy_path.name in canonical_bases:
                continue
            metadata = MetadataReader.read_legacy(legacy_path, legacy_format, model_id=legacy_path.name)
            if metadata.model_id not in results:
                results[metadata.model_id] = metadata

        return list(results.values())

    def list(self) -> list[ModelMetadata]:
        """ディレクトリ内の全モデルの`ModelMetadata`一覧を返す（Canonical優先・重複排除済み）。"""
        return self._scan()

    def find(self, model_id: str) -> Optional[ModelMetadata]:
        """`model_id`に一致する`ModelMetadata`を返す。見つからない場合は`None`。"""
        for metadata in self._scan():
            if metadata.model_id == model_id:
                return metadata
        return None

    def load(self, model_id: str) -> ModelMetadata:
        """`model_id`に一致する`ModelMetadata`を返す。見つからない場合は`ModelCatalogError`。"""
        metadata = self.find(model_id)
        if metadata is None:
            raise ModelCatalogError(f"model not found: {model_id!r}")
        return metadata

    def exists(self, model_id: str) -> bool:
        """`model_id`に一致するモデルがディレクトリ内に存在するかどうかを返す。"""
        return self.find(model_id) is not None
