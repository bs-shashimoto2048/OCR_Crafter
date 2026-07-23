"""モデルリリース管理（Model Release Management）のテスト。

- ステータス変更（Draft→Validated→Candidate=0.x採番・Production直接変更の禁止）
- Production一意（昇格で旧Productionが自動Archived・Release Note必須・バージョン自動採番）
- Rollback（過去Versionのモデルを再Production・rollback=true履歴・現Productionへの不要ロールバック拒否）
- Release History（新しい順・Author/Reason/Rollback）
- Model Card（Markdown生成・性能/評価条件/更新履歴を含む）
- Deployment Package（ZIPに traineddata/設定JSON/前処理Snapshot/Release Note/Model Card）
"""

import io
import json
import zipfile

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.experiment_tracker import attach_evaluation, record_experiment
from src.app.services.release_manager import (
    build_deployment_package,
    build_model_card,
    list_releases,
    next_production_version,
    promote_model,
    rollback_release,
    set_model_status,
)


def _make_model(project_id: str, name: str) -> None:
    paths = ensure_project_directories(project_id)
    model_dir = paths.models / "tesseract" / name
    model_dir.mkdir(parents=True, exist_ok=True)
    traineddata = model_dir / f"{name}.traineddata"
    traineddata.write_bytes(b"dummy-traineddata")
    (paths.models / f"{name}.tess.json").write_text(
        json.dumps(
            {
                "engine": "tesseract",
                "lang": name,
                "created_at": "2026-07-20T10:00:00",
                "charset": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt",
                "base_lang": "eng",
                "max_iterations": 1500,
                "traineddata_path": str(traineddata),
                "model_dir": str(model_dir),
                "tessdata_dir": str(model_dir),
                "training_preprocess": {"snapshot_id": "prep_x", "steps": {"wide": []}, "ocr_input_normalization": {}},
                "training_preprocess_hash": "sha256:tp1",
            }
        ),
        encoding="utf-8",
    )


def test_status_transitions_and_candidate_version(temp_projects):
    pid = "p_status"
    _make_model(pid, "tess_a")
    releases = list_releases(pid)
    assert releases["statuses"]["tess_a.tess.json"]["status"] == "Draft"  # 既定=学習直後
    set_model_status(pid, "tess_a.tess.json", "Validated")
    item = set_model_status(pid, "tess_a.tess.json", "Candidate")
    assert item["status"] == "Candidate"
    assert item["version"] == "0.1"  # Candidateまでは0.x
    _make_model(pid, "tess_b")
    assert set_model_status(pid, "tess_b.tess.json", "Candidate")["version"] == "0.2"
    with pytest.raises(ValueError):
        set_model_status(pid, "tess_a.tess.json", "Production")  # Productionはpromoteのみ


def test_promote_unique_production_and_versioning(temp_projects):
    pid = "p_prod"
    _make_model(pid, "tess_v1")
    _make_model(pid, "tess_v2")
    with pytest.raises(ValueError):
        promote_model(pid, "tess_v1.tess.json", note="  ")  # Release Note必須
    first = promote_model(pid, "tess_v1.tess.json", note="初回リリース", author="hashimoto")
    assert first["version"] == "1.0.0"
    second = promote_model(pid, "tess_v2.tess.json", note="CERを31.2→28.7へ改善 / CLAHE追加")
    assert second["version"] == "1.1.0"  # 自動マイナー加算
    releases = list_releases(pid)
    assert releases["production"] == "tess_v2.tess.json"  # Productionは常に1つ
    assert releases["statuses"]["tess_v2.tess.json"]["status"] == "Production"
    assert releases["statuses"]["tess_v1.tess.json"]["status"] == "Archived"  # 旧Productionは自動Archived
    # 明示バージョン指定
    _make_model(pid, "tess_v3")
    assert promote_model(pid, "tess_v3.tess.json", note="major", version="2.0.0")["version"] == "2.0.0"
    with pytest.raises(FileNotFoundError):
        promote_model(pid, "missing.tess.json", note="x")


