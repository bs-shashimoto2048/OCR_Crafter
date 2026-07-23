# 06. API リファレンス

すべてのルートは `src/app/main.py` に定義されている（`APIRouter` / `include_router` は不使用）。
リクエストスキーマは `src/app/schemas.py` を参照。**全71エンドポイント**。

- アプリ定義: `FastAPI(title="OCR Crafter API", version="0.2.0")`
- ベースURL（開発時）: `http://127.0.0.1:8000`

## システム

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/health` | なし | `status` | ヘルスチェック（固定 `ok`） |
| GET `/api/system/check` | なし | 環境チェック結果 | GPU可否等の実行環境スナップショット |
| POST `/system/shutdown` | `AppShutdownRequest`（`frontend_port?`） | `status` | フロント/バックエンドの終了 |

## プロジェクト

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/projects` | なし | `items`, `summaries` | プロジェクト一覧＋サマリ |
| POST `/projects` | `ProjectCreateRequest`（`project_id`） | `project_id` | プロジェクト作成（ディレクトリ+master CSV） |
| DELETE `/projects/{project_id}` | Path | `project_id`, `deleted_jobs` | プロジェクト削除（学習ジョブも削除） |

## 画像取り込み / ダイアログ

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/images/import` | `ImportImagesRequest`（`source_dir`, `project_id?`） | 取込結果 + `pipeline` | 外部ディレクトリから取込→新規分を前処理 |
| POST `/dialogs/select-directory` | `DirectorySelectRequest`（`initial_dir?`） | `path` | ネイティブのフォルダ選択ダイアログ |
| POST `/dialogs/select-file` | `FileSelectRequest`（`initial_dir?`, `extensions?`） | `path` | ネイティブのファイル選択ダイアログ |

## 画像

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/images` | Query: `project_id?`, `offset?`, `limit?`, `search?`, `unlabeled_only?` | `items[{image,label,type}]`, `total`, `has_more` | 画像一覧（ラベル結合・検索・ページング） |
| GET `/images/{image_name}/file` | Query: `project_id?` | FileResponse | 元画像（raw）を返す |
| GET `/images/{image_name}/thumbnail` | Query: `project_id?`, `width`, `height` | FileResponse | サムネイル（元画像mtimeキーのディスクキャッシュ） |
| GET `/images/{image_name}/processed` | Query: `project_id?`, `image_type?` | FileResponse | 前処理済み画像（無ければプレビュー生成） |
| GET `/images/{image_name}/interim` | Query: `project_id?` | FileResponse | 中間画像（既存のみ・生成しない） |
| POST `/images/{image_name}/rotate` | `RotateImageRequest`（`angle`） | 回転結果 + `pipeline` | 90度単位の回転→対象のみ再前処理 |
| GET `/images/manual-masks` | Query: `project_id?` | `items` | 手動マスク定義の一覧 |
| PUT `/images/{image_name}/manual-masks` | `ManualMasksUpdateRequest`（`manual_masks[]`） | `count` | 画像単位の手動マスク保存 |
| POST `/images/{image_name}/analyze-mask-region` | `AnalyzeMaskRegionRequest`（`x`, `y`, `threshold`） | 黒領域抽出結果 | クリック点の黒連結領域を抽出 |

## 前処理

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/preprocess/run` | `PreprocessRequest`（`project_id?`, `overrides?`=前処理設定画面のUI設定。**プレビューと同一の共通ペイロード**） | `count`, `type_counts`, `files`, `preprocess_snapshot{snapshot_id, preprocess_hash, created_at}`, `preprocess_snapshot_id`, `preprocess_hash`, `effective_params{ratio_threshold, operations}`, `processed_count` | 全画像の前処理実行。**実効設定の優先順位: ①リクエストoverrides ②プロジェクト保存値（`data/projects/<id>/preprocess_config.json`=前回実行時のoverridesを自動保存。回転後の部分再処理・旧クライアントも同条件になる） ③settings.yaml既定 ④コード既定**。実効値は補完・クランプ後の値（threshold 0-255等）で、応答の `effective_params` とスナップショットへ**入力値ではなく実効値**を保存する。実行時点の完全スナップショット（工程順序・有効/無効・実効パラメータ）を `processed/meta/preprocess_snapshot.json` へ保存（最終実行時点の設定が正。データセット作成時に確定コピーされる）。同一設定なら `/preprocess/preview` の最終画像と**画素単位で一致**（テストで保証）。手動マスクの座標（画像単位）は含めない |
| GET `/preprocess/preview` | Query: `image`, `engine`, `model`, `model_type?`, `easyocr_langs`, `include_lowercase` | プレビュー + 推論結果 | 前処理プレビュー＋OCR推論 |
| POST `/preprocess/preview` | `PreprocessPreviewRequest`（上記 + `overrides?` + `psm?`/`whitelist?`=Tesseract用のOCR結果確認パラメータ。未指定=従来動作） | プレビュー + 推論結果 | Body で前処理上書きを指定できる版。overrides は `/preprocess/run` と同一の共通ペイロード（`lib/preprocessRequest.js`）。二値化 `threshold.type` へ **`none`（二値化なし）** を追加（既存値の挙動は不変） |

## ラベル

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/labels` | Query: `project_id?` | `items` | ラベル一覧 |
| PUT `/labels/{image_name}` | `LabelUpdateRequest`（`label`） | `label` | ラベル更新（upsert） |

