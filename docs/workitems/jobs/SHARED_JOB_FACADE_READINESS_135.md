# Shared Job Facade Implementation Readiness 作業記録

Related: Investigation [#135](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/135) / Architecture Investigation [#123](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/123)（Job Lifecycle Unification、Completed。Option Cを将来方向として採用） / Reliability [#125](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/125) / Feature [#127](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/127) / Investigation [#129](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/129) / Refactor [#131](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/131) / Reliability [#133](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/133)

**状態**: Implemented, PR review pending（Investigation / Documentation only。Production Job lifecycleは無変更）

## 目的

Architecture Investigation #123が将来方向として採用したOption C（Shared Job Facade + 複数Executor/Repository）について、Issue #125/#127/#129/#131/#133完了後のmainを正として、実装着手のreadinessを再評価する。Backend Facadeをいきなり実装せず、現在残っているBackend/API/Frontendの二重契約を再計測し、価値・最小責務・移行順序を確定する。

## 1. Current Job Architecture Map（#123以降の変更を反映）

### System A: `training_jobs` + subprocess

- 永続化: `outputs/app.db`の`training_jobs`テーブル（無変更、`db.py`）
- 実行: `job_runner.py`をsubprocessとして起動（`_spawn_training_runner`、無変更）
- **startup reconciliation（#125）**: `_reconcile_stale_training_jobs_on_startup()`が`on_startup()`から呼ばれ、queued/runningのまま残ったjobを`worker_pid`の生死で判定し`failed`へ補正する。PaddleOCRは既存の`_reconcile_ocr_training_job()`を先に適用
- **Windows process tree termination（#133）**: `_terminate_training_process_tree()`がUnix=`killpg`維持・Windows=`taskkill /PID <pid> /T /F`（`tasklist`によるイメージ名確認つき）で、workerだけでなくTesseract/PaddleOCRの孫プロセスも終了する。`_stop_training_worker()`は終了未確認時にartifact cleanupをスキップする
- **`_is_pid_alive()`（#133で修正）**: Windows分岐が`GetExitCodeProcess`ベースの判定へ修正済み。#125のreconciliationはこの修正の恩恵をコード変更なしに受けている
- 状態語彙: `queued`/`running`/`completed`/`failed`/`stopped`（無変更）
- Progress: 構造化フィールドなし、Frontend側のlog parsingのみ（無変更）

### System B: `JobManager`/`JobWorker` + SQLite `JobRepository`

- **永続化（#127でSQLite化）**: `data/jobs/job_manager.db`（`job_manager_jobs`/`job_manager_counter`/`job_manager_config`の3テーブル）。旧`jobs.json`はレガシー実装`_LegacyJsonJobRepository`として移行importにのみ残る。`JobRepository`のInterfaceは維持（`_lock`/`_path()`/`_load()`/`_save()`のprivate attribute reach-through含む）
- 実行: `JobWorker`（daemon thread、1秒ポーリング）。`migrate_legacy_jobs_json()`が`JobWorker.start()`から呼ばれる（#127）
- Consumer: 実運用でdedicated endpointから到達するのは`benchmark`（`POST /api/benchmarks`）・`report_generate`（`POST /api/reports/generate`）のみ（#123/#127で確認済み、変更なし）。`preprocess`/`dataset_creation`/`training`/`deployment_export`は汎用`POST /api/jobs`経由でテストからのみ到達（実運用未使用）。`evaluation`の専用wrapper endpointは依然として未特定（#123/#127から継続する既知gap、本Issueでも未解消のまま）
- 状態語彙: `queued`/`running`/`succeeded`/`failed`/`cancel_requested`/`cancelled`/`interrupted`（無変更）
- Progress: `progress`(0-100)構造化フィールド＋JSONLイベント履歴（無変更）
- cancellation: cooperative（`JobContext.check_cancelled()`）

### Frontend

- **`jobDisplayModel.js`（#131で新設）**: `toJobDisplayModel(source, raw, options)`が両Systemの生job shapeを共通`JobDisplayModel`（`id`/`source`/`type`/`engine`/`displayStatus`/`rawStatus`/`progress`/`message`/`error`/`createdAt`/`startedAt`/`updatedAt`/`finishedAt`/`canCancel`/`canRetry`/`canOpenDetails`）へ正規化する。canonical categoryは`queued`/`running`/`cancelling`/`success`/`failed`/`cancelled`/`interrupted`/`unknown`の8種
- `JobsView.jsx`が`jobDisplayModel.js`を使用（System Bのみ）。`TrainingView.jsx`は意図的に無変更（#131のDesign Decision、`deriveUiTrainingState`等の既存log parsing正規化層を維持）
- Polling: TrainingView固定2000ms／JobsView可変3000ms(active)/10000ms(idle)。いずれも無変更

## 2. Remaining Duplicate Contracts（表示差 vs Backend semantic差の分離）

| 契約 | System A | System B | 表示差のみか、Backend semantic差か |
|---|---|---|---|
| list | `GET /train/{job_id}`（単一job、project内1件想定のTrainingView UI） | `GET /api/jobs`（project/type/status/requested_by/date range filter付き一覧） | **Backend semantic差**。System Aはそもそも「一覧」概念を持たない（1画面=1 active job）。System Bは多数jobの並行管理を前提とした設計。Facadeで一覧APIを統一しても、System A側に「一覧で見る」実際のニーズが無い |
| get/detail | `jobInfo`（`training_jobs`の生レコード） | `job` detail（`job_manager_jobs`の生レコード） | 表示差のみ（#131の`jobDisplayModel.js`で既に吸収済み） |
| status/state | `queued/running/completed/failed/stopped`（5語彙） | `queued/running/succeeded/failed/cancel_requested/cancelled/interrupted`（7語彙、`cancel_requested`という非terminal状態を持つ） | 表示差は#131で吸収済み。**`cancel_requested`という中間状態の有無自体はBackend semantic差**（System Aにはcooperative cancelという概念自体が無い） |
| progress | log parsing（クライアント側`parseTrainingProgress`） | 構造化`progress`フィールド | **Backend semantic差**。System A側に構造化progress reportを追加する実装（各training実行コード内へのcallback追加）をしない限り、Facade側の変換だけでは解消しない |
| logs/events | `GET /api/ocr/train/log/{job_id}`（生ログtail、OCR familyのみ） | `GET /api/jobs/{job_id}/events`（構造化JSONLイベント） | **Backend semantic差**。System Aはengine別ログフォーマットに依存し、System Bのようなイベント抽象を持たない |
| cancel/stop | OS process tree kill（#133で強化、`_terminate_training_process_tree`） | cooperative cancel（`check_cancelled()`） | **Backend semantic差（根本的）**。#123/#133で確認済み: Training系の「今すぐ確実に止める」という要求にはOS killが必要で、cooperativeへ後退させると既存の強い保証を失う。統一しない方針は#123から一貫している |
| timestamps | `created_at`/`updated_at`のみ（`started_at`/`finished_at`が存在しない） | `created_at`/`started_at`/`finished_at`のみ（`updated_at`が存在しない） | 表示差のみ（#131で`null`のまま扱う設計により吸収済み） |
| error/message | `message`のみ（成功/失敗/進行中を兼用） | `message`と`error_summary`が分離 | 表示差のみ（#131で吸収済み） |
| retry/rerun | 明示的な再実行APIなし（同一パラメータで新規`train/start`を呼ぶ運用） | `POST /api/jobs/{job_id}/retry`（`retry_source_job_id`保存） | **Backend semantic差**。System Aには`retry_source_job_id`相当の系譜追跡が無い |

**結論**: 8契約のうち3つ（get/detail、timestamps、error/message）は既に#131のFrontend adapterで完全に吸収済みであり、Backend側でこれ以上共通化する価値は乏しい。残り5つ（list、status/state、progress、logs/events、cancel/stop、retry/rerun）は、Frontend表示の問題ではなく**Backendの実行モデル・永続化モデル自体の違いに起因する真のsemantic差**であり、Shared Job Facadeを導入しても「同じ見た目のAPIの下でsource別に分岐する」以上のことはできない。

## 3. API Surface比較

| 候補 | 現状 | Facade化の安全性評価 |
|---|---|---|
| unified read-only list/detail API | System Aは`GET /train/{job_id}`（単一）、System Bは`GET /api/jobs`（一覧+filter） | **低〜中**。System A側に「一覧」ニーズが実際に無い（TrainingViewは常に1 active jobだけを見る設計）ため、統一しても呼び出し元（Frontend）を書き換える動機が薄い。#131で表示レベルは既に統一済みのため、Backend API統一の追加価値は限定的 |
| unified cancel facade | `POST /api/{family}/train/stop/{job_id}`（OS kill）と`POST /api/jobs/{job_id}/cancel`（cooperative） | **低**。実行意味論が根本的に異なり（#123/#133で確認済み）、共通APIの下に隠しても呼び出し元は依然として「どちらのsystemのjobか」を知っている必要がある（confirm dialogの文言等、UI側で既に使い分けている） |
| unified event/log API | `GET /api/ocr/train/log/{job_id}`（生ログ、OCR familyのみ）と`GET /api/jobs/{job_id}/events`（構造化イベント） | **低**。System A側に構造化イベントを生成する仕組みがそもそも無く、Facadeで形式だけ揃えても中身（log parsing由来の近似値）は変わらない |
| unified create/start API | `POST /api/{family}/train/start`系4本と`POST /api/jobs`（`job_type`指定） | **最高リスク（Issue本文の指示通り、先行実装前提にしない）**。作成時の入力パラメータ形状（training_family/engine別の必須パラメータ）が全く異なり、統一するとバリデーション・同時実行制御ルール（#123で確認したproject単位 vs システム全体単位の違い）まで巻き込む設計変更になる |

**結論**: 4候補のうちどれも「今すぐ実装する価値が明確に高い」ものはない。read-only list/detail（Option B相当）が相対的に最もリスクが低いが、#131のFrontend adapterが既に同等の価値を提供しているため、Backend側での重複実装になりやすい。

## 4. Shared DTO案（Backend側）

Issue本文の候補fieldに基づき、`frontend/src/lib/jobDisplayModel.js`（#131）と対応する形でBackend DTOを設計するとすれば以下になる（**実装はしない、設計のみ**）:

```python
{
    "id": str,
    "source": "training" | "job_manager",
    "type": str | None,
    "raw_status": str,
    "canonical_status": "queued" | "running" | "cancelling" | "success" | "failed" | "cancelled" | "interrupted" | "unknown",
    "progress": float | None,  # System Aは常にNone（構造化フィールドが存在しないため）
    "message": str | None,
    "error": str | None,
    "created_at": str | None,
    "updated_at": str | None,  # System Bは常にNone
    "finished_at": str | None,  # System Aは常にNone
    "can_cancel": bool,
    "can_retry": bool,
}
```

これは#131のFrontend `JobDisplayModel`とほぼ同型であり、**Backend側で同じ変換をもう一度実装することは、Frontendで既に解決済みの問題を重複して解くことになる**。Backend DTOを新設する価値があるのは、(a) Frontend以外のconsumer（CLI・外部連携等）が将来的に必要になった場合、または(b) Frontend側のadapterロジック自体をBackendへ寄せて二重管理を避けたい場合、のいずれかだが、**現時点でこのいずれの動機も存在しない**（(a)は将来の仮定、(b)は#131の実装コストが既に払われた後でありbackendへ移す追加コストに見合う理由が無い）。

## 5. Repository Boundary

- #127によりSystem BもSQLite化されたが、`training_jobs`とのtable統合は行っていない（意図的、Architecture Investigation #123の結論通り）
- Shared Facadeが必要になった場合でも、**複数Repositoryを束ねるだけで十分**であり、unified repository interfaceは不要と判断する。理由: 両Repositoryの`insert`/`get`/`list`/`update`のシグネチャ自体は既に似た形をしている（`job_manager.py::JobRepository`と`db.py`の関数群）が、統一インターフェースを導入するとどちらか一方の型（dict shapeやID形式）に強制的に寄せる設計変更が必要になり、Design Principle（DB table統合はしない）と矛盾しかねない
- DB schema統合は依然不要（#123・#127の結論を再確認、変更なし）

## 6. Executor Boundary

- Training subprocess semantics（#129/#133で検証・修正済み）は維持する
- Facadeを導入する場合でも、**Executorの隠蔽（プロセスkillかcooperative cancelかを呼び出し元から見えなくする）は行うべきではない**。理由: #133で確認した通り、Windows/Unixの違いだけでなくTraining/JobManagerの違いも実行時に呼び出し元（Frontend）が意識すべき情報である（confirm dialogの文言差、"停止"と"キャンセル"という異なるUI表現が既に使い分けられている）。抽象化レイヤーの下に隠すと、この意図的な差異表現ができなくなる
- cancelはsource-specific adapterへ委譲すべき（現状の`onStopTraining`/`onCancel`という別ハンドラのままにする、#131のDesign原則と一致）
- start/createは共通化しない方が安全（§3の結論通り）

## 7. Progress / Events

- read-only facadeで共通形へprojectionすること自体は可能（#131の`jobDisplayModel.js`が既に実証済み、Frontend側で）
- System Aへ構造化event書込みを追加する実装（各engine実行コード内へのprogress report callback追加）は、**Training algorithm変更に近い変更範囲**になり、本Investigationのスコープ外（Issue本文Out of Scope）
- 価値評価: 追加コストに見合うか？ 現状、TrainingViewは既にlog parsingベースのprogress表示で実用上機能しており（iteration/epoch単位の詳細な進捗表示は、System Bの単純な0-100%よりむしろ情報量が多い）、構造化イベントへの置き換えは**表示の後退になりかねない**。価値なしと判断する

## 8. Frontend Integration（#131との関係）

- Backend Facade導入でFrontend adapter（`jobDisplayModel.js`）を削減できるか: **できない**。`jobDisplayModel.js`はSystem A側の`progressOverride`（log parsing結果）を受け取る設計になっており、Backend Facadeがこれを代替するには結局System A側に構造化progress reportを実装する必要がある（§7で不要と判断済み）。Backend DTOを追加しても、Frontend側の変換ロジック自体はほぼそのまま残る
- Frontendだけで十分で、Backend Facadeが不要ではないか: **その通りと判断する**。#131の実装により、表示契約の共通化という当初の目的は既に達成されている
- JobsViewへTraining jobsも表示する価値があるか: **無いと判断する**。TrainingViewは既に1画面で完結したUXを提供しており、JobsViewへ二重表示する動機（横断的な検索・フィルタニーズ）は本Investigationの調査範囲では確認できなかった
- TrainingViewをJobsViewへ統合する必要はないことを再確認: **確認した**（#131のOut of Scopeを維持）

## Architecture Options比較

| Option | 評価 |
|---|---|
| **A: No Backend Facade（推奨）** | Frontend #131の共通表示だけで、現時点のduplicate contract問題（表示レベルの重複）は解消済み。Backendの実行モデル差はFacadeで隠すべきではないもの（§6）であり、追加実装の必要性が無い |
| B: Read-only Shared Job Facade | list/detail/status projectionのBackend統一。§3の通り、System Aに「一覧」ニーズが無く、#131が既に同等の価値を提供しているため、実装コストに見合う追加価値が薄い |
| C: Read + Cancel Facade | cancel semanticsが根本的に異なる（§6）ため、共通API化しても呼び出し元は依然としてsource判別が必要。Bの価値の薄さに加え、cancel統一の実装コストが増えるだけ |
| D: Full Facade | create/start統合が最高リスク（§3）。明確な価値が無い限り推奨しない（Issue本文の指示通り） |

**推奨: Option A（No Backend Facade）**。#123時点でOption Cを「将来方向」として残したが、#131の実装により、当初Facadeで解決しようとしていた問題（Frontendの表示重複）は既に解消された。残っている差異はBackendの実行モデル自体の違いであり、Facadeという抽象化レイヤーで解決すべき性質の問題ではないと判断する。

## Architecture Questions（15問回答）

1. **#123以降、Shared Job Facadeの必要性は上がったか下がったか。** — **下がった**。#131がFrontend側で表示契約の共通化を既に達成したため、Facadeが解決するはずだった問題の大部分が既に解消されている
2. **Frontend #131だけで十分ではないか。** — **十分と判断する**（§8）
3. **read-only facadeはユーザー/保守価値があるか。** — 限定的（§3）。System Aに「一覧」ニーズが無いため、ユーザー価値は薄い。保守価値も、#131の重複が既に解消済みのため薄い
4. **cancel facadeは安全に共通化できるか。** — 技術的には可能だが、意図的に共通化すべきではない（§6、実行意味論の違いをUIから隠すべきではないため）
5. **create/start facadeは今必要か。** — 不要（§3、最高リスクの領域）
6. **unified DTOは何を必須fieldとすべきか。** — §4で設計は示したが、実装は推奨しない。仮に実装する場合は`id`/`source`/`raw_status`/`canonical_status`/`can_cancel`/`can_retry`が必須、`progress`/`message`/`error`/timestamps系はnullable
7. **raw status/sourceを保持すべきか。** — 保持すべき（#131のFrontend DTOと同じ原則。既存語彙を書き換えない）
8. **System Aのlog-based progressをFacadeでどう扱うか。** — Facade側でのprojectionは可能（#131で実証済み）だが、Backend Facade自体を新設する動機にはならない（§7）
9. **event/log APIは統一すべきか。** — 統一すべきではない（§7、System A側への構造化event実装というTraining algorithm変更に近いコストに見合わない）
10. **repository interfaceを共通化する必要はあるか。** — 不要（§5、複数Repositoryを束ねるだけで十分）
11. **DB table統合は不要のままでよいか。** — 良い（§5、#123・#127の結論を維持）
12. **existing API compatibilityをどう維持するか。** — Option A採用のため、既存API自体を一切変更しない（維持は自明に達成される）
13. **rolling migration/dual endpoint期間は必要か。** — 不要（Option A採用のため、migration自体が発生しない）
14. **frontend pollingを統一する価値はあるか。** — 本Investigationのスコープでは価値を確認できなかった（#131のOut of Scopeを維持。TrainingViewの固定2000ms・JobsViewの可変3000/10000msは、それぞれの画面特性に応じた既存の合理的な設計と判断する）
15. **最小安全な次Issue分割は何か。** — 次Issueの新規作成は推奨しない（§Recommended Output参照）。現時点でBackend Facade関連の新規実装Issueを起票する積極的な理由がない

## Recommended Output

1. **Backend Shared Job Facadeを今実装する / しない**: **実装しない**。#131により、Facadeが解決するはずだった主要な問題（Frontend表示契約の重複）は既に解消済みであり、残る差異はBackendの実行モデル自体の意図的な違いである
2. **推奨Option**: **Option A（No Backend Facade）**
3. **実装する場合の最小scope**: 該当なし（実装を推奨しないため）
4. **次Issue一覧と順序**: 推奨する新規Issueなし。Architecture Investigation #123で開始された一連の調査・改善（#125/#127/#129/#131/#133）は、本Investigation（#135）の結論をもって完結したと判断する。将来、以下のいずれかの状況変化があれば本Investigationの結論を再評価すべき: (a) JobsViewでTraining jobsを横断的に検索・管理したいという具体的なユーザー要望が生まれた場合、(b) Frontend以外のJob consumer（CLI等）が必要になった場合、(c) System Aへ構造化progress/eventを追加する具体的な動機（例: 外部監視ツール連携）が生まれた場合
5. **Epic #28等、無関係なarchitectureへ波及させないこと**: 波及させていない（本Investigationのスコープ・調査範囲は#123系列のJob Lifecycle関連のみ）

## Scope外（Out of Scope、実施しなかったこと）

- Shared Job Facade Production実装
- Job Lifecycle全面統合
- `training_jobs` / `job_manager` DB統合
- Training subprocess architecture変更
- Frontend Job画面全面統合
- Epic #28 Consumer Migration
- 次Issueの新規作成（推奨Issueなしという結論のため、そもそも作成対象がない）

## Production Changes

なし。本Issueはdocs追加・更新のみ。`git diff --stat main -- src/ frontend/src/`で差分0を確認済み。

## Tests / Verification

Production変更が無いため新規testsは不要。実コード（`main.py`のJob関連endpoint群・`job_manager.py`・`jobDisplayModel.js`）と本書の記述が一致することをgrep/Readで確認済み。

## Future Work

- 本Investigationの結論により、Architecture Investigation #123から続く一連のJob Lifecycle関連調査・改善は完結したと判断する。今後新たな具体的動機（§Recommended Output 4参照）が生じない限り、追加のJob Lifecycle関連Investigationは不要
