# TrOCR対応 Work Item

## 状態

Phase1（設計フェーズ）完了。ADR-0001はAccepted。Phase2（共通基盤実装）へ移行準備中

## 目的

OCR CrafterへTransformerベースの文字認識エンジンを追加できる構成を検討し、最初の対象としてTrOCRの採用可否を判断する。

## 現在の段階

- [x] Epic作成
- [x] 技術調査Issue作成
- [x] 実装前調査（Backend/Frontend現状分析・TrOCR公式仕様調査・統合方式比較）
- [x] Architecture Decision準備（[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)）
- [x] Design Documents作成（[ENGINE_CAPABILITY.md](../../design/ENGINE_CAPABILITY.md) / [ENGINE_REGISTRY.md](../../design/ENGINE_REGISTRY.md) / [MODEL_METADATA.md](../../design/MODEL_METADATA.md)）
- [x] ユーザーレビュー（Design Documents最終レビュー完了、ADR-0001をAcceptedへ変更）
- [ ] 実装Issueの作成（Phase2、[ISSUE_MAP.md](ISSUE_MAP.md)の確定順序に沿って次段階で作成）

## 関連Issue

- Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) [Epic] Transformer OCR対応基盤とTrOCR統合
- Investigation: [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) [Investigation] TrOCR採用可否とOCR Crafter統合方式の調査（Parent Epic: #1）

## 作業資料

- [EPIC.md](EPIC.md)
- [INVESTIGATION.md](INVESTIGATION.md)
- [ARCHITECTURE_DRAFT.md](ARCHITECTURE_DRAFT.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
- [DECISION_LOG.md](DECISION_LOG.md)
- [../../adr/ADR-0001_Trocr_Architecture.md](../../adr/ADR-0001_Trocr_Architecture.md)（Status: Proposed）

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