## データセット / 学習（分類モデル）

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/dataset/build` | `DatasetBuildRequest`（比率, `seed`） | ビルド結果 | train/val/test 分割ビルド |
| GET `/dataset/meta` | Query: `project_id?` | メタ情報 | データセットメタ取得 |
| POST `/train/start` | `TrainRequest`（`model_type`, `epochs`, `batch_size`, `learning_rate`, `training_mode`, `init_source_*`, `freeze_backbone_epochs`, `backbone_lr_scale`） | `job_id`, `status: queued` | 非同期学習ジョブ開始 |
| GET `/train/{job_id}` | Path | ジョブ状態 | 学習ジョブ状態取得 |
| POST `/train/stop/{job_id}` | Query: `delete_artifacts?` | 停止結果 | 学習停止（成果物削除オプション） |

## 学習（OCR: PaddleOCR / Tesseract）

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/api/ocr/dataset/create` | `OcrDatasetCreateRequest`（`image_types`, `charset`, `max_text_length`, `image_shape`, 比率, `seed`, `text_case`, 任意: `augmentation`=新形式オーグメンテーション設定） | 作成結果（`counts`＋`input_count`/`valid_count`/`skipped`内訳/`split_method: image`/`augmentation`/`augmentation_generated`） | ラベル済み画像からOCR認識用データセット作成。**分割枚数は最大剰余法**（合計=有効画像数を保証。同値小数部はTrain→Val→Test優先）。`augmentation` 指定時は**Trainのみ**へ追加画像を生成（元画像は必ず残る・ラベル不変・生成枚数=(倍率-1)×Train枚数）。比率合計≠1.0は **400**（`detail={code: INVALID_SPLIT_RATIO, message, values}` の構造化エラー）。**meta.json へ学習時前処理を確定保存**: `training_preprocess`（作成時点の `processed/meta/preprocess_snapshot.json` のコピー＋`ocr_input_normalization`。スナップショット未保存の旧プロジェクトは `null`=推測補完しない）・`training_preprocess_hash`（sha256）・`source_image_state`（processed/mixed等）・`source_priority`・`source_state_counts`・`source_preprocess_snapshot_id`・`source_warning`（processed以外の混在時） |
| POST `/api/ocr/dataset/split-preview` | `OcrDatasetSplitPreviewRequest`（`image_types`, `charset`, `max_text_length`, `text_case`, 比率） | `input_count`, `valid_count`, `skipped{type,invalid_label,missing_source}`, `counts`, `split_method`, `ratios` | データセット作成前の分割予定枚数プレビュー（画像は生成しない。作成時と同じ最大剰余法） |
| POST `/api/ocr/dataset/augmentation-preview` | `OcrAugmentationPreviewRequest`（`augmentation`, `sample_count`=1〜5, `image_shape` 等） | `items[{image_name,label,original,augmented}]`（base64 PNG）, `config` | 学習前のオーグメンテーションプレビュー（ランダムサンプルへ適用。強すぎる設定の事前確認用） |
| POST `/api/ocr/dataset/from_logs` | `OcrDatasetFromLogsRequest`（`only_invalid`, `include_corrected` 等） | 作成結果 | 推論ログからOCRデータセット作成 |
| POST `/api/ocr/train/start` | `OcrTrainStartRequest`（`engine`, `dataset_dir`, `device`, worker/AMP設定等） | `job_id`, `engine: paddleocr` | PaddleOCR学習ジョブ開始（paddleocrのみ許可）。同一プロジェクトでアクティブなOCRジョブがある場合は **409 Conflict** |
| POST `/api/tesseract/train/start` | `TesseractTrainStartRequest`（`dataset_dir`, `charset`, `max_iterations`, `base_lang`, `psm`, 任意: `experiment_name` / `parent_model_id` / `training_note`） | `job_id`, `engine: tesseract` | Tesseract LSTM fine-tune 開始。二重実行は **409 Conflict**。実験情報はジョブ（`training_jobs.experiment_meta` JSON列）経由でモデルメタへ保存（未指定=従来動作）。学習完了時にデータセット meta.json の `training_preprocess` / `training_preprocess_hash` / `source_image_state` を `.tess.json` へそのまま引き継ぐ（未記録=null） |
| GET `/api/ocr/train/active` | Query: `project_id?` | `{project_id, job}` | プロジェクトのアクティブ（queued/running）なOCR学習ジョブを返す（無ければ `job: null`）。画面再読込時の再接続用 |
| GET `/api/ocr/train/status/{job_id}` | Path | ジョブ状態 | OCR学習状態取得 |
| POST `/api/ocr/train/stop/{job_id}` | Query: `delete_artifacts?` | 停止結果 | OCR学習停止 |
| GET `/api/ocr/train/log/{job_id}` | Query: `tail`（1〜5000） | `lines[]` | 学習ログのtail取得 |

