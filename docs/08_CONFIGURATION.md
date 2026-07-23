# 08. 設定

## 設定ファイル

| ファイル | 役割 |
|---|---|
| `config/settings.yaml` | アプリ全体の設定（唯一のYAML設定。`src/app/config.py` が読込） |
| `frontend/.env` | フロントの環境変数（任意。`VITE_API_BASE` のみ。gitignore対象、`.env.example` の許可記述はあるがファイル自体は存在しない） |

## 環境変数

### バックエンド

| 変数 | 用途 | 既定動作 | 参照箇所 |
|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | CORS許可オリジン（カンマ区切り、settings.yamlより優先） | settings.yaml → `http://localhost:5173`, `http://127.0.0.1:5173` | `src/app/main.py` |
| `PADDLEOCR_PATH` | PaddleOCRリポジトリの場所 | `settings.yaml ocr_training.paddleocr_repo_dir`（`external/PaddleOCR`） | `src/app/main.py` |
| `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK` | paddlexのモデル配信元疎通チェック無効化（オフライン対応） | コードが `"True"` を setdefault | `src/app/predict.py` |
| `TESSDATA_PREFIX` | tessdata探索先 | `settings.yaml tesseract.tessdata_dir` が優先 | `services/tesseract_pipeline.py` |
| `YOLO_CONFIG_DIR` | ultralytics設定ディレクトリ | コードが setdefault | `services/training_image_builder.py` |
| `HOME` / `USERPROFILE` / `XDG_CACHE_HOME` / `PADDLE_HOME` / `DATA_HOME` | Paddleのキャッシュをワークスペース内（`.runtime_home/`, `.cache/`）へ隔離するため上書き | コードが設定 | `services/ocr_pipeline.py` |
| `OCRC_ALLOW_UNAUTHENTICATED_ADMIN` | 認証未設定モード（Admin互換）の許可。`false`/`0`/`no`で本番モード（X-Operatorなし=401・不正Role=403）。settings.yaml `security.allow_unauthenticated_admin` より優先 | 未設定=settings.yaml→true | `services/audit_log.py`（docs/22参照） |
| `OCRC_DISABLE_WORKER_AUTOSTART` | app startup時のJob Worker自動起動・再起動復旧の無効化（テスト用） | 未設定=起動する | `src/app/main.py` |

### フロントエンド

| 変数 | 用途 | 既定値 | 参照箇所 |
|---|---|---|---|
| `VITE_API_BASE` | バックエンドAPIのベースURL | `http://127.0.0.1:8000` | `frontend/src/lib/api.js`, `views/TrainingImageBuilderView.jsx` |

## settings.yaml の主な設定値

### app / cors / paths

| キー | 既定値 | 意味 |
|---|---|---|
| `app.name` | `ocr-crafter` | アプリ名 |
| `app.db_path` | `outputs/app.db` | SQLite DBパス |
| `cors.allowed_origins` | localhost:5173, 127.0.0.1:5173 | CORS許可オリジン |
| `paths.data_projects` | `data/projects` | プロジェクトデータルート |
| `paths.outputs` | `outputs` | 共通出力先 |

### preprocess（前処理）

| キー | 既定値 | 意味 |
|---|---|---|
| `ratio_threshold` | 1.6 | 縦横比による single / wide 分岐しきい値 |
| `pipelines.single` / `pipelines.wide` | 工程名の配列 | 前処理パイプライン（grayscale → illumination → … → manual_mask_pre → threshold → manual_mask_post → … → resize 等） |
| `operations.threshold` | type: binary, value: 128 | 二値化 |
| `operations.sharpen` | enabled: true, amount: 0.2 | シャープ化 |
| `operations.stroke_boost` | enabled: true, method: close | 掠れ補正 |
| `operations.deskew` | enabled: true | 傾き補正（wideのみパイプラインに含む） |
| `operations.resize` | single: 64, wide_height: 48, keep_ratio: true | リサイズ |
| その他 | clahe / gamma / morph / unsharp / bilateral / local_contrast / crop_margin / hist_equalize / denoise / pad / normalize / illumination / manual_mask | 各オペレーションの既定パラメータ（多くは enabled: false） |

前処理設定はAPIリクエストの `overrides` でリクエスト単位に上書きできる（フロントの前処理設定画面から送信）。

### dataset / training（分類モデル）

| キー | 既定値 |
|---|---|
| `dataset.train_ratio` / `val_ratio` / `test_ratio` | 0.7 / 0.2 / 0.1 |
| `dataset.seed` | 42 |
| `training.default_epochs` / `default_batch_size` / `default_lr` | 30 / 16 / 0.001 |
| `training.image_type_to_model` | single→square, wide→wide |
| `training.models.square.image_size` | [64, 64] |
| `training.models.wide.image_size` | [96, 48] |

### ocr_training（PaddleOCR学習）

| キー | 既定値 |
|---|---|
| `paddleocr_repo_dir` | `external/PaddleOCR` |
| `default_device` | `auto` |
| `default_auto_batch_size` / `default_use_amp` / `default_pin_memory` / `default_persistent_workers` | false |
| `default_train_num_workers` / `default_eval_num_workers` | 0 |
| `default_save_epoch_step` | 10 |
| `presets.mac_safe` | cpu / batch 8 / workers 0 / AMPなし |
| `presets.rtx_train` | gpu / auto batch / batch 24 / workers 4/2 / AMP・pin_memory・persistent_workers 有効 |

