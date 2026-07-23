# OCR Crafter 管理者ガイド（v1.0.0）

対象読者: 情報システム担当・アプリ管理者・運用責任者・保守担当者。
導入手順は [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md)、更新は [UPDATE_GUIDE.md](UPDATE_GUIDE.md)、バックアップは [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)、障害時は [TROUBLESHOOTING.md](TROUBLESHOOTING.md) / [25_DISASTER_RECOVERY.md](25_DISASTER_RECOVERY.md) を参照してください。

## 1. 基本運用

### 1.1 起動・停止

```powershell
# 起動（リポジトリルートで）
.\.venv\Scripts\Activate.ps1
uvicorn src.app.main:app --port 8000        # バックエンド
cd frontend; npm run dev                     # フロントエンド（開発サーバー・port 5173）
```

- 停止: 各ターミナルで `Ctrl+C`、またはUIサイドバー下部の「アプリ終了」
- サービス化（NSSM）・タスクスケジューラ・Linux systemd の構成例は [24_DEPLOYMENT_GUIDE.md](24_DEPLOYMENT_GUIDE.md) を参照
- 実行中のJobがある状態で停止しても、再起動時に自動で `interrupted`（中断）へ回収され、再実行で復旧できます

### 1.2 稼働確認・ヘルスチェック

| 確認 | 方法 | 正常 |
|---|---|---|
| 死活監視 | `GET /health` | `{"status":"ok"}` |
| 受付可否 | `GET /health/ready` | `ready: true`（データDir書き込み・設定読込） |
| 詳細（管理者向け） | `GET /health/details` または「運用 > システム状態」 | `status: ok`（degradedなら `problems[]` を確認） |

`/health/details` の9項目: Backend / データDir書き込み / 設定ファイル / Tesseract / PaddleOCR / GPU / Job Worker / ディスク空き（1GB未満で警告） / プロジェクトDir。**取得不能な値はnull（推測しない）**。

### 1.3 Worker・Job状態の確認

- 「運用 > ジョブ管理」で全Jobの状態・進捗・エラー要約を確認（Worker稼働状態もヘッダに表示）
- WorkerはJob作成時に自動起動します。「Worker: 停止」は異常ではありません
- 再起動後に `running` のまま残るJobはありません（起動時に `interrupted` へ回収 → 再実行可能）

### 1.4 ログ・保存領域・リソースの確認

| 対象 | 場所 |
|---|---|
| Job内部ログ（スタックトレース） | `data/jobs/logs/JOB-xxxxxx.log` |
| Job進捗イベント | `data/jobs/events/JOB-xxxxxx.jsonl` |
| 学習ログ | `data/projects/<id>/logs/` および学習画面のログ表示 |
| 監査ログ | `data/audit/audit.jsonl`（画面: 運用 > 監査ログ） |
| データ使用量 | 「運用 > システム状態」の使用量カード（raw/processed/models/outputs別・MB） |
| ディスク空き | `/health/details` の disk（1GB未満で警告。運用目安は10GB以上） |
| GPU状態 | `GET /api/system/check`（GPU名・CUDA可否・推奨プロファイル）/ セットアップウィザードのGPU確認 |

- Job履歴・監査ログの肥大化は「データ保持設定」（システム状態画面）で管理します。**Job 10,000件でJob作成が約600msまで悪化する実測**があるため、保持30日運用を推奨（[26_PERFORMANCE_LIMITS.md](26_PERFORMANCE_LIMITS.md)）

## 2. ユーザーと権限

認証基盤（SSO等）は未導入です。ユーザー識別は **X-Operator（操作者名）/ X-Role（ロール）ヘッダ**で行います（[22_SECURITY_AND_AUDIT.md](22_SECURITY_AND_AUDIT.md)）。

- **認証未設定モード（既定）**: ロール未指定はAdmin互換として動作（画面にその旨のバナー表示）
- **本番認証モード**: 環境変数 `OCRC_ALLOW_UNAUTHENTICATED_ADMIN=false` を設定すると、X-Operatorなしの変更系操作は401、不正Roleは403、Role未指定はviewer扱い。リバースプロキシでヘッダを付与する構成例は [24_DEPLOYMENT_GUIDE.md](24_DEPLOYMENT_GUIDE.md)

### ロールと権限（実装済みの4ロール）

弱い順に `viewer < operator < approver < admin`。

| 操作 | viewer | operator | approver | admin |
|---|---|---|---|---|
| 閲覧（一覧・詳細・監査ログ）・CSV Export・Model Card表示 | ○ | ○ | ○ | ○ |
| 前処理 / データセット作成 / 学習 / 評価 / Benchmark / レポート生成・削除 | ✕ | ○ | ○ | ○ |
| プロジェクト作成 / Candidate化 / Jobキャンセル・再実行 / Experiment編集 / 分析対象切替 / Backup作成 / Deployment Package Export | ✕ | ○ | ○ | ○ |
| **Production昇格 / Override承認 / Rollback** | ✕ | ✕ | ○ | ○ |
| **Policy変更 / プロジェクト削除 / モデル削除 / Restore / Retention実行** | ✕ | ✕ | ✕ | ○ |

