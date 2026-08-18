# Resume Unified Model Metadata Consumer Migration — Reassessment 作業記録

Related: Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure） / Investigation [#108](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/108) / Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46)（Engine UI Generalization、Completed） / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR Lifecycle、Completed）

**状態**: Completed / Closed（Investigation/Documentation only、Productionコード変更なし）。PR [#109](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/109)、Squash Commit `75f317f`でマージ済み。

## 目的

Epic #28は2026-07-31、UIレビュー未実施を理由に一旦停止された。その後Epic #46・Epic #27が完了し停止理由は解消されたが、Epic #28の設計・Migration Planはそれ以前に策定されているため、古い前提のままConsumer Migrationへ着手せず、現在のmainを正として再評価する。

## 実装前調査（Mandatory Investigation）

### 1. Canonical Metadata Infrastructure Status（実利用状況）

`ModelMetadata`/`LegacyMetadataAdapter`/`MetadataReader`/`MetadataWriter`/`ModelCatalog`/`ModelMetadataFactory`/`ModelsAPI`が、これら自身のモジュール・テスト以外のどこから参照されているかを`grep`で全文検索した。

**結果: ゼロ件。** `src/app/main.py`・`model_registry.py`・`ocr_pipeline.py`・`tesseract_pipeline.py`・`trocr_model_registry.py`・`release_manager.py`・`release_gate.py`・`benchmark.py`のいずれからも一切importされていない。Feature #32〜#44で構築した基盤（8 Issue分）は、実装当初から一度もProduction consumerを持ったことがない、完全に孤立したコンポーネント群である。

| Component | 実consumer | 未使用/孤立状態 | Public API | Legacy fallback | Canonical metadata file location |
|---|---|---|---|---|---|
| `ModelMetadata`（#32） | なし（テストのみ） | 孤立 | `to_dict()`/`from_dict()`/`is_valid()`/`replace()` | N/A | N/A（dataclass自体はfile非依存） |
| `LegacyMetadataAdapter`（#34） | なし（テストのみ） | 孤立 | `adapt()`/`from_ocr_json()`/`from_tess_json()`/`from_inference_model_json()` | 該当形式のみ変換 | N/A |
| `MetadataReader`（#36） | なし（テストのみ） | 孤立 | `read()`/`read_canonical()`/`read_legacy()` | Legacy 3形式のみ | `<model>.model_metadata.json`（未使用のため実際には1件も存在しない） |
| `MetadataWriter`（#38） | なし（テストのみ） | 孤立 | `write()` | なし（Canonicalのみ書込） | 同上 |
| `ModelCatalog`（#40） | なし（テストのみ） | 孤立 | `list()`/`find()`/`load()`/`exists()` | Legacy 2形式のみ（`.ocr.json`/`.tess.json`。**`.trocr.json`未対応**） | `models/`直下を走査 |
| `ModelMetadataFactory`（#42） | なし（テストのみ） | 孤立 | `create_from_training()` | N/A（生成専用） | N/A |
| `ModelsAPI`（#44） | なし（テストのみ） | 孤立 | `list_models()`/`get_model()`/`exists()`/`create_metadata()`/`save_metadata()` | Catalog経由 | 同上 |

### 2. Current Legacy Metadata Matrix

| 永続化機構 | Writer | Reader | Consumer | Source of Truth | Canonical Metadataへ移行可能か |
|---|---|---|---|---|---|
| `.tess.json` | `tesseract_pipeline.py::register_tesseract_model()` | `model_registry.py::list_model_infos()`・`release_manager.py`・`benchmark.py`等 | Models画面・Release Gate・Benchmark・Model Card | ✅（実データそのもの） | 部分的（`LegacyMetadataAdapter`で変換可能だが、consumer側は移行していない） |
| `.ocr.json` | `ocr_pipeline.py::_register_ocr_model()` | 同上 | 同上 | ✅ | 部分的（同上） |
| `.trocr.json` | `trocr_model_registry.py::register_trocr_model()`（Issue #96） | `trocr_model_registry.py::list_trocr_models()`のみ | Training UI/Benchmark Runner/Release Gate（#98/#102/#104） | ✅ | **不可（現状）**。Legacy Metadata Adapter/Reader/Catalogのいずれにも`.trocr.json`の分岐が存在しない（詳細は§8参照） |
| `inference_model.json` | `inference_model.py::save_inference_model()` | `inference_model.py::load_inference_model()` | 推論使用モデル切替UI | ✅ | 可能（`InferenceMetadataAdapter`が既に対応済み。テストでも`engine="trocr"`のケースを検証済み） |
| `releases.json` | `release_manager.py`（`_save()`） | 同上（`_load()`） | リリース管理画面・Release Gate | ✅ | **意図的に対象外**（`status`/`version`は`ModelMetadata`の設計時に除外された別概念、§Architecture Q10参照） |
| Experiment records（`experiments.json`） | `experiment_tracker.py::record_experiment()` | 同上 | 実験管理・Release Gate・Benchmark Center | ✅ | 対象外（学習実行の記録であり、モデル識別情報ではない） |
| Dataset lineage（`dataset_ids.json`等） | `dataset_registry.py` | 同上 | Dataset Manager | ✅ | 対象外（Datasetの識別情報であり、モデルの識別情報ではない） |
| Frontend localStorage（`ocr_model_aliases_by_project_v1`） | `App.jsx`（`writeProjectScopedStorage`） | 同上 | モデル管理画面の表示名 | ✅（ブラウザローカル） | 非推奨（§Architecture Q12参照） |
| Frontend localStorage（`ocr_model_eval_history_by_project_v1`） | 同上 | 同上 | モデル評価履歴表示 | ✅（ブラウザローカル） | 非推奨（§Architecture Q12参照） |

### 3. Models Consumer

`GET /models`・`GET /models/info`は現在も`model_registry.py::list_models()`/`list_model_infos()`という手書きの拡張子glob（`*.pt`/`*.ocr.json`/`*.tess.json`）に完全に依存しており、`.trocr.json`は含まれない（Issue #96で意図的な決定として確認済みの既存事実、本調査で再確認）。`list_model_infos()`は70以上のキーを持つ辞書をEngine別`if/elif`分岐で組み立てる200行超の関数であり、`ModelCatalog`/`ModelsAPI`へ切り替えるには、この70+キー相当のフィールドを`ModelMetadata`（必須2フィールド＋任意9フィールド＋`extra`）で表現し直す必要がある。現状の`ModelMetadata`スキーマはこの情報量を持たない（`extra`に押し込めば技術的には可能だが、実質的に「新しい大きな辞書変換ロジックを`extra`の中に再実装する」ことになり、Migrationの目的である簡素化に反する）。

`GET /api/models/download/{model_name}`も同じ拡張子制限（`.pt`/`.ocr.json`/`.tess.json`のみ）を持ち、`.trocr.json`は対象外（本調査で確認。既存の`docs/USER_GUIDE.md`記載の既知の制約と一致）。

### 4. Inference Consumer

Tesseract/PaddleOCRは`resolve_model_path()`/`resolve_ocr_model_meta()`/`resolve_tesseract_model_meta()`経由のファイル名ルックアップ、TrOCRは`model`文字列（Hugging Face ID・ローカルパス）をそのまま`TrOCREngine.load()`へ渡す非対称な設計（Epic #1で確定済み、本調査で再確認）。`inference_model.json`（現在選択中モデルのポインタ）はこの非対称性の影響を受けず、`engine`/`model`という2フィールドのフラットな構造のまま全4エンジンで問題なく機能している。Canonical ModelMetadataをInference Resolverへ導入する具体的な必要性・利益は確認できなかった（既存の非対称設計自体が壊れているわけではない）。

### 5. Evaluation Consumer

Multi-engine Evaluation（Evaluation Dispatcher/Runner、Feature #67/#69）は、各Engine Predictor（Feature #71/#73/#75/#77）が持つ独自のmodel resolution（Tesseract/PaddleOCRは既存Resolver、TrOCR/EasyOCRは直接参照）にそのまま依存しており、`ModelMetadata`/`ModelCatalog`は一切参照しない。Evaluation UI（Epic #46 Feature #83/#85）のモデル選択も`GET /models/info`（Legacy）・TrOCR専用の`GET /api/trocr/models`（Issue #96/#98）から構築されており、Canonical Metadataとは無関係に完結している。Evaluation Dispatcher/Runnerの責務をMetadata都合で変更する具体的な必要性は無い。

### 6. Deployment / Release Gate Consumer

Issue #104で実施済みの調査を踏まえ再確認した。`release_manager.py::list_releases()`は`.tess.json`/`.ocr.json`/`.trocr.json`（Issue #104で追加）のsidecarファイル名をそのままモデル識別子として扱う。`release_gate.py::_model_engine()`もファイル名拡張子判定（`.trocr.json`→`"trocr"`もIssue #104で追加済み）であり、`ModelCatalog`/`ModelMetadata`とは無関係に独立して動作している。`build_model_card()`/`build_deployment_package()`はTesseract専用フィールド（`charset`/`base_lang`/`max_iterations`/`traineddata_path`）を前提としており（Issue #104で発見済みの既存の制約）、Canonical Metadataへの統合はこの制約の解消策になりうるが、Release Gate自体の安定した既存動作（Issue #104で完成したばかり）への回帰リスクを伴う大きな変更である。

### 7. Training Metadata Generation

Tesseract（`register_tesseract_model()`）・PaddleOCR（`_register_ocr_model()`）・TrOCR（`register_trocr_model()`）はいずれも独自のLegacy sidecar書込のみを行い、`ModelMetadataFactory.create_from_training()`は一切呼び出されていない（本調査で確認）。`ModelMetadataFactory`自体はEngine非依存の汎用実装であり、technicalには全Training Engineで呼び出し可能だが、実際に呼び出す配線（dual-write）は未実装。EasyOCRは学習非対応のため対象外（既存事実）。

### 8. TrOCR Directory Artifact Compatibility

**重要な発見**: `LegacyMetadataAdapter`（#34）・`MetadataReader`（#36）・`ModelCatalog`（#40）のいずれにも`.trocr.json`の分岐が存在しない。これはEpic #28設計時点（Architecture #30、2026-07頃）でTrOCR Training成果物の保存方式（Issue #96、後発）がまだ確定していなかったためであり、実装漏れではなく設計時点の情報不足による既知のギャップである。

「TrOCR directory artifact」という表現から連想される「ディレクトリ自体をCatalogが走査する必要があるか」という懸念は、調査の結果**該当しない**と判断した。`.trocr.json`sidecarは他2形式と同様に`models/`直下に置かれるフラットなJSONファイルであり（Issue #96で確定済み）、Hugging Face `save_pretrained()`出力ディレクトリ（`model_dir`フィールドの値）はsidecarが指し示す**値**にすぎない。`ModelCatalog`はいかなる形式でもartifact本体のディレクトリを走査しない設計（sidecarファイルの列挙のみ）であるため、`.trocr.json`を`ModelCatalog`/`LegacyMetadataAdapter`/`MetadataReader`の対応形式へ追加するだけで、既存2形式と全く同じ仕組みでTrOCRも扱える。

必要な変更（他2形式と同型、schema変更・Catalog戦略変更いずれも不要）:
- `legacy_metadata_adapter.py`: `LEGACY_FORMAT_TROCR_JSON = "trocr_json"`定数の追加、`TrocrMetadataAdapter`クラスの新設（`engine_id`←`data["engine"]`、`artifact_path`←`data["model_dir"]`、`dataset_id`←`data["dataset_id"]`、`created_at`←`data["created_at"]`）、`LegacyMetadataAdapter.adapt()`のif/elif分岐への追加
- `metadata_reader.py`: `MetadataReader.read()`のファイル名判定へ`.trocr.json`分岐を追加
- `model_catalog.py`: `_LEGACY_SUFFIX_FORMATS`へ`(".trocr.json", LEGACY_FORMAT_TROCR_JSON)`を追加

既存の`tests/test_model_metadata.py`等が`engine_id="trocr"`を既にテスト済みであること（`InferenceMetadataAdapter`経由のtrocrケースも検証済み）から、Engine Registry側の`trocr`登録自体には問題が無いことも確認済み。

### 9. Export Consumer

「Export」に該当する既存機能は2つ確認した。

1. `GET /api/models/download/{model_name}`（Models画面の単体ダウンロード。`.pt`/`.ocr.json`/`.tess.json`のみ対象、`.trocr.json`は対象外）
2. `release_manager.py::build_deployment_package()`（リリース管理画面のDeployment Package ZIP。Tesseract専用フィールド前提、Issue #104で確認済み）

いずれも`ModelCatalog`/`ModelsAPI`を経由せず、独立した実装のまま存在する。Epic #28の「Export利用」完了条件は、Canonical Metadata経由の新しい統一Export機構を意味するのではなく、現行の2つのExport機能を指すと解釈するのが妥当。ただし両者ともTrOCR未対応というギャップが既に存在し（Model Downloadは本調査で新規確認、Deployment PackageはIssue #104で既知）、これはCanonical Metadata Migrationとは独立に、既存のLegacy glob拡張（Release Gateで実施した`.trocr.json`追加と同型のパターン）で解消可能な問題である。

### 10. UI Review Closure

Epic #28停止理由だった「モデル管理・学習・評価画面のUIレビュー」は、以下で実質的に完了している。

- Epic #46（Engine UI Generalization、Completed・Closed）: Evaluation UI Generalization（Feature #83）・TrOCR UI Integration調査（Feature #85）で、`ModelsView.jsx`/`TrainingView.jsx`/`InferenceView.jsx`/`OcrEvaluationView.jsx`/`BenchmarkCenterView.jsx`のTrOCR対応状況を全画面調査済み
- Epic #27（TrOCR Lifecycle、Completed・Closed）: Training UI（Feature #98）・Benchmark UI（Feature #102）・Release Gate統合（Feature #104）で、各画面の実際のUI変更・導線確認を実施済み

これらの調査・実装を通じて、「Models API導入による影響・UI導線・表示項目・不要項目・TrOCR統合」は個別Issueごとに確認済みであり、Epic #28が包括的に想定していた「UIレビュー」という単一の作業としては存在しないが、実質的な内容はカバーされている。**Epic #28停止理由は解消済みと判断する。**

## Architecture Questions（14問への回答）

1. **Canonical ModelMetadataは現在Production consumerを持つか。** 持たない（§1で確認済み、grep結果ゼロ件）。
2. **`/models/info`をModelsAPI/Catalogへ切替可能か。** 技術的には`extra`フィールドへ70+キーを押し込めば不可能ではないが、それは「巨大な変換ロジックの再実装」であり移行の目的（簡素化）に反する。現時点では**推奨しない**。
3. **`.trocr.json`をLegacy Adapterで扱えるか、新Adapterが必要か。** 新しい`TrocrMetadataAdapter`が必要だが、既存2 Adapterと完全に同型の追加で足り、schema変更・architecture変更は不要（§8）。
4. **ModelCatalogはdirectory artifactを安全に探索できるか。** 探索対象は常にsidecarファイル（flat file）のみであり、`.trocr.json`のsuffix対応を追加するだけで安全に扱える。ディレクトリ自体の走査は元々発生しない（§8）。
5. **Training完了時のcanonical metadata生成は全training engineで可能か。** `ModelMetadataFactory`はEngine非依存で技術的には全Engineで呼び出し可能だが、現状どのTraining経路からも呼ばれていない（§7）。
6. **legacy sidecarとのdual-write期間が必要か。** 必要（既存sidecarに依存するconsumerが多数残るため）。ただし当面dual-writeを導入する具体的な需要は無い。
7. **Inference Resolverを新設すべきか、既存engine-specific resolver維持でよいか。** 既存resolver維持を推奨。新設の具体的必要性・利益を確認できなかった（§4）。
8. **Evaluationはcanonical metadataを直接consumerにすべきか。** すべきでない。Evaluation Dispatcher/Runnerの責務をMetadata都合で変更しないという本Issue自身の指示とも整合する（§5）。
9. **Release Gate/release_managerはcanonical metadataへ切替可能か。** 技術的には可能だが、Issue #104で安定化したばかりの既存動作への回帰リスクが大きく、現時点では推奨しない（§6）。
10. **`releases.json`はModelMetadataへ統合すべきか別state storeとして維持すべきか。** 別state storeとして維持すべき。`status`/`version`は`ModelMetadata`設計時に意図的に除外された別概念（`model_metadata.py`のdocstring参照）であり、この設計判断は今回の調査でも妥当と確認した。
11. **`inference_model.json`の廃止/維持条件は何か。** 維持すべき。小規模で安定して機能しており、`InferenceMetadataAdapter`により既にCanonical Metadataへの変換経路も用意済み（読み取り専用の橋渡しとして利用可能、廃止する理由が無い）。
12. **Frontend localStorageのmodel metadata的情報を移行対象に含めるべきか。** 含めるべきでない。ブラウザローカルの補助的なUI状態（表示名エイリアス・評価履歴）であり、Backend Canonical Metadataへの統合はUI/UX設計を伴う別責務の変更になる。
13. **Export完了条件は現行Productで実装対象か。** 現行の2つのExport機能（Model Download・Deployment Package）が該当する。Canonical Metadata経由の新しい統一Export機構を新設する必要は無い（§9）。
14. **Epic #28を何Issueに分割するのが現在最小安全か。** 「Recommended Issue Split」参照。

## Risks

- **孤立インフラの保守コスト**: 8 Issue（#30-#44）で構築したMetadata基盤は、consumer無しのまま存在し続けるとコードベースの理解コストになる（「なぜこれが存在するのに使われていないのか」という疑問を将来の開発者に生む）。ただし無理にconsumerを増やすと、安定している既存システム（Model Registry・Release Gate・Evaluation）への回帰リスクを負う
- **TrOCRの実務上のギャップは、Metadata Migrationを待たずに解消可能**: 「TrOCRモデルがModels画面に表示されない」という既知の制約（Issue #96/#98/#100/#102/#104で繰り返し記録済み）は、`model_registry.py::list_models()`/`list_model_infos()`へ`.trocr.json`globを追加するという、Canonical Metadata基盤を全く経由しないより直接的な修正でも解消できる。ただしこれは`list_model_infos()`という200行超の共有関数への変更であり、Tesseract/PaddleOCRへの回帰リスクを伴うため、本調査でも実施しない（Issue #96の既存判断を維持）
- **Model Card/Deployment PackageのTesseract専用項目依存**（Issue #104で既発見）は、Canonical Metadata統合が解決策になりうるが、優先度・実施タイミングは未確定

## Updated Migration Strategy

初期のMigration Plan（8フェーズ: Investigation→Architecture→Schema→Adapter→Reader→Writer→Catalog→Factory→Models API→Consumer移行）のうち、最初の8フェーズ（インフラ構築）は完了済み。残る「Consumer移行」フェーズについては、当初想定していた包括的な移行（Models/Inference/Evaluation/Deployment/Cleanupすべて）を**縮小し、需要が実証された範囲のみに限定する**方針へ更新する。

具体的には、以下の優先順位で判断する。

1. **既存Metadata基盤自身の内部一貫性を保つための最小限の追加**（TrOCR Adapter対応）は実施する
2. **Consumer側の実際の移行**（Models/Inference/Evaluation/Deployment）は、既存Legacyパスが機能している限り着手しない。着手するのは、既存Legacyパスで解決できない具体的な問題が生じた場合のみ
3. **`releases.json`統合・Frontend localStorage統合**は対象外として維持する

## Recommended Issue Split

不要なIssueは作らない、という方針に従い、以下の1 Issueのみを推奨する。

1. **TrOCR Legacy Metadata Adapter Compatibility**（小規模・低リスク）: `TrocrMetadataAdapter`新設・`MetadataReader`/`ModelCatalog`への`.trocr.json`分岐追加・テスト追加。既存2形式と完全に同型の追加であり、既存Adapter/Reader/Catalogの動作を変更しない。**この修正はMetadata基盤自身の内部一貫性（「Legacy 3形式に対応する」という既存の謳い文句を実態に合わせる）のためのものであり、ModelsUiの「TrOCRが表示されない」という実務上のギャップを解決するものではない**（そちらは`model_registry.py`という別の独立した経路の問題であり、本Issueのスコープ外）。

**却下・保留する候補**（現時点で不要と判断）:

- Models API consumer migration（`/models/info`切替）: `list_model_infos()`の70+キーをCanonical Metadataで表現できないため時期尚早
- Inference Resolver integration: 具体的な必要性を確認できず
- Evaluation metadata integration: Evaluation Dispatcher/Runnerの責務を変更する正当な理由が無い
- Release/Deployment metadata integration: Issue #104で安定化したばかりのRelease Gateへの回帰リスクが利益を上回る
- Legacy cleanup: 移行元のconsumerが存在しないため時期尚早

## Scope / Out of Scope

Out of Scope（Issue本文どおり）:
- Production consumer migration実装
- Canonical schema変更
- ModelMetadata基盤全面再設計
- OCR Training/Evaluation/Benchmark/Release Gateアルゴリズム変更
- 新OCR Engine追加
- Issue #8修正

## Tests / Verification

Investigation中心のためProduction diffなし。`git diff --stat main -- src/ frontend/src/`で差分が無いことを確認済み。

## Documentation

- 本ドキュメント（新規）
- Epic #28本文（GitHub）を実装実態・本調査結果に同期
- `docs/workitems/model-metadata/README.md`・`ISSUE_MAP.md`を更新
- `docs/design/MODEL_METADATA_ARCHITECTURE.md`の一部記述（`release_gate.py::_model_engine()`のTrOCR判定は既にIssue #104で解消済み）を更新
