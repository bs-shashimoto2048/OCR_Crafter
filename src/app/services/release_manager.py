"""モデルリリース管理（Model Release Management）サービス。

モデルのライフサイクル（Draft→Validated→Candidate→Production→Archived）を管理し、
安全な配布・本番適用を実現する。

- ステータス: Draft（学習直後・既定）/ Validated（評価完了）/ Candidate（本番候補）/
  Production（現在使用中・**1プロジェクトに必ず1モデルだけ**）/ Archived（旧モデル）
- Production昇格時は Release Note 必須・旧Productionは自動で Archived へ
- バージョン: Candidateまでは 0.x（Candidate昇格時に自動採番）、Productionで 1.0.0 / 1.1.0 / …
  （自動=マイナー加算。明示指定も可能。SemVer厳密準拠ではない）
- リリース履歴: Version / Model / Release Date / Author / Reason / Rollback を追記型で保存
- Rollback: 過去のリリースVersionのモデルを再びProductionへ（新しい履歴エントリ・rollback=true）
- Model Card: Productionモデルのカルテ（Markdown）をモデルメタ・実験・評価・履歴から自動生成
- Deployment Package: Productionモデルの traineddata / 設定JSON(.tess.json) / 前処理Snapshot /
  Release Note / Model Card をZIPへまとめてExport（ONNX等の推論成果物はTesseractには存在しない
  ため、モデルディレクトリに実在する場合のみ追加する）

保存先: data/projects/<id>/releases.json
"""

import io
import json
import zipfile
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Optional

from ..project_paths import ensure_project_directories

RELEASES_FILENAME = "releases.json"
_RELEASES_LOCK = Lock()

# releases.json のスキーマバージョン（Migration Version）。
# v2: Release ID（REL-0001形式）の導入・release_counter追加・既存履歴へのバックフィル
RELEASES_SCHEMA_VERSION = 2

MODEL_STATUSES = ["Draft", "Validated", "Candidate", "Production", "Archived"]
# 手動設定できるステータス（ProductionはpromoteのみでArchived化も自動）
SETTABLE_STATUSES = ["Draft", "Validated", "Candidate", "Archived"]


def _releases_path(project_root: Path) -> Path:
    return Path(project_root) / RELEASES_FILENAME


