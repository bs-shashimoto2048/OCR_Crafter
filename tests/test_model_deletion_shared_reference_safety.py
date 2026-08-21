"""Model Deletion Robustness（Issue #154）: 共有artifact directory参照検出のテスト。

Investigation #152で最優先（P1）として特定された、delete_model()が手編集・バグ等で
複数モデルのsidecarが同一artifact directoryを参照している場合に、片方の削除が
もう片方のartifactを警告なく巻き込んで削除しうるという既知課題（`docs/10_KNOWN_LIMITATIONS.md`/
`docs/13_QA_STATUS.md`記載）の修正を検証する。実`data/projects/`へは一切触れない
（`temp_projects`フィクスチャで隔離）。
"""

import json
import os
from pathlib import Path

import pytest

import src.app.services.model_registry as mr

PROJECT = "t_shared"


def models_root(temp_projects) -> Path:
    return temp_projects["projects_dir"] / PROJECT / "models"


def write_meta(temp_projects, name: str, payload) -> Path:
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    meta = root / name
    meta.write_text(json.dumps(payload), encoding="utf-8")
    return meta


# ---------------------------------------------------------------------------
# Shared Directory
# ---------------------------------------------------------------------------


def test_shared_directory_survives_deleting_one_of_two_referencing_models(temp_projects):
    """2つのsidecarが同じartifact directoryを参照している場合、片方を削除しても
    directoryは残り、もう片方のモデルは引き続き利用可能。"""
    root = models_root(temp_projects)
    shared_dir = root / "tesseract" / "shared"
    shared_dir.mkdir(parents=True)
    (shared_dir / "shared.traineddata").write_bytes(b"weights")

    meta_a = write_meta(temp_projects, "a.tess.json", {"tessdata_dir": str(shared_dir), "model_dir": str(shared_dir)})
    meta_b = write_meta(temp_projects, "b.tess.json", {"tessdata_dir": str(shared_dir), "model_dir": str(shared_dir)})

    mr.delete_model(PROJECT, "a.tess.json")

    assert not meta_a.exists()  # 削除対象sidecar自体は既存契約どおり削除される
    assert meta_b.exists()  # もう一方のsidecarは無傷
    assert shared_dir.exists()  # 共有artifactは残る（このモデルがまだ参照しているため）
    assert (shared_dir / "shared.traineddata").is_file()

    # bはまだ実体を正しく参照できる（ready判定が引き続き機能する）
    payload_b = json.loads(meta_b.read_text(encoding="utf-8"))
    assert (shared_dir / "shared.traineddata").is_file()


def test_shared_directory_deleted_only_when_last_reference_removed(temp_projects):
    """最後の参照モデルを削除した時のみ、共有artifact directoryが実際に削除される。"""
    root = models_root(temp_projects)
    shared_dir = root / "tesseract" / "shared2"
    shared_dir.mkdir(parents=True)
    (shared_dir / "shared2.traineddata").write_bytes(b"weights")

    write_meta(temp_projects, "a2.tess.json", {"tessdata_dir": str(shared_dir), "model_dir": str(shared_dir)})
    write_meta(temp_projects, "b2.tess.json", {"tessdata_dir": str(shared_dir), "model_dir": str(shared_dir)})

    mr.delete_model(PROJECT, "a2.tess.json")
    assert shared_dir.exists()  # まだb2が参照しているため残る

    mr.delete_model(PROJECT, "b2.tess.json")
    assert not shared_dir.exists()  # 最後の参照が消えたため実際に削除される


def test_shared_directory_across_engines_ocr_and_trocr_sidecars(temp_projects):
    """異なる拡張子（.ocr.json/.trocr.json）のsidecar間でも共有参照を検出する。"""
    root = models_root(temp_projects)
    shared_dir = root / "shared_cross_engine"
    shared_dir.mkdir(parents=True)
    (shared_dir / "config.json").write_text("{}", encoding="utf-8")

    write_meta(temp_projects, "p1.ocr.json", {"model_dir": str(shared_dir), "inference_dir": str(shared_dir)})
    write_meta(temp_projects, "t1.trocr.json", {"model_dir": str(shared_dir)})

    mr.delete_model(PROJECT, "p1.ocr.json")
    assert shared_dir.exists()  # t1.trocr.jsonがまだ参照している

    mr.delete_model(PROJECT, "t1.trocr.json")
    assert not shared_dir.exists()


def test_non_shared_directory_still_deleted_normally(temp_projects):
    """共有されていないディレクトリは、既存どおり削除対象モデルの削除で実際に削除される
    （回帰: 共有検出ロジックの追加が非共有ケースへ誤って影響しないこと）。"""
    root = models_root(temp_projects)
    victim = root / "tesseract" / "victim"
    victim.mkdir(parents=True)
    (victim / "victim.traineddata").write_bytes(b"x")
    other = root / "tesseract" / "other"
    other.mkdir(parents=True)
    write_meta(temp_projects, "other.tess.json", {"tessdata_dir": str(other), "model_dir": str(other)})
    meta = write_meta(temp_projects, "victim.tess.json", {"tessdata_dir": str(victim), "model_dir": str(victim)})

    mr.delete_model(PROJECT, "victim.tess.json")

    assert not meta.exists()
    assert not victim.exists()
    assert other.exists()  # 無関係な他モデルのdirは無傷


