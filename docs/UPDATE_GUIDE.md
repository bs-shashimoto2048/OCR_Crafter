# 更新ガイド（v1.0.0）

OCR Crafter本体を新しいバージョンへ更新する手順です。自動更新機能はありません（手動更新のみ）。

## 1. 更新前

1. **バックアップ取得**: 全運用プロジェクトの `full` バックアップを作成し、`GET /api/backups/{BK-ID}/verify` で `valid: true` を確認（[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)）
2. **現在バージョン確認**: `src/app/version.py` の `APP_VERSION`（バックアップmanifestにも記録されています）。現在のコミット: `git rev-parse HEAD` を控える
3. **リリースノート確認**: `CHANGELOG.md` と対象コミットの内容を確認。互換性に関わる変更（設定キー・データ形式）の有無を確認
4. **実行中Jobの確認**: 「運用 > ジョブ管理」で実行中Jobがないことを確認（あれば完了を待つかキャンセル）

## 2. 更新手順

```powershell
# 1) アプリ停止（uvicorn / npm を Ctrl+C。サービス化している場合はサービス停止）

# 2) コード更新
git fetch origin
git checkout <対象タグまたはコミット>    # 例: git pull origin main

# 3) 依存関係更新（requirements.txt / package.json が変わった場合）
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd frontend; npm install; cd ..

# 4) 設定差分確認
#    config/settings.yaml に新キーが追加されていないか確認（新設定は「未設定=従来動作」が原則。
#    settings.production.example.yaml との差分を見る）

# 5) 起動
uvicorn src.app.main:app --port 8000
cd frontend; npm run dev
```

## 3. 更新後の確認

| 確認 | 期待結果 |
|---|---|
| ヘルスチェック | `GET /health` = ok / `GET /health/details` = ok |
| Job復旧 | 「運用 > ジョブ管理」で更新前に実行中だったJobが「中断（再起動）」→ 再実行で復旧 |
| 既存プロジェクト | ダッシュボードで各プロジェクトが開け、画像・ラベル・モデル一覧が表示される |
| Productionモデル | リリース管理でProductionが更新前と同一（0件または1件） |
| テスト（推奨） | `.\.venv\Scripts\python.exe -m pytest -q` 全件PASS |

## 4. データ移行について

- **v1.0.0時点で手動のデータ移行作業は不要です**。データ形式の変更が必要な場合は、初回参照時に自動で行われる仕組み（例: `releases.json` の schema_version=2 への自動Migration・Release IDバックフィル、`db.py` の `ALTER TABLE ADD COLUMN`）で吸収されます
- 更新後に既存プロジェクトのデータが読めない場合は不具合です。復旧の前にログ（`data/jobs/logs/`・コンソール出力）を保全してください

## 5. ロールバック（更新の取り消し）

```powershell
# 1) アプリ停止
# 2) 元のコミットへ戻す
git checkout <控えておいた更新前コミット>
# 3) 依存関係を戻す（requirements.txt が変わっていた場合）
pip install -r requirements.txt
cd frontend; npm install; cd ..
# 4) 起動して更新後の確認（上表）を再実施
```

- データはコードと分離されている（`data/` はgit管理外）ため、通常はコードを戻すだけで復旧します
- 新バージョンで**自動Migrationが走った後**に旧バージョンへ戻す場合は、更新前バックアップからの復元（新Project IDへ）で整合を取ってください

## 6. 更新失敗時の復旧

1. アプリを停止し、エラーメッセージ・ログを保全
2. 上記ロールバック手順で更新前コミットへ戻す
3. 起動しない・データ破損が疑われる場合は、更新前に取得したfullバックアップから新Project IDへ復元（[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)）
4. それでも復旧しない場合は [25_DISASTER_RECOVERY.md](25_DISASTER_RECOVERY.md) の全損復旧手順へ
