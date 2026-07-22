"""前処理スナップショット（学習・評価・推論の前処理再現性）共通サービス。

取込時前処理（services/preprocess.py のパイプライン）の「実効パラメータ」を
構造化JSONとして保存し、以下の経路で引き継ぐ:

    /preprocess/run 実行
      → data/projects/<id>/processed/meta/preprocess_snapshot.json（正: 最終実行時点の設定）
      → OCRデータセット meta.json の training_preprocess（作成時点のスナップショットを確定保存）
      → 学習モデル .tess.json / .ocr.json
      → /models/info → モデル管理・モデル比較・評価・推論

役割（学習・評価・推論で共通実装を使い、前処理定義を複製しない）:
  - スナップショット構築（工程順序・有効/無効・実効パラメータ・OCR入力整形）
  - 前処理ハッシュ生成（作成日時・表示名・一時パスを除外した正規化JSONのsha256）
  - スナップショットの再適用（評価・推論で学習時前処理を再現。preprocess.py の
    _run_pipeline / _process_image を共用し、処理系を複製しない）

注意:
  - 手動マスクは画像単位の補正のため、スナップショットには enabled/fill/timing のみ
    記録し、マスク座標は含めない（再適用時は no-op。既知の制約）。
  - processed/ 画像は既にスナップショット適用済みのため、データセット作成では
    再適用しない（二重前処理防止）。適用状態は dataset meta の source_image_state で区別する。
"""

import copy
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from PIL import Image

PREPROCESS_SNAPSHOT_SCHEMA_VERSION = 1
PREPROCESS_PIPELINE_VERSION = "preprocess-v1"
PREPROCESS_SNAPSHOT_FILENAME = "preprocess_snapshot.json"

# OCR入力整形（ocr_pipeline.preprocess_ocr_image, strong=False）の固定仕様。
# ここを変更する場合は preprocess_ocr_image 本体と必ず同期すること
OCR_INPUT_NORMALIZATION_BASE: dict[str, Any] = {
    "grayscale": True,
    "autocontrast_cutoff": 1,
    "contrast_factor": 1.08,
    "alignment": "center",
    "background": "white",
}

# enabled キーを持たず、パイプラインに含まれていれば常に実行される工程
_ALWAYS_ON_OPS = {"grayscale", "threshold", "denoise", "pad", "resize", "clahe"}

# 工程名 → operations 設定キー（manual_mask_pre/post は同一設定 manual_mask を参照）
_OP_CONFIG_KEYS = {
    "manual_mask_pre": "manual_mask",
    "manual_mask_post": "manual_mask",
}


def ocr_input_normalization_for_shape(image_shape: Optional[list[int]]) -> dict[str, Any]:
    """image_shape([C,H,W])からOCR入力整形の実効パラメータを組み立てる。"""
    shape = list(image_shape or [3, 48, 320])
    return {
        **OCR_INPUT_NORMALIZATION_BASE,
        "channels": int(shape[0]) if len(shape) == 3 else 3,
        "target_height": int(shape[1]) if len(shape) == 3 else 48,
        "canvas_width": int(shape[2]) if len(shape) == 3 else 320,
    }


def _step_params(op_name: str, operations: dict[str, Any]) -> dict[str, Any]:
    """工程の実効パラメータ（enabled・画像単位のマスク座標は除外）。"""
    cfg_key = _OP_CONFIG_KEYS.get(op_name, op_name)
    cfg = operations.get(cfg_key)
    if not isinstance(cfg, dict):
        return {}
    params = {k: v for k, v in cfg.items() if k not in {"enabled", "masks"}}
    return copy.deepcopy(params)


def _step_enabled(op_name: str, operations: dict[str, Any]) -> bool:
    if op_name in {"manual_mask_pre", "manual_mask_post"}:
        cfg = operations.get("manual_mask", {})
        if not isinstance(cfg, dict) or not bool(cfg.get("enabled", False)):
            return False
        timing = str(cfg.get("timing", "post"))
        return timing == ("pre" if op_name == "manual_mask_pre" else "post")
    cfg = operations.get(op_name)
    if not isinstance(cfg, dict):
        return op_name in _ALWAYS_ON_OPS
    if "enabled" in cfg:
        return bool(cfg.get("enabled"))
    return True


