"""OCR学習データセットの資産管理（Dataset Manager / Model Lineage）。

Datasetは一時生成物ではなく開発資産として扱う——「どの設定で作られ」「どのモデルに
使用され」「どの評価結果だったか」まで追跡できるようにする。

設計方針（既存ロジックを重複実装しない）:
- Dataset ID採番は `model_registry.py` の `assign_model_ids`（M0001形式・作成順・
  削除しても番号を再利用しない・file_lock＋atomic_write_json）と**同型のパターン**を
  再利用する（DS0001形式。データセットの実体＝タイムスタンプ付きフォルダ名は既存のまま
  変更しない。IDはフォルダ名から作成順に採番する表示用の安定識別子）。
- Dataset⇔Model の「使用モデル数・使用モデル一覧」は永続的な逆引きインデックスを
  持たず、`model_registry.list_model_infos()` を都度クロス参照して算出する（single
  source of truthはモデル側metadataの `dataset_id`。モデル削除時に別途リンク解除処理
  を書く必要がない＝取消し忘れによる不整合が起きない）。
- 前処理Version/Hash・分割計算・meta.json（Dataset Format）は一切変更しない
  （`services/preprocess_config_store.py` / `create_ocr_dataset` の出力を読むのみ）。
- ディレクトリ構成は既存のまま（`outputs/ocr_dataset/`・`outputs/ocr_dataset_from_logs/`）。
  コメント・表示名はDatasetの `meta.json` へ追加フィールドとして保存する（新規ファイル・
  新規ディレクトリ階層は作らない）。
"""

from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Optional

from .atomic_io import atomic_write_json, file_lock
from ..project_paths import ensure_project_directories, safe_rmtree
from .. import project_paths as project_paths_module

logger = logging.getLogger(__name__)

# 学習データセットの保存先（新規作成・OCRログからの再学習作成の両方が対象）。
# ocr_pipeline.py の find_latest_ocr_dataset と同一の探索範囲を共有する
OCR_DATASET_PARENT_DIRS = ("ocr_dataset", "ocr_dataset_from_logs")


def scan_ocr_dataset_folders(paths: Any) -> list[tuple[str, Path, dict[str, Any]]]:
    """`outputs/ocr_dataset*` 配下でmeta.jsonを持つ全フォルダを列挙する（読み取り専用）。

    戻り値: (parent_name, folder, meta) のリスト（順不同）。
    `find_latest_ocr_dataset`（最新1件）・`list_all_datasets`（全件一覧）の両方が
    この共通スキャンを使い、探索ロジックを重複実装しない。
    """
    found: list[tuple[str, Path, dict[str, Any]]] = []
    for parent_name in OCR_DATASET_PARENT_DIRS:
        parent = paths.outputs / parent_name
        if not parent.is_dir():
            continue
        for child in sorted(parent.iterdir()):
            if not child.is_dir():
                continue
            meta_path = child / "meta.json"
            if not meta_path.is_file():
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(meta, dict):
                found.append((parent_name, child, meta))
    return found


# ---------- Dataset ID採番（model_registry.assign_model_ids と同型のパターン） ----------

_DATASET_ID_LOCK = Lock()


def _dataset_id_file() -> Path:
    return Path(project_paths_module.PROJECTS_DIR).parent / "dataset_ids.json"


def _load_dataset_id_registry() -> dict[str, Any]:
    try:
        data = json.loads(_dataset_id_file().read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("datasets"), dict):
            return {"counter": int(data.get("counter") or 0), "datasets": dict(data["datasets"])}
    except (OSError, ValueError):
        pass
    return {"counter": 0, "datasets": {}}


