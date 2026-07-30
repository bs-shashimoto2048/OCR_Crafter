"""Engine判定ロジック統一（Feature #11）の回帰テスト。

model_registry.py::list_model_infos() と
ocr_pipeline.py::migrate_ocr_models_to_inference() が、
resolve_engine_id() 経由の明示的な判定へ切り替わり、
「engine未指定・不明ならPaddleOCRとみなす」という暗黙フォールバックを
廃止したことを確認する。TrOCR対応・Handler・Model Metadata・Frontendは対象外。
"""

import json

from src.app.services.model_registry import list_model_infos
from src.app.services.ocr_pipeline import migrate_ocr_models_to_inference


def _write_ocr_meta(models_dir, name: str, payload: dict) -> None:
    (models_dir / f"{name}.ocr.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _models_dir(temp_projects, project_id: str = "p1"):
    d = temp_projects["projects_dir"] / project_id / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _engine_of(temp_projects, name: str, project_id: str = "p1") -> str:
    items = {item["name"]: item for item in list_model_infos(project_id)}
    return items[f"{name}.ocr.json"]["engine"]


# ---------------------------------------------------------------------------
# model_registry.py::list_model_infos()
# ---------------------------------------------------------------------------


def test_list_model_infos_resolves_explicit_paddleocr_engine(temp_projects):
    """正常系: engineが明示的に'paddleocr'なら、そのままpaddleocrとして扱われる。"""
    models = _models_dir(temp_projects)
    _write_ocr_meta(models, "m1", {"engine": "paddleocr", "created_at": "2026-07-15T00:00:00"})

    assert _engine_of(temp_projects, "m1") == "paddleocr"


def test_list_model_infos_resolves_engine_case_insensitively(temp_projects):
    """正常系: 大文字混在のengine値も正規化して判定できる。"""
    models = _models_dir(temp_projects)
    _write_ocr_meta(models, "m1", {"engine": "PaddleOCR", "created_at": "2026-07-15T00:00:00"})

    assert _engine_of(temp_projects, "m1") == "paddleocr"


def test_list_model_infos_missing_engine_field_is_unknown_not_paddleocr(temp_projects):
    """異常系（回帰の核心）: engineフィールドが無い場合、暗黙にpaddleocrとみなさず'unknown'になる。"""
    models = _models_dir(temp_projects)
    _write_ocr_meta(models, "legacy", {"created_at": "2026-07-15T00:00:00"})  # engineキー自体が無い

    assert _engine_of(temp_projects, "legacy") == "unknown"


def test_list_model_infos_empty_engine_field_is_unknown(temp_projects):
    """異常系: engineが空文字の場合も'unknown'（paddleocrへフォールバックしない）。"""
    models = _models_dir(temp_projects)
    _write_ocr_meta(models, "m1", {"engine": "", "created_at": "2026-07-15T00:00:00"})

    assert _engine_of(temp_projects, "m1") == "unknown"


def test_list_model_infos_unregistered_engine_value_is_unknown(temp_projects):
    """異常系: Registryに登録されていない未知の文字列も'unknown'。"""
    models = _models_dir(temp_projects)
    _write_ocr_meta(models, "m1", {"engine": "some_future_engine", "created_at": "2026-07-15T00:00:00"})

    assert _engine_of(temp_projects, "m1") == "unknown"


def test_list_model_infos_recognizes_tesseract_and_easyocr_ids_in_ocr_json(temp_projects):
    """正常系: .ocr.json内にtesseract/easyocrという値が入っていても、既知IDとしてそのまま解決される。

    実運用では.ocr.jsonはPaddleOCR系が書き込むファイル形式だが、
    resolve_engine_id自体はファイル形式に依存せず値だけで判定することを確認する。
    """
    models = _models_dir(temp_projects)
    _write_ocr_meta(models, "m_tess", {"engine": "tesseract", "created_at": "2026-07-15T00:00:00"})
    _write_ocr_meta(models, "m_easy", {"engine": "EasyOCR", "created_at": "2026-07-15T00:00:00"})

    assert _engine_of(temp_projects, "m_tess") == "tesseract"
    assert _engine_of(temp_projects, "m_easy") == "easyocr"


# ---------------------------------------------------------------------------
# ocr_pipeline.py::migrate_ocr_models_to_inference()
# ---------------------------------------------------------------------------


def test_migrate_skips_explicit_non_paddleocr_engine(temp_projects):
    """正常系: engineが明示的に別エンジンなら、理由付きでskipされる（従来通り）。"""
    models = _models_dir(temp_projects)
    _write_ocr_meta(models, "m1", {"engine": "tesseract"})
    repo_dir = temp_projects["tmp"] / "paddle_repo"
    repo_dir.mkdir()

    result = migrate_ocr_models_to_inference("p1", str(repo_dir), dry_run=True)

    assert result["skipped"] == 1
    assert result["items"][0]["reason"] == "unsupported_engine:tesseract"


def test_migrate_missing_engine_field_is_skipped_as_unknown_not_migrated_as_paddleocr(temp_projects):
    """異常系（回帰の核心）: engine未指定のレコードは、暗黙にpaddleocrとして移行されず'unknown'としてskipされる。"""
    models = _models_dir(temp_projects)
    _write_ocr_meta(models, "legacy", {})  # engineキー自体が無い
    repo_dir = temp_projects["tmp"] / "paddle_repo"
    repo_dir.mkdir()

    result = migrate_ocr_models_to_inference("p1", str(repo_dir), dry_run=True)

    assert result["skipped"] == 1
    assert result["migrated"] == 0
    assert result["items"][0]["reason"] == "unsupported_engine:unknown"


def test_migrate_unregistered_engine_value_is_skipped_as_unknown(temp_projects):
    """異常系: Registry未登録の値も'unknown'としてskipされる。"""
    models = _models_dir(temp_projects)
    _write_ocr_meta(models, "m1", {"engine": "not_a_real_engine"})
    repo_dir = temp_projects["tmp"] / "paddle_repo"
    repo_dir.mkdir()

    result = migrate_ocr_models_to_inference("p1", str(repo_dir), dry_run=True)

    assert result["skipped"] == 1
    assert result["items"][0]["reason"] == "unsupported_engine:unknown"
