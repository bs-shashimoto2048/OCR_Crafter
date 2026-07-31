# Unified Model Metadata Infrastructure Work Item

## 状態

**Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)は現在Open。** Investigation（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)）完了・Closed。Architecture（[#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)）**Completed**（PR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)をSquash Merge・mainへ反映済み、ADR-0002はAccepted）。Canonical ModelMetadata Schema（[#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)）**Completed**・Closed（PR [#33](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/33)をSquash Merge・mainへ反映済み、Merge Commit: `b250c8f`）。Legacy Metadata Adapter（[#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)）**Completed**・Closed（PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)をSquash Merge・mainへ反映済み、Merge Commit: `434993d`）。Metadata Reader（[#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)）**Completed**・Closed（PR [#37](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/37)をSquash Merge・mainへ反映済み、Merge Commit: `678524f`）。Metadata Writer（[#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38)）**Completed**・Closed（PR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)をSquash Merge・mainへ反映済み、Merge Commit: `5b1564c`）。Model Catalog（[#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40)）**Completed**・Closed（PR [#41](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/41)をSquash Merge・mainへ反映済み、Merge Commit: `627b6f2`）。次のOpen項目は**Training Metadata Factory**（着手中）。

本ディレクトリは、[Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Transformer OCR対応基盤とTrOCR統合）の実装過程で発見された「`ModelMetadata`が実運用で未配線」という課題に対応するため新設したEpic #28専用の作業資料である。TrOCRに限らない、既存コード全体への`ModelMetadata`の本格配線を扱う。TrOCR固有のTraining/Evaluation/Benchmark/Release Gateは[Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（`docs/workitems/trocr/`）の責務であり、本Epicとは分離管理する。

## 目的

モデルに関する情報（`.ocr.json`/`.tess.json`/`.pt`/`inference_model.json`/`releases.json`/実験カルテ/Frontend localStorage等に分散）を、`ModelMetadata`をSingle Source of Truthとして段階的に統一する。

## 現在の段階

- [x] Epic作成（[#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)）
- [x] Investigation Issue作成・完了・Close（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)）
- [x] `docs/design/MODEL_METADATA_MIGRATION_PLAN.md`作成
- [x] Architecture Issue作成・設計完了（[#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)）
- [x] `docs/design/MODEL_METADATA_ARCHITECTURE.md`作成
- [x] ADR-0002作成（Status: Proposed）
- [x] PR #31レビュー・Squash Merge（mainへ反映済み）
- [x] ADRレビュー・Accepted判断（ユーザー承認によりADR-0002 Status: Accepted）
- [x] Feature Issue作成・実装完了: Canonical ModelMetadata Schema（[#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)、**Completed**・Closed。PR [#33](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/33)Squash Merge済み）
- [x] Feature Issue作成・実装完了: Legacy Metadata Adapter（[#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)、**Completed**・Closed。PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)Squash Merge済み）
- [x] Metadata Reader Design Notes作成（[METADATA_READER_DESIGN_NOTES.md](METADATA_READER_DESIGN_NOTES.md)。#34レビューのMinor未決事項を記録・#36で決定）
- [x] Feature Issue作成・実装完了: Metadata Reader（[#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)、**Completed**・Closed。PR [#37](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/37)Squash Merge済み）
- [x] Feature Issue作成・実装完了: Metadata Writer（[#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38)、**Completed**・Closed。PR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)Squash Merge済み）
- [x] Metadata Writer Design Notes作成（[METADATA_WRITER_DESIGN_NOTES.md](METADATA_WRITER_DESIGN_NOTES.md)。`extra`のJSON直列化制約を将来検討事項として記録）
- [x] Feature Issue作成・実装完了: Model Catalog（[#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40)、**Completed**・Closed。PR [#41](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/41)Squash Merge済み）
- [x] Model Catalog Design Notes作成（[MODEL_CATALOG_DESIGN_NOTES.md](MODEL_CATALOG_DESIGN_NOTES.md)。スコープ決定・将来検討事項を記録）
- [ ] 次のOpen項目: Training Metadata Factory（[ISSUE_MAP.md](ISSUE_MAP.md)参照、着手中）
- [ ] 後続Feature Issue作成（Cleanupまで）

## 関連Issue

- Epic: [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) [Epic] Unified Model Metadata Infrastructure（Open）
- Investigation: [#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29) [Investigation] Model Metadata実運用化の影響調査（Closed）
- Architecture: [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30) [Architecture] Unified Model Metadata Adapterと段階的移行方式を設計（**Completed**・Closed。PR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)Squash Merge済み）
- Feature: [#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32) [Feature] Canonical ModelMetadata Schema（**Completed**・Closed。PR [#33](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/33)Squash Merge済み）
- Feature: [#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34) [Feature] Legacy Metadata Adapter（**Completed**・Closed。PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)Squash Merge済み）
- Feature: [#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36) [Feature] Metadata Reader（**Completed**・Closed。PR [#37](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/37)Squash Merge済み）
- Feature: [#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38) [Feature] Metadata Writer（**Completed**・Closed。PR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)Squash Merge済み）
- Feature: [#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40) [Feature] Model Catalog（**Completed**・Closed。PR [#41](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/41)Squash Merge済み）

## 作業資料

- [EPIC_28.md](EPIC_28.md)（Epic #28）
- [INVESTIGATION_29.md](INVESTIGATION_29.md)（Investigation #29、Closed）
- [ARCHITECTURE_30.md](ARCHITECTURE_30.md)（Architecture #30）
- [ISSUE_MAP.md](ISSUE_MAP.md)
- [METADATA_READER_DESIGN_NOTES.md](METADATA_READER_DESIGN_NOTES.md)（#34レビューで挙がった未決事項。#36で決定済み）
- [METADATA_WRITER_DESIGN_NOTES.md](METADATA_WRITER_DESIGN_NOTES.md)（#38レビューで挙がった将来検討事項）
- [MODEL_CATALOG_DESIGN_NOTES.md](MODEL_CATALOG_DESIGN_NOTES.md)（#40のスコープ決定・将来検討事項）
- [../../design/MODEL_METADATA.md](../../design/MODEL_METADATA.md)（`ModelMetadata` dataclass設計、Feature #14）
- [../../design/MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)（Investigation #29成果物）
- [../../design/MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)（Architecture #30成果物）
- [../../adr/ADR-0002_Unified_Model_Metadata.md](../../adr/ADR-0002_Unified_Model_Metadata.md)（Status: Accepted）

## 重要な制約

- 既存モデル（`.ocr.json`/`.tess.json`/`.pt`）を一括変換・書き換えしない
- 既存API・DB・localStorageの後方互換を維持する（新規キー・新規フィールドの追加のみ）
- TrOCR固有の学習・評価・Benchmark・Release Gateロジックには立ち入らない（[Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)の責務）
- 読めないモデルを別Engineへ推測フォールバックしない（安全に除外・診断可能にする）

## 関連Epic

- [Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Transformer OCR対応基盤とTrOCR統合、Closed。本Epicの発端）
- [Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合、`docs/workitems/trocr/`。別責務）
