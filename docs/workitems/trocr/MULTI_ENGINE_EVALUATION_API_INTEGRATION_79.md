# [Feature] Multi-engine Evaluation API Integration

Issue: [#79](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/79)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61) / Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)（Common Evaluation Schema、Completed） / Feature [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)（Common Evaluation Metric Calculator、Completed） / Feature [#67](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/67)（Evaluation Dispatcher、Completed） / Feature [#69](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/69)（Evaluation Runner、Completed） / Feature [#71](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/71)（Tesseract Evaluation Predictor Adapter、Completed） / Feature [#73](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/73)（PaddleOCR Evaluation Predictor、Completed） / Feature [#75](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/75)（EasyOCR Evaluation Predictor、Completed） / Feature [#77](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/77)（TrOCR Evaluation Predictor、Completed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: [#80](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/80)（Open・レビュー待ち）

**状態**: Implemented, PR review pending。

## 最重要原則

本Featureの目的は「既存`POST /api/ocr/evaluate`を書き直すこと」ではない。既存Tesseract
挙動を1バイトも変えず、これまで`ValueError`で拒否されていた非Tesseractエンジンの評価
リクエストだけを、既存の`EvaluationDispatcher`/`EvaluationRunner`/4つのEvaluation
Predictorへ橋渡しする。

## 1. 既存API調査【最重要】

`POST /api/ocr/evaluate`（`main.py::api_ocr_evaluate`）を実コードで完全に追跡した結果、
以下の契約を確認した。

| 項目 | 事実 |
| --- | --- |
| Endpoint | `main.py::api_ocr_evaluate(req: OcrEvaluateRequest, request: Request) -> dict[str, Any]` |
| Request Schema | `OcrEvaluateRequest`（`project_id`/`image_dir`/`gt_csv`/`targets: list[OcrEvalTarget]`/`charset`/`psm`/`eval_preprocess`/`preprocess_source`/`preprocess_mode`）。`OcrEvalTarget`は`engine`/`model`/`options`（未使用の予約フィールド） |
| Response Schema | `response_model`指定なし。`evaluate_ocr()`が返す素の`dict`をそのまま返す |
| Core関数 | `ocr_evaluation.py::evaluate_ocr()`。Tesseract専用のモノリシック実装 |
| Model resolution | `build_recognizer()`が`engine != "tesseract"`を`ValueError`で拒否する単一`if`分岐（他Engineへ到達不可） |
| Tesseract legacy path | `_build_tesseract_recognizer()`→`tesseract_pipeline.py::recognize_line()`。base/trained判定・`training_preprocess`メタデータ収集を含む |
| preprocessing | `resolve_evaluation_preprocess_plan()`でtarget横断の共有前処理plan（none/manual/training/training_individual）を決定。`training`系はTesseract学習後モデルの`training_preprocess`メタデータに依存する概念 |
| dataset/sample取得 | `_read_gt_csv()`（正解CSV読込）・`_resolve_image()`（画像パス解決） |
| error handling | `FileNotFoundError`→404 / `ValueError`→400 / `RuntimeError`→400（`main.py`） |
| response構造 | `targets[]`（target単位summary：total/correct/accuracy/cer/confusions/mismatches等）＋`rows[]`（画像単位、target横断の`results[]`）＋`comparison`（base/trained 2モデル比較。base・trainedが両方揃う場合のみ） |

**重要な発見**: 既存呼び出し元は必ず`engine="tesseract"`のみを指定する（他Engine指定は
既存コードで既に`ValueError`→HTTP 400になっていたため、他Engineを指定するリクエストは
そもそも存在し得なかった）。この事実が、今回の統合方式（2章）の安全性の根拠となる。

## 2. 新Evaluation基盤の再確認

`EvaluationDispatcher`（Issue #67）・`EvaluationRunner`（Issue #69）・`EnginePredictor`
Protocol・`PredictionResult`（`evaluation_types.py`）・4つのPredictor
（Tesseract/PaddleOCR/EasyOCR/TrOCR）の契約はいずれも無変更のまま利用した。Capability実値:

```text
tesseract = True
paddleocr = True
easyocr  = True
trocr    = True
custom   = Registry未登録（Unknown）
```

## 3. API統合方式（実コード調査の結果として決定）

```text
POST /api/ocr/evaluate
        ↓
全targetがengine="tesseract"か？
        ├─ Yes → evaluate_ocr()（既存実装、1バイトも変更しない）
        └─ No  → run_multi_engine_evaluation()（新規、本Issue）
                        ↓
                  target単位で EvaluationDispatcher（新規生成）→ build_predictor() → EnginePredictor
                        ↓
                  target単位で EvaluationRunner.run()
                        ↓
                  OcrEvaluationResult → legacy風の応答shapeへ変換
```

**この分岐は既存の呼び出し元に対して完全に後方互換である。** 既存の呼び出し元は1章の
発見のとおり100%`engine="tesseract"`のみであるため、既存の全呼び出しは無条件に
`evaluate_ocr()`（無変更）を通り、応答は1バイトも変わらない。`else`側は、これまで
到達不可能だった経路（新規capability）であり、既存の後方互換に一切影響しない。

**「mixed tesseract + 非tesseract」リクエストの扱い**: target集合に1つでも非Tesseract
エンジンが含まれる場合、Tesseract targetを含む**target集合全体**を新経路（Dispatcher/
Runner経由、`TesseractEvaluationPredictor`使用）で処理する。2つの異なる集計ロジックを
1レスポンス内に併存させる複雑さを避けるための意図的な単純化であり、
`TesseractEvaluationPredictor`は既存`build_recognizer()`＋`recognize_line()`と出力が
完全一致することをIssue #71で検証済みのため、退行リスクはない。

## 4. Composition Root

Predictorは**API requestごと**に、実際にリクエストされたtargetの分だけ構築する
（`src/app/services/evaluation_multi_engine.py::build_predictor()`）。グローバルな
mutable Registry・プロセス全体で共有するSingletonは新設していない。

- `EvaluationDispatcher`もtargetごとに個別インスタンスを生成する（同一engine_idで
  異なるmodel/optionsを指定した複数targetを同時に扱うため。単一Dispatcherへ複数
  Predictorを同一engine_idで`register()`すると2件目以降が`EvaluationDispatcherError`
  になる既存制約を回避するための意図的な設計）
- 各Predictorのbuild-once契約は保持される: targetあたり1回だけ構築し、そのtargetの
  全Sample（評価対象画像全件）で同一インスタンスを再利用する（`EvaluationRunner.run()`
  が`resolve()`をRunあたり1回だけ呼ぶ既存契約をそのまま利用。テストで実測確認済み）
- **Predictor構築より前に、全targetのengineを`validate_engine_supported()`で検証する**
  （Unknown/Unsupportedなtargetが1つでもあれば、他target用の重量Predictor（TrOCR/
  PaddleOCR等）を無駄にロードしない。テストで確認済み）

## 5. engine / model_ref / options

Requestから以下を解決する。

| Field | 解決方法 |
| --- | --- |
| `engine` | `OcrEvalTarget.engine`（既存フィールド、変更なし） |
| `model_ref` | `OcrEvalTarget.model`（既存フィールド、変更なし） |
| `project_id` | `OcrEvaluateRequest.project_id`（既存フィールド、変更なし） |
| PSM/whitelist（Tesseract） | `OcrEvalTarget.options.get("psm"/"charset")`。未指定時はRequestレベルの`psm`/`charset`（既存の後方互換フォールバック） |
| languages（EasyOCR） | `OcrEvalTarget.options.get("languages")` |
| language/use_angle_cls（PaddleOCR） | `OcrEvalTarget.options.get("language"/"use_angle_cls")` |
| device/local_files_only（TrOCR） | `OcrEvalTarget.options.get("device"/"local_files_only")` |

**既存APIに存在しないRequest fieldは追加していない。** `OcrEvalTarget.options`は
Issue #63で既に追加済みの予約フィールドであり（docstring: 「ターゲット単位のEngine固有
オプション」）、legacy `build_recognizer()`はこれを一切読まない（未使用のまま）。今回、
初めてこのフィールドを実際に消費する経路を追加したが、Schema自体は変更していない。

## 6. Legacy Tesseract互換性【最重要】

`ocr_evaluation.py`は**1行も変更していない**（`evaluate_ocr()`・`build_recognizer()`・
`_build_tesseract_recognizer()`・`resolve_evaluation_preprocess_plan()`いずれも無変更）。
全targetがtesseractのリクエストは無条件に既存`evaluate_ocr()`を呼ぶため、base model・
trained model・PSM・whitelist・preprocessing・dataset selection・output・error semantics
は全て既存のまま1バイトも変わらない（テストで確認: `test_all_tesseract_targets_route_to_legacy_evaluate_ocr`・
`test_legacy_path_error_mapping_unchanged`）。

## 7. preprocessing方針（実コード調査の結果として再判断）

既存`evaluate_ocr()`内の`_prepare_eval_input()`は、前処理plan適用後に必ず
`preprocess_ocr_image(..., image_shape=[1, 48, 320])`（Tesseract CRNN学習パイプライン
向けの固定canvas正規化）を通す。これは各Predictor Issue（#71/#73/#75/#77）が明記した
契約「Predictorは前処理を一切実行しない」の「前処理」がTesseract固有の入力整形を意味
しているとは考えにくく、他Engineへ強制するのはPredictorへengine非依存前処理を押し込む
ことになる。

したがって、新経路では**`preprocess_ocr_image()`によるTesseract固有の入力整形を一切
行わない**。評価前処理は以下の2モードのみをサポートする。

- `none`（既定）: 画像を一切加工せず、解決済みの元画像パスをそのままPredictorへ渡す
- `manual`: 既存`preprocess.py::apply_eval_preprocess()`（grayscale/binarize、Engine
  非依存の単純な画像変換）のみを適用し、一時ファイルへ保存してPredictorへ渡す

`training`/`training_individual`モードは、Tesseract学習後モデルの`training_preprocess`
メタデータに依存する概念であり他Engineには存在しないため、非Tesseractエンジンを含む
リクエストでは明示的に`ValueError`で拒否する（Scope外、Future Work）。

## 8. Response

既存`OcrEvaluationResult`（Pydantic Schema、Issue #63）はそのまま返さず、`targets[]`/
`rows[]`/`comparison`という既存応答のキー命名にできるだけ寄せた辞書へ変換する（新しい
Response DTOは追加していない）。`OcrEvaluationResult.metrics`/`.samples`/`.confusions`/
`.warnings`/`.engine_details`から、legacy `targets_summary`と同じキー（total/correct/
accuracy/accuracy_percent/cer/cer_percent/char_accuracy/confusions/confusions_full/
mismatches）を導出する。`comparison`は base/trained概念がEngine横断では一般化しない
ため、本Issueでは常に`None`とする（Future Work）。

## 9. Error mapping

| 例外 | HTTP | 備考 |
| --- | --- | --- |
| `FileNotFoundError` | 404 | 既存と同じ |
| `ValueError` | 400 | 既存と同じ（`training`モード拒否・空Dataset等） |
| `RuntimeError` | 400 | 既存と同じ |
| `UnknownEvaluationEngineError` / `UnsupportedEvaluationEngineError` / `EvaluationDispatcherError` | 400 | 新規追加（`main.py`に`except EvaluationDispatcherError`を追加。3例外はいずれもこの基底クラスのサブクラス） |

Sample単位の推論失敗は`EvaluationRunner`の既存Sample Failure Boundaryで隔離され、
`rows[].results[].error`へ格納されるのみで、Run全体のHTTP errorへは変換されない
（テストで確認: `test_sample_inference_failure_isolated`）。

## 10. API未配線状態の終了条件

本Issue完了時点で、実際のAPI request（`POST /api/ocr/evaluate`のtargetに
`engine="paddleocr"/"easyocr"/"trocr"`を指定）から4 Built-in EnginesをDispatcher/
Runner経由で選択できる状態を達成した。

## Scope外（本Issueでは行わない）

- Evaluation UI変更（`frontend/`は無変更）
- Benchmark変更
- Job化
- DB schema変更
- Issue #8修正
- TrOCR学習変更
- `comparison`（base/trained比較）のEngine横断一般化（Future Work）
- Mixed-engineリクエストにおける`training`/`training_individual`前処理モード対応（Future Work）

## テスト

- `tests/test_evaluation_multi_engine.py`（新規21テスト）: Composition Root
  （`validate_engine_supported`/`build_predictor`）とOrchestration
  （`run_multi_engine_evaluation`）の単体テスト。4エンジン分のfake Predictorクラスを
  本モジュールの名前空間で差し替え、実OCRエンジン・実モデル・network・GPUに依存しない。
- `tests/test_api_evaluation_integration.py`（新規10テスト）: Router層の分岐ロジック
  （全tesseract→legacy / 非tesseract含む→新経路）とError mapping。
- 既存`tests/test_evaluate_preprocess.py`・`test_evaluation_dataset.py`・
  `test_preprocess_snapshot.py`・`test_tesseract_charset.py`・`test_tesseract_e2e.py`・
  `test_e2e_uat.py`（`evaluate_ocr`/`ocr_evaluation.py`に触れる既存テスト群）は無修正の
  まま全件成功を確認済み。

## Production変更範囲

新規:

- `src/app/services/evaluation_multi_engine.py`
- `tests/test_evaluation_multi_engine.py`
- `tests/test_api_evaluation_integration.py`

最小限の既存ファイル変更:

- `src/app/main.py`（`api_ocr_evaluate()`へ分岐ロジック追加。import追加。既存の
  `evaluate_ocr()`呼び出し自体は無変更のまま維持）

`src/app/services/ocr_evaluation.py`・`src/app/services/evaluation_runner.py`・
`src/app/services/evaluation_dispatcher.py`・`src/app/services/evaluation_metrics.py`・
`src/app/services/evaluation_types.py`・4つのEvaluation Predictor・
`src/app/services/engine_capability.py`・`src/app/schemas.py`・`frontend/`はいずれも
無変更。
