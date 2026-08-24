# 02. ディレクトリ構成

## ツリー（追跡対象 + 主要な生成物）

```text
ocr_crafter/
├── config/
│   └── settings.yaml            # 全設定（前処理・学習・Tesseract・CORS等）
├── src/
│   └── app/
│       ├── main.py              # FastAPI本体（全142エンドポイント、約5320行）
│       ├── schemas.py           # Pydanticリクエストスキーマ
│       ├── config.py            # settings.yaml 読込（lru_cache）
│       ├── paths.py             # リポジトリパス定数
│       ├── project_paths.py     # プロジェクトdir構造・安全削除・ID検証
│       ├── version.py           # アプリバージョン定数
│       ├── db.py                # SQLite: Job System A（training_jobsテーブル、outputs/app.db）
│       ├── train.py             # 分類モデル学習（CLIあり）
│       ├── predict.py           # 5エンジン推論（custom/EasyOCR/PaddleOCR/Tesseract/TrOCR、CLIあり）
│       ├── job_runner.py        # 学習ワーカー起動（CLIあり。classification/ocr/tesseract/trocr）
│       ├── init_dirs.py         # ディレクトリ初期化（CLIあり）
│       ├── ocr_tuning.py        # OCR学習データ出力CLIラッパー
│       ├── migrate_legacy_data.py   # 旧データ移行CLI
│       ├── migrate_ocr_models.py    # OCRモデルinference変換CLI
│       └── services/            # ドメインロジック（57モジュール）
│           ├── preprocess.py            # OCR前処理パイプライン本体
│           ├── ocr_preprocess.py        # 軽量前処理ユーティリティ
│           ├── manual_mask.py           # 手動マスク補正（行RLE）
│           ├── detection_preprocess.py  # YOLO検出専用前処理+BBox逆変換
│           ├── image_classifier.py      # single/wide 判定
│           ├── data_manager.py          # 画像取込・一覧・回転
│           ├── labels.py                # annotations/master.csv 読み書き
│           ├── dataset_builder.py       # 分類データセット分割
│           ├── training_image_builder.py# YOLO検出・クロップ出力
│           ├── model_registry.py        # モデル一覧・解決・安全削除
│           ├── ocr_pipeline.py          # PaddleOCR学習・登録・ログ・検証（約2400行）
│           ├── tesseract_pipeline.py    # Tesseract学習・認識
│           ├── trocr_engine.py          # TrOCR推論コア（TrOCREngine.load/predict）
│           ├── trocr_training_core.py   # TrOCR学習ループ（独自AdamW training loop）
│           ├── trocr_dataset_adapter.py # TrOCR学習データセット読込
│           ├── trocr_model_registry.py  # TrOCRモデル一覧・登録（.trocr.json sidecar）
│           ├── trocr_evaluation_predictor.py  # TrOCR評価アダプタ
│           ├── ocr_tuning.py            # EasyOCR/PaddleOCR学習データ出力
│           ├── ocr_evaluation.py        # OCRモデル評価（Tesseract専用の既存関数。Multi-engineはevaluation_dispatcher.py経由）
│           ├── evaluation_dispatcher.py # Multi-engine Evaluation Dispatcher（Tesseract/PaddleOCR/EasyOCR/TrOCR）
│           ├── evaluation_multi_engine.py # Multi-engine評価の共通処理
│           ├── evaluation_runner.py     # 評価バッチ実行
│           ├── evaluation_metrics.py    # CER等の指標計算共通処理
│           ├── evaluation_types.py      # Multi-engine評価の型定義
│           ├── tesseract_evaluation_predictor.py / paddleocr_evaluation_predictor.py / easyocr_evaluation_predictor.py  # エンジン別評価アダプタ
│           ├── ocr_preview_cache.py     # OCRプレビューのキャッシュ
│           ├── evaluation.py            # 分類モデル評価
│           ├── evaluation_dataset.py    # 評価データセット管理
│           ├── preprocess_config_store.py  # 前処理設定の保存・履歴
│           ├── preprocess_snapshot.py   # 前処理実効パラメータのスナップショット
│           ├── dataset_registry.py      # Dataset Manager（DS0001採番・一覧・Dataset⇔Model連携）
│           ├── experiment_tracker.py    # 実験管理（EXP-0001・実験カルテ・比較・推薦）
│           ├── benchmark.py             # Benchmark Runner（BM-0001・Tesseract/PaddleOCR/TrOCR実行比較）
│           ├── benchmark_center.py      # Benchmark Center（BMC-0001・横断比較・実行なし）
│           ├── release_manager.py       # リリース管理（Draft→Production・Rollback。Tesseract/PaddleOCR/TrOCR対応）
│           ├── release_gate.py          # Release Policy判定（PASS/CONDITIONAL_PASS/FAIL）
│           ├── job_manager.py           # Job System B（JOB-000001・JobManager/JobWorker・SQLite JobRepository、data/jobs/job_manager.db）
│           ├── audit_log.py             # 監査ログ（追記型・32操作）
│           ├── report_generator.py      # レポート生成（RPT-0001・Markdown/PDF）
│           ├── operations.py            # 運用ダッシュボード・ヘルスチェック
│           ├── backup_manager.py        # project単位バックアップ（BK-0001・metadata_only/full）
│           ├── sqlite_backup.py         # Global SQLiteのOnline Backup/Restore（outputs/app.db・job_manager.db）
│           ├── inference_model.py       # 推論モデル永続化（GET/POST /api/ocr/inference/model）
│           ├── engine_capability.py / engine_registry.py  # Engine横断のCapability/Registry
│           ├── model_metadata.py        # `ModelMetadata` dataclass（Epic #28、Consumer未配線）
│           ├── metadata_reader.py / metadata_writer.py / model_catalog.py / models_api.py / training_metadata_factory.py / legacy_metadata_adapter.py  # `ModelMetadata`のConsumer層（Epic #28、main.py未配線・Continue Hold）
│           ├── latin_case.py            # 小文字出力制御の共通判定
│           ├── atomic_io.py             # 原子的ファイル書き込み共通処理
│           └── dialogs.py               # ネイティブのファイル/フォルダ選択
├── frontend/
│   ├── index.html               # エントリHTML（lang="ja"）
│   ├── vite.config.js           # Vite設定（port 5173、プロキシなし）
│   ├── tailwind.config.js       # ダークテーマカラー定義
│   ├── postcss.config.js
│   ├── package.json             # scripts: dev/build/preview/test
│   ├── src/
│   │   ├── main.jsx             # Reactエントリ（StrictMode）
│   │   ├── App.jsx              # 全状態管理・view切替（約5240行）
│   │   ├── index.css            # Tailwind + カスタムクラス
│   │   ├── views/               # 22画面（下表）
│   │   ├── components/          # 共通UI 20種
│   │   └── lib/                 # 純粋ロジック（api.js 等 53種）
│   └── tests/                   # node:test（71ファイル、依存追加不要。`npm test`で全件実行）
├── tests/                       # pytest（87ファイル + conftest.py）
├── docs/                        # ドキュメント
├── data/projects/<project_id>/  # ※gitignore。プロジェクトデータ（下記）
├── data/jobs/                    # ※gitignore。Job System B: job_manager.db（SQLite）・events/・logs/
├── data/backups/                # ※gitignore。project単位ZIP backup・system/配下にGlobal SQLite backup（sqlite_backup.py）
├── data/model_ids.json          # モデル管理No（M0001形式）の登録簿（全プロジェクト共通）
├── data/dataset_ids.json        # Dataset管理No（DS0001形式）の登録簿（全プロジェクト共通）
├── models/                      # ※gitignore。tessdata_best / yolo 等
├── outputs/                     # ※gitignore。app.db（SQLite、Job System A）等
├── external/                    # ※gitignore。PaddleOCRリポジトリ
├── requirements.txt             # 全量スナップショット（UTF-16）
├── requirements-ci.txt          # CI最小依存
├── requirements-dev.txt         # pytest
├── requirements-ocr-tuning.txt  # OCRチューニング任意依存
├── Pipfile                      # pipenv定義（Python 3.9指定。CI/実運用は3.10のため既知の不一致あり）
├── readme.md                    # セットアップ・API概要・Quick Start
├── CHANGELOG.md                 # 変更履歴
└── yolo11n.pt                   # YOLOモデル（リポジトリ直下）
```

