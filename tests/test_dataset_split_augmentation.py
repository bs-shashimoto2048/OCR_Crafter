"""データ分割（最大剰余法）と学習時オーグメンテーションのテスト。

- 分割枚数: 期待値の厳密一致（1000×0.8/0.1/0.1=800/100/100 等）・端数ケースの合計保証・
  重複/欠落なし・Seed再現性・比率合計の検証
- オーグメンテーション: Trainのみへ適用・元画像は必ず残す・ラベル不変・メタ保存
"""

import json

import numpy as np
import pytest
from PIL import Image

from src.app.services.ocr_pipeline import (
    WEAK_AUGMENTATION_CONFIG,
    compute_split_counts,
    create_ocr_dataset,
    parse_augmentation_config,
    preview_ocr_dataset_split,
)


# ---------- compute_split_counts（純関数） ----------


@pytest.mark.parametrize(
    ("total", "ratios", "expected"),
    [
        (1000, (0.80, 0.10, 0.10), (800, 100, 100)),
        (1000, (0.85, 0.10, 0.05), (850, 100, 50)),
        (1000, (0.70, 0.15, 0.15), (700, 150, 150)),
        (897, (0.85, 0.10, 0.05), (762, 90, 45)),  # タスク記載の端数例
        (997, (0.80, 0.10, 0.10), (797, 100, 100)),
        (11, (0.80, 0.10, 0.10), (9, 1, 1)),
    ],
)
def test_compute_split_counts_expected(total, ratios, expected):
    counts = compute_split_counts(total, *ratios)
    assert (counts["train"], counts["val"], counts["test"]) == expected
    assert counts["train"] + counts["val"] + counts["test"] == total


def test_compute_split_counts_always_sums_to_total():
    """任意の組み合わせで合計が常に一致する（浮動小数点誤差・端数処理の網羅確認）。"""
    ratios_list = [(0.8, 0.1, 0.1), (0.85, 0.1, 0.05), (0.7, 0.15, 0.15), (0.75, 0.2, 0.05), (0.9, 0.05, 0.05)]
    for total in [1, 2, 3, 10, 11, 99, 100, 101, 897, 997, 1000, 1234]:
        for ratios in ratios_list:
            counts = compute_split_counts(total, *ratios)
            assert counts["train"] + counts["val"] + counts["test"] == total, (total, ratios, counts)
            assert counts["train"] >= 1  # train_ratio>0なら最低1枚


def test_compute_split_counts_tie_order_prefers_train():
    """小数部分が同値の場合の優先順位は Train → Val → Test（仕様固定）。"""
    # 10枚を 1/3ずつ: 各3.33...（小数部同値）→ 残り1枚はTrainへ
    counts = compute_split_counts(10, 1 / 3, 1 / 3, 1 / 3)
    assert counts == {"train": 4, "val": 3, "test": 3}


# ---------- create_ocr_dataset（統合） ----------


