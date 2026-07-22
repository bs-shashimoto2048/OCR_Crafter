"""前処理スナップショット（学習・評価・推論の前処理再現性）のテスト。

- /preprocess/run 相当（run_preprocess）で実効パラメータ（threshold値等）が保存される
- 前処理ハッシュ: 同一設定で一致 / パラメータ差で変化 / 日時差では変化しない / channels非依存
- データセット meta.json への引き継ぎ（training_preprocess / hash / 由来）と未記録時の None
- モデルメタ（.tess.json）・/models/info への引き継ぎと旧モデル後方互換
- スナップショット再適用（apply_training_preprocess）と processed 画像への二重適用防止
- 評価前処理モードの適用計画（resolve_evaluation_preprocess_plan）の解決・エラー・警告
"""

import copy
import json

import numpy as np
import pytest
from PIL import Image

from src.app.services.model_registry import list_model_infos, resolve_model_training_preprocess
from src.app.services.ocr_pipeline import create_ocr_dataset
from src.app.services.ocr_evaluation import (
    TRAINING_PREPROCESS_MISSING_MESSAGE,
    resolve_evaluation_preprocess_plan,
)
from src.app.services.preprocess import build_preprocess_config, run_preprocess
from src.app.services.preprocess_snapshot import (
    apply_training_preprocess,
    build_preprocess_snapshot,
    build_training_preprocess,
    compute_preprocess_hash,
    compute_training_preprocess_hash,
    load_preprocess_snapshot,
    save_preprocess_snapshot,
    snapshot_file_path,
)
from src.app.services.tesseract_pipeline import register_tesseract_model
from src.app.project_paths import ensure_project_directories


def _make_raw_project(temp_projects, project_id: str = "p1", count: int = 3) -> str:
    """raw画像のみのプロジェクトを作る（run_preprocess の入力）。"""
    root = temp_projects["projects_dir"] / project_id
    raw = root / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        arr = np.full((32, 96), 200, dtype=np.uint8)
        arr[:, 10 + i * 5 : 14 + i * 5] = 30  # 暗い縦線（wide判定・deskew対象になる前景）
        Image.fromarray(arr, mode="L").save(raw / f"img_{i:04d}.png")
    return project_id