## プロジェクトデータ構造（`data/projects/<project_id>/`）

`src/app/project_paths.py` の `ensure_project_directories` が生成する:

| サブディレクトリ | 内容 |
|---|---|
| `raw/` | 取り込んだ元画像（回転はこのファイルを直接更新） |
| `interim/` | 前処理の中間画像 |
| `processed/` | 前処理済み画像（single/wide 別） |
| `annotations/` | `master.csv`（filename,label,type）と `manual_masks.json` |
| `dataset/` | 分類用データセット（train/val/test） |
| `models/` | 学習済みモデル（`*.pt` / `*.ocr.json` / `*.tess.json` / `*.trocr.json` / `ocr_runs/<job_id>/` / `trocr_runs/<job_id>/`） |
| `logs/` | 学習ログ |
| `outputs/` | 評価・プレビュー・OCRログ（`ocr_logs/predictions.jsonl`）・OCRデータセット（`ocr_dataset*/<フォルダ>/meta.json`＝Dataset Managerが走査する実体）等 |
| `experiments.json` | 実験カルテ（EXP-0001形式） |
| `releases.json` | リリース管理の状態・履歴（REL-0001形式） |
| `benchmarks.json` | Benchmark Runnerの実行結果（BM-0001形式） |
| `benchmark_center.json` | Benchmark Centerの比較条件（BMC-0001形式。評価結果自体は保存しない） |
| `inference_model.json` | 推論モデル永続化（現在の「推論に使用」選択。`GET/POST /api/ocr/inference/model`） |

