# TrOCR Legacy Metadata Adapter Compatibility 作業記録

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure） / Feature [#110](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/110) / Depends on: Investigation [#108](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/108)（Completed） / Related: [#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)（Legacy Metadata Adapter）・[#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)（Metadata Reader）・[#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40)（Model Catalog）・[#96](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/96)（TrOCR Model Registration）・[#98](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/98)（TrOCR Training UI Integration） / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR Lifecycle、Completed）

**状態**: Implemented, PR review pending。

## 目的

Investigation #108で唯一推奨された次Issue。Canonical Metadata基盤（Legacy Metadata Adapter / Metadata Reader / Model Catalog）が`.tess.json`/`.ocr.json`/`inference_model.json`の3形式のみに対応し、Epic #27（Issue #96）で新設された`.trocr.json`に未対応というギャップを解消する。Production consumer切替は行わない（Canonical基盤の「Legacy input compatibility」をTrOCRまで拡張するのみ）。

## 実装前調査（Mandatory Investigation）

### 1. `.trocr.json` writer/list contract

`src/app/services/trocr_model_registry.py::register_trocr_model()`が`paths.models`直下へ`trocr_<job_id>.trocr.json`として書き込む（`.tess.json`/`.ocr.json`と同じsidecarパターン）。`list_trocr_models(project_id)`が同ディレクトリを`*.trocr.json`でglobして返す既存の専用一覧関数（`model_registry.py`とは独立、統合しない設計、Issue #96のモジュールdocstring参照）。

### 2. `.trocr.json` 実フィールド

```json
{
  "name": "trocr_<job_id>.trocr.json",
  "engine": "trocr",
  "training_family": "ocr",
  "model_type": "ocr",
  "model_dir": "<save_pretrained()の出力ディレクトリ絶対パス>",
  "base_model_ref": "<Hugging Face Hub ID / ローカルパス>",
  "project_id": "<project_id>",
  "job_id": "<job_id>",
  "dataset_root": "<dataset_dir>",
  "dataset_id": "<DS-xxxx>",
  "epochs": int,
  "batch_size": int,
  "learning_rate": float,
  "final_loss": float | null,
  "created_at": "<isoformat>"
}
```

Tesseract/PaddleOCRと異なり、train/inferディレクトリ分離が無く、`model_dir`1つのみがartifactの実体（Hugging Face `save_pretrained()`の対称性、Issue #96調査結果を再確認）。

### 3. 既存Adapterの責務

`OCRMetadataAdapter`/`TesseractMetadataAdapter`/`InferenceMetadataAdapter`はいずれも「Legacy dict → `dict`（共通6フィールドのみ）→ `ModelMetadata.from_dict()`」という薄い変換のみを行い、独自Validationを持たない。固有フィールド（`.ocr.json`の`training_params`等）は共通フィールドへ写像せず単に無視し、`extra`へも自動混入させない（`tests/test_legacy_metadata_adapter.py::test_ocr_specific_fields_not_modeled_are_ignored_not_leaked_into_extra`で確認済みの既存precedent）。

### 4. `MetadataReader.read_legacy()`/`read()`のformat判定方法

`read()`はファイル名の末尾一致のみで判定する（内容を見ない）。`.ocr.json`→`LEGACY_FORMAT_OCR_JSON`、`.tess.json`→`LEGACY_FORMAT_TESS_JSON`、`inference_model.json`（完全一致）→`LEGACY_FORMAT_INFERENCE_MODEL_JSON`。`.trocr.json`は`.ocr.json`のsuffixとは文字列的に衝突しない（`".trocr.json".endswith(".ocr.json")`は`False`、末尾9文字が`"rocr.json"` ≠ `".ocr.json"`）ため、新規分岐追加は既存判定へ影響しない。

### 5. `ModelCatalog`の探索対象・file pattern・deduplicationルール

`ModelCatalog._scan()`は`directory.iterdir()`（非再帰、`entry.is_file()`のみ対象）でCanonical sidecar（`*.model_metadata.json`）とLegacy候補（`_LEGACY_SUFFIX_FORMATS`に列挙されたsuffix）を収集し、Canonical優先・model_id重複排除で`ModelMetadata`一覧を返す。

### 6. directory artifactのidentity化

TrOCRのartifact本体（`model_dir`、例: `models/trocr_runs/<job_id>/`）は`paths.models`直下ではなくサブディレクトリに置かれる（`main.py`の`output_dir = paths.models / "trocr_runs" / job_id`）。`ModelCatalog._iter_entries()`は非再帰的`iterdir()`かつ`entry.is_file()`のみを対象とするため、このサブディレクトリ自体はCatalogの走査に一切現れない。Catalogが識別するのは`.trocr.json`sidecarファイル（`paths.models`直下）のみであり、artifact directoryの再帰スキャン・identity化は不要（既存の`.tess.json`/`.ocr.json`と全く同じ扱いで足りる）。

### 7. Canonical `ModelMetadata` schemaでTrOCR情報を表現可能か

共通6フィールド（`engine_id`/`model_type`/`created_at`/`artifact_path`/`dataset_id`/`source`）で`.trocr.json`の主要情報（engine判定・作成日時・artifact参照・dataset lineage・training/backfill区別）を表現できる。Schema変更は不要と判断した。

### 8. engine-specific extra fieldsの扱い

`base_model_ref`/`project_id`/`job_id`/`dataset_root`/`epochs`/`batch_size`/`learning_rate`/`final_loss`/`training_family`/`name`はCanonical共通フィールドに対応が無い。既存Adapter（OCR/Tesseract）の`training_params`/`charset`/`counts`等と同じ扱いとして、**`extra`へも自動格納せず、単に無視する**という決定をした（詳細はDecision Recordを参照）。

## Decision Record: extraへ格納しない理由

Issue本文は「Canonical schemaに直接fieldが無いものは、既存Architectureの方針に従いextraへ格納するか、未対応として明記する」と両論を示していたため、既存3Adapterの実装を確認した上で決定した。

- `OCRMetadataAdapter`/`TesseractMetadataAdapter`は`training_params`/`charset`/`max_text_length`/`counts`等、多数の固有フィールドを持つ実データに対して**一切`extra`へ格納していない**（テストで明示的に確認済み: `test_ocr_specific_fields_not_modeled_are_ignored_not_leaked_into_extra`）。
- ここでTrOCRだけ`extra`へ固有フィールドを格納する新しい振る舞いを導入すると、Adapter間の一貫性が崩れ、「なぜTrOCRだけextraに情報が入るのか」という新たな非対称性を生む。
- Consumer Migration自体が本Issueのスコープ外（Investigation #108の結論）であるため、`extra`に格納した情報を実際に読み取って活用するConsumerは現時点で存在しない。
- 以上より、既存Adapterの一貫性を優先し、TrOCR固有フィールドは「未対応（既存2形式と同じ扱いで無視）」として明記するに留めた。将来Consumer Migrationへ着手する段階で、`base_model_ref`等の情報が本当に必要になった時点で改めて`extra`化を検討する（Future Work）。

## 実装内容

### 1. TrOCR Legacy Adapter

`src/app/services/legacy_metadata_adapter.py`に`TrOCRMetadataAdapter`を追加した（既存`OCRMetadataAdapter`/`TesseractMetadataAdapter`と同一のクラス構造・`_build_canonical()`/`adapt()`パターン）。

```python
class TrOCRMetadataAdapter:
    @staticmethod
    def _build_canonical(data, model_id, source):
        return {
            "model_id": model_id,
            "engine_id": data.get("engine"),
            "model_type": data.get("model_type"),
            "created_at": data.get("created_at"),
            "artifact_path": data.get("model_dir"),
            "dataset_id": data.get("dataset_id"),
            "source": source,
        }
```

`LEGACY_FORMAT_TROCR_JSON = "trocr_json"`を`KNOWN_LEGACY_FORMATS`へ追加し、`LegacyMetadataAdapter.from_trocr_json()`/`adapt()`の分岐を追加した。

### 2. Field Mapping

| Canonical field | `.trocr.json`由来 |
|---|---|
| `engine_id` | `data.get("engine")`（`"trocr"`） |
| `model_type` | `data.get("model_type")`（`"ocr"`） |
| `created_at` | `data.get("created_at")` |
| `artifact_path` | `data.get("model_dir")` |
| `dataset_id` | `data.get("dataset_id")` |
| `source` | 呼び出し側指定（Adapter直接呼び出しは既定`"training"`、Reader経由は`"backfill"`） |

`base_model_ref`/`project_id`/`job_id`/`dataset_root`/`epochs`/`batch_size`/`learning_rate`/`final_loss`/`training_family`/`name`は未対応（Decision Record参照、既存2形式と同じ扱い）。

### 3. Reader Integration

`src/app/services/metadata_reader.py`の`read()`へ`.trocr.json`判定を追加（Canonical優先→`.ocr.json`→`.tess.json`→`.trocr.json`→`inference_model.json`の順、既存3分岐の位置・優先順位は変更していない）。`read_legacy()`の`source`既定値分岐（`.ocr.json`/`.tess.json`と同じ`"backfill"`）へ`LEGACY_FORMAT_TROCR_JSON`を追加した。

### 4. Catalog Compatibility

`src/app/services/model_catalog.py`の`_LEGACY_SUFFIX_FORMATS`へ`(".trocr.json", LEGACY_FORMAT_TROCR_JSON)`を追加した。§6の調査結果通り、artifact directoryの再帰スキャンは不要であり、Catalog全面再設計・再帰スキャンの無制限化は行っていない。dedupe/Canonical優先ルールは既存ロジックをそのまま再利用し、TrOCR専用の分岐は追加していない。

### 5. No Consumer Migration

`/models/info`・Inference Resolver・Evaluation Predictor resolution・Release Gate/release_manager・`releases.json`・`inference_model.json`・Frontend model listingはいずれも変更していない（`git diff --stat main -- src/ frontend/src/`で確認）。

### 6. No Canonical Schema Redesign

`model_metadata.py`は無変更（§7の調査結果通り、既存6共通フィールドで表現可能なため）。

### 7. Error Handling

- malformed `.trocr.json`（不正JSON）: `MetadataReader._read_json_file()`が`MetadataReadError`を送出（既存3形式と共通のI/O層、TrOCR専用の例外処理は追加していない）
- missing required field（`model_id`欠損等）: `ModelMetadata.from_dict()`が`InvalidModelMetadataError`を送出（既存3形式と共通）
- invalid engine/model id: 同上（`resolve_engine_id()`経由、Adapter側でengine名を推測・変換しない既存方針を継承）
- artifact directory missing: Adapter/Readerの責務範囲外（Filesystemアクセスを行わないAdapter設計上、`model_dir`実在確認はしない。既存OCR/Tesseract Adapterと同じ振る舞い、`test_trocr_metadata_adapter_works_purely_in_memory_without_any_file_on_disk`で確認）
- invalid timestamps/types: `ModelMetadata.__post_init__()`の型検証へ委譲（既存3形式と共通）

## Tests

`tests/test_legacy_metadata_adapter.py`・`tests/test_metadata_reader.py`・`tests/test_model_catalog.py`へ以下を追加した（`tmp_path`フィクスチャのみ使用、実データへの書込は無し）。

### Adapter（9件追加）
- valid `.trocr.json` → `ModelMetadata`変換
- engine=`trocr`確認
- artifact_path=`model_dir`マッピング
- dataset_id マッピング
- `LegacyMetadataAdapter`経由のdispatch一致確認
- 固有フィールド（`base_model_ref`等）がextraへ混入しないこと
- Filesystem非依存確認（存在しないパスでも変換できる）
- 未知engine拒否（既存3形式と共通パラメータ化テストへ追加）
- engine欠損・model_id欠損・非Mapping入力・round trip確認

### Reader（5件追加）
- `.trocr.json`明示読込・`source="backfill"`既定確認
- ファイル名suffixによる自動dispatch確認
- `source`上書き確認
- `.ocr.json`suffixとの誤判定が起きないことの回帰確認
- 未知engineパラメータ化テストへ`.trocr.json`ケース追加

### Catalog（7件追加）
- `.trocr.json`単独エントリのlisting（model_id=ファイル名、既存Legacy専用ルールと同じ）
- artifact本体（サブディレクトリ）がCatalogの非再帰走査に現れないことの確認
- Canonical優先（TrOCR版）
- Canonical + Tesseract Legacy + TrOCR Legacyの共存（既存engineへの回帰なし確認）
- 未知engineエラー伝播（`.trocr.json`版）

### 実行結果

```
python -m pytest -q tests/test_legacy_metadata_adapter.py tests/test_metadata_reader.py tests/test_model_catalog.py tests/test_trocr_model_registry.py
# 105 passed

python -m pytest -q
# 1317 passed, 1 failed（既知Issue #8のみ）
# ※1回目の実行で tests/test_evaluation_dataset.py::test_rename_evaluation_dataset がPermissionErrorで
#   1件追加failしたが、単体再実行・ファイル単位再実行・2回目のfull suite再実行のいずれもgreen。
#   本Issueのdiff（legacy_metadata_adapter.py/metadata_reader.py/model_catalog.py+関連テストのみ）は
#   evaluation_dataset/dataset_registry関連コードに一切触れていないため、Windows環境のファイルハンドル
#   競合によるflakeと判断した（証拠: 2回目のfull suite実行では当該test含め既知Issue #8以外は全green）
```

テスト件数: Issue #108マージ後1298 passed → 1317 passed（+19、追加した19テストと一致）。

## Documentation

- 本ファイル（新規）
- `docs/design/MODEL_METADATA_ARCHITECTURE.md`（TrOCR対応の追記）
- `docs/design/MODEL_METADATA_MIGRATION_PLAN.md`（Issue #110実装完了の追記）
- `docs/workitems/model-metadata/ISSUE_MAP.md`・`README.md`（行14をPending→Completedへ更新）

Frontend変更なし（Issue本文の想定通り）。

## Review Focus / Exit Criteria対応状況

- [x] `.trocr.json`をCanonical `ModelMetadata`へ変換可能（`TrOCRMetadataAdapter`）
- [x] `MetadataReader`でTrOCR legacy metadataを扱える
- [x] `ModelCatalog`でTrOCR artifact compatibilityを確認・最小実装（suffix追加のみ、artifact directoryスキャンは調査の結果不要と判明）
- [x] Canonical schema全面変更なし（`model_metadata.py`無変更）
- [x] Production consumer migrationなし（`src/`/`frontend/src/`のうちmetadata 3ファイルのみ変更）
- [x] Tesseract/PaddleOCR/Inference metadata回帰なし（既存105テスト全てgreen、共存テストで確認）
- [x] relevant tests passed（105 passed）
- [x] full suite確認（1317 passed, 1 failed=既知Issue #8のみ）
- [x] documentation更新
- [x] PRセルフレビュー完了（PR作成後に実施）
