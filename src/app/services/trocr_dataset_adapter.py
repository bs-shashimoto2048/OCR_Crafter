"""TrOCR Training Dataset Adapter（Issue #90）。

**目的は新しいDataset schemaを作ることではない。** 既存OCR Dataset（`ocr_pipeline.py::
create_ocr_dataset()`が書き出す`train.txt`/`val.txt`/`test.txt`+`meta.json`）を、
TrOCR Training Backend Core（次Issue、Out of Scope）が消費できる最小契約（image path +
ground truth text）へ橋渡しするだけのAdapterである。Investigation #88の結論どおり、
既存Dataset schema自体はEngine非依存であり変更しない。

```text
既存OCR Dataset（train.txt/val.txt/test.txt + meta.json）
        ↓
trocr_dataset_adapter（本モジュール。読込・検証のみ）
        ↓
TrOCR Training Backend Core（次Issue。Hugging Face Processor/Trainerへの接続）
```

## 責務境界（重要）

本Adapterは以下を一切行わない（次Issueの責務、またはTrOCR Processor自身の責務）。

- 画像のresize/normalize/RGB変換（TrOCR Processorが担当すべき処理）
- Hugging Face `datasets.Dataset` / `Seq2SeqTrainer`との接続
- `TrOCRProcessor` / `AutoProcessor` / `VisionEncoderDecoderModel` / `Seq2SeqTrainer`の
  import・ロード（本モジュールはtransformers/torchに一切依存しない）
- `job_runner.py`統合・training API・progress/cancel・artifact保存・Model Registry登録・
  Experiment tracking書込（いずれも後続Issueの責務）

## 既知の制約: 画像は既に加工済みである（Investigation #88で指摘、本Issueでは解決しない）

`create_ocr_dataset()`（`ocr_pipeline.py:1089-1297`）が書き出す`{split}/images/*.png`は、
画像生成時に必ず`_prepare_ocr_image()`→`preprocess_ocr_image()`
（グレースケール化・固定キャンバスへのレターボックス整形。既定`[1, 48, 320]`、
Tesseract/PaddleOCRのCRNN入力向け）を通した**加工済み画像**であり、元画像（raw source）は
データセット出力に一切保存されない（`ocr_pipeline.py`の該当箇所を実際に読み、
rawコピーを別途保存する分岐が存在しないことを確認済み）。`meta.json`の
`source_image_state`/`source_state_counts`は**データセット作成時に入力した候補画像の状態**
（processed/interim/raw）を表すものであり、**最終的に書き出された画像ファイル自体が
加工済みかどうかを示すフラグではない**（後者は常に加工済みで固定、前者の値に関わらず不変）。

したがって、本Adapterが返す画像パスは常にこのCRNN向け加工済み画像を指す。TrOCRの
`ViTImageProcessor`相当が別解像度・カラー正規化を要求する場合、この画像が二重前処理の
起点になりうる。**本Adapterはこの事実をそのまま返し、推測で変換・補完しない。**
raw画像を必要とする場合はDataset生成自体の変更（raw画像の追加保存）が必要であり、
Dataset schema変更を伴うため本Issueでは対応せず、後続Issueへ制約として引き継ぐ
（Issue #90本文の指示どおり）。

## Validation方針（既存Dataset readerとの意図的な差異）

既存`tesseract_pipeline.py::_read_dataset_pairs()`は、書式異常行・画像不存在・空文字列の
groundtruthを**黙ってスキップ**する（既存Tesseract/PaddleOCR学習の実運用上の寛容な契約）。
本Adapterは**Issue #90が明示的に要求する「malformed datasetを学習開始前に検出できる」**
という異なる目的（TrOCR学習を無駄な計算前に停止させる事前検証）のため、意図的に
異なる契約を採用する: 書式異常・画像不存在・空groundtruthは`TrocrDatasetError`で
明確に拒否する（黙ってスキップしない）。既存readerの寛容な動作を複製しない。

一方、以下は既存契約（`_read_dataset_pairs()`の実際の挙動）とあえて整合させる。

- **train split以外（val/test）が0件でもエラーにしない**（既存`_read_dataset_pairs()`が
  `val`について同じ扱いをしているのと同じ。train splitのみ1件以上を必須とする）
- **重複するimage pathをエラーにしない**（既存readerも重複を検出・拒否しておらず、
  同一画像を複数回学習に使うこと自体は既存契約上のエラーではないため）

## Path Traversal（新規に追加した安全策）

既存`_read_dataset_pairs()`は`(root / rel).resolve()`のみで、解決後のパスが
`dataset_root`の外を指していないか（`../../`等によるroot外参照）を検証していない
（実コード確認済みの既存の潜在的ギャップ。本Issueでは既存コードを変更しないため
修正しないが、**新規に書く本Adapterでは最初から`Path.relative_to()`による
root内チェックを組み込む**）。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SPLIT_NAMES: tuple[str, ...] = ("train", "val", "test")

# train split以外は0件を許容する（既存tesseract_pipeline.py::_read_dataset_pairs()と同じ契約）。
_REQUIRED_NON_EMPTY_SPLITS: tuple[str, ...] = ("train",)


class TrocrDatasetError(ValueError):
    """TrOCR Training Dataset Adapterが検出したmalformed datasetを表す。"""


@dataclass(frozen=True)
class TrocrDatasetSample:
    """1 Sample分の最小契約（image path + ground truth text）。

    画像ファイル自体は開かない・読み込まない（本Adapterの責務外。呼び出し側＝
    Training Backend Coreが実際に画像を読み込みTrOCR Processorへ渡す）。
    """

    image_path: Path
    text: str


def _resolve_dataset_root(dataset_root: str | Path) -> Path:
    root = Path(dataset_root).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"dataset root not found: {dataset_root}")
    return root


def _parse_manifest_line(line: str, line_number: int, split: str) -> tuple[str, str]:
    """`{split}.txt`の1行（`"rel/path\\ttext"`）をパースする。

    書式異常（タブ区切りが無い・パスが空・groundtruthが空）は`TrocrDatasetError`で
    明確に拒否する（モジュールdocstring「Validation方針」参照。黙ってスキップしない）。
    """
    if "\t" not in line:
        raise TrocrDatasetError(f"{split}.txt line {line_number}: missing tab separator: {line!r}")
    rel_path, _, text = line.partition("\t")
    rel_path = rel_path.strip()
    # 既存_read_dataset_pairs()と同じくtextもstripしてから空判定する（空白のみの
    # groundtruthを非空と誤判定しない。stripしないとtext=="   "がtruthyのまま通ってしまう）
    text = text.strip()
    if not rel_path:
        raise TrocrDatasetError(f"{split}.txt line {line_number}: empty image path")
    if not text:
        raise TrocrDatasetError(f"{split}.txt line {line_number}: empty ground truth text")
    return rel_path, text


def _resolve_within_root(root: Path, rel_path: str, line_number: int, split: str) -> Path:
    """`dataset_root`外参照（path traversal）を拒否しつつ絶対パスへ解決する。"""
    candidate = (root / rel_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as e:
        raise TrocrDatasetError(
            f"{split}.txt line {line_number}: image path escapes dataset root: {rel_path!r}"
        ) from e
    return candidate


def load_trocr_training_samples(dataset_root: str | Path, split: str = "train") -> list[TrocrDatasetSample]:
    """既存OCR Dataset（`{split}.txt`）からTrOCR Training用Sample列を決定的な順序で読み込む。

    ファイル内の行順をそのまま返す（同一入力に対し常に同じ順序・同じ結果。乱数・
    シャッフルは行わない。シャッフルが必要ならTraining Backend Core側の責務とする）。

    Trainer/Processor/model依存を一切持たない（純粋なファイル読込+検証のみ）。

    - `dataset_root`が存在しない・ディレクトリでない → `FileNotFoundError`
    - `{split}.txt`が存在しない → `FileNotFoundError`
    - 書式異常行・画像不存在・空groundtruth・root外参照 → `TrocrDatasetError`
    - `split="train"`で有効なsampleが0件 → `TrocrDatasetError`
      （`val`/`test`は0件でもエラーにしない。モジュールdocstring参照）
    - 重複するimage pathはエラーにしない（既存契約と同じ）
    """
    if split not in SPLIT_NAMES:
        raise TrocrDatasetError(f"unknown split: {split!r} (expected one of {SPLIT_NAMES})")

    root = _resolve_dataset_root(dataset_root)
    manifest_path = root / f"{split}.txt"
    if not manifest_path.exists():
        raise FileNotFoundError(f"{split}.txt not found under dataset root: {dataset_root}")

    samples: list[TrocrDatasetSample] = []
    for index, raw_line in enumerate(manifest_path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip("\r\n")
        if not line.strip():
            continue  # 空行のみ許容（既存書込ロジックの末尾改行等）
        rel_path, text = _parse_manifest_line(line, index, split)
        image_path = _resolve_within_root(root, rel_path, index, split)
        if not image_path.exists() or not image_path.is_file():
            raise TrocrDatasetError(f"{split}.txt line {index}: image not found: {image_path}")
        samples.append(TrocrDatasetSample(image_path=image_path, text=text))

    if not samples and split in _REQUIRED_NON_EMPTY_SPLITS:
        raise TrocrDatasetError(f"{split}.txt contains no valid samples under dataset root: {dataset_root}")

    return samples


def read_trocr_dataset_meta(dataset_root: str | Path) -> dict[str, Any]:
    """`meta.json`をそのまま読み込む（新しいメタデータ形式は作らない）。

    TrOCR観点で参照する可能性がある既存フィールドの意味（呼び出し側の判断材料。
    本関数自体は解釈・変換を行わない）:

    - `image_shape`: データセット画像へ実際に焼き込まれた固定キャンバスの
      `[channels, height, width]`（モジュールdocstring「既知の制約」参照。TrOCR
      Processorが別解像度を要求する場合の参考値）
    - `charset`: Tesseract/PaddleOCRの`character_dict_path`用文字集合。TrOCR
      （トークナイザベース）に適用する契約は無いため、そのまま使わない
    - `split_method`: 現状`"image"`固定（画像単位分割。Series/グループ単位は未実装）
    - `counts`: 分割ごとのsample数（`{split}.txt`の実件数と照合する用途に使える）

    - `dataset_root`が存在しない・ディレクトリでない → `FileNotFoundError`
    - `meta.json`が存在しない → `FileNotFoundError`
    - JSONとして不正 → `TrocrDatasetError`
    """
    root = _resolve_dataset_root(dataset_root)
    meta_path = root / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"meta.json not found under dataset root: {dataset_root}")
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise TrocrDatasetError(f"meta.json is not valid JSON: {meta_path}") from e
    if not isinstance(data, dict):
        raise TrocrDatasetError(f"meta.json does not contain a JSON object: {meta_path}")
    return data
