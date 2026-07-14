# 06. API リファレンス

すべてのルートは `src/app/main.py` に定義されている（`APIRouter` / `include_router` は不使用）。
リクエストスキーマは `src/app/schemas.py` を参照。**全55エンドポイント**。

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
| POST `/api/ocr/dataset/create` | `OcrDatasetCreateRequest`（`image_types`, `charset`, `max_text_length`, `image_shape`, 拡張設定, 比率, `text_case`） | 作成結果 | ラベル済み画像からOCR認識用データセット作成 |
| POST `/api/ocr/dataset/from_logs` | `OcrDatasetFromLogsRequest`（`only_invalid`, `include_corrected` 等） | 作成結果 | 推論ログからOCRデータセット作成 |
| POST `/api/ocr/train/start` | `OcrTrainStartRequest`（`engine`, `dataset_dir`, `device`, worker/AMP設定等） | `job_id`, `engine: paddleocr` | PaddleOCR学習ジョブ開始（paddleocrのみ許可） |
| POST `/api/tesseract/train/start` | `TesseractTrainStartRequest`（`dataset_dir`, `charset`, `max_iterations`, `base_lang`, `psm`） | `job_id`, `engine: tesseract` | Tesseract LSTM fine-tune 開始 |
| GET `/api/ocr/train/status/{job_id}` | Path | ジョブ状態 | OCR学習状態取得 |
| POST `/api/ocr/train/stop/{job_id}` | Query: `delete_artifacts?` | 停止結果 | OCR学習停止 |
| GET `/api/ocr/train/log/{job_id}` | Query: `tail`（1〜5000） | `lines[]` | 学習ログのtail取得 |

## モデル管理

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/models` | Query: `project_id?` | `items` | 保存済みモデル一覧 |
| GET `/models/info` | Query: `project_id?` | `items` | モデル詳細情報一覧 |
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

## 学習画像作成（YOLO検出）

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| GET `/image-builder/yolo-models` | Query: `project_id?` | モデル一覧 | 利用可能なYOLOモデル一覧 |
| POST `/image-builder/resize-preview` | Form: `file`, `resize_long_side`, `use_resize`, `resize_axis`, `detect_preprocess_json` | プレビュー | リサイズ/検出前処理プレビュー |
| POST `/image-builder/detect` | Form: 上記 + `model`, `conf_threshold`, `merge_overlaps`, `merge_iou_threshold` | 検出結果 | YOLO BBox検出 |
| POST `/image-builder/export` | Form: 上記 + `boxes_json`, `output_dir`, `crop_height` | 出力結果 | 選択BBoxを元画像から切出して出力 |

## 評価 / チューニング出力

| Method / Path | リクエスト | レスポンス主要キー | 概要 |
|---|---|---|---|
| POST `/evaluate` | `EvaluateRequest`（`dataset` val/test, `model`, `overrides?`） | 評価結果 | 分類モデルの精度評価 |
| POST `/api/ocr/evaluate` | `OcrEvaluateRequest`（`image_dir`, `gt_csv`, `targets[]`, `charset`, `psm`） | 評価結果 | OCRモデル評価（Tesseract。正解CSV比較） |
| POST `/ocr/tuning/export` | `OcrTuningExportRequest`（`engine`, `image_types`, 比率） | 出力結果 | EasyOCR/PaddleOCR学習用データのエクスポート |

## ミドルウェア / 起動処理

| 項目 | 内容 |
|---|---|
| CORS | `CORSMiddleware`。許可オリジンは 環境変数 `CORS_ALLOWED_ORIGINS` → `settings.yaml cors.allowed_origins` → 既定 `http://localhost:5173`, `http://127.0.0.1:5173` の順で解決。`allow_credentials=True` |
| 例外処理 | `@app.middleware("http")` の `_unhandled_exception_as_json` が未捕捉例外を JSON 500（`detail`付き）へ変換。CORSMiddleware の内側で実行され、500応答にもCORSヘッダが付く |
| 起動時 | `@app.on_event("startup")` で `ensure_directories()` と `init_db()` を実行 |

## 認証

- 認証・認可の仕組みは存在しない（ローカル実行前提。全エンドポイントが無認証）。
