# OCR Crafter Post-Backup Roadmap Refresh — Investigation #152 作業記録

Related: Investigation [#152](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/152) / Investigation [#139](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/139)（OCR Crafter Roadmap Refresh、Completed。本Investigationの前回版） / Investigation [#115](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/115) / Investigation [#108](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/108)（Epic #28 Consumer Migration再評価） / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure、Open・保留継続）

**状態**: Completed / Closed（Investigation / Documentation only。Production実装は無し）。

## 目的

Roadmap Investigation #139以降の実装結果を現在のmainで再棚卸しし、次に着手する開発Issueを1件に絞る。特に#143から派生した3件（#145/#147/#150）がすべて完了したため、Backup/Restoreテーマを惰性で拡張せず、現時点の実コード・UI・運用docsを基準に次の優先順位を再評価する。

## A. Completed Since #139

`gh issue list --state all`で実際にClosed・mainへ反映済みであることを確認した。

| Issue | 内容 | 状態 |
|---|---|---|
| #141 | TrOCR Model Management Parity | Completed（PR #142、`a159477`）。Model ManagerでTrOCRの一覧・ダウンロード・削除がTesseract/PaddleOCRと同等になった |
| #143 | Backup / Restore & Operational Data Safety Investigation | Completed（PR #144、`53eca2f`）。project単位backupの既存実装を棚卸しし、3件の重大な発見（後述）を記録した |
| #145 | Restore Model Sidecar Path Rebase | Completed（PR #146、`4174fcc`）。#143最優先の発見（restore後にモデルsidecarの絶対パスが復元先を指さない既知バグ）を修正した |
| #147 | SQLite Online Backup for Global Job Databases | Completed（PR #148、`c704944`）。`outputs/app.db`・`data/jobs/job_manager.db`をBackend停止不要でオンラインバックアップできる内部関数を追加した（UI/APIなし） |
| #150 | Expand metadata_only Backup Coverage | Completed（PR #151、`33d9202`）。`benchmark_center.json`・`inference_model.json`・`preprocess/`（確定済み前処理設定＋履歴）を`metadata_only`対象へ追加した |

**Investigation #143から派生した3件（#145/#147/#150）はすべて完了し、Investigation #143自体のFuture Workは空になった。**

**運用上の発見（本Investigationで確認）**: Issue [#149](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/149)（`[Feature] Expand metadata_only Backup Coverage`）が#150と完全に同一内容でOPENのまま残っていることを確認した（作成日時2026-08-20T08:32:25Z、本文は#150と一言一句同一）。#150がSquash Merge済み（PR #151）であるため、#149は重複Issueと判断し、本Investigation内で「#150として実装済み」という説明コメントを付けてCloseした（Production変更を伴わない純粋なIssue管理上の整理のため、Investigation本来のScopeに含めて対応した）。

## B. Current Capability Matrix

| 機能 | Tesseract | PaddleOCR | EasyOCR | TrOCR |
|---|---|---|---|---|
| Training | ○ | ○（custom） | ×（設計上、公式モデルのみ） | ○ |
| Model Manager（一覧/ダウンロード/削除） | ○ | ○ | N/A（学習・登録機能自体が無い） | ○（#141で追加） |
| Inference | ○ | ○ | ○ | ○ |
| Evaluation（Multi-engine Evaluation API、#79/#83） | ○ | ○ | ○ | ○ |
| Benchmark Runner | ○（登録モデル/標準eng） | ○（公式/自作） | ○（公式のみ、学習対象外） | ○ |
| Release Gate / Release管理 | ○ | ○ | N/A（training artifactを持たないため対象外、既存方針） | ○ |
| Deployment Package / Model Card（#117） | ○（traineddata単一） | ○（ディレクトリ） | N/A | ○（ディレクトリ） |
| Project Backup（`metadata_only`/`full`） | ○ | ○ | N/A | ○（#141以降、sidecarがModel Managerへ統合されたことでbackup観点でも他2エンジンと同列になった） |
| Restore後のartifact参照整合性 | ○（#145で修正） | ○（#145で修正） | N/A | ○（#145で修正） |

EasyOCRは学習・モデル登録機能自体を持たない設計（既存方針、変更なし）であるため、上表の該当行はN/Aとした。無理な同一化はしていない。

## C. Remaining Gaps

### C.1 Legacy Evaluation Job Type実態確認（#139から3回持ち越し、本Investigationで4回目の確認）

- **Evidence**: `job_manager.py::JOB_TYPES`に`"evaluation"`が定義され、`_handle_evaluation()`（`ocr_evaluation.py::evaluate_ocr()`＝Tesseract専用の旧evaluation pathを呼ぶ）がdispatcherへ登録されている。しかし`grep -rn 'create_job([^)]*"evaluation"'`で全コードを検索した結果、**`job_type="evaluation"`のJobを実際に作成する呼び出しは1件も存在しない**ことを確認した（`main.py`のOCR評価画面は同期的なMulti-engine Evaluation API＝Issue #61-#79系列を直接呼んでおり、JobManager経由ではない）。`main.py`の`_active_training_or_evaluation_jobs()`相当の関数も`"evaluation"`をフィルタ条件に含むが、該当Jobが作られない以上この分岐は常にfalseになる。
- **User impact**: 無し（ユーザーが到達できるコードパスではない）
- **Reliability impact**: 無し
- **Scope size**: 小（`JOB_TYPES`から削除・`_handle_evaluation`削除・関連filterの整理）
- **Regression risk**: 低（未到達コードの削除のため）
- **Existing workaround**: 不要（実害が無い）

### C.2 Model Deletion Robustness（#139から持ち越し、`docs/10_KNOWN_LIMITATIONS.md`/`docs/13_QA_STATUS.md`に既記載）

- **Evidence**: `model_registry.py::_resolve_safe_model_dirs()`は、削除対象モデルのsidecarに記載された`_MODEL_DIR_META_KEYS`（`model_dir`/`inference_dir`/`tessdata_dir`/`checkpoint_dir`）の値を**他のモデルのsidecarと照合せずに**そのままrmtree対象として扱う。手編集・バグ等により2つのモデルのsidecarが同じ物理ディレクトリを指す状態になった場合、一方のモデル削除がもう一方のモデルのartifactを**警告なく**巻き込んで削除しうる（`docs/13_QA_STATUS.md`が「発生には異常/手編集メタが前提」と明記するとおり、通常の学習フロー＝`job_id`ベースの一意なディレクトリ命名では発生しない）。加えて`rmtree`の封じ込め方式が`safe_rmtree`/`allowed_roots`/`relative_to`の3方式併存しており統一が望ましいこと、`rmtree(ignore_errors=True)`の部分失敗（Windowsファイルロック）が非検知のままAPIが成功を返すことも既知課題として記載済み。
- **User impact**: 低〜中（通常操作では発生しないが、発生時はモデル喪失という重い結果になる）
- **Reliability impact**: 中〜高（サイレントなデータ損失の可能性がある構造的リスク）
- **Scope size**: 中（共有ディレクトリ検出ロジックの追加、`rmtree`封じ込めの`safe_rmtree`への統一、`ignore_errors`の結果検知）
- **Regression risk**: 中（削除操作の根幹に関わるため慎重な設計・広いテストが必要）
- **Existing workaround**: 手編集メタを避ける運用ルール（ドキュメント化済み、コード側の防御ではない）

### C.3 SQLite Online Backupの運用入口（#147の効果を実際に享受するための次の一歩、新規発見）

- **Evidence**: Feature #147で`services/sqlite_backup.py::backup_app_db()`/`backup_job_manager_db()`を実装したが、Issue本文の明示的指示により**UI/API/CLIのいずれも追加していない**。現状これらの関数を呼び出すには、Pythonを直接起動して手動で関数を呼ぶ以外の手段が無い。既存の`src/app/migrate_legacy_data.py`等（`argparse`＋`if __name__ == "__main__":`という確立されたCLIスクリプトpattern）を踏襲すれば、低コストで運用入口を追加できる見込みである。
- **User impact**: 低（開発者・運用者向けの機能であり、エンドユーザーには影響しない）
- **Reliability impact**: 中（実際に定期実行されなければ、せっかくのオンラインバックアップ機能が「実行されない機能」のままになる）
- **Scope size**: 小（CLIスクリプト1つ、新規依存なし）
- **Regression risk**: 低（新規スクリプト追加のみ、既存コードへの変更は不要）
- **Existing workaround**: 手動でPythonを起動し関数を直接呼ぶ（`docs/25_DISASTER_RECOVERY.md`に明記済みだが、実行のしやすさは低い）

### C.4 full-system restore runbookの十分性

- **Evidence**: `docs/25_DISASTER_RECOVERY.md` §4「サーバー全損からの復旧（フル手順）」は、project backupの復元手順（§3）を反復適用する形で書かれているが、**`outputs/app.db`・`data/jobs/job_manager.db`の実際の復元手順（backupから戻す方法）は記載されていない**（#147はbackup作成のみを実装し、restoreは意図的にOut of Scopeとした）。バックアップは作成できるが、実際に障害復旧時にこれらのDBを「元に戻す」具体的な手順（ファイルを配置し直すだけで足りるのか、schema整合性の確認は必要か等）が未検証・未文書化のままである。
- **User impact**: 低（平常運用では発生しない）
- **Reliability impact**: 中（実際の障害時に手順が無いと復旧が遅れる）
- **Scope size**: 小〜中（restoreの実装は不要、手順の検証・文書化のみで足りる可能性が高い）
- **Regression risk**: 低（Investigation/Documentationのみで解決しうる）
- **Existing workaround**: ファイルを単純にコピーして配置（未検証）

### C.5 cross-machine restoreの実用性

- **Evidence**: Bug #145でproject単位のmodel sidecar絶対パスは復元先projectを指すよう修正されたが、これは「同一マシン内・同一`data/projects/`配下への復元」を前提にした修正であり、**別マシン・別ディレクトリ構成への復元（cross-machine restore）は依然として正式サポート外**（Investigation #143の判断を継続）。TrOCRの`local_files_only`設定やHugging Face Hubキャッシュの扱いも別マシンでは再構築が必要。
- **User impact**: 低（現在の主な使い方は単一マシン運用）
- **Reliability impact**: 低〜中（災害復旧を別マシンで行う場合にのみ関わる）
- **Scope size**: 大（本格的なcross-machine対応は設計から見直しが必要）
- **Regression risk**: N/A（未着手）
- **Existing workaround**: 同一マシン内でのrestoreに限定する運用（既存docsに明記済み）

### C.6 scheduled backupの必要性

- **Evidence**: `docs/BACKUP_AND_RESTORE.md`は「アプリ内蔵のスケジューラはありません。OSのタスクスケジューラ等で構成する」と明記しており、これは意図的な設計判断（Issue #147/#150双方が明示的にOut of Scopeとした）。
- **判断**: 新しいgapではなく、既存の意図的な設計。再提案しない。

## D. Priority Ranking

Issue本文のDecision Principles（① データ損失/誤参照/復旧不能 → ② 主要導線が実質使用不能 → ③ silent incorrect behavior → ④ reliability/restart/cancellation → ⑤ major UX friction → ⑥ maintainability → ⑦ cosmetic）に従って順位付けした。

| # | テーマ | 該当するDecision Principle | 優先度 |
|---|---|---|---|
| 1 | C.2 Model Deletion Robustness | ③ silent incorrect behavior（サイレントなデータ損失リスク） | **P1** |
| 2 | C.4 full-system restore runbookの検証・文書化 | ④ reliability（実際の障害復旧の実行可能性） | P2 |
| 3 | C.3 SQLite Online Backupの運用入口（CLI） | ④ reliability（バックアップ機能の実効性） | P2 |
| 4 | C.1 Legacy Evaluation Job Type実態確認 | ⑥ maintainability（実害なし、cleanup） | P3 |
| 5 | C.5 cross-machine restore正式対応 | ⑤ UX friction（現状は影響する運用が限定的） | P3（大規模、着手は時期尚早） |
| 6 | C.6 scheduled backup | 該当なし（既存の意図的設計） | 対象外 |
| 7 | Epic #28再開 | 該当なし（§F参照） | 対象外（保留継続） |

**#139時点の優先順位（テーマ2 Legacy Evaluation Job Typeが2番手）との違い**: #139は実装コスト・regression riskを主軸に順位付けしたため、コストの低いLegacy Evaluation Job Typeが2番手だった。本Investigation（#152）はIssue本文が明示するDecision Principlesを主軸に順位付けするため、**サイレントなデータ損失リスクを持つModel Deletion Robustnessが最優先**となる。これはコストが低い施策を後回しにする趣旨ではなく、Issue本文が明示的に要求する優先順位基準を機械的に適用した結果である。Legacy Evaluation Job Typeは実装コストが最も低い「ついで作業」候補として引き続き有効である。

## E. Recommended Next Issue

**原則1件のみ推奨する。**

### Title
[Reliability] Model Deletion Robustness — 共有ディレクトリ検出・rmtree封じ込め統一

### Problem
`model_registry.py::delete_model()`の削除ガード（`_resolve_safe_model_dirs()`/`_is_safe_model_artifact_dir()`）は、手編集・バグ等でモデルのsidecarメタが他モデルと共有する親ディレクトリを指す場合に、削除操作が警告なく他モデルのartifactを巻き込んで削除しうる（`docs/10_KNOWN_LIMITATIONS.md`/`docs/13_QA_STATUS.md`記載の既知課題）。加えて`rmtree`封じ込めが`safe_rmtree`/`allowed_roots`/`relative_to`の3方式併存しており、`rmtree(ignore_errors=True)`の部分失敗が非検知のままAPIが成功を返す。

### Scope
1. 削除対象ディレクトリが、**同一project内の他モデルのsidecarが参照するディレクトリと重複していないか**を`delete_model()`実行前に検出する（重複時は削除を中止しエラーで診断可能にする、あるいは明示的な確認を要求する）
2. `rmtree`封じ込め方式を`project_paths.safe_rmtree()`へ統一する（`main.py._cleanup_failed_ocr_dataset`のallowed_roots方式・`main.py._delete_training_artifacts`のrelative_to方式を含む）
3. `rmtree`の部分失敗（Windowsファイルロック等）を検知し、成功を偽装しないようにする
4. Tesseract/PaddleOCR/TrOCR・分類モデルいずれの既存削除挙動も壊さない（regression test必須）

### Exit Criteria概要
- 共有ディレクトリ検出により、意図しない他モデルの巻き込み削除を防止できる
- `rmtree`封じ込めが単一方式に統一される
- 部分失敗が診断可能になる（成功を偽装しない）
- 既存の削除挙動（4エンジン・分類モデル）が無回帰
- full backend suite green・self-review Blocker/Majorなし

### Why now
Investigation #143/#145/#147/#150でBackup/Restore領域のサイレントな不整合リスクを2件（restore後の絶対パス不一致・metadata_onlyの部分欠落）解消してきた流れの延長として、Model Manager側に残る**唯一の既知サイレントデータ損失リスク**を解消するのが論理的な次の一歩である。Issue本文のDecision Principlesにおいても「silent incorrect behavior」は「maintainability」より優先度が高い。

巨大Issueにはならない見込みのため、段階分割は提案しない（1 Issueで完結可能と判断）。

## F. Epic #28 Decision

**判断: Continue Hold（保留継続）。**

根拠:

- Investigation #108が定義した再開トリガー（「既存Legacyパスが機能しなくなる」「同じmetadata fixが繰り返される」）を再確認した。#139時点で観測されていた2件（#117・#137）から、#139以降に**新たに追加された「同じmetadata fixの繰り返し」インシデントは0件**である。Issue #141（TrOCR Model Management Parity）は§7が事前に予見していたパターンの**解消**であり、新規の繰り返しインシデントとしてカウントすべきではない。
- Bug #145（restore時のsidecar絶対パスrebase）は、`model_registry.py::_MODEL_DIR_META_KEYS`という**既存の汎用registry**をrebase用途でそのまま再利用することで、Tesseract/PaddleOCR/TrOCRの3エンジンを**同時に**カバーできた。これはEpic #28が懸念する「engineごとに個別対応が必要」というパターンの**反例**であり、既存のlegacy registry方式が実際にはうまく汎用化できていることを示す追加の証拠になった。
- Feature #150（metadata_only対象拡張）も同様に、engine別分岐ではなく単一の`_METADATA_FILES`/`_METADATA_DIRS`拡張で完結した。
- 上記より、Epic #28が想定する「複数の独立した永続化・判定機構による保守コスト増大」という構造的問題自体は変わらず存在するが（legacy sidecar分岐は引き続き8ファイル・25箇所に分布）、**個別Issue対応で十分吸収できているという#139の結論を覆す新しい証拠は無い**。

Investigation #108・#139の方針（既存Legacyパスが機能している限り着手しない）を継続することを推奨する。

## Documentation / Operational Accuracy 確認（Investigation Scope §7）

`docs/USER_GUIDE.md`・`docs/QUICK_START.md`・`docs/FAQ.md`・`docs/06_API_REFERENCE.md`・`docs/16_SCREEN_SPEC.md`・`docs/BACKUP_AND_RESTORE.md`・`docs/25_DISASTER_RECOVERY.md`・`docs/10_KNOWN_LIMITATIONS.md`を確認した。#141/#145/#147/#150の各Issue完了時にそれぞれのdocsが実装内容に合わせて更新済みであり、本Investigationの調査範囲では新たな矛盾は見つからなかった。唯一の运用上の不整合はGitHub Issue Tracker側の重複Issue（#149、上記A節参照）であり、コード・ドキュメントの不整合ではない。

## Tests / Verification

Investigation / Documentation onlyのため新規テストは追加していない。Production code変更が無いことを`git diff --stat -- src/ frontend/src/`で確認済み。read-only probe（`gh issue list`・`grep`によるコード調査）のみを実施し、実project/DB・実Issue（#150等）の内容は変更していない（#149のCloseのみ、Issue管理上の重複解消でありコード・データへの影響は無い）。

## Documentation

- 本ファイル新規作成
- `docs/workitems/roadmap/NEXT_DEVELOPMENT_ROADMAP_REFRESH_139.md`: 本Investigationへのフォローアップとして更新
- 重複Issue #149を#150重複としてClose（コメント付き）

## Scope外（Out of Scope、実施しなかったこと）

新機能実装、UI redesign、architecture refactor、Epic #28 Consumer Migration実装、scheduled/cloud backup実装、新Engine追加、次Issue（Model Deletion Robustness）の自動作成（ユーザー判断後に別途起票する）。
