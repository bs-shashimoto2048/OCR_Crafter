# [Epic] Unified Model Metadata Infrastructure

Issue: [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)

Related: [Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Transformer OCR対応基盤とTrOCR統合、Closed）/ [Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

## 背景

- `ModelMetadata` dataclass（Feature [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)）は既に実装されている
- しかし実コードへは一切配線されていない（`model_metadata.py`自身以外のどこからも参照されない）
- モデルに関する情報の保存方式は、現時点で複数（`.ocr.json`/`.tess.json`/`.pt`/`inference_model.json`/`releases.json`/実験カルテ/Frontend localStorage等）が独立して存在しており、統一されていない
- 将来的なTraining/Evaluation/Inference/Deploymentのすべてで、統一されたMetadata基盤が必要になる

本Epicは、Epic #27（TrOCR固有のTraining/Evaluation/Benchmark/Release Gate）とは責務が異なる、**Engine横断・Metadata基盤そのもの**を扱う独立したEpicとして管理する。

## 最終ゴール

Model MetadataをSingle Source of Truthとする。

```text
Training
    ↓
Metadata生成
    ↓
Metadata保存
    ↓
Models
Inference
Evaluation
Deployment
Export
```

すべて同一Metadataを利用する。

## 完了条件

- Metadata生成
- Metadata保存
- Models利用
- Inference利用
- Evaluation利用
- Deployment利用
- Export利用
- 旧管理方式整理
- ドキュメント更新

## Scope外

以下はEpic #27で扱う。

- OCR学習アルゴリズム
- 評価ロジック
- Benchmark
- Release Gate

（Metadataの保存・利用の統一自体は本Epicの責務。上記はTrOCR固有のアルゴリズム・ロジックそのものを指す）

## 調査結果サマリー（Investigation #29、2026-07-31完了）

モデルに関する情報は、単一のSource of Truthではなく、最低6つの独立した永続化機構（モデル別メタデータファイル/推論使用モデル選択/Release状態レジストリ/実験カルテ/Frontend localStorageの評価履歴・エイリアス）に分散していることを確認した。Engine判定ロジックも`resolve_engine_id()`経由の箇所と、`release_gate.py::_model_engine()`の独自拡張子判定の箇所が併存している。詳細・Migration戦略・提案Issue構成・リスクは[MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)を参照。

## 提案Issue構成（Investigation #29の成果物より）

1. Investigation（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)、完了）
2. Architecture（Adapter設計・保存先決定）
3. Metadata生成
4. Metadata保存
5. Models連携
6. Inference連携
7. Evaluation連携
8. Deployment連携
9. Cleanup（旧管理方式整理）

## 子Issue

- [x] Investigation: Model Metadata実運用化の影響調査（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)、**Closed**）
- [x] Architecture: Unified Model Metadata Adapterと段階的移行方式を設計（[#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)、**Completed**。PR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)をSquash Merge・mainへ反映済み）
- [x] Feature: Canonical ModelMetadata Schema（[#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)、**Completed**・Closed。PR [#33](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/33)をSquash Merge・mainへ反映済み）
- [x] Feature: Legacy Metadata Adapter（[#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)、**Completed**・Closed。PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)をSquash Merge・mainへ反映済み）
- [x] Feature: Metadata Reader（[#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)、**Completed**・Closed。PR [#37](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/37)をSquash Merge・mainへ反映済み）
- [x] Feature: Metadata Writer（[#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38)、**Completed**・Closed。PR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)をSquash Merge・mainへ反映済み）
- [x] Feature: Model Catalog（[#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40)、**Completed**・Closed。PR [#41](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/41)をSquash Merge・mainへ反映済み）
- [x] Feature: Training Metadata Factory（[#42](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/42)、**Completed**・Closed。PR [#43](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/43)をSquash Merge・mainへ反映済み）
- [ ] Feature: Models API（[#44](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/44)、実装完了・PRレビュー待ち）

## Progress

```
✓ Investigation
✓ Architecture
✓ Canonical Schema
✓ Legacy Metadata Adapter
✓ Metadata Reader
✓ Metadata Writer
✓ Model Catalog
✓ Training Metadata Factory
🔶 Models API
□ Inference Resolver
□ Evaluation
□ Deployment
□ Cleanup
```

- [x] Investigation（#29、Closed。調査結果は[INVESTIGATION_29.md](INVESTIGATION_29.md)参照）
- [x] Architecture + ADR（#30、**Completed**。PR #31をSquash Merge済み。ADR-0002のStatusはAcceptedへ変更済み。[ARCHITECTURE_30.md](ARCHITECTURE_30.md)参照）
- [x] Canonical ModelMetadata Schema（#32、**Completed**・Closed。PR #33をSquash Merge済み（Merge Commit: `b250c8f`）。Schema/Validation/schema_version/to_dict/from_dict/Equality/is_valid/replaceを実装。PRレビューで発見したschema_versionのbool/float誤受理（Major #1）を追加コミットで修正済み。Reader/Writer/Adapter/Catalogは対象外のまま）
- [x] Legacy Metadata Adapter（#34、**Completed**・Closed。PR #35をSquash Merge済み（Merge Commit: `434993d`）。`OCRMetadataAdapter`/`TesseractMetadataAdapter`/`InferenceMetadataAdapter`＋委譲先の`LegacyMetadataAdapter`を実装。Filesystem非依存、Validationは`ModelMetadata.from_dict()`へ完全委譲。レビューで挙がったMinor（`inference_model_id`の優先順位・`source`のtraining/backfill区別）は[METADATA_READER_DESIGN_NOTES.md](METADATA_READER_DESIGN_NOTES.md)へ未決事項として記録し、次のReader Issueへ持ち越し）
- [x] Metadata Reader（#36、**Completed**・Closed。PR #37をSquash Merge済み（Merge Commit: `678524f`）。`MetadataReader`（`read_canonical()`/`read_legacy()`/`read()`）を実装。METADATA_READER_DESIGN_NOTES.mdの未決事項2件を決定・実装（`inference_model_id`優先順位・`source`のtraining/backfill区別）。PRレビューで挙がったMinor（6.7のfallback表現・6.6の関数名表現）をArchitectureへ反映済み。Writer/Catalogは対象外のまま）
- [x] Metadata Writer（#38、**Completed**・Closed。PR #39をSquash Merge済み（Merge Commit: `5b1564c`）。`MetadataWriter.write(path, metadata)`を実装（`atomic_write_json`+`file_lock`再利用、単純な上書き保存のみ）。PRレビューで挙がったMinor（6.8の`created_at`保持記述の矛盾・`extra`のJSON直列化制約）をArchitecture/[METADATA_WRITER_DESIGN_NOTES.md](METADATA_WRITER_DESIGN_NOTES.md)へ反映済み。Reader（#36）は無変更）
- [x] Model Catalog（#40、**Completed**・Closed。PR #41をSquash Merge済み（Merge Commit: `627b6f2`）。`ModelCatalog`（`list()`/`find()`/`load()`/`exists()`）を実装。Directory探索はCatalogのみ、Canonical優先・Legacy fallback・重複排除。Reader/Adapter由来の例外は伝播（Architecture 6.9の元の「invalid metadata除外」記述は不採用と明記して修正済み）。詳細は[MODEL_CATALOG_DESIGN_NOTES.md](MODEL_CATALOG_DESIGN_NOTES.md)参照。Reader（#36）・Writer（#38）は無変更）
- [x] Training Metadata Factory（#42、**Completed**・Closed。PR #43をSquash Merge済み（Merge Commit: `fee1885`）。`ModelMetadataFactory.create_from_training()`を実装（Architecture 6.11）。Reader/Writer/Catalogは利用せず、Validationは`ModelMetadata.from_dict()`へ完全委譲。`engine_version`/`task`は対応フィールドが無いため`extra`へ格納。詳細は[TRAINING_METADATA_FACTORY_DESIGN_NOTES.md](TRAINING_METADATA_FACTORY_DESIGN_NOTES.md)参照）
- 🔶 Models API（[#44](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/44)、実装完了・PRレビュー待ち。`ModelsAPI`（`list_models()`/`get_model()`/`exists()`/`create_metadata()`/`save_metadata()`）をFacadeとして実装（Architecture 6.17）。Catalog/Factory/Writerは無変更、Readerは直接利用しない。既存`/models/info`への配線は行わず既存エンドポイントを無変更のまま維持（後方互換調査は[MODELS_API_DESIGN_NOTES.md](MODELS_API_DESIGN_NOTES.md)参照）。新設`ModelsAPIError`はFacade呼び出し形状不正のみ対象）
- 未着手: Consumer切替（`/models/info`のCatalog経由化）/Inference連携/Evaluation連携/Deployment連携/Cleanup

## 関連資料

- [MODEL_METADATA.md](../../design/MODEL_METADATA.md)
- [MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)（Investigation成果物）
- [MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)（Architecture #30成果物）
- [ADR-0002_Unified_Model_Metadata.md](../../adr/ADR-0002_Unified_Model_Metadata.md)（Status: Accepted）
- [ISSUE_MAP.md](ISSUE_MAP.md)（本Epic配下のIssue一覧）
- [METADATA_READER_DESIGN_NOTES.md](METADATA_READER_DESIGN_NOTES.md)（#34レビューで挙がった未決事項。#36で決定・実装済み）
- [METADATA_WRITER_DESIGN_NOTES.md](METADATA_WRITER_DESIGN_NOTES.md)（#38レビューで挙がった将来検討事項）
- [MODEL_CATALOG_DESIGN_NOTES.md](MODEL_CATALOG_DESIGN_NOTES.md)（#40のスコープ決定・将来検討事項）
- [TRAINING_METADATA_FACTORY_DESIGN_NOTES.md](TRAINING_METADATA_FACTORY_DESIGN_NOTES.md)（#42のフィールド対応・設計判断）
- [MODELS_API_DESIGN_NOTES.md](MODELS_API_DESIGN_NOTES.md)（#44の`/models/info`後方互換調査・設計判断）
