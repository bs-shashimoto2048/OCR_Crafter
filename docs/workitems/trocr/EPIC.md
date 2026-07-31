# [Epic] Transformer OCR対応基盤とTrOCR統合

Issue: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

**スコープ整理（2026-07-31）**: 本Epicのスコープは、既存OCR推論経路（OCR Pipeline / 既存OCR推論API / Frontend推論画面）へのTrOCR統合が完了した時点で確定した。Training／Evaluation／Benchmark／Release Gate（Deployment）は、当初のロードマップには含まれていたが、実際のIssue構成上は着手されておらず、[Epic #2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）へ引き継いだ。以下のProgressは、この整理後の確定スコープに基づく。

## Progress（2026-07-31時点、完了済みIssueベース）

✅ Investigation（[#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)、Closed。PR [#3](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/3)でmainへマージ済み）

✅ Architecture（[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)、Status: Accepted）

✅ Design Documents（[ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [MODEL_METADATA.md](../../design/MODEL_METADATA.md)）

✅ Engine Capability（[#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)、Closed。PR [#5](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/5)でmainへマージ済み。`src/app/services/engine_capability.py`）

✅ Engine Registry（[#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)、Closed。PR [#10](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/10)でmainへマージ済み。`src/app/services/engine_registry.py`。MVP範囲（Handler群未実装。Future Work参照）

✅ Model Metadata（[#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)、Closed。PR [#15](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/15)でmainへマージ済み。`src/app/services/model_metadata.py`。**共通スキーマの実装のみ**で、既存コードへは依然未配線（Future Work最優先項目、詳細下記）

✅ Engine判定既存バグ修正（Backend側[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)、Closed。PR [#13](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/13)。Frontend側[#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)、Closed。PR [#22](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/22)（merge commit `1b93b75`）。`resolve_engine_id()`経由の明示的判定へ統一、`frontend/src/lib/engineResolution.js`で未知Engineの暗黙PaddleOCRフォールバックを是正）

✅ TrOCR Backend推論コア（[#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)、Closed。PR [#17](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/17)でmainへマージ済み（merge commit `8b914e5`）。`src/app/services/trocr_engine.py`）

✅ OCR PipelineへTrOCR統合（[#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)、Closed。PR [#19](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/19)でmainへマージ済み（merge commit `dab3cbe`）。`src/app/predict.py::predict_from_image()`が`resolve_engine_id()`経由で`trocr`分岐しTrOCREngineを呼び出す）

✅ 既存OCR推論APIへTrOCR統合（[#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)、Closed。PR [#21](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/21)でmainへマージ済み（merge commit `031f59b`）。既存`POST /predict`が`engine="trocr"`を受け付ける。新規TrOCR専用APIは作成せず既存経路を拡張）

✅ FrontendへTrOCR選択UI追加（[#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)、Closed。PR [#24](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/24)でmainへマージ済み（merge commit `cfb9ac3`）。`InferenceView.jsx`（推論テスト画面）へTrOCR選択肢＋モデル参照入力を追加）

✅ TrOCR Model MetadataのFrontend連携（[#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25)、Closed。PR [#26](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/26)でmainへマージ済み（merge commit `65bf4e5`）。既存`GET /models/info`からengine正規化が`trocr`のものだけを抽出し、登録済みモデル選択・手動入力の2方式を共存）

**この時点で「TrOCR統合完了」**: Engine Registry → resolve_engine_id() → OCR Pipeline → {PaddleOCR, EasyOCR, Tesseract, TrOCR} という当初目標の経路が確立し、Backend（Pipeline・API）・Frontend（推論画面・Model Metadata連携）のすべてでTrOCRが選択・実行可能な状態にある。既存3エンジンへの回帰はいずれのPRでも確認済み（Issue #8を除き全テスト通過）。

## Epic #2へ引き継いだ項目

以下は当初のロードマップに含まれていたが、実際には未着手のまま[Epic #2（TrOCR学習・評価・Benchmark・Release Gate統合）](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)へ引き継いだ。

- Training（TrOCR学習Backend）
- Evaluation（TrOCR評価連携）
- Benchmark（Benchmark Runner/Center連携）
- Release Gate / Deployment（本番リリース判定へのTrOCR組み込み）

参考: CI依存関係修正（[#6](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/6)、PR [#7](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/7)でmainへマージ済み）／既存のDB初期化テスト課題（[#8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)、Open、Epic対象外の既存不具合）

**Future Work（Epic #1範囲内・未着手。Epic #2の前提として先に解消したほうがよいものを含む）**: 【最優先】`ModelMetadata`dataclassは実運用で未使用（既存コードへ一切未配線。Epic #2でTrOCR学習に着手する際は保存方式を最初に判断する必要がある）／カスタム分類モデル（`engine="custom"`）のModel Metadata対応／device選択ロジックの共通化候補／TrOCRのmodel_ref解決方式の見直し／PipelineレベルでのTrOCREngineインスタンス再利用／`/predict`の同期推論実行（Thread Pool未使用）／preview・batch系エンドポイントへのmodel_ref必須検証拡張／Backend Engine RegistryをAPI経由でFrontendへ提供する案／`OcrBatchView.jsx`・`RapidOCRView.jsx`へのTrOCR対応／TrOCRモデル参照の永続化／Engine選択UIの共通Component化／Engine Registry Handler化（`ENGINE_BUILDERS`スタイルの`recognize()`実装）。詳細は[ISSUE_MAP.md](ISSUE_MAP.md)の「Future Work」参照。

## 背景

OCR Crafterは現在、複数のOCRエンジンを扱っています。

TrOCRの追加によって、TransformerベースのEnd-to-End文字認識モデルを、既存の推論フローへ加えることを検討しました。

既存エンジンとは学習方式、モデル構造、依存関係、保存形式、推論条件が異なるため、単純な条件分岐追加ではなく、Engine Capability/Engine Registry/Model Metadataという共通基盤を先に整備したうえで、既存設計との適合性を調査しながら段階的に統合しました。

## 目的

- TrOCRを既存OCR推論経路（OCR Pipeline / 既存OCR推論API / Frontend推論画面）へ統合する
- 将来のRecognition Backend追加を妨げない共通基盤（Engine Capability/Engine Registry/Model Metadata）を確立する
- 既存OCRエンジンの動作とデータ互換性を維持する

TrOCRの学習・評価・Benchmark・Release Gate統合は[Epic #2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)の目的とする。

## 対象範囲候補

- TrOCR技術調査
- 既存OCRエンジン構成調査
- Engine Capability設計
- Recognizer Adapterの必要性判断
- TrOCR推論（Pipeline・API・Frontend統合）
- Model Metadata共通スキーマ
- UI（推論画面のTrOCR選択）
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
- TrOCR学習・評価・Benchmark・Release Gate統合（[Epic #2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)へ引き継ぎ）

## 完了条件

Epicの完了条件は、子Issueがすべて完了し、以下が確認できることです。

- 既存Engine共通基盤（Engine Capability/Engine Registry/Model Metadata共通スキーマ）が実装されている
- 既存Engine判定バグが是正されている（Backend/Frontend双方）
- TrOCRを選択して推論を実行できる（OCR Pipeline・既存OCR推論API・Frontend推論画面の全経路）
- 既存OCRエンジン（Tesseract/PaddleOCR/EasyOCR）へ回帰がない
- 実装内容がドキュメント化されている

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
- [x] #25（Feature: TrOCR Model MetadataをFrontend推論UIへ連携、Closed）

**子Issueはすべて完了。Close可能。**

## 後続Epic

[Epic #2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

## 関連資料

`docs/workitems/trocr/`
