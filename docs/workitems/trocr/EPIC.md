# [Epic] Transformer OCR対応基盤とTrOCR統合

Issue: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

## Progress（2026-07-30時点）

✅ Investigation（[#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)、Closed。PR [#3](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/3)でmainへマージ済み）

✅ Architecture（[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)、Status: Accepted）

✅ Design Documents（[ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [MODEL_METADATA.md](../../design/MODEL_METADATA.md)）

✅ Engine Capability（[#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)、Closed。PR [#5](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/5)でmainへマージ済み。`src/app/services/engine_capability.py`。既存コードへの配線はまだ無し）

✅ Engine Registry（[#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)、Closed。PR [#10](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/10)でmainへマージ済み。`src/app/services/engine_registry.py`。MVP範囲のみ（Handler群未実装）、既存コードへの配線はまだ無し）

✅ Model Metadata（[#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)、Closed。PR [#15](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/15)でmainへマージ済み。`src/app/services/model_metadata.py`。既存コードへの配線・Adapterはまだ無し）

✅ Engine判定既存バグ修正（Backend側は[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)、Closed。PR [#13](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/13)でmainへマージ済み。`resolve_engine_id()`経由の明示的判定へ統一、互換性調査済み。Frontend側は[#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)、Closed。PR [#22](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/22)でmainへマージ済み（merge commit `1b93b75`）。`frontend/src/lib/engineResolution.js`を新設し`engineLabelOf()`/`resolveInferenceEngine()`/`resolveRestoredInferenceSelection()`の暗黙PaddleOCRフォールバックを是正）

✅ TrOCR Backend推論コア（[#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)、Closed。PR [#17](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/17)でmainへマージ済み（merge commit `8b914e5`）。`src/app/services/trocr_engine.py`。単画像推論のみ、OCR Pipeline等へは未接続）

✅ OCR PipelineへTrOCR統合（[#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)、Closed。PR [#19](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/19)でmainへマージ済み（merge commit `dab3cbe`）。`src/app/predict.py::predict_from_image()`が`resolve_engine_id()`経由で`trocr`分岐しTrOCREngineを呼び出す。当初想定の`ocr_pipeline.py`ではなく実際の推論ディスパッチファイルへ接続。API/Frontend/学習/評価は未接続）

✅ TrOCR API統合（[#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)、Closed。PR [#21](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/21)でmainへマージ済み（merge commit `031f59b`）。既存`POST /predict`が`engine="trocr"`を受け付ける。新規TrOCR専用APIは作成せず既存経路を拡張。Frontend/Model Metadata/Engineキャッシュは未接続）

✅ TrOCR Frontend UI（[#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)、Closed。PR [#24](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/24)でmainへマージ済み（merge commit `cfb9ac3`）。`InferenceView.jsx`（推論テスト画面）へTrOCR選択肢＋モデル参照入力を追加し、既存`POST /predict`を利用。`OcrBatchView.jsx`/`RapidOCRView.jsx`は対象外。Model Metadata/Engine Registry APIは未接続）

🔶 TrOCR Model MetadataのFrontend連携（[#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25)、実装済み・PRレビュー待ち。既存`GET /models/info`からengine正規化が`trocr`のものだけを抽出し、登録済みモデル選択・手動入力の2方式を共存。Backend変更なし。`ModelMetadata`dataclass自体は依然未配線・TrOCR用モデル一覧ファイル形式も存在しないため、実環境では登録済みモデルは基本的に0件）

⬜ Training

⬜ Inference（Engine Registry Handler化は未着手。OCR Pipeline・APIへの接続自体は上記参照）

⬜ Evaluation

⬜ Frontend（推論テスト画面のTrOCR選択UIは上記参照。Model Manager/Training/Evaluation UIは未着手）

⬜ Benchmark

⬜ Documentation

次フェーズ: TrOCR Training／Evaluation連携を含む残りの実装Issue（[ISSUE_MAP.md](ISSUE_MAP.md)の確定順序）を作成予定。

参考: CI依存関係修正（[#6](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/6)、PR [#7](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/7)でmainへマージ済み）／既存のDB初期化テスト課題（[#8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)、Open、Epic対象外の既存不具合）

**Future Work（Epic範囲内・未着手）**: カスタム分類モデル（`engine="custom"`）のModel Metadata対応／device選択ロジックの共通化候補（`train.py::detect_device()`と`trocr_engine.py::_resolve_device()`が独立実装）／TrOCRのmodel_ref解決方式の見直し（Model Metadata連携実装時）／PipelineレベルでのTrOCREngineインスタンス再利用（現状は推論のたびに`load()`し直す設計）／`/predict`の同期推論実行（Thread Pool未使用、既存Engine共通の課題）／preview・batch系エンドポイントへのmodel_ref必須検証拡張／Backend Engine RegistryをAPI経由でFrontendへ提供しFrontend側Engine一覧を一元管理する案／`OcrBatchView.jsx`・`RapidOCRView.jsx`へのTrOCR対応／TrOCRモデル参照の永続化／`InferenceView`・`OcrBatchView`・`RapidOCRView`のEngine選択UIの共通Component化／TrOCR学習・モデル登録の仕組み（実装されるまで登録済みモデル選択は0件のまま）／`ModelMetadata`の既存コードへの配線・変換Adapter実装。詳細は[ISSUE_MAP.md](ISSUE_MAP.md)の「Future Work」参照。

## 背景

OCR Crafterは現在、複数のOCRエンジンを扱っています。

TrOCRの追加によって、TransformerベースのEnd-to-End文字認識モデルを、学習・推論・評価・モデル管理の対象へ加えることを検討します。

ただし、既存エンジンとは学習方式、モデル構造、依存関係、保存形式、推論条件が異なるため、単純な条件分岐追加ではなく、既存設計との適合性を調査した上で進めます。

## 目的

- TrOCRをOCR Crafterの学習対象へ追加できる構成を確立する
- TrOCRの推論・評価・モデル管理を既存フローへ統合する
- 将来のRecognition Backend追加を妨げない設計にする
- 既存OCRエンジンの動作とデータ互換性を維持する

## 対象範囲候補

- TrOCR技術調査
- 既存OCRエンジン構成調査
- Engine Capability設計
- Recognizer Adapterの必要性判断
- TrOCR学習
- TrOCR推論
- TrOCR評価
- Dataset連携
- Experiment Tracking連携
- Model管理連携
- Benchmark Runner連携
- Benchmark Center連携
- UI
- テスト
- ドキュメント

## 対象外

現段階では以下を対象外とします。

- PARSeqの実装
- ABINetの実装
- ViTSTRの実装
- Donutの実装
- 文書レイアウト解析
- 文字検出モデルの全面再設計
- 未調査の汎用Pluginシステム実装
- 既存OCRエンジンの全面置換

## 完了条件

Epicの完了条件は、調査後に確定した子Issueがすべて完了し、以下が確認できることです。

- TrOCR学習が実行できる
- TrOCRモデルを保存・識別できる
- TrOCR推論が実行できる
- TrOCRモデル評価が実行できる
- Datasetとの系譜を追跡できる
- Experimentとの系譜を追跡できる
- Model管理画面から確認できる
- Benchmark関連画面と整合する
- 既存OCRエンジンへ回帰がない
- ユーザー向けドキュメントが整備されている

## 子Issue

- [x] #2（Investigation、Closed）
- [x] #4（Feature: Engine Capability実装、Closed）
- [x] #9（Feature: Engine Registry実装、Closed）
- [x] #11（Refactor: Engine判定ロジックをEngine Registryへ統一、Backend側、Closed）
- [x] #12（Bug: Frontendの未知Engine判定がPaddleOCRへ暗黙フォールバックする、Closed）
- [x] #14（Feature: 共通Model Metadata実装、Closed）
- [x] #16（Feature: TrOCR Backend単画像推論コア実装、Closed）
- [x] #18（Feature: OCR PipelineへTrOCR統合、Closed）
- [x] #20（Feature: 既存OCR推論APIへTrOCR統合、Closed）
- [x] #23（Feature: FrontendへTrOCR選択UIを追加、Closed）
- [ ] #25（Feature: TrOCR Model MetadataをFrontend推論UIへ連携、実装済み・PRレビュー待ち）

## 関連資料

`docs/workitems/trocr/`
