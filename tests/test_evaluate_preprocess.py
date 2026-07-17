"""モデル評価の前処理（evaluate_ocr + Step5共通 apply_eval_preprocess）のテスト。

- 前処理未指定は従来動作（画像パスをそのまま preprocess_ocr_image へ渡す・応答互換）
- グレースケール/固定二値化/大津を適用（処理定義はStep5と共通の apply_eval_preprocess を共用）
- 適用順は「元画像（回転焼き込み済み）→ 評価前処理 → OCR入力整形」
- 評価データセットの回転は作成時に画像へ焼き込み済み（構造A）のため二重回転しない
- 応答へ実際に適用した前処理（preprocess_source / eval_preprocess）を含める
- 不正な前処理値は ValueError（API側で400）
"""

import numpy as np
import pytest
from PIL import Image

import src.app.services.ocr_evaluation as eval_mod


def _setup_dataset(tmp_path):
    """グラデーション画像1枚と正解CSVを持つ評価データを作る。"""
    img_dir = tmp_path / "imgs"
    img_dir.mkdir()
    arr = np.zeros((40, 120, 3), dtype=np.uint8)
    arr[:, :60] = 40
    arr[:, 60:] = 220
    Image.fromarray(arr, mode="RGB").save(img_dir / "a.png")
    gt_csv = tmp_path / "gt.csv"
    gt_csv.write_text("filename,text\na.png,AB1\n", encoding="utf-8")
    return img_dir, gt_csv


@pytest.fixture
def eval_env(monkeypatch, tmp_path):
    """preprocess_ocr_image の入力を捕捉し、認識器をスタブ化した評価環境。"""
    captured = []

    def fake_preprocess(image_source, image_shape=None, strong=False):
        captured.append(image_source)
        return Image.new("L", (32, 32), 255)

    def fake_build_recognizer(project_id, target, charset, psm):
        return {
            "label": str(target.get("model")),
            "engine": "tesseract",
            "model": str(target.get("model")),
            "is_base": False,
            "recognize": lambda path: ("AB1", 0.9),
        }

    monkeypatch.setattr("src.app.services.ocr_pipeline.preprocess_ocr_image", fake_preprocess)
    monkeypatch.setattr(eval_mod, "build_recognizer", fake_build_recognizer)
    img_dir, gt_csv = _setup_dataset(tmp_path)
    return {"captured": captured, "img_dir": str(img_dir), "gt_csv": str(gt_csv)}


def _run(env, **kwargs):
    return eval_mod.evaluate_ocr(
        project_id="p1",
        image_dir=env["img_dir"],
        gt_csv=env["gt_csv"],
        targets=[{"engine": "tesseract", "model": "m1"}],
        **kwargs,
    )


def test_evaluate_without_preprocess_keeps_legacy_path(eval_env):
    """前処理未指定は従来どおり画像パス（str）を渡し、応答はsource=noneを返す。"""
    result = _run(eval_env)
    assert isinstance(eval_env["captured"][0], str)  # パスをそのまま渡す（従来動作）
    assert result["preprocess_source"] == "none"
    assert result["eval_preprocess"] is None
    assert result["targets"][0]["accuracy_percent"] == 100.0


def test_evaluate_all_off_settings_treated_as_none(eval_env):
    """全設定OFFの前処理指定は「前処理なし」と同じ扱い（従来動作）。"""
    result = _run(eval_env, eval_preprocess={"grayscale": False, "binarize": False}, preprocess_source="custom")
    assert isinstance(eval_env["captured"][0], str)
    assert result["preprocess_source"] == "none"
    assert result["eval_preprocess"] is None


def test_evaluate_with_grayscale(eval_env):
    """グレースケール適用: OCR入力整形へはPIL画像（R=G=B）が渡る。sourceはechoされる。"""
    result = _run(eval_env, eval_preprocess={"grayscale": True}, preprocess_source="step5")
    given = eval_env["captured"][0]
    assert isinstance(given, Image.Image)
    arr = np.asarray(given.convert("RGB"))
    assert np.array_equal(arr[:, :, 0], arr[:, :, 1])
    assert result["preprocess_source"] == "step5"
    assert result["eval_preprocess"]["grayscale"] is True


def test_evaluate_with_fixed_and_otsu_binarize(eval_env):
    """固定しきい値・大津: OCR入力整形前の画像が0/255へ二値化される（Step5と同一実装）。"""
    _run(eval_env, eval_preprocess={"binarize": True, "binarize_method": "fixed", "threshold": 127})
    arr = np.asarray(eval_env["captured"][0].convert("L"))
    assert set(np.unique(arr)) <= {0, 255}
    assert arr[0, 0] == 0 and arr[0, 119] == 255

    _run(eval_env, eval_preprocess={"binarize": True, "binarize_method": "otsu"})
    arr2 = np.asarray(eval_env["captured"][1].convert("L"))
    assert set(np.unique(arr2)) == {0, 255}


def test_evaluate_response_contains_model_card_fields(eval_env):
    """モデルカルテが参照する correct / total / mismatch_count / accuracy_percent が応答に含まれる
    （既存フィールドの後方互換確認。フロントはこれを correct_count / total_count /
    misrecognized_count として履歴へ保存する）。"""
    result = _run(eval_env)
    target = result["targets"][0]
    assert target["correct"] == 1
    assert target["total"] == 1
    assert target["mismatch_count"] == 0
    assert target["accuracy_percent"] == 100.0
    assert "accuracy" in target and "is_base" in target


def test_model_info_includes_size(tmp_path, monkeypatch, temp_projects):
    """/models/info 相当の list_model_infos が model_size_mb を返す（traineddata実体のサイズ）。"""
    import json as json_mod

    from src.app.project_paths import get_project_paths
    from src.app.services.model_registry import list_model_infos

    models_dir = get_project_paths("p1").root / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    traineddata = tmp_path / "m.traineddata"
    traineddata.write_bytes(b"x" * (1024 * 1024))  # 1MB
    meta = {
        "traineddata_path": str(traineddata),
        "lang": "cursive",
        "base_lang": "eng",
        "created_at": "2026-07-17T00:00:00",
        "counts": {"train": 10, "val": 2, "test": 1},
    }
    (models_dir / "m.tess.json").write_text(json_mod.dumps(meta), encoding="utf-8")

    items = list_model_infos("p1")
    row = next(item for item in items if item["name"] == "m.tess.json")
    assert row["model_size_mb"] == 1.0
    # traineddataが無いモデルはNone（未記録扱い）
    (models_dir / "m2.tess.json").write_text(json_mod.dumps({**meta, "traineddata_path": ""}), encoding="utf-8")
    items2 = list_model_infos("p1")
    row2 = next(item for item in items2 if item["name"] == "m2.tess.json")
    assert row2["model_size_mb"] is None


def test_evaluate_rejects_invalid_preprocess(eval_env):
    """不正な前処理値はValueError（API側で400へ変換される）。"""
    with pytest.raises(ValueError):
        _run(eval_env, eval_preprocess={"binarize": True, "binarize_method": "adaptive"})
    with pytest.raises(ValueError):
        _run(eval_env, eval_preprocess={"threshold": 999, "binarize": True})
