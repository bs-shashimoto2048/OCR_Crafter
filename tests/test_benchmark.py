"""OCR Benchmark Suite のテスト。

- BM-0001採番（プロジェクト内一意）と保存
- Profile Hash（表示名・日時を含めない / データセット内容・エンジン条件で変わる）
- 未実装エンジン（EasyOCR）の実行拒否と「未導入・利用不可」明示
- run_benchmark_job（フェイクエンジンで結果項目・失敗集計・cold/inference分離・warmup記録）
- Leaderboardソート（CER昇順→ExactMatch降順→Failed昇順→MeanTime昇順）
- 用途別ベスト＋バランス最良（計算式・重み設定）
- CSV Export 3種（BOM付きUTF-8）
"""

import csv
import io

import numpy as np
import pytest
from PIL import Image

from src.app.services import benchmark as bm


class FakeCtx:
    job_id = "JOB-000001"

    def update(self, progress, step, message=""):
        pass

    def check_cancelled(self):
        pass


@pytest.fixture()
def bench_env(temp_projects, monkeypatch):
    """フェイクエンジン2種（good/bad）と評価データ3件を用意する。"""
    root = temp_projects["projects_dir"].parent / "bench"
    root.mkdir(parents=True, exist_ok=True)
    images = root / "images"
    images.mkdir(exist_ok=True)
    gt_rows = [("a.png", "AB12"), ("b.png", "CD34"), ("c.png", "EF56")]
    for name, _ in gt_rows:
        Image.fromarray(np.full((32, 96), 220, dtype=np.uint8), mode="L").save(images / name)
    gt_csv = root / "gt.csv"
    gt_csv.write_text("\n".join(f"{n},{e}" for n, e in gt_rows), encoding="utf-8")

    predictions_good = {"a.png": "AB12", "b.png": "CD34", "c.png": "EF50"}  # 2完全一致+1置換
    predictions_bad = {"a.png": "AB12", "b.png": "XXXX"}  # c.png は例外（失敗）

    def build_good(project_id, spec):
        def recognize(path):
            from pathlib import Path

            return predictions_good[Path(path).name], 0.9

        return {"label": "fake-good", "recognize": recognize}

    def build_bad(project_id, spec):
        def recognize(path):
            from pathlib import Path

            name = Path(path).name
            if name not in predictions_bad:
                raise RuntimeError("engine crashed")
            return predictions_bad[name], 0.5

        return {"label": "fake-bad", "recognize": recognize}

    monkeypatch.setitem(bm.ENGINE_BUILDERS, "tesseract_model", build_good)
    monkeypatch.setitem(bm.ENGINE_BUILDERS, "tesseract_base", build_bad)
    return {
        "image_dir": str(images),
        "gt_csv": str(gt_csv),
        "engines": [
            {"engine": "tesseract_model", "model": "m1.tess.json", "psm": 7, "whitelist": "ABCDEF0123456"},
            {"engine": "tesseract_base", "psm": 7},
        ],
    }


def _run(env, project_id="p1", name="test-bm"):
    params = {
        "project_id": project_id,
        "name": name,
        "image_dir": env["image_dir"],
        "gt_csv": env["gt_csv"],
        "dataset_id": "eval_x",
        "engines": env["engines"],
        "warmup_runs": 2,
    }
    return bm.run_benchmark_job(params, FakeCtx())


def test_run_benchmark_and_bm_id_sequence(bench_env):
    first = _run(bench_env)
    second = _run(bench_env)
    assert first["benchmark_id"] == "BM-0001"
    assert second["benchmark_id"] == "BM-0002"  # プロジェクト内一意・再利用しない
    assert first["related_benchmark_id"] == "BM-0001"
    assert first["engines"] == 2 and first["images"] == 3

    detail = bm.get_benchmark("p1", "BM-0001")
    results = detail["results"]
    good = next(r for r in results if r["label"] == "fake-good")
    bad = next(r for r in results if r["label"] == "fake-bad")
    # 結果項目（CER/CharAcc/ExactMatch/Correct/Sub/Ins/Del/Failed/時間/PeakMemory/Errors/CompletedAt）
    assert good["cer"] == round(1 / 12, 4)  # EF56→EF50 の1置換 / 正解12文字
    assert good["char_accuracy"] == round(1 - 1 / 12, 4)
    assert good["exact_match_rate"] == round(2 / 3, 4)
    assert good["correct"] == 2 and good["substitutions"] == 1 and good["failed"] == 0
    assert bad["failed"] == 1  # c.png 例外
    assert bad["errors"][0]["image"] == "c.png"
    # 失敗ケースは空予測（全脱落）としてCERへ算入する
    assert bad["deletions"] >= 4
    for key in ["cold_start_seconds", "warmup_seconds", "inference_seconds", "total_seconds", "mean_time_ms", "p50_time_ms", "p95_time_ms", "completed_at"]:
        assert good[key] is not None, f"{key} がない"
    assert good["warmup_runs"] == 2
    # PeakMemoryは取得不能のためnull（推測値を入れない）
    assert good["peak_memory_mb"] is None