def _setup_labeled_project(temp_projects, count: int) -> str:
    """wide画像count枚＋master.csvを持つプロジェクトを作る。"""
    project_id = "p1"
    root = temp_projects["projects_dir"] / project_id
    images_dir = root / "processed" / "wide" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    lines = ["filename,label,type"]
    for i in range(count):
        name = f"img_{i:04d}.png"
        arr = np.full((32, 96), 255, dtype=np.uint8)
        arr[:, (i * 3) % 90 : (i * 3) % 90 + 4] = 0  # 画像ごとに異なる内容
        Image.fromarray(arr, mode="L").save(images_dir / name)
        lines.append(f"{name},AB{i % 10},wide")
    annotations = root / "annotations"
    annotations.mkdir(parents=True, exist_ok=True)
    (annotations / "master.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return project_id


def _read_split_names(dataset_root, split):
    text = (dataset_root / f"{split}.txt").read_text(encoding="utf-8")
    return [line.split("\t")[0] for line in text.splitlines() if line.strip()]


def test_create_dataset_split_exact_and_no_overlap(temp_projects):
    project_id = _setup_labeled_project(temp_projects, 20)
    result = create_ocr_dataset(
        project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=42,
    )
    assert result["counts"] == {"train": 16, "val": 2, "test": 2}
    assert result["valid_count"] == 20
    assert result["input_count"] == 20
    assert result["split_method"] == "image"
    from pathlib import Path

    dataset_root = Path(result["dataset_root"])
    names = {s: _read_split_names(dataset_root, s) for s in ("train", "val", "test")}
    all_names = names["train"] + names["val"] + names["test"]
    assert len(all_names) == 20
    assert len(set(all_names)) == 20  # 重複なし・欠落なし


def test_create_dataset_same_seed_reproducible_and_different_seed_changes(temp_projects):
    project_id = _setup_labeled_project(temp_projects, 20)

    def _labels_of(seed, tag):
        result = create_ocr_dataset(
            project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
            train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=seed,
            output_dir=str(temp_projects["tmp"] / f"ds_{tag}"),
        )
        from pathlib import Path

        root = Path(result["dataset_root"])
        # 割り当ての同一性はラベル列（シャッフル順）で比較する
        return tuple((root / f"{s}.txt").read_text(encoding="utf-8") for s in ("train", "val", "test"))

    first = _labels_of(42, "a")
    second = _labels_of(42, "b")
    third = _labels_of(7, "c")
    assert first == second  # 同じSeed→同じ分割
    assert first != third  # 異なるSeed→割り当てが変化


def test_create_dataset_ratio_sum_validation(temp_projects):
    project_id = _setup_labeled_project(temp_projects, 5)
    with pytest.raises(ValueError, match="sum to 1.0"):
        create_ocr_dataset(
            project_id=project_id, image_types=["wide"], charset="AB0123456789",
            train_ratio=0.85, val_ratio=0.10, test_ratio=0.10,
        )
    # 浮動小数点誤差は許容（0.7+0.2+0.1=0.9999999999999999）
    result = create_ocr_dataset(
        project_id=project_id, image_types=["wide"], charset="AB0123456789",
        train_ratio=0.7, val_ratio=0.2, test_ratio=0.1,
        output_dir=str(temp_projects["tmp"] / "ds_float"),
    )
    assert sum(result["counts"].values()) == 5


def test_split_preview_reports_input_valid_and_skipped(temp_projects):
    project_id = _setup_labeled_project(temp_projects, 10)
    # 1件をcharset外ラベルへ（有効9枚になる）
    root = temp_projects["projects_dir"] / project_id
    csv_path = root / "annotations" / "master.csv"
    lines = csv_path.read_text(encoding="utf-8").splitlines()
    lines[1] = lines[1].replace("AB", "??")  # charset外
    csv_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    preview = preview_ocr_dataset_split(
        project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1,
    )
    assert preview["input_count"] == 10
    assert preview["valid_count"] == 9
    assert preview["skipped"]["invalid_label"] == 1
    assert sum(preview["counts"].values()) == 9
    assert preview["split_method"] == "image"


# ---------- オーグメンテーション ----------


def test_parse_augmentation_config():
    assert parse_augmentation_config(None) is None
    assert parse_augmentation_config({"preset": "none"}) is None
    weak = parse_augmentation_config(dict(WEAK_AUGMENTATION_CONFIG))
    assert weak["preset"] == "weak"
    assert weak["rotation"]["max_degrees"] == 2.0
    assert weak["multiplier"] == 1.5
    # クランプ: 回転は±10°以内・確率0〜1・倍率1.0〜3.0
    clamped = parse_augmentation_config(
        {"preset": "custom", "multiplier": 99, "rotation": {"enabled": True, "max_degrees": 45, "probability": 5}}
    )
    assert clamped["multiplier"] == 3.0
    assert clamped["rotation"]["max_degrees"] == 10.0
    assert clamped["rotation"]["probability"] == 1.0
    # 全て無効はNone（未使用扱い）
    assert parse_augmentation_config({"preset": "custom", "rotation": {"enabled": False}}) is None


def test_augmentation_applies_to_train_only_and_keeps_labels(temp_projects):
    project_id = _setup_labeled_project(temp_projects, 20)
    result = create_ocr_dataset(
        project_id=project_id, image_types=["wide"], charset="AB0123456789", max_text_length=8,
        train_ratio=0.8, val_ratio=0.1, test_ratio=0.1, seed=42,
        augmentation={**WEAK_AUGMENTATION_CONFIG, "multiplier": 1.5},
    )
    from pathlib import Path

    dataset_root = Path(result["dataset_root"])
    # 分割枚数（元画像）は不変・生成枚数は(1.5-1)×16=8枚
    assert result["counts"] == {"train": 16, "val": 2, "test": 2}
    assert result["augmentation_generated"] == 8
    assert result["augmentation"]["preset"] == "weak"

    train_lines = (dataset_root / "train.txt").read_text(encoding="utf-8").splitlines()
    val_lines = (dataset_root / "val.txt").read_text(encoding="utf-8").splitlines()
    test_lines = (dataset_root / "test.txt").read_text(encoding="utf-8").splitlines()
    # Trainのみaugファイルがある（元16＋aug8）。Val/Testには無い
    aug_train = [line for line in train_lines if "train_aug_" in line]
    assert len(aug_train) == 8
    assert len(train_lines) == 24
    assert all("aug" not in line for line in val_lines + test_lines)
    # 元画像もTrainへ必ず残る
    originals = [line for line in train_lines if "train_aug_" not in line]
    assert len(originals) == 16
    # ラベル不変: augラベルは元Trainラベルの集合に含まれる
    original_labels = {line.split("\t")[1] for line in originals}
    for line in aug_train:
        assert line.split("\t")[1] in original_labels
    # メタへ設定が保存される
    meta = json.loads((dataset_root / "meta.json").read_text(encoding="utf-8"))
    assert meta["augmentation"]["rotation"]["enabled"] is True
    assert meta["augmentation_generated"] == 8
    assert meta["seed"] == 42
    assert meta["split_method"] == "image"
