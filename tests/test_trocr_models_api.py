"""TrOCR登録済みモデル一覧API（Issue #98）のテスト。

`GET /api/trocr/models`はIssue #96で実装済みの`list_trocr_models()`をそのまま
返す薄いラッパーであり、本Issueで新規に検証すべきなのはAPI層の配線
（project_id解決・レスポンス形状）のみである。`list_trocr_models()`自体の
挙動（malformed JSON無視・project別スコープ等）は`tests/test_trocr_model_registry.py`
で既に検証済みのため、ここでは重複させない。
"""

from __future__ import annotations

import src.app.main as main_module
from src.app.services.trocr_model_registry import register_trocr_model


def _make_artifact_dir(tmp_path, name: str = "artifact"):
    artifact_dir = tmp_path / name
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "config.json").write_text("{}", encoding="utf-8")
    return artifact_dir


def test_api_trocr_models_returns_empty_items_when_none_registered(temp_projects):
    result = main_module.api_trocr_models(project_id="p1")
    assert result["project_id"] == "p1"
    assert result["items"] == []


def test_api_trocr_models_returns_registered_models(temp_projects, tmp_path):
    artifact_dir = _make_artifact_dir(tmp_path)
    register_trocr_model(
        "p1",
        job_id="job-1",
        model_dir=artifact_dir,
        base_model_ref="microsoft/trocr-base-printed",
        dataset_dir="",
        epochs=3,
        batch_size=2,
        learning_rate=5e-5,
        final_loss=0.5,
    )

    result = main_module.api_trocr_models(project_id="p1")
    assert result["project_id"] == "p1"
    assert len(result["items"]) == 1
    item = result["items"][0]
    assert item["engine"] == "trocr"
    assert item["job_id"] == "job-1"
    assert item["model_dir"] == str(artifact_dir.resolve())


def test_api_trocr_models_defaults_project_id_to_default(temp_projects):
    # FastAPI経由のHTTPリクエストでproject_idクエリを省略した場合、Query(default="default")
    # により実際に渡ってくる値は文字列"default"である（Noneではない）。関数を直接呼ぶ
    # 本テストではその挙動を模し、Query未解決のsentinelを渡すケースは対象外とする
    result = main_module.api_trocr_models(project_id="default")
    assert result["project_id"] == "default"
    assert result["items"] == []


def test_api_trocr_models_scopes_by_project(temp_projects, tmp_path):
    artifact_dir = _make_artifact_dir(tmp_path)
    register_trocr_model(
        "p1",
        job_id="job-1",
        model_dir=artifact_dir,
        base_model_ref="microsoft/trocr-base-printed",
        dataset_dir="",
        epochs=1,
        batch_size=1,
        learning_rate=5e-5,
    )

    result = main_module.api_trocr_models(project_id="p2")
    assert result["items"] == []
