# 22. Security and Audit（監査ログ・ユーザー識別・権限）

実装は `src/app/services/audit_log.py`、画面は「運用 > 監査ログ」（`AuditView.jsx`）。

## 1. 監査ログ（Audit Log）

- 保存先: `data/audit/audit.jsonl`（**追記型JSONL**）＋ `data/audit/counter.json`（採番）
- **削除・編集APIは提供しない**（通常UIから削除不可）。整理はデータ保持設定の運用のみ
- Audit ID: `AUD-000001`（全体一意・再利用しない）

### 保存項目

Audit ID / Timestamp / User（operator名）/ Role / Action / Project / TargetType / TargetID / Before / After / Reason / JobID / Client情報（IP・User-Agent）

### 保存禁止（_sanitize が強制）

- **パスワード・トークン・APIキー**等の機密キー（password / token / api_key / secret / credential / authorization を含むキーは値ごと除去）
- **画像バイナリ**（bytes系は `[バイナリは保存しません]` へ置換）
- 巨大値は2000文字で切り詰め

### 対象操作（24種）

基本13種: project_create / project_delete / preprocess_run / dataset_create / training_start（Tesseract・**PaddleOCR両方**） / model_delete / release_status_change / release_promote / release_rollback / release_policy_update / benchmark_run / job_cancel / job_retry

バックアップ・保持2種: **backup_restore** / **retention_cleanup**

レポート2種: **report_generate**（レポート生成Job作成） / **report_delete**（レポート削除）

監査補完7種（最終検証フェーズ③）: **job_finished**（Job完了 succeeded/failed/cancelled。**Service層＝JobService.execute_jobで記録**するためAPI・Worker・CLIのどの経路でも同じ場所で1回だけ記録され二重記録しない） / **evaluation_run**（モデル評価実行） / **experiment_update**（タグ・メモ・実験名変更） / **analysis_toggle**（分析対象ON/OFF） / **backup_create** / **deployment_export**（Deployment Package Export） / **restore_failed**（復元失敗・整合性エラー含む）

CLI直接実行（`python -m src.app.train` 等）は、共通Service層で記録可能な操作（job_finished）のみ監査対象。API層でのみ記録する操作はCLI経由では記録されない（既知の制約）。

Before/Afterの例: release_status_change（変更前後のStatus/Version）、release_policy_update（変更前後のPolicy全体）、release_promote（旧/新Production・Release ID・Override内容）。

## 2. ユーザー識別（UserContext）

- リクエストヘッダ `X-Operator`（operator名）と `X-Role`（viewer / operator / approver / admin）で識別
- 認証基盤（SSO等）は未導入。**将来SSO導入時は `resolve_user_context`（ヘッダ解決部分）のみ差し替える**設計
- GET `/api/auth/context` で現在の識別情報と認証モードを取得できる

## 3. 権限モデル（ロール）

弱い順に **viewer < operator < approver < admin**。

| 操作 | 最低ロール |
|---|---|
| 参照系すべて | viewer |
| preprocess_run / dataset_create / training_start / benchmark_run / release_status_change / job_cancel / job_retry / project_create / evaluation_run / experiment_update / analysis_toggle / backup_create / deployment_export / report_generate / report_delete | operator |
| release_promote / release_rollback | approver |
| project_delete / model_delete / release_policy_update / backup_restore / retention_cleanup | admin |

### 認証未設定モード（開発・移行用）と本番モード

**開発・移行用（既定）**: X-Roleヘッダが無い場合は **Admin互換**で全操作を許可し、既存運用を壊さない。その代わり監査ログ・システム状態画面へ「**認証未設定モード（Admin互換）**」のバナーを常時表示して明示する。X-Roleを明示した場合のみロール階層を強制（不足時403）。

**本番モード**: `config/settings.yaml` の `security.allow_unauthenticated_admin: false`（または環境変数 `OCRC_ALLOW_UNAUTHENTICATED_ADMIN=false`。環境変数が優先）でAdmin互換を無効化できる。falseの場合:

- **X-Operatorなし・空のOperator名 → 401**（AUTH_REQUIRED）
- **不正なRole文字列 → 403**（PERMISSION_DENIED）
- ロール未指定は **viewer（最小権限）** 扱い（Admin互換にしない）
- UIへ「認証設定不足」（X-Operator/X-Roleヘッダをリバースプロキシ/SSOで付与する案内）を表示

実SSOは未実装（ヘッダ付与はリバースプロキシ等で行う）。将来SSO導入時は `resolve_user_context` のみ差し替える。

## 3b. 統一エラー形式

全APIエラーは以下の形式で返る（HTTPExceptionハンドラで正規化。旧形式 `detail` 文字列も後方互換で併記）:

```json
{
  "error_code": "JOB_CONFLICT",
  "message": "同一モデルの評価Jobが実行中です。",
  "details": {},
  "related_id": "JOB-000123"
}
```

- error_code: VALIDATION_ERROR（400/422）/ AUTH_REQUIRED（401）/ PERMISSION_DENIED（403）/ NOT_FOUND（404）/ CONFLICT・JOB_CONFLICT（409）/ RELEASE_GATE_FAILED / BACKUP_VALIDATION_FAILED / INTERNAL_ERROR（500）
- related_id: メッセージ中の JOB-/BM-/REL-/EXP-/AUD-/BK-/CG-/M番号 を自動抽出
- **スタックトレース・内部パスは画面へ返さない**（500は「サーバー内部エラー」の要約のみ・詳細はサーバーログ）

## 4. 監査ログ画面

- フィルタ: Project / 操作（24種の日本語ラベル） / User（部分一致） / Target ID / 日付From・To
- 行クリックで詳細: **Before/After差分**（変更キーを強調表示・`lib/auditDiff.js`）・記録情報（Target/Client/Reason）
- 削除ボタンは存在しない（追記型の明示）

## 5. API

| Method / Path | 概要 |
|---|---|
| GET `/api/audit` | 一覧（フィルタ6種・新しい順・削除/編集APIなし） |
| GET `/api/auth/context` | 現在のユーザー識別＋認証モード |

## 6. テスト

`tests/test_audit_operations.py`（13操作定義・採番/保存項目・機密キー/バイナリ除去・フィルタ・ロール階層・認証未設定モード・ヘルスチェック・ダッシュボード）＋ `frontend/tests/auditDiff.test.mjs` / `operationsView.render.test.mjs`。
