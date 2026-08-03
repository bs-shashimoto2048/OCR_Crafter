# [Feature] Common Evaluation Schema実装

Issue: [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)（Multi-engine Evaluation API Architecture、Completed・Closed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: 作成後に追記（本ドキュメントは実装コミットと同時に作成しているため、PR作成直後に更新する）

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

## bool誤受理対策

Pydantic v2ではboolがintのサブクラスとして数値フィールドへ暗黙変換されうるため、以下で明示的に拒否した。

- `OcrEvaluationMetrics`: `sample_count`/`exact_match_count`/`exact_match_rate`/`cer`/`character_accuracy`
- `OcrEvaluationSampleResult`: `edit_distance`/`cer`/`confidence`/`duration_ms`
- `OcrEvaluationConfusion`: `count`
- `OcrEvaluationResult`: `duration_ms`/`sample_count`

実装は`field_validator(..., mode="before")`＋共通ヘルパー`_reject_bool_value()`（`isinstance(value, bool)`チェック）。`OcrEvaluationSampleResult.exact_match`は`Field(strict=True)`で文字列等の暗黙変換自体を拒否した。

## Validationのその他の判断

- `cer`: 上限を設けない（既存仕様上マイクロ平均が1を超えうるため）
- `character_accuracy`: 下限を設けない（`1-cer`のCER派生値であり、`cer>1`のとき負値になりうるため）
- `exact_match_rate`: 0〜1に制限（完全一致率は定義上この範囲に収まる）
- `engine_id`: 空文字・空白のみを拒否。`resolve_engine_id()`によるRegistry検証は行わない（Schemaは未知Engineの結果も表現できる必要があり、known/supported判定はDispatcherの責務）。既存`OcrEvalTarget.engine`と同様、trim・小文字化などの暗黙変換はしない
- `sample_count`（Result）と`metrics.sample_count`の重複: Design #61本文・本Issue双方の候補に明記されているため両方を保持し、整合チェックは後続Evaluation Runner実装Issueの責務とすることをコード内コメントに明記した

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

`tests/test_evaluation_schema.py`（新規、42テスト）。Request/Metrics/Sample/Confusion/Result/Backward Compatibilityの各カテゴリを網羅。全体テスト（`python -m pytest -q`、888件）も無修正のまま全件成功を確認済み（Issue #8等の既知の失敗は発生していない）。
