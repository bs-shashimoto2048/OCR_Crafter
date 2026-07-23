# 25. Disaster Recovery（障害復旧手順）

## 1. 障害タイプ別の一次対応

| 障害 | 症状 | 一次対応 |
|---|---|---|
| Backendクラッシュ/再起動 | Jobがrunningのまま | サービス再起動 → 起動時に**interrupted自動回収**＋queued再開（docs/18）。ジョブ管理画面で「中断（再起動）」を確認し**再実行** |
| レジストリJSON破損疑い | 一覧が空/エラー | 原子的書き込みのため通常発生しない。発生時は `.tmp` 残骸を確認→直近バックアップからRestore |
| プロジェクト誤削除/破損 | データ欠損 | 最新バックアップを**新Project IDへRestore**（上書きしないため安全に比較できる） |
| ディスク障害 | /health/details のdisk警告 | データ保持設定の適用・outputs整理→復旧後にバックアップからRestore |
| 誤ったProduction昇格 | 本番モデル不良 | リリース管理→Release Historyから**Rollback**（Version維持・新Release ID・監査記録） |

## 2. 再起動復旧の仕様（自動）

1. Backend起動時に `recover_interrupted_jobs` が running / cancel_requested のJobを `interrupted` へ回収（**永続running表示は残らない**）
2. queued のJobはWorker再開でそのまま実行
3. `interrupted` のJobはUIの「再実行」で同一入力条件の新Jobとして復旧（`retry_source_job_id` で追跡）
4. 成果物は原子的書き込みのため、中断時に不完全な正式成果物は残らない（docs/18 §3b）

試験根拠: `tests/test_recovery_atomicity.py`（queued/running/cancel_requested/完了直後の4シナリオ）。

## 3. バックアップからの復元手順

1. **検証**: `GET /api/backups/{BK-ID}/verify` → `valid=true` を確認（SHA-256全ファイル照合）
2. **復元**: `POST /api/backups/{BK-ID}/restore`（既定=新Project ID `<元ID>_restored_<n>`）
   - 復元前検証で不一致があれば**復元は開始されない**（BACKUP_VALIDATION_FAILED）
   - 復元後にも再検証され、不一致時は復元先が自動削除される（部分復元なし）
3. **確認**: 復元プロジェクトで モデル一覧 / 実験 / リリース状況 / 画像 を確認
4. **切替**: 問題なければ運用プロジェクトとして利用開始（旧プロジェクトは残置または削除）
5. 全操作は監査ログ（backup_restore / restore_failed）に記録される

## 4. サーバー全損からの復旧（フル手順）

1. docs/24 に従い新サーバーへアプリ配備（リポジトリ＋.venv＋Tesseract＋tessdata＋PaddleOCR）
2. NAS等から `data/backups/` を新サーバーの `data/backups/` へ配置（`index.json` 含む）
3. Backend起動 → プロジェクトごとに §3 の復元手順を実施
4. `data/jobs/` `data/audit/` はバックアップ対象外（システム全体データ）。監査ログの長期保管が必要な場合は `data/audit/audit.jsonl` をファイルコピーで別途保全しておくこと
5. Release Checklist（`docs/RELEASE_CHECKLIST.md`）で復旧後の健全性を確認

## 5. リストア試験（月次推奨）

1. 最新のfullバックアップで `verify` → `restore`（新Project ID）
2. 復元プロジェクトの モデル評価を1回実行し、既知のCERと一致することを確認
3. 試験用の復元プロジェクトを削除（監査記録される）
4. 結果を `docs/RELEASE_CHECKLIST.md` のチェックリストへ記録
