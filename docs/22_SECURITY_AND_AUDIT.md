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

### 対象操作（13種）

project_create / project_delete / preprocess_run / dataset_create / training_start / model_delete / release_status_change / release_promote / release_rollback / release_policy_update / benchmark_run / job_cancel / job_retry

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
| preprocess_run / dataset_create / training_start / benchmark_run / release_status_change / job_cancel / job_retry / project_create | operator |
| release_promote / release_rollback | approver |
| project_delete / model_delete / release_policy_update | admin |

### 認証未設定モード

X-Roleヘッダが無い（=通常のブラウザ利用）場合は **Admin互換**で全操作を許可し、既存運用を壊さない。その代わり監査ログ・システム状態画面へ「**認証未設定モード（Admin互換）**」のバナーを常時表示して明示する。X-Roleを明示した場合のみロール階層を強制（不足時403）。

## 4. 監査ログ画面

- フィルタ: Project / 操作（13種の日本語ラベル） / User（部分一致） / Target ID / 日付From・To
- 行クリックで詳細: **Before/After差分**（変更キーを強調表示・`lib/auditDiff.js`）・記録情報（Target/Client/Reason）
- 削除ボタンは存在しない（追記型の明示）

## 5. API

| Method / Path | 概要 |
|---|---|
| GET `/api/audit` | 一覧（フィルタ6種・新しい順・削除/編集APIなし） |
| GET `/api/auth/context` | 現在のユーザー識別＋認証モード |

## 6. テスト

`tests/test_audit_operations.py`（13操作定義・採番/保存項目・機密キー/バイナリ除去・フィルタ・ロール階層・認証未設定モード・ヘルスチェック・ダッシュボード）＋ `frontend/tests/auditDiff.test.mjs` / `operationsView.render.test.mjs`。