## フロントエンド画面（views/、22画面）

| ファイル | 画面 |
|---|---|
| `DashboardView.jsx` | ダッシュボード（プロジェクト管理・進捗） |
| `ImagesView.jsx` | 画像取り込み・一覧（仮想スクロール・回転） |
| `TrainingImageBuilderView.jsx` | データ作成 Step1〜4（YOLO検出〜クロップ出力） |
| `PreprocessView.jsx` | 前処理設定・プレビュー・手動マスク・比較スロット |
| `LabelingView.jsx` | ラベル編集（OCR候補・辞書近似候補） |
| `EvaluationDatasetBuilder.jsx` | 評価データセット作成 |
| `TrainingView.jsx` | 学習（OCR/分類/Tesseract共通） |
| `ModelsView.jsx` | モデル管理（管理No・カルテ・比較・推論モデル切替） |
| `DatasetManagerView.jsx` | Dataset Manager（学習データセットの資産管理） |
| `ExperimentsView.jsx` | 実験管理（EXP-0001・条件推薦） |
| `ReleasesView.jsx` | リリース管理（Draft→Production・Rollback） |
| `OcrEvaluationView.jsx` | OCRモデル評価 |
| `InferenceView.jsx` | 単一推論 |
| `RapidOCRView.jsx` | OCR修正（キーボード中心） |
| `OcrBatchView.jsx` | バッチ推論 |
| `JobsView.jsx` | ジョブ管理 |
| `BenchmarkView.jsx` | Benchmark Runner（実行して比較。旧称「Benchmark」） |
| `BenchmarkCenterView.jsx` | Benchmark Center（既存結果を横断比較・実行なし） |
| `ReportsView.jsx` | レポート生成 |
| `AuditView.jsx` | 監査ログ |
| `OperationsView.jsx` | システム状態（ヘルスチェック・バックアップ） |
| `EvaluationView.jsx` | 分類モデル評価（実験機能） |

