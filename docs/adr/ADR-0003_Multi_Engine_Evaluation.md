# ADR-0003: Multi-engine Evaluation Architecture

- **Status**: Proposed
- **Date**: 2026-08-03（Proposed）
- **Related Issue**: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)（Multi-engine Evaluation API Architecture） / Parent Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27) / Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46) / Design [#59](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/59)
- **Related PR**: 未マージ（Issue #61調査中）

> 本ADRはDesign Issue #61の成果物であり、調査結果の詳細は[docs/design/MULTI_ENGINE_EVALUATION_API.md](../design/MULTI_ENGINE_EVALUATION_API.md)を前提とする。PR承認後にStatusを`Proposed`→`Accepted`へ変更する予定。**現時点ではProposedのまま据え置く（実装は一切行わない）。**

## Context

現行の`POST /api/ocr/evaluate`（`src/app/services/ocr_evaluation.py::evaluate_ocr`/`build_recognizer`）はTesseract専用実装であり、PaddleOCR/EasyOCR/TrOCRを評価対象にできない。これはTrOCR固有の課題ではなく、[ADR-0001](ADR-0001_Trocr_Architecture.md)で「PaddleOCRも含む既存の積み残し」と明記された、以前からの技術的負債である。

モデル解決も、Tesseract（評価・Benchmarkで共通化済み）・PaddleOCR（評価未対応、Benchmark/Inferenceで別々に実装）・TrOCR（解決層自体が無い）という3種類に分散しており、統一されていない。Backend `EngineCapability`には`supports_evaluation`等の評価Capabilityが既に定義済みだが、実際に参照する箇所が存在しない。

## Decision

**評価処理を「共通Evaluation Loop（Runner）＋ Engine別Predictor」という構成へ一般化し、既存`POST /api/ocr/evaluate`はエンドポイントを変えずにこの一般化された内部実装のAdapterとして維持する。**

要約:

- **Architecture**: `EvaluationDispatcher`（canonical engine_id→`PredictorBuilder`の登録表）→ `EnginePredictor`（1回build・複数回`recognize(image_path)->(text, confidence|None)`）→ `EvaluationRunner`（既存の正規化・Levenshtein・CER・confusion集計ロジックをそのまま踏襲する共通処理）
- **Dispatcherのキー軸**: canonical engine_id（`tesseract`/`paddleocr`/`easyocr`/`trocr`）。Benchmarkの`ENGINE_CATALOG`が使うVariant Key軸とは意図的に分離し、混同しない
- **Custom（分類モデル）は評価対象に含めない**（テキスト認識ではないためCER評価が成立せず、backend Engine Registryにも未登録）
- **confidence/bboxは捏造しない**: 取得できないEngine（TrOCR）は`null`許可、`0.0`代用禁止。UIは`--`表示（既存`TrOCREngine`の設計原則をそのまま踏襲）
- **Model Resolution**: 統一Inference Resolverの完成を前提としない。各PredictorBuilderが既存のEngine別解決ヘルパー（`resolve_tesseract_model_meta`/`resolve_ocr_model_meta`/TrOCRの素通し）をそのまま利用する。Models API（ADR-0002）配線待ちには依存させない
- **Request/Result Schema**: 既存`OcrEvalTarget`へターゲット単位のEngine固有オプション（`psm`/`charset`等）を追加する形で拡張し、Discriminated Unionのような大きな構造変更は行わない。Result側は`evaluation_id`/タイミング/`error`（画像単位）を新設するが、既存フィールドは変更しない
- **後方互換**: 新規エンドポイントは追加しない（`POST /api/ocr/evaluate`を維持・拡張）。既存デフォルト呼び出し（Tesseractのみ2ターゲット）は変更前と同一のResponse構造を返す
- **Benchmarkとの責務境界**: 統合しない。Evaluation=1モデル×1Dataset詳細分析、Benchmark Runner=複数Variant横断比較、Benchmark Center=保存済み結果閲覧、という既存の役割分担を維持する
- **Sync/Async**: 本Phaseでは同期APIを維持する。既存の`job_type="evaluation"`非同期経路の詳細は別途調査（未決事項）

詳細な設計・比較案・Migration Planは[MULTI_ENGINE_EVALUATION_API.md](../design/MULTI_ENGINE_EVALUATION_API.md)を参照。

## Alternatives Considered

1. **Engineごとに評価処理を丸ごと個別実装**（案A）
   - 却下理由: 共通の正規化・Levenshtein・CER・confusion集計ロジックが重複し、Tesseractの既存の実証済み挙動をコピーし直す必要があり回帰リスクが高い
2. **既存`predict_from_image()`へ全面委譲**（案C）
   - 却下理由: `predict_from_image()`はInference画面向けの単発推論用に設計されており、TrOCRは呼び出しごとにモデルを再ロードする実装であるため、評価ループでの繰り返し呼び出しに適さない
3. **Benchmarkの`ENGINE_BUILDERS`をそのまま再利用**（案D）
   - 却下理由: BenchmarkはVariant Key軸（モデル取得元）で構成されており、Evaluationのcanonical engine_id軸とは異なる。契約の形（`recognize(image_path)->(text,confidence)`）は参考にするが、実装をそのまま共有すると軸の混同を招く
4. **新規`POST /api/evaluations`エンドポイントの追加**
   - 却下理由: 既存`targets`が既に多エンジン前提の構造を持つため新設の必然性が薄く、2エンドポイントの並行メンテ負担が生じる
