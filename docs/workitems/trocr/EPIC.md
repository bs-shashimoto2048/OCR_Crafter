# [Epic] Transformer OCR対応基盤とTrOCR統合

Issue: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

## Progress（2026-07-29時点）

✅ Investigation（[#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)、Close可能）

✅ Architecture（[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)、Status: Accepted）

✅ Design Documents（[ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [MODEL_METADATA.md](../../design/MODEL_METADATA.md)）

⬜ Engine Capability

⬜ Engine Registry

⬜ Model Metadata

⬜ TrOCR Backend

⬜ Training

⬜ Evaluation

⬜ Benchmark

⬜ Documentation

次フェーズ（Phase2）: Engine Capability / Engine Registry / Model Metadataの実装Issueを、[ISSUE_MAP.md](ISSUE_MAP.md)の順序で作成予定。

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

初期状態ではInvestigation Issueのみ登録してください。

実装Issueは調査完了後に追加します。

- [ ] #2

## 関連資料

`docs/workitems/trocr/`
