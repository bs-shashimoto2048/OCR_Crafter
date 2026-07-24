# Changelog

## [v1.0.0] - 未リリース

### Added（Tesseract統合）

- **Tesseract学習対応**: 公式 `eng.traineddata`（tessdata_best）ベースのLSTM fine-tune。
  データセット作成（新規/OCRログ由来）→ lstmf生成（WordStr box自動生成・LF固定）→
  学習 → `.traineddata`/`.tess.json` の自動登録まで一気通貫（`POST /api/tesseract/train/start`）
- **Tesseract推論対応**: `POST /predict` の engine に `tesseract` を追加。
  標準英語モデル `eng.traineddata`（ベースライン）と学習済みモデルを選択可能。
  前処理プレビュー・推論画面にも対応。未導入環境では導入案内つきエラー
- **Tesseractモデル評価**: `POST /api/ocr/evaluate` と「モデル評価」画面。
  学習前（eng）と学習後モデルを同一前処理入力で比較し、認識率・増減・改善率・
  誤認識一覧・CSV出力に対応。評価時whitelistは実運用/なし/カスタムを切替可能
- **モデル管理対応**: `.tess.json` の一覧表示（traineddataパス・charset・学習条件）、
  削除、`.traineddata` ダウンロード。最新モデルは PaddleOCR / Tesseract を並記
- **バッチ推論対応**: engine に Tesseract を追加。モデル選択
  （最新/eng.traineddata/学習済み一覧）、結果の大小文字保持、
  結果CSV出力（engine/model記録）
- **RapidOCR（OCR修正）対応**: engine に Tesseract を追加、修正確定ログの保存

### Changed

- **charset仕様を `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt` に確定**
  （旧「a-z whitelist / 英小文字のみ」前提を廃止）:
  - 学習対象文字セット / 推論時whitelist / 評価時whitelist を別概念として分離
  - 学習データは `text_case=keep`（`CHYBkt` を無改変で学習）
  - charset外文字を含むラベルは「文字削除」ではなくサンプル除外＋skipped集計
  - 評価比較は case-sensitive の完全一致（`KT` ≠ `kt`）
  - 詳細: `docs/12_TESSERACT_CHARSET_SPEC.md`
- **Tesseract既定charsetへ記号 `+` `-` を追加**: `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt` →
  `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-`（学習対象文字セット/推論時whitelist/評価時whitelistの
  既定値・設定ファイルの既定値・フロントエンドの新規作成時既定値が対象。**既存プロジェクトの保存済み
  charset/whitelistは自動変更しない**。詳細: `docs/12_TESSERACT_CHARSET_SPEC.md`）
- **学習画面「次回学習の設定」を4タブ→3タブへ統合**: 「学習パラメータ」「データ分割」を「学習設定」へ
  統合（学習パラメータが先・データ分割が後の順で1タブ内に表示）。localStorageキー
  `ocr_training_settings_tab_v1` は維持し、旧タブID（`data-split`/`training-params`）は新ID
  `training-settings` へ安全に移行する
- **共通ツールチップ（InfoTooltip）の表示位置を上部優先へ変更**: 既定で対象要素の上部中央へ表示し、
  上端に十分な空間が無い場合のみ下側へフォールバック（画面端は左右クランプ・Escで閉じる・
  キーボードfocus対応）

### Fixed / Security

- **delete_model安全修正**: モデルメタの空パスが `Path('.')`=CWD に化けて
  プロジェクト全体を再帰削除しうる重大バグを修正。削除対象を `models` 配下に限定
  （resolve後に包含検証、CWD/ルート/親/空パスを拒否、削除前ログ出力）。
  破損メタはメタのみ削除、関連パス欠落メタは削除中止。
  一括削除は `Promise.allSettled` 化（1件失敗でも継続・成功/失敗の内訳表示）
- **output_dir安全修正**: APIユーザー入力の `output_dir` + `overwrite=true` による
  無検証 `rmtree`（データセット作成×2・OCRチューニングexport）を共有ガード
  `safe_rmtree` で封じ込め（許可ルート=プロジェクトのoutputs配下のみ）。
  job id 空文字による runs ルート削除の構造穴も封鎖
- Tesseract学習の不具合修正: `.box` 未生成で lstmf 生成が失敗する問題、
  CRLF改行で lstmtraining が失敗する問題、学習済みモデルのTSV出力が
  `configs/tsv` に依存して評価が空になる問題

### Tests / Infra

- **回帰テスト追加**（pytest・一時ディレクトリのみ使用）:
  delete_model安全 / output_dir安全（safe_rmtree）/ charset仕様
- **軽量E2Eテスト追加**: データセット作成→小規模学習→モデル一覧→評価→削除
  （Tesseract未導入環境では自動skip）
- **GitHub Actions CI追加**: backend import / pytest / frontend build
- **.gitignore整備**: data・models・outputs・.venv・node_modules・復旧退避物などを
  管理対象外に（`yolo11n.pt` は追跡解除）
- リリース前チェックリスト（`docs/RELEASE_CHECKLIST.md`）、
  QAステータス・既知課題一覧（`docs/13_QA_STATUS.md`）を追加
