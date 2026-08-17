# TrOCR Training Dataset Adapter 作業記録

Related: Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR学習・評価・Benchmark・Release Gate統合） / Investigation [#88](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/88)（[TROCR_TRAINING_INVESTIGATION_88.md](TROCR_TRAINING_INVESTIGATION_88.md)） / Feature [#90](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/90)

**状態**: Completed・Closed。PR [#91](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/91)をSquash Merge・mainへ反映済み、Merge Commit: `7cc8da6`。Issue #90はPR本文の`Closes #90`によりマージ時に自動Close。

## 目的

Investigation #88で確定した実装分割の第1段階として、既存OCR Dataset（`train.txt`/`val.txt`/`test.txt` + `meta.json`）をTrOCR Training Backend Core（次Issue、本Issueの対象外）が安全に消費できるDataset Adapterを実装する。Trainer・Processor・モデルへの依存は一切持たない。

## 実装前調査

- 既存の書込元 `services/ocr_pipeline.py::create_ocr_dataset()`（1089-1297行目）を確認し、`{split}/images/*.png` + `{split}.txt`（タブ区切り`rel_path\ttext`）+ `meta.json`の形式・書込順序を確認した。
- 既存の読込側 `services/tesseract_pipeline.py::_read_dataset_pairs()`（250-277行目）を確認し、書式異常行・画像不存在・空groundtruthを**黙ってスキップ**する寛容な契約であること、`train`のみ0件をエラーとし`val`は0件を許容する契約であること、`dataset_root`外参照（path traversal）を検証していないことを確認した。
- **重要な発見**: `create_ocr_dataset()`が画像を書き出す直前に必ず`_prepare_ocr_image()`→`preprocess_ocr_image()`（グレースケール化・固定キャンバスへのレターボックス整形、既定`[1,48,320]`）を通しており、**データセット出力に元画像（raw source）は一切保存されない**（該当コードを実際に読み、rawコピーを保存する分岐が存在しないことを確認済み）。この事実はInvestigation #88で懸念として指摘されていたが、本Issueの調査で「回避不能な既存の制約」であることを確定させた（後述）。

## 実装内容

### `src/app/services/trocr_dataset_adapter.py`（新規）

- `TrocrDatasetSample`（frozen dataclass）: `image_path: Path` + `text: str`の最小契約。画像は開かない・読み込まない。
- `TrocrDatasetError`（`ValueError`のサブクラス）: malformed dataset検出用の専用例外。
- `load_trocr_training_samples(dataset_root, split="train") -> list[TrocrDatasetSample]`: `{split}.txt`を決定的な順序（ファイル内の行順）で読み込み検証する。
- `read_trocr_dataset_meta(dataset_root) -> dict`: `meta.json`をそのまま読み込む（新しいメタデータ形式は作らない）。

### Validation方針（既存readerとの意図的な差異、レビュー時に説明が必要な設計判断）

既存`_read_dataset_pairs()`は書式異常・画像不存在・空groundtruthを黙ってスキップするが、本Adapterは**Issue #90が明示的に要求する「malformed datasetを学習開始前に検出できる」**という異なる目的のため、これらを`TrocrDatasetError`で明確に拒否する（既存の寛容な動作は複製しない）。

一方、以下2点は既存契約とあえて整合させた（新しいポリシーを発明しない）。

- **train split以外（val/test）は0件でもエラーにしない**（既存`_read_dataset_pairs()`の`val`と同じ扱い）
- **重複するimage pathをエラーにしない**（既存readerも重複を検出・拒否していない。同一画像を複数回学習に使うこと自体は既存契約上のエラーではない）

また、既存`_read_dataset_pairs()`には無い安全策として、解決後のパスが`dataset_root`の外を指していないか（`Path.relative_to()`によるroot内チェック）を新規に追加した（既存コードは変更せず、新規に書く本Adapterにのみ適用）。

### Preprocessing Boundary（既知の制約の明文化）

本Adapterは画像のresize/normalize/RGB変換を一切行わない。加えて、モジュールdocstringで以下を明文化した。

- Adapterが返す画像パスは、`create_ocr_dataset()`が既に`preprocess_ocr_image()`で加工済みの画像を常に指す
- `meta.json`の`source_image_state`は**データセット作成時の入力候補画像の状態**を表すものであり、**最終的に書き出された画像ファイル自体が加工済みかどうかを示すフラグではない**（後者は常に加工済みで固定）
- raw画像へ戻る手段は現行Dataset単体には無い。対応が必要ならDataset生成自体の変更（raw画像の追加保存）が必要であり、Dataset schema変更を伴うため**本Issueでは対応せず、次Issue（Training Backend Core）以降への制約として引き継ぐ**（Issue #90本文の指示どおり、推測でschema変更しない）

### No Model Dependency

`transformers`/`torch`/`PIL`のいずれもimportしない（`json`/`dataclasses`/`pathlib`/`typing`のみに依存）。`tests/test_trocr_dataset_adapter.py::test_module_has_no_model_or_image_processing_dependency`でモジュールの実importを静的に固定化した。

## Tests

`tests/test_trocr_dataset_adapter.py`（新規、22件）:

- 正常系: valid dataset load、複数sample、日本語/Unicode groundtruth、決定的な順序、重複entry許容、val/test 0件許容、空行スキップ
- 異常系: dataset root不存在、dataset rootがファイル、`train.txt`不存在、未知split、タブ区切りなし、画像パス空、groundtruth空、画像不存在、train 0件、path traversal
- `meta.json`: 正常読込、不存在、JSON不正、JSONオブジェクトでない
- 依存非混入の静的固定化テスト

`python -m pytest -q tests/test_trocr_dataset_adapter.py` — 22 passed。全体`python -m pytest -q` — 既知Issue #8以外の新規failureなし（実行結果は本ドキュメント末尾のCompletion Report相当箇所、またはPR説明を参照）。

## Documentation

- 本ドキュメント（新規）
- `docs/workitems/trocr/EPIC_27_TROCR_LIFECYCLE.md`・`docs/workitems/trocr/ISSUE_MAP.md`を更新（Feature #90の進捗を反映）

## マージ前レビューでの是正

セルフレビューで、`_parse_manifest_line()`が`rel_path`のみ`strip()`し`text`（groundtruth）を
`strip()`せずに空判定していたため、空白のみのgroundtruth（例: `"path\t   "`）が
truthyのまま素通りしてしまう不具合を検出した。既存`_read_dataset_pairs()`は`text.strip()`
してから空判定しているのと不整合だったため、同じ扱いへ修正（`text`をstripしてから
空判定・stripした値を返す）。回帰テスト`test_malformed_line_whitespace_only_ground_truth_raises`・
`test_ground_truth_text_is_stripped`を追加。

## Out of Scope（次Issue以降）

- TrOCR Training Backend Core（Hugging Face Processor/Trainer接続）
- `job_runner.py`統合・training API・progress/cancel
- Artifact/checkpoint保存・Model Registry登録・Experiment tracking書込
- Training UI
- Dataset schema変更（raw画像の追加保存を含む。上記「Preprocessing Boundary」参照）
