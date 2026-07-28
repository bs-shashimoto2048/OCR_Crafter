# TrOCR対応 Issue Map

Related Issue: Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) / Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)

## 現在作成するIssue

- Epic: [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1) Transformer OCR対応基盤とTrOCR統合
- Investigation: [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) TrOCR採用可否とOCR Crafter統合方式の調査（Parent Epic: #1）

## 調査完了後に作成を検討するIssue

以下は仮の分割案であり、まだGitHub Issueを作成しない。

1. Engine Capability設計
2. Recognizer共通インターフェース
3. TrOCR依存関係・設定管理
4. TrOCR Dataset Adapter
5. TrOCR学習Backend
6. TrOCR推論Backend
7. TrOCR評価連携
8. Experiment Tracking連携
9. Model metadata・永続化
10. Model Manager UI
11. Training UI
12. Evaluation UI
13. Benchmark Runner連携
14. Benchmark Center連携
15. Backendテスト
16. Frontendテスト
17. ユーザーマニュアル
18. チュートリアル
19. リリース・移行確認

## 分割ルール

- 1 Issue = 1つの明確な完了条件
- 調査と実装を同じIssueへ混在させない
- BackendとFrontendを無条件に同一Issueへまとめない
- 共通基盤とTrOCR固有処理を区別する
- ドキュメントを最後の巨大Issueへまとめすぎない
- 既存機能の変更は回帰テストを含める
