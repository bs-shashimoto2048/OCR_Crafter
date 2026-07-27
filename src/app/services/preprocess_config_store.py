"""「前処理設定保存」（学習に使用する確定済み前処理設定）の永続化。

プリセット（`services/preprocess.py` の `preprocess_presets.json`。よく使う設定を
再利用するためのテンプレート・複数保存可）とは役割が異なる別機能——
このプロジェクトで学習に使用する確定済み設定を1件（+履歴）だけ持つ。

設定構造・正規化・Hash生成は既存の `build_preprocess_config` /
`build_preprocess_snapshot` / `build_training_preprocess` / `compute_training_preprocess_hash`
（`services/preprocess_snapshot.py`）をそのまま再利用する。ここでは保存先の管理のみを担当し、
前処理設定そのものの構造・Hashロジックは複製しない。

保存先: project_root/preprocess/saved_config.json（現在の確定設定・即座に取得可能）
       project_root/preprocess/history/v{NNNN}.json（過去の保存履歴・上書きされない）
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .atomic_io import atomic_write_json

PREPROCESS_CONFIG_DIRNAME = "preprocess"
SAVED_CONFIG_FILENAME = "saved_config.json"
HISTORY_DIRNAME = "history"


def _preprocess_config_dir(project_root: Path) -> Path:
    return Path(project_root) / PREPROCESS_CONFIG_DIRNAME


def _saved_config_path(project_root: Path) -> Path:
    return _preprocess_config_dir(project_root) / SAVED_CONFIG_FILENAME


def _history_dir(project_root: Path) -> Path:
    return _preprocess_config_dir(project_root) / HISTORY_DIRNAME


def load_saved_preprocess_config(project_root: Path) -> Optional[dict[str, Any]]:
    """現在の確定済み学習用前処理設定。無い/壊れている場合は None（過去設定を推測しない）。"""
    path = _saved_config_path(project_root)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("training_preprocess"), dict):
        return None
    return payload


def list_preprocess_config_history(project_root: Path) -> list[dict[str, Any]]:
    """保存履歴一覧（version降順）。壊れたファイルはスキップする（初回実装では読み取り専用）。"""
    hist_dir = _history_dir(project_root)
    if not hist_dir.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for path in sorted(hist_dir.glob("v*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(payload, dict):
            items.append(payload)
    items.sort(key=lambda item: int(item.get("version") or 0), reverse=True)
    return items


def save_preprocess_config_version(
    project_root: Path, training_preprocess: dict[str, Any], config_hash: str
) -> dict[str, Any]:
    """現在の解決済み設定を新しい確定バージョンとして保存する。

    同じHashの設定を連続して保存した場合は、原則として新しい履歴を増やさず
    既存の確定設定をそのまま返す（`created=False`）。
    """
    existing = load_saved_preprocess_config(project_root)
    if existing and str(existing.get("config_hash") or "") == str(config_hash or ""):
        return {"created": False, "saved_config": existing}

    next_version = int(existing.get("version") or 0) + 1 if existing else 1
    payload = {
        "version": next_version,
        "saved_at": datetime.now().isoformat(),
        "config_hash": str(config_hash or ""),
        "training_preprocess": training_preprocess,
    }
    atomic_write_json(_saved_config_path(project_root), payload)
    atomic_write_json(_history_dir(project_root) / f"v{next_version:04d}.json", payload)
    return {"created": True, "saved_config": payload}
