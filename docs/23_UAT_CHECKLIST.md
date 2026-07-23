# 23. UATチェックリスト（運用受入試験）

社内本番配備前の受入試験項目。自動E2E（`tests/test_e2e_uat.py`）と権限マトリクス（`tests/test_permission_matrix.py`）が根拠。実行は `python -m pytest tests/test_e2e_uat.py -s`。

## 1. End-to-Endシナリオ（19工程・全PASS）

2026-07-23 実行結果（合成データ・OCR推論と実学習のみフェイク、パイプラインは実物）:

| # | 操作 | 期待結果 | 実結果 | ID | 判定 |
|---|---|---|---|---|---|
| 1 | プロジェクト作成 | 200 | 200 | e2e_uat | PASS |
| 2 | 画像登録 | 4枚 | 4枚 | - | PASS |
| 3 | 前処理設定 | overrides作成 | 作成済み | - | PASS |
| 4 | 前処理Job実行 | succeeded | succeeded | JOB-000001 | PASS |
| 5 | OCRデータセット作成 | succeeded | succeeded | JOB-000002 | PASS |
| 6 | 学習Job実行 | succeeded | succeeded | JOB-000003 | PASS |
| 7 | モデル登録 | e2e_model.tess.json | 同左＋管理No | M0001 | PASS |
| 8 | 評価Job実行 | succeeded・CER 0.0 | succeeded・CER 0.0 | JOB-000004 | PASS |
| 9 | Experiment作成・評価Profile保存 | attached=true | true | EXP-0001 | PASS |
| 10 | Comparable Group生成 | CG-0001 | CG-0001 | CG-0001 | PASS |
| 11 | Benchmark実行（前処理manual） | BM-0001・1位=登録モデル | 同左 | JOB-000005 / BM-0001 | PASS |
| 12 | Candidate化 | Validated→Candidate v0.1 | 同左（Validated自動遷移確認込み） | - | PASS |
| 13 | Release Gate判定 | PASS | PASS | - | PASS |
| 14 | Production昇格 | REL-0001 v1.0.0 | 同左 | REL-0001 | PASS |
| 15 | Deployment Package生成 | 200・ZIP | 200・1,595bytes | - | PASS |
| 16 | Rollback | v1.0.0維持・新Release ID | v1.0.0・REL-0003 | REL-0003 | PASS |
| 17 | Backup作成＋整合性検証 | BK-0001・valid=true | 同左 | BK-0001 | PASS |
| 18 | 新規Project IDへのRestore | e2e_uat_restored_1 | 同左（モデル含め復元確認） | - | PASS |
| 19 | 監査ログ確認 | 主要操作すべて記録 | 16件・欠落なし | AUD-000001〜000016 | PASS |

補足: Job 5件（前処理/データセット/学習/評価/Benchmark）すべてに `job_finished` 監査が記録されることも確認済み。

## 2. 権限マトリクス（仕様確定）

○=許可 / ✕=403。`tests/test_permission_matrix.py` で全組み合わせ自動検証。

| 操作 | Viewer | Operator | Approver | Admin |
|---|---|---|---|---|
| 閲覧（一覧・詳細・監査ログ） | ○ | ○ | ○ | ○ |
| CSV Export（評価・Benchmark） | ○ | ○ | ○ | ○ |
| Model Card表示 | ○ | ○ | ○ | ○ |
| **Deployment Package Export** | **✕（仕様確定: 配布物の持ち出しは操作扱い）** | ○ | ○ | ○ |
| 前処理 / データセット作成 / 学習 / 評価 / Benchmark | ✕ | ○ | ○ | ○ |
| **Candidate化（release_status_change）** | ✕ | **○（仕様確定）** | ○ | ○ |
| Job キャンセル / 再実行 | ✕ | ○ | ○ | ○ |
| Experiment編集 / 分析対象切替 / Backup作成 | ✕ | ○ | ○ | ○ |
| Production昇格 / Override承認 / Rollback | ✕ | ✕ | ○ | ○ |
| Policy変更 / Project削除 / Model削除 / Restore / Retention実行 | ✕ | ✕ | ✕ | ○ |

- 認証未設定モード（既定）: ロール未指定はAdmin互換（バナー明示）
- 本番モード（allow_unauthenticated_admin=false）: X-Operatorなし=401・不正Role=403・未指定=viewer

## 3. 破壊的操作の確認ダイアログ（影響対象の明示）

| 操作 | 確認内容 | 実装 |
|---|---|---|
| processed再生成 | 送信ペイロード由来の設定要約＋既存processed・スナップショット更新の注意 | App.jsx `preprocessRunConfirmText` |
| Dataset再生成 | 作成元・プロジェクト名・既存データセットは変更されない旨 | App.jsx `createSelectedOcrDataset` |
| Model削除 | 対象モデル一覧（最大3件+件数）＋DELETE入力 | ModelsView |
| Project削除 | 対象プロジェクト名＋削除されるデータ内訳＋名前入力一致 | App.jsx `deleteProject` |
| Production昇格 / Override昇格 | 対象モデル・旧Productionの自動Archived・Version・Override承認者 | ReleasesView `submitPromote` |
| Rollback | 対象Version・モデル名 | ReleasesView |
| Restore | Backup ID・新プロジェクトへ復元（上書きなし）の明示 | OperationsView |
| Retention cleanup | 削除対象（終端Job・監査ログ）＋監査記録される旨 | OperationsView |
| Jobキャンセル | Job ID＋実行中は現在工程の終了後に停止する旨 | JobsView |

## 4. 画面表示確認（実施済み）

5画面（ジョブ管理/Benchmark/監査ログ/システム状態/リリース管理）× 4解像度（1920×1080 / 1440×900 / 1366×768 / 900×1400）で横スクロールなし・空状態表示・縦積み切替を確認（docs/15 2026-07-23参照）。大量ケース表はページング（50件/ページ）・一覧はコンテナ内スクロール。

## 5. ブラウザE2E（Playwright）について

新規依存パッケージを追加しない方針（CLAUDE.md）のため導入見送り。代替として TestClientによるAPI E2E（19工程）＋ vite ssrLoadModule + renderToString による全画面レンダリングテスト（284件）で担保する。導入する場合は `npm i -D @playwright/test` 後、本チェックリストの19工程をブラウザ操作へ書き起こすこと。
