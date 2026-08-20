# Metadata-Only Backup Coverage Expansion 作業記録

Related: Feature [#150](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/150) / Investigation [#143](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/143)（Backup/Restore Investigation、本Issueの起点） / Bug [#145](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/145)（Restore Model Sidecar Path Rebase、無回帰を確認） / Feature [#147](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/147)（SQLite Online Backup、Investigation #143推奨2件目・対応済み）

**状態**: Completed / Closed。PR [#151](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/151)、Squash Commit `33d9202`でマージ済み。

## 目的

Investigation #143で推奨された3件目（最後）の実装Issue。project単位Backupの`metadata_only`モードで、`benchmark_center.json`・`inference_model.json`が除外されている既知gapを解消する。

## 実装前調査（Mandatory Investigation、Issue本文の9項目）

### 1. `backup_manager.py`の`_METADATA_FILES`定義

変更前: `["experiments.json", "releases.json", "benchmarks.json", "preprocess_config.json"]`。`_METADATA_DIRS`: `[("annotations", None), ("processed/meta", None), ("models", {".json"})]`。

### 2. full backupとmetadata_only backupのinclude/excludeロジック

`_collect_backup_files()`: `full`は`paths.root.rglob("*")`で全ファイル、`metadata_only`は`_METADATA_FILES`（project root直下の指定ファイル名）＋`_METADATA_DIRS`（指定subdirectory、拡張子フィルタ任意）のみ。

### 3. manifest生成・checksum対象

`create_backup()`は`_collect_backup_files()`が返したファイル一覧をそのままZIPへ書込み、各ファイルのSHA-256・サイズをmanifestへ記録する。**`_METADATA_FILES`/`_METADATA_DIRS`へ追加するだけで、manifest生成ロジック自体への変更は不要**（single sourceの拡張のみで自動的にmanifest対象へ含まれる）。

### 4. restore時のfile restoreロジック

`restore_backup()`はZIP内の`project/`プレフィックス配下を相対パスどおりに展開するのみで、ファイル名やsubdirectory構造を特別扱いしない。**`_METADATA_FILES`/`_METADATA_DIRS`拡張はrestoreロジック自体には影響しない**（backup時に含まれたファイルが、backup時と同じ相対パスで自然に復元される）。

### 5. `benchmark_center.json`のproducer/consumer

`services/benchmark_center.py`（`COMPARISONS_FILENAME = "benchmark_center.json"`）。Benchmark Centerの比較条件（対象Dataset・対象Model・フィルタ・並び順）のみを保存し、評価結果自体は保存しない（Evaluation/Experimentが唯一の情報源であり続ける設計）。書込みは`atomic_write_json`経由（backup時の読み取りが安全）。内容は`{counter, items: [{dataset_id, model...}]}`形式で、**絶対パスは一切含まない**（Dataset ID・モデルファイル名等の識別子のみ）。

### 6. `inference_model.json`のproducer/consumer

`services/inference_model.py`（`INFERENCE_MODEL_FILENAME = "inference_model.json"`）。現在の推論使用モデル選択（`{engine, model, inference_model_id, updated_at}`）。`model`フィールドはモデルファイル名（`releases.json`の`model`フィールドと同じ規約）であり、**絶対パスではない**ため、Bug #145のsidecar絶対パスrebase問題とは無関係（rebase不要、そのままコピーで正しく機能する）。書込みは`atomic_write_json`経由。

### 7. project rootにある他のJSON metadata files

`src/app/services/*.py`の`*_FILENAME`定数を全数調査した（`grep -rn "_FILENAME\s*=\s*\""`）。

| ファイル/ディレクトリ | 定義元 | 既存カバー状況 |
|---|---|---|
| `experiments.json` | `experiment_tracker.py::EXPERIMENTS_FILENAME` | 既存カバー済み |
| `releases.json` | `release_manager.py::RELEASES_FILENAME` | 既存カバー済み |
| `benchmarks.json` | `benchmark.py`（`paths.root / "benchmarks.json"`直書き） | 既存カバー済み |
| `preprocess_config.json` | `preprocess.py::PROJECT_PREPROCESS_CONFIG_FILENAME` | 既存カバー済み |
| `annotations/manual_masks.json` | `manual_mask.py::MANUAL_MASK_FILENAME`（`paths.annotations_dir`配下） | 既存カバー済み（`_METADATA_DIRS`の`annotations`が拡張子フィルタ無しで包含） |
| `processed/meta/<PREPROCESS_SNAPSHOT_FILENAME>` | `preprocess_snapshot.py` | 既存カバー済み（`_METADATA_DIRS`の`processed/meta`が包含） |
| `benchmark_center.json` | `benchmark_center.py::COMPARISONS_FILENAME` | **未カバー（Issue本文で指摘・本Issueで追加）** |
| `inference_model.json` | `inference_model.py::INFERENCE_MODEL_FILENAME` | **未カバー（Issue本文で指摘・本Issueで追加）** |
| `preprocess/saved_config.json`・`preprocess/history/v{NNNN}.json` | `preprocess_config_store.py` | **未カバー（本Investigationで新たに発見、後述）** |

Job系DB（`data/jobs/job_manager.db`）・監査ログ（`data/audit/`）・グローバルID採番簿（`data/model_ids.json`/`data/dataset_ids.json`）はいずれもproject root配下ではない（Investigation #143・Feature #147で別途扱い済み）ため対象外。

### 8. 既存metadata_only対象との分類基準

Issue本文のScope Decision（project-local／metadata source-of-truth／binary・large artifactでない／regenerate前提でない／full backupには既に含まれている）を、既存の4ファイル・3ディレクトリと同じ基準として適用した。

### 9. runtime cache/tempとmetadata source-of-truthの区別

`preprocess_config.json`（project root、「前処理を実行」で最後に使用したoverrides＝UIの利便性維持用途）と、`preprocess/saved_config.json`（`preprocess_config_store.py`、「学習に使用する確定済み前処理設定」＋`preprocess/history/v{NNNN}.json`という上書きされない履歴）は**別概念**であることをそれぞれのモジュールdocstringで確認した。前者はrun-time convenienceに近い性質だが既に含まれておりIssueスコープ外、後者は明確なsource-of-truth（確定済み設定＋不可逆な履歴）であり、本Investigationで新たに発見した。

## Scope Decision（追加調査で見つかった第3の対象）

Issue本文が明示した2件（`benchmark_center.json`・`inference_model.json`）に加え、上記§7・§9の調査により`preprocess/`ディレクトリ（`saved_config.json`＋`history/v{NNNN}.json`）がScope Decisionの5条件を**すべて満たす**ことを確認した。

1. project-local ✅（`paths.root / "preprocess"`配下）
2. metadata source-of-truth ✅（モジュールdocstringで「学習に使用する確定済み前処理設定」と明記）
3. binary/large artifactではない ✅（JSON、小容量）
4. regenerate前提ではない ✅（特に`history/`は追記型の版履歴で、失えば再現不能）
5. full backupでは既に含まれている ✅（`paths.root.rglob("*")`で包含済み）

このため本Issueへ含めた（Issue本文の「同種の明白な漏れが他にも見つかった場合は、条件を全て満たすものだけ同Issueへ含めてよい」を適用）。判断が曖昧な対象は無かった（他の候補は全て既存カバー済みであることを§7で確認済み）。

## 実装内容

`backup_manager.py`の`_METADATA_FILES`・`_METADATA_DIRS`（single source）を拡張した。

```python
_METADATA_FILES = [
    "experiments.json",
    "releases.json",
    "benchmarks.json",
    "preprocess_config.json",
    "benchmark_center.json",  # 追加
    "inference_model.json",   # 追加
]
_METADATA_DIRS = [
    ("annotations", None),
    ("processed/meta", None),
    ("models", {".json"}),
    ("preprocess", {".json"}),  # 追加（saved_config.json・history/v{NNNN}.jsonのみ拡張子.json）
]
```

`create_backup()`/`restore_backup()`本体・manifest生成ロジック・ZIP展開ロジックはいずれも無変更（single source拡張のみで自動的に反映される設計だったため）。backup/restoreで別々にhardcodeしている箇所は無かった。

## Manifest / Checksum

manifest schemaは無変更（v2のまま）。追加された4パス（`benchmark_center.json`・`inference_model.json`・`preprocess/saved_config.json`・`preprocess/history/v0001.json`）は、既存のSHA-256付きFile Listへ自動的に含まれることをテストで確認した。

## Restore

`metadata_only`復元で4パスすべてが正しく復元され、内容がsourceと一致することを確認した。`benchmark_center.json`/`inference_model.json`は絶対パスを含まないため、Bug #145のmodel sidecar絶対パスrebaseとは無関係（対象外のまま正しく機能する）。rebase処理自体（`.tess.json`/`.ocr.json`/`.trocr.json`が対象）は本Issueの変更後も無回帰であることを別途確認した。

## Missing Files

いずれの追加ファイルも、既存の4ファイルと全く同じ「存在しなければ単にZIPへ含めない」既存semanticsをそのまま踏襲する（`_collect_backup_files()`の`if file_path.is_file():`判定は既存ファイルにも新規ファイルにも同一に適用される）。missingを理由にbackup全体を失敗させることはない。

## No Scope Creep（実施しなかったこと）

- binary model artifactを`metadata_only`へ追加していない
- SQLite global DBをproject metadataへ混入していない（Feature #147で別途対応済み）
- frontend localStorage backupは実装していない
- full-system backup設計には触れていない

## Tests

新規: `tests/test_metadata_only_backup_coverage.py`（14件）

- **Backup**: `benchmark_center.json`/`inference_model.json`/`preprocess/saved_config.json`+`history/v0001.json`が`metadata_only`へ含まれること、既存の除外方針（画像・モデル実体）が変わらないこと、内容がsourceと一致すること、manifestへSHA-256付きで記録されること、対象ファイルが存在しなくてもbackup全体が失敗しないこと
- **Restore**: `metadata_only`復元で4パスすべてが正しく復元されること、`full`復元が引き続き全ファイルを含むこと（回帰）、既存4ファイルが引き続き復元されること（回帰）、Bug #145のmodel sidecar絶対パスrebaseが無回帰であること
- **Contract guard**: `_METADATA_FILES`/`_METADATA_DIRS`の内容を固定リストとして検証するテスト（将来誰かが誤って削除した場合にテストが失敗する）、実際に1件を意図的に取り除いた場合にbackupから漏れることを示すテスト（既存テストが漏れを検出できることの直接確認）

実行結果:

```
python -m pytest -q tests/test_metadata_only_backup_coverage.py
# 14 passed

python -m pytest -q tests/test_metadata_only_backup_coverage.py tests/test_backup_retention.py \
  tests/test_restore_model_sidecar_path_rebase.py tests/test_sqlite_online_backup.py
# 51 passed

python -m pytest -q
# 1350 passed, 10 failed, 93 errors
# 10 failed・93 errorsはIssue #141/#143/#145/#147時点のbaselineと一致する
# ローカルci_sim_venvのtransformers完全欠落による既知の環境依存事象のみ、
# 本Issueの変更とは無関係
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し一致を確認済み。Frontend diffは0。

## Documentation

- 本ファイル新規作成
- `backup_manager.py`モジュールdocstring: metadata_only対象の説明を更新
- `docs/BACKUP_AND_RESTORE.md`: §1のmetadata_only対象データ説明を更新
- `docs/workitems/operations/BACKUP_RESTORE_INVESTIGATION_143.md`: Next Issue Split 3件目を解決済みへ更新（Investigation #143推奨3件すべてが完了）

## Scope外（Out of Scope、実施しなかったこと）

- SQLite online backup（Feature #147で完了済み）
- model sidecar path rebase（Bug #145で完了済み）
- frontend localStorage backup
- automatic/scheduled backup
- cloud/object storage
- encryption/key management
- full-system restore automation
- Epic #28 Consumer Migration

## Future Work

Investigation #143推奨の3件（Bug #145・Feature #147・本Issue #150）はすべて完了した。今後同種の「project root JSON metadataの新規追加漏れ」を防ぐため、新しいproject-local metadata fileを追加する開発者は、本Issueの`test_metadata_files_contract_is_pinned`/`test_metadata_dirs_contract_is_pinned`が示す固定リストパターンを踏襲し、`_METADATA_FILES`/`_METADATA_DIRS`への追加要否をあわせて検討することが望ましい。
