"""学習画像作成 Step5（評価用データ作成）のバックエンドテスト。

- Step4出力マニフェスト（対応関係の確定保存）
- 評価候補の取得・プロジェクト分離
- 回転焼き込み（学習画像は変更しない・評価コピーのみ）
- ground_truth.csv が既存モデル評価（_read_gt_csv）で読めること
"""

import io
import json
import shutil
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


def test_list_evaluation_datasets(temp_projects):
    """一覧はmetadata.jsonを根拠に件数・Series・回転済み数・パスを返す。"""
    result = _run_export(temp_projects)
    eval_ds.create_evaluation_dataset("p1", "eval_list_a", _items_from_export(result, rotations=(90, 0)))
    listing = eval_ds.list_evaluation_datasets("p1")
    assert len(listing["datasets"]) == 1
    entry = listing["datasets"][0]
    assert entry["id"] == "eval_list_a"
    assert entry["image_count"] == 2
    assert entry["label_count"] == 2
    assert entry["rotated_count"] == 1
    assert entry["series"] == ["nmb", "tube"]
    assert Path(entry["csv_path"]).exists()
    assert Path(entry["image_dir"]).exists()
    # 別プロジェクトには出ない
    assert eval_ds.list_evaluation_datasets("p2")["datasets"] == []


def test_delete_evaluation_dataset(temp_projects):
    """削除はCSV・metadata・images・editing_stateをまとめて消す（safe_rmtree配下検証）。"""
    result = _run_export(temp_projects)
    created = eval_ds.create_evaluation_dataset("p1", "eval_del", _items_from_export(result), editing_state={"x": 1})
    dataset_dir = Path(created["dataset_dir"])
    assert dataset_dir.exists()
    eval_ds.delete_evaluation_dataset("p1", "eval_del")
    assert not dataset_dir.exists()
    with pytest.raises(FileNotFoundError):
        eval_ds.delete_evaluation_dataset("p1", "eval_del")
    with pytest.raises(ValueError):
        eval_ds.delete_evaluation_dataset("p1", "../evil")


def test_rename_evaluation_dataset(temp_projects):
    """名前変更後もmetadata・CSV・画像参照が壊れない（ディレクトリ内相対参照）。"""
    result = _run_export(temp_projects)
    eval_ds.create_evaluation_dataset("p1", "eval_old", _items_from_export(result))
    renamed = eval_ds.rename_evaluation_dataset("p1", "eval_old", "eval_new")
    assert renamed["dataset_id"] == "eval_new"
    listing = eval_ds.list_evaluation_datasets("p1")
    assert [d["id"] for d in listing["datasets"]] == ["eval_new"]
    entry = listing["datasets"][0]
    assert entry["name"] == "eval_new"
    # CSVは新パスでそのまま既存評価が読める
    gt = _read_gt_csv(entry["csv_path"])
    assert len(gt) == 2
    for name in gt:
        assert (Path(entry["image_dir"]) / name).exists()
    # 重複名は拒否
    eval_ds.create_evaluation_dataset("p1", "eval_other", _items_from_export(result))
    with pytest.raises(ValueError, match="既に存在"):
        eval_ds.rename_evaluation_dataset("p1", "eval_other", "eval_new")


def test_check_training_overlap_priority(temp_projects):
    """重複判定は sha256 → 元画像+BBoxID（マニフェスト引き当て）の優先順で検出する。"""
    from src.app.project_paths import get_project_paths

    result = _run_export(temp_projects)
    # 評価データ: 1.png は回転90（バイト不一致になる）、2.png は無回転（バイト一致する）
    eval_ds.create_evaluation_dataset("p1", "eval_ovl", _items_from_export(result, rotations=(90, 0)))

    # 学習データ: outputs/ocr_dataset/<ts>/train へStep4クロップと同一ファイルを配置
    train_dir = get_project_paths("p1").outputs / "ocr_dataset" / "20260716_000000" / "train"
    train_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(result["files"][0], train_dir / "crop_a.png")  # 1.png と同一バイト（=回転前）
    shutil.copyfile(result["files"][1], train_dir / "crop_b.png")  # 2.png と同一バイト

    overlap = eval_ds.check_training_overlap("p1", "eval_ovl")
    assert overlap["training_image_count"] == 2
    assert overlap["evaluation_image_count"] == 2
    assert overlap["overlap_count"] == 2
    by_name = {row["filename"]: row["matched_by"] for row in overlap["overlaps"]}
    # 無回転コピーはsha256一致、回転済みはマニフェスト経由の元画像+BBoxIDで検出
    assert by_name[f"{result['export_id']}_2.png"] == "sha256"
    assert by_name[f"{result['export_id']}_1.png"] == "source_bbox"


def test_check_training_overlap_none(temp_projects):
    """学習データが無ければ重複0（正常応答）。"""
    result = _run_export(temp_projects)
    eval_ds.create_evaluation_dataset("p1", "eval_no_ovl", _items_from_export(result))
    overlap = eval_ds.check_training_overlap("p1", "eval_no_ovl")
    assert overlap["overlap_count"] == 0
    assert overlap["training_image_count"] == 0


def test_preview_preprocess_image_uses_rotated_input(temp_projects):
    """評価画像のOCRプレビューは回転後の画像を入力とし、前処理系は既存サービスを共通利用する。"""
    from src.app.services.preprocess import preview_preprocess_image

    result = _run_export(temp_projects)
    # ユーザー回転90°を適用した評価画像を入力（回転前を渡さない）
    rotated = eval_ds.load_export_crop_image("p1", result["export_id"], "1.png", rotation=90)
    preview = preview_preprocess_image(rotated, project_id="p1", overrides=None, preview_stem="eval_test")
    assert preview["original_size"] == [rotated.width, rotated.height]
    assert preview["type"] in {"single", "wide"}
    assert preview["interim_data_url"].startswith("data:image/")
    assert preview["processed_data_url"].startswith("data:image/")
    # プレビュー保存名はサニタイズされる（パス区切り等を含まない）
    assert "/" not in preview["image"] and "\\" not in preview["image"]


def test_crop_path_traversal_rejected(temp_projects):
    result = _run_export(temp_projects)
    with pytest.raises((FileNotFoundError, ValueError)):
        eval_ds.resolve_export_crop_path("p1", result["export_id"], "../manifest.json")
    with pytest.raises((FileNotFoundError, ValueError)):
        eval_ds.resolve_export_crop_path("p1", "../" + result["export_id"], "1.png")
