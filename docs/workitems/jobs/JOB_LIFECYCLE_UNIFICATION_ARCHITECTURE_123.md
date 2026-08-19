# Job Lifecycle Unification Architecture Investigation 作業記録

Related: Architecture Investigation [#123](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/123) / Investigation [#115](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/115)（Next Development Roadmap、Theme 2） / Bug [#8](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/8) / Bug [#112](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/112)（training_jobs参照によるtest DB isolation問題）

**状態**: Completed / Closed（Architecture / Documentation onlyのInvestigation。Production job lifecycleは無変更）。PR [#124](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/124)、Squash Commit `9308321`でマージ済み。

## 目的

Investigation #115のTheme 2「Job Lifecycle Unification」について、Feature実装へ進む前に現在mainの実コードを正としてArchitecture Investigationを行う。OCR Crafterには独立した2つのJob機構（`training_jobs`テーブル+subprocess方式、`job_manager.py`+`jobs.json`+daemon worker方式）が併存しており、本書はその可視化・比較・統合可能性・移行順序・回帰リスクを確定し、実装Issueへ分割できる状態にすることを目的とする。本Issueでは統合実装・migration実装・DB schema変更・Frontend redesignは一切行わない。

---

## 1. Job System A: `training_jobs` + subprocess

### 1.1 Call Graph

```
Frontend (TrainingView.jsx)
  └─ POST /api/tesseract/train/start | /api/ocr/train/start | /api/trocr/train/start | /train/start (classification)
       └─ main.py: job_id = str(uuid.uuid4())
            └─ db.upsert_training_job(job_id, status="queued", training_family=..., engine=..., ...)
            └─ _spawn_training_runner(job_type, job_id)
                 └─ subprocess.Popen([sys.executable, "-m", "src.app.job_runner", job_type, job_id],
                                     start_new_session=True, close_fds=True)
                      └─ job_runner.py: init_db() → _run_{ocr,tesseract,trocr}_training_job(job_id) | _run_training_job(job_id)
                           └─ main.py内の該当関数: engine実行 → db.upsert_training_job(status="running"→"completed"|"failed", ...)
Frontend polling
  └─ GET /api/{tesseract,ocr,trocr}/train/status/{job_id} | /train/{job_id}
       └─ db.fetch_training_job(job_id)  （OCR familyのみ _reconcile_ocr_training_job() を経由）
       └─ (ocr familyのみ) GET /api/ocr/train/log/{job_id}?tail=N でログtailを別途取得
Cancellation
  └─ POST /api/{tesseract,ocr,trocr}/train/stop/{job_id} | /train/stop/{job_id}
       └─ _stop_training_worker(job_id): os.killpg(worker_pid, SIGTERM) → fallback os.kill(worker_pid, SIGTERM)
            └─ db.upsert_training_job(status="stopped")
Artifact registration
  └─ 各engineの学習関数が成功時にモデルファイル・sidecar（.tess.json/.ocr.json/.trocr.json）を書き出し、
     `experiment_meta`/`training_condition_snapshot` を training_jobs レコードへJSON文字列として保存する
```

### 1.2 DB Schema（`training_jobs`、`src/app/db.py`）

- 単一テーブル。`get_conn()`/`init_db()`でスキーマ作成。カラムは job_id(PK) / status / training_family / engine / project_id / created_at / updated_at / worker_pid / log_path / params(JSON文字列) / result(JSON文字列) / experiment_meta(JSON文字列) / training_condition_snapshot(JSON文字列) 等（Issue #112調査で確認したschema drift問題は既存local DBのみの事象で、コード上のCREATE TABLE定義自体は正）。
- 構造化されたstate machineは無い。任意の文字列が status カラムへ書き込み可能（アプリ側コードが暗黙にvocabularyを守っているだけ）。
- Job ID: 4系統（classification/ocr/tesseract/trocr）すべて `uuid.uuid4()`（main.py 2896行/3254行/3328行/3419行）。

### 1.3 Status vocabulary

`queued` / `running` / `completed`（Bではなく"succeeded"ではない） / `failed` / `stopped`（Bの"cancelled"ではない）。バリデーションは無く、命名も System B と一致しない。

### 1.4 Cancellation

OS levelの強制終了。`os.killpg(worker_pid, SIGTERM)`（プロセスグループ全体）、失敗時 `os.kill(worker_pid, SIGTERM)` にフォールバック。GPU処理中でも即座にプロセスが終了するため、他のcooperativeな仕組みより強力だが、後始末（部分書き込みartifactの削除等）はプロセス側のSIGTERMハンドラ／`finally`節に依存する。

### 1.5 Progress/Logging

DBに構造化されたprogress fieldは無い。Frontendが `log_path` のログファイルをpollし、`parseTrainingProgress(logs)`（`frontend/src/lib/`）でクライアント側で「iteration X/Y」等のパターンを正規表現抽出して進捗バーを描画する。

### 1.6 Startup Reconciliation（重要な非対称性）

- `_reconcile_ocr_training_job()` は存在するが、**フロントエンドが `GET /api/ocr/train/status/{job_id}` をpollした時にのみ遅延実行**される。アプリ起動時（`on_startup()`）には一切呼ばれない。
- さらに `_reconcile_ocr_training_job()` は **TesseractとTrOCRのreconciliationを明示的に除外**している。PaddleOCRのみ `worker_pid` の生存確認＋エクスポート済み推論ディレクトリ/チェックポイントファイルの有無で部分的な復旧を行う。
- Classification training（`GET /train/{job_id}`）は `fetch_training_job(job_id)` を直接呼ぶのみで、reconciliationロジックが一切無い。
- **結果**: バックエンドがTesseract/TrOCR/Classification学習の実行中にクラッシュ/再起動すると、該当Jobは`running`のままDBに残り続け、`worker_pid`は死んでいるにもかかわらず自動検出・自動補正が行われない。ユーザーが気づかない限り、Job一覧上は永久に「実行中」に見える。これは本調査で新たに確認した具体的なreliability gapである。

### 1.7 Concurrency

`_reject_if_training_active(project_id, training_family)` は **(project_id, training_family) の組み合わせ単位**でチェックする。つまり異なるprojectであれば複数の学習を同時実行できる（system-wide lockではない）。

### 1.8 対象training engines

Tesseract / PaddleOCR（"ocr" family） / TrOCR / Classification（4系統、すべて同一の subprocess + `job_runner.py` 経由パターンを共有するが、`training_family`/`engine` discriminatorで分岐）。

---

## 2. Job System B: `job_manager.py` + `jobs.json` + daemon worker

### 2.1 Call Graph

```
Frontend
  └─ 各機能専用の検証済みwrapper endpoint（例: POST /api/benchmarks, POST /api/reports/generate）
       └─ get_job_service().create_job(project_id, job_type, params, requested_by)
            └─ JobRepository: JOB-000001形式のIDを採番（jobs.json内の system-wide counter）→ atomic_write_json で永続化
            └─ ensure_worker_started() → JobWorker（daemon thread）がqueueをpollしてhandlerを実行
                 └─ JOB_HANDLERS[job_type](ctx, params)（同一プロセス・同一スレッド内で直接実行、subprocessではない）
                      └─ JobContext.check_cancelled() を要所でpoll（cooperative cancellation）
                      └─ ctx.update_progress(percent, current_step, message) → jobs.json更新 + JSONL event追記
Frontend polling
  └─ GET /api/jobs?project_id=...（一覧、JobsView.jsx等）
  └─ GET /api/jobs/{job_id}（詳細）
  └─ GET /api/jobs/{job_id}/events（JSONLイベント履歴）
Cancellation
  └─ POST /api/jobs/{job_id}/cancel → status: running→cancel_requested
       └─ handler内のcheck_cancelled()がJobCancelledをraiseした時点でcancelled確定
Startup Recovery
  └─ on_startup()（main.py）で無条件に recover_interrupted_jobs() を実行
  └─ JobWorker.start() でも同様に recover_interrupted_jobs() を実行（二重の安全網）
       └─ running/cancel_requested のまま残っているJobを terminal "interrupted" へ補正（UIから再実行可能）
```

### 2.2 `JOB_HANDLERS` と実際の呼び出し経路（重要な発見）

`job_manager.py` の `JOB_HANDLERS` には7つのjob_typeが登録されている: `preprocess` / `dataset_creation` / `training` / `evaluation` / `deployment_export` / `benchmark` / `report_generate`。

しかし実際に**専用wrapper endpointを経由して production frontendから呼ばれるのは `benchmark`（`POST /api/benchmarks`）と `report_generate`（`POST /api/reports/generate`）のみ**であることを本調査で確認した。

- `preprocess`（前処理）: 実際のfrontend（PreprocessView等）は `POST /preprocess/run` を直接呼び、`run_preprocess()` を**同期的に**実行する。Job Systemを一切経由しない。`job_manager.py`の`_handle_preprocess`ハンドラを呼び出すmain.py側のcall siteは存在しない。
- `deployment_export`（配布パッケージ）: 実際のfrontend（ReleasesView）は `GET /api/releases/deployment_package` を直接呼び、`build_deployment_package()` を**同期的に**実行してZIPをレスポンスとして直接返す。Job Systemを一切経由しない。`_handle_deployment_export`を呼び出すcall siteも同様に存在しない。
- `dataset_creation` / `training`: main.py内に `job_type="dataset_creation"` / `job_type="training"` でjobを作成するcall siteが存在しない（grep確認済み）。
- `training` は `_handle_training()` が `run_tesseract_training()` を**in-process・非subprocessで直接実行**するが、これを呼び出す経路は汎用 `POST /api/jobs`（任意の`job_type`文字列を受理する）のみであり、実際に使うのは `tests/test_e2e_uat.py:138` と `tests/test_job_manager.py:201` のみ（grep確認済み）。

つまり `docs/18_JOB_MANAGEMENT.md` が述べる「既存の同期API（`/preprocess/run`等）はそのまま維持する。Job APIは同じサービス関数をハンドラ経由で呼ぶ追加経路であり、既存フローを置き換えない」という記述は、**"追加経路として実際に使われている"のはbenchmark/evaluation/report_generateの3種類のみ**であり、preprocess/dataset_creation/training/deployment_exportの4種類のJOB_HANDLERSエントリは、汎用`POST /api/jobs`経由でのみ到達可能な、実運用上ほぼ死んでいる（テスト専用の）経路である、という精緻化が必要である。統合を検討する際、この4種類は「移行対象の実データフロー」ではなく「テスト専用のvestigialコード」として扱うべきである。

### 2.3 `data/jobs/jobs.json` + Job ID

`JOB-000001`形式（6桁ゼロ埋め、system-wide連番カウンタ。IDは再利用されない）。`atomic_io.atomic_write_json`/`file_lock`でatomic書き込み。

### 2.4 State Machine

`JOB_STATUSES = ["queued","running","succeeded","failed","cancel_requested","cancelled","interrupted"]`。`ALLOWED_TRANSITIONS`辞書で明示的に検証される（`queued→{running,cancel_requested,cancelled}`、`running→{succeeded,failed,cancel_requested,interrupted}`、`cancel_requested→{cancelled,succeeded,failed,interrupted}`、terminal state→`set()`）。

### 2.5 Cancellation

Cooperative。`JobContext.check_cancelled()`がhandler内の要所でpollされた時に`JobCancelled`をraiseする。Handlerは同一プロセスのスレッド内で動くため、System AのようなOS levelの強制killは不可能（自プロセスをkillすることになるため）。

### 2.6 Progress/Event Model

`progress`(0-100) + `current_step` + `message` がjob recordに直接構造化フィールドとして存在し、加えて `data/jobs/events/JOB-xxxxxx.jsonl` への追記専用イベント履歴がある。System Aのログファイル正規表現parsingより堅牢。

### 2.7 Concurrency

- Training: システム全体で同時1件（project横断、System Aとは異なる粒度）
- Preprocess: 同一project内で同時1件
- Evaluation: 同一project×同一modelの重複防止
- Benchmark: `jobs.json`の`config.benchmark_concurrency`で設定可能（デフォルト1）

重複job作成要求は既存のactive jobを`deduplicated: true`で返す（409は返さない、統一仕様）。

### 2.8 Recovery

`recover_interrupted_jobs()`が`on_startup()`（アプリ起動時、無条件）と`JobWorker.start()`の両方で実行される二重の安全網。`running`/`cancel_requested`のまま残っているjobを`interrupted`（terminal、UIから再実行可能）へ補正する。System Aと対照的に、全job_typeに一律で適用される。

---

## 3. API Surface Matrix

| 機能 | Endpoint | 利用するJob System | 備考 |
|---|---|---|---|
| create/start（Tesseract学習） | `POST /api/tesseract/train/start` | A | subprocess |
| create/start（PaddleOCR/OCR学習） | `POST /api/ocr/train/start` | A | subprocess |
| create/start（TrOCR学習） | `POST /api/trocr/train/start` | A | subprocess |
| create/start（Classification学習） | `POST /train/start` | A | subprocess |
| status/get（Tesseract） | `GET /api/tesseract/train/status/{job_id}` | A | reconciliationなし |
| status/get（OCR/PaddleOCR） | `GET /api/ocr/train/status/{job_id}` | A | `_reconcile_ocr_training_job()`（PaddleOCRのみ実質的に有効） |
| status/get（TrOCR） | `GET /api/trocr/train/status/{job_id}` | A | reconciliationなし |
| status/get（Classification） | `GET /train/{job_id}` | A | reconciliationなし |
| logs（OCR系のみ） | `GET /api/ocr/train/log/{job_id}?tail=N` | A | ログファイルtail、他engineに同等APIなし |
| cancel（各training family） | `POST /api/{family}/train/stop/{job_id}` \| `/train/stop/{job_id}` | A | 強制SIGTERM |
| create/start（汎用） | `POST /api/jobs` | B | 任意`job_type`を受理（本番未使用のtraining/preprocess/dataset_creation/deployment_exportもここ経由でのみ到達可能） |
| create/start（Benchmark） | `POST /api/benchmarks` | B | 検証済みwrapper、`job_type="benchmark"` |
| create/start（Report） | `POST /api/reports/generate` | B | 検証済みwrapper、`job_type="report_generate"` |
| create/start（Evaluation, legacy） | （`job_type="evaluation"`） | B | 本調査ではlegacy evaluation経路の専用endpoint呼び出し箇所は未特定。Theme探索の対象 |
| list | `GET /api/jobs` | B | project/type/status/requested_by/date rangeでfilter |
| status/get | `GET /api/jobs/{job_id}` | B | |
| events | `GET /api/jobs/{job_id}/events` | B | JSONLイベント履歴 |
| cancel | `POST /api/jobs/{job_id}/cancel` | B | cooperative |
| retry/re-run | 明示的な"retry" APIは存在しない（`interrupted`状態のjobをUIから同一paramsで再作成する運用） | B | System Aにも同等の明示APIなし |
| preprocess実行（実運用） | `POST /preprocess/run` | どちらでもない（同期実行のみ） | Job Systemを一切経由しない |
| deployment package取得（実運用） | `GET /api/releases/deployment_package` | どちらでもない（同期実行のみ） | Job Systemを一切経由しない |

**結論**: Training（4 family）はSystem A、Benchmark/Reportは実運用上System B、Preprocess/Deployment Exportはどちらも経由しない純粋な同期API。Evaluation/Dataset Creationは実運用上の到達経路が曖昧（legacy evaluationの専用呼び出し箇所は本調査で未特定のまま。実装Issue化する場合は再調査が必要）。

---

## 4. Frontend Consumer Matrix

| 画面/機構 | 対象Job System | Polling間隔 | Cancellation UI |
|---|---|---|---|
| `TrainingView.jsx`（App.jsx側のuseEffect） | A | 固定2000ms（`setInterval(poll, 2000)`、状態に関わらず一定） | 「学習停止」ボタン→`/train/stop/{job_id}`系 |
| `JobsView.jsx`（App.jsx側の`loadJobs`） | B | 可変（activeなjobがあれば3000ms、無ければ10000ms） | Job詳細から`/api/jobs/{job_id}/cancel` |
| `BenchmarkView.jsx` | B | `JobsView`と同様の一覧polling経由、または個別`GET /api/jobs/{job_id}`（本調査ではBenchmark専用の独自pollingロジックは未確認、Job一覧picker経由が主) | 同上 |
| Dataset/PreprocessView | どちらも未経由（`/preprocess/run`同期呼び出しで完了を待つのみ） | N/A（同期レスポンス待ち） | 同期実行のためcancel UI無し |

**Frontendが2つのJob contractをどの程度吸収しているか**: 吸収は最小限。TrainingView用のstatus/log/stop APIとJobsView用の`/api/jobs`系APIは完全に別のReactコンポーネント・別のstate・別のpolling loopとして実装されており、共通の"Job"抽象は無い。Frontend側で契約差異を隠蔽するadapter層は存在しない（App.jsxの各useEffectがそれぞれのAPI形状を直接知っている）。

---

## 5. Persistence / Identity 比較

| 項目 | System A | System B |
|---|---|---|
| ID形式 | `uuid.uuid4()`文字列 | `JOB-000001`（system-wide連番、ゼロ埋め） |
| 保存場所 | SQLite `outputs/app.db`の`training_jobs`テーブル | `data/jobs/jobs.json`（+ `data/jobs/events/*.jsonl`） |
| Serialization | SQLite row（一部カラムはJSON文字列） | JSON（atomic_write_json） |
| Timestamps | `created_at`/`updated_at`（DBカラム） | job record内フィールド＋イベントJSONLの各行にtimestamp |
| State names | `queued/running/completed/failed/stopped` | `queued/running/succeeded/failed/cancel_requested/cancelled/interrupted` |
| Progress表現 | 無し（ログファイルをfrontendが正規表現parse） | `progress`(0-100)+`current_step`+`message`の構造化フィールド |
| Error表現 | `result`カラム（JSON文字列、engine依存） | job record内`error`相当フィールド＋イベント履歴 |
| Retryability | 明示APIなし（UIから同一paramsで再度start） | 明示APIなし（`interrupted`から同様に再作成） |
| Lineage | `project_id`/`training_family`/`engine`カラム、`experiment_meta`/`training_condition_snapshot`で実験・データセットと紐付け | `params`内に`project_id`等を保持、dataset/model lineageの構造化は薄い |

既存job idを破壊するmigrationは避けるべき、という制約に対し: **System AのUUID形式とSystem Bの`JOB-NNNNNN`形式は文字列としてすでに衝突しない**（UUIDにはハイフンが必ず含まれ、`JOB-`prefixと形式が異なる）ため、単純にID空間を統合してもID衝突は起きない。ただし「system-wide連番カウンタ」という意味論はSystem B固有であり、統合後もこれを維持するかは設計判断が必要。

---

## 6. Concurrency Model 比較

| 項目 | System A | System B |
|---|---|---|
| 実行方式 | 独立subprocess（`start_new_session=True`） | 同一プロセス内daemon thread |
| 同時実行数の単位 | (project_id, training_family)単位で1件 | job_typeごとに個別ルール（training=system全体1件、preprocess=project内1件、evaluation=project×model重複防止、benchmark=設定可能） |
| Queue semantics | 無し（reject if active、queueに積まない） | `JobWorker`がqueueをpollして順次実行（`deduplicated`応答で重複要求を吸収） |
| Resource contention | OS process分離のため、GPU/CPUリソースの奪い合いはOSのプロセススケジューラ任せ | 同一プロセス内のスレッドのため、GPU排他制御はhandler実装依存（明示的なlockは本調査では未確認） |
| Process isolation | 強い（別プロセス、クラッシュしてもFastAPI本体は無事） | 無い（handlerの例外はFastAPI本体と同一プロセス内、ただしdaemon threadなのでハング時もサーバ自体は生存） |
| Crash behavior | worker processのみ死亡、DBは`running`のまま取り残される（reconciliation gapあり、§1.6参照） | サーバプロセス自体がクラッシュした場合のみ影響。起動時に無条件でreconcileされる |
| Server restart behavior | 再起動後もDBの`running`状態がそのまま残る（family依存で一部recovery） | 起動時に`recover_interrupted_jobs()`で確実に`interrupted`へ補正 |

「共通化＝同じworker方式」という前提は置かない: TrainingのようなCPU/GPU長時間拘束・強制killが必要な処理には、System Aのprocess isolation（subprocess）の利点は実務上大きい。System Bのin-thread実行方式へ単純に寄せると、cancellation semanticsの後退（§7参照）とサーバ全体のブロッキングリスクを招く。

---

## 7. Cancellation Semantics 比較（最重要）

| 項目 | System A | System B |
|---|---|---|
| 停止方式 | `os.killpg(worker_pid, SIGTERM)`（プロセスグループ全体）、フォールバック`os.kill` | `JobContext.check_cancelled()`のポーリングによるcooperative cancellation |
| GPU taskの停止 | プロセスごと終了するため、GPUを握っているPythonプロセス自体が消える（CUDA context含め解放される） | handlerが`check_cancelled()`を呼ぶタイミングでしか中断できない。GPU処理の途中（1 epoch内の1 forward/backward等）では即座に止まらない可能性がある |
| Cleanup | プロセス側の`finally`/シグナルハンドラに依存。親プロセス側で明示的な後始末コードは限定的 | handler内で`JobCancelled`を捕捉し、明示的にcleanupできる（例外送出ベースのため） |
| Partial artifact | Subprocessが即死するため、書きかけの学習成果物（チェックポイント等）が不完全な状態で残る可能性がある | Cooperativeなため、次のcheckpoint境界まで到達してから安全に停止できる余地がある（handler実装次第） |
| DB/Job state整合性 | `_stop_training_worker()`実行後に`upsert_training_job(status="stopped")`を明示的に呼ぶ。プロセスが即死するため、DB更新前にjob側から状態を報告する術は無い | `cancel_requested`→`cancelled`の遷移がstate machineで保証される |

**統合時の必須制約**: Trainingの強いcancellation semantics（即時・確実なプロセス終了）を弱めてはならない。System Bのcooperative方式へ単純に寄せると、GPU長時間ジョブの「今すぐ止めたい」という既存のユーザー期待を裏切る（stuck状態のjobが増える）リスクが高い。統合する場合も、Training系だけは何らかの形でOS process級のkill能力を維持する必要がある。

---

## 8. Progress / Event Model 比較

| 項目 | System A | System B |
|---|---|---|
| Percentage | 無し（frontend側で`parseTrainingProgress(logs)`により正規表現から近似算出） | `progress`フィールド（0-100、handlerが明示的に更新） |
| Epoch log | 生ログファイル（`log_path`）をtailで取得、engine固有のログ形式に依存 | `message`/`current_step`として構造化、加えてJSONLイベント履歴 |
| Event history | 無し（ログファイルの追記のみ、構造化イベントではない） | `data/jobs/events/JOB-xxxxxx.jsonl`（追記専用） |
| Message | ログ行そのもの | 専用`message`フィールド |
| Timestamps | DBの`updated_at`のみ（ログ行ごとのtimestampはengine依存） | job record＋イベント各行 |

**共通DTO/adapterで吸収できるか**: 構造自体（percentage/step/message/eventsという概念）はSystem Bの形式へ寄せることが可能に見えるが、System Aの「進捗はログファイルの正規表現parsing」という実装は、engineごとに異なるログフォーマット（PaddleOCRのppocr形式ログ等）に依存しており、構造化`progress`フィールドへ変換するには各engine実行コード（`_run_ocr_training_job`等）内に進捗report呼び出しを新設する実装が必要になる。これは「Adapterで吸収」ではなく「System A側の実装変更」を要する点に注意する。

---

## 9. Recovery / Reconciliation 比較

§1.6・§2.8で詳述した非対称性の要約:

| 項目 | System A | System B |
|---|---|---|
| 起動時reconciliation | 無し（`on_startup()`はSystem Aに一切触れない） | 有り（`recover_interrupted_jobs()`を無条件実行） |
| Reconciliation対象engine | PaddleOCRのみ部分対応（worker_pid生存確認＋成果物有無）。Tesseract/TrOCR/Classificationは対象外 | 全job_type一律 |
| 実行タイミング | フロントエンドがstatus pollした時のみ（遅延・受動的） | サーバ起動時＋Worker起動時（能動的、二重） |
| Orphan process検出 | PaddleOCRのみ`_is_pid_alive()`で確認 | プロセス自体が同一サーバプロセス内のため「orphan process」という概念が無い（daemon threadは`interrupted`化のみ） |
| Stale job | Tesseract/TrOCR/Classificationは検出手段が無い（本調査の最重要ギャップ） | `interrupted`へ確実に補正される |
| Retry | UIから同一paramsで再start（明示的なretry APIは無い） | 同上 |

---

## 10. Theme 3（`jobs.json` → SQLite移行）との関係

- Job System BだけをSQLite化しても、それ単独ではSystem Aとの統合は自動的には容易にならない。統合の本質的な難しさはpersistence formatではなく、**execution model（subprocess vs in-thread）とcancellation semantics（OS kill vs cooperative）の違い**にあるため、Theme 3はexecution model統合の前提条件ではない。
- 一方で、統合先としてOption A（`training_jobs`への全面統合）を選ぶ場合、System Bの`jobs.json`をどのみち何らかのテーブルへ移行する必要が生じるため、Theme 3はOption Aの**部分集合**として自然に包含される。
- Option B（`job_manager`への全面統合）を選ぶ場合、Theme 3（`jobs.json`→SQLite）はSystem B自体の信頼性向上（atomic_write_jsonのfile lock依存からの脱却、同時書き込み耐性の向上）として独立に価値があり、統合前に先行させても後退させても、どちらの順序でも成立する。
- 結論: **Theme 3はJob Lifecycle Unificationの前提条件ではなく、独立したIssueとして先行・並行・後追いのいずれでも進められる**。ただし、Option A方向で統合を進めると決めた場合は、Theme 3の設計（unified schema）をUnificationのマイグレーション設計と同時に検討した方が手戻りが少ない。

---

## 11. Architecture Options比較

| Option | 概要 | Pros | Cons |
|---|---|---|---|
| **A: `training_jobs`へ全面統合** | 全JobをSQLite `training_jobs`系スキーマへ寄せる | 既存Training系の強いcancellation/process isolationを自然に維持できる。Issue #8/#112のtest DB isolation知見をそのまま活かせる | Benchmark/Reportの構造化progress/eventモデルをSQLiteスキーマへ再設計する必要がある。`jobs.json`の`deduplicated`応答等の既存API互換をSQLite側で作り直す必要がある |
| **B: `job_manager`へ全面統合** | Trainingも`JobManager`へ寄せ、subprocess実行だけExecutorとして保持する | 構造化progress/event/state machineの恩恵をTraining側にも展開できる。起動時reconciliationの恩恵をTraining全engineに展開できる（§9の最重要ギャップを解消） | Cancellation semanticsの設計変更が必須（cooperative pollingの中に「即座にsubprocessをkillする」処理を組み込むハイブリッドexecutorが必要）。実装コストが最大 |
| **C: Shared Job Facade + 複数Executor/Repository** | 共通Job DTO/API・shared lifecycle/state machineを新設し、executor（subprocess/thread）とrepositoryは複数実装を許容する段階移行 | 既存の2実装をほぼそのまま活かしながら、Frontend/API層だけを先に統一できる。Migrationを段階化しやすい | 中間層の設計・実装コストがかかる。「本当の統合」までの距離が長く、途中で停滞するリスクがある |
| **D: 統合しない / Adapterのみ** | Backend内部は2系統のまま、API/UI contractだけ統一する | 実装コスト・回帰リスクが最小。今回の調査で判明した`§1.6`のreconciliation gapのような個別課題を、統合を待たずに単独Issueとして先に修正できる | 「二重管理の複雑性」というTheme 2が指摘した根本課題そのものは解消しない。Frontendの二重pollingロジックも残る |

---

## 12. Architecture Questions回答（16問）

1. **2系統は本当に統合すべきか。** — 長期的には統合が望ましいが、緊急性は低い（Reliability Impact=4だがImplementation Cost=5、Regression Risk=5とInvestigation #115で評価済み）。まず個別のreliability gap（§1.6のreconciliation非対称性）を単独Issueとして解消する方が費用対効果が高い。
2. **共通化すべき最小責務は何か。** — 「Job一覧のfrontend表示契約」（list/detail/eventsのAPI形状）が最も費用対効果の高い共通化対象。次点で「起動時reconciliation」をSystem Aへも展開すること。
3. **execution modelまで統合すべきか。** — 現時点では不要。Training系はsubprocess、Benchmark/Report系はin-thread、という使い分けはそれぞれの負荷特性（長時間・GPU拘束 vs 短時間・IO中心)に合致しており、無理に統一する技術的必然性は薄い。
4. **persistenceを統合すべきか。** — 中期的には統合が望ましい（2つのストレージ機構を保守する負担）が、Theme 3として独立に進めても良い（§10）。
5. **state machineを統合可能か。** — 可能。System Bの`ALLOWED_TRANSITIONS`はSystem Aの語彙（completed/stopped等）を包含する形で拡張でき、System A側へ後から明示的なstate machineを導入すること自体は独立した改善として価値がある。
6. **cancellation semanticsを統一可能か。** — 完全な統一は非推奨（§7）。Training系のOS process killという強い保証は、統合後も何らかの形で個別に維持すべき。
7. **progress/event modelを統一可能か。** — DTO形状としては統一可能。ただしSystem A側のengine実行コードに構造化progress report呼び出しを新設する実装作業が必要（§8）。
8. **existing job idsを維持できるか。** — 維持できる。UUID形式と`JOB-NNNNNN`形式は文字列として衝突しないため、ID空間の統合自体に破壊的変更は不要（§5）。
9. **frontend API contractを先に統一すべきか。** — Yes。Option Cの発想に近く、最もリスクが低く即座に着手可能な統合ステップである。
10. **`jobs.json → SQLite`は前提か、独立Issueか。** — 独立Issue（§10）。
11. **migration中のdual-read/dual-writeは必要か。** — 統合実装に着手する場合は必要になる可能性が高い（既存running中のjobを移行期間中も正しく追跡するため）。ただし本Issueの時点では統合実装自体を推奨しないため、詳細設計は次のArchitecture/Design Issueへ委ねる。
12. **existing running jobsのmigrationは必要か。** — 統合実装が承認された場合のみ必要。実装Issue側でrolling migration（新規jobのみ新方式、既存running jobは旧方式のまま完走を待つ）を検討すべき。
13. **startup reconciliationをどこへ置くべきか。** — 統合の有無に関わらず、まずSystem Aの`on_startup()`へ、Tesseract/TrOCR/Classification向けのreconciliation（少なくとも`worker_pid`生存確認による`running→failed`程度の最小補正）を追加することを独立したBug Issueとして推奨する（§14「次Issue」参照）。
14. **training artifact registrationとのtransaction boundaryはどうするか。** — 現状もSystem A内で「学習成功→sidecar書き出し→DB更新」の順に実行されており、統合後もこのtransaction boundary（artifact書き込み→job状態確定の順序）は変更すべきでない。
15. **Benchmark/Dataset jobsの並行性を変えるべきか。** — 変えるべきではない。現行の並行性ルール（§2.7）はそれぞれの機能要件に基づいて個別に設計されており、統合を理由に変更する動機はない。
16. **最小安全な実装分割は何Issueか。** — §14「推奨Issue分割」参照。

