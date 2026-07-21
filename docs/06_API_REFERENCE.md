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
| POST `/preprocess/run` | `PreprocessRequest`（`project_id?`, `overrides?`） | `count`, `type_counts`, `files` | 全画像の前処理実行 |
| GET `/preprocess/preview` | Query: `image`, `engine`, `model`, `model_type?`, `easyocr_langs`, `include_lowercase` | プレビュー + 推論結果 | 前処理プレビュー＋OCR推論 |
| POST `/preprocess/preview` | `PreprocessPreviewRequest`（上記 + `overrides?`） | プレビュー + 推論結果 | Body で前処理上書きを指定できる版 |

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
| POST `/api/ocr/dataset/create` | `OcrDatasetCreateRequest`（`image_types`, `charset`, `max_text_length`, `image_shape`, 比率, `seed`, `text_case`, 任意: `augmentation`=新形式オーグメンテーション設定） | 作成結果（`counts`＋`input_count`/`valid_count`/`skipped`内訳/`split_method: image`/`augmentation`/`augmentation_generated`） | ラベル済み画像からOCR認識用データセット作成。**分割枚数は最大剰余法**（合計=有効画像数を保証。同値小数部はTrain→Val→Test優先）。`augmentation` 指定時は**Trainのみ**へ追加画像を生成（元画像は必ず残る・ラベル不変・生成枚数=(倍率-1)×Train枚数）。比率合計≠1.0は **400**（`detail={code: INVALID_SPLIT_RATIO, message, values}` の構造化エラー） |
| POST `/api/ocr/dataset/split-preview` | `OcrDatasetSplitPreviewRequest`（`image_types`, `charset`, `max_text_length`, `text_case`, 比率） | `input_count`, `valid_count`, `skipped{type,invalid_label,missing_source}`, `counts`, `split_method`, `ratios` | データセット作成前の分割予定枚数プレビュー（画像は生成しない。作成時と同じ最大剰余法） |
| POST `/api/ocr/dataset/augmentation-preview` | `OcrAugmentationPreviewRequest`（`augmentation`, `sample_count`=1〜5, `image_shape` 等） | `items[{image_name,label,original,augmented}]`（base64 PNG）, `config` | 学習前のオーグメンテーションプレビュー（ランダムサンプルへ適用。強すぎる設定の事前確認用） |
| POST `/api/ocr/dataset/from_logs` | `OcrDatasetFromLogsRequest`（`only_invalid`, `include_corrected` 等） | 作成結果 | 推論ログからOCRデータセット作成 |
| POST `/api/ocr/train/start` | `OcrTrainStartRequest`（`engine`, `dataset_dir`, `device`, worker/AMP設定等） | `job_id`, `engine: paddleocr` | PaddleOCR学習ジョブ開始（paddleocrのみ許可）。同一プロジェクトでアクティブなOCRジョブがある場合は **409 Conflict** |
| POST `/api/tesseract/train/start` | `TesseractTrainStartRequest`（`dataset_dir`, `charset`, `max_iterations`, `base_lang`, `psm`, 任意: `experiment_name` / `parent_model_id` / `training_note`） | `job_id`, `engine: tesseract` | Tesseract LSTM fine-tune 開始。二重実行は **409 Conflict**。実験情報はジョブ（`training_jobs.experiment_meta` JSON列）経由でモデルメタへ保存（未指定=従来動作） |
| GET `/api/ocr/train/active` | Query: `project_id?` | `{project_id, job}` | プロジェクトのアクティブ（queued/running）なOCR学習ジョブを返す（無ければ `job: null`）。画面再読込時の再接続用 |
| GET `/api/ocr/train/status/{job_id}` | Path | ジョブ状態 | OCR学習状態取得 |
| POST `/api/ocr/train/stop/{job_id}` | Query: `delete_artifacts?` | 停止結果 | OCR学習停止 |
| GET `/api/ocr/train/log/{job_id}` | Query: `tail`（1〜5000） | `lines[]` | 学習ログのtail取得 |

