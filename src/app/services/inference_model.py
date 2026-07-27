"""推論使用モデルの永続化（プロジェクト単位）。

画面遷移・ブラウザ再読み込み・アプリ再起動・プロジェクトの開き直しをまたいで
推論使用モデルの選択状態を維持するための最小限の永続化。

既存のプロジェクト設定管理方式を調査したが、`preprocess_config.json`（project_root直下へ
小さなJSONファイルを1つ置く方式）以外に汎用のプロジェクト設定ストアは存在しなかった。
新しい保存機構を増やさず、この既存方式（project_root直下のフラットJSONファイル）を
踏襲して `inference_model.json` を追加する。
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .atomic_io import atomic_write_json

INFERENCE_MODEL_FILENAME = "inference_model.json"


def _inference_model_path(project_root: Path) -> Path:
    return Path(project_root) / INFERENCE_MODEL_FILENAME


def load_inference_model(project_root: Path) -> Optional[dict[str, Any]]:
    """保存済みの推論使用モデル選択。無い/壊れている場合は None（推測補完しない）。"""
    path = _inference_model_path(project_root)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict) or not str(payload.get("model") or "").strip():
        return None
    return payload


def save_inference_model(project_root: Path, engine: str, model: str, model_id: str = "") -> dict[str, Any]:
    """推論使用モデルの選択をプロジェクト単位で保存する（利用者が選択した時点で即時保存）。"""
    payload = {
        "engine": str(engine or "").strip(),
        "model": str(model or "").strip(),
        "inference_model_id": str(model_id or "").strip(),
        "updated_at": datetime.now().isoformat(),
    }
    atomic_write_json(_inference_model_path(project_root), payload)
    return payload


def clear_inference_model(project_root: Path) -> None:
    """推論使用モデルの選択をクリアする（対象モデルが削除された場合）。"""
    path = _inference_model_path(project_root)
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
