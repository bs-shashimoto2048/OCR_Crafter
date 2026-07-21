"""実験情報（experiment_name / parent_model_id / training_note / training_duration_seconds）のテスト。

- register_tesseract_model がモデルメタ（.tess.json）へ実験情報を保存する
- 未指定（extra_meta=None）は空値で保存され従来動作を壊さない
- /models/info（list_model_infos）が新フィールドを返し、旧メタ（フィールド無し）は空/Noneで後方互換
"""

import json

from src.app.services.model_registry import list_model_infos
from src.app.services.tesseract_pipeline import register_tesseract_model


def _register(temp_projects, lang: str, extra_meta=None, duration=None):
    return register_tesseract_model(
        project_id="p1",
        lang=lang,
        traineddata_path=temp_projects["tmp"] / f"{lang}.traineddata",
        tessdata_dir=temp_projects["tmp"],
        base_lang="eng",
        charset="ABC",
        dataset_root=str(temp_projects["tmp"]),
        counts={"train": 10, "val": 2, "test": 0},
        job_id="job-1",
        max_iterations=1000,
        extra_meta=extra_meta,
        training_duration_seconds=duration,
    )


def test_register_saves_experiment_meta(temp_projects):
    meta_path = _register(
        temp_projects,
        "expmodel",
        extra_meta={
            "experiment_name": "Iteration 15000",
            "parent_model_id": "M0003",
            "training_note": "Iterationのみ変更",
        },
        duration=1122,
    )
    payload = json.loads(meta_path.read_text(encoding="utf-8"))
    assert payload["experiment_name"] == "Iteration 15000"
    assert payload["parent_model_id"] == "M0003"
    assert payload["training_note"] == "Iterationのみ変更"
    assert payload["training_duration_seconds"] == 1122
    # 既存キーは従来どおり保存される
    assert payload["base_lang"] == "eng"
    assert payload["max_iterations"] == 1000


def test_register_without_experiment_meta_is_backward_compatible(temp_projects):
    meta_path = _register(temp_projects, "plainmodel", extra_meta=None, duration=None)
    payload = json.loads(meta_path.read_text(encoding="utf-8"))
    assert payload["experiment_name"] == ""
    assert payload["parent_model_id"] == ""
    assert payload["training_note"] == ""
    assert payload["training_duration_seconds"] is None


def test_models_info_returns_experiment_fields(temp_projects):
    _register(
        temp_projects,
        "expmodel",
        extra_meta={"experiment_name": "初期学習", "parent_model_id": "", "training_note": "初期比較"},
        duration=60,
    )
    items = {item["name"]: item for item in list_model_infos("p1")}
    info = items["expmodel.tess.json"]
    assert info["experiment_name"] == "初期学習"
    assert info["parent_model_id"] == ""
    assert info["training_note"] == "初期比較"
    assert info["training_duration_seconds"] == 60


def test_models_info_backward_compatible_with_legacy_meta(temp_projects):
    """旧メタ（実験フィールド無し）でもAPIは空値/Noneで返す（エラーにしない）。"""
    models_dir = temp_projects["projects_dir"] / "p1" / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    legacy = {
        "created_at": "2026-07-01T00:00:00",
        "traineddata_path": "",
        "lang": "legacy",
        "base_lang": "eng",
        "charset": "ABC",
        "counts": {"train": 1, "val": 0, "test": 0},
        "max_iterations": 500,
    }
    (models_dir / "legacy.tess.json").write_text(json.dumps(legacy, ensure_ascii=False), encoding="utf-8")
    items = {item["name"]: item for item in list_model_infos("p1")}
    info = items["legacy.tess.json"]
    assert info["experiment_name"] == ""
    assert info["parent_model_id"] == ""
    assert info["training_note"] == ""
    assert info["training_duration_seconds"] is None
