# 24. Deployment Guide（社内配備手順）

## 1. 推奨構成

```text
C:\ocr-crafter\                     ... アプリルート（リポジトリ配置先）
├─ src\ / frontend\ / config\      ... アプリ本体（git管理）
├─ .venv\                          ... Python仮想環境
├─ data\                           ... データディレクトリ（プロジェクト・jobs・audit・backups・retention）
│   ├─ projects\<project_id>\
│   ├─ jobs\ / audit\ / backups\
│   └─ model_ids.json / retention.json
├─ models\tessdata_best\           ... Tesseractベースモデル
├─ external\PaddleOCR\             ... PaddleOCRリポジトリ
├─ outputs\                        ... ログ・学習成果物
└─ logs\                           ... サービスログ（サービス化時にリダイレクト）
```

| 構成要素 | 内容 |
|---|---|
| Backend | uvicorn（FastAPI）port 8000・**単一プロセス（--workers 1 必須**。レジストリ排他はプロセス内Lock+ファイルロック前提） |
| Frontend | `npm run build` の `frontend/dist/` を静的配信（nginx / IIS）。開発時のみ Vite dev server 5173 |
| Config | `config/settings.yaml`（本番差分は `config/settings.production.example.yaml` 参照）＋環境変数（`.env.example` 参照） |
| Backup Directory | `data/backups/`（別ドライブ/NASへの定期コピー推奨） |

## 2. 環境変数（.env.example）

- `CORS_ALLOWED_ORIGINS`: フロント配信元のみに絞る
- `OCRC_ALLOW_UNAUTHENTICATED_ADMIN=false`: **本番必須**（Admin互換無効化。docs/22）
- `VITE_API_BASE`: フロントビルド時のAPI URL

## 3. Windows起動手順（手動）

```bat
cd C:\ocr-crafter
.venv\Scripts\activate
set OCRC_ALLOW_UNAUTHENTICATED_ADMIN=false
uvicorn src.app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

フロントは事前に `cd frontend && npm run build` し、`dist/` をWebサーバーで配信する。

## 4. Windowsサービス化

### 方法A: タスクスケジューラ（簡易）

1. `deploy\start_backend.bat` を作成（上記起動コマンド＋ `>> C:\ocr-crafter\logs\backend.log 2>&1`）
2. タスクスケジューラ→「タスクの作成」→トリガー「スタートアップ時」→操作にbatを指定
3. 「ユーザーがログオンしているかどうかにかかわらず実行する」＋「最上位の特権」

### 方法B: NSSM（推奨・サービスとして管理）

```bat
nssm install OCRCrafterBackend "C:\ocr-crafter\.venv\Scripts\python.exe" ^
  "-m" "uvicorn" "src.app.main:app" "--host" "0.0.0.0" "--port" "8000" "--workers" "1"
nssm set OCRCrafterBackend AppDirectory C:\ocr-crafter
nssm set OCRCrafterBackend AppEnvironmentExtra OCRC_ALLOW_UNAUTHENTICATED_ADMIN=false
nssm set OCRCrafterBackend AppStdout C:\ocr-crafter\logs\backend.log
nssm set OCRCrafterBackend AppStderr C:\ocr-crafter\logs\backend.err.log
nssm set OCRCrafterBackend AppRotateFiles 1
nssm set OCRCrafterBackend AppRotateBytes 10485760
nssm start OCRCrafterBackend
```

再起動時は起動処理が **interrupted回収＋queued Job再開** を自動実行する（docs/18）。

## 5. Linux systemd例

```ini
# /etc/systemd/system/ocr-crafter.service
[Unit]
Description=OCR Crafter Backend
After=network.target

[Service]
User=ocrcrafter
WorkingDirectory=/opt/ocr-crafter
Environment=OCRC_ALLOW_UNAUTHENTICATED_ADMIN=false
ExecStart=/opt/ocr-crafter/.venv/bin/uvicorn src.app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## 6. Reverse Proxy例（nginx）

```nginx
server {
    listen 80;
    server_name ocr-crafter.example.local;
    client_max_body_size 200m;          # 画像インポート・バックアップDL用

    location / {                         # フロント（ビルド成果物）
        root /opt/ocr-crafter/frontend/dist;
        try_files $uri /index.html;
    }
    location ~ ^/(api|health|projects|images|labels|models|model-types|preprocess|dataset|train|predict|dialogs|system)($|/) {
        proxy_pass http://127.0.0.1:8000;
        proxy_read_timeout 600s;         # 学習・Benchmark等の長時間API
        # SSO連携時: 認証結果を X-Operator / X-Role へ変換して付与（docs/22）
        proxy_set_header X-Operator $remote_user;
        proxy_set_header X-Role     $http_x_role;
    }
}
```

**重要**: 本番モードではクライアントからの `X-Operator/X-Role` 偽装を防ぐため、プロキシで**外部からの同ヘッダを破棄**し認証結果のみを設定すること。

## 7. ポート一覧・Firewall要件

| ポート | 用途 | 公開範囲 |
|---|---|---|
| 80/443 | Reverse Proxy（フロント+API） | 社内ネットワーク |
| 8000 | Backend（uvicorn） | **localhostのみ**（プロキシ経由でのみ公開） |
| 5173/5174 | Vite dev server | 開発機のみ・本番では起動しない |

Firewall: 受信は80/443のみ許可。8000への外部直接アクセスはブロック（認証ヘッダ偽装防止）。

## 8. データディレクトリ権限

- `data/` `outputs/` `logs/`: サービス実行ユーザーへ読み書き（Windows: サービスアカウントへ変更/フルコントロール、Linux: `chown -R ocrcrafter:ocrcrafter`・`chmod 750`）
- `config/settings.yaml`: 読み取りのみで運用可（Policy等はAPI経由で `data/` 側へ保存される）
- 監査ログ `data/audit/` は一般ユーザーの直接書込を禁止（改ざん防止）

## 9. ログローテーション

- サービスログ: NSSMのAppRotate（10MB）または logrotate（Linux: `weekly / rotate 8 / compress`）
- Job内部ログ（`data/jobs/logs/`）・監査ログ: **データ保持設定**（システム状態画面 / `PUT /api/retention`）で日数指定→定期的に「今すぐ適用」またはスケジューラから `POST /api/retention/apply`（削除は監査記録される）

## 10. バックアップスケジュール例

| 対象 | 頻度 | 方法 |
|---|---|---|
| プロジェクト（metadata_only） | 毎日 | タスクスケジューラ→ `curl -X POST http://127.0.0.1:8000/api/backups -H "Content-Type: application/json" -H "X-Operator: scheduler" -H "X-Role: operator" -d "{\"project_id\":\"<id>\",\"mode\":\"metadata_only\"}"` |
| プロジェクト（full） | 毎週 | 同上 `mode=full` |
| `data/backups/` | 毎日 | NAS/別ドライブへ robocopy /MIR 等 |
| リストア試験 | 月次 | `GET /api/backups/{id}/verify` → 新Project IDへRestore → 動作確認 → 復元プロジェクト削除（docs/25） |

## 11. Docker

現時点で正式対応しない（CI/CD・Docker未整備の方針。CLAUDE.md）。将来対応時は backend/frontend/nginx の3コンテナ構成＋ `data/` ボリュームで docs/24 を更新すること。
