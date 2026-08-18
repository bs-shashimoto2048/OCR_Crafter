# Training Job Startup Reconciliation Parity 作業記録

Related: Reliability [#125](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/125) / Architecture Investigation [#123](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/123)（Job Lifecycle Unification、Completed） / Feature [#94](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/94)（TrOCR Training Job Integration） / Bug [#112](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/112)（training_jobs参照によるtest DB isolation問題）

**状態**: Implemented, PR review pending

## 目的

Architecture Investigation #123で確認したreliability gapを解消する。`training_jobs`+subprocess方式（Job System A）は、PaddleOCRのみ`_reconcile_ocr_training_job()`による部分的なstartup reconciliationを持つが、Tesseract/TrOCR/Classificationには同等の復旧処理が無い。サーバー異常終了・再起動後、実際にはworkerが存在しないtraining jobがqueued/running状態のまま残り続ける可能性がある。#123の結論通り、Job Lifecycle全面統合は行わず、既存`training_jobs + subprocess` lifecycle内部のreliability parityのみを最小修正する。

## 実装前調査（Mandatory Investigation）

### 1. `training_jobs`のstate一覧とstate transition

`status`カラムは自由文字列で、構造化されたstate machineは無い（Architecture Investigation #123で確認済み）。実際に使われる値: `queued`/`running`/`completed`/`failed`/`stopped`（`cancelled`ではなく`stopped`が実際の停止時state名、`_stop_training_worker()`で確認）。`ACTIVE_TRAINING_STATUSES = ("queued", "running")`（`db.py`）が非terminal扱いの唯一の定義。

### 2. `_reconcile_ocr_training_job()`および関連reconciliation関数

`main.py`の`_reconcile_ocr_training_job(job_id)`（既存、無変更）: training_family=="ocr"のjobのみ対象。engineがtesseract/trocrの場合は即座に元のjobをそのまま返す（明示的除外、コメントに「TrOCR jobのworker異常終了時の復旧はFuture Work、Issue #94では対象外」と記載）。PaddleOCR（engineがtesseract/trocr以外）の場合のみ:

1. `_recover_exported_ocr_runs(project_id)`で、`inference/`ディレクトリが有効なPaddleOCR推論成果物（`inference.yml`+`inference.pdiparams`+`inference.pdmodel`or`inference.json`）を持つ全run_dirを走査し、未登録なら`register_exported_ocr_model()`を呼んでモデル登録＋`status="completed"`へ確定する
2. 対象jobの`run_dir/inference`が有効な推論成果物であれば`completed`へ確定する
3. 非terminal状態が続き、`worker_pid`が死んでいれば、`run_dir/latest.pdparams`（学習途中チェックポイント）の有無を見る。存在すれば`failed`（"training process ended before export/registration completed"）。**存在しなければ、statusは変更せずそのまま返す**（本調査で確認した既存の残余ギャップ。worker_pidが死んでいて成果物が一切無い場合、PaddleOCR自身もstale判定できていなかった）

### 3. PaddleOCRだけが現在どの条件でreconcileされるか

`GET /api/ocr/train/status/{job_id}`（唯一の"ocr"family向けstatus endpoint、Tesseract/PaddleOCR/TrOCR共通）が`_reconcile_ocr_training_job()`を呼ぶため、**フロントエンドがこのendpointをpollした時にのみ**、かつ**PaddleOCR engineの場合にのみ**上記の復旧が働く。アプリ起動時（`on_startup()`）には一切呼ばれない。

### 4. Tesseract/TrOCR/Classificationのcall graph

4系統すべて同一パターン: `POST /api/{family}/train/start`系endpoint → `job_id = str(uuid.uuid4())` → `upsert_training_job(status="queued", worker_pid=None, ...)` → `_spawn_training_runner(job_type, job_id)`（`subprocess.Popen([...,"-m","src.app.job_runner", job_type, job_id], start_new_session=True)`）→ `upsert_training_job(worker_pid=<実pid>)` → `job_runner.py`が`init_db()`後に`_run_{family}_training_job(job_id)`を実行 → 成功時は各engine実行コードが直接`status="completed"`で確定。Classification（`GET /train/{job_id}`）はreconciliation皆無で`fetch_training_job()`を直接返す。

### 5. PID/process metadataの永続化範囲

`worker_pid`（INTEGER、`training_jobs`テーブル）のみ。4 engineすべて共通のカラムで、`_spawn_training_runner()`が返す`process.pid`をそのまま保存する。他のprocess metadata（開始時刻以外のOS識別情報等）は保持していない。

### 6. application startup時にreconciliationが呼ばれる箇所

`on_startup()`（`main.py`）はSystem B（`job_manager.py`）の`recover_interrupted_jobs()`のみを無条件で呼ぶ。System A（`training_jobs`）向けの起動時呼び出しは本Issue以前には存在しなかった。

### 7. Windows/Linuxでprocess existenceを安全に判断できる情報

既存の`_is_pid_alive(pid)`（`main.py`、無変更・そのまま再利用）が両OSに対応済み: `os.kill(pid, 0)`を試み、`ProcessLookupError`→False、`PermissionError`→True（権限が無くても存在は確認できるため）、それ以外の`OSError`（Windowsで発生しうる）の場合はWindows限定で`ctypes`経由の`OpenProcess`/`CloseHandle`にフォールバックする。本Issueではこの関数を変更せず、そのまま再利用する。

### 8. server restart時に子processが残存し得るか

`_spawn_training_runner()`は`start_new_session=True`でOS上独立したprocess groupとして起動している。したがって、サーバ（uvicorn/FastAPI）プロセスが再起動しても、既に起動済みのtraining subprocessは**そのまま生存し続ける**（意図的な設計、長時間学習をサーバ再起動から守るため）。これが「サーバ再起動をまたいで実在するworker_pidは引き続き本物のrunning jobを指す」という本Issueの前提の根拠である。

### 9. completed/failed/cancelled jobへreconciliationを再適用した場合のidempotency

`list_active_training_jobs()`（新設、db.py）が`status IN ('queued','running')`でのみ絞り込むため、terminal状態（`completed`/`failed`/`stopped`）のjobは走査対象に一切含まれない。したがって新設の`_reconcile_stale_training_jobs_on_startup()`はterminal jobを構造的に変更し得ず、繰り返し呼び出しても2回目以降は対象が残っていなければ何もしない（冪等）。

### 10. artifact/registry書込との順序

PaddleOCRについては、既存の`_reconcile_ocr_training_job()`をまず無変更のまま適用し（`register_exported_ocr_model()`等の既存artifact登録ロジックはそのまま温存）、それでもなお非terminalかつworker_pidが死んでいる場合にのみ新設のfallbackが`failed`へ確定する。Tesseract/TrOCR/Classificationは学習成功時のartifact書き込み・sidecar登録がsubprocess内で`status="completed"`更新前に完結するため（`job_runner.py`経由の各`_run_*_training_job`関数）、新設のreconciliationは`list_active_training_jobs()`の絞り込みにより既にcompletedとなったjobには到達しない。

## Required Behavior（実装内容）

### Stale Job Detection

`src/app/db.py`に`list_active_training_jobs()`を新設。project横断で`status IN ('queued','running')`のjobを`id`昇順で全件返す（決定的な順序、テストの再現性のため）。

`src/app/main.py`に`_reconcile_stale_training_jobs_on_startup() -> list[str]`を新設し、`on_startup()`から呼び出す:

1. `list_active_training_jobs()`で全project・全engine横断のnon-terminal jobを列挙する
2. `training_family=="ocr"`かつ`engine`がtesseract/trocr以外（=PaddleOCR）の場合、既存の`_reconcile_ocr_training_job(job_id)`をまず無変更で適用する（既存挙動を完全に温存）
3. その結果が非terminal（`queued`/`running`のまま）であれば、`worker_pid`の生死を`_is_pid_alive()`（既存・無変更）で確認する
4. `worker_pid`が未設定（0/None）または死んでいれば、`status="failed"`・`message="startup reconciliationによりstale jobと判断されました（workerプロセスが見つかりません）"`・`worker_pid=None`へ更新する
5. `worker_pid`が生存していれば何もしない（サーバ再起動をまたいで引き続き実行中の本物のjobとして扱う）

`on_startup()`側は、既存の`OCRC_DISABLE_WORKER_AUTOSTART`環境変数ガード（System Bの`recover_interrupted_jobs()`と共通、テスト実行時に実データへ触れないための既存規約）の内側に新設呼び出しを配置し、例外はSystem B側と同様に`logging.exception()`でログのみ行い起動自体は継続する。

### Terminal State Safety

`list_active_training_jobs()`のSQLフィルタにより、`completed`/`failed`/`stopped`のjobは構造的に対象外。追加のガード条件は不要（テストで直接検証）。

### Engine Parity

- **PaddleOCR**: 既存の`_reconcile_ocr_training_job()`を無変更のまま最初に適用し、その残余ギャップ（成果物皆無かつworker_pid死亡）のみを新設ロジックがカバーする
- **Tesseract/TrOCR/Classification**: 既存のengine別reconciliationが無いため、新設ロジックのみが唯一の判定経路となる。3 engineとも`worker_pid`の永続化方式が完全に同一のため、判定ロジックに差異は無い

### Error/Message Contract

新しいpublic API schemaは追加しない。既存の`message`カラム（`GET /train/{job_id}`・`GET /api/ocr/train/status/{job_id}`等の既存レスポンスに既に含まれる）へ「startup reconciliationによりstale jobと判断されました」という診断可能な文言を設定するのみ。

### No Job Architecture Unification

`job_manager.py`との統合・`jobs.json` migration・Shared Job Facade・execution model変更・job ID変更・training API redesignはいずれも実施していない。

## Production Changes

- `src/app/db.py`: `list_active_training_jobs()`を新設（`training_jobs`テーブルの既存カラムのみ参照、schema変更なし）
- `src/app/main.py`:
  - import追加: `ACTIVE_TRAINING_STATUSES`, `list_active_training_jobs`（`.db`より）
  - `_reconcile_stale_training_jobs_on_startup()`を新設
  - `on_startup()`へ新設関数の呼び出しを追加（既存の`OCRC_DISABLE_WORKER_AUTOSTART`ガードの内側）

`_reconcile_ocr_training_job()`・`_is_pid_alive()`・`_spawn_training_runner()`・`_stop_training_worker()`・`job_runner.py`・DB schema（`CREATE TABLE`/`ALTER TABLE`）・既存API contract・既存job IDフォーマットはいずれも無変更。

## Compatibility

- 既存API（`GET /train/{job_id}`・`GET /api/ocr/train/status/{job_id}`・`GET /api/tesseract/train/status/{job_id}`・`GET /api/trocr/train/status/{job_id}`）のレスポンス形状は無変更（既存の`message`フィールドへ書き込む値が変わるのみ）
- 既存のPaddleOCR reconciliation挙動（export検知・部分checkpoint検知）は無変更
- `OCRC_DISABLE_WORKER_AUTOSTART=1`（テスト実行時の既存規約、`tests/conftest.py`）が設定されている場合、新設のreconciliationも従来のSystem B同様に実行されない

## Tests

新規: `tests/test_training_job_startup_reconciliation.py`（19件、`isolated_test_db`フィクスチャ使用、実DB `outputs/app.db`へは一切触れない）

- Tesseract/TrOCR/Classificationのstale running job reconciliation（worker_pid死亡時に`failed`へ補正、パラメータ化テスト）
- worker_pid未設定（missing）のqueued jobも同様にstale判定されること
- worker_pidが生存している場合は状態変更されないこと（3 engine共通）
- PaddleOCR既存reconciliationがそのまま再利用されること（無回帰）
- PaddleOCR既存reconciliationが非terminalのまま返す残余ケースが新設fallbackでカバーされること
- terminal状態（completed/failed/stopped）のjobが無変更のままであること
- 繰り返し呼び出しの冪等性
- 無関係のjob（別project・生存中・completed）が影響を受けないこと
- `on_startup()`が`OCRC_DISABLE_WORKER_AUTOSTART`未設定時に新設reconciliationを呼び出すこと、設定時には呼び出さないこと（既存のtest隔離規約の回帰確認）
- `list_active_training_jobs()`がproject横断で正しく絞り込むこと

`_is_pid_alive()`は全テストでmonkeypatchにより固定し、実際のプロセス起動・OS依存の挙動には依存しない。

実行結果:

```
python -m pytest -q tests/test_training_job_startup_reconciliation.py
# 19 passed

python -m pytest -q tests/test_training_guard.py tests/test_trocr_training_job.py
# 24 passed（既存reconciliation関連テストの無回帰確認）

python -m pytest -q
# 1244 passed, 10 failed（既存の未導入optional package依存: transformers/ultralytics未インストールによる
# ModuleNotFoundError。git stashで本Issueの変更を除いたclean mainでも同一の10件が失敗することを確認済み、
# 本Issueの変更に起因しない）
```

`outputs/app.db`のsha256チェックサムをテスト実行前後で比較し、一致することを確認済み（実データへの副作用なし）。

## Scope外（Out of Scope、実施しなかったこと）

- Job Lifecycle全面統合
- Shared Job Facade
- `jobs.json → SQLite` migration
- Frontend Job UI redesign（本Issueはbackendのみ、Frontend diffは0）
- Training algorithm変更
- Artifact contract redesign
- Epic #28 Consumer Migration

## Future Work

- PaddleOCRの`_reconcile_ocr_training_job()`自体（worker_pid死亡かつ成果物皆無の場合に`current`をそのまま返す挙動）は本Issueでは変更していない。新設のfallbackがその残余ケースを別レイヤーでカバーしているが、将来的に`_reconcile_ocr_training_job()`自体へ同等のロジックを統合し、二重の判定経路を一本化する余地はある
- Windows環境における`os.killpg`/`_is_pid_alive`の実機検証はArchitecture Investigation #123のRisk Analysisで指摘された既存の未検証事項であり、本Issueでも新規の実機検証は行っていない（既存関数の再利用のみ）
- Job Lifecycle Unification（Option C方向での段階的統一）はArchitecture Investigation #123の推奨に従い、引き続き別Issueとして扱う
