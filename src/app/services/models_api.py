"""Models API（UI ↔ Catalog / Factory / Writer の橋渡しを行うFacade）。

docs/design/MODEL_METADATA_ARCHITECTURE.md「Models API」（Migration Phase 5）のうち、
本Issue（Models API、#44）で実装する範囲のみを対象とする。

```
UI → Models API → Catalog / Factory / Writer
```

設計方針:
- Models API自身はMetadataを保持しない（状態を持たないFacade）
- Directory探索は`ModelCatalog`（Feature #40）のみに委譲する。`MetadataReader`は
  直接利用しない（常にCatalog経由）
- Metadata生成は`ModelMetadataFactory.create_from_training()`（Feature #42）のみへ
  委譲する
- Metadata保存は`MetadataWriter.write()`（Feature #38）のみへ委譲する
- Validationは自前で一切書かない。Catalog/Factory/Writerがそれぞれ委譲する先
  （`ModelMetadata.from_dict()`等）にすべて委ねる
- Catalog/Factory/Writerの責務・実装は本Issueで変更しない（無変更）
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional, Union

from .metadata_writer import MetadataWriter
from .model_catalog import ModelCatalog
from .model_metadata import ModelMetadata
from .training_metadata_factory import ModelMetadataFactory

PathLike = Union[str, Path]


class ModelsAPIError(Exception):
    """Models API層（Facade）自身に起因する例外。

    Catalog/Factory/Writerが送出する例外（`ModelCatalogError`/`MetadataReadError`/
    `UnsupportedLegacyMetadataError`/`InvalidModelMetadataError`/`MetadataWriteError`/
    `TrainingMetadataFactoryError`）はそのまま伝播させ、本例外でラップしない
    （下位層の例外は握りつぶさない、というEpic #28全体の方針と同じ）。

    本例外は、Facade自体の呼び出し形状が不正な場合（コンストラクタへ渡された
    `directory`がstr/Pathでない、`create_metadata()`が必須キーワード引数を欠いた
    状態で呼ばれた等）にのみ用いる。
    """


class ModelsAPI:
    """Model一覧取得・詳細取得・存在確認・Metadata生成・保存を提供するFacade。"""

    def __init__(self, directory: PathLike) -> None:
        if not isinstance(directory, (str, Path)):
            raise ModelsAPIError(f"directory must be a str or Path, got {type(directory)!r}")
        self._catalog = ModelCatalog(directory)

    def list_models(self) -> list[ModelMetadata]:
        """`ModelCatalog.list()`への薄い委譲。"""
        return self._catalog.list()

    def get_model(self, model_id: str) -> ModelMetadata:
        """`ModelCatalog.load()`への薄い委譲（見つからない場合は`ModelCatalogError`）。"""
        return self._catalog.load(model_id)

    def exists(self, model_id: str) -> bool:
        """`ModelCatalog.exists()`への薄い委譲。"""
        return self._catalog.exists(model_id)

    @staticmethod
    def create_metadata(**kwargs: Any) -> ModelMetadata:
        """`ModelMetadataFactory.create_from_training()`への薄い委譲。

        呼び出し自体が必須キーワード引数（`model_id`/`engine`）を欠いている等、
        Factory呼び出しに至る前の入力形状そのものが不正な場合は`ModelsAPIError`で
        ラップする。Factory自身が検出する`extra`衝突（`TrainingMetadataFactoryError`）や
        `ModelMetadata.from_dict()`のValidation違反（`InvalidModelMetadataError`）は
        ラップせずそのまま伝播させる。
        """
        try:
            return ModelMetadataFactory.create_from_training(**kwargs)
        except TypeError as e:
            raise ModelsAPIError(f"invalid arguments for create_metadata(): {e}") from e

    @staticmethod
    def save_metadata(path: PathLike, metadata: ModelMetadata) -> None:
        """`MetadataWriter.write()`への薄い委譲。"""
        MetadataWriter.write(path, metadata)
