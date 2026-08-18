# CLAUDE.md — OCR Crafter（Claude Code 用ガイド）

## プロジェクト概要

ローカル完結のOCR学習環境。画像取込→前処理→ラベル付け→データセット作成→学習（PaddleOCR/Tesseract/分類）→評価→推論・修正を1つのUIで行う。

- バックエンド: FastAPI（`src/app/main.py`、port 8000）
- フロントエンド: React 18 + Vite 5 + Tailwind（`frontend/`）
- データ: `data/projects/<project_id>/` にプロジェクト単位で分離（gitignore対象）

詳細: `docs/02_DIRECTORY_STRUCTURE.md` / API: `docs/06_API_REFERENCE.md`

## Sources of Truth

適用可能な情報は原則として次の優先順で扱う。

1. 現在の会話でのユーザーの最新の明示指示
2. 現在のGitHub Issue本文（個別Featureの要件・Scope・Exit Criteria）
3. Accepted ADR / design docs（Architecture・公開Contract）
4. この`CLAUDE.md`（Repository共通ルール）
5. 既存Productionコード・テスト（現在の挙動・互換性）

通常はIssueごとの`task.md`を作成しない。GitHub Issue + `CLAUDE.md` + 関連ADR/design docsを正本として進める。ユーザーが明示的に要求した場合のみ`task.md`を使う。

Architecture/API/Data contract/永続データ/ユーザー向けsemanticsを変えうる矛盾や曖昧さがある場合は、推測せず停止して確認する。

## Standard Issue Workflow

ユーザーから「Issue #Nを実装」「Issue #Nを完了まで進めて」等の指示を受けた場合、ユーザーが工程を限定しない限り次を標準フローとする。

1. Issue、関連Epic、ADR/design/workitem、関連コード・テストを読む。
2. branch/base/PRの現状を確認し、実装前調査を行う。想定と実コードの差異は記録する。
3. Issue単位のbranchで作業し、Scope外変更を混入させない。
4. 既存helper/contract/pathを優先して再利用し、最小の一貫した変更を実装する。
5. focused tests + 関連regression testsを実行する。shared behaviorへ影響する場合はfull suiteも実行する。
6. DB-backed suiteを扱う場合、必要に応じて既存のclean-environment/checksum検証を行う。`outputs/app.db`を退避した場合は必ず復元し、checksumを確認する。
7. Merge前ドキュメントは事実に合わせて`Implemented, PR review pending`等とする。未Mergeなのに`Merged`/`Completed`/`Closed`や未確定commit IDを書かない。
8. commit/pushし、Issueにつき原則1つのPRを作成・更新する。レビュー修正のために新PRを作り直さない。
9. 実際のPR diffを対象にマージ前レビューを行い、Blocker / Major / Minor / Suggestionで分類する。
10. Blocker/Majorは修正して再レビューする。Minor/Suggestionのみなら、リスクを記録したうえでマージ可否を判断する。
11. CIを確認する。赤いcheckを原因未確認のまま許容しない。
12. Review承認相当かつ停止条件が無ければSquash Mergeする。
13. Merge後に実際のSquash Commit SHAを取得してから、Issue完了コメント/Close、Epic/ADR/design/workitem/ISSUE_MAP等を更新する。
14. `main`を同期してclean stateを確認し、roadmapまたはユーザー指示から次作業が明確な場合のみ次Issue/branchを作成する。

外部permission/classifier gateで必要操作が拒否された場合、その境界で停止し、ブロックされた操作を正確に報告する。迂回や状態の捏造を行わない。

## Review Policy

- **Blocker**: Merge不可。データ破損/セキュリティ/重大なcontract破壊/Featureが成立しない問題。
- **Major**: Merge前に修正すべきmaterialなcorrectness/architecture/compatibility/reliability問題。
- **Minor**: 実在するが低リスクなedge case、maintainability、テスト/ドキュメントgap。
- **Suggestion**: 現在のcorrectness defectではない任意改善。

未解消Blocker/Majorがある場合はApprove推奨にしない。自動進行を続けるためにseverityを下げない。

## CI / Known Failure

GitHub Issue #8（`tests/test_dataset_registry.py::test_register_ocr_model_records_dataset_lineage`のclean-environment `no such table: training_jobs`）はPR #113（Squash Commit `3e45f45`）で修正済み・Closed。現時点で許容される既知backend failureは無い。

backend failureを推測で許容しない。新規failure・別traceback・DB checksum不一致・継続的な新flake・説明不能なCI挙動は調査完了まで停止条件とする。

Issue #8と同系統の広範な問題（`tesseract_pipeline.py::register_tesseract_model()`が実DBへ副作用を及ぼす、少なくとも6ファイル・約15テスト）はGitHub Issue #112で追跡中。

## Scope / Natural-language Adjustments

無関係なcleanupやroadmap作業を現在のIssueへ混ぜない。API/UI/DB/schema/benchmark/training/別OCR engineなどは、Issueが要求しない限り変更しない。

ユーザーは作業途中に通常の会話として追加指示してよい。UIの位置・ラベル・badge・表示/interaction等も`task.md`形式に書き直す必要はない。

