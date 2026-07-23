"""モデル開発レポート自動生成のテスト（採番・Markdown/PDF・記録なし・判定・API）。"""

import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from src.app.project_paths import ensure_project_directories
from src.app.services import report_generator as rg

PID = "p_report"


class FakeCtx:
    job_id = "JOB-000042"

    def update(self, *args, **kwargs):
        pass

    def check_cancelled(self):
        pass


def _seed(project=PID, evaluated=True):
    """モデル+実験+評価+リリースを用意する（本番相当の記録）。"""
    from src.app.services.experiment_tracker import attach_evaluation, record_experiment
    from src.app.services.release_manager import promote_model

    paths = ensure_project_directories(project)
    traineddata = paths.models / "rep.traineddata"
    traineddata.write_bytes(b"fake-model-bytes")
    (paths.models / "rep.tess.json").write_text(
        json.dumps({"engine": "tesseract", "lang": "rep", "created_at": "2026-07-20T10:00:00", "charset": "AB12",
                     "max_iterations": 800, "base_lang": "eng", "traineddata_path": str(traineddata),
                     "training_preprocess": {"snapshot_id": "s1", "steps": {"wide": [{"name": "threshold", "enabled": True, "params": {"type": "binary", "value": 128}}]}, "ocr_input_normalization": {"target_height": 48, "canvas_width": 320}},
                     "training_preprocess_hash": "sha256:pp"}, ensure_ascii=False),
        encoding="utf-8",
    )
    record_experiment(project, {"models": ["rep.tess.json"], "experiment_name": "レポート試験", "note": "手入力メモ",
                                 "duration_seconds": 120, "started_at": "2026-07-20T09:58:00", "finished_at": "2026-07-20T10:00:00",
                                 "training": {"iterations": 800, "charset": "AB12", "base_lang": "eng", "split_seed": 42,
                                               "split_ratio": {"train": 0.8, "val": 0.1, "test": 0.1},
                                               "counts": {"train": 80, "val": 10, "test": 10}},
                                 "preprocess": {"hash": "sha256:pp", "snapshot_id": "s1", "summary": "Binary 128"},
                                 "augmentation": {"config": None, "generated": None}})
    if evaluated:
        attach_evaluation(project, "rep.tess.json", {
            "cer": 0.05, "char_accuracy": 0.95, "accuracy_percent": 80.0, "dataset_id": "eval_rep",
            "image_count": 100, "label_count": 100, "preprocess_signature": "none:x", "engine": "tesseract",
            "psm": 7, "whitelist": "AB12",
            "confusions": [{"kind": "sub", "from": "1", "to": "I", "count": 4}],
            "char_stats": {"1": {"total": 10, "errors": 4}, "A": {"total": 20, "errors": 0}},
        })
        promote_model(project, "rep.tess.json", note="レポート試験リリース", author="uat")
    return paths


def test_sanitize_and_unique_filename(tmp_path):
    assert rg.sanitize_filename('a/b\\c:d*e?"f<g>h|i') == "a_b_c_d_e__f_g_h_i"  # 禁止文字は全て _ へ
    assert ".." not in rg.sanitize_filename("../../etc/passwd")
    assert rg.sanitize_filename("日本語レポート.md") == "日本語レポート.md"  # 日本語ファイル名対応
    first = rg.unique_path(tmp_path, "r.md")
    first.write_text("x")
    second = rg.unique_path(tmp_path, "r.md")
    assert second.name == "r_1.md"  # 重複時は連番


def test_report_id_concurrent_allocation(temp_projects):
    _seed()

    def generate(_):
        return rg.run_report_job({"project_id": PID, "report_type": "single_model", "model_ids": ["rep.tess.json"], "formats": ["markdown"]}, FakeCtx())["report_id"]

    with ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(generate, range(6)))
    assert len(set(ids)) == 6  # RPT-IDが並行実行でも重複しない
    assert sorted(ids)[0] == "RPT-0001"


