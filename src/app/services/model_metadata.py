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

Architecture #30 / ADR-0002（Feature #32）で追加した方針:
- `MODEL_METADATA_SCHEMA_VERSION`（`schema_version`）は、上記の`status`/`version`とは
  別概念。モデル自体のバージョンではなく、`to_dict()`が返す辞書表現（将来のsidecar
  ファイル形式）そのものの構造バージョンを表す。dataclassのフィールドには追加しない
- 永続化（JSON保存・読込・Reader/Writer/Adapter）は本Issueの対象外のまま
"""

from __future__ import annotations

import copy
import dataclasses
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Mapping

from .engine_registry import resolve_engine_id


class InvalidModelMetadataError(ValueError):
    """ModelMetadataとして不正な値（必須フィールド欠損・型不一致・engine_id不正・extra衝突・schema_version不正等）。"""


# Canonical Schemaのenvelopeバージョン（Architecture #30 6.2）。
# dataclass自身のフィールドにはしない（sidecarファイル形式が持つ「入れ物」のバージョンであり、
# ModelMetadataというデータ自体の一部ではないため。永続化はまだ実装しない本Issueの時点でも、
# to_dict()の出力・from_dict()の入力チェックとして先に導入する）。
MODEL_METADATA_SCHEMA_VERSION = 1
_SUPPORTED_SCHEMA_VERSIONS = (MODEL_METADATA_SCHEMA_VERSION,)


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
        """辞書へシリアライズする。Noneフィールドも含めて全キーを出力する（round trip前提）。

        `schema_version`はModelMetadata自身のフィールドではなく、この辞書表現（将来の
        sidecarファイル形式）のenvelopeバージョンとして付与する（Architecture #30 6.2）。
        """
        return {
            "schema_version": MODEL_METADATA_SCHEMA_VERSION,
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

        `schema_version`キーが含まれる場合は既知のバージョン（現状v1のみ）と厳密なint型で
        一致するか検証する（未知の将来バージョンをそれと知らずに現行スキーマとして誤解釈しない
        ため）。キー自体が無い入力（`schema_version`導入前の`to_dict()`出力・Adapterが変換した
        旧データ相当）は検証をスキップする（後方互換）。

        型チェックは`in`によるvalue比較の前に行う。Pythonでは`bool`が`int`のサブクラスであり
        `True == 1`・`False == 0`が成立するため、素朴な`value not in _SUPPORTED_SCHEMA_VERSIONS`
        判定だけでは`True`・`1.0`のような非int値を`1`と誤って同一視してしまう
        （PRレビューで指摘・確認済みの不具合。Major #1）。
        """
        if not isinstance(data, Mapping):
            raise InvalidModelMetadataError(f"data must be a mapping, got {type(data)!r}")

        if "schema_version" in data:
            version = data["schema_version"]
            if (
                isinstance(version, bool)
                or not isinstance(version, int)
                or version not in _SUPPORTED_SCHEMA_VERSIONS
            ):
                raise InvalidModelMetadataError(
                    f"schema_version must be a strict int in {_SUPPORTED_SCHEMA_VERSIONS!r}, "
                    f"got {version!r} ({type(version)!r})"
                )

        known_fields = {f.name for f in dataclasses.fields(cls)}
        kwargs = {k: v for k, v in data.items() if k in known_fields}
        try:
            return cls(**kwargs)
        except TypeError as e:
            raise InvalidModelMetadataError(f"missing or invalid ModelMetadata fields: {e}") from e

    @classmethod
    def is_valid(cls, data: Mapping[str, Any]) -> bool:
        """dataがModelMetadataとして構築可能かを判定する（例外を送出しない`from_dict()`）。

        後続Issue（Adapter/Catalog）が、個々の入力の妥当性を例外送出なしに判定できるようにする
        ための最小限のUtility。判定ロジック自体は`from_dict()`を再利用し、複製しない。
        """
        try:
            cls.from_dict(data)
        except InvalidModelMetadataError:
            return False
        return True

    def replace(self, **changes: Any) -> "ModelMetadata":
        """一部フィールドを差し替えた新しいインスタンスを返す（frozenのため自身は変更しない）。

        `dataclasses.replace()`の薄いラッパー。新インスタンス生成時に`__post_init__`の
        Validationがそのまま再実行される（差し替え後の値が不正ならInvalidModelMetadataErrorが
        送出される）。
        """
        return dataclasses.replace(self, **changes)
