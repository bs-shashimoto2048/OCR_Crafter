# Metadata Reader Design Notes

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Feature [#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)（Legacy Metadata Adapter、Completed） / [MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md) 6.7（Reader）

本ドキュメントは、Legacy Metadata Adapter（PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)）のマージ前レビューで挙がったMinor指摘のうち、**今回は実装しない**と判断した論点を、次のModelMetadata Reader/Writer実装Issueで決定すべき未決事項として記録する。**コードは変更しない。**

## 未決事項

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

**決定すべきこと（Readerの責務）:**

- Readerが`inference_model.json`を読む際、ファイル内の`inference_model_id`をそのまま`model_id`として採用するか
- それとも、`data/model_ids.json`（Architecture 6.3で決定した正式なmodel_id管理No登録簿）を都度re-resolveして、そちらを常に正とするか
- 両者が食い違った場合（例: ファイルが古く、モデルが削除・再登録されて新しいM0001が振られている場合）にどちらを優先するか、あるいは不整合として扱いCatalogから除外する（Architecture 8章「後方互換」の原則）か

### 2. `source`（training / backfill）をCanonicalへどちらで保存するか

`OCRMetadataAdapter`/`TesseractMetadataAdapter`は現状`source="training"`を固定値として設定している（Feature #34、`_build_canonical()`）。この値は、Adapterが呼ばれるタイミングを考慮していない。

- 学習・Export完了**直後**にリアルタイムでCanonical Metadataへ変換される場合 → `"training"`が正確
- 既存の古いモデルファイルへ**遡及的**にCanonical Metadataを生成する場合（Reader/Writer実装後、Migration Phase 2で新規モデルのみ書込となるため、既存モデルは当面Adapter経由の読み取りのままだが、将来Writerで遡及書込を検討する可能性がある） → `experiment_tracker.py`の`source="backfill"`概念の方が意味的に近い

**決定すべきこと（Readerの責務）:**

- Readerが`LegacyMetadataAdapter`を呼び出す際、常に`"training"`を使うか、`"backfill"`を明示的に指定できるようAdapter呼び出し側でsourceを上書きする経路を用意するか
- あるいは、Adapter自体に`source`引数を追加し、呼び出し側（Reader）が状況に応じて指定する設計へ変更するか（この場合、Feature #34の`_build_canonical()`シグネチャ変更が必要）

## Readerの責務として記録する事項

上記2点に加え、[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md) 6.7で既に決定済みの以下の責務も、実装時に本ドキュメントと合わせて参照すること。

- Canonical sidecar（`<model>.model_metadata.json`）読込を優先し、無ければ`LegacyMetadataAdapter`へfallbackする
- `model_id`の解決（`data/model_ids.json`経由）はReaderが行う（Adapterは行わない、Feature #34で確定済み）
- 破損sidecar・未知schema_versionはAdapterへfallback、警告ログを残す（Architecture 8章）

## 対象外

- 本ドキュメントの記述に基づくコード変更（Reader実装Issueで行う）
- Legacy Metadata Adapter（Feature #34）自体の修正
