# [Epic] Transformer OCR対応基盤とTrOCR統合

Issue: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

## Progress（2026-07-30時点）

✅ Investigation（[#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)、Closed。PR [#3](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/3)でmainへマージ済み）

✅ Architecture（[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)、Status: Accepted）

✅ Design Documents（[ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [MODEL_METADATA.md](../../design/MODEL_METADATA.md)）

✅ Engine Capability（[#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)、Closed。PR [#5](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/5)でmainへマージ済み。`src/app/services/engine_capability.py`。既存コードへの配線はまだ無し）

✅ Engine Registry（[#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)、Closed。PR [#10](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/10)でmainへマージ済み。`src/app/services/engine_registry.py`。MVP範囲のみ（Handler群未実装）、既存コードへの配線はまだ無し）

✅ Model Metadata（[#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)、Closed。PR [#15](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/15)でmainへマージ済み。`src/app/services/model_metadata.py`。既存コードへの配線・Adapterはまだ無し）

🔶 Engine判定既存バグ修正（Backend側は[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)、Closed。PR [#13](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/13)でmainへマージ済み。`resolve_engine_id()`経由の明示的判定へ統一、互換性調査済み。Frontend側は[#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)として別Issue化、未着手のため🔶のまま）

⬜ TrOCR Backend

⬜ Training

⬜ Inference

⬜ Evaluation

⬜ Frontend

⬜ Benchmark

⬜ Documentation

次フェーズ（Phase2）: [ISSUE_MAP.md](ISSUE_MAP.md)の確定順序で残りの実装Issue（Engine判定既存バグ修正のFrontend側、TrOCR Backend以降）を作成予定。

参考: CI依存関係修正（[#6](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/6)、PR [#7](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/7)でmainへマージ済み）／既存のDB初期化テスト課題（[#8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8)、Open、Epic対象外の既存不具合）

**Future Work（Epic範囲内・未着手）**: カスタム分類モデル（`engine="custom"`）のModel Metadata対応。Engine Registry未登録の`custom`をどう扱うか未決定（詳細は[ISSUE_MAP.md](ISSUE_MAP.md)の「Future Work」参照）。

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
- [ ] #12（Bug: Frontendの未知Engine判定がPaddleOCRへ暗黙フォールバックする、未着手）
- [x] #14（Feature: 共通Model Metadata実装、Closed）

## 関連資料

`docs/workitems/trocr/`
