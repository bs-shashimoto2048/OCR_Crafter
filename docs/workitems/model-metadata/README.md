# Unified Model Metadata Infrastructure Work Item

## 状態

**Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)は現在Open。** Investigation（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)）完了・Closed。Architecture（[#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)）**Completed**（PR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)をSquash Merge・mainへ反映済み、ADR-0002はAccepted）。次のOpen項目は**Canonical ModelMetadata Schema整備**。

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
- [ ] 次のOpen項目: Canonical ModelMetadata Schema整備（[ISSUE_MAP.md](ISSUE_MAP.md)参照）
- [ ] 後続Feature Issue作成（Legacy Adapter〜Cleanupまで）

## 関連Issue

- Epic: [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) [Epic] Unified Model Metadata Infrastructure（Open）
- Investigation: [#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29) [Investigation] Model Metadata実運用化の影響調査（Closed）
- Architecture: [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30) [Architecture] Unified Model Metadata Adapterと段階的移行方式を設計（**Completed**・Closed。PR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)Squash Merge済み）

## 作業資料

- [EPIC_28.md](EPIC_28.md)（Epic #28）
- [INVESTIGATION_29.md](INVESTIGATION_29.md)（Investigation #29、Closed）
- [ARCHITECTURE_30.md](ARCHITECTURE_30.md)（Architecture #30）
- [ISSUE_MAP.md](ISSUE_MAP.md)
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
