# OCR Crafter Next Development Roadmap — Investigation #115 作業記録

Related: Investigation [#115](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/115) / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR Lifecycle、Completed） / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure、Open・保留継続） / Investigation [#108](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/108) / Bug [#8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8) [#112](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/112)（Completed）

**状態**: Completed / Closed（Investigation/Documentation only、Productionコード変更なし）。PR [#116](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/116)、Squash Commit `a3900c4`でマージ済み。

## 目的

Epic #27がCompleted、Issue #8/#112のテストDB isolation問題が解消、Issue #87が重複整理済みとなった現時点で、既存Epic #28を無理に再開せず、OCR Crafter全体から次の高価値開発テーマを選定する。

## 1. Current Product Capability Map

`docs/00_PROJECT_OVERVIEW.md`（既存ドキュメント）が機能一覧を網羅的に維持しているため重複作成はせず、実コードから以下を実測・再確認した。

| 領域 | 実装状況 | 根拠 |
|---|---|---|
| Project / Dataset Management | 実装済み・実運用レベル | `project_paths.py`、`dataset_registry.py` |
| OCR Dataset creation / preprocessing | 実装済み・実運用レベル（前処理スナップショット・ハッシュ管理込み） | `preprocess.py`、`preprocess_snapshot.py` |
| Training: Tesseract | 実装済み・実運用レベル（E2E確認済み、`test_tesseract_e2e.py`） | `tesseract_pipeline.py`（714行） |
| Training: PaddleOCR | 実装済み・実運用レベル | `ocr_pipeline.py`（2401行） |
| Training: EasyOCR | **未実装**（`main.py`にEasyOCR学習エンドポイントが存在しない。EasyOCR本体が実用的なfine-tuning APIを提供していないための設計判断、推論・評価のみ対応） | grep確認: `main.py`にEasyOCR学習経路なし |
| Training: TrOCR | 実装済み・実運用レベル（Epic #27、Issue #90-#106で完了） | `trocr_training_core.py`、`trocr_model_registry.py` |
| Inference | 実装済み・実運用レベル（4エンジン: custom/EasyOCR/PaddleOCR/Tesseract/TrOCR） | `predict.py` |
| Evaluation | **2経路が意図的に共存**（詳細は§4） | `ocr_evaluation.py`（Tesseract専用legacy）＋ `evaluation_dispatcher.py`/`evaluation_runner.py`（Multi-engine、Issue #61-#79） |
| Benchmark（Runner） | 実装済み・実運用レベル（4エンジン中3実装済み、EasyOCRは「未導入・利用不可」と明示） | `benchmark.py`（949行） |
| Release Gate | 実装済み・実運用レベル（Tesseract/PaddleOCR/TrOCR対応、Issue #104） | `release_gate.py`（400行） |
| Models / Artifact Management | 実装済みだが**Legacy sidecar形式が分散**（`.tess.json`/`.ocr.json`/`.trocr.json`、Canonical Metadata基盤は未配線・Investigation #108で意図的保留） | `model_registry.py`（823行） |
| Experiment / lineage | 実装済み・実運用レベル（`parent_model_id`保存済みだが系譜ツリー表示は未実装） | `experiment_tracker.py`、`docs/10_KNOWN_LIMITATIONS.md` |
| Engine Registry / Capability | 実装済み・実運用レベル（Issue #55-#57で確立、Frontend/Backend双方から参照） | `engine_registry.py`、`docs/design/ENGINE_REGISTRY.md` |
| Frontend screens / navigation | 21画面、ワークフロー順サイドバーグループ化済み | `frontend/src/views/`（21ファイル） |
| API surface | `main.py`に140+エンドポイント集約（単一ファイル、5068行） | `src/app/main.py` |
| Background jobs / cancellation / progress | **2つの独立したJob機構が併存**（詳細は§4） | `job_manager.py`、`db.py`（training_jobs） |

「実装済み」と「実運用で十分使える」の区別: Tesseract/PaddleOCR/TrOCRの学習・評価・Benchmark・Release Gateはいずれも実データでのE2E確認・回帰テストが揃っており実運用レベルと判断した。EasyOCRは推論・評価・Benchmark（実行可能）まで対応するが学習は非対応（上流ライブラリの制約であり、本アプリ側の実装漏れではない）。

## 2. End-to-end User Journey Review

代表フロー（Project作成→Dataset登録→OCR Dataset生成→Training→Evaluation→Benchmark→Release Gate→Inference）を画面遷移・API呼び出しの単位で追跡した。

| Step | 必要画面/API | 手動作業・重複入力 | Engine差異 |
|---|---|---|---|
| Project作成 | DashboardView / `POST /projects` | 無し | 無し |
| Dataset登録 | ImagesView / `POST /images/import` | フォルダ選択（手動） | 無し |
| OCR Dataset生成 | LabelingView・PreprocessView・TrainingImageBuilderView / `dataset_creation` Job | ラベル付け（手動、本質的に不可避） | 無し |
| Training | TrainingView / `/api/ocr/train/start`（PaddleOCR）・専用endpoint（Tesseract・TrOCR） | **charset/学習率/バッチサイズ等をEngineごとに別UIブロックで再入力**（Registry駆動で表示切替はされるが、値自体の使い回しは無い） | 大（3エンジンで別endpoint・別state命名規則`ocrTrocr*`等） |
| Evaluation | OcrEvaluationView / `/api/ocr/evaluate` | モデル選択・Engine選択を毎回実施 | 中（Dispatcher経由で統一されたが選択UIはEngineごとのブロックが並ぶ） |
| Benchmark | BenchmarkView / `/api/benchmark/*` | Evaluation済みモデルの再選択（Evaluationの結果を引き継がない） | 中 |
| Release Gate | ReleasesView / `/api/releases/*` | Benchmark結果のmodel_ref/sidecar名の対応関係はバックエンドで自動解決済み（Issue #104） | 小（解決済み） |
| Inference | InferenceView / `/predict` | モデル選択 | 小 |

**確認できた詰まり**: Training→Evaluation→BenchmarkでモデルやDataset選択を毎回やり直す（結果の引き継ぎが無い）。Benchmark Centerが横断比較を提供するが、これは「実行後の比較」であり「次に何を実行すべきか」の導線ではない。失敗時の復旧性は各画面でおおむね良好（Job管理画面でステータス確認・再実行可能）。

## 3. UI/UX Gaps

- **Engineごとの設定分散**: Training/Evaluation/Benchmark/Inferenceそれぞれで、Engine別のstateブロックが画面ごとに独立命名されている（`ocrTrocr*`/`inferTrocr*`/`ocrEvalTrocr*`/`benchTrocr*`）。意図的な設計判断（画面間の副作用分離）だが、新Engine追加のたびに4画面すべてへ同型の実装を複製する必要がある。
- **Model selection一貫性**: 画面ごとに「登録済みモデルから選択」/「model_refを直接入力」の2モード切替が概ね統一されているが、統一パターン自体がドキュメント化されていない（各PRで個別に実装判断）。
- **Training→Evaluation→Benchmark間の導線**: 前工程の選択結果を次工程へ引き継ぐUIが無い（§2参照）。
- **実行結果の比較・履歴確認**: Benchmark Center・Experiment比較・Model比較（最大3件）がそれぞれ独立して存在し、横断ナビゲーションは限定的（相互リンクはあるが「今見ている結果からもう一方を開く」体験は非対称）。
- **進捗表示**: Job管理画面は0-100%＋イベント履歴で充実。一方 `/api/ocr/evaluate` は同期APIで段階進捗が無い（`docs/10_KNOWN_LIMITATIONS.md`記載の既知制約、継続）。
- **大量データ操作性**: Benchmark詳細は50件/ページングで対応済み。Dataset Manager・Models一覧のページング状況は個別確認が必要（本調査のスコープでは未確認、Future Work）。

## 4. Backend / Architecture Gaps

### 4.1 Job Lifecycle: 2つの独立した機構が併存

- **`training_jobs`テーブル（`db.py`）+ subprocess方式**: Tesseract/PaddleOCR/TrOCR/分類学習が使用。`job_runner.py`をsubprocessとして起動し、`worker_pid`をSIGTERMでキャンセル。
- **`job_manager.py`の`JobWorker`（単一daemon thread）+ `data/jobs/jobs.json`**: Benchmark/Evaluation（旧経路）/preprocess/dataset_creationが使用。JOB-000001形式・状態遷移検証・進捗0-100%。

両者は永続化方式・並行性モデル・キャンセル方式のいずれも異なり、共通の抽象化が無い。Issue #8/#112で明らかになった「DBが初期化されていないテストが実DBへ副作用を及ぼす」問題は、この二重構造の複雑さが一因（学習系のtry/exceptフォールバックが`training_jobs`を無条件参照していたため）。

### 4.2 Evaluation: 2経路が意図的に共存（重複ではなく設計判断）

`api_ocr_evaluate()`は全targetが`tesseract`の場合のみ既存`evaluate_ocr()`（legacy）を呼び、1つでも非tesseractが含まれる場合は`run_multi_engine_evaluation()`（Issue #79のDispatcher/Runner/Predictor経由）を呼ぶ。既存の後方互換を壊さないための明示的な設計判断であり、コード上のコメントにも理由が記載されている。ただし`docs/10_KNOWN_LIMITATIONS.md`の「OCRモデル評価はTesseract専用」という既存記述は、この2経路併存の実態を反映しておらずやや古い（Multi-engine Evaluation API完成前の記述のまま）。

### 4.3 Model Metadata: Legacy sidecar形式の分散（Epic #28スコープ、意図的保留中）

`.tess.json`/`.ocr.json`/`.trocr.json`の3形式が並存。Canonical Metadata基盤（`model_metadata.py`ほか）は実装済みだがConsumer未配線（Investigation #108で確認済み、既存Legacyパスが機能している限り保留の方針）。

### 4.4 巨大ファイル（継続的な技術的負債）

`main.py`（5068行）・`App.jsx`（5169行）・`ocr_pipeline.py`（2401行）はいずれも機能追加のたびに増加を続けている（`docs/10_KNOWN_LIMITATIONS.md`記載の既知事項、本調査で行数を再測定し悪化を確認: main.py 約4830→5068行、App.jsx 約4920→5169行）。

## 5. Quality / Reliability

- Issue #8/#112で解消済みの問題（テストの実DB依存）は再度Issue化しない（Issue本文の指示どおり）。
- 現在のテストスイート: backend 75ファイル・1318テスト（ローカル実行は全件pass、CIはtesseract本体等未導入のため8件skip）。frontend 67ファイル。
- flaky testsの新規発生は本調査時点で確認されなかった（Issue #108/#110/#112それぞれのマージ時に確認した既知Issue #8の1件のみが唯一のflake、既に解消済み）。
- CI: Docker化・CD未整備（既知、`docs/10_KNOWN_LIMITATIONS.md`記載のまま変化なし）。
- atomic write: `atomic_io.py`（`atomic_write_json`/`file_lock`）が`releases.json`/`experiments.json`/`inference_model.json`/`model_ids.json`で再利用されており、基本的なpartial write対策は既に存在する。

## 6. Performance / Scale

`docs/26_PERFORMANCE_LIMITS.md`（2026-07-23実測）が既に詳細な負荷試験結果とSQLite移行計画を持っている。本調査時点で追加の実測は行っていないが、同ドキュメントの記載内容と現在のコードとの整合性を確認した結果、記載内容は現在も有効と判断した。

- **`jobs.json`のJob作成・更新が約600ms@10,000件**で最も限界に近い（移行計画は既にドキュメント化済み・未実装）。
- `audit.jsonl`・`benchmarks.json`のcasesも大規模時に線形悪化するが、現状の運用規模（保持日数設定あり）では実用範囲内。

## 7. Documentation / Operations

- `docs/00_PROJECT_OVERVIEW.md`・`docs/16_SCREEN_SPEC.md`・`docs/USER_GUIDE.md`・`docs/QUICK_START.md`・`docs/FAQ.md`はいずれもTrOCR対応（Issue #106）で更新済み・現在のmain実装と整合していることを確認した。
- `docs/10_KNOWN_LIMITATIONS.md`の「OCRモデル評価はTesseract専用」の記述はやや古い（§4.2参照）。本Issueの対象外のため本ドキュメントでは修正せず、Future Workとして記録する。
- `docs/13_QA_STATUS.md`（2026-07-07付）記載の「後始末」項目（一時退避フォルダ・`.git` dangling blob等）はユーザー判断待ちのまま現在も未解決。本調査でも状態変化は確認できなかった（削除は行っていない）。
- **Model Card / Deployment Package**: `docs/USER_GUIDE.md`に既知の制約として明記済み。「Tesseract向けの項目（charset・PSM・traineddata等）を前提とした内容になっており、PaddleOCR/TrOCRモデルでは該当項目が『未記録』表示になる」（エラーにはならないが、UXとして未完成）。

## 8. Epic #28 Reassessment Trigger

Investigation #108の結論（Consumer Migrationは既存Legacyパスが機能している限り着手を見送る）を再評価した結果、以下のいずれの再開トリガーも本調査時点で確認できなかった。

- 複数画面/APIで同一model metadata不整合が顕在化 → 未確認（Release Gate/Benchmark/Evaluationの相互解決はエンジンごとの専用ロジックで個別対応済み、§4.3）
- TrOCRを含むmodel listingの重複修正が頻発 → Issue #96/#98/#102/#104/#110は計画的な段階的統合であり「頻発する場当たり修正」には該当しない
- Release/Inference/Evaluationでidentity不整合 → 未確認
- 新Engine追加がlegacy sidecar増加を要求 → 現在4エンジン体制から新規追加の具体的な計画は無い

**結論: Epic #28の再開は推奨しない。保留継続。** 次にトリガーとなり得るのは「5つ目のOCR Engine追加」または「Legacy sidecar形式に起因する具体的なバグ報告」であり、いずれも現時点で発生していない。

## Candidate Themes

調査結果から4テーマへ絞った。

### Theme 1: Model Card / Deployment Package Multi-engine Parity

PaddleOCR/TrOCRモデルのModel Card・Deployment Packageが「未記録」表示に留まっている項目（charset相当・学習パラメータ等）を、各エンジンの実データから可能な範囲で補完する。

### Theme 2: Job Lifecycle Unification（Architecture Investigation止まりを推奨）

`training_jobs`テーブル方式と`job_manager.py`方式の2系統を統合する設計を検討する。ただし本調査では実装着手を推奨しない（§Prioritization参照）。

→ Architecture Investigation [#123](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/123)として実施済み。詳細は[JOB_LIFECYCLE_UNIFICATION_ARCHITECTURE_123.md](../jobs/JOB_LIFECYCLE_UNIFICATION_ARCHITECTURE_123.md)を参照。結論: 統合実装は依然として非推奨、まず個別のreliability gap（startup reconciliation欠如）を単独Bug Issueとして解消することを推奨。

### Theme 3: `jobs.json` → SQLite移行（Performance Limits既存計画の実行）

`docs/26_PERFORMANCE_LIMITS.md`が既に設計済みの移行計画（`JobRepository`インターフェース固定済み）を実行する。

### Theme 4: Training→Evaluation→Benchmark 結果引き継ぎUX改善

前工程で選択したモデル・Datasetを次工程画面へ引き継ぐ導線を追加する（§2で確認した詰まりの解消）。

## Prioritization Matrix

| # | テーマ | User Value | Frequency | Reliability Impact | Tech Debt削減 | Implementation Cost | Regression Risk | 依存 |
|---|---|---|---|---|---|---|---|---|
| 1 | Model Card/Deployment Package Multi-engine Parity | 4 | 3 | 2 | 2 | 2 | 2 | Epic #27完了済み（依存なし） |
| 2 | Job Lifecycle Unification | 3 | 5 | 4 | 5 | 5 | 5 | 専用Architecture Investigationが先行必須 |
| 3 | jobs.json → SQLite移行 | 2 | 3 | 3 | 4 | 3 | 3 | 既存移行計画あり（依存なし） |
| 4 | Training→Evaluation→Benchmark結果引き継ぎUX | 4 | 4 | 2 | 2 | 3 | 3 | Engine Registry確立済み（依存なし） |

**推奨理由**:

- **Theme 1を最優先で推奨する。** Implementation CostとRegression Riskが最も低く（既存`report_generator.py`/`release_manager.py`への追加のみ、Release Gate自体のロジックは変更しない）、Epic #27完了直後の自然な仕上げとして高いUser Valueを持つ。既存のTesseract専用実装パターンを参考にでき、設計の不確実性が低い。
- Theme 4はUser Value・Frequencyともに高いが、3画面（Training/Evaluation/Benchmark）にまたがる状態受け渡し設計が必要でCostがやや高い。Theme 1完了後の次候補として推奨する。
- Theme 3は既存計画があり技術的難易度は中程度だが、現在の運用規模（保持日数設定運用）では緊急性が低い。ロードマップ上の「計画済みだが未着手」の技術的負債として記録し、Job件数が実際に増大した時点で着手を推奨する。
- Theme 2はUser Value/Frequency/Tech Debt削減の観点で最も価値が高いが、Implementation CostとRegression Riskが突出して高い（ほぼ全機能が経由する中核コンポーネントの置き換え）。**いきなりFeature実装へ進まず、専用のArchitecture Investigation Issueを先に起票することを推奨する。**

## Recommended GitHub Output

**単独Feature Issueを先に実施すべき（Theme 1: Model Card / Deployment Package Multi-engine Parity）。**

Epic新設は不要（Epic #27の残存タスクとして、または独立したFeature/Choreとして起票可能な小粒度）。Epic #28再開は推奨しない（§8）。Theme 2（Job Lifecycle Unification）は将来的にEpic化する価値があるが、まず専用のArchitecture Investigation Issueで設計・移行戦略・リスクを確定させてからにすべきである。

## Out-of-scope / Deferred Items

- `docs/13_QA_STATUS.md`記載の後始末項目（一時退避フォルダ・`.git` dangling blob）: ユーザー判断待ちのまま継続保留
- `docs/10_KNOWN_LIMITATIONS.md`の「OCRモデル評価はTesseract専用」記述の是正: 本調査で古さを確認したが、本Issueでは修正しない（Future Work）
- Dataset Manager・Models一覧の大量データ操作性の詳細確認: 本調査のスコープでは未実施
- モデル系譜可視化（parent_model_id tree表示）・評価履歴の複数保持: 既存Known Limitationsに記載済み、優先度は今回のCandidate Themesに含めなかった（User Value/Frequencyが相対的に低いと判断）