---

## 13. Risk Analysis

| Risk | 評価 |
|---|---|
| Data loss | 低〜中。Migration実装時にdual-write期間を設けず単純に一括変換すると、進行中jobのparamsや部分的な進捗情報を失うリスクがある。統合実装Issueでは必ずdual-read期間を設けるべき |
| Stuck jobs | 現状で既に発生しうる（§1.6のTesseract/TrOCR/Classification reconciliation欠如）。統合前でも単独で修正可能かつ推奨 |
| Duplicate execution | 中。統合実装中、旧APIと新APIの両方から同一paramsでjobが二重生成されるリスクがある。`deduplicated`ロジック（System B由来）を早期に共通化することで軽減できる |
| Cancellation regression | 高。Training系をSystem Bのcooperative方式へ単純移行すると、実質的にcancel機能が弱体化する（§7）。Option B選択時は最重要の設計課題 |
| Server restart regression | 中。System Aの現状（reconciliation無し）は既に脆弱なため、統合はむしろこのリスクを下げる方向に働きうる。ただし移行期間中は両システムの起動処理を正しく両立させる必要がある |
| Artifact partial write | 中。Cancellation時の後始末ロジック（tempファイルの削除等）は現状System A・B双方で個別実装されており、統合時に一方の後始末ロジックが漏れるリスクがある |
| DB migration | 中。`training_jobs`テーブルへの統合（Option A）を選ぶ場合、既存の`experiment_meta`/`training_condition_snapshot`等のカラム設計とSystem Bのparams/eventsをどう共存させるかスキーマ設計が必要 |
| Frontend polling mismatch | 低〜中。TrainingViewの固定2000ms pollingとJobsViewの可変3000/10000ms pollingは、契約統一時にどちらか一方へ揃える判断が必要（頻度を上げすぎるとサーバ負荷、下げすぎるとUX低下） |
| CI/test isolation | 中〜高。Issue #8/#112で確認した通り、`training_jobs`はテストが無自覚に実DBへ書き込みうる構造上の弱点を持つ。統合時は`isolated_test_db`パターンをSystem B側のテストにも一貫して適用する設計が必要 |
| Windows/Linux process semantics | 高。`os.killpg`はUnix系のprocess group概念に依存しており、Windows環境での動作（`start_new_session=True`のWindows実装差異、シグナル送出可否）は本コードベースの実行環境（開発機はWindows、CLAUDE.md記載の通り）で個別の検証が必要。本調査ではWindows上での実際の`os.killpg`挙動の検証は行っていない（Future Work） |

