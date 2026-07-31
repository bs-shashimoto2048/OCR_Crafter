# [Epic] TrOCR学習・評価・Benchmark・Release Gate統合

Issue: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)

Parent: なし（[Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)の後続Epic。Epic #1は既存OCR推論経路へのTrOCR統合が完了し、Close済み/Close可能な状態）

## 背景

[Epic #1（Transformer OCR対応基盤とTrOCR統合）](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)により、TrOCRは既存OCR推論経路（OCR Pipeline / 既存OCR推論API / Frontend推論画面）へ統合済みである。

```text
Engine Registry → resolve_engine_id() → OCR Pipeline → {PaddleOCR, EasyOCR, Tesseract, TrOCR}
```

ユーザーはFrontendからTrOCRを選択し、モデル参照（Hugging Face model ID・ローカルパス、または登録済みモデルからの選択）を指定して推論を実行できる。

一方、TrOCRの**学習・評価・Benchmark比較・Release Gate（本番リリース判定）**は未着手である。Epic #1のスコープが「既存推論経路への統合」に整理されたことに伴い、これらは本Epic（Epic #2）へ引き継いだ。

## 目的

- TrOCRをOCR Crafterの学習対象へ追加できる構成を確立する
- TrOCRの評価（CER等の指標）を既存フローへ統合する
- TrOCRをBenchmark Runner/Benchmark Centerでの比較対象に含める
- TrOCRモデルをRelease Gate（Draft/Validated/Candidate/Production/Archived）の対象に含める
- 既存OCRエンジン（Tesseract/PaddleOCR/EasyOCR）の学習・評価・Benchmark・Release Gateの動作に回帰がない設計にする

## Progress

⬜ Training（`services/trocr_pipeline.py`学習Backend。Hugging Face Transformers経由、`VisionEncoderDecoderModel`+`Seq2SeqTrainer`。公式`unilm/trocr`（fairseq）は不採用。詳細は[ARCHITECTURE_DRAFT.md](ARCHITECTURE_DRAFT.md)・[ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md)参照）

⬜ Evaluation（評価連携の方針決定・confidence算出方法の確定。`ocr_evaluation.py`のTesseract専用制約への対応可否を含む）

⬜ Benchmark（Benchmark Runner/Benchmark Centerへの`ENGINE_CATALOG`/`ENGINE_BUILDERS`登録）

⬜ Release Gate（`release_gate.py`のモデル対象へTrOCRを含める）

⬜ Frontend（Training UI・Evaluation UIへのTrOCR対応。`TrainingView.jsx`の既存ドロップダウンへTrOCR選択肢を追加）

⬜ Model Metadata本格連携（学習成果物の保存形式の確定。Epic #1のFuture Workで確認済みのとおり、`ModelMetadata`dataclassは実運用で未使用のため、本Epicで学習を実装する際に保存方式を判断する必要がある。既存`.ocr.json`/`.tess.json`パターンを踏襲するか、`ModelMetadata`経由にするかを最初に決定する）

⬜ Documentation（ユーザーマニュアル・チュートリアル。学習成果物ができてから実用的な内容を書く）

## 対象範囲候補

- TrOCR学習Backend
- Dataset連携
- Experiment Tracking連携
- TrOCR評価
- Benchmark Runner連携
- Benchmark Center連携
- Release Gate連携
- Training UI / Evaluation UI
- Model Metadataの学習成果物への適用
- テスト
- ユーザーマニュアル・チュートリアル

## 対象外（現時点）

- PARSeq/ABINet/ViTSTR/Donut等、TrOCR以外の新規Recognitionエンジン
- 文書レイアウト解析
- 既存OCRエンジン（Tesseract/PaddleOCR/EasyOCR）の学習・評価・Benchmark・Release Gateロジックの全面再設計

## 完了条件

- TrOCR学習が実行できる
- TrOCRモデルを保存・識別できる（Model Metadataまたは新形式）
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

[Epic #1](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/1)（Transformer OCR対応基盤とTrOCR統合。既存推論経路へのTrOCR統合完了）

## 関連資料

`docs/workitems/trocr/`（Issue Map・設計ドキュメントをEpic #1と共有）
