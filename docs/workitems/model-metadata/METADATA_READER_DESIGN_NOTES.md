# Metadata Reader Design Notes

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Feature [#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)（Legacy Metadata Adapter、Completed） / Feature [#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)（Metadata Reader、Completed） / [MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md) 6.6・6.7

本ドキュメントは、Legacy Metadata Adapter（PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)）のマージ前レビューで挙がったMinor指摘を、次のModelMetadata Reader実装Issueで決定すべき未決事項として記録したものである。

> **2026-07-31追記: Feature #36で決定・実装済み**。以下2点はFeature #36（Metadata Reader）で決定し、`src/app/services/legacy_metadata_adapter.py`（`source`引数追加）・`src/app/services/metadata_reader.py`（新規）へ実装済み。決定内容は[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md) 6.6・6.7へ反映済み。本ドキュメントは経緯の記録として残す。

## 未決事項（Feature #36で決定済み）

### 1. `inference_model_id`（`inference_model.json`）の優先順位

`inference_model.json`（`services/inference_model.py::save_inference_model()`）は以下のフィールドを持つ。

```json
{
  "engine": "...",
  "model": "...",
  "inference_model_id": "M0009",
  "updated_at": "..."
}
```

`.ocr.json`/`.tess.json`には`model_id`相当のフィールドが存在しないため、`LegacyMetadataAdapter`（Feature #34）は3形式すべてで一律「呼び出し側が解決した`model_id`を明示的に渡す」設計を採用した。しかし`inference_model.json`だけは、既にM0001形式の`model_id`相当値（`inference_model_id`）をファイル自身が保持している。

**決定（Feature #36）**: 呼び出し側が`model_id`を明示指定した場合はそれを優先する。指定が無い場合のみ、ファイル内の`inference_model_id`へfallbackする。`data/model_ids.json`との突合・不整合時のCatalog除外判定は、Model Catalog実装Issue（Reader/Adapterより上位のレイヤー）の責務とし、Reader自体はファイル内容とその場の呼び出し引数のみで完結させる（`metadata_reader.py::MetadataReader.read_legacy()`実装済み）。

### 2. `source`（training / backfill）をCanonicalへどちらで保存するか

`OCRMetadataAdapter`/`TesseractMetadataAdapter`は現状`source="training"`を固定値として設定している（Feature #34、`_build_canonical()`）。この値は、Adapterが呼ばれるタイミングを考慮していない。

- 学習・Export完了**直後**にリアルタイムでCanonical Metadataへ変換される場合 → `"training"`が正確
- 既存の古いモデルファイルへ**遡及的**にCanonical Metadataを生成する場合（Reader/Writer実装後、Migration Phase 2で新規モデルのみ書込となるため、既存モデルは当面Adapter経由の読み取りのままだが、将来Writerで遡及書込を検討する可能性がある） → `experiment_tracker.py`の`source="backfill"`概念の方が意味的に近い

**決定（Feature #36）**: Adapter自体（`OCRMetadataAdapter.adapt()`/`TesseractMetadataAdapter.adapt()`/`LegacyMetadataAdapter.adapt()`）へ`source: str = "training"`を後方互換な既定値として追加した（Adapterを直接呼ぶ既存の呼び出し・テストは無変更で動作する）。Metadata Reader（`metadata_reader.py::MetadataReader.read_legacy()`）はこれを`source="backfill"`で明示的に上書きする（Reader経由の変換は既存モデルへの遡及読み取りであるため）。呼び出し側が`read_legacy()`へ`source`を明示指定すれば、Reader既定の`"backfill"`をさらに上書きできる。

## Readerの責務として記録する事項（実装済み）

上記2点に加え、[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md) 6.7で決定済みの以下の責務も実装済み。

- Canonical sidecar（`<model>.model_metadata.json`）は`read_canonical()`が直接`ModelMetadata.from_dict()`へ委譲する
- Legacy形式は`read_legacy()`が`LegacyMetadataAdapter`へ委譲する。形式判定（`read()`）はファイル名のみで行う
- `model_id`の解決（`data/model_ids.json`経由の正式なM0001採番）はReaderの対象外のまま（呼び出し側が解決した値を渡す前提。Model Catalog実装Issueで確定する）
- 破損ファイル・未知schema_versionは`MetadataReadError`/`InvalidModelMetadataError`として明確に区別（クラッシュさせない。Architecture 8章）

## 対象外

- Model Catalog（`data/model_ids.json`との突合・ディレクトリ列挙）の実装（次のIssue）
- Metadata Writer（保存・更新・削除）の実装
