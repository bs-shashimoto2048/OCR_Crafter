# Unified Model Metadata Infrastructure Issue Map

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Architecture [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30) / Feature [#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32) / Feature [#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34) / Feature [#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36) / Feature [#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38) / Feature [#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40) / Feature [#42](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/42) / Feature [#44](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/44)

本ドキュメントは、Architecture [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)（[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)「Issue分割」章）で決定した、Epic #28配下の後続Issue構成の追跡表である。Architecture #30はPR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)のSquash Mergeによりmainへ反映済み・Closed。Canonical ModelMetadata Schema（[#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)）はPR [#33](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/33)のSquash Mergeによりmainへ反映済み・Closed。Legacy Metadata Adapter（[#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)）はPR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)のSquash Mergeによりmainへ反映済み・Closed。Metadata Reader（[#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)）はPR [#37](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/37)のSquash Mergeによりmainへ反映済み・Closed（[METADATA_READER_DESIGN_NOTES.md](METADATA_READER_DESIGN_NOTES.md)の未決事項を決定・実装済み）。Metadata Writer（[#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38)）はPR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)のSquash Mergeによりmainへ反映済み・Closed（`extra`のJSON直列化制約は[METADATA_WRITER_DESIGN_NOTES.md](METADATA_WRITER_DESIGN_NOTES.md)へ将来検討事項として記録）。Model Catalog（[#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40)）はPR [#41](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/41)のSquash Mergeによりmainへ反映済み・Closed（スコープ決定は[MODEL_CATALOG_DESIGN_NOTES.md](MODEL_CATALOG_DESIGN_NOTES.md)参照）。Training Metadata Factory（[#42](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/42)）はPR [#43](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/43)のSquash Mergeによりmainへ反映済み・Closed（フィールド対応は[TRAINING_METADATA_FACTORY_DESIGN_NOTES.md](TRAINING_METADATA_FACTORY_DESIGN_NOTES.md)参照）。Models API（[#44](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/44)）はPR [#45](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/45)のSquash Mergeによりmainへ反映済み・Closed（`/models/info`後方互換調査は[MODELS_API_DESIGN_NOTES.md](MODELS_API_DESIGN_NOTES.md)参照。既存エンドポイントは無変更のまま維持、実際のConsumer切替は別Issue）。**2026-07-31、Epic #28は一旦停止**（ユーザー判断。UIレビュー実施のため）していたが、Epic #46（Engine UI Generalization）・Epic #27（TrOCR Lifecycle）の完了により停止理由は解消された。Investigation [#108](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/108)（2026-08-18完了）で現在実装を再調査した結果、Canonical Metadata基盤（#30-#44）は依然としてProduction consumerを一切持たないこと、Consumer Migration（Models/Inference/Evaluation/Deployment）は既存Legacyパスが機能している限り着手を見送るべきことを確認した。次Issueとして推奨された「TrOCR Legacy Metadata Adapter Compatibility」（下記#14）は[#110](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/110)として**Completed**・Closed（PR [#111](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/111)Squash Merge済み）。詳細は[MODEL_METADATA_CONSUMER_MIGRATION_REASSESSMENT_108.md](MODEL_METADATA_CONSUMER_MIGRATION_REASSESSMENT_108.md)・[TROCR_LEGACY_METADATA_ADAPTER_110.md](TROCR_LEGACY_METADATA_ADAPTER_110.md)参照。

## Issue一覧（提案）

| # | Issue | 依存 | 概要 | 状態 |
|---|---|---|---|---|
| 1 | Investigation | なし | Model Metadata実運用化の影響調査 | Closed（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)） |
| 2 | Architecture + ADR | 1 | Adapter設計・保存先決定・Migration戦略確定 | **Completed**（[#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)、PR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)Squash Merge済み。ADR-0002はAccepted） |
| 3 | Canonical ModelMetadata Schema整備 | 2 | 既存`ModelMetadata` dataclassのSchema確定・schema_version・Validation・to_dict/from_dict・Equality・is_valid/replace | **Completed**（[#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)、PR [#33](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/33)Squash Merge済み。Merge Commit: `b250c8f`） |
| 4 | Legacy Metadata Adapter実装 | 3 | `.ocr.json`/`.tess.json`/`inference_model.json`→`ModelMetadata`変換（読み取り専用、`LegacyMetadataAdapter`＋3専用Adapter） | **Completed**（[#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)、PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)Squash Merge済み。Merge Commit: `434993d`） |
| 5 | ModelMetadata Reader実装 | 3, 4 | Canonical sidecar読込・Legacy委譲読込（`MetadataReader`）。`inference_model_id`優先順位・`source`のtraining/backfill区別を決定（[METADATA_READER_DESIGN_NOTES.md](METADATA_READER_DESIGN_NOTES.md)） | **Completed**（[#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)、PR [#37](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/37)Squash Merge済み。Merge Commit: `678524f`） |
| 6 | ModelMetadata Writer実装 | 3 | Canonical sidecarへの原子的書込（`MetadataWriter`、単純な上書き保存のみ） | **Completed**（[#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38)、PR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)Squash Merge済み。Merge Commit: `5b1564c`） |
| 7 | Model Catalog実装 | 5, 6 | 一覧・model_id検索・Canonical優先・Legacy fallback・重複排除（`ModelCatalog`）。詳細は[MODEL_CATALOG_DESIGN_NOTES.md](MODEL_CATALOG_DESIGN_NOTES.md) | **Completed**（[#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40)、PR [#41](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/41)Squash Merge済み） |
| 8 | Training Metadata Factory | 7 | `create_from_training(...)`。学習完了時に`ModelMetadata`を生成（保存は行わない）。詳細は[TRAINING_METADATA_FACTORY_DESIGN_NOTES.md](TRAINING_METADATA_FACTORY_DESIGN_NOTES.md) | **Completed**（[#42](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/42)、PR [#43](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/43)Squash Merge済み） |
| 9 | Models API・Models画面連携 | 7, 8 | Models API（Facade、`ModelsAPI`）は**Completed**（[#44](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/44)、PR [#45](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/45)Squash Merge済み、詳細は[MODELS_API_DESIGN_NOTES.md](MODELS_API_DESIGN_NOTES.md)）。`/models/info`の実際のConsumer切替（レスポンス形式維持）は別途Issue化する | Models APIは**Completed**（[#44](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/44)、PR [#45](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/45)）。**却下・保留**（Investigation #108、`/models/info`の70+キーをCanonical Metadataで表現できないため時期尚早と判断） |
| 10 | Inference Resolver連携 | 7 | model_id→ModelMetadata→model_refの解決（既存`POST /predict`は変更しない） | **却下・保留**（Investigation #108、具体的必要性を確認できず） |
| 11 | Evaluation連携 | 7 | 評価履歴の保存先方針（Metadata本体へ埋め込まない） | **却下・保留**（Investigation #108、Evaluation Dispatcher/Runnerの責務を変更する正当な理由が無いと判断） |
| 12 | Deployment・Export連携 | 7 | Release/Deployment情報とMetadataの境界確定 | **却下・保留**（Investigation #108、Issue #104で安定化したばかりのRelease Gateへの回帰リスクが利益を上回ると判断） |
| 13 | 旧管理方式Deprecation・Cleanup | 9, 10, 11, 12 | 利用状況確認・deprecation・削除条件 | **却下・保留**（Investigation #108、移行元のconsumerが存在しないため時期尚早） |
| 14 | TrOCR Legacy Metadata Adapter Compatibility | 4, 5, 7 | `TrOCRMetadataAdapter`新設・`MetadataReader`/`ModelCatalog`への`.trocr.json`分岐追加（既存2形式と同型・schema変更なし） | **Completed**・Closed（[#110](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/110)、PR [#111](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/111)Squash Merge済み。Merge Commit: `5e51796`。詳細は[TROCR_LEGACY_METADATA_ADAPTER_110.md](TROCR_LEGACY_METADATA_ADAPTER_110.md)参照） |

## 推奨実装順

Architecture #30で決定した順序（詳細は[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)参照）:

```text
Investigation(#29) → Architecture(#30)
  → Canonical Schema整備(#32)
  → Legacy Adapter実装(#34) ─┐
  → Reader実装(#36)         ─┤
  → Writer実装(#38)         ─┴→ Model Catalog実装(#40)
  → Training/Import Factory実装
  → Models API/画面連携 → Inference Resolver連携 → Evaluation連携 → Deployment/Export連携
  → 旧管理方式Cleanup
```

Consumer切替（Models→Inference→Evaluation→Deployment/Export）は一度に行わず、1 Issue = 1 Consumerを原則とする。

**（2026-08-18更新、Investigation #108）**: 上記の順序はArchitecture #30時点の計画のままだが、Investigation #108の再評価により、Consumer切替（#9-#13）は既存Legacyパスが機能している限り着手しない方針へ更新した。次に着手するのは#14（TrOCR Legacy Metadata Adapter Compatibility）のみで、それ以降のConsumer切替は具体的な必要性が生じた時点で個別に再判断する。

**（2026-08-18更新、Issue #110）**: #14（TrOCR Legacy Metadata Adapter Compatibility）は**Completed**・Closed（PR #111Squash Merge済み）。Consumer Migration（#9-#13）は引き続き着手しない方針のまま。

## 対象外（Epic #27の責務）

- TrOCR学習・評価ロジック・Benchmark・Release Gate
- OCR学習アルゴリズムそのもの

詳細は[docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md](../trocr/EPIC_27_TROCR_LIFECYCLE.md)を参照。
