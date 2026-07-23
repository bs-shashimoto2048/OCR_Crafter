# 26. Performance Limits（負荷試験結果とJSON方式の限界）

2026-07-23 実測（Windows 11 / ローカルSSD / Python 3.x単一プロセス）。試験スクリプトは合成データで
画像1,000枚 / 評価ケース1,000件 / Experiment 500件 / Job履歴10,000件 / Audit 50,000件 / Benchmark case 5,000件 / Model 100件 を生成して計測。

## 1. 実測値

| 項目 | データ量 | 実測 | 判定 |
|---|---|---|---|
| jobs.json 書込み（全件） | 10,000件 / 5.46MB | 63.8ms | ○ |
| Job一覧 limit=200 | 10,000件から | 58.4ms | ○ |
| Jobフィルタ（project+status） | 10,000件 | 59.2ms | ○ |
| **Job作成1件（採番+追記=全件read-modify-write）** | 10,000件レジストリ | **594.2ms** | **△ 限界に近い** |
| audit.jsonl サイズ | 50,000件 | 15.25MB | ○ |
| 監査一覧 limit=200 | 50,000件から | 32.9ms | ○ |
| 監査フィルタ（user部分一致・全走査） | 50,000件 | 32.7ms | ○ |
| Experiment一覧（Hash/CG計算込み） | 500件 / 0.82MB | 19.4ms | ○ |
| 条件推薦 | 500件 | 31.2ms | ○ |
| Benchmark一覧（cases除外） | cases 5,000件 / 1.37MB | 29.2ms | ○ |
| Benchmark詳細（cases込み） | 5,000件 | 32.2ms | ○（UIは50件/ページでページング） |
| Benchmark cases CSV | 5,000行 | 32.1ms | ○ |
| 管理No一括採番 / 参照 | 100件 | 42.2ms / 15.3ms | ○ |
| 正解CSV読込 / Profile Hash | 1,000件 | 8.1ms / 0.7ms | ○ |
| 画像1,000枚の生成（ディスクI/O） | 32×96 PNG | 約13s | ○（取込は1回きり） |
| 一覧系ピークメモリ（4種一覧同時） | 上記全データ | 45.8MB | ○ |

## 2. JSON方式が限界に近い項目（明記）

1. **jobs.json のJob作成・更新（約600ms@10,000件）**: 採番・状態更新のたびに全件をread-modify-writeするため、件数に比例して悪化する。進捗更新（record_progress）は実行中Jobごとに毎回発生するため、**Job履歴が5,000件を超えたらデータ保持設定（job_retention_days）で定期削除する運用を必須とする**。10,000件超の常用はSQLite移行が必要
2. **audit.jsonl のフィルタ全走査**: 50,000件で33msと実用内だが、リクエスト毎に全読みするため500,000件級（150MB超）ではメモリ・時間とも悪化する。保持日数（audit_retention_days）での整理を推奨
3. **benchmarks.json のcases**: 1 Benchmark=5,000ケースで1.4MB。数十件のBenchmark履歴を保持すると読込が線形悪化（一覧はcases除外済みのため影響は詳細表示のみ）

## 3. SQLite移行計画（今回未実装・Migration計画）

移行対象の優先順位と方式（実装時は `training_jobs` と同じ `outputs/app.db` へ）:

| 優先 | 対象 | 移行方式 |
|---|---|---|
| 1 | `data/jobs/jobs.json` → `jobs` テーブル | JobRepositoryはインターフェース固定済み（docs/18）。SQLite版Repositoryへ差し替え、初回起動時に jobs.json をINSERT移行→`jobs.json.migrated` へリネーム。イベントJSONL・内部ログはファイルのまま |
| 2 | `data/audit/audit.jsonl` → `audit` テーブル（INDEX: timestamp/action/project_id） | 追記型を維持（INSERTのみ・UPDATE/DELETE文を実装しない）。既存JSONLは初回移行後にアーカイブ保管 |
| 3 | `benchmarks.json` の `cases` → `benchmark_cases` テーブル | summary/資格情報はJSONのまま・casesのみ分離（ページングをSQL LIMIT/OFFSETへ） |
| 対象外 | experiments.json / releases.json / model_ids.json / retention.json | 件数・サイズとも小さく（500件で0.8MB・20ms）JSONで十分。ユーザーが直接確認できる利点を維持 |

移行原則: `db.py` の `ALTER TABLE ADD COLUMN` / `migrate_legacy_data.py` 方式に倣い、明示的なmigration関数＋冪等＋既存ファイルは削除せずリネーム保管。

## 4. 運用上の目安（本番設定推奨値）

- Job保持日数: 30日（またはJob履歴5,000件相当）
- 監査ログ保持日数: 365日（コンプライアンス要件に合わせて調整。適用前に audit.jsonl をアーカイブ）
- Benchmark履歴: プロジェクトあたり20件程度まで（超えたら古いものを手動整理）