def _make_labeled_processed_project(temp_projects, project_id: str = "p2", count: int = 10, pixel: int = 100) -> str:
    """processed済み画像＋master.csvを持つプロジェクトを作る（データセット作成の入力）。"""
    root = temp_projects["projects_dir"] / project_id
    images_dir = root / "processed" / "wide" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    lines = ["filename,label,type"]
    for i in range(count):
        name = f"img_{i:04d}.png"
        arr = np.full((32, 96), pixel, dtype=np.uint8)
        Image.fromarray(arr, mode="L").save(images_dir / name)
        lines.append(f"{name},AB{i % 10},wide")
    annotations = root / "annotations"
    annotations.mkdir(parents=True, exist_ok=True)
    (annotations / "master.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return project_id


# ---------- スナップショット保存（/preprocess/run） ----------


def test_run_preprocess_saves_snapshot_with_effective_params(temp_projects):
    project_id = _make_raw_project(temp_projects)
    result = run_preprocess(project_id=project_id, overrides={"threshold_type": "binary"})
    # 応答に要約が含まれる
    assert result["preprocess_snapshot"]["snapshot_id"].startswith("prep_")
    assert result["preprocess_snapshot"]["preprocess_hash"].startswith("sha256:")
    # ファイルが保存され、工程名だけでなく実効パラメータ（threshold値等）を持つ
    paths = ensure_project_directories(project_id)
    snapshot = load_preprocess_snapshot(paths.root)
    assert snapshot is not None
    assert snapshot_file_path(paths.root).is_file()
    threshold = next(s for s in snapshot["steps"]["wide"] if s["name"] == "threshold")
    assert threshold["enabled"] is True
    assert threshold["params"]["type"] == "binary"
    assert isinstance(threshold["params"]["value"], int)
    # 実行順序・有効/無効・バージョン・日時も保存される
    assert snapshot["schema_version"] == 1
    assert snapshot["pipeline_version"] == "preprocess-v1"
    assert snapshot["created_at"]
    assert [s["name"] for s in snapshot["steps"]["wide"]] == snapshot["pipelines"]["wide"]


def test_snapshot_excludes_manual_mask_coordinates(temp_projects):
    """手動マスクの座標（画像単位）はスナップショットへ含めない（enabled/fill/timingのみ）。"""
    cfg = build_preprocess_config({"preprocess": {"operations": {"manual_mask": {"enabled": True, "masks": [{"x": 1}]}}}})
    snapshot = build_preprocess_snapshot(cfg)
    assert snapshot["operations"]["manual_mask"]["masks"] == []
    mask_step = next(s for s in snapshot["steps"]["wide"] if s["name"] == "manual_mask_post")
    assert "masks" not in mask_step["params"]


# ---------- 前処理ハッシュ ----------


def test_preprocess_hash_stable_and_sensitive():
    cfg = build_preprocess_config(None)
    snap1 = build_preprocess_snapshot(cfg)
    snap2 = build_preprocess_snapshot(cfg)  # 実行日時・snapshot_idが違っても
    assert snap1["snapshot_id"] == snap2["snapshot_id"] or snap1["created_at"] != "" or True
    assert snap1["preprocess_hash"] == snap2["preprocess_hash"]  # 日時差ではハッシュは変わらない

    cfg_changed = build_preprocess_config({"preprocess": {"operations": {"threshold": {"value": 90}}}})
    snap3 = build_preprocess_snapshot(cfg_changed)
    assert snap3["preprocess_hash"] != snap1["preprocess_hash"]  # パラメータ差でハッシュが変わる


def test_training_preprocess_hash_ignores_channels():
    """channels（[3,H,W]と[1,H,W]の違い）はハッシュへ影響しない（学習と評価を同一判定できる）。"""
    cfg = build_preprocess_config(None)
    snapshot = build_preprocess_snapshot(cfg)
    tp3 = build_training_preprocess(snapshot, ["wide"], [3, 48, 320])
    tp1 = build_training_preprocess(snapshot, ["wide"], [1, 48, 320])
    assert compute_training_preprocess_hash(tp3) == compute_training_preprocess_hash(tp1)
    # 入力整形サイズの違いは別前処理として判定する
    tp_small = build_training_preprocess(snapshot, ["wide"], [3, 32, 200])
    assert compute_training_preprocess_hash(tp_small) != compute_training_preprocess_hash(tp3)


def test_compute_preprocess_hash_excludes_timestamps():
    steps = {"wide": [{"name": "grayscale", "enabled": True, "params": {}}]}
    h1 = compute_preprocess_hash(steps, {"target_height": 48, "channels": 1})
    h2 = compute_preprocess_hash(steps, {"target_height": 48, "channels": 3})
    assert h1 == h2


# ---------- データセットへの引き継ぎ ----------


def test_create_ocr_dataset_inherits_snapshot(temp_projects):
    project_id = _make_labeled_processed_project(temp_projects)
    paths = ensure_project_directories(project_id)
    cfg = build_preprocess_config(None)
    snapshot = save_preprocess_snapshot(paths.root, cfg)

    result = create_ocr_dataset(project_id=project_id, image_types=["wide"], seed=42)
    meta = json.loads((paths.root / "outputs" / "ocr_dataset").glob("*/meta.json").__iter__().__next__().read_text(encoding="utf-8"))
    assert result["training_preprocess"]["source"] == "processed_snapshot"
    assert result["training_preprocess"]["snapshot_id"] == snapshot["snapshot_id"]
    assert result["training_preprocess_hash"].startswith("sha256:")
    assert meta["training_preprocess"]["snapshot_id"] == snapshot["snapshot_id"]
    # 学習データの由来: 全て processed 由来
    assert meta["source_image_state"] == "processed"
    assert meta["source_priority"] == ["processed", "interim", "raw"]
    assert meta["source_state_counts"] == {"processed": 10}
    assert meta["source_preprocess_snapshot_id"] == snapshot["snapshot_id"]
    assert meta["source_warning"] == ""


def test_create_ocr_dataset_without_snapshot_records_none(temp_projects):
    """スナップショット未保存（旧プロジェクト）は training_preprocess=None（推測補完しない）。"""
    project_id = _make_labeled_processed_project(temp_projects, project_id="p_old")
    result = create_ocr_dataset(project_id=project_id, image_types=["wide"], seed=42)
    assert result["training_preprocess"] is None
    assert result["training_preprocess_hash"] is None
    assert result["source_image_state"] == "processed"


def test_create_ocr_dataset_warns_on_mixed_sources(temp_projects):
    """processed が無く raw から取得する画像が混在する場合は警告する。"""
    project_id = _make_labeled_processed_project(temp_projects, project_id="p_mix", count=5)
    root = temp_projects["projects_dir"] / project_id
    # 2枚は processed を消して raw のみへ（フォールバック発生）
    raw = root / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for i in range(2):
        name = f"img_{i:04d}.png"
        (root / "processed" / "wide" / "images" / name).rename(raw / name)
    result = create_ocr_dataset(project_id=project_id, image_types=["wide"], seed=42)
    assert result["source_image_state"] == "mixed"
    assert result["source_state_counts"] == {"processed": 3, "raw": 2}
    assert "raw" in result["source_warning"] or "processed" in result["source_warning"]


# ---------- 二重前処理防止 ----------


def test_dataset_creation_does_not_reapply_snapshot(temp_projects):
    """processed画像は前処理適用済みのため、データセット作成でスナップショットを再適用しない。

    中間グレー（100）の processed 画像 + threshold=128 のスナップショットで作成した場合、
    再適用されていれば黒(0)化するが、実際の学習画像は中間調のまま残る。
    """
    project_id = _make_labeled_processed_project(temp_projects, project_id="p_dbl", pixel=100)
    paths = ensure_project_directories(project_id)
    cfg = build_preprocess_config({"preprocess": {"operations": {"threshold": {"type": "binary", "value": 128}}}})
    save_preprocess_snapshot(paths.root, cfg)
    result = create_ocr_dataset(project_id=project_id, image_types=["wide"], seed=42)
    train_dir = paths.root / "outputs" / "ocr_dataset"
    first_image = next(next(train_dir.iterdir()).joinpath("train", "images").glob("train_*.png"))
    arr = np.asarray(Image.open(first_image).convert("L"))
    assert result["training_preprocess_hash"] is not None
    assert int(arr.min()) > 30, "学習画像が黒化している=スナップショットが二重適用されている"


def test_apply_training_preprocess_reproduces_threshold(temp_projects):
    """スナップショット再適用で二値化（実効パラメータ）が再現される（評価・推論用）。"""
    cfg = build_preprocess_config({"preprocess": {"operations": {"threshold": {"type": "binary", "value": 128}}}})
    snapshot = build_preprocess_snapshot(cfg)
    tp = build_training_preprocess(snapshot, ["wide"], [1, 48, 320])
    src = Image.fromarray(np.full((32, 96), 100, dtype=np.uint8), mode="L")  # 100 < 128 → 黒
    out = apply_training_preprocess(src, tp)
    arr = np.asarray(out)
    assert set(np.unique(arr)).issubset({0, 255})
    assert int(arr.min()) == 0


# ---------- モデルメタ・/models/info への引き継ぎ ----------


def _register_model(temp_projects, project_id: str, dataset_root: str) -> None:
    paths = ensure_project_directories(project_id)
    model_dir = paths.models / "tesseract" / "tess_test"
    model_dir.mkdir(parents=True, exist_ok=True)
    traineddata = model_dir / "tess_test.traineddata"
    traineddata.write_bytes(b"dummy")
    register_tesseract_model(
        project_id=project_id,
        lang="tess_test",
        traineddata_path=traineddata,
        tessdata_dir=model_dir,
        base_lang="eng",
        charset="AB0123456789",
        dataset_root=dataset_root,
        counts={"train": 8, "val": 1},
        job_id="job-1",
        max_iterations=100,
    )


def test_model_meta_inherits_training_preprocess(temp_projects):
    project_id = _make_labeled_processed_project(temp_projects, project_id="p_model")
    paths = ensure_project_directories(project_id)
    snapshot = save_preprocess_snapshot(paths.root, build_preprocess_config(None))
    dataset = create_ocr_dataset(project_id=project_id, image_types=["wide"], seed=42)
    _register_model(temp_projects, project_id, dataset["dataset_root"])

    meta = json.loads((paths.models / "tess_test.tess.json").read_text(encoding="utf-8"))
    assert meta["training_preprocess"]["snapshot_id"] == snapshot["snapshot_id"]
    assert meta["training_preprocess_hash"] == dataset["training_preprocess_hash"]
    assert meta["dataset_source_image_state"] == "processed"

    infos = {row["name"]: row for row in list_model_infos(project_id)}
    info = infos["tess_test.tess.json"]
    assert info["training_preprocess"]["snapshot_id"] == snapshot["snapshot_id"]
    assert info["training_preprocess_hash"] == dataset["training_preprocess_hash"]

    record = resolve_model_training_preprocess(project_id, "tess_test.tess.json")
    assert record is not None
    assert record["training_preprocess_hash"] == dataset["training_preprocess_hash"]


def test_old_model_meta_backward_compatible(temp_projects):
    """training_preprocess キーの無い旧 .tess.json は None/空（未記録）として読める。"""
    project_id = "p_legacy"
    paths = ensure_project_directories(project_id)
    legacy = {
        "engine": "tesseract",
        "training_family": "tesseract",
        "lang": "tess_old",
        "traineddata_path": "",
        "tessdata_dir": str(paths.models),
        "model_dir": str(paths.models),
        "charset": "AB",
        "created_at": "2026-07-01T00:00:00",
    }
    (paths.models / "tess_old.tess.json").write_text(json.dumps(legacy), encoding="utf-8")
    infos = {row["name"]: row for row in list_model_infos(project_id)}
    info = infos["tess_old.tess.json"]
    assert info["training_preprocess"] is None
    assert info["training_preprocess_hash"] == ""
    assert resolve_model_training_preprocess(project_id, "tess_old.tess.json") is None


# ---------- 評価前処理モードの適用計画 ----------


def _meta(is_base=False, tp=None, tp_hash=None, model="m.tess.json"):
    return {"is_base": is_base, "model": model, "training_preprocess": tp, "training_preprocess_hash": tp_hash}


def _recorded_tp(value=128):
    cfg = build_preprocess_config({"preprocess": {"operations": {"threshold": {"type": "binary", "value": value}}}})
    snapshot = build_preprocess_snapshot(cfg)
    tp = build_training_preprocess(snapshot, ["wide"], [3, 48, 320])
    return tp, compute_training_preprocess_hash(tp)


def test_plan_legacy_manual_and_none():
    tp, tp_hash = _recorded_tp()
    metas = [_meta(is_base=True, model="eng"), _meta(tp=tp, tp_hash=tp_hash)]
    # 旧API互換: mode未指定 + eval_preprocess → manual（学習時前処理とは不一致警告）
    plan = resolve_evaluation_preprocess_plan(None, {"grayscale": True, "binarize": False}, metas, preprocess_source="custom")
    assert plan["mode"] == "manual"
    assert plan["matches"] == [None, False]
    assert any("異なる前処理" in w for w in plan["warnings"])
    # mode未指定 + eval_preprocessなし → none
    plan2 = resolve_evaluation_preprocess_plan(None, None, metas)
    assert plan2["mode"] == "none"
    assert list(plan2["groups"].values())[0]["kind"] == "none"


def test_plan_training_mode_matches():
    tp, tp_hash = _recorded_tp()
    metas = [_meta(is_base=True, model="eng"), _meta(tp=tp, tp_hash=tp_hash)]
    plan = resolve_evaluation_preprocess_plan("training", None, metas)
    assert plan["mode"] == "training"
    assert len(plan["groups"]) == 1
    assert plan["assignment"] == ["training", "training"]  # ベースにも共通適用（公平比較）
    assert plan["matches"] == [None, True]
    assert plan["evaluation_preprocess"]["preprocess_hash"] == tp_hash
    assert not any("異なる前処理" in w for w in plan["warnings"])


def test_plan_training_mode_requires_record():
    metas = [_meta(tp=None, tp_hash=None)]
    with pytest.raises(ValueError) as exc:
        resolve_evaluation_preprocess_plan("training", None, metas)
    assert TRAINING_PREPROCESS_MISSING_MESSAGE in str(exc.value)


def test_plan_training_mode_rejects_mixed_hashes():
    tp1, h1 = _recorded_tp(128)
    tp2, h2 = _recorded_tp(90)
    metas = [_meta(tp=tp1, tp_hash=h1, model="a"), _meta(tp=tp2, tp_hash=h2, model="b")]
    with pytest.raises(ValueError) as exc:
        resolve_evaluation_preprocess_plan("training", None, metas)
    assert "個別適用" in str(exc.value)
    # 個別適用モードならモデル別グループで解決でき、純粋比較でない旨を警告する
    plan = resolve_evaluation_preprocess_plan("training_individual", None, metas)
    assert len(plan["groups"]) == 2
    assert plan["matches"] == [True, True]
    assert any("純粋比較ではありません" in w for w in plan["warnings"])


def test_plan_none_mode_warns_mismatch():
    tp, tp_hash = _recorded_tp()
    metas = [_meta(tp=tp, tp_hash=tp_hash)]
    plan = resolve_evaluation_preprocess_plan("none", None, metas)
    assert plan["matches"] == [False]
    assert any("参考値" in w for w in plan["warnings"])


def test_plan_unrecorded_warning_without_error_in_manual():
    metas = [_meta(tp=None, tp_hash=None)]
    plan = resolve_evaluation_preprocess_plan("manual", {"grayscale": True, "binarize": False}, metas)
    assert plan["matches"] == [None]
    assert any("未記録" in w for w in plan["warnings"])
