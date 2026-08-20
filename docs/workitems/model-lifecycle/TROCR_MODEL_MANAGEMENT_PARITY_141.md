# TrOCR Model Management Parity 作業記録

Related: Feature [#141](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/141) / Investigation [#139](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/139)（OCR Crafter Roadmap Refresh、本Issueの起点となった最優先推奨） / Feature [#117](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/117)（Model Card / Deployment Package Multi-engine Parity、`_add_directory_artifact_to_zip()`の再利用元） / Bug [#137](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/137)（PaddleOCR Release Gate Benchmark Linkage、同種の既知gap修正パターン）

**状態**: Implemented, PR review pending。

## 目的

TrOCRモデルをModel Manager画面からTesseract/PaddleOCRと同等に一覧・ダウンロード・削除できるようにする。既存TrOCR artifact contract（`.trocr.json` sidecar + directory artifact）を尊重し、`/models`・`/models/info`等の既存2エンジンAPIには一切手を入れず、Frontend側でのマージと、`delete_model()`/`download_model_endpoint()`への最小追加のみで実現する。

## 実装前調査（Mandatory Investigation、Issue本文の12項目）

### 1. ModelsView / Model Managerのlist source

`App.jsx::loadModels()`が`GET /models`（モデル名配列）と`GET /models/info`（`modelInfos`辞書）を取得し、`ModelsView`へ`models`/`modelInfos` propsとして渡す。両APIとも`model_registry.py::list_models()`/`list_model_infos()`が`.pt`/`.ocr.json`/`.tess.json`のみをglobし、`.trocr.json`は最初から対象外（Issue #96で意図的に未統合、Investigation #108・Issue #121で再確認済み）。

### 2. `/models/info`等の既存API contract

`list_model_infos()`は`_MODEL_DIR_META_KEYS`等の既存フィールド規約でTesseract/PaddleOCRのメタ情報を返す。TrOCRのフィールド形状（`model_dir`/`base_model_ref`等）は`.trocr.json`固有であり、無理に同じ関数へ混ぜるとTesseract/PaddleOCR側のfield正規化ロジックへ分岐が増える。本Issueでは`/models/info`自体は変更しない方針を確定した。

### 3. model delete endpoint / helper

`DELETE /models/{model_name}` → `delete_model_endpoint()`（`main.py`） → `model_registry.py::delete_model()`。拡張子で`.pt`/`.ocr.json`/`.tess.json`を判定し、メタ内の既知キー（`_MODEL_DIR_META_KEYS`）が指すディレクトリを`_resolve_safe_model_dirs()`で安全性確認のうえ削除する、という汎用的な設計であることを確認した。

### 4. model download/export endpoint / helper

`GET /models/{model_name}/download` → `download_model_endpoint()`（`main.py`）。`.pt`はそのままファイル、`.ocr.json`は`_add_directory_artifact_to_zip()`（Issue #117 Deployment Package由来）で`inference_dir`をzip化、という2パターンのみ実装済みだった。

### 5. Tesseract `.tess.json`のdelete/downloadフロー

Delete: `tessdata_dir`/`model_dir`メタキーが指すディレクトリを削除。Download: `.traineddata`単一ファイルをそのまま返す（`fallbackDownloadName()`で拡張子を`.traineddata`へ置換）。

### 6. PaddleOCR `.ocr.json` + custom artifactのdelete/downloadフロー

Delete: `inference_dir`（存在すれば`model_dir`も）を削除。Download: `_add_directory_artifact_to_zip()`で`inference_dir`をzip化して返す（`model/`プレフィックス配下に相対パスを保って格納）。

### 7. TrOCR `trocr_model_registry.py::list_trocr_models()`のcontract

`paths.models.glob("*.trocr.json")`を読み込み、sidecarのdictをそのまま配列で返すだけの薄い関数（`model_registry.py`とは完全に独立、Issue #96由来）。`GET /api/trocr/models`（Issue #98、`api_trocr_models()`）がこれを薄くラップしている。Training UIの「登録済みモデルから継続Fine-tune」選択専用として既に存在しており、Model Managerには未接続だった。

### 8. `.trocr.json` sidecar fields

`register_trocr_model()`（`trocr_model_registry.py`）が書き出す形状: `name`/`engine`("trocr")/`training_family`("ocr")/`model_type`("ocr")/`model_dir`/`base_model_ref`/`project_id`/`job_id`/`dataset_root`/`dataset_id`/`epochs`/`batch_size`/`learning_rate`/`final_loss`/`created_at`。sidecar名は`_sidecar_name(job_id)` → `f"trocr_{job_id}.trocr.json"`。

### 9. TrOCR artifact directory layout

常に`paths.models / "trocr_runs" / job_id`（`main.py::_run_trocr_training_job()`の`output_dir`）。sidecarの`model_dir`フィールドにこの絶対パスの文字列表現が保存されている。常に`models/`配下であり、path containment確認に適する。

### 10. Release / Model Card / Benchmark / EvaluationからTrOCR artifactがどう参照されるか

- Release: `release_manager.py::list_releases()`が`*.trocr.json`をglob対象に含む（Issue #117で実装済み）。Model Card生成・Deployment Packageダウンロードは`model_dir`を`_add_directory_artifact_to_zip()`で処理する既存経路がある。
- Benchmark: `_resolve_trocr_benchmark_model_ref()`（`release_gate.py`）がsidecar名→`model_dir`を解決してBenchmark結果と接続する（Issue #104）。
- Evaluation: `trocr_evaluation_predictor.py`がsidecarの`model_dir`を`TrocrEngine`へ渡す。

いずれも**sidecarを読み取るだけ**であり、Model Managerでの削除操作に対して逆参照・カウント管理を行っていない。

### 11. 削除時に参照中Releaseやmetadataをどう扱う既存policyがあるか

`delete_model()`/`delete_model_endpoint()`を精査した結果、**Tesseract/PaddleOCRを含め、いずれのengineでも「Production/Candidate状態のReleaseが参照中のモデルの削除を拒否する」policyは実装されていない**ことを確認した（`model_registry.py`に`release_manager`/`release_gate`のimportは無い）。Issue本文の「既存policyがあれば同等に適用、無ければ新設しない」という指示に従い、**TrOCRにも同様の保護を追加しない**（Tesseract/PaddleOCRとの一貫性を優先）。

### 12. Deployment Package #117との関係

`_add_directory_artifact_to_zip(zf, engine, meta)`（`release_manager.py`）は、PaddleOCRの`inference_dir`/`model_dir`だけでなく、TrOCRの`model_dir`もそのまま扱える汎用実装だったため、**Issue #141のdownload実装はこの関数をそのまま再利用するだけで済んだ**（新しいzip生成ロジックは追加していない）。

## Engine Matrix

| Capability | Tesseract | PaddleOCR | TrOCR |
|---|---|---|---|
| list in Model Manager | ○（`/models`+`/models/info`） | ○（`/models`+`/models/info`） | ○（本Issueで追加。Frontend側マージ、`/models`/`/models/info`は無変更） |
| download | ○（`.traineddata`単一ファイル） | ○（`inference_dir`をzip化） | ○（本Issueで追加。`model_dir`をzip化、`_add_directory_artifact_to_zip()`再利用） |
| delete sidecar | ○ | ○ | ○（本Issueで追加） |
| delete artifact | ○（`tessdata_dir`/`model_dir`） | ○（`inference_dir`/`model_dir`） | ○（本Issueで追加。`model_dir`） |
| release reference check | ×（既存policy無し、全engine共通） | ×（既存policy無し、全engine共通） | ×（既存policyに合わせ非対応のまま） |
| rollback/recovery | ×（既存機能無し） | ×（既存機能無し） | ×（既存機能無しに合わせ非対応のまま） |

EasyOCR official modelはtraining artifactを持たないため、上表の対象外（Issue本文の指示どおり同一契約を強制しない）。

## 実装内容

### Backend: Delete（`model_registry.py::delete_model()`）

拡張子判定に`is_trocr_meta`（`.trocr.json`）を追加し、既存の`is_ocr_meta`/`is_tess_meta`と同じ削除経路（`_resolve_safe_model_dirs()` → 安全なディレクトリのみ`shutil.rmtree` → sidecar削除）に合流させた。`_MODEL_DIR_META_KEYS`に既に`"model_dir"`が含まれていたため、**この汎用ヘルパー自体は無変更**。実質的な追加は拡張子判定と対応エラーメッセージの数行のみ。

### Backend: Download（`main.py::download_model_endpoint()`）

`.trocr.json`向けの新しい分岐を追加した。sidecarをJSONとして読み込み、`model_dir`フィールドの存在・実在ディレクトリを検証したうえで、`release_manager.py::_add_directory_artifact_to_zip()`を再利用してsidecar＋artifact directory一式をzip化し、`FileResponse`＋`BackgroundTask`で一時ファイルを確実にクリーンアップする（PaddleOCRの既存downloadパターンと同一構造）。ファイル名は`<export_name>.trocr.zip`（`.trocr.json`を除いた名前 + `.trocr.zip`）。

### Frontend: List統合（`frontend/src/lib/trocrModelManagement.js`、新規）

`mapTrocrModelToInfo(item)`: `GET /api/trocr/models`のsidecar payloadを、ModelsViewが期待する`modelInfos`エントリ形状へ変換する。`training_family`には既存の`"ocr"`/`"tesseract"`のいずれとも異なる**専用値`"trocr"`**を設定する。理由: `ModelsView.jsx::isOcrFamily(name)`は`["ocr","tesseract"]`のみを判定するため、これにより`canDownload()`/`isModelAvailableForInference()`（共通式`!isOcrFamily(name) || exportReady(name)`）がTrOCRに対して常に`true`になる。TrOCRは登録（sidecar書込）自体が完了マーカーであり、PaddleOCRのような別途Export手順を持たないため、既存の分類モデル（`training_family: "classification"`）と同じ「Export概念なし」の扱いに揃えた。

`mergeTrocrModelsIntoList(modelItems, infoMap, trocrItems)`: 既存の`models`/`modelInfos`へTrOCRモデルを追加する。**同名エントリが既に存在する場合は上書きしない**（Tesseract/PaddleOCRの既存エントリを誤って置き換えない保守的な挙動）。引数はミューテートせず、新しい配列/オブジェクトを返す。

`App.jsx::loadModels()`は、既に取得済みの`trocrModelsData`（`GET /api/trocr/models`、Issue #96/#98由来の既存呼び出し）をこの関数でマージするだけで、新しいAPI呼び出し・Backend変更は追加していない。

### Frontend: `ModelsView.jsx`の2箇所の追加分岐

- `fallbackDownloadName()`: `downloadType === "directory_or_ref" && engine === "trocr"`かつ入力が実際に`.trocr.json`で終わる場合のみ、`<export_name>.trocr.zip`へ変換する。**`.trocr.json`で終わらない入力（既存テストが検証する想定外ケース）はそのまま返す**既存フォールバックを維持し、後方互換を壊さない。
- `familyLabelOf(family)`: `["ocr", "tesseract", "trocr"]`のいずれかで「OCR認識」を返すよう`"trocr"`を追加した。`isOcrFamily(name)`自体（Export可否判定用）は意図的に無変更のまま。2つの関数は見た目が似ているが役割が異なる（`isOcrFamily`=Export gating、`familyLabelOf`=表示ラベル）ため、それぞれ個別に対応した。

`ENGINE_ID_TROCR`のRegistryエントリ（`downloadType: "directory_or_ref"`、Issue #49由来のplaceholder）は、本Issueで初めて実際のダウンロード処理へ接続された。

## Reference Safety（既存policyの維持、新設なし）

§11の調査結果のとおり、Tesseract/PaddleOCRを含め既存Model Managerに「Release参照中モデルの削除拒否」policyは存在しない。TrOCRにもこの既存状態（policy無し）をそのまま適用し、新しいreference graph基盤・保護ロジックは一切追加していない。

## Error Handling

| ケース | 挙動 |
|---|---|
| missing sidecar | `download_model_endpoint()`: 404 / `delete_model()`: `FileNotFoundError`→400/404相当 |
| missing artifact directory | download: 404（`model_dir not found`）。delete: sidecarのみ削除し実体には触れない（既存Tesseract/PaddleOCRと同じ「診断可能・クラッシュしない」方針） |
| malformed `.trocr.json` | download: 400。delete: 破損メタと判定しsidecarのみ削除（実体を推測削除しない、既存PaddleOCR/Tesseractの破損メタfallthroughと同じ） |
| path outside allowed model root | `_resolve_safe_model_dirs()`の既存ガードによりrmtree対象から除外（sidecarのみ削除） |
| download archive生成失敗 | 一時zipを`unlink(missing_ok=True)`で確実に破棄し、500として返す |
| delete partial failure | `shutil.rmtree`は既存の`try/except OSError`（Issue #133由来）でラップ済み、握りつぶさずログに残る |
| permission/file-lock failure | 上記と同じ経路（Windows file lock時もクラッシュしない） |
| release保護によりdelete拒否 | 該当なし（§11のとおり既存policy自体が存在しない） |

## Tests

### Backend: `tests/test_trocr_model_management_parity.py`（新規、16件）

- Delete: sidecar+artifact directory削除、他job_idのdirectoryに影響しないこと、artifact directory不在でもsidecarは削除できること、破損メタはsidecarのみ削除、models root外のdirは削除されないこと、対応外拡張子は引き続き拒否されること
- Download: zipにsidecar+artifact files（`model/`プレフィックス）が含まれること、元artifactが無変更のままであること、`model_dir`不在→404、破損メタ→400、`model_dir`空→400、存在しないモデル→404、path traversal拒否、対応外拡張子は引き続き拒否されること
- Tesseract/PaddleOCR回帰: 既存delete挙動が無回帰であること

実行結果:

```
python -m pytest -q tests/test_trocr_model_management_parity.py
# 16 passed

python -m pytest -q tests/test_trocr_model_management_parity.py tests/test_delete_model_safety.py \
  tests/test_dataset_registry.py tests/test_preprocess_config_store.py tests/test_release_gate_paddleocr_benchmark.py
# 76 passed
```

### Frontend

- `frontend/tests/trocrModelManagement.test.mjs`（新規、9件）: `mapTrocrModelToInfo`/`mergeTrocrModelsIntoList`の単体テスト（フィールド変換、欠損値フォールバック、同名上書き防止、空リスト、name未設定アイテムの除外、ソート順、引数非ミューテーション）
- `frontend/tests/modelsView.render.test.mjs`（追加、4件）: `fallbackDownloadName()`が実際の`.trocr.json`sidecar名を`.trocr.zip`へ変換すること、方式列（`familyLabelOf`）がTrOCRを「OCR認識」と表示すること（「分類」への誤表示が無いこと）、`ocr_inference_ready`未設定でもダウンロード/推論使用ボタンが無効化されないこと（`isOcrFamily()`にTrOCRが含まれないことの確認）、既存Tesseractの未Exportモデルが引き続き無効化されること（回帰）
  - 既存テスト「TrOCRは.ocr.jsonにも.ptにも誤分類せず、ファイル名をそのまま返す」（`.trocr.json`拡張子を持たない入力）との後方互換のため、`fallbackDownloadName()`の新しい分岐は入力が実際に`.trocr.json`で終わる場合のみ変換するよう実装した

実行結果:

```
npm test
# 759 passed（既存フルスイート、追加分含む）

npm run build
# ビルド成功（既存のchunk sizeに関する警告のみ、新規エラーなし）
```

### Safety

- 実`data/projects`/実model artifacts/実`outputs/app.db`は一切触れていない（`temp_projects`フィクスチャで隔離、sha256チェックサムをテスト前後で比較し一致を確認）
- `git diff --stat -- src/ frontend/src/`で変更ファイルを確認: `src/app/main.py`・`src/app/services/model_registry.py`・`frontend/src/App.jsx`・`frontend/src/views/ModelsView.jsx`（新規: `frontend/src/lib/trocrModelManagement.js`）。`/models`・`/models/info`本体・UI全面redesignには触れていない

### 補足: ローカル`ci_sim_venv`のtransformers欠落について

`python -m pytest -q`をフルスイートで実行したところ、`10 failed, 1305 passed, 93 errors`という結果になった。93件のERRORはすべて`ModuleNotFoundError: No module named 'transformers'`（`test_benchmark_trocr.py`/`test_trocr_engine.py`/`test_trocr_evaluation_predictor.py`/`test_trocr_model_registry.py`/`test_trocr_training_core.py`、本Issueで一切変更していないファイル群）であり、`pip show transformers`で未インストールであることを直接確認した。

Issue #137時点のworkitem doc（本ファイルと同ディレクトリ）では同じフルスイート実行が「1289 passed, 10 failed（既存の環境依存failureのみ）」だったと記録されており、この93件のERRORはそれ以降にローカル`ci_sim_venv`から`transformers`パッケージが完全に失われた（以前は一部機能する程度に部分的にインストールされていたと推測される）ことによるものであり、**本Issueのコード変更（`model_registry.py`/`main.py`のTrOCR追加分のみ、上記ファイル群には一切触れていない）とは無関係**と判断した。10件のFAILED（従来からの既知環境依存failure: `test_trocr_availability_reflects_transformers_import`等3件＋`test_yolo_detect.py`7件）はIssue #133時点のbaselineと完全一致しており、新規のlogicレベル失敗ではない。本Issue固有のテストおよび隣接する回帰テスト（`test_trocr_model_management_parity.py`ほか計76件）を個別実行しすべて成功していることは上記のとおり確認済み。実GitHub Actions CIには`transformers`がインストール済みであり、この差異はローカル環境限定の既知constraintとして記録するに留め、`requirements.txt`やCI設定への変更は行っていない（Issueスコープ外のため）。

## Documentation

- 本ファイル新規作成
- `docs/USER_GUIDE.md`: 「TrOCRの既知の制約」節にあった「モデル管理画面の一覧・カルテ・ダウンロードには表示されません」という記述を、本Issueで解消済みである旨へ更新
- `docs/workitems/roadmap/NEXT_DEVELOPMENT_ROADMAP_REFRESH_139.md`: 推奨Issue「TrOCR Model Management Parity」の状態を本Issueへリンクして更新

## Scope外（Out of Scope、実施しなかったこと）

- Epic #28 Consumer Migration（`/models`・`/models/info`をCanonical ModelMetadataへ統合する変更）
- `model_registry.py`全面再設計
- Canonical ModelMetadataをProduction唯一sourceへ変更
- Model Manager UI全面redesign
- model versioning system新設
- cloud/object storage対応
- automatic artifact garbage collection
- Release参照保護の新規実装（既存policy自体が全engine共通で存在しないため）

## Future Work

- Model Manager全体でRelease参照保護（Production/Candidate状態のモデル削除拒否等）が将来必要になった場合は、TrOCRだけでなく全engine共通のpolicyとして設計すべき（本Issューでは意図的に見送り）
- `.trocr.json`が持つ`base_model_ref`/`dataset_id`等のTrOCR固有フィールドをModel Manager詳細パネル（カルテ）でより丁寧に表示する余地はあるが、本Issueの必要最小限スコープでは既存のSpecRow汎用表示に留めた
- ローカル`ci_sim_venv`の`transformers`/`ultralytics`欠落は、TrOCR/YOLO関連の一部テストがローカルで実行できない状態を継続させている。将来的にローカル検証を強化したい場合は当該venvへの再インストールを検討する余地がある（本Issueのスコープ外）