def test_profile_hash_excludes_name_and_time(bench_env):
    import json
    from pathlib import Path

    gt = {"a.png": "AB12", "b.png": "CD34"}
    specs = [{"engine": "tesseract_base", "psm": 7}]
    p1 = bm.build_profile(gt, "ds1", specs)
    p2 = bm.build_profile(gt, "ds1", specs)
    assert p1["profile_hash"] == p2["profile_hash"]  # 表示名・日時を含まないため常に同一
    # データセット内容が変わればHashも変わる
    p3 = bm.build_profile({"a.png": "AB12", "b.png": "ZZ99"}, "ds1", specs)
    assert p3["profile_hash"] != p1["profile_hash"]
    # エンジン条件（PSM）が変わればHashも変わる
    p4 = bm.build_profile(gt, "ds1", [{"engine": "tesseract_base", "psm": 8}])
    assert p4["profile_hash"] != p1["profile_hash"]
    assert p1["common_profile"]["normalization"] == "trim+NFC"
    assert p1["common_profile"]["cer_version"] == "cer-v1-micro"
    assert p1["common_profile"]["image_count"] == 2


def test_unimplemented_engine_rejected(temp_projects):
    with pytest.raises(ValueError, match="未導入・利用不可"):
        bm.normalize_engine_spec({"engine": "easyocr"})
    with pytest.raises(ValueError, match="unsupported engine"):
        bm.normalize_engine_spec({"engine": "google_vision"})
    catalog = {c["key"]: c for c in bm.ENGINE_CATALOG}
    assert catalog["easyocr"]["implemented"] is False
    assert "未導入・利用不可" in catalog["easyocr"]["description"]


def test_leaderboard_sorting():
    results = [
        {"engine_key": "slow", "cer": 0.10, "exact_match_rate": 0.5, "failed": 0, "mean_time_ms": 100},
        {"engine_key": "best", "cer": 0.05, "exact_match_rate": 0.6, "failed": 0, "mean_time_ms": 200},
        {"engine_key": "tie_fast", "cer": 0.10, "exact_match_rate": 0.5, "failed": 0, "mean_time_ms": 50},
        {"engine_key": "tie_exact", "cer": 0.10, "exact_match_rate": 0.7, "failed": 2, "mean_time_ms": 300},
        {"engine_key": "no_cer", "cer": None, "exact_match_rate": None, "failed": 0, "mean_time_ms": 10},
    ]
    ranked = bm.build_leaderboard(results)
    # CER昇順 → 同率はExactMatch降順 → Failed昇順 → MeanTime昇順。CERなしは最下位
    assert [r["engine_key"] for r in ranked] == ["best", "tie_exact", "tie_fast", "slow", "no_cer"]
    assert [r["rank"] for r in ranked] == [1, 2, 3, 4, 5]


def test_purpose_picks_and_balance_formula(temp_projects):
    results = [
        {"engine_key": "accurate", "cer": 0.02, "exact_match_rate": 0.9, "failed": 2, "total": 10, "mean_time_ms": 200},
        {"engine_key": "fast", "cer": 0.10, "exact_match_rate": 0.6, "failed": 0, "total": 10, "mean_time_ms": 20},
    ]
    weights = bm.get_balance_weights("p1")
    assert weights == {"accuracy": 0.7, "speed": 0.2, "stability": 0.1}
    picks = bm.build_purpose_picks(results, weights)
    assert picks["best_accuracy"] == "accurate"
    assert picks["best_exact_match"] == "accurate"
    assert picks["fastest"] == "fast"
    assert picks["fewest_failures"] == "fast"
    # バランス式: accurate = 0.7*0.98 + 0.2*(20/200) + 0.1*0.8 = 0.786
    #             fast     = 0.7*0.90 + 0.2*1.0      + 0.1*1.0 = 0.930
    scores = {s["engine_key"]: s["balance_score"] for s in picks["scores"]}
    assert scores["accurate"] == round(0.7 * 0.98 + 0.2 * 0.1 + 0.1 * 0.8, 4)
    assert scores["fast"] == round(0.7 * 0.90 + 0.2 * 1.0 + 0.1 * 1.0, 4)
    assert picks["best_balance"] == "fast"
    assert "1−CER" in picks["balance_formula"]  # 計算式をUIへ明示する

    # 重みをプロジェクト設定で変更（正規化される）
    updated = bm.set_balance_weights("p1", {"accuracy": 90, "speed": 5, "stability": 5})
    assert updated == {"accuracy": 0.9, "speed": 0.05, "stability": 0.05}
    picks2 = bm.build_purpose_picks(results, updated)
    assert picks2["best_balance"] == "accurate"  # 精度重視の重みでは逆転
    with pytest.raises(ValueError):
        bm.set_balance_weights("p1", {"accuracy": -1, "speed": 0, "stability": 0})


