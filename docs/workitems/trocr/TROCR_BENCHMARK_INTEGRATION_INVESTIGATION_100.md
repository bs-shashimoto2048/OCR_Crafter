# TrOCR Benchmark Integration Investigation 作業記録

Related: Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Investigation [#88](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/88) / Feature [#90](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/90)（Dataset Adapter） / Feature [#92](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/92)（Training Backend Core） / Feature [#94](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/94)（Job Integration） / Feature [#96](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/96)（Artifact Registration） / Feature [#98](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/98)（Training UI） / Investigation [#100](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/100)

**状態**: Implemented, PR review pending（Investigation/Documentation onlyのため、本Issueの意味では実装完了＝調査完了）。

## 目的

Epic #27の次段階として、TrOCRを既存Benchmark Runner / Benchmark Centerへ安全に統合するための実装前調査を行う。Productionコード変更は行わない（本Issueの方針どおり）。

## 1. Existing Benchmark Call Graph

Benchmark Runner（実行ツール）とBenchmark Center（横断比較ビュー）は**コード・保存先・目的が完全に別**（`docs/19_BENCHMARK_SPEC.md`・`benchmark_center.py`モジュールdocstringに明記済み）。

### Benchmark Runner（実行系）

```text
BenchmarkView.jsx（フォーム: 対象エンジンチェックボックス・前処理モード）
    ↓ POST /api/benchmarks（BenchmarkCreateRequest。main.py::api_benchmark_create）
        - normalize_engine_spec()で各engine specを検証（400: 未対応/未導入engine・model必須）
        - resolve_benchmark_preprocess()で前処理計画を事前検証
        - job_manager.py::JobService.create_job(job_type="benchmark", params={...})
    ↓ JobWorker（単一デーモンスレッド・ポーリング、job_manager.py）
        - execute_job() → JOB_HANDLERS["benchmark"] = _handle_benchmark()
    ↓ services/benchmark.py::run_benchmark_job(params, ctx)
        1. gt_csv読込（ocr_evaluation.py::_read_gt_csv）
        2. build_profile()でcommon_profile/engine_profiles/profile_hashを生成
        3. resolve_benchmark_preprocess()の`apply`を全画像へ一度だけ適用（前処理は全エンジン共通）
        4. engine_profiles を順に処理: ENGINE_BUILDERS[spec["engine"]](project_id, spec) でRunner生成（cold start計測）
           → warmup_runs回のウォームアップ → 画像ごとに runner["recognize"](path) を呼びCER/exact match/confusion/時間を集計
        5. results/casesをbenchmarks.json（BM-0001形式）へ保存
    ↓ GET /api/benchmarks・GET /api/benchmarks/{id}・.../export（Leaderboard/CSV）
```

主要ファイル・関数: `frontend/src/views/BenchmarkView.jsx`、`src/app/main.py`（`api_benchmark_create`/`api_benchmarks`/`api_benchmark_detail`/`api_benchmark_export`/`api_benchmark_engines`/`api_benchmark_config`）、`src/app/services/job_manager.py`（`JobService`/`JobWorker`/`JobContext`/`JOB_HANDLERS["benchmark"]`）、`src/app/services/benchmark.py`（`ENGINE_CATALOG`/`ENGINE_BUILDERS`/`normalize_engine_spec`/`build_profile`/`resolve_benchmark_preprocess`/`run_benchmark_job`/`build_leaderboard`/`compute_balance_scores`）。

### Benchmark Center（横断比較ビュー・実行しない）

```text
BenchmarkCenterView.jsx（Dataset/Model/Experimentを横断比較する読み取り専用ビュー）
    ↓ GET /api/benchmark-center/models → benchmark_center.py::list_comparable_models()
        - model_registry.py::list_model_infos() × experiment_tracker.py::list_experiments() をクロス集計
        - 評価結果（CER/char_accuracy/accuracy_percent）はExperimentへ紐づいたもののみ表示。新規評価は実行しない
    ↓ GET /api/benchmark-center/comparisons・POST（保存は比較条件のみ。評価結果自体は保存しない）
```

**重要な発見**: `_handle_evaluation`（`job_manager.py`のJob Management経由の評価）は旧`ocr_evaluation.py::evaluate_ocr()`を直接呼ぶ。Feature #61-#85で構築したMulti-engine Evaluation API（`evaluation_dispatcher.py`/`evaluation_runner.py`/Predictor群）はこの経路からは一切使われていない（`main.py::POST /api/ocr/evaluate`からのみ使われる別経路）。同様にBenchmark（`run_benchmark_job`）もCER計算を`ocr_evaluation.py`の`_normalize_compare`/`levenshtein_ops`のみ再利用しており、`evaluation_metrics.py`（Common Evaluation Metric Calculator, Feature #65）・Dispatcher・Runner・Predictor群は一切使っていない。**Benchmark／Job Management経由Evaluation／Multi-engine Evaluation APIは、部分的に用語が重なるが実装上は3つの独立した経路**であり、Multi-engine Evaluation APIの資産（Predictor・Dispatcher・Runner）はBenchmarkへ自動的には波及しない。

## 2. Engine Support Matrix（実コードで確定）

| Engine | Benchmark Runner対応 | 対応キー | Benchmark Center表示 |
|---|---|---|---|
| tesseract | ✅ 対応（2キーに分割） | `tesseract_model`（登録モデル）/ `tesseract_base`（eng標準） | ✅（`list_model_infos()`経由） |
| paddleocr | ✅ 対応（2キーに分割） | `paddleocr_official`（公式） / `paddleocr_custom`（自作・要エクスポート） | ✅（`list_model_infos()`経由） |
| easyocr | ❌ 未実装（カタログに`implemented: False`で明示、選択不可） | `easyocr` | ✅（表示自体は汎用だが評価結果が無いため実質空） |
| trocr | ❌ **未実装**（`ENGINE_CATALOG`に一切のエントリが無い。UIにも表示されない） | なし | ❌ 表示不可（後述） |
| custom（分類モデル） | 対象外（Benchmarkの対象はOCR認識のみ。`training_family`が異なる） | - | 対象外 |

「Inference/Evaluationで対応済みだからBenchmarkも対応済み」という推測は誤りであることを確認した。TrOCRはInference（#18/#20）・Evaluation（#77/#79）・Training（#90-#98）まで完了しているが、**Benchmark Runnerには対応コードが1行も存在しない**（`ENGINE_CATALOG`・`ENGINE_BUILDERS`いずれにも`trocr`キーが無い。grep確認済み）。

Benchmark Centerは`list_model_infos()`のみを参照する（`benchmark_center.py::list_comparable_models()`）。TrOCRの`.trocr.json`はIssue #96の決定により`list_model_infos()`にglobされないため、**Benchmark Center側もコードは汎用（`engineDisplayText()`はEngine Registry経由でTrOCRラベルを正しく表示できる）だが、実データが1件も現れない**という、Issue #96/#98investigationで既出の同一根本原因（`list_model_infos()`未統合）がここでも再現している。

## 3. TrOCR Inference Contract

`src/app/services/trocr_engine.py::TrOCREngine`:

- `TrOCREngine.load(model_ref, *, device: str | None = None, local_files_only: bool = False) -> TrOCREngine`: Processor/Model構築（`transformers.AutoProcessor`/`VisionEncoderDecoderModel.from_pretrained()`）。`model_ref`はHugging Face Hub ID・ローカルディレクトリパスいずれも可、`from_pretrained()`へそのまま渡す（特殊値のフォールバックなし）。失敗時は`TrOCRDependencyError`（transformers未インストール）/`TrOCRModelLoadError`（load/device移動失敗）/`ValueError`（model_ref不正）を送出
- `predict(image: PIL.Image) -> TrOCRResult` / `predict_file(path) -> TrOCRResult`: 同一インスタンスで繰り返し呼べる（**load-once/predict-many契約が既に確立済み**、`tests/test_trocr_engine.py::test_same_engine_instance_does_not_reload_on_repeated_predict`で実証済み）
- `TrOCRResult`は`text`と`model_ref`のみを持ち、**`confidence`属性が存在しない**（TrOCR標準の`generate()`は文字単位confidenceを直接返さないため、Issue #16/#77で「独自のconfidence定義を発明しない」と確定済み）
- 画像前処理はEngine内部で完結（`PIL.Image.open()`→RGB変換→`processor()`）。Benchmark側で追加の前処理は不要（Predictor Adapterと同じ契約）

Issue #92のTraining Backend Coreは既に`TrOCREngine.load()`をそのまま再利用しており、Issue #77のTrOCR Evaluation Predictor Adapterも`TrOCREngine`のbuild-once契約をそのまま利用している（新規キャッシュ層を作らない、が既存の一貫した方針）。**Benchmarkのbuilder（`ENGINE_BUILDERS`）もこのbuild-once契約をそのまま再利用できる**——`_build_paddleocr_runner()`/`_build_tesseract_runner()`と同様、builder関数内で`TrOCREngine.load()`を1回呼び、`recognize(image_path)`クロージャが同一インスタンスの`predict_file()`を繰り返し呼ぶだけで良い（新しいキャッシュ・Predictor Protocol経由の間接呼び出しは不要）。

## 4. TrOCR Artifact Contract

Issue #96/#98で完成済み:

- `.trocr.json`（`models/trocr_<job_id>.trocr.json`）: `name`/`engine="trocr"`/`model_dir`/`base_model_ref`/`project_id`/`job_id`/`dataset_root`/`dataset_id`/`epochs`/`batch_size`/`learning_rate`/`final_loss`/`created_at`
- `trocr_model_registry.py::list_trocr_models(project_id)`: `.trocr.json`をそのまま読み込む専用一覧関数
- `GET /api/trocr/models`（Issue #98で新設）: 上記の薄いラッパー
- `model_dir`はそのまま`TrOCREngine.load()`のmodel_refとして使える（save_pretrained()/from_pretrained()の対称性、Issue #96で確認済み契約）

**`model_registry.py::list_models()`/`list_model_infos()`とは統合されていない**（Issue #96で意図的に決定、Tesseract/PaddleOCRの200行超の共有分岐への回帰リスクを避けるため）。Benchmarkが既存`model_registry.py`（例: `resolve_ocr_model_meta()`）へ依存する場合（PaddleOCR自作モデルの解決に使用）、TrOCRは**同じ経路を使えない**——Benchmark用のTrOCR builderは`GET /api/trocr/models`/`list_trocr_models()`（登録済みartifact）または手動入力のmodel_ref（HF ID/ローカルパス）のいずれかをUIから受け取り、`model_registry.py`を経由せず直接`TrOCREngine.load()`へ渡す設計にする必要がある（Issue #98のTraining UIが採用した設計と同型）。

`model_registry.py::list_models()`の全面再設計はこの調査で決定しない（Issue #96のFuture Work境界をそのまま維持）。

## 5. Variant Key / Identity

Benchmarkの`engine_key = f"{spec['engine']}:{spec.get('model') or ''}"`（`run_benchmark_job()`内、単純な文字列結合）は、**Evaluation Dispatcherのcanonical engine_id（tesseract/paddleocr/easyocr/trocrの4値）とは別の識別体系**である。Benchmarkの`spec["engine"]`は`ENGINE_CATALOG`のキー（`tesseract_model`/`tesseract_base`/`paddleocr_official`/`paddleocr_custom`）であり、canonical engine_idをさらに「登録モデル/標準」「公式/自作」で細分化した**Benchmark独自のカタログキー**である。これは既存のEvaluation Dispatcherの責務とは意図的に別（`docs/workitems/trocr/`の既存投資結果どおり、Variant KeyとEvaluationのcanonical engine_idは別責務として維持されている）。

TrOCRを追加する場合、既存の細分化パターンに倣うなら以下のような新規カタログキー候補が考えられる（**本Issueでは決定しない**、次Issueで確定）:

- `trocr_registered`（Issue #96登録済みartifactから選択。`model`=sidecarの`name`または`model_dir`）
- `trocr_manual`（Hugging Face model ID・ローカルパスの手動入力。`model`=入力文字列そのもの）

いずれも`{engine, model}`の2フィールドで表現可能（PSM/Whitelistのような追加profile_keysは不要。device/local_files_onlyを追加するかは次Issueで判断、後述）。同一model_ref（例: 同じHugging Face model ID）を`trocr_registered`/`trocr_manual`の両方から指定した場合の重複・表示名の区別は、既存のPaddleOCR公式/自作の区別方法（catalog keyそのものが区別軸）をそのまま踏襲すればよく、新しい仕組みは不要と判断した。

## 6. Dataset / Preprocessing

Benchmarkの前処理（`resolve_benchmark_preprocess()`）は、Issue #90が発見した「training dataset画像は`create_ocr_dataset()`が必ず`preprocess_ocr_image()`（Tesseract/PaddleOCR向け固定キャンバス整形）を適用済み」という制約とは**完全に別の独立した経路**である。Benchmarkは`image_dir`（評価画像フォルダ、生画像を直接指定可能）+ `gt_csv`を入力とし、`mode: none/manual/training/project`の4モードで**Benchmark開始時に一度だけ**前処理を適用し、全エンジンへ同じ最終画像を渡す（Dataset作成時の固定前処理とは無関係）。

ただし`mode == "training"`は現状**Tesseractの学習時前処理記録専用**にハードコードされている（`resolve_benchmark_preprocess()`内で`model_registry.py::resolve_tesseract_model_meta()`を直接呼ぶ）。TrOCRモデルの学習時前処理（現状TrOCR Training Coreは前処理を独自に持たず、Dataset Adapter経由の画像をそのままProcessorへ渡す設計、Issue #90/#92で確認済み）を`mode: training`で指定する需要があるかは次Issue以降で確認する（本調査の時点でTrOCR Trainingには「学習時前処理スナップショット」という概念自体が無いため、無理に対応させる必要はないと考えられる）。

`mode: none/manual/project`はEngine非依存の前処理（PIL Imageを受け取りPIL Imageを返す`apply`関数）であり、TrOCRのProcessorへそのまま渡せる。**TrOCR Processorとの二重前処理リスク**: `mode: manual`（グレースケール・二値化）や`mode: project`（プロジェクトの現在の前処理スナップショット）を適用した画像をTrOCR Processorへ渡すこと自体は技術的に可能だが、TrOCRは印刻/手書き文字を想定したVisionモデルであり、Tesseract/PaddleOCR向けの二値化・グレースケール変換を事前適用すると認識精度が低下する可能性がある（本調査ではこの精度影響を測定しない。UI側で「TrOCRには前処理適用を推奨しない」旨の注記を検討する程度に留め、機能自体を禁止するかはBenchmark実装Issueで判断する）。

## 7. Metrics / Confidence

Benchmarkの`recognize(image_path) -> (prediction: str, confidence: float)`という関数シグネチャは`confidence`を戻り値として要求するが、**実際にはこの`confidence`は`run_benchmark_job()`内で`_confidence`として受け取られた直後に破棄され、`results`/`cases`のいずれにも一切保存・使用されない**（コード確認済み: `prediction, _confidence = runner["recognize"](...)`）。CER・完全一致率・置換/挿入/脱落数は`ocr_evaluation.py`の`levenshtein_ops`/`_normalize_compare`のみから算出され、confidenceには依存しない。

**したがってTrOCRのconfidence=None（confidence非提供）はBenchmarkに一切影響しない**——`recognize()`が`(text, None)`を返せばよく、Evaluation側で確立済みの「confidenceを捏造しない」方針（0.0/1.0での代用禁止）をそのまま流用できる。Evaluation側の共通Metric Calculator（`evaluation_metrics.py`）をBenchmarkへ流用する必要はない（そもそも現状のBenchmarkはこれを使っておらず、既存のCER計算ロジックとの責務差はそのまま維持すればよい。両者を統合するのは本調査のスコープ外の大きな再設計であり、Issue #100自身が禁止する「Benchmark framework全面再設計」に該当する）。

## 8. Error / Cancellation / Runtime

- **Job実行モデル**: Benchmarkは`job_manager.py`の`JobWorker`（**単一デーモンスレッド**、プロセス内実行）上で動く。Training（`_spawn_training_runner`、独立サブプロセス+SIGTERM）とは異なるJob基盤であり、Benchmark Jobは常にAPIサーバーと同一プロセス・同一スレッドで実行される
- **キャンセル**: `ctx.check_cancelled()`（協調的キャンセル。`JobCancelled`例外を送出）が画像20件毎・エンジン切替時に呼ばれる。**TrOCRの`model.generate()`のような1回の重い呼び出し中はキャンセルポイントに到達できない**（TrainingのSIGTERMのような強制終了機構は無い）。この制約は既存のTesseract/PaddleOCRにも同様に当てはまる（Benchmark基盤自体の既存の性質であり、TrOCR固有の問題ではない）
- **モデルロード失敗（cold start失敗）**: `runner = ENGINE_BUILDERS[spec["engine"]](project_id, spec)`の呼び出しは`run_benchmark_job()`のエンジンループ内でtry/exceptに包まれていない。**1エンジンのモデルロードが失敗すると、Benchmark Job全体が`failed`になる**（他エンジンの結果も保存されない。既存のPaddleOCR未インストール等でも同じ挙動）。TrOCRはHugging Face Hubからのダウンロード・torch/transformers依存・GPU/CPUメモリ使用量の観点で他エンジンよりロード失敗の可能性が相対的に高いため、この既存の「1エンジン失敗＝Job全体失敗」という設計はTrOCR追加時により顕在化しやすいリスクとして記録する（本調査では既存挙動を変更しない。エンジン単位の失敗分離を導入するかはFuture Workとして次Issueで判断）
- **device/local_files_only**: 現状の`ENGINE_BUILDERS`はどれもdevice/local_files_onlyパラメータを受け取らない（Tesseract=CPU固定、PaddleOCRはreader内部解決）。TrOCR builderを追加する場合、`TrOCREngine.load(model_ref, device=..., local_files_only=...)`をそのまま呼べるよう、engine specへ`device`/`local_files_only`（Training UI Issue #98と同じ`auto`/`cpu`/`cuda`語彙）を追加できる余地は`engines: list[dict[str, Any]]`という完全に自由形式のスキーマ（後述）により**API schema変更なしに実現可能**
- **同時実行**: `benchmark_concurrency`設定（既定1）は「同時にrunning状態のBenchmark Job数」を制限する設計だが、`JobWorker`自体は単一スレッド・単一ループで一度に1件のJobしか実行しないため（`process_next()`が1件実行→完了後に次を探す）、実質的にBenchmark同士も他Job種別とも常に直列実行される。この既存の実装上の制約（設定値が事実上無意味になっている可能性）は本調査で発見した事実として記録するが、TrOCR追加とは無関係の既存の潜在的な設計不整合であり、本Issueでは修正しない

## 9. Benchmark Center UI

`BenchmarkCenterView.jsx`は`frontend/src/config/engineRegistry.js::getEngineLabel()`を**既に使用しており**、Engineフィルタの選択肢（`engineOptions`）も`rows.map(row => row.engine)`から動的に生成される（ハードコードされたEngine一覧ではない）。**つまりBenchmark Center自体のUIコードはTrOCRに対して既に汎用的であり、追加のUI変更は不要**——唯一の障害は、TrOCRモデルが`list_model_infos()`（`list_comparable_models()`が参照する唯一のデータソース）に一切現れないことである（Issue #96の決定に起因、本調査のスコープ外）。

一方`BenchmarkView.jsx`（Benchmark Runner本体の実行フォーム）は、Epic #46で確立した`engineRegistry.js`駆動の汎用パターンを採用しておらず、`selectedEngines`のstate初期値・チェックボックスリスト・モデルセレクタ（`engine.key === "tesseract_model"`等のハードコード分岐）を持つ。TrOCR対応のUI変更としては、Training UI（Issue #98）・Inference（既存）で確立済みの「登録済みモデルから選択／手動入力」の二択パターンをここでも踏襲する形が最小変更になると考えられる（`GET /api/trocr/models`を新しいデータソースとして使う）。Epic #46のEngine UI Generalizationパターンへ`BenchmarkView.jsx`自体を全面移行することは、既存Tesseract/PaddleOCRの回帰リスクを伴う大きな変更になるため、本調査では推奨しない（TrOCR用の新しいハードコード分岐を1つ追加するだけに留める）。

state isolationについては、Training（`ocrTrocr*`）・Inference（`inferTrocr*`）・Evaluation（`ocrEvalTrocr*`）で既に確立済みの命名規約（画面ごとに専用prefixを持つ）をBenchmark Runner UIでも踏襲すればよい（例: `benchTrocr*`）。

## 10. Legacy Compatibility

`ENGINE_CATALOG`へ新しいdict要素を追加し、`ENGINE_BUILDERS`へ新しいkey→builder関数のマッピングを追加するだけであれば、既存のTesseract/PaddleOCR/EasyOCRカタログエントリ・既存のbuilder関数・`normalize_engine_spec()`の既存分岐は一切変更不要である（`normalize_engine_spec()`内の`catalog = next((c for c in ENGINE_CATALOG if c["key"] == engine), None)`というルックアップは新規キー追加に対して自然に対応する）。巨大共有関数（`list_model_infos()`等）への分岐追加は不要——TrOCR用のBenchmark連携は`benchmark.py`内で完結する新規関数の追加のみで実現可能であることを確認した。

## Architecture Questions（14問への回答）

1. **TrOCRを`ENGINE_CATALOG`へ追加するだけで足りるか。** 足りない。`ENGINE_CATALOG`への追加に加え、対応する`ENGINE_BUILDERS`のbuilder関数実装が必須（`normalize_engine_spec()`は`ENGINE_CATALOG`のみ見るが、実行時は`ENGINE_BUILDERS[spec["engine"]]`を呼ぶため）。
2. **`ENGINE_BUILDERS`へどのbuilderを追加すべきか。** `_build_trocr_runner(project_id, spec) -> {"label": str, "recognize": Callable[[str], tuple[str, float | None]]}`を新設。`TrOCREngine.load(model_ref, device=..., local_files_only=...)`を呼び出しコンストラクタ相当とし、`recognize()`は`engine.predict_file(path)`をラップして`(result.text, None)`を返す（`_build_paddleocr_runner()`と同型のクロージャパターン）。
3. **Builderは`TrOCREngine`を1回loadして全sampleで再利用できるか。** できる（§3参照。`TrOCREngine`は既にload-once/predict-many契約を持ち、既存テストで実証済み）。
4. **HF model ID / local path / registered artifactを既存variant keyで表現できるか。** できる。`engine_key = f"{spec['engine']}:{spec.get('model') or ''}"`という既存の文字列結合方式は`model`フィールドに任意の文字列（HF ID・パス・sidecar名）を許容するため変更不要。カタログキー自体を`trocr_registered`/`trocr_manual`のように分ける案が既存のPaddleOCR公式/自作分割と一貫する（§5）。
5. **`.trocr.json` / `GET /api/trocr/models`をBenchmark側で利用すべきか。** 利用すべき（§4）。`model_registry.py`の共有Resolverは使えないため、Training UI（#98）と同じ「新規エンドポイントを直接使う」設計を踏襲する。
6. **Benchmark API schema変更は必要か。** 不要。`BenchmarkCreateRequest.engines: list[dict[str, Any]]`は完全に自由形式であり、新しいkey（`device`/`local_files_only`等）を追加しても既存フィールドには影響しない。
7. **DB schema変更は必要か。** 不要。`benchmarks.json`はフリーフォームJSON（SQLiteテーブルではない）。
8. **Benchmark result persistenceはTrOCRをそのまま保存できるか。** できる。`results`/`cases`のスキーマ自体がEngine非依存（`engine`/`model`/`engine_key`/`label`という汎用フィールドのみに依存）であり、TrOCR固有の新規フィールドは不要。
9. **confidence欠損は既存Benchmarkに影響するか。** 影響しない（§7）。confidenceは現状のBenchmarkで一切永続化・利用されていない。
10. **Benchmark Center UI変更はBackendと同一Issueで行うべきか、分割すべきか。** Benchmark Center自体はコード変更不要（§9）。UI変更が必要なのはBenchmark Runner（`BenchmarkView.jsx`）のみであり、これはBenchmark Backend（`benchmark.py`）と同一Issueで扱う規模（Issue #98のBackend+UI一体型パターンと同程度の小さな変更）と判断する。
11. **device/local_files_onlyはBenchmark optionとして必要か。** 必要性は次Issューでの判断事項だが、技術的には容易に追加可能（§8）。ローカル運用でHugging Face Hubへの意図しないアクセスを避けたい需要（Issue #98で確認済みの既存懸念）を考えると、追加を推奨する。
12. **Training artifactのdataset/experiment lineageをBenchmark結果へ接続する必要があるか。** 本調査の範囲では必須ではないと判断する。Benchmarkは元々「同一データ・同一条件での比較実行」がFocusであり、Dataset/Experiment lineageの接続は既存Tesseract/PaddleOCRのBenchmark結果にも存在しない（Benchmark自身のProfile Hashで条件の同一性を管理する設計のため）。
13. **Release Gateへ渡すBenchmark結果として追加契約が必要か。** 必要になる見込みだが、本Issueのスコープ外（Issue本文のOut of Scope「Release Gate実装」に該当）。`release_gate.py::_model_engine()`は現状`.tess.json`/`.ocr.json`の拡張子判定のみのハードコードで、TrOCR（`.trocr.json`）を認識しない、かつBenchmarkとの突合（`_find_benchmark_row_for_tesseract_model`相当）もTesseract専用にハードコードされていることを確認した。これはEpic #27の別Progress項目（Release Gate）として扱う。
14. **TrOCR専用Benchmark implementationと共通Benchmark generalization境界はどこか。** `ENGINE_BUILDERS`のAdapter構造自体が既に「共通実行ループ（`run_benchmark_job`）+ Engine別builder」という境界で設計されているため、TrOCR固有の実装は新規builder関数1つと、UIの新規条件分岐1つに閉じ込められる。共通実行ループ・Leaderboard・CSV Export・Profile Hash計算等はEngine非依存のまま一切変更不要。

## Risks

- **Job全体失敗のリスク**（§8）: TrOCRのモデルロード失敗（ネットワーク・依存未導入・GPU OOM等）で、他エンジンの結果を含むBenchmark Job全体が失敗する既存の設計。TrOCR追加により顕在化しやすくなる（既存の設計変更は本Issueでは行わない）
- **前処理の二重適用による精度低下**（§6）: `mode: manual/project`をTrOCRへ適用した場合の認識精度への影響は未測定
- **`list_model_infos()`未統合による機能ギャップ**: Benchmark CenterはUIコード上TrOCR対応済みだが、実データが現れない（Issue #96のFuture Work解消待ち）
- **`benchmark_concurrency`設定の実効性**（§8）: 単一Workerスレッドのため設定が事実上機能していない可能性（既存の潜在的不整合、TrOCR追加とは無関係だが記録する）
- **キャンセルの粒度**（§8）: 協調的キャンセルのため、重い1回の推論呼び出し中は停止できない（既存の性質）

## Recommended Implementation Plan / Issue分割案

既存architectureで安全に1 Issueへ収まると判断し、**不要な分割はしない**。

1. **TrOCR Benchmark Runner Integration**（Backend + UI、1 Issue）
   - Backend: `ENGINE_CATALOG`へ`trocr_registered`/`trocr_manual`相当のエントリ追加、`_build_trocr_runner()`実装、`ENGINE_BUILDERS`登録、`engine_catalog_with_availability()`のtransformers導入確認分岐追加
   - UI: `BenchmarkView.jsx`へTrOCR用のモデル選択パネル（登録済み/手動の二択、`GET /api/trocr/models`を利用）を追加。State isolation規約（`benchTrocr*`）を新設
   - Benchmark Centerはコード変更不要（対象外として明記）

Release Gate統合・`list_model_infos()`統合は、いずれもEpic #27の別Progress項目・別Epic（#28）のFuture Workとして本Issueには含めない。

## Scope / Out of Scope

Out of Scope（Issue本文どおり）:
- TrOCR Benchmark Production実装
- Benchmark Center Production UI変更
- Release Gate実装
- Benchmark framework全面再設計
- ModelMetadata infrastructure全面統合
- Training/Evaluation再設計
- Dataset schema変更
- Issue #8修正

## Tests / Verification

Investigation中心のためProduction diffなし。本調査中に発見した既存の設計上の特性（Job全体失敗・単一Workerスレッド・`benchmark_concurrency`の実効性等）はBugとして無断修正せず、上記Risksとして記録した。

`git diff main`でProductionコード（`src/`・`frontend/src`）の差分が無いことを確認済み（本ドキュメントおよびEpic/ISSUE_MAP更新のみ）。

## Documentation

- 本ドキュメント（新規）
- `docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`・`docs/workitems/trocr/ISSUE_MAP.md`を更新
