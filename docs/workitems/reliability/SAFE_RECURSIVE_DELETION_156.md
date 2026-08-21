# Safe Recursive Deletion & Partial Cleanup Failure Detection 作業記録

Related: Reliability [#156](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/156) / Reliability [#154](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/154)（Model Deletion Robustness、本Issueの起点となったFuture Work） / Bug [#145](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/145)（Restore Model Sidecar Path Rebase） / Reliability [#133](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/133)（Terminate Windows Training Process Trees Safely）

**状態**: Completed / Closed。PR [#157](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/157)、Squash Commit `e1ccafd`でマージ済み。

## 目的

Issue #154（Model Deletion Robustness）のFuture Workとして記録された、recursive deletionの安全性と失敗検知を改善する。実装前調査でrecursive deleteの全call siteを棚卸しした結果、**`backup_manager.py::restore_backup()`の`new_project_id`パラメータが検証前に使われ、project root（`data/projects/`）外への任意ファイル書込み・cleanup時の任意ディレクトリrmtreeを許してしまう脆弱性**を新たに発見した。本Issueではこれを最優先で修正し、あわせてIssue #154のFuture Workで言及された「共通containment・失敗検知」も実装した。

## Mandatory Investigation: Recursive Delete Call Site Inventory

`shutil.rmtree(`・`safe_rmtree`・containment関連コードを全数調査した。

| Call site | Purpose | Allowed root | Containment方式 | Failure handling（変更前） | User impact | 本Issueでの対応 |
|---|---|---|---|---|---|---|
| `backup_manager.py::restore_backup()` | 復元先project directoryの失敗時cleanup | `projects_dir / target_pid`（**target_pidは検証前に使われていた**） | **無し（脆弱性）** | `ignore_errors=True` | **最高**: project root外への任意書込み・削除が可能だった | **修正: `normalize_project_id()`で検証してから使用** |
| `main.py::_cleanup_failed_ocr_dataset()` | 失敗したOCRデータセット自動生成物のcleanup | `paths.outputs/ocr_dataset(_from_logs)` | `root == path or root in path.parents`（**root自身を誤って許可**） | `ignore_errors=True`、成否未確認のままTrue返却 | 中: 手動/バグでroot自身を渡すと全dataset喪失の可能性 | **修正: `is_within_directory()`でroot自身を拒否＋成否確認** |
| `project_paths.py::safe_rmtree()` | 汎用の許可root限定recursive delete（5箇所から利用） | 呼び出し側指定 | `is_within_directory()`（既存、健全） | `ignore_errors=True`、成否未確認 | 中: 呼び出し元5箇所すべてに波及 | **拡張: 削除未完了時にwarningログ追加（契約不変）** |
| `main.py::_delete_training_artifacts()` | 学習停止後のrun_dir/model/logクリーンアップ | `paths.models`/`paths.logs`（`relative_to()`） | `Path.relative_to()`（既存、健全） | `except: pass`（3箇所とも完全silent） | 中: 失敗しても診断不能 | **拡張: 3箇所ともwarningログ追加（契約不変）** |
| `model_registry.py::delete_model()` | モデルsidecar+artifact directoryの削除 | `paths.models` | `_is_safe_model_artifact_dir()`（既存、健全。Issue #154で共有参照検出も追加済み） | `ignore_errors=True`、成否未確認 | 高: Model Manager主要機能 | **拡張: 削除未完了時にwarningログ追加（契約不変）** |
| `project_paths.py::delete_project_directory()` | プロジェクト全体削除 | `PROJECTS_DIR / normalize_project_id(...)` | `normalize_project_id()`（絶対パス・`/`・`\`・`..`拒否）＋symlink拒否 | 例外はそのまま伝播（ignore_errors無し） | 高（プロジェクト全体） | **変更不要**（既に健全と確認） |
| `dataset_builder.py::_clear_split_dirs()`/`_clear_typed_split_dirs()` | 分類データセット分割の再作成前クリア | `paths.dataset`固定 | 固定パス（動的成分なし） | 例外はそのまま伝播 | 低（project内固定パスのみ操作） | **変更不要**（安全構成） |
| `dataset_registry.py`（Dataset Manager削除） | Dataset削除 | `paths.outputs` | 既存`safe_rmtree()`使用 | `safe_rmtree()`経由 | 中 | **Fix適用で自動的に恩恵**（safe_rmtree拡張） |
| `evaluation_dataset.py`（評価データセット削除、L287） | 評価データセット削除 | `_evaluation_dir(project_id)` | 既存`safe_rmtree()`使用 | `safe_rmtree()`経由 | 中 | **Fix適用で自動的に恩恵** |
| `evaluation_dataset.py`（構築失敗時cleanup、L543） | 評価データセット構築失敗時のrollback | `dataset_dir`（呼び出し元で確定済み） | 呼び出し元依存 | `ignore_errors=True`、ただし元の例外は再送出される | 低（元例外が既に失敗を伝えている） | Future Workへ（元例外が主情報源のため緊急性低） |
| `ocr_pipeline.py`（OCRデータセット上書き、2箇所） | OCRデータセット上書き時の既存データクリア | `paths.outputs` | 既存`safe_rmtree()`使用 | `safe_rmtree()`経由 | 中 | **Fix適用で自動的に恩恵** |
| `ocr_tuning.py`（Export上書き） | Export出力先の上書きクリア | `paths.outputs` | 既存`safe_rmtree()`使用 | `safe_rmtree()`経由 | 低 | **Fix適用で自動的に恩恵** |
| `benchmark.py`（Benchmark一時ディレクトリ） | 前処理済み一時画像のcleanup | OS一時領域（`tempfile.mkdtemp()`、project外） | 該当なし（project/modelデータではない） | `ignore_errors=True`、no log | 低（OS一時領域、他から未参照） | Future Workへ（データ損失リスクなし、優先度4「purely ephemeral」に該当） |
| `report_generator.py`（レポート画像削除） | レポート添付画像の削除 | `_reports_root() / sanitize_filename(...)` | `sanitize_filename()`（既存の別方式） | `ignore_errors=True`、no log | 低〜中（レポートのみ、model/datasetに影響しない） | Future Workへ |
| `tesseract_pipeline.py`（学習前work_dirクリア） | Tesseract学習開始前の旧work_dirクリア | `paths.models / "tesseract_runs" / job_id`（job_id検証済み） | 固定パス構成（動的成分はjob_idのみ、空文字ガード済み） | `ignore_errors=True`、no log | 低（自ジョブの旧ディレクトリのみ） | Future Workへ（安全な構成、緊急性低） |

## 最重要の発見: `restore_backup()`の`new_project_id` Path Traversal

### 発見の経緯

Model Deletion（Issue #154）以外のrecursive delete call siteを機械的に棚卸しする過程で、`restore_backup()`の`target_pid`計算を精査したところ、**`normalize_project_id()`（project_id検証の唯一の既存規約、絶対パス・`/`・`\`・`..`を拒否）が一切呼ばれないまま`target_root = projects_dir / target_pid`が計算されていた**ことを発見した。既存の`ensure_project_directories(target_pid)`呼び出しが関数の**最後**にあり、そこでのみ間接的に検証されていたが、その時点までにZIP展開（ファイル書込み）と失敗時cleanup（`shutil.rmtree(target_root, ignore_errors=True)`）が既に実行され得る。

### 実証（temp環境のprobeで確認、実データ非破壊）

```
new_project_id="../../danger_zone_new" で restore_backup() を呼んだ結果:
- restore_backup()はfileをdanger_zone_new（projects_dir外）へ実際に書き込んだ
- その後 ensure_project_directories() が'/'を含むIDを拒否して例外を送出
- しかしこの例外は try/except の外側（関数末尾）で発生するため、
  cleanup（shutil.rmtree）が実行されず、projects_dir外に書込み済みファイルが残った
```

`new_project_id`をAPI（`POST /api/backups/{backup_id}/restore`の`BackupRestoreRequest.new_project_id`）から自由に指定できるため、`backup_restore`権限を持つ利用者が任意のファイルシステム位置への書込み、および（try節内で例外が発生する条件では）任意ディレクトリの再帰削除を引き起こせる状態だった。

### 修正

`target_pid`が明示指定された場合、`projects_dir`と結合する**前に**`normalize_project_id()`へ通す（1行の変更）。空文字（自動採番）の既存分岐は変更していない。

```python
if target_pid:
    target_pid = normalize_project_id(target_pid)
else:
    ... # 既存の自動採番ロジックは無変更
```

新しい依存・並行実装は追加しておらず、既存の`normalize_project_id()`（project_id検証の唯一のsource of truth）をそのまま再利用した（Design Principle #4）。

## 実装内容（その他）

### `_cleanup_failed_ocr_dataset()`（`main.py`）

- containment判定を`root == dataset_path or root in dataset_path.parents`（root自身を誤って許可）から、既存の`is_within_directory()`（root自身を明示的に拒否）へ置き換えた。個々のOCRデータセットは常に`ocr_dataset/<timestamp>`という真の子ディレクトリとして作られる契約（`ocr_pipeline.py`で確認済み）のため、root自身が渡ることは想定外の異常値であり、これを削除対象から除外するのが正しい。
- `shutil.rmtree()`後に`dataset_path.exists()`を確認し、削除が完了しなかった場合は`False`を返しwarningログを残す（従来は常に`True`を返していた）。呼び出し元（`main.py`の学習失敗ハンドラ）はこの戻り値を診断メッセージ生成にのみ使うため、契約変更によるリグレッションは無い。

### `safe_rmtree()`（`project_paths.py`）

- 既存の例外送出・戻り値契約（`Path`を返す、無効/許可範囲外は`ValueError`）は一切変更していない。
- `shutil.rmtree(..., ignore_errors=True)`後、削除対象がまだ存在する場合にwarningログを追加した。この関数は`dataset_registry.py`・`evaluation_dataset.py`・`ocr_pipeline.py`（2箇所）・`ocr_tuning.py`の計5箇所から呼ばれており、1箇所の変更で全呼び出し元が診断可能性の恩恵を受ける（Design Principle #3「1つの小さなhelperへ寄せられる場合は寄せる」）。

### `_delete_training_artifacts()`（`main.py`）

- run_dir削除失敗（`except OSError: pass`）・model_path削除失敗またはcontainment不成立（`except Exception: pass`）・log_path削除失敗またはcontainment不成立（同）の3箇所すべてに`logging.getLogger(__name__).warning(...)`を追加した。**例外を外部へ伝播させない既存contract（Issue #133由来、Windowsファイルロック等でtermination成功後の後処理を失敗させない設計）自体は変更していない**。

### `delete_model()`（`model_registry.py`）

- Issue #154で追加した共有参照検出はそのまま維持しつつ、`shutil.rmtree()`後に対象ディレクトリがまだ存在する場合はwarningログを残す（既存contract＝例外を投げず処理続行、は不変）。

## Shared Artifact Protection Regression（Issue #154無回帰）

`_resolve_safe_model_dirs()`/`_is_dir_referenced_by_other_sidecar()`（Issue #154実装）は本Issueで一切変更していない。共有ディレクトリ保護（片方削除でdirectory存続、最終参照削除時のみ実削除）が本Issueの変更後も機能することを`tests/test_model_deletion_shared_reference_safety.py`の既存テストで再確認した（無回帰）。

## Windows/Linux安全性

- `safe_rmtree()`のcontainment判定（`is_within_directory()`）は`Path.resolve()`を経由するため、symlink/junctionが許可root外を指す場合は実体パスへ解決されてから判定され、正しく拒否される（既存実装、Issue #145・#154のテストでLinux CI上のsymlinkケースとして実証済み）。
- `_delete_training_artifacts()`のrun_dir削除は、Issue #133の「Windowsプロセス終了直後のファイルロック」シナリオと矛盾しないよう、例外送出契約を維持したままログのみ追加した。

## Tests

新規: `tests/test_safe_recursive_deletion.py`（15件）、`tests/test_output_dir_safety.py`へ追加（2件）

- **Core helper（safe_rmtree、既存`test_output_dir_safety.py`で網羅済みのcontainmentに加え新規追加）**: 削除未完了時にwarningログが残ること・戻り値契約が不変であること、完全成功時はwarningが出ないこと
- **restore_backup() path traversal（最重要）**: `../`・`..`・絶対パス（POSIX/Windows）・`/`・`\`を含む`new_project_id`がいずれもZIP展開前に拒否されること、projects_dir外にディレクトリが作られないこと、正当な明示指定・空文字自動採番・既存ID衝突検出が引き続き機能すること（回帰）
- **_cleanup_failed_ocr_dataset()**: root自身の拒否（新規）、真の子ディレクトリの削除は引き続き機能（回帰）、root外の拒否（回帰）、削除未完了時にFalseを返すこと（新規）
- **delete_model()**: 削除未完了時にwarningログが残り、既存contract（sidecarは削除、例外なし）が不変であること

実行結果:

```
python -m pytest -q tests/test_safe_recursive_deletion.py tests/test_output_dir_safety.py
# 28 passed

python -m pytest -q tests/test_safe_recursive_deletion.py tests/test_output_dir_safety.py \
  tests/test_backup_retention.py tests/test_restore_model_sidecar_path_rebase.py \
  tests/test_model_deletion_shared_reference_safety.py tests/test_delete_model_safety.py \
  tests/test_windows_training_process_tree_termination.py tests/test_evaluation_dataset.py \
  tests/test_production_auth.py
# 126 passed, 1 skipped（symlinkテスト、環境依存でローカルWindowsのみskip許容）

python -m pytest -q
# 1379 passed, 10 failed, 1 skipped, 93 errors
# 10 failed・93 errorsはIssue #141/#143/#145/#147/#150/#154時点のbaselineと一致する
# ローカルci_sim_venvのtransformers完全欠落による既知の環境依存事象のみ、
# 本Issueの変更とは無関係
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し一致を確認済み。Frontend diffは0（Backend側の安全ガードのみの変更）。

## Documentation

- 本ファイル新規作成
- `docs/10_KNOWN_LIMITATIONS.md`・`docs/13_QA_STATUS.md`: 「rmtree封じ込め3方式併存」「ignore_errors部分失敗の非検知」を部分解消済みへ更新（safe_rmtree/delete_model/_delete_training_artifacts/_cleanup_failed_ocr_datasetの4箇所を対応、benchmark.py等の低リスク箇所は継続記録）
- `docs/workitems/reliability/MODEL_DELETION_ROBUSTNESS_154.md`: Future Workの該当項目を部分解決済みへ更新

## Scope外（Out of Scope、実施しなかったこと）

- soft delete / trash / undo
- filesystem transaction framework
- Model Registry全面再設計
- Job Lifecycle統合
- Backup policy変更
- Epic #28 Consumer Migration
- UI redesign
- `benchmark.py`（OS一時領域cleanup）・`evaluation_dataset.py`構築失敗時cleanup・`report_generator.py`（レポート画像削除）・`tesseract_pipeline.py`（学習前work_dirクリア）へのログ追加（優先度3-4、データ損失リスクが低いためFuture Workへ。Scope Decisionに従い、全call siteを一度に変更しない）
- `rmtree`封じ込め方式の完全な単一化（`safe_rmtree`/`is_within_directory`/`relative_to`/`sanitize_filename`の4方式が引き続き併存。各方式は健全であることを確認済みで、統合による追加の安全性向上は無いと判断し、無理な単一化は行わなかった）

## Future Work

- `benchmark.py`・`evaluation_dataset.py`（構築失敗時cleanup）・`report_generator.py`・`tesseract_pipeline.py`の各cleanupへのログ追加（低優先度、データ損失リスクなし）
- `report_generator.py`の`sanitize_filename()`ベースのcontainmentを、他箇所と統一した`is_within_directory()`ベースへ揃えるかどうかの再検討（現状健全なため緊急性なし）
- **フォローアップ**: `restore_backup()`の`new_project_id`検証タイミングバグの発見を受け、project/dataset/model/job等のユーザー入力IDがfilesystem pathへ到達する経路全体を横断的に監査するReliability [#158](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/158)を実施した。結論: 本Issue以外に同種の脆弱性は発見されなかった（詳細: `docs/workitems/reliability/PATH_ID_VALIDATION_AUDIT_158.md`）
