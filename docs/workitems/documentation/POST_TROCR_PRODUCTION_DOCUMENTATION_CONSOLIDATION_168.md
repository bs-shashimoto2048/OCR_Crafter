# Post-TrOCR Production Documentation Consolidation 作業記録

Related: Documentation [#168](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/168) / Investigation [#166](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/166)（Post-TrOCR E2E Final Closure & Roadmap、本Issueの起点） / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27) / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28) / Validation [#164](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/164)

**状態**: Completed / Closed。PR [#169](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/169)をSquash Merge（Squash Commit `86689bf8cee90caa8618910f8fa65b1f6a1b1479`）。Issue #168はSquash Merge時の`Closes #168`により自動Close。最終CI結果: backend/frontendともに初回checkでpass（flake再現なし）。マージ後、main上でMarkdownリンク再検証（818リンク中broken 0件、docs/design・docs/workitems内のPython型ヒント記法5件は既知の誤検知）およびProductionコード非変更（`git diff --stat 8aa9be8 86689bf -- src/ frontend/src/`が空）を再確認済み。

## 目的

Investigation #166（Final Closure Decision: READY TO CLOSE）で今回のTrOCR統合＋関連リファクタリング＋Reliability/Data Safety改善フェーズ（Epic #27・Issue #123〜#166）が正式に終了した。一方、このフェーズを通じて`docs/`配下の主要ドキュメントは断片的にしか更新されておらず、現在のProduction実装と乖離した記述が随所に残っていた。本Issueは、現在のmainを正として`docs/`全体を体系的に再整備する**Documentation-only**の作業である。Productionコード・テストコードは一切変更していない。

## 調査方法

一次情報として、現在のProductionコード（`src/app/main.py`・`src/app/schemas.py`・`src/app/services/*.py`・`frontend/src/`）・実際のファイル/ディレクトリ構成・GitHub Issue/PRの記録（各workitem doc）・実行結果（`git log`・`wc -l`・`grep`・実際のCI設定ファイル）を直接確認した。推測での記載は行わず、確認できなかった内容は記載していない。

## 確認したDocs

最優先: `docs/USER_GUIDE.md`

概要・入口: `docs/00_PROJECT_OVERVIEW.md`・`docs/QUICK_START.md`

アーキテクチャ・データ: `docs/01_ARCHITECTURE.md`・`docs/02_DIRECTORY_STRUCTURE.md`・`docs/03_TECH_STACK.md`・`docs/04_BUILD_AND_RUN.md`・`docs/06_API_REFERENCE.md`・`docs/07_DATABASE.md`

制約・運用: `docs/10_KNOWN_LIMITATIONS.md`・`docs/BACKUP_AND_RESTORE.md`・`docs/25_DISASTER_RECOVERY.md`

横断チェック: `docs/16_SCREEN_SPEC.md`・`docs/FAQ.md`・`docs/GLOSSARY.md`・`README.md`（リポジトリ直下）・`docs/README.md`・`docs/INSTALLATION_GUIDE.md`・`docs/TROUBLESHOOTING.md`・`docs/13_QA_STATUS.md`・`docs/DOCUMENTATION_REPORT.md`

その他、実コード側の参照元として `src/app/job_runner.py`・`src/app/predict.py`・`src/app/services/experiment_tracker.py`・`src/app/services/benchmark.py`・`.github/workflows/ci.yml`・`Pipfile`・`requirements.txt` を直接確認した。

## 発見したstale記述と修正内容

### `docs/USER_GUIDE.md`（最優先）

- **発見**: §1「対応OCRエンジン」テーブルにTrOCRの行が存在しなかった（Tesseract/PaddleOCR/EasyOCR/customのみ。ドキュメント全体では§9.3/§16/§17等でTrOCRが広く扱われているにも関わらず、冒頭の対応エンジン一覧に反映されていなかった）
- **修正**: TrOCR行を追加し、Training→Model Management→Inference→Evaluation→Benchmark→Release Gate→ReleaseまでE2E検証済み（Issue #164）であることを明記
- 本ドキュメントの他の箇所（§9.3学習・§16モデル管理・§17リリース管理・付録A推論等）は、既にIssue #141・#164相当の内容が正しく反映されており、追加の修正は不要と判断した

### `docs/QUICK_START.md`

- **発見**: §8（学習開始）に「**TrOCRのみ例外**——モデル管理には表示されず、学習画面自身・モデル評価・Benchmark Runner・リリース管理の各画面から直接参照します」という記述があった。これはFeature #141（TrOCR Model Management Parity）以前の状態を記述したままであり、現在は`USER_GUIDE.md`§16・`docs/16_SCREEN_SPEC.md`が正しく記録するとおりTrOCRモデルもモデル管理画面の一覧・ダウンロード・削除に表示される
- **修正**: 「TrOCRも同じ画面の一覧・ダウンロード・削除に表示されます」へ訂正

### `docs/FAQ.md`

- **発見**: 「Q. TrOCRで学習したモデルがモデル管理画面に表示されません」というQ&Aが、Feature #141以前の「既知の制約」として残っていた（QUICK_START.mdと同種のstale記述）
- **修正**: 質問文・回答とも現在の実態（表示される）へ書き換え

### `docs/00_PROJECT_OVERVIEW.md`

- **発見1**: 「動作環境」に「Python: 3.11以上を推奨（Pipfileに3.9の記載が残る既知の不一致あり）」とあったが、実際のCI（`.github/workflows/ci.yml`）・実運用venvはいずれもPython 3.10系であり、「3.11以上を推奨」という記述自体が実態と一致していなかった（Pipfile=3.9、実際の運用=3.10、docsの推奨=3.11という三者不一致だった）
- **発見2**: `src/app/`の説明に「全140エンドポイント」とあったが、実際に`main.py`を走査すると**142エンドポイント**（GET 72 / POST 57 / PUT 4 / PATCH 3 / DELETE 6）だった
- **発見3**: `tests/`の説明に「44ファイル」とあったが、実際には**87ファイル**だった
- **修正**: いずれも実際に確認した値へ訂正

### `docs/01_ARCHITECTURE.md`（最も乖離が大きかった文書）

- **発見**: 本ドキュメントはJob System B（`data/jobs/job_manager.db`・`JobManager`/`JobWorker`、Issue #123〜#135）・TrOCR（Epic #27）のいずれの導入前の状態を記述したままだった。具体的には:
  - 全体構成のMermaid図にSQLiteが`outputs/app.db`しか描かれておらず、`data/jobs/job_manager.db`が完全に欠落していた
  - `job_runner.py`の対応job_typeが「classification / ocr / tesseract」のみ記載され、実際には対応済みの`trocr`が欠落していた
  - モジュール関係図にTrOCR関連モジュール（`trocr_engine.py`・`trocr_training_core.py`・`trocr_dataset_adapter.py`・`trocr_model_registry.py`・`trocr_evaluation_predictor.py`）・Multi-engine Evaluation Dispatcher・`sqlite_backup.py`が一切描かれていなかった
  - サービスモジュール数が「34モジュール」と記載されていたが、実際には**57モジュール**だった
  - エンドポイント数が「全140」のままだった（実際は142）
  - 状態管理表にSQLiteが1種類（Job System Aのみ）としか記載されておらず、Job System Bが欠落していた
- **修正**: 全体構成図・モジュール関係図・データフロー図・API構成・状態管理のいずれにもJob System B・TrOCR関連モジュールを反映した。Job System A/Bが意図的に併存している（Issue #135の結論であり統一Facadeへの移行は行わない）ことを明記した。Epic #28（`model_metadata.py`とそのConsumer層）についても、実装・テスト済みだが`main.py`未配線という正確な現状を追記し、「壊れている」のではなく意図的なContinue Hold状態であることを明記した

### `docs/02_DIRECTORY_STRUCTURE.md`

- **発見**: `services/`配下の一覧が29個程度しか列挙されておらず「34モジュール」という数字も実態（57モジュール）と乖離。TrOCR関連モジュール・Multi-engine Evaluationファミリー・`sqlite_backup.py`・Model Metadata Consumer層（`model_metadata.py`等）がいずれも一覧から欠落していた。トップレベルツリーに`data/jobs/`（Job System B）・`data/backups/`（project/Global SQLiteバックアップ）が存在しなかった。プロジェクトデータ構造の`models/`行に`*.trocr.json`/`trocr_runs/`が欠落していた。`main.py`（約4830行→実測5321行）・`App.jsx`（約4920行→実測5243行）・`tests/`（44→87ファイル）・フロントエンドtests（56→71ファイル）・`lib/`（45→53種）の各カウントが古かった
- **修正**: `services/`一覧にTrOCR・Multi-engine Evaluation・Model Metadata Consumer層関連モジュールを追加し、モジュール数を57へ訂正。トップレベルツリーに`data/jobs/`・`data/backups/`を追加。プロジェクトデータ構造テーブルに`.trocr.json`/`trocr_runs/`を追加。各種カウントを実測値へ訂正

### `docs/03_TECH_STACK.md`

- **発見1**: バックエンド主要ライブラリ表に`transformers`（TrOCRの中核依存）・`tokenizers`・`sentencepiece`（Issue #164で追加）が一切記載されていなかった（TrOCRがEpic #27で導入されて以降、一度も反映されていなかった）
- **発見2**: Pythonバージョンの注記が「CI相当の固定はなし」としていたが、同じファイルの「Docker / CI」節（本ドキュメント自身）が「Python 3.10」とCI設定を正しく記載しており、**同一ファイル内で自己矛盾**していた
- **修正**: `transformers==5.14.1`・`tokenizers==0.22.2`・`sentencepiece==0.2.2`を追加。Pythonバージョンの記述を「CI・実運用venvともに3.10系で固定。Pipfileは3.9指定のまま未更新」へ訂正し、自己矛盾を解消

### `docs/04_BUILD_AND_RUN.md`

- **発見**: `tests/`（44ファイル）・フロントエンドtests（56ファイル）のカウントが古かった。CLI例に`--engine trocr`の例が無かった（`predict.py`は`--engine`に`custom`/`easyocr`/`paddleocr`/`tesseract`/`trocr`のいずれも対応済みであることをコード上で確認した）
- **修正**: カウントを実測値（87/71）へ訂正。`--engine trocr`のCLI例を追加

### `docs/06_API_REFERENCE.md`

- **発見1**: 冒頭のエンドポイント数「全140」（GET 71/POST 56/PUT 4/PATCH 3/DELETE 6）が実際の値（全142、GET 72/POST 57/PUT 4/PATCH 3/DELETE 6）と一致していなかった
- **発見2**（Issue #164で既に発見済みの再確認）: `GET /api/experiments`の`model_engine`説明が「現状はtesseract固定」だったが、実際には`tesseract_pipeline.py`・`trocr_model_registry.py`の双方が`record_experiment()`を呼び、`"tesseract"`/`"trocr"`のいずれも自動記録される。逆にPaddleOCR学習完了時は`record_experiment()`を一切呼ばないため自動記録されないことをコードで確認した（この点も追記した）
- **発見3**（Issue #164で既に発見済みの再確認）: `GET /api/benchmarks/engines`の説明が「対応= tesseract_model / tesseract_base / paddleocr_official のみ」だったが、`services/benchmark.py::ENGINE_CATALOG`を確認すると`paddleocr_custom`・`trocr`も`implemented: true`だった
- **修正**: いずれも実コードで確認した内容へ訂正

### `docs/07_DATABASE.md`

- **発見**: 「RDB は SQLite のみ（学習ジョブ専用）」という冒頭の記述が、Job System B（`data/jobs/job_manager.db`、Issue #127でjobs.jsonから移行済み）の存在を完全に見落としていた。SQLite Online Backup/Restore（`services/sqlite_backup.py`、Issue #147/#162）の記載も皆無だった。ファイルベース永続化の表に`.trocr.json`が欠落していた。全体共有ファイルの表に`data/dataset_ids.json`が欠落していた（`data/model_ids.json`のみ記載）
- **修正**: Job System A/Bをそれぞれ独立した節として整理し、テーブル・journal mode・startup reconciliation・意図的な分離方針（Issue #135）を明記。SQLite Online Backup/Restoreの節を新設し、Backend停止要否・WAL/SHM対応を含めて記録。`.trocr.json`・`data/dataset_ids.json`を追加

### `docs/10_KNOWN_LIMITATIONS.md`

- **発見**: `main.py`/`App.jsx`の行数（約4830行/約4920行）が実測（5321行/5243行）と乖離。「環境記述の不一致」の説明が「docs類はPython3.11+/Windows前提へ統一済み」としていたが、この「統一済み」という記述自体が誤りだった（実際には統一されておらず、複数のdocsが異なる数値を記載していた。本Issueで3.10へ統一した）。Epic #28について「壊れている機能」なのか「意図的なアーキテクチャ判断」なのかを区別する記述が本ドキュメントに一切無かった
- **修正**: 行数を実測値へ訂正。Python版数の記述を実態（CI/実運用=3.10、Pipfile=3.9の既知不一致）へ訂正。Epic #28専用の行を新設し、Investigation #160・#166の結論（Production Consumerゼロのため意図的にContinue Hold、実装漏れではない）を明記

### `README.md`（リポジトリ直下）

- **発見**: `docs/00_PROJECT_OVERVIEW.md`と同種の乖離がすべて存在した——「対応OCRエンジン」表にTrOCR行が無い、学習/推論のエンジン列挙にTrOCRが無い、エンドポイント数「全140」、サービスモジュール数「34モジュール」、テスト数「44ファイル」/「56ファイル」、Python「3.11以上を推奨」、ディレクトリ構成に`data/jobs/`・`data/backups/`が無い
- **修正**: `docs/00_PROJECT_OVERVIEW.md`・`docs/01_ARCHITECTURE.md`・`docs/02_DIRECTORY_STRUCTURE.md`で行ったのと同内容の訂正をREADME.mdにも反映した（実ファイル名は`readme.md`。Windowsの大文字小文字非依存ファイルシステムにより`README.md`として表示される）

### `docs/INSTALLATION_GUIDE.md`

- **発見**: 「Python 3.11以上を推奨（`docs/USER_GUIDE.md`旧版より）」という記述が、他の修正済みドキュメントと同じ不一致を含んでいた
- **修正**: 「3.10系（CI・実運用venvで使用しているバージョン。Pipfileには3.9の記載が残る既知の不一致あり）」へ統一

### `docs/TROUBLESHOOTING.md`

- **発見**: 「OCRエンジン」節にTesseract/PaddleOCRの項目はあるがTrOCR固有の項目が無かった。Issue #164のE2E実行で、TrOCRのBase Model取得にHugging Face Hubへのネットワークアクセスが必要（`local_files_only`未指定時）であることを直接確認していたが、この事実がユーザー向けトラブルシューティングに反映されていなかった
- **修正**: 「TrOCRのBase Modelが読み込めない」項目を追加（ネットワークアクセス要否・`local_files_only`・confidence/PSM/Whitelist非対応の補足）

## 発見したが修正しなかった事項（推測を避け報告に留めたもの）

- なし。調査の過程で発見した事項はいずれも実コード・実際のファイル構成・完了済みIssueの記録で裏付けが取れており、判断できないままコード側の修正が必要になった事項は無かった。

## 意図的に残した履歴記述

- `docs/workitems/`配下の全ファイルは履歴資料として一切書き換えていない（各Issueの完了時点の記録をそのまま保持）
- `docs/13_QA_STATUS.md`（「2026-07-07」時点の記録と明記された文書）内の「現状バックエンド44ファイル・フロントエンド56ファイル」という記述は、当時（2026-07-07時点）のQA状況を凍結したスナップショットとして意図的に変更していない。他のドキュメント側（`10_KNOWN_LIMITATIONS.md`もこの文書を参照する際「（2026-07-07）記載の」と明記しており、現在値ではなく当時の記録として扱う既存の慣習に従った
- `docs/DOCUMENTATION_REPORT.md`（「2026-07-14時点の生成作業ログ」と冒頭に明記された文書）内の当時のファイル数・エンドポイント数（例: 「バックエンド31ファイル」）も、同様に凍結されたスナップショットとして変更していない（同文書自身が「本レポート自体の数値は当時の記録として更新していません」と明記済み）
- Epic #27・各Issue（#123〜#166）のworkitem doc本文・完了時ステータスは一切変更していない

## 修正しなかったが確認したドキュメント

- `docs/BACKUP_AND_RESTORE.md`・`docs/25_DISASTER_RECOVERY.md`: Issue #147/#150/#162で既に最新化されており、現在のmainの実装と一致していることを再確認した（修正不要）
- `docs/16_SCREEN_SPEC.md`: TrOCR関連の記述（Feature #96/#98/#102/#104/#117/#121/#141等）はすでに正確であることを確認した（修正不要）
- `docs/GLOSSARY.md`: TrOCR用語（TrOCR・Epoch）は既に正確に記載されていることを確認した（修正不要）

## Markdownリンク検証

`docs/`配下全ファイル＋`README.md`のMarkdownリンクを走査するスクリプトで検証した。検出された5件は、いずれも`docs/design/`・`docs/workitems/`配下のPythonコードブロック中の型注釈（例: `[project_id, spec]`）が誤って正規表現にマッチした**誤検知**であり、実在するリンク切れは0件だった。本Issueで新規追加した相互参照（`docs/workitems/jobs/SHARED_JOB_FACADE_READINESS_135.md`・`docs/workitems/reliability/SQLITE_GLOBAL_DB_RESTORE_RUNBOOK_162.md`・`docs/workitems/roadmap/POST_TROCR_E2E_FINAL_CLOSURE_166.md`等）は、いずれも実在するファイルであることを個別に確認した。

## 現在のDocumentation Map（読者導線）

```text
README.md（リポジトリ直下）
  └─ docs/README.md（対象読者別の案内）
       ├─ 初めての方: docs/QUICK_START.md → docs/USER_GUIDE.md（全画面詳細） → docs/FAQ.md / docs/GLOSSARY.md
       ├─ 管理者向け: docs/ADMIN_GUIDE.md / docs/INSTALLATION_GUIDE.md / docs/BACKUP_AND_RESTORE.md
       └─ 開発者向け仕様書（番号付き）:
            00_PROJECT_OVERVIEW → 01_ARCHITECTURE → 02_DIRECTORY_STRUCTURE
              → 03_TECH_STACK / 04_BUILD_AND_RUN → 05_CODING_CONVENTIONS
              → 06_API_REFERENCE → 07_DATABASE → 08_CONFIGURATION
              → 09_AI_DEVELOPMENT_GUIDE → 10_KNOWN_LIMITATIONS
              → 16_SCREEN_SPEC / 17_DATAFLOW / 18_JOB_MANAGEMENT
              → 19_BENCHMARK_SPEC / 20_RELEASE_POLICY
              → 21_OPERATIONS_GUIDE / 22_SECURITY_AND_AUDIT
              → 24_DEPLOYMENT_GUIDE / 25_DISASTER_RECOVERY / 26_PERFORMANCE_LIMITS
       └─ docs/workitems/（Issue単位の履歴資料。実装当時の判断を保持。上記の現行仕様書とは別レイヤ）
```

上記読者導線自体は既存のまま維持し、各ノードの**内容**を現在の実装と一致させることに専念した（導線構造自体の変更は行っていない）。

## Tests

Productionコード・テストコードへの変更は無いため、既存テストの再実行のみ行った（回帰確認目的）。

```
python -m pytest -q      # .venv（実transformers/paddleocr使用）、full backend suite
# 1528 passed, 3 warnings（0 failed。回帰なし）

cd frontend && npm run build
# ビルド成功（既知のchunk sizeサイズ警告のみ、新規警告なし）
```

`git diff --stat -- src/ frontend/src/ tests/` は空（Productionコード・テストコードへの変更が無いことを確認済み）。

## Scope外（Out of Scope、実施しなかったこと）

- Productionコード・テストコードの変更
- `docs/workitems/`の履歴書き換え
- 新機能実装
- 新規Issueの起票

## Scope Discipline

調査中に発見した事項はすべて「Docsと実装の不一致の是正」という本Issueのスコープ内で完結しており、Production側の修正が必要と判断した事項は無かった。判断に迷う事象（コードとDocsのどちらが正か不明な事象）も発生しなかった。
