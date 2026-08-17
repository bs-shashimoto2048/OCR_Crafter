"""TrOCR Training Dataset Adapter（Issue #90、`src/app/services/trocr_dataset_adapter.py`）のテスト。

既存OCR Dataset形式（`train.txt`/`val.txt`/`test.txt` + `meta.json`）をtmp_path上に
手作りし、実際のDataset作成処理（`create_ocr_dataset()`）・実画像・transformers/torch/
PIL・model downloadに一切依存せずAdapter単体の読込・検証ロジックを検証する。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.app.services.trocr_dataset_adapter import (
    TrocrDatasetError,
    TrocrDatasetSample,
    load_trocr_training_samples,
    read_trocr_dataset_meta,
)


def _touch_image(path: Path) -> None:
    """画像の中身は本Adapterが一切読まないため、存在確認だけできればよい
    （空ファイルで十分。PIL/transformers等の実画像デコードには依存しない）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")


def _write_manifest(root: Path, split: str, lines: list[str]) -> None:
    (root / f"{split}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _build_valid_dataset(root: Path) -> None:
    """create_ocr_dataset()が実際に書き出す形式を模した最小データセット。"""
    _touch_image(root / "train" / "images" / "train_000001.png")
    _touch_image(root / "train" / "images" / "train_000002.png")
    _touch_image(root / "val" / "images" / "val_000001.png")
    _write_manifest(
        root,
        "train",
        ["train/images/train_000001.png\tABC", "train/images/train_000002.png\tXYZ"],
    )
    _write_manifest(root, "val", ["val/images/val_000001.png\tKLM"])
    _write_manifest(root, "test", [])
    (root / "meta.json").write_text(
        json.dumps({"image_shape": [1, 48, 320], "charset": "ABCXYZKLM", "split_method": "image"}),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# 正常系
# ---------------------------------------------------------------------------


def test_valid_dataset_load(tmp_path):
    _build_valid_dataset(tmp_path)
    samples = load_trocr_training_samples(tmp_path, split="train")
    assert samples == [
        TrocrDatasetSample(image_path=(tmp_path / "train" / "images" / "train_000001.png").resolve(), text="ABC"),
        TrocrDatasetSample(image_path=(tmp_path / "train" / "images" / "train_000002.png").resolve(), text="XYZ"),
    ]


def test_multiple_samples_and_val_split(tmp_path):
    _build_valid_dataset(tmp_path)
    train = load_trocr_training_samples(tmp_path, split="train")
    val = load_trocr_training_samples(tmp_path, split="val")
    assert len(train) == 2
    assert len(val) == 1
    assert val[0].text == "KLM"


def test_japanese_unicode_ground_truth(tmp_path):
    _touch_image(tmp_path / "train" / "images" / "a.png")
    _write_manifest(tmp_path, "train", ["train/images/a.png\tこんにちは世界"])
    samples = load_trocr_training_samples(tmp_path, split="train")
    assert samples[0].text == "こんにちは世界"


def test_deterministic_ordering(tmp_path):
    _build_valid_dataset(tmp_path)
    first = load_trocr_training_samples(tmp_path, split="train")
    second = load_trocr_training_samples(tmp_path, split="train")
    assert [s.image_path for s in first] == [s.image_path for s in second]
    assert first == second


def test_duplicate_image_entries_are_not_rejected(tmp_path):
    """既存tesseract_pipeline.py::_read_dataset_pairs()も重複を検出・拒否しない
    （同一画像を複数回学習に使うこと自体は既存契約上のエラーではない）。"""
    _touch_image(tmp_path / "train" / "images" / "a.png")
    _write_manifest(
        tmp_path,
        "train",
        ["train/images/a.png\tABC", "train/images/a.png\tABC"],
    )
    samples = load_trocr_training_samples(tmp_path, split="train")
    assert len(samples) == 2
    assert samples[0] == samples[1]


def test_empty_val_and_test_split_is_not_an_error(tmp_path):
    """train split以外は0件でもエラーにしない（既存_read_dataset_pairs()と同じ契約）。"""
    _touch_image(tmp_path / "train" / "images" / "a.png")
    _write_manifest(tmp_path, "train", ["train/images/a.png\tABC"])
    _write_manifest(tmp_path, "val", [])
    _write_manifest(tmp_path, "test", [])
    assert load_trocr_training_samples(tmp_path, split="val") == []
    assert load_trocr_training_samples(tmp_path, split="test") == []


def test_blank_lines_in_manifest_are_skipped(tmp_path):
    _touch_image(tmp_path / "train" / "images" / "a.png")
    (tmp_path / "train.txt").write_text("\n\ntrain/images/a.png\tABC\n\n", encoding="utf-8")
    samples = load_trocr_training_samples(tmp_path, split="train")
    assert len(samples) == 1


# ---------------------------------------------------------------------------
# 異常系: dataset root / manifest不存在
# ---------------------------------------------------------------------------


def test_missing_dataset_root_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_trocr_training_samples(tmp_path / "does_not_exist", split="train")


def test_dataset_root_is_a_file_not_a_directory_raises(tmp_path):
    not_a_dir = tmp_path / "not_a_dir"
    not_a_dir.write_text("x", encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        load_trocr_training_samples(not_a_dir, split="train")


def test_missing_train_txt_raises_file_not_found(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    with pytest.raises(FileNotFoundError):
        load_trocr_training_samples(tmp_path, split="train")


def test_unknown_split_raises(tmp_path):
    _build_valid_dataset(tmp_path)
    with pytest.raises(TrocrDatasetError):
        load_trocr_training_samples(tmp_path, split="bogus")


# ---------------------------------------------------------------------------
# 異常系: malformed manifest（本Adapter独自の厳格な検証。既存readerは黙ってスキップするが、
# 本Adapterは学習開始前の検出という目的のため明示的にTrocrDatasetErrorを送出する）
# ---------------------------------------------------------------------------


def test_malformed_line_missing_tab_raises(tmp_path):
    _touch_image(tmp_path / "train" / "images" / "a.png")
    (tmp_path / "train.txt").write_text("train/images/a.png ABC (no tab)\n", encoding="utf-8")
    with pytest.raises(TrocrDatasetError, match="missing tab separator"):
        load_trocr_training_samples(tmp_path, split="train")


def test_malformed_line_empty_path_raises(tmp_path):
    (tmp_path / "train.txt").write_text("\tABC\n", encoding="utf-8")
    tmp_path.mkdir(exist_ok=True)
    with pytest.raises(TrocrDatasetError, match="empty image path"):
        load_trocr_training_samples(tmp_path, split="train")


def test_malformed_line_empty_ground_truth_raises(tmp_path):
    _touch_image(tmp_path / "train" / "images" / "a.png")
    (tmp_path / "train.txt").write_text("train/images/a.png\t\n", encoding="utf-8")
    with pytest.raises(TrocrDatasetError, match="empty ground truth text"):
        load_trocr_training_samples(tmp_path, split="train")


def test_malformed_line_whitespace_only_ground_truth_raises(tmp_path):
    """マージ前レビューで検出: text.strip()せずに空判定すると"   "（空白のみ）が
    truthyのまま通ってしまう不具合があったための回帰テスト。"""
    _touch_image(tmp_path / "train" / "images" / "a.png")
    (tmp_path / "train.txt").write_text("train/images/a.png\t   \n", encoding="utf-8")
    with pytest.raises(TrocrDatasetError, match="empty ground truth text"):
        load_trocr_training_samples(tmp_path, split="train")


def test_ground_truth_text_is_stripped(tmp_path):
    _touch_image(tmp_path / "train" / "images" / "a.png")
    (tmp_path / "train.txt").write_text("train/images/a.png\t  ABC  \n", encoding="utf-8")
    samples = load_trocr_training_samples(tmp_path, split="train")
    assert samples[0].text == "ABC"


def test_missing_image_raises(tmp_path):
    (tmp_path / "train.txt").write_text("train/images/does_not_exist.png\tABC\n", encoding="utf-8")
    tmp_path.mkdir(exist_ok=True)
    with pytest.raises(TrocrDatasetError, match="image not found"):
        load_trocr_training_samples(tmp_path, split="train")


def test_empty_train_split_raises(tmp_path):
    _write_manifest(tmp_path, "train", [])
    with pytest.raises(TrocrDatasetError, match="no valid samples"):
        load_trocr_training_samples(tmp_path, split="train")


def test_path_traversal_outside_dataset_root_is_rejected(tmp_path):
    """train.txtに../等でdataset_root外を参照する行があれば拒否する
    （既存_read_dataset_pairs()には無い、本Adapter独自の安全策）。"""
    outside_dir = tmp_path.parent / "outside_target"
    outside_dir.mkdir(exist_ok=True)
    outside_image = outside_dir / "secret.png"
    outside_image.write_bytes(b"")
    dataset_root = tmp_path / "dataset"
    dataset_root.mkdir()
    rel = f"../{outside_dir.name}/secret.png"
    (dataset_root / "train.txt").write_text(f"{rel}\tABC\n", encoding="utf-8")
    with pytest.raises(TrocrDatasetError, match="escapes dataset root"):
        load_trocr_training_samples(dataset_root, split="train")


# ---------------------------------------------------------------------------
# meta.json
# ---------------------------------------------------------------------------


def test_read_meta_json(tmp_path):
    _build_valid_dataset(tmp_path)
    meta = read_trocr_dataset_meta(tmp_path)
    assert meta["image_shape"] == [1, 48, 320]
    assert meta["charset"] == "ABCXYZKLM"


def test_meta_json_missing_raises_file_not_found(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    (tmp_path / "train.txt").write_text("", encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        read_trocr_dataset_meta(tmp_path)


def test_meta_json_malformed_raises_trocr_dataset_error(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    (tmp_path / "meta.json").write_text("{not valid json", encoding="utf-8")
    with pytest.raises(TrocrDatasetError, match="not valid JSON"):
        read_trocr_dataset_meta(tmp_path)


def test_meta_json_not_an_object_raises(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    (tmp_path / "meta.json").write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(TrocrDatasetError, match="JSON object"):
        read_trocr_dataset_meta(tmp_path)


# ---------------------------------------------------------------------------
# 依存関係の非混入（Trainer/model/画像処理ライブラリを一切importしないこと）
# ---------------------------------------------------------------------------


def test_module_has_no_model_or_image_processing_dependency():
    """本Issueの制約（No Model Dependency / Preprocessing Boundary）を静的に固定化する:
    transformers/torch/PIL等の実際のimport文が混入していないことをソース自体から確認する
    （モジュールdocstring中の説明文言としての言及は許容し、実import行のみを検査する）。"""
    source = Path("src/app/services/trocr_dataset_adapter.py").read_text(encoding="utf-8")
    import_lines = [
        line.strip()
        for line in source.splitlines()
        if line.strip().startswith("import ") or line.strip().startswith("from ")
    ]
    for forbidden in ("transformers", "torch", "PIL"):
        assert not any(forbidden in line for line in import_lines), (
            f"禁止依存 {forbidden!r} を参照するimport文が混入している: {import_lines}"
        )
    assert import_lines == [
        "from __future__ import annotations",
        "import json",
        "from dataclasses import dataclass",
        "from pathlib import Path",
        "from typing import Any",
    ]