def test_csv_export_three_kinds(bench_env):
    _run(bench_env)
    for kind, expected_name in [
        ("summary", "benchmark_summary_BM-0001.csv"),
        ("cases", "benchmark_cases_BM-0001.csv"),
        ("confusions", "benchmark_confusions_BM-0001.csv"),
    ]:
        filename, payload = bm.export_benchmark_csv("p1", "BM-0001", kind)
        assert filename == expected_name
        assert payload.startswith("﻿".encode("utf-8"))  # Excel対応（BOM付きUTF-8）
        rows = list(csv.reader(io.StringIO(payload.decode("utf-8-sig"))))
        assert len(rows) >= 2, f"{kind} にデータ行がない"
    summary_rows = list(csv.reader(io.StringIO(bm.export_benchmark_csv("p1", "BM-0001", "summary")[1].decode("utf-8-sig"))))
    assert "cer" in summary_rows[0] and "profile_hash" in summary_rows[0]
    cases_rows = list(csv.reader(io.StringIO(bm.export_benchmark_csv("p1", "BM-0001", "cases")[1].decode("utf-8-sig"))))
    assert cases_rows[0][:2] == ["image", "expected"]
    assert len(cases_rows) == 4  # ヘッダ+3画像
    with pytest.raises(ValueError):
        bm.export_benchmark_csv("p1", "BM-0001", "unknown")
    with pytest.raises(FileNotFoundError):
        bm.export_benchmark_csv("p1", "BM-9999", "summary")


def test_list_benchmarks_excludes_cases(bench_env):
    _run(bench_env, name="第1回")
    _run(bench_env, name="第2回")
    listing = bm.list_benchmarks("p1")
    assert [i["name"] for i in listing["items"]] == ["第2回", "第1回"]  # 新しい順
    assert all("cases" not in i for i in listing["items"])
    assert all(i["results"][0]["rank"] == 1 for i in listing["items"])
    assert listing["items"][0]["purpose_picks"]["best_accuracy"]
    assert "balance_weights" in listing