def build_pipeline_steps(pipeline: list[str], operations: dict[str, Any]) -> list[dict[str, Any]]:
    """パイプライン順の工程一覧（name / enabled / 実効params）を組み立てる。"""
    return [
        {
            "name": str(op_name),
            "enabled": _step_enabled(str(op_name), operations),
            "params": _step_params(str(op_name), operations),
        }
        for op_name in pipeline
    ]


def _strip_manual_masks(operations: dict[str, Any]) -> dict[str, Any]:
    """再適用用の operations 設定（画像単位のマスク座標は含めない）。"""
    out = copy.deepcopy(operations)
    manual = out.get("manual_mask")
    if isinstance(manual, dict):
        manual["masks"] = []
    return out


def build_preprocess_snapshot(cfg: dict[str, Any], source: str = "project_preprocess") -> dict[str, Any]:
    """前処理設定（_build_preprocess_config の結果）からスナップショットを構築する。

    保存対象: 工程の有効/無効・実効パラメータ・実行順序・実行日時・設定バージョン・
    前処理実装バージョン。工程名だけの記録（パラメータなし）は不可（タスク仕様）。
    """
    pipelines = cfg.get("pipelines", {}) if isinstance(cfg.get("pipelines"), dict) else {}
    operations = cfg.get("operations", {}) if isinstance(cfg.get("operations"), dict) else {}
    steps = {
        image_type: build_pipeline_steps(list(pipeline or []), operations)
        for image_type, pipeline in pipelines.items()
    }
    now = datetime.now()
    snapshot = {
        "schema_version": PREPROCESS_SNAPSHOT_SCHEMA_VERSION,
        "pipeline_version": PREPROCESS_PIPELINE_VERSION,
        "snapshot_id": f"prep_{now.strftime('%Y%m%d_%H%M%S')}",
        "created_at": now.isoformat(),
        "source": str(source),
        "ratio_threshold": float(cfg.get("ratio_threshold", 1.6) or 1.6),
        "pipelines": {k: [str(x) for x in (v or [])] for k, v in pipelines.items()},
        "steps": steps,
        # 再適用用の実効 operations 設定（マスク座標除外）。steps と冗長だが、
        # preprocess.py の既存処理系（_run_pipeline）で無変換に再適用するために保持する
        "operations": _strip_manual_masks(operations),
    }
    snapshot["preprocess_hash"] = compute_preprocess_hash(steps, OCR_INPUT_NORMALIZATION_BASE)
    return snapshot


def compute_preprocess_hash(steps: dict[str, Any], ocr_input_normalization: Optional[dict[str, Any]]) -> str:
    """正規化済み設定JSONから前処理ハッシュ（sha256:...）を生成する。

    ハッシュ対象: 工程順序・有効/無効・実効パラメータ・OCR入力整形。
    除外対象: 作成日時・スナップショットID・表示名・一時パス・channels
    （channels はエンジン入力形式の違いで、画像内容には影響しないため
    学習[3,H,W]と評価[1,H,W]を同一前処理として判定できるように除外する）。
    """
    normalization = dict(ocr_input_normalization or {})
    normalization.pop("channels", None)
    payload = {"steps": steps or {}, "ocr_input_normalization": normalization}
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def snapshot_file_path(project_root: Path) -> Path:
    """プロジェクトの正スナップショット保存先（processed/meta/preprocess_snapshot.json）。"""
    return Path(project_root) / "processed" / "meta" / PREPROCESS_SNAPSHOT_FILENAME


def save_preprocess_snapshot(project_root: Path, cfg: dict[str, Any]) -> dict[str, Any]:
    """/preprocess/run 実行時のスナップショット保存。最終実行時点の設定を正とする。"""
    snapshot = build_preprocess_snapshot(cfg)
    path = snapshot_file_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    return snapshot


def load_preprocess_snapshot(project_root: Path) -> Optional[dict[str, Any]]:
    """保存済みスナップショットの読込。存在しない/読めない場合は None（推測補完しない）。"""
    path = snapshot_file_path(project_root)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and payload.get("steps"):
            return payload
    except (OSError, ValueError):
        return None
    return None