- 現Issueの目的・Scopeに自然に含まれ、Architecture/API/Data scopeをmaterialに拡張しない調整: 同じbranch/PRで対応し、必要なtests/docsも更新する。
- 別subsystem、Issueの主目的から外れる変更、新しいArchitecture/API/Data contractを伴う変更: ユーザーが明示的に同Issueへ含めるよう指示しない限り別Issueへ分離する。

Scope外だが有用な事項はFuture Workとして記録するか、別Issueを作成/提案する。

## Architecture / Compatibility

新しいabstraction/resolver/DTO/engine-specific branch/dependencyを追加する前に既存実装pathを調査し、適切なら再利用する。Issueが明示的に変更しない限り既存挙動・後方互換性を維持する。

Multi-engine evaluationではregistry/capability、dispatcher、predictor adapter、runner/metrics、composition/orchestration、API、UIの責務を分離する。engine adapterへrunner/metrics/API/DB/benchmark/UI責務を持ち込まない。

shared engine capability/contract変更時は対象engineだけでなく全registered engineと`custom`/unknown behaviorを確認する。

## コーディングルール

- コメント・docstring・UIテキスト・PR説明は日本語。コミットは`<type>: <英語要約>`を基本とする。
- endpointは`main.py`、ロジックは`services/`、schemaは`schemas.py`。既存の責務分離を崩さない。
- フロントの純粋ロジックは`frontend/src/lib/`へ切り出し、必要に応じnode:testを書く。
- 新規依存パッケージの追加は原則避ける。必要なら理由を明示する。
- 新設定は「未設定=従来動作」の後方互換defaultを持たせる。

## Testing Expectations

```bash
python -m pytest -q
cd frontend && npm run build && npm test
```

Issueで変更したbehavior、重要なerror path、integration boundaryをテストする。optional local package/GPU/network/model download/machine-specific stateへ依存するテストよりdeterministic mock/stubを優先する。

Production validationを弱めてテストを通さない。shared contractがtyped resultを要求する場合、malformed engine outputを暗黙変換しない。

flakeらしい失敗を見つけた場合は単体再現と関連suite再実行で確認し、証拠を記録する。「再実行したらgreen」だけで失敗を隠さない。

## 編集禁止・要注意箇所

| 対象 | ルール |
|---|---|
| `data/projects/` 実データ | テストは隔離する。`master.csv`等を勝手に書き換えない |
| 元画像（`raw/`） | 既存仕様上の例外を除き変更しない |
| `.git` | `git gc` / `git prune`禁止 |
| 削除系安全ガード | `safe_rmtree`等を弱めない |
| `external/` `models/` `outputs/` | 大容量/実行資産。不要な削除・再生成をしない |
| `requirements.txt` | 既知のencoding問題に注意し、無関係な一括編集をしない |

## Git / GitHub Conventions

- 1 Issue = 原則1 branch + 1 PR。
- 自動CloseするPR本文は`Closes #<issue>`を含める。
- Feature/Chore PRは原則Squash Merge。
- completion docsには実際のPR番号とSquash Commit SHAを記載する。
- handoff/completion時はworking treeをcleanにする。
- force-push/shared history rewrite/データ削除/permission gate bypassを勝手に行わない。

## Documentation Lifecycle

- 実装前: Planned / Not started
- 実装済み・未Merge: Implemented, PR review pending
- Review修正中: Implemented, review fixes in progress
- 実Merge + Issue完了後: Completed / Closed + PR + Squash Commit

Future Workは未実装のgapとして記録し、実装済みのように書かない。

変更内容に応じて既存docsも更新する。

| 変更内容 | 主な更新先 |
|---|---|
| UI変更 | `docs/16_SCREEN_SPEC.md` |
| データ構造変更 | `docs/17_DATAFLOW.md` |
| 設定追加 | `docs/08_CONFIGURATION.md` |
| API追加/変更 | `docs/06_API_REFERENCE.md` + 関連design/ADR |
| 画面追加 | `docs/00_PROJECT_OVERVIEW.md` + `docs/16_SCREEN_SPEC.md` |
| 仕様/Architecture変更 | `docs/15_CHANGELOG_AI.md` + 関連ADR/design/workitem |

## 絶対に維持する既存仕様

- project_id単位のデータ分離とproject切替時の競合guard。
- charset関連の学習対象/推論whitelist/評価whitelistの分離。評価GTを勝手に大文字化しない。
- OCR前処理とYOLO検出前処理を独立させる。
- 既存project/config/API/localStorage/file format/output formatの後方互換性。破壊的変更が必要ならmigrationを設計する。
- 現在のdark themeと既存Button/Card/spacing/icon/color conventions。
- Step3 Bounding Box編集の既存操作契約。

詳細な背景は`docs/15_CHANGELOG_AI.md`および関連仕様書を参照する。

## Completion Report

Issue完了時は日本語で、観測した事実のみを簡潔に報告する。

- GitHub: Issue / branch / PR / merge state / Squash SHA
- 実装前調査と重要な設計判断
- Production変更と明示的な非変更
- Tests / CI / known failures / flakes / DB integrity（該当時）
- Documentation更新
- Git/main同期状態
- Scope外として触らなかった事項
- 作成した場合は次Issue/branch

意図した未来状態ではなく、実際のRepository/GitHub状態を記載する。
