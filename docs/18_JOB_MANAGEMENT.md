# 18. Job Management（バックグラウンドジョブ管理）

前処理・データセット作成・学習・評価・Benchmark・Deployment Package生成を、統一の「Job」としてキュー実行・監視・キャンセル・再実行できる仕組み。実装は `src/app/services/job_manager.py`、画面は `frontend/src/views/JobsView.jsx`（サイドバー「運用 > ジョブ管理」）。

既存の同期API（`/preprocess/run` 等）は**そのまま維持**する。Job APIは同じサービス関数をハンドラ経由で呼ぶ追加経路であり、既存フローを置き換えない。

## 1. Job種別

| job_type | 実処理（ハンドラが呼ぶ既存サービス） |
|---|---|
| `preprocess` | `services/preprocess.py run_preprocess` |
| `dataset_creation` | `services/ocr_pipeline.py create_ocr_dataset` |
| `training` | `services/tesseract_pipeline.py run_tesseract_training` |
| `evaluation` | `services/ocr_evaluation.py evaluate_ocr` |
| `benchmark` | `services/benchmark.py run_benchmark_job`（Phase 2で実装） |
| `deployment_export` | `services/release_manager.py build_deployment_package` → `outputs/deployments/` へ保存 |

## 2. Job ID

- 形式: `JOB-000001`（6桁ゼロ埋め連番）
- **システム全体（全プロジェクト横断）で一意**。プロジェクト毎に採番しない
- 採番カウンタは `data/jobs/jobs.json` の `counter`。IDは再利用しない

## 3. 状態遷移

```text
queued ──→ running ──→ succeeded
   │          │    └──→ failed
   │          └──→ cancel_requested ──→ cancelled（安全な区間で停止）
   └──→ cancel_requested → cancelled（未開始は即時取消）
```

- 許可遷移は `ALLOWED_TRANSITIONS` 辞書で定義し、**不正遷移（例: succeeded→running）は ValueError で拒否**する
- `succeeded` / `failed` / `cancelled` は終端状態（以後変更不可）
- `cancel_requested` 中に処理が完走した場合は `succeeded`、例外で終わった場合は `cancelled` として完結する

## 4. 保存項目

`data/jobs/jobs.json` の各Jobに以下を保存する:

`job_id` / `project_id` / `job_type` / `status` / `requested_by` / `created_at` / `started_at` / `finished_at` / `progress`(0-100) / `current_step` / `message` / `params`（入力条件） / `result_summary` / `error_summary` / `related_experiment_id` / `related_model_id` / `related_benchmark_id` / `retry_source_job_id` / `cancellation_requested_at`

- **スタックトレースは保存しない**。失敗時はユーザー向けの `error_summary`（500字まで）のみ画面へ出し、トレースバックは内部ログ `data/jobs/logs/JOB-xxxxxx.log` にのみ書く

## 5. レイヤ構成（将来の交換可能性）

| レイヤ | 現実装 | 将来の交換先 |
|---|---|---|
| `JobRepository` | JSONファイル（`data/jobs/jobs.json`） | SQLite等（このクラスのみ置換） |
| `JobService` | 採番・遷移検証・同時実行制御・キャンセル・再実行 | （共通） |
| `JobWorker` | 単一プロセス・単一スレッド（1秒ポーリング、FastAPIプロセス内daemon） | Redis/Celery/RQ等のキュー基盤 |
| `JOB_HANDLERS` | 種別→関数の辞書。`(params, ctx)` を受け取り結果dictを返す | （共通の登録形式） |

`JobContext` はハンドラへ渡す進捗・キャンセル用コンテキスト:

- `ctx.update(progress, step, message)` — 進捗0〜100%とステップ名を記録
- `ctx.check_cancelled()` — **キャンセルポイント**。`cancel_requested` なら `JobCancelled` を送出し、安全に中断できる区間でのみ停止する（処理の途中で強制killしない）

## 6. 同時実行制御

| 種別 | ルール |
|---|---|
| training | システム全体で同時1件 |
| preprocess | 同一プロジェクトで同時1件（別プロジェクトは並行可） |
| evaluation | 同一プロジェクト×同一モデルの評価Job重複を防止（対象モデル集合が交差する場合は重複扱い） |
| benchmark | 設定可能な同時実行数（`jobs.json` の `config.benchmark_concurrency`、既定1）。スロットが埋まっている間は queued のまま待機 |

**重複時の挙動は「既存のアクティブJobを `deduplicated: true` で返す」で統一**（409エラーは返さない）。呼び出し側は返ったJob IDをそのまま監視すればよい。

## 7. キャンセル・再実行

- キャンセル: `queued` は即時 `cancelled`。`running` は `cancel_requested` へ遷移し、ハンドラの次のキャンセルポイントで `cancelled` になる（学習イテレーション途中等では止まらない）
- 再実行: 終端状態のJobに対して**同一入力条件（params）で新規Jobを作成**し、`retry_source_job_id` に元Job IDを保存する。アクティブなJobの再実行は拒否

## 8. API（`docs/06_API_REFERENCE.md` 参照）

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/jobs` | Job作成（queued登録→Worker自動起動）。重複時 `deduplicated: true` |
| GET | `/api/jobs` | 一覧（project_id / job_type / status / requested_by / date_from / date_to / limit） |
| GET | `/api/jobs/{job_id}` | 詳細 |
| POST | `/api/jobs/{job_id}/cancel` | キャンセル要求 |
| POST | `/api/jobs/{job_id}/retry` | 再実行 |
| GET | `/api/jobs/{job_id}/events` | 進捗イベント履歴 |

進捗の受け取りは現在**ポーリング**（画面はアクティブJobあり=3秒 / なし=10秒間隔）。イベントは `data/jobs/events/JOB-xxxxxx.jsonl` に1行1イベント（`ts` + `type: status|progress`）で追記しており、**将来SSEへ移行してもイベント形式はそのまま使える**よう取得方法と形式を分離している。

## 9. ファイル配置

```text
data/jobs/
  jobs.json                 counter / items[]（Job本体） / config（benchmark_concurrency等）
  events/JOB-xxxxxx.jsonl   進捗イベント（追記型JSONL）
  logs/JOB-xxxxxx.log       内部ログ（スタックトレース等。画面へ出さない）
```

`data/jobs/` は `PROJECTS_DIR` の親（= `data/`）配下。テストでは `temp_projects` フィクスチャの `PROJECTS_DIR` 差し替えにより自動的に一時領域へ隔離される。

## 10. テスト

- バックエンド: `tests/test_job_manager.py`（採番・保存項目・不正遷移拒否・同時実行制御3種・キャンセル・再実行・実行成功/失敗/実行中キャンセル・実前処理ハンドラの統合・benchmark同時数設定・一覧フィルタ）
- フロント: `frontend/tests/jobsView.render.test.mjs`（一覧・フィルタ・ラベル定義・所要時間表示）、`sidebar.render.test.mjs`（運用セクション）
