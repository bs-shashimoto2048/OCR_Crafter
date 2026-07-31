# Metadata Writer Design Notes

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Feature [#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38)（Metadata Writer、Completed） / [MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md) 6.8

本ドキュメントは、Metadata Writer（PR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)）のマージ前レビューで挙がった指摘のうち、**今回はコード変更しない**と判断した将来検討事項を記録する。

## 将来検討事項

### `ModelMetadata.extra`のJSON serializable制約

`ModelMetadata`（Feature #14/#32、`src/app/services/model_metadata.py`）の`extra`フィールドは、構築時のValidationで`Mapping`であることのみを検証しており、値がJSON直列化可能かどうかは検証していない。

```python
# 構築は成功する（Mappingでありさえすればよい）
ModelMetadata(model_id="M0001", engine_id="tesseract", extra={"obj": SomeCustomObject()})
```

この状態で`MetadataWriter.write()`（Feature #38）へ渡すと、書き込み時（`atomic_write_json`内部の`json.dumps()`）で`TypeError: Object of type ... is not JSON serializable`が送出される。この`TypeError`は、Writerが区別する既存の3種の例外（`MetadataWriteError`＝I/Oエラー、`InvalidModelMetadataError`＝型不正、Legacy側の`UnsupportedLegacyMetadataError`＝形式未対応）のいずれにも該当せず、未分類のまま呼び出し側へ伝播する。

**現時点で対応しない理由:**

- `ModelMetadata`を生成する呼び出し元がまだ存在しない（Adapter/Reader/Writerいずれも既存コードから未配線のまま）ため、実際にこのケースが発生する経路が無い
- 対応する場合、`ModelMetadata.__post_init__()`（Canonical Schema自体、Feature #32で確定済み）に`extra`値のJSON直列化可能性検証を追加するか、Writer側で`json.dumps()`の`TypeError`を捕捉して独自に分類するかの設計判断が必要であり、いずれもFeature #38（Writerのみ）のスコープを超える

**検討すべき選択肢（将来のIssueで判断）:**

1. `ModelMetadata.__post_init__()`で`extra`の各値がJSON直列化可能か検証し、不正なら`InvalidModelMetadataError`とする（Canonical Schemaの変更が必要）
2. `MetadataWriter.write()`で`json.dumps()`由来の`TypeError`を捕捉し、`MetadataWriteError`または新設の専用例外へ変換する（Writer側のみの変更で対応可能）
3. 現状維持（`extra`は呼び出し側の責任でJSON安全な値のみを渡す前提とし、ドキュメントで明記するに留める）

## 対象外

- 本ドキュメントの記述に基づくコード変更（将来のIssueで判断する）
- Metadata Writer（Feature #38）自体の修正
