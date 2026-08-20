# Backup / Restore & Operational Data Safety Investigation 作業記録

Related: Investigation [#143](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/143) / Investigation [#139](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/139)（本Investigationの起点） / Feature [#127](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/127)（JobRepository SQLite移行） / Reliability [#133](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/133)（Windows Process Tree Termination） / Feature [#141](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/141)（TrOCR Model Management Parity）

**状態**: Completed / Closed（Investigation / Documentation only。Production実装は無し）。PR [#144](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/144)、Squash Commit `53eca2f`でマージ済み。

## 目的

OCR Crafterの永続データ・DB・モデルartifactについて、既存のBackup / Restore方針と運用安全性を実コード・実ファイル構成から棚卸しする。Production機能はいきなり追加せず、何をバックアップすればOCR Crafterを復旧できるか、復元順序・整合性・停止要否・破損時の扱いを明確化し、必要ならFeature/Bug Issueへ分割する。

## 重要な前提の訂正

Issue本文は「現時点で一貫したBackup / Restore手順が明確かは未確認」という前提で書かれているが、**実際には`services/backup_manager.py`によるプロジェクト単位のBackup / Restore機能が既に実装済みであり、`docs/BACKUP_AND_RESTORE.md`・`docs/25_DISASTER_RECOVERY.md`という専用ドキュメントも既に存在する**（Candidate Implementation OptionでいうOption Cに近いAPI/UI実装が既にある）。したがって本Investigationの実質は「ゼロから設計する」ではなく、**既存実装のスコープ・既知の穴・未検証の前提を棚卸しする**ことになった。この事実を最初に記録する。

## 1. Persistent Data Inventory

`data/`は全体が`.gitignore`対象（Git管理外・ローカル/サーバ固有の永続データ）。

| 項目 | 実体パス | Source of Truth? | Regenerate可能? | Backup必須? | 現状のBackup対象? |
|---|---|---|---|---|---|
| `data/projects/<id>/raw` `interim` `processed` | プロジェクト内 | Yes（元画像・前処理結果） | No（raw除去は再取込必要、processedのみ再生成可） | Yes | `full`のみ |
| `data/projects/<id>/annotations/master.csv` | プロジェクト内 | Yes（ラベル） | No | Yes | `metadata_only`/`full`両方 |
| `data/projects/<id>/dataset/` | プロジェクト内 | 半分（分割元があれば再生成可） | 概ねYes（annotations+processedから再分割可能） | 任意 | `full`のみ |
| `data/projects/<id>/models/*.tess.json` `*.ocr.json` `*.trocr.json`（sidecar） | プロジェクト内 | Yes | No | Yes | `metadata_only`/`full`両方 |
| `data/projects/<id>/models/**`（traineddata・inference_dir・trocr_runs等の実体） | プロジェクト内 | Yes（再学習しないと再現不可） | No | Yes | **`full`のみ**（`metadata_only`は`.json`以外を除外） |
| `data/projects/<id>/experiments.json` `releases.json` `benchmarks.json` `preprocess_config.json` | プロジェクト内 | Yes | No | Yes | `metadata_only`/`full`両方 |
| `data/projects/<id>/benchmark_center.json` | プロジェクト内 | Yes | No（Center比較条件は手動再構成が必要） | Yes | **`full`のみ（`metadata_only`は含まない＝§2で詳述する既知gap）** |
| `data/projects/<id>/inference_model.json` | プロジェクト内 | Yes（現在の推論使用モデル選択） | Yes（再設定は容易） | 低 | **`full`のみ（同上）** |
| `data/projects/<id>/outputs/**`（評価・プレビュー・OCRログ・OCRデータセット） | プロジェクト内 | 一部Yes（評価履歴等は再現不可） | 一部Yes（再評価は可能だが当時のCERの記録ではない） | 中 | `full`のみ |
| `data/projects/<id>/logs/` | プロジェクト内 | 低（診断用） | No（再現不可だが重要度低） | 低 | `full`のみ |
| `outputs/app.db`（`training_jobs`テーブル、Job System A） | リポジトリ直下 | Yes（Tesseract/PaddleOCR/TrOCR学習Jobの実行履歴・experiment_meta/training_condition_snapshotの一次記録） | No | Yes | **対象外（全project横断のグローバルDB。project単位のbackup_manager.pyのスコープ外）** |
| `data/jobs/job_manager.db`（Job System B、Issue #127） | `data/`直下 | Yes（preprocess/dataset-build等のJob実行履歴） | No | 中 | **対象外（同上）** |
| `data/jobs/events/` `data/jobs/logs/` | `data/`直下 | 低（診断用） | No | 低 | 対象外 |
| `data/audit/audit.jsonl` `counter.json` | `data/`直下 | Yes（監査証跡） | No | 用途次第（コンプライアンス要件があれば高） | **対象外（`25_DISASTER_RECOVERY.md`に明記済み）** |
| `data/model_ids.json` | `data/`直下 | Yes（全project共通の管理No採番簿） | 部分的（未採番分は再採番されるが、**厳密には既存番号の再現を保証しない**。§6参照） | 中〜高 | **対象外（未文書化の既知gap）** |
| `data/dataset_ids.json` | `data/`直下 | Yes（同上、DS0001採番簿） | 同上 | 中〜高 | **対象外（同上）** |
| `data/retention.json` | `data/`直下 | Yes（保持設定） | Yes（再設定は容易） | 低 | 対象外（低リスクのため許容） |
| `data/reports/`（`RPT-0001`成果物＋`index.json`） | `data/`直下 | 部分的（生成元データが変化/削除されると再現不可） | 部分的 | 低〜中 | **対象外（未文書化）** |
| `data/backups/`自体（既存Backup ZIP群＋`index.json`） | `data/`直下 | N/A（Backupそのもの） | N/A | Yes（別媒体退避） | `docs/BACKUP_AND_RESTORE.md`に明記済み（「OS側の運用で行う」） |
| `models/`（`tessdata_best` `yolo`等、project非依存） | リポジトリ直下 | No（外部配布物/ダウンロード可能） | Yes（再ダウンロードAPI・同梱物） | 低 | 対象外（regenerate可能なため妥当） |
| `data/train/` `data/eval/`（Jul 7時点の日付・現行コードから未参照） | `data/`直下 | 不明（レガシー/開発時fixtureの可能性が高い） | 不明 | 未評価 | 対象外（現行コードから参照される形跡なし。§7参照） |
| Frontend `localStorage`（サイドバー折り畳み・前処理UIパラメータ・評価スロット等） | ブラウザ内 | No（UI利便性のみ、業務データではない） | Yes | 不要 | 対象外（妥当。§Architecture Q5で明記） |
| `external/`（PaddleOCRリポジトリclone） | リポジトリ直下 | No | Yes（`git clone`で再取得） | 不要 | 対象外（妥当） |

## 2. SQLite Safety（`outputs/app.db` / `data/jobs/job_manager.db`）

| 項目 | `outputs/app.db`（System A, `db.py`） | `data/jobs/job_manager.db`（System B, `job_manager.py`, Issue #127） |
|---|---|---|
| journal mode | 既定（rollback journal。PRAGMA未設定） | **WAL**（`_connect()`で`PRAGMA journal_mode=WAL`を明示設定） |
| ファイルcopyの安全性 | 書込トランザクション中の単純copyは不安全（ページ途中状態を捕捉し得る） | **より不安全**。WAL下では最近のcommitが`-wal`ファイル側にのみ存在し、メインの`.db`ファイルだけをcopyすると**そのcommitが丸ごと欠落する** |
| `sqlite3.Connection.backup()`利用可否 | 利用可能（標準ライブラリ、Python 3.7+、追加依存なし） | 利用可能（同上、WALでも正しく動作する） |
| process停止要否 | Online Backup APIを使えば不要 | 同左 |

### 実証（本Investigationで実施したprobe、実データ非破壊・temp dirのみ）

一時DBをWALモードで作成し、コミット済みデータが`-wal`ファイル側にのみ存在する状態を作って比較した。

```
-wal file exists before copy: True size=12392
naive copy (main .db file only) sees rows: ERROR: no such table: t
sqlite3.Connection.backup() sees rows: [('committed-before-copy',)]
```

**単純な`.db`ファイルのみのcopyは、WALモードのDBに対しては「テーブルすら存在しない」レベルで壊れる**ことを実証した。`sqlite3.Connection.backup()`（Python標準の Online Backup API）はjournal modeに関わらず正しく全データを捕捉する。

### 結論

- どちらのDBも**現状バックアップ対象に一切含まれていない**（backup_manager.pyのスコープはproject単位のみで、`outputs/`・`data/jobs/`はスコープ外）。これは`25_DISASTER_RECOVERY.md`に「`data/jobs/` `data/audit/`はバックアップ対象外」と明記されているが、**`outputs/app.db`は同リストに含まれておらず、記載漏れ**であることを確認した（§8で訂正）。
- 単純なファイルcopyは**両DBとも不安全**（System Aは書込タイミング次第、System Bは常時WALのため一段と不安全）。安全な方式は`sqlite3.Connection.backup()`の利用であり、Application停止は不要。新規依存パッケージも不要（標準ライブラリのみ）。

## 3. File Artifact Consistency

- **JSON登録簿・sidecar（`releases.json`/`experiments.json`/`*.tess.json`/`*.ocr.json`/`*.trocr.json`/`model_ids.json`/`dataset_ids.json`等）は`atomic_io.py::atomic_write_json`（tmp書込→`os.replace`）で保護されている**。バックアップがこれらのファイルを読むタイミングと書込タイミングが重なっても、旧内容か新内容の完全な状態のいずれかしか観測されない（torn writeは発生しない）。
- **directory artifact（TrOCRの`model_dir`＝`save_pretrained()`出力、PaddleOCRの`inference_dir`）はディレクトリ単位でのatomic swapではない**。`trocr_training_core.py`を確認したところ、`output_dir.mkdir()` → `model.save_pretrained(output_dir)` → `processor.save_pretrained(output_dir)`という複数ファイルへの逐次書込であり、ディレクトリ全体を差し替えるような原子的操作はない。**ただしこのディレクトリはtraining loop完了後の最終保存ステップでのみ作成される**（学習中は存在しない）ため、backupが不完全なartifactを捕捉するリスクの時間窓は「学習全体」ではなく「最終保存の数秒程度」に限定される。
- sidecar登録（`register_trocr_model()`等）はartifact保存成功の**後**に行われるため、この短い時間窓でbackupが走ると「sidecarが無いのにartifact directoryだけ存在する」孤立ディレクトリを捕捉する可能性があるが、これは無害（起動時に自動認識されない未登録ディレクトリとして残るのみ）。
- **画像ファイル（raw/interim/processed）もPIL `.save()`で直接書込まれており、atomic_write経由ではない**ことを確認した（`data_manager.py`/`preprocess.py`）。大量の画像を書込中にbackupが走ると、理論上は書込途中の画像ファイルを捕捉するリスクがある（ただし1ファイルあたりの書込は数msオーダーで、実害の確認された報告はない）。
- backup_manager.pyの`_collect_backup_files()`は「ファイル一覧を確定 → 順に`read_bytes()`」という2段階処理であり、**ファイル一覧確定後にモデル削除（`delete_model()`）が割り込むと、既に一覧に含まれるファイルの`read_bytes()`が`FileNotFoundError`で失敗しうる**（backup全体が失敗する。部分成果物は`.tmp`のまま残り正式パスへ昇格しないため、既存の原子的リネームにより「壊れたbackup ZIPが正式に残る」ことはないが、backup作成自体が失敗する）。この競合はテストされていない（`test_backup_retention.py`に該当ケースなし）。

## 4. Running Jobs

| 状況 | Backup実行の安全性 |
|---|---|
| Training Job実行中（Tesseract/PaddleOCR/TrOCR） | 概ね安全。artifact directoryは完了直前まで存在しないため、`full`バックアップは「未完了Job」を中途半端な状態で含めることはほぼない。ただし§3の画像書込・最終保存の短い時間窓のリスクはゼロではない |
| Benchmark Job実行中 | `benchmarks.json`はatomic_write保護のため安全。実行中の一時ファイルは`paths.outputs`配下で完結し、backup対象に含まれても実害は小さい |
| report generation中 | `data/reports/`はbackup対象外（そもそも捕捉されない） |
| dataset creation中（Step1〜4） | 画像書込（§3）と同じリスクを持つ。加えて分割中の`dataset/`ディレクトリを部分状態で捕捉する可能性がある（再分割で復旧可能なため実害は小さい） |

**「backup前にjobを止める」ことは必須ではない**という結論。JSON登録簿は原子的書込で保護されており、directory artifactの生成タイミングもJob完了直前に限定されるため、多少のタイミング依存はあっても「barrelバックアップが恒常的に壊れる」ような設計ではない。ただし、月次のリストア試験（`25_DISASTER_RECOVERY.md` §5）はアクティブJobが無いタイミングで行うことを推奨する（既存docsには未記載のため§9で追記提案する）。

## 5. Restore Order

現状の`restore_backup()`はproject単位の完結した処理であり、他コンポーネントとの復元順序調整は不要（1リクエストで完結）。ただし**フルシステム復旧**の観点では以下の順序が必要になる（現状は`25_DISASTER_RECOVERY.md` §4に部分的に記載済み）。

1. アプリ配備（バイナリ・依存関係。docs/24）
2. `data/backups/`をリストア先サーバーへ配置（`index.json`含む）
3. Backend起動（`outputs/app.db`・`data/jobs/job_manager.db`は`CREATE TABLE IF NOT EXISTS`で自動初期化されるため、無くてもクラッシュしない。ただし**Job実行履歴は失われる**）
4. `data/model_ids.json`・`data/dataset_ids.json`を別途保全していた場合は配置（無ければ次回一覧取得時に未登録分が新規採番される。既存番号の厳密な再現は保証されない）
5. project単位で`verify` → `restore`（`docs/25_DISASTER_RECOVERY.md` §3の手順）
6. **§6で詳述する既知バグにより、復元直後のTesseract/PaddleOCR/TrOCRモデルは復元先project内の実体を正しく参照できない**（後述）

`job_manager.db`/`outputs/app.db`は現状の設計では**restore必須ではない**（無くても起動・新規Job実行は可能）が、**過去のJob実行履歴・失敗診断情報は完全に失われる**。

## 6. Identity / Lineage Integrity（最重要の発見）

### 実証済みの既知バグ: Restore後、モデルsidecarの絶対パスが復元先を指さない

`resolve_tesseract_model_meta()`/`resolve_ocr_model_meta()`（`model_registry.py`）・TrOCRの`list_trocr_models()`はいずれも、sidecar JSON内の`model_dir`/`tessdata_dir`/`inference_dir`フィールドを**書込まれた時点の絶対パス文字列のまま**返す（読み出し時に現在のproject rootへ対して再解決するロジックは無い）。一方`restore_backup()`はZIP内の相対パス（`project/<relative>`）をそのまま新しいproject rootへ書き出すのみで、**sidecar JSON内部の絶対パス文字列を書き換えない**。

本Investigationで実際にprobeし、以下を実証した（実データには一切触れず、tempディレクトリのみで実行）。

```
source project_id='probe_src'  restored project_id='probe_src_restored_1'
restored sidecar's model_dir field:      ...\data\projects\probe_src\models\trocr_runs\job-1
actual physical location after restore:  ...\data\projects\probe_src_restored_1\models\trocr_runs\job-1
actual physical directory exists:         True
sidecar's model_dir field points there?:  False
sidecar's model_dir field still == OLD src path?: True
```

**影響**: `full`モードでbackup/restoreしたproject内のTesseract/PaddleOCR/TrOCRモデルは、復元先projectでは実質的に壊れている。

- ダウンロード・削除・推論・評価はすべてsidecarの`model_dir`/`tessdata_dir`/`inference_dir`を信頼して読むため、元のprojectが既に存在しない場合（真の障害復旧シナリオ）は`FileNotFoundError`（404）になる
- **元のprojectが同一マシン上にまだ存在する場合（例えば「試しにリストアしてみる」運用）は、復元先projectの操作が誤って元projectの現在の実体を読み書きしてしまう**（download_model_endpoint等は読み取りのみなので実害は限定的だが、意図に反して復元先が独立した実体を持たない）
- これは既存のRelease参照（`releases.json`の`model`フィールドはファイル名のみで健全）自体は壊れないが、その先の実artifactの解決が壊れるという、layerの異なる問題である

この不具合は`test_backup_retention.py`のシードデータ（`{"lang": "x"}`のみでmodel_dir/tessdata_dirを持たない）では顕在化しないため、**既存テストに一切引っかからず未発見のまま存在していた**。

### Architecture Question 6の回答に直結する

このバグにより、「restore後にproject id/dataset id/training job id/model id/artifact path/release reference/benchmark・evaluation linkage/experiment lineageが壊れないか」という問い（Mandatory Investigation §6）への回答は明確に **「artifact pathが壊れる」** である。他の識別子（project_id自体は新規採番、dataset_id/model_id/job_idの文字列表現、release/benchmark/experimentの記録内容そのもの）はファイルコピーとして正しく復元されるが、**それらが指し示す先（artifact本体）への到達性が壊れる**。

## 7. Cross-machine Restore

- 上記§6のバグは同一マシン内の復元でも顕在化するため、cross-machine restoreは**現状「正式サポート外」と判定するのが適切**（同一マシンより悪化はしないが、同一マシンで既に壊れている機能を他マシンでサポート対象と謳うべきではない）
- `local_files_only`（TrOCR）・Hugging Faceモデルキャッシュ等の外部依存は、cross-machine環境では別途キャッシュ再構築が必要になる（`base_model_ref`がHugging Face Hub上のIDであれば再ダウンロードで解決するが、`local_files_only=true`で運用していた環境ではキャッシュそのものを移送する必要がある。これは本Investigationのスコープでは深追いしない）
- Windows path separator自体はPython `pathlib`が吸収するため、Windows間の移送であれば大きな問題にはならないが、上記のsidecar絶対パス問題は解消しない

## 8. Existing Documentation Audit

| ドキュメント | 状態 |
|---|---|
| `docs/BACKUP_AND_RESTORE.md` | 現行実装と一致。ただし「対象外データ」列にproject横断のグローバルデータ（`outputs/app.db`・`model_ids.json`・`dataset_ids.json`・`data/reports/`）への言及が無い |
| `docs/25_DISASTER_RECOVERY.md` | §4「`data/jobs/` `data/audit/`はバックアップ対象外」の一覧に**`outputs/app.db`が抜けている**（本Investigationで確認した記載漏れ。§9で修正） |
| `docs/QUICK_START.md` / `docs/FAQ.md` | 既存記述は実装と齟齬なし |
| `docs/02_DIRECTORY_STRUCTURE.md` | `model_ids.json`/`dataset_ids.json`/`app.db`の存在自体は記載済みだが、Backup/Restoreとの関係には触れていない |
| Known Limitations | 専用の一覧ページなし（各docsに分散）。今回の発見（§6のバグ）は次のBug Issueで正式にKnown Limitationとして記録すべき |

## Architecture Questions（15問）

1. **最小backup unitは何か** — project単位（`data/projects/<id>/`）。ただしこれだけでは「その projectで使われたグローバルID採番簿」「Job実行履歴」を含まない。
2. **app.dbだけのbackupでどこまで復旧可能か** — ほぼ何も復旧できない。Job実行履歴（誰がいつ何を学習させたか）のみで、モデル本体・ラベル・実験記録は一切含まれない。
3. **project directoryだけのbackupでどこまで復旧可能か** — `full`モードなら画像・ラベル・モデルsidecar+実体・実験/リリース/Benchmark記録まで復旧できる**はずだが、§6のバグにより実際にはモデル本体への到達性が壊れる**。バグ修正後であれば「ほぼ全機能」が復旧可能な単位になる。
4. **job_manager.dbは必須かoptionalか** — optional。無くても起動・新規Job実行に支障はない（`CREATE TABLE IF NOT EXISTS`で自動初期化）。失われるのは実行履歴・診断情報のみ。
5. **frontend localStorageはbackup対象に含めるべきか** — 含めるべきではない。UI利便性状態のみで業務データが無いため、失っても再設定で回復できる。
6. **backup時にapplication停止は必要か** — 不要。§3・§4の分析どおり、JSON登録簿はatomic書込で保護され、directory artifactの生成タイミングも限定的。SQLiteも`sqlite3.Connection.backup()`を使えば停止不要。
7. **SQLite online backupで十分か** — 十分。§2で実証済み。単純ファイルcopyは不十分（WAL下では致命的に不十分）。
8. **model sidecar + artifactはどの単位で整合性を保証すべきか** — sidecar1件＋そのdirectory artifact1件を常にペアで扱うべき（現状のbackup/restoreは物理コピーとしてはペアを保っているが、§6のバグにより論理的な参照が壊れる）。
9. **release metadataとmodel artifactのrestore順序** — 順序は無関係（同一ZIP内に両方含まれ、同時に展開される）。問題は順序ではなく§6のパス書換の欠落。
10. **cross-machine restoreを正式supportすべきか** — 現時点ではNo。§6のバグを修正し、同一マシン内restoreが完全に機能することを確認してから検討すべき。
11. **backup manifest/checksumを導入する価値はあるか** — **既に導入済み**（Manifest v2、SHA-256 per-file）。追加の価値は限定的（十分な水準に既に到達している）。
12. **restore dry-run/validationは必要か** — 部分的に既にある（`verify_backup()`が復元前検証として機能）。「dry-run展開して壊れたパス参照を検出する」機能は無く、§6のバグ検出には効果がない（そもそもzip自体は正しいため）。
13. **automatic scheduled backupは必要か** — 現状はOS側のタスクスケジューラに委ねる設計（`docs/BACKUP_AND_RESTORE.md`に明記済み）。アプリ内蔵化の緊急性は低い。
14. **retention policyは必要か** — **既に実装済み**（`data/retention.json`、Job/監査ログの保持日数設定）。backup ZIP自体の世代管理は未実装（ファイル操作に委ねる設計、ドキュメント化済み）。
15. **次の最小実装Issueは何か** — 下記「Next Issue Split」を参照。

## Recommended Option

**Option A（Documentation-only）はもはや妥当ではない**（既にOption Cに近い実装が存在するため）。今回のRecommended Outputは「既存実装の是正」という第4の実質的選択肢になる。

- **最優先で推奨**: §6で発見した「restore後にmodel sidecarの絶対パスが復元先を指さない」バグの修正（Bug Issue）。既存のRestore機能の**正しさ**に関わる問題であり、機能追加ではなく既存契約の是正。
- 次点: `outputs/app.db`・`job_manager.db`のSQLite online backup対応（新しいFeature、`sqlite3.Connection.backup()`の追加、新規依存なし）
- 次点: `_METADATA_FILES`への`benchmark_center.json`・`inference_model.json`追加（小さな修正）
- 低優先: `model_ids.json`/`dataset_ids.json`のbackup対応（global fileのため、project単位のbackup契約とは別の設計判断が必要）

## Next Issue Split（提案、本Investigation内では起票しない）

1. ~~**[Bug] Backup Restore: モデルsidecarの絶対パスが復元先projectを指さない**（§6）。最優先。既存のRestore機能の正しさに関わる。修正方針: restore時にsidecar JSON内の既知パスキー（`_MODEL_DIR_META_KEYS`と同じ集合）を、旧project rootから新project rootへの文字列置換で書き換える。~~ → **Bug #145で修正済み（Completed / Closed）**。単純な文字列置換ではなく、`Path.parts`単位でsource project idをanchorとして特定し、実在・containment検証を経てから書き換える方式を採用した。詳細: `docs/workitems/operations/RESTORE_MODEL_SIDECAR_PATH_REBASE_145.md`
2. ~~**[Feature] outputs/app.db・job_manager.dbのオンラインバックアップ対応**。`sqlite3.Connection.backup()`を使った専用のbackupモード（または既存`create_backup()`への追加コンポーネント）を設計する。~~ → **Feature #147で実装済み（Completed）**。既存`create_backup()`とは責務分離した新規モジュール`services/sqlite_backup.py`（UI/APIなし）として実装した。詳細: `docs/workitems/operations/SQLITE_ONLINE_BACKUP_147.md`
3. ~~**[Feature] metadata_onlyバックアップへbenchmark_center.json・inference_model.jsonを追加**。小規模な`_METADATA_FILES`拡張。~~ → **Feature #150で実装済み（Completed）**。調査の過程で`preprocess/`ディレクトリ（確定済み前処理設定＋履歴）も同基準を満たすことが判明し、あわせて追加した。詳細: `docs/workitems/operations/METADATA_ONLY_BACKUP_COVERAGE_150.md`

3件は独立して実装可能（依存関係なし）。優先順は上記の番号順を推奨する。

## Operational Runbook Draft（現状ベース、§9のdocs修正後に本採用）

1. 日次: `POST /api/backups`（`metadata_only`）をOSタスクスケジューラで実行
2. 週次: `POST /api/backups`（`full`）を同様に実行
3. 月次: 最新`full`バックアップで`verify` → `restore`（新Project ID）→ モデル評価1回実行して既知CERと一致確認 → 試験用復元プロジェクトを削除
   - **本Investigationの発見を踏まえ、この月次試験手順にモデルダウンロード/削除の動作確認も追加すべき**（§6のバグは通常のverify/restoreでは検出できず、実際にモデルをダウンロードしようとして初めて顕在化するため）
4. `outputs/app.db`・`data/jobs/job_manager.db`は現状の機能ではバックアップ対象外。長期保管が必要な場合は運用側で`sqlite3`標準ライブラリの`Connection.backup()`を使った独自スクリプトを用意するか、Feature Issue #2の実装を待つ
5. `data/model_ids.json`・`data/dataset_ids.json`も同様に運用側でのファイルコピー退避を推奨（停止不要、`atomic_write_json`保護によりコピー中の破損リスクは低い）

## Recommended Output（Issue本文が明示要求する5項目）

1. **現時点で推奨するbackup/restore方式**: 既存の`backup_manager.py`（project単位、`metadata_only`/`full`、Manifest v2 SHA-256検証）を土台として維持しつつ、§6のバグを最優先で修正する。DBは`sqlite3.Connection.backup()`による専用対応を追加する。
2. **手動手順だけで十分か、Feature実装が必要か**: §6のバグ修正は**Feature実装が必要**（既存コードの修正）。DB backup対応も同様にFeature実装が必要（現状は手動手順すら確立していない＝ドキュメント化されていない）。
3. **Feature実装する場合の次Issue一覧と順序**: 上記「Next Issue Split」の3件、番号順。
4. **application停止要否**: 不要（§4・§2の分析どおり）。
5. **cross-machine restore support可否**: 現時点では**不可（正式サポートしない）**。§6のバグ修正後に再評価する。

## Tests / Verification

Production変更が無いため新規テストは追加していない。本Investigationの主張はいずれも実コード確認＋temp環境でのprobe（実データ非破壊、tempディレクトリのみで実行、実行後に削除）で実証済み（§2・§6の実測結果を参照）。

- `outputs/app.db`のsha256チェックサムをprobe前後で比較し不変を確認済み
- probeはtempfile.TemporaryDirectory()内でのみ動作し、`data/projects/`実体には一切触れていない
- probe scriptは調査完了後に削除済み（コミット対象ではない）

## Documentation

- 本ファイル新規作成
- `docs/25_DISASTER_RECOVERY.md`: §4のバックアップ対象外一覧へ`outputs/app.db`・`model_ids.json`・`dataset_ids.json`を追記（記載漏れの是正）、§3へ§6の既知バグの注記を追加
- `docs/BACKUP_AND_RESTORE.md`: §8の制約一覧へ同様の記載漏れ是正・既知バグ注記を追加
- `docs/workitems/roadmap/NEXT_DEVELOPMENT_ROADMAP_REFRESH_139.md`: Issue #143自体はInvestigation #139のCandidate Themes一覧（TrOCR Model Management Parity等5テーマ）には含まれておらず、同ドキュメントに本Investigationと直接対応する記載が無いため、今回は更新していない（正確性を優先し、無関係な追記はしない）

## Scope外（Out of Scope、実施しなかったこと）

- Backup/Restore Production実装（§6のバグ修正含む。次Issueへ分割）
- cloud backup / object storage
- encryption/key management
- scheduled backup daemon（アプリ内蔵化）
- Epic #28 Consumer Migration
- UI全面redesign

## Future Work

上記「Next Issue Split」の3件はすべて対応済み: 1件目（絶対パスのrestore時書換）はBug #145、2件目（SQLite online backup対応）はFeature #147、3件目（`metadata_only`対象拡張）はFeature #150。Investigation #143の推奨事項はこれで完結した。