## モデル管理

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/models` | Query: `project_id?` | `items` | 保存済みモデル一覧 |
| GET `/models/info` | Query: `project_id?` | `items` | モデル詳細情報一覧（`model_size_mb`=モデル実体サイズMB。tesseract=traineddata・分類=.ptファイル。実体なし/PaddleOCRはnull=UIでは未記録表示。`model_id`=管理No「M0001」形式：作成日時順に自動採番・OCR Crafter全体で一意・削除後も再利用しない。`data/model_ids.json` へ永続化し未登録モデルは一覧取得時に一括採番。tesseractモデルは実験情報 `experiment_name` / `parent_model_id`（親モデルの管理No。ベース直学習は空）/ `training_note` / `training_duration_seconds`（秒・旧モデルはnull）を含む=学習条件比較で使用。旧メタは空値/nullで後方互換） |
| GET `/models/latest` | Query: `model_type?`, `training_family`, `engine?` | `model` | 最新モデル名 |
| GET `/model-types` | Query: `project_id?` | `items` | モデル種別一覧 |
| DELETE `/models/{model_name}` | Query: `project_id?` | `deleted` | モデル削除（models配下限定の安全検証あり） |
| GET `/api/models/download/{model_name}` | Query: `project_id?` | FileResponse | `.pt` / `.traineddata` / inference ZIP のダウンロード |
| POST `/api/ocr/models/export-migrate` | Query: `overwrite?`, `dry_run?` | 変換結果 | 学習済みOCRモデルを推論用へ一括変換 |
| GET `/api/ocr/models/official` | なし | `items` | 公式PaddleOCR認識モデル一覧 |

## 推論 / OCRログ

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/predict` | Form: `file`, `engine`, `model_type`, `model`, `easyocr_langs`, `include_lowercase`, `apply_preprocess`, `preprocess_overrides_json`, `project_id` | 推論結果 + `preprocess_preview_data_url` | 1画像のOCR推論（ログ保存） |
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
| POST `/api/ocr/evaluate` | `OcrEvaluateRequest`（`image_dir`, `gt_csv`, `targets[]`, `charset`, `psm`, `eval_preprocess?`（Step5と共通の評価前処理 `{grayscale, binarize, binarize_method: otsu/fixed, threshold}`。未指定=従来動作）, `preprocess_source?`（none/step5/custom）） | 評価結果（`preprocess_source` / `eval_preprocess` に**サーバーが実際に適用した前処理**をecho。**targets[] へCER主指標を追加**: `cer`/`cer_percent`（マイクロ平均=全画像の編集距離総和÷正解文字数総和・低いほど良い）・`char_accuracy`（=1-CER）・`edit_distance_total`・`ref_length_total`・`confusions`（Levenshteinアラインメント由来の置換/脱落/挿入TOP10）。**comparison へ** `base_cer`/`trained_cer`/`cer_delta`/`cer_delta_pt`/`cer_relative_improvement`（=(学習前-学習後)/学習前）と、画像単位の編集距離比較による `improved`/`unchanged`/`regressed`、完全一致の増減 `perfect_fixed`/`perfect_regressed` を追加。**rows[].results[] へ** `edit_distance`/`sub_count`/`del_count`/`ins_count` を追加。既存フィールドは不変=後方互換） | OCRモデル評価（Tesseract。正解CSV比較・CER主指標／Accuracy=完全一致率は業務指標）。前処理は全評価画像へ同一適用され、適用順は「元画像（回転はデータセット作成時に焼き込み済み=二重回転しない）→ 評価前処理（Step5共通の `apply_eval_preprocess`）→ OCR入力整形 → 推論 → whitelist → 完全一致評価」。不正な前処理値は400 |
| POST `/ocr/tuning/export` | `OcrTuningExportRequest`（`engine`, `image_types`, 比率） | 出力結果 | EasyOCR/PaddleOCR学習用データのエクスポート |

## ミドルウェア / 起動処理

| 項目 | 内容 |
|---|---|
| CORS | `CORSMiddleware`。許可オリジンは 環境変数 `CORS_ALLOWED_ORIGINS` → `settings.yaml cors.allowed_origins` → 既定 `http://localhost:5173`, `http://127.0.0.1:5173` の順で解決。`allow_credentials=True` |
| 例外処理 | `@app.middleware("http")` の `_unhandled_exception_as_json` が未捕捉例外を JSON 500（`detail`付き）へ変換。CORSMiddleware の内側で実行され、500応答にもCORSヘッダが付く |
| 起動時 | `@app.on_event("startup")` で `ensure_directories()` と `init_db()` を実行 |

## 認証

- 認証・認可の仕組みは存在しない（ローカル実行前提。全エンドポイントが無認証）。
