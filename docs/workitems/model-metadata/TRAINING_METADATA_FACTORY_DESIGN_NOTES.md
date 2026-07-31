# Training Metadata Factory Design Notes

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Feature [#42](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/42)（Training Metadata Factory） / [MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md) 6.11

本ドキュメントは、Training Metadata Factory（Feature #42）実装にあたって行ったフィールド対応・設計判断を記録する。

## クラス名・メソッド名

Architecture 6.11で既に「単一`ModelMetadataFactory`（Engine別クラス分割はしない）」と決定済みのため、本Featureでもこの名称をそのまま採用した。モジュール名はIssue名に合わせて`training_metadata_factory.py`とし、メソッド名は要求どおり`create_from_training()`とした。

## フィールド対応

依頼元の要求（Factoryが最低限設定するもの）と、実際の`ModelMetadata`（Feature #32）のフィールドとの対応は以下のとおり。

| 要求されたフィールド | `ModelMetadata`上の対応 | 備考 |
|---|---|---|
| `model_id` | `model_id` | そのまま |
| `model_name` | `display_name` | `ModelMetadata`に`model_name`フィールドは存在しないため改名 |
| `engine` | `engine_id` | `ModelMetadata.from_dict()`内部で`resolve_engine_id()`により検証・正規化される |
| `engine_version` | `extra["engine_version"]` | 下記「`engine_version`・`task`を`extra`へ格納する理由」参照 |
| `task` | `extra["task"]` | 同上 |
| `created_at` | `created_at` | 未指定時はFactoryが`datetime.now().isoformat()`で生成する（下記参照） |
| `schema_version` | （dataclassフィールドではない） | 下記「`schema_version`について」参照 |
| `source="training"` | `source`（既定値`"training"`） | 呼び出し側が明示的に上書き可能（例: 将来のImport/Backfill用途） |

## `engine_version`・`task`を`extra`へ格納する理由

`ModelMetadata`（Feature #32、Canonical Schema）には`engine_version`・`task`に対応する専用フィールドが存在しない。[MODEL_METADATA.md](../../design/MODEL_METADATA.md)のスキーマ比較表でも、`engine_version`は「既存にはこの概念が無い。追加してもデータ互換性は壊れない（新規フィールドの追加のみ）」として**未実装**の新規項目として明記されている。

既存の`model_type`フィールドへ`task`を流用することも検討したが、`model_type`は既にコードベース上で別の実データ上の意味（分類モデルの画像タイプバケット`"square"`/`"wide"`、OCRエンジンの固定値`"ocr"`。`src/app/main.py`・`src/app/db.py`・`legacy_metadata_adapter.py`の`OCRMetadataAdapter`/`TesseractMetadataAdapter`で確認済み）を持っており、Factoryが独自の「タスク種別」という別概念をここへ混入させると、既存の`model_type`の意味と衝突・混同する。したがって、本Issueのスコープ（`ModelMetadata`自身へのフィールド追加は禁止、Reader/Writer/Catalogの変更も禁止）に従い、既存の`extra`（`Mapping[str, Any]`、エンジン固有情報の逃し場）へ格納する方式を採用した。

**将来検討すべきこと**: `engine_version`・`task`の利用が広がった場合、`ModelMetadata`（Feature #32相当）へ専用フィールドとして正式に追加するかどうかは、別Issueで判断する。

## `extra`衝突時に`TrainingMetadataFactoryError`を送出する設計

Factoryは呼び出し側が明示的に渡した`extra`と、Factory自身が`engine_version`/`task`から生成する`extra`エントリをマージする。呼び出し側の`extra`に`engine_version`または`task`というキーが偶然含まれていた場合、意図せずどちらかの値が上書きされてしまうため、これをマージ前に検出し`TrainingMetadataFactoryError`として送出する。

これは`ModelMetadata.from_dict()`側のValidation（`extra`キーと既知dataclassフィールド名との衝突検出）とは別の関心事であり、Factory自身が組み立てる`extra`の一貫性に関する問題であるため、`InvalidModelMetadataError`ではなく新設の`TrainingMetadataFactoryError`を用いる。要求仕様の「`TrainingMetadataFactoryError`は入力組み立てに関する例外のみを対象とする」を満たす、Factory内で唯一発生しうる非Validation例外である。

`extra`が既知dataclassフィールド名（`model_id`等）と衝突するケースは、従来どおり`ModelMetadata.from_dict()`側の`InvalidModelMetadataError`がそのまま送出される（Factoryは変更しない）。

## `created_at`について

呼び出し側が`created_at`を指定しない場合、Factoryが`datetime.now().isoformat()`で生成する。これは`train.py`・`benchmark.py`・`dataset_registry.py`等、既存コードが学習・処理完了時に採用している形式（タイムゾーン情報を持たないローカル時刻のISO 8601文字列）とそのまま揃えたものであり、新たな時刻表現を導入していない。

## `schema_version`について

`schema_version`は`ModelMetadata`自身のdataclassフィールドではなく、`to_dict()`/`from_dict()`が扱う辞書表現（sidecarファイル形式）のenvelopeバージョンという別概念（Feature #32）。そのためFactoryにも`schema_version`専用の引数は存在しない。要求仕様の「Factoryがschema_versionを設定する」は、Factoryが返す`ModelMetadata`インスタンスが、将来`to_dict()`で辞書化された時点で自動的に`schema_version=1`を持つ、という構造的な意味で満たされる（`test_create_from_training_result_serializes_with_schema_version`で確認）。

## 既知の制約（`engine="custom"`）の引き継ぎ

Canonical Schema整備（Feature #32）・[MODEL_METADATA.md](../../design/MODEL_METADATA.md)で既に文書化されている制約どおり、`engine="custom"`（`.pt`分類モデル）はEngine Registry未登録のため`ModelMetadata.from_dict()`が`InvalidModelMetadataError`を送出する。Factoryはこの制約を新たに緩和・回避しない（Validationを完全にModelMetadata側へ委譲する設計方針どおり）。

## 対象外

- 本ドキュメントの記述に基づく`ModelMetadata`（Feature #32）自体へのフィールド追加（将来のIssueで判断する）
- Training Metadata Factory（Feature #42）自体の修正
- `MetadataWriter`との連携（実際にTrainingパイプラインからFactoryを呼び出し、Writerで保存する配線は本Issueのスコープ外。次のOpen項目であるModels API連携以降で判断する）
