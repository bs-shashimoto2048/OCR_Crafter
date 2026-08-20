# Restore Model Sidecar Path Rebase 作業記録

Related: Bug [#145](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/145) / Investigation [#143](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/143)（Backup/Restore Investigation、本Issueの起点となった最優先発見） / Feature [#141](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/141)（TrOCR Model Management Parity）

**状態**: Implemented, PR review pending。

## 目的

Investigation #143で実証されたBackup/Restoreの最優先バグを修正する。`services/backup_manager.py::restore_backup()`はprojectを新Project IDへ復元するが、復元されたモデルsidecar（`.tess.json`/`.ocr.json`/`.trocr.json`）内の絶対パス（`model_dir`/`tessdata_dir`/`inference_dir`/`traineddata_path`等）を復元先projectへ書き換えていなかった。本Issueでrestore時にsidecar pathを安全にrebaseし、復元後projectのartifactのみを参照するよう修正する。

## 実装前調査（Mandatory Investigation、Issue本文の10項目）

### 1. `create_backup()` / `restore_backup()` call graph

`create_backup()`は`_collect_backup_files()`でファイル一覧を確定し、`project/<paths.rootからの相対パス>`という arcname でZIPへ格納、`backup_manifest.json`（SHA-256付きFile List）を同梱する。`restore_backup()`は`verify_backup()`で事前ハッシュ検証 → ZIP展開（`project/`プレフィックスを除いた相対パスを`target_root`直下へ書込） → 展開後の再ハッシュ検証、という一連の流れ。**sidecar JSON内部の文字列は一切変更されず、ZIP展開時のバイト列そのまま**であることを確認した（Investigation #143の発見の直接的な原因）。

### 2. backup archive内でmodel sidecarとartifactが格納されるrelative path

`project/models/<sidecar名>`（例: `project/models/trocr_job-1.trocr.json`）、artifact本体は`project/models/<各engineのディレクトリ構造>`（例: `project/models/trocr_runs/job-1/config.json`）。**アーカイブ内の相対パス構造自体は常に正しく、restore後もこの相対構造どおりに`target_root`配下へ展開される**（バグの原因はアーカイブ構造ではなく、sidecar JSON内部の絶対パス文字列が別途保持されていること）。

### 3. source project ID → restored project ID変換

`entry.get("project_id")`（backup作成時に記録された`source_pid`）と、`restore_backup()`が採番する`target_pid`（既定`<source_pid>_restored_<n>`）。`target_root = projects_dir / target_pid`。

### 4〜6. 各engineのsidecar path field一覧（実コードから確認）

| Engine | ファイル | path field | 種別 |
|---|---|---|---|
| Tesseract | `tesseract_pipeline.py` | `tessdata_dir` | directory |
| Tesseract | 同上 | `model_dir`（`tessdata_dir`と同値） | directory |
| Tesseract | 同上 | `traineddata_path` | **file**（`tessdata_dir`配下の`.traineddata`） |
| PaddleOCR | `ocr_pipeline.py` | `model_dir` | directory |
| PaddleOCR | 同上 | `inference_dir` | directory |
| PaddleOCR | 同上 | `checkpoint_dir` | directory |
| TrOCR | `trocr_model_registry.py`/`trocr_training_core.py` | `model_dir` | directory |

`dataset_root`/`dataset_dir`（学習に使用したDatasetへの参照。別projectを指しうる、あるいはproject外の任意パスでありうる）は**artifact本体を指す値ではないため、rebase対象に含めない**（本Issueのスコープは「このモデル自身の実体」の参照回復であり、「学習に使った入力データセットの場所」という別概念の参照までは扱わない。誤ってrebaseすると、実際には別projectに存在する入力データセットへの正しい参照を壊しかねない）。

### 7. `model_registry.py`/`trocr_model_registry.py`/`release_manager.py`等で参照されるpath keys

`model_registry.py::_MODEL_DIR_META_KEYS = ("checkpoint_dir", "inference_dir", "tessdata_dir", "model_dir")`が、上表のdirectory系4フィールドを**すでに過不足なく列挙している**ことを確認した（削除処理用に定義されたものだが、rebase対象の集合としてもそのまま再利用できる）。`release_manager.py::_add_directory_artifact_to_zip()`も同じキー集合（`model_dir`/`inference_dir`優先）でartifactディレクトリを解決している。file系の`traineddata_path`のみ、削除処理では個別ハンドリングされており（`_MODEL_DIR_META_KEYS`には含まれない）、rebase用に追加が必要と判断した。

### 8. `_MODEL_DIR_META_KEYS`等の既存定義を再利用可能か

**再利用可能、かつ再利用した**。新しいparallel registryは作らず、`model_registry.py`から`_MODEL_DIR_META_KEYS`と`_is_safe_model_artifact_dir()`をimportして使う（`backup_manager.py`内に重複定義しない）。

### 9. sidecarのpathがabsolute/relative/nullの各ケース

実コード（`tesseract_pipeline.py`/`ocr_pipeline.py`/`trocr_model_registry.py`）を確認した限り、**すべてのpath fieldは常に絶対パス文字列として書込まれる**（`str(path.resolve())`または同等）。null/空文字のケースは「フィールド自体が空文字またはキー不在」（例: 分類モデルの`.pt`にはこれらのフィールドが存在しない）としてのみ現れる。relativeパスとして保存される実例は確認できなかった。

### 10. malformed/missing sidecar時の既存restore policy

既存の`restore_backup()`は、sidecarを含む**個別ファイルの中身を解釈しない**（バイト列のコピーとハッシュ検証のみ）ため、malformed sidecarがあってもrestore自体は成功していた（中身がおかしいまま複製されるだけ）。本Issueで新設するrebase処理は、この既存policyの範囲内で「読めないsidecarはrebaseをスキップし、restore全体は失敗させない」という設計にした（後述）。

## 実装内容

### Rebase Policy（`backup_manager.py`に新設）

- `_rebase_path_value(old_value, source_pid, target_root)`: `old_value`を`Path.parts`で構成要素分解し、`source_pid`と完全一致する**最後の**要素をanchorとして、それ以降を相対部分として`target_root`へ再結合する。**単純な文字列前方一致・置換には依存しない**（Issue本文の明示的要求）。パス構成要素単位の一致により、`source_pid`と同じ文字列が無関係な階層に偶然出現するケースでも、実際のproject境界（末尾側）を正しく選ぶ（テストで検証済み）。anchorが見つからない場合はNone（rebase不能）を返す。
- `_rebase_model_sidecar_paths(target_root, source_pid, restored)`: `restored`（`restore_backup()`が展開したファイル一覧）から`.tess.json`/`.ocr.json`/`.trocr.json`を抽出し、`_MODEL_DIR_META_KEYS`＋新設した`traineddata_path`の各キーについて`_rebase_path_value()`を試みる。結果パスは**必ず実在確認＋containment検証**（directory系は`model_registry.py::_is_safe_model_artifact_dir()`、`traineddata_path`は`project_paths.is_within_directory()`＋`is_file()`）を経てから書込む。検証に失敗した場合は**元の値を保持し**、`unrebased`リストへ理由を記録する（推測で書き換えない・silent successにしない）。書込みは`atomic_io.atomic_write_json()`を使い原子的に行う。

### Restore全体への統合

`restore_backup()`の復元後ハッシュ検証（既存）が成功した**直後**（ハッシュ検証対象のバイト列を書き換える前に必ず完了させる）に`_rebase_model_sidecar_paths()`を呼ぶ。この呼び出しも既存の`try/except`ブロック内にあるため、rebase処理自体が予期しない例外を投げた場合も、既存の「復元先を削除してエラー」という後片付けが適用される（部分的に書き換わった復元先を残さない）。戻り値へ新しいキー`model_path_rebase: {"rebased": [...], "unrebased": [...]}`を追加した（既存キーは無変更）。

### API（`main.py::api_backup_restore()`）

既存どおり`restore_backup()`の戻り値をそのまま返すため、`model_path_rebase`は追加のBackend変更なくAPIレスポンスへ自動的に含まれる。監査ログ（`backup_restore`）の`after`へ`model_path_rebased_count`/`model_path_unrebased_count`を追加し、`unrebased`が1件でもあれば運用者が監査ログから気づけるようにした（診断可能性の要求に対応）。

## Engine Coverage

- Tesseract: `tessdata_dir`/`model_dir`（directory）＋`traineddata_path`（file）の3フィールドをrebase
- PaddleOCR custom: `model_dir`/`inference_dir`/`checkpoint_dir`（directory）の3フィールドをrebase
- TrOCR: `model_dir`（directory）1フィールドをrebase
- PaddleOCR official（project-localなartifactを持たない）: `.ocr.json`sidecar自体をprojectへ書込まないため、そもそもrebase処理の対象にならない（テストで無害な無変更を確認済み）

## Path Containment

`_rebase_path_value()`が返す候補パスは、書込み前に必ず`model_registry.py::_is_safe_model_artifact_dir()`（directory）または`project_paths.is_within_directory()`＋`.is_file()`（file）で「復元先projectの`models/`配下に実在するか」を確認する。archive内metadataを無条件に信頼して任意の絶対パスへ書込むことはない。旧project pathは（rebaseに成功した場合）payloadから完全に置き換えられ、保持されない。

## Atomic Sidecar Update

sidecarの書き換えは既存の`atomic_io.atomic_write_json()`（tmp書込→`os.replace`）を再利用し、原子的に行う。rebase処理全体が例外を投げた場合は、既存の「復元先を削除してエラー」という上位の後片付けロジックに委ねる（restore全体としてtransactionalな扱いを維持）。

## Error Handling

| ケース | 挙動 |
|---|---|
| sidecar missing | 該当なし（restoreされたファイル一覧に無いsidecarは処理対象にならない） |
| malformed JSON | rebaseをスキップし、`unrebased`へ理由（「sidecarのJSONが破損しているためrebaseできません」）を記録。restore全体は失敗させない |
| expected artifact missing（rebase後パスが実在しない） | 元の値を保持し、`unrebased`へ理由を記録（例: `metadata_only`モードでartifact本体が元々含まれないケース） |
| unsupported/unrecognized path key | 該当なし（既知キー集合以外は読まない。未知キーへの推測rebaseは行わない） |
| artifact outside restored project | `_is_safe_model_artifact_dir()`/`is_within_directory()`が拒否し、元の値を保持（`unrebased`へ記録） |
| partial model directory（一部ファイルのみ実在） | directoryの実在確認のみ行うため、rebase自体は成功しうる（個々のファイル欠落の検出は本Issueのスコープ外。Investigation #143で既知gapとして記録済みの`metadata_only`拡張とは別Issue） |

## Compatibility（維持したもの）

- labels/imagesのrestore: 無変更（既存のZIP展開ロジックそのまま）
- experiments/release/benchmark metadataのrestore: 無変更
- 既存backup manifest/schema version: 無変更（v2のまま、archive formatも無変更）
- 既存の「新Project IDへの復元」semantics: 無変更
- 既存の事前/事後ハッシュ検証: 無変更（rebaseはこの検証が成功した**後**にのみ行う）

## Tests

新規: `tests/test_restore_model_sidecar_path_rebase.py`（16件）

- `_rebase_path_value()`単体: 通常ケース、source_pidが途中にも偶然出現するケース（末尾側=実際のproject境界を正しく選ぶ）、anchor未検出、anchor直後に相対部分が無いケース
- Tesseract: `tessdata_dir`/`model_dir`/`traineddata_path`のrebase、`_is_tesseract_model_ready()`がrebase後のpathで正しくreadyと判定できること
- PaddleOCR: `model_dir`/`inference_dir`/`checkpoint_dir`のrebase、official model相当（sidecar自体が無い）のケースで無害な無変更
- TrOCR: `model_dir`のrebase、**`download_model_endpoint()`が復元先projectから実際にダウンロードできること**（Investigation #143で確認された「復元後は404になる」の直接的な回帰確認）
- Safety/Regression: 元projectのsidecarが変更されないこと、backup archive自体が変更されないこと、破損sidecarがあってもrestore全体は失敗せず他データは正しく復元されること、`metadata_only`モードでartifact本体が無いケースは`unrebased`として報告されること、path fieldが存在しないsidecarは無害に無視されること、モデルが1件も無いprojectのrestoreが従来どおり成功すること

実行結果:

```
python -m pytest -q tests/test_restore_model_sidecar_path_rebase.py
# 16 passed

python -m pytest -q tests/test_backup_retention.py tests/test_restore_model_sidecar_path_rebase.py \
  tests/test_delete_model_safety.py tests/test_trocr_model_management_parity.py tests/test_dataset_registry.py
# 67 passed

python -m pytest -q
# 1321 passed, 10 failed, 93 errors
# 10 failed・93 errorsはIssue #141/#143で確認済みのローカルci_sim_venvにおける
# transformers完全欠落による既知の環境依存事象（本Issueで変更していないファイル群）で、
# 本Issueの変更とは無関係（実GitHub Actions CIには影響しない）
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し一致を確認済み。Frontend diffは0（`git diff --stat -- frontend/`で確認済み）。

## Documentation

- 本ファイル新規作成
- `docs/BACKUP_AND_RESTORE.md`: §8の「既知の制約（未修正）」注記を、修正済みである旨へ更新
- `docs/25_DISASTER_RECOVERY.md`: §3の同注記を同様に更新
- `docs/workitems/operations/BACKUP_RESTORE_INVESTIGATION_143.md`: Future Workの該当項目（Next Issue Split 1件目）を解決済みへ更新

## Scope外（Out of Scope、実施しなかったこと）

- SQLite online backup対応（Investigation #143推奨2件目、別Issue）
- `metadata_only` backup対象拡張（Investigation #143推奨3件目、別Issue。本Issueの調査で「TrOCRのconfig.jsonが`.json`拡張子のため`metadata_only`でも部分的に紛れ込む」既知gapを再確認したが、修正は別Issueのスコープ）
- cross-machine restoreの正式サポート化
- backup archive format全面再設計
- scheduled/cloud backup
- Epic #28 Consumer Migration

## Future Work

- `metadata_only`モードでのTrOCR `config.json`混入gap（Investigation #143 Next Issue Split 3件目で対応予定）
- 本Issueのrebaseは「pathが復元先に実在するか」までは検証するが、「artifactディレクトリの中身が完全か（全ファイルが揃っているか）」までは検証しない。`metadata_only`復元後にTrOCRのconfig.jsonのみが存在する不完全な状態でもrebase自体は成功しうるため、真に必要なら将来的に「必須ファイルの存在確認」を追加する余地がある
