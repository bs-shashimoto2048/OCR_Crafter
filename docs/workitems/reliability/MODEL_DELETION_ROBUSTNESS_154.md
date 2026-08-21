# Model Deletion Robustness 作業記録

Related: Reliability [#154](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/154) / Investigation [#152](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/152)（Post-Backup Roadmap Refresh、本Issueを最優先(P1)として特定） / Feature [#117](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/117)（Model Card / Deployment Package Multi-engine Parity） / Feature [#141](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/141)（TrOCR Model Management Parity） / Bug [#145](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/145)（Restore Model Sidecar Path Rebase）

**状態**: Implemented, PR review pending。

## 目的

Investigation #152で最優先（P1）として特定されたModel Deletionの安全性を改善する。`model_registry.py::delete_model()`が、手編集・バグ等で複数モデルのsidecarが同一artifact directoryを参照している場合に、片方の削除がもう片方のartifactを警告なく巻き込んで削除しうるという既知課題（`docs/10_KNOWN_LIMITATIONS.md`/`docs/13_QA_STATUS.md`記載）を解消する。

## Before-state 調査（実装前の現行delete call graph）

### `model_registry.py::delete_model()`の既存構造

1. `safe_name`（basename限定）を確定 → 拡張子判定（`.pt`/`.ocr.json`/`.tess.json`/`.trocr.json`のみ許可）
2. `target`（sidecarファイル）の存在確認
3. `.ocr.json`/`.tess.json`/`.trocr.json`の場合、sidecar JSONを読み込む（パース失敗時は`payload = None`）
4. Tesseract固有: 破損メタは実体に触れずsidecarのみ削除、読めるが関連パス欠落は削除中止（`ValueError`）
5. `payload`が読めた場合、`_resolve_safe_model_dirs(payload, paths.models)`が返すディレクトリを`shutil.rmtree(dir, ignore_errors=True)`
6. 最後にsidecarファイル自体を`unlink()`

### `_resolve_safe_model_dirs()` / `_is_safe_model_artifact_dir()`（既存、変更前）

`_MODEL_DIR_META_KEYS = ("checkpoint_dir", "inference_dir", "tessdata_dir", "model_dir")`の各キーの値を、削除対象sidecar自身のpayloadからのみ抽出し、`_is_safe_model_artifact_dir()`（resolve済みパスがmodels root配下の実在ディレクトリであることを`Path.parents`で検証、models root自身・CWD・親ディレクトリ等は拒否）を通過したものだけをrmtree対象として返す。**この時点では「他のモデルも同じディレクトリを参照していないか」は一切確認していなかった**。

## engine別artifact/sidecar contract確認

| Engine | sidecar | directory参照キー | 単一ファイル参照 |
|---|---|---|---|
| Tesseract | `.tess.json` | `tessdata_dir`・`model_dir`（通常同値） | `traineddata_path`（削除では未使用、rebase専用） |
| PaddleOCR custom | `.ocr.json` | `model_dir`・`inference_dir`・`checkpoint_dir` | なし |
| TrOCR | `.trocr.json` | `model_dir` | なし |
| 分類（custom） | `.pt`（sidecarなし） | 該当なし（ファイル自体が実体） | なし |

いずれの3エンジンも`_MODEL_DIR_META_KEYS`の部分集合を使っており、既存の汎用抽出ロジックがそのまま適用できることを確認した（Issue #145のrebase実装時と同じ知見）。

### 共有参照が現実に起こり得るか（推測せず根拠を記録）

- **通常の学習フロー**: TrOCR/PaddleOCRは`job_id`ベースのディレクトリ命名（`models/trocr_runs/<job_id>/`・`models/ocr_runs/<job_id>/`）、Tesseractはモデル名ベースのディレクトリ命名を用いており、`job_id`/モデル名の一意性が保たれる限り、**正常な学習フローで2つの異なるモデルが同一ディレクトリを指すことは起こらない**（`tesseract_pipeline.py`/`ocr_pipeline.py`/`trocr_training_core.py`のディレクトリ生成箇所を確認済み）。
- **異常系**: 手編集メタ・コピー&ペーストによるsidecar複製・将来のバグにより、2つのsidecarが同じ`model_dir`等を指す状態は物理的に作成可能である（JSONテキストファイルの中身を変更するだけで再現できる）。`docs/13_QA_STATUS.md`も「発生には異常/手編集メタが前提」と明記しており、本調査でもこの評価を追認した。

## 実装内容

### 1. 共有参照検出（新設）

`model_registry.py`へ以下を新設した。

- `_MODEL_SIDECAR_GLOBS = ("*.tess.json", "*.ocr.json", "*.trocr.json")`
- `_other_model_sidecars(models_root, exclude_name)`: models直下の他モデルsidecar一覧（削除対象自身を除く）
- `_is_dir_referenced_by_other_sidecar(target_dir, models_root, exclude_sidecar_name)`: `target_dir`を他のsidecarが`_MODEL_DIR_META_KEYS`のいずれかで参照しているか確認する。読み取り不能・JSONパース不能な他sidecarは保守的に「参照なし」として扱う（推測で「共有あり」と判定して削除対象自身の削除まで止めない）

### 2. `_resolve_safe_model_dirs()`の拡張（新しいparallel registryは作らない）

`exclude_sidecar_name: str = ""`という**後方互換のキーワード専用引数**を追加した。指定時のみ共有参照チェックを行い、共有されているディレクトリは削除対象から除外する（対象sidecar自体は既存契約どおり削除される。共有artifact directoryは参照countが0になるまで物理削除しない）。未指定（デフォルト）の場合は既存の挙動のまま変化しない。

`delete_model()`の唯一の呼び出し箇所を`_resolve_safe_model_dirs(payload, paths.models, exclude_sidecar_name=safe_name)`へ更新した。

### 3. Containment（既存実装の再確認、変更なし）

`_is_safe_model_artifact_dir()`は**既に**`Path.resolve()`＋`Path.parents`による構成要素単位の検証であり、単純な文字列prefix比較には依存していなかった（Issue本文が要求する「Containment Before Recursive Delete」・「単純な文字列prefix比較には依存しない」を、本Issue着手前から満たしていたことを確認した）。symlink経由のescapeについても、`.resolve()`がシンボリックリンクを実体パスへ解決するため、models root外を指すsymlinkは`root not in resolved.parents`で正しく拒否されることをテストで実証した（Decision Record参照）。

### 4. Fail Safe（既存実装の再確認、変更なし）

- artifact pathがroot外・判定不能な場合: 既存の`_is_safe_model_artifact_dir()`が`False`を返し、rmtreeされない（sidecarのみ削除）
- Tesseractの破損メタ・パス欠落メタ: 既存どおり「sidecarのみ削除」または「削除中止」（本Issueで変更なし）
- 新設の共有参照チェック: 判定不能（他sidecarが読めない）な場合は「共有なし」扱いとし、**削除対象自身の削除を妨げない**（保守的すぎる誤検出で通常の削除操作までブロックしないため）

## Decision Record

| 論点 | 決定 | 理由 |
|---|---|---|
| 共有ディレクトリの判定基準 | 他sidecarの`_MODEL_DIR_META_KEYS`値をresolve後に完全一致比較 | 既存の`_MODEL_DIR_META_KEYS`をそのまま再利用でき、新しいparallel registryが不要 |
| 他sidecarが読めない場合の扱い | 「参照なし」として扱い、削除対象自身の削除は継続 | 誤検出で通常の削除操作をブロックすると、既存の「破損メタは実体に触れずsidecarのみ削除」という既存Fail Safe方針と矛盾するため |
| 共有ディレクトリ削除時のsidecar自体の扱い | 対象sidecarは常に削除する（ディレクトリのみ保護） | Issue本文4番「対象sidecar自体は既存contractに従って削除可能」を採用。sidecarを残すと「削除したはずなのに一覧に残る」というUXの矛盾を生む |
| Containment実装 | 変更なし（既存`_is_safe_model_artifact_dir()`のPath.parents方式で十分） | 実装前調査で単純prefix比較ではなく既に構成要素単位の検証だったことを確認したため、作り直す必要がない |
| `rmtree(ignore_errors=True)`の部分失敗検知 | 本Issueでは対応しない（Future Work） | Issue #154のExit Criteriaに明記された項目ではなく、共有参照検出とは独立した別種の課題（Investigation #152のC.2でも別項目として記録済み） |

## Tests

新規: `tests/test_model_deletion_shared_reference_safety.py`（13件、うち1件は環境依存でskip許容）

- **Shared Directory**: 2つのsidecarが同じdirectoryを参照する場合に片方削除でdirectoryが残ること、最後の参照削除時のみ実際に削除されること、拡張子の異なるsidecar間（`.ocr.json`/`.trocr.json`）でも共有検出が機能すること、共有されていないdirectoryは既存どおり削除されること（回帰）、他sidecarが破損JSONでも削除対象自身の削除がブロックされないこと
- **Containment**: `..`によるescapeが拒否されること（既存回帰確認）、symlink経由のescapeが`resolve()`によって正しく拒否されること（symlink作成が環境的にサポートされない場合はskip）
- **単体テスト**: `_is_dir_referenced_by_other_sidecar()`が共有あり/なし/自己参照除外の3ケースで正しく判定すること
- **Regression**: Tesseract/PaddleOCR/TrOCRの通常削除（非共有ケース）が無回帰であること

実行結果:

```
python -m pytest -q tests/test_model_deletion_shared_reference_safety.py
# 12 passed, 1 skipped（symlink未サポート環境、GitHub Actions Linux runnerでは実行される見込み）

python -m pytest -q tests/test_model_deletion_shared_reference_safety.py tests/test_delete_model_safety.py \
  tests/test_trocr_model_management_parity.py tests/test_backup_retention.py \
  tests/test_restore_model_sidecar_path_rebase.py
# 63 passed, 1 skipped

python -m pytest -q
# 1362 passed, 10 failed, 1 skipped, 93 errors
# 10 failed・93 errorsはIssue #141/#143/#145/#147/#150時点のbaselineと一致する
# ローカルci_sim_venvのtransformers完全欠落による既知の環境依存事象のみ、
# 本Issueの変更とは無関係
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し一致を確認済み。Frontend diffは0（既存のModel Manager UIの削除操作フロー・確認ダイアログには変更不要、Backend側の安全ガードのみの変更のため）。

## Documentation

- 本ファイル新規作成
- `docs/10_KNOWN_LIMITATIONS.md`・`docs/13_QA_STATUS.md`: 「手編集メタが共有親ディレクトリを指す場合に配下の他モデルも削除しうる余地」を解消済みへ更新
- `docs/workitems/roadmap/NEXT_DEVELOPMENT_ROADMAP_REFRESH_152.md`: Recommended Next Issueの完了を記録

## Scope外（Out of Scope、実施しなかったこと）

- Epic #28 Consumer Migration
- Model Registry全面再設計（既存`_MODEL_DIR_META_KEYS`/`_is_safe_model_artifact_dir()`をそのまま再利用、新しいparallel registryは作っていない）
- Release参照保護policyの新規導入（Issue #141で既存policyが存在しないことを確認済みのまま、本Issueも新設していない）
- Model Manager UI redesign（Frontend変更なし）
- soft delete / trash / undo機能
- backup policy変更
- 新Engine追加
- `rmtree`封じ込め3方式（`safe_rmtree`/`allowed_roots`/`relative_to`）の統一（Investigation #152 C.2で言及されたが、本Issueの共有参照検出とは独立した別課題としてFuture Workへ記録）
- `rmtree(ignore_errors=True)`の部分失敗検知（同上）

## Future Work

- `rmtree`封じ込め方式の`safe_rmtree`への統一（`main.py._cleanup_failed_ocr_dataset`のallowed_roots方式・`main.py._delete_training_artifacts`のrelative_to方式を含む）
- `rmtree(ignore_errors=True)`の部分失敗（Windowsファイルロック等）を検知し、成功を偽装しないようにする
- 上記2件は`docs/10_KNOWN_LIMITATIONS.md`/`docs/13_QA_STATUS.md`に引き続き既知課題として記載する
