# [Architecture] Unified Model Metadata Adapterと段階的移行方式を設計

Issue: [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)

Parent Epic: [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure）

## 背景

Investigation [#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)（Closed）により、モデル情報が複数の独立した仕組みに分散していることが確認された。本Issueは、その調査結果をもとに`ModelMetadata`をSingle Source of Truthへ段階的に移行するためのArchitectureとADRを策定する。**コード変更は行わない。**

## 今回の範囲

- 現行`ModelMetadata` Schemaの評価・Canonical Metadata Schemaの決定
- Adapter/Reader/Writer/Registry(Repository)/Resolver/Factory(Builder)の責務設計
- 保存場所・ファイル単位・model_id・engine_id・artifact_path/model_refの方針決定
- Migration戦略（Phase 1〜4）・後方互換・Rollback・Security設計
- ADR-0002・Architecture設計書の作成
- Epic #28配下の後続Issue構成案の確定

## 対象外

- Productionコード実装 / Model Metadataの実保存 / 既存モデルの一括変換 / DB Migration
- Models画面・Inference・Evaluation・Deployment・Export変更
- TrOCR学習・評価ロジック・Benchmark・Release Gate（Epic #27の責務）
- Issue #8修正

## 成果物

- [ADR-0002_Unified_Model_Metadata.md](../../adr/ADR-0002_Unified_Model_Metadata.md)（Status: Proposed）
- [MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)
- [MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)の更新
- Epic #28配下の後続Issue構成案（本ファイルの「提案Issue構成」参照）

## 決定サマリー

詳細は[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)・[ADR-0002](../../adr/ADR-0002_Unified_Model_Metadata.md)を参照。要点のみ記載する。

- **Canonical Schema**: 既存`ModelMetadata` dataclass（Feature #14）を破棄せず採用。`status`/`schema_version`等、実データに対応が無いフィールドは追加しない
- **保存形式**: モデルディレクトリ横に置くsidecarファイル`<model>.model_metadata.json`（`atomic_io.py`の`atomic_write_json`/`file_lock`を再利用）
- **model_id**: 新規のUUID等は発行せず、既存の管理No登録簿（`model_registry.py::assign_model_ids()` / `data/model_ids.json`のM0001形式）をそのまま`ModelMetadata.model_id`として再利用する
- **engine_id**: `resolve_engine_id()`（Engine Registry）へ一本化。`release_gate.py::_model_engine()`の独自拡張子判定はCleanup Issueで置き換える
- **Adapter**: 形式別（Tesseract/PaddleOCR/Legacy Inference Model/Release）ではなく、既存4形式読み取りロジックを持つ単一の`LegacyMetadataAdapter`+関数ベースの変換規則
- **Reader/Writer**: 新規`services/model_metadata_store.py`（仮称）にCanonical読み込み・sidecar書き込みを実装（本Issueでは設計のみ、実装は後続Issue）
- **Migration**: Phase 1（Adapterのみ・既存ファイル不変）→Phase 2（新規モデルのみsidecar書込）→Phase 3（Models→Inference→Evaluation→Deployment/Exportの順でConsumer切替）→Phase 4（Cleanup）
- **後方互換**: 読めないモデルは他エンジンへ推測フォールバックせず、安全に除外＋診断ログを残す

## 提案Issue構成（Epic #28配下・本Issueの成果物）

1. Investigation（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)、Closed）
2. Architecture + ADR（本Issue、[#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)）
3. Canonical ModelMetadata Schema整備
4. Legacy Metadata Adapter実装
5. ModelMetadata Reader/Writer実装
6. Model Catalog / Registry実装
7. Training・Import時のMetadata生成（Factory/Builder）
8. Models API・Models画面連携
9. Inference Resolver連携
10. Evaluation連携
11. Deployment・Export連携
12. 旧管理方式Deprecation・Cleanup

各Issueの目的・依存・変更範囲・完了条件・対象外は[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)の「Issue分割」章を参照。

## 完了条件

- [x] Canonical Schema・保存形式・model_id・engine_id・Adapter/Reader/Writer/Registry/Resolver/Factoryの責務を決定した
- [x] Migration Phase 1〜4を確定した
- [x] 後方互換・Rollback・Securityを設計した
- [x] ADR-0002を作成した（Status: Proposed）
- [x] MODEL_METADATA_ARCHITECTURE.mdを作成した
- [x] Epic #28配下の後続Issue構成案を確定した
- [x] Productionコードを変更していない
