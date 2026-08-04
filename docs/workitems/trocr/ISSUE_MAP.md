# TrOCR対応 Issue Map

Related Issue: Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27) / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)

**Epic分割（2026-07-31）**: [Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Transformer OCR対応基盤とTrOCR統合）は、既存OCR推論経路（OCR Pipeline / 既存OCR推論API / Frontend推論画面）へのTrOCR統合が完了し、**Closed（2026-07-31 09:21:33 JST）**。当初ロードマップに含まれていたTraining／Evaluation／Benchmark／Release Gateは、実際には未着手のまま[Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）へ引き継いだ。本ドキュメントの各Phaseの記載は両Epicで共有するが、Phase4（Training/Evaluation）・Phase6（Benchmark）・Phase7の一部（マニュアル・チュートリアル・リリース確認）はEpic #27の管轄である。また、`ModelMetadata`の既存コードへの本格配線（生成・保存・Models/Inference/Evaluation連携・旧モデル管理方式からの移行）は、TrOCRに限らない別責務のため、Epic #27にも含めず[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure）で扱う。

## 現在作成するIssue

- Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) Transformer OCR対応基盤とTrOCR統合（既存推論経路への統合完了、Closed 2026-07-31）
- Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27) TrOCR学習・評価・Benchmark・Release Gate統合（Epic #1の後続。未着手）
- Epic: [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) Unified Model Metadata Infrastructure: `ModelMetadata`の生成・保存・Models/Inference/Evaluation連携・旧モデル管理方式からの移行。TrOCRに限らない別責務のためEpic #27とは分離管理する（Investigation [#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)完了）
- Investigation: [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) TrOCR採用可否とOCR Crafter統合方式の調査（Parent Epic: #1）
- Feature: [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4) Engine Capability実装（実装済み。Parent Epic: #1）
- Feature: [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9) Engine Registry実装（実装済み・Closed。Parent Epic: #1）
- Refactor: [#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11) Engine判定ロジックをEngine Registryへ統一（Backend側実装済み・Closed。Parent Epic: #1）
- Bug: [#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12) Frontendの未知Engine判定がPaddleOCRへ暗黙フォールバックする（実装済み・Closed。Parent Epic: #1）
- Feature: [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14) 共通Model Metadata実装（実装済み・Closed。Parent Epic: #1）
- Feature: [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16) TrOCR Backend単画像推論コア実装（実装済み・Closed。Parent Epic: #1）
- Feature: [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18) OCR PipelineへTrOCR統合（実装済み・Closed。Parent Epic: #1。当初想定の`ocr_pipeline.py`ではなく実際の推論ディスパッチファイル`predict.py`へ接続）
- Feature: [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20) 既存OCR推論APIへTrOCR統合（実装済み・Closed。Parent Epic: #1。新規TrOCR専用APIは作成せず既存`POST /predict`を拡張）
- Feature: [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23) FrontendへTrOCR選択UIを追加（実装済み・Closed。Parent Epic: #1。`InferenceView.jsx`（推論テスト画面）へ最小追加、`OcrBatchView.jsx`/`RapidOCRView.jsx`は対象外）
- Feature: [#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25) TrOCR Model MetadataをFrontend推論UIへ連携（実装済み・Closed。Parent Epic: #1。既存`GET /models/info`のengineフィルタのみで実現、Backend変更なし。実環境では登録済みモデルは基本的に0件）

## 次に作成するIssue候補（確定順序、2026-07-29）

ADR-0001がAcceptedとなり、Phase2（共通基盤実装）へ移行するにあたり、次に作成するIssue候補の順序を以下のとおり確定した。**GitHub Issueはまだ作成しない。** 各項目の詳細は次節「調査完了後に作成を検討するIssue（Phase構成）」の該当Phaseを参照。

1. **Engine Capability** — Phase1（[ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md)の実装、✅完了: [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)）
2. **Engine Registry** — Phase1（[ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)のMVP実装、✅完了: [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)）
3. **Model Metadata** — Phase1（[MODEL_METADATA.md](../../design/MODEL_METADATA.md)のMVP実装、✅完了: [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)）
4. **Engine判定既存バグ修正** — Phase2（`engineLabelOf()`/`resolveInferenceEngine()`/`_model_engine()`のキャッチオール是正＋判定ロジックの一本化。Backend側（`model_registry.py`/`ocr_pipeline.py`）は✅完了: [#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)。Frontend側も✅完了: [#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)。`release_gate.py::_model_engine()`との重複一本化は未着手）
5. **TrOCR Backend** — Phase3（依存関係・設定管理・Dataset確認・TrOCR Model Metadata適用。単画像推論コアは✅完了: [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)）
6. **TrOCR Training** — Phase4（`services/trocr_pipeline.py`学習Backend。**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄**）
7. **TrOCR Inference** — Phase4（OCR Pipelineへの接続は✅完了: [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)。既存OCR推論APIへの統合も✅完了: [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)。Epic #1完了。`ENGINE_BUILDERS`スタイルの`recognize()`実装＝Engine Registry Handler化はFuture Work）
8. **TrOCR Evaluation** — Phase4（評価連携の方針決定・confidence算出方法の確定。**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄**。Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)として設計**Completed**・Closed、[ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md)確定。Common Evaluation Schema（Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)）は**Completed**・Closed（PR [#64](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/64)、Merge Commit: `4663dd0`）。Common Metric Calculator（Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)）は**Completed**・Closed（PR [#66](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/66)、Merge Commit: `b2de141`）。Evaluation Dispatcher（Feature #67、PR #68レビュー待ち）以降は未着手）
9. **Frontend** — Phase5（既存OCR推論テスト画面へのTrOCR選択UI追加・Model Metadata連携は✅完了: [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23) / [#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25)、Epic #1完了。Model Manager UI / Training UI / Evaluation UI / Experiment Tracking連携は**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄**）
10. **Benchmark** — Phase6（Benchmark Runner/Center連携。**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄**）
11. **Documentation** — Phase7（Backend/Frontendテストは各Feature Issueで実施済み。マニュアル・チュートリアル・リリース確認は**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄**）

1〜3（Engine Capability/Engine Registry/Model Metadata）は、TrOCRの採否に関わらず単独で価値を持つ共通基盤であるため最優先で着手した。4は新機能ではなく既存バグ修正のため3の直後に行った。5・7・9（一部）がTrOCRの既存推論経路への統合＝Epic #1で、6・8・9（残り）・10・11がEpic #27（学習・評価・Benchmark・Release Gate）である。

## 調査完了後に作成を検討するIssue（Phase構成）

以下は[ARCHITECTURE_DRAFT.md](ARCHITECTURE_DRAFT.md)・[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)（案C: Engine Capability + 限定Adapter）・`docs/design/`配下のDesign Documentsの内容を反映した仮の分割案であり、**まだGitHub Issueを作成しない**（ユーザーレビュー後に作成する）。

**設計方針**: Phase1〜2は「今後どんなOCRエンジンを追加しても再利用できる共通基盤」、Phase3〜6が「TrOCRという最初の適用事例」、Phase7が両方に関わるドキュメントである。TrOCR固有の実装（Phase3〜6）と共通基盤（Phase1〜2）を明確に分離し、Phase1〜2はTrOCRが最終的に不採用になった場合でも単独で価値を持つ（次にPARSeq等を検討する際にそのまま使える）よう設計している。

### Phase1: 共通基盤（Engine Capability / Engine Registry / Model Metadata）

- **Engine Capability**（✅完了: [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)）: [ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md)の設計を実装。`src/app/services/engine_capability.py`へスキーマ定義（既存3エンジンの`if/elif`分岐は変更しない。既存コードからの参照・配線はEngine Registry実装後に行う）
- **Engine Registry**（✅MVP実装済み: [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)）: [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)のうち`EngineDescriptor`/`EngineRegistry`（register/unregister/get/list/exists）のみを実装。Training/Inference/Evaluation Handler・MetadataProvider・ModelLoader・Exporter・Validatorは未実装（別Issue）。既存3エンジンをRegistryへ移行するかは別Issue、本Phaseでは仕組みのみ
- **Model Metadata**（✅MVP実装済み: [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)）: [MODEL_METADATA.md](../../design/MODEL_METADATA.md)のうち`ModelMetadata`（必須: `model_id`/`engine_id`のみ、`status`/`version`は不採用）を実装。既存`.tess.json`/`.ocr.json`/`.pt`は変更せず、各形式からの変換Adapterも今回は実装しない（`from_dict()`のみ提供）。カスタム分類モデル（`engine="custom"`）はEngine Registry未登録のため現時点では表現できない既知の制約あり

### Phase2: 既存バグ修正・Engine判定の一本化

- **既存エンジン判定の欠陥修正**（新機能ではなくバグ修正）: `frontend/src/views/ModelsView.jsx::engineLabelOf()`・`frontend/src/lib/inferenceModel.js::resolveInferenceEngine()`・`src/app/services/release_gate.py::_model_engine()`の「PaddleOCRキャッチオール」是正
  - ✅**Backend完了**（[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)）: `model_registry.py::list_model_infos()`・`ocr_pipeline.py::migrate_ocr_models_to_inference()`の暗黙paddleocrフォールバックを、`engine_registry.py`の`resolve_engine_id()`経由の明示的判定へ置き換え済み。未知engineは`"unknown"`
  - ✅**Frontend完了**（[#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)）: JSからPythonのEngine Registryを直接参照できないため、Backendとは独立したFrontend側最小実装（`frontend/src/lib/engineResolution.js::normalizeEngineId()`/`engineDisplayLabel()`）を新設し、`engineLabelOf()`/`resolveInferenceEngine()`/`resolveRestoredInferenceSelection()`の暗黙フォールバックを是正。詳細は[FEATURE_FRONTEND_ENGINE_RESOLUTION.md](FEATURE_FRONTEND_ENGINE_RESOLUTION.md)
  - ⬜`release_gate.py::_model_engine()`は未知拡張子で空文字を返す設計のため今回の「暗黙paddleocrフォールバック廃止」の対象外だったが、`model_registry.py`との重複一本化自体は未着手のまま
- **Engine判定の一本化**: `release_gate.py::_model_engine()`と`model_registry.py`の重複した拡張子判定ロジックを、Engine Registryの解決方法（[ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md)の「Engine解決方法」参照）へ一本化（未着手）

### Phase3: TrOCR Backend基盤

- **TrOCR依存関係・設定管理**（✅一部完了: [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)）: `requirements.txt`/`requirements-ci.txt`へ`transformers==5.14.1`等を追加済み、遅延import方針を適用済み（`src/app/services/trocr_engine.py`）。`config/settings.yaml`への統一名前空間（例: `engines.trocr.*`）ブロック新設は未着手
- **TrOCR単画像推論コア**（✅完了: [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)）: `TrOCREngine.load()`/`predict()`/`predict_file()`を実装。既存OCR Pipeline・API・Frontendへの接続は未着手（詳細は[TROCR_BACKEND.md](../../design/TROCR_BACKEND.md)）
- **TrOCR Dataset側の確認**: 既存Dataset形式（`meta.json`）がそのまま使えることを実装レベルで検証（スキーマ変更は不要と調査時点で判断済み）。未着手
- **TrOCR Model Metadata**: [MODEL_METADATA.md](../../design/MODEL_METADATA.md)スキーマに沿ったTrOCR用メタデータ実装（`processor`/`tokenizer`/`license`等の新規フィールドを実際に使う最初の事例）。未着手（Model Metadata AdapterはFeature #16でも対象外とした）

### Phase4: Training / Inference / Evaluation

- **TrOCR学習Backend**（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄・未着手**）: `services/trocr_pipeline.py`新設。Hugging Face Transformers（`VisionEncoderDecoderModel`+`Seq2SeqTrainer`）経由、公式`unilm/trocr`（fairseq）は不採用（[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)決定事項）
- **TrOCR推論Backend**（✅Epic #1完了: [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18) / [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)）: `predict.py::predict_from_image()`（`ocr_pipeline.py`ではなく実際の推論ディスパッチ先）へ`resolve_engine_id()`経由の`trocr`分岐を追加済み。既存`POST /predict`が`engine="trocr"`を受け付ける。詳細は[FEATURE_PIPELINE_TROCR.md](FEATURE_PIPELINE_TROCR.md) / [FEATURE_TROCR_API_INTEGRATION.md](FEATURE_TROCR_API_INTEGRATION.md)。`ENGINE_BUILDERS`スタイルの`recognize()`実装（Engine Registry Handler化）はFuture Work
- **TrOCR評価連携の方針決定**（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄**）: `ocr_evaluation.py`のTesseract専用制約への対応可否（PaddleOCRも未対応のため、TrOCR単独の課題ではないことに留意）。Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)「Multi-engine Evaluation API Architecture」で調査・設計**Completed**・Closed（PR [#62](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/62)をSquash Merge・mainへ反映済み、Merge Commit: `34aea57`）。採用Architecture: 共通Evaluation Runner + Engine別Predictor、canonical engine_idによるDispatcher。confidence算出方法は「nullable・未取得値の捏造禁止」で確定。成果物: [MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)・[ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md)。Common Evaluation Schema（Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)）は**Completed**・Closed（PR [#64](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/64)をSquash Merge・mainへ反映済み、Merge Commit: `4663dd0`）。count系はstrict int、float系はint/floatのみ許可しbool・数値文字列・非有限値を拒否、confidenceはnullableで実測0.0を許可。既存APIは無変更・未配線。クリーン環境ではIssue #8のみ既知の失敗として残る（無関係）。Common Metric Calculator（Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)）は**Completed**・Closed（PR [#66](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/66)をSquash Merge・mainへ反映済み、Merge Commit: `b2de141`）。`src/app/services/evaluation_metrics.py`でCER（マイクロ平均）・完全一致・confusion集計をEngine非依存で実装、既存`ocr_evaluation.py`とは出力一致をテストで確認したうえで独立実装とし配線は見送り（logger名互換問題を含めTesseract Predictor Adapter Issueへ持ち越し）。次の実装対象はEvaluation Dispatcher（Feature #67、PR #68レビュー待ち）

### Phase5: Frontend

- **推論テスト画面へのTrOCR選択UI**（✅Epic #1完了: [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)）: `InferenceView.jsx`（既存OCR推論APIへ直接`POST /predict`する画面）へTrOCR選択肢＋モデル参照自由入力欄を追加。詳細は[FEATURE_TROCR_FRONTEND_UI.md](FEATURE_TROCR_FRONTEND_UI.md)。`OcrBatchView.jsx`/`RapidOCRView.jsx`は対象外（Future Work参照）
- **TrOCR Model MetadataのFrontend連携**（✅Epic #1完了: [#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25)）: 既存`GET /models/info`（`modelInfos`）からengine正規化が`trocr`のものだけを抽出し、登録済みモデル選択・手動入力の2方式を共存させた。`ModelMetadata`dataclass自体は依然未配線・TrOCR用モデル一覧ファイル形式も存在しないため、実環境では登録済みモデルは基本的に0件（既知の状態）。詳細は[FEATURE_TROCR_MODEL_METADATA_UI.md](FEATURE_TROCR_MODEL_METADATA_UI.md)
- **Model Manager UI**（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄・未着手**）: Engine Capability参照への切替（Phase2の欠陥修正と連動）
- **Training UI**（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄・未着手**）: `TrainingView.jsx`の既存ドロップダウンへTrOCR選択肢を追加
- **Evaluation UI**（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄・未着手**）: Phase4の評価連携方針決定に連動
- **Experiment Tracking連携**（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄・未着手**）: 既存の`training`サブオブジェクト予約フィールド（`optimizer`/`scheduler`/`loss`/`learning_rate`/`batch_size`）の活用可否、epoch/loss推移の記録要否を確定

### Phase6: Benchmark（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄・未着手**）

- **Benchmark Runner連携**: `ENGINE_CATALOG`/`ENGINE_BUILDERS`へのTrOCR登録
- **Benchmark Center連携**: 変更不要の想定だが実装後に確認（調査時点でengine非依存と判断済み）

### Phase7: Documentation

- **Backendテスト**（✅Epic #1完了）: 各Feature Issue（#16/#18/#20/#25）で実装と同じPRにテストを含めて完了済み
- **Frontendテスト**（✅Epic #1完了）: `engineLabelOf()`等の修正に対する回帰テストを含め、各Feature Issue（#12/#23/#25）で完了済み
- **ユーザーマニュアル**（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄・未着手**）: `docs/manual/`関連章の更新
- **チュートリアル**（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄・未着手**）: `docs/tutorial/`へTrOCRチュートリアル追加（日本語対応方針が未解決のため、英語/英数字ユースケースを優先する可能性あり。学習成果物ができてから書く方が実用的）
- **リリース・移行確認**（**Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)管轄・未着手**）: 既存プロジェクトへの影響が無いことの最終確認

## Future Work（Epic #1範囲内・未着手）

- **【最優先】`ModelMetadata`は実運用で未使用**: Feature [#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25)のレビューで確定した最重要事項。`ModelMetadata`dataclass（Feature [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)で実装済み）は、`model_metadata.py`自身以外のどのファイルからも参照されず、これを生成・保存・読込する処理はコードベース上どこにも存在しない（既存コードへ一切未配線）。加えて`model_registry.py::list_model_infos()`にもTrOCR用ファイル形式（`*.trocr.json`相当）は存在しないため、Frontendの「登録済みモデルから選択」機能（Feature #25）は実環境では常に0件を返す。**対応は[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure、TrOCRに限らない別責務。Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)とは分離管理する）の責務とする**（2026-07-31、Issue #1のClose整理時に確定。Investigation [#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)Closed、Architecture [#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)で設計中、Migration計画は[MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)・[MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)参照）。Epic #27でTrOCR学習に着手する際は、Epic #28の決定（`ModelMetadata`経由で保存するか、既存`.ocr.json`/`.tess.json`パターンを踏襲した新形式にするか）を前提とする。
- **カスタム分類モデル（`engine="custom"`）のModel Metadata対応**: [MODEL_METADATA.md](../../design/MODEL_METADATA.md)の`ModelMetadata`は、Engine Registry登録済みの4エンジン（tesseract/paddleocr/easyocr/trocr）のみを`engine_id`として許可する。カスタム分類モデル（`.pt`）は`engine="custom"`という、Engine Registry未登録の値を使っているため、現時点のModelMetadataはカスタム分類モデルを表現できない（Feature [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)で確認済みの既知の制約）。対応する場合はEngine Registryへ`custom`を新規登録するか、ModelMetadataの対象外として扱うかを別途判断する必要がある。今回は対象外のため、忘れないようここへ記録する（GitHub Issueはまだ作成しない）
- **device選択ロジックの共通化候補**: 現在、`src/app/train.py::detect_device()`（分類モデル用、MPS/CPUのみ判定）と`src/app/services/trocr_engine.py::_resolve_device()`（TrOCR用、CPU/CUDAのみ判定）が、それぞれ独立した自己完結ロジックとして存在する（Feature [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)で確認済み）。将来PARSeq等のPyTorchベースエンジンが追加されるたびに同種のdevice解決ロジックが個別実装される可能性がある。共通のdevice解決ヘルパーへ統合するかどうかは、実際に3つ目以降のPyTorchベースエンジンが追加される段階で判断する（現時点で2エンジンのみのため、抽象化を急がない）。GitHub Issueはまだ作成しない
- **TrOCRのmodel_ref解決**: `predict.py::_predict_with_trocr()`は、既存3エンジンが使う`.ocr.json`/`.tess.json`ファイル探索（`resolve_model_path()`/`resolve_ocr_model_meta()`）を適用せず、呼び出し側の`model`パラメータをHugging Face Hub ID・ローカルパスとしてそのまま`TrOCREngine.load()`へ渡している（Feature [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)で確認済み）。そのため`model`未指定時の既定値`"latest"`をTrOCRへ渡すと存在しないモデル名としてロード失敗する。TrOCR用のModel Metadata・Model Registry連携が実装される段階で、他エンジンと同様の解決方式へ見直す
- **PipelineレベルでのTrOCREngineインスタンス再利用**: 現在、`predict.py::_predict_with_trocr()`はTrOCR推論のたびに`TrOCREngine.load()`を呼び直しており、EasyOCR/PaddleOCRが持つような`_EASYOCR_READER_CACHE`/`_PADDLEOCR_READER_CACHE`相当のキャッシュを持たない（Feature [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)で意図的に対象外とした）。TrOCRのモデルロードはProcessor/Modelのロード＋deviceへの移動を伴い相対的に重いため、同一model_refでの連続推論が増える場合はPipelineまたはServiceレベルでのインスタンス再利用（キャッシュ）を検討する余地がある。ただし新規キャッシュの導入はメモリ保持・複数device・複数model_ref同時利用時の設計判断を要するため、実際の利用状況（連続呼び出し頻度・レイテンシ影響）を確認してから着手する。GitHub Issueはまだ作成しない
- **`/predict`の同期推論実行**: `POST /predict`は`async def`だが、内部で`predict_from_image()`（重い同期処理）を直接呼び出しており、Thread Pool等でオフロードしていない（Feature [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)で確認済み。既存3エンジンも同様で、TrOCR固有の問題ではない）。TrOCRはモデルロード＋推論が相対的に重いため、リクエスト処理中のイベントループ占有時間が既存エンジンより長くなる可能性がある。既存Engineも含めた影響を踏まえ、対応要否は別途判断する。GitHub Issueはまだ作成しない
- **preview/batch系エンドポイントへのmodel_ref必須検証拡張**: `POST /predict`にのみ、engine=trocr時の`model`（model_ref）必須検証を追加した（Feature [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)）。`/preprocess/preview`（GET/POST）・`/api/ocr/predict/batch`・`/api/ocr/yolo/predict`・`/api/ocr/preview-file/batch`は、engine/model文字列を制限していないため`engine="trocr"`自体は引き続き通るが、model_ref未指定時に`/predict`と同じ明確な400エラーにはならない（既存の`ValueError`/`FileNotFoundError`個別catchのみで、`RuntimeError`系の汎用catch-allを持たないエンドポイントもある）。利用実態を踏まえ、必要であれば共通バリデーションヘルパーとして各エンドポイントへ展開する。GitHub Issueはまだ作成しない
- **Backend Engine RegistryをAPI経由でFrontendへ提供し、Frontend側Engine一覧を一元管理する**（Bug [#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)のレビューで記録）。GitHub Issueはまだ作成しない
- **`OcrBatchView.jsx`/`RapidOCRView.jsx`へのTrOCR対応**: 両画面は`InferenceView.jsx`と同じApp.jsx共有state（`inferEngine`等）を参照するが、独自のEngine選択肢・FormData構築ロジックを持ち、いずれもTrOCRを追加していない（Feature [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)で確認済み）。`InferenceView`でTrOCRを選択したまま両画面へ遷移すると、共有stateの値がそれらのドロップダウン選択肢と一致しない状態になりうる（クラッシュはしない。既存の行/スロット単位のエラーハンドリングで捕捉される）。対応する場合は両画面へ同様のUI追加が必要。GitHub Issueはまだ作成しない
- **TrOCRモデル参照の永続化**: `InferenceView.jsx`のTrOCRモデル参照入力はテスト画面の一時的なUI状態としてのみ保持しており、プロジェクト保存・復元（「推論に使用」の仕組み）の対象にしていない（Feature [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)で意図的に対象外とした）。Model Metadata連携が実装される段階で永続化要否を再検討する。GitHub Issueはまだ作成しない
- **`InferenceView`・`OcrBatchView`・`RapidOCRView`のEngine選択UIを共通Component化する**（Feature [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)のレビューで記録）。GitHub Issueはまだ作成しない

## その他の将来検討候補（優先度低・Epic対象外）

- **[Performance] Frontendの初期JavaScript bundleを分割する**: `npm run build`時に`index-*.js`が500kBを超える警告が継続的に出ている（2026-07-29時点で約937kB）。ビルド自体は正常完了しており、Engine Capability/Engine Registry実装（Backendのみの変更）とは無関係。現時点では初期表示遅延等の具体的な症状は確認できていないため、急いで対応する必要はない。実際に初期表示が遅い・端末で重い・配信環境で問題になる等の症状が確認された段階でIssue化し、対応を検討する

## 分割ルール

- 1 Issue = 1つの明確な完了条件
- 調査と実装を同じIssueへ混在させない
- BackendとFrontendを無条件に同一Issueへまとめない
- 共通基盤とTrOCR固有処理を区別する
- ドキュメントを最後の巨大Issueへまとめすぎない
- 既存機能の変更は回帰テストを含める
