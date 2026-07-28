"""Benchmark Center（既存資産の横断比較ビュー）。

Benchmark Runner（`services/benchmark.py`）とは責務を明確に分離する:
- Benchmark Runner = OCRエンジンを実際に実行して性能を測定する実行ツール
- Benchmark Center = Dataset Manager / Experiment Tracking / Model Manager /
  既存評価結果を横断して**比較・可視化するだけ**の統合ビュー。評価ロジックは一切持たない

このモジュールは新しい評価ロジックを実装しない。CER・完全一致率・文字正解率は
`experiment_tracker.py`（Experimentへ紐付いた評価結果）からそのまま読む。
Precision/Recall/F1/WER/推論速度は、既存のどの機能にも算出ロジックが無いため
提供しない（推測で埋めない。比較表では「未対応」表示になる）。

保存するのは**比較条件のみ**（対象Dataset・対象Model・フィルタ・並び順）。
評価結果自体は保存しない＝Evaluation/Experimentが唯一の情報源であり続ける。
保存先: `data/projects/<project_id>/benchmark_center.json`
（`experiments.json`/`benchmarks.json`と同じ「プロジェクト単位カウンタ+履歴リスト」形式を踏襲）
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Optional

from ..project_paths import ensure_project_directories

logger = logging.getLogger(__name__)

COMPARISONS_FILENAME = "benchmark_center.json"
_LOCK = Lock()


def _comparisons_path(project_root: Path) -> Path:
    return Path(project_root) / COMPARISONS_FILENAME


def _load_registry(project_root: Path) -> dict[str, Any]:
    try:
        payload = json.loads(_comparisons_path(project_root).read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            return {"counter": int(payload.get("counter") or 0), "items": payload["items"]}
    except (OSError, ValueError):
        pass
    return {"counter": 0, "items": []}


def _save_registry(project_root: Path, registry: dict[str, Any]) -> None:
    from .atomic_io import atomic_write_json

    atomic_write_json(_comparisons_path(project_root), registry)


# ---------- 比較対象一覧（Dataset Manager / Experiment Tracking / Model Managerを横断参照） ----------


def _experiment_for_model(experiments: list[dict[str, Any]], model_name: str) -> Optional[dict[str, Any]]:
    """このモデルに紐づく最新のExperimentを返す（`attach_evaluation`と同じ「最後に一致した
    Experimentを採用」規則。1モデルが複数Experimentのmodelsに含まれる場合は最新を優先）。"""
    matches = [e for e in experiments if model_name in (e.get("models") or [])]
    return matches[-1] if matches else None


def list_comparable_models(
    project_id: Optional[str],
    dataset_id: str = "",
    engine: str = "",
    preprocess_version: Optional[int] = None,
    experiment_id: str = "",
    query: str = "",
) -> list[dict[str, Any]]:
    """比較可能なモデル一覧（Model Manager×Experiment Trackingのクロス参照。新規評価は実行しない）。

    各行: model_name・model_id・engine・model_size_mb・dataset_id・dataset_name・
    experiment_id・preprocess_version・evaluation（cer/char_accuracy/accuracy_percent/
    evaluated_at。未評価はNone=推測補完しない）。
    """
    from .experiment_tracker import list_experiments
    from .model_registry import list_model_infos

    resolved = str(project_id or "default")
    model_infos = list_model_infos(resolved)
    experiments = list_experiments(resolved)

    rows: list[dict[str, Any]] = []
    for info in model_infos:
        name = str(info.get("name") or "")
        exp = _experiment_for_model(experiments, name)
        evaluation_raw = exp.get("evaluation") if exp else None
        preprocess = exp.get("preprocess") if isinstance((exp or {}).get("preprocess"), dict) else {}
        row_dataset_id = str(info.get("dataset_id") or "")
        row_engine = str(info.get("engine") or "")
        row_preprocess_version = preprocess.get("version")
        row_experiment_id = str(exp.get("experiment_id") or "") if exp else ""

        if dataset_id and row_dataset_id != dataset_id:
            continue
        if engine and row_engine != engine:
            continue
        if preprocess_version is not None and row_preprocess_version != preprocess_version:
            continue
        if experiment_id and row_experiment_id != experiment_id:
            continue
        if query:
            haystack = " ".join(
                [name, str(info.get("dataset_name") or ""), row_dataset_id, row_experiment_id, row_engine]
            ).lower()
            if query.lower() not in haystack:
                continue

        rows.append(
            {
                "model_name": name,
                "model_id": str(info.get("model_id") or ""),
                "engine": row_engine,
                "model_size_mb": info.get("model_size_mb"),
                "dataset_id": row_dataset_id,
                "dataset_name": str(info.get("dataset_name") or ""),
                "experiment_id": row_experiment_id,
                "preprocess_version": row_preprocess_version,
                "evaluation": (
                    {
                        "cer": evaluation_raw.get("cer"),
                        "char_accuracy": evaluation_raw.get("char_accuracy"),
                        "accuracy_percent": evaluation_raw.get("accuracy_percent"),
                        "evaluated_at": evaluation_raw.get("evaluated_at"),
                        "confusions": evaluation_raw.get("confusions") if isinstance(evaluation_raw.get("confusions"), list) else [],
                    }
                    if isinstance(evaluation_raw, dict)
                    else None
                ),
            }
        )
    return rows


def check_missing_evaluations(project_id: Optional[str], model_names: list[str]) -> list[str]:
    """指定モデルのうち、評価結果（Experimentへ紐付いたEvaluation）が無いモデル名一覧。

    Benchmark Center自身は評価を実行しない。呼び出し側（フロント）はこの結果が空でない場合、
    「評価結果がありません。評価を実行しますか？」を表示し、既存のモデル評価画面へ誘導する。
    """
    rows = list_comparable_models(project_id)
    by_name = {row["model_name"]: row for row in rows}
    return [name for name in model_names if not (by_name.get(name) or {}).get("evaluation")]


# ---------- 比較条件の保存（評価結果自体は保存しない） ----------


def save_comparison(project_id: Optional[str], payload: dict[str, Any]) -> dict[str, Any]:
    """比較条件（対象Dataset・対象Model・対象Experiment・フィルタ・並び順）のみを保存する。

    Benchmark ID（`BMC-0001`形式）はプロジェクト内一意・作成順・削除しても再利用しない
    （既存の`EXP-0001`/`BM-0001`と同じ採番方式）。
    """
    from .atomic_io import file_lock

    paths = ensure_project_directories(project_id)
    with _LOCK, file_lock(_comparisons_path(paths.root)):
        registry = _load_registry(paths.root)
        registry["counter"] = int(registry["counter"]) + 1
        item = {
            "comparison_id": f"BMC-{registry['counter']:04d}",
            "created_at": datetime.now().isoformat(),
            "name": str(payload.get("name") or ""),
            "dataset_ids": [str(x) for x in (payload.get("dataset_ids") or []) if str(x)],
            "model_names": [str(x) for x in (payload.get("model_names") or []) if str(x)],
            "experiment_ids": [str(x) for x in (payload.get("experiment_ids") or []) if str(x)],
            "filters": payload.get("filters") if isinstance(payload.get("filters"), dict) else {},
            "sort": payload.get("sort") if isinstance(payload.get("sort"), dict) else {},
        }
        registry["items"].append(item)
        _save_registry(paths.root, registry)
        return item


def list_comparisons(project_id: Optional[str]) -> list[dict[str, Any]]:
    """保存済み比較条件の履歴（作成日時降順）。"""
    paths = ensure_project_directories(project_id)
    registry = _load_registry(paths.root)
    items = list(registry["items"])
    items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return items


def get_comparison(project_id: Optional[str], comparison_id: str) -> Optional[dict[str, Any]]:
    for item in list_comparisons(project_id):
        if str(item.get("comparison_id")) == str(comparison_id):
            return item
    return None


# ---------- 参加件数（Dataset/Model/Experiment詳細画面へ表示） ----------
# 一括計算してO(1)参照にする（比較条件件数×対象件数のO(n×m)を避ける。項目16のパフォーマンス要件）


def build_dataset_participation_counts(project_id: Optional[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in list_comparisons(project_id):
        for dataset_id in item.get("dataset_ids") or []:
            counts[dataset_id] = counts.get(dataset_id, 0) + 1
    return counts


def build_model_participation_counts(project_id: Optional[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in list_comparisons(project_id):
        for model_name in item.get("model_names") or []:
            counts[model_name] = counts.get(model_name, 0) + 1
    return counts


def build_experiment_participation_counts(project_id: Optional[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in list_comparisons(project_id):
        for experiment_id in item.get("experiment_ids") or []:
            counts[experiment_id] = counts.get(experiment_id, 0) + 1
    return counts


def count_comparisons_for_model(project_id: Optional[str], model_name: str) -> int:
    return build_model_participation_counts(project_id).get(str(model_name), 0)


def count_comparisons_for_dataset(project_id: Optional[str], dataset_id: str) -> int:
    return build_dataset_participation_counts(project_id).get(str(dataset_id), 0)


def count_comparisons_for_experiment(project_id: Optional[str], experiment_id: str) -> int:
    return build_experiment_participation_counts(project_id).get(str(experiment_id), 0)
