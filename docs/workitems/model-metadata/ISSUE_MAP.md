# Unified Model Metadata Infrastructure Issue Map

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Architecture [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30) / Feature [#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)

本ドキュメントは、Architecture [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)（[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)「Issue分割」章）で決定した、Epic #28配下の後続Issue構成の追跡表である。Architecture #30はPR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)のSquash Mergeによりmainへ反映済み・Closed。Canonical ModelMetadata Schema（[#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)）は実装完了・PRレビュー待ち。次のOpen項目は「Legacy Metadata Adapter実装」である。

## Issue一覧（提案）

| # | Issue | 依存 | 概要 | 状態 |
|---|---|---|---|---|
| 1 | Investigation | なし | Model Metadata実運用化の影響調査 | Closed（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)） |
| 2 | Architecture + ADR | 1 | Adapter設計・保存先決定・Migration戦略確定 | **Completed**（[#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)、PR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)Squash Merge済み。ADR-0002はAccepted） |
| 3 | Canonical ModelMetadata Schema整備 | 2 | 既存`ModelMetadata` dataclassのSchema確定・schema_version・Validation・to_dict/from_dict・Equality・is_valid/replace | 実装完了・PRレビュー待ち（[#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)） |
| 4 | Legacy Metadata Adapter実装 | 3 | `.ocr.json`/`.tess.json`/`.pt`/`inference_model.json`→`ModelMetadata`変換（読み取り専用） | 次のOpen項目（未作成） |
| 5 | ModelMetadata Reader/Writer実装 | 3 | Canonical sidecar読込・原子的書込（新規モデルのみ） | 未作成 |
| 6 | Model Catalog / Registry実装 | 4, 5 | 一覧・フィルタ・legacy合成・重複排除 | 未作成 |
| 7 | Training・Import時のMetadata生成 | 5 | Factory/Builder。新規学習・Export時にCanonical Metadataを書込 | 未作成 |
| 8 | Models API・Models画面連携 | 6 | `/models/info`をCatalog経由へ切替（レスポンス形式は維持） | 未作成 |
| 9 | Inference Resolver連携 | 6 | model_id→ModelMetadata→model_refの解決（既存`POST /predict`は変更しない） | 未作成 |
| 10 | Evaluation連携 | 6 | 評価履歴の保存先方針（Metadata本体へ埋め込まない） | 未作成 |
| 11 | Deployment・Export連携 | 6 | Release/Deployment情報とMetadataの境界確定 | 未作成 |
| 12 | 旧管理方式Deprecation・Cleanup | 8, 9, 10, 11 | 利用状況確認・deprecation・削除条件 | 未作成 |

## 推奨実装順

Architecture #30で決定した順序（詳細は[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)参照）:

```text
Investigation(#29) → Architecture(#30)
  → Canonical Schema整備
  → Legacy Adapter実装 ─┐
  → Reader/Writer実装  ─┴→ Model Catalog/Registry実装
  → Training/Import Factory実装
  → Models API/画面連携 → Inference Resolver連携 → Evaluation連携 → Deployment/Export連携
  → 旧管理方式Cleanup
```

Consumer切替（Models→Inference→Evaluation→Deployment/Export）は一度に行わず、1 Issue = 1 Consumerを原則とする。

## 対象外（Epic #27の責務）

- TrOCR学習・評価ロジック・Benchmark・Release Gate
- OCR学習アルゴリズムそのもの

詳細は[docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md](../trocr/EPIC_27_TROCR_LIFECYCLE.md)を参照。
