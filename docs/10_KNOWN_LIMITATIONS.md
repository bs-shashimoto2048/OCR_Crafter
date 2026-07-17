# 10. 既知の制約・課題

## TODO / FIXME / HACK コメント

- **リポジトリ内に存在しない**（src/, frontend/src/, tests/, config/, docs/ を走査。0件）。
- 将来対応を示す唯一のコメント: `src/app/services/ocr_evaluation.py:72` `# 将来: elif engine == "paddleocr": ...`（OCRモデル評価のPaddleOCR対応は未実装）。

## 未実装・機能面の制約（コード上の事実）

| 項目 | 内容 | 根拠 |
|---|---|---|
| OCRモデル評価はTesseract専用 | `build_recognizer` が tesseract 以外を `ValueError` で拒否 | `services/ocr_evaluation.py` |
| OCR学習APIはPaddleOCRのみ | `POST /api/ocr/train/start` は engine=paddleocr のみ許可（Tesseractは別エンドポイント） | `main.py` |
| PaddleOCRの推論時whitelist不可 | 3.x系APIに実行時whitelistがなく、小文字OFFは出力後の大文字化で実現 | `predict.py`（`_apply_latin_case_to_results` のコメント） |
| Tesseractのwhitelist指定時は信頼度が取得不能 | Tesseract 5.x のLSTMは `tessedit_char_whitelist` 指定時に信頼度を計算せず conf=0 を返す（実測: v5.3.3）。本アプリのTesseract推論は常にwhitelistを使うため Confidence は null（UI表示 `--`）になる | `tesseract_pipeline.py`（`aggregate_word_confidences`）、`docs/15_CHANGELOG_AI.md` |
| 未exportモデルは推論拒否 | `STRICT_OCR_EXPORT_REQUIRED = True` | `predict.py` |
| 認証なし | 全エンドポイント無認証（ローカル実行前提） | `main.py` |
| アップロードサイズ上限なし | `/predict` 等は `await file.read()` のみでサイズ検証なし（一覧APIの `limit<=1000` のみ） | `main.py` |
| 候補辞書はlocalStorage保存 | 数万件規模の辞書には不向き（5MB/256文字の読込上限あり） | `lib/candidateDictionary.js` |
| CI/CD未整備 | `.github/` は空。requirements-ci.txt は存在するがワークフロー定義なし | `.github/` |
| Lint/型チェック未設定 | ruff/eslint/mypy等の設定ファイルなし | リポジトリルート |

## docs/13_QA_STATUS.md（2026-07-07）記載の既知課題

### コード品質（レビュー残指摘）

- `delete_model` のガード: 手編集メタが共有親ディレクトリを指す場合に配下の他モデルも削除しうる余地
- 相対パスメタが CWD 基準で resolve され削除スキップになる（fail-safe側の挙動）
- rmtree の封じ込めが3方式併存（`safe_rmtree` / allowed_roots / relative_to）→ 統一が望ましい
- `rmtree(ignore_errors=True)` の部分失敗（Windowsのファイルロック）が非検知でもAPIは成功を返す

### 復旧関連

- 旧cursiveプロジェクトの実画像・学習済みモデル・旧評価出力の消失（未回収）
- 未復元ドキュメントあり（AGENTS.md / PROJECT_OVERVIEW.md 等）
- `requirements.txt` が **UTF-16** で pip から直接利用できない場合がある（UTF-8再保存が推奨として記録）
- `paddleocrOfficialTooltip.js` は原文消失後の再作成版（文言未確認）

### 改善案（未着手として記録されているもの）

- Tesseract学習のlstmf生成が1枚ずつサブプロセス起動で遅い（500枚≈2分、並列化余地）
- 精度改善（lt系サンプル増強、イテレーション増、実画像混入）
- 評価UIでの誤認識パターン集計表示

## 技術的な注意点

| 項目 | 内容 |
|---|---|
| `main.py` / `App.jsx` / `ocr_pipeline.py` の巨大化 | それぞれ約2460行 / 約3300行 / 約1850行の単一ファイル |
| 環境記述の不一致 | Pipfile=Python3.9、usage.md=Python3.11+/macOS、settings.yaml=WindowsのTesseractパス既定 |
| `settings.yaml` の絶対パス | `tesseract.tessdata_dir` に開発機の絶対パスがハードコードされている |
| `readme.md` のリンク | usage.md へのリンクが旧macOS環境の絶対パスになっている |
| Paddleキャッシュ隔離 | `HOME` 等の環境変数をプロセス内で上書きする実装（`services/ocr_pipeline.py`） |
| broad except | `# noqa: BLE001` 付きの広域catchが50箇所以上（意図的な設計） |

## Step5（評価用データ作成）のOCR候補まわり

| 項目 | 内容 |
|---|---|
| OCR自動実行は既定ON（設定で無効化可） | 画像切替・回転・設定変更の連続操作終了後（300msデバウンス）に1回だけ自動実行。キャッシュヒット時はAPIを呼ばない。OFF（旧バージョンで保存済みの設定は尊重）にすると「要再実行」表示＋手動実行のみ |
| OCR結果キャッシュ | サーバー側は処理済み画像sha256+推論設定キーのLRU（プロセス内・最大128件・エラーは対象外）。フロント側は実行条件キーのLRU（セッション内・最大30件）。プロセス/ページ再読込で消える |
| OCR推論はプロセス全体で同時2件 | Step5専用の共有Executor（max_workers=2）で全リクエスト横断の同時推論数を制限。多数の要求が重なった場合は各リクエストがキュー待ちになる（CPU飽和で全体が遅くなるより待ち時間が予測可能な設計。実測: 6同時要求で旧実装は全件20秒超→新実装は1.3〜3.4秒の順次処理） |
| 実行中の推論は中断不可 | クライアント切断は画像デコード前・各スロット実行前に確認し未開始スロットを実行しない（キュー内Futureはキャンセル）。ただし**実行中**の推論だけは完了まで走る（最大2件・後続はキャンセル済みのため影響は1推論分） |
| 先読みはアイドル時のみ | 先読み（次の1画像・最大1件）はフロントで「同じ画像に留まっている・現在OCRが実行中でない・未キャッシュ」を再判定し、サーバー側でも実行中/待機中のOCRがあれば破棄（skipped_busy）。高速に画像を送り続けると先読みは効かず毎回フル実行になる（安定性優先の仕様） |
| Step5サムネイルは5分キャッシュ | evaluation/crop・directory-image は `max-age=300` でブラウザキャッシュされる（rotationがURLに含まれるため安全）。元ファイルを同名のまま差し替えた直後は最大5分古いサムネイルが表示され得る（リロードで解消） |
| 保存時間の実測条件 | 保存API 10〜25ms/次画像表示は即時（ローカルSSD・同一ホスト実測）。ネットワーク越し・低速ディスクでは保存時間が伸びるが、OCRとは資源を共有しないため相対的な詰まりは発生しない |
| プレビュー更新は都度実行 | 中間・最終画像の生成（前処理+base64）はプレビュー要求ごとに実行される（結果キャッシュの対象はOCR推論のみ） |

## セキュリティ関連（実装済みの防御と残余リスク）

- 実装済み: プロジェクトID検証（パストラバーサル拒否）、モデル削除の models 配下限定、OCRデータセット削除の allowed_roots 限定、CORS明示オリジン
- 残余: 認証なし・アップロード上限なし（ローカル前提の設計判断として存在）
