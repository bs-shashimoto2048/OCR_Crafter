"""/preprocess/run へのUI設定反映（第1段階）のテスト。

- run_preprocess が overrides を受け取り、processed 画像へ実際に反映される
- 実効設定の優先順位: overrides > プロジェクト保存値 > settings.yaml既定
- 実効値クランプ（補完・クランプ後の値がスナップショットへ保存される）
- preview と run の画素一致（同一画像・同一設定で完全一致）
- スナップショットと実効設定の一致 / single・wide 双方 / 旧リクエスト（overridesなし）の後方互換
"""

import base64
import io
import json

import numpy as np
import pytest
from PIL import Image

from src.app.project_paths import ensure_project_directories
from src.app.services.preprocess import (
    build_preprocess_config,
    load_project_preprocess_overrides,
    preview_preprocess,
    run_preprocess,
)
from src.app.services.preprocess_snapshot import load_preprocess_snapshot


def _make_project(temp_projects, project_id: str = "p1", wide: bool = True) -> str:
    """raw画像1枚（wide=横長 / single=正方形寄り）のプロジェクトを作る。"""
    raw = temp_projects["projects_dir"] / project_id / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(7)
    if wide:
        arr = np.full((32, 96), 200, dtype=np.uint8)
        arr[8:24, 10:80] = rng.integers(20, 120, size=(16, 70), dtype=np.uint8)  # 濃淡のある前景
    else:
        arr = np.full((64, 64), 200, dtype=np.uint8)
        arr[16:48, 16:48] = rng.integers(20, 120, size=(32, 32), dtype=np.uint8)
    Image.fromarray(arr, mode="L").save(raw / "img.png")
    return project_id


def _overrides(**threshold) -> dict:
    return {"preprocess": {"operations": {"threshold": {"type": "binary", "value": 128, **threshold}}}}


def _processed_array(project_id: str, image_type: str = "wide") -> np.ndarray:
    paths = ensure_project_directories(project_id)
    path = paths.processed / image_type / "images" / "img.png"
    assert path.is_file(), f"processed画像が生成されていない: {path}"
    return np.asarray(Image.open(path).convert("L"))


def _data_url_array(data_url: str) -> np.ndarray:
    raw = base64.b64decode(data_url.split(",", 1)[1])
    return np.asarray(Image.open(io.BytesIO(raw)).convert("L"))


# ---------- overrides の受け取り・反映 ----------


def test_run_accepts_overrides_and_affects_processed(temp_projects):
    project_id = _make_project(temp_projects)
    low = run_preprocess(project_id=project_id, overrides=_overrides(value=40))
    arr_low = _processed_array(project_id).copy()
    high = run_preprocess(project_id=project_id, overrides=_overrides(value=200))
    arr_high = _processed_array(project_id)
    # しきい値40と200で二値化結果（黒画素数）が変わる=UI設定が実処理へ反映されている
    assert int((arr_low == 0).sum()) < int((arr_high == 0).sum())
    # 応答へ実効値・スナップショット識別子・処理件数を含む
    assert low["preprocess_snapshot_id"].startswith("prep_")
    assert low["preprocess_hash"].startswith("sha256:")
    assert low["effective_params"]["operations"]["threshold"]["value"] == 40
    assert low["processed_count"] == 1


def test_run_backward_compatible_without_overrides(temp_projects):
    """旧リクエスト（overridesなし・保存値なし）は settings.yaml/コード既定で従来どおり動く。"""
    project_id = _make_project(temp_projects, project_id="p_legacy")
    result = run_preprocess(project_id=project_id)
    assert result["processed_count"] == 1
    default_value = build_preprocess_config(None)["operations"]["threshold"]["value"]
    assert result["effective_params"]["operations"]["threshold"]["value"] == default_value


# ---------- 優先順位（overrides > プロジェクト保存値 > 既定） ----------


def test_priority_project_saved_overrides_used_when_not_given(temp_projects):
    project_id = _make_project(temp_projects, project_id="p_prio")
    paths = ensure_project_directories(project_id)
    with_overrides = run_preprocess(project_id=project_id, overrides=_overrides(value=90))
    # overrides はプロジェクト保存値として永続化される
    saved = load_project_preprocess_overrides(paths.root)
    assert saved["preprocess"]["operations"]["threshold"]["value"] == 90
    # overrides なしの実行（回転後の部分再処理・旧クライアント）は保存値を採用=同一ハッシュ
    without = run_preprocess(project_id=project_id)
    assert without["preprocess_hash"] == with_overrides["preprocess_hash"]
    assert without["effective_params"]["operations"]["threshold"]["value"] == 90
    # 新しい overrides は保存値より優先される
    newer = run_preprocess(project_id=project_id, overrides=_overrides(value=150))
    assert newer["effective_params"]["operations"]["threshold"]["value"] == 150