## 実験管理（Experiment Tracking）

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/api/experiments` | Query: `project_id?` | `{project_id, items:[{experiment_id, created_at, started_at, finished_at, duration_seconds, models[], model_ids[], experiment_name, parent_model_id, note, operator, training{iterations, charset, base_lang, split_ratio, split_seed, split_method, counts}, preprocess{hash, snapshot_id, summary}, augmentation{config, generated}, evaluation, tags[], favorite, source}]}` | 実験一覧。実験IDは **EXP-0001形式・プロジェクト内一意・作成順・再利用しない**（モデル管理Noとは独立。1実験に複数モデルを紐付け可能=modelsはリスト）。学習完了時（`register_tesseract_model`）に自動記録され、**実験記録のない旧モデル（.tess.json）は一覧取得時に自動バックフィル**（source="backfill"・作成日時順採番）。保存先は `data/projects/<id>/experiments.json` |
| PATCH `/api/experiments/{experiment_id}` | `ExperimentUpdateRequest`（`tags?`, `favorite?`, `note?`, `operator?`, `experiment_name?`） | `{item}` | 実験カルテの編集（自由タグ最大20件・★固定・メモ・学習者・実験名のみ。学習条件は不変）。存在しないIDは404 |
| GET `/api/experiments/comparable_groups` | Query: `project_id?` | `{groups:[{group_id, evaluation_hash, dataset, whitelist, psm, preprocess_signature, experiments[], count}]}` | **Comparable Group一覧**（Evaluation Hash単位・CG-0001形式・出現順で決定的に採番）。Evaluation Hashは評価条件（データセットID・画像数・ラベル数・評価前処理識別子・エンジン・PSM・Whitelist・文字正規化 trim+NFC・CERバージョン cer-v1-micro）のsha256（評価日時は除外）。同一Hash=同一条件評価。データセットID・前処理識別子の両方が空の実験はHash生成不可でグループへ含めない |
| GET `/api/experiments/recommendation` | Query: `project_id?` | `{group_id, basis_count, insufficient, cards[], excluded[{experiment_id, reason}], safety}` | **比較可能Experimentのみから生成した安全な条件推薦**。分析対象外（バックフィル既定OFF / 分析OFF / 評価未実施 / CERなし / Hash生成不可）は使用せず理由付きで `excluded` へ。最大の Comparable Group を根拠に `basis_count` を必ず返し、**5件未満は `insufficient: true`（参考値・データ不足）**。`safety`=「この推薦はN件の比較可能Experimentから生成されています。」 |
| PATCH `/api/experiments/{experiment_id}/analysis` | `ExperimentAnalysisToggleRequest`（`enabled`） | `{item}` | **分析対象ON/OFF**（失敗・途中停止・デバッグ実験を推薦・相関から除外）。バックフィル実験は既定で分析対象外（ONへ戻せる） |
| POST `/api/experiments/attach-evaluation` | `ExperimentEvaluationAttachRequest`（`model`, `evaluation{cer, char_accuracy, accuracy_percent, improved, regressed, evaluated_at, dataset}`） | `{attached, item}` | 評価実行結果の要約をモデル名から該当実験へ保存（同一モデルが複数実験にある場合は最新の実験）。該当なしは `attached: false`（エラーにしない）。モデル評価実行時にフロントが自動送信する |

## 監査・運用（Audit / Operations）

詳細仕様: `docs/21_OPERATIONS_GUIDE.md` / `docs/22_SECURITY_AND_AUDIT.md`。

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/health` | - | `{status}` | 死活監視（従来どおり） |
| GET `/health/ready` | - | `{ready, checks}` | 受付可否（データDir書き込み・設定ファイル） |
| GET `/health/details` | - | `{status, problems[], checks{}}` | 管理者向け詳細（Backend/データDir/設定/Tesseract/PaddleOCR/GPU/JobWorker/ディスク/プロジェクトDir。取得不能=null） |
| GET `/api/auth/context` | ヘッダ: `X-Operator?`, `X-Role?` | `{operator, role, auth_configured, auth_mode}` | ユーザー識別。認証未設定環境は **Admin互換＋「認証未設定モード」** を返す |
| GET `/api/audit` | Query: `project_id?`, `action?`, `user?`, `target_id?`, `date_from?`, `date_to?`, `limit?` | `{items[], actions[]}` | **監査ログ一覧**（新しい順・追記型のため削除/編集APIなし）。対象13操作、**パスワード・トークン・APIキー・画像バイナリは保存されない** |
| GET `/api/operations/dashboard` | Query: `project_id?` | `{jobs, production, unevaluated_candidates[], latest_benchmark, data_usage, backup}` | 運用ダッシュボード（実行中/待機中/失敗Job・Production＋Gate状態・未評価Candidate・最近のBenchmark・データ使用量・バックアップ状態） |
| GET `/api/backups` | Query: `project_id?` | `{items[]}` | バックアップ一覧（新しい順・BK-0001形式）。保存先 `data/backups/` |
| POST `/api/backups` | `BackupCreateRequest`（`mode`=metadata_only/full） | `{item}` | バックアップ作成（metadata_only=設定・記録・モデルメタのみ / full=プロジェクト全体） |
| GET `/api/backups/{backup_id}/verify` | - | `{valid, mismatches[], manifest_summary}` | **整合性検証のみ**（manifest v2の全ファイルSHA-256照合。旧形式v1はvalid=null=検証不能） |
| POST `/api/backups/{backup_id}/restore` | `BackupRestoreRequest`（`new_project_id?`） | `{backup_id, project_id, mode, source_project_id, verified_files}` | 復元。**既定で新しいProject IDへ**（`<元ID>_restored_<n>` 自動採番・既存プロジェクトは上書きしない=衝突は400）。**復元前にSHA-256検証（不一致は開始しない=BACKUP_VALIDATION_FAILED）・復元後にも再検証（不一致は復元先削除）**。監査 `backup_restore`/失敗は`restore_failed`（admin） |
| GET / PUT `/api/retention` | `RetentionConfigRequest`（`job_retention_days?`, `audit_retention_days?`） | `{config}` | データ保持設定。**未設定（null）=無期限保持（従来動作）** |
| POST `/api/retention/apply` | - | `{removed_jobs, removed_audit_entries, config, applied_at}` | 保持期間を過ぎた終端状態Job・監査ログの削除を適用。**削除は監査ログ `retention_cleanup` へ必ず記録**（admin） |

変更系エンドポイント（projects作成/削除・preprocess/run・dataset/create・tesseract学習開始・モデル削除・releases status/promote/rollback/policy・benchmarks実行・jobs cancel/retry・backups restore・retention apply）は `X-Role` 明示時にロール階層（viewer<operator<approver<admin）を強制し（不足403）、成功時に監査ログへ記録する。

