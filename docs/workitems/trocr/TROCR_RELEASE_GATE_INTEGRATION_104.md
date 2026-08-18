# TrOCR Release Gate Integration 作業記録

Related: Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Feature [#102](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/102)（TrOCR Benchmark Runner Integration） / Feature [#104](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/104)

**状態**: Implemented, PR review pending。

## 目的

Epic #27の次段階として、TrOCRモデルを既存Release Gate lifecycle（Draft/Validated/Candidate/Production/Archived）の正式な対象へ統合する。既存`release_gate.py`/`release_manager.py`のAPI/UI/Model Registryとの接続点を実コードで再調査したうえで、TrOCR artifactを既存Release Gate contractへ最小変更で統合する。

## 実装前調査（Mandatory Investigation）

Issue本文が要求する10項目を実コードから確認した。

1. **`release_gate.py`のpublic API / state machine / validation rules**: `evaluate_release_gate(project_id, model)`がPolicy（`normalize_policy()`）に基づき11種のルールを評価し`PASS/CONDITIONAL_PASS/FAIL/NOT_EVALUATED`を返す。State machineは`release_manager.py`側（`Draft/Validated/Candidate/Production/Archived`）にあり、Gate判定自体は状態遷移を持たない（判定のみ）
2. **モデルのidentifier/model_ref参照方法**: Release Gate全体（`evaluate_release_gate`/`set_model_status`/`promote_model`/`build_model_card`等）は一貫して「モデルメタsidecarファイル名」（例: `m1.tess.json`）を識別子として使う。model_ref（Hugging Face ID等）という概念はRelease Gate層には存在しない
3. **Evaluation/Benchmarkのどの保存データを読むか**: `experiments.json`の`evaluation`/`evaluation_profile`/`evaluation_hash`（`_experiment_for_model()`経由）と、`benchmarks.json`の`results`行（`_latest_benchmark_result()`経由）。Model Registry（`model_registry.py::list_model_infos()`）は一切読まない
4. **confidenceがgate条件に使われているか**: 使われていない。`evaluate_release_gate()`のいかなるルールもconfidenceを参照しない（CER/文字正解率/完全一致率/評価画像数/混同/必須文字/Benchmark順位・失敗数/許可エンジンのみ）
5. **CER/exact match/sample count等の判定条件**: `max_cer`/`min_char_accuracy`/`min_exact_match`/`min_eval_images`は`experiments.json`の`evaluation`（CER・文字正解率・完全一致率・画像数）のみを参照し、いずれもEngine非依存の数値比較
6. **Candidate/Production遷移時のartifact存在確認**: `promote_model()`は`(paths.models / model_name).is_file()`——**sidecarファイルの存在確認のみ**であり、実モデル（weights/processor）のloadは一切行わない
7. **Model Registry / Models APIとの接続点**: 無し。Release Gateは`model_registry.py`を一切importしない（独立した`releases.json`のみで完結）
8. **`.trocr.json`と既存Release Gate metadata contractの差異**: **重大な発見**（後述）。`list_releases()`が`*.tess.json`/`*.ocr.json`のみをglobしており、`.trocr.json`が一覧化されない。また`_model_engine()`が`.trocr.json`を認識しない（`allowed_engines`ルールで"不明"扱いになる）。さらに`_latest_benchmark_result()`はTesseract専用の文字列一致ロジックのみを持ち、TrOCRのBenchmark結果（`model`=model_ref）とは識別子の意味が異なるため接続できない
9. **Frontend Release Gate操作UIのengine依存箇所**: `ReleasesView.jsx`（799行）を全文調査した結果、**エンジン固有のファイル名判定（`.tess.json`/`.ocr.json`等の文字列リテラル）が一切存在しない**ことを確認した。モデル一覧・昇格候補選択は`Object.keys(releases.statuses)`から完全に汎用的に構築される
10. **DB schema変更が本当に必要か**: 不要。`releases.json`/`experiments.json`/`benchmarks.json`はいずれもフリーフォームJSON（SQLiteテーブルではない）

### 重大な発見: 3つの必須Backend修正

上記調査により、既存contractのままではTrOCRがRelease Gateへ一切現れない/正しく機能しないことが判明した。いずれも「新しいarchitecture」ではなく、既存2エンジン（Tesseract/PaddleOCR）と同じパターンへTrOCRを追加するだけの最小修正。

1. **`release_manager.py::list_releases()`**: `*.tess.json`/`*.ocr.json`のみをglobしており`.trocr.json`が一覧に出ない → `*.trocr.json`のglobを追加
2. **`release_gate.py::_model_engine()`**: `.trocr.json`を認識せず空文字（"不明"）を返す → `allowed_engines`ポリシーでTrOCRモデルが常にFAILしてしまう → `.trocr.json` → `"trocr"`の分岐を追加
3. **`release_gate.py::_latest_benchmark_result()`**: Tesseract専用のハードコード（`engine == "tesseract_model"`かつ`model`=sidecar名の直接一致）。TrOCRのBenchmark結果（Issue #102）は`model`にmodel_ref（Hugging Face ID・ローカルパス・登録済みartifactのmodel_dir）を保存するため、sidecar名との直接一致では絶対にヒットしない → `list_trocr_models()`（Issue #96の既存契約）経由でsidecar名→model_dirへ解決してから照合する分岐を追加

### 副次的な発見: Evaluation Profileのengine誤記録（Frontend）

`frontend/src/App.jsx::runOcrEvaluation()`が`/api/experiments/attach-evaluation`へ送るペイロードの`engine`フィールドが、**評価対象エンジンに関わらず常に`"tesseract"`へ固定されていた**ことを発見した。この値はExperimentの`evaluation_profile.engine`として保存され、`compute_evaluation_hash()`（Evaluation Hash生成）へ含まれる。Release Gateの`no_cer_regression`/`require_same_evaluation_hash`/`min_comparison_quality`ルールはこのHash・Profileを使ってProductionモデルとの比較可能性を判定するため、この不具合は「異なるEngineの評価を同一条件の評価と誤認しうる」という正確性の問題であり、TrOCR固有ではなくPaddleOCR/EasyOCR評価にも影響する既存の潜在バグだった。

Release GateのTrOCR統合（Backend Requirement #3「Evaluation evidence接続」）に直接必要な修正のため、本Issueで併せて修正した（`engine: "tesseract"` → `engine: ocrEvalEngine`）。Evaluation UI Generalization（Issue #83）で確立済みの選択値をそのまま渡すだけの変更で、Tesseract評価時の挙動は無変更（`ocrEvalEngine === "tesseract"`の場合、送信値は従来と同一）。

## 実装内容

### `src/app/services/release_manager.py`

`list_releases()`のモデルsidecarglobへ`*.trocr.json`を追加した。既存2エンジンと同じ「モデルメタsidecarファイル名=Release Gateのモデル識別子」という規約をそのまま踏襲する。

### `src/app/services/release_gate.py`

- `_model_engine()`へ`.trocr.json` → `"trocr"`の分岐を追加（`allowed_engines`ルールがTrOCRを正しく識別できるようにする）
- `_resolve_trocr_benchmark_model_ref()`を新設: TrOCRのRelease Gateモデル識別子（sidecarファイル名）から、Benchmark実行時に使われたmodel指定（model_ref）を`list_trocr_models()`（Issue #96の既存契約）経由で解決する。新しい統一Resolverは作らない——TrOCR固有の解決のみを追加する
- `_latest_benchmark_result()`を拡張し、`engine == "trocr"`かつ解決済みmodel_refが一致する行も接続対象にした。既存のTesseract専用ロジック（`engine == "tesseract_model"`）は無変更

### `frontend/src/App.jsx`

`runOcrEvaluation()`の`attach-evaluation`ペイロードの`engine`フィールドを、ハードコードされた`"tesseract"`から実際に評価したエンジン（`ocrEvalEngine`）へ修正した（上記「副次的な発見」参照）。

### Frontend UI（`ReleasesView.jsx`）: 変更なし

実コード調査（Mandatory Investigation #9）により、`ReleasesView.jsx`はエンジン固有のファイル名判定を一切持たず、`releases.statuses`（Backendの`list_releases()`が返す辞書）をそのまま汎用的に描画していることを確認した。Backend側の修正（`.trocr.json`のglob追加）のみで、TrOCRモデルが既存の一覧・昇格候補選択・Release Gate判定表示へ自然に現れる。Issue本文の許容事項どおり、UI変更は行わず、テスト（`frontend/tests/releasesView.render.test.mjs`）でこの契約を固定した。

## Model Resolution / Artifact Validation

- TrOCR model_refの解決はIssue #96の既存契約（`.trocr.json`/`list_trocr_models()`/`model_dir`）をそのまま利用し、新しいResolver layerやModelMetadata新層は追加していない
- Promotion時のartifact存在確認は既存契約どおり「sidecarファイルの存在確認のみ」（実モデルのload・processor/model構築は行わない）。TrOCRだけ高コストなload処理を追加していない

## Persistence / DB

DB schema変更なし。`releases.json`/`experiments.json`/`benchmarks.json`はいずれもフリーフォームJSONのまま。

## API

既存Release Gate API（`GET /api/releases`・`GET /api/releases/gate`・`POST /api/releases/promote`等）はすべてリクエスト/レスポンス互換のまま無変更。TrOCR専用endpointは新設していない（`model`パラメータは元々自由文字列であり、`.trocr.json`のsidecar名を渡すだけで動作する）。

## Compatibility

- Tesseract/PaddleOCR Release Gate: 無変更（`_model_engine()`/`_latest_benchmark_result()`の既存分岐はそのまま）
- TrOCR Inference/Evaluation/Training/Benchmark: 無変更（Release Gate側からの新規呼び出しは無い）
- Models listing（`GET /models`/`GET /models/info`）: 無変更（Release Gateはこれらを参照しない設計のまま）
- Experiment tracking / 既存DB・Job lifecycle: 無変更

## Tests

`tests/test_release_gate_trocr.py`（新規、14件）:

- `list_releases()`がTrOCRモデルを一覧化すること・既存Tesseract/PaddleOCRへの回帰がないこと
- `evaluate_release_gate()`: NOT_EVALUATED → PASS / max_cerでのFAIL
- `allowed_engines`ポリシーがTrOCRを正しく識別すること（"不明"にならない）・許可リスト外でFAILすること
- Benchmark evidence接続: 一致するBenchmark結果が無ければ未検証、model_dir解決経由で正しく接続されFAIL/PASSすること、model_dirが異なる場合・別エンジンのモデルを照会した場合に誤って接続されないこと（回帰確認）
- Promotion: TrOCRモデルのProduction昇格、artifact不存在時のFileNotFoundError、Gate FAIL時のOverride要求

既存`tests/test_release_gate.py`（15件）・`tests/test_releases.py`・`tests/test_benchmark.py`・`tests/test_benchmark_trocr.py`は無修正のまま全件成功を確認し、既存Tesseract/PaddleOCR Release Gate・Benchmarkに回帰が無いことを確認した。

`frontend/tests/ocrEvalAttachEvaluationEngine.test.mjs`（新規）: attach-evaluationペイロードのengineが`ocrEvalEngine`を渡すこと（`"tesseract"`固定に戻っていないこと）の回帰テスト。

`frontend/tests/releasesView.render.test.mjs`（新規）: TrOCRモデルが既存UIへエンジン非依存に表示される契約の固定（一覧表示・Production表示・空状態）。

`python -m pytest -q` — 1298 passed, 1 failed（既知Issue #8のみ、新規failureなし）。

`cd frontend && npm test` — 705 passed。

`cd frontend && npm run build` — 成功。

## Test Isolation

全テストで`temp_projects`フィクスチャを使用し、`data/projects/`等の実データへは一切書き込んでいない（Issue #96の実データ書込み事故の再発防止方針に従う）。`git status`でtest実行後の実データ差分が無いことを確認済み。

## Documentation

- 本ドキュメント（新規）
- `docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`・`docs/workitems/trocr/ISSUE_MAP.md`を更新
- `docs/20_RELEASE_POLICY.md`（`allowed_engines`にtrocrを追加、モデル識別子・Benchmark照合方式の説明、テスト節を更新）

## Out of Scope（次Issue以降・既存の別課題として記録）

- **Model Card / Deployment Package生成**（`release_manager.py::build_model_card()`/`build_deployment_package()`）はTesseract専用の項目（`charset`/`base_lang`/`max_iterations`/`traineddata_path`等）がハードコードされており、TrOCR（およびPaddleOCR）モデルに対しては「未記録」表示の劣化した内容になる。クラッシュはしないが、内容として不正確。これはTrOCR固有の新規課題ではなく、Tesseract以外の全エンジンに既に存在する既存の制約であり、本Issueのスコープ外（「Release Gate framework全面再設計」に該当するため）
- ModelMetadata全面統合
- 新しい評価指標の発明
- TrOCR confidence推定
- Dataset schema変更
- Training/Benchmark/Evaluationの再設計
- Issue #8修正
- ユーザーマニュアル全面整備（Epic #27最終cleanup/documentationで扱う）