# ---------- 実効値クランプ ----------


def test_effective_values_are_clamped_and_snapshotted(temp_projects):
    project_id = _make_project(temp_projects, project_id="p_clamp")
    result = run_preprocess(project_id=project_id, overrides=_overrides(value=999))
    # 入力999はクランプされ、実効値255が応答・スナップショットの両方に保存される
    assert result["effective_params"]["operations"]["threshold"]["value"] == 255
    paths = ensure_project_directories(project_id)
    snapshot = load_preprocess_snapshot(paths.root)
    step = next(s for s in snapshot["steps"]["wide"] if s["name"] == "threshold")
    assert step["params"]["value"] == 255


# ---------- スナップショットと実効設定の一致 ----------


def test_snapshot_matches_effective_settings(temp_projects):
    project_id = _make_project(temp_projects, project_id="p_snap")
    overrides = {
        "preprocess": {
            "operations": {
                "threshold": {"type": "binary", "value": 77},
                "gamma": {"enabled": True, "value": 1.3},
                "clahe": {"clip_limit": 2.5, "tile_grid_size": 4},
                "deskew": {"enabled": False},
                "morph": {"enabled": True, "method": "open", "ksize": 3, "iterations": 2},
                "denoise": {"method": "median", "ksize": 3},
                "resize": {"single": 96, "wide_height": 40, "keep_ratio": True},
                "illumination": {"enabled": True, "method": "gaussian", "background_size": 51, "strength": 0.5},
            }
        }
    }
    result = run_preprocess(project_id=project_id, overrides=overrides)
    paths = ensure_project_directories(project_id)
    snapshot = load_preprocess_snapshot(paths.root)
    assert snapshot["snapshot_id"] == result["preprocess_snapshot_id"]
    assert snapshot["preprocess_hash"] == result["preprocess_hash"]
    step = {s["name"]: s for s in snapshot["steps"]["wide"]}
    assert step["threshold"]["params"]["value"] == 77
    assert step["gamma"]["enabled"] is True and step["gamma"]["params"]["value"] == 1.3
    assert step["clahe"]["params"] == {"clip_limit": 2.5, "tile_grid_size": 4}
    assert step["deskew"]["enabled"] is False
    assert step["morph"]["enabled"] is True and step["morph"]["params"]["method"] == "open"
    assert step["denoise"]["params"] == {"method": "median", "ksize": 3}
    assert step["resize"]["params"]["wide_height"] == 40
    assert step["illumination"]["enabled"] is True and step["illumination"]["params"]["background_size"] == 51


# ---------- preview と run の画素一致 ----------


@pytest.mark.parametrize(
    "name,overrides",
    [
        ("fixed90", _overrides(value=90)),
        ("fixed128", _overrides(value=128)),
        ("otsu", {"preprocess": {"operations": {"threshold": {"type": "otsu"}}}}),
        ("clahe_on", {"preprocess": {"operations": {"clahe": {"clip_limit": 4.0, "tile_grid_size": 8}}}}),
        ("deskew_off", {"preprocess": {"operations": {"deskew": {"enabled": False}}}}),
        ("morph_on", {"preprocess": {"operations": {"morph": {"enabled": True, "method": "close", "ksize": 3, "iterations": 1}}}}),
    ],
)
def test_preview_and_run_produce_identical_pixels_wide(temp_projects, name, overrides):
    project_id = _make_project(temp_projects, project_id=f"p_{name}")
    preview = preview_preprocess("img.png", project_id=project_id, overrides=overrides)
    run_preprocess(project_id=project_id, overrides=overrides)
    preview_arr = _data_url_array(preview["processed_data_url"])
    run_arr = _processed_array(project_id, "wide")
    assert preview["type"] == "wide"
    assert preview_arr.shape == run_arr.shape
    assert np.array_equal(preview_arr, run_arr), f"{name}: previewとrunのprocessed画像が一致しない"


def test_preview_and_run_produce_identical_pixels_single(temp_projects):
    project_id = _make_project(temp_projects, project_id="p_single", wide=False)
    overrides = _overrides(value=100)
    preview = preview_preprocess("img.png", project_id=project_id, overrides=overrides)
    run_preprocess(project_id=project_id, overrides=overrides)
    preview_arr = _data_url_array(preview["processed_data_url"])
    run_arr = _processed_array(project_id, "single")
    assert preview["type"] == "single"
    assert np.array_equal(preview_arr, run_arr), "single: previewとrunのprocessed画像が一致しない"