def test_single_model_markdown_content(temp_projects):
    _seed()
    result = rg.run_report_job(
        {"project_id": PID, "report_type": "single_model", "model_ids": ["rep.tess.json"], "formats": ["markdown"],
         "created_by": "hashimoto", "template_info": {"templateId": "nameplate-ocr", "templateVersion": 1, "templateName": "銘板OCR"}},
        FakeCtx(),
    )
    entry = rg.get_report(result["report_id"])
    md_path = rg.report_file_path(result["report_id"], "markdown")
    md = md_path.read_text(encoding="utf-8")
    # 14セクション+目次+注記
    for heading in ["## 目次", "## 1. 表紙・基本情報", "## 2. 目的・概要", "## 3. データセット情報", "## 4. 前処理条件",
                    "## 5. 学習条件", "## 6. 評価結果", "## 7. 誤認識分析", "## 9. Benchmark結果", "## 11. リリース情報",
                    "## 12. 総合判定", "## 13. 推奨事項", "## 14. 監査情報"]:
        assert heading in md, f"{heading} がない"
    assert "自動生成されています" in md  # 末尾注記
    # 表紙: テンプレート・作成者・Release ID・OCR Crafterバージョン
    assert "銘板OCR" in md and "nameplate-ocr" in md
    assert "hashimoto" in md and "REL-0001" in md
    # 数値と単位・注釈
    assert "5.00%" in md and "95.00%" in md and "80.0%" in md
    assert "CER 5% = 文字正解率95%" in md
    # 前処理は値つき（ON/OFFだけでない）
    assert "二値化" in md and "type=binary / value=128" in md
    # Benchmarkなし文言・Production 0件/1件の明記
    assert "Benchmark結果は記録されていません。" in md
    assert "0件または1件" in md
    # ユーザー入力（Release Notes/メモ）は引用で区別
    assert "> v1.0.0: レポート試験リリース" in md
    assert "> 手入力メモ" in md
    # メタデータ: SHA-256・ファイル・generatorVersion
    assert entry["sha256"][md_path.name] == rg._sha256_file(md_path)
    assert entry["generatorVersion"] == 1
    assert entry["status"] == "completed"


def test_no_record_display_for_sparse_model(temp_projects):
    """評価・リリース未実施のモデルでも「記録なし」で生成でき、推測値を使わない。"""
    paths = ensure_project_directories(PID)
    (paths.models / "bare.tess.json").write_text(json.dumps({"lang": "bare", "created_at": "t"}), encoding="utf-8")
    result = rg.run_report_job({"project_id": PID, "report_type": "single_model", "model_ids": ["bare.tess.json"], "formats": ["markdown"]}, FakeCtx())
    md = rg.report_file_path(result["report_id"], "markdown").read_text(encoding="utf-8")
    assert md.count("記録なし") >= 10
    assert "【評価不足】" in md  # 自動判定: 評価不足
    assert "モデル評価を実行してください" in md  # 推奨事項


def test_pdf_generation_and_consistency(temp_projects):
    _seed()
    result = rg.run_report_job({"project_id": PID, "report_type": "single_model", "model_ids": ["rep.tess.json"], "formats": ["markdown", "pdf"]}, FakeCtx())
    pdf_path = rg.report_file_path(result["report_id"], "pdf")
    md_path = rg.report_file_path(result["report_id"], "markdown")
    assert pdf_path.read_bytes()[:5] == b"%PDF-"
    assert pdf_path.stat().st_size > 5000
    assert md_path.is_file()  # Markdown+PDF両方
    entry = rg.get_report(result["report_id"])
    assert set(entry["sha256"].keys()) == {pdf_path.name, md_path.name}


def test_comparison_report_hash_warning(temp_projects):
    """Evaluation Hashが異なる比較では注意文言を明示する。"""
    from src.app.services.experiment_tracker import attach_evaluation, record_experiment

    _seed()
    paths = ensure_project_directories(PID)
    (paths.models / "other.tess.json").write_text(json.dumps({"lang": "other", "created_at": "t"}), encoding="utf-8")
    record_experiment(PID, {"models": ["other.tess.json"]})
    attach_evaluation(PID, "other.tess.json", {"cer": 0.10, "dataset_id": "eval_other", "image_count": 50, "label_count": 50, "preprocess_signature": "none:y", "engine": "tesseract", "psm": 7, "whitelist": "AB12"})
    result = rg.run_report_job({"project_id": PID, "report_type": "comparison", "model_ids": ["rep.tess.json", "other.tess.json"], "formats": ["markdown"]}, FakeCtx())
    md = rg.report_file_path(result["report_id"], "markdown").read_text(encoding="utf-8")
    assert "## 8. モデル比較" in md
    assert "評価条件が異なるため、数値の直接比較には注意が必要です。" in md
    assert "優劣を確定できません" in md  # 総合判定=比較不能


