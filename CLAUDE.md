# CLAUDE.md — OCR Crafter（Claude Code 用ガイド）

## プロジェクト概要

ローカル完結のOCR学習環境。画像取込→前処理→ラベル付け→データセット作成→学習（PaddleOCR/Tesseract/分類）→評価→推論・修正 を1つのUIで行う。

- バックエンド: FastAPI（`src/app/main.py`、port 8000、全55エンドポイント）
- フロントエンド: React 18 + Vite 5 + Tailwind（`frontend/`、port 5173、状態管理はReact標準hooksのみ）
- データ: `data/projects/<project_id>/` にプロジェクト単位で分離（gitignore対象）

## ディレクトリ構成

```text
src/app/            FastAPI本体（main.py）+ CLI（train/predict/job_runner等）
src/app/services/   前処理・OCRパイプライン・モデル管理・評価
frontend/src/       App.jsx（全状態集約）+ views/ + components/ + lib/
config/settings.yaml 全設定（前処理パイプライン・学習・Tesseract・CORS）
tests/              pytest（temp_projectsフィクスチャで実データ隔離）
frontend/tests/     node:test（lib/の純関数）
docs/               ドキュメント（00〜14）
```

詳細: `docs/02_DIRECTORY_STRUCTURE.md` / API一覧: `docs/06_API_REFERENCE.md`

## ビルド・テスト・実行

```bash
# 実行
uvicorn src.app.main:app --reload --port 8000
cd frontend && npm run dev

# ビルド（フロントのみ。バックエンドにビルド工程なし）
cd frontend && npm run build

# テスト
python -m pytest -q            # バックエンド（.venv使用）
cd frontend && npm test        # フロント（node --test、依存追加不要）
```

## コーディングルール

- コメント・docstring・UIテキスト・PR説明は**日本語**。コミットは `<type>: <英語要約>` + 日本語本文（type: feat/fix/ui/refactor）。
- エンドポイントは `main.py`、ロジックは `services/`、スキーマは `schemas.py`。例外変換は `FileNotFoundError→404` / `ValueError→400`。
- 前処理工程の追加は「`_op_*` 関数 + `OPERATIONS` 登録 + `settings.yaml pipelines` 挿入」の3点セット。
- フロントの純粋ロジックは `frontend/src/lib/` に切り出し node:test を書く。localStorage キーは `ocr_<用途>_v1`（プロジェクト別は `_by_project_` + 共通ヘルパー）。
- 新規依存パッケージの追加は原則しない（必要なら理由を先に説明）。TypeScript・状態管理ライブラリは不使用。
- 新設定は「未設定=従来動作」となるデフォルトを必ず持たせる。

## 編集禁止・要注意箇所

| 対象 | ルール |
|---|---|
| `data/projects/` 実データ | テストは必ず `temp_projects` フィクスチャで隔離。`master.csv` はユーザーが手動編集することがある——勝手に書き換えない |
| 元画像（`raw/`） | 前処理・マスクは元画像を変更しない設計（回転APIのみ例外） |
| `.git` | **`git gc` / `git prune` 禁止**（dangling blob を復旧用に意図的保持） |
| 削除系の安全ガード | `safe_rmtree` / models配下検証を弱めない（過去にCWD誤削除の重大バグ。`CHANGELOG.md` 参照） |
| `external/` `models/` `outputs/` | 大容量資産。削除・再生成しない |
| `requirements.txt` | UTF-16エンコード（既知課題）。PowerShellでの一括ファイル編集は文字化けの原因になるため、ファイル編集は専用ツールで行う |

## 推奨ワークフロー

1. `task.md`（gitignore対象）でタスクを受領 → 実装 → `npm run build` + `pytest` + `npm test` で検証
2. 実画像確認が必要な機能は `data/projects/` の既存プロジェクト（読み取りのみ）で確認
3. 日本語コミット本文で変更点を列挙し、`main` へ push（リモート: GitHub）
4. 完了報告はタスク指示の報告項目に沿って日本語で行う

## 重要な設計思想

- **プロジェクト分離**: 全データ・設定はproject_id単位。プロジェクト切替時のレスポンス競合ガード（リクエスト連番・IDタグ）を崩さない。
- **charset仕様**（`docs/12_TESSERACT_CHARSET_SPEC.md`）: 学習対象文字 `A-Z0-9klt` / 推論whitelist / 評価whitelist は別概念。評価はcase-sensitive完全一致。GTを勝手に大文字化しない。
- **既存動作を壊さない**: 後方互換デフォルト（例: `include_lowercase` 未指定=true、旧設定はON扱い）。
- **補助機能の分離**: 手動マスク・候補辞書はOCRエンジンの学習・推論内部へ注入しない（推論後の補助）。
- **OCR前処理とYOLO検出前処理は別モジュール**（`preprocess.py` / `detection_preprocess.py`）。

