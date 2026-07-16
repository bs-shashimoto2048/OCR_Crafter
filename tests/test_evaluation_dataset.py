"""学習画像作成 Step5（評価用データ作成）のバックエンドテスト。

- Step4出力マニフェスト（対応関係の確定保存）
- 評価候補の取得・プロジェクト分離
- 回転焼き込み（学習画像は変更しない・評価コピーのみ）
- ground_truth.csv が既存モデル評価（_read_gt_csv）で読めること
"""

import io
import json
from pathlib import Path

import pytest
from PIL import Image

import src.app.services.evaluation_dataset as eval_ds
import src.app.services.training_image_builder as tib
from src.app.services.ocr_evaluation import _read_gt_csv


def _png_bytes(width=200, height=100, color=(255, 255, 255)):
    img = Image.new("RGB", (width, height), color)
    # 回転検証用に左上へ目印を置く
    for x in range(10):
        for y in range(6):
            img.putpixel((x, y), (255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _boxes_json():
    return json.dumps(
        [
            {"id": 1, "label": "tube", "confidence": 0.9, "x1": 10, "y1": 10, "x2": 90, "y2": 40},
            {"id": 2, "label": "nmb", "confidence": 0.8, "x1": 100, "y1": 50, "x2": 180, "y2": 90},
        ]
    )


def _run_export(temp_projects, project_id="p1", out_name="crops"):
    out_dir = temp_projects["tmp"] / out_name
    return tib.export_selected_crops(
        image_bytes=_png_bytes(),
        long_side=640,
        use_resize=False,
        resize_axis="long",
        boxes_json=_boxes_json(),
        output_dir=str(out_dir),
        crop_height=32,
        project_id=project_id,
        export_context={
            "source_image": "IMG_0001.jpeg",
            "model_name": "TrmRead_yolo26s.pt",
            "model_source": "common",
            "selected_series": ["tube", "nmb"],
        },
    )


def test_export_writes_manifest_with_crop_mapping(temp_projects):
    """Step4出力時に対応関係（元画像・BBox・Series・sha256）が確定情報として保存される。"""
    result = _run_export(temp_projects)
    assert result["export_id"].startswith("export_")
    assert len(result["crops"]) == 2
    crop = result["crops"][0]
    assert crop["filename"] == "1.png"
    assert crop["bbox_id"] == 1
    assert crop["series"] == "tube"
    assert len(crop["sha256"]) == 64
    assert crop["bbox_original_xyxy"] is not None

    from src.app.project_paths import get_project_paths

    export_dir = get_project_paths("p1").root / "image_builder_exports" / result["export_id"]
    manifest = json.loads((export_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["version"] == 1
    assert manifest["project_id"] == "p1"
    assert manifest["source_image"] == "IMG_0001.jpeg"
    assert manifest["model_name"] == "TrmRead_yolo26s.pt"
    assert manifest["selected_series"] == ["tube", "nmb"]
    assert [c["filename"] for c in manifest["crops"]] == ["1.png", "2.png"]
    assert (export_dir / "state.json").exists()
    # 出力フォルダ側にも同内容を保存
    assert (Path(result["output_dir"]) / "manifest.json").exists()


def test_export_without_project_id_keeps_legacy_behavior(temp_projects):
    """project_id未指定は従来どおり（マニフェスト無し・後方互換）。"""
    out_dir = temp_projects["tmp"] / "legacy"
    result = tib.export_selected_crops(
        image_bytes=_png_bytes(),
        long_side=640,
        use_resize=False,
        resize_axis="long",
        boxes_json=_boxes_json(),
        output_dir=str(out_dir),
        crop_height=32,
    )
    assert result["export_id"] == ""
    assert not (out_dir / "manifest.json").exists()


def test_candidates_reflect_manifest_and_project_isolation(temp_projects):
    """候補はマニフェスト由来（Series保持）で、プロジェクト単位に分離される。"""
    result = _run_export(temp_projects, project_id="p1")
    candidates = eval_ds.list_export_candidates("p1")
    assert len(candidates["exports"]) == 1
    export = candidates["exports"][0]
    assert export["export_id"] == result["export_id"]
    assert [c["series"] for c in export["crops"]] == ["tube", "nmb"]
    assert all(c["exists"] for c in export["crops"])
    # 別プロジェクトには出ない
    assert eval_ds.list_export_candidates("p2")["exports"] == []


def test_editing_state_roundtrip_and_isolation(temp_projects):
    state = {"labels": {"a": "ABC"}, "rotations": {"a": 90}, "dataset_name": "eval_x"}
    eval_ds.save_editing_state("p1", state)
    assert eval_ds.load_editing_state("p1") == state
    assert eval_ds.load_editing_state("p2") == {}


def test_dataset_id_validation():
    assert eval_ds.sanitize_dataset_id("eval_20260716-01") == "eval_20260716-01"
    assert eval_ds.sanitize_dataset_id("").startswith("eval_")
    with pytest.raises(ValueError):
        eval_ds.sanitize_dataset_id("../evil")
    with pytest.raises(ValueError):
        eval_ds.sanitize_dataset_id("日本語名")


def _items_from_export(result, labels=("AB1", "CD2"), rotations=(0, 0)):
    return [
        {
            "export_id": result["export_id"],
            "filename": crop["filename"],
            "label": labels[i],
            "rotation": rotations[i],
            "series": crop["series"],
            "source_image": "IMG_0001.jpeg",
            "bbox_id": crop["bbox_id"],
        }
        for i, crop in enumerate(result["crops"])
    ]


def test_create_dataset_bakes_rotation_and_keeps_source(temp_projects):
    """回転は評価用コピーへだけ焼き込み、Step4学習画像は変更しない。90°で幅高が入れ替わる。"""
    result = _run_export(temp_projects)
    source_path = Path(result["files"][0])
    source_bytes_before = source_path.read_bytes()
    with Image.open(source_path) as img:
        src_w, src_h = img.size

    created = eval_ds.create_evaluation_dataset(
        "p1", "eval_rot", _items_from_export(result, rotations=(90, 180)), editing_state={"x": 1}
    )
    assert created["image_count"] == 2

    # 学習画像（Step4出力）は無変更
    assert source_path.read_bytes() == source_bytes_before

    images_dir = Path(created["image_dir"])
    rotated_90 = images_dir / f"{result['export_id']}_1.png"
    with Image.open(rotated_90) as img:
        assert (img.width, img.height) == (src_h, src_w)  # 90°: 幅高入替
    rotated_180 = images_dir / f"{result['export_id']}_2.png"
    with Image.open(rotated_180) as img:
        assert img.width > img.height  # 180°: 寸法は不変（横長のまま）

    metadata = json.loads((Path(created["dataset_dir"]) / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["dataset_id"] == "eval_rot"
    assert metadata["image_count"] == 2
    assert metadata["case_sensitive"] is True
    assert metadata["csv_file"] == "ground_truth.csv"
    assert metadata["images"][0]["rotation"] == 90
    assert metadata["images"][0]["series"] == "tube"
    assert (Path(created["dataset_dir"]) / "editing_state.json").exists()


def test_create_dataset_csv_is_readable_by_existing_evaluator(temp_projects):
    """生成CSVは既存モデル評価の_read_gt_csvでそのまま読める（BOM・ヘッダー・エスケープ・大小文字保持）。"""
    result = _run_export(temp_projects)
    labels = ('Ab,"1', "kLt2")  # カンマ・引用符・大小文字混在
    created = eval_ds.create_evaluation_dataset("p1", "eval_csv", _items_from_export(result, labels=labels))

    raw = Path(created["csv_path"]).read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM

    gt = _read_gt_csv(created["csv_path"])
    assert gt[f"{result['export_id']}_1.png"] == 'Ab,"1'
    assert gt[f"{result['export_id']}_2.png"] == "kLt2"


def test_create_dataset_rejects_unlabeled_and_duplicates(temp_projects):
    """未入力ラベルは作成拒否。同名データセットも拒否。失敗時に不完全ディレクトリを残さない。"""
    result = _run_export(temp_projects)
    items = _items_from_export(result)
    items[1]["label"] = "  "
    with pytest.raises(ValueError, match="未入力"):
        eval_ds.create_evaluation_dataset("p1", "eval_a", items)
    from src.app.project_paths import get_project_paths

    assert not (get_project_paths("p1").root / "evaluation" / "eval_a").exists()

    good = _items_from_export(result)
    eval_ds.create_evaluation_dataset("p1", "eval_a", good)
    with pytest.raises(ValueError, match="既に存在"):
        eval_ds.create_evaluation_dataset("p1", "eval_a", good)


def test_create_dataset_missing_source_rejected(temp_projects):
    """出力フォルダの画像が消えている場合は作成せず明示エラー。"""
    result = _run_export(temp_projects)
    Path(result["files"][0]).unlink()
    with pytest.raises(FileNotFoundError, match="見つからない"):
        eval_ds.create_evaluation_dataset("p1", "eval_missing", _items_from_export(result))


def test_crop_preview_rotation_does_not_modify_source(temp_projects):
    """プレビュー用の回転読み込みは元ファイルを変更しない。"""
    result = _run_export(temp_projects)
    source_path = Path(result["files"][0])
    before = source_path.read_bytes()
    img = eval_ds.load_export_crop_image("p1", result["export_id"], "1.png", rotation=90)
    with Image.open(source_path) as src:
        assert (img.width, img.height) == (src.height, src.width)
    assert source_path.read_bytes() == before


def test_crop_path_traversal_rejected(temp_projects):
    result = _run_export(temp_projects)
    with pytest.raises((FileNotFoundError, ValueError)):
        eval_ds.resolve_export_crop_path("p1", result["export_id"], "../manifest.json")
    with pytest.raises((FileNotFoundError, ValueError)):
        eval_ds.resolve_export_crop_path("p1", "../" + result["export_id"], "1.png")
