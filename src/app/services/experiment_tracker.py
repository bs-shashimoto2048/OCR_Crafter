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

import hashlib
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

# 評価の固定仕様（Evaluation Profileへ記録する。変更時はバージョンを上げて別条件として扱う）
EVAL_NORMALIZATION_VERSION = "trim+NFC"  # _normalize_compare の仕様（case-sensitive・NFKC不使用）
CER_VERSION = "cer-v1-micro"  # マイクロ平均CER（編集距離総和÷正解文字数総和）

# 推薦の最低根拠件数（未満は「参考値・データ不足」）
RECOMMENDATION_MIN_BASIS = 5


def normalize_evaluation_profile(evaluation: dict[str, Any]) -> dict[str, Any]:
    """評価実行の入力から Evaluation Profile（比較可能性を定義する評価条件）を正規化する。

    評価データセット・画像数・ラベル数・評価前処理・エンジン・PSM・Whitelist・
    文字正規化・CERバージョン・評価日時。欠損は空/None（推測しない）。
    """
    src = evaluation if isinstance(evaluation, dict) else {}
    psm = src.get("psm")
    return {
        "dataset": str(src.get("dataset") or ""),
        "dataset_id": str(src.get("dataset_id") or src.get("dataset") or ""),
        "image_count": int(src["image_count"]) if isinstance(src.get("image_count"), (int, float)) else None,
        "label_count": int(src["label_count"]) if isinstance(src.get("label_count"), (int, float)) else None,
        # 評価前処理の識別子（学習時前処理モード=ハッシュ / 手動=設定シグネチャ / なし="none"）
        "preprocess_signature": str(src.get("preprocess_signature") or ""),
        "engine": str(src.get("engine") or "tesseract"),
        "psm": int(psm) if isinstance(psm, (int, float)) else 7,
        "whitelist": str(src.get("whitelist") or ""),
        "normalization": EVAL_NORMALIZATION_VERSION,
        "cer_version": CER_VERSION,
        "evaluated_at": str(src.get("evaluated_at") or datetime.now().isoformat()),
    }


def compute_evaluation_hash(profile: Optional[dict[str, Any]]) -> str:
    """Evaluation Profileから Evaluation Hash を生成する（同一Hash=同一条件評価）。

    ハッシュ対象: データセットID・画像数・ラベル数・評価前処理・エンジン・PSM・Whitelist・
    文字正規化・CERバージョン。評価日時・表示名は除外。
    条件が特定できない（データセットID・前処理識別子の両方が空）場合は空文字（Hash生成不可）。
    """
    if not isinstance(profile, dict):
        return ""
    if not profile.get("dataset_id") and not profile.get("preprocess_signature"):
        return ""
    payload = {
        "dataset_id": str(profile.get("dataset_id") or ""),
        "image_count": profile.get("image_count"),
        "label_count": profile.get("label_count"),
        "preprocess_signature": str(profile.get("preprocess_signature") or ""),
        "engine": str(profile.get("engine") or ""),
        "psm": profile.get("psm"),
        "whitelist": str(profile.get("whitelist") or ""),
        "normalization": str(profile.get("normalization") or ""),
        "cer_version": str(profile.get("cer_version") or ""),
    }
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


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
        "evaluation_profile": None,
        "tags": [],
        "favorite": False,
        # バックフィル実験は評価条件・学習経緯の完全性を保証できないため、既定で分析対象外
        # （推薦・相関への影響を下げる。UIから分析対象へ戻せる）
        "analysis_enabled": False,
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
            "evaluation_profile": None,
            "analysis_enabled": bool(payload.get("analysis_enabled", True)),
            "source": str(payload.get("source") or "training"),
            **{k: v for k, v in payload.items() if k not in {"tags", "favorite", "source", "analysis_enabled"}},
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


def _default_analysis_enabled(item: dict[str, Any]) -> bool:
    """analysis_enabled 未設定の旧レコードの既定値（backfill=対象外 / それ以外=対象）。"""
    if "analysis_enabled" in item:
        return bool(item["analysis_enabled"])
    return str(item.get("source") or "training") != "backfill"