## よく使うコマンド

```bash
python -m pytest -q                                  # 全テスト
python -m pytest tests/test_manual_mask.py -q        # 単一ファイル
cd frontend && npm run build && npm test             # フロント検証
python -m src.app.predict <image> --project-id <id> --engine paddleocr --easyocr-langs en
python -m src.app.ocr_tuning --project-id <id> --engine both --image-types wide
```

## 環境メモ

- Windows 11 / PowerShell。venvは `.venv\Scripts\python.exe`（pytest は `.venv` 経由で実行）
- Tesseract: `C:\Program Files\Tesseract-OCR\`（`config/settings.yaml` で変更可）
- CI/CD・Docker・Lint設定は未整備（`.github/` は空）

## 絶対に変更してはいけない仕様

各仕様の背景・経緯は `docs/15_CHANGELOG_AI.md` を参照。

### 学習画像

- 学習画像は必ず**元画像から切り出す**こと（BBoxは `invert_detection_bbox` で元画像座標へ逆変換）
- 検出前処理画像を学習画像として保存しないこと
- 検出前処理は**検出専用**（YOLO推論の入力にのみ使う）

### OCR

- **OCR前処理**（`services/preprocess.py`）と **YOLO検出前処理**（`services/detection_preprocess.py`）は完全に独立させること
- 設定・保存（localStorageキー含む）・処理系を共有しないこと

### Bounding Box（学習画像作成 Step3）

- Step3は**編集画面**である
- 移動・サイズ変更・新規追加・削除は**編集モードON時のみ**許可する
- 有効/無効の切替は**一覧右端のチェックボックスのみ**。画像クリックで変更しない

### プロジェクト互換性

- 既存プロジェクトを壊さないこと。以下は後方互換を維持する:
  - `config/settings.yaml`（キー追加はよいが既存キーの意味を変えない）
  - API（既存パラメータの既定値・挙動を変えない。追加パラメータは「未指定=従来動作」）
  - localStorage（既存キーの形式変更禁止。変更が必要なら新キー `_v2` 等）
  - プロジェクト構成（`data/projects/<id>/` のサブディレクトリ・ファイル形式）
  - 出力形式（master.csv・モデルメタ・CSVエクスポート等）
- 互換性を壊す変更は禁止。必要なら移行処理を書くこと（例: `db.py` の `ALTER TABLE ADD COLUMN`、`migrate_legacy_data.py` の方式）

### UI

- 現在の**ダークテーマ**（`tailwind.config.js` のカスタムカラー）を維持すること
- 以下を既存コンポーネントに合わせて統一すること:
  - ボタン高さ（`Button.jsx` の size 定義）
  - カードデザイン（`Card.jsx` / `.surface-card`）
  - 余白・アイコンサイズ・色使い（accent=青 / success=緑 / danger=赤）
- 勝手に別デザインへ変更しない

### AI実装ルール

- 必ず**既存コードを調査してから**修正すること
- 推測でAPIやDB（`training_jobs` テーブル・ファイル形式）を書き換えない
- 既存の処理を理解した上で修正する
- 大規模な変更では、既存コードを流用できる部分を優先する（新規実装より既存パターンの踏襲）

### ドキュメント

新機能追加時は以下も必要に応じて更新すること:

- `docs/00_PROJECT_OVERVIEW.md`
- `docs/06_API_REFERENCE.md`（エンドポイント追加時）
- `docs/08_CONFIGURATION.md`（設定・localStorageキー追加時）
- `docs/15_CHANGELOG_AI.md`（仕様の理由を残す）

## 実装後の義務

実装内容に応じて、対応するドキュメントを**同じ変更の中で**更新すること:

| 変更内容 | 更新するドキュメント |
|---|---|
| UI変更時 | `docs/16_SCREEN_SPEC.md` |
| データ構造変更時 | `docs/17_DATAFLOW.md` |
| 設定追加時 | `docs/08_CONFIGURATION.md` |
| API追加時 | `docs/06_API_REFERENCE.md` |
| 画面追加時 | `docs/00_PROJECT_OVERVIEW.md` の画面一覧（+ `16_SCREEN_SPEC.md` に画面仕様を追加） |
| 仕様変更時 | `docs/15_CHANGELOG_AI.md`（なぜその仕様にしたかを記録） |