def test_project_summary_report(temp_projects):
    _seed()
    result = rg.run_report_job({"project_id": PID, "report_type": "project_summary", "model_ids": [], "formats": ["markdown"], "experiments_limit": 10}, FakeCtx())
    md = rg.report_file_path(result["report_id"], "markdown").read_text(encoding="utf-8")
    assert "プロジェクト総括レポート" in md
    assert "## モデル一覧" in md
    assert "## 10. 実験履歴" in md
    assert "Productionモデル詳細" in md
    assert "rep.tess.json" in md


def test_invalid_inputs_and_path_traversal(temp_projects):
    _seed()
    with pytest.raises(ValueError, match="report_type"):
        rg.run_report_job({"project_id": PID, "report_type": "invalid", "model_ids": []}, FakeCtx())
    with pytest.raises(ValueError, match="1件"):
        rg.run_report_job({"project_id": PID, "report_type": "single_model", "model_ids": []}, FakeCtx())
    with pytest.raises(ValueError, match="2件以上"):
        rg.run_report_job({"project_id": PID, "report_type": "comparison", "model_ids": ["rep.tess.json"]}, FakeCtx())
    with pytest.raises(ValueError, match="見つかりません"):
        rg.run_report_job({"project_id": PID, "report_type": "single_model", "model_ids": ["../../../etc/passwd"]}, FakeCtx())
    with pytest.raises(FileNotFoundError):
        rg.get_report("RPT-9999")


def test_delete_report_removes_files(temp_projects):
    _seed()
    result = rg.run_report_job({"project_id": PID, "report_type": "single_model", "model_ids": ["rep.tess.json"], "formats": ["markdown"]}, FakeCtx())
    path = rg.report_file_path(result["report_id"], "markdown")
    assert path.is_file()
    rg.delete_report(result["report_id"])
    assert not path.exists()
    with pytest.raises(FileNotFoundError):
        rg.get_report(result["report_id"])


def test_api_flow(temp_projects):
    """API経由: 生成Job→実行→一覧/詳細/ダウンロード/削除+監査記録。"""
    from fastapi.testclient import TestClient

    import src.app.main as main_module
    from src.app.services.audit_log import read_audit
    from src.app.services.job_manager import JobService, JobWorker

    _seed()
    client = TestClient(main_module.app, raise_server_exceptions=False)
    response = client.post(
        "/api/reports/generate",
        json={"project_id": PID, "report_type": "single_model", "model_ids": ["rep.tess.json"], "formats": ["markdown"], "created_by": "uat"},
    )
    assert response.status_code == 200
    job_id = response.json()["job"]["job_id"]
    JobWorker(JobService()).process_next()
    job = client.get(f"/api/jobs/{job_id}").json()["job"]
    assert job["status"] == "succeeded"
    report_id = job["result_summary"]["report_id"]

    items = client.get(f"/api/reports?project_id={PID}").json()["items"]
    assert items[0]["reportId"] == report_id and items[0]["jobId"] == job_id
    assert client.get(f"/api/reports/{report_id}").json()["item"]["status"] == "completed"
    download = client.get(f"/api/reports/{report_id}/download?format=markdown")
    assert download.status_code == 200 and "表紙・基本情報" in download.content.decode("utf-8")
    assert client.get(f"/api/reports/{report_id}/download?format=pdf").status_code == 404  # PDF未生成
    assert client.get("/api/reports/RPT-9999").status_code == 404
    # 不正モデルIDは400
    bad = client.post("/api/reports/generate", json={"project_id": PID, "report_type": "single_model", "model_ids": [], "formats": ["markdown"]})
    assert bad.status_code == 400
    # 削除+監査
    assert client.delete(f"/api/reports/{report_id}").status_code == 200
    assert client.get(f"/api/reports/{report_id}").status_code == 404
    assert len(read_audit(action="report_generate")) == 1
    assert len(read_audit(action="report_delete")) == 1