### tesseract

| キー | 既定値 |
|---|---|
| `tesseract_cmd` 等 | `C:\Program Files\Tesseract-OCR\` 配下の実行ファイルパス（空ならPATH解決） |
| `tessdata_dir` | `models/tessdata_best`（絶対パスで記載） |
| `base_lang` | `eng` |
| `default_charset` | `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt`（学習対象文字。whitelistとは別概念、詳細は `docs/12_TESSERACT_CHARSET_SPEC.md`） |
| `default_max_iterations` | 1000 |
| `default_psm` | 7（単一行認識） |

## フロントエンドのブラウザ保存設定

localStorage（`try/catch` で不可環境でも動作継続）:

| キー | 用途 | 保存単位 |
|---|---|---|
| `ocr_preprocess_presets_v1` | 前処理プリセット（**旧キー**。プロジェクト別キーへの初回コピー移行元として読み取りのみ・変更しない） | 全体共通 |
| `ocr_preprocess_presets_by_project_v1` | 前処理プリセット（プロジェクト別。未保存プロジェクトは旧キーから初回コピー移行） | プロジェクト別 |
| `ocr_preprocess_params_by_project_v1` | 前処理パラメータ（`threshold_block_size`/`threshold_c` 追加。旧データはキー無し=既定値補完） | プロジェクト別 |
| `ocr_preprocess_ui_state_by_project_v1` | 前処理設定画面のUI状態（`{mode: basic/advanced, openSections: []}`。検索文字列は保存しない） | プロジェクト別 |
| `ocr_preprocess_predict_by_project_v1` | 前処理画面「OCR結果確認」の推論設定（engine/model/paddleModel/tesseractModel/modelType/langs/psm/whitelist） | プロジェクト別 |
| `ocr_preprocess_extra_slots_by_project_v1` | 推論比較スロット（モデル2/3） | プロジェクト別 |
| `ocr_model_aliases_by_project_v1` | モデル表示名 | プロジェクト別 |
| `ocr_model_eval_history_by_project_v1` | モデル評価履歴（`{モデル: {データセットラベル: {percent, at}}}`。データセット選択時はラベル=データセットID・手動指定時は画像フォルダ名。形式は従来から不変・追加キーのみ: `pre.mode`（評価前処理モード）/`pre.hash`（評価前処理ハッシュ）/`pre.source_model_id`/`preprocess_match`（学習時前処理との一致 true/false/null=未記録）/`training_preprocess_hash`。旧エントリはキー無し=未記録表示） | プロジェクト別 |
| `ocr_include_lowercase_by_project_v1` | 小文字出力設定 | プロジェクト別 |
| `ocr_candidate_dict_by_project_v1` | OCR候補辞書 | プロジェクト別 |
| `ocr_label_text_align_by_project_v1` | ラベル編集の「現在のラベル」文字位置（left/center/right、既定center） | プロジェクト別 |
| `ocr_eval_preview_settings_by_project_v1` | Step5専用OCR設定の旧単一モデル形式（読み込み時に `ocr_eval_preview_slots_by_project_v1` のモデル1へ自動移行。旧キー自体は変更しない） | プロジェクト別 |
| `ocr_eval_preview_slots_by_project_v1` | Step5（評価用データ作成）専用のOCR設定・最大3モデル（`{slots: [{enabled, engine, paddleModel, tesseractModel, easyocrLangs, includeLowercase, psm, whitelist}], autoRun}`。初期=モデル1のみ有効。`autoRun`=「画像切替・回転後にOCRを自動実行」（**既定ON**: 未保存=ON・明示的にfalse保存済み=OFFを尊重。OFF時は変更で候補を要再実行表示にするだけ）。ラベル編集の推論設定とは独立） | プロジェクト別 |
| `ocr_eval_preprocess_settings_by_project_v1` | Step5専用OCR前処理（`{grayscale, binarize, binarizeMethod: otsu/fixed, threshold}`。OCR候補生成時のみ適用・評価用画像/作成データには反映しない。プロジェクト共通OCR前処理・YOLO検出前処理とは独立） | プロジェクト別 |
| `ocr_detection_preprocess_by_project_v1` | YOLO検出用前処理 | プロジェクト別 |
| `ocr_sidebar_collapsed_v1` | サイドバー折り畳み | 全体共通 |
| `ocr_image_builder_last_state_v1` | データ作成（Step1〜4）の最終状態（`modelSource`=選択モデルの取得元 project/common/builtin を追加。旧データは一覧ロード後に自動補完） | 全体共通 |
| `ocr_eval_label_text_align_by_project_v1` | Step5（評価用データ作成）のラベル文字配置（left/center/right）。既存ラベル編集の `ocr_label_text_align_by_project_v1` とはキーを分離 | プロジェクト別 |

sessionStorage:

| キー | 用途 |
|---|---|
| `ocr_training_session_by_project_v1` | 学習ジョブセッション（jobId/status/logs） |
| `ocr_last_project_v1` | 最後に開いたプロジェクトID |

## Feature Flag 相当の定数

| 定数 | 値 | 意味 | 場所 |
|---|---|---|---|
| `STRICT_OCR_EXPORT_REQUIRED` | `True` | 未export（inference変換前）のOCRモデルでの推論を拒否 | `src/app/predict.py` |
| `EXPERIMENTAL_VIEWS` | `cls-training` 等4画面 | 実験機能バナーを表示する画面集合 | `frontend/src/App.jsx` |
