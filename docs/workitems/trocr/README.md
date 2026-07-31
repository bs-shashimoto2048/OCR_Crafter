# TrOCR対応 Work Item

## 状態

**Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)は既存推論経路へのTrOCR統合が完了し、Closed（2026-07-31 09:21:33 JST）。** Phase1（設計フェーズ）完了。Phase2（共通基盤実装）完了（Engine Capability [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4)・Engine Registry [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9)・Engine判定ロジック統一Backend側[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)・Frontend側[#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)・共通Model Metadata [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)、いずれもmainへマージ済み）。Phase3（TrOCR Backend単画像推論コア、Feature [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)）完了・mainへマージ済み。Phase4（OCR Pipelineへの接続、Feature [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)）完了・mainへマージ済み。既存OCR推論APIへの統合（Feature [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)）完了・mainへマージ済み。Phase5（推論テスト画面へのTrOCR選択UI追加、Feature [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)）完了・mainへマージ済み。TrOCR Model MetadataのFrontend連携（Feature [#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25)）完了・mainへマージ済み。

**[Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）を新設し、当初ロードマップのうちTraining／Evaluation／Benchmark／Release Gateを引き継いだ。** 未着手（Phase4/6/7の一部）。

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
- [x] Engine判定既存バグ修正（Backend）実装完了・Closed（[#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11)）。Frontend側も実装完了・Closed（[#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)）
- [x] Phase2 3番目の実装Issue作成・実装完了（Model Metadata、[#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)、Closed）
- [x] Phase3 最初の実装Issue作成・実装完了（TrOCR Backend単画像推論コア、[#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16)、Closed・mainへマージ済み）
- [x] Phase4 OCR Pipelineへの接続Issue作成・実装完了（[#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18)、Closed・mainへマージ済み）
- [x] 既存OCR推論APIへのTrOCR統合Issue作成・実装完了（[#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)、Closed・mainへマージ済み）
- [x] Frontend側Engine判定修正Issue実装完了（既存Issue [#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)を使用、新規Issue作成なし。Closed・mainへマージ済み）
- [x] Frontend TrOCR選択UI追加Issue作成・実装完了（[#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)、Closed・mainへマージ済み）
- [x] TrOCR Model MetadataのFrontend連携Issue作成・実装完了（[#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25)、Closed・mainへマージ済み）
- [x] Epic #1のスコープ整理（Training/Evaluation/Benchmark/Release GateをEpic #27へ引き継ぎ）
- [x] Epic #1をClose（2026-07-31 09:21:33 JST。子Issue・完了条件すべて達成）
- [ ] Epic #27配下の実装Issue作成（[ISSUE_MAP.md](ISSUE_MAP.md)のPhase4/6/7参照: TrOCR Training/Evaluation/Benchmark/Release Gate等）
- [x] Model Metadata実運用化Epicの新規作成（[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) Unified Model Metadata Infrastructure。ModelMetadata生成/保存/Models連携/Inference連携/Evaluation連携/旧モデル管理方式からの移行。Investigation [#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)完了）

## 関連Issue

- Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) [Epic] Transformer OCR対応基盤とTrOCR統合（既存推論経路への統合完了、Closed 2026-07-31）
- Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27) [Epic] TrOCR学習・評価・Benchmark・Release Gate統合（Epic #1の後続、未着手）
- Investigation: [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) [Investigation] TrOCR採用可否とOCR Crafter統合方式の調査（Parent Epic: #1）
- Feature: [#4](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/4) [Feature] Engine Capability実装（Parent Epic: #1、実装済み）
- Feature: [#9](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/9) [Feature] Engine Registry実装（Parent Epic: #1、MVP実装済み・Closed）
- Refactor: [#11](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/11) [Refactor] Engine判定ロジックをEngine Registryへ統一（Parent Epic: #1、Backend実装済み・Closed）
- Bug: [#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12) [Bug] Frontendの未知Engine判定がPaddleOCRへ暗黙フォールバックする（Parent Epic: #1、実装済み・Closed）
- Feature: [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14) [Feature] 共通Model Metadata実装（Parent Epic: #1、実装済み・Closed）
- Feature: [#16](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/16) [Feature] TrOCR Backend単画像推論コア実装（Parent Epic: #1、実装済み・Closed）
- Feature: [#18](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/18) [Feature] OCR PipelineへTrOCR統合（Parent Epic: #1、実装済み・Closed）
- Feature: [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20) [Feature] 既存OCR推論APIへTrOCR統合（Parent Epic: #1、実装済み・Closed）
- Feature: [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23) [Feature] FrontendへTrOCR選択UIを追加（Parent Epic: #1、実装済み・Closed）
- Feature: [#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25) [Feature] TrOCR Model MetadataをFrontend推論UIへ連携（Parent Epic: #1、実装済み・Closed）

## 作業資料

- [EPIC.md](EPIC.md)（Epic #1、Closed）
- [EPIC_27_TROCR_LIFECYCLE.md](EPIC_27_TROCR_LIFECYCLE.md)（Epic #27）
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
- [FEATURE_TROCR_API_INTEGRATION.md](FEATURE_TROCR_API_INTEGRATION.md)（Feature [#20](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/20)、実装済み・Closed）
- [FEATURE_FRONTEND_ENGINE_RESOLUTION.md](FEATURE_FRONTEND_ENGINE_RESOLUTION.md)（Bug [#12](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/12)、実装済み・Closed）
- [FEATURE_TROCR_FRONTEND_UI.md](FEATURE_TROCR_FRONTEND_UI.md)（Feature [#23](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/23)、実装済み・Closed）
- [FEATURE_TROCR_MODEL_METADATA_UI.md](FEATURE_TROCR_MODEL_METADATA_UI.md)（Feature [#25](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/25)、実装済み・Closed）

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
