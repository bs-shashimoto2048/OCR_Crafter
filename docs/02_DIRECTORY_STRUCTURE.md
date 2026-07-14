# 02. ディレクトリ構成

## ツリー（追跡対象 + 主要な生成物）

```text
ocr_crafter/
├── config/
│   └── settings.yaml            # 全設定（前処理・学習・Tesseract・CORS等）
├── src/
│   └── app/
│       ├── main.py              # FastAPI本体（全55エンドポイント、約2460行）
│       ├── schemas.py           # Pydanticリクエストスキーマ
│       ├── config.py            # settings.yaml 読込（lru_cache）
│       ├── paths.py             # リポジトリパス定数
│       ├── project_paths.py     # プロジェクトdir構造・安全削除・ID検証
│       ├── db.py                # SQLite（training_jobsテーブル）
│       ├── train.py             # 分類モデル学習（CLIあり）
│       ├── predict.py           # 4エンジン推論（CLIあり）
│       ├── job_runner.py        # 学習ワーカー起動（CLIあり）
│       ├── init_dirs.py         # ディレクトリ初期化（CLIあり）
│       ├── ocr_tuning.py        # OCR学習データ出力CLIラッパー
│       ├── migrate_legacy_data.py   # 旧データ移行CLI
│       ├── migrate_ocr_models.py    # OCRモデルinference変換CLI
│       └── services/
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
│           ├── ocr_pipeline.py          # PaddleOCR学習・登録・ログ・検証（約1850行）
│           ├── tesseract_pipeline.py    # Tesseract学習・認識
│           ├── ocr_tuning.py            # EasyOCR/PaddleOCR学習データ出力
│           ├── ocr_evaluation.py        # OCRモデル評価（Tesseract）
│           ├── evaluation.py            # 分類モデル評価
│           ├── latin_case.py            # 小文字出力制御の共通判定
│           └── dialogs.py               # ネイティブのファイル/フォルダ選択
├── frontend/
│   ├── index.html               # エントリHTML（lang="ja"）
│   ├── vite.config.js           # Vite設定（port 5173、プロキシなし）
│   ├── tailwind.config.js       # ダークテーマカラー定義
│   ├── postcss.config.js
│   ├── package.json             # scripts: dev/build/preview/test
│   ├── src/
│   │   ├── main.jsx             # Reactエントリ（StrictMode）
│   │   ├── App.jsx              # 全状態管理・view切替（約3300行）
│   │   ├── index.css            # Tailwind + カスタムクラス
│   │   ├── views/               # 12画面（下表）
│   │   ├── components/          # 共通UI 14種
│   │   └── lib/                 # api.js / candidateDictionary.js 等 5種
│   └── tests/                   # node:test（2ファイル）
├── tests/                       # pytest（10ファイル + conftest.py）
├── docs/                        # ドキュメント
├── data/projects/<project_id>/  # ※gitignore。プロジェクトデータ（下記）
├── models/                      # ※gitignore。tessdata_best / yolo 等
├── outputs/                     # ※gitignore。app.db（SQLite）等
├── external/                    # ※gitignore。PaddleOCRリポジトリ
├── requirements.txt             # 全量スナップショット（UTF-16）
├── requirements-ci.txt          # CI最小依存
├── requirements-dev.txt         # pytest
├── requirements-ocr-tuning.txt  # OCRチューニング任意依存
├── Pipfile                      # pipenv定義（python 3.9）
├── readme.md                    # セットアップ・API概要
├── CHANGELOG.md                 # v1.0.0（未リリース）変更履歴
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
| `models/` | 学習済みモデル（`*.pt` / `*.ocr.json` / `*.tess.json` / `ocr_runs/<job_id>/`） |
| `logs/` | 学習ログ |
| `outputs/` | 評価・プレビュー・OCRログ（`ocr_logs/predictions.jsonl`）・OCRデータセット等 |

## フロントエンド画面（views/）

| ファイル | 画面 |
|---|---|
| `DashboardView.jsx` | ダッシュボード（プロジェクト管理・進捗） |
| `ImagesView.jsx` | 画像取り込み・一覧（仮想スクロール・回転） |
| `PreprocessView.jsx` | 前処理設定・プレビュー・手動マスク・比較スロット |
| `LabelingView.jsx` | ラベル編集（OCR候補・辞書近似候補） |
| `TrainingView.jsx` | 学習（OCR/分類/Tesseract共通） |
| `ModelsView.jsx` | モデル管理 |
| `InferenceView.jsx` | 単一推論 |
| `RapidOCRView.jsx` | OCR修正（キーボード中心） |
| `OcrBatchView.jsx` | バッチ推論 |
| `OcrEvaluationView.jsx` | OCRモデル評価 |
| `EvaluationView.jsx` | 分類モデル評価（実験機能） |
| `TrainingImageBuilderView.jsx` | 学習画像作成 Step1〜4（YOLO） |

## 主要な共通コンポーネント（components/）

| ファイル | 役割 |
|---|---|
| `Sidebar.jsx` / `Header.jsx` / `WorkflowProgress.jsx` | ナビゲーション・ヘッダー・工程表示 |
| `Button.jsx` / `Card.jsx` | 基本UI（variant定義） |
| `PreprocessPanel.jsx` | 前処理パラメータパネル（アコーディオン） |
| `ManualMaskEditor.jsx` | 手動マスク編集（座標正規化） |
| `CharHeatmap.jsx` / `EditableHeatmap.jsx` | 文字別確信度ヒートマップ（閲覧用/編集用） |
| `ImagePreview.jsx` / `ResultBadge.jsx` / `LowercaseToggle.jsx` / `ExperimentalNotice.jsx` | 補助表示 |

## lib/（フロント共通ロジック）

| ファイル | 役割 |
|---|---|
| `api.js` | `API_BASE`・`request()`・画像URLヘルパー |
| `candidateDictionary.js` | 候補辞書の解析・重み付き編集距離・近似検索（純関数） |
| `labelNavigation.js` | 「保存して次へ」の次画像決定 |
| `lowercase.js` | 小文字出力設定の言語判定 |
| `paddleocrOfficialTooltip.js` | 公式モデル説明文 |
