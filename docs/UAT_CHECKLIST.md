# UATチェックリスト（受入試験・v1.0.0）

社内本番配備前の受入試験項目です。§1は**実際の利用者が手動で実施する受入試験**、§2以降は自動テスト（`tests/test_e2e_uat.py` / `tests/test_permission_matrix.py`）による検証記録です。自動E2Eの実行は `python -m pytest tests/test_e2e_uat.py -s`。

## 1. 手動受入試験チェックリスト（利用者実施）

実際の業務データ（またはサンプルデータ）で以下を実施し、結果・備考を記入してください。操作手順は [USER_GUIDE.md](USER_GUIDE.md) を参照。

| # | 試験項目 | 前提条件 | 操作 | 期待結果 | 結果 | 備考 |
|---|---|---|---|---|---|---|
| 1 | 初回起動 | インストール完了 | Backend/Frontend起動→ブラウザで開く | サイドバーとダッシュボードが表示される | | |
| 2 | セットアップウィザード | 初回アクセス（ブラウザ記録なし） | ウィザードを7ステップ完了 | 完了後に再表示されない。「セットアップを再実行」で再表示できる | | |
| 3 | 新規プロジェクト作成 | - | 「新規プロジェクト」→テンプレート選択→名前入力→作成 | プロジェクトが作成され「使用中」になる | | |
| 4 | 6種類のテンプレート | - | テンプレート選択画面で6種の内容を確認 | 標準/英数字OCR/日本語OCR/銘板OCR/手書きOCR/OCR＋YOLOが表示され、適用設定の詳細を確認できる | | |
| 5 | 画像取込 | プロジェクト作成済み | 学習データ>画像で「画像取込」 | 画像が一覧表示され、前処理が自動実行される | | |
| 6 | YOLO検出 | YOLOモデル配置済み | OCR画像作成のYOLO検出を実行 | 検出結果（件数・使用モデル・処理時間）が表示される。0件は「正常終了」表示 | | |
| 7 | クロップ | 検出済み | Bounding Box選択→クロップ出力 | 選択領域が切り出される | | |
| 8 | 画像回転 | 画像取込済み | 画像一覧で90°回転 | 回転が保存され、対象画像のみ再前処理される | | |
| 9 | 前処理 | 画像取込済み | 前処理設定でプレビュー→前処理実行 | 確認ダイアログ表示→processedが更新され、プレビューと同一の結果 | | |
| 10 | ラベル編集 | 画像取込済み | ラベルを入力・保存（大小文字混在含む） | 保存され、大文字化されない（入力どおり保持） | | |
| 11 | 評価データセット作成 | ラベル済み | 評価データ>データセット作成 | 評価データセットが作成され、モデル評価で選択できる | | |
| 12 | 学習 | データセット作成済み | OCRデータ作成→OCR学習開始 | Jobが完了しモデル管理へモデル追加（管理No付与） | | |
| 13 | 評価 | 学習済みモデルあり | モデル評価を実行 | CER・文字正解率・完全一致率・誤認識一覧が表示される | | |
| 14 | モデル比較 | モデル2件以上 | モデル管理で比較 | 性能サマリー・条件差分が表示される。評価条件が違う場合は警告 | | |
| 15 | 実験記録 | 学習・評価実施済み | 実験管理を開く | EXP-IDつきの実験カルテに学習条件・評価が記録されている | | |
| 16 | Benchmark | モデルあり | Benchmarkを実行 | BM-IDつきのLeaderboardが表示される | | |
| 17 | リリース（Candidate化） | 評価済みモデル | リリース管理でCandidateへ変更 | Version 0.xが採番される | | |
| 18 | Production昇格 | Candidateあり | Release Note入力→Gate判定→昇格 | Gate判定が表示され、昇格後Productionが1件になる（旧Productionは自動Archived） | | |
| 19 | Rollback | Release History2件以上 | Rollbackを実行 | Version維持・新Release IDで旧モデルがProductionへ戻る | | |
| 20 | レポート生成（Markdown） | モデルあり | レポート種別=単一モデル・Markdownで生成 | RPT-IDが採番されMarkdownをダウンロードできる | | |
| 21 | レポート生成（PDF） | 同上 | PDF形式で生成 | 日本語が文字化けなく表示されるPDFをダウンロードできる | | |
| 22 | Job管理 | Job実行中/完了後 | ジョブ管理で進捗確認・キャンセル・再実行 | 進捗表示・キャンセル・再実行が動作する | | |
| 23 | Audit（監査ログ） | 上記操作実施後 | 監査ログを確認 | 主要操作が操作者名つきで記録され、削除ボタンが無い | | |
| 24 | Backup | プロジェクトあり | バックアップ作成→verify→新Project IDへ復元 | valid=true・復元先でデータ確認できる | | |
| 25 | 再起動復旧 | Job実行中 | Backend再起動→ジョブ管理確認 | 「中断（再起動）」表示→再実行で復旧 | | |
| 26 | Empty State | 新規プロジェクト | データ0件の各画面を確認 | 空状態の案内（次の操作への導線）が表示される | | |
| 27 | キーボード操作 | - | Tab移動・Enter/Space選択・OCR修正のEnter確定 | 主要操作がキーボードで完結する | | |
| 28 | 解像度 1366×768 | - | 主要画面を表示 | 横スクロールなし・レイアウト崩れなし | | |
| 29 | 解像度 1600×900 | - | 主要画面を表示 | 同上 | | |
| 30 | 解像度 1920×1080 | - | 主要画面を表示 | 同上 | | |

## 2. End-to-Endシナリオ（自動・19工程・全PASS）

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

## 3. 権限マトリクス（仕様確定）

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

## 4. 破壊的操作の確認ダイアログ（影響対象の明示）

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

## 5. 画面表示確認（実施済み）

5画面（ジョブ管理/Benchmark/監査ログ/システム状態/リリース管理）× 4解像度（1920×1080 / 1440×900 / 1366×768 / 900×1400）で横スクロールなし・空状態表示・縦積み切替を確認（docs/15 2026-07-23参照）。大量ケース表はページング（50件/ページ）・一覧はコンテナ内スクロール。

## 6. ブラウザE2E（Playwright）について

新規依存パッケージを追加しない方針（CLAUDE.md）のため導入見送り。代替として TestClientによるAPI E2E（19工程）＋ vite ssrLoadModule + renderToString による全画面レンダリングテスト（284件）で担保する。導入する場合は `npm i -D @playwright/test` 後、本チェックリストの19工程をブラウザ操作へ書き起こすこと。
