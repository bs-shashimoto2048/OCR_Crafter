# TrOCR対応 Decision Log

Related Issue: Investigation [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2) / Parent Epic [#1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)

## ADR-0001 TrOCR統合方式

正式なADRは [docs/adr/ADR-0001_Trocr_Architecture.md](../../adr/ADR-0001_Trocr_Architecture.md) を参照（本ファイルは要約のみ）。

- Status: **Accepted**（2026-07-29、Design Documentsレビュー完了により決定）
- Date: 2026-07-28
- Related Issue: [#2](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/2)
- Decision: 案C（Engine Capability導入 + 限定Adapter）を提案。既存3エンジンの分岐は変更せず、TrOCR専用モジュール（`services/trocr_pipeline.py`）を新設し、学習はHugging Face Transformers経由（`VisionEncoderDecoderModel`+`Seq2SeqTrainer`）とする
- Context: 既存4画面・5箇所のエンジン分岐は統一されたFactory/Registryを持たない。唯一の例外は`benchmark.py`の`ENGINE_BUILDERS`
- Considered Options: 案A（既存分岐拡張）／案B（Recognizer Adapter統一）／案C（採用）／案D（専用Backend）
- Rationale: 既存エンジンへの回帰リスクが低く、既存の実証済みAdapterパターンを再利用でき、既存の欠陥（PaddleOCRキャッチオール）も同時に是正できるため
- Consequences: `trocr_pipeline.py`新設・`ENGINE_BUILDERS`拡張・`engineLabelOf()`等3箇所の修正が後続実装Issueとして必要
- Compatibility: Dataset/Experiment/Benchmark Centerはengine非依存のため変更不要。Model/Frontendの一部（エンジン判定ロジック）は修正が必要
- Follow-up Issues: [ISSUE_MAP.md](ISSUE_MAP.md)のPhase1〜7構成（Phase2実装Issue候補11件を確定済み。レビュー後にGitHub Issue化）
