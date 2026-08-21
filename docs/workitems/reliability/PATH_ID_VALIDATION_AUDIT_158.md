# Project ID Validation Before Path Use 作業記録

Related: Reliability [#158](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/158) / Reliability [#156](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/156)（Safe Recursive Deletion、本Issueの起点となった発見） / Bug [#145](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/145)（Restore Model Sidecar Path Rebase）

**状態**: Implemented, PR review pending。

## 目的

Issue #156の実装中に発見・修正した`restore_backup()`の`new_project_id`検証タイミングバグ（`normalize_project_id()`が関数末尾でのみ間接的に呼ばれ、それ以前にfilesystem書込み・cleanupが実行され得た）を受け、project/dataset/model/job等のユーザー入力IDがfilesystem pathへ到達する経路を横断的に棚卸しし、**path使用前validation**が保証されているかを確認する。

## 結論（要約）

**本Issueの調査範囲では、Issue #156で修正済みの`restore_backup()`以外に、同種の「検証前path使用」脆弱性は発見されなかった。** 一方で、この結論の根拠となる中核のvalidation helper（`normalize_project_id()`）に**単体テストが一切存在しなかった**ことを確認し、本Issueで新設した。以下、調査の詳細と根拠を記録する。

## Mandatory Investigation

### 1. Validation Helpers Inventory

| Helper | 対象識別子 | 方式 | 呼び出し箇所 |
|---|---|---|---|
| `project_paths.py::normalize_project_id()` | Project ID | 絶対パス拒否・`/`/`\`拒否・`.`/`..`/`..`を含む値拒否・64文字制限・NFKC正規化 | `get_project_paths()`内部で必ず呼ばれる（後述） |
| `main.py::_resolve_project_id()` | Project ID（API層） | `normalize_project_id()`の薄いwrapper。`ValueError`→`HTTPException(400)`変換のみ | 各APIエンドポイントの入口 |
| `evaluation_dataset.py::sanitize_dataset_id()` | 評価データセットID | 正規表現ホワイトリスト`^[A-Za-z0-9_-]{1,64}$` | データセット作成・rename時 |
| `evaluation_dataset.py::_resolve_dataset_dir()` | 評価データセットID（既存参照） | `Path(id).name`でbasename化＋元の値と一致確認＋ホワイトリスト | 削除・rename前に必ず経由 |
| `report_generator.py::sanitize_filename()` | ファイル名全般 | 危険文字を`_`へ置換・`..`を`_`へ置換・150文字制限 | レポート添付ファイル名 |
| `model_registry.py`（`Path(model_name).name`パターン） | モデルファイル名 | basename化＋元の値との一致確認（`safe_name != model_name`ならエラー） | `delete_model()`/`download_model_endpoint()`（Issue #141/#145/#154で確認済み） |
| `project_paths.py::safe_rmtree()`/`is_within_directory()` | 汎用path containment | `Path.resolve()`＋`Path.parents`（構成要素単位、文字列prefix比較ではない） | 削除系5箇所＋Issue #156で追加2箇所 |

既存helperを再利用し、新しい重複validationは追加していない（dataset ID用の新しいwhitelistヘルパー等は作らなかった）。

### 2. User-controlled ID → Path Call Graph

#### Project ID

`grep`で`PROJECTS_DIR /`の直接使用を全数調査した結果、**リポジトリ全体で唯一の使用箇所は`project_paths.py::get_project_paths()`自身**であることを確認した（`root = PROJECTS_DIR / normalized`、`normalized = normalize_project_id(project_id)`の**後**）。すなわち、project_idが`PROJECTS_DIR`と結合される経路は事実上1本しかなく、そこには必ず`normalize_project_id()`が先行する。

例外は`backup_manager.py::restore_backup()`のみで、`target_root = projects_dir / target_pid`という**別の**`PROJECTS_DIR`結合ロジックを独自に持っていたため、`get_project_paths()`の「必ず先に検証する」という保証の外側にあった。これがIssue #156で発見・修正されたバグの構造的原因である。他に`PROJECTS_DIR`（または`project_paths_module.PROJECTS_DIR`）を直接参照する箇所は`audit_log.py`・`backup_manager.py`（自身の`data/backups`等）・`dataset_registry.py`・`experiment_tracker.py`・`job_manager.py`・`model_registry.py`・`operations.py`・`report_generator.py`・`sqlite_backup.py`に存在するが、いずれも固定のサブパス文字列（`"audit"`・`"backups"`・`"jobs"`・`"model_ids.json"`等）と結合するのみで、ユーザー入力IDとは結合していないことを確認した。

`new_project_id`に相当する「ユーザー入力から新しいproject_idを作る」操作は、リポジトリ全体で`restore_backup()`のみであることも確認した（rename_project/duplicate_project等の類似機能は存在しない）。

#### Dataset ID（2系統）

- **評価データセット**（`evaluation_dataset.py`）: `sanitize_dataset_id()`（ホワイトリスト正規表現）で新規作成・rename時に検証。既存参照（削除等）は`_resolve_dataset_dir()`が`Path(id).name`によるbasename化＋元の値との完全一致確認＋ホワイトリストを、path構築・`safe_rmtree()`呼び出しより**前**に行う。
- **Dataset Manager**（`dataset_registry.py`）: `dataset_id`は`find_dataset_folder_by_id()`による**lookup-then-use**方式（既存の登録簿と完全一致するIDのみ有効なfolderへ解決され、一致しなければ`None`が返り以降の操作は発生しない）。新規folder名は`copy_dataset()`のように常にサーバー側で生成する（`f"{folder.name}_copy_{timestamp}"`）ため、ユーザー入力が新しいfolder名として直接使われることはない。

#### Model名/ID

Issue #141/#145/#154で確認済み: `delete_model()`/`download_model_endpoint()`はいずれも`safe_name = Path(model_name).name`＋`if safe_name != model_name: raise ValueError`という、basename化と元の値との一致確認を**最初に**行う（path構築・ファイルI/Oより前）。Model ID（M0001形式）自体はpathへ直接使われない（`model_ids.json`という登録簿を介した表示用識別子であり、path構築には常にファイル名の方を使う）。

#### Job ID

Training Job（System A・System B）とも`job_id = str(uuid.uuid4())`でサーバー側生成される（`main.py`内4箇所で確認）。ユーザーが新しいjob_idを指定して何かを作成する経路は存在しない。既存job_idの参照は常にDBの`WHERE id = ?`（パラメータ化クエリ）による**lookup-then-use**であり、存在しないjob_idはそのまま「見つからない」扱いになりpath操作は発生しない。

#### Report ID

`report_id = f"RPT-{index['counter']:04d}"`でサーバー側生成（`report_generator.py`）。`delete_report()`は`entry = next((i for i in index["items"] if i.get("reportId") == report_id), None)`という**lookup-then-use**方式で、一致しなければ`FileNotFoundError`となり以降のpath操作は発生しない。

#### Backup ID

`backup_id`（BK-0001形式）も同様にlookup-then-use方式（`index["items"]`との完全一致）。実際のfilesystem pathは`entry.get("file")`（サーバー側生成のZIPファイル名）から構築され、`backup_id`自体が直接pathへ使われることはない。

#### SQLite Backup（Issue #147）の`logical_name`

`sqlite_backup.py::backup_sqlite_database()`の`logical_name`引数は、唯一の呼び出し元である`backup_app_db()`/`backup_job_manager_db()`がいずれも固定文字列（`"app"`/`"job_manager"`）を渡すのみで、UI/APIが存在しない（Issue #147の設計どおり）ため、ユーザー入力が到達する経路自体が無い。

### 3. Risk Classification（優先順位別の確認結果）

| 優先順位 | 対象 | 結果 |
|---|---|---|
| 1. write/delete | project削除・model削除・dataset削除・report削除 | いずれもlookup-then-use、basename化、またはwhitelist regexで保護済み |
| 2. archive extract/restore | `restore_backup()` | Issue #156で修正済み（本Issueの発見の起点） |
| 3. model/dataset artifact creation | 学習成果物のディレクトリ作成（job_id利用） | job_idはサーバー生成UUIDのため安全 |
| 4. download/read | `download_model_endpoint()`等 | basename化パターンで保護済み（Issue #141/#145で確認済み） |
| 5. purely internal IDs | model_id（M0001）・dataset_id（DS0001）の表示用識別子 | pathへ直接使われない（別途ファイル名/folder経由） |

## Required Behavior確認

### 1. Validate Before Path Construction/Mutation

`get_project_paths()`/`ensure_project_directories()`は`normalize_project_id()`を呼んだ**後**にのみ`PROJECTS_DIR / normalized`を計算する。本Issueの新規テストで、`ensure_project_directories()`に不正なproject_idを渡した際、`Path.mkdir`が一度も呼ばれないことを直接確認した（`monkeypatch`でmkdir呼び出しを監視）。

### 2. Path Traversal Inputs

`normalize_project_id()`が拒否する入力（`../x`・`..\x`・絶対パス・drive-qualified path・path separator混入・empty/whitespace・`.`/`..`単独）を新設した単体テストで網羅的に確認した。

### 3. Error Contract

`main.py::_resolve_project_id()`は既存どおり`ValueError`→`HTTPException(400)`。`api_backup_restore()`の既存の`except ValueError: raise HTTPException(400, ...)`は、Issue #156で`restore_backup()`内部が新たに送出するようになった`ValueError`（`normalize_project_id()`由来）も無変更のまま正しく捕捉することを、API層の新規テスト（`TestClient`経由）で確認した。エンドポイント間の不一致は見つからず、統一作業は不要だった。

### 4. No Double-normalization Bugs

`normalize_project_id()`の出力を再度同じ関数へ通しても値が変わらない（idempotent）ことを単体テストで確認した。

### 5. Containment Still Required

`safe_rmtree()`/`is_within_directory()`（Issue #145/#156で確認・拡張済み）は本Issueで一切変更していない。Defense in depthとして、ID検証とcontainmentの両方が引き続き存在する。

## Windows/Linux確認

`normalize_project_id()`の絶対パス判定（`Path(value).is_absolute()`）はpathlibの実装がOS依存であることを、PR #159のCI（GitHub Actions Linuxランナー）で実際に確認した。ローカル（Windows）では`C:\...`形式が`is_absolute()=True`で「absolute path」メッセージとして拒否される一方、Linux CIでは`PurePosixPath`がドライブレターを認識しないため`is_absolute()=False`となり、後続の`"/" in value or "\\" in value`チェックで「'/' and '\\' are not allowed」メッセージとして拒否される（当初この違いに気づかず、Windows限定のメッセージをテストで固定してしまい、Linux CIで2件のテスト失敗として顕在化・修正した）。同様に`/etc/passwd`のようなPOSIX形式パスもOSによって拒否される分岐が変わる。**いずれの分岐でも拒否されること自体はプラットフォームに依存しない**ため、最終的なテストはメッセージの厳密一致ではなく「`ValueError`が送出されること」のみを確認する形に統一した。

## Tests

新規: `tests/test_project_id_validation.py`（27件）

- **normalize_project_id()単体**: 正常ID・None/空文字/空白→default・`../`系traversal・`..`単独・`.`単独・絶対パス（Windows drive-qualified／POSIX形式）・path separator混入・最大長超過/境界値・NFKC正規化・冪等性（二重正規化しても値が変わらない）
- **API層（POST /api/backups/{backup_id}/restore）**: 不正な`new_project_id`（`../`・`..`・絶対パス・separator混入）がHTTP 400で拒否され、`projects_dir`配下に予期しないエントリが作られないこと。正当な`new_project_id`は引き続き200で成功すること
- **Validate-before-use順序**: `ensure_project_directories()`に不正なproject_idを渡した場合、`Path.mkdir`が一度も呼ばれないことを直接確認（monkeypatchによる呼び出し監視）

実行結果:

```
python -m pytest -q tests/test_project_id_validation.py
# 27 passed

python -m pytest -q tests/test_project_id_validation.py tests/test_safe_recursive_deletion.py \
  tests/test_output_dir_safety.py tests/test_backup_retention.py \
  tests/test_restore_model_sidecar_path_rebase.py tests/test_production_auth.py
# 85 passed

python -m pytest -q
# 1406 passed, 10 failed, 1 skipped, 93 errors
# 10 failed・93 errorsはIssue #141/#143/#145/#147/#150/#154/#156時点のbaselineと
# 一致するローカルci_sim_venvのtransformers完全欠落による既知の環境依存事象のみ、
# 本Issueの変更とは無関係
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し一致を確認済み。Frontend diffは0。**本Issueは実装前調査の結果としてProduction codeの変更を一切行っていない**（Issue #156で既に修正済みのため、追加のcode fixは不要と判断した。テスト追加とドキュメント化のみ）。

## Documentation

- 本ファイル新規作成
- `docs/workitems/reliability/SAFE_RECURSIVE_DELETION_156.md`: 本Issueへのフォローアップリンクを追記

## Scope外（Out of Scope、実施しなかったこと）

- 認証/認可
- archive format全面再設計
- filesystem sandbox framework新設
- Epic #28 Consumer Migration
- UI redesign
- 新Engine追加
- Production codeの変更（調査の結果、Issue #156修正以外に必要な変更が見つからなかったため）

## Future Work

特になし。本Issueの監査で、project/dataset/model/job/report/backup ID全系統についてvalidation-before-use（またはそれと同等に安全なlookup-then-use）が成立していることを確認した。将来新しい識別子系統やAPI（例: 新しいrename/duplicate機能）を追加する場合は、本workitem docのID→path call graphパターン（basename化＋一致確認、whitelist regex、lookup-then-use、サーバー側ID生成のいずれか）を踏襲することを推奨する。