## レポート（Model Development Reports）

詳細仕様: `docs/16_SCREEN_SPEC.md`（レポート画面）。生成はJob Management経由（`job_type=report_generate`）。

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/api/reports/generate` | `ReportGenerateRequest`（`report_type`=single_model/comparison/project_summary, `model_ids[]`, `formats[]`=markdown/pdf, `include_images?`, `experiments_limit?`, `template_info?`, `created_by?`） | `{job, deduplicated}` | レポート生成Jobの作成（single=モデル1件必須 / comparison=2件以上。不正は400）。監査 `report_generate` |
| GET `/api/reports` | Query: `project_id?` | `{items[]}` | レポート一覧（新しい順・メタデータ: reportId/種別/対象/形式/状態/sha256/jobId等） |
| GET `/api/reports/{report_id}` | - | `{item}` | レポート詳細（存在しないIDは404） |
| DELETE `/api/reports/{report_id}` | - | `{deleted}` | レポート削除（メタデータ+出力ファイル。監査 `report_delete`） |
| GET `/api/reports/{report_id}/download` | Query: `format`=markdown/pdf | ファイル | ダウンロード（`data/reports` 配下限定・トラバーサル防止・日本語ファイル名対応） |

## ジョブ管理（Job Management）

詳細仕様: `docs/18_JOB_MANAGEMENT.md`。既存の同期API（`/preprocess/run` 等）は維持し、Job APIは同じ処理を非同期実行する追加経路。

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/api/jobs` | `JobCreateRequest`（`project_id?`, `job_type`, `params?`, `requested_by?`） | `{project_id, job, deduplicated}` | Job作成（queued登録→Worker自動起動）。job_typeは preprocess / dataset_creation / training / evaluation / benchmark / deployment_export。**同時実行制御に該当する重複要求は既存アクティブJobを `deduplicated: true` で返す**（409は返さない・統一仕様）。不明なjob_typeは400 |
| GET `/api/jobs` | Query: `project_id?`, `job_type?`, `status?`, `requested_by?`（部分一致）, `date_from?`, `date_to?`（YYYY-MM-DD）, `limit?`（既定200） | `{items[], worker_alive}` | Job一覧（新しい順）。Job IDは **JOB-000001形式・システム全体で一意・再利用しない**。保存先 `data/jobs/jobs.json` |
| GET `/api/jobs/{job_id}` | - | `{job}` | Job詳細（params / result_summary / error_summary=要約のみ・スタックトレースは内部ログ `data/jobs/logs/` へ）。存在しないIDは404 |
| POST `/api/jobs/{job_id}/cancel` | - | `{job}` | キャンセル要求。queued=即時cancelled / running=cancel_requestedへ遷移し**ハンドラの安全なキャンセルポイントで停止**。終端状態は400 |
| POST `/api/jobs/{job_id}/retry` | `JobRetryRequest`（`requested_by?`） | `{job, deduplicated}` | 同一入力条件で新規Job作成（`retry_source_job_id` に元IDを保存）。アクティブJobの再実行は400 |
| GET `/api/jobs/{job_id}/events` | - | `{events[]}` | 進捗イベント履歴（`ts` + `type: status|progress`）。現在はポーリング取得・**将来SSEでも同一形式を使用** |

## Benchmark（OCR Benchmark Suite）