def build_training_preprocess(
    snapshot: Optional[dict[str, Any]],
    image_types: list[str],
    image_shape: Optional[list[int]],
) -> Optional[dict[str, Any]]:
    """データセット作成時に確定保存する学習時前処理レコードを構築する。

    スナップショット未保存（旧プロジェクト等）の場合は None を返し、推測で補完しない。
    """
    if not isinstance(snapshot, dict):
        return None
    return {
        "source": "processed_snapshot",
        "snapshot_id": str(snapshot.get("snapshot_id") or ""),
        "schema_version": int(snapshot.get("schema_version") or PREPROCESS_SNAPSHOT_SCHEMA_VERSION),
        "pipeline_version": str(snapshot.get("pipeline_version") or PREPROCESS_PIPELINE_VERSION),
        "created_at": str(snapshot.get("created_at") or ""),
        "image_types": [str(x) for x in (image_types or [])],
        "ratio_threshold": float(snapshot.get("ratio_threshold", 1.6) or 1.6),
        "pipelines": snapshot.get("pipelines") if isinstance(snapshot.get("pipelines"), dict) else {},
        "steps": snapshot.get("steps") if isinstance(snapshot.get("steps"), dict) else {},
        "operations": snapshot.get("operations") if isinstance(snapshot.get("operations"), dict) else {},
        "ocr_input_normalization": ocr_input_normalization_for_shape(image_shape),
    }


def compute_training_preprocess_hash(training_preprocess: Optional[dict[str, Any]]) -> Optional[str]:
    """学習時前処理レコードのハッシュ。未記録（None）は None。"""
    if not isinstance(training_preprocess, dict):
        return None
    steps = training_preprocess.get("steps")
    normalization = training_preprocess.get("ocr_input_normalization")
    if not isinstance(steps, dict):
        return None
    return compute_preprocess_hash(steps, normalization if isinstance(normalization, dict) else None)


def training_preprocess_to_config(training_preprocess: dict[str, Any]) -> dict[str, Any]:
    """学習時前処理レコード→preprocess.py の処理系（_process_image）用設定へ復元する。"""
    return {
        "ratio_threshold": float(training_preprocess.get("ratio_threshold", 1.6) or 1.6),
        "pipelines": copy.deepcopy(training_preprocess.get("pipelines") or {}),
        "operations": copy.deepcopy(training_preprocess.get("operations") or {}),
    }


def apply_training_preprocess(img: Image.Image, training_preprocess: dict[str, Any]) -> Image.Image:
    """学習時前処理（取込パイプライン相当）を画像へ再適用する。

    既存の preprocess.py 処理系を共用する（前処理定義を複製しない）。
    学習対象が単一の画像種別（例: wide のみ）の場合はその種別のパイプラインを強制し、
    複数種別の場合は取込時と同じ比率判定で種別を決める。
    OCR入力整形（preprocess_ocr_image）はここでは適用しない（呼び出し側で共通適用する）。
    Augmentation は評価・推論へ適用しない（この関数に含まれない）。
    """
    from .preprocess import _process_image, _run_pipeline

    cfg = training_preprocess_to_config(training_preprocess)
    pipelines = cfg.get("pipelines", {})
    image_types = [str(x) for x in (training_preprocess.get("image_types") or []) if str(x) in pipelines]
    if len(image_types) == 1:
        forced = image_types[0]
        pipeline = list(pipelines.get(forced) or [])
        if not pipeline:
            raise ValueError(f"学習時前処理のパイプラインが空です: {forced}")
        _, processed = _run_pipeline(img, forced, pipeline, cfg.get("operations", {}))
    else:
        _, _, processed, _, _ = _process_image(img, cfg)
    return Image.fromarray(processed, mode="L")


def source_state_of_path(path: Path, project_root: Path) -> str:
    """学習ソース画像の由来（processed / interim / raw / external）を判定する。"""
    try:
        rel = Path(path).resolve().relative_to(Path(project_root).resolve())
    except (OSError, ValueError):
        return "external"
    top = rel.parts[0] if rel.parts else ""
    if top in {"processed", "interim", "raw"}:
        return top
    return "external"


def summarize_source_states(states: list[str]) -> dict[str, Any]:
    """由来の集計と全体状態（processed / mixed / raw 等）。混在時は警告文を返す。"""
    counts: dict[str, int] = {}
    for state in states:
        counts[state] = counts.get(state, 0) + 1
    unique = sorted(counts.keys())
    overall = unique[0] if len(unique) == 1 else ("mixed" if unique else "unknown")
    warning = ""
    if overall == "mixed" or (unique and unique != ["processed"]):
        non_processed = sum(v for k, v in counts.items() if k != "processed")
        if counts.get("processed") and non_processed:
            warning = (
                f"一部画像（{non_processed}枚）がprocessedではなく他の場所（interim/raw）から取得されています。"
                "学習入力条件が統一されていない可能性があります。"
            )
    return {"overall": overall, "counts": counts, "warning": warning}
