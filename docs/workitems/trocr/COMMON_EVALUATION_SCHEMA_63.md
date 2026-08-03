# [Feature] Common Evaluation Schema実装

Issue: [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)（Multi-engine Evaluation API Architecture、Completed・Closed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: [#64](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/64)（Squash Merge済み。Squash Commit: `4663dd0`）

**状態**: **Completed**・Closed。PR #64レビュー指摘（非有限浮動小数点・数値文字列の暗黙変換）を受け、数値Validationを強化済み（後述「PR #64レビュー対応」）のうえでApprove・Squash Merge・mainへ反映済み。

## 実装Schema

対象ファイル: `src/app/schemas.py`のみ。

- `OcrEvalTarget.options: dict[str, Any]`（`default_factory=dict`）を追加。ターゲット単位のEngine固有オプション（Tesseractの`psm`/`charset`個別指定、TrOCRの`device`/`local_files_only`等）を保持する
- `OcrEvaluationMetrics`: `sample_count`/`exact_match_count`/`exact_match_rate`/`cer`/`character_accuracy`（現時点で確定している共通指標のみ。WER/Precision/Recall/F1は含めない）
- `OcrEvaluationSampleResult`: `image`/`ground_truth`/`prediction`/`exact_match`/`edit_distance`/`cer`/`confidence`/`error`/`duration_ms`
- `OcrEvaluationConfusion`: `kind`/`expected`/`predicted`/`count`（既存`ocr_evaluation.py`の`confusions`実構造`{kind,from,to,count}`をそのまま反映。`from`はPython予約語のため、`from`→`expected`、`to`→`predicted`と読み替えた。task候補の`expected`/`predicted`のみの2フィールド構造は`kind`を欠落させ既存構造から情報が失われるため採用しなかった）
- `OcrEvaluationResult`: `evaluation_id`/`engine_id`/`model_ref`/`dataset_id`/`started_at`/`finished_at`/`duration_ms`/`sample_count`/`metrics`/`samples`/`confusions`/`warnings`/`engine_details`。`engine_id`のみ必須（14章「実在しない値を必須にしない」方針を優先し、`metrics`は`default_factory=OcrEvaluationMetrics`で自動生成可能とした）

## 後方互換

- 既存`OcrEvaluateRequest`/`OcrEvalTarget`のフィールドは削除・改名・必須化していない
- 既存Frontend Payload（`frontend/src/App.jsx::runOcrEvaluation`）・既存デフォルト値（`targets`の学習前+latestペア、`charset`実運用whitelist、`psm=7`等）は無変更
- `options`は新規Optionalフィールドであり、省略時は`{}`。既存の`main.py::api_ocr_evaluate`が`t.model_dump()`で`options`キーを含むdictを`evaluate_ocr()`へ渡しても、同関数は未知キーを無視するため既存処理に影響しない（確認済み。ただし`main.py`/`ocr_evaluation.py`自体は本Issueで変更していない）
- 既存API（`POST /api/ocr/evaluate`）の`response_model`・返却dict構造は無変更

## Options方針

- 今回は`options: dict[str, Any]`を採用（Discriminated Union・Engine別Nested Schemaは今回導入しない、Design #61 10章の折衷案どおり）
- `options`内部のEngine固有Validation・Path存在確認・model load確認・network接続確認は一切行わない
- `options`を既存`charset`/`psm`より優先させる実装は行っていない（Schema層のみで、消費側=Dispatcher実装Issueの責務）
- 未知キー（将来のTrOCR用`device`/`local_files_only`等）はそのまま保持する

## confidence方針

- `OcrEvaluationSampleResult.confidence: Optional[float]`。`None`許可・未取得値を`0.0`で補完する処理は禁止・実測値`0.0`は正当な値として許可（テストで確認済み）
- 範囲制約（0〜1等）は設けていない（全Engineでの保証が確認できていないため）

## 数値Validation方針（bool誤受理対策を含む、PR #64レビュー対応で強化）

PR #64のレビューで、(1) `sample_count="5"`のような数値文字列が暗黙変換されてしまうこと、(2) `cer=inf`等の非有限浮動小数点値が拒否されないことの2点を指摘された。これを受け、対象を**今回追加した共通Result Schemaの数値項目のみ**（既存`OcrEvaluateRequest`/`OcrEvalTarget`の`psm`等は対象外）に絞り、以下のとおり強化した。

### count系（厳密なintのみ許可）

対象: `OcrEvaluationMetrics.sample_count`/`exact_match_count`、`OcrEvaluationSampleResult.edit_distance`、`OcrEvaluationConfusion.count`、`OcrEvaluationResult.sample_count`。

`Field(strict=True)`を採用。Pydantic v2のstrict intは、bool・float（`1.0`等の整数値相当も含む）・数値文字列（`"5"`等）をいずれも拒否し、`int`型の値のみを受理することを実測で確認済み。以前の`_reject_bool_value()`によるbool限定拒否（`mode="before"`のカスタムvalidator）は、この`strict=True`により完全に代替されたため削除した。

### float系（int/floatのみ許可、非有限値は拒否）

対象: `OcrEvaluationMetrics.exact_match_rate`/`cer`/`character_accuracy`、`OcrEvaluationSampleResult.cer`/`confidence`/`duration_ms`、`OcrEvaluationResult.duration_ms`。

`Field(strict=True)`によりint・floatは許可しつつbool・数値文字列を拒否（int入力はfloatへ変換される。実測で`confidence=1`→`1.0`を確認）。加えて、`strict=True`単体ではNaN/Infinity/-Infinityを拒否しない（`inf`はそのまま通過することを実測で確認）ため、`_reject_non_finite()`（`math.isfinite()`によるvalidator、`mode="after"`）を追加し、非有限値を明示的な`ValidationError`として拒否する（`null`や`0.0`への自動変換は行わない）。

維持した既存の許可値: `confidence=None`／`confidence=0.0`／`cer>1`／`character_accuracy<0`／`duration_ms=0`（いずれも実測・テストで確認済み）。

`OcrEvaluationSampleResult.exact_match`（bool）は引き続き`Field(strict=True)`で文字列等の暗黙変換を拒否する（変更なし）。

## Validationのその他の判断

- `cer`: 上限を設けない（既存仕様上マイクロ平均が1を超えうるため）
- `character_accuracy`: 下限を設けない（`1-cer`のCER派生値であり、`cer>1`のとき負値になりうるため）
- `exact_match_rate`: 0〜1に制限（完全一致率は定義上この範囲に収まる）
- `engine_id`: 空文字・空白のみを拒否。`resolve_engine_id()`によるRegistry検証は行わない（Schemaは未知Engineの結果も表現できる必要があり、known/supported判定はDispatcherの責務）。既存`OcrEvalTarget.engine`と同様、trim・小文字化などの暗黙変換はしない
- `sample_count`（Result）と`metrics.sample_count`の重複（暫定方針）: 現段階では後方互換・Runner設計前のため両方を保持する。Canonicalな値は後続Evaluation Runner Issueで決定し、Runnerが両値の整合性を保証する。API Integration前に重複解消または同期方針を確定する
- `OcrEvaluationConfusion.count`の下限（`ge=0`、0を許可する理由）: 現行`Counter`出力は通常1以上だが、共通Schemaは中間生成・空集計・将来の変換処理も表現できるよう0を許可する。負値は許可しない
- `options`/`engine_details`（`dict[str, Any]`）のJSON serializable性: **Schemaは構築時にJSON serializable性を検証しない**（Engine固有情報を保持する責務のみを持つ）。非JSON serializable値の拒否・変換はAPI Integration／Persistence境界の責務とし、Schema利用者はJSON互換値を渡すことを前提とする。任意Pythonオブジェクトの検査を共通Schemaへ持ち込まない（構築時は無検証で保持し、実際のシリアライズ時に初めて失敗することを実測で確認済み）
- クリーン環境でのIssue #8: `outputs/app.db`を実際に退避（move）したクリーン環境相当では、本PRとは無関係な既知の失敗（`tests/test_dataset_registry.py::test_register_ocr_model_records_dataset_lineage`、`sqlite3.OperationalError: no such table: training_jobs`）が引き続き残る。本Issueでは修正しない（Scope外）

## 未実装範囲（Scope外）

- Evaluation Runner
- Common Metric Calculator（`_normalize_compare`/`levenshtein_ops`等の抽出）
- Evaluation Dispatcher
- Engine別Predictor（Tesseract/PaddleOCR/EasyOCR/TrOCR）
- `POST /api/ocr/evaluate`のAPI接続変更（`response_model`設定含む）
- `src/app/main.py`・`src/app/services/ocr_evaluation.py`・`frontend/`の変更
- TrOCR評価実装
- Evaluation UI変更
- Benchmark変更

## 次のIssue

Common Metric Calculator（既存`ocr_evaluation.py`の`_normalize_compare`/`levenshtein_ops`/集計ロジックの抽出。本Schemaを入出力として使用する）

## テスト

`tests/test_evaluation_schema.py`（88テスト。初回実装時42件＋PR #64レビュー対応で46件追加：非有限値拒否／数値文字列拒否／型境界／JSON serialization／Confusion変換意図）。Request/Metrics/Sample/Confusion/Result/Backward Compatibilityの各カテゴリを網羅。

全体テストの結果は環境によって異なる。**既存`outputs/app.db`が残るローカル環境では888件（Schema分の増分88件を含む）全件成功**するが、**`outputs/app.db`を実際に退避したクリーン環境相当では、本PRと無関係な既知の失敗（Issue #8、`test_dataset_registry.py::test_register_ocr_model_records_dataset_lineage`）が1件残る**（CIのbackend Checkと一致）。「クリーン環境でも全件成功」という表現はしない。
