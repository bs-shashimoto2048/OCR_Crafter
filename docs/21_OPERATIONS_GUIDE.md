# 21. Operations Guide（運用ダッシュボード・ヘルスチェック）

社内運用時のシステム監視のためのガイド。実装は `src/app/services/operations.py`、画面は「運用 > システム状態」（`OperationsView.jsx`）。

## 1. 運用ダッシュボード（GET /api/operations/dashboard）

1画面で以下を確認できる:

| 項目 | 内容 | 情報源 |
|---|---|---|
| 実行中/待機中/失敗Job | システム全体のJob状況＋最近5件＋Worker稼働状態 | `data/jobs/jobs.json` |
| Production | 現Productionモデル（**0件または1件**）とVersion | `releases.json` |
| Release Gate状態 | ProductionモデルのGate判定（PASS等）＋不合格ルール | `release_gate.py` |
| 未評価Candidate | Candidateステータスだが実験カルテに評価がないモデル | `experiments.json` × `releases.json` |
| 最近のBenchmark | 最新Benchmarkの1位エンジンとCER | `benchmarks.json` |
| データ使用量 | 現プロジェクトの raw / processed / models / outputs / 合計（MB） | ファイルサイズ集計 |
| バックアップ状態 | 最新バックアップ（Phase 5のバックアップ機能の index.json）。未取得はnull | `data/backups/index.json` |

## 2. ヘルスチェック

| エンドポイント | 用途 | 内容 |
|---|---|---|
| GET `/health` | 死活監視 | `{status: "ok"}`（従来どおり・互換維持） |
| GET `/health/ready` | 受付可否 | データDir書き込み＋設定ファイル読込。`{ready, checks}` |
| GET `/health/details` | 管理者向け詳細 | 下記9項目。`{status: ok/degraded, problems[], checks{}}` |

`/health/details` の確認項目: Backend / データDir書き込み / 設定ファイル（settings.yaml） / Tesseract（実行ファイル解決） / PaddleOCR（import可否） / GPU（paddle判定・判定不能はnull） / Job Worker（スレッド稼働） / ディスク空き（1GB未満で警告） / プロジェクトDir。**取得不能な値はnull（推測しない）**。

## 3. 運用の目安

- 失敗Jobが増えた → ジョブ管理画面でエラー要約を確認 → 詳細は `data/jobs/logs/JOB-xxxxxx.log`
- Gate判定がFAILのままProduction運用 → Override履歴（監査ログ・Release History）を確認
- ディスク警告 → データ使用量の内訳（raw/processed/outputs）から整理対象を判断（`external/` `models/` `outputs/` は削除・再生成しない方針に注意）
- Worker停止表示 → Job作成時に自動起動する。プロセス再起動後にrunningのまま残ったJobは再実行で復旧
