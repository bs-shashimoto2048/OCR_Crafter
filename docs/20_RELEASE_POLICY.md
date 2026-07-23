# 20. Release Policy / Release Gate（本番昇格の自動判定）

Productionへ昇格するモデルが満たすべき基準（Release Policy）をプロジェクト毎に設定し、昇格前に自動判定（Release Gate）する。実装は `src/app/services/release_gate.py` ＋ `release_manager.py`、UIは リリース管理画面（`ReleasesView.jsx`）。

## 1. Release Policy（プロジェクト毎・releases.json の `policy`）

| 項目 | 内容 | 未設定時 |
|---|---|---|
| `max_cer` | CER上限（0〜1） | ルール無効 |
| `min_char_accuracy` | 文字正解率下限 | ルール無効 |
| `min_exact_match` | 完全一致率下限 | ルール無効 |
| `min_eval_images` | 評価画像数の下限 | ルール無効 |
| `max_failed` | Benchmarkでの推論失敗数上限 | ルール無効 |
| `no_cer_regression` | Production比でCER悪化なし | false=無効 |
| `require_same_evaluation_hash` | ProductionとEvaluation Hash同一（同一条件評価） | false=無効 |
| `min_comparison_quality` | Productionとの比較品質（★1〜5）下限 | ルール無効 |
| `required_chars` | 必須文字と最低正解率 `{chars, min_accuracy}` | ルール無効 |
| `critical_confusions` | 危険な混同 `[{from, to, severity: warning/fail, max_count}]` | ルール無効 |
| `max_benchmark_rank` | Benchmark順位の上限 | ルール無効 |
| `allowed_engines` | 許可エンジン（tesseract / paddleocr） | 空=制限なし |

**未設定の項目はルール自体を生成しない**（後方互換: Policy未設定のプロジェクトは従来どおり制限なし）。

## 2. 判定（Verdict）

| 判定 | 条件 |
|---|---|
| `PASS` | 全ルール合格 |
| `CONDITIONAL_PASS` | 不合格なし・警告または未検証あり |
| `FAIL` | 不合格ルールが1つ以上 |
| `NOT_EVALUATED` | モデルの評価結果が実験カルテにない |

各ルールは **Rule / Expected / Actual / Result / Message** の行としてUIへ表示する。Resultは `pass`（合格）/ `fail`（不合格）/ `warning`（警告）/ `unverified`（未検証）。

判定の情報源は実験カルテ（`experiments.json` の evaluation / evaluation_profile / evaluation_hash）・Benchmark（`benchmarks.json`）・Production側の実験カルテ。**推測で補完しない**（記録がなければ未検証）。

## 3. Critical Confusion（危険な混同）

例: `0→O`, `1→I`, `5→S`。評価の混同集計（Levenshteinアラインメント由来・attach_evaluationで実験カルテへ保存）から該当置換の件数を数え、`max_count`（既定0）を超えたらルール毎の設定に従い **warning（警告・昇格可能）または fail（1件でもFAIL可能）**。混同集計が未記録（旧評価）の場合は未検証。

## 4. 必須文字

評価の文字別統計（`char_stats`: 正解文字ごとの出現数とエラー数=置換+脱落。`evaluate_ocr` が算出）から、必須文字それぞれの正解率を判定する。

- **評価データにその文字が現れない場合は「未検証」**（FAILにしない・CONDITIONAL_PASS要因）
- 正解率基準（`min_accuracy`、既定90%）は設定可能

## 5. 例外承認（Override）

**Gate判定がFAILのモデルは、例外承認なしでProductionへ昇格できない**（`promote_model` がサーバー側で強制）。承認には以下すべてが必須:

- Override Reason（理由）
- Approved By（承認者）

承認時、履歴エントリへ `override: {reason, approved_by, approved_at, failed_rules}` を保存する。`failed_rules` は**承認時点の不合格ルールのスナップショット**（後からPolicy・評価が変わっても当時の判定を追跡できる）。UIの履歴には Override バッジ（ホバーで理由・承認者）を表示。

## 6. Release ID と Version

| 概念 | 役割 |
|---|---|
| **Release ID**（`REL-0001`） | リリース行為（履歴エントリ）の識別子。全リリース・Rollbackで毎回新規採番・再利用しない |
| **Version**（`1.0.0` 等） | 配布成果物の版。Deployment Package名・Model Cardに使う |

既存履歴へのバックフィル: `releases.json` は `schema_version` を持ち（Migration Version）、v1→v2 Migration（`migrate_releases_registry`・明示的関数）で既存履歴へ**古い順に REL-0001.. を安全に付与**する（既存フィールドは変更しない。初回参照時に永続化・冪等）。

## 7. Version規則（明文化）

1. **初回Candidate**: `0.x` を自動採番（candidate_counter）
2. **Candidate解除→再設定**: Versionを維持（再採番しない）
3. **Production昇格**: 正式版へ（未指定=直近Productionのマイナー加算・初回 `1.0.0`。明示指定可）
4. **Rollback**: **対象Versionを維持**（新Version採番しない）。新Release ID・`rollback=true`・`rollback_from` で履歴に記録

## 8. Validated自動遷移

評価実行（attach_evaluation）で以下**すべて**が成功した場合のみ `Draft → Validated` へ自動遷移する:

1. CER計算成功（cerが数値）
2. Evaluation Profile保存成功
3. Evaluation Hash生成成功（データセットID・前処理識別子の少なくとも一方あり）

**Candidate以降のステータスは自動変更しない**（`mark_validated_if_draft` はDraftのみ対象）。

## 9. Productionの一意性

Productionは1プロジェクトに**0件または1件**（初期状態・未昇格プロジェクトは0件、昇格後は常に1件。2件以上には決してならない）。新Production昇格時に旧Productionは自動Archived。

## 10. API（`docs/06_API_REFERENCE.md` 参照）

| Method / Path | 概要 |
|---|---|
| GET `/api/releases/policy` | Policy取得（正規化済み） |
| PUT `/api/releases/policy` | Policy保存（不正なseverity等は400） |
| GET `/api/releases/gate?model=` | Gate判定（verdict＋ルール行） |
| POST `/api/releases/promote` | 昇格（FAILは `override_reason`+`approved_by` 必須） |

## 11. テスト

`tests/test_release_gate.py`（Policy正規化・比較品質・NOT_EVALUATED/PASS/FAIL・Critical Confusion warning/fail・必須文字未検証・Production比較3ルール・Benchmark未実施=未検証・Override強制とスナップショット・REL-IDバックフィルMigration・Rollback Version維持・Candidate Version維持・Validated自動遷移）＋ `frontend/tests/releaseGate.test.mjs`（ラベル・Override必須判定・Policyフォーム変換・Critical Confusionsテキスト形式）。