詳細仕様: `docs/19_BENCHMARK_SPEC.md`。実行はJob Management経由（`job_type=benchmark`）。

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/api/benchmarks/engines` | - | `{items:[{key, label, implemented, available, availability_note, description}]}` | 対応エンジンカタログ＋実行環境での利用可否。対応= tesseract_model / tesseract_base / paddleocr_official のみ。**EasyOCR等の未実装は「未導入・利用不可」明示・実行対象外**。クラウドOCRは対象外（掲載しない） |
| GET `/api/benchmarks` | Query: `project_id?` | `{items[], balance_weights}` | Benchmark一覧（新しい順・Leaderboard/用途別ベスト付き・casesは含めない）。Benchmark IDは **BM-0001形式・プロジェクト内一意**。保存先 `data/projects/<id>/benchmarks.json` |
| POST `/api/benchmarks` | `BenchmarkCreateRequest`（`name?`, `image_dir`, `gt_csv`, `dataset_id?`, `engines[]`, `warmup_runs?`, `preprocess?{mode: none/manual/training/project, settings?, model?}`, `requested_by?`） | `{job, deduplicated}` | Benchmark実行。エンジン条件・前処理計画を事前検証（未実装エンジン・不正mode・学習時前処理未記録・スナップショットなしは400）してから **job_type=benchmark のJobを作成**。前処理は開始時に一度だけ適用され全エンジンへ同一入力・実効HashがProfile Hashへ含まれる。エンジンへ `paddleocr_custom`（自作PaddleOCRモデル・要推論用エクスポート）を追加 |
| PATCH `/api/benchmarks/config` | `BenchmarkConfigRequest`（`balance_weights{accuracy, speed, stability}`） | `{balance_weights}` | バランス最良スコアの重み設定（プロジェクト毎・合計1へ正規化。既定 70/20/10） |
| GET `/api/benchmarks/{benchmark_id}` | Query: `project_id?` | `{item}` | 詳細（Leaderboard=CER昇順・同率はExactMatch降順→Failed昇順→MeanTime昇順 / 用途別ベスト＋バランス計算式 / 画像単位cases / Profile Hash）。存在しないIDは404 |
| GET `/api/benchmarks/{benchmark_id}/export` | Query: `kind`=summary/cases/confusions, `project_id?` | CSV（BOM付きUTF-8） | **CSV（Excel対応）3種**: benchmark_summary / benchmark_cases / benchmark_confusions |

## リリース管理（Model Release Management）

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/api/releases` | Query: `project_id?` | `{production, statuses{model: {status, version, updated_at}}, history[]}` | リリース状況。Statusは Draft（既定=学習直後）/ Validated / Candidate / **Production（1プロジェクトに必ず1つ）** / Archived。履歴は新しい順。保存先 `data/projects/<id>/releases.json` |
| POST `/api/releases/status` | `ReleaseStatusRequest`（`model`, `status`） | `{item}` | 手動ステータス変更（Draft/Validated/Candidate/Archived。**Candidate初回は 0.x を自動採番**。Productionへの直接変更は400=promoteのみ） |
| POST `/api/releases/promote` | `ReleasePromoteRequest`（`model`, `note`=**必須**, `author?`, `version?`, `override_reason?`, `approved_by?`） | `{model, version, previous_production, entry}` | Productionへ昇格。**旧Productionは自動でArchived**。versionは未指定なら直近Productionのマイナー加算（初回 1.0.0）。Release Note空は400。**Release Gate判定FAILのモデルは override_reason + approved_by（例外承認）なしでは400**（承認時はFailed Rulesスナップショットを履歴の `override` へ保存）。履歴エントリへ **Release ID（REL-0001形式）** を採番 |
| POST `/api/releases/rollback` | `ReleaseRollbackRequest`（`version`, `author?`, `note?`） | `{model, version, entry}` | 過去のリリースVersionのモデルを再びProductionへ（**Version維持・新Release ID・rollback=true・rollback_from記録**）。現Productionへのロールバックは400・存在しないVersionは404 |
| GET `/api/releases/policy` | Query: `project_id?` | `{policy}` | **Release Policy**（プロジェクト毎のGateルール設定・正規化済み。未設定キー=ルール無効）。詳細 `docs/20_RELEASE_POLICY.md` |
| PUT `/api/releases/policy` | `ReleasePolicyRequest`（`policy{max_cer, min_char_accuracy, min_exact_match, min_eval_images, max_failed, no_cer_regression, require_same_evaluation_hash, min_comparison_quality, required_chars, critical_confusions[], max_benchmark_rank, allowed_engines[]}`） | `{policy}` | Policy保存（releases.json の `policy`。severity不正等は400） |
| GET `/api/releases/gate` | Query: `model`=**必須**, `project_id?` | `{model, verdict, rules[], production_model, policy_configured}` | **Release Gate判定**: PASS / CONDITIONAL_PASS / FAIL / NOT_EVALUATED。各ルールは Rule/Expected/Actual/Result(pass/fail/warning/unverified)/Message。必須文字が評価データにない場合・混同/文字統計未記録・Benchmark未実施は「未検証」（推測しない） |
| GET `/api/releases/model_card` | Query: `project_id?`, `model?`（未指定=現Production） | `{model, version, markdown}` | **Model Card（Markdown）自動生成**: 概要・Version・用途・対象文字・評価条件（Experiment/Group/データセット/Whitelist/前処理ハッシュ）・性能（CER/文字正解率/完全一致率）・既知の制約・更新履歴。Production未設定は404 |
| GET `/api/releases/deployment_package` | Query: `project_id?` | ZIP（`deployment_<project>_v<version>.zip`） | **Deployment Package**: Productionモデルの traineddata / 設定JSON（model_config.json=.tess.json） / 前処理Snapshot / RELEASE_NOTE.md / MODEL_CARD.md をZIPでExport（ONNX等はモデルディレクトリに実在する場合のみ追加。Tesseractは通常なし） |

## モデル管理

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/models` | Query: `project_id?` | `items` | 保存済みモデル一覧 |
| GET `/models/info` | Query: `project_id?` | `items` | モデル詳細情報一覧（`model_size_mb`=モデル実体サイズMB。tesseract=traineddata・分類=.ptファイル。実体なし/PaddleOCRはnull=UIでは未記録表示。`model_id`=管理No「M0001」形式：作成日時順に自動採番・OCR Crafter全体で一意・削除後も再利用しない。`data/model_ids.json` へ永続化し未登録モデルは一覧取得時に一括採番。tesseractモデルは実験情報 `experiment_name` / `parent_model_id`（親モデルの管理No。ベース直学習は空）/ `training_note` / `training_duration_seconds`（秒・旧モデルはnull）を含む=学習条件比較で使用。旧メタは空値/nullで後方互換。**学習時前処理**: `training_preprocess`（前処理スナップショット。tesseract=.tess.json保存値 / PaddleOCR=.ocr.jsonまたはデータセットmeta由来）・`training_preprocess_hash`・`dataset_source_image_state` を含む=モデル比較「学習前処理比較」・評価/推論の学習時前処理再現で使用。旧モデルはnull/空=未記録表示） |
| GET `/models/latest` | Query: `model_type?`, `training_family`, `engine?` | `model` | 最新モデル名 |
| GET `/model-types` | Query: `project_id?` | `items` | モデル種別一覧 |
| DELETE `/models/{model_name}` | Query: `project_id?` | `deleted` | モデル削除（models配下限定の安全検証あり） |
| GET `/api/models/download/{model_name}` | Query: `project_id?` | FileResponse | `.pt` / `.traineddata` / inference ZIP のダウンロード |
| POST `/api/ocr/models/export-migrate` | Query: `overwrite?`, `dry_run?` | 変換結果 | 学習済みOCRモデルを推論用へ一括変換 |
| GET `/api/ocr/models/official` | なし | `items` | 公式PaddleOCR認識モデル一覧 |

## 推論 / OCRログ

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/predict` | Form: `file`, `engine`, `model_type`, `model`, `easyocr_langs`, `include_lowercase`, `apply_preprocess`, `preprocess_overrides_json`, `preprocess_mode?`, `project_id` | 推論結果 + `preprocess_preview_data_url` + `inference_preprocess?` | 1画像のOCR推論（ログ保存）。`preprocess_mode`: 未指定=従来動作 / `training`=**モデルの学習時前処理を再現**してからOCR入力整形（未記録の旧モデルは400・自動フォールバックしない。分類モデルcustomは400）/ `manual`=現在の前処理設定パイプラインを適用 / `none`=OCR入力整形のみ。適用時は `inference_preprocess{mode, preprocess_hash?, snapshot_id?}` を返す |
| POST `/api/ocr/predict/batch` | Form: `files[]` + 上記同様 | `items[]`, `include_lowercase` | 複数画像の一括推論 |
| POST `/api/ocr/yolo/predict` | Form: `file`, YOLO設定（`yolo_model`, `conf_threshold` 等）+ OCR設定 | `detections[{bbox,text,confidence}]` | YOLO検出→切出し→OCRの複合推論 |
| POST `/api/ocr/log/save` | `OcrLogSaveRequest`（`predicted_text`, `corrected_text?` 等） | 保存結果 | OCR修正ログ保存 |
| GET `/api/ocr/log/state` | Query: `project_id?` | 最新状態 | OCR修正画面の最新状態取得 |

