# トラブルシューティング（v1.0.0）

症状別の確認・対処ガイドです。各項目は「症状 / 考えられる原因 / 確認方法 / 対処方法 / 改善しない場合」の順で記載します。
ここにない症状は [FAQ.md](FAQ.md)・[25_DISASTER_RECOVERY.md](25_DISASTER_RECOVERY.md) も確認してください。

## 起動

### Backendが起動しない

- **原因**: 仮想環境未有効化 / 依存不足 / settings.yaml の構文エラー / ポート競合
- **確認**: 起動時のコンソールエラーを読む。`.\.venv\Scripts\python.exe -c "import src.app.main"` でimportエラーを特定
- **対処**: `.\.venv\Scripts\Activate.ps1` → `pip install -r requirements.txt`。settings.yamlをYAML構文チェック（直近の編集差分を確認）
- **改善しない場合**: `git status` で意図しない変更がないか確認し、[UPDATE_GUIDE.md](UPDATE_GUIDE.md) のロールバック手順へ

### Frontendが起動しない / 画面が表示されない

- **原因**: `npm install` 未実施 / Nodeバージョン / ポート競合（5173が使用中だと自動で別ポートへ）
- **確認**: `npm run dev` の出力に表示される実際のURL（`Local: http://localhost:51xx/`）を確認
- **対処**: `cd frontend && npm install`。表示されたURLでアクセス
- **改善しない場合**: `npm run build` でビルドエラーの有無を確認

### API接続エラー（画面は出るがデータが表示されない）

- **原因**: Backend未起動 / `VITE_API_BASE` 不一致 / **CORS許可外のポートでフロントを開いている**
- **確認**: `curl http://127.0.0.1:8000/health`。ブラウザ開発者ツールのコンソールにCORSエラーが出ていないか
- **対処**: Backendを起動。Viteが5173以外のポートで起動した場合は `config/settings.yaml` の `cors.allowed_origins` へそのオリジンを追加（または環境変数 `CORS_ALLOWED_ORIGINS`）
- **改善しない場合**: `frontend/.env` の `VITE_API_BASE` がBackendのURLと一致しているか確認

### ポート競合

- **確認**: `netstat -ano | findstr :8000`
- **対処**: `uvicorn ... --port 8001` のように変更（フロント側の `VITE_API_BASE` も合わせる）

### settings.yamlエラー

- **症状**: 起動失敗、または `GET /health/ready` の settings チェックがfalse
- **対処**: インデント・コロン等のYAML構文を確認。判断に迷う場合は `config/settings.production.example.yaml` と比較

## OCRエンジン

### Tesseractが見つからない

