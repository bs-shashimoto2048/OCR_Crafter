# TrOCR Benchmark Runner Integration 作業記録

Related: Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Investigation [#100](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/100)（TrOCR Benchmark Integration Investigation） / Feature [#102](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/102)

**状態**: Implemented, PR review pending。

## 目的

Investigation #100の結論に基づき、TrOCRを既存Benchmark Runnerへ統合し、Benchmark実行フォームからTrOCRモデルを選択して既存Benchmarkフローを実行できるようにする。既存Benchmark architectureは全面再設計しない。

## 実装前調査（Investigation #100からの引き継ぎ）

- TrOCRはBenchmark Runnerに一切対応コードが無い（`ENGINE_CATALOG`/`ENGINE_BUILDERS`いずれにも`trocr`キーが存在しない）
- Benchmark独自のCER計算・Job Management経由の旧`evaluate_ocr()`・Multi-engine Evaluation APIは実装上3つの独立した経路であり、既存Evaluation資産はBenchmarkへ自動的には波及しない
- `TrOCREngine`は既にload-once/predict-many契約を持つ（`TrOCREngine.load()`を1回、以降`predict_file()`を繰り返し呼ぶ）
- TrOCRのconfidence欠損はBenchmarkに一切影響しない（confidenceは現状のBenchmarkで一切永続化・使用されていない）
- `engines: list[dict[str, Any]]`という完全に自由形式のAPI schemaのため、新しいoption（`device`/`local_files_only`）追加にschema変更は不要
- Benchmark Center本体はコード変更不要（別途、対象外として明記）

## 実装内容

### `src/app/services/benchmark.py`

- **`ENGINE_CATALOG`**へ`trocr`エントリを追加した。canonical engine idは`trocr`の1つのみ（Issue本文の指示どおり、PaddleOCRのofficial/customのような分割は行わない——登録済みartifact・手動入力いずれの場合も`TrOCREngine.load(model_ref)`という同一の実行経路のため、catalog keyを分ける技術的な理由が無いと判断した）。`profile_keys: ["device", "local_files_only"]`とし、これらもTesseractのPSM/Whitelistと同じ「エンジン固有条件」としてProfile Hashへ含まれる（条件が変われば別Benchmarkとして区別される）
- **`normalize_engine_spec()`**へ`device`/`local_files_only`の正規化を追加した（`profile_keys`に含まれる場合のみ適用。既存3エンジンの`profile_keys`には含まれないため無影響）
- **`_build_trocr_runner()`**を新設し、`ENGINE_BUILDERS["trocr"]`へ登録した。`TrOCREngine.load(model_ref, device=..., local_files_only=...)`をcold start（1回だけ）で呼び、`recognize(image_path)`クロージャが同一インスタンスの`predict_file()`を呼ぶ（既存`_build_paddleocr_runner()`と同型のAdapterパターン）。confidenceは常に`None`を返す（TrOCRの既存方針どおり捏造しない）
  - `device`の`"auto"`は`TrOCREngine.load()`の`device=None`（自動解決）へ変換する（Issue #94の`_run_trocr_training_job()`と同じ変換規約。`"auto"`という文字列自体は`trocr_engine.py::_resolve_device()`が理解しないため）
  - model_refが空の場合・`TrOCREngine.load()`が失敗した場合はいずれも例外がそのまま伝播する（TrOCR専用の握りつぶし処理は追加していない。既存のPaddleOCR未インストール等と同じ「1エンジンの構築失敗はBenchmark Job全体を失敗させる」という既存failure boundaryをそのまま維持する）
- **`engine_catalog_with_availability()`**へ`trocr`の可否判定を追加した（`import transformers`の成否のみで判定。`torch`は既存の必須依存のため判定不要、`trocr_engine.py::_resolve_device()`のコメント参照）

### `frontend/src/views/BenchmarkView.jsx`

- `selectedEngines`の初期stateへ`trocr: false`を追加し、対象エンジン一覧（`GET /api/benchmarks/engines`のカタログ）に含まれる`trocr`エントリをチェックボックスで選択可能にした（既存Tesseract/PaddleOCRと同じ表示・無効化ロジックをそのまま適用、変更なし）
- `trocr`が選択された場合のみ表示する専用パネルを追加した:
  - Base Model選択（登録済みモデルから選択／手動入力の二択。Training UI（Issue #98）・Inference/Evaluationの既存パターンをそのまま踏襲）
  - device（auto/cpu/gpu、UI表示は他画面と共通の語彙。送信直前にのみ`gpu → cuda`へ変換する。共通の演算デバイスUIコンポーネント自体は変更しない）
  - local_files_only チェックボックス
- 登録済みモデル一覧は`GET /api/trocr/models`（Issue #96/#98で確立済み）由来の`trocrTrainedModels`propをそのまま使う。Benchmark専用の重複model listing APIは新設していない
- `buildRunPayload()`へtrocr specの構築を追加した（`engine: "trocr"`, `model`, `device`, `local_files_only`）。model_refが解決できない場合は既存のTesseract/PaddleOCR自作モデルと同じ挙動（該当engineのspecを単に追加しない。エラー通知は行わない）を踏襲した
- Benchmark画面専用のTrOCR state（`benchTrocr*`）を新設し、Training（`ocrTrocr*`）・推論テスト画面（`inferTrocr*`）・モデル評価画面（`ocrEvalTrocr*`）の既存stateとは完全に分離した。他画面と異なりApp.jsxへ状態を持ち上げず、`BenchmarkView.jsx`内のコンポーネントローカルstateとして閉じている（Benchmark実行フォームは画面遷移をまたいで保持する必要のない一時設定のため）

### `frontend/src/App.jsx`

- `<BenchmarkView>`へ`trocrTrainedModels`（Training UIと同じ読み取り専用の共有prop、Issue #96の`GET /api/trocr/models`由来）を渡すよう追加した。他の変更は無し（`runBenchmark()`はpayloadをそのまま送信するだけの既存実装のため無変更）

### `frontend/package.json`（テスト登録の是正）

Issue #98で追加した`frontend/tests/trocrTrainedModels.test.mjs`が`npm test`の対象ファイル一覧（明示列挙方式）へ登録されておらず、CIで実行されていなかったことを本Issueの作業中に発見した。本Issueで新設した`benchmarkTrocrStateIsolation.test.mjs`と合わせて登録した（Issue #98自体の実装内容は無変更、テスト実行対象への追加のみ）。

## Model Resolution

TrOCRのmodel_refは以下のいずれも受け付ける（新しいResolverは追加しない、既存契約のまま）:

- Hugging Face Hub上のmodel ID（例: `microsoft/trocr-base-printed`）
- ローカルディレクトリパス
- Issue #96で登録されたTrOCR artifact（`.trocr.json`の`model_dir`。UIが`GET /api/trocr/models`から選択したものをそのまま`model`として送信する）

`model_registry.py`の巨大共有関数（`resolve_ocr_model_meta()`等）は使わない（Investigation #100の判断どおり）。

## Failure Behavior

既存Benchmarkのfailure boundaryをそのまま維持した。TrOCR固有の例外握りつぶし処理は追加していない。

- モデルロード失敗（依存未導入・model_ref不正・ネットワーク等）は`TrOCREngine.load()`が送出する例外（`TrOCRDependencyError`/`TrOCRModelLoadError`/`ValueError`）がそのまま伝播し、既存の「1エンジンの構築失敗はBenchmark Job全体を失敗させる」という設計（Investigation #100 §8で確認済み）がそのまま適用される
- 画像読込・推論失敗（1画像単位）は既存の`run_benchmark_job()`内try/exceptがそのまま吸収する（TrOCR専用の変更なし）
- キャンセルは既存の協調的キャンセル（`ctx.check_cancelled()`）がそのまま適用される（TrOCR専用の変更なし）

## Metrics / Persistence

既存のCER/metrics/result persistenceをそのまま利用した。Evaluation Runner/Metric Calculatorへの切替は行っていない。confidence永続化は新設していない（`recognize()`が返す`(text, None)`のうち`None`は`run_benchmark_job()`内で既存どおり破棄される）。TrOCR専用metricsは追加していない。DB schema変更は行っていない（`benchmarks.json`はフリーフォームJSONのまま）。

## Tests

`tests/test_benchmark_trocr.py`（新規、20件）:

- `ENGINE_CATALOG`/`ENGINE_BUILDERS`登録・catalog shape
- `engine_catalog_with_availability()`のtransformers可否判定
- `normalize_engine_spec()`のdevice/local_files_only既定値・明示値・model必須検証
- `_build_trocr_runner()`: model必須検証、load-once（複数recognize呼び出しでも1回のみ）、device"auto"→None変換、明示device値の伝播、local_files_only伝播、labelへのmodel_ref反映
- confidenceが常に`None`で返ること
- モデルロード失敗・推論失敗の既存failure boundaryへの伝播（TrOCR固有の握りつぶしが無いこと）
- `run_benchmark_job()`経由のエンドツーエンド統合（TrOCR単独実行・既存エンジンとの混在実行・cold start失敗によるJob全体失敗）

いずれも`transformers.AutoProcessor`/`VisionEncoderDecoderModel.from_pretrained`をfakeへ差し替える方式（`tests/test_trocr_evaluation_predictor.py`と同じmonkeypatch規約）で、`TrOCREngine.load()`/`predict_file()`自体は実関数を使用する。実TrOCRモデル・Hugging Face network access・GPU/CUDAへは依存しない。

`tests/test_benchmark.py`（既存10件）は無修正のまま全件成功を確認し、既存Tesseract/PaddleOCR/EasyOCR Benchmarkに回帰が無いことを確認した。

`frontend/tests/benchmarkView.render.test.mjs`: TrOCRエンジンが選択肢へ表示され、未導入バッジが誤表示されないことを追加検証。

`frontend/tests/benchmarkTrocrStateIsolation.test.mjs`（新規）: Benchmark画面のTrOCR state（`benchTrocr*`）が他3画面の既存TrOCR stateと完全に分離されていることの静的検証（Issue #85/#98と同じ手法）。

`python -m pytest -q` — 1284 passed, 1 failed（既知Issue #8のみ、新規failureなし）。

`cd frontend && npm test` — 701 passed（Issue #98で登録漏れだった`trocrTrainedModels.test.mjs`12件を含む）。

`cd frontend && npm run build` — 成功。

## Documentation

- 本ドキュメント（新規）
- `docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`・`docs/workitems/trocr/ISSUE_MAP.md`を更新
- `docs/19_BENCHMARK_SPEC.md`（対応エンジン表へtrocr行を追加、テスト節を更新）

## Out of Scope（次Issue以降）

- Release Gate integration
- Benchmark framework全面再設計
- Evaluation architecture変更
- Training architecture変更
- ModelMetadata infrastructure全面統合
- Dataset schema変更
- confidence推定の新規実装
- Benchmark Center Production UI変更（Investigation #100で変更不要と確定済み）
