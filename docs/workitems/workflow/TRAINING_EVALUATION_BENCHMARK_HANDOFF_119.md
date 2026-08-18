# Training → Evaluation → Benchmark Workflow Handoff 作業記録

Related: Investigation [#115](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/115)（OCR Crafter Next Development Roadmap） / Feature [#119](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/119) / Feature [#117](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/117)（Model Card / Deployment Package Multi-engine Parity、Completed） / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR Lifecycle） / Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46)（Engine UI Generalization）

**状態**: Completed / Closed。PR [#120](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/120)、Squash Commit `fca59c8`でマージ済み。

## 目的

Investigation #115のTheme 4（Training → Evaluation → Benchmark 結果引き継ぎUX改善）を実装する。既存のTraining/Evaluation/Benchmark各画面のstate isolationを維持したまま、明示的なユーザー操作による最小限のhandoffを追加する。

## 実装前調査（Mandatory Investigation）

### 1. Training completion flow

- `TrainingView.jsx`の`uiTrainingState === "completed"`ブロックが、Tesseract/PaddleOCR/TrOCR/分類学習いずれの完了時にも共通で表示される（Engine別に別ブロックへ分岐していない）ことを確認した
- `jobInfo`は`GET /api/ocr/train/status/{job_id}`（`db.py::fetch_training_job()`相当）の応答そのもので、`engine`/`id`/`training_family`/`model_path`を含む
- `model_path`はEngineごとに異なる実体を指す: Tesseract=`traineddata_path`（単一ファイル）、TrOCR=`result.artifact_dir`（ディレクトリ）。**いずれも`.tess.json`/`.ocr.json`/`.trocr.json`のsidecarファイル名そのものではない**ため、Evaluationの「登録済みモデル」選択（sidecar名で選択する`<select>`）へ直接使えないことを確認した
- 完了後、UIは既に「学習結果を確認」（Models画面）・「推論で試す」（Inference画面、**モデル識別子の引き継ちは元から無い**、Investigation #115の指摘どおり）の2アクションを提供している

### 2. Evaluation input contract

- `OcrEvaluationView`はTesseract/PaddleOCRについて「登録済みモデル」の`<select>`のみを持つ（sidecarファイル名が値）。TrOCRのみ「登録済み（metadata）/手動（manual）」の二択を持つ
- `POST /api/ocr/evaluate`のtarget構築（`lib/ocrEvalEngine.js::buildOcrEvalTargets()`）はTesseract=sidecar名、PaddleOCR=sidecar名、TrOCR=model_ref（metadataモードなら登録済み一覧から解決、manualモードなら直接値）を送信する
- 評価Datasetは`docs/00_PROJECT_OVERVIEW.md`の画面構成が示すとおり、学習Datasetとは別概念（「学習データ」と「評価データ」は別の作成フロー）であることを確認した。したがってTraining完了時点では評価Datasetを安全に特定できない

### 3. Evaluation completion flow

- `ocrEvalResult`（`/api/ocr/evaluate`応答）にはtargetごとの`engine`/`model`が残るが、これは実行時に選択したstate（`ocrEvalEngine`/`ocrEvalTrainedModel`等）と一致するため、handoffには応答を解析せず**現在の選択state自体をそのまま使う**方が単純で確実と判断した
- Model Card/Releaseへの接続はFeature #117で完了済み（本Issueでは変更しない）

### 4. Benchmark input contract

- `BenchmarkView.jsx`の`selectedEngines`/`selectedModel`/`selectedPaddleModel`/`benchTrocr*`は**すべてコンポーネント内部の`useState`**であり、App.jsxから直接setterを呼べない（既存の意図的な設計、TrOCR State Isolationの既存コメント参照）
- `services/benchmark.py::ENGINE_CATALOG`を確認した結果、**EasyOCRは`implemented: False`**（未導入・利用不可）であり、Benchmark Runnerに実行経路が存在しないことを確認した。フロントエンドの`BenchmarkView.jsx`にも`easyocr`向けの専用UIやspec構築ロジックが一切無く、`buildRunPayload()`もeasyocrのspecを一切push しない
- Benchmarkの登録済みモデル選択肢（`selectedModel`=Tesseract、`selectedPaddleModel`=PaddleOCR）は、いずれもApp.jsxが提供する`ocrModels`（sidecarファイル名の配列）をsuffixでフィルタしたものであり、Evaluationの「登録済みモデル」選択と同じ値空間（sidecarファイル名）を共有していることを確認した

### 5. Existing navigation/state pattern

- Dataset Manager/Experiments画面の`onOpenModel`/`onOpenExperiment`は、`{name/id, seq: Date.now()}`という**detailRequestパターン**をApp.jsxで生成し、target画面が`useEffect(() => {...}, [detailRequest?.seq])`で消費する既存の確立された設計であることを確認した（`ModelsView.jsx`/`DatasetManagerView.jsx`/`ExperimentsView.jsx`）
- Evaluation（`ocrEval*`）のstateはApp.jsxへリフトされているため、Training→Evaluationは**detailRequestパターンを使わず、対象のsetterを直接呼ぶだけで足りる**と判断した
- Benchmark（`benchTrocr*`等）のstateはコンポーネント内部stateのため、Evaluation→Benchmarkは既存detailRequestパターンと同型の**`handoffRequest`（`{..., seq}`）**をBenchmarkView自身が`useEffect`で消費する設計とした（新しいpatternを発明しない）

### 発見: 既存の別バグ（本Issueでは修正しない）

Evaluationの「登録済みモデルから選択」（`trocrModelSource==="metadata"`）モードは`GET /models/info`由来の`trocrModels`（`lib/trocrModelMetadata.js::extractTrocrModels()`）を参照するが、`/models/info`は`.trocr.json`をglobしない（Issue #96で意図的に未統合、`model_registry.py`のモジュールdocstring参照）ため、**この一覧は実運用上常に空になる**。`trocrModelMetadata.js`自身のコメントも「TrOCR学習・モデル登録の仕組みが実装されるまでの既知の状態」と記載しているが、TrOCR学習（Issue #90-#106）は既に実装済みであり、このコメント自体が古い。本Issueのhandoff実装では、この既存バグの影響を避けるため**TrOCRのhandoffは常にmanualモード（model_ref直接指定）**を使う設計とした（§Design Decisions参照）。このEvaluation画面自体の既存バグ修正は本Issueのscope外としてFuture Workへ記録する。

## Engine Matrix

| Handoff | Tesseract | PaddleOCR | EasyOCR | TrOCR |
|---|---|---|---|---|
| Training → Evaluation | implemented | implemented | N/A（学習エンドポイント自体が存在しない） | implemented |
| Evaluation → Benchmark | implemented | implemented | **unsupported**（Benchmark Runnerに実行経路が無い、`ENGINE_CATALOG`で`implemented: False`） | implemented |
| registered model handoff | implemented（job_id逆引き） | implemented（job_id逆引き） | N/A | N/A（既知バグのため未使用、常にmanualへ変換） |
| manual model_ref handoff | N/A（EvaluationのTesseract/PaddleOCRにmanualモード自体が無い） | N/A（同左） | N/A | implemented |
| dataset handoff | Training→Eval: N/A（学習/評価Datasetは別概念）。Eval→Benchmark: implemented | 同左 | N/A | 同左 |

## State Ownership / Handoff Contract

| 画面 | state所有 | handoff方式 |
|---|---|---|
| TrainingView → App.jsx | `jobInfo`（App.jsx）| App.jsxの`sendTrainingResultToEvaluation(jobInfo)`が直接`ocrEval*`のsetterを呼ぶ（Evaluation stateはApp.jsx所有のため） |
| OcrEvaluationView → App.jsx → BenchmarkView | `ocrEval*`（App.jsx）→ `benchmarkHandoffRequest`（App.jsx、`{..., seq}`）→ BenchmarkView内部state | App.jsxの`sendEvaluationResultToBenchmark()`が`resolveEvaluationBenchmarkHandoff()`で解決し、`benchmarkHandoffRequest`をセット。BenchmarkViewが`useEffect([handoffRequest?.seq])`で内部stateへ反映 |

## Design Decisions

1. **明示的handoffのみ**: 「評価へ」「Benchmarkへ」はいずれもユーザーのボタンクリックでのみ発火する関数から呼ばれる。画面を開いただけで別画面のstateを書き換えるuseEffectは追加していない
2. **job_id逆引きによる正確なモデル識別**（推測しない）: Training完了直後の`jobInfo.id`と、モデル一覧の`job_id`フィールドが一致するものだけを引き継ぐ。一致するモデルが無ければ空のまま遷移し、ユーザーへ選択を委ねる（通知でも案内する）
3. **`job_id`を`list_model_infos()`へ追加**（Backend最小変更）: Tesseract/PaddleOCRの`/models/info`には元々`job_id`が公開されておらず、正確な逆引きができなかった。既存キーの変更・削除は無い、追加のみの後方互換な変更
4. **TrOCRは常にmanualモードで引き継ぐ**: Evaluationの「登録済み」モードが既知のバグで機能しないため（§発見参照）、Training→Evaluation・Evaluation→Benchmarkのいずれも、TrOCRは解決済みの`model_dir`/`model_ref`を直接manualモードへ設定する
5. **Evaluation→Benchmarkのengineマッピングは固定テーブル**: `tesseract→tesseract_model`・`paddleocr→paddleocr_custom`・`trocr→trocr`。`easyocr`はマッピングを持たず、handoff関数が`null`を返す（呼び出し側はボタン自体を表示しない）
6. **"latest"（Evaluation固有の特殊値）はBenchmarkへ引き継がない**: Benchmarkの登録済みモデル選択肢には「latest」という概念が無いため、推測でモデル名へ変換せず空のまま遷移する
7. **Benchmarkの既存選択状態は保持する**: handoff時、対象engineのチェックボックスのみONにし、他のチェックボックス・値は変更しない（Design Principle #2）。datasetは引き継げた値のみ上書きし、未指定の項目は既存のBenchmark設定を維持する

## Production Changes

- `src/app/services/model_registry.py`: `list_model_infos()`の`.tess.json`/`.ocr.json`分岐へ`"job_id"`キーを追加（既存キーの変更・削除は無い）
- `frontend/src/lib/trainingEvaluationHandoff.js`（新規）: Training完了jobから、Evaluationへ引き継ぐモデル識別子を解決する純粋関数
- `frontend/src/lib/evaluationBenchmarkHandoff.js`（新規）: Evaluation設定から、BenchmarkへのEngine key・モデル識別子・Datasetを解決する純粋関数
- `frontend/src/views/TrainingView.jsx`: 完了パネルへ「評価へ」ボタンを追加（`jobInfo.training_family === "ocr"`かつ対応engineの場合のみ表示）
- `frontend/src/views/OcrEvaluationView.jsx`: 評価結果パネルへ「Benchmarkへ」ボタンを追加（`engine !== "easyocr"`の場合のみ表示、結果が無い間は無効）
- `frontend/src/views/BenchmarkView.jsx`: `handoffRequest`prop・`useEffect`を追加し、内部stateへ反映する
- `frontend/src/App.jsx`: `benchmarkHandoffRequest`state・`sendTrainingResultToEvaluation()`・`sendEvaluationResultToBenchmark()`を追加

`src/app/services/ocr_evaluation.py`・`evaluation_dispatcher.py`・`benchmark.py`・`db.py`（Training Job Lifecycle）・`release_gate.py`・`model_registry.py`の既存ロジック（job_id追加以外）はいずれも無変更。`/api/ocr/evaluate`・Benchmark実行APIのsemanticは変更していない。

## Compatibility

- `list_model_infos()`の既存消費側（Models画面・Model Card・Release Gate等）は新規キー`job_id`の存在に依存しないため無変更のまま動作する（既存テストが無変更で全件パス）
- TrainingView/OcrEvaluationView/BenchmarkViewの既存props・既存stateはいずれも削除・変更していない（新規props・新規stateの追加のみ）
- Handoffを使わない通常のnavigation（サイドバークリック等）では、いずれの新規stateも変化しない（`benchmarkHandoffRequest`は初期値`null`のまま）

## Tests

### Backend（3件追加、`tests/test_model_info_job_id.py`新規）
- Tesseract/PaddleOCRの`job_id`公開確認、既存キーへの回帰無し確認
- job_id未記録の旧モデルは空文字（エラーにしない）

### Frontend（26件追加）
- `lib/trainingEvaluationHandoff.js`: 8テスト（Tesseract/PaddleOCR/TrOCR解決・未一致・jobId空・EasyOCR対象外・未知engine・引数省略時の安全性）
- `lib/evaluationBenchmarkHandoff.js`: 9テスト（3engine解決・"latest"特殊値・TrOCR manual/metadata・EasyOCR unsupported・未知engine・dataset未指定・引数省略時の安全性）
- `TrainingView.jsx`: 4テスト（3engine表示確認・classification非表示・情報欠損時非表示）
- `OcrEvaluationView.jsx`: 3テスト（結果無し時disabled・3engine表示・EasyOCR非表示）
- `BenchmarkView.jsx`: 2テスト（handoffRequestありなしでクラッシュしない、既存挙動回帰確認）

実行結果:

```
python -m pytest -q
# 1328 passed（既知failureなし）

cd frontend && npm test
# 731 passed

cd frontend && npm run build
# 成功
```

## Scope外（Explicit Non-goals、実施しなかったこと）

- Training/Evaluation/Benchmark stateの完全共有化
- Redux等の新しいglobal state framework導入
- URL router全面導入
- EvaluationとBenchmark backend architectureの統合
- Job Lifecycle統合
- `jobs.json` → SQLite移行
- Epic #28 Consumer Migration
- UI全面redesign
- 自動でEvaluation/Benchmarkを連続実行するpipeline/job orchestration

## Future Work

- Evaluationの「登録済みモデルから選択」（TrOCR、`trocrModelSource==="metadata"`）モードが`/models/info`経由のため実運用上常に空になる既存バグ（`lib/trocrModelMetadata.js`）。修正する場合は`extractTrocrModels()`が`trocrTrainedModels`（`/api/trocr/models`）を参照するよう変更する必要があるが、Evaluation画面のTrOCR回帰確認を伴う別Issueとして起票すべき
- Training→Inference（`onOpenInference`）も現状モデル識別子の引き継ぎが無い（Investigation #115で確認済みの別ギャップ）。本Issueのscopeには含まれていない