---

## 14. Recommended Output

1. **統合実装へ進む / 進まない**: **今は進まない**。Reliability Impact対比でImplementation Cost/Regression Riskが高すぎる（Investigation #115のスコアリング通り）。まず個別のreliability gap（reconciliation非対称性）を低コスト・低リスクな単独Bug Issueとして解消し、Frontend API contractの部分統一（Option Cの最初のステップ）を次点として検討する。
2. **推奨Architecture Option**: **Option C（Shared Job Facade + 複数Executor/Repository）を将来方向として採用するが、現時点ではその最初のステップ（Frontend Job一覧表示契約の統一）のみを推奨し、execution model/persistenceの統合は保留する**。Option Bは長期的な理想形として否定はしないが、cancellation semantics設計が固まるまで着手すべきでない。
3. **Theme 3（jobs.json → SQLite）の扱い**: Job Lifecycle Unificationの前提条件ではない、独立したIssueとして扱ってよい（§10）。着手順序を強制しない。
4. **次のFeature/Refactor Issue一覧と順序（推奨、本Issueでは作成しない）**:
   1. [Bug] Tesseract/TrOCR/Classification学習のstartup reconciliation欠如を修正する（§1.6、§9。低コスト・高reliability効果、最優先）
   2. [Investigation or Small Refactor] Windows環境における`os.killpg`/`os.kill`の実挙動検証（§13のRisk、上記(1)の修正と合わせて検証すると効率的）
   3. [Refactor] Frontend Job一覧・詳細表示のAPI contractを部分的に共通化する（TrainingViewのstatus pollingとJobsViewの一覧pollingの間で、少なくとも表示コンポーネント/型を共有できないか検討。Option Cの第一歩）
   4. [Investigation] Theme 3（jobs.json→SQLite）の独立Architecture Investigation（本Issueとは別に、必要になった時点で着手）
   5. （将来・保留）Job execution model統合（Option B方向）の本格設計は、上記(1)〜(3)が完了し、cancellation semanticsの設計が固まってから再検討する