def test_malformed_other_sidecar_does_not_block_deletion(temp_projects):
    """他モデルのsidecarが破損JSONの場合でも、共有判定は保守的にスキップされ
    （「参照なし」扱い）、削除対象自身の削除は正常に完了する。"""
    root = models_root(temp_projects)
    target = root / "tesseract" / "target"
    target.mkdir(parents=True)
    (target / "target.traineddata").write_bytes(b"x")
    meta = write_meta(temp_projects, "target.tess.json", {"tessdata_dir": str(target), "model_dir": str(target)})
    broken = root / "broken_other.ocr.json"
    broken.write_text("{not valid json", encoding="utf-8")

    mr.delete_model(PROJECT, "target.tess.json")

    assert not meta.exists()
    assert not target.exists()  # 他の破損sidecarに惑わされず、正常に削除される
    assert broken.exists()  # 破損sidecar自体はこの削除操作の対象外なので無傷


# ---------------------------------------------------------------------------
# Containment（既存_is_safe_model_artifact_dir()の再確認・回帰）
# ---------------------------------------------------------------------------


def test_containment_rejects_dotdot_escape(temp_projects):
    """'..'でproject外へ抜けるパスは、resolve後にcontainment判定で拒否される。"""
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    outside = temp_projects["tmp"] / "outside_via_dotdot"
    outside.mkdir(parents=True)
    escape_path = root / ".." / ".." / "outside_via_dotdot"
    meta = write_meta(temp_projects, "escape.tess.json", {"tessdata_dir": str(escape_path), "model_dir": str(escape_path)})

    mr.delete_model(PROJECT, "escape.tess.json")

    assert not meta.exists()
    assert outside.exists()  # rmtreeされていない


def test_containment_rejects_symlink_escape_if_supported(temp_projects):
    """models配下のsymlinkがproject外を指す場合、resolve()でシンボリックリンクの
    実体パスへ解決されるため、containment判定（root not in resolved.parents）で
    正しく拒否される。symlink作成が権限等でサポートされない環境ではskipする。"""
    root = models_root(temp_projects)
    root.mkdir(parents=True, exist_ok=True)
    outside = temp_projects["tmp"] / "outside_via_symlink"
    outside.mkdir(parents=True)
    (outside / "secret.txt").write_bytes(b"do-not-delete")
    link = root / "link_to_outside"
    try:
        os.symlink(outside, link, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("この環境ではsymlink作成がサポートされていません（権限不足等）")

    meta = write_meta(temp_projects, "linked.tess.json", {"tessdata_dir": str(link), "model_dir": str(link)})
    mr.delete_model(PROJECT, "linked.tess.json")

    assert not meta.exists()
    assert outside.exists()
    assert (outside / "secret.txt").is_file()  # symlink経由でも実体は削除されない


# ---------------------------------------------------------------------------
# _is_dir_referenced_by_other_sidecar() 単体テスト
# ---------------------------------------------------------------------------


def test_is_dir_referenced_by_other_sidecar_true_when_shared(temp_projects):
    root = models_root(temp_projects)
    shared_dir = root / "shared3"
    shared_dir.mkdir(parents=True)
    write_meta(temp_projects, "other3.tess.json", {"model_dir": str(shared_dir)})
    assert mr._is_dir_referenced_by_other_sidecar(shared_dir.resolve(), root, "self.tess.json") is True


def test_is_dir_referenced_by_other_sidecar_false_when_not_shared(temp_projects):
    root = models_root(temp_projects)
    shared_dir = root / "notshared"
    shared_dir.mkdir(parents=True)
    other_dir = root / "unrelated"
    other_dir.mkdir(parents=True)
    write_meta(temp_projects, "other4.tess.json", {"model_dir": str(other_dir)})
    assert mr._is_dir_referenced_by_other_sidecar(shared_dir.resolve(), root, "self.tess.json") is False


def test_is_dir_referenced_by_other_sidecar_excludes_self(temp_projects):
    """exclude_sidecar_name自身のsidecarは参照元として数えない（自己参照で
    誤って「共有あり」と判定しないこと）。"""
    root = models_root(temp_projects)
    own_dir = root / "ownonly"
    own_dir.mkdir(parents=True)
    write_meta(temp_projects, "self5.tess.json", {"model_dir": str(own_dir)})
    assert mr._is_dir_referenced_by_other_sidecar(own_dir.resolve(), root, "self5.tess.json") is False


# ---------------------------------------------------------------------------
# Regression: 既存の非共有シナリオ（Tesseract/PaddleOCR/TrOCR）
# ---------------------------------------------------------------------------


def test_regression_tesseract_normal_delete_unchanged(temp_projects):
    root = models_root(temp_projects)
    artifact = root / "tesseract" / "m1"
    artifact.mkdir(parents=True)
    (artifact / "m1.traineddata").write_bytes(b"x")
    meta = write_meta(temp_projects, "m1.tess.json", {"tessdata_dir": str(artifact), "model_dir": str(artifact)})
    mr.delete_model(PROJECT, "m1.tess.json")
    assert not meta.exists()
    assert not artifact.exists()


def test_regression_paddleocr_normal_delete_unchanged(temp_projects):
    root = models_root(temp_projects)
    artifact = root / "ocr_runs" / "job-1" / "inference"
    artifact.mkdir(parents=True)
    (artifact / "inference.pdmodel").write_bytes(b"x")
    meta = write_meta(temp_projects, "m1.ocr.json", {"inference_dir": str(artifact)})
    mr.delete_model(PROJECT, "m1.ocr.json")
    assert not meta.exists()
    assert not artifact.exists()


def test_regression_trocr_normal_delete_unchanged(temp_projects):
    root = models_root(temp_projects)
    artifact = root / "trocr_runs" / "job-1"
    artifact.mkdir(parents=True)
    (artifact / "config.json").write_text("{}", encoding="utf-8")
    meta = write_meta(temp_projects, "trocr_job-1.trocr.json", {"model_dir": str(artifact)})
    mr.delete_model(PROJECT, "trocr_job-1.trocr.json")
    assert not meta.exists()
    assert not artifact.exists()
