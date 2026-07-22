"""実験管理（Experiment Tracking）サービス。

学習実行ごとに実験カルテ（学習条件・前処理・オーグメンテーション・評価・学習時間）を
プロジェクト単位で採番・保存し、実験比較・履歴分析の土台にする。

- 実験ID: EXP-0001 形式（プロジェクト内で一意・作成順・削除しても再利用しない）。
  モデル管理No（M0001）とは独立。1実験に複数モデルが紐付けられるよう models はリスト
- 保存先: data/projects/<id>/experiments.json（{"counter": n, "items": [...]}）
- 旧モデル（実験記録なしで学習済みの .tess.json）は一覧取得時に自動バックフィル
  （source="backfill"。モデルメタから復元できる範囲のみ・推測補完しない）
- 評価結果は評価実行時に attach_evaluation でモデル名から該当実験へ保存する
- 将来拡張: Optuna等の自動探索は record_experiment の payload に "search" 名前空間を
  追加する形で拡張できる（既存フィールドの意味は変えない）
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any, Optional

from ..project_paths import ensure_project_directories

EXPERIMENTS_FILENAME = "experiments.json"
_EXPERIMENTS_LOCK = Lock()

# 自由タグの上限（1実験あたり）と1タグの最大長
MAX_TAGS = 20
MAX_TAG_LENGTH = 40


def _experiments_path(project_root: Path) -> Path:
    return Path(project_root) / EXPERIMENTS_FILENAME


def _load_registry(project_root: Path) -> dict[str, Any]:
    try:
        payload = json.loads(_experiments_path(project_root).read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            return {"counter": int(payload.get("counter") or 0), "items": payload["items"]}
    except (OSError, ValueError):
        pass
    return {"counter": 0, "items": []}


def _save_registry(project_root: Path, registry: dict[str, Any]) -> None:
    _experiments_path(project_root).write_text(
        json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _normalize_tags(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    tags: list[str] = []
    for item in raw:
        tag = str(item or "").strip()[:MAX_TAG_LENGTH]
        if tag and tag not in tags:
            tags.append(tag)
        if len(tags) >= MAX_TAGS:
            break
    return tags


def summarize_threshold_from_preprocess(training_preprocess: Any) -> str:
    """学習時前処理レコードから二値化の要約（前処理名の代表表示）を作る。未記録は空文字。"""
    if not isinstance(training_preprocess, dict):
        return ""
    steps = training_preprocess.get("steps")
    if not isinstance(steps, dict):
        return ""
    for image_type in ("wide", "single"):
        for step in steps.get(image_type) or []:
            if isinstance(step, dict) and step.get("name") == "threshold":
                params = step.get("params") or {}
                mode = str(params.get("type") or "otsu").lower()
                if mode == "otsu":
                    return "Otsu"
                if mode == "adaptive":
                    return f"Adaptive({params.get('block_size')}, {params.get('c')})"
                if mode == "none":
                    return "二値化なし"
                return f"Binary {params.get('value')}"
    return ""


def _experiment_from_model_meta(model_file: str, meta: dict[str, Any]) -> dict[str, Any]:
    """旧モデルの .tess.json から実験カルテを復元する（バックフィル。取れない値はNone/空）。"""
    counts = meta.get("counts") if isinstance(meta.get("counts"), dict) else {}
    dataset_counts = {
        "train": counts.get("train"),
        "val": counts.get("val"),
        "test": counts.get("test"),
    }
    duration = meta.get("training_duration_seconds")
    finished = str(meta.get("created_at") or "")
    started = ""
    if finished and isinstance(duration, (int, float)):
        try:
            started = (datetime.fromisoformat(finished) - timedelta(seconds=int(duration))).isoformat()
        except ValueError:
            started = ""
    return {
        "created_at": finished or datetime.now().isoformat(),
        "started_at": started,
        "finished_at": finished,
        "duration_seconds": int(duration) if isinstance(duration, (int, float)) else None,
        "models": [model_file],
        "experiment_name": str(meta.get("experiment_name") or ""),
        "parent_model_id": str(meta.get("parent_model_id") or ""),
        "note": str(meta.get("training_note") or ""),
        "operator": "",
        "training": {
            "iterations": int(meta.get("max_iterations") or 0) or None,
            "charset": str(meta.get("charset") or ""),
            "base_lang": str(meta.get("base_lang") or ""),
            "split_ratio": meta.get("dataset_split_ratio") if isinstance(meta.get("dataset_split_ratio"), dict) else None,
            "split_seed": meta.get("split_seed") if isinstance(meta.get("split_seed"), int) else None,
            "split_method": str(meta.get("split_method") or ""),
            "counts": dataset_counts,
        },
        "preprocess": {
            "hash": str(meta.get("training_preprocess_hash") or ""),
            "snapshot_id": str((meta.get("training_preprocess") or {}).get("snapshot_id") or "")
            if isinstance(meta.get("training_preprocess"), dict)
            else "",
            "summary": summarize_threshold_from_preprocess(meta.get("training_preprocess")),
        },
        "augmentation": {
            "config": meta.get("augmentation_config") if isinstance(meta.get("augmentation_config"), dict) else None,
            "generated": meta.get("augmentation_generated") if isinstance(meta.get("augmentation_generated"), int) else None,
        },
        "evaluation": None,
        "tags": [],
        "favorite": False,
        "source": "backfill",
    }


def record_experiment(project_id: Optional[str], payload: dict[str, Any]) -> dict[str, Any]:
    """学習完了時の実験記録。EXP-0001形式でプロジェクト内一意に採番して保存する。"""
    paths = ensure_project_directories(project_id)
    with _EXPERIMENTS_LOCK:
        registry = _load_registry(paths.root)
        registry["counter"] = int(registry["counter"]) + 1
        experiment = {
            "experiment_id": f"EXP-{registry['counter']:04d}",
            "created_at": datetime.now().isoformat(),
            "tags": _normalize_tags(payload.get("tags")),
            "favorite": bool(payload.get("favorite", False)),
            "evaluation": None,
            "source": str(payload.get("source") or "training"),
            **{k: v for k, v in payload.items() if k not in {"tags", "favorite", "source"}},
        }
        if not isinstance(experiment.get("models"), list):
            experiment["models"] = [str(experiment.get("models") or "")] if experiment.get("models") else []
        registry["items"].append(experiment)
        _save_registry(paths.root, registry)
        return experiment


def ensure_experiments_for_models(project_id: Optional[str]) -> int:
    """実験記録を持たない既存モデル（.tess.json）から実験をバックフィルする。戻り値=追加件数。"""
    paths = ensure_project_directories(project_id)
    with _EXPERIMENTS_LOCK:
        registry = _load_registry(paths.root)
        known_models: set[str] = set()
        for item in registry["items"]:
            for name in item.get("models") or []:
                known_models.add(str(name))
        added = 0
        candidates: list[tuple[str, dict[str, Any]]] = []
        for meta_path in sorted(paths.models.glob("*.tess.json")):
            if meta_path.name in known_models:
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(meta, dict):
                candidates.append((meta_path.name, meta))
        # 作成日時順に採番（古いモデルほど若い実験ID）
        candidates.sort(key=lambda row: str(row[1].get("created_at") or ""))
        for model_file, meta in candidates:
            registry["counter"] = int(registry["counter"]) + 1
            experiment = {
                "experiment_id": f"EXP-{registry['counter']:04d}",
                **_experiment_from_model_meta(model_file, meta),
            }
            registry["items"].append(experiment)
            added += 1
        if added:
            _save_registry(paths.root, registry)
        return added


def _model_id_map(project_id: str) -> dict[str, str]:
    """モデル管理No登録簿（data/model_ids.json）から <モデル名>→M0001 の対応を読む。"""
    from .. import project_paths as project_paths_module

    try:
        path = Path(project_paths_module.PROJECTS_DIR).parent / "model_ids.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        models = data.get("models") if isinstance(data, dict) else {}
        prefix = f"{project_id}/"
        return {key[len(prefix):]: str(value) for key, value in (models or {}).items() if key.startswith(prefix)}
    except (OSError, ValueError):
        return {}


def list_experiments(project_id: Optional[str], backfill: bool = True) -> list[dict[str, Any]]:
    """実験一覧（管理No付与済み）。backfill=True で旧モデル分を自動補完する。"""
    paths = ensure_project_directories(project_id)
    if backfill:
        ensure_experiments_for_models(paths.project_id)
    registry = _load_registry(paths.root)
    id_map = _model_id_map(paths.project_id)
    items = []
    for item in registry["items"]:
        models = [str(m) for m in (item.get("models") or [])]
        items.append({**item, "model_ids": [id_map.get(m, "") for m in models]})
    return items


def update_experiment(project_id: Optional[str], experiment_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """タグ・お気に入り・メモ・学習者・実験名の更新（許可フィールドのみ）。"""
    paths = ensure_project_directories(project_id)
    with _EXPERIMENTS_LOCK:
        registry = _load_registry(paths.root)
        for item in registry["items"]:
            if str(item.get("experiment_id")) != str(experiment_id):
                continue
            if "tags" in patch:
                item["tags"] = _normalize_tags(patch.get("tags"))
            if "favorite" in patch and patch["favorite"] is not None:
                item["favorite"] = bool(patch["favorite"])
            if "note" in patch and patch["note"] is not None:
                item["note"] = str(patch["note"])
            if "operator" in patch and patch["operator"] is not None:
                item["operator"] = str(patch["operator"])
            if "experiment_name" in patch and patch["experiment_name"] is not None:
                item["experiment_name"] = str(patch["experiment_name"])
            _save_registry(paths.root, registry)
            return item
    raise FileNotFoundError(f"experiment not found: {experiment_id}")


def attach_evaluation(project_id: Optional[str], model: str, evaluation: dict[str, Any]) -> Optional[dict[str, Any]]:
    """評価実行結果をモデル名から該当実験へ保存する（最新の該当実験1件）。

    該当実験がない場合は None（旧モデルはバックフィル後に該当する）。
    保存する値は要約のみ（CER・文字正解率・完全一致率・改善/悪化件数・評価日時・データセット）。
    """
    paths = ensure_project_directories(project_id)
    model_name = str(model or "").strip()
    if not model_name:
        return None
    normalized = {
        "cer": evaluation.get("cer"),
        "char_accuracy": evaluation.get("char_accuracy"),
        "accuracy_percent": evaluation.get("accuracy_percent"),
        "improved": evaluation.get("improved"),
        "regressed": evaluation.get("regressed"),
        "evaluated_at": str(evaluation.get("evaluated_at") or datetime.now().isoformat()),
        "dataset": str(evaluation.get("dataset") or ""),
    }
    with _EXPERIMENTS_LOCK:
        registry = _load_registry(paths.root)
        target = None
        for item in registry["items"]:
            if model_name in [str(m) for m in (item.get("models") or [])]:
                target = item  # 複数該当時は最後（最新）の実験を採用
        if target is None:
            return None
        target["evaluation"] = normalized
        _save_registry(paths.root, registry)
        return target
