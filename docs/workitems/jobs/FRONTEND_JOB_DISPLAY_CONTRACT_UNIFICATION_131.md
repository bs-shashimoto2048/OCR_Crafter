# Frontend Job List/Detail Display Contract Unification 作業記録

Related: Refactor [#131](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/131) / Architecture Investigation [#123](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/123)（Job Lifecycle Unification、Completed。Option C＝Shared Job Facadeの第一歩として本Issueを推奨） / Reliability [#125](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/125) / Feature [#127](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/127) / Investigation [#129](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/129)

**状態**: Implemented, PR review pending

## 目的

Architecture Investigation #123の推奨順序（reconciliation修正→SQLite移行→Windows process semantics調査→Frontend契約の部分統一）に従い、Job Lifecycle全面統合ではなく、Frontendで分離しているTraining Job（Job System A）とJobManager系Job（Job System B）の**表示契約だけ**を部分共通化する。Backend（execution model / persistence / cancellation semantics）は一切変更しない。

## 実装前調査（Mandatory Investigation）

### 1. `TrainingView.jsx`が受け取るjob/status shape

props: `jobId`（`training_jobs.id`）・`jobStatus`（`queued`/`running`/`completed`/`failed`/`stopped`）・`jobInfo`（`training_jobs`の生レコード全体: `created_at`/`updated_at`/`message`/`model_path`/`engine`/`training_family`/`dataset_dir`/`charset`/`epochs`/`max_text_length`/`init_source_value`等）。

Progressは`jobInfo`に構造化フィールドが**無く**、`lib/trainingLog.js::parseTrainingProgress(logs)`（ログ行の正規表現解析）が唯一の情報源。既存の`deriveUiTrainingState(jobStatus, {hasIterationLog, stopRequested})`が、backend状態＋クライアント側の`hasIterationLog`/`stopRequested`を合成してTrainingView専用のUI状態（`idle`/`preparing`/`training`/`stopping`/`completed`/`failed`/`cancelled`、`UI_TRAINING_STATE_LABELS`）へ既に正規化している。

### 2. `JobsView.jsx`が受け取るjob shape

`jobs`配列の各要素は`job_manager.py`の生レコード（`job_id`/`project_id`/`job_type`/`status`/`progress`(0-100)/`current_step`/`requested_by`/`created_at`/`started_at`/`finished_at`/`message`/`error_summary`/`retry_source_job_id`/`related_model_id`/`related_experiment_id`/`related_benchmark_id`/`params`/`result_summary`）をそのまま渡している。`JOB_STATUS_LABELS`・`statusChipClass()`・`dateLabel()`・`jobDuration()`が一覧・詳細双方で個別に定義されていた（本Issueで共通化対象）。

### 3. `App.jsx`の各polling/useEffect

- TrainingView用: `setInterval(poll, 2000)`固定間隔。`jobFamily`により`GET /api/ocr/train/status/{jobId}`または`GET /train/{jobId}`を呼び分け、OCR familyのみ追加で`GET /api/ocr/train/log/{jobId}`を呼ぶ
- JobsView用: `loadJobs`を`hasActive ? 3000 : 10000`msの可変間隔で呼ぶ（`GET /api/jobs`一覧）

いずれも本Issueでは変更しない（Design Principles・Out of Scope通り）。

### 4. status/state名の差

| System | 非terminal | terminal（成功） | terminal（失敗） | terminal（中止系） |
|---|---|---|---|---|
| A（training_jobs） | `queued`/`running` | `completed` | `failed` | `stopped` |
| B（job_manager） | `queued`/`running`/`cancel_requested` | `succeeded` | `failed` | `cancelled`/`interrupted` |

Systemごとに語彙が異なり、Bには「キャンセル要求受付済みだが未終端」という状態（`cancel_requested`）がAには存在しない。

### 5. progress算出方法の差

A: ログ行解析（`parseTrainingProgress`→`computeProgressPercent`）。構造化フィールド無し。B: `job.progress`（0-100、backendが直接管理）。

### 6. error/message/time fieldの差

A: `message`のみ（成功/失敗/進行中いずれの文脈でも同じフィールドを使い回す）。`started_at`/`finished_at`は存在せず`created_at`/`updated_at`のみ。B: `message`と`error_summary`が分離。`created_at`/`started_at`/`finished_at`はあるが`updated_at`相当の汎用フィールドは無い。

### 7. cancel/stop actionの差

A: `onStopTraining`/`onStopTrainingAndDelete`→`POST /api/{family}/train/stop/{jobId}`（OS process kill、Investigation #129参照）。B: `onCancel`→`POST /api/jobs/{jobId}/cancel`（cooperative cancel、`cancel_requested`→`cancelled`）。

### 8. list/detail componentの重複箇所

`JobsView.jsx`内で一覧行・詳細パネルの双方が同じ`JOB_STATUS_LABELS`/`statusChipClass`/`dateLabel`/`jobDuration`をそれぞれ個別に呼んでいた（同一ファイル内の重複）。`TrainingView.jsx`の日時表示（`jobInfo.created_at`の直接フォーマット）はJobsViewの`dateLabel`とは意図的に異なる書式（フル`YYYY-MM-DD hh:mm:ss` vs 一覧向けの短縮`MM-DD hh:mm`）であり、真の重複ではないと判断した（§Design Decisions参照）。

### 9. 既存tests

`frontend/tests/jobsView.render.test.mjs`（`JOB_TYPE_LABELS`/`JOB_STATUS_LABELS`/`jobDuration`をJobsView.jsxから直接importして検証）・`trainingView.render.test.mjs`・`trainingLog.test.mjs`（`deriveUiTrainingState`等）・`trocrStateIsolation.test.mjs`（TrainingView/InferenceView/OcrEvaluationViewのstate isolation）を確認し、本Issueの変更後も無改修で全件パスすることを確認した。

## Design Decisions

1. **共通DTO `JobDisplayModel`を`frontend/src/lib/jobDisplayModel.js`として新設**し、両Systemのraw job shapeを正規化する純粋関数（`toJobDisplayModel(source, raw, options)`）・statusのcanonical mapping（`mapStatusToCanonical`）・共通formatting（`formatJobTimestamp`/`formatJobDuration`/`jobStatusBadgeClass`）を提供する。Backendへの変更は無い（Design Principle #1）
2. **Canonical categoryは`queued`/`running`/`cancelling`/`success`/`failed`/`cancelled`/`interrupted`/`unknown`の8種**とした。Issue本文の例示（`queued/running/success/failed/cancelled/interrupted`）に`cancelling`を追加した理由: System Bの`cancel_requested`は「非terminal・再度キャンセル不可・再実行不可」という既存UI上の固有の意味を持ち、これを`running`へ丸めると`canCancel`判定（後述）が既存の「cancel_requestedはキャンセルボタンを表示しない」という挙動と矛盾するため、区別を保持する必要があった（存在する意味を書き換えない、というDesign Principle #6の趣旨に沿う）
3. **`JobsView.jsx`のみへ具体的に適用した**。一覧・詳細の両方で`JOB_STATUS_LABELS`（`CANONICAL_JOB_STATUS_LABELS`経由の生成へ変更）・`statusChipClass`→`jobStatusBadgeClass`・`dateLabel`→`formatJobTimestamp`・`jobDuration`→`formatJobDuration`（共通実装への薄いラッパーとしてexportは維持）・キャンセル/再実行ボタンの表示条件→`toJobDisplayModel(...).canCancel`/`.canRetry`、へ置き換えた。実装はすべて既存ロジックと**計算結果が完全に同一**であることを確認済み（既存test無改修で全件パス、後述）
4. **`TrainingView.jsx`の内部（`isRunning`・`deriveUiTrainingState`・`parseTrainingProgress`等）は変更しなかった**。理由:
   - `deriveUiTrainingState`はTrainingView固有のクライアント側nuance（`hasIterationLog`・`stopRequested`という、backendのraw statusには無い情報）を合成した、既にTrainingView専用に正しく設計された正規化層であり、Design Principle #5「Training progressの既存log parsingは維持し、その結果をdisplay modelへ渡す」の対象そのものである。汎用`JobDisplayModel`で置き換えると、この既存nuanceを失うか、汎用モデル側を過度に複雑化するかのいずれかになり、いずれもリスクに見合う重複解消効果が無い
   - `isRunning`（`queued`/`running`判定）はTrainingView内で単一定義・複数箇所から参照される、既にDRYな1変数であり、他ファイルとの重複ではない。`jobDisplayModel.js`の`canCancel`と数学的に同一の結果になるが、置き換えても重複は減らず、2,594行のファイル内の複数箇所（Stop/削除ボタン・`canToggleParams`・polling effect依存配列等）を触るリスクだけが増えるため、実施しなかった
   - `jobInfo.created_at`のフル日時表示（`YYYY-MM-DD hh:mm:ss`）はJobsViewの短縮日時表示（`MM-DD hh:mm`）とは意図的に異なる書式であり、統一すると既存UXが変わってしまうため統一しなかった（Design Principle: 既存UXを壊さない）
   - 上記の判断により、`jobDisplayModel.js`はSystem A（`training`ソース）についても完全な変換・テストカバレッジを持つ（「正規化**できる**」ことをテストで証明済み）が、TrainingView.jsx自体からの具体的な呼び出しは無い。将来Training側で表示を共通化する具体的な必要が生じた場合に備え、`source: "training"`のmapping・testはIssue本文の「Suggested Display Contract」「Status Mapping」要求を満たす形で完全実装している

## Suggested Display Contractの実装

`toJobDisplayModel(source, raw, options)`が返すJobDisplayModel:

`id` / `source`(`training`|`job_manager`) / `type` / `engine`（Systemに存在する場合のみ、無ければ`null`） / `displayStatus`（canonical） / `rawStatus`（backend生値） / `progress`（nullable、0-100） / `message` / `error` / `createdAt` / `startedAt`（存在しないSystemは`null`） / `updatedAt`（同） / `finishedAt`（同） / `canCancel` / `canRetry`（Issue本文の最低限フィールドに無いが、JobsViewの既存重複ロジックであるため追加） / `canOpenDetails`。

存在しない値（例: System Aの`started_at`/`finished_at`、System Bの`updated_at`、System Aのprogress実測値）は`null`のまま返し、捏造しない。

## Tests

新規: `frontend/tests/jobDisplayModel.test.mjs`（24件）

- Pure mapping: System A 5状態・System B 7状態すべてのcanonical mapping、未知statusの`unknown`扱い、`CANONICAL_JOB_STATUSES`/`CANONICAL_JOB_STATUS_LABELS`が両Systemの全カテゴリを網羅すること
- progress: System Aは`progressOverride`経由のみ（未指定/null/undefinedは常にnull、捏造しない）・System Bは`job.progress`をそのまま使用（null/undefined入力もnullのまま）
- message/error mapping: System Aは`failed`時のみ`message`が`error`にも反映される・System Bは`error_summary`をそのまま`error`へ
- timestamp mapping: 各Systemに存在しないフィールド（A: started_at/finished_at、B: updated_at）が`null`になること
- rawStatus/source保持: 未知statusでも`rawStatus`・`source`は書き換えられないこと
- `canCancel`/`canRetry`: 両System全状態（A 5状態・B 7状態）で既存UIの表示条件と同じ真偽値になること
- formatting helper: `formatJobTimestamp`/`formatJobDuration`/`jobStatusBadgeClass`が既存の`dateLabel`/`jobDuration`/`statusChipClass`と同一の出力になること（回帰）

既存: `frontend/tests/jobsView.render.test.mjs`（`JobsView.jsx`からの`JOB_TYPE_LABELS`/`JOB_STATUS_LABELS`/`jobDuration`の直接importに依存。無改修のまま全件パスすることを確認済み）・`trainingView.render.test.mjs`・`trainingLog.test.mjs`・`trocrStateIsolation.test.mjs`はいずれも無改修で全件パス。

実行結果:

```
cd frontend && npm test
# 755 passed（既存731件 + 新規24件、いずれも失敗なし）

cd frontend && npm run build
# 成功
```

Backend変更が無いため、`python -m pytest -q`の再実行は不要と判断した（`git diff --stat -- src/`で差分0を確認済み）。CI backendも念のためgreenを確認する。

## Production Changes

- `frontend/src/lib/jobDisplayModel.js`（新設）
- `frontend/src/views/JobsView.jsx`: `JOB_STATUS_LABELS`・`jobDuration`を共通実装からの生成/委譲へ変更（exportは維持、既存consumerへの影響なし）。ローカル定義の`statusChipClass`/`dateLabel`を削除し、共通の`jobStatusBadgeClass`/`formatJobTimestamp`を使用。キャンセル/再実行ボタンの表示条件を`toJobDisplayModel(...).canCancel`/`.canRetry`へ置き換え
- `frontend/package.json`: 新規test fileをtestスクリプトへ追加

`frontend/src/views/TrainingView.jsx`・`src/`配下のBackendコードはいずれも無変更。

## Polling / Cancellation（無変更の確認）

- TrainingView: 固定2000ms polling（無変更）
- JobsView: アクティブJob有無で3000/10000ms可変polling（無変更）
- Training cancellation: OS process kill経由の`onStopTraining`/`onStopTrainingAndDelete`（無変更、endpoint・semantics共に無変更）
- JobManager cancellation: cooperative cancel経由の`onCancel`（無変更）

UI上のボタン表示条件（`canCancel`）は共通化したが、実際に呼び出すハンドラ・endpoint・semanticsはSystemごとに別のまま維持した（Design Principle #7・Out of Scope「cancellation方式統一」）。

## Scope外（Out of Scope、実施しなかったこと）

- Backend Shared Job Facade実装
- Job Lifecycle全面統合
- Training JobとJobManager JobのDB統合
- polling cadence統一
- cancellation方式統一
- Job画面全面redesign（TrainingViewとJobsViewは1画面へ統合していない）
- Job API全面統一
- Epic #28 Consumer Migration
- `TrainingView.jsx`内部（`isRunning`・`deriveUiTrainingState`・日時表示）の共通モデルへの置き換え（§Design Decisions 4で理由を記録）

## Future Work

- Backend側のShared Job Facade本体（Architecture Investigation #123のOption C、Frontend側は本Issueで準備が整った）
- 将来TrainingView.jsxに新規の共有UIコンポーネント（例: 両System共通のstatusバッジコンポーネント）を追加する必要が生じた場合、本Issueの`jobDisplayModel.js`（`source: "training"`のmappingは既に完成済み）をそのまま利用できる
