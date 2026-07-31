"""Training Metadata Factory（Training完了時に`ModelMetadata`を生成する）。

docs/design/MODEL_METADATA_ARCHITECTURE.md 6.11（Factory / Builder）のうち、本Issue
（Training Metadata Factory、Migration Phase 4）で実装する範囲のみを対象とする。

設計方針:
- Factoryの責務は「生成のみ」。保存（JSON書込・`MetadataWriter`呼び出し）は行わない
- Directory探索（`MetadataReader`/`ModelCatalog`の利用）は一切行わない
- Validationは自前で書かず、`ModelMetadata.from_dict()`へ完全委譲する
- 6.11の決定どおり、Engine別クラス分割は行わない単一`ModelMetadataFactory`とする
- `model_name`→`display_name`、`engine`→`engine_id`（`ModelMetadata`側のフィールド名に
  合わせる）。`engine_version`・`task`は`ModelMetadata`に対応する専用フィールドが存在
  しないため`extra`へ格納する（既存の`model_type`フィールドは分類モデルの画像タイプ・
  OCRエンジンの固定値等、既に別の実データ上の意味を持つため流用しない。詳細は
  docs/workitems/model-metadata/TRAINING_METADATA_FACTORY_DESIGN_NOTES.md参照）
- `schema_version`はModelMetadata自身のフィールドではない（envelope概念、Feature #32）
  ため、Factoryも専用の引数を持たない。生成したインスタンスが将来`to_dict()`で
  シリアライズされた時点で自動的に`schema_version=1`が付与される
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping

from .model_metadata import ModelMetadata


class TrainingMetadataFactoryError(ValueError):
    """Factoryの入力組み立てに関する不正（呼び出し側`extra`とFactory生成`extra`のキー衝突等）。

    `ModelMetadata.from_dict()`が送出する`InvalidModelMetadataError`（必須フィールド欠損・
    engine_id不正等のValidation違反）とは異なる概念であるため、別の例外として区別する。
    """


def _generated_extra(engine_version: str | None, task: str | None) -> dict[str, Any]:
    generated: dict[str, Any] = {}
    if engine_version is not None:
        generated["engine_version"] = engine_version
    if task is not None:
        generated["task"] = task
    return generated


class ModelMetadataFactory:
    """Training完了時・Export時に`ModelMetadata`を構築するFactory（Architecture 6.11）。

    Engine別のクラス分割は行わない（現状4エンジン+custom程度の規模であり、
    `LegacyMetadataAdapter`同様、関数レベルの分岐で十分と判断）。
    """

    @staticmethod
    def create_from_training(
        *,
        model_id: str,
        engine: str,
        model_name: str | None = None,
        engine_version: str | None = None,
        task: str | None = None,
        created_at: str | None = None,
        source: str = "training",
        model_type: str | None = None,
        artifact_path: str | None = None,
        dataset_id: str | None = None,
        experiment_id: str | None = None,
        preprocess_version: str | None = None,
        updated_at: str | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> ModelMetadata:
        """Training Resultから`ModelMetadata`を構築して返す（保存は行わない）。

        `created_at`が指定されない場合は生成時刻（`datetime.now().isoformat()`、
        既存コード（train.py等）と同じ形式）を採用する。`engine_version`/`task`は
        `extra`へ格納するため、呼び出し側が明示的に渡した`extra`とキーが衝突する場合は
        `TrainingMetadataFactoryError`を送出する（Factory自身が組み立てる`extra`の
        一貫性に関する問題であり、`ModelMetadata`側のValidation対象ではないため）。
        """
        generated_extra = _generated_extra(engine_version, task)
        caller_extra = dict(extra) if extra is not None else {}

        collisions = sorted(set(generated_extra) & set(caller_extra))
        if collisions:
            raise TrainingMetadataFactoryError(
                f"extra keys collide with Factory-generated keys (engine_version/task): {collisions}"
            )

        merged_extra = {**caller_extra, **generated_extra}

        data: dict[str, Any] = {
            "model_id": model_id,
            "engine_id": engine,
            "display_name": model_name,
            "model_type": model_type,
            "created_at": created_at if created_at is not None else datetime.now().isoformat(),
            "updated_at": updated_at,
            "artifact_path": artifact_path,
            "dataset_id": dataset_id,
            "experiment_id": experiment_id,
            "preprocess_version": preprocess_version,
            "source": source,
            "extra": merged_extra,
        }
        return ModelMetadata.from_dict(data)
