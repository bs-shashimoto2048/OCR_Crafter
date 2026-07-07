# 14_RELEASE_CHECKLIST

リリース前に必ず確認する項目。コマンドはリポジトリルート・Windows PowerShell 前提
（バックエンド確認は `.\.venv\Scripts\python.exe`、APIは `http://127.0.0.1:8000`）。

## ビルド・テスト

- [ ] **backend import**: `.\.venv\Scripts\python.exe -c "import src.app.main"` が成功する
- [ ] **frontend build**: `cd frontend; npm run build` が成功する
- [ ] **pytest**: `.\.venv\Scripts\python.exe -m pytest tests` が全件PASS
  - [ ] delete_model安全テスト（`tests/test_delete_model_safety.py`）: 空パス/`.`/CWD/プロジェクトルート拒否、models配下のみ削除可、破損`.tess.json`はメタのみ削除
  - [ ] output_dir安全テスト（`tests/test_output_dir_safety.py`）: 空/`.`/許可外拒否、outputs配下のみ削除可
  - [ ] charset仕様テスト（`tests/test_tesseract_charset.py`）: `CHYBkt`非改変・サンプル除外・case-sensitive
  - [ ] 軽量E2E（`tests/test_tesseract_e2e.py`）: Tesseract導入環境で skip されず PASS

## アプリ起動

- [ ] `uvicorn src.app.main:app --reload --port 8000` が起動し `GET /health` が `{"status":"ok"}`
- [ ] `cd frontend; npm run dev` でUIが表示される（`VITE_API_BASE` 設定済み）

## 推論（3エンジン）

- [ ] **PaddleOCR**: 推論画面で engine=PaddleOCR / latest で推論できる（学習済みが無い場合は公式モデルへフォールバック）
- [ ] **EasyOCR**: engine=EasyOCR で推論できる
- [ ] **Tesseract**: engine=Tesseract / `eng.traineddata`（標準英語モデル）で推論できる。未導入環境では導入案内つきエラー（クラッシュしない）

## Tesseract 学習〜運用（docs/11_TESSERACT_CHECKLIST.md 詳細版に準拠）

- [ ] **学習**: OCRデータ作成（charset=`A-Z0-9klt` / text_case=keep）→ 学習開始 → completed
- [ ] **モデル一覧**: モデル管理画面に `.tess.json` が表示される（traineddataパス・charset・学習条件）
- [ ] **モデル評価**: eng vs 学習後モデルの比較が動作し、comparison（増減・改善率）が出る
- [ ] **バッチ推論**: engine=Tesseract でフォルダ一括推論、結果CSV出力に engine/model が入る、大小文字保持
- [ ] **RapidOCR**: engine=Tesseract で推論・修正確定・OCRログ保存ができる
- [ ] **モデル削除**: `.tess.json` とモデルディレクトリが削除され、models ルートは無傷

## リポジトリ健全性

- [ ] `git status --short` がクリーン（意図しない未コミットが無い）
- [ ] **`data/` / `models/` / `outputs/` / `.venv/` / `frontend/node_modules/` がGit管理対象外**:
  `git ls-files data models outputs .venv frontend/node_modules` の出力が空であること
- [ ] `git ls-files --ignored --exclude-standard -c` の出力が空（追跡中の除外対象ファイルが無い）
- [ ] CI（GitHub Actions）が main で成功している

## リリース作業

- [ ] `CHANGELOG.md` にバージョンと日付を記入
- [ ] タグ付与: `git tag v1.0.0 && git push origin v1.0.0`
