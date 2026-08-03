# [Feature] Common Evaluation Metric Calculator

Issue: [#65](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/65)

Parent Epic: [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合）

Related: Design [#61](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/61)（Multi-engine Evaluation API Architecture、Completed・Closed） / Feature [#63](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/63)（Common Evaluation Schema、Completed・Closed） / [ADR-0003（Accepted）](../../adr/ADR-0003_Multi_Engine_Evaluation.md) / [docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md)

PR: 作成後に追記

**状態**: Implemented, PR review pending。

## 現行Metrics仕様（調査結果、`src/app/services/ocr_evaluation.py`）

- **正規化**（`_normalize_compare`、`ocr_evaluation.py:31-42`）: `unicodedata.normalize("NFC", text).strip()`。大小文字変換なし・NFKC不使用（全角半角・0とO・1とIを同一視しない）。U+FFFD検出時は警告ログのみ（値は変更しない）
- **Levenshtein**（`levenshtein_ops`、`ocr_evaluation.py:45-80`）: DP+バックトレースの純Python実装。追加依存なし。戻り値は`(distance, ops)`、`ops`は`("sub"|"del"|"ins", 正解文字, 予測文字)`のリスト
- **完全一致判定**（`ocr_evaluation.py:429`）: `bool(prediction.strip()) and pred_cmp == expected_cmp`。空文字列predictionは常に不一致（空正解との偶然一致を防ぐ）
- **CER**（`ocr_evaluation.py:476-479`）: `dist_total / ref_total`（**マイクロ平均**。画像ごとのCER平均ではない）、`ref_total==0`ならNone。四捨五入`round(x, 4)`
- **character_accuracy**（`ocr_evaluation.py:494`）: `1.0 - cer`。cer>1のとき負値、clampしない
- **confusion集計**（`ocr_evaluation.py:499-507`）: `Counter[(kind, from, to)]`。上位10件（`most_common(10)`）と全件（`most_common()`）。tie-breakは不定（Counter内部の実装依存）
- **sample_count/exact_match_count/exact_match_rate相当**: 既存コードでは`total`/`correct`/`accuracy`という名称。`total==0`時の`accuracy`フォールバックは`0.0`（防御的コードであり現状の呼び出し経路では到達しない。全target一律`total=len(rows_out)`のため）
- **空Ground Truth**: `ref_total==0`時、CERはNone（0除算を回避、分母0を勝手に決めない）
- **空Dataset**: `evaluate_ocr()`自体は評価対象画像0件で`ValueError`を送出する（Dataset全体のガード）。target単位の`total==0`は前述のとおり到達しない防御的コード
- **prediction error / skipped sample**: 既存実装には「推論例外」という概念が無い（`recognize()`は常に文字列を返す前提）。GT CSVに存在するが画像ファイルが見つからない行は`skipped_missing_image`としてカウントされ評価対象から除外される（本Issueの対象外、Dataset探索の責務）
- **whitelist適用タイミング**: Tesseract推論（`recognize_line`）内部で適用。比較（`_normalize_compare`）には影響しない

## Calculator設計

新規: `src/app/services/evaluation_metrics.py`（純関数、クラス化せず）。公開API:

```python
normalize_compare(text) -> str
levenshtein_ops(expected, predicted) -> tuple[int, list[tuple[str, str, str]]]
calculate_sample_metrics(image, ground_truth, prediction, *, confidence=None, duration_ms=None, error=None) -> OcrEvaluationSampleResult
calculate_evaluation_metrics(samples: list[OcrEvaluationSampleResult]) -> OcrEvaluationMetrics
aggregate_confusions(pairs: list[tuple[str, str]]) -> list[OcrEvaluationConfusion]
```

### CER計算方式

`calculate_sample_metrics`は1サンプル分の`cer = edit_distance / len(normalize_compare(ground_truth))`（`ref_len==0`ならNone）を計算する。`calculate_evaluation_metrics`は複数サンプルから**マイクロ平均**（全`edit_distance`合計 ÷ 全正解文字数合計）を計算し、既存仕様と完全に一致することをテストで確認済み（`test_compatibility_cer_micro_average_matches_test_cer_metrics_fixture`で`tests/test_cer_metrics.py`の`cer_env`Fixtureと同じ入力からbase CER=`2/9`、trained CER=`1/9`が得られることを確認）。

### Empty GT / Empty Dataset

- 1サンプルのground_truthが空文字列の場合、`cer=None`（分母0のため。predictionの有無に関わらず）
- 0件Datasetの場合、`calculate_evaluation_metrics([])`は`sample_count=0`/`exact_match_count=0`/`exact_match_rate=0.0`/`cer=None`/`character_accuracy=None`/`confusions=[]`を返す。`exact_match_rate=0.0`と`cer=None`という非対称は既存実装の`accuracy`フォールバック（`0.0`）と`cer`のNone分岐をそれぞれ忠実に再現した結果であり、意図的に維持した

### Confusion表現

既存`{kind, from, to, count}`構造を`OcrEvaluationConfusion(kind, expected, predicted, count)`へ、`from→expected`・`to→predicted`と読み替えて表現する（Issue #63で既に決定済みの方針）。kindの値（`sub`/`del`/`ins`）は既存の短縮表記をそのまま使用し、`substitution`/`insertion`/`deletion`という長い名称へは変更しない（実装事実を優先）。insertion/deletionは`expected`/`predicted`の一方を空文字列で表現し、`None`へは変換しない。

並び順は count降順、同countはkind→expected→predictedの決定的sort。既存API（`POST /api/ocr/evaluate`）の`confusions`/`confusions_full`は`Counter.most_common()`のみ（tie-breakは不定）で、**本Calculatorは未配線のためこの並び順に一切影響しない**。決定的sortはテスト安定性のために本モジュール内でのみ導入した。

### normalization方針

`normalize_compare`は既存`_normalize_compare`と同一仕様（trim + NFC正規化のみ）。`strip()`/`lower()`/Unicode NFKC正規化/whitespace collapseを追加していない。大文字小文字・全角半角は区別する（既存仕様どおり）。

### sample_count Canonical方針（Issue #63で残した重複の確定）

`OcrEvaluationResult.sample_count`と`OcrEvaluationResult.metrics.sample_count`の重複について、**`metrics.sample_count`をCanonicalとする**方針を確定した。本Issueでは`OcrEvaluationResult`自体を生成しない（Calculatorはengine_id/model_ref/timing/warningsを知らないため）ため、`calculate_evaluation_metrics()`は`OcrEvaluationMetrics.sample_count`のみを正として返す。将来Runnerが`OcrEvaluationResult`を構築する際は、`result.sample_count = result.metrics.sample_count`として同期させる（Runner実装Issueの責務）。`OcrEvaluationResult`のトップレベル`sample_count`フィールド自体は削除しない（Schema変更なし）。

## Tesseract既存処理への配線有無

**配線しない（Calculator新設・テストのみ）。** `src/app/services/ocr_evaluation.py`は本Issueで一切変更していない。

判断理由:

1. `evaluate_ocr()`は画像読込・一時ファイル管理・前処理グループ計算・認識器実行・Counter集計が単一の600行超の関数に密結合しており、Calculatorへの実配線は「Tesseract固有モデルloadや画像処理へ触れない」という条件を満たしにくい
2. `_normalize_compare`は`logging.getLogger("src.app.services.ocr_evaluation")`という**このモジュール名に固定されたlogger**でU+FFFD検出時に警告を出す。既存テスト`tests/test_cer_metrics.py::test_normalize_compare_logs_replacement_char`は`caplog.at_level(..., logger="src.app.services.ocr_evaluation")`でこのlogger名を明示的に指定しており、仮に`_normalize_compare`の実装を本モジュールへ移設し`ocr_evaluation.py`側をimportへ置き換えると、警告の出力元logger名が`src.app.services.evaluation_metrics`へ変わり、このテストが壊れることを検証で確認した
3. `benchmark.py`は`from .ocr_evaluation import _normalize_compare, _read_gt_csv, _resolve_image, levenshtein_ops`として既存関数を直接re-exportに依存しており、移設の影響範囲が`ocr_evaluation.py`単体に留まらない

このため、本モジュールは`ocr_evaluation.py`からの「移設」ではなく、独立した実装として用意した。正しさの担保は、`tests/test_evaluation_metrics.py`のCompatibilityテストで`ocr_evaluation.py`の`_normalize_compare`/`levenshtein_ops`と直接出力比較し、完全一致することを確認する方法を取った（`test_compatibility_normalize_compare_matches_legacy`・`test_compatibility_levenshtein_ops_matches_legacy`）。

Tesseract評価の実際の配線は、既存の[docs/design/MULTI_ENGINE_EVALUATION_API.md](../../design/MULTI_ENGINE_EVALUATION_API.md) 19章 Migration Planで既に計画されている「Tesseract Predictor Adapter」Issue（Phase 4相当）で改めて判断する。

## 未実装範囲（Scope外）

- Evaluation Runner
- Evaluation Dispatcher
- Engine別Predictor（Tesseract/PaddleOCR/EasyOCR/TrOCR）
- `POST /api/ocr/evaluate`のAPI接続変更
- `src/app/main.py`・`src/app/services/ocr_evaluation.py`（配線見送りのため）・`frontend/`の変更
- TrOCR評価実装
- Evaluation UI変更
- Benchmark変更
- Schema変更（`src/app/schemas.py`は無変更）

## 次のIssue

Evaluation Dispatcher / Runner（`EvaluationDispatcher`本体、`EnginePredictor`契約、Tesseract Predictor Adapterの配線判断を含む）

## テスト

`tests/test_evaluation_metrics.py`（新規46テスト）。Exact Match/Edit Distance/CER/Aggregate/Confusion/Validation/Compatibilityの各カテゴリを網羅。既存`tests/test_cer_metrics.py`（7テスト）は無修正のまま全件成功を確認済み。
