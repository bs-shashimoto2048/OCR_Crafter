# JobRepository SQLite Migration 作業記録

Related: Feature [#127](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/127) / Architecture Investigation [#123](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/123)（Job Lifecycle Unification、Completed、Theme 3の関係を整理） / Investigation [#115](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/115)（Theme 3の起点） / Reliability [#125](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/125)

**状態**: Completed / Closed。PR [#128](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/128)、Squash Commit `2baad09`でマージ済み。

## 目的

Architecture Investigation #123の結論（Theme 3「jobs.json→SQLite移行」はJob Lifecycle Unificationの前提条件ではなく独立Issueとして進めてよい）に従い、Job System B（`job_manager.py`/`JobRepository`）の永続化層のみを`data/jobs/jobs.json`からSQLiteへ移行する。Training Job（`training_jobs`テーブル+subprocess、Job System A）のlifecycle・API契約は一切変更しない。

## 実装前調査（Mandatory Investigation）

### 1. 既存`JobRepository`契約

`job_manager.py`を全文読了。Public/準Publicメソッド: `next_id()` / `insert(job)` / `update(job_id, patch)`（未存在は`FileNotFoundError`） / `get(job_id)` / `list()` / `get_config(key, default)` / `set_config(key, value)` / `append_event(job_id, event)` / `read_events(job_id)` / `write_internal_log(job_id, text)`。

**重要な発見**: `JobService.create_job()`（`with self.repository._lock, file_lock(self.repository._path()):`）と`backup_manager.py::apply_retention()`（`with repository._lock: ... repository._load() ... repository._save(registry)`）は、`_lock`（threading.RLock）・`_path()`・`_load()`・`_save()`という**private扱いだが外部から直接reachされている4つのメンバ**に依存している。これらを保つことがInterface互換の実質的な条件になる。

- read-modify-writeは`next_id`/`insert`/`update`/`set_config`が`self._lock` + `file_lock(self._path())`で排他、`get`/`list`/`get_config`は無ロック
- 保存は`atomic_io.atomic_write_json`（一時ファイル→os.replace）
- ソート順は挿入順（JSON配列のappend順）、`list_jobs()`側で`reversed()`して新しい順にする
- イベントは`data/jobs/events/JOB-xxxxxx.jsonl`（追記型JSONL）、内部ログは`data/jobs/logs/JOB-xxxxxx.log`。**いずれもRepositoryのメソッド経由だが実体はファイルのまま**

### 2. `jobs.json`のデータ形状

`_create_job_locked()`（`job_manager.py`）が生成する正準スキーマを確認した。ルートは`{"counter": int, "items": [Job...], "config": {...}}`。各Jobは`job_id` / `project_id` / `job_type` / `status` / `requested_by` / `created_at` / `started_at` / `finished_at` / `progress`(int) / `current_step` / `message` / `params`(dict) / `result_summary`(dict|None) / `error_summary` / `related_experiment_id` / `related_model_id` / `related_benchmark_id` / `retry_source_job_id` / `cancellation_requested_at`の19フィールド。存在しないフィールドを推測で追加していない。

`config`はキーバリュー（例: `benchmark_concurrency`）。JSON自体はスキーマレスで、部分的なdict（一部フィールドのみ）を`insert()`しても既存実装は何も検証せずそのまま格納していた（`tests/test_dashboard_summary.py::_seed_job()`が実例。詳細は§4）。

### 3. 実際の到達可能なConsumer

Architecture Investigation #123の調査結果を再確認し、grepで裏取りした。

| job_type | 実運用での到達経路 |
|---|---|
| `benchmark` | `POST /api/benchmarks`（専用wrapper） |
| `report_generate` | `POST /api/reports/generate`（専用wrapper） |
| `preprocess` | 到達なし。実運用は`POST /preprocess/run`が同期実行、Job Systemを経由しない |
| `dataset_creation` | 到達なし |
| `training` | 到達なし（実運用のTraining画面は`/api/{tesseract,ocr,trocr}/train/start`＝Job System A経由） |
| `deployment_export` | 到達なし。実運用は`GET /api/releases/deployment_package`が同期実行 |
| `evaluation` | 本調査でも専用wrapper endpointは未特定（#123と同じ結論。汎用`POST /api/jobs`経由の可能性が高いが未確認） |

「handlerが登録されている」ことと「実運用で到達可能」であることは区別した。`preprocess`/`dataset_creation`/`training`/`deployment_export`は汎用`POST /api/jobs`（任意の`job_type`文字列を受理）を経由してテストからのみ到達する。本Issueはこの到達可能性の実態を変更しない（Repositoryの永続化層のみが対象）。

### 4. 既存SQLite基盤

`src/app/db.py`を確認した。`get_conn()`（`sqlite3.connect(path)`、呼び出しごとに新規接続）・`init_db()`（`CREATE TABLE IF NOT EXISTS training_jobs` + `ALTER TABLE ADD COLUMN`による後方互換拡張）・`ACTIVE_TRAINING_STATUSES`等。テスト隔離は`isolated_test_db`フィクスチャ（`db._db_path()`をtmp_pathへ差し替え）。

`training_jobs`テーブルは`outputs/app.db`の唯一のテーブル。migration/versioning方針は「`ALTER TABLE ADD COLUMN`＋既存列は変更しない」という後方互換スタイル（Issue #94等で実績あり）。

## Storage Decision: Option B（専用`data/jobs/job_manager.db`）を採用

Issue本文はOption A（既存`outputs/app.db`へ`job_manager_jobs`table追加）を既定案として提示し、既存`docs/26_PERFORMANCE_LIMITS.md`の当初計画も同様だった。**実装前調査の結果、Option Bへ変更した。**

理由:

1. **テスト隔離**: 既存の`tests/test_job_manager.py`等13ファイルは`temp_projects`フィクスチャ（`PROJECTS_DIR`をtmp_pathへ差し替える）のみで`job_manager`関連の実データから隔離されている。`_jobs_root()`は`PROJECTS_DIR`の親から導出されるため、SQLiteファイルを`data/jobs/`配下（`_jobs_root()`経由）に置けば、既存の`temp_projects`のみで自動的に隔離される。もし`outputs/app.db`（`db.py::_db_path()`経由、`PROJECTS_DIR`とは独立した設定値）を使うと、既存の`temp_projects`だけでは隔離されず、**Issue #8/#112で解消したばかりの「テストが実DBへ副作用を出す」クラスの問題を、job_manager関連の13テストファイルに対して再発させてしまう**（各ファイルへ`isolated_test_db`を追加する広範な改修が必要になっていた）
2. **Architecture Investigation #123の懸念（Training Job tableとの誤統合リスク）を、テーブル分離よりさらに強く回避できる**（ファイルレベルで完全分離）
3. Option Bの他のPros（Job System Bの境界維持・migration/rollbackの容易さ）も本Issueの目的（Job Lifecycle Unificationとは無関係に永続化層だけ差し替える）に合致する

Cons（DBファイル増加・backup対象増加）は許容する: `data/jobs/`は既に`docs/25_DISASTER_RECOVERY.md`でバックアップ対象外と明記されたシステム全体データであり、ファイルが1つ増えても運用上の扱いは変わらない。

## Schema

`data/jobs/job_manager.db`（SQLite、WALモード）に3テーブル。

```sql
CREATE TABLE job_manager_jobs (
    job_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    job_type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    requested_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT '',
    finished_at TEXT NOT NULL DEFAULT '',
    progress INTEGER NOT NULL DEFAULT 0,
    current_step TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    params TEXT NOT NULL DEFAULT '{}',       -- JSON text
    result_summary TEXT,                     -- JSON text、NULL可
    error_summary TEXT NOT NULL DEFAULT '',
    related_experiment_id TEXT NOT NULL DEFAULT '',
    related_model_id TEXT NOT NULL DEFAULT '',
    related_benchmark_id TEXT NOT NULL DEFAULT '',
    retry_source_job_id TEXT NOT NULL DEFAULT '',
    cancellation_requested_at TEXT NOT NULL DEFAULT ''
);
-- INDEX: status / job_type / project_id / created_at

CREATE TABLE job_manager_counter (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL DEFAULT 0);
CREATE TABLE job_manager_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- value=JSON text
```

過剰な正規化を避け、`params`/`result_summary`はJSON textのまま1カラムに保持した（Issue指示通り）。イベント履歴（`events/*.jsonl`）・内部ログ（`logs/*.log`）はテーブル化せず既存のファイル方式のまま（`docs/26_PERFORMANCE_LIMITS.md`の既存移行計画通り）。

## Migration Policy

`migrate_legacy_jobs_json(repository=None)`（`job_manager.py`）を新設し、`JobWorker.start()`から呼ぶ（`recover_interrupted_jobs()`と同じ配置。テスト実行時は`OCRC_DISABLE_WORKER_AUTOSTART`により呼ばれない）。

1. `data/jobs/jobs.json`が存在しなければ即座に`no_legacy_file`を返す（新規インストール、または既に移行済みで2回目以降の起動）
2. JSONとして読めない（`OSError`/`ValueError`/`TypeError`）場合は取り込まず、`jobs.json.malformed.<timestamp>`へリネームして内容を保全する（**サイレントなデータ消失はしない**。中身自体は復元できないため、ファイルとして残す以上のことはしない）
3. 正常にparseできた場合、`items`内の各要素について:
   - dict形状でない、または`job_id`が空のものはスキップ（部分的に不正な要素があっても正常な要素だけ取り込む）
   - SQLite側に同じ`job_id`が既に存在する場合は**上書きせずスキップ**（`skipped_duplicate`としてカウント。重複を決定的に扱う＝既存データを正とする）
   - それ以外は`repository.insert(item)`でそのまま取り込む
4. counterはSQLite側の現在値とlegacyの`counter`の**大きい方**を採用する（IDの巻き戻り防止）
5. legacy側の`config`は、SQLite側にまだ存在しないキーのみ設定する（既存カスタム設定を上書きしない）
6. 取り込み後（0件でも）、legacy fileは削除せず`jobs.json.migrated.<timestamp>`へリネームする。**このリネーム自体が「移行済みマーカー」を兼ねる**ため、次回起動時は手順1で`no_legacy_file`となり再処理されない＝**冪等**

Rollback strategy: legacy `jobs.json`は`jobs.json.migrated.<timestamp>`として保全され続ける（自動削除しない）。移行後に問題が見つかった場合、当該`.migrated`ファイルを`jobs.json`へ戻し、`data/jobs/job_manager.db`を削除すれば旧JSON実装（`_LegacyJsonJobRepository`、コード上は残置）の状態へ復元できる（ただしSQLite側でのみ新規作成されたJobがあれば、それは`jobs.json`側に反映されないため失われる。実運用では移行直後・アクティブJobがまだ無いタイミングでの検証を推奨する）。

## Concurrency / Atomicity

- write系（`next_id`/`insert`/`update`/`set_config`）は既存と同じ`self._lock`（プロセス内RLock）+ `file_lock(self._path())`（プロセス間、`job_manager.db.lock`）で排他する。`JobService.create_job()`・`backup_manager.apply_retention()`は`repository._lock`/`repository._path()`/`repository._load()`/`repository._save()`という既存の private attribute reach-throughをそのまま利用できるよう、同名のメンバをSQLite実装でも維持した
- read系（`get`/`list`/`get_config`）は無ロック（旧実装と同じ設計）。Worker daemon threadの書き込みとFastAPIリクエストスレッドの読み取りが衝突しても失敗しないよう、**WALモード（`PRAGMA journal_mode=WAL`）のみ**を有効にした（本Issueで導入した唯一のDB tuning。それ以外の設定変更は行っていない）
- 接続は`db.py`と同様に呼び出しごとに新規`sqlite3.connect()`（`check_same_thread`は既定のまま、接続をスレッドをまたいで共有しない）
- **シングルトン対応**: `JobRepository`はアプリ全体で1インスタンス（`get_job_service()`）として使い回される。テストごとに`temp_projects`が`PROJECTS_DIR`（延いてはDBファイルパス）を差し替えるため、`__init__`時の一度きりのschema作成では2つ目以降のテストで`no such table`エラーになることを実装中に発見した。`_connect()`のたびに`CREATE TABLE/INDEX IF NOT EXISTS`を実行するよう修正し解消した（冪等なDDLのため許容できるオーバーヘッド）

## API / Frontend Compatibility

`GET /api/jobs`・`GET /api/jobs/{job_id}`・`POST /api/jobs`・`POST /api/jobs/{job_id}/cancel`・`POST /api/jobs/{job_id}/retry`・`GET /api/jobs/{job_id}/events`はいずれも`JobService`/`JobRepository`の既存メソッドを呼ぶのみで、エンドポイント自体は無変更。レスポンス形状（`progress`0-100・`status`語彙・`params`/`result_summary`の形・イベント履歴）も無変更。Frontend（`JobsView.jsx`・`BenchmarkView.jsx`等）は無変更（`git diff --stat -- frontend/`で差分0を確認済み）。

## Production Changes

- `src/app/services/job_manager.py`:
  - 既存のJSON実装クラスを`_LegacyJsonJobRepository`へ改称（実装は無変更、`migrate_legacy_jobs_json()`が読み取り専用で使う）
  - 新設: SQLite版`JobRepository`クラス（`next_id`/`insert`/`update`/`get`/`list`/`get_config`/`set_config`は行単位のSQL操作、`append_event`/`read_events`/`write_internal_log`は無変更のファイル実装、`_load`/`_save`は`apply_retention()`互換の一括読み書きshim）
  - 新設: `migrate_legacy_jobs_json()`
  - `JobWorker.start()`へ`migrate_legacy_jobs_json()`呼び出しを追加（`recover_interrupted_jobs()`と同じ配置）
- `tests/test_dashboard_summary.py`: `_seed_job()`ヘルパーが`jobs.json`への直接書き込みから`JobRepository().insert()`経由へ変更（Repositoryの永続化層が変わったことに追随。テストの検証内容自体は無変更）

`JobService`・`JobWorker`・`JOB_HANDLERS`・`JobContext`・`main.py`のJob関連endpoint・`backup_manager.py`・`operations.py`・`benchmark.py`・`report_generator.py`はいずれも無変更（`JobRepository`のInterfaceが維持されているため）。Training Job（`training_jobs`テーブル・`db.py`・`_reconcile_ocr_training_job`等）は無変更。

## Tests

新規: `tests/test_job_repository_sqlite_migration.py`（15件）

- Repository: 再インスタンス化後も永続化された値が読める・部分的なdictのinsertを許容・list()の順序が挿入順と一致・update()が対象外フィールドを保持・存在しないjob_idのupdate()は`FileNotFoundError`・`result_summary`のdict/None往復・`get_config`/`set_config`の既定値と永続化
- Migration: legacy fileなし・正常な複数Jobのimport（counter継承・config引き継ぎ・legacy fileのrename確認）・冪等な再実行・重複job_idはスキップ（上書きしない）・malformed JSON（内容保全つきbackup）・空items・一部不正な要素の混在・`JobWorker.start()`経由の統合確認

既存: `tests/test_job_manager.py`（30件）・`tests/test_recovery_atomicity.py`（8件、並行ID採番20並列×5種・8スレッドバリア同期での重複Job作成防止を含む）・`tests/test_backup_retention.py`（6件、`apply_retention()`の`_load`/`_save`互換確認）・`tests/test_benchmark.py`・`tests/test_audit_operations.py`・`tests/test_production_auth.py`・`tests/test_reports.py`・`tests/test_e2e_uat.py`はいずれも**無改修のまま全件パス**（Interfaceを維持したままRepositoryの永続化層のみ差し替えたことの回帰確認）。

実行結果:

```
python -m pytest -q tests/test_job_manager.py tests/test_dashboard_summary.py tests/test_recovery_atomicity.py tests/test_backup_retention.py
# 90 passed

python -m pytest -q tests/test_job_repository_sqlite_migration.py
# 15 passed

python -m pytest -q
# 1259 passed, 10 failed（既存の未導入optional package依存: transformers/ultralytics未インストール。
# 内容・件数ともIssue #125時点の既知baselineと完全一致、本Issueの変更に起因しないことを確認済み）
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し一致することを確認済み（実データへの副作用なし）。実`data/jobs/`ディレクトリに`job_manager.db`が生成されていないことも確認済み（テストは`temp_projects`により完全に隔離されている）。

Frontend diffは0（`git diff --stat -- frontend/`で確認済み）のため、Issue本文の指示通りfrontendテストの再実行は不要と判断した。

## Scope外（Out of Scope、実施しなかったこと）

- Job Lifecycle全面統合
- Shared Job Facade実装
- `training_jobs` table統合
- Training subprocess architecture変更
- Frontend Job画面redesign
- Job API全面統一
- Epic #28 Consumer Migration

## Future Work

- `data/audit/audit.jsonl`→`audit`テーブル移行（docs/26優先度2、未着手）
- `benchmarks.json`の`cases`→`benchmark_cases`テーブル移行（docs/26優先度3、未着手）
- legacy evaluationの実際の呼び出し経路（本Issue調査時点でも専用wrapper endpointは未特定。Architecture Investigation #123から継続する既知のgap）
- `_LegacyJsonJobRepository`は移行importにのみ使われ、他に呼び出し元が無い（dead codeに近いが、移行importの実装として意図的に残置している。完全に不要と判断されれば将来削除してよい）