- 監査対象は24操作（`report_generate`・`report_delete` 含む）。全組み合わせは `tests/test_permission_matrix.py` で自動検証されています（[UAT_CHECKLIST.md](UAT_CHECKLIST.md) に一覧表）
- Release Override（FAIL判定モデルの例外昇格）は approver 以上で、Override Reason＋Approved By の両方が必須です

## 3. モデル運用（リリース管理）

- ステータス: `Draft` → `Validated`（評価完了で自動遷移）→ `Candidate` → `Production` → `Archived`
- **Productionは各プロジェクトで0件または1件**（2件以上にならない設計。新昇格時に旧Productionは自動Archived）
- **Release ID**（REL-0001形式）=リリース行為の識別子 / **Version**=配布物の版（Candidate=0.x、Production初回=1.0.0→マイナー加算）
- **Release Gate**: Release Policy（プロジェクト毎・最大12項目）に基づく昇格自動判定（PASS / CONDITIONAL_PASS / FAIL / NOT_EVALUATED）。**未設定の項目はルール自体が生成されない**ため、Policy未設定プロジェクトは制限なしで動作します
- **Override**: FAIL判定はサーバー側で昇格拒否。Override Reason＋Approved By が揃った場合のみ昇格でき、当時のFailed Rulesスナップショットが履歴へ保存されます
- **Rollback**: 過去リリースVersionのモデルを再Productionへ（Version維持・新Release ID・監査記録）。現Productionへのロールバックは拒否されます
- 運用上の推奨: 昇格前に評価（Evaluation Hash）・Benchmark・バックアップの取得を確認（[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)）
- 詳細仕様: [20_RELEASE_POLICY.md](20_RELEASE_POLICY.md)

## 4. Job運用

- Job種別（7種）: `preprocess` / `dataset_creation` / `training` / `evaluation` / `benchmark` / `deployment_export` / `report_generate`
- 状態遷移: `queued` → `running` → `succeeded` / `failed` / `cancelled`（キャンセル要求中は `cancel_requested`）。再起動時に running だったものは `interrupted`
- **再起動時の扱い**: Backend起動時に `running` のJobを自動で `interrupted` へ回収し、`queued` のJobはWorkerが再開します。**「実行中のまま固まる」状態は残りません**
- **Retry（再実行）**: failed / cancelled / interrupted のJobを同じパラメータで新規Jobとして再実行
- **Cancel**: queued は即時キャンセル、running は現在工程の終了後に停止
- **Worker停止時**: Job作成時に自動起動します。起動しない場合はBackendの再起動 → [TROUBLESHOOTING.md](TROUBLESHOOTING.md#学習) を参照
- 詳細仕様: [18_JOB_MANAGEMENT.md](18_JOB_MANAGEMENT.md)

## 5. レポート運用

- **Report ID**: RPT-0001形式（プロジェクト内一意・並行生成でも重複しない採番）
- **保存先**: `data/reports/<project_id>/`（`index.json`=メタデータ、`.md` / `.pdf`=生成物、`<RPT-xxxx>_images/`=掲載画像のローカルコピー）
- **Markdown / PDF**: Markdownが基準で、PDFは同一Markdownから変換（内容差分なし）。PDFはmatplotlibによる**ローカル生成**で外部サービスへ送信されません
- **SHA-256**: 各生成ファイルのハッシュがメタデータへ記録され、改ざん・破損の確認に使えます
- **削除**: レポート詳細から削除（確認ダイアログつき）。メタデータと出力ファイルの両方が削除され、監査ログ `report_delete` へ記録されます
- **再生成**: 同条件で新しいReport IDのレポートを生成します（既存レポートは上書きされません）
- **監査ログ**: 生成（`report_generate`）・削除（`report_delete`）が操作者名つきで記録されます
- 運用上の推奨: 月次でプロジェクト総括レポートを生成し、引き継ぎ・報告資料として保管

## 6. 本番配布・その他

- 本番配布手順（配布前チェック・ポート/Firewall・自動起動・ロールバック）: [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md#7-本番配布手順) と [24_DEPLOYMENT_GUIDE.md](24_DEPLOYMENT_GUIDE.md)
- 更新手順: [UPDATE_GUIDE.md](UPDATE_GUIDE.md)
- バックアップ・復元: [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)
- 障害復旧（タイプ別一次対応・全損復旧・月次リストア試験）: [25_DISASTER_RECOVERY.md](25_DISASTER_RECOVERY.md)
- セキュリティ・データ取扱い: [SECURITY_AND_DATA_HANDLING.md](SECURITY_AND_DATA_HANDLING.md)