def migrate_releases_registry(registry: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """releases.json の明示的Migration。戻り値=(registry, 変更あり)。

    v1→v2: 既存の履歴エントリへ Release ID（REL-0001形式・古い順）を安全にバックフィルし、
    release_counter と schema_version を付与する。既存フィールドは変更しない。
    """
    changed = False
    version = int(registry.get("schema_version") or 1)
    if version < 2:
        counter = 0
        for entry in registry["history"]:  # 追記順=古い順
            counter += 1
            if not entry.get("release_id"):
                entry["release_id"] = f"REL-{counter:04d}"
                changed = True
        registry["release_counter"] = max(int(registry.get("release_counter") or 0), counter)
        registry["schema_version"] = RELEASES_SCHEMA_VERSION
        changed = True
    return registry, changed


def _load(project_root: Path) -> dict[str, Any]:
    try:
        payload = json.loads(_releases_path(project_root).read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            registry = {
                "schema_version": int(payload.get("schema_version") or 1),
                "models": payload.get("models") if isinstance(payload.get("models"), dict) else {},
                "history": payload.get("history") if isinstance(payload.get("history"), list) else [],
                "candidate_counter": int(payload.get("candidate_counter") or 0),
                "release_counter": int(payload.get("release_counter") or 0),
                "policy": payload.get("policy") if isinstance(payload.get("policy"), dict) else {},
            }
            registry, _ = migrate_releases_registry(registry)
            return registry
    except (OSError, ValueError):
        pass
    return {
        "schema_version": RELEASES_SCHEMA_VERSION,
        "models": {},
        "history": [],
        "candidate_counter": 0,
        "release_counter": 0,
        "policy": {},
    }


def _save(project_root: Path, registry: dict[str, Any]) -> None:
    from .atomic_io import atomic_write_json

    # 原子的リネーム書き込み（途中失敗で releases.json が破損しない）
    atomic_write_json(_releases_path(project_root), registry)


def _model_record(registry: dict[str, Any], model: str) -> dict[str, Any]:
    record = registry["models"].get(model)
    if not isinstance(record, dict):
        record = {"status": "Draft", "version": "", "updated_at": ""}
        registry["models"][model] = record
    return record


def _production_model(registry: dict[str, Any]) -> str:
    for model, record in registry["models"].items():
        if record.get("status") == "Production":
            return model
    return ""


def _latest_production_version(registry: dict[str, Any]) -> str:
    for entry in reversed(registry["history"]):
        if entry.get("version"):
            return str(entry["version"])
    return ""


def next_production_version(current: str) -> str:
    """次のProductionバージョン（自動=マイナー加算。初回は 1.0.0）。"""
    text = str(current or "").lstrip("v")
    parts = text.split(".")
    try:
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
    except (ValueError, IndexError):
        return "1.0.0"
    if major < 1:
        return "1.0.0"
    return f"{major}.{minor + 1}.0"


def list_releases(project_id: Optional[str]) -> dict[str, Any]:
    """リリース状況（モデル別ステータス・現Production・リリース履歴）。

    releases.json に無いモデルは既定 Draft（学習直後）として返す。
    """
    paths = ensure_project_directories(project_id)
    registry = _load(paths.root)
    statuses: dict[str, Any] = {}
    for meta_path in sorted(paths.models.glob("*.tess.json")) + sorted(paths.models.glob("*.ocr.json")):
        record = registry["models"].get(meta_path.name)
        statuses[meta_path.name] = {
            "status": str(record.get("status") or "Draft") if isinstance(record, dict) else "Draft",
            "version": str(record.get("version") or "") if isinstance(record, dict) else "",
            "updated_at": str(record.get("updated_at") or "") if isinstance(record, dict) else "",
        }
    # 実体が削除されたモデルの記録も返す（履歴の整合表示用）
    for model, record in registry["models"].items():
        if model not in statuses and isinstance(record, dict):
            statuses[model] = {
                "status": str(record.get("status") or "Draft"),
                "version": str(record.get("version") or ""),
                "updated_at": str(record.get("updated_at") or ""),
                "missing": True,
            }
    # 起動後最初の参照でMigration結果（Release IDバックフィル等）を永続化する
    with _RELEASES_LOCK:
        raw = None
        try:
            raw = json.loads(_releases_path(paths.root).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = None
        if isinstance(raw, dict) and int(raw.get("schema_version") or 1) < RELEASES_SCHEMA_VERSION:
            _save(paths.root, registry)
    return {
        "production": _production_model(registry),  # Productionは0件（空文字）または1件
        "statuses": statuses,
        "history": list(reversed(registry["history"])),  # 新しい順
    }


def set_model_status(project_id: Optional[str], model: str, status: str) -> dict[str, Any]:
    """手動ステータス変更（Draft / Validated / Candidate / Archived）。

    Productionへの変更は promote_model のみ（Release Note必須・一意性保証のため）。
    Candidateへ初めて変更したとき 0.x バージョンを自動採番する。
    """
    if status not in SETTABLE_STATUSES:
        raise ValueError(f"status must be one of {SETTABLE_STATUSES} (Production is set via promote)")
    from .atomic_io import file_lock

    paths = ensure_project_directories(project_id)
    model_name = Path(str(model)).name
    with _RELEASES_LOCK, file_lock(_releases_path(paths.root)):
        registry = _load(paths.root)
        record = _model_record(registry, model_name)
        if record.get("status") == "Production":
            raise ValueError("Productionモデルのステータスは直接変更できません（新しいProductionへの昇格で自動Archivedになります）")
        record["status"] = status
        # Version規則: 初回Candidateで 0.x を採番。既にVersionを持つ場合は維持する
        # （Candidate解除→再設定でVersionを変えない。§Version規則の明文化）
        if status == "Candidate" and not str(record.get("version") or ""):
            registry["candidate_counter"] = int(registry["candidate_counter"]) + 1
            record["version"] = f"0.{registry['candidate_counter']}"
        record["updated_at"] = datetime.now().isoformat()
        _save(paths.root, registry)
        return {"model": model_name, **record}


def promote_model(
    project_id: Optional[str],
    model: str,
    note: str,
    author: str = "",
    version: Optional[str] = None,
    rollback: bool = False,
    rollback_from: str = "",
    override_reason: str = "",
    approved_by: str = "",
) -> dict[str, Any]:
    """Productionへ昇格する。Release Note必須・旧Productionは自動Archived・履歴へ追記。

    - versionは未指定なら直近Productionバージョンのマイナー加算（初回 1.0.0=正式版）
    - Release Gate判定がFAILのモデルは、例外承認（override_reason + approved_by）なしでは
      昇格できない。承認時はFailed Rulesのスナップショットを履歴へ保存する
    - 履歴エントリへは Release ID（REL-0001形式）を採番する（Versionとは別概念:
      Versionは配布成果物の版・Release IDはリリース行為の識別子）
    """
    note_text = str(note or "").strip()
    if not note_text:
        raise ValueError("Release Note は必須です（変更点・理由を記入してください）")
    paths = ensure_project_directories(project_id)
    model_name = Path(str(model)).name
    if not (paths.models / model_name).is_file():
        raise FileNotFoundError(f"model not found: {model_name}")

    # Release Gate判定（FAILは承認なしで昇格不可。Rollbackは過去に承認済みリリースのため対象外）
    override: Optional[dict[str, Any]] = None
    if not rollback:
        from .release_gate import evaluate_release_gate

        gate = evaluate_release_gate(paths.project_id, model_name)
        if gate["verdict"] == "FAIL":
            reason_text = str(override_reason or "").strip()
            approver = str(approved_by or "").strip()
            if not reason_text or not approver:
                failed_rules = [r["rule"] for r in gate["rules"] if r.get("result") == "fail"]
                raise ValueError(
                    "Release Gate判定がFAILのため昇格できません（不合格ルール: "
                    + ", ".join(failed_rules)
                    + "）。昇格するには例外承認（Override Reason と Approved By）が必要です。"
                )
            override = {
                "reason": reason_text,
                "approved_by": approver,
                "approved_at": datetime.now().isoformat(),
                # 承認時点の不合格ルールのスナップショット（後から検証条件が変わっても追跡できる）
                "failed_rules": [r for r in gate["rules"] if r.get("result") == "fail"],
            }

    from .atomic_io import file_lock

    with _RELEASES_LOCK, file_lock(_releases_path(paths.root)):
        registry = _load(paths.root)
        previous = _production_model(registry)
        if previous and previous != model_name:
            registry["models"][previous]["status"] = "Archived"
            registry["models"][previous]["updated_at"] = datetime.now().isoformat()
        record = _model_record(registry, model_name)
        resolved_version = str(version or "").strip() or next_production_version(_latest_production_version(registry))
        record["status"] = "Production"
        record["version"] = resolved_version
        record["updated_at"] = datetime.now().isoformat()
        registry["release_counter"] = int(registry.get("release_counter") or 0) + 1
        entry = {
            "release_id": f"REL-{registry['release_counter']:04d}",
            "version": resolved_version,
            "model": model_name,
            "released_at": datetime.now().isoformat(),
            "author": str(author or ""),
            "note": note_text,
            "rollback": bool(rollback),
            "rollback_from": str(rollback_from or ""),
            "previous_production": previous,
            "override": override,
        }
        registry["history"].append(entry)
        _save(paths.root, registry)
        return {"model": model_name, "version": resolved_version, "previous_production": previous, "entry": entry}


def rollback_release(project_id: Optional[str], version: str, author: str = "", note: str = "") -> dict[str, Any]:
    """過去のリリースVersionのモデルを再びProductionへ戻す。

    Version規則: Rollbackは**対象VersionをそのままVersionとして維持**し、
    新しい履歴エントリ（新Release ID・rollback=true・rollback_from）を追加する。
    """
    paths = ensure_project_directories(project_id)
    registry = _load(paths.root)
    target = None
    for entry in reversed(registry["history"]):
        if str(entry.get("version")) == str(version):
            target = entry
            break
    if target is None:
        raise FileNotFoundError(f"release version not found: {version}")
    model_name = str(target.get("model") or "")
    current = _production_model(registry)
    if current == model_name:
        raise ValueError(f"v{version}（{model_name}）は現在のProductionです（ロールバック不要）")
    reason = str(note or "").strip() or f"Rollback to v{version}（{model_name}）"
    return promote_model(
        project_id,
        model_name,
        note=reason,
        author=author,
        version=str(version),  # Rollbackは対象Versionを維持（新Version採番しない）
        rollback=True,
        rollback_from=str(version),
    )


def mark_validated_if_draft(project_id: Optional[str], model: str) -> bool:
    """評価完了時のValidated自動遷移（Draft→Validatedのみ。Candidate以降は自動変更しない）。

    呼び出し条件は attach_evaluation 側で保証する（CER計算成功＋Evaluation Profile保存成功＋
    Evaluation Hash生成成功）。戻り値=遷移したか。
    """
    paths = ensure_project_directories(project_id)
    model_name = Path(str(model)).name
    with _RELEASES_LOCK:
        registry = _load(paths.root)
        record = _model_record(registry, model_name)
        if str(record.get("status") or "Draft") != "Draft":
            return False
        record["status"] = "Validated"
        record["updated_at"] = datetime.now().isoformat()
        _save(paths.root, registry)
        return True


def get_release_policy(project_id: Optional[str]) -> dict[str, Any]:
    """Release Policy（プロジェクト毎のGateルール設定。未設定キー=ルール無効）。"""
    paths = ensure_project_directories(project_id)
    return dict(_load(paths.root)["policy"])


def set_release_policy(project_id: Optional[str], policy: dict[str, Any]) -> dict[str, Any]:
    from .release_gate import normalize_policy

    paths = ensure_project_directories(project_id)
    normalized = normalize_policy(policy)
    with _RELEASES_LOCK:
        registry = _load(paths.root)
        registry["policy"] = normalized
        _save(paths.root, registry)
    return normalized


# ---------- Model Card ----------


def _load_model_meta(paths: Any, model: str) -> dict[str, Any]:
    try:
        payload = json.loads((paths.models / model).read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, ValueError):
        return {}


def _experiment_for_model(project_id: str, model: str) -> Optional[dict[str, Any]]:
    from .experiment_tracker import list_experiments

    target = None
    for item in list_experiments(project_id, backfill=False):
        if model in [str(m) for m in (item.get("models") or [])]:
            target = item
    return target


def build_model_card(project_id: Optional[str], model: Optional[str] = None) -> dict[str, Any]:
    """Productionモデル（またはモデル指定）のModel Card（Markdown）を自動生成する。"""
    paths = ensure_project_directories(project_id)
    registry = _load(paths.root)
    model_name = Path(str(model)).name if model else _production_model(registry)
    if not model_name:
        raise FileNotFoundError("Productionモデルがありません（先にProductionへ昇格してください）")
    meta = _load_model_meta(paths, model_name)
    record = registry["models"].get(model_name) or {}
    experiment = _experiment_for_model(paths.project_id, model_name)
    evaluation = (experiment or {}).get("evaluation") if isinstance((experiment or {}).get("evaluation"), dict) else None
    profile = (experiment or {}).get("evaluation_profile") if isinstance((experiment or {}).get("evaluation_profile"), dict) else None
    tp = meta.get("training_preprocess") if isinstance(meta.get("training_preprocess"), dict) else {}

    def pct(value: Any) -> str:
        return f"{float(value) * 100:.1f}%" if isinstance(value, (int, float)) else "未記録"

    history_lines = [
        f"| v{entry.get('version')} | {str(entry.get('released_at') or '')[:16].replace('T', ' ')} | "
        f"{entry.get('author') or '-'} | {'Rollback: ' if entry.get('rollback') else ''}{entry.get('note') or '-'} |"
        for entry in reversed(registry["history"])
        if entry.get("model") == model_name
    ]
    lines = [
        f"# Model Card: {model_name}",
        "",
        "## 概要",
        f"- プロジェクト: {paths.project_id}",
        f"- Version: v{record.get('version') or '-'}（Status: {record.get('status') or 'Draft'}）",
        f"- 用途: 単一行の刻印文字OCR（Tesseract LSTM fine-tune / PSM {profile.get('psm') if profile else 7} 想定）",
        f"- 対象文字: {meta.get('charset') or '未記録'}",
        f"- ベースモデル: {meta.get('base_lang') or '未記録'} / 学習Iteration: {meta.get('max_iterations') or '未記録'}",
        "",
        "## 評価条件",
        f"- Experiment: {(experiment or {}).get('experiment_id') or '未記録'} / Comparable Group: {(experiment or {}).get('comparable_group') or 'なし'}",
        f"- 評価データセット: {(profile or {}).get('dataset_id') or '未記録'}（画像 {(profile or {}).get('image_count') or '-'}件）",
        f"- Whitelist: {(profile or {}).get('whitelist') or '未記録'} / 評価前処理: {(profile or {}).get('preprocess_signature') or '未記録'}",
        f"- 学習時前処理ハッシュ: {meta.get('training_preprocess_hash') or '未記録'}（snapshot: {tp.get('snapshot_id') or '-'}）",
        "",
        "## 性能",
        f"- CER: {pct((evaluation or {}).get('cer'))}",
        f"- 文字正解率: {pct((evaluation or {}).get('char_accuracy'))}",
        f"- 完全一致率: {(evaluation or {}).get('accuracy_percent') if evaluation else '未記録'}%" if evaluation else "- 完全一致率: 未記録",
        "",
        "## 既知の制約",
        "- 学習・評価条件（前処理・Whitelist・PSM）と異なる入力では性能が保証されない",
        "- 評価データセット外の書体・照明条件は未検証",
        "- 大小文字はcase-sensitive（k/l/t等の筆記体小文字を含むcharsetのみ認識）",
        "",
        "## 更新履歴",
        "| Version | 日時 | Author | 内容 |",
        "|---|---|---|---|",
        *(history_lines or ["| - | - | - | リリース履歴なし |"]),
        "",
        f"_自動生成: {datetime.now().isoformat()[:16].replace('T', ' ')} / OCR Crafter Release Management_",
    ]
    return {"model": model_name, "version": str(record.get("version") or ""), "markdown": "\n".join(lines)}


# ---------- Deployment Package ----------


def build_deployment_package(project_id: Optional[str]) -> tuple[str, bytes]:
    """Productionモデルの配布パッケージ（ZIP）を生成する。

    含むもの: traineddata（モデル実体）/ 設定JSON（.tess.json）/ 前処理Snapshot /
    Release Note / Model Card。ONNX等の推論成果物はモデルディレクトリに実在する場合のみ追加。
    戻り値: (ファイル名, ZIPバイト列)
    """
    paths = ensure_project_directories(project_id)
    registry = _load(paths.root)
    model_name = _production_model(registry)
    if not model_name:
        raise FileNotFoundError("Productionモデルがありません（先にProductionへ昇格してください）")
    meta = _load_model_meta(paths, model_name)
    record = registry["models"].get(model_name) or {}
    version = str(record.get("version") or "0")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # 設定JSON（モデルメタ）
        zf.writestr("model_config.json", json.dumps(meta, ensure_ascii=False, indent=2))
        # モデル実体（traineddata）
        traineddata = str(meta.get("traineddata_path") or "")
        if traineddata and Path(traineddata).is_file():
            zf.write(traineddata, f"model/{Path(traineddata).name}")
        # ONNX等の追加成果物（実在する場合のみ。Tesseractは通常なし）
        model_dir = str(meta.get("model_dir") or meta.get("tessdata_dir") or "")
        if model_dir and Path(model_dir).is_dir():
            for onnx in Path(model_dir).glob("*.onnx"):
                zf.write(onnx, f"model/{onnx.name}")
        # 前処理Snapshot（学習時前処理。モデルメタの確定保存値）
        if isinstance(meta.get("training_preprocess"), dict):
            zf.writestr(
                "preprocess_snapshot.json", json.dumps(meta["training_preprocess"], ensure_ascii=False, indent=2)
            )
        # Release Note（このモデルの履歴）
        notes = [
            f"v{entry.get('version')}  {str(entry.get('released_at') or '')[:16].replace('T', ' ')}  "
            f"{entry.get('author') or '-'}\n{'[Rollback] ' if entry.get('rollback') else ''}{entry.get('note') or ''}\n"
            for entry in reversed(registry["history"])
            if entry.get("model") == model_name
        ]
        zf.writestr("RELEASE_NOTE.md", f"# Release Notes: {model_name}\n\n" + "\n".join(notes or ["リリース履歴なし\n"]))
        # Model Card
        zf.writestr("MODEL_CARD.md", build_model_card(project_id, model_name)["markdown"])
    filename = f"deployment_{paths.project_id}_v{version.replace('.', '_')}.zip"
    return filename, buffer.getvalue()
