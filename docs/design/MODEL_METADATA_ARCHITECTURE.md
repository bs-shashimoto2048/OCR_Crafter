# Model Metadata Architecture

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Architecture [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30) / Investigation [#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29) / [ADR-0002](../adr/ADR-0002_Unified_Model_Metadata.md) / [MODEL_METADATA_MIGRATION_PLAN.md](MODEL_METADATA_MIGRATION_PLAN.md) / [MODEL_METADATA.md](MODEL_METADATA.md)（`ModelMetadata` dataclass設計、Feature #14）

本ドキュメントはArchitecture Issue #30の成果物であり、Investigation #29の調査結果を前提に、`ModelMetadata`をSingle Source of Truthへ段階的に移行するための設計を確定する。**本ドキュメント自体はコード変更を伴わない。**

> **2026-07-31追記**: PR [#31](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/31)のレビュー承認・Squash Merge（Squash Commit: `ce04863`）によりIssue #30はCompleted・Closed、[ADR-0002](../adr/ADR-0002_Unified_Model_Metadata.md)のStatusはAcceptedへ変更された。以降のFeature Issue（Canonical ModelMetadata Schema整備以降）は本ドキュメントの決定に基づいて進める。
>
> **2026-07-31追記2**: Feature [#32](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/32)（Canonical ModelMetadata Schema）**Completed**。6.2の決定どおり`schema_version`（`MODEL_METADATA_SCHEMA_VERSION = 1`）をdataclassのフィールドにはせず、`to_dict()`/`from_dict()`のenvelope値として実装。`is_valid()`（例外を送出しない`from_dict()`）・`replace()`（`dataclasses.replace()`の薄いラッパー）を追加。同値性は`@dataclass(frozen=True)`既定の`__eq__`をそのまま採用し、カスタム実装は追加していない（過剰実装を避けるため）。`copy()`は、frozenかつ`extra`もdeep copy済みで不変性が保証されているため実装しなかった（既定の値渡し・`replace()`で十分と判断）。PRレビューでschema_versionがbool/floatを誤って`1`と同一視して受理する不具合が見つかり、型を明示的に検証する修正を追加コミットで反映（PR [#33](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/33)、Squash Merge・Merge Commit: `b250c8f`）。永続化（Reader/Writer/Adapter/Catalog）は本Featureの対象外のまま、次のIssueはLegacy Metadata Adapter。
>
> **2026-07-31追記3**: Feature [#34](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/34)（Legacy Metadata Adapter）**Completed**。6.6の決定どおり単一`LegacyMetadataAdapter`（形式別クラス分割はしない）ではなく、`OCRMetadataAdapter`/`TesseractMetadataAdapter`/`InferenceMetadataAdapter`の3専用Adapter＋`LegacyMetadataAdapter`という委譲構成を採用（既知3形式の固定if/elif分岐のみ、Factory/Registry/Plugin/DIは導入しない）。各Adapterは`.get()`によるフィールド抽出のみを行い、Validationは一切自前で書かず`ModelMetadata.from_dict()`へ完全委譲（非Mapping入力も自前でエラーにせず`from_dict()`へそのまま渡す）。`model_id`はLegacy形式のファイル内容から一意に決定できないため、呼び出し側（将来のReader/Catalog）が解決した値を明示的に渡す設計とした。未対応形式は新設の`UnsupportedLegacyMetadataError`で区別。PR [#35](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/35)をSquash Merge・mainへ反映済み（Merge Commit: `434993d`）。レビューで挙がったMinor（`inference_model_id`の優先順位・`source`のtraining/backfill区別）は実装せず、[METADATA_READER_DESIGN_NOTES.md](../workitems/model-metadata/METADATA_READER_DESIGN_NOTES.md)へ未決事項として記録した。Reader/Writer/Model Catalog/Factory（生成用）は本Featureの対象外のまま、次のIssueはModelMetadata Reader/Writer実装。
>
> **2026-07-31追記4**: Feature [#36](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/36)（Metadata Reader）**Completed**。6.7の決定どおり、Canonical sidecar（`<model>.model_metadata.json`、命名規則を`metadata_reader.py::CANONICAL_METADATA_SIDECAR_SUFFIX`として実装）は`ModelMetadata.from_dict()`へ直接委譲、Legacyファイルは`LegacyMetadataAdapter`へ委譲する`MetadataReader`（`read_canonical()`/`read_legacy()`/`read()`）を実装した。`read()`はファイル名のみでCanonical/Legacy判定・Legacy形式種別判定を行う（内容を見て推測しない）。Filesystemアクセスは渡された単一Pathの読込のみ（`glob`/`os.walk`/ディレクトリスキャンは行わない）。I/O・JSON解析エラーは新設`MetadataReadError`（`OSError`、元例外を`__cause__`で保持）として、`UnsupportedLegacyMetadataError`（未対応形式）・`InvalidModelMetadataError`（Validation違反）と区別した。METADATA_READER_DESIGN_NOTES.mdの未決事項を本Featureで決定・実装（詳細は6.6・6.7の更新箇所、および同ノートの「決定済み」セクション参照）。PR [#37](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/37)をSquash Merge・mainへ反映済み（Merge Commit: `678524f`）。同PRレビューで挙がったMinor（6.6の関数名表現・6.7のfallback表現）を反映済み。Writer/Model Catalogは本Featureの対象外のまま、次のIssueはModelMetadata Writer実装。
>
> **2026-07-31追記5**: Feature [#38](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/38)（Metadata Writer）**Completed**。6.8の決定どおり、`ModelMetadata.to_dict()`の出力を`atomic_write_json`+`file_lock`（既存`services/atomic_io.py`）でそのまま書き込む`MetadataWriter.write(path, metadata)`を実装した。既存sidecarの読み取り込み（`created_at`保持等のマージ処理）は行わない（6.8を単純な上書き保存のみへ確定・旧方針の記述は削除済み）。渡された値が`ModelMetadata`インスタンスでない場合は既存の`InvalidModelMetadataError`を再利用（Writer独自のValidationは追加しない）。I/Oエラーは新設`MetadataWriteError`（`OSError`、`__cause__`保持）。PR [#39](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/39)をSquash Merge・mainへ反映済み（Merge Commit: `5b1564c`）。同PRレビューで挙がった`ModelMetadata.extra`のJSON直列化可能性に関する指摘は、コード変更せず[METADATA_WRITER_DESIGN_NOTES.md](../workitems/model-metadata/METADATA_WRITER_DESIGN_NOTES.md)へ将来検討事項として記録した。Reader（`metadata_reader.py`）は無変更。
>
> **2026-07-31追記6**: Feature [#40](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/40)（Model Catalog）**Completed**。6.9の決定どおり`ModelCatalog`（`list()`/`find()`/`load()`/`exists()`）を実装した。Directory探索（`iterdir`）は`ModelCatalog`のみが行い、`MetadataReader`（無変更）へは常に単一のPathのみを渡す。同一ベースファイルにCanonical sidecarとLegacyの両方が存在する場合はCanonicalを採用しLegacyを無視（マージしない）、Canonical不在時のみLegacyを採用。Legacyのmodel_idは暫定的にファイル名を採用（`data/model_ids.json`との統合は将来のIssue）。同一model_idは走査順で先勝ちのdeduplicationを行う。**Reader/Adapter由来の例外は握りつぶさず伝播させる方針とし、6.9の元の記述にあった「invalid metadata除外」は採用しなかった**（6.9の実装確定注記で明記・元の記述を修正済み）。`ModelCatalogError`はディレクトリ探索エラーのみを表す。`inference_model.json`・`.pt`は`list()`の対象外（[MODEL_CATALOG_DESIGN_NOTES.md](../workitems/model-metadata/MODEL_CATALOG_DESIGN_NOTES.md)参照）。PR [#41](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/41)をSquash Merge・mainへ反映済み（Merge Commit: `627b6f2`）。Writer/Factory/Resolverは本Featureの対象外のまま、次のIssueはTraining/Import時のMetadata生成（Factory）またはModels連携。
>
> **2026-07-31追記7**: Feature [#42](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/42)（Training Metadata Factory）**Completed**。6.11の決定どおり単一`ModelMetadataFactory`（Engine別クラス分割はしない）を実装し、`create_from_training()`を追加した。Reader/Writer/Catalogはいずれも利用せず（Directory探索・JSON保存を一切行わない）、Validationは`ModelMetadata.from_dict()`へ完全委譲する。`model_name`→`display_name`、`engine`→`engine_id`へ改名し、`ModelMetadata`に対応フィールドが存在しない`engine_version`・`task`は`extra`へ格納する（既存の`model_type`フィールドは別の実データ上の意味を既に持つため流用しなかった。詳細は[TRAINING_METADATA_FACTORY_DESIGN_NOTES.md](../workitems/model-metadata/TRAINING_METADATA_FACTORY_DESIGN_NOTES.md)参照）。呼び出し側の`extra`とFactory生成の`extra`（`engine_version`/`task`）が衝突する場合のみ、新設`TrainingMetadataFactoryError`（入力組み立てに関する例外）を送出する。`created_at`未指定時は`datetime.now().isoformat()`で生成、`schema_version`はdataclassフィールドではないため専用引数を持たず`to_dict()`シリアライズ時に自動付与される。PR [#43](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/43)をSquash Merge・mainへ反映済み（Merge Commit: `fee1885`）。Reader/Writer/Catalogは本Featureの対象外のまま、次のIssueはModels API連携。
>
> **2026-07-31追記8**: Feature [#44](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/44)（Models API）**Completed**。新設6.17の決定どおり単一`ModelsAPI` Facade（`list_models()`/`get_model()`/`exists()`/`create_metadata()`/`save_metadata()`）を実装した。Catalog/Factory/Writerはいずれも無変更、Readerは直接利用しない（読込は常にCatalog経由）。Validationは自前で持たず、Catalog/Factory/Writerへ完全に委譲する。既存`/models/info`（`model_registry.py::list_model_infos()`）への配線は行わず、既存エンドポイントは無変更のまま維持することで後方互換性を保った（調査結果・将来のConsumer切替方針は[MODELS_API_DESIGN_NOTES.md](../workitems/model-metadata/MODELS_API_DESIGN_NOTES.md)参照）。新設`ModelsAPIError`はFacade自体の呼び出し形状不正（コンストラクタの型不正・`create_metadata()`の必須引数欠損）のみを対象とし、下位層の例外はラップせず伝播させる。PR [#45](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/45)をSquash Merge・mainへ反映済み（Merge Commit: `7fec5fb`）。
>
> **2026-07-31、Epic #28を一旦停止**: ユーザー判断によりEpic #28配下の新規Feature着手を一旦停止し、UIレビュー（モデル管理・学習・評価画面）を実施する。次のIssue（実際のConsumer切替・Inference連携等）はUIレビュー完了後に着手要否を判断する。

## 1. 目的

モデルに関する情報（識別・表示・追跡）を、複数の独立した永続化機構から`ModelMetadata`（Feature #14で実装済みのdataclass）へ段階的に統一する。既存の保存形式・API・UIとの後方互換を維持しながら、Consumer（Models/Inference/Evaluation/Deployment/Export）が最終的に同一のMetadataを参照する構成へ移行する。

## 2. 非目的

- 既存モデルファイル（`.ocr.json`/`.tess.json`/`.pt`）の一括変換・書き換え
- `releases.json`（Release状態遷移ロジック自体）・`experiments.json`（実験記録ロジック自体）の置き換え
- OCR学習アルゴリズム・評価ロジック・Benchmark・Release Gateの実装（[Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)の責務）
- DB（`training_jobs`）Schemaの変更
- Issue #8（`test_register_ocr_model_records_dataset_lineage`失敗）の修正

## 3. 現状構成

Investigation #29で確認した現状（詳細は[MODEL_METADATA_MIGRATION_PLAN.md](MODEL_METADATA_MIGRATION_PLAN.md)参照）を、実コード調査で再確認・補強した。

```text
Training ──────> 各Engine固有ファイル（.ocr.json / .tess.json / .pt）
Models ────────> modelInfos（model_registry.py::list_model_infos()、手書き辞書変換）
Inference ─────> inference_model.json（選択保持） + resolve_model_path()/resolve_ocr_model_meta()/
                  resolve_tesseract_model_meta()（Tesseract/PaddleOCR/custom個別） + TrOCRは
                  model_ref（HF ID/ローカルパス）をそのままTrOCREngine.load()へ渡す（未統合）
Evaluation ────> experiments.json（実験カルテ、evaluation/evaluation_profile） + Frontend
                  localStorage（ocr_model_eval_history_by_project_v1、Backend未連携）
Release ───────> releases.json（Draft/Validated/Candidate/Production/Archived、モデルファイル名キー）
Display ───────> Frontend localStorage（ocr_model_aliases_by_project_v1、display name別名）
Management No ─> data/model_ids.json（M0001形式。model_registry.py::assign_model_ids()）
```

### 3.1 `ModelMetadata` dataclass（Feature #14、`src/app/services/model_metadata.py`）

- 必須フィールド: `model_id: str`・`engine_id: str`（`engine_registry.resolve_engine_id()`で検証。未登録engineは`InvalidModelMetadataError`）
- 任意フィールド（すべて`str | None`）: `display_name`・`model_type`・`created_at`・`updated_at`・`artifact_path`・`dataset_id`・`experiment_id`・`preprocess_version`・`source`
- `extra: Mapping[str, Any]`（構築時にdeep copy + `MappingProxyType`で凍結。既知フィールドとのキー衝突は拒否）
- `status`・`schema_version`は**意図的に未採用**（3.6参照）
- `to_dict()`/`from_dict()`実装済み（round-trip可能。未知キーは無視）
- **既存コードへの参照はゼロ**（`model_metadata.py`自身以外のどこからも import されていない）

### 3.2 現在の永続化方式

| 方式 | 誰が書くか | 誰が読むか | 保存場所 | ファイル単位 | 更新タイミング |
|---|---|---|---|---|---|
| `.tess.json` | `ocr_pipeline.py`（学習完了時） | `model_registry.py::list_model_infos()`/`resolve_tesseract_model_meta()`、`release_manager.py`（Model Card/Deployment） | `data/projects/<id>/models/` | モデル1件=1ファイル | 学習完了時・コメント編集時 |
| `.ocr.json` | `ocr_pipeline.py::register_exported_ocr_model()`（20+キーワード引数） | 同上（PaddleOCR系） | 同上 | 同上 | 同上 |
| `.pt` | `train.py`（分類モデル） | `model_registry.py::list_model_infos()`（`torch.load`） | 同上 | 同上 | 学習完了時 |
| `inference_model.json` | `services/inference_model.py::save_inference_model()` | Inference画面の選択復元 | `data/projects/<id>/`直下 | プロジェクト1件=1ファイル | 推論モデル選択時 |
| `releases.json` | `services/release_manager.py` | `release_gate.py`・Model Card・Deployment Package | 同上 | 同上（`models`辞書+`history`配列） | ステータス変更・昇格時 |
| `experiments.json` | `services/experiment_tracker.py::record_experiment()`/`attach_evaluation()` | `release_gate.py::_experiment_for_model()`、実験比較UI | 同上 | 同上（`items`配列） | 学習完了時・評価実行時 |
| `data/model_ids.json` | `model_registry.py::assign_model_ids()` | `experiment_tracker.py::_model_id_map()`、Models画面表示 | `data/`直下（全プロジェクト共通） | 全体1ファイル | 新規モデル検出時（作成日時順で一括採番） |
| localStorage alias | `App.jsx`（`ocr_model_aliases_by_project_v1`） | `ModelsView.jsx`表示 | ブラウザ | プロジェクト単位 | ユーザー編集時 |
| localStorage 評価履歴 | `App.jsx`（`ocr_model_eval_history_by_project_v1`） | `ModelsView.jsx`比較バッジ | ブラウザ | プロジェクト単位 | 評価実行時（Backend連携なし） |

すべて**モデルファイル名（例: `digits_20260101.tess.json`）をキー**に相互参照している。`data/model_ids.json`のみ、`{project_id}/{ファイル名}`をキーとする作成順採番のプロセス外レジストリを別途持つ。

### 3.3 Consumer一覧と現在の情報源

| Consumer | 現在の情報源 |
|---|---|
| Models画面（`ModelsView.jsx`） | `GET /models/info` → `list_model_infos()`の手書き辞書 |
| 通常推論・Batch推論・Rapid OCR | `predict.py::predict_from_image()`。Tesseract/PaddleOCRは`resolve_model_path()`/`resolve_ocr_model_meta()`/`resolve_tesseract_model_meta()`経由、TrOCRは`model`文字列をそのまま`TrOCREngine.load()`へ（`_predict_with_trocr()`。model_ref解決は現状Metadata未使用） |
| Evaluation | `ocr_evaluation.py`（Tesseract専用の評価器構築）＋`experiment_tracker.py::attach_evaluation()`が結果を実験カルテへ保存 |
| Release Gate | `release_gate.py::evaluate_release_gate()`（`_experiment_for_model()`/`_latest_benchmark_result()`/`_model_engine()`） |
| Export（学習成果物） | `ocr_pipeline.py::register_exported_ocr_model()` |
| Export（Deployment Package） | `release_manager.py::build_deployment_package()`（`.tess.json`のメタ＋`training_preprocess`＋Model Card＋Release Noteをzip化） |
| Model削除・コメント編集 | `model_registry.py::delete_model()`/`set_model_comment()` |

### 3.4 Engine判定の重複

- `model_registry.py::list_model_infos()`: `resolve_engine_id(payload.get("engine"), registry=...)`（Engine Registry経由。未登録・未指定は`"unknown"`、暗黙フォールバックなし）
- `release_gate.py::_model_engine()`: **ファイル名拡張子のみ**で判定する独自ロジック（`.tess.json`→`"tesseract"`、`.ocr.json`→`"paddleocr"`、それ以外→`""`）。`.pt`（custom）・TrOCRは常に空文字列になる
- Engine Registry（`create_default_registry()`）には`tesseract`/`paddleocr`/`easyocr`/`trocr`の4エンジンのみ登録済み。**`custom`（分類モデル）は未登録**のため、`ModelMetadata(engine_id="custom", ...)`は現状`InvalidModelMetadataError`になる

### 3.5 API Surface（`src/app/main.py`）

`GET /models` / `GET /models/info` / `GET /models/latest` / `DELETE /models/{model_name}` / `GET /api/models/download/{model_name}` / `POST /api/models/{model_name}/comment`。すべてモデルファイル名をパスパラメータ・識別子として使う。`ModelMetadata`や`model_id`（Canonical）を受け取るエンドポイントは存在しない。

### 3.6 DB・キャッシュ

- SQLite（`db.py`）は`training_jobs`テーブルのみ。モデル成果物自体は扱わない。既存Migrationパターンは`ALTER TABLE ADD COLUMN`（本Architectureでは踏襲しない。理由: モデルメタデータはファイルベースであり、DB化は今回のScope外）
- モデルメタデータ専用のキャッシュは存在しない（`predict.py`の`_EASYOCR_READER_CACHE`/`_PADDLEOCR_READER_CACHE`はエンジンReaderインスタンスのキャッシュであり、メタデータとは無関係）
- 原子的I/O・プロセス間ロックの共通基盤として`services/atomic_io.py`（`atomic_write_json`/`file_lock`）が既に存在し、`releases.json`/`experiments.json`/`inference_model.json`/model_ids.jsonすべてがこれを再利用している

## 4. 問題点

1. **`ModelMetadata`が未配線**: 実装済みだが参照ゼロ。Frontend「登録済みモデルから選択」（Feature #25）は実環境で常に0件
2. **Engine判定が2箇所に重複**: `resolve_engine_id()`と`release_gate.py::_model_engine()`が食い違う（後者はcustom/TrOCRを判定できない）
3. **`model_id`概念が既に2つ存在**: `ModelMetadata.model_id`（未使用）と`data/model_ids.json`のM0001形式（稼働中、`experiment_tracker.py`等が参照）。両者を素朴に別物として実装すると、将来「モデルの識別子」が3つ目に増える
4. **モデル別メタデータの拡張性課題**: `register_exported_ocr_model()`の20+キーワード引数と`list_model_infos()`の手書き辞書変換の両方に手を入れる必要がある
5. **Frontend localStorageの評価履歴・エイリアスがBackendと非連携**: プロジェクトを跨いだ共有・バックアップができない
6. **`custom`（分類モデル）がEngine Registry未登録**: `ModelMetadata`の`engine_id`検証を素通しできない

## 5. 理想構成

```text
Training / Import / Export
            │
            ▼
 ModelMetadata Factory
            │
            ▼
 ModelMetadata Writer
            │
            ▼
 Canonical Metadata Store（sidecar JSON）
            │
            ▼
 Model Catalog / Resolver
            │
   ┌────────┼────────┐
   ▼        ▼        ▼
 Models  Inference Evaluation
```

移行中（Phase 1〜3の間、詳細は7章）:

```text
Legacy Files（.ocr.json / .tess.json / .pt / inference_model.json）
     │
     ▼
LegacyMetadataAdapter（読み取り専用・既存ファイル無変更）
     │
     ▼
ModelMetadata Reader（Canonical優先、無ければAdapterへfallback）
     │
     ▼
Model Catalog
     │
 ┌───┼──────────────┐
 ▼   ▼              ▼
Models Inference Evaluation
```

## 6. コンポーネント設計

以下、各コンポーネントの責務・非責務・採用案を確定する（複数案の比較は[ADR-0002](../adr/ADR-0002_Unified_Model_Metadata.md)「Alternatives Considered」参照）。

### 6.1 Canonical Metadata Schema — 採用: 既存`ModelMetadata`をそのまま採用

- 既存dataclass（3.1参照）を**破棄しない**。Feature #14の設計判断（`status`/`schema_version`をdataclass内に持たない）を維持する
- 必須のSchema拡張は**今回時点でなし**。フィールド追加が必要になった場合は「Canonical ModelMetadata Schema整備」Issue（後述10章）で個別に判断する（推測で先回り追加しない）
- 後方互換: `from_dict()`が未知フィールドを無視する既存実装により、将来フィールド追加時も旧sidecarファイルの読み込みは壊れない

### 6.2 保存形式 — 採用: モデルディレクトリ横のsidecar JSON

- ファイル名: `<モデルファイル名>.model_metadata.json`（例: `digits_20260101.tess.json.model_metadata.json` / `resnet_20260101.pt.model_metadata.json`）
  - 既存の`*.tess.json`/`*.ocr.json`globパターンと衝突しない（末尾が`.model_metadata.json`のため`fnmatch`の対象外）
  - モデル本体と1対1で対応し、モデル削除時に一緒に削除しやすい
- 保存場所: 既存の`paths.models`（`data/projects/<id>/models/`）そのまま。新しいディレクトリ階層を作らない
- envelope形式: `{"schema_version": 1, "metadata": {...ModelMetadata.to_dict()の内容...}}`
  - `schema_version`は**sidecarファイルのenvelope**に持たせる（dataclass自体には追加しない。`releases.json`の`schema_version`と同じ発想だが、対象はファイル形式でありdataclassではない）
  - 将来のenvelope形式変更に備えるが、v1のみが必要な間はMigration関数を書かない（YAGNI）
- 書き込みは`services/atomic_io.py::atomic_write_json`+`file_lock`を再利用する（新しいI/Oプリミティブを作らない）
- Windows/Linux互換: パスは常に相対パス基準で保存し、実行時に`paths.models`基準で解決する（絶対パスをそのままsidecarへ書かない。3.2の既存メタ同様、`artifact_path`はプロジェクトルート相対または`Path.name`のみを保存する方針とする）

### 6.3 model_id — 採用: 既存のM0001管理No登録簿をそのまま再利用する

- **新しいUUID等は発行しない**。`model_registry.py::assign_model_ids()`が既に「作成日時順・作成順採番・削除後も再利用しない・既存モデルにも遡って付与可能」という要件をすべて満たした状態で稼働している（`data/model_ids.json`）
- `ModelMetadata.model_id`には、この既存M0001形式の値をそのまま格納する（Adapter・Factory双方が`assign_model_ids()`経由で解決する）
- Engine間の衝突: 既存レジストリのキーが`{project_id}/{ファイル名}`のため、エンジンを跨いでも衝突しない
- **既知の制約（今回は解決しない）**: 登録簿のキーがファイル名ベースのため、モデルファイルのrename・移動を追跡すると新しいM0001が振られる。これは現行システムに既に存在する制約であり、本Architectureで新規に持ち込む問題ではない。真に安定な識別子（内容ハッシュ等）が必要になった場合は将来のFuture Work（15章）とする
- Frontend表示名（`display_name`/alias）とは完全に分離する（6.13参照）

### 6.4 engine_id — 採用: `resolve_engine_id()`（Engine Registry）へ一本化

- Canonical ID: `tesseract`/`paddleocr`/`easyocr`/`trocr`（既存Engine Registry登録済み）+ 新規`custom`（分類モデル、今回Architectureで追加を決定。実装は「Canonical ModelMetadata Schema整備」Issueで行う。**本Issue自体はコードを変更しない**）
- alias入力（大文字混在等）は`resolve_engine_id()`の`str.strip().lower()`正規化のみ（暗黙のエンジン別名変換はしない、既存方針を踏襲）
- unknown/invalidの扱い: `resolve_engine_id()`が`None`を返すケース（未登録・空文字）は、Adapterが当該モデルを**Catalogから除外**し、診断ログを残す（4.6/8章参照）。他エンジンへの推測フォールバックはしない
- `release_gate.py::_model_engine()`の独自拡張子判定は、Cleanup Issue（12章の#12）で`resolve_engine_id()`ベースの判定へ置き換える（本Issueでは変更しない）
- Frontendへの公開形式: 既存の`normalizeEngineId()`/`engineDisplayLabel()`（`frontend/src/lib/engineResolution.js`）とCanonical IDの語彙を一致させる（既に一致している。変更不要）

### 6.5 artifact_pathとmodel_ref — 概念を分離する

```text
artifact_path = 保存成果物の実体位置（Backend内部のファイル/ディレクトリ参照）
model_ref     = 推論エンジンがロード時に受け取る参照
                （Hugging Face model ID、ローカルパス、または既存.ocr.json/.tess.jsonのファイル名）
```

- 両方が必要（同じ値になるケースもある。例: PaddleOCRは`inference_dir`がartifact_pathでもありmodel_ref相当でもある。TrOCRはHugging Face IDがartifact_pathを持たない場合がある）
- Frontendへ返してよいのは相対パス・ファイル名のみ。絶対パスは公開しない（既存`list_model_infos()`が`model_dir`等の絶対パスをそのまま返している箇所は、本Architectureのスコープ外の既存動作として現状維持し、Models連携Issue（10章）で見直すかを判断する）
- path traversalは既存の`_is_safe_model_artifact_dir()`（`model_registry.py`）と同等の許可ルート検証パターンを、新規Reader/Writerでも踏襲する（9章）

### 6.6 Adapter — 採用: 3専用Adapter＋`LegacyMetadataAdapter`（Factory/Registry/Plugin/DIは導入しない）

- 責務: 旧形式（`.ocr.json`/`.tess.json`/`.pt`/`inference_model.json`）→`ModelMetadata`への**読み取り専用**変換
- 非責務: ファイル保存・model loading・推論・Training・UI表示・Release判定
- 実装方針（Feature #34で確定）: 形式ごとに`OCRMetadataAdapter`（`.ocr.json`）・`TesseractMetadataAdapter`（`.tess.json`）・`InferenceMetadataAdapter`（`inference_model.json`）の3専用クラスを分離し、`LegacyMetadataAdapter`が固定的なif/elif分岐でそれらへ委譲する（Factory・Registry・Plugin・DIといった動的解決の仕組みは導入しない。過剰なクラス分割を避けつつ、将来Adapterが増えることを前提とした最小限の分離）
- `inference_model.json`・`releases.json`・`experiments.json`はAdapterの直接の変換対象では**ない**（これらは「どのモデルが選択されているか/どの状態か」という別軸の情報であり、`ModelMetadata`自体の生成源ではない。6.14/6.15で境界を扱う）

**実装確定（Feature #34/#36、Design Decision）**:

- `source`（training/backfill）: `OCRMetadataAdapter.adapt()`/`TesseractMetadataAdapter.adapt()`は`source: str = "training"`をAdapter直接呼び出し時の既定値として持つ。Metadata Reader（6.7）はこれを`"backfill"`で明示的に上書きする。既存モデルへの遡及読み取り（Reader経由）と、学習・Export完了直後のリアルタイム変換（将来Writerが直接Adapterを呼ぶ想定）を区別するための決定
- `inference_model.json`固有の`inference_model_id`は、Adapter自体は関知しない（Reader側の責務、下記6.7参照）

### 6.7 Reader — 採用: 渡された1ファイルの読込のみ（Directory探索・Fallback探索は行わない）

- 責務: 呼び出し側から渡された単一のPath（Canonical sidecarまたはLegacyファイルのいずれか1件）を読み込み、`ModelMetadata`を返す
- Canonical sidecar（`<model>.model_metadata.json`）は`ModelMetadata.from_dict()`へ直接委譲する。schema_version検証・Validationは自前で行わない
- Legacy形式（`.ocr.json`/`.tess.json`/`inference_model.json`）は`LegacyMetadataAdapter`へ委譲する。Readerは旧形式を直接理解しない（責務分離）
- Canonical/Legacyの判定・Legacy形式種別の判定は、渡されたファイル名のみで行う（内容を見て推測しない）
- **Reader自身はDirectory探索（`glob`/`os.walk`等）もFallback探索（「Canonical sidecarが無ければ同じモデルのLegacyファイルを探す」といった複数ファイルにまたがる判定）も行わない。** Canonicalとして渡されたファイルが壊れている・存在しない場合は`MetadataReadError`/`InvalidModelMetadataError`をそのまま送出し、Legacyへの自動フォールバックは行わない。「無ければLegacyへ」という複数ファイル間の解決は、ディレクトリを列挙できる**Model Catalog（未実装、後続Issue）の責務**とする

**実装確定（Feature #36、Design Decision）**:

- **`inference_model_id`優先順位**: 呼び出し側が`model_id`を明示指定した場合はそれを優先する。指定が無い場合のみ、`inference_model.json`内の`inference_model_id`へfallbackする（`.ocr.json`/`.tess.json`にはこの概念が無いため対象外。両方とも無い場合は`model_id=None`のまま`ModelMetadata.from_dict()`へ渡し、既存の必須フィールドValidationが欠損として拒否する）
- I/O・JSON解析エラーは`MetadataReadError`（`OSError`のサブクラス）として、`UnsupportedLegacyMetadataError`（形式未対応）・`InvalidModelMetadataError`（Validation違反）と型で区別する
- ファイル名判定（`.model_metadata.json`/`.ocr.json`/`.tess.json`/`inference_model.json`）は、実際の命名規則（`ocr_pipeline.py::_register_ocr_model()`が`ocr_<engine>_<timestamp>.ocr.json`、`tesseract_pipeline.py::register_tesseract_model()`が`<lang>.tess.json`）では互いに衝突しないことを確認済み

### 6.8 Writer — 採用: 新規モデルのみへの原子的書込（Feature #38で確定）

- 責務: Canonical Metadata保存（`atomic_write_json`+`file_lock`を再利用）・schema_version付与・directory作成不要（既存`models/`へ書くのみ）
- 新規モデルのみを書込対象とする段階的方式（Phase 2）。既存モデルの一括書き換えはMigration方針に含めない（14章）
- **overwrite方針**: `MetadataWriter.write(path, metadata)`は`ModelMetadata.to_dict()`の出力を`atomic_write_json`+`file_lock`でそのまま書き込む**単純な上書き保存のみ**を行う。**Writerは既存sidecarを読み込まない・マージしない**（`created_at`の保持を含め、既存Metadataとの部分更新・引き継ぎは一切行わない）。これはRead-Modify-Writeであり、「書くだけ」というWriterの責務を超えるため、本Issueのスコープに含めない。`created_at`の保持等が将来必要になった場合は、Model CatalogまたはMigration専用の仕組みが既存Metadataを読み込んだ上で`ModelMetadata.replace()`等により値を引き継いだ新しいインスタンスを構築し、Writerへ渡す設計とする
- 渡された値が`ModelMetadata`インスタンスでない場合は、既存の`InvalidModelMetadataError`を再利用する（Writer独自の例外・Validationロジックは追加しない）
- I/Oエラーは新設`MetadataWriteError`（`OSError`のサブクラス）として、`__cause__`で元例外を保持する

### 6.9 Model Catalog（Registry/Repository相当） — 採用名称: `ModelCatalog`

- 「Registry」はEngine Registry・`data/model_ids.json`の暗黙レジストリと語が衝突するため、モデル一覧提供の責務には`ModelCatalog`を使う
- 責務: 一覧取得（Reader経由でCanonical+Legacy合成）・model_id検索・duplicate排除・sort
- 非責務: Engine Registry（Engine自体の定義）とは別責務。書き込みは行わない（Writer専任）
- cache/refreshは6.16で扱う（今回は実装しない）

**実装確定（Feature #40、スコープ決定）**:

- API: `list()`（全件）・`find(model_id)`（該当が無ければ`None`）・`load(model_id)`（該当が無ければ`ModelCatalogError`）・`exists(model_id)`
- Directory探索（`iterdir`）は`ModelCatalog`のみが行う。`MetadataReader`（6.7）へは常に単一のPathのみを渡す（Reader自体の変更は行わない）
- Canonical優先: 同一ベースファイル（`<X>.model_metadata.json`の`<X>`部分）についてCanonicalとLegacyの両方が存在する場合、必ずCanonicalを採用しLegacyは無視する（読み取り込みマージはしない）
- Legacy fallback: Canonicalが存在しないベースファイルのみ、対応するLegacy形式（`.ocr.json`/`.tess.json`）を`MetadataReader.read_legacy()`経由で採用する。Legacyのmodel_idは、`data/model_ids.json`（M0001形式）への統合をまだ行わず、暫定的にLegacyファイル自身のファイル名を採用する（`model_registry.py`との統合は将来のIssueで判断する）
- **`invalid metadata除外`は採用しない**: 元の6.9の記述（“invalid metadata除外”）は本Featureでは実装していない。破損ファイル・Validation違反・未対応形式はいずれも`ModelCatalogError`へ変換せず、Reader/Adapter由来の例外（`MetadataReadError`/`InvalidModelMetadataError`/`UnsupportedLegacyMetadataError`）をそのまま呼び出し側へ伝播させる（握りつぶさない。安全な除外・診断ログは将来のIssueで検討する）
- `ModelCatalogError`はディレクトリ探索エラー（対象ディレクトリが存在しない・権限無し・`load()`の対象未検出）のみを表す
- `engineフィルタ`は本Featureでは実装していない（将来必要になれば`list()`の呼び出し側でフィルタするか、専用引数を追加するかを別途判断する）
- `inference_model.json`（プロジェクトルート直下の「現在選択中モデル」ポインタ）と`.pt`（Legacy Adapter未対応）は`list()`の対象外（詳細は[MODEL_CATALOG_DESIGN_NOTES.md](../workitems/model-metadata/MODEL_CATALOG_DESIGN_NOTES.md)参照）

### 6.10 Resolver — 採用: `model_id → ModelMetadata → model_ref`の解決責務を新設するが、既存`POST /predict`は変更しない

- 責務: `model_id`（Canonical）を受け取り、`ModelCatalog`経由で`ModelMetadata`を引き、`model_ref`/`artifact_path`を返す
- 今回のArchitectureでは、既存`POST /predict`の`model`パラメータ（文字列。ファイル名かHugging Face IDかを呼び出し側が知っている前提）を直ちにmodel_idへ置き換える設計は**採用しない**。既存Frontendの選択UI・API契約を壊さないことを優先する（CLAUDE.mdの後方互換原則）
- Resolverは「Inference連携」Issue（10章）で、既存の`model`文字列解決経路（`resolve_model_path()`等）と併存する形で導入する。model_idのopaque化（Frontendが内部パスを知らずに済む形）は将来のFuture Work（15章）とする

### 6.11 Factory / Builder — 採用: 単一`ModelMetadataFactory`（Engine別クラス分割はしない）

- 責務: Training完了時・Export時・外部モデル登録時に`ModelMetadata`を構築する
- 入力: `engine_id`・`artifact_path`・`model_ref`・training parameters・metrics・base model・`created_at`・`source`
- 各Engine別Factoryは不要と判断する（現状4エンジン+custom程度の規模であり、`LegacyMetadataAdapter`同様、関数レベルの分岐で十分。将来6エンジン目以降で再検討する）

**実装確定（Feature #42、Training Metadata Factory）**: `ModelMetadataFactory.create_from_training()`として実装した。`ModelMetadata`の実フィールド名に合わせ`engine`→`engine_id`・`model_name`→`display_name`へ改名し、対応フィールドが存在しない`engine_version`・`task`は`extra`へ格納する（`model_type`は既に別概念のため流用しない）。Reader/Writer/Catalogはいずれも利用せず、Validationは`ModelMetadata.from_dict()`へ完全委譲する。詳細は[TRAINING_METADATA_FACTORY_DESIGN_NOTES.md](../workitems/model-metadata/TRAINING_METADATA_FACTORY_DESIGN_NOTES.md)参照。

### 6.12 State / Status — 採用: 追加しない（既存dataclassの判断を維持）

- `ModelMetadata`に状態フィールドを追加**しない**。理由は`model_metadata.py`のdocstringに既に明記されている設計判断と同じ:
  - モデルファイル自体には「状態」に対応する実データが存在しない
  - Job状態（`training_jobs`テーブル）・Release状態（`releases.json`のDraft/Validated/Candidate/Production/Archived）は、それぞれ別の確立した概念であり、3つ目の状態機械を`ModelMetadata`へ持ち込むと混同を招く
  - 必要な「状態」はConsumer側（Release Gate等）が`releases.json`を直接参照すればよく、`ModelMetadata`経由にする必然性がない
- Workflow Engine化は行わない

### 6.13 Display情報 — 採用: 実体情報と分離を維持、localStorage aliasは今回移行しない

- `display_name`（`ModelMetadata`）・alias（Frontend localStorage）・`model_id`・`artifact_path`・`model_ref`はそれぞれ独立した概念として扱う
- 今回のArchitectureでは、Frontend localStorageの`ocr_model_aliases_by_project_v1`を`ModelMetadata.display_name`へ移行する設計は**採用しない**（Consumer切替の対象外。UIの表示名編集機能はプロジェクトローカルのまま維持し、Backend Canonical Metadataとの統合は「Models連携」Issue（10章）でMigration要否を個別判断する）
- 理由: aliasは「ユーザー個人のブラウザ上の表示設定」であり、Canonical Metadata（Backend・ファイルベース）へ即座に統合すると、複数ユーザー・複数ブラウザでの一貫性設計が必要になり、本Architectureのスコープが拡大しすぎる

### 6.14 Evaluation情報 — 採用: Metadata本体へ埋め込まない、`experiment_id`で参照

- `ModelMetadata.experiment_id`（既存フィールド）を使い、評価履歴の実体は`experiments.json`（`experiment_tracker.py`）に置いたまま参照する
- 評価履歴を`ModelMetadata`へ無制限に追加する設計は採用しない（1モデルに対し評価は複数回行われうるため、都度増える配列をdataclassへ持たせると、6.2のsidecarファイルが際限なく肥大化する）
- Frontend localStorageの評価履歴（`ocr_model_eval_history_by_project_v1`）をBackendへ連携するかどうかは、「Evaluation連携」Issue（10章）で個別判断する（今回のArchitectureでは決定しない）
- Epic #27のTrOCR評価ロジックそのものは対象外

### 6.15 Release / Deployment情報 — 採用: 参照IDのみ持つ、別Entityとして維持

- `releases.json`の情報（Status/Version/History）を`ModelMetadata`へ統合しない。モデルファイル名（既存キー）でのクロス参照を維持する
- 理由: Release状態遷移ロジック（`release_manager.py`）は`ModelMetadata`と無関係に既に確立しており、統合するメリットよりリスク（状態機械の二重管理）が大きい
- Release Gateロジック自体は[Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)の責務

### 6.16 Cache — 採用: 今回は実装しない、設計のみ残す

- 必要性: `ModelCatalog`の一覧取得は現状のファイルglob程度のコストであり、即座にキャッシュが必要とは判断しない
- 将来必要になった場合の設計方針: cache keyは`models/`ディレクトリのmtime + ファイル一覧のハッシュ、invalidationは明示的refresh（API呼び出し時の自動再走査を既定とし、起動時読込のみに頼らない）
- 今回のIssue・後続Issueでもキャッシュは実装しない

### 6.17 Models API — 採用: 単一`ModelsAPI` Facade（Migration Phase 5）

- 責務: `UI → Models API → Catalog / Factory / Writer`の橋渡しを行う薄いFacade。Models API自身はMetadataを保持しない（状態を持たない）
- API最低限: `list_models()`（→`ModelCatalog.list()`）・`get_model()`（→`ModelCatalog.load()`）・`exists()`（→`ModelCatalog.exists()`）・`create_metadata()`（→`ModelMetadataFactory.create_from_training()`）・`save_metadata()`（→`MetadataWriter.write()`）
- Reader（`MetadataReader`）は直接利用しない。読込は常に`ModelCatalog`経由とする
- Validationは自前で持たず、Catalog/Factory/Writerがそれぞれ委譲する先（`ModelMetadata.from_dict()`等）へ完全に委ねる
- 既存`/models/info`（`model_registry.py::list_model_infos()`）への配線は本Featureでは行わない。既存エンドポイントは無変更のまま維持し、後方互換性は「変更しないことによって」自動的に維持する。実際のConsumer切替（`/models/info`をCatalog経由へ）はADR-0002の「1 Issue = 1 Consumer」方針に従い別Issueとする（詳細は[MODELS_API_DESIGN_NOTES.md](../workitems/model-metadata/MODELS_API_DESIGN_NOTES.md)参照）

**実装確定（Feature #44、Models API）**: `ModelsAPI`（`src/app/services/models_api.py`）として実装した。Catalog/Factory/Writerの実装・責務はいずれも無変更。新設`ModelsAPIError`は、Facade自体の呼び出し形状が不正な場合（コンストラクタの`directory`引数が不正な型、`create_metadata()`が必須キーワード引数を欠いて`TypeError`となった場合）のみに用い、Catalog/Factory/Writer/Schemaが送出する既存の例外はラップせずそのまま伝播させる。

## 7. Migration戦略（確定）

### Phase 1: Adapter導入

```text
旧形式（.ocr.json/.tess.json/.pt/inference_model.json）
  ↓
LegacyMetadataAdapter（読み取り専用）
  ↓
ModelMetadata（メモリ上のみ。ファイルへは書かない）
```

既存保存物は一切変更しない。

### Phase 2: 新規モデルへCanonical Metadata書込

新規Training成果物・新規登録モデル・新規Exportのみ、Writerを通じてsidecarへ`ModelMetadata`を保存する。既存モデルは引き続きPhase 1のAdapter経由で扱われる。

### Phase 3: Consumer切り替え（1 Issue = 1 Consumer、順序固定）

1. Models API（`/models/info`をCatalog経由へ。レスポンス形式は維持）
2. Models画面
3. Inference（Resolver導入。既存`POST /predict`契約は維持）
4. Evaluation
5. Deployment / Export
6. Release Gate連携（Engine判定の一本化のみ。Release状態遷移ロジックには立ち入らない）

各Consumerは一度に変更しない。

### Phase 4: 旧方式Cleanup

- 利用状況確認（新形式のカバレッジがどこまで進んだか）
- Deprecation（旧形式読み取りに警告ログを追加する等、削除はまだしない）
- 読み取り互換維持期間（最低1リリースサイクル。具体的な期間は運用開始後に判断）
- 削除条件（全モデルがCanonical Metadataを持つこと、かつ全Consumerが切替済みであること）
- Rollback（8章参照）

## 8. 後方互換

以下のケースをすべて安全に扱う。**共通原則: 読めないモデルを別Engineへ推測フォールバックしない。安全に除外し、診断可能な状態にする。**

| ケース | 扱い |
|---|---|
| 既存モデルにCanonical Metadataがない | Reader が `LegacyMetadataAdapter` へfallback |
| metadata破損（JSON parse失敗） | Canonical無しとして扱い、Adapterへfallback。警告ログ |
| 未知schema version | 既知の最新版として解釈を試みず、Adapterへfallback。警告ログ |
| unknown engine | Catalogから除外。警告ログ（推測フォールバック禁止） |
| artifactが存在しない | Catalogには含めるが`ocr_inference_ready`相当のフラグをfalseにする（既存`list_model_infos()`の`exported`/`ocr_inference_ready`と同じ発想） |
| legacy JSONだけ存在する | 正常系（Phase 1〜3の標準状態）。Adapter経由で扱う |
| duplicate model | model_id（6.3、既存M0001登録簿）で一意性を担保。重複が生じた場合はCatalogが先勝ちで警告ログ |
| renamed model | 6.3の既知の制約どおり、新しいM0001が振られる（現行動作を維持。今回解決しない） |
| moved model directory | artifact_pathが相対パス基準のため、`paths.models`自体の位置が変わらない限り影響しない。`paths.models`自体の移動は現行システムでも未対応であり対象外 |
| Windowsで保存したpathをLinuxで読む | 相対パス（`Path`のPOSIX形式文字列化）で保存し、実行時に`Path()`で解釈することでOS差異を吸収する。絶対パスの生保存はしない（6.2） |
| Linuxで保存したpathをWindowsで読む | 同上 |
| old frontend alias | 6.13のとおり今回統合しない。影響なし |
| old evaluation history | 6.14のとおり今回統合しない。影響なし |
| old release data | 6.15のとおり参照のみ。影響なし |

## 9. セキュリティ

- 絶対パスをFrontendへ露出しない（`artifact_path`は相対パス・ファイル名のみを公開APIレスポンスへ含める）
- path traversal防止: 新規Reader/Writerは、既存`model_registry.py::_is_safe_model_artifact_dir()`と同じ「`models`ディレクトリ配下の実在パスのみ許可」パターンを踏襲する
- allowed model root: `paths.models`（プロジェクトごとのモデルディレクトリ）を唯一の許可ルートとする
- metadata内の任意URLをFrontendからfetchしない（`model_ref`がHugging Face IDの場合も、Frontendは表示のみでfetchは行わない。実際のロードはBackendの`TrOCREngine.load()`が担う）
- Hugging Face Hub Tokenを`ModelMetadata`/sidecarへ保存しない
- arbitrary Python import・arbitrary class name実行は行わない（Adapter/Factoryは固定の変換関数のみ）
- metadata内容をshellへ渡さない
- error messageへ内部絶対パスを含めない（既存`model_registry.py`の警告ログ方式を踏襲し、ユーザー向けエラーとログを分離する）
- checksumの役割: 今回はsidecarへ`checksum`フィールドを持たせない（`ModelMetadata.extra`で将来拡張可能な余地は残すが、integrity検証は今回のScope外）
- symlinkの扱い: `_is_safe_model_artifact_dir()`と同様、`resolve()`後の実体パスで検証し、許可ルート外を指すsymlinkは拒否する
- 破損・改ざんmetadataは8章のとおりfallback対象とし、クラッシュさせない

## 10. Issue分割

Epic #28配下の後続Issue構成（依存関係付き）。詳細な追跡は[docs/workitems/model-metadata/ISSUE_MAP.md](../workitems/model-metadata/ISSUE_MAP.md)を参照。

1. **Investigation**（Closed、#29）— 影響範囲調査
   - 対象外: コード実装
2. **Architecture + ADR**（本Issue、#30）— 本ドキュメント・ADR-0002
   - 対象外: コード実装
3. **Canonical ModelMetadata Schema整備**
   - 目的: `custom` engine_idのEngine Registry登録、必要なフィールド拡張要否の最終判断
   - 依存: #30
   - 変更範囲: `engine_capability.py`/`engine_registry.py`（`custom`追加）、`model_metadata.py`（必要な場合のみ）
   - 完了条件: `ModelMetadata(engine_id="custom", ...)`が構築可能になる
   - 対象外: sidecar読み書き実装
4. **Legacy Metadata Adapter実装**
   - 目的: `LegacyMetadataAdapter`実装（読み取り専用）
   - 依存: #3
   - 変更範囲: 新規`services/model_metadata_adapter.py`
   - 完了条件: 4形式（`.tess.json`/`.ocr.json`/`.pt`/`inference_model.json`）からの変換テストが揃う
   - 対象外: 書き込み・Consumer切替
5. **ModelMetadata Reader/Writer実装**
   - 目的: sidecar読み書き実装
   - 依存: #3
   - 変更範囲: 新規`services/model_metadata_store.py`
   - 完了条件: atomic write・fallback・破損ファイル処理のテストが揃う
   - 対象外: Consumer切替
6. **Model Catalog実装**
   - 目的: `ModelCatalog`実装（Reader+Adapter合成、一覧・フィルタ）
   - 依存: #4, #5
   - 完了条件: 一覧取得・engineフィルタ・重複排除のテストが揃う
   - 対象外: API公開
7. **Training・Import時のMetadata生成**
   - 目的: `ModelMetadataFactory`実装、新規学習・Export完了時にWriterを呼ぶ
   - 依存: #5
   - 完了条件: 新規モデルのみsidecarが生成されることを確認
   - 対象外: 既存モデルへの遡及書込
8. **Models API・Models画面連携**
   - 目的: `/models/info`をCatalog経由へ切替（レスポンス形式維持）
   - 依存: #6
   - 完了条件: 既存Frontend表示に回帰がないこと
9. **Inference Resolver連携**
   - 目的: model_id解決の追加提供（既存`model`文字列解決は維持）
   - 依存: #6
   - 完了条件: 既存`POST /predict`契約に変更がないこと
10. **Evaluation連携**
    - 目的: 評価履歴の保存先方針確定（localStorage→Backend連携要否の判断含む）
    - 依存: #6
    - 完了条件: 方針文書化＋（必要な場合のみ）実装
11. **Deployment・Export連携**
    - 目的: Release/Deployment情報とMetadataの参照関係を実装
    - 依存: #6
    - 完了条件: `build_deployment_package()`等が`ModelMetadata`を参照可能（既存zip内容は維持）
12. **旧管理方式Deprecation・Cleanup**
    - 目的: 利用状況確認・Deprecation・`release_gate.py::_model_engine()`の置き換え
    - 依存: #8, #9, #10, #11
    - 完了条件: 全Consumerが切替済み、旧判定ロジックが除去される

## 11. Testing Strategy（方針。今回テストコードは追加しない）

| 対象 | 観点 |
|---|---|
| Schema | required/optional fields、schema version、invalid engine、invalid path、unknown fields、serialize round-trip |
| Adapter | 各Legacy形式、missing fields、corrupt JSON、unknown engine、duplicate、fallback禁止（推測フォールバックしないことの確認） |
| Reader | canonical metadata、legacy fallback、unsupported version、broken file、path escape |
| Writer | atomic write、overwrite、directory creation不要の確認、failure rollback、Windows/Linux path |
| Catalog | list、filter、model_id lookup、deduplication、invalid model exclusion、cache invalidation（将来実装時） |
| Resolver | model_id→model_ref、local file、local directory、Hugging Face ID、missing artifact、unsafe path |

## 12. Future Work

- `model_id`の真の安定識別子化（rename/move追跡、内容ハッシュベース等）— 6.3の既知の制約への対応
- Frontend localStorage評価履歴・aliasのBackend連携要否の最終判断（10章 #10）
- `ModelCatalog`のキャッシュ実装（6.16）
- `release_gate.py::_model_engine()`の`resolve_engine_id()`への置き換え（10章 #12）
- checksumによるmetadata整合性検証（9章）

## 13. 参照

- [ADR-0002_Unified_Model_Metadata.md](../adr/ADR-0002_Unified_Model_Metadata.md)
- [MODEL_METADATA_MIGRATION_PLAN.md](MODEL_METADATA_MIGRATION_PLAN.md)（Investigation #29成果物）
- [MODEL_METADATA.md](MODEL_METADATA.md)（`ModelMetadata` dataclass設計、Feature #14）
- [docs/workitems/model-metadata/ISSUE_MAP.md](../workitems/model-metadata/ISSUE_MAP.md)
