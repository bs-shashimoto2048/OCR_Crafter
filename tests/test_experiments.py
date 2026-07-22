"""実験管理（Experiment Tracking）のテスト。

- 実験ID採番（EXP-0001形式・プロジェクト内一意・モデルIDとは独立・再利用しない）
- 学習完了（register_tesseract_model）からの実験記録と保存内容
- 旧モデル（.tess.json）からの自動バックフィル（作成日時順採番・冪等）
- タグ・お気に入り・メモの更新 / 評価結果のアタッチ（モデル名解決）
- 1実験複数モデル（modelsリスト）と model_ids の付与
"""

import json

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services.experiment_tracker import (
    attach_evaluation,
    ensure_experiments_for_models,
    list_experiments,
    record_experiment,
    summarize_threshold_from_preprocess,
    update_experiment,
)
from src.app.services.tesseract_pipeline import register_tesseract_model


def test_record_assigns_sequential_ids(temp_projects):
    first = record_experiment("p1", {"models": ["a.tess.json"], "training": {"iterations": 100}})
    second = record_experiment("p1", {"models": ["b.tess.json", "b2.tess.json"], "training": {"iterations": 200}})
    other = record_experiment("p2", {"models": ["c.tess.json"]})
    assert first["experiment_id"] == "EXP-0001"
    assert second["experiment_id"] == "EXP-0002"
    assert other["experiment_id"] == "EXP-0001"  # プロジェクト単位で独立採番
    # 1実験に複数モデルが紐付く
    assert second["models"] == ["b.tess.json", "b2.tess.json"]
    items = list_experiments("p1", backfill=False)
    assert [row["experiment_id"] for row in items] == ["EXP-0001", "EXP-0002"]


def test_register_tesseract_model_records_experiment(temp_projects, tmp_path):
    project_id = "p_train"
    paths = ensure_project_directories(project_id)
    dataset_root = tmp_path / "dataset"
    dataset_root.mkdir()
    (dataset_root / "meta.json").write_text(
        json.dumps(
            {
                "train_ratio": 0.8,
                "val_ratio": 0.1,
                "test_ratio": 0.1,
                "seed": 42,
                "split_method": "image",
                "counts": {"train": 80, "val": 10, "test": 10},
                "augmentation": {"preset": "weak", "multiplier": 1.5},
                "augmentation_generated": 40,
                "training_preprocess": {
                    "snapshot_id": "prep_test",
                    "steps": {"wide": [{"name": "threshold", "enabled": True, "params": {"type": "binary", "value": 90}}]},
                    "ocr_input_normalization": {"target_height": 48, "canvas_width": 320},
                },
                "training_preprocess_hash": "sha256:abc",
            }
        ),
        encoding="utf-8",
    )
    model_dir = paths.models / "tesseract" / "tess_exp"
    model_dir.mkdir(parents=True)
    traineddata = model_dir / "tess_exp.traineddata"
    traineddata.write_bytes(b"dummy")
    register_tesseract_model(
        project_id=project_id,
        lang="tess_exp",
        traineddata_path=traineddata,
        tessdata_dir=model_dir,
        base_lang="eng",
        charset="AB",
        dataset_root=str(dataset_root),
        counts={"train": 80, "val": 10},
        job_id="job-1",
        max_iterations=1500,
        extra_meta={"experiment_name": "iteration検証", "parent_model_id": "M0001", "training_note": "メモ"},
        training_duration_seconds=120,
    )
    items = list_experiments(project_id, backfill=False)
    assert len(items) == 1
    exp = items[0]
    assert exp["experiment_id"] == "EXP-0001"
    assert exp["models"] == ["tess_exp.tess.json"]
    assert exp["experiment_name"] == "iteration検証"
    assert exp["parent_model_id"] == "M0001"
    assert exp["note"] == "メモ"
    assert exp["training"]["iterations"] == 1500
    assert exp["training"]["split_ratio"] == {"train": 0.8, "val": 0.1, "test": 0.1}
    assert exp["training"]["split_seed"] == 42
    assert exp["training"]["counts"] == {"train": 80, "val": 10, "test": 10}
    assert exp["preprocess"]["hash"] == "sha256:abc"
    assert exp["preprocess"]["snapshot_id"] == "prep_test"
    assert exp["preprocess"]["summary"] == "Binary 90"
    assert exp["augmentation"]["config"]["preset"] == "weak"
    assert exp["augmentation"]["generated"] == 40
    assert exp["duration_seconds"] == 120
    assert exp["started_at"] and exp["finished_at"]
    assert exp["source"] == "training"


