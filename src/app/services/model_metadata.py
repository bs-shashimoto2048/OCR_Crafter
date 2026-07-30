"""Model Metadata（OCRモデルを横断的に識別・表示・追跡するための共通データ型）。

docs/design/MODEL_METADATA.md のうち、本Issue（共通Model Metadata MVP）で
実装する範囲のみを対象とする。

設計方針:
- ModelMetadataは「モデルを横断的に識別・表示・追跡するための共通情報」のみを
  保持する。学習・推論・評価の実処理は持たない（Engine Capability/Registryと同様）
- 既存4形式（.ocr.json/.tess.json/.pt/inference_model.json）・学習履歴・実験カルテ・
  Benchmark結果を調査した上で、実データに存在しない項目は必須にしない
  （調査結果は docs/workitems/trocr/FEATURE_MODEL_METADATA.md 参照）
- `status`と`version`はMVPでは採用しない。モデルファイル自体にはどちらの概念も
  実データとして存在せず（Job状態・Release状態はそれぞれ別テーブル/別ファイルの
  概念）、想像で追加すると別概念との混同を招くため（詳細は同上ドキュメント）
- engine_idの検証は`engine_registry.resolve_engine_id()`を再利用し、正規化ロジック
  （trim・小文字化・Registry照合）を複製しない
- 既存コード（model_registry.py等）へは一切配線しない。既存JSON・DBは変更しない
"""

from __future__ import annotations

import copy
import dataclasses
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Mapping

from .engine_registry import resolve_engine_id


class InvalidModelMetadataError(ValueError):
    """ModelMetadataとして不正な値（必須フィールド欠損・型不一致・engine_id不正・extra衝突等）。"""


# 型チェックのみで足りる任意のstr|Noneフィールド一覧（__post_init__で一括検証する）。
_OPTIONAL_STRING_FIELDS = (
    "display_name",
    "model_type",
    "created_at",
    "updated_at",
    "artifact_path",
    "dataset_id",
    "experiment_id",
    "preprocess_version",
    "source",
)


@dataclass(frozen=True)
class ModelMetadata:
    """OCRモデルを横断的に識別・表示・追跡するための共通データ。

    必須フィールドは`model_id`と`engine_id`のみ。他はすべて任意（既存データに
    存在しない項目を必須にしないという方針、詳細はFEATURE_MODEL_METADATA.md参照）。
    `status`・`version`はモデルファイル自体に対応する実データが存在しないため
    MVPでは採用していない（Job状態・Release状態・各種バージョン概念とは別軸）。
    """

    model_id: str
    engine_id: str
    display_name: str | None = None
    model_type: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    artifact_path: str | None = None
    dataset_id: str | None = None
    experiment_id: str | None = None
    preprocess_version: str | None = None
    # 実験カルテ（experiment_tracker.py）の source("training"|"backfill") と同じ
    # 概念: このレコード自体がライブ記録かバックフィルかを表す。既存値の想像による
    # 拡張はしない（自由文字列のまま）
    source: str | None = None
    extra: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not isinstance(self.model_id, str):
            raise InvalidModelMetadataError(f"model_id must be a string, got {type(self.model_id)!r}")
        if not self.model_id or self.model_id != self.model_id.strip():
            raise InvalidModelMetadataError(
                f"model_id must be a non-empty string without leading/trailing whitespace: {self.model_id!r}"
            )

        resolved_engine = resolve_engine_id(self.engine_id)
        if resolved_engine is None:
            raise InvalidModelMetadataError(
                f"engine_id is not a known, registered engine (Engine Registry): {self.engine_id!r}"
            )
        object.__setattr__(self, "engine_id", resolved_engine)

        for name in _OPTIONAL_STRING_FIELDS:
            value = getattr(self, name)
            if value is not None and not isinstance(value, str):
                raise InvalidModelMetadataError(f"{name} must be a string or None, got {type(value)!r}")

        if not isinstance(self.extra, Mapping):
            raise InvalidModelMetadataError(f"extra must be a mapping, got {type(self.extra)!r}")

        known_fields = {f.name for f in dataclasses.fields(self)}
        collisions = sorted(set(self.extra.keys()) & known_fields)
        if collisions:
            raise InvalidModelMetadataError(f"extra keys collide with common fields: {collisions}")

        # extraは構築時の入力からdeep copyした上でMappingProxyTypeへ包む。
        # - MappingProxyTypeにより、外部からのキー追加・削除・差し替えを防ぐ
        # - deep copyにより、呼び出し側が元の辞書（やそのネストした可変値）を
        #   構築後に書き換えても、本インスタンスの状態には影響しない
        # ただし、md.extra["key"] のように取得した後の値そのものを呼び出し側が
        # 変更するケースまでは防がない（Any型の値を再帰的に凍結することは
        # 本Issueのスコープ外とする）
        object.__setattr__(self, "extra", MappingProxyType(copy.deepcopy(dict(self.extra))))

    def to_dict(self) -> dict[str, Any]:
        """辞書へシリアライズする。Noneフィールドも含めて全キーを出力する（round trip前提）。"""
        return {
            "model_id": self.model_id,
            "engine_id": self.engine_id,
            "display_name": self.display_name,
            "model_type": self.model_type,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "artifact_path": self.artifact_path,
            "dataset_id": self.dataset_id,
            "experiment_id": self.experiment_id,
            "preprocess_version": self.preprocess_version,
            "source": self.source,
            # 呼び出し側がto_dict()の戻り値を書き換えても内部状態へ影響しないよう、
            # 独立したdeep copyを返す
            "extra": copy.deepcopy(dict(self.extra)),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "ModelMetadata":
        """辞書からModelMetadataを構築する。

        未知フィールド（ModelMetadataが持たないキー）は無視する。既存の
        .ocr.json/.tess.json等はここでモデル化していない多数のエンジン固有
        フィールドを持つため、それらを自動的にextraへ混入させることはしない
        （共通フィールドとの衝突を構造的に避けるため）。extraへ値を持たせたい
        場合は、呼び出し側がdata["extra"]へ明示的に格納すること。

        必須フィールド（model_id/engine_id）の欠損・型不正は
        InvalidModelMetadataError として明確に送出する。
        """
        if not isinstance(data, Mapping):
            raise InvalidModelMetadataError(f"data must be a mapping, got {type(data)!r}")

        known_fields = {f.name for f in dataclasses.fields(cls)}
        kwargs = {k: v for k, v in data.items() if k in known_fields}
        try:
            return cls(**kwargs)
        except TypeError as e:
            raise InvalidModelMetadataError(f"missing or invalid ModelMetadata fields: {e}") from e
