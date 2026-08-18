# TrOCR Training UI Integration 作業記録

Related: Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Investigation [#88](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/88) / Feature [#90](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/90)（Dataset Adapter） / Feature [#92](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/92)（Training Backend Core） / Feature [#94](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/94)（Job Integration） / Feature [#96](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/96)（Artifact Registration） / Feature [#98](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/98)

**状態**: Completed・Closed。PR [#99](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/99)をSquash Merge・mainへ反映済み、Merge Commit: `092302c`。Issue #98はPR本文の`Closes #98`によりマージ時に自動Close。

## 目的

Investigation #88で確定した実装分割の最終（第5）段階として、Issue #92/#94/#96で完成したTrOCR Training Backend（`POST /api/trocr/train/start`・Job lifecycle・Artifact登録）をTraining UI（`TrainingView.jsx`）から実行できるようにする。Backend側の変更は最小限（`GET /api/trocr/models`の新設のみ）に留め、既存の学習画面Architecture（Engine Registry駆動のOCRタイプ切替・共通/Engine別設定パネル分岐）へTrOCRを追加する。

## 実装前調査（既存Training UI Architecture）

- OCRタイプドロップダウン・学習回数（Epoch/Iteration）入力・演算デバイス（Auto/CPU/GPU）3ボタンは、いずれも`frontend/src/config/engineRegistry.js`（`getTrainingSelectableEngines()`/`isEngineTrainingSupported()`/`getEngineSupportedDevices()`/`isEngineDeviceSupported()`）を参照する既にEngine非依存の実装であることを確認した。TrOCRの`trainingSupported`/`trainingSelectable`をtrueへ変更するだけで、これら3項目はJSX変更なしにTrOCRへ対応する
- Engine固有設定パネルは`engineTrainingPanel === "tesseract" ? (...) : engineTrainingPanel === "paddleocr" ? (...) : (未対応表示)`という3分岐のみで構成されており、TrOCR用の新しい分岐を追加する以外に既存分岐への変更は不要と確認した
- バッチサイズ（`batchSize`）・最大文字数（`ocrMaxTextLength`）は既にPaddleOCR・Tesseractを跨いで共有される汎用stateであり、TrOCRの`batch_size`/`max_target_length`にもそのまま再利用できることを確認した（新規state不要）
- 「次回学習の設定」インライン編集（変更を破棄／次回学習に適用）は`lib/trainingSettingsDraft.js`の`SETTINGS_DRAFT_KEYS`固定リストで管理されており、TrOCR固有の新規stateもこのリストへ追加するだけで既存の破棄／dirty判定の仕組みにそのまま乗ることを確認した
- Job監視（状態取得・ログ取得・キャンセル・スナップショット表示）はIssue #94で`training_family="ocr"`として完全にEngine非依存化済みであり、`getEngineSnapshotType("trocr")`は既に`"generic"`を返す設定済みのため、無変更でTrOCR jobにも対応することを確認した
- Inference/Evaluationの既存TrOCRモデル選択（`lib/trocrModelMetadata.js::extractTrocrModels()`）は`GET /models/info`から`engine="trocr"`のものを抽出するが、Issue #96で新設した`.trocr.json`sidecarは`model_registry.py::list_models()`にglobされないため、この一覧は実運用上常に空であることを確認した。Training UIの「継続元モデル」選択にこの既存propをそのまま使うと常に空リストになり実用的でないと判断し、Issue #96で既に実装済みの`list_trocr_models()`を薄くラップする新規エンドポイント`GET /api/trocr/models`を追加する設計とした（Issue #96 Future Work、および本Issueの「8. Registered Artifact Visibility」が許容する範囲）

## 実装内容

### `src/app/main.py`（`GET /api/trocr/models`を新設）

Issue #96で実装済みの`list_trocr_models()`をそのまま返す薄いラッパー。`model_registry.py`の共有関数（`list_models()`/`list_model_infos()`）へは統合しない（Issue #96で決定したFuture Work境界をそのまま維持）。

```python
@app.get("/api/trocr/models")
def api_trocr_models(project_id: Optional[str] = Query(default="default")) -> dict[str, Any]:
    resolved = _resolve_project_id(project_id)
    return {"project_id": resolved, "items": list_trocr_models(resolved)}
```

### `frontend/src/config/engineRegistry.js`

`trocr`エントリの`trainingSupported`/`trainingSelectable`を`true`、`trainingPanel`を`"trocr"`へ変更した（`supportedDevices: ["cpu", "gpu"]`は既存のまま）。

### `frontend/src/views/TrainingView.jsx`

- `engineTrainingPanel === "trocr"`の新しい分岐を追加した。内容: Base Model選択（登録済みモデルから継続Fine-tune／手動入力の二択、Inference画面の既存UIパターンを踏襲）・学習率（learning_rate）入力・local_files_onlyチェックボックス。バッチサイズ・最大文字数・学習回数・演算デバイスは既存の共通コントロールをそのまま使う
- `TRAINING_ENGINE_OPTION_SUFFIX`へ`trocr: "（学習可 / Fine-tune）"`を追加
- `currentSettingsValues()`/`restoreSettingsSnapshot()`へ新規TrOCR state（`ocrTrocrModelSource`/`ocrTrocrSelectedModel`/`ocrTrocrModelRef`/`ocrTrocrLearningRate`/`ocrTrocrLocalFilesOnly`）を追加し、既存の「変更を破棄」「次回学習に適用」の仕組みに乗せた
- 新規props: 上記5state（値+setter）と`trocrTrainedModels`（登録済みモデル一覧、読み取り専用）

### `frontend/src/lib/trainingSettingsDraft.js`

`SETTINGS_DRAFT_KEYS`へTrOCR固有の5キーを追加した。

### `frontend/src/lib/trocrTrainedModels.js`（新規）

`GET /api/trocr/models`の応答（`.trocr.json`sidecarそのもの）を、Base Model選択用の`{name, label, modelRef}`へ変換する純関数群（`mapTrocrTrainedModels`/`resolveTrocrTrainedModelRef`/`trocrTrainedModelValidationError`）。Inference/Evaluation用の`trocrModelMetadata.js::extractTrocrModels()`とはデータソースが異なる別モジュールとして追加した（既存モジュールは変更しない）。

### `frontend/src/App.jsx`

- 新規state（Training画面専用、Inference/Evaluationの`inferTrocr*`/`ocrEvalTrocr*`とは完全に分離）: `ocrTrocrModelSource`/`ocrTrocrSelectedModel`/`ocrTrocrModelRef`/`ocrTrocrLearningRate`（既定`5e-5`）/`ocrTrocrLocalFilesOnly`/`trocrTrainedModelItems`（`GET /api/trocr/models`の生応答）
- `trocrTrainedModels`をuseMemoで`mapTrocrTrainedModels(trocrTrainedModelItems)`として算出
- `loadModels()`（プロジェクト読込時に呼ばれる既存関数）へ`GET /api/trocr/models`の取得を追加し、`trocrTrainedModelItems`を更新する
- `canStartOcrTraining`にTrOCR条件を追加（dataset_dir必須＋model_ref解決済み必須）
- 新規関数`startTrocrTraining()`（`startTesseractTraining()`/`startPaddleOcrTraining()`と同じ構造）: `POST /api/trocr/train/start`を呼ぶ。UIの演算デバイス値（`auto`/`cpu`/`gpu`）はBackend契約（`TrocrTrainStartRequest.device`: `auto`/`cpu`/`cuda`）に合わせて`gpu → cuda`のみこの関数内でローカル変換する（共通の演算デバイスUIコンポーネント自体は変更しない）
- `startOcrTraining()`へ`ocrEngine === "trocr"`分岐を追加

## 対象外（Scope外）

- Backend学習ロジック（`trocr_training_core.py`・`_run_trocr_training_job()`・DB schema）は無変更（Issue #92/#94/#96で完了済み）
- `model_registry.py::list_models()`/`list_model_infos()`への統合（ModelsView等、一般Modelsリスト表示。Issue #96のFuture Workを維持）
- Benchmark Runner/Benchmark Center・Release Gate連携（Epic #27の別Progress項目）

## Tests

Backend: `tests/test_trocr_models_api.py`（新規、4件）。`GET /api/trocr/models`のproject_id解決・レスポンス形状・project別スコープを検証（`list_trocr_models()`自体の挙動は`tests/test_trocr_model_registry.py`で検証済みのため重複しない）。

Frontend:
- `frontend/tests/trocrTrainedModels.test.mjs`（新規）: `mapTrocrTrainedModels`/`resolveTrocrTrainedModelRef`/`trocrTrainedModelValidationError`の純ロジック
- `frontend/tests/engineRegistry.test.mjs`: TrOCRの`trainingSupported`/`trainingSelectable`/`trainingPanel`がtrue/true/"trocr"へ変わったことを反映
- `frontend/tests/trainingSettingsDraft.test.mjs`: TrOCR固有5キーの追加・dirty判定
- `frontend/tests/trainingView.render.test.mjs`: OCRタイプ選択肢へのTrOCR追加、学習可否、デバイス対応可否、TrOCR専用設定パネル（Base Model二択・model_ref入力・学習率・local_files_only）のレンダリング検証
- `frontend/tests/trocrStateIsolation.test.mjs`: Training画面用TrOCR state（`ocrTrocr*`）が推論テスト画面（`inferTrocr*`）・評価画面（`ocrEvalTrocr*`）のstateと完全に分離されていることの静的検証（Issue #85と同じ手法）

`python -m pytest -q` — 1264 passed, 1 failed（`tests/test_dataset_registry.py::test_register_ocr_model_records_dataset_lineage`）。既知Issue #8と同一のテスト・同一の根本原因（本テストが`db_module._db_path()`を隔離しておらずリポジトリ実体の`outputs/app.db`を直接使う）だが、今回観測されたエラーメッセージは`sqlite3.OperationalError: no such column: local_files_only`であり、CLAUDE.mdが記載する既知症状の文言（`no such table: training_jobs`）とは異なる。本Issueの変更（`git diff --stat`で確認済み、`test_dataset_registry.py`・`db.py`・`model_registry.py`・`ocr_pipeline.py`は無変更）とは無関係であることを確認した上で、実体の`outputs/app.db`（ローカル環境の実行資産、テストが隔離せず直接参照するリポジトリ実データ）のスキーマ状態がIssue #94のマイグレーション（`local_files_only`列追加）以前の状態のまま止まっているために生じている、同一根本原因（テスト非隔離）の別症状と判断した。`outputs/app.db`自体は本Issueの作業で変更していない（`git status`・mtime確認済み）。

Frontend: `npm test` — 683 passed。`npm run build` — 成功。

## Documentation

- 本ドキュメント（新規）
- `docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`・`docs/workitems/trocr/ISSUE_MAP.md`を更新

## Future Work（Scope外として記録）

- `model_registry.py::list_models()`/`list_model_infos()`への統合（ModelsView等でのTrOCR一般表示）
- TrOCR学習中のGPUメモリ・バッチサイズに関するUI側ガイダンス（PaddleOCRのMac Safe/RTX Trainプリセットに相当する仕組み）
- Benchmark・Release Gate連携（Epic #27の別Progress項目）
