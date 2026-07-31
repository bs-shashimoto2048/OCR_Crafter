# Model Metadata Migration Plan

Related: [MODEL_METADATA.md](MODEL_METADATA.md)（`ModelMetadata`のスキーマ設計）/ [Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Closed）/ [Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate）/ Architecture [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30) / [ADR-0002](../adr/ADR-0002_Unified_Model_Metadata.md) / [MODEL_METADATA_ARCHITECTURE.md](MODEL_METADATA_ARCHITECTURE.md)

本ドキュメントは、Unified Model Metadata Infrastructure Epicの調査Issue（Investigation: Model Metadata実運用化の影響調査、[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)、Closed）の成果物である。**コード変更は行っていない。** 現状のモデル管理方式を実地調査し、`ModelMetadata`（Feature #14で実装済み・未配線）を実運用化する場合の課題・理想構成・Migration戦略・Issue分割案・リスクを記載する。

## 追記（2026-07-31）: Architecture #30で決定事項を確定

本Investigationで「要判断」「未決定」としていた論点は、Architecture Issue #30・[ADR-0002](../adr/ADR-0002_Unified_Model_Metadata.md)・[MODEL_METADATA_ARCHITECTURE.md](MODEL_METADATA_ARCHITECTURE.md)で確定した。対応関係は以下のとおり。

| 本ドキュメントの論点 | Architecture #30での決定 |
|---|---|
| DB vs ファイルベース（「リスク」参照） | ファイルベース（sidecar JSON）採用。DB化しない（Architecture 6.2） |
| `engine="custom"`が未登録（「リスク」参照） | Engine Registryへ`custom`を新規登録する方針を決定（実装は後続Issue、Architecture 6.4・10章#3） |
| model_idの生成方式（本ドキュメントでは未検討） | 新規UUID等は発行せず、既存`data/model_ids.json`（M0001形式）をそのまま再利用（Architecture 6.3） |
| Adapter Interfaceの詳細設計 | 単一`LegacyMetadataAdapter`（形式別クラス分割はしない）に確定（Architecture 6.6） |
| Issue分割の依存関係 | 12件のIssue・依存関係を確定（Architecture 10章、[ISSUE_MAP.md](../workitems/model-metadata/ISSUE_MAP.md)） |

以降の本文（現状・問題点・理想構成・Migration戦略・Issue分割・リスク・Future Work）はInvestigation #29時点の調査記録として維持し、確定した決定内容は上記表からArchitecture成果物を参照すること。

## 追記2（2026-07-31）: Feature #32でCanonical Schema実装完了（Migration Phase 1: Canonical Schema — Completed）

Feature [#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)（Canonical ModelMetadata Schema）**Completed**。`src/app/services/model_metadata.py`へ`schema_version`（envelope値・`MODEL_METADATA_SCHEMA_VERSION = 1`、bool/floatを誤受理しない厳密int検証）・`is_valid()`・`replace()`を追加し、PR [#33](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/33)をSquash Merge・mainへ反映済み（Merge Commit: `b250c8f`）。Migration Phase 1のうちCanonical Schema部分は完了。Reader/Writer/Catalog（Phase 1の残り）はまだ未実装であり、永続化（JSON保存・読込）も行っていない。

## 追記3（2026-07-31）: Feature #34でLegacy Metadata Adapter実装完了（Migration Phase 1: Adapter — Completed）

Feature [#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)（Legacy Metadata Adapter）**Completed**。新規`src/app/services/legacy_metadata_adapter.py`へ`OCRMetadataAdapter`（`.ocr.json`）・`TesseractMetadataAdapter`（`.tess.json`）・`InferenceMetadataAdapter`（`inference_model.json`）と、それらへ委譲する`LegacyMetadataAdapter`を実装した。Filesystemアクセスなし（dict→ModelMetadataの変換のみ）、Validationは全て`ModelMetadata.from_dict()`へ委譲、Engine判定は`resolve_engine_id()`一本化（推測フォールバックなし）。未対応形式は新設の`UnsupportedLegacyMetadataError`で区別する。PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)をSquash Merge・mainへ反映済み（Merge Commit: `434993d`）。これで**Migration Phase 1（Canonical Schema + Adapter導入）が完了**。レビューで挙がった未決事項（`inference_model_id`優先順位・`source`のtraining/backfill区別）は[METADATA_READER_DESIGN_NOTES.md](../workitems/model-metadata/METADATA_READER_DESIGN_NOTES.md)へ記録し、次のReader Issueで決定する。

## 追記4（2026-07-31）: Feature #36でMetadata Reader実装完了（Migration Phase 2: Reader — Completed）

Feature [#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)（Metadata Reader）**Completed**。新規`src/app/services/metadata_reader.py`へ`MetadataReader`（`read_canonical()`/`read_legacy()`/`read()`）を実装した。渡された単一Pathの読込のみ（`glob`/`os.walk`/ディレクトリスキャンなし）。Canonical sidecarは`ModelMetadata.from_dict()`へ直接委譲、Legacyは`LegacyMetadataAdapter`へ委譲。I/O・JSON解析エラーは新設`MetadataReadError`（`OSError`）で区別。[METADATA_READER_DESIGN_NOTES.md](../workitems/model-metadata/METADATA_READER_DESIGN_NOTES.md)の未決事項（`inference_model_id`優先順位・`source`のtraining/backfill区別）を決定・実装した（`legacy_metadata_adapter.py`へ後方互換な`source`引数を追加）。PR [#37](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/37)をSquash Merge・mainへ反映済み（Merge Commit: `678524f`）。**Migration Phase 2のうちReader部分が完了**。

## 追記5（2026-07-31）: Feature #38でMetadata Writer実装完了（Migration Phase 2: Writer — Completed）

Feature [#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38)（Metadata Writer）**Completed**。新規`src/app/services/metadata_writer.py`へ`MetadataWriter.write(path, metadata)`を実装した。`ModelMetadata.to_dict()`の出力を既存`atomic_write_json`+`file_lock`でそのまま書き込む単純な上書き保存のみ（既存sidecarの読み取り込みマージ処理は対象外、Directory探索なし）。渡された値が`ModelMetadata`インスタンスでない場合は既存の`InvalidModelMetadataError`を再利用、I/Oエラーは新設`MetadataWriteError`（`OSError`、`__cause__`保持）で区別。Reader（`metadata_reader.py`）は無変更。PR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)をSquash Merge・mainへ反映済み（Merge Commit: `5b1564c`）。**Migration Phase 2（Reader + Writer）が完了**。

## 追記6（2026-07-31）: Feature #40でModel Catalog実装完了（Migration Phase 3: Model Catalog — Completed）

Feature [#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40)（Model Catalog）**Completed**。新規`src/app/services/model_catalog.py`へ`ModelCatalog`（`list()`/`find()`/`load()`/`exists()`）を実装した。Directory探索は`ModelCatalog`のみが行い、`MetadataReader`（無変更）へは常に単一のPathのみを渡す。同一ベースファイルにCanonical+Legacyが両方存在する場合はCanonical優先・Legacy無視（マージしない）、model_idの重複は走査順で先勝ちのdeduplication。Legacyのmodel_idは暫定的にファイル名を採用（`data/model_ids.json`統合は将来のIssue、[MODEL_CATALOG_DESIGN_NOTES.md](../workitems/model-metadata/MODEL_CATALOG_DESIGN_NOTES.md)参照）。Reader/Adapter由来の例外は握りつぶさず伝播（`ModelCatalogError`はディレクトリ探索エラーのみ）。`inference_model.json`・`.pt`は`list()`の対象外。**Migration Phase 3（Model Catalog）が完了**。次のOpen項目はTraining/Import時のMetadata生成（Factory）またはModels連携（[docs/workitems/model-metadata/ISSUE_MAP.md](../workitems/model-metadata/ISSUE_MAP.md)参照）。

## 現状

### 発見: モデルに関する情報は、単一のSource of Truthではなく、最低6つの独立した永続化機構に分散している

調査の結果、「モデル」という単一概念に関する情報が、以下のように**互いに参照し合わない**6つの独立した仕組みへ分散して保存されていることを確認した。

| # | 仕組み | 保存先 | 単位 | 実装 | 内容 |
|---|---|---|---|---|---|
| 1 | モデル別メタデータファイル | `<model>.ocr.json` / `<model>.tess.json` / `<model>.pt`（バイナリ内のchekpoint dict） | モデル単位 | `services/ocr_pipeline.py::_register_ocr_model()`（PaddleOCR/Tesseract）、`train.py`のcheckpoint保存（分類モデル） | 学習パラメータ・Dataset系譜・前処理Snapshot・実験情報など20+フィールド |
| 2 | 推論使用モデル選択 | `inference_model.json`（プロジェクト直下） | プロジェクト単位 | `services/inference_model.py` | 現在「推論に使用」しているengine/model |
| 3 | Release状態レジストリ | `releases.json`（プロジェクト直下） | プロジェクト単位、モデル別レコード | `services/release_manager.py` | Draft/Validated/Candidate/Production/Archived、バージョン履歴 |
| 4 | 実験カルテ | `experiments.json`（実験単位） | 実験（学習実行）単位 | `experiment_tracker.py`（本調査では詳細未読み込み。既存呼び出し元から存在を確認） | 学習条件・評価指標。`release_gate.py`が判定材料として参照 |
| 5 | モデル評価履歴（表示用） | ブラウザlocalStorage（`ocr_model_eval_history_by_project_v1`） | プロジェクト単位、モデル別 | `frontend/src/App.jsx`（`MODEL_EVAL_HISTORY_STORAGE_KEY`） | **Backendには一切保存されない。** ModelsView.jsxでの比較バッジ表示用 |
| 6 | モデル表示名（エイリアス） | ブラウザlocalStorage（`MODEL_ALIASES_STORAGE_KEY`） | プロジェクト単位、モデル別 | `frontend/src/App.jsx` | ユーザーが設定した表示名。`ModelMetadata.display_name`と概念上重複 |
| （参考） | 学習ジョブ実行状態 | SQLite `training_jobs`テーブル | ジョブ単位 | `db.py` | Job実行のライフサイクル（queued/running/succeeded/failed等）。モデル成果物そのものではない |
| （未配線） | `ModelMetadata` dataclass | なし（インメモリのみ、永続化コードが存在しない） | — | `services/model_metadata.py`（Feature #14） | 上記を統一する共通スキーマとして設計されたが、生成・保存・読込のいずれの処理も実装されていない |

### Engine判定ロジックも複数箇所に重複している

- `model_registry.py::list_model_infos()`: `resolve_engine_id()`（Engine Registry）経由で判定。未知engineは`"unknown"`（Refactor #11で是正済み）
- `release_gate.py::_model_engine()`: **`resolve_engine_id()`を使わず**、ファイル名の拡張子（`.tess.json`→tesseract、`.ocr.json`→paddleocr）で独自判定。ISSUE_MAP.mdのPhase2「Engine判定の一本化」として既に未着手のFuture Workに記録済み（未解消）
- `.pt`（分類モデル）は常に`engine="custom"`固定（`training_family`に基づく分岐で、ファイルに保存された`engine`フィールドは無い）

### modelInfos（Frontend）の実体

`GET /models/info` → `model_registry.py::list_model_infos()`が、上記#1（モデル別メタデータファイル）を`*.pt`/`*.ocr.json`/`*.tess.json`のファイルグロブでスキャンし、各形式ごとに手書きの辞書変換ロジックで70以上のキーを持つ`dict`を組み立てて返す。TrOCR用のファイルパターンは存在しない（Epic #1のFuture Workで確認済み）。この関数はAPI応答生成そのものであり、`ModelMetadata`とは無関係に独自の辞書を都度組み立てている。

### Models画面（Frontend）の実体

`ModelsView.jsx`は`modelInfos`をそのまま表示に使う。表示名は`modelAliases[name] || name`（上記#6のlocalStorage）。比較バッジ表示は`evalHistory`（上記#5のlocalStorage）。いずれも`ModelMetadata`の`display_name`フィールドとは無関係に、Frontend側で独自に管理されている。

### Inference（推論）の実体

`predict.py::predict_from_image()`は、エンジンごとに異なるmodel解決方式を持つ。

- `custom`/`paddleocr`/`tesseract`: `model`パラメータをファイル名として扱い、`resolve_model_path()`/`resolve_ocr_model_meta()`（`model_registry.py`）でプロジェクトの`models/`ディレクトリ内を検索
- `trocr`: `model`パラメータをHugging Face model ID・ローカルパスとしてそのまま`TrOCREngine.load()`へ渡す（ファイル名ルックアップを行わない、Epic #1で確定した設計）

この非対称性（3エンジンはファイル名ルックアップ、TrOCRは直接参照）は、`ModelMetadata.artifact_path`が将来のmodel_ref解決の接続点として設計時に想定されていた箇所である（[MODEL_METADATA.md](MODEL_METADATA.md)参照）。

### Evaluation（評価）の実体

`release_gate.py::evaluate_release_gate()`は、`experiments.json`（実験カルテ）とBenchmark結果（`_latest_benchmark_result()`）を判定材料として参照する。`ocr_evaluation.py`自体は評価の実行ロジック（Levenshtein距離等）を持つが、結果の永続化先は呼び出し元に委ねられている。Frontend表示用の評価履歴（上記#5）はBackendのこれらの仕組みとは別に、localStorageで独立管理されている。

### Export（モデル書き出し）の実体

2つの異なる意味の「Export」が存在する。

1. **学習成果物のExport**（PaddleOCR固有）: `ocr_pipeline.py::export_paddleocr_model()` → `register_exported_ocr_model()`が、学習チェックポイントを推論用形式へ変換し、同時に`.ocr.json`メタデータ（上記#1）を生成する。この関数は20以上のキーワード引数を個別に受け取っており、新しい追跡項目を追加するたびに複数箇所（関数シグネチャ・呼び出し元・`list_model_infos()`の変換ロジック）を同時に変更する必要がある
2. **Deployment Package Export**（Release Gate経由）: `job_manager.py::_handle_deployment_export()` → `release_manager.py::build_deployment_package()`が、Production状態のモデルをZIPへパッケージ化する。Production判定は上記#3（`releases.json`）に依存する

### API surface

既存のモデル関連APIは以下（すべて`src/app/main.py`）。

- `GET /models` — モデルファイル名一覧
- `GET /models/info` — `list_model_infos()`の結果（Frontendの`modelInfos`の実体）
- `GET /models/latest` — 最新モデルの解決
- `DELETE /models/{model_name}` — モデル削除（`safe_rmtree`等の安全ガード経由）
- `GET /api/models/download/{model_name}` — モデルファイルのダウンロード
- `POST /api/models/{model_name}/comment` — コメント（メモ）の保存

いずれも`ModelMetadata`を返さず、各エンドポイントが独自に辞書を組み立てている。

### DB

`training_jobs`テーブル（SQLite、`db.py`）のみ。モデル成果物そのものではなく、学習ジョブの実行状態を追跡する。既存の変更方式は`ALTER TABLE ADD COLUMN`による後方互換Migration（新規カラムは既定値付き）。モデルメタデータの永続化にDBを使う場合、この既存パターンを踏襲するか、ファイルベースを維持するかは要検討（下記「リスク」参照）。

### Cache

モデルメタデータそのものをキャッシュする仕組みは存在しない。`predict.py`の`_EASYOCR_READER_CACHE`/`_PADDLEOCR_READER_CACHE`は、エンジンのReader/インスタンスを言語・GPU設定単位でキャッシュするものであり、モデルメタデータとは無関係。Metadataの読み込み自体はファイルI/Oを都度行っており、明示的なキャッシュ層は無い。

## 問題点

1. **Single Source of Truthが存在しない**: 同じ「モデル」について、6つの独立した仕組みがそれぞれ部分的な情報を保持し、互いに参照しない。ある機能（例: Release Gate）が必要とする情報を得るには、複数の仕組みを個別に読みに行く必要がある
2. **Engine判定ロジックの重複**: `resolve_engine_id()`を使う箇所と、独自のファイル名拡張子判定を使う箇所（`release_gate.py`）が併存し、将来的な判定不一致のリスクがある
3. **Frontend-onlyの情報**: エイリアス・評価履歴はサーバー側に一切保存されず、ブラウザのlocalStorageのみに存在する。別端末・別ブラウザからは参照できず、Backend APIとしての一貫性も無い
4. **手書きの辞書変換ロジック**: `list_model_infos()`は70以上のキーを持つ辞書を、モデル形式ごとに個別のif/elif分岐で組み立てている。新しいエンジン（TrOCR等）や新しい追跡項目の追加のたびに、この巨大な関数へ手を入れる必要がある
5. **`ModelMetadata`が宙に浮いている**: Feature #14で設計・実装されたスキーマが、1年以上（本調査時点）実運用に一切使われず、6つの既存の仕組みとは無関係に存在している
6. **TrOCRのmodel_ref解決に既存の仕組みが使えない**: `.ocr.json`/`.tess.json`前提のファイル名ルックアップは、Hugging Face model ID・ローカルパスを直接扱うTrOCRには適用できない（Epic #1で確認済みの既知の制約）

## 理想構成

```text
Training
    ↓
Metadata生成
    ↓
Metadata保存（Single Source of Truth）
    ↓
Models / Inference / Evaluation / Deployment / Export
    （すべて同一Metadataを参照）
```

`ModelMetadata`を単一の真実源（Single Source of Truth）とし、以下の6つの利用者すべてが同じMetadataを読み書きする構成を目指す。

- **Models**: `list_model_infos()`（またはその後継）が`ModelMetadata`を返す。手書きの辞書変換ロジックを廃止し、Adapterがファイル形式間の差異を吸収する
- **Inference**: `predict.py`がmodel_ref解決に`ModelMetadata.artifact_path`（または後継フィールド）を使う。エンジンごとの非対称性（ファイル名ルックアップ vs 直接参照）を`ModelMetadata`側で吸収する
- **Evaluation**: 評価結果を`ModelMetadata`（または関連レコード）へ記録し、Frontend localStorageへの依存を段階的に解消する
- **Deployment**: `releases.json`の状態を`ModelMetadata`と整合させる（重複管理を避ける）
- **Export**: Export時に`ModelMetadata`を生成・更新する（現在の`register_exported_ocr_model()`の20+引数を、構造化された`ModelMetadata`インスタンスの生成に置き換える）

## Migration戦略

**既存プロジェクト・既存ファイルを壊さない**ことを最優先とする（CLAUDE.mdの互換性原則に従う）。一括移行ではなく、段階的なAdapter導入＋読み取り専用フォールバックを基本方針とする。

### 段階1: 読み取り専用Adapter

各既存形式（`.ocr.json`/`.tess.json`/`.pt`/`inference_model.json`/`releases.json`）から`ModelMetadata.from_dict()`相当への変換Adapterを実装する。既存ファイルは変更しない（読み取りのみ）。`list_model_infos()`等の既存関数は当面維持し、新しいAdapter経由の取得経路を並行して追加する（既存呼び出し元は変更しない）。

### 段階2: 新規生成時のMetadata書き込み

新しく学習・Exportされるモデルについてのみ、`ModelMetadata`を生成・保存する（既存モデルは段階1のAdapterで読み取り専用のまま扱う）。保存先はファイルベース（既存の`atomic_write_json`パターンを踏襲）を基本とし、DBへの保存は別途要否を判断する（下記「リスク」参照）。

### 段階3: 利用箇所の切り替え

Models → Inference → Evaluation → Deployment → Exportの順（依存関係が少ない順）で、各利用箇所を`ModelMetadata`経由の取得へ切り替える。既存フィールド・既存API応答形式は変更しない（内部実装のみ切り替え、外部互換性を維持）。

### 段階4: 旧管理方式の整理

すべての利用箇所が`ModelMetadata`経由になった後、重複していた保存先（`releases.json`とModelMetadataの状態、localStorageのエイリアス・評価履歴等）の統廃合を検討する。既存プロジェクトへの影響が大きいため、最終段階まで実施しない。

**既存モデル（`.tess.json`/`.ocr.json`/`.pt`）の一括変換・書き換えは行わない。** 段階1のAdapterが恒久的に既存形式を読み続けられる設計とし、Migration Versionの概念（`releases.json`の`RELEASES_FILENAME`スキーマバージョンや、`db.py`の`ALTER TABLE`パターンと同様）を導入するかどうかは、Issue分割後の各Featureで個別に判断する。

## Issue分割（提案）

Epic配下のFeature候補。ユーザーの例に沿って提案する（増減可）。

1. **Investigation**（本Issue）: 完了。本ドキュメントが成果物
2. **Architecture**: 段階1〜4の詳細設計（Adapter Interface、既存4形式それぞれの変換仕様、DBかファイルかの決定）。ADR形式での意思決定記録を推奨
3. **Metadata生成**: Export（`register_exported_ocr_model()`等）・学習完了時に`ModelMetadata`を生成する処理の実装（既存ファイルへの書き込みに追加する形。既存フィールドは変更しない）
4. **Metadata保存**: 生成された`ModelMetadata`の永続化機構の実装（段階2のファイル保存、または新規テーブル。Architecture Issueでの決定に従う）
5. **Models連携**: `list_model_infos()`/`GET /models/info`を`ModelMetadata`経由の取得へ段階的に切り替え（外部API応答形式は変更しない）
6. **Inference連携**: `predict.py`のmodel_ref解決を`ModelMetadata.artifact_path`（またはEngine別の後継フィールド）経由へ切り替え。TrOCRのmodel_ref解決見直し（Epic #1のFuture Work）と統合
7. **Evaluation連携**: 評価結果の保存先を`ModelMetadata`関連レコードへ統合し、Frontend localStorage依存の解消方針を決定（Epic #27のTrOCR評価連携とも調整が必要）
8. **Deployment連携**: `releases.json`との整合（Release Gate・Deployment Export）
9. **Cleanup**: 段階4（旧管理方式の整理）。既存プロジェクトへの影響確認を含む

## リスク

- **既存プロジェクトへの後方互換性**: `data/projects/<id>/`配下の既存ファイル形式は変更禁止（CLAUDE.md）。Adapterは既存ファイルの欠損フィールド・型不一致に対して寛容である必要がある
- **DB vs ファイルベースの選択**: `training_jobs`は`ALTER TABLE ADD COLUMN`パターンが確立しているが、モデルメタデータをDBへ移すか、既存の踏襲（プロジェクトディレクトリ内JSONファイル）を続けるかは未決定。DBへ移す場合、`training_jobs`との関連付け（外部キー相当）の設計が必要
- **Engine Registry未登録の`engine="custom"`**: `ModelMetadata.engine_id`はEngine Registry登録済みIDのみ許可するため、分類モデル（`.pt`）を表現できない既知の制約（Feature #14で確認済み）。本Migrationで解消するかは要判断
- **Frontend localStorageからの移行**: エイリアス・評価履歴をBackendへ移す場合、既存ユーザーのブラウザに保存された値をどう引き継ぐか（自動移行 or 明示的な再入力）の検討が必要
- **`release_gate.py::_model_engine()`の重複判定ロジック解消とのタイミング**: Engine判定の一本化（ISSUE_MAP.mdのPhase2、未着手）を本Migrationと同時に行うか、先に済ませておくかの順序判断が必要
- **Epic #27（TrOCR学習）との依存関係**: Epic #27がTrOCR学習成果物の保存方式を決める際、本Migrationの段階2（新規生成時のMetadata書き込み）の設計が前提となる。着手順序の調整が必要
- **スコープクリープ**: 6つの仕組みすべてを一度に統合しようとすると、既存機能への影響範囲が非常に大きくなる。段階的Migration（Adapter→新規生成→切り替え→整理）を厳守し、1 Issue = 1つの明確な完了条件という既存の分割ルール（ISSUE_MAP.md）を適用する

## Future Work

- `ModelMetadata.engine_id`のカスタム分類モデル（`engine="custom"`）対応（Feature #14で既知の制約として記録済み、本Migrationのスコープに含めるか要判断）
- Engine Registry Handler化（`ENGINE_BUILDERS`スタイルの`recognize()`実装、Epic #1のFuture Work）とMetadataProvider/ModelLoaderの関係整理（[ENGINE_REGISTRY.md](ENGINE_REGISTRY.md)参照）
- Frontend評価履歴・エイリアスのBackend移行時のUI設計（既存UIとの互換性維持）
