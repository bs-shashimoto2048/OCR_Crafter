# Post-TrOCR E2E Final Closure & Roadmap 作業記録

Related: Investigation [#166](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/166) / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合、Closed） / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure、Open） / Validation [#164](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/164) / #141, #143〜#165

**状態**: Completed / Closed。PR [#167](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/167)、Squash Commit `e60d13d`でマージ済み。

## 目的

Issue #164（TrOCR End-to-End Production Workflow Validation、Final Readiness Decision: READY）の完了を起点として、Epic #27以降連続してきた開発フェーズ（Issue #123〜#165）全体が現在のmain上で実際に整合し、正式に終了してよい状態にあるかを棚卸しする。新機能実装・改善実装は行わない（本Issue自身がProduction変更を行わない投資調査であるため）。

## 実行方法についての注記

現在のmain（`441cabc`、`origin/main`と同期済み）を正として、実コード（`grep`/`git log`）・GitHub Issue/PR状態（`gh issue view`/`gh pr view`/`gh issue list`）・関連ドキュメントを直接確認した。branchは作成せず、Productionコードの変更は一切行っていない。

## 1. TrOCR Lifecycle

- Issue #164で発見・修正した3件（Blocker×2・Major×1、`_load_processor()`・`_backfill_config_token_ids()`・`_same_model_ref()`）が現在のmainに存在することを`src/app/services/trocr_engine.py`・`src/app/services/release_gate.py`で直接確認した
- TrOCR関連テスト（`test_trocr_engine.py`等10ファイル）・Release Gate関連テスト（`test_release_gate_trocr.py`等）を再実行し、回帰がないことを確認した（詳細は§Tests参照）
- Issue #164のE2E実行で作成した実際の証跡（専用プロジェクト`trocr_e2e_164`の学習済みモデル・`releases.json`のProduction Release `REL-0001`・`benchmarks.json`）が、その後の変更（PR #165のマージ・docs更新）によって失われていないことをファイルシステム上で直接確認した

**結論**: Issue #164でREADYとなったTrOCR E2Eの状態は、現在のmain上でも変わらず成立している。証跡・実装・テストのいずれにも劣化がない。

## 2. Epic #27（TrOCR学習・評価・Benchmark・Release Gate統合）

- GitHub上の状態: `CLOSED`（`gh issue view 27`で確認）
- Epic本文に列挙された全機能領域（Training/Evaluation/Benchmark/Release Gate/Documentation）はすべて✅マーク済みで、詳細は`docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`（166行）に記録されている
- **重要な補足事実**: Epic #27がCloseされた時点（Issue #106）では、TrOCR関連の全単体テストが`fake_transformers`モックを使用しており、**実際のHugging Face Hub上の公式checkpointを使った実行は一度も検証されていなかった**。Issue #164のE2E実行で初めて、実checkpointに対するTraining/Inference/Evaluation/Benchmark/Release Gateの全経路が実際に機能することが検証され、その過程で発見された2件のBlocker（`transformers`バージョン起因のtokenizer解決失敗・`config.pad_token_id`欠落）が修正された
- つまりEpic #27は「実装・設計としては完結していたが、実checkpointに対する実動作検証はIssue #164で初めて完了した」という位置づけが正確であり、**現時点でEpic #27は実装・ドキュメント・GitHub状態・実動作検証のすべてにおいて完了している**

**結論**: Epic #27は実装・ドキュメント・GitHub状態のすべてで完了している（Issue #164による実動作検証の完了をもって、最終的な完成根拠が確定した）。

## 3. Model Management

- Model Manager表示（Issue #141・`mergeTrocrModelsIntoList()`）・Dataset Manager・Model Metadata（`ModelMetadata` dataclass）まわりで、Issue #141以降の新たな矛盾は見つからなかった
- `GET /models/info`が`.trocr.json`をglobしない設計（Feature #96・Issue #108・#121で確認済み）は、Issue #164のPhase 3で改めて実データにより再確認され、変化がないことを確認した
- `tests/test_trocr_model_registry.py`・`tests/test_dataset_registry.py`を再実行し、回帰なしを確認した

**結論**: Model Managementに新たな矛盾なし。

## 4. Job Lifecycle（#123〜#135）

- Issue #123（Job Lifecycle Unification Architecture Investigation）〜#135（Shared Job Facade Implementation Readiness）まで、GitHub上ですべて`CLOSED`/`MERGED`であることを確認した（`gh issue view`/`gh pr view`を#123〜#136で実行）
- `docs/workitems/jobs/SHARED_JOB_FACADE_READINESS_135.md`（Issue #135の最終成果物）に、以下の明示的な結論が記録されていることを確認した:
  > 本Investigationの結論により、Architecture Investigation #123から続く一連のJob Lifecycle関連調査・改善は完結したと判断する。今後新たな具体的動機が生じない限り、追加のJob Lifecycle関連Investigationは不要
- これは「Job System A（`outputs/app.db`training_jobs）とJob System B（`data/jobs/job_manager.db`JobManager）を統一Facadeへ統合しない」という**意図的なアーキテクチャ決定**であり、放置された未完了作業ではない
- Issue #164のE2E実行で両Job Systemへ実際に書き込みが発生した後も（training_jobs 29→32件、job_manager_jobs 0→1件）、両DBの`PRAGMA integrity_check`は`ok`のままであることを確認した

**結論**: #123〜#135のJob Lifecycle改善後に重大な未解決事項は残っていない（「統合しない」という決定自体が正式な結論であり、ギャップではない）。

## 5. Backup/Restore・Data Safety（#143〜#162）

- Issue #143（Investigation）〜#162（SQLite Global DB Restore Runbook）までの全Issue/PRが、GitHub上ですべて`CLOSED`/`MERGED`であることを確認した（#143〜#165を`gh issue view`/`gh pr view`で個別確認）
- roadmap文書のフォローアップリンクチェーン（#139→#152→#160→#162）が正しく接続されていることを`docs/workitems/roadmap/POST_SAFETY_HARDENING_ROADMAP_REFRESH_160.md`で確認した
- 関連テスト（`tests/test_sqlite_online_backup.py`・`tests/test_sqlite_restore.py`・`tests/test_backup_retention.py`）を再実行し、回帰なしを確認した

**結論**: #143〜#162のBackup/Restore・Data Safety改善後に重大な未解決事項は残っていない。

## 6. filesystem/path safety（#154〜#158を含む）

- `src/app/project_paths.py`（`safe_rmtree`）・`src/app/services/model_registry.py`（`delete_model`）・`src/app/services/backup_manager.py`（`restore_backup`）の変更履歴を確認したところ、Issue #157（#156の修正）以降、これらのファイルに変更が加えられていないことを`git log`で確認した（Issue #158はテストのみの追加で、Production変更はゼロだったため、これらのファイルには履歴が現れない。これも想定どおり）
- `tests/test_project_id_validation.py`（27件）・`tests/test_safe_recursive_deletion.py`・`tests/test_model_deletion_shared_reference_safety.py`・`tests/test_output_dir_safety.py`・`tests/test_restore_model_sidecar_path_rebase.py`を再実行し、**84 passed**（回帰なし）を確認した
- Issue #164のE2E実行で新規作成したproject_id（`trocr_e2e_164`）も、`normalize_project_id()`の既存検証規則（英数字+アンダースコア、path traversal禁止等）に自然に適合しており、新たなpath safety上の懸念を生んでいない

**結論**: #154〜#158を含むfilesystem/path safety改善は完結している。

## 7. Documentation

現在のmain上のdocsを実装・GitHub状態と突き合わせ、以下を確認した。

- **既知のstale docs（Issue #164で発見済み、未対応のまま）が現在も存在することを再確認した**（意図的に未修正のまま、Future Backlog §9参照）:
  - `docs/06_API_REFERENCE.md`の`GET /api/experiments`説明にある「`model_engine`（学習エンジン。現状は`tesseract`固定）」という記述は、実際にはTrOCR学習でも`model_engine: "trocr"`が正しく記録される（Issue #164のPhase 7で実証済み）実態と乖離したままである
  - `docs/06_API_REFERENCE.md`の`GET /api/benchmarks/engines`説明にある「対応= tesseract_model / tesseract_base / paddleocr_official のみ」という記述は、実際には`benchmark.py::ENGINE_CATALOG`で`paddleocr_custom`・`trocr`も`implemented: true`である実態と食い違ったままである
- **新たに発見した軽微な文書上のギャップ**:
  - `docs/workitems/reliability/SQLITE_GLOBAL_DB_RESTORE_RUNBOOK_162.md`に、後続のIssue #164へのフォローアップリンクが記載されていない（本開発フェーズで確立された「roadmap文書は次に実施されたIssueへのフォローアップリンクを追記する」という慣習が、Issue #162→#164間では適用されなかった。Issue #164は#162からの直接推奨ではなく別文脈（Reliability完了後の実ユーザー検証）から起票されたため、厳密には「壊れたリンク」ではないが、慣習上は追記があってもよかった）
  - `docs/13_QA_STATUS.md`に、`test_batch_inflight_share_same_key`が本開発フェーズ中に複数回（Issue #152・#156・#164/#165）独立に再確認された既知flakeであるという事実が一切記録されていない（§9・§既知Flake参照）

**結論**: Documentationは概ね実装と整合しているが、上記2件の既知stale docs（Issue #164で発見済み・対応未着手のまま）と、2件の軽微な新規ギャップが見つかった。いずれもBlocker/Majorではない（Future Backlog §9へ記録）。

## 8. Open Issue/Epic

- `gh issue list --state open`で確認した現在のOpen Issue/Epicは、本Issue自身（#166）を除くと**Epic #28（Unified Model Metadata Infrastructure）のみ**である
- Epic #28の本文は「`ModelMetadata` dataclassは実装済みだが実コードへ一切配線されていない」と記載しているが、実際に調査したところ、**`models_api.py`/`model_catalog.py`/`metadata_reader.py`/`metadata_writer.py`/`training_metadata_factory.py`/`legacy_metadata_adapter.py`という、`ModelMetadata`を実際に読み書きする一連のConsumer層モジュール（Issue #110/#111で追加、いずれも専用テストあり）が既に存在する**ことを確認した。ただし`src/app/main.py`（実際に稼働するFastAPIアプリ）はこれらのいずれも一切import/参照しておらず、**実際のHTTPリクエスト経路からは完全に到達不能（生きたコードではない）**ことを`grep`で確認した。これはEpic #28の「実コードへ一切配線されていない」という記述と矛盾しない（Consumer層のコード自体は書かれているが、配線＝実際のAPI/main.pyへの接続がされていない、という正確な状態）
- この事実は「Epic #28に必要な実装量が思ったより少ない（Consumer層は既に書かれている）」ことを示す一方、「それでも尚、この既に書かれたConsumer層をmain.pyへ接続する具体的な必要性・動機が、Issue #145/#150/#154/#164のいずれの機会でも一度も生じなかった」ことも同時に示している

**結論**: Open Issue/Epicと現在のmainに矛盾はない（Epic #28の記載は現在も正確）。Epic #28自体の再判定は§10参照。

## 9. 既知Flake

- `test_batch_inflight_share_same_key`（`tests/test_preview_batch.py`）について、以下の証拠を独立に収集した:
  - 本Issue調査時点でローカル（`.venv`）で**8回連続実行し8/8成功**
  - GitHub Actions上の直近15回のmain branch CI実行（2026-08-20〜2026-08-21）はすべて`success`（`gh run list --branch main`で確認）——このテストが**main上で実際にCI失敗を引き起こした記録はない**
  - 本開発フェーズ中、Issue #152・#156・PR #165（Issue #164由来）の3回、いずれもPRのCI実行中に独立に再現し、その都度「本PRの差分と無関係・ローカルで安定して成功・`gh run rerun --failed`で成功」という同一の証拠パターンで既知flakeと判断されている
  - テストコード自体を確認したところ、2つのスレッドを`t1.start(); t2.start()`と連続起動し、`t2`が`t1`のin-flight登録を観測できるかどうかというOSスレッドスケジューリングの実際のタイミングに依存する設計になっており（明示的な同期バリアなし）、CI環境のCPU負荷変動により偶発的に失敗しうることがテストコード自体からも裏付けられた

**結論**: `test_batch_inflight_share_same_key`はClosureを妨げる性質のものではない。実際のProduct機能（同一キー推論のin-flight共有）は正しく動作しており、テスト自体のタイミング設計に起因する非決定的な失敗であることが、本開発フェーズ中の3回の独立した確認・本Investigationでの追加確認（8/8ローカル成功・直近15回のmain CI実行すべてsuccess）により十分に裏付けられている。

## 10. Epic #28（Unified Model Metadata Infrastructure）再判定

### 現在のProduction Consumer

- `ModelMetadata` dataclass自体、およびそれを読み書きするConsumer層一式（`metadata_reader.py`/`metadata_writer.py`/`model_catalog.py`/`models_api.py`/`training_metadata_factory.py`/`legacy_metadata_adapter.py`）は実装・テスト済みだが、**`main.py`（実際に稼働するAPI）からは一切参照されていない**（§8で確認済み）
- 現在のProduction Consumerは**ゼロ**である

### 実際の必要性（本開発フェーズ全体を通じた実証的評価）

- Issue #145（Restore Model Sidecar Path Rebase）・#150（Metadata-Only Backup Coverage拡張）・#154（Model Deletion Robustness）は、いずれも既存の`_MODEL_DIR_META_KEYS`のような**小さな汎用registryパターンの再利用**で完結し、Unified Metadata基盤を必要としなかった
- Issue #164（TrOCR E2E Production Workflow Validation）は、TrOCRの`.trocr.json`sidecarパターン（既存`.tess.json`/`.ocr.json`を踏襲した、Unified Metadata基盤とは別の設計）でTraining→Model Manager→Inference→Evaluation→Benchmark→Release Gate→Deploymentの全経路が実際に機能することを実証した。この過程で発見された3件のBlocker/Majorは、いずれもModel Metadata表現方式そのものとは無関係（`transformers`バージョン互換性・Release Gateのpath文字列比較）であり、**Unified Metadata基盤があれば防げた・容易になったという具体的な証拠は本E2E検証を通じて一切見つからなかった**
- 既に書かれたConsumer層（Issue #110/#111）がある一方、それを実際に接続する具体的な動機は、本開発フェーズを通じて一度も発生しなかった

### 再判定

**Continue Hold（保留継続）。**

根拠:
1. Production Consumerが依然としてゼロである
2. 本開発フェーズ中、少なくとも4件の独立した機会（#145/#150/#154/#164）で「統一Metadata基盤が必要か」を実質的に問い直す状況があったが、いずれも既存の軽量な仕組みで解決でき、統一基盤を要する具体的Production problemは一度も生じなかった
3. 既に書かれたConsumer層（Issue #110/#111）は無駄にはなっていない（配線するだけで再利用可能な状態を保っている）ため、「保留」を続けることによる追加コストは小さい
4. Closeへ倒すには「今後もこのEpicの目的（Training→Metadata→Models→Inference→Evaluation→Deployment→Exportの単一Source of Truth化）を放棄してよい」という積極的判断が必要だが、本Investigationはそこまでの根拠（アーキテクチャ上不可能・不要と確定した等）を発見していない
5. Resumeへ倒すには「今すぐ着手すべき具体的Production problem」が必要だが、これも見つかっていない

**Resume条件（今後Continue HoldからResumeへ移す際の具体的トリガー候補、実装はしない）**: 新しいOCR engineの追加、または既存の per-engine sidecarパターンの重複が実際に具体的なバグ・運用障害を引き起こした場合。

## 発見したFuture Backlog（本Issue内では実装しない）

「今回のフェーズを閉じるために必要なもの」は**存在しない**（下記はすべて次期開発で検討すればよい候補）。

| # | 内容 | Severity | Priority | Rationale |
|---|---|---|---|---|
| 1 | `docs/06_API_REFERENCE.md`のExperiment Tracking `model_engine`記述訂正（「現状はtesseract固定」→実際はTrOCRでも正しく記録される） | Minor（docs乖離のみ、実装への影響なし） | P2 | Issue #164で既に発見済み・Future Work記録済みの再確認。誤解を招くが機能には影響しない |
| 2 | `docs/06_API_REFERENCE.md`のBenchmark Runner対応エンジン一覧訂正（`paddleocr_custom`/`trocr`が`implemented: true`である実態の反映） | Minor（docs乖離のみ） | P2 | 同上、Issue #164で既に発見済み |
| 3 | `docs/workitems/reliability/SQLITE_GLOBAL_DB_RESTORE_RUNBOOK_162.md`へIssue #164へのフォローアップリンク追記 | Suggestion | P3 | 慣習上の軽微な文書一貫性の欠落。機能・判断への影響なし |
| 4 | `test_batch_inflight_share_same_key`の既知flake状態を`docs/13_QA_STATUS.md`等へ正式に記録する | Suggestion | P2 | 本開発フェーズ中3回独立に再調査され同じ結論に至っている。記録があれば将来の調査コストを削減できる |
| 5 | Epic #28: 既に書かれたConsumer層（`models_api.py`等）をmain.pyへ接続するかどうかの判断 | N/A（Epic自体の設計判断） | P3（Continue Hold中は着手不要） | §10参照。具体的Production problemが発生した時点でP1へ格上げを検討 |

## Final Readiness Decision

### READY TO CLOSE

今回のTrOCR統合＋関連リファクタリング＋Reliability/Data Safety改善フェーズ（Epic #27・Issue #123〜#166）を正式に終了してよい。

**根拠:**

1. Issue #164でREADYとなったTrOCR E2Eの状態は、現在のmain（`441cabc`）上でも劣化なく成立している（§1）
2. Epic #27は実装・ドキュメント・GitHub状態・実動作検証（Issue #164）のすべてで完了している（§2）
3. Model Management（§3）・Job Lifecycle #123〜#135（§4）・Backup/Restore・Data Safety #143〜#162（§5）・filesystem/path safety #154〜#158（§6）のいずれにも、重大な未解決事項（Blocker/Major相当）は見つからなかった
4. Open Issue/Epicは現在のmainと矛盾しない（§8）。Epic #28はContinue Hold継続が妥当と再判定した（§10、Blocker/Majorではなく意図的な保留状態）
5. 既知flake（`test_batch_inflight_share_same_key`）はClosureを妨げる性質のものではないことを、本Investigationで新たに収集した証拠（8/8ローカル成功・直近15回のmain CI実行すべてsuccess）を含めて確認した（§9）
6. 発見したFuture Backlog（5件）はいずれもMinor/Suggestion相当であり、「今回のフェーズを閉じるために必要なもの」は存在しない（すべて次期開発で検討すればよい候補）
7. 全テストスイート（backend full suite・TrOCR関連・Release Gate関連・filesystem safety関連・frontend）を本Investigation内で再実行し、いずれも既知の環境依存事象（ローカル`ci_sim_venv`のtransformers/ultralytics欠落）以外の失敗がないことを確認した（§Tests参照）
8. `outputs/app.db`・`data/jobs/job_manager.db`は`integrity_check: ok`のまま、Issue #164の証跡（training_jobs 32件・job_manager_jobs 1件）が保持されている
9. Productionコードへの変更は本Investigation内で一切行っていない（Execution Rules §2の例外に該当する事象は発生しなかった）

## Tests

本Investigation内で再実行した内容（すべて既存テストの再実行・新規テスト追加なし）:

```
python -m pytest -q
# 1528 passed, 3 warnings（.venv、実transformers/paddleocr使用。full backend suite）

python -m pytest -q tests/test_project_id_validation.py tests/test_safe_recursive_deletion.py \
  tests/test_model_deletion_shared_reference_safety.py tests/test_output_dir_safety.py \
  tests/test_restore_model_sidecar_path_rebase.py
# 84 passed（filesystem/path safety、#154〜#158関連）

python -m pytest -q tests/test_trocr_model_registry.py tests/test_dataset_registry.py \
  tests/test_job_manager.py tests/test_job_repository_sqlite_migration.py \
  tests/test_sqlite_online_backup.py tests/test_sqlite_restore.py tests/test_backup_retention.py
# 96 passed（Model Management / Job Lifecycle / Backup-Restore関連）

# 既知flakeの追加確認（8回連続実行）
python -m pytest -q tests/test_preview_batch.py::test_batch_inflight_share_same_key  # ×8
# 8/8 passed

cd frontend && npm test
# 759 passed, 0 failed

cd frontend && npm run build
# ビルド成功（既知のchunk sizeサイズ警告のみ、新規警告なし）
```

`outputs/app.db`のsha256チェックサムは調査開始前後で不変（`dfa73a55...`）であることを確認済み。`git status --short`は本Investigation実行前後で恒常的なローカル差分（`.github/PULL_REQUEST_TEMPLATE.md`・`CLAUDE.md`・未追跡`docs/LOCAL_SYNC.md`）のみで、Production変更は一切生じていない。

### CI結果（既知flakeの4回目の独立した再現）

PR #167（本ドキュメントのみのdocs-only diff）の初回CI実行で、`tests/test_preview_batch.py::test_batch_inflight_share_same_key`が`assert 2 == 1`で再度失敗した。本PRの差分（`docs/workitems/roadmap/POST_TROCR_E2E_FINAL_CLOSURE_166.md`の新規追加のみ）はこのテストと一切関係がないことを`git diff --stat main -- tests/test_preview_batch.py src/app/main.py`で確認し、ローカルで3回実行して3/3成功、`gh run rerun --failed`（コード変更ゼロ）で成功したことを確認した。これは§9で予測したとおりの挙動であり、本開発フェーズ中に独立に再現した**4件目の事例**（#152・#156・#164/PR #165・本PR #167）となった。既知flakeとしての判断（Closureを妨げない）を追加で裏付ける結果となった。

最終CI結果（2回目の実行、`https://github.com/bs-shashimoto2048/OCR_Crafter/actions/runs/32675183576`）: backend pass・frontend pass。Squash Merge実行、Issue #166自動Close済み（Squash Commit `e60d13d`）。

## Documentation

- 本ファイル新規作成
- 既存docsへの変更は行っていない（発見したstale docsの訂正はFuture Backlogへ記録するに留め、本Issue内では実装しない。Execution Rules §3の明示的指示どおり）

## Scope外（Out of Scope、実施しなかったこと）

- 発見した改善候補（Future Backlog5件）の実装
- 新規Issueの起票
- Epic #28 Consumer Migrationの実装
- 新規OCR engine追加
- 広範なUI再設計
- 性能最適化

## Scope Discipline

調査中に発見した事象（stale docs 2件の再確認、新規軽微ギャップ2件、Epic #28のConsumer層既存確認）は、いずれも本Issueの目的（フェーズ終了可否の判定）に直接必要な棚卸しの一部として記録するに留め、実装・新規Issue化は一切行わなかった。