5. **Rollback strategy**: 本Issue自体はProduction変更を含まないため、rollbackは「本PRをrevertしてdocs差分を戻すのみ」で完結する。将来の実装Issue（上記1〜5）に着手する場合は、各Issueごとに独立してfeature branch上で完結させ、既存のTraining/Benchmark/Evaluation本番フローに影響が出た場合は当該PRのみをrevertできるよう、本調査で確認した「2系統は現状疎結合」という性質を意図的に維持したまま進めるべきである。

---

## 15. Explicit Non-goals（本Issueで実施しなかったこと）

- Job lifecycle Production統合実装
- `jobs.json` → SQLite migration実装
- DB schema migration実装
- Frontend Job画面redesign
- Training/Evaluation/Benchmarkのalgorithm変更
- Epic #28 Consumer Migration
- 上記§14で列挙した推奨Issueの作成（ユーザー/次工程が判断する）

## Production Changes

なし。本Issueはdocs追加のみ。`git diff --stat main -- src/ frontend/src/`で差分0を確認済み。

## Tests / Verification

Production変更が無いため新規testsは不要（Issue本文の指示通り）。

- 実コード（`src/app/db.py`・`job_runner.py`・`services/job_manager.py`・`main.py`関連endpoint群）と本書の記述が一致することをgrep/Readで確認済み
- `docs/18_JOB_MANAGEMENT.md`・`docs/07_DATABASE.md`の既存記述との整合を確認し、本書はそれらを置き換えるのではなく、実運用上の到達経路（§2.2）・reconciliation非対称性（§9）等、既存docsに欠けていた分析を補完する位置づけとする
- `python -m pytest -q` / `cd frontend && npm test && npm run build` は本Issueでは実行必須ではないが、Production diffが無いことの確認のため `git diff --stat main` を実行した

