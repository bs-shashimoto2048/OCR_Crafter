# OCR Crafter Next Development Roadmap Refresh — Investigation #139 作業記録

Related: Investigation [#139](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/139) / Investigation [#115](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/115)（Next Development Roadmap、Completed。本Investigationの前回版） / Investigation [#108](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/108)（Epic #28 Consumer Migration再評価、Completed） / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure、Open・保留継続）

**状態**: Implemented, PR review pending（Investigation / Documentation only。Production実装は無し）

## 目的

Investigation #115で策定したRoadmapの主要推奨事項（#117/#119/#121/#123系/#137）が完了し、Job Lifecycle関連の一連の改善も#135で完結したため、現在mainを正として次の開発優先順位を再評価する。

## Completed Since #115（確認済み）

`gh issue list`/各workitem docで実際にClosed・mainへ反映済みであることを確認した。

| Issue | 内容 | 状態 |
|---|---|---|
| #117 | Model Card / Deployment Package Multi-engine Parity | Completed |
| #119 | Training → Evaluation → Benchmark Workflow Handoff | Completed |
| #121 | TrOCR Evaluation/Inference registered-model選択修正 | Completed |
| #123 | Job Lifecycle Unification Architecture Investigation | Completed |
| #125 | Training Job Startup Reconciliation Parity | Completed |
| #127 | JobRepository jobs.json → SQLite migration | Completed |
| #129 | Windows Training Process Termination Investigation | Completed |
| #131 | Frontend Job Display Contract Unification | Completed |
| #133 | Windows Training Process Tree Termination | Completed |
| #135 | Shared Job Facade Readiness（Backend Facade不要、Option A） | Completed |
| #137 | PaddleOCR Release Gate Benchmark Linkage | Completed |

`gh issue list --state open`で確認した現在のOPEN Issueは、本Investigation（#139）自身とEpic #28のみである。

## 1. Product Capability Delta（#115時点との差分）

| 領域 | #115時点 | 現在 |
|---|---|---|
| Training | Tesseract/PaddleOCR/TrOCR実装済み、EasyOCR未実装（変更なし） | 変更なし。加えてTraining Job（System A）のstartup reconciliation（#125）・Windows process tree termination（#133）でreliabilityが向上 |
| Inference | 4エンジン対応（変更なし） | 変更なし（InferenceViewのTrOCR registered-model選択バグは#121で修正済み） |
| Evaluation | 2経路共存（Tesseract専用legacy／Multi-engine dispatcher） | 変更なし。TrOCR Evaluationの登録済みモデル選択バグは#121で修正済み |
| Benchmark | 実装済み（3/4エンジン） | 変更なし。PaddleOCR自作モデルのRelease Gate連携は#137で修正済み |
| Release Gate | Tesseract/PaddleOCR/TrOCR対応 | PaddleOCR Benchmark evidence接続の既知gapを#137で解消 |
| Model Card / Deployment Package | Tesseract専用ハードコードが残存（#115時点の既知課題） | #117でMulti-engine parity達成済み |
| Job lifecycle | training_jobs（System A）とjob_manager（System B）が二重契約のまま | #125/#127/#129/#131/#133/#135で個別のreliability gapを解消。Backend統合自体は#135の結論により見送り継続（意図的） |
| Frontend workflow handoff | Training→Evaluation→Benchmarkの引き継ぎ導線なし | #119で実装済み。Job一覧・詳細の表示契約重複も#131で解消済み |

## 2. Remaining UX Gaps

### 2.1 TrOCRモデルがModel Manager画面に表示されない（既知の制約、継続）

`GET /models/info`（`model_registry.py::list_model_infos()`）は`.trocr.json`を一切globしない（Issue #96で意図的に未統合、Investigation #108・Issue #121で繰り返し確認済み）。`docs/USER_GUIDE.md`（267行目）は既にこれを「現時点では既知の制約」として明記しており、**ドキュメントと実装は一致している**（新たな不一致ではない）。

本Investigationで新たに確認した具体的な影響範囲:

- `download_model_endpoint()`（`main.py:4297`）: `.trocr.json`は明示的に対象外（`if not safe_name.endswith(".ocr.json"): raise HTTPException(400, "only .pt, .ocr.json and .tess.json are downloadable")`）
- `delete_model()`（`model_registry.py:605`）: `.trocr.json`は`is_pt`/`is_ocr_meta`/`is_tess_meta`のいずれにも該当せず、削除できない（`ValueError("only .pt, .ocr.json and .tess.json model files can be deleted")`）

**現状、学習済みTrOCRモデルをOCR Crafter上から削除・ダウンロードする手段が一切存在しない**（ファイルシステムを直接操作する以外に方法がない）。Model Manager画面自体が`.trocr.json`を一覧に含めないため、この制約はUI上では「ボタンが出ない」形で隠れているが、TrOCRモデルの運用（不要モデルの整理・バックアップ用ダウンロード）ができないという実運用上の不便として残っている。

### 2.2 Training/Evaluation/Benchmark/Release間の次アクション導線

#119で主要な引き継ぎ（Training→Evaluation→Benchmark）を実装済み。Release Gateへの導線（Benchmark/Evaluation結果からRelease判定画面への直接遷移）は本Investigationの調査範囲では未実装のまま確認したが、Release管理画面自体がProjectごとの全モデルを一覧表示する設計のため、致命的なUX gapではないと判断する。

### 2.3 Model selection一貫性

#121でTrOCRのInference/Evaluationの登録済みモデル選択が修正され、Training/Benchmarkと同じデータソース（`GET /api/trocr/models`）へ統一済み。現在、Model selection UIの一貫性に関する既知の未解決issueは確認できなかった。

### 2.4 Job status/error presentation

#131でFrontend表示契約が部分共通化済み。TrainingViewとJobsViewは意図的に別画面のまま（#131のDesign Decision）であり、これは既存UXを維持する意図的な設計判断として妥当と判断する。

## 3. Remaining Backend Gaps

### 3.1 Legacy Evaluation Job Typeの実際の到達経路が依然として未特定

Architecture Investigation #123・Feature #127・Investigation #135のいずれでも、`job_manager.py`の`job_type="evaluation"`が実際にどのdedicated endpointから到達するのか特定できていない（3回連続で「Future Work」として記録されたまま）。本Investigationで`main.py`を再確認したが、`job_type="evaluation"`でjobを作成するdedicated endpoint（`POST /api/benchmarks`・`POST /api/reports/generate`に相当するもの）は依然として見つからなかった。既存のLegacy Evaluation（Tesseract専用、`ocr_evaluation.py`）は同期API（`POST /api/ocr/evaluate`等）経由で完結しており、Job System B経由の評価パスが実運用で使われている形跡は無い。**3回の調査で毎回未解決のまま持ち越されている**ため、次回Issue化する際は「本当に到達経路が存在するか」を確定し、存在しなければ`JOB_HANDLERS["evaluation"]`をdead codeとして扱うか削除を検討すべき、という一段強い扱いへ格上げする。

### 3.2 Artifact cleanup / model deletion既知課題（`docs/10_KNOWN_LIMITATIONS.md`記載、継続）

`docs/13_QA_STATUS.md`由来の既知課題として、`delete_model()`のガードに以下が既に記録されている（本Investigationで再確認、変更なし）:

- 手編集メタが共有親ディレクトリを指す場合に配下の他モデルも削除しうる余地
- 相対パスメタがCWD基準でresolveされ削除スキップになる（fail-safe側の挙動）
- `rmtree`の封じ込めが3方式併存（`safe_rmtree`/`allowed_roots`/`relative_to`）→統一が望ましい

これらは新規発見ではないが、#115以降も未着手のまま残っている。

### 3.3 legacy sidecar分岐の分布（Epic #28再開トリガー評価の根拠、§7参照）

`grep`で`.tess.json`/`.ocr.json`/`.trocr.json`のsuffix判定分岐を数えたところ、8ファイル・25箇所に分布していることを確認した（`model_registry.py`7・`report_generator.py`4・`release_gate.py`4・`release_manager.py`3・`metadata_reader.py`3・`main.py`2・`ocr_pipeline.py`1・`benchmark.py`1）。詳細は§7参照。

### 3.4 DB backup/restore

`data/jobs/`（Job System B、#127でSQLite化済み）は引き続きバックアップ対象外として明記されている（`docs/25_DISASTER_RECOVERY.md`、システム全体データのため）。#127のSQLite移行前後でこの方針に変更は無く、新たな整合性gapは確認できなかった。

### 3.5 report generation / export/deployment package

本Investigationの調査範囲では、#117で対応済みのMulti-engine parity以外に新たな具体的gapは確認できなかった。

## 4. Reliability / Operations

### 4.1 環境依存の既知test failure（flakyではない）

本Investigationおよびこれまでのセッションで繰り返し観測した通り、ローカル開発環境（`ci_sim_venv`）で`transformers`/`ultralytics`が未インストールのため、以下10件が一貫して失敗する: `test_benchmark_trocr.py`/`test_trocr_engine.py`/`test_trocr_evaluation_predictor.py`（各1件）・`test_yolo_detect.py`（7件）。**これはflaky（不安定）ではなく、決定的な環境依存failureである**（同一条件で常に同じ結果になることを、Issue #125〜#137にかけて毎回のfull suite実行で確認済み）。実際のCI（GitHub Actions）ではこれらのパッケージがインストールされておりgreenになる。CLAUDE.mdの「CI/Known Failure」節は現在「許容される既知backend failureは無い」と記載されており、これは実CIの結果を正しく反映している（ローカルのみの環境ギャップであり、CLAUDE.mdの記載を変更する必要は無い）。

### 4.2 Windows/Linux差異

#129/#133で徹底的に検証・修正済み（`os.killpg`のWindows非対応・`_is_pid_alive()`のWindows実装バグ・process tree termination）。本Investigationの調査範囲では、これ以外の新たなWindows固有gapは確認できなかった。

### 4.3 startup recovery / cancellation

#125（Training Job Startup Reconciliation）・#127（JobManager側は既存のrecover_interrupted_jobsのまま）・#133（process tree termination）で対応済み。

### 4.4 log/diagnostics

#133で`_stop_training_worker()`の終了未確認時に診断ログ（`logging.warning()`）を追加済み。それ以外の新たなgapは確認できなかった。

## 5. Performance / Scale

`docs/26_PERFORMANCE_LIMITS.md`（2026-07-23実測、#127で「jobs.json移行済み」へ更新済み）を再確認した。Job作成のO(n)問題は#127のSQLite移行で解消済み。監査ログ（`audit.jsonl`）・Benchmark cases（`benchmarks.json`）のSQLite移行（docs/26優先度2・3）は依然として未着手のままだが、実測データ上は現在の運用規模で緊急性は無いと判断されている（既存の結論を維持）。新たな実測（要計測）が必要な項目は本Investigationの調査範囲では見つからなかった。

## 6. Documentation / Onboarding

`docs/USER_GUIDE.md`の TrOCR既知制約の記述（§2.1）は実装と一致していることを確認した。`QUICK_START.md`/`FAQ.md`/API reference（`docs/06_API_REFERENCE.md`）については、#117/#119/#121/#125/#127/#129/#131/#133/#135/#137の完了に伴う更新が各Issueの完了時にすでに反映されていることを確認した（各workitem docの「Documentation」節を参照）。本Investigationの調査範囲では、追加で必要な大きなdocumentation gapは確認できなかった。

## 7. Epic #28 Restart Trigger

Investigation #108が定義した再開トリガー（「既存Legacyパスが機能しなくなる」「同じmetadata fixが繰り返される」）が発生しているか再確認した。

**判断: トリガーは弱く発生しているが、Epic #28全体を再開するほどの強さではない。保留継続を推奨する。**

根拠:

- §3.3の通り、legacy sidecar分岐は8ファイル・25箇所に分布しており、Epic #28が当初想定した「複数の独立した永続化・判定機構」という状況自体は変わっていない
- #115以降、実際に「同じmetadata fix」に該当する修正は2件観測された: #117（Model Card内のTesseract専用ハードコード2箇所）・#137（Release Gateの`_latest_benchmark_result()`のPaddleOCR分岐欠落）。これは確かに「新しいengineが追加されるたびに、既存の汎用に見える関数のどこかにengine別分岐の抜けが見つかる」というEpic #28が警告していたパターンに合致する
- しかし、この2件はいずれも**低コスト・低リスクな単一関数の局所修正**で完結しており（それぞれ数行〜数十行の変更）、Epic #28が懸念する「同じ修正が広範囲に何度も必要になる」というほどの頻度・深刻度には至っていない
- §2.1のTrOCRモデル削除/ダウンロード不可というgapも同種のパターンだが、これも「新しいConsumer（delete_model/download_model_endpoint）へTrOCR分岐を追加する」という局所修正で解決可能であり、Canonical Metadata基盤への全面移行を必要としない

**結論**: トリガーは部分的に観測されるが、個別のBug/Feature Issue（例: TrOCR Model Management Parity）として都度対処する方が、Canonical Metadata Consumer Migration全体に着手するより低コスト・低リスクである。Investigation #108の方針（既存Legacyパスが機能している限り着手しない）を継続することを推奨する。

## Candidate Themes

| # | テーマ | 概要 |
|---|---|---|
| 1 | **TrOCR Model Management Parity** | Model Manager画面（`/models/info`・削除・ダウンロード）へTrOCRモデルを統合する。§2.1・§7で確認した具体的gapを解消する |
| 2 | Legacy Evaluation Job Type実態確認 | `job_type="evaluation"`の実際の到達経路を確定し、無ければdead codeとして整理する（§3.1、3回連続の持ち越し） |
| 3 | Model Deletion Robustness | `delete_model()`の既知ガード課題（共有親ディレクトリ・相対パス・rmtree方式統一）を解消する（§3.2） |
| 4 | jobs.json→SQLite以外のSQLite移行（audit/benchmark cases） | docs/26優先度2・3。現状は緊急性なしと判断されているため低優先度 |
| 5 | Epic #28再開 | §7の結論により**推奨しない**（トリガー弱、個別Issue対応の方が低リスク） |

## Prioritization Matrix

| # | テーマ | User Value | Frequency | Reliability Impact | Operational Value | Tech Debt削減 | Implementation Cost | Regression Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | TrOCR Model Management Parity | 4 | 3 | 2 | 3 | 3 | 3 | 2 |
| 2 | Legacy Evaluation Job Type実態確認 | 2 | 2 | 2 | 3 | 3 | 2 | 1 |
| 3 | Model Deletion Robustness | 3 | 2 | 4 | 3 | 3 | 3 | 3 |
| 4 | audit/benchmark cases SQLite移行 | 1 | 1 | 2 | 2 | 2 | 4 | 2 |

**推奨理由**:

- **テーマ1（TrOCR Model Management Parity）を最優先で推奨する**。既に`USER_GUIDE.md`が明記する既知制約であり、実際に「削除もダウンロードもできない」という具体的な運用上の不便として残っている。実装コストは中程度（`model_registry.py::delete_model()`・`download_model_endpoint()`・`list_model_infos()`への`.trocr.json`分岐追加が中心）で、このセッションで確立された#117/#121/#137の「engine別分岐を1関数ずつ丁寧に追加する」パターンをそのまま適用できる。Regression Riskも低い（既存3エンジンのロジックには触れず、TrOCR向けの新規分岐を追加するのみ）
- テーマ2（Legacy Evaluation Job Type実態確認）はコストが最も低く、3回連続で持ち越された調査を今度こそ確定させる価値がある。次点として推奨する
- テーマ3（Model Deletion Robustness）はReliability Impactが最も高いが、削除操作という性質上Regression Riskも高く、より慎重な設計が必要なため2番手に留める
- テーマ4はdocs/26が既に「緊急性なし」と結論づけており、優先度は低いままでよい
- Epic #28再開は§7の通り推奨しない

## Recommended Output

1. **次に起票すべきIssue/Epicを1つ**: **[Feature] TrOCR Model Management Parity**（Model Manager画面・削除・ダウンロードへTrOCRモデルを統合する）
2. **その理由**: `USER_GUIDE.md`に既に明記された既知制約であり、実際に運用上の不便（モデル整理・バックアップ不可）として残っている。このセッションで確立された engine-parity 修正パターン（#117/#121/#137）がそのまま適用でき、実装コスト・リスクともに中程度で着手しやすい
3. **次点候補2件**: (a) Legacy Evaluation Job Type実態確認（低コスト、3回持ち越しの解消） (b) Model Deletion Robustness（Reliability Impact高いが慎重な設計が必要）
4. **Epic #28**: **保留継続を推奨する**。再開トリガーは部分的に観測される（§7）が、個別Issue対応で十分吸収できる強さであり、Canonical Metadata Consumer Migration全体に着手するコスト・リスクには見合わない

次Issue自体は本Investigation内では作成しない（Issue本文の明示的指示通り）。

## Deferred Items

- audit.jsonl/benchmark cases SQLite移行（docs/26優先度2・3、緊急性なしのため据え置き）
- Release Gateへの直接遷移導線（§2.2、致命的ではないため据え置き）
- Epic #28 Consumer Migration本体（§7の結論により据え置き継続）

## Production Changes

なし。本Issueはdocs追加・更新のみ。`git diff --stat main -- src/ frontend/src/`で差分0を確認済み。

## Tests / Verification

Production変更が無いため新規testsは不要。実コード（`model_registry.py::delete_model()`・`main.py::download_model_endpoint()`・`job_manager.py::JOB_HANDLERS`・`docs/USER_GUIDE.md`等）と本書の記述が一致することをgrep/Readで確認済み。