def test_backfill_from_legacy_models(temp_projects):
    project_id = "p_legacy"
    paths = ensure_project_directories(project_id)
    for name, created in [("tess_b", "2026-07-02T10:00:00"), ("tess_a", "2026-07-01T10:00:00")]:
        (paths.models / f"{name}.tess.json").write_text(
            json.dumps(
                {
                    "engine": "tesseract",
                    "created_at": created,
                    "max_iterations": 1000,
                    "charset": "AB",
                    "base_lang": "eng",
                    "counts": {"train": 8, "val": 1},
                    "training_duration_seconds": 60,
                }
            ),
            encoding="utf-8",
        )
    added = ensure_experiments_for_models(project_id)
    assert added == 2
    items = list_experiments(project_id, backfill=False)
    # 作成日時順に採番（古い tess_a が EXP-0001）
    assert items[0]["experiment_id"] == "EXP-0001" and items[0]["models"] == ["tess_a.tess.json"]
    assert items[1]["experiment_id"] == "EXP-0002" and items[1]["models"] == ["tess_b.tess.json"]
    assert all(row["source"] == "backfill" for row in items)
    assert items[0]["started_at"]  # created_at - duration から復元
    # 冪等（再実行で重複しない）
    assert ensure_experiments_for_models(project_id) == 0
    assert len(list_experiments(project_id)) == 2


def test_update_tags_favorite_note(temp_projects):
    record_experiment("p_tag", {"models": ["m.tess.json"]})
    updated = update_experiment(
        "p_tag", "EXP-0001", {"tags": ["Baseline", "Aug試験", "Baseline", "  "], "favorite": True, "note": "重要", "operator": "hashimoto"}
    )
    assert updated["tags"] == ["Baseline", "Aug試験"]  # 重複・空白は除去
    assert updated["favorite"] is True
    assert updated["note"] == "重要"
    assert updated["operator"] == "hashimoto"
    with pytest.raises(FileNotFoundError):
        update_experiment("p_tag", "EXP-9999", {"favorite": True})


def test_attach_evaluation_by_model(temp_projects):
    record_experiment("p_eval", {"models": ["old.tess.json"]})
    record_experiment("p_eval", {"models": ["target.tess.json"]})
    record_experiment("p_eval", {"models": ["target.tess.json"]})  # 同一モデルの再学習（最新を採用）
    result = attach_evaluation(
        "p_eval",
        "target.tess.json",
        {"cer": 0.32, "char_accuracy": 0.68, "accuracy_percent": 37.3, "improved": 10, "regressed": 2, "dataset": "ds1"},
    )
    assert result["experiment_id"] == "EXP-0003"
    items = {row["experiment_id"]: row for row in list_experiments("p_eval", backfill=False)}
    assert items["EXP-0003"]["evaluation"]["cer"] == 0.32
    assert items["EXP-0003"]["evaluation"]["dataset"] == "ds1"
    assert items["EXP-0002"]["evaluation"] is None  # 旧実験は上書きしない
    assert attach_evaluation("p_eval", "missing.tess.json", {"cer": 0.5}) is None


def test_summarize_threshold_labels():
    tp = lambda params: {"steps": {"wide": [{"name": "threshold", "enabled": True, "params": params}]}}  # noqa: E731
    assert summarize_threshold_from_preprocess(tp({"type": "binary", "value": 128})) == "Binary 128"
    assert summarize_threshold_from_preprocess(tp({"type": "otsu"})) == "Otsu"
    assert summarize_threshold_from_preprocess(tp({"type": "adaptive", "block_size": 35, "c": 11})) == "Adaptive(35, 11)"
    assert summarize_threshold_from_preprocess(tp({"type": "none"})) == "二値化なし"
    assert summarize_threshold_from_preprocess(None) == ""
