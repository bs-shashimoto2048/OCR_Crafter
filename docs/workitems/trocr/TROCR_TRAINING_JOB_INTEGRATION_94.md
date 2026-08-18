# TrOCR Training Job Integration 作業記録

Related: Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Investigation [#88](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/88) / Feature [#90](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/90)（Dataset Adapter） / Feature [#92](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/92)（Training Backend Core） / Feature [#94](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/94)

**状態**: Completed・Closed。PR [#95](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/95)をSquash Merge・mainへ反映済み、Merge Commit: `712bb19`。Issue #94はPR本文の`Closes #94`によりマージ時に自動Close。

## 目的

Investigation #88で確定した実装分割の第3段階として、Issue #92のTrOCR Training Backend Core（`run_trocr_training()`）を既存Training Job lifecycleへ統合する。Training Core自体は再実装せず、既存job infrastructure（`training_jobs`テーブル・`_spawn_training_runner`・多重起動防止・キャンセル・状態取得・ログ取得）へTrOCRを接続する。

## 実装前調査（既存Job Call Graph）

実コードを再確認し、以下を確定した。

- Tesseract/PaddleOCRはそれぞれ専用エンドポイント（`POST /api/tesseract/train/start`・`POST /api/ocr/train/start`）を持つ。後者は`engine != "paddleocr"`を400で拒否しており、汎用engine受理契約ではない
- 唯一の合流点（composition point）は`_spawn_training_runner(job_type, job_id)`（サブプロセス起動）と、`job_runner.py`のjob_type分岐（`-m src.app.job_runner <job_type> <job_id>`）
- Job lifecycle（`queued → running → completed/failed/stopped`）は`training_jobs`テーブル1本で共通管理され、各engineのorchestration関数（`_run_ocr_training_job()`/`_run_tesseract_training_job()`）が同一の構造（fetch → running更新 → try実行 → 成功/失敗の状態更新）を持つ
- キャンセルは`_stop_training_worker()`が`worker_pid`へ`os.killpg(SIGTERM)`を送るOSプロセスレベルの機構であり、Engine固有の実装は不要（`_spawn_training_runner`が`start_new_session=True`でサブプロセス化している前提）
- 進捗は構造化カラムを持たず、`log_path`への生ログをフロントが正規表現パースする（`frontend/src/lib/trainingLog.js`。PaddleOCR/EasyOCR系は`"epoch: [N/M]"`パターン）
- `_reconcile_ocr_training_job()`はPaddleOCR固有の復旧ロジック（`inference/`ディレクトリ・`latest.pdparams`の存在確認）であり、既にTesseractを早期除外している
- `GET /api/ocr/train/status/{job_id}`・`POST /api/ocr/train/stop/{job_id}`・`GET /api/ocr/train/log/{job_id}`は`training_family="ocr"`のみで判定するEngine非依存の実装

## 実装内容

### 唯一の合流点への追加（既存分岐を複数箇所へ散らさない）

- **新規エンドポイント**: `POST /api/trocr/train/start`（`main.py::api_trocr_train_start()`）。既存`/api/ocr/train/start`を汎用化せず、Tesseractと同じ「専用エンドポイント・専用スキーマ」パターンで新設した（既存2エンジンの契約・挙動は無変更）
- **新規リクエストスキーマ**: `TrocrTrainStartRequest`（`schemas.py`）: `dataset_dir`/`model_ref`/`epochs`/`batch_size`/`learning_rate`/`max_target_length`/`device`（`auto`/`cpu`/`cuda`）/`local_files_only`
- **新規orchestration関数**: `_run_trocr_training_job()`（`main.py`）。既存`_run_ocr_training_job()`/`_run_tesseract_training_job()`と同一構造。Issue #92の`run_trocr_training()`をそのまま呼ぶのみ（Dataset parsing・Processor/Model load・training loop・artifact save処理はいずれも複製しない）
- **`job_runner.py`**: `job_type`の選択肢へ`"trocr"`を追加し、`_run_trocr_training_job()`へ分岐

### 既存フィールドの再利用（新しいstatus体系・隠れdefaultを作らない）

Tesseractが`epochs=max_iterations`/`init_source_value=base_lang`/`max_text_length=psm`という既存カラムを意味的に読み替えて再利用しているのと同じ考え方で、TrOCRも以下のようにマッピングした。

| Job DBカラム | TrOCRでの意味 |
|---|---|
| `epochs`/`batch_size`/`learning_rate` | そのまま（Core `TrocrTrainingConfig`の同名フィールドへ） |
| `max_text_length` | `max_target_length`（最大トークン長） |
| `init_source_value` | `model_ref`（Hugging Face model ID／ローカルパス） |
| `device` | `"auto"`/`"cpu"`/`"cuda"`の文字列。`"auto"`はCore呼び出し直前に`None`へ変換する（Core/`TrOCREngine`の既存契約は`None`=自動判定のため） |

新規に追加したカラムは`local_files_only`（1件のみ）。既存の`ALTER TABLE training_jobs ADD COLUMN`パターンをそのまま踏襲した。成果物ディレクトリ（`output_dir`）はJob DBへ保存せず、既存2エンジンと同様に`project_id`+`job_id`から`models/trocr_runs/<job_id>`として導出する（`model_path`カラムには完了後の最終artifact pathのみ保存）。

### Job Lifecycle

`queued → running → completed/failed`。成功時は`model_path=str(result.artifact_dir)`。失敗時は`message=str(例外)`（Dataset Adapter error・`TrOCRDependencyError`・`TrOCRModelLoadError`・`TrOCRTrainingRunError`・`TrOCRTrainingSaveError`のいずれも、Core側で既に明確な例外のためラップせずそのまま`message`へ保持）。

### Cancellation Contract

**既存の`_spawn_training_runner`/`_stop_training_worker`機構をそのまま再利用し、Core・Job層のいずれにもコード変更を加えていない。** TrOCR学習はTesseract/PaddleOCRと同様に独立サブプロセス（`python -m src.app.job_runner trocr <job_id>`）として実行されるため、`_stop_training_worker()`の既存`os.killpg(worker_pid, SIGTERM)`がプロセスグループごと即座に終了させる。DB側の状態更新（`status="stopped"`）も`_stop_training_worker()`自身が行う既存の仕組みでそのまま機能し、TrOCR固有のcancel hookは不要と判断した（partial artifactが成功として登録されることもない。SIGTERMで即終了するため、`_run_trocr_training_job()`の成功パス自体に到達しない）。

### Progress Contract

Issue #92の`run_trocr_training()`へ、後方互換な追加専用引数`on_epoch_end`（省略時デフォルト`None`、既存動作は1バイトも変わらない）を追加した。epoch完了ごとに`(epoch_number, total_epochs, avg_loss)`で呼ばれるobservation専用フックで、training semantics（epoch数・batch順序・loss計算）には一切影響しない。Job層はこのフックで`_append_log()`（`tesseract_pipeline.py`の既存ヘルパーを再利用）を使い、PaddleOCR/EasyOCR系の既存パーサ（`frontend/src/lib/trainingLog.js`の`/epoch:\s*\[(\d+)\/(\d+)\]/i`）がそのまま解釈できる`"epoch: [N/M] loss=X.XXXX"`形式でログへ1行追記する。Training UI自体（フロントエンドのTrOCR有効化）は本Issueのスコープ外だが、フォーマットを既存契約に合わせておくことで、UIが有効化された際に無改修で進捗表示できる。

### Existing Engines Compatibility

`_reconcile_ocr_training_job()`のTesseract早期除外（PaddleOCR固有の`inference/`ディレクトリ確認をスキップ）に、`engine == "trocr"`も同じ条件へ追加した（1行の拡張、既存のTesseract分岐と同じ場所）。TrOCR jobのworker異常終了時の自動復旧はFuture Workとして記録し、本Issueでは実装しない。既存Tesseract/PaddleOCR/EasyOCRのjob pathはコード変更なし（既存テスト`test_training_guard.py`等が無修正のままpass）。

## Tests

`tests/test_trocr_training_job.py`（新規、16件）:

- `api_trocr_train_start()`: dataset_dir未指定/不存在、model_ref未指定、device不正値、device=cuda かつCUDA不可、409（多重起動防止）、正常系のリクエスト→DBフィールドマッピング全項目、`_spawn_training_runner`へのjob_type伝播
- `_run_trocr_training_job()`: Core呼び出し引数マッピング（dataset_dir/model_ref/config全フィールド、device="auto"→None変換）、running状態がCore呼び出し前に設定されること、成功時のartifact_dir→model_path反映、Core失敗時のfailed遷移とmessage保持、on_epoch_endによる進捗ログ記録（フォーマット含む）、存在しないjob_idはno-op
- `_reconcile_ocr_training_job()`: trocr engineがPaddleOCR固有復旧チェックを一切呼ばずに除外されること
- `job_runner.py`: `trocr`のargparse選択肢・dispatch

`tests/test_trocr_training_core.py`へ3件追加（`on_epoch_end`の呼び出し確認・省略時無変化・コールバック例外の非ラップ伝播）。

`python -m pytest -q tests/test_trocr_training_job.py tests/test_trocr_training_core.py tests/test_training_guard.py tests/test_training_condition_snapshot.py tests/test_ocr_dataset_workflow.py` — 全pass（既存無回帰含む）。全体`python -m pytest -q` — 既知Issue #8以外の新規failureなし（詳細件数はPR説明参照）。

## Documentation

- 本ドキュメント（新規）
- `docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`・`docs/workitems/trocr/ISSUE_MAP.md`を更新

## Future Work（Scope外として記録）

- TrOCR jobのworker異常終了時の自動復旧（`_reconcile_ocr_training_job()`は現状trocrを早期除外するのみで、PaddleOCR相当の復旧チェックは実装しない）
- Training UI（`engineRegistry.js`の`trainingSupported`/`trainingSelectable`を`true`化する、TrOCR専用設定パネル追加）
- Model Registry登録・`.trocr.json`等metadata sidecar・Experiment tracking書込・Dataset lineage最終統合（次Issue「Artifact Registration」の責務）

## Out of Scope（次Issue以降）

- TrOCR Model Registry / Artifact Registration
- Experiment tracking/lineageの最終統合
- Training UI
- Dataset schema変更・raw image保存方式変更
- Evaluation/Benchmark/Release Gate変更