def list_experiments(project_id: Optional[str], backfill: bool = True) -> list[dict[str, Any]]:
    """実験一覧（管理No・Evaluation Hash・Comparable Group・分析対象を付与済み）。

    backfill=True で旧モデル分を自動補完する。
    """
    paths = ensure_project_directories(project_id)
    if backfill:
        ensure_experiments_for_models(paths.project_id)
    registry = _load_registry(paths.root)
    id_map = _model_id_map(paths.project_id)
    items = []
    for item in registry["items"]:
        models = [str(m) for m in (item.get("models") or [])]
        items.append(
            {
                **item,
                "model_ids": [id_map.get(m, "") for m in models],
                "evaluation_hash": compute_evaluation_hash(item.get("evaluation_profile")),
                "analysis_enabled": _default_analysis_enabled(item),
            }
        )
    # Comparable Group（Evaluation Hash単位・出現順で CG-0001 から採番）を付与
    groups = build_comparable_groups(items)
    group_by_hash = {group["evaluation_hash"]: group["group_id"] for group in groups}
    for item in items:
        item["comparable_group"] = group_by_hash.get(item["evaluation_hash"], "")
    return items


def build_comparable_groups(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Evaluation Hash単位の Comparable Group を生成する（CG-0001形式・出現順で決定的に採番）。

    Hashのない実験（評価未実施・Hash生成不可）はグループへ含めない。
    """
    groups: dict[str, dict[str, Any]] = {}
    for item in items:
        eval_hash = str(item.get("evaluation_hash") or compute_evaluation_hash(item.get("evaluation_profile")))
        if not eval_hash:
            continue
        if eval_hash not in groups:
            profile = item.get("evaluation_profile") if isinstance(item.get("evaluation_profile"), dict) else {}
            groups[eval_hash] = {
                "group_id": f"CG-{len(groups) + 1:04d}",
                "evaluation_hash": eval_hash,
                "dataset": str(profile.get("dataset") or profile.get("dataset_id") or ""),
                "whitelist": str(profile.get("whitelist") or ""),
                "psm": profile.get("psm"),
                "preprocess_signature": str(profile.get("preprocess_signature") or ""),
                "experiments": [],
            }
        groups[eval_hash]["experiments"].append(str(item.get("experiment_id") or ""))
    result = list(groups.values())
    for group in result:
        group["count"] = len(group["experiments"])
    return result


def set_analysis_enabled(project_id: Optional[str], experiment_id: str, enabled: bool) -> dict[str, Any]:
    """実験の分析対象ON/OFF（失敗・途中停止・デバッグ実験の除外用）。"""
    paths = ensure_project_directories(project_id)
    with _EXPERIMENTS_LOCK:
        registry = _load_registry(paths.root)
        for item in registry["items"]:
            if str(item.get("experiment_id")) == str(experiment_id):
                item["analysis_enabled"] = bool(enabled)
                _save_registry(paths.root, registry)
                return item
    raise FileNotFoundError(f"experiment not found: {experiment_id}")


def analysis_exclusion_reason(item: dict[str, Any]) -> str:
    """推薦・相関分析へ使用できない理由（空文字=使用可能）。

    対象外: 分析対象OFF（バックフィル既定含む）/ 評価未実施・CERなし / Evaluation Hash生成不可。
    """
    if not _default_analysis_enabled(item):
        return "backfill" if str(item.get("source") or "") == "backfill" else "analysis_disabled"
    evaluation = item.get("evaluation") if isinstance(item.get("evaluation"), dict) else None
    if evaluation is None:
        return "not_evaluated"
    if not isinstance(evaluation.get("cer"), (int, float)):
        return "no_cer"
    eval_hash = str(item.get("evaluation_hash") or compute_evaluation_hash(item.get("evaluation_profile")))
    if not eval_hash:
        return "no_evaluation_hash"
    return ""


def build_recommendations(project_id: Optional[str]) -> dict[str, Any]:
    """比較可能Experimentのみから条件推薦を生成する（安全な推薦）。

    - 分析対象外（バックフィル既定OFF・CERなし・評価未実施・Hash生成不可）は使用しない
    - 最大の Comparable Group を根拠とし、根拠件数を必ず返す（5件未満は参考値=insufficient）
    """
    items = list_experiments(project_id)
    eligible = [item for item in items if not analysis_exclusion_reason(item)]
    excluded = [
        {"experiment_id": str(item.get("experiment_id") or ""), "reason": analysis_exclusion_reason(item)}
        for item in items
        if analysis_exclusion_reason(item)
    ]
    # 最大グループを推薦根拠にする（同数は先に採番されたグループ）
    by_group: dict[str, list[dict[str, Any]]] = {}
    for item in eligible:
        group = str(item.get("comparable_group") or "")
        if group:
            by_group.setdefault(group, []).append(item)
    if not by_group:
        return {"group_id": "", "basis_count": 0, "insufficient": True, "cards": [], "excluded": excluded, "safety": ""}
    group_id = max(by_group.keys(), key=lambda g: (len(by_group[g]), -int(g.split("-")[1])))
    basis = by_group[group_id]
    insufficient = len(basis) < RECOMMENDATION_MIN_BASIS

    def cer(item: dict[str, Any]) -> float:
        return float(item["evaluation"]["cer"])

    def iterations(item: dict[str, Any]) -> Optional[int]:
        training = item.get("training") if isinstance(item.get("training"), dict) else {}
        value = training.get("iterations")
        return int(value) if isinstance(value, (int, float)) else None

    cards: list[dict[str, Any]] = []
    best = min(basis, key=cer)
    best_iter = iterations(best)
    if best_iter is not None:
        higher = [item for item in basis if (iterations(item) or 0) > best_iter]
        reason = f"{best['experiment_id']}（CER {cer(best) * 100:.1f}%）で最良"
        if higher:
            higher_mean = sum(cer(item) for item in higher) / len(higher)
            if higher_mean > cer(best):
                reason += f"。{best_iter:,}超は平均CER {higher_mean * 100:.1f}%と悪化（過学習傾向）"
        cards.append({"id": "iteration", "title": "Iteration", "value": f"{best_iter:,} を推奨", "reason": reason})

    def has_aug(item: dict[str, Any]) -> bool:
        aug = item.get("augmentation") if isinstance(item.get("augmentation"), dict) else {}
        return isinstance(aug.get("config"), dict)

    with_aug = [item for item in basis if has_aug(item)]
    without_aug = [item for item in basis if not has_aug(item)]
    if with_aug and without_aug:
        delta_pt = (sum(cer(i) for i in without_aug) / len(without_aug) - sum(cer(i) for i in with_aug) / len(with_aug)) * 100
        cards.append(
            {
                "id": "augmentation",
                "title": "Augmentation",
                "value": "使用を推奨" if delta_pt > 0 else "なしを推奨",
                "reason": f"Augあり平均とAugなし平均の差 {'+' if delta_pt >= 0 else ''}{delta_pt:.1f}pt（あり{len(with_aug)}件 / なし{len(without_aug)}件）",
            }
        )

    return {
        "group_id": group_id,
        "basis_count": len(basis),
        "insufficient": insufficient,
        "cards": cards,
        "excluded": excluded,
        "safety": f"この推薦は{len(basis)}件の比較可能Experiment（{group_id}）から生成されています。",
    }


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
        # Release Gate用: 混同集計（Critical Confusion判定）と文字別統計（必須文字ルール）。
        # 旧クライアントからの送信では欠損=None（未検証として扱う。推測で補完しない）
        "confusions": evaluation.get("confusions") if isinstance(evaluation.get("confusions"), list) else None,
        "char_stats": evaluation.get("char_stats") if isinstance(evaluation.get("char_stats"), dict) else None,
    }
    # Evaluation Profile（比較可能性の判定条件）も同時に保存する
    profile = normalize_evaluation_profile(evaluation)
    with _EXPERIMENTS_LOCK:
        registry = _load_registry(paths.root)
        target = None
        for item in registry["items"]:
            if model_name in [str(m) for m in (item.get("models") or [])]:
                target = item  # 複数該当時は最後（最新）の実験を採用
        if target is None:
            return None
        target["evaluation"] = normalized
        target["evaluation_profile"] = profile
        _save_registry(paths.root, registry)
    # Validated自動遷移: CER計算成功＋Profile保存成功＋Evaluation Hash生成成功が揃った場合のみ
    # Draft→Validated へ進める（Candidate以降は自動変更しない。失敗しても評価保存は成功扱い）
    if isinstance(normalized.get("cer"), (int, float)) and compute_evaluation_hash(profile):
        try:
            from .release_manager import mark_validated_if_draft

            mark_validated_if_draft(paths.project_id, model_name)
        except Exception:  # noqa: BLE001
            pass
    return target
