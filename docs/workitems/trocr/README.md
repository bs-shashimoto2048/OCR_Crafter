# TrOCR対応 Work Item

## 状態

Investigation準備中

## 目的

OCR CrafterへTransformerベースの文字認識エンジンを追加できる構成を検討し、最初の対象としてTrOCRの採用可否を判断する。

## 現在の段階

- Epic作成
- 技術調査Issue作成
- 実装前調査
- Architecture Decision準備

## 関連Issue

- Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) [Epic] Transformer OCR対応基盤とTrOCR統合
- Investigation: [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) [Investigation] TrOCR採用可否とOCR Crafter統合方式の調査（Parent Epic: #1）

## 作業資料

- [EPIC.md](EPIC.md)
- [INVESTIGATION.md](INVESTIGATION.md)
- [ARCHITECTURE_DRAFT.md](ARCHITECTURE_DRAFT.md)
- [ISSUE_MAP.md](ISSUE_MAP.md)
- [DECISION_LOG.md](DECISION_LOG.md)

## 重要な制約

- 調査完了前に本実装を開始しない
- 既存OCRエンジンを無条件に共通化しない
- TrOCR固有仕様を既存エンジンへ押し付けない
- 実装済み機能との互換性を維持する
- Dataset・Experiment・Model・Evaluation・Benchmarkとの連携可能性を確認する
