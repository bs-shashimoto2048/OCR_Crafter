"""TrOCR Training Artifact Registration（Issue #96）。

**目的は新しいModel Metadata基盤を発明することではない。** 既存`.tess.json`/`.ocr.json`
sidecarパターン（`models/`直下のJSON1ファイル=1登録済みモデル、ファイルの存在自体が
「正式登録済み」の完了マーカー）を踏襲し、TrOCR専用の`.trocr.json`sidecarとして
最小実装する。

## 実装前調査の結論（既存Registry / Artifact Call Graph）

- `model_registry.py::list_models()`/`list_model_infos()`は`*.pt`/`*.ocr.json`/
  `*.tess.json`のみをglobする、拡張子がハードコードされた実装であり、
  `list_model_infos()`はTesseract/PaddleOCRそれぞれに200行超の専用フィールド
  構築ロジックを持つ（Engine別`elif`分岐）。ここへ`.trocr.json`用の第3分岐を
  追加することは技術的に可能だが、既存2エンジンの巨大な共有関数への変更となり
  回帰リスクが大きい
- TrOCRのInference経路（`predict.py::_predict_with_trocr()`）・Evaluation経路
  （`trocr_evaluation_predictor.py::TrOCREvaluationPredictor`）はいずれも
  `model_registry.py`のresolve系関数（`resolve_ocr_model_meta()`等）を一切
  使わない。呼び出し側が渡した`model`パラメータ（Hugging Face Hub ID・
  ローカルディレクトリパス）を`TrOCREngine.load()`へそのまま渡すだけの既存契約
  （Issue #18で確定、Investigation #88で再確認）
- したがって「登録済みモデルをInference/Evaluationへ安全に渡せる契約」は、
  artifact directoryのパス文字列をそのままmodel_refとして渡すだけで既に満たされる
  （save_pretrained()で書き出したディレクトリはfrom_pretrained()でそのまま
  読み込める、Hugging Face標準の対称性）。新しい解決層は不要

以上より、**本Issueでは`model_registry.py`の共有関数（`list_models()`/
`list_model_infos()`）への統合は行わない**（Tesseract/PaddleOCRへの回帰リスクを
避けるため）。TrOCR専用の`.trocr.json`sidecar・専用の一覧関数のみを新設する。
一般Modelsリスト（ModelsView等）への統合は、Training UI（Model Manager UI表示）を
扱う後続Issueへ境界として引き継ぐ（Future Work）。

## Registration Timing

登録はTraining Core（`trocr_training_core.py`）へ混入させず、呼び出し元
（`main.py::_run_trocr_training_job()`）がtraining成功を確認した後、
job完了確定前に呼ぶ。登録（sidecar書込）が失敗した場合、呼び出し元は
job成功を確定せず`failed`として扱う（既存`_run_tesseract_training_job()`の
「モデルメタ＝正式登録の完了マーカー。書込失敗時は不完全モデルを登録済みと
扱わない」という設計思想をそのまま踏襲）。

## Experiment Tracking

Investigation #88で確認した既存の非対称性（Tesseractは`experiment_tracker.
record_experiment()`を呼ぶが、PaddleOCRでは確認できない）を踏まえ、
Tesseract側の既存呼び出し（`tesseract_pipeline.py::register_tesseract_model()`）を
手本として再利用する。ただし**Tesseract自身の既存precedent通り、実験記録の失敗は
モデル登録（sidecar書込）自体の成功に影響させない**（try/exceptで囲み、失敗時は
警告ログのみ）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from ..project_paths import ensure_project_directories
from .atomic_io import atomic_write_json
from .dataset_registry import resolve_dataset_id_safe

logger = logging.getLogger(__name__)

# save_pretrained()が必ず書き出すファイル（Hugging Face標準）。存在しない場合は
# 不完全なartifactとみなし登録しない（Registration Timing参照）
_REQUIRED_ARTIFACT_FILES = ("config.json",)


class TrocrRegistrationError(ValueError):
    """TrOCR Model登録失敗（artifact不完全・重複識別子・metadata書込失敗等）。"""


@dataclass(frozen=True)
class TrocrModelRecord:
    """登録済みTrOCRモデル1件の最小契約。

    `model_dir`はそのまま`TrOCREngine.load()`/`TrOCREvaluationPredictor`の
    model_refとして使える（既存Inference/Evaluation契約。新しい解決層を追加しない）。
    """

    name: str
    engine: str
    model_dir: Path
    base_model_ref: str
    project_id: str
    job_id: str
    dataset_dir: str
    dataset_id: str
    epochs: int
    batch_size: int
    learning_rate: float
    final_loss: Optional[float]
    created_at: str


def _sidecar_name(job_id: str) -> str:
    return f"trocr_{job_id}.trocr.json"


def register_trocr_model(
    project_id: Optional[str],
    *,
    job_id: str,
    model_dir: str | Path,
    base_model_ref: str,
    dataset_dir: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    final_loss: Optional[float] = None,
) -> TrocrModelRecord:
    """成功したTrOCR Training Jobのartifact directoryを登録済みモデルとして記録する。

    呼び出し前提: training自体は既に成功している（failed/stopped/cancelled jobを
    渡さないのは呼び出し側=`_run_trocr_training_job()`の責務）。本関数はartifactの
    完全性（`config.json`の存在）と識別子の重複のみを検証する。

    - artifact directory不存在・不完全 → `TrocrRegistrationError`
    - 同一job_idで既に登録済み（sidecar重複） → `TrocrRegistrationError`
    - sidecar書込失敗 → `TrocrRegistrationError`
    """
    job_id = str(job_id or "").strip()
    if not job_id:
        raise TrocrRegistrationError("job_id is required for TrOCR model registration")

    resolved_dir = Path(model_dir).expanduser().resolve()
    if not resolved_dir.exists() or not resolved_dir.is_dir():
        raise TrocrRegistrationError(f"artifact directory not found: {resolved_dir}")
    missing = [name for name in _REQUIRED_ARTIFACT_FILES if not (resolved_dir / name).is_file()]
    if missing:
        raise TrocrRegistrationError(
            f"artifact directory is missing required file(s) {missing} (incomplete save_pretrained output): {resolved_dir}"
        )

    resolved_project_id = str(project_id or "default")
    paths = ensure_project_directories(resolved_project_id)
    name = _sidecar_name(job_id)
    sidecar_path = paths.models / name
    if sidecar_path.exists():
        raise TrocrRegistrationError(f"model already registered for job_id={job_id}: {name}")

    dataset_dir_str = str(dataset_dir or "")
    # Dataset Manager / Model Lineage向けのdataset_id（既存の安定採番をそのまま再利用。
    # 失敗してもモデル登録自体は継続する既存方針、tesseract_pipeline.py::register_tesseract_model()
    # と同じ理由でresolve_dataset_id_safe()を使う）
    dataset_id = resolve_dataset_id_safe(resolved_project_id, dataset_dir_str) if dataset_dir_str else ""

    created_at = datetime.now().isoformat()
    meta: dict[str, Any] = {
        "name": name,
        "engine": "trocr",
        "training_family": "ocr",
        "model_type": "ocr",
        "model_dir": str(resolved_dir),
        "base_model_ref": str(base_model_ref or ""),
        "project_id": resolved_project_id,
        "job_id": job_id,
        # 既存Tesseract sidecarと同じフィールド名（dataset_root）を採用し、将来
        # Dataset⇔Modelクロス参照（dataset_registry.py::_dataset_root_of_model()）へ
        # 接続する際に無改修で使えるようにする（現時点ではlist_model_infos()未統合のため
        # 実際のクロス参照UIには現れない。Future Work）
        "dataset_root": dataset_dir_str,
        "dataset_id": dataset_id,
        "epochs": int(epochs),
        "batch_size": int(batch_size),
        "learning_rate": float(learning_rate),
        "final_loss": float(final_loss) if final_loss is not None else None,
        "created_at": created_at,
    }
    try:
        atomic_write_json(sidecar_path, meta)
    except OSError as e:
        raise TrocrRegistrationError(f"failed to write model metadata: {sidecar_path}: {e}") from e

    _record_experiment_best_effort(resolved_project_id, meta)

    return TrocrModelRecord(
        name=name,
        engine="trocr",
        model_dir=resolved_dir,
        base_model_ref=meta["base_model_ref"],
        project_id=resolved_project_id,
        job_id=job_id,
        dataset_dir=dataset_dir_str,
        dataset_id=dataset_id,
        epochs=meta["epochs"],
        batch_size=meta["batch_size"],
        learning_rate=meta["learning_rate"],
        final_loss=meta["final_loss"],
        created_at=created_at,
    )


def _record_experiment_best_effort(project_id: str, meta: dict[str, Any]) -> None:
    """実験カルテ記録（EXP-0001形式）。失敗してもモデル登録自体は成功のまま扱う
    （`tesseract_pipeline.py::register_tesseract_model()`と同じ既存precedent）。
    """
    try:
        from .experiment_tracker import record_experiment

        record_experiment(
            project_id,
            {
                "models": [meta["name"]],
                "model_engine": "trocr",
                "source": "training",
                "dataset_id": meta.get("dataset_id") or "",
                # Tesseract/PaddleOCR側の既存「training」予約サブオブジェクトを再利用する。
                # TrOCRにはoptimizer(AdamW固定)・epochs・batch_size・learning_rateが実在するため
                # Noneで埋めず実測値を保存する（Tesseractはこれらの概念が無いためNone、
                # TrOCRは概念自体が存在する点で異なる。既存キー名は変更しない）
                "training": {
                    "optimizer": "AdamW",
                    "scheduler": None,
                    "epochs": meta.get("epochs"),
                    "batch_size": meta.get("batch_size"),
                    "learning_rate": meta.get("learning_rate"),
                    "loss": meta.get("final_loss"),
                },
            },
        )
    except Exception:  # noqa: BLE001
        logger.warning("trocr experiment recording failed for job_id=%s", meta.get("job_id"))


def list_trocr_models(project_id: Optional[str] = None) -> list[dict[str, Any]]:
    """登録済みTrOCRモデル一覧（`.trocr.json`sidecarをそのまま読み込むだけ）。

    `model_registry.py::list_models()`/`list_model_infos()`とは独立した専用関数
    （モジュールdocstring参照。一般Modelsリストへの統合はFuture Work）。
    """
    import json

    paths = ensure_project_directories(project_id)
    files = sorted(p for p in paths.models.glob("*.trocr.json") if p.is_file())
    result: list[dict[str, Any]] = []
    for path in files:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(payload, dict):
            result.append(payload)
    return result
