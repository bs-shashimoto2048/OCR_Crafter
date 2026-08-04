# [Epic] TrOCR学習・評価・Benchmark・Release Gate統合

Issue: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)

Parent: なし（[Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)の後続Epic。Epic #1は既存OCR推論経路へのTrOCR統合が完了し、Closed 2026-07-31）

**責務の範囲（2026-07-31整理）**: 本Epicは**TrOCR固有**のライフサイクル（Training/Evaluation/Benchmark/Release Gate）のみを扱う。`ModelMetadata`の既存コードへの本格配線（生成・保存・Models連携・Inference連携・Evaluation連携・旧モデル管理方式からの移行）は、TrOCRに限らない別責務のため、[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure）で扱う。本Epicの「TrOCR学習成果物の保存」は、Epic #28の決定（`ModelMetadata`経由か既存`.ocr.json`/`.tess.json`パターン踏襲か）を前提として進める。

## 背景

[Epic #1（Transformer OCR対応基盤とTrOCR統合）](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)により、TrOCRは既存OCR推論経路（OCR Pipeline / 既存OCR推論API / Frontend推論画面）へ統合済みである。

```text
Engine Registry → resolve_engine_id() → OCR Pipeline → {PaddleOCR, EasyOCR, Tesseract, TrOCR}
```

ユーザーはFrontendからTrOCRを選択し、モデル参照（Hugging Face model ID・ローカルパス、または登録済みモデルからの選択）を指定して推論を実行できる。

一方、TrOCRの**学習・評価・Benchmark比較・Release Gate（本番リリース判定）**は未着手である。Epic #1のスコープが「既存推論経路への統合」に整理されたことに伴い、これらは本Epic（Epic #27）へ引き継いだ。

## 目的

- TrOCRをOCR Crafterの学習対象へ追加できる構成を確立する
- TrOCRの評価（CER等の指標）を既存フローへ統合する
- TrOCRをBenchmark Runner/Benchmark Centerでの比較対象に含める
- TrOCRモデルをRelease Gate（Draft/Validated/Candidate/Production/Archived）の対象に含める
- 既存OCRエンジン（Tesseract/PaddleOCR/EasyOCR）の学習・評価・Benchmark・Release Gateの動作に回帰がない設計にする

## Progress

⬜ Training（`services/trocr_pipeline.py`学習Backend。Hugging Face Transformers経由、`VisionEncoderDecoderModel`+`Seq2SeqTrainer`。公式`unilm/trocr`（fairseq）は不採用。詳細は[ARCHITECTURE_DRAFT.md](ARCHITECTURE_DRAFT.md)・[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)参照）

Evaluation（評価連携の方針決定・confidence算出方法の確定。`ocr_evaluation.py`のTesseract専用制約への対応可否を含む）

```text
Evaluation
  ✅ Multi-engine Evaluation API Design
  ✅ Common Evaluation Schema
  🔧 Common Metric Calculator（実装済み・PRレビュー待ち）
  ⬜ Evaluation Dispatcher / Runner
  ⬜ Tesseract Predictor Adapter
  ⬜ PaddleOCR Predictor
  ⬜ EasyOCR Predictor
  ⬜ TrOCR Predictor
  ⬜ Multi-engine API Integration
  ⏸ Evaluation UI Integration（Backend完了後、Epic #46で再開）
  ⬜ Cleanup
```

Multi-engine Evaluation API Design（Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)、**Completed**・Closed。PR [#62](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/62)をSquash Merge・mainへ反映済み、Merge Commit: `34aea57`）。採用Architecture: 共通Evaluation Runner + Engine別Predictorへ分離、canonical engine_idによるDispatcher、Benchmark Variant Keyとは別責務として維持、既存APIを後方互換で拡張。成果物: [MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)・[ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md)。

Common Evaluation Schema実装（Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)、**Completed**・Closed。PR [#64](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/64)をSquash Merge・mainへ反映済み、Merge Commit: `4663dd0`）。`OcrEvalTarget.options`（ターゲット単位のEngine固有オプション）と、`OcrEvaluationMetrics`/`OcrEvaluationSampleResult`/`OcrEvaluationConfusion`/`OcrEvaluationResult`（後続Runnerが使う内部共通Result Schema）を実装。count系はstrict int、float系はint/floatのみ許可しbool・数値文字列・非有限値（NaN/Infinity/-Infinity）を拒否、confidenceはnullableで実測`0.0`を許可。`options`/`engine_details`のJSON serializable性はAPI Integration境界の責務、`sample_count`重複はRunnerで整合方針を確定する暫定方針のまま。既存API・Dispatcher・Predictor・Metric Calculatorは無変更（未配線）。クリーン環境ではIssue #8のみ既知の失敗として残る（無関係）。詳細は[COMMON_EVALUATION_SCHEMA_63.md](COMMON_EVALUATION_SCHEMA_63.md)参照。

Common Evaluation Metric Calculator実装（Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)、**実装済み・PRレビュー待ち**）。`src/app/services/evaluation_metrics.py`を新設し、`calculate_sample_metrics`/`calculate_evaluation_metrics`/`aggregate_confusions`を実装。CERは既存仕様どおりマイクロ平均、character_accuracyは負値許容、confusionは`from→expected`/`to→predicted`変換。`sample_count`重複は`metrics.sample_count`をCanonicalとする方針を確定。既存`ocr_evaluation.py`への配線は見送り（Tesseract Predictor Adapter Issueへ持ち越し）。詳細は[COMMON_EVALUATION_METRICS_65.md](COMMON_EVALUATION_METRICS_65.md)参照。次の実装対象はEvaluation Dispatcher / Runner。

⬜ Benchmark（Benchmark Runner/Benchmark Centerへの`ENGINE_CATALOG`/`ENGINE_BUILDERS`登録）

⬜ Release Gate（`release_gate.py`のモデル対象へTrOCRを含める）

⬜ Frontend（Training UI・Evaluation UIへのTrOCR対応。`TrainingView.jsx`の既存ドロップダウンへTrOCR選択肢を追加）

⬜ Documentation（ユーザーマニュアル・チュートリアル。学習成果物ができてから実用的な内容を書く）

**Model Metadata本格連携（ModelMetadataの生成・保存・Models/Inference/Evaluation連携・旧モデル管理方式からの移行）は、本Epicのスコープ外。[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure）の責務。** 本Epicで学習成果物の保存方式を決める際は、Epic #28の決定を前提とする（詳細は[Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)・[ISSUE_MAP.md](ISSUE_MAP.md)の「Future Work」参照）。

## 対象範囲候補

- TrOCR学習Backend
- Dataset連携
- Experiment Tracking連携
- TrOCR評価
- Benchmark Runner連携
- Benchmark Center連携
- Release Gate連携
- Training UI / Evaluation UI
- テスト
- ユーザーマニュアル・チュートリアル

## 対象外（現時点）

- PARSeq/ABINet/ViTSTR/Donut等、TrOCR以外の新規Recognitionエンジン
- 文書レイアウト解析
- 既存OCRエンジン（Tesseract/PaddleOCR/EasyOCR）の学習・評価・Benchmark・Release Gateロジックの全面再設計
- `ModelMetadata`の既存コードへの本格配線（生成・保存・Models/Inference/Evaluation連携・旧モデル管理方式からの移行。[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)の責務）

## 完了条件

- TrOCR学習が実行できる
- TrOCRモデルを保存・識別できる（保存方式は[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)の`ModelMetadata`実運用化方針、または既存`.ocr.json`/`.tess.json`パターン踏襲のいずれかに従う）
- TrOCRモデル評価が実行できる
- Datasetとの系譜を追跡できる
- Experimentとの系譜を追跡できる
- Benchmark関連画面と整合する
- Release Gateの対象に含まれる
- 既存OCRエンジンへ回帰がない
- ユーザー向けドキュメントが整備されている

## 子Issue

未作成。[ISSUE_MAP.md](ISSUE_MAP.md)のPhase4（Training/Evaluation）・Phase6（Benchmark）を参照し、順次作成する。

## 前提Epic

[Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Transformer OCR対応基盤とTrOCR統合。既存推論経路へのTrOCR統合完了、Closed）

## 関連Epic（別責務）

[Epic #28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure）。`ModelMetadata`の生成・保存・Models連携・Inference連携・Evaluation連携・旧モデル管理方式からの移行を扱う、TrOCRに限らない別責務のEpic。Investigation（[#29](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/29)）完了、Migration計画は[MODEL_METADATA_MIGRATION_PLAN.md](../../design/MODEL_METADATA_MIGRATION_PLAN.md)参照。

## 関連資料

`docs/workitems/trocr/`（Issue Map・設計ドキュメントをEpic #1と共有）