def test_benchmark_preprocess_modes(bench_env, temp_projects, monkeypatch):
    """§前処理対応: mode解決・Profile Hashへの実効Hash反映・開始時一括適用（1回だけ）。"""
    # none: 従来と同じ識別子（後方互換）
    plan_none = bm.resolve_benchmark_preprocess("p1", None)
    assert plan_none["mode"] == "none" and plan_none["identifier"] == "none" and plan_none["apply"] is None
    # manual: 設定から決定的なHash
    manual_spec = {"mode": "manual", "settings": {"grayscale": True, "binarize": True, "binarize_method": "fixed", "threshold": 100}}
    plan_a = bm.resolve_benchmark_preprocess("p1", manual_spec)
    plan_b = bm.resolve_benchmark_preprocess("p1", manual_spec)
    assert plan_a["identifier"] == plan_b["identifier"] and plan_a["identifier"].startswith("manual:sha256:")
    # 不正mode・training未記録・projectスナップショットなしはエラー（推測しない）
    with pytest.raises(ValueError, match="preprocess.mode"):
        bm.resolve_benchmark_preprocess("p1", {"mode": "auto"})
    with pytest.raises(ValueError, match="model"):
        bm.resolve_benchmark_preprocess("p1", {"mode": "training"})
    with pytest.raises(ValueError, match="スナップショット"):
        bm.resolve_benchmark_preprocess("p1", {"mode": "project"})

    # 実行: 前処理は開始時に一度だけ適用され、全エンジンが同じ前処理済み画像を受け取る
    seen_paths: dict[str, list[str]] = {"good": [], "bad": []}
    original_good = bm.ENGINE_BUILDERS["tesseract_model"]
    original_bad = bm.ENGINE_BUILDERS["tesseract_base"]

    def wrap(builder, key):
        def build(project_id, spec):
            runner = builder(project_id, spec)
            inner = runner["recognize"]

            def recognize(path):
                seen_paths[key].append(path)
                from PIL import Image

                with Image.open(path) as img:
                    # fixed threshold=100 で gray220 → 白(255) の二値画像になっている
                    assert img.convert("L").getpixel((5, 5)) == 255
                return "AB12", 0.9

            runner["recognize"] = recognize
            return runner

        return build

    monkeypatch.setitem(bm.ENGINE_BUILDERS, "tesseract_model", wrap(original_good, "good"))
    monkeypatch.setitem(bm.ENGINE_BUILDERS, "tesseract_base", wrap(original_bad, "bad"))
    params = {
        "project_id": "p1",
        "name": "pre",
        "image_dir": bench_env["image_dir"],
        "gt_csv": bench_env["gt_csv"],
        "engines": bench_env["engines"],
        "warmup_runs": 0,
        "preprocess": manual_spec,
    }
    result = bm.run_benchmark_job(params, FakeCtx())
    detail = bm.get_benchmark("p1", result["benchmark_id"])
    assert detail["preprocess"]["mode"] == "manual"
    assert detail["preprocess"]["hash"].startswith("sha256:")
    # Profile Hashがnone実行と異なる（実効前処理Hashを含むため）
    assert detail["profile"]["common_profile"]["preprocess_identifier"].startswith("manual:")
    plain = bm.build_profile({"a.png": "AB12"}, "eval_x", bench_env["engines"])
    assert detail["profile"]["profile_hash"] != plain["profile_hash"]
    # 両エンジンが同一の前処理済みパス集合を読む（エンジンごとの再処理なし）
    assert set(seen_paths["good"]) == set(seen_paths["bad"])
    assert all("bench_" in p for p in seen_paths["good"])  # Job ID付き一時ディレクトリ


def test_paddleocr_custom_adapter(temp_projects, monkeypatch):
    """§自作モデルAdapter: カタログ登録・spec正規化・未登録モデルの明確なエラー。"""
    catalog = {c["key"]: c for c in bm.ENGINE_CATALOG}
    assert catalog["paddleocr_custom"]["implemented"] is True
    assert "paddleocr_custom" in bm.ENGINE_BUILDERS  # Adapter構造（builder辞書）へ登録済み
    spec = bm.normalize_engine_spec({"engine": "paddleocr_custom", "model": "my.ocr.json"})
    assert spec == {"engine": "paddleocr_custom", "model": "my.ocr.json"}
    with pytest.raises(ValueError, match="model の指定が必要"):
        bm.normalize_engine_spec({"engine": "paddleocr_custom"})
    with pytest.raises(ValueError, match="\\.ocr\\.json"):
        bm.normalize_engine_spec({"engine": "paddleocr_custom", "model": "x.tess.json"})
    # 未登録・未エクスポートのモデルは明確なエラー（推測フォールバックしない）
    monkeypatch.setattr(
        "src.app.services.model_registry.resolve_ocr_model_meta", lambda **kwargs: None
    )
    with pytest.raises(FileNotFoundError, match="自作PaddleOCRモデルが見つかりません"):
        bm.ENGINE_BUILDERS["paddleocr_custom"]("p1", spec)


def test_job_handler_integration(bench_env, temp_projects):
    """Job Management（job_type=benchmark）経由でBenchmarkが完走する。"""
    from src.app.services.job_manager import JobService, JobWorker

    service = JobService()
    job, _ = service.create_job(
        "p1",
        "benchmark",
        {
            "project_id": "p1",
            "name": "via-job",
            "image_dir": bench_env["image_dir"],
            "gt_csv": bench_env["gt_csv"],
            "engines": bench_env["engines"],
        },
    )
    worker = JobWorker(service)
    assert worker.process_next() == job["job_id"]
    done = service.repository.get(job["job_id"])
    assert done["status"] == "succeeded"
    assert done["result_summary"]["benchmark_id"] == "BM-0001"
    assert done["related_benchmark_id"] == "BM-0001"  # 関連リンク用に引き継がれる
