# [Investigation] Model Metadata実運用化の影響調査

Issue: [#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)（**Closed**: 調査・Migration Plan・Issue分割案の作成完了により2026-07-31 Close）

Parent Epic: [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure）

## 目的

`ModelMetadata`（Feature [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)）を実運用化する場合の影響範囲を調査し、Migration計画を策定する。**コード変更は行わない。**

## 調査Scope

- `ModelMetadata` dataclass（現行スキーマ・検証ロジック）
- 現在の保存方式（`.ocr.json`/`.tess.json`/`.pt`/`inference_model.json`等）
- `modelInfos`（Frontend、`GET /models/info`の応答実体）
- Models画面（`ModelsView.jsx`）
- Inference（`predict.py`のmodel解決方式）
- Evaluation（評価結果の保存・参照経路）
- Export（学習成果物Export・Deployment Package Export）
- API（モデル関連エンドポイント一覧）
- DB（`training_jobs`テーブル等）
- キャッシュ（モデルメタデータに関連するキャッシュ機構の有無）

## 成果物

- [MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)（現状・問題点・理想構成・Migration戦略・Issue分割・リスク・Future Work）

## 調査結果（2026-07-31）

調査完了。主な発見は以下のとおり。

- モデルに関する情報は、単一のSource of Truthではなく、最低6つの独立した永続化機構に分散している: モデル別メタデータファイル（`.ocr.json`/`.tess.json`/`.pt`）、推論使用モデル選択（`inference_model.json`）、Release状態レジストリ（`releases.json`）、実験カルテ（`experiments.json`）、Frontend localStorageの評価履歴、同エイリアス
- Engine判定ロジックが重複: `model_registry.py`は`resolve_engine_id()`経由、`release_gate.py::_model_engine()`はファイル名拡張子による独自判定
- `ModelMetadata`dataclass自体は、これらのいずれからも参照されていない（生成・保存・読込のいずれの処理も存在しない）
- モデル別メタデータの追跡項目追加は、`register_exported_ocr_model()`等の20+キーワード引数と`list_model_infos()`の手書き辞書変換ロジックの両方に手を入れる必要があり、拡張性に課題がある
- モデルメタデータそのものをキャッシュする仕組みは存在しない（エンジンReaderキャッシュのみ）
- DBはモデル成果物ではなく学習ジョブ実行状態（`training_jobs`）のみを扱う。既存のMigrationパターンは`ALTER TABLE ADD COLUMN`

詳細・Migration戦略（段階1〜4）・Issue分割提案・リスクは[MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)を参照。

## 対象外

- コード実装
- 既存ファイル形式の変更
- 新規API・新規DB Schemaの実装

## 完了条件

- [x] 調査完了
- [x] `docs/design/MODEL_METADATA_MIGRATION_PLAN.md`作成
- [x] Epic配下のFeature Issue構成案を提示

## 補足資料

- [MODEL_METADATA.md](../../design/MODEL_METADATA.md)
- [EPIC_28.md](EPIC_28.md)
- ArchitectureはIssue [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)（[ARCHITECTURE_30.md](ARCHITECTURE_30.md)）で継続する