- **確認**: `GET /health/details` の tesseract 項目 / 「運用 > システム状態」
- **対処**: Tesseractをインストールし、`config/settings.yaml` の `tesseract.tesseract_cmd` へ実行ファイルパスを設定（PATH解決も可。既定: `C:\Program Files\Tesseract-OCR\`）
- **補足**: 学習には学習ツール入りビルド（lstmtraining同梱）が必要（[INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md#6-tesseract学習環境学習を行う場合)）

### PaddleOCRが利用できない

- **確認**: `GET /health/details` の paddleocr（import可否）/ 学習は `external/PaddleOCR` の有無
- **対処**: `pip install -r requirements.txt` を再実行。学習には `PADDLEOCR_PATH` または `settings.yaml` の `ocr_training.paddleocr_repo_dir` でリポジトリを指定
- **補足**: PaddleOCR推論はexport済みモデルのみ使用可能（未exportはエラー。一括変換: `POST /api/ocr/models/export-migrate`）

### OCR結果が空になる

- **原因**: 前処理が強すぎて文字が消えている / Whitelistが対象文字と不一致 / PSM不適合
- **確認**: 「前処理設定」のプレビューで処理後画像を目視。推論画面でWhitelist「なし」を試す
- **対処**: 二値化しきい値・照明ムラ補正を調整。単一行文字列はPSM 7を使用
- **改善しない場合**: Benchmarkで複数エンジンを同一条件比較し、エンジン起因かデータ起因かを切り分け

### 文字化け・日本語が認識されない

- **原因**: 正解CSV・ラベルの文字コード / エンジンの言語設定
- **確認**: CSV・ラベルがUTF-8か。EasyOCRの言語設定（`easyocr_langs`）
- **対処**: UTF-8で保存し直す。日本語認識はPaddleOCR/EasyOCRの日本語対応設定を使用（Tesseractの既定charsetは英数字向け `A-Z0-9klt`）

### GPUが利用されない

- **確認**: `GET /api/system/check`（torch CUDA可否・Paddle GPU可否・GPU名）
- **対処**: CUDA対応版のPyTorch/PaddlePaddleが入っているか確認。学習の `device` を `auto` または `gpu` に
- **補足**: GPUがなくても全機能はCPUで動作します（[INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md#4-cpu環境gpuなしでの利用範囲)）

## 学習

### 学習が開始しない / JobがQueuedのまま

- **原因**: Worker未稼働 / 同一プロジェクトで別のOCR学習が実行中（409）
- **確認**: 「運用 > ジョブ管理」ヘッダのWorker表示・実行中Jobの有無
- **対処**: WorkerはJob作成時に自動起動します。動かない場合はBackendを再起動（queuedは自動再開）
- **改善しない場合**: `data/jobs/logs/JOB-xxxxxx.log` を確認

### Workerが停止と表示される

- **対処**: 異常ではありません（Job作成時に自動起動）。Jobを作成しても動かない場合のみBackend再起動

### 学習がFailedになる

- **確認**: ジョブ管理のエラー要約 → 学習ログ（学習画面のログ表示 / `GET /api/ocr/train/log/{job_id}`）
- **対処**: エラー内容別に対処（下記のメモリ不足・CUDAエラー・ツール未導入など）。パラメータを既定値に戻して再現確認
- **改善しない場合**: Job IDとログを添えて開発担当へ連絡

### 学習がInterrupted（中断（再起動））になる

- **原因**: 学習中にBackendが再起動された（仕様どおりの動作です）
- **対処**: ジョブ管理から「再実行」

### メモリ不足 / CUDAエラー

- **症状**: OOMエラー・CUDA out of memory
- **対処**: PaddleOCR学習はOOM時にバッチ半減で1回自動リトライします。それでも失敗する場合はバッチサイズ・ワーカー数を下げる（`Mac Safe` プリセット=cpu/workers 0が最も安全）
- **改善しない場合**: `device=cpu` で学習し、GPUドライバ・CUDAバージョンを確認

### データがサンプル除外される（charset外文字・ラベル件数不足）

- **症状**: OCRデータ作成の skipped が多い・学習データが少ない
- **原因**: charset外の文字を含むラベルは**サンプルごと除外**されます（文字削除はしない仕様）。type不一致・元画像欠落も除外要因
- **確認**: データ作成結果の skipped 内訳（`type` / `invalid_label` / `missing_source`）
- **対処**: charsetへ必要文字を追加するか、ラベル表記を見直す。ラベル未入力の画像はラベル編集で補完

## 評価

### 評価結果が表示されない

- **確認**: 正解CSVの形式（`filename,text`）とパス、画像フォルダ内ファイル名との一致（「画像未検出 N件」表示）
- **対処**: [USER_GUIDE.md](USER_GUIDE.md#10-モデル評価) のエラー案内表に従う

### Evaluation Hashが異なる / 比較不能と表示される

- **原因**: 評価条件（データセット・前処理・Whitelist・PSM等）が異なる評価同士はCERを直接比較できません（仕様）
- **対処**: 同一条件で再評価する（モデルカルテの評価履歴から条件を確認して揃える）。旧評価（Validation導入前）はProfileがないため再評価でHashが付与されます

### CERが高い / 完全一致率が低い

- **確認**: 誤認識一覧・混同TOPで「どの文字がどう間違うか」を確認。評価はcase-sensitive（`KT`≠`kt`）である点に注意
- **対処**: 混同の多い文字を含むデータを増やして再学習 / 前処理調整 / Whitelist設定を実運用に合わせる

### 評価データセットが選択できない

- **確認**: 「データ準備 > 評価データ > データセット作成」で作成済みか
- **対処**: 未作成なら作成する。プロジェクトを切り替えた直後は再読込

## PDF・レポート

### PDFが生成されない / Report Jobが失敗する

- **確認**: 「運用 > ジョブ管理」の該当Job（種別: レポート生成）のエラー要約 → `data/jobs/logs/JOB-xxxxxx.log`
- **対処**: 対象モデルが存在するか・形式選択（Markdown/PDF）を確認して再生成

### PDFの日本語が文字化けする / フォントが見つからない

- **原因**: PDFは日本語フォント（Yu Gothic等のWindows標準フォント）を自動検出して埋め込みます。フォントが見つからない環境では文字化けし得ます
- **確認**: Windows標準構成では通常発生しません。非Windows環境や最小構成OSの場合はフォント有無を確認
- **対処**: 日本語フォントをOSへ導入。Markdown版は環境に依存しないため、代替としてMarkdownをダウンロード

### レポートをダウンロードできない

- **確認**: レポートの状態が完了か（生成中はダウンロード不可）。ブラウザのダウンロードブロック
- **対処**: Job完了後に再試行。ファイル実体は `data/reports/<project_id>/` にあります

### 保存先を開けない

- **対処**: エクスプローラーで `data/reports/<project_id>/` を直接開く（アプリからフォルダを開く機能はありません）

## バックアップ

### バックアップが失敗する / ディスク容量不足

- **確認**: `/health/details` のディスク空き。fullバックアップはプロジェクトと同等の容量が必要
- **対処**: 不要データ整理（データ保持設定の適用・outputs整理）後に再実行

### SHA-256不一致（verify失敗）

- **対処**: そのZIPからの復元は中止し、別世代を検証。保存先ストレージの健全性を確認（[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md#7-失敗時の対応)）

### 復元できない

- **原因**: 検証エラー（復元前SHA-256チェック）/ 指定IDが既存プロジェクトと衝突
- **対処**: 新Project ID自動採番（既定）で復元。エラーコード BACKUP_VALIDATION_FAILED の場合は別世代を使用

## ブラウザ

### セットアップウィザードが毎回表示される

- **原因**: 完了フラグがlocalStorageに保存されていない（途中で×中断した場合は仕様どおり再表示）／プライベートブラウズやlocalStorage無効環境
- **対処**: ウィザードを最後まで完了する。ブラウザのサイトデータ削除設定を確認

### テンプレート情報が「記録なし」になる

- **原因**: テンプレート記録はブラウザ（localStorage）単位のため、**別ブラウザ・別PCでは表示されません**。テンプレート導入前の既存プロジェクトも「記録なし」です（仕様）

### localStorageが消えた / 別ブラウザで設定が共有されない

- **説明**: 前処理UI設定・候補辞書・テンプレート記録・ウィザード完了状態などはブラウザ保存です（一覧: [08_CONFIGURATION.md](08_CONFIGURATION.md)）。ブラウザのデータ削除で消えます。**サーバー側データ（画像・ラベル・モデル・実験記録）は影響を受けません**
- **対処**: 前処理の実行済み設定はプロジェクト側にも保存されるため（`preprocess_config.json`・スナップショット）、再実行時は前回実行条件が使われます。UI設定は再設定してください

---

改善しない場合は、Job ID・エラーメッセージ・`data/jobs/logs/` の該当ログを添えて管理者または開発担当へ連絡してください。
