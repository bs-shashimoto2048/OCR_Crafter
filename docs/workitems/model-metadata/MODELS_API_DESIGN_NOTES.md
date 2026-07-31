# Models API Design Notes

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Feature [#44](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/44)（Models API） / [MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)「Models API」

本ドキュメントは、Models API（Feature #44）実装にあたって行った既存`/models/info`との後方互換調査・設計判断を記録する。

## 既存`/models/info`との関係（後方互換調査）

`src/app/main.py::model_infos_endpoint()`（`GET /models/info`）は、`model_registry.py::list_model_infos()`を呼び出し、モデルごとに30項目近い詳細情報（`dataset_split_counts`・`ocr_training_params`・`experiment_name`・`model_size_mb`・`augmentation_config`等、エンジン固有の情報を多数含む）を返す既存の実運用エンドポイントである。Frontend側でも`App.jsx`・`lib/trocrModelMetadata.js`・`lib/augmentation.js`・`lib/preprocessCompare.js`・`lib/trainingCompare.js`の5ファイルから参照されており、広く依存されていることを確認した。

一方、`ModelMetadata`（Canonical Schema、Feature #32）が持つフィールドは11個程度であり、上記の詳細情報の大半（学習パラメータ・分割比率・オーグメンテーション設定等）に対応するフィールドを持たない。`ModelCatalog.list()`が返す`ModelMetadata`一覧を使って`/models/info`の既存レスポンス形式（30項目近い詳細情報）を完全に再現することは、本Issueのスコープ（`ModelsAPI`は`list_models()`/`get_model()`/`exists()`/`create_metadata()`/`save_metadata()`という薄いFacadeメソッドのみを提供し、Catalog/Factory/Writerの戻り値をそのまま返す）を大きく超える。

**本Issueでの判断**: `ModelsAPI`（`src/app/services/models_api.py`）は`main.py`・`/models/info`エンドポイント・`model_registry.py`のいずれにも一切配線しない、純粋な追加のサービス層モジュールとする。既存の`GET /models/info`は本Issueでは無変更のまま維持されるため、後方互換性は「変更しないことによって」自動的に維持される。Frontend（Scope外）・既存エンドポイントの実装（`main.py`）はいずれも変更していない。

**将来検討すべきこと**: 実際に`/models/info`をCatalog経由へ切替える場合（[ISSUE_MAP.md](ISSUE_MAP.md) Issue 9「Models API・Models画面連携」）、ADR-0002の「Consumer切替は1 Issue = 1 Consumerを原則とする」方針に従い、本Issueとは別のIssueとして扱う。その際は、レスポンス形式の完全な後方互換維持が現実的か（`ModelMetadata.extra`へ旧フィールドを収容する、または`list_model_infos()`側は当面維持しつつCatalogは別の新規エンドポイントとして追加する等）を個別に判断する必要がある。

## `ModelsAPIError`のスコープ

Catalog（`ModelCatalogError`）・Factory（`TrainingMetadataFactoryError`）・Writer（`MetadataWriteError`）・Schema Validation（`InvalidModelMetadataError`）がそれぞれ送出する例外は、Models APIでは一切ラップせずそのまま伝播させる（Epic #28全体で一貫している「下位層の例外は握りつぶさない」方針をFacade層でも維持する）。

`ModelsAPIError`は、以下の2つの「Facade自体の呼び出し形状が不正」なケースにのみ用いる。

1. `ModelsAPI.__init__(directory)`に`str`/`Path`以外の値が渡された場合
2. `create_metadata(**kwargs)`が`ModelMetadataFactory.create_from_training()`の必須キーワード引数（`model_id`/`engine`）を欠いた状態で呼ばれ、`TypeError`が発生した場合

いずれも、Catalog/Factory/Writer/Schemaが設計済みの例外で表現している概念（ディレクトリ探索失敗・`extra`衝突・I/Oエラー・Validation違反）とは異なる、Facade境界そのものの呼び出し不備であるため区別した。

## Reader直接利用について

`ModelsAPI`は`MetadataReader`をimportしない（`models_api.py`は`metadata_writer`/`model_catalog`/`model_metadata`/`training_metadata_factory`のみをimportする）。モデルの読込は常に`ModelCatalog`経由（`list_models()`/`get_model()`/`exists()`が内部で`ModelCatalog`のインスタンスメソッドへ委譲）とし、Readerを直接呼び出す経路は存在しない。

## 対象外

- 本ドキュメントの記述に基づく`main.py`・`model_registry.py`・Frontendの変更（将来のIssueで判断する）
- Models API（Feature #44）自体の修正
