# Post-Safety-Hardening Roadmap Refresh — Investigation #160 作業記録

Related: Investigation [#160](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/160) / Investigation [#152](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/152)（Post-Backup Roadmap Refresh、本Investigationの前回版） / Reliability [#154](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/154)・[#156](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/156)・[#158](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/158) / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure、Open・保留継続）

**状態**: Completed / Closed（Investigation / Documentation only。Production実装は無し）。PR [#161](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/161)、Squash Commit `b7eae8e`でマージ済み。

## 目的

Issue #152以降、Backup/Restore・Model Deletion・recursive delete・ID/path validationを中心とするOperational Data Safety / Reliability改善（#145/#147/#150/#154/#156/#158）を連続して実施した。直前IssueのFuture Workを機械的に次へ実装するのではなく、現在のmainを正として次の開発優先順位を再評価する。

## 1. Open Issue Inventory

`gh issue list --state open`で全件確認した結果、**Open Issueは Epic #28（Unified Model Metadata Infrastructure）と本Investigation（#160）自身の2件のみ**であることを確認した。重複・obsolete・「実装済みだがOpenのまま」に該当するIssueは存在しない。Epic #28自体の評価は§5参照。

## 2. User Journey Audit

Project作成→Dataset取込/ラベル付け/前処理→学習→Model Manager→推論→評価→Benchmark→Release Gate→Release/Deployment Package→Backup/Restoreの各段階について、既存workitem docs・実コードを確認した。

| 段階 | 到達可能性 | Engine parity | 備考 |
|---|---|---|---|
| Project create/open | ○ | N/A | Issue #158で経路検証済み、安全 |
| Dataset import/annotation/preprocess | ○ | Tesseract/PaddleOCR/TrOCR対応、EasyOCRは学習非対応（既存の意図的設計） | 変更なし |
| Training | ○ | 同上 | 変更なし |
| Model Manager | ○ | 4エンジンとも一覧・削除対応（Issue #141・#154で完成） | Issue #154で共有artifact保護済み |
| Inference | ○ | 4エンジン対応 | 変更なし |
| Evaluation | ○ | **4エンジン対応（Multi-engine Evaluation Dispatcher、Issue #61-#79）** | `docs/10_KNOWN_LIMITATIONS.md`に「OCRモデル評価はTesseract専用」という**誤解を招く記述**が残っていたことを本Investigationで発見し、修正した（§4参照。`ocr_evaluation.py::build_recognizer()`自体はTesseract専用の内部実装のまま据え置く設計だが、評価機能全体は4エンジン対応済み） |
| Benchmark | ○ | 4エンジン対応（EasyOCRは公式モデルのみ） | 変更なし |
| Release Gate | ○ | Tesseract/PaddleOCR/TrOCR対応（EasyOCR対象外、既存方針） | Issue #137で解消済み |
| Release/Deployment Package | ○ | 3エンジン対応 | 変更なし |
| Backup/Restore | ○ | project単位（4エンジンのsidecar含む）・グローバルSQLite（backup方向のみ） | Issue #145/#147/#150/#156/#158で強化済み |

**新たなdestructive operation safety gapは発見されなかった**。既存の主要User Journeyはいずれも到達可能で、Backend contractと矛盾する箇所も見つからなかった。

## 3. Reliability / Data Safety Follow-up

### 3.1 recursive deleteの残存call site（Issue #156 Future Work）

`benchmark.py`（OS一時領域cleanup）・`evaluation_dataset.py`（構築失敗時cleanup）・`report_generator.py`（レポート画像削除）・`tesseract_pipeline.py`（学習前work_dirクリア）の4箇所は、Issue #156で意図的にFuture Workへ分離した低リスクcleanup loggingの追加候補である。実コードを再確認した結果:

- いずれも**project/model dataを破壊する経路ではない**（OS一時領域、または既に例外を上位へ伝播させている、またはsanitize済みfilenameのみを扱う）
- ユーザー影響は「診断ログが無いため障害調査がやや困難」という observability の問題に留まり、data-lossには直結しない

Decision Principlesに照らすと、これらはCategory 6（保守性）相当であり、単独のIssueとして今優先すべき理由は無い（§6.3参照）。

### 3.2 SQLite Backup/Restore運用ギャップ（Issue #152 C.4 の再確認）

Issue #147は`outputs/app.db`・`data/jobs/job_manager.db`の**オンラインバックアップ作成のみ**を実装し、**restore（実際に戻す手順）は意図的にOut of Scopeのまま**である。`docs/25_DISASTER_RECOVERY.md`§4を再確認した結果、project単位のrestore手順（§3）は明記されているが、**これら2つのグローバルSQLiteを実際にバックアップから復元する具体的な手順（ファイル配置のみで足りるか、schema整合性確認は必要か等）は依然として未検証・未文書化のまま**であることを確認した。Issue #152で指摘した内容から状態は変わっていない。

### 3.3 Windows process/file-lock関連

Issue #133・#125のworkitem docsを再確認したところ、**#129のFuture Work節（2項目）が、実際には#133で既に解消済みであるにもかかわらず、未更新のまま「推奨Issue」として残っていた**ことを発見した（本Investigationで訂正注記を追記済み、§4参照）。startup reconciliationとWindows process termination自体に新たなgapは見つからなかった。

### 3.4 SQLite backup/restoreのarchive extraction

Issue #145/#156で`restore_backup()`の安全性は強化済み。新たなgapは見つからなかった。

## 4. Known Limitations / Future Work Audit

`Future Work`・`Known Limitation`・`TODO`・`FIXME`・`未対応`・`既知`を全workitem docs・`docs/10_KNOWN_LIMITATIONS.md`・`docs/13_QA_STATUS.md`で検索し、解決済みの記述が未更新のまま残っていないかを確認した。

**発見・本Investigationで修正した陳腐化ドキュメント（2件）**:

1. `docs/workitems/jobs/WINDOWS_TRAINING_PROCESS_TERMINATION_INVESTIGATION_129.md`のFuture Work節: 「Windows環境でのTesseract/PaddleOCR孫プロセス終了対応」「`shutil.rmtree(run_dir)`のtry/except保護」の2項目が、いずれもReliability #133で解消済みであるにもかかわらず、未更新のまま「推奨Issue」として残っていた。訂正注記を追記した。
2. `docs/10_KNOWN_LIMITATIONS.md`の「OCRモデル評価はTesseract専用」という記述: `ocr_evaluation.py::build_recognizer()`という**特定の内部関数**の実装詳細を、あたかも「モデル評価機能全体」の制約であるかのように読める書き方になっていた。Multi-engine Evaluation Dispatcher（Issue #61-#79、Completed）により実際には4エンジン対応済みであることを明記する形へ修正した。

他のFuture Work記述（`docs/13_QA_STATUS.md`のaudit/benchmark SQLite移行・Model CardへのBenchmark結果表示等）は、既存の優先度判断（Investigation #139・#152）どおり未着手のまま正確に記載されていることを確認した。

TODO/FIXMEコメントはリポジトリ全体で0件（`docs/10_KNOWN_LIMITATIONS.md`に既記載のとおり、変更なし）。

## 5. Epic #28 Reassessment

Epic #28本体・関連する全closed子Issueを再確認した。

- **Canonical MetadataのProduction consumerは依然ゼロ**: `main.py`および`src/app/services/`配下の全ファイル（Canonical Metadata自身のクラスタ7ファイルを除く）を対象に、`model_metadata`/`models_api`/`model_catalog`/`metadata_reader`/`metadata_writer`/`training_metadata_factory`/`legacy_metadata_adapter`のいずれのimportも存在しないことを確認した（grepによる全数調査）。
- **Legacy metadata経路は現在も全engineで正常に機能している**: Issue #141（TrOCR Model Management Parity）・#154（Model Deletion Robustness）・#145（Restore Model Sidecar Path Rebase）はいずれもLegacy sidecar（`.tess.json`/`.ocr.json`/`.trocr.json`）を対象とした改善であり、実装中に機能不全は確認されなかった。
- **#117/#119/#121/#137/#141/#145/#154等の個別改善により、Consumer Migrationを必要とする具体的problemが新たに生じたか**: 生じていない。むしろ#154（`_MODEL_DIR_META_KEYS`という既存の汎用registryを共有参照検出という新用途にそのまま再利用）・#145（同じレジストリをrebase用途に再利用）・#150（`_METADATA_FILES`という単一リストの拡張のみ）はいずれも、**既存のLegacy方式が持つ「小さな汎用registry」パターンが新しい要求にも十分応用できる**ことを示す追加の証拠になった。これはEpic #28が懸念する「engineごとに個別対応が必要」というパターンの反例である。
- **Legacy/Canonical二重構造そのものが現在ユーザー影響・データ不整合を起こしているか**: 起こしていない。二重構造は存在するが、Canonical側が単に未使用（dead infrastructure）というだけであり、ユーザーから見た挙動への悪影響は無い。

**結論: Continue Hold（保留継続）。** 具体的なProduction problemは生じておらず、Investigation #108・#139・#152の既存方針を継続する。

## 6. Test / CI Health

- 実CI（GitHub Actions、`gh run list --branch main`）: 直近5回すべて`success`。最新run（`6926f94`時点）のbackendログで`1501 passed, 9 skipped`を確認（failed/error 0件）。
- ローカル`ci_sim_venv`では`transformers`/`ultralytics`パッケージの完全欠落により10 failed・93 errorsが発生するが、これはIssue #141以降一貫して確認されている**ローカル環境限定の既知事象**であり、実CIには一切影響しない（`requirements.txt`自体の変更は不要と判断）。
- Issue #8/#112（`test_dataset_registry.py`のclean-environment失敗、DB isolation不備）は過去に完全解決済みであり、現在のKnown Failureとして誤って再カウントしていないことを確認した。
- skip対象（9件）はいずれもGPU/CUDA等の環境依存条件によるもので、既存の意図的なスキップ条件であることを確認した（新規のskip増加は無い）。

## Capability / Risk Matrix

| Area | Current State | User Reachable | Risk | Evidence | Recommendation |
|---|---|---:|---|---|---|
| SQLite Backup Restore手順 | Backup作成のみ実装（#147）、restore手順未検証・未文書化 | 低（障害時のみ） | 中（Operational recovery遅延） | `docs/25_DISASTER_RECOVERY.md`§4、#152 C.4 | 次点候補（§Top Recommendation参照） |
| recursive delete残存cleanup logging | 4箇所が`ignore_errors=True`のまま無ログ | 低 | 低（data-loss無し、診断性のみ） | Issue #156 Future Work | 低優先度のまま据え置き |
| Legacy Evaluation Job Type（dead code） | `job_type="evaluation"`が到達不能のまま定義され続けている | 無し（未到達コード） | 極低 | Issue #139/#152 C.1 | 低優先度のまま据え置き |
| Epic #28 Consumer Migration | Canonical Metadata未消費のまま | N/A | N/A（機能影響無し） | 本Investigation§5 | Continue Hold |
| Windows孫プロセス終了 | #133で解消済み、docs記載のみ陳腐化 | N/A（解決済み） | 無し | 本Investigation§4で訂正済み | 対応済み（本Investigation内で修正） |
| Evaluation機能のEngine parity記述 | 実装は4engine対応済み、docs記載が誤解を招く表現だった | 低（誤読リスクのみ） | 極低（ドキュメントのみ） | 本Investigation§4で修正済み | 対応済み（本Investigation内で修正） |

## Candidate Ranking

| # | 候補 | Severity | Reachability | Data-loss risk | Frequency | Scope size | Regression risk | 既存Issue有無 |
|---|---|---|---|---|---|---|---|---|
| 1 | SQLite Backup Restore runbook検証・文書化 | 中（障害時） | 低（平常時は不使用） | 低（restore自体は実装しないため） | 低（障害時のみ） | 小〜中 | 低 | 無し（新規候補） |
| 2 | recursive delete残存cleanup logging（#156 Future Work） | 低 | 低 | 無し | 低 | 極小 | 極低 | Issue #156 workitem docに記録済み |
| 3 | Legacy Evaluation Job Type dead code整理 | 極低 | 無し | 無し | 該当なし | 極小 | 極低 | Issue #139/#152 workitem docに記録済み |
| 4 | Epic #28 Consumer Migration | N/A | N/A | N/A | N/A | 大 | 高 | Epic #28（Open、Continue Hold） |

## Top Recommendation

**次Issueを1件だけ推奨する。**

### Proposed Title
[Reliability] SQLite Global DB Restore Runbook & Verification

### Scope
- `outputs/app.db`（Job System A）・`data/jobs/job_manager.db`（Job System B）を、Issue #147で作成したbackupから実際に復元する手順を検証する
- 復元手順はrestore機能の**実装**ではなく、まず**手動手順の検証・文書化**を優先する（Backend停止 → backupファイルを正式パスへ配置 → 起動確認、という単純な手順で足りるかを実際にtemp環境で検証する）
- 検証の結果、単純な手順で十分と判明すれば、`docs/25_DISASTER_RECOVERY.md`へrunbookとして追記する
- 検証の結果、schema migration・整合性検証等の追加考慮が必要と判明した場合のみ、restore用のヘルパー関数実装を追加のExit Criteriaとして検討する（Scope拡張の要否は実装前調査の結果次第）

### Exit Criteria概要
- temp環境で「backup作成→アプリ停止相当→backupから復元→アプリ再起動相当→データ整合性確認」のフルサイクルを実際に検証する
- 検証結果に基づき、`docs/25_DISASTER_RECOVERY.md`へ具体的なrestore手順を追記する
- 実`outputs/app.db`・実project dataは変更しない
- Production code変更が必要と判明した場合のみ、その理由と最小実装を記録する

### Why Now
Issue #147でBackup作成機能を実装した際、restore（実際に戻す手順）は意図的にOut of Scopeとした。Investigation #152で「残るgap」として記録されたまま、その後の#154/#156/#158はいずれも別領域（Model Deletion・recursive delete・ID validation）を優先したため、このgapは未着手のまま残っている。Backup機能が「作成はできるが実際に戻せるか誰も確認していない」状態は、Decision Principle 4（Operational recovery / observability不足）に該当する具体的なgapであり、他に発見されたCategory 1-3相当（データ損失・security boundary・主要User Journey阻害）の新規問題が無いことを踏まえると、次点として妥当と判断する。

本Investigation内では起票しない（Issue本文の明示的指示通り）。

## Epic #28 Decision

**Continue Hold（保留継続）。** 根拠は§5に記載のとおり: Canonical Metadataは依然Production consumerゼロ、Legacy pathは全engineで正常機能中、#145/#150/#154の個別改善はいずれも「小さな汎用registryの再利用」で完結しており、Consumer Migrationを必要とする具体的Production problemは新たに生じていない。

## Production Change Policy

本Investigationでは以下の2件のドキュメント陳腐化修正のみを実施した（Issue本文が明示的に許可する「既存ドキュメントの明白な事実誤認・陳腐化の同期」に該当）。

1. `docs/workitems/jobs/WINDOWS_TRAINING_PROCESS_TERMINATION_INVESTIGATION_129.md`: Future Work 2項目にReliability #133で解消済みである旨の訂正注記を追記
2. `docs/10_KNOWN_LIMITATIONS.md`: 「OCRモデル評価はTesseract専用」という誤解を招く記述を、実際のMulti-engine Evaluation Dispatcher対応状況を反映する形へ修正

Production code（`src/`・`frontend/src/`）は一切変更していない。

## Tests / Validation

Production変更が無いため、targeted read-only確認のみを実施した。

- `git diff --stat -- src/ frontend/src/`で変更が0件であることを確認
- `gh run list --branch main`で直近CIがすべてgreenであることを確認
- `grep`による全数調査（Canonical Metadata consumer有無、TODO/FIXME、recursive delete call site）を実施し、実project/DBは一切変更していない

## Documentation

- 本ファイル新規作成
- `docs/workitems/jobs/WINDOWS_TRAINING_PROCESS_TERMINATION_INVESTIGATION_129.md`: Future Work陳腐化の訂正
- `docs/10_KNOWN_LIMITATIONS.md`: Evaluation engine parity記述の訂正
- `docs/workitems/roadmap/NEXT_DEVELOPMENT_ROADMAP_REFRESH_152.md`: 本Investigationへのフォローアップリンクを追記（#139→#152→#160という既存のリンクチェーンをそのまま延伸するため、#139自体は変更していない）

## Out of Scope

新機能実装、bug fix本体、Epic #28 Consumer Migration実装、UI redesign、Architecture大規模refactor、新Engine追加、次Issue（SQLite Global DB Restore Runbook）の自動作成。