def assign_dataset_ids(project_id: str, items: list[dict[str, Any]]) -> None:
    """データセット一覧へ管理No（`dataset_id`: DS0001形式）を付与する。

    - 既登録データセットは登録済みの番号を返す（番号は不変・削除後も再利用しない）
    - 未登録データセットは**作成日時順**で一括採番（既存データセットの初回移行も同じ経路）
    - 採番はプロセス内Lock＋ファイル永続化（`data/dataset_ids.json`）。保存失敗時も表示は継続する
    - `items` の各dictは `folder_name`（フォルダ名。キー）・`created_at` を持つこと
    """
    pid = str(project_id or "default")
    with _DATASET_ID_LOCK, file_lock(_dataset_id_file()):
        registry = _load_dataset_id_registry()
        datasets = registry["datasets"]
        missing = [item for item in items if f"{pid}/{item.get('folder_name')}" not in datasets]
        missing.sort(key=lambda item: (str(item.get("created_at") or ""), str(item.get("folder_name"))))
        changed = False
        for item in missing:
            registry["counter"] = int(registry["counter"]) + 1
            datasets[f"{pid}/{item.get('folder_name')}"] = f"DS{registry['counter']:04d}"
            changed = True
        if changed:
            try:
                atomic_write_json(_dataset_id_file(), registry)
            except OSError:
                logger.warning("dataset id registry save failed: %s", _dataset_id_file())
        for item in items:
            item["dataset_id"] = datasets.get(f"{pid}/{item.get('folder_name')}", "")


def resolve_dataset_id(project_id: Optional[str], dataset_root: str) -> str:
    """1件のデータセットに対して安定Dataset IDを解決する（未登録なら新規採番）。

    学習時のモデル登録（`register_tesseract_model` / `_register_ocr_model`）から、
    モデルmetadataへ `dataset_id` を記録するために呼ばれる。
    """
    root = Path(str(dataset_root or "")).expanduser()
    meta_path = root / "meta.json"
    created_at = ""
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(meta, dict):
                created_at = str(meta.get("created_at") or "")
        except (OSError, ValueError):
            created_at = ""
    item = {"folder_name": root.name, "created_at": created_at}
    assign_dataset_ids(str(project_id or "default"), [item])
    return str(item.get("dataset_id") or "")


def resolve_dataset_id_safe(project_id: Optional[str], dataset_root: str) -> str:
    """`resolve_dataset_id`の失敗（レジストリ書き込み不可等）でモデル登録自体を
    失敗させないための安全な呼び出し（学習完了直後の登録処理から使う）。"""
    try:
        return resolve_dataset_id(project_id, dataset_root)
    except OSError:
        logger.warning("dataset id resolution failed for %s", dataset_root)
        return ""


# ---------- Dataset⇔Model のクロス参照 ----------


def _dataset_root_of_model(model_info: dict[str, Any]) -> str:
    """モデルmetadataから、そのモデルが使用したデータセットのルートパスを取り出す
    （Tesseract=`dataset_root`、OCR=`ocr_dataset_root`。既存フィールドをそのまま使う）。"""
    return str(model_info.get("dataset_root") or model_info.get("ocr_dataset_root") or "")


