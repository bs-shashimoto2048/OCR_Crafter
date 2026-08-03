# [Design] Multi-engine Evaluation API Architecture

Issue: [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46) / Design [#59](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/59) / [docs/EVALUATION_UI_GENERALIZATION.md](../../EVALUATION_UI_GENERALIZATION.md) / [ADR-0001](../../adr/ADR-0001_Trocr_Architecture.md) / [ADR-0002](../../adr/ADR-0002_Unified_Model_Metadata.md) / [ADR-0003（Proposed）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)（本Issueの主成果物）

**本Issueは調査・設計のみ。実装は一切行わない。**

## 調査範囲

- Backend: `src/app/services/ocr_evaluation.py`（現行Evaluation API本体）・`src/app/main.py`（エンドポイント定義）・`src/app/schemas.py`（Request Schema）・`src/app/services/benchmark.py`（Benchmarkの`ENGINE_CATALOG`/`ENGINE_BUILDERS`）・`src/app/services/trocr_engine.py`（TrOCR推論コア）・`src/app/predict.py`（PaddleOCR/EasyOCR/TrOCR/Custom推論経路）・`src/app/services/engine_registry.py`・`src/app/services/engine_capability.py`・`src/app/services/model_metadata.py`・`src/app/services/model_catalog.py`・`src/app/services/models_api.py`
- Frontend（Backendが返すべき情報を確認する目的に限定。変更なし）: `frontend/src/views/OcrEvaluationView.jsx`・`BenchmarkView.jsx`・`BenchmarkCenterView.jsx`・`frontend/src/App.jsx`
- Documents: `docs/EVALUATION_UI_GENERALIZATION.md`・ADR-0001・ADR-0002・`docs/design/TROCR_BACKEND.md`・`docs/design/ENGINE_CAPABILITY.md`・`docs/design/ENGINE_REGISTRY.md`・`docs/ENGINE_REGISTRY_DESIGN.md`・`docs/BENCHMARK_ENGINE_REGISTRY_DESIGN.md`・`docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`・`ISSUE_MAP.md`
- Tests: `tests/test_cer_metrics.py`・`tests/test_evaluate_preprocess.py`・`tests/test_tesseract_e2e.py`・`tests/test_evaluation_dataset.py`・`tests/test_e2e_uat.py`（Job経由の評価呼び出し）

## 調査結果（要旨）

詳細は[docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)を参照。ここでは特に重要な発見のみ記す。

- `POST /api/ocr/evaluate`は同期・`response_model`無しの素の`dict`返却。`OcrEvalTarget.engine`は既に「エンジン別ペアのリスト」という多エンジン前提の構造を持つが、`build_recognizer()`（`ocr_evaluation.py:133-140`）がTesseract以外を`ValueError`で拒否する単一分岐であり拡張ポイントが無い
- `charset`/`psm`がRequest全体で1つしかなく、ターゲットごとのEngine固有オプションを表現できないことが、多エンジン化の実質的なボトルネックの一つ
- CER・Character Accuracy・Exact Match Rate・confusion集計・char_statsは**共通化可能**（正規化・Levenshtein計算はエンジン非依存の純粋関数であることをテスト・実装の両方で確認）。WER/Precision/Recall/Confidence集計・処理時間計測は**未実装**
- PaddleOCR/EasyOCRは推論経路（`predict.py`）・confidence取得ともに既に存在し、評価未対応は「配線されていないだけ」（Benchmarkは同じ推論経路を既に再利用している）
- TrOCRはconfidence/bboxを意図的に持たない設計（捏造しない方針が`trocr_engine.py`で既に確立済み）。単一画像推論のみ、バッチ未実装。`TrOCREngine.load()`は「1回load・複数回predict」の再利用を前提に設計されているが、現行`predict.py::_predict_with_trocr()`は毎回reloadする実装であり、この呼び出しパターンをそのまま評価ループへ転用してはならない
- Custom（分類モデル）はテキスト認識ではなくbackend Engine Registry未登録のため評価対象外とする
- Backend `EngineCapability`には`supports_evaluation`等の評価Capabilityが既に定義済み（`engine_capability.py:80-86`）だが、参照箇所が存在しない未消費の設計——新Dispatcherがこれを消費する最初の実装になる
- モデル解決はTesseract（評価/Benchmarkで共通化済み）・PaddleOCR（Benchmark/Inferenceで別々に重複実装）・TrOCR（解決層無し）の3種類バラバラ。統一Inference Resolverは存在せず、Models API（ADR-0002）もHTTPエンドポイント未配線
- `POST /api/jobs`に`job_type="evaluation"`という既存の非同期実行経路が存在することを`tests/test_e2e_uat.py`から確認したが、内部実装（`job_runner.py`側）は本Issueの調査範囲外——実装Issューでの確認事項として残す

## Design Decision

- Architecture: `EvaluationDispatcher`（canonical engine_id軸）→`EnginePredictor`（build-once, recognize多数回）→`EvaluationRunner`（既存の共通集計ロジックをそのまま踏襲）を採用（案B）。Engineごと全体実装（案A）・`predict_from_image()`全面委譲（案C）・Benchmark Engine Builder直接再利用（案D）は不採用（理由は設計doc5章参照）
- Dispatcherのキーはcanonical engine_id。Benchmarkの`ENGINE_CATALOG`のVariant Keyとは意図的に分離し混同しない
- Request Schema: `OcrEvalTarget`へターゲット単位のEngine固有オプションを追加する折衷案を採用。Discriminated Union・新規エンドポイントは不採用
- Result Schema: `evaluation_id`/タイミング/`error`（画像単位）を新設。`confidence`は`null`許可・捏造禁止・`0.0`代用禁止の既存原則をそのまま踏襲
- Model Resolution: 統一Inference Resolverの完成を前提としない。各PredictorBuilderが既存のEngine別解決ヘルパーを使う
- 後方互換: 既存`POST /api/ocr/evaluate`を維持・拡張する（案1+案3の組み合わせ、新規エンドポイント案2は不採用）
- Benchmarkとの責務境界: 統合しない（既存方針の再確認）
- Sync/Async: 本Phaseは同期維持。非同期化判断は`job_runner.py`調査後に別途決定

## 未決事項

- `POST /api/jobs`の`job_type="evaluation"`経路の内部実装詳細
- `benchmark.py`側のMetric計算ロジックとの共有可能性
- `image_dir`/`gt_csv`の既存Path traversal対策の有無
- Hugging Face Hub認証・プライベートモデル対応の要否
- 評価結果の永続化方式（`evaluation_id`の払い出し・保存先）

## 提案Issue分割

1. Evaluation Schema（`OcrEvalTarget`へのオプション追加、Result Schemaの新規フィールド）
2. Common Metric Calculator（既存`_normalize_compare`/`levenshtein_ops`/集計ロジックの抽出）
3. Evaluation Dispatcher（`EvaluationDispatcher`本体、`UnsupportedEvaluationEngineError`等）
4. Tesseract Evaluator Adapter（既存`_build_tesseract_recognizer`のAdapter化、動作無変更が受け入れ条件）
5. PaddleOCR Evaluator（既存`predict.py`/`benchmark.py`の推論経路を再利用）
6. EasyOCR Evaluator（PaddleOCRと同時、またはその直後）
7. TrOCR Evaluator（build-once Predictor、confidence/bbox無し）
8. Multi-engine Evaluation API（既存エンドポイントをDispatcherへ接続、後方互換の直接検証）
9. Evaluation Job化の検討（`job_type="evaluation"`経路の調査結果次第で要否決定）
10. OcrEvaluationView Generalization（Epic #46側、Backend安定後に着手）
11. Cleanup（Benchmark `ENGINE_BUILDERS`との重複解消検討）

task.md提示の初期候補（Evaluation Job化または同期継続、を1項目として想定）を、調査結果（既存Job経路の存在確認）に基づき「9. Evaluation Job化の検討」として独立させ、PaddleOCR/EasyOCRを別項目（5・6）に分離した点が変更点。

## Scope外

- Productionコード変更
- Testコード変更
- Dependency変更
- API追加・変更（実装）
- Evaluation Dispatcher実装
- Evaluator実装
- TrOCR評価実装
- `OcrEvaluationView.jsx`変更
- Benchmark変更
- Engine Registry変更
- Models API変更
- Inference Resolver実装
- DB変更
- CSS変更
