"""OCR Benchmark Suite（複数エンジン公平比較）。

同一データセット・同一条件で複数のOCRエンジン/モデルを一括実行し、
精度（CER/完全一致）・速度（cold start / 推論時間を分離）・安定性（失敗数）を
比較する。実行はJob Management（job_type=benchmark）経由。

設計方針:
- CER・混同集計は `ocr_evaluation.py` の共通ロジック（levenshtein_ops /
  _normalize_compare）を再利用し、評価計算を重複実装しない
- 対応エンジンは「Tesseract登録モデル / Tesseract標準(eng) / PaddleOCR公式」のみ。
  未実装エンジン（EasyOCR等）はカタログで「未導入・利用不可」を明示し実行対象外。
  クラウドOCRは対象外（カタログへ含めない）
- Benchmark ID: BM-0001形式・プロジェクト内一意・再利用しない
  （保存先 data/projects/<id>/benchmarks.json）
- Profile Hash: 比較条件（データセットID/内容ハッシュ/画像数/ラベル数/正規化/
  CERバージョン/前処理識別子/Engine Profile一覧）のsha256。表示名・日時は除外
- 公平性: cold_start_time（モデルロード）/ inference_time（画像毎推論）/
  total_time を分離し、ウォームアップ実行回数を記録（ウォームアップは統計へ含めない）
- PeakMemory: 本環境では外部プロセス（Tesseract）やネイティブ実装の
  ピークメモリを正確に取得できないため null（推測値を入れない）
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from ..project_paths import ensure_project_directories
from .experiment_tracker import CER_VERSION, EVAL_NORMALIZATION_VERSION
from .ocr_evaluation import _normalize_compare, _read_gt_csv, _resolve_image, levenshtein_ops

_LOCK = threading.RLock()

# バランス最良スコアの既定重み（プロジェクト設定で変更可能。合計1へ正規化して使用）
DEFAULT_BALANCE_WEIGHTS = {"accuracy": 0.7, "speed": 0.2, "stability": 0.1}

# 対応エンジンカタログ。implemented=False は「未導入・利用不可」として実行対象外。
# クラウドOCR（Google Vision / Azure等）はローカル完結の設計方針により対象外（掲載しない）
ENGINE_CATALOG: list[dict[str, Any]] = [
    {
        "key": "tesseract_model",
        "label": "Tesseract（登録モデル）",
        "implemented": True,
        "requires_model": True,
        "profile_keys": ["psm", "whitelist"],
        "description": "OCR Crafterで学習・登録したTesseractモデル（.tess.json）",
    },
    {
        "key": "tesseract_base",
        "label": "Tesseract標準（eng）",
        "implemented": True,
        "requires_model": False,
        "profile_keys": ["psm", "whitelist"],
        "description": "学習前ベースライン（eng.traineddata）",
    },
    {
        "key": "paddleocr_official",
        "label": "PaddleOCR公式",
        "implemented": True,
        "requires_model": True,
        "profile_keys": [],
        "description": "PaddleOCR公式認識モデル（PSM/Whitelistの概念なし）",
    },
    {
        "key": "easyocr",
        "label": "EasyOCR",
        "implemented": False,
        "requires_model": False,
        "profile_keys": [],
        "description": "未導入・利用不可（本環境にBenchmark用のEasyOCR実行経路が実装されていません）",
    },
]


def _benchmarks_path(project_id: Optional[str]) -> Path:
    paths = ensure_project_directories(project_id)
    return paths.root / "benchmarks.json"


def _load_registry(project_id: Optional[str]) -> dict[str, Any]:
    try:
        payload = json.loads(_benchmarks_path(project_id).read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            return {
                "counter": int(payload.get("counter") or 0),
                "items": payload["items"],
                "config": payload.get("config") if isinstance(payload.get("config"), dict) else {},
            }
    except (OSError, ValueError):
        pass
    return {"counter": 0, "items": [], "config": {}}


def _save_registry(project_id: Optional[str], registry: dict[str, Any]) -> None:
    _benchmarks_path(project_id).write_text(
        json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def get_balance_weights(project_id: Optional[str]) -> dict[str, float]:
    """バランス最良スコアの重み（プロジェクト設定。未設定=既定 70/20/10）。"""
    raw = _load_registry(project_id)["config"].get("balance_weights")
    weights = dict(DEFAULT_BALANCE_WEIGHTS)
    if isinstance(raw, dict):
        for key in weights:
            try:
                value = float(raw.get(key, weights[key]))
            except (TypeError, ValueError):
                continue
            if value >= 0:
                weights[key] = value
    total = sum(weights.values())
    if total <= 0:
        return dict(DEFAULT_BALANCE_WEIGHTS)
    return {k: round(v / total, 6) for k, v in weights.items()}


def set_balance_weights(project_id: Optional[str], weights: dict[str, Any]) -> dict[str, float]:
    with _LOCK:
        registry = _load_registry(project_id)
        cleaned: dict[str, float] = {}
        for key in DEFAULT_BALANCE_WEIGHTS:
            try:
                value = float(weights.get(key))
            except (TypeError, ValueError):
                raise ValueError(f"balance_weights.{key} は0以上の数値で指定してください")
            if value < 0:
                raise ValueError(f"balance_weights.{key} は0以上で指定してください")
            cleaned[key] = value
        if sum(cleaned.values()) <= 0:
            raise ValueError("balance_weights の合計は0より大きくしてください")
        registry["config"]["balance_weights"] = cleaned
        _save_registry(project_id, registry)
    return get_balance_weights(project_id)


# ---------- Profile / Hash ----------


def normalize_engine_spec(spec: dict[str, Any]) -> dict[str, Any]:
    """Engine Profile（エンジン固有条件）を正規化する。PSM/WhitelistはTesseract系のみ。"""
    engine = str((spec or {}).get("engine") or "").strip()
    catalog = next((c for c in ENGINE_CATALOG if c["key"] == engine), None)
    if catalog is None:
        raise ValueError(f"unsupported engine: {engine}")
    if not catalog["implemented"]:
        raise ValueError(f"{catalog['label']} は未導入・利用不可のため実行できません")
    normalized: dict[str, Any] = {"engine": engine, "model": str(spec.get("model") or "").strip()}
    if catalog.get("requires_model") and not normalized["model"]:
        if engine == "paddleocr_official":
            from ..predict import OFFICIAL_PADDLEOCR_REC_MODELS

            normalized["model"] = OFFICIAL_PADDLEOCR_REC_MODELS[0]
        else:
            raise ValueError(f"{catalog['label']} は model の指定が必要です")
    if "psm" in catalog["profile_keys"]:
        normalized["psm"] = int(spec.get("psm") or 7)
    if "whitelist" in catalog["profile_keys"]:
        # None=既定whitelist / 空文字=whitelistなし を区別して保存する
        whitelist = spec.get("whitelist")
        normalized["whitelist"] = None if whitelist is None else str(whitelist)
    return normalized


def _dataset_content_hash(gt: dict[str, str]) -> str:
    lines = [f"{name}\t{expected}" for name, expected in sorted(gt.items())]
    return "sha256:" + hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def build_profile(
    gt: dict[str, str],
    dataset_id: str,
    engine_specs: list[dict[str, Any]],
    preprocess_identifier: str = "none",
) -> dict[str, Any]:
    """比較条件のProfile（common + engines）とProfile Hashを生成する。

    Hashへは表示名・実行日時を含めない（同一Hash=同一条件のBenchmark）。
    """
    common = {
        "dataset_id": str(dataset_id or ""),
        "dataset_content_hash": _dataset_content_hash(gt),
        "image_count": len(gt),
        "label_count": len(gt),
        "normalization": EVAL_NORMALIZATION_VERSION,
        "cer_version": CER_VERSION,
        "preprocess_identifier": str(preprocess_identifier or "none"),
    }
    engines = [normalize_engine_spec(spec) for spec in engine_specs]
    canonical = json.dumps(
        {"common": common, "engines": sorted(engines, key=lambda e: json.dumps(e, sort_keys=True, ensure_ascii=False))},
        sort_keys=True,
        ensure_ascii=False,
    )
    profile_hash = "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return {"common_profile": common, "engine_profiles": engines, "profile_hash": profile_hash}


# ---------- Engine Runner（recognize関数の生成） ----------


def _build_tesseract_runner(project_id: Optional[str], spec: dict[str, Any]) -> dict[str, Any]:
    from .ocr_evaluation import _build_tesseract_recognizer
    from .tesseract_pipeline import TESSERACT_WHITELIST_DEFAULT

    whitelist = spec.get("whitelist")
    charset = TESSERACT_WHITELIST_DEFAULT if whitelist is None else str(whitelist)
    model = spec["model"] if spec["engine"] == "tesseract_model" else "eng"
    rec = _build_tesseract_recognizer(project_id, model, charset, int(spec.get("psm") or 7))
    return {"label": rec["label"], "recognize": rec["recognize"]}


def _build_paddleocr_runner(project_id: Optional[str], spec: dict[str, Any]) -> dict[str, Any]:
    from ..predict import (
        OFFICIAL_PADDLEOCR_REC_MODELS,
        _create_paddleocr_instance,
        _get_paddle_text_recognition_reader,
        _prepare_paddle_runtime_env,
        _run_paddleocr,
    )

    model_name = str(spec.get("model") or OFFICIAL_PADDLEOCR_REC_MODELS[0])
    if model_name not in OFFICIAL_PADDLEOCR_REC_MODELS:
        raise ValueError(f"PaddleOCR公式モデルではありません: {model_name}（{list(OFFICIAL_PADDLEOCR_REC_MODELS)}）")
    reader = _get_paddle_text_recognition_reader(model_name=model_name)
    if reader is None:
        _prepare_paddle_runtime_env()
        try:
            from paddleocr import PaddleOCR  # type: ignore
        except ImportError as e:
            raise RuntimeError("PaddleOCRが未インストールのため実行できません（pip install paddleocr paddlepaddle）") from e
        reader = _create_paddleocr_instance(
            PaddleOCR,
            lang="en",
            use_angle_cls=False,
            text_recognition_model_name=model_name,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

    def recognize(image_path: str) -> tuple[str, float]:
        prediction, confidence, _results = _run_paddleocr(reader, image_path, use_angle_cls=False)
        return prediction, confidence

    return {"label": f"PaddleOCR公式（{model_name}）", "recognize": recognize}


# エンジン種別→Runner生成関数（テストではここを差し替えて実OCRなしで検証する）
ENGINE_BUILDERS: dict[str, Callable[[Optional[str], dict[str, Any]], dict[str, Any]]] = {
    "tesseract_model": _build_tesseract_runner,
    "tesseract_base": _build_tesseract_runner,
    "paddleocr_official": _build_paddleocr_runner,
}


def engine_catalog_with_availability() -> list[dict[str, Any]]:
    """エンジンカタログ＋実行環境での利用可否（未実装は「未導入・利用不可」を明示）。"""
    items = []
    for entry in ENGINE_CATALOG:
        item = dict(entry)
        if not entry["implemented"]:
            item["available"] = False
            item["availability_note"] = "未導入・利用不可"
        elif entry["key"] in {"tesseract_model", "tesseract_base"}:
            try:
                from .tesseract_pipeline import ensure_tesseract_inference_tool

                ensure_tesseract_inference_tool()
                item["available"] = True
                item["availability_note"] = ""
            except Exception as e:  # noqa: BLE001
                item["available"] = False
                item["availability_note"] = f"Tesseractが見つかりません: {str(e)[:120]}"
        elif entry["key"] == "paddleocr_official":
            try:
                import paddleocr  # type: ignore # noqa: F401

                item["available"] = True
                item["availability_note"] = ""
            except Exception:  # noqa: BLE001
                item["available"] = False
                item["availability_note"] = "PaddleOCRが未インストールです"
        items.append(item)
    return items


# ---------- 実行（Job Management の benchmark ハンドラから呼ばれる） ----------


def _percentile(sorted_values: list[float], ratio: float) -> Optional[float]:
    if not sorted_values:
        return None
    index = min(len(sorted_values) - 1, max(0, int(round(ratio * (len(sorted_values) - 1)))))
    return sorted_values[index]


def run_benchmark_job(params: dict[str, Any], ctx: Any) -> dict[str, Any]:
    """Benchmark実行本体。paramsを検証し、エンジン毎に順次（公平に同一マシン負荷で）実行する。

    params: {project_id, name?, image_dir, gt_csv, dataset_id?, engines: [spec...],
             warmup_runs?（既定1）}
    """
    project_id = str(params.get("project_id") or "default")
    name = str(params.get("name") or "")
    image_dir = Path(str(params.get("image_dir") or "")).expanduser()
    if not image_dir.exists() or not image_dir.is_dir():
        raise FileNotFoundError(f"Benchmark用画像フォルダが見つかりません: {params.get('image_dir')}")
    gt = _read_gt_csv(str(params.get("gt_csv") or ""))
    engine_specs = params.get("engines") or []
    if not engine_specs:
        raise ValueError("Benchmark対象エンジンがありません")
    warmup_runs = max(0, int(params.get("warmup_runs") if params.get("warmup_runs") is not None else 1))

    ctx.update(5, "条件検証", f"エンジン{len(engine_specs)}件・画像{len(gt)}件")
    profile = build_profile(gt, str(params.get("dataset_id") or ""), engine_specs)
    specs = profile["engine_profiles"]

    # 画像の解決（全エンジンで同一の画像リストを使う=公平性）
    images: list[tuple[str, str, Path]] = []
    skipped_missing = 0
    for image_name, expected in gt.items():
        image_path = _resolve_image(image_dir, image_name)
        if image_path is None:
            skipped_missing += 1
            continue
        images.append((image_name, expected, image_path))
    if not images:
        raise ValueError("Benchmark対象の画像が見つかりませんでした（正解CSVと画像フォルダを確認してください）")

    results: list[dict[str, Any]] = []
    cases: dict[str, dict[str, Any]] = {
        image_name: {"image": image_name, "expected": expected, "engines": {}} for image_name, expected, _ in images
    }
    total_steps = len(specs) * len(images)
    done_steps = 0

    for spec_index, spec in enumerate(specs):
        ctx.check_cancelled()
        engine_key = f"{spec['engine']}:{spec.get('model') or ''}"
        ctx.update(
            int(5 + 90 * done_steps / max(1, total_steps)),
            f"エンジン準備 {spec_index + 1}/{len(specs)}",
            engine_key,
        )
        # cold start = Runner生成（モデルロード含む）の時間
        cold_t0 = time.perf_counter()
        runner = ENGINE_BUILDERS[spec["engine"]](project_id, spec)
        cold_start_seconds = time.perf_counter() - cold_t0

        # ウォームアップ（先頭画像で warmup_runs 回。統計へ含めず回数のみ記録）
        warmup_t0 = time.perf_counter()
        for _ in range(warmup_runs):
            try:
                runner["recognize"](str(images[0][2]))
            except Exception:  # noqa: BLE001
                break
        warmup_seconds = time.perf_counter() - warmup_t0

        dist_total = 0
        ref_total = 0
        correct = 0
        failed = 0
        sub_total = del_total = ins_total = 0
        times: list[float] = []
        errors: list[dict[str, str]] = []
        from collections import Counter

        confusions: Counter = Counter()

        for image_index, (image_name, expected, image_path) in enumerate(images):
            if image_index % 20 == 0:
                ctx.check_cancelled()
            infer_t0 = time.perf_counter()
            prediction = ""
            case_failed = False
            try:
                prediction, _confidence = runner["recognize"](str(image_path))
            except Exception as e:  # noqa: BLE001
                case_failed = True
                failed += 1
                if len(errors) < 20:
                    errors.append({"image": image_name, "error": str(e)[:200]})
            elapsed = time.perf_counter() - infer_t0
            times.append(elapsed)

            expected_cmp = _normalize_compare(expected)
            pred_cmp = _normalize_compare(prediction)
            match = (not case_failed) and bool(pred_cmp) and pred_cmp == expected_cmp
            # 失敗ケースは空予測（全脱落）としてCERへ算入する（除外して精度を偽らない）
            distance, ops = levenshtein_ops(expected_cmp, pred_cmp)
            dist_total += distance
            ref_total += len(expected_cmp)
            for op in ops:
                confusions[op] += 1
                if op[0] == "sub":
                    sub_total += 1
                elif op[0] == "del":
                    del_total += 1
                else:
                    ins_total += 1
            if match:
                correct += 1
            cases[image_name]["engines"][engine_key] = {
                "prediction": prediction,
                "match": bool(match),
                "failed": bool(case_failed),
                "edit_distance": int(distance),
                "time_ms": round(elapsed * 1000.0, 2),
            }
            done_steps += 1
            if done_steps % 10 == 0 or done_steps == total_steps:
                ctx.update(
                    int(5 + 90 * done_steps / max(1, total_steps)),
                    f"推論 {spec_index + 1}/{len(specs)}",
                    f"{engine_key} {image_index + 1}/{len(images)}",
                )

        total = len(images)
        cer = round(dist_total / ref_total, 4) if ref_total > 0 else None
        sorted_times = sorted(times)
        inference_seconds = sum(times)
        results.append(
            {
                "engine": spec["engine"],
                "model": spec.get("model") or "",
                "engine_key": engine_key,
                "label": runner["label"],
                "psm": spec.get("psm"),
                "whitelist": spec.get("whitelist"),
                # 精度
                "cer": cer,
                "char_accuracy": round(1.0 - cer, 4) if cer is not None else None,
                "exact_match_rate": round(correct / total, 4) if total else None,
                "correct": correct,
                "substitutions": sub_total,
                "insertions": ins_total,
                "deletions": del_total,
                "failed": failed,
                "total": total,
                # 時間（cold start / 推論を分離。ウォームアップは統計へ含めず回数記録）
                "cold_start_seconds": round(cold_start_seconds, 4),
                "warmup_runs": warmup_runs,
                "warmup_seconds": round(warmup_seconds, 4),
                "inference_seconds": round(inference_seconds, 4),
                "total_seconds": round(cold_start_seconds + warmup_seconds + inference_seconds, 4),
                "mean_time_ms": round(inference_seconds / total * 1000.0, 2) if total else None,
                "p50_time_ms": round(_percentile(sorted_times, 0.50) * 1000.0, 2) if sorted_times else None,
                "p95_time_ms": round(_percentile(sorted_times, 0.95) * 1000.0, 2) if sorted_times else None,
                # ピークメモリは本環境では正確に取得できないため null（推測しない）
                "peak_memory_mb": None,
                "errors": errors,
                "confusions": [
                    {"kind": kind, "from": src, "to": dst, "count": int(count)}
                    for (kind, src, dst), count in confusions.most_common(50)
                ],
                "completed_at": datetime.now().isoformat(),
            }
        )

    ctx.update(97, "保存")
    with _LOCK:
        registry = _load_registry(project_id)
        registry["counter"] = int(registry["counter"]) + 1
        benchmark_id = f"BM-{registry['counter']:04d}"
        item = {
            "benchmark_id": benchmark_id,
            "name": name,
            "created_at": datetime.now().isoformat(),
            "completed_at": datetime.now().isoformat(),
            "job_id": str(getattr(ctx, "job_id", "") or ""),
            "image_dir": str(image_dir.resolve()),
            "gt_csv": str(Path(str(params.get("gt_csv"))).expanduser().resolve()),
            "skipped_missing_image": skipped_missing,
            "profile": profile,
            "results": results,
            "cases": list(cases.values()),
        }
        registry["items"].append(item)
        _save_registry(project_id, registry)

    leaderboard = build_leaderboard(results)
    best = leaderboard[0] if leaderboard else None
    return {
        "benchmark_id": benchmark_id,
        "related_benchmark_id": benchmark_id,
        "engines": len(results),
        "images": len(images),
        "profile_hash": profile["profile_hash"],
        "best": {"engine_key": best["engine_key"], "cer": best["cer"]} if best else None,
    }


# ---------- Leaderboard / 用途別ベスト ----------


def build_leaderboard(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """CER昇順。同率は ExactMatch降順 → Failed昇順 → MeanTime昇順（CERなしは最下位）。"""

    def sort_key(row: dict[str, Any]):
        cer = row.get("cer")
        exact = row.get("exact_match_rate")
        mean_time = row.get("mean_time_ms")
        return (
            cer if cer is not None else float("inf"),
            -(exact if exact is not None else -1.0),
            int(row.get("failed") or 0),
            mean_time if mean_time is not None else float("inf"),
        )

    ranked = sorted((dict(r) for r in results), key=sort_key)
    for index, row in enumerate(ranked):
        row["rank"] = index + 1
    return ranked


def compute_balance_scores(results: list[dict[str, Any]], weights: dict[str, float]) -> list[dict[str, Any]]:
    """バランス最良スコア。計算式（UIにも明示する）:

    score = w_acc × 文字正解率(1−CER) + w_speed × (最速MeanTime ÷ 自MeanTime) + w_stab × (1 − Failed/Total)
    （重みは合計1へ正規化済み。CER未算出のエンジンはスコアなし）
    """
    valid_times = [r["mean_time_ms"] for r in results if r.get("mean_time_ms")]
    fastest = min(valid_times) if valid_times else None
    scored = []
    for row in results:
        entry = dict(row)
        cer = row.get("cer")
        if cer is None:
            entry["balance_score"] = None
        else:
            accuracy_score = 1.0 - float(cer)
            speed_score = (fastest / row["mean_time_ms"]) if fastest and row.get("mean_time_ms") else 0.0
            total = int(row.get("total") or 0)
            stability_score = 1.0 - (int(row.get("failed") or 0) / total) if total else 0.0
            entry["balance_score"] = round(
                weights["accuracy"] * accuracy_score
                + weights["speed"] * speed_score
                + weights["stability"] * stability_score,
                4,
            )
        scored.append(entry)
    return scored


def build_purpose_picks(results: list[dict[str, Any]], weights: dict[str, float]) -> dict[str, Any]:
    """用途別ベスト（最高精度 / 完全一致 / 最速 / 最少失敗 / バランス最良）。"""
    if not results:
        return {}
    with_cer = [r for r in results if r.get("cer") is not None]
    with_time = [r for r in results if r.get("mean_time_ms") is not None]
    scored = compute_balance_scores(results, weights)
    with_score = [r for r in scored if r.get("balance_score") is not None]
    picks = {
        "best_accuracy": min(with_cer, key=lambda r: r["cer"])["engine_key"] if with_cer else None,
        "best_exact_match": (
            max(with_cer, key=lambda r: r.get("exact_match_rate") or 0.0)["engine_key"] if with_cer else None
        ),
        "fastest": min(with_time, key=lambda r: r["mean_time_ms"])["engine_key"] if with_time else None,
        "fewest_failures": min(results, key=lambda r: int(r.get("failed") or 0))["engine_key"],
        "best_balance": max(with_score, key=lambda r: r["balance_score"])["engine_key"] if with_score else None,
        "balance_weights": weights,
        "balance_formula": (
            "score = {acc:.0%}×文字正解率(1−CER) + {speed:.0%}×(最速MeanTime÷自MeanTime) + {stab:.0%}×(1−Failed/Total)".format(
                acc=weights["accuracy"], speed=weights["speed"], stab=weights["stability"]
            )
        ),
        "scores": [{"engine_key": r["engine_key"], "balance_score": r.get("balance_score")} for r in scored],
    }
    return picks


# ---------- 取得・CSV Export ----------


def list_benchmarks(project_id: Optional[str]) -> dict[str, Any]:
    """Benchmark一覧（新しい順・casesは含めない要約）＋バランス重み設定。"""
    registry = _load_registry(project_id)
    weights = get_balance_weights(project_id)
    items = []
    for item in reversed(registry["items"]):
        summary = {k: v for k, v in item.items() if k != "cases"}
        summary["results"] = build_leaderboard(item.get("results") or [])
        summary["purpose_picks"] = build_purpose_picks(item.get("results") or [], weights)
        items.append(summary)
    return {"items": items, "balance_weights": weights}


def get_benchmark(project_id: Optional[str], benchmark_id: str) -> dict[str, Any]:
    registry = _load_registry(project_id)
    for item in registry["items"]:
        if item.get("benchmark_id") == benchmark_id:
            weights = get_balance_weights(project_id)
            detail = dict(item)
            detail["results"] = build_leaderboard(item.get("results") or [])
            detail["purpose_picks"] = build_purpose_picks(item.get("results") or [], weights)
            return detail
    raise FileNotFoundError(f"benchmark not found: {benchmark_id}")


def _csv_bytes(rows: list[list[Any]]) -> bytes:
    import csv
    import io

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    for row in rows:
        writer.writerow(["" if value is None else value for value in row])
    # BOM付きUTF-8（Excelで文字化けしない「CSV（Excel対応）」）
    return ("﻿" + buffer.getvalue()).encode("utf-8")


def export_benchmark_csv(project_id: Optional[str], benchmark_id: str, kind: str) -> tuple[str, bytes]:
    """CSV（Excel対応）3種: benchmark_summary / benchmark_cases / benchmark_confusions。"""
    detail = get_benchmark(project_id, benchmark_id)
    results = detail.get("results") or []
    if kind == "summary":
        rows: list[list[Any]] = [
            [
                "rank", "engine", "model", "label", "cer", "char_accuracy", "exact_match_rate",
                "correct", "substitutions", "insertions", "deletions", "failed", "total",
                "cold_start_seconds", "warmup_runs", "warmup_seconds", "inference_seconds",
                "total_seconds", "mean_time_ms", "p50_time_ms", "p95_time_ms", "peak_memory_mb",
                "psm", "whitelist", "completed_at", "profile_hash",
            ]
        ]
        for r in results:
            rows.append([
                r.get("rank"), r.get("engine"), r.get("model"), r.get("label"), r.get("cer"),
                r.get("char_accuracy"), r.get("exact_match_rate"), r.get("correct"),
                r.get("substitutions"), r.get("insertions"), r.get("deletions"), r.get("failed"),
                r.get("total"), r.get("cold_start_seconds"), r.get("warmup_runs"),
                r.get("warmup_seconds"), r.get("inference_seconds"), r.get("total_seconds"),
                r.get("mean_time_ms"), r.get("p50_time_ms"), r.get("p95_time_ms"),
                r.get("peak_memory_mb"), r.get("psm"), r.get("whitelist"), r.get("completed_at"),
                (detail.get("profile") or {}).get("profile_hash"),
            ])
        return f"benchmark_summary_{benchmark_id}.csv", _csv_bytes(rows)
    if kind == "cases":
        engine_keys = [r.get("engine_key") for r in results]
        header = ["image", "expected"]
        for key in engine_keys:
            header += [f"{key}:prediction", f"{key}:match", f"{key}:failed", f"{key}:edit_distance", f"{key}:time_ms"]
        rows = [header]
        for case in detail.get("cases") or []:
            row: list[Any] = [case.get("image"), case.get("expected")]
            for key in engine_keys:
                engine_case = (case.get("engines") or {}).get(key) or {}
                row += [
                    engine_case.get("prediction"),
                    engine_case.get("match"),
                    engine_case.get("failed"),
                    engine_case.get("edit_distance"),
                    engine_case.get("time_ms"),
                ]
            rows.append(row)
        return f"benchmark_cases_{benchmark_id}.csv", _csv_bytes(rows)
    if kind == "confusions":
        rows = [["engine_key", "kind", "from", "to", "count"]]
        for r in results:
            for confusion in r.get("confusions") or []:
                rows.append([
                    r.get("engine_key"), confusion.get("kind"), confusion.get("from"),
                    confusion.get("to"), confusion.get("count"),
                ])
        return f"benchmark_confusions_{benchmark_id}.csv", _csv_bytes(rows)
    raise ValueError(f"unsupported export kind: {kind}（summary / cases / confusions）")