## 主要な共通コンポーネント（components/、20種）

| ファイル | 役割 |
|---|---|
| `Sidebar.jsx` / `Header.jsx` / `WorkflowProgress.jsx` | ナビゲーション・ヘッダー・工程表示 |
| `Button.jsx` / `Card.jsx` | 基本UI（variant定義） |
| `EmptyState.jsx` | データなし表示の共通形式（アイコン＋タイトル＋説明＋導線） |
| `ViewErrorBoundary.jsx` | 画面単位のエラー境界 |
| `SetupWizard.jsx` | 初回セットアップウィザード（モーダル） |
| `ProjectCreateModal.jsx` | 新規プロジェクト作成（テンプレート選択） |
| `PreprocessPanel.jsx` | 前処理パラメータパネル（アコーディオン） |
| `AugmentationSettingsPanel.jsx` | オーグメンテーション設定パネル |
| `ManualMaskEditor.jsx` | 手動マスク編集（座標正規化） |
| `CharHeatmap.jsx` / `EditableHeatmap.jsx` | 文字別確信度ヒートマップ（閲覧用/編集用） |
| `ModelIdBadge.jsx` | 管理No（M0001等）の共通表示バッジ |
| `InfoTooltip.jsx` | 用語説明ツールチップ（「?」アイコン） |
| `ImagePreview.jsx` / `ResultBadge.jsx` / `LowercaseToggle.jsx` / `ExperimentalNotice.jsx` | 補助表示 |

## lib/（フロント共通ロジック、53種の一部を抜粋）

| ファイル | 役割 |
|---|---|
| `api.js` | `API_BASE`・`request()`・画像URLヘルパー |
| `candidateDictionary.js` | 候補辞書の解析・重み付き編集距離・近似検索（純関数） |
| `labelNavigation.js` | 「保存して次へ」の次画像決定 |
| `lowercase.js` | 小文字出力設定の言語判定 |
| `paddleocrOfficialTooltip.js` | 公式モデル説明文 |
| `inferenceModel.js` | 推論モデル切替・永続化の純ロジック（`isInferenceModelInUse`等） |
| `datasetSearch.js` | Dataset Manager一覧の検索・絞り込み |
| `experimentAnalysis.js` | 実験管理の相関・ベスト条件・条件推薦 |
| `benchmarkLogic.js` | Benchmark Runnerの集計・Leaderboardロジック |
| `benchmarkCenter.js` | Benchmark Centerの比較・推薦ロジック |
| `releaseLogic.js` / `releaseGate.js` | リリース管理・Release Gate判定の純ロジック |
| `auditDiff.js` | 監査ログBefore/After差分の整形 |
| `modelCompare.js` / `modelEval.js` | モデル比較・評価表示の純ロジック |
| `trainingCompare.js` / `preprocessCompare.js` | 学習条件・前処理比較の純ロジック |

他に `augmentation.js`・`augmentationSettings.js`・`bboxSelection.js`・`confidence.js`・`confusionFormat.js`・`dashboardProjectList.js`・`detectModel.js`・`evalHistory.js`・`evalOcrRun.js`・`evalOcrSettings.js`・`evalPreprocess.js`・`evaluationBuilder.js`・`helpTexts.js`・`labelAlign.js`・`ocrCandidates.js`・`ocrDatasetStatus.js`・`preprocessConfigStatus.js`・`preprocessRequest.js`・`preprocessSchema.js`・`preprocessUiState.js`・`previewCache.js`・`ratio.js`・`setupWizard.js`・`tooltipPosition.js`・`trainingLog.js`・`trainingSettingsDraft.js`・`trainingSettingsTabs.js`・`viewKey.js` 等が存在する。