def _linked_models_for_dataset(dataset_root: Path, model_infos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """このデータセットから作成されたモデル一覧（dataset_root一致で判定。永続の逆引き
    インデックスは持たず都度クロス参照する＝モデル削除時に別途リンク解除処理が不要）。"""
    resolved_target = str(dataset_root.resolve())
    linked = []
    for info in model_infos:
        candidate = _dataset_root_of_model(info)
        if not candidate:
            continue
        try:
            if str(Path(candidate).resolve()) == resolved_target:
                linked.append(info)
        except OSError:
            continue
    return linked


# ---------- 一覧・詳細 ----------


def _dataset_summary(project_id: str, parent_name: str, folder: Path, meta: dict[str, Any], model_infos: list[dict[str, Any]]) -> dict[str, Any]:
    counts = meta.get("counts") or {}
    linked_models = _linked_models_for_dataset(folder, model_infos)
    return {
        "dataset_id": "",  # assign_dataset_idsで一括付与する（呼び出し側で埋める）
        "folder_name": folder.name,
        "name": str(meta.get("display_name") or folder.name),
        "dataset_root": str(folder.resolve()),
        "source": "from_logs" if parent_name == "ocr_dataset_from_logs" else "new",
        "created_at": str(meta.get("created_at") or ""),
        "input_count": int(meta.get("input_count") or 0),
        "counts": {
            "train": int(counts.get("train", 0) or 0),
            "val": int(counts.get("val", 0) or 0),
            "test": int(counts.get("test", 0) or 0),
        },
        "charset": str(meta.get("charset") or ""),
        "seed": meta.get("seed"),
        "preprocess_config_version": meta.get("preprocess_config_version"),
        "training_preprocess_hash": meta.get("training_preprocess_hash"),
        "comment": str(meta.get("comment") or ""),
        "copied_from_dataset_folder": str(meta.get("copied_from_dataset_folder") or ""),
        "model_count": len(linked_models),
        "model_names": [str(info.get("name") or "") for info in linked_models],
    }


def list_all_datasets(project_id: Optional[str], model_infos: Optional[list[dict[str, Any]]] = None) -> list[dict[str, Any]]:
    """プロジェクト内の全学習データセットを一覧化する（Dataset Manager画面用）。

    `model_infos`（`model_registry.list_model_infos(project_id)`の結果）を渡すと
    そのままモデル数クロス参照に使う（呼び出し側で1回だけ取得すれば十分。渡されない
    場合はこの関数内で取得する）。既定の並び順は作成日時降順。
    """
    resolved = str(project_id or "default")
    paths = ensure_project_directories(resolved)
    if model_infos is None:
        from .model_registry import list_model_infos

        model_infos = list_model_infos(resolved)

    found = scan_ocr_dataset_folders(paths)
    items = [_dataset_summary(resolved, parent_name, folder, meta, model_infos) for parent_name, folder, meta in found]
    assign_dataset_ids(resolved, items)
    items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return items


def find_dataset_folder_by_id(project_id: Optional[str], dataset_id: str) -> Optional[tuple[str, Path, dict[str, Any]]]:
    """Dataset ID（DS0001形式）からフォルダを解決する（読み取り専用）。"""
    resolved = str(project_id or "default")
    paths = ensure_project_directories(resolved)
    found = scan_ocr_dataset_folders(paths)
    for parent_name, folder, meta in found:
        item = {"folder_name": folder.name, "created_at": str(meta.get("created_at") or "")}
        assign_dataset_ids(resolved, [item])
        if item.get("dataset_id") == dataset_id:
            return parent_name, folder, meta
    return None


def get_dataset_detail(project_id: Optional[str], dataset_id: str) -> Optional[dict[str, Any]]:
    """Dataset詳細（基本情報・前処理・学習設定・使用モデル一覧）。"""
    resolved = str(project_id or "default")
    found = find_dataset_folder_by_id(resolved, dataset_id)
    if found is None:
        return None
    parent_name, folder, meta = found

    from .model_registry import list_model_infos

    model_infos = list_model_infos(resolved)
    linked_models = _linked_models_for_dataset(folder, model_infos)

    counts = meta.get("counts") or {}
    skipped = meta.get("skipped") or {}
    augmentation = meta.get("augmentation") if isinstance(meta.get("augmentation"), dict) else None
    excluded_count = sum(int(v or 0) for v in skipped.values()) if isinstance(skipped, dict) else 0

    return {
        "dataset_id": dataset_id,
        "folder_name": folder.name,
        "name": str(meta.get("display_name") or folder.name),
        "dataset_root": str(folder.resolve()),
        "source": "from_logs" if parent_name == "ocr_dataset_from_logs" else "new",
        "created_at": str(meta.get("created_at") or ""),
        "comment": str(meta.get("comment") or ""),
        "copied_from_dataset_folder": str(meta.get("copied_from_dataset_folder") or ""),
        "preprocess": {
            "version": meta.get("preprocess_config_version"),
            "saved_at": meta.get("preprocess_config_saved_at"),
            "hash": meta.get("training_preprocess_hash"),
        },
        "training_settings": {
            "train_ratio": meta.get("train_ratio"),
            "val_ratio": meta.get("val_ratio"),
            "test_ratio": meta.get("test_ratio"),
            "charset": str(meta.get("charset") or ""),
            # Rotation: データセット単位の回転設定は無いため、オーグメンテーションの
            # 回転設定（有効時のみ最大角度を記録）を代わりに表示する（推測補完しない）
            "rotation": (
                {"enabled": True, "max_degrees": (augmentation.get("rotation") or {}).get("max_degrees")}
                if augmentation and (augmentation.get("rotation") or {}).get("enabled")
                else {"enabled": False, "max_degrees": None}
            ),
            "input_count": int(meta.get("input_count") or 0),
            "excluded_count": excluded_count,
        },
        "counts": {
            "train": int(counts.get("train", 0) or 0),
            "val": int(counts.get("val", 0) or 0),
            "test": int(counts.get("test", 0) or 0),
        },
        "models": [
            {"name": str(info.get("name") or ""), "model_id": str(info.get("model_id") or "")} for info in linked_models
        ],
        # v1.0.0で追加（Experiment Manager強化）: このDatasetを使用したExperiment一覧
        # （既存のexperiment_tracker.list_experiments_for_datasetをそのまま再利用。
        # Dataset⇔Experimentの逆引きインデックスは持たず、experiment側のdataset_idで
        # 都度フィルタする＝Dataset⇔Modelと同じ設計方針を踏襲）
        "experiments": _linked_experiments_for_dataset(resolved, dataset_id),
    }


def _linked_experiments_for_dataset(project_id: str, dataset_id: str) -> list[dict[str, Any]]:
    from .experiment_tracker import list_experiments_for_dataset

    try:
        items = list_experiments_for_dataset(project_id, dataset_id)
    except Exception:  # noqa: BLE001
        return []
    return [
        {
            "experiment_id": str(item.get("experiment_id") or ""),
            "created_at": str(item.get("created_at") or ""),
            "models": [str(m) for m in (item.get("models") or [])],
        }
        for item in items
    ]


def set_dataset_comment(project_id: Optional[str], dataset_id: str, comment: str) -> Optional[dict[str, Any]]:
    """Datasetへコメントを保存する（meta.jsonへ追加フィールドとして書き込む。複数行対応）。"""
    resolved = str(project_id or "default")
    found = find_dataset_folder_by_id(resolved, dataset_id)
    if found is None:
        return None
    _parent_name, folder, meta = found
    meta = dict(meta)
    meta["comment"] = str(comment or "")
    atomic_write_json(folder / "meta.json", meta)
    return get_dataset_detail(resolved, dataset_id)


def check_dataset_delete_impact(project_id: Optional[str], dataset_id: str) -> Optional[dict[str, Any]]:
    """Dataset削除前の影響確認（使用モデル数・モデル名一覧）。"""
    detail = get_dataset_detail(project_id, dataset_id)
    if detail is None:
        return None
    return {"model_count": len(detail["models"]), "model_names": [m["name"] for m in detail["models"]]}


def delete_dataset(project_id: Optional[str], dataset_id: str) -> bool:
    """Datasetを削除する（既存のsafe_rmtreeガードを再利用。models配下は一切触らない
    ＝Model側のリンクはmodel_infoのdataset_root参照が単に無効になるだけで、モデル自体は
    削除されない。呼び出し側[API]で使用モデル数の警告確認を済ませてから呼ぶこと）。"""
    resolved = str(project_id or "default")
    found = find_dataset_folder_by_id(resolved, dataset_id)
    if found is None:
        return False
    _parent_name, folder, _meta = found
    paths = ensure_project_directories(resolved)
    safe_rmtree(folder, [paths.outputs], label="dataset_manager delete")
    return True


def copy_dataset(project_id: Optional[str], dataset_id: str) -> Optional[dict[str, Any]]:
    """Datasetを複製する（実体ファイルをコピーし、metadataも複製。Dataset IDのみ新規発行）。"""
    resolved = str(project_id or "default")
    found = find_dataset_folder_by_id(resolved, dataset_id)
    if found is None:
        return None
    parent_name, folder, meta = found

    parent_dir = folder.parent
    base_name = str(meta.get("display_name") or folder.name)
    new_folder_name = f"{folder.name}_copy_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    new_folder = parent_dir / new_folder_name
    shutil.copytree(folder, new_folder)

    new_meta = dict(meta)
    new_meta["display_name"] = f"{base_name}_Copy"
    new_meta["created_at"] = datetime.now().isoformat()
    new_meta["copied_from_dataset_folder"] = folder.name
    atomic_write_json(new_folder / "meta.json", new_meta)

    new_item = {"folder_name": new_folder.name, "created_at": new_meta["created_at"]}
    assign_dataset_ids(resolved, [new_item])
    return get_dataset_detail(resolved, str(new_item.get("dataset_id") or ""))