def test_rollback(temp_projects):
    pid = "p_rb"
    _make_model(pid, "tess_old")
    _make_model(pid, "tess_new")
    promote_model(pid, "tess_old.tess.json", note="v1", author="a")
    promote_model(pid, "tess_new.tess.json", note="v1.1")
    result = rollback_release(pid, "1.0.0", author="hashimoto")
    assert result["model"] == "tess_old.tess.json"
    releases = list_releases(pid)
    assert releases["production"] == "tess_old.tess.json"
    assert releases["statuses"]["tess_new.tess.json"]["status"] == "Archived"
    # 履歴は新しい順・rollbackフラグと理由・Author
    latest = releases["history"][0]
    assert latest["rollback"] is True
    assert latest["rollback_from"] == "1.0.0"
    assert "Rollback to v1.0.0" in latest["note"]
    assert latest["author"] == "hashimoto"
    # Version規則（Phase 3で変更）: RollbackはVersion維持・新Release IDのみ採番
    assert latest["version"] == "1.0.0"
    assert latest["release_id"] and latest["release_id"] != releases["history"][-1]["release_id"]
    # 現Productionへのロールバックは拒否 / 存在しないVersionは404相当
    with pytest.raises(ValueError):
        rollback_release(pid, latest["version"])
    with pytest.raises(FileNotFoundError):
        rollback_release(pid, "9.9.9")


def test_release_history_order(temp_projects):
    pid = "p_hist"
    for name, note in [("tess_1", "one"), ("tess_2", "two"), ("tess_3", "three")]:
        _make_model(pid, name)
        promote_model(pid, f"{name}.tess.json", note=note)
    history = list_releases(pid)["history"]
    assert [h["note"] for h in history] == ["three", "two", "one"]  # 新しい順
    assert [h["version"] for h in history] == ["1.2.0", "1.1.0", "1.0.0"]


def test_model_card(temp_projects):
    pid = "p_card"
    _make_model(pid, "tess_card")
    # 実験＋評価を紐付け（カードへ性能・評価条件が載る）
    record_experiment(pid, {"models": ["tess_card.tess.json"], "training": {"iterations": 1500}})
    attach_evaluation(
        pid,
        "tess_card.tess.json",
        {
            "cer": 0.287,
            "char_accuracy": 0.713,
            "accuracy_percent": 41.2,
            "dataset": "eval_ds",
            "dataset_id": "eval_ds",
            "image_count": 228,
            "label_count": 228,
            "preprocess_signature": "training:sha256:tp1",
            "engine": "tesseract",
            "psm": 7,
            "whitelist": "ABC",
        },
    )
    with pytest.raises(FileNotFoundError):
        build_model_card(pid)  # Production未設定
    promote_model(pid, "tess_card.tess.json", note="CERを31.2→28.7へ改善", author="hashimoto")
    card = build_model_card(pid)
    md = card["markdown"]
    assert card["model"] == "tess_card.tess.json"
    assert card["version"] == "1.0.0"
    for expected in [
        "# Model Card: tess_card.tess.json",
        "## 概要",
        "Version: v1.0.0",
        "対象文字: ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt",
        "## 評価条件",
        "eval_ds",
        "## 性能",
        "CER: 28.7%",
        "## 既知の制約",
        "## 更新履歴",
        "CERを31.2→28.7へ改善",
    ]:
        assert expected in md, f"Model Cardに {expected} がない"


def test_deployment_package(temp_projects):
    pid = "p_zip"
    _make_model(pid, "tess_zip")
    with pytest.raises(FileNotFoundError):
        build_deployment_package(pid)  # Production未設定
    promote_model(pid, "tess_zip.tess.json", note="deploy")
    filename, payload = build_deployment_package(pid)
    assert filename.startswith("deployment_p_zip_v1_0_0")
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        names = set(zf.namelist())
        assert "model_config.json" in names  # 設定JSON
        assert "model/tess_zip.traineddata" in names  # モデル実体
        assert "preprocess_snapshot.json" in names  # 前処理Snapshot
        assert "RELEASE_NOTE.md" in names
        assert "MODEL_CARD.md" in names
        assert b"deploy" in zf.read("RELEASE_NOTE.md")
        snapshot = json.loads(zf.read("preprocess_snapshot.json"))
        assert snapshot["snapshot_id"] == "prep_x"


def test_next_production_version():
    assert next_production_version("") == "1.0.0"
    assert next_production_version("0.3") == "1.0.0"
    assert next_production_version("1.0.0") == "1.1.0"
    assert next_production_version("2.4.0") == "2.5.0"
    assert next_production_version("v1.2.0") == "1.3.0"