## データ作成（YOLO検出・評価データ作成）

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/image-builder/yolo-models` | Query: `project_id?` | モデル一覧（`items` / `local_models` / `common_models` / `builtin_models` / `builtin_dir` / `models`=`{name, source, downloaded, path}`。`source`は`project`/`common`/`builtin`で**取得元ごとに独立列挙**（同名も各取得元に表示）。builtinは取得済み状態`downloaded`付き・未取得は`path=null`） | 利用可能なYOLOモデル一覧。取得元は project=`data/projects/<id>/models/yolo/` / common=`models/yolo/` / builtin=`models/yolo/builtin/`（旧自動DLのリポジトリ直下も取得済みとして互換認識） |
| POST `/image-builder/yolo-models/builtin/download` | JSON: `{model_name}` | `{model_name, source, downloaded, path, size_bytes, already_downloaded}` | Ultralytics標準モデルの**明示取得**（許可リスト内の名前のみ・任意名/URL拒否=400、取得済みなら再DLせず返却、同名取得進行中=409、失敗時は不完全ファイルを残さない）。外部通信はこのAPIのみで発生 |
| POST `/image-builder/resize-preview` | Form: `file`, `resize_long_side`, `use_resize`, `resize_axis`, `detect_preprocess_json` | プレビュー | リサイズ/検出前処理プレビュー |
| POST `/image-builder/detect` | Form: 上記 + `model`, `model_source?`（path/project/common/builtin。未指定は後方互換の従来順）, `conf_threshold`, `merge_overlaps`, `merge_iou_threshold`, `series_json?`（検出対象class名のJSON配列。空文字=未指定で全class対象・空配列=400） | 検出結果（従来キーに加え `model_name` / `model_source` / `builtin_downloaded` / `inference_time_ms`=YOLO推論のみ / `total_time_ms`=デコード〜レスポンス整形の全体 / `preprocess_applied`=noop判定でON/OFF / `inference_count`=推論生検出数 / `series_filtered_count`=Series絞込後 / `selected_series`=適用Series（null=フィルタなし）。`raw_count`は統合前件数の後方互換キー） | YOLO BBox検出。**指定された取得元の中だけで解決し暗黙フォールバックしない**（見つからない=404）。**実行中の外部通信（自動ダウンロード）は行わず**、未取得標準モデルは**409**。Series指定時は推論後にclass名で絞り込み→ID振り直し→重複統合 |
| GET `/image-builder/yolo-models/classes` | Query: `model`, `model_source?`, `project_id?` | `{model_name, model_source, resolved_model, classes}`（class_id順のclass名一覧） | 選択モデルのclass一覧（Step2の検出対象Series候補）。解決規則は検出APIと同一（未取得標準モデル=409・自動DLなし）。解決パス＋更新時刻でプロセス内キャッシュ |
| POST `/image-builder/export` | Form: 上記 + `boxes_json`, `output_dir`, `crop_height`, `project_id?`, `export_context_json?`（元画像名・モデル・選択Series） | 出力結果（+`export_id` / `crops`=`{crop_id, filename, bbox_id, series, bbox_step3_xyxy, bbox_original_xyxy, sha256}`） | 選択BBoxを元画像から切出して出力。`project_id`指定時は対応関係マニフェストを `data/projects/<id>/image_builder_exports/<export_id>/`（manifest.json+state.json）と出力フォルダへ保存（未指定は従来動作） |
| GET `/image-builder/evaluation/candidates` | Query: `project_id?` | `{exports:[{export_id, source_image, model_name, selected_series, crops:[{filename, series, bbox_id, exists}]}]}` | Step5の評価候補（Step4出力マニフェスト由来。画像名からの推測をしない） |
| GET `/image-builder/evaluation/crop` | Query: `export_id`, `filename`, `rotation?`, `max_side?`, `project_id?` | PNG | 評価候補クロップのプレビュー/サムネイル（回転はその場適用・元ファイル不変。マニフェスト記載ファイルのみ解決=トラバーサル防止）。`Cache-Control: private, max-age=300`（rotationがURLに含まれるためキャッシュ安全。サムネイル再取得が保存・OCRリクエストとブラウザ同時接続枠を奪い合わないようにする） |
| GET `/image-builder/evaluation/directory-images` | Query: `directory` | `{directory, image_count, images:[{filename}]}` | Step5「フォルダから読み込む」用の画像一覧（フォルダ直下のみ・サブフォルダ対象外。対応形式: PNG/JPG/JPEG/BMP/TIF/TIFF/WEBP。存在しない=404・未指定=400） |
| GET `/image-builder/evaluation/directory-image` | Query: `directory`, `filename`, `rotation?`, `max_side?` | PNG | フォルダ画像のプレビュー/サムネイル（EXIF Orientation反映＋回転をその場適用・元ファイル不変。フォルダ直下のみ解決=トラバーサル・非画像拡張子は400）。`Cache-Control: private, max-age=300`（rotationがURLに含まれるためキャッシュ安全） |
| GET/POST `/image-builder/evaluation/state` | Query/JSON: `project_id`, `state` | 編集状態 | Step5の途中保存（`evaluation/editing_state.json`。ラベル・回転・評価対象・フィルタ・データセット名・取得方法（sourceMode/directoryPath）。上限2MB） |
| POST `/image-builder/evaluation/create` | JSON: `{project_id, dataset_name, items:[{export_id?, filename, label, rotation, series?, source_image?, bbox_id?, source?, source_directory?}], editing_state?}` | `{dataset_id, dataset_dir, image_dir, csv_path, image_count}` | 評価データセット作成（`evaluation/<dataset_id>/` へ画像コピー+回転焼き込み+ground_truth.csv+metadata.json。`source`未指定=step4（従来動作・export_id必須）/ `source=directory` は `source_directory`+`filename` で任意フォルダ画像から作成し metadata へ `source`/`source_directory` を保存。step4とdirectoryの混在=400。未入力ラベル=400・重複名=400・欠損ソース=404・失敗時は不完全ディレクトリを残さない） |
| GET `/api/evaluation/datasets` | Query: `project_id` | `{project_id, datasets:[{id, name, created_at, image_count, label_count, series, rotated_count, dataset_dir, image_dir, csv_path}]}` | 評価データセット一覧（`evaluation/` 直下のmetadata.json由来。作成日時降順。モデル評価画面のデータセット選択に使用） |
| DELETE `/api/evaluation/datasets/{dataset_id}` | Query: `project_id` | `{deleted, dataset_id}` | 評価データセット削除（CSV・metadata・画像・editing_stateを含むディレクトリごと `safe_rmtree` で削除。`evaluation/` 配下のみ許可・ID形式検証でトラバーサル防止） |
| POST `/api/evaluation/datasets/{dataset_id}/rename` | JSON: `{project_id, new_name}` | `{dataset_id, renamed, dataset_dir}` | 評価データセット名変更（ディレクトリ改名+metadata更新。CSV・画像参照は相対のため壊れない。英数字/-/_のみ・重複名=400） |
| GET `/api/evaluation/datasets/{dataset_id}/overlap` | Query: `project_id` | `{training_image_count, evaluation_image_count, overlap_count, overlaps:[{filename, matched_by}]}` | 学習データ（`outputs/ocr_dataset/*/{train,val,test}`）との重複チェック。判定優先順位: ①sha256一致 ②元画像+BBoxID一致（学習画像sha→マニフェスト逆引き。回転焼き込み後でも検出可能） ③ファイル名一致。overlapsは先頭100件 |
| POST `/api/ocr/preview-file/batch` | multipart: preview-fileと同じ入力（`file?` / `export_id`+`filename`+`rotation` / `source_directory`+`filename`+`rotation`, `project_id`, `overrides_json?`, `eval_preprocess_json?`）+ `slots_json`（最大3スロットの配列 `[{slot, engine, model, model_type?, easyocr_langs, include_lowercase, psm, whitelist}]`。`[]`=プレビューのみ）+ `include_images?`（false=画像data URLを空で返す。先読み用の転送削減）+ `prefetch?`（true=先読み要求。**実行中/待機中のOCRがあるとスロットを実行せず `skipped_busy=true` で破棄**=現在画像を優先） | `{project_id, type, ratio, original_size, pipeline, interim_data_url, processed_data_url, results:[{slot, engine, model_name, prediction, confidence, error, cached, elapsed_ms}], skipped_busy, timings:{preprocess_ms, slots_wall_ms}}` | Step5用: **前処理1回＋複数OCR設定を1リクエストで処理**。推論は**プロセス共有のExecutor（同時実行数2）**へsubmitされ、**リクエスト横断で同時推論数が2に制限**される（リクエスト毎のPool生成を廃止。Abort残骸・先読みが積み重なってもCPU飽和しない）。**同一条件（処理済み画像sha256+設定）のin-flight共有**により、先読みと現在画像OCRの二重実行は推論1回に統合。**クライアント切断を画像デコード前・各スロット実行前に確認**し、切断済みなら未開始スロットを実行しない（キュー内Futureはキャンセル）。1件失敗しても他スロットの結果は返す（行単位error）。結果は**プロセス内LRUキャッシュ（128件）を再利用**（エラーは対象外）。中間・最終画像はレスポンス直下に1回だけ。`timings`/`elapsed_ms` は性能調査用の実測値。既存 preview-file は後方互換のため維持 |
| POST `/api/ocr/preview-file` | multipart: `file?`（アップロード画像）/ `export_id`+`filename`+`rotation`（サーバー管理下の評価候補）/ `source_directory`+`filename`+`rotation`（Step5フォルダ取得モードの画像）, `project_id`, `overrides_json?`, `eval_preprocess_json?`（Step5専用OCR前処理 `{grayscale, binarize, binarize_method: otsu/fixed, threshold: 0-255}`。未指定=従来動作）, `engine`, `model`, `model_type?`, `easyocr_langs`, `include_lowercase`, `psm?`（Tesseractのページセグメンテーションモード。0/未指定=従来の7）, `whitelist?`（Tesseract=whitelist・検証charsetも追従 / EasyOCR=readtextのallowlist。空=従来の既定） | `/preprocess/preview` 互換（`type` / `interim_data_url` / `processed_data_url` / `prediction` / `confidence` / `predict_engine` / `predict_model_name` / `predict_error` 等） | 登録前・評価用画像のOCR前処理＋推論プレビュー（Step5のOCR候補用）。前処理・推論・小文字制御・Confidence正規化は既存サービスを共通利用。評価候補はマニフェスト記載ファイルのみ・フォルダ画像はフォルダ直下のみ解決（トラバーサル拒否）。処理順は「回転（フォルダ画像はEXIF反映も）→ Step5専用OCR前処理（既存 `_op_grayscale`/`_op_threshold` を再利用するアダプター。**OCR候補生成用の推論入力にのみ適用し、評価用画像・作成データセットへは一切反映しない**）→ プロジェクト共通のOCR前処理 → 推論」 |

## 評価 / チューニング出力

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/evaluate` | `EvaluateRequest`（`dataset` val/test, `model`, `overrides?`） | 評価結果 | 分類モデルの精度評価 |
| POST `/api/ocr/evaluate` | `OcrEvaluateRequest`（`image_dir`, `gt_csv`, `targets[]`, `charset`, `psm`, `eval_preprocess?`（Step5と共通の評価前処理 `{grayscale, binarize, binarize_method: otsu/fixed, threshold}`。未指定=従来動作）, `preprocess_source?`（none/step5/custom）, `preprocess_mode?`（`none`=前処理なし / `manual`=手動設定 / `training`=**学習時前処理を全対象へ共通適用**（対象モデルの`training_preprocess`が未記録=400・全学習後モデルのハッシュ不一致=400でフォールバックしない） / `training_individual`=各モデルの学習時前処理を個別適用（ベースengは前処理なし・「純粋比較ではない」警告付き）。未指定=従来動作）） | 評価結果（**前処理関連の追加キー**: `preprocess_mode`（実際に適用したモード）・`evaluation_preprocess`（`{mode, preprocess_hash?, snapshot_id?, source_model_id?, settings?}`=再現用）・`preprocess_warnings[]`（不一致/未記録/個別適用の注意文）・targets[]へ `training_preprocess_hash` / `preprocess_match`（true/false/null=未記録）。`preprocess_source` / `eval_preprocess` に**サーバーが実際に適用した前処理**をecho。**targets[] へCER主指標を追加**: `cer`/`cer_percent`（マイクロ平均=全画像の編集距離総和÷正解文字数総和・低いほど良い）・`char_accuracy`（=1-CER）・`edit_distance_total`・`ref_length_total`・`confusions`（Levenshteinアラインメント由来の置換/脱落/挿入TOP10）。**comparison へ** `base_cer`/`trained_cer`/`cer_delta`/`cer_delta_pt`/`cer_relative_improvement`（=(学習前-学習後)/学習前）と、画像単位の編集距離比較による `improved`/`unchanged`/`regressed`、完全一致の増減 `perfect_fixed`/`perfect_regressed` を追加。**rows[].results[] へ** `edit_distance`/`sub_count`/`del_count`/`ins_count` を追加。既存フィールドは不変=後方互換） | OCRモデル評価（Tesseract。正解CSV比較・CER主指標／Accuracy=完全一致率は業務指標）。前処理は全評価画像へ同一適用され、適用順は「元画像（回転はデータセット作成時に焼き込み済み=二重回転しない）→ 評価前処理（Step5共通の `apply_eval_preprocess`）→ OCR入力整形 → 推論 → whitelist → 完全一致評価」。不正な前処理値は400 |
| POST `/api/ocr/training-preprocess/preview` | `TrainingPreprocessPreviewRequest`（`project_id?`, `model`, `directory`, `filename`） | `{model, training_preprocess_hash, snapshot_id, preprocessed_data_url, normalized_data_url}` | モデルの**学習時前処理を適用したプレビュー**（元画像→学習時前処理後→OCR入力整形後。評価・推論画面用）。学習時前処理が未記録の旧モデルは400（フォールバックしない）。元ファイルは変更しない |
| POST `/ocr/tuning/export` | `OcrTuningExportRequest`（`engine`, `image_types`, 比率） | 出力結果 | EasyOCR/PaddleOCR学習用データのエクスポート |

## ミドルウェア / 起動処理

| 項目 | 内容 |
|---|---|
| CORS | `CORSMiddleware`。許可オリジンは 環境変数 `CORS_ALLOWED_ORIGINS` → `settings.yaml cors.allowed_origins` → 既定 `http://localhost:5173`, `http://127.0.0.1:5173` の順で解決。`allow_credentials=True` |
| 例外処理 | `@app.middleware("http")` の `_unhandled_exception_as_json` が未捕捉例外を JSON 500（`detail`付き）へ変換。CORSMiddleware の内側で実行され、500応答にもCORSヘッダが付く |
| 起動時 | `@app.on_event("startup")` で `ensure_directories()` と `init_db()` を実行 |

## 認証

- 認証・認可の仕組みは存在しない（ローカル実行前提。全エンドポイントが無認証）。
