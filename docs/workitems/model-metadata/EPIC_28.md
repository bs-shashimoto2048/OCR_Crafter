# [Epic] Unified Model Metadata Infrastructure

Issue: [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)

Related: [Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Transformer OCR対応基盤とTrOCR統合、Closed）/ [Epic #27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

## 背景

- `ModelMetadata` dataclass（Feature [#14](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/14)）は既に実装されている
- しかし実コードへは一切配線されていない（`model_metadata.py`自身以外のどこからも参照されない）
- モデルに関する情報の保存方式は、現時点で複数（`.ocr.json`/`.tess.json`/`.pt`/`inference_model.json`/`releases.json`/実験カルテ/Frontend localStorage等）が独立して存在しており、統一されていない
- 将来的なTraining/Evaluation/Inference/Deploymentのすべてで、統一されたMetadata基盤が必要になる

本Epicは、Epic #27（TrOCR固有のTraining/Evaluation/Benchmark/Release Gate）とは責務が異なる、**Engine横断・Metadata基盤そのもの**を扱う独立したEpicとして管理する。

## 最終ゴール

Model MetadataをSingle Source of Truthとする。

```text
Training
    ↓
Metadata生成
    ↓
Metadata保存
    ↓
Models
Inference
Evaluation
Deployment
Export
```

すべて同一Metadataを利用する。

## 完了条件

- Metadata生成
- Metadata保存
- Models利用
- Inference利用
- Evaluation利用
- Deployment利用
- Export利用
- 旧管理方式整理
- ドキュメント更新

## Scope外

以下はEpic #27で扱う。

- OCR学習アルゴリズム
- 評価ロジック
- Benchmark
- Release Gate

（Metadataの保存・利用の統一自体は本Epicの責務。上記はTrOCR固有のアルゴリズム・ロジックそのものを指す）

## 調査結果サマリー（Investigation #29、2026-07-31完了）

モデルに関する情報は、単一のSource of Truthではなく、最低6つの独立した永続化機構（モデル別メタデータファイル/推論使用モデル選択/Release状態レジストリ/実験カルテ/Frontend localStorageの評価履歴・エイリアス）に分散していることを確認した。Engine判定ロジックも`resolve_engine_id()`経由の箇所と、`release_gate.py::_model_engine()`の独自拡張子判定の箇所が併存している。詳細・Migration戦略・提案Issue構成・リスクは[MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)を参照。

## 提案Issue構成（Investigation #29の成果物より）

1. Investigation（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)、完了）
2. Architecture（Adapter設計・保存先決定）
3. Metadata生成
4. Metadata保存
5. Models連携
6. Inference連携
7. Evaluation連携
8. Deployment連携
9. Cleanup（旧管理方式整理）

## 子Issue

- [x] Investigation: Model Metadata実運用化の影響調査（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)、**Closed**）
- [ ] Architecture: Unified Model Metadata Adapterと段階的移行方式を設計（[#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)、設計中）

## Progress

- [x] Investigation（#29、Closed。調査結果は[INVESTIGATION_29.md](INVESTIGATION_29.md)参照）
- Architecture + ADR: 🔶 設計完了・PRレビュー待ち（[#30](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/30)、[ARCHITECTURE_30.md](ARCHITECTURE_30.md)）
- 後続（Metadata生成/保存/Models連携/Inference連携/Evaluation連携/Deployment連携/Cleanup）: 未着手（Architecture決定後にIssue化）

## 関連資料

- [MODEL_METADATA.md](../../design/MODEL_METADATA.md)
- [MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)（Investigation成果物）
- [MODEL_METADATA_ARCHITECTURE.md](../../design/MODEL_METADATA_ARCHITECTURE.md)（Architecture #30成果物）
- [ADR-0002_Unified_Model_Metadata.md](../../adr/ADR-0002_Unified_Model_Metadata.md)（Status: Proposed）
- [ISSUE_MAP.md](ISSUE_MAP.md)（本Epic配下のIssue一覧）