## Future Work

- §14で列挙した推奨Issue（reconciliation修正、Windows process semantics検証、Frontend API contract部分統一、Theme 3独立investigation、将来のexecution model統合設計）
  - reconciliation修正（§14推奨(1)）はReliability [#125](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/125)として実施済み。詳細は[TRAINING_JOB_STARTUP_RECONCILIATION_125.md](TRAINING_JOB_STARTUP_RECONCILIATION_125.md)を参照
  - Theme 3（jobs.json→SQLite migration、§10・§14(3)）はFeature [#127](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/127)として実施済み。Job System B（`job_manager.py`）のみをSQLiteへ移行し、Training Job lifecycle（Job System A）・Job Lifecycle Unification自体は本Issueの結論通り変更していない。詳細は[JOB_REPOSITORY_SQLITE_MIGRATION_127.md](JOB_REPOSITORY_SQLITE_MIGRATION_127.md)を参照
  - Windows process semantics検証（§14推奨(2)）はInvestigation [#129](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/129)として実施済み。`os.killpg`はWindowsで`AttributeError`となり常に`os.kill`へfallbackすること、worker本体は終了するがTesseract/PaddleOCRの孫プロセス（外部CLI/ネストsubprocess）はWindows上で終了されず孤立し得ることを実測で確認した。詳細は[WINDOWS_TRAINING_PROCESS_TERMINATION_INVESTIGATION_129.md](WINDOWS_TRAINING_PROCESS_TERMINATION_INVESTIGATION_129.md)を参照
    - この孫プロセス孤立gapの修正はReliability [#133](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/133)として実施済み（`taskkill /PID <pid> /T /F`によるWindows process tree termination）。実装前調査の過程で`_is_pid_alive()`自体のWindows実装バグ（`GetExitCodeProcess`未確認によりプロセス終了後も生存中と誤判定する）を発見・修正し、#129の該当結論も訂正した。詳細は[WINDOWS_TRAINING_PROCESS_TREE_TERMINATION_133.md](WINDOWS_TRAINING_PROCESS_TREE_TERMINATION_133.md)を参照
  - Frontend API contract部分統一（§14推奨(3)、Option Cの第一歩）はRefactor [#131](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/131)として実施済み。`frontend/src/lib/jobDisplayModel.js`でTraining Job/JobManager Jobの表示契約（status mapping・progress・cancel/retry可否）を共通化した（Backend execution model/persistence/cancellationは無変更）。詳細は[FRONTEND_JOB_DISPLAY_CONTRACT_UNIFICATION_131.md](FRONTEND_JOB_DISPLAY_CONTRACT_UNIFICATION_131.md)を参照
  - Option C（Shared Job Facade）の本格実装可否は、#125/#127/#129/#131/#133完了後にInvestigation [#135](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/135)として再評価済み。**結論: Backend Facadeは実装しない（Option A採用）**。#131により当初Facadeで解決しようとしていた表示契約の重複は既に解消されており、残る差異（cancel semantics・progress/events・create/start）はBackendの実行モデル自体が意図的に持つ違いであり、Facadeという抽象化で隠すべきではないと判断した。詳細は[SHARED_JOB_FACADE_READINESS_135.md](SHARED_JOB_FACADE_READINESS_135.md)を参照
- Legacy evaluation（`job_type="evaluation"`）の実際の呼び出し経路が本調査では未特定のまま残っている。実装Issue化する際は再調査が必要
- Benchmark専用のfrontend polling実装の詳細（`BenchmarkView.jsx`側の個別pollingロジックの有無）は本調査で深掘りしきれておらず、Frontend Consumer Matrix統一を検討する際に追加調査が必要
