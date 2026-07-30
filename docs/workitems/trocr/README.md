# TrOCR対応 Work Item

## 状態

Phase1（設計フェーズ）完了。Phase2（共通基盤実装）完了（Engine Capability [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)・Engine Registry [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)・Engine判定ロジック統一Backend側[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)・共通Model Metadata [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)、いずれもmainへマージ済み。Frontend側は[#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)として別Issue化・未着手）。Phase3（TrOCR Backend単画像推論コア、Feature [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)）完了・mainへマージ済み。Phase4（OCR Pipelineへの接続、Feature [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)）完了・mainへマージ済み。既存OCR推論APIへの統合（Feature [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)）実装済み・PRレビュー待ち

## 目的

OCR CrafterへTransformerベースの文字認識エンジンを追加できる構成を検討し、最初の対象としてTrOCRの採用可否を判断する。

## 現在の段階

- [x] Epic作成
- [x] 技術調査Issue作成
- [x] 実装前調査（Backend/Frontend現状分析・TrOCR公式仕様調査・統合方式比較）
- [x] Architecture Decision準備（[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)）
- [x] Design Documents作成（[ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [MODEL_METADATA.md](../../design/MODEL_METADATA.md)）
- [x] ユーザーレビュー（Design Documents最終レビュー完了、ADR-0001をAcceptedへ変更）
- [x] Phase2 最初の実装Issue作成・完了（Engine Capability、[#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)）
- [x] Phase2 2番目の実装Issue作成・MVP実装完了（Engine Registry、[#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)、Closed）
- [x] Engine判定既存バグ修正（Backend）実装完了・Closed（[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)）。Frontend側は別Issue化のみ（[#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)、未着手）
- [x] Phase2 3番目の実装Issue作成・実装完了（Model Metadata、[#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)、Closed）
- [x] Phase3 最初の実装Issue作成・実装完了（TrOCR Backend単画像推論コア、[#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)、Closed・mainへマージ済み）
- [x] Phase4 OCR Pipelineへの接続Issue作成・実装完了（[#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)、Closed・mainへマージ済み）
- [x] 既存OCR推論APIへのTrOCR統合Issue作成・実装完了（[#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)、PRレビュー待ち・未マージ）
- [ ] 残りの実装Issue作成（[ISSUE_MAP.md](ISSUE_MAP.md)の確定順序: Engine判定既存バグ修正のFrontend側、TrOCR Training/Evaluation等）

## 関連Issue

- Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) [Epic] Transformer OCR対応基盤とTrOCR統合
- Investigation: [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) [Investigation] TrOCR採用可否とOCR Crafter統合方式の調査（Parent Epic: #1）
- Feature: [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4) [Feature] Engine Capability実装（Parent Epic: #1、実装済み）
- Feature: [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9) [Feature] Engine Registry実装（Parent Epic: #1、MVP実装済み・Closed）
- Refactor: [#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11) [Refactor] Engine判定ロジックをEngine Registryへ統一（Parent Epic: #1、Backend実装済み・Closed）
- Bug: [#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12) [Bug] Frontendの未知Engine判定がPaddleOCRへ暗黙フォールバックする（Parent Epic: #1、未着手）
- Feature: [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14) [Feature] 共通Model Metadata実装（Parent Epic: #1、実装済み・Closed）
- Feature: [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16) [Feature] TrOCR Backend単画像推論コア実装（Parent Epic: #1、実装済み・Closed）
- Feature: [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18) [Feature] OCR PipelineへTrOCR統合（Parent Epic: #1、実装済み・Closed）
- Feature: [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20) [Feature] 既存OCR推論APIへTrOCR統合（Parent Epic: #1、実装済み・PRレビュー待ち）

## 作業資料

- [EPIC.md](EPIC.md)
- [INVESTIGATION.md](INVESTIGATION.md)
- [ARCHITECTURE_DRAFT.md](ARCHITECTURE_DRAFT.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
- [DECISION_LOG.md](DECISION_LOG.md)
- [../../adr/ADR-0001_Trocr_Architecture.md](../../adr/ADR-0001_Trocr_Architecture.md)（Status: Accepted）
- [FEATURE_ENGINE_CAPABILITY.md](FEATURE_ENGINE_CAPABILITY.md)（Feature [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)、実装済み）
- [FEATURE_ENGINE_REGISTRY.md](FEATURE_ENGINE_REGISTRY.md)（Feature [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)、MVP実装済み・Closed）
- [FEATURE_ENGINE_RESOLUTION.md](FEATURE_ENGINE_RESOLUTION.md)（Refactor [#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)、Backend実装済み・Closed）
- [FEATURE_MODEL_METADATA.md](FEATURE_MODEL_METADATA.md)（Feature [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)、実装済み・Closed）
- [FEATURE_TROCR_INFERENCE_CORE.md](FEATURE_TROCR_INFERENCE_CORE.md)（Feature [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)、実装済み・Closed）
- [FEATURE_PIPELINE_TROCR.md](FEATURE_PIPELINE_TROCR.md)（Feature [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)、実装済み・Closed）
- [FEATURE_TROCR_API_INTEGRATION.md](FEATURE_TROCR_API_INTEGRATION.md)（Feature [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)、実装済み・PRレビュー待ち）

## 重要な制約

- 調査完了前に本実装を開始しない
- 既存OCRエンジンを無条件に共通化しない
- TrOCR固有仕様を既存エンジンへ押し付けない
- 実装済み機能との互換性を維持する
- Dataset・Experiment・Model・Evaluation・Benchmarkとの連携可能性を確認する

## Review Summary（2026-07-29、PR #3反映予定）

- **Investigation完了**: Issue [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)の完了条件をすべて満たし、Close可能な状態（Closeはユーザー判断で別途実施）
- **ADR Accepted**: [ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)のStatusをProposedからAcceptedへ変更。案C（Engine Capability導入 + 限定Adapter）を正式決定
- **共通基盤設計完了**: [ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [MODEL_METADATA.md](../../design/MODEL_METADATA.md)の最終レビュー完了（TrOCR専用ではなく将来エンジン全般を見据えた設計であることを確認）
- **Phase2へ移行予定**: 次に作成するIssue候補の順序を[ISSUE_MAP.md](ISSUE_MAP.md)へ確定済み（Engine Capability→Engine Registry→Model Metadata→既存バグ修正→TrOCR Backend以降）。GitHub Issue作成はまだ行わない
