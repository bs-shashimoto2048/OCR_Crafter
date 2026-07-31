"""Metadata Writer（ModelMetadataをCanonical sidecar JSONへ保存する）。

docs/design/MODEL_METADATA_ARCHITECTURE.md 6.8（Writer）のうち、本Issue（Metadata
Writer、Migration Phase 2）で実装する範囲のみを対象とする。

設計方針:
- Writerの責務は`ModelMetadata → Canonical JSON → write`のみ。Reader・Model Catalog・
  Resolver・Factoryの責務は持たない
- 書き込みは既存の`services/atomic_io.py::atomic_write_json`/`file_lock`を再利用する。
  新しいI/Oプリミティブ（独自の一時ファイル・独自ロック機構等）は実装しない
- Directory探索（`glob`/`os.walk`等）は行わない。渡された単一Pathへ書き込むのみ
- Validationは自前で書かない。書き込む内容は`ModelMetadata.to_dict()`の出力
  （`schema_version`は常に`ModelMetadata`が持つ値=1）をそのまま使う。Legacy形式
  （`.ocr.json`/`.tess.json`/`inference_model.json`）は保存しない
- 渡された値が`ModelMetadata`インスタンスでない場合は、既存の`InvalidModelMetadataError`
  を再利用する（Writer独自の例外・Validationロジックを新設しない）
- 本Issueのスコープは単純な上書き保存のみ。既存sidecarを読み込んで`created_at`を
  保持するような読み取り込みのマージ処理は行わない（それはRead-Modify-Writeであり、
  本Writerの「書くだけ」という責務を超える。将来Model Catalog/Resolver層で必要になれば
  別途設計する）
"""

from __future__ import annotations

from pathlib import Path
from typing import Union

from .atomic_io import atomic_write_json, file_lock
from .model_metadata import InvalidModelMetadataError, ModelMetadata

PathLike = Union[str, Path]


class MetadataWriteError(OSError):
    """Metadataファイルの書込に失敗した（権限無し・ディスク容量不足等）。

    元の例外は`__cause__`（`raise ... from e`）で保持する。
    """


class MetadataWriter:
    """`ModelMetadata`をCanonical sidecar JSONへ保存する唯一のWriter。

    ```
    ModelMetadata → Canonical JSON → write
    ```
    """

    @staticmethod
    def write(path: PathLike, metadata: ModelMetadata) -> None:
        """`metadata`を`path`へCanonical JSONとして書き込む（`atomic_write_json`+`file_lock`）。

        `metadata`が`ModelMetadata`インスタンスでない場合は`InvalidModelMetadataError`を送出
        する（Writer独自のValidationではなく、型の誤用を明確にするための既存例外の再利用）。
        I/Oエラー（権限無し等）は`MetadataWriteError`として`__cause__`付きで再送出する。
        """
        if not isinstance(metadata, ModelMetadata):
            raise InvalidModelMetadataError(
                f"metadata must be a ModelMetadata instance, got {type(metadata)!r}"
            )

        payload = metadata.to_dict()
        target = Path(path)
        try:
            with file_lock(target):
                atomic_write_json(target, payload)
        except OSError as e:
            raise MetadataWriteError(f"failed to write metadata file: {target}") from e
