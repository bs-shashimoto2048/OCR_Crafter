"""モデル開発レポート自動生成（Markdown / PDF）。

- Markdownを基準データとして生成し、PDFは同じMarkdownから変換する（内容差分が出ない構造）
- PDFはmatplotlib（既存依存）のPdfPagesで生成: A4縦・白背景・日本語フォント（Windowsシステム
  フォント）・表紙・目次・ヘッダー/フッター/ページ番号・自動改ページ。**外部通信は一切しない**
- レポートID: RPT-0001形式（file_lock+原子的書き込みで並行実行でも重複しない）
- 保存先: data/reports/<project_id>/（ディレクトリトラバーサル防止のためファイル名を厳格に
  サニタイズし、出力先を data/reports 配下へ限定する）
- 記録のない項目は「記録なし」と表示し、推測値を使わない
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from .. import project_paths as project_paths_module
from ..version import APP_VERSION

_LOCK = threading.RLock()

REPORT_GENERATOR_VERSION = 1
REPORT_TYPES = ["single_model", "comparison", "project_summary"]
NO_RECORD = "記録なし"

FOOTNOTE = (
    "本レポートはOCR Crafterに保存された情報から自動生成されています。\n"
    "記録のない項目は「記録なし」と表示されます。自動判定は事実に基づくルールベースの参考情報です。"
)


def _reports_root() -> Path:
    root = Path(project_paths_module.PROJECTS_DIR).parent / "reports"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _index_path() -> Path:
    return _reports_root() / "index.json"


def _load_index() -> dict[str, Any]:
    try:
        payload = json.loads(_index_path().read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            return {"counter": int(payload.get("counter") or 0), "items": payload["items"]}
    except (OSError, ValueError):
        pass
    return {"counter": 0, "items": []}


def _save_index(index: dict[str, Any]) -> None:
    from .atomic_io import atomic_write_json

    atomic_write_json(_index_path(), index)


def sanitize_filename(name: str) -> str:
    """ファイル名のサニタイズ（使用禁止文字の除去・トラバーサル防止。日本語は保持）。"""
    text = str(name or "").strip()
    text = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", text)
    text = text.replace("..", "_")
    return text[:150] or "report"


def unique_path(directory: Path, filename: str) -> Path:
    """重複時は連番を付与した書き込み先パスを返す。

    排他的作成（open "x"）でファイル名を予約するため、並行実行でも同名衝突しない。
    予約した空ファイルは後続の原子的書き込み（os.replace）で本文へ置き換えられる。
    """
    base = sanitize_filename(filename)
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, ""
    counter = 0
    while True:
        name = base if counter == 0 else (f"{stem}_{counter}.{ext}" if ext else f"{stem}_{counter}")
        candidate = directory / name
        try:
            with candidate.open("x"):
                pass  # 予約（排他的作成）
            return candidate
        except FileExistsError:
            counter += 1


def _fmt(value: Any, unit: str = "") -> str:
    """値の表示（None/空=「記録なし」。推測しない）。"""
    if value is None or value == "" or value == []:
        return NO_RECORD
    return f"{value}{unit}"


def _pct(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return NO_RECORD
    return f"{float(value) * 100:.2f}%"


# ---------- データ収集（既存レジストリから。推測補完しない） ----------


def _model_management_no(project_id: str, model: str) -> str:
    try:
        path = Path(project_paths_module.PROJECTS_DIR).parent / "model_ids.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        return str((data.get("models") or {}).get(f"{project_id}/{model}") or "")
    except (OSError, ValueError):
        return ""


def _collect_model_facts(project_id: str, model: str) -> dict[str, Any]:
    """1モデル分の事実情報（実験・リリース・Gate・Benchmark・モデルメタ）。"""
    from ..project_paths import ensure_project_directories
    from .benchmark import list_benchmarks
    from .experiment_tracker import list_experiments
    from .release_gate import evaluate_release_gate
    from .release_manager import list_releases

    paths = ensure_project_directories(project_id)
    meta: dict[str, Any] = {}
    try:
        meta = json.loads((paths.models / model).read_text(encoding="utf-8"))
        if not isinstance(meta, dict):
            meta = {}
    except (OSError, ValueError):
        meta = {}

    experiment = None
    for item in list_experiments(project_id, backfill=False):
        if model in [str(m) for m in (item.get("models") or [])]:
            experiment = item
    releases = list_releases(project_id)
    record = (releases.get("statuses") or {}).get(model) or {}
    history = [h for h in (releases.get("history") or []) if h.get("model") == model]
    gate = None
    try:
        gate = evaluate_release_gate(project_id, model)
    except Exception:  # noqa: BLE001
        gate = None
    bench_row = None
    bench_item = None
    for item in list_benchmarks(project_id)["items"]:
        for row in item.get("results") or []:
            if row.get("engine") == "tesseract_model" and str(row.get("model") or "") == model:
                bench_row, bench_item = row, item
                break
        if bench_row:
            break
    model_size = None
    traineddata = str(meta.get("traineddata_path") or "")
    try:
        if traineddata and Path(traineddata).is_file():
            model_size = round(Path(traineddata).stat().st_size / (1024 * 1024), 2)
    except OSError:
        model_size = None
    return {
        "project_id": project_id,
        "model": model,
        "model_id": _model_management_no(project_id, model),
        "meta": meta,
        "experiment": experiment,
        "release_record": record,
        "release_history": history,
        "production": str(releases.get("production") or ""),
        "gate": gate,
        "benchmark_row": bench_row,
        "benchmark_item": {k: v for k, v in (bench_item or {}).items() if k != "cases"} if bench_item else None,
        "model_size_mb": model_size,
    }


# ---------- Markdownセクションビルダー ----------


def _table(headers: list[str], rows: list[list[Any]]) -> list[str]:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(str(c) if c not in (None, "") else NO_RECORD for c in row) + " |")
    return lines


def _kv_table(pairs: list[tuple[str, Any]]) -> list[str]:
    return _table(["項目", "値"], [[k, _fmt(v)] for k, v in pairs])


def _cover_section(report_name: str, project_id: str, facts: Optional[dict], options: dict[str, Any]) -> list[str]:
    record = (facts or {}).get("release_record") or {}
    template = options.get("template_info") if isinstance(options.get("template_info"), dict) else {}
    latest = ((facts or {}).get("release_history") or [])
    latest_entry = latest[0] if latest else {}
    return [
        "## 1. 表紙・基本情報",
        "",
        *_kv_table(
            [
                ("レポート名", report_name),
                ("プロジェクト名", project_id),
                ("プロジェクトID", project_id),
                ("作成日時", datetime.now().isoformat(timespec="seconds")),
                ("OCR Crafterバージョン", APP_VERSION),
                ("レポート形式", " / ".join(options.get("formats") or ["markdown"])),
                ("作成者", options.get("created_by") or ""),
                ("対象モデルID", (facts or {}).get("model_id") or ((facts or {}).get("model") or "")),
                ("Release ID", latest_entry.get("release_id") or ""),
                ("Version", record.get("version") or ""),
                ("モデル状態", record.get("status") or ""),
                ("作成元テンプレート", template.get("templateName") or ("標準設定" if template.get("templateId") == "standard" else "")),
                ("templateId", template.get("templateId") or ""),
                ("templateVersion", template.get("templateVersion") or ""),
            ]
        ),
        "",
    ]


def _overview_section(facts: dict[str, Any], options: dict[str, Any]) -> list[str]:
    meta = facts.get("meta") or {}
    experiment = facts.get("experiment") or {}
    notes = [h.get("note") for h in facts.get("release_history") or [] if h.get("note")]
    lines = [
        "## 2. 目的・概要",
        "",
        *_kv_table(
            [
                ("プロジェクト概要", options.get("project_description") or ""),
                ("対象文字列", meta.get("charset") or ""),
                ("OCR用途", options.get("purpose") or ""),
                ("採用エンジン", meta.get("engine") or ("tesseract" if facts.get("model", "").endswith(".tess.json") else "")),
                ("学習方式", "Tesseract LSTM fine-tune" if facts.get("model", "").endswith(".tess.json") else NO_RECORD),
                ("モデルの位置付け", (facts.get("release_record") or {}).get("status") or ""),
                ("Production採用有無", "採用中" if facts.get("production") == facts.get("model") else "未採用"),
            ]
        ),
        "",
    ]
    if notes:
        lines += ["以下はユーザー入力（Release Notes）の引用です（自動生成文と区別のため引用表記）:", ""]
        lines += [f"> {n}" for n in notes[:5]]
        lines.append("")
    if experiment.get("note"):
        lines += ["ユーザー入力（実験メモ）:", "", f"> {experiment['note']}", ""]
    return lines


def _dataset_section(facts: dict[str, Any]) -> list[str]:
    meta = facts.get("meta") or {}
    experiment = facts.get("experiment") or {}
    training = experiment.get("training") if isinstance(experiment.get("training"), dict) else {}
    counts = training.get("counts") if isinstance(training.get("counts"), dict) else {}
    profile = experiment.get("evaluation_profile") if isinstance(experiment.get("evaluation_profile"), dict) else {}
    preprocess = experiment.get("preprocess") if isinstance(experiment.get("preprocess"), dict) else {}
    train_total = None
    if any(isinstance(counts.get(k), (int, float)) for k in ("train", "val", "test")):
        train_total = sum(int(counts.get(k) or 0) for k in ("train", "val", "test"))
    return [
        "## 3. データセット情報",
        "",
        *_kv_table(
            [
                ("学習画像数", f"{train_total}枚（train {counts.get('train')} / val {counts.get('val')} / test {counts.get('test')}）" if train_total is not None else None),
                ("評価画像数", f"{profile.get('image_count')}枚" if profile.get("image_count") is not None else None),
                ("ラベル数", f"{profile.get('label_count')}件" if profile.get("label_count") is not None else None),
                ("文字セット", training.get("charset") or meta.get("charset")),
                ("クラス（文字種）", f"{len(str(training.get('charset') or meta.get('charset') or ''))}文字" if (training.get("charset") or meta.get("charset")) else None),
                ("学習・評価データの分離", "評価データセットを別途作成（学習分割とは独立）" if profile.get("dataset_id") else None),
                ("データセットID", profile.get("dataset_id")),
                ("Evaluation Profile", f"engine={profile.get('engine')} / psm={profile.get('psm')} / whitelist={profile.get('whitelist')} / 正規化={profile.get('normalization')} / CER={profile.get('cer_version')}" if profile else None),
                ("Evaluation Hash", experiment.get("evaluation_hash")),
                ("前処理プロファイル", preprocess.get("summary")),
                ("前処理ハッシュ", preprocess.get("hash") or meta.get("training_preprocess_hash")),
                ("作成日時", meta.get("created_at")),
                ("回転済み画像数", None),
                ("除外画像数", None),
                ("スキップ画像数", None),
            ]
        ),
        "",
    ]


_PREPROCESS_LABELS = {
    "grayscale": "グレースケール",
    "illumination": "照明ムラ補正",
    "gamma": "ガンマ補正",
    "clahe": "CLAHE",
    "local_contrast": "局所コントラスト",
    "hist_equalize": "ヒストグラム均等化",
    "bilateral": "Bilateral Filter",
    "sharpen": "Sharpen",
    "unsharp": "Unsharp Mask",
    "threshold": "二値化",
    "morph": "モルフォロジー",
    "stroke_boost": "Stroke Boost",
    "deskew": "傾き補正",
    "crop_margin": "Crop Margin",
    "resize": "Resize",
    "denoise": "Denoise",
    "manual_mask": "手動マスク",
    "pad": "Pad",
    "normalize": "Normalize",
}


def _preprocess_section(facts: dict[str, Any]) -> list[str]:
    """学習時前処理（モデルメタの確定保存値=実際に保存されている有効値）。"""
    meta = facts.get("meta") or {}
    tp = meta.get("training_preprocess") if isinstance(meta.get("training_preprocess"), dict) else None
    lines = ["## 4. 前処理条件", ""]
    if not tp:
        lines += [f"学習時前処理: {NO_RECORD}（旧モデルまたは前処理スナップショット未保存）", ""]
        return lines
    steps = tp.get("steps") if isinstance(tp.get("steps"), dict) else {}
    rows: list[list[Any]] = []
    for image_type, step_list in steps.items():
        for step in step_list or []:
            if not isinstance(step, dict):
                continue
            name = str(step.get("name") or "")
            enabled = step.get("enabled")
            params = step.get("params") if isinstance(step.get("params"), dict) else {}
            value_text = " / ".join(f"{k}={v}" for k, v in params.items()) if params else "-"
            rows.append([image_type, _PREPROCESS_LABELS.get(name, name), "ON" if enabled else "OFF", value_text])
    if rows:
        lines += _table(["画像種別", "工程", "有効", "設定値"], rows)
    normalization = tp.get("ocr_input_normalization") if isinstance(tp.get("ocr_input_normalization"), dict) else None
    if normalization:
        lines += ["", f"OCR入力整形: 高さ{normalization.get('target_height')}px / 幅{normalization.get('canvas_width')}px"]
    lines += ["", f"前処理ハッシュ: {_fmt(meta.get('training_preprocess_hash'))}", ""]
    return lines


def _training_section(facts: dict[str, Any]) -> list[str]:
    meta = facts.get("meta") or {}
    experiment = facts.get("experiment") or {}
    training = experiment.get("training") if isinstance(experiment.get("training"), dict) else {}
    engine = str(meta.get("engine") or ("tesseract" if facts.get("model", "").endswith(".tess.json") else ""))
    profile = experiment.get("evaluation_profile") if isinstance(experiment.get("evaluation_profile"), dict) else {}
    duration = experiment.get("duration_seconds")
    common: list[tuple[str, Any]] = [
        ("OCRエンジン", engine),
        ("ベースモデル", training.get("base_lang") or meta.get("base_lang")),
        ("学習モデル名", facts.get("model")),
        ("学習開始日時", experiment.get("started_at")),
        ("学習終了日時", experiment.get("finished_at")),
        ("学習時間", f"{duration}秒（約{round(duration / 60, 1)}分）" if isinstance(duration, (int, float)) else None),
        ("Seed", training.get("split_seed")),
        ("Train/Val/Test分割", f"{(training.get('split_ratio') or {}).get('train')}/{(training.get('split_ratio') or {}).get('val')}/{(training.get('split_ratio') or {}).get('test')}" if isinstance(training.get("split_ratio"), dict) else None),
        ("charset", training.get("charset") or meta.get("charset")),
        ("whitelist（評価時）", profile.get("whitelist")),
        ("PSM（評価時）", profile.get("psm")),
        ("データ拡張", "あり" if isinstance((experiment.get("augmentation") or {}).get("config"), dict) else ("なし" if experiment.get("augmentation") is not None else None)),
        ("Job ID", meta.get("job_id")),
        ("Experiment ID", experiment.get("experiment_id")),
    ]
    lines = ["## 5. 学習条件", ""]
    if engine == "tesseract":
        lines += ["### Tesseract（LSTM fine-tune）", ""]
        common.insert(6, ("Iteration", training.get("iterations") or meta.get("max_iterations")))
        # Tesseract学習に存在しない項目は「記録なし」ではなく非該当として明記
        lines += _kv_table(common)
        lines += ["", "Epoch / Batch Size / Learning Rate / Optimizer / num_workers / GPU: Tesseract LSTM fine-tune では使用しない項目です（lstmtrainingはCPU実行・Iterationベース）。"]
    else:
        lines += ["### PaddleOCR", ""]
        common.insert(6, ("Epoch", meta.get("epochs")))
        common.insert(7, ("Batch Size", meta.get("batch_size")))
        common.insert(8, ("Learning Rate", meta.get("learning_rate")))
        common.insert(9, ("Optimizer", meta.get("optimizer")))
        common.insert(10, ("num_workers", meta.get("train_num_workers")))
        common.insert(11, ("GPU/CPU", meta.get("device")))
        lines += _kv_table(common)
    lines += ["", f"学習時の警告・スキップ・失敗件数: {_fmt(meta.get('training_warnings'))}", ""]
    return lines


def _evaluation_section(facts: dict[str, Any]) -> list[str]:
    experiment = facts.get("experiment") or {}
    evaluation = experiment.get("evaluation") if isinstance(experiment.get("evaluation"), dict) else {}
    profile = experiment.get("evaluation_profile") if isinstance(experiment.get("evaluation_profile"), dict) else {}
    from .experiment_tracker import analysis_exclusion_reason

    exclusion = analysis_exclusion_reason(experiment) if experiment else ""
    lines = [
        "## 6. 評価結果",
        "",
        *_kv_table(
            [
                ("CER（文字誤り率・低いほど良い）", _pct(evaluation.get("cer")) if evaluation else None),
                ("Character Accuracy（文字正解率=1−CER・高いほど良い）", _pct(evaluation.get("char_accuracy")) if evaluation else None),
                ("Exact Match Rate（完全一致率）", f"{evaluation.get('accuracy_percent')}%" if isinstance(evaluation.get("accuracy_percent"), (int, float)) else None),
                ("評価件数", f"{profile.get('image_count')}件" if profile.get("image_count") is not None else None),
                ("評価エンジン", profile.get("engine")),
                ("評価前処理モード", profile.get("preprocess_signature")),
                ("Comparable Group", experiment.get("comparable_group")),
                ("評価日時", evaluation.get("evaluated_at") if evaluation else None),
                ("分析対象（Scientific Mode）", "対象" if experiment.get("analysis_enabled") else ("対象外" if experiment else None)),
                ("分析対象外の理由", exclusion or ("該当なし" if experiment else None)),
            ]
        ),
        "",
        "注: CERは「誤り率」（0%が理想）、Character Accuracyは「正解率」（100%が理想）です。CER 5% = 文字正解率95%を意味します。",
        "",
    ]
    return lines


def _confusion_section(facts: dict[str, Any], include_images: bool, images_dir: Optional[Path], report_dir: Optional[Path]) -> list[str]:
    experiment = facts.get("experiment") or {}
    evaluation = experiment.get("evaluation") if isinstance(experiment.get("evaluation"), dict) else {}
    confusions = evaluation.get("confusions") if isinstance(evaluation.get("confusions"), list) else None
    lines = ["## 7. 誤認識分析", ""]
    if not confusions:
        lines += [f"混同集計: {NO_RECORD}（再評価すると記録されます）", ""]
    else:
        kind_label = {"sub": "置換", "ins": "挿入", "del": "脱落"}
        rows = [
            [kind_label.get(c.get("kind"), c.get("kind")), c.get("from") or "（空）", c.get("to") or "（空）", f"{c.get('count')}回"]
            for c in confusions[:15]
        ]
        lines += ["### 誤認識上位（文字別混同・Levenshteinアラインメント由来）", ""]
        lines += _table(["種別", "正解文字", "OCR結果", "発生回数"], rows)
        lines.append("")
    # 代表的な失敗例（Benchmarkのcasesから。画像は同梱ディレクトリへコピー・外部送信しない）
    bench = facts.get("benchmark_item")
    failures: list[dict[str, Any]] = []
    if bench:
        from .benchmark import get_benchmark

        try:
            detail = get_benchmark(facts["project_id"], bench["benchmark_id"])
            engine_key = (facts.get("benchmark_row") or {}).get("engine_key")
            image_dir = Path(str(detail.get("image_dir") or ""))
            for case in detail.get("cases") or []:
                result = (case.get("engines") or {}).get(engine_key) or {}
                if result and not result.get("match"):
                    failures.append({"image": case.get("image"), "expected": case.get("expected"), "prediction": result.get("prediction"), "failed": result.get("failed"), "image_dir": image_dir})
                if len(failures) >= 10:
                    break
        except Exception:  # noqa: BLE001
            failures = []
    if failures:
        lines += ["### 代表的な失敗例（最新Benchmarkより・最大10件）", ""]
        rows = []
        for index, f in enumerate(failures):
            image_ref = NO_RECORD
            if include_images and images_dir is not None and report_dir is not None:
                try:
                    src = f["image_dir"] / str(f["image"])
                    if src.is_file():
                        images_dir.mkdir(parents=True, exist_ok=True)
                        dst = images_dir / sanitize_filename(f"fail_{index:02d}_{f['image']}")
                        dst.write_bytes(src.read_bytes())
                        image_ref = f"![{f['image']}]({dst.relative_to(report_dir).as_posix()})"
                except OSError:
                    image_ref = NO_RECORD
            rows.append([f["image"], f["expected"], f["prediction"] or "（空）", "推論失敗" if f["failed"] else "不一致", image_ref])
        lines += _table(["画像", "正解文字列", "OCR結果", "エラー種別", "画像参照"], rows)
        lines.append("")
    elif bench is None:
        lines += [f"代表的な失敗例: {NO_RECORD}（Benchmark実行で記録されます）", ""]
    return lines


def _comparison_section(facts_list: list[dict[str, Any]]) -> list[str]:
    lines = ["## 8. モデル比較", ""]
    headers = ["項目"] + [f["model_id"] or f["model"] for f in facts_list]

    def row(label: str, getter: Callable[[dict[str, Any]], Any]) -> list[Any]:
        return [label] + [_fmt(getter(f)) for f in facts_list]

    def experiment_of(f):
        return f.get("experiment") or {}

    def evaluation_of(f):
        e = experiment_of(f).get("evaluation")
        return e if isinstance(e, dict) else {}

    rows = [
        row("Model ID", lambda f: f.get("model_id")),
        row("モデル名", lambda f: f.get("model")),
        row("Experiment ID", lambda f: experiment_of(f).get("experiment_id")),
        row("Release ID", lambda f: (f.get("release_history") or [{}])[0].get("release_id") if f.get("release_history") else None),
        row("Version", lambda f: (f.get("release_record") or {}).get("version")),
        row("OCRエンジン", lambda f: (f.get("meta") or {}).get("engine") or ("tesseract" if f.get("model", "").endswith(".tess.json") else None)),
        row("データセット", lambda f: (experiment_of(f).get("evaluation_profile") or {}).get("dataset_id")),
        row("Evaluation Hash", lambda f: (experiment_of(f).get("evaluation_hash") or "")[:22] or None),
        row("前処理ハッシュ", lambda f: ((f.get("meta") or {}).get("training_preprocess_hash") or "")[:22] or None),
        row("Iteration", lambda f: (experiment_of(f).get("training") or {}).get("iterations")),
        row("CER", lambda f: _pct(evaluation_of(f).get("cer")) if evaluation_of(f) else None),
        row("Character Accuracy", lambda f: _pct(evaluation_of(f).get("char_accuracy")) if evaluation_of(f) else None),
        row("Exact Match Rate", lambda f: f"{evaluation_of(f).get('accuracy_percent')}%" if isinstance(evaluation_of(f).get("accuracy_percent"), (int, float)) else None),
        row("学習時間", lambda f: f"{experiment_of(f).get('duration_seconds')}秒" if isinstance(experiment_of(f).get("duration_seconds"), (int, float)) else None),
        row("推論速度（Benchmark平均）", lambda f: f"{(f.get('benchmark_row') or {}).get('mean_time_ms')}ms" if (f.get("benchmark_row") or {}).get("mean_time_ms") is not None else None),
        row("メモリ使用量", lambda f: (f.get("benchmark_row") or {}).get("peak_memory_mb") or "取得不能"),
        row("モデルサイズ", lambda f: f"{f.get('model_size_mb')}MB" if f.get("model_size_mb") is not None else None),
        row("リリース状態", lambda f: (f.get("release_record") or {}).get("status")),
    ]
    lines += _table(headers, rows)
    hashes = {str((f.get("experiment") or {}).get("evaluation_hash") or "") for f in facts_list}
    lines.append("")
    if len(hashes) == 1 and "" not in hashes:
        lines += ["比較可能性: 全モデルが同一のEvaluation Hash（同一条件の評価）です。数値を直接比較できます。", ""]
    else:
        lines += ["**比較可能性: 評価条件が異なるため、数値の直接比較には注意が必要です。**（Evaluation Hashが一致しない、または未記録のモデルを含みます）", ""]
    return lines


def _benchmark_section(facts: dict[str, Any]) -> list[str]:
    lines = ["## 9. Benchmark結果", ""]
    row = facts.get("benchmark_row")
    item = facts.get("benchmark_item")
    if not row or not item:
        lines += ["Benchmark結果は記録されていません。", ""]
        return lines
    lines += _kv_table(
        [
            ("Benchmark ID", item.get("benchmark_id")),
            ("Profile Hash", (item.get("profile") or {}).get("profile_hash")),
            ("対象エンジン", row.get("engine_key")),
            ("CER", _pct(row.get("cer"))),
            ("Character Accuracy", _pct(row.get("char_accuracy"))),
            ("Exact Match Rate", _pct(row.get("exact_match_rate"))),
            ("Cold Start", f"{row.get('cold_start_seconds')}秒" if row.get("cold_start_seconds") is not None else None),
            ("P50 / P95", f"{row.get('p50_time_ms')}ms / {row.get('p95_time_ms')}ms" if row.get("p50_time_ms") is not None else None),
            ("Peak Memory", row.get("peak_memory_mb") if row.get("peak_memory_mb") is not None else "取得不能"),
            ("実行日時", row.get("completed_at")),
            ("実行環境", "ローカル（OCR Crafter実行マシン）"),
        ]
    )
    lines.append("")
    return lines


def _experiments_section(project_id: str, limit: int) -> list[str]:
    from .experiment_tracker import list_experiments

    items = list_experiments(project_id, backfill=False)
    lines = [f"## 10. 実験履歴（最新{limit}件 / 全{len(items)}件）", ""]
    if not items:
        lines += [f"実験履歴: {NO_RECORD}", ""]
        return lines
    rows = []
    for item in list(reversed(items))[:limit]:
        evaluation = item.get("evaluation") if isinstance(item.get("evaluation"), dict) else {}
        rows.append(
            [
                item.get("experiment_id"),
                str(item.get("created_at") or "")[:16],
                ", ".join(str(m) for m in (item.get("models") or [])),
                (item.get("preprocess") or {}).get("summary") or "-",
                _pct(evaluation.get("cer")) if evaluation else NO_RECORD,
                f"{evaluation.get('accuracy_percent')}%" if isinstance(evaluation.get("accuracy_percent"), (int, float)) else NO_RECORD,
                item.get("comparable_group") or "-",
                "ON" if item.get("analysis_enabled") else "OFF",
                ", ".join(item.get("tags") or []) or "-",
                "★" if item.get("favorite") else "-",
                (item.get("note") or "")[:30] or "-",
            ]
        )
    lines += _table(["Experiment", "実行日時", "モデル", "条件（前処理）", "CER", "完全一致", "CG", "分析", "タグ", "★", "備考"], rows)
    lines.append("")
    return lines


def _release_section(facts: dict[str, Any]) -> list[str]:
    record = facts.get("release_record") or {}
    history = facts.get("release_history") or []
    gate = facts.get("gate")
    lines = [
        "## 11. リリース情報",
        "",
        "モデル状態はDraft（学習直後）→ Validated（評価完了）→ Candidate（本番候補）→ Production（本番・**1プロジェクトに0件または1件**）→ Archivedのライフサイクルで管理されます。",
        "",
        *_kv_table(
            [
                ("モデル状態", record.get("status")),
                ("Release ID", history[0].get("release_id") if history else None),
                ("Version", record.get("version")),
                ("Production採用中", "はい" if facts.get("production") == facts.get("model") else "いいえ"),
                ("Release Gate結果", (gate or {}).get("verdict")),
                ("昇格日時", history[0].get("released_at") if history else None),
            ]
        ),
        "",
    ]
    if gate and gate.get("rules"):
        lines += ["### Release Gate合格条件と判定", ""]
        lines += _table(
            ["ルール", "期待", "実測", "判定"],
            [[r.get("rule"), r.get("expected"), r.get("actual"), r.get("result")] for r in gate["rules"]],
        )
        lines.append("")
    overrides = [h for h in history if h.get("override")]
    if overrides:
        o = overrides[0]["override"]
        lines += [
            "### Override（例外承認）",
            "",
            *_kv_table([("Override理由", o.get("reason")), ("承認者", o.get("approved_by")), ("承認日時", o.get("approved_at"))]),
            "",
        ]
    else:
        lines += [f"Override: なし", ""]
    rollbacks = [h for h in history if h.get("rollback")]
    if rollbacks:
        lines += ["### ロールバック履歴", ""]
        lines += _table(["Release ID", "Version", "日時", "理由"], [[h.get("release_id"), h.get("version"), str(h.get("released_at") or "")[:16], h.get("note")] for h in rollbacks])
        lines.append("")
    if history:
        lines += ["### Release Notes（ユーザー入力の引用）", ""]
        for h in history[:5]:
            lines.append(f"> v{h.get('version')}: {h.get('note')}")
        lines.append("")
    lines += ["Deployment Package / Model Card: リリース管理画面からExportできます。", ""]
    return lines


def build_verdict(facts: dict[str, Any]) -> tuple[str, list[str]]:
    """総合判定（事実に基づくルールベース・断定しない）。戻り値=(判定文, 根拠リスト)。"""
    experiment = facts.get("experiment") or {}
    evaluation = experiment.get("evaluation") if isinstance(experiment.get("evaluation"), dict) else None
    profile = experiment.get("evaluation_profile") if isinstance(experiment.get("evaluation_profile"), dict) else {}
    gate = facts.get("gate") or {}
    reasons: list[str] = []
    if evaluation is None or not isinstance(evaluation.get("cer"), (int, float)):
        reasons.append("評価結果が記録されていません")
        return ("【評価不足】評価が未実施のため、判定できません。モデル評価の実行を推奨します。", reasons)
    cer = float(evaluation["cer"])
    reasons.append(f"CER {cer * 100:.2f}%（評価{profile.get('image_count') or '?'}件）")
    image_count = profile.get("image_count")
    small = isinstance(image_count, (int, float)) and image_count < 30
    if small:
        reasons.append(f"評価データ数が{int(image_count)}件と少数です")
    verdict = gate.get("verdict")
    if verdict == "PASS":
        reasons.append("設定されたRelease Gateの全ルールを満たしています")
        text = "【採用候補・リリース可能】本モデルは設定されたRelease Gateを満たしています。"
        if small:
            text += " ただし評価データ数が少ないため、追加評価を推奨します。"
        return (text, reasons)
    if verdict == "FAIL":
        failed = [r.get("rule") for r in gate.get("rules") or [] if r.get("result") == "fail"]
        reasons.append(f"Release Gate不合格ルール: {', '.join(failed)}")
        return ("【要改善・リリース非推奨】Release Gateを満たしていない項目があります。改善または例外承認の検討が必要です。", reasons)
    if verdict == "CONDITIONAL_PASS":
        reasons.append("Release Gateに警告または未検証の項目があります")
        return ("【採用候補（条件付き）】不合格ルールはありませんが、未検証・警告項目の確認を推奨します。", reasons)
    reasons.append("Release Policyが未設定です（Gate判定なし）")
    if small:
        return ("【評価不足】評価データ数が少ないため、追加評価を推奨します。", reasons)
    return ("【採用候補】明確な不合格条件は確認されていません。Release Policyの設定とGate判定の実施を推奨します。", reasons)


def build_report_recommendations(facts: dict[str, Any]) -> list[str]:
    """推奨事項（ルールベース）。"""
    recommendations: list[str] = []
    experiment = facts.get("experiment") or {}
    evaluation = experiment.get("evaluation") if isinstance(experiment.get("evaluation"), dict) else None
    profile = experiment.get("evaluation_profile") if isinstance(experiment.get("evaluation_profile"), dict) else {}
    gate = facts.get("gate") or {}
    record = facts.get("release_record") or {}
    if evaluation is None:
        recommendations.append("モデル評価を実行してください（評価結果が未記録です）")
        return recommendations
    image_count = profile.get("image_count")
    if isinstance(image_count, (int, float)) and image_count < 30:
        recommendations.append(f"評価データの追加を推奨します（現在{int(image_count)}件。30件以上を目安）")
    char_stats = evaluation.get("char_stats") if isinstance(evaluation.get("char_stats"), dict) else {}
    weak_chars = [ch for ch, s in char_stats.items() if isinstance(s, dict) and s.get("total") and (s.get("errors") or 0) / s["total"] > 0.2]
    if weak_chars:
        recommendations.append(f"誤り率の高い文字（{', '.join(weak_chars[:5])}）の学習データ追加を推奨します")
    confusions = evaluation.get("confusions") if isinstance(evaluation.get("confusions"), list) else []
    if any((c.get("count") or 0) >= 3 for c in confusions):
        recommendations.append("特定の混同が繰り返し発生しています。前処理（二値化・コントラスト）の見直しを検討してください")
    if facts.get("benchmark_row") is None:
        recommendations.append("Benchmarkが未実施です。他エンジン（Tesseract標準・PaddleOCR）との比較実施を推奨します")
    if gate.get("verdict") in {"FAIL", "CONDITIONAL_PASS"}:
        recommendations.append("Release Gateの再確認を推奨します（不合格・未検証項目があります）")
    status = str(record.get("status") or "")
    if status == "Validated" and gate.get("verdict") in {"PASS", "CONDITIONAL_PASS"}:
        recommendations.append("Candidate昇格を検討できます")
    if status == "Candidate" and gate.get("verdict") == "PASS":
        recommendations.append("Production昇格を検討できます（昇格前に現場相当データでの追加試験を推奨）")
    if status == "Production":
        recommendations.append("運用中の実データでの定期的な追加評価（現場試験）を推奨します")
    if not recommendations:
        recommendations.append("現時点で追加の推奨事項はありません")
    return recommendations


def _verdict_section(facts: dict[str, Any]) -> list[str]:
    verdict, reasons = build_verdict(facts)
    lines = ["## 12. 総合判定", "", verdict, "", "判定根拠:", ""]
    lines += [f"- {r}" for r in reasons]
    lines += ["", "注: 本判定は保存された事実に基づくルールベースの参考情報であり、最終的な採用判断はプロジェクト責任者が行ってください。", ""]
    return lines


def _recommendation_section(facts: dict[str, Any]) -> list[str]:
    lines = ["## 13. 推奨事項", ""]
    lines += [f"- {r}" for r in build_report_recommendations(facts)]
    lines += ["", "注: 相関に基づく示唆を含む場合、相関は因果関係を示すものではありません。", ""]
    return lines


def _audit_section(report_id: str, project_id: str, targets: list[str], options: dict[str, Any], job_id: str) -> list[str]:
    return [
        "## 14. 監査情報",
        "",
        *_kv_table(
            [
                ("レポートID", report_id),
                ("レポート生成日時", datetime.now().isoformat(timespec="seconds")),
                ("レポート生成Job ID", job_id),
                ("操作者", options.get("created_by") or ""),
                ("対象プロジェクト", project_id),
                ("対象モデル", ", ".join(targets) if targets else ""),
                ("出力形式", " / ".join(options.get("formats") or [])),
                ("使用したデータの更新日時", options.get("source_updated_at") or datetime.now().isoformat(timespec="seconds")),
            ]
        ),
        "",
        "出力ファイル名・SHA-256ハッシュ・生成成功/失敗はレポートメタデータ（レポート画面の詳細）に記録されます。",
        "",
    ]


def _toc(section_titles: list[str]) -> list[str]:
    lines = ["## 目次", ""]
    lines += [f"- {t}" for t in section_titles]  # セクション名自体に番号を含むため列挙のみ
    lines.append("")
    return lines


def build_report_markdown(
    report_type: str,
    project_id: str,
    model_ids: list[str],
    options: dict[str, Any],
    report_id: str = "",
    job_id: str = "",
    report_dir: Optional[Path] = None,
) -> str:
    """レポート本体（Markdown）を生成する。PDFはこのMarkdownから変換される（内容差分なし）。"""
    include_images = bool(options.get("include_images"))
    images_dir = (report_dir / f"{report_id}_images") if (report_dir and include_images) else None
    limit = max(1, min(500, int(options.get("experiments_limit") or 50)))

    if report_type == "single_model":
        facts = _collect_model_facts(project_id, model_ids[0])
        title = f"モデル開発レポート: {facts.get('model_id') or model_ids[0]}"
        sections = [
            _cover_section(title, project_id, facts, options),
            _overview_section(facts, options),
            _dataset_section(facts),
            _preprocess_section(facts),
            _training_section(facts),
            _evaluation_section(facts),
            _confusion_section(facts, include_images, images_dir, report_dir),
            _benchmark_section(facts),
            _release_section(facts),
            _verdict_section(facts),
            _recommendation_section(facts),
            _audit_section(report_id, project_id, model_ids, options, job_id),
        ]
    elif report_type == "comparison":
        facts_list = [_collect_model_facts(project_id, m) for m in model_ids]
        title = f"モデル比較レポート: {', '.join(f.get('model_id') or f['model'] for f in facts_list)}"
        sections = [
            _cover_section(title, project_id, facts_list[0], options),
            _comparison_section(facts_list),
        ]
        for facts in facts_list:
            sections.append([f"## 個別詳細: {facts.get('model_id') or facts['model']}", ""])
            sections.append(_evaluation_section(facts))
            sections.append(_release_section(facts))
        sections.append(_verdict_comparison_section(facts_list))
        sections.append(_audit_section(report_id, project_id, model_ids, options, job_id))
    else:  # project_summary
        title = f"プロジェクト総括レポート: {project_id}"
        production_model = ""
        try:
            from .release_manager import list_releases

            production_model = str(list_releases(project_id).get("production") or "")
        except Exception:  # noqa: BLE001
            production_model = ""
        facts = _collect_model_facts(project_id, production_model) if production_model else None
        sections = [
            _cover_section(title, project_id, facts, options),
            _project_models_section(project_id),
            _experiments_section(project_id, limit),
            _project_benchmark_section(project_id),
        ]
        if facts:
            sections.append([f"## Productionモデル詳細（{facts.get('model_id') or production_model}）", ""])
            sections.append(_evaluation_section(facts))
            sections.append(_release_section(facts))
            sections.append(_verdict_section(facts))
            sections.append(_recommendation_section(facts))
        else:
            sections.append(["## Productionモデル", "", "Productionモデルはありません（0件。Productionは1プロジェクトに0件または1件です）。", ""])
        sections.append(_audit_section(report_id, project_id, model_ids, options, job_id))

    section_titles = [s[0].lstrip("# ").strip() for s in sections if s and s[0].startswith("## ")]
    lines = [f"# {title}", ""]
    lines += _toc(section_titles)
    for section in sections:
        lines += section
    lines += ["---", "", FOOTNOTE, ""]
    return "\n".join(lines)


def _verdict_comparison_section(facts_list: list[dict[str, Any]]) -> list[str]:
    hashes = {str((f.get("experiment") or {}).get("evaluation_hash") or "") for f in facts_list}
    lines = ["## 総合判定（比較）", ""]
    if len(hashes) > 1 or "" in hashes:
        lines += [
            "【比較不能（参考比較）】比較対象とEvaluation Hashが異なるため、優劣を確定できません。",
            "",
            "判定根拠:",
            "- 評価条件（データセット・前処理・エンジン設定）が同一ではない、または未記録のモデルを含みます",
            "- 同一条件（同じ評価データセット・同じ前処理）での再評価を推奨します",
            "",
        ]
        return lines
    evaluated = [f for f in facts_list if isinstance(((f.get("experiment") or {}).get("evaluation") or {}).get("cer"), (int, float))]
    if not evaluated:
        lines += ["【評価不足】評価結果のあるモデルがないため、判定できません。", ""]
        return lines
    best = min(evaluated, key=lambda f: f["experiment"]["evaluation"]["cer"])
    lines += [
        f"同一条件の評価に基づくと、CER最小は {best.get('model_id') or best['model']}（CER {_pct(best['experiment']['evaluation']['cer'])}）です。",
        "",
        "判定根拠:",
        "- 全モデルのEvaluation Hashが一致（同一条件の評価）",
        f"- 比較対象: {len(facts_list)}モデル / 評価済み: {len(evaluated)}モデル",
        "",
        "注: 本判定は参考情報です。運用条件・速度・安定性も含めて総合的に判断してください。",
        "",
    ]
    return lines


def _project_models_section(project_id: str) -> list[str]:
    from ..project_paths import ensure_project_directories
    from .release_manager import list_releases

    paths = ensure_project_directories(project_id)
    releases = list_releases(project_id)
    statuses = releases.get("statuses") or {}
    lines = ["## モデル一覧", ""]
    if not statuses:
        lines += [f"モデル: {NO_RECORD}", ""]
        return lines
    rows = []
    for name, record in statuses.items():
        rows.append([_model_management_no(paths.project_id, name) or "-", name, record.get("status"), record.get("version") or "-"])
    lines += _table(["管理No", "モデル", "状態", "Version"], rows)
    production = str(releases.get("production") or "")
    lines += ["", f"Production: {production or '0件（未昇格）'}（Productionは1プロジェクトに0件または1件です）", ""]
    return lines


def _project_benchmark_section(project_id: str) -> list[str]:
    from .benchmark import list_benchmarks

    items = list_benchmarks(project_id)["items"]
    lines = ["## Benchmark履歴", ""]
    if not items:
        lines += ["Benchmark結果は記録されていません。", ""]
        return lines
    rows = []
    for item in items[:10]:
        top = (item.get("results") or [{}])[0]
        rows.append([item.get("benchmark_id"), item.get("name") or "-", str(item.get("created_at") or "")[:16], len(item.get("results") or []), f"{top.get('label')}（CER {_pct(top.get('cer'))}）" if top else "-"])
    lines += _table(["Benchmark ID", "名前", "実行日時", "エンジン数", "1位"], rows)
    lines.append("")
    return lines


# ---------- PDF生成（matplotlib PdfPages・外部通信なし・白背景A4） ----------


def _japanese_font() -> str:
    """日本語対応フォント名（Windowsシステムフォントから解決。見つからなければ既定）。"""
    try:
        from matplotlib import font_manager

        available = {f.name for f in font_manager.fontManager.ttflist}
        for name in ["Yu Gothic", "Meiryo", "MS Gothic", "Noto Sans CJK JP", "IPAGothic"]:
            if name in available:
                return name
    except Exception:  # noqa: BLE001
        pass
    return "sans-serif"


def markdown_to_pdf(markdown_text: str, pdf_path: Path, title: str) -> None:
    """MarkdownをA4縦PDFへ変換する（簡易レンダラ。表・見出し・箇条書き・画像・改ページ対応）。"""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.image as mpimg
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages

    font = _japanese_font()
    plt.rcParams["font.family"] = font
    page_w, page_h = 8.27, 11.69  # A4（インチ）
    margin_x, top_y, bottom_y = 0.07, 0.94, 0.06
    usable_w = 1.0 - margin_x * 2

    lines = markdown_text.split("\n")
    pdf_dir = pdf_path.parent

    with PdfPages(pdf_path) as pdf:
        page_number = 0
        fig = None
        y = top_y

        def new_page():
            nonlocal fig, y, page_number
            if fig is not None:
                _footer(fig, page_number)
                pdf.savefig(fig)
                plt.close(fig)
            page_number += 1
            fig = plt.figure(figsize=(page_w, page_h), facecolor="white")
            # ヘッダー（表紙以外）
            if page_number > 1:
                fig.text(margin_x, 0.975, f"OCR Crafter — {title}", fontsize=7, color="#666666")
                fig.lines.append(plt.Line2D([margin_x, 1 - margin_x], [0.968, 0.968], transform=fig.transFigure, color="#cccccc", linewidth=0.5))
            y = top_y

        def _footer(figure, number):
            figure.text(0.5, 0.03, f"- {number} -", fontsize=8, color="#666666", ha="center")

        def ensure(height):
            nonlocal y
            if y - height < bottom_y:
                new_page()

        def text(content, size=9, color="#111111", weight="normal", indent=0.0, line_height=None):
            nonlocal y
            height = line_height or (size / 500)
            # 幅に応じた簡易折返し（全角換算）
            max_chars = max(10, int(usable_w * 95 * (9 / size)))
            for chunk in _wrap(content, max_chars):
                ensure(height)
                fig.text(margin_x + indent, y, chunk, fontsize=size, color=color, fontweight=weight, va="top")
                y -= height * 1.35

        def _wrap(content, max_chars):
            out, buf, width = [], "", 0
            for ch in str(content):
                w = 2 if ord(ch) > 0x2000 else 1
                if width + w > max_chars * 1.0:
                    out.append(buf)
                    buf, width = ch, w
                else:
                    buf += ch
                    width += w
            out.append(buf)
            return out or [""]

        def table(headers, body_rows):
            nonlocal y
            columns = len(headers)
            col_w = usable_w / columns
            max_chars = max(4, int(col_w * 92))

            def cell_lines(value):
                return _wrap(str(value), max_chars)

            all_rows = [headers] + body_rows
            for row_index, row in enumerate(all_rows):
                wrapped = [cell_lines(c) for c in row]
                row_lines = max(len(w) for w in wrapped)
                row_h = 0.0155 * row_lines + 0.004
                ensure(row_h + 0.01)
                # 行の背景（ヘッダーはグレー・印刷向け白基調）
                if row_index == 0:
                    fig.patches.append(plt.Rectangle((margin_x, y - row_h + 0.004), usable_w, row_h, transform=fig.transFigure, facecolor="#eeeeee", edgecolor="none"))
                fig.lines.append(plt.Line2D([margin_x, 1 - margin_x], [y + 0.004, y + 0.004], transform=fig.transFigure, color="#bbbbbb", linewidth=0.4))
                for col, cell in enumerate(wrapped):
                    for li, chunk in enumerate(cell):
                        fig.text(margin_x + col * col_w + 0.003, y - li * 0.0155, chunk, fontsize=6.5, color="#111111", va="top", fontweight="bold" if row_index == 0 else "normal")
                y -= row_h
            fig.lines.append(plt.Line2D([margin_x, 1 - margin_x], [y + 0.004, y + 0.004], transform=fig.transFigure, color="#bbbbbb", linewidth=0.4))
            y -= 0.012

        def image(path_text):
            nonlocal y
            try:
                img = mpimg.imread(str(pdf_dir / path_text))
            except Exception:  # noqa: BLE001
                text(f"（画像を読み込めません: {path_text}）", size=7, color="#999999")
                return
            height_px, width_px = img.shape[0], img.shape[1]
            display_w = min(0.4, usable_w)
            display_h = display_w * (height_px / max(1, width_px)) * (page_w / page_h)
            ensure(display_h + 0.01)
            ax = fig.add_axes([margin_x, y - display_h, display_w, display_h])
            ax.imshow(img, aspect="equal")
            ax.axis("off")
            y -= display_h + 0.015

        # 表紙
        new_page()
        fig.text(0.5, 0.62, title, fontsize=18, ha="center", fontweight="bold", color="#111111")
        fig.text(0.5, 0.55, f"生成日時: {datetime.now().isoformat(timespec='seconds')}", fontsize=10, ha="center", color="#444444")
        fig.text(0.5, 0.51, f"OCR Crafter v{APP_VERSION}（自動生成レポート）", fontsize=10, ha="center", color="#444444")
        new_page()

        index = 0
        while index < len(lines):
            line = lines[index].rstrip()
            if line.startswith("|") and index + 1 < len(lines) and set(lines[index + 1].replace("|", "").replace(" ", "")) <= {"-"}:
                headers = [c.strip() for c in line.strip("|").split("|")]
                body = []
                index += 2
                while index < len(lines) and lines[index].startswith("|"):
                    body.append([c.strip() for c in lines[index].strip("|").split("|")])
                    index += 1
                table(headers, body)
                continue
            image_match = re.match(r"^!\[[^\]]*\]\(([^)]+)\)$", line.strip())
            if image_match:
                image(image_match.group(1))
            elif line.startswith("# "):
                pass  # タイトルは表紙に掲載済み
            elif line.startswith("## "):
                ensure(0.05)
                y -= 0.012
                text(line[3:], size=13, weight="bold", color="#1a3a5c")
                fig.lines.append(plt.Line2D([margin_x, 1 - margin_x], [y + 0.008, y + 0.008], transform=fig.transFigure, color="#1a3a5c", linewidth=0.8))
                y -= 0.006
            elif line.startswith("### "):
                y -= 0.006
                text(line[4:], size=10.5, weight="bold", color="#333333")
            elif line.startswith("- "):
                text("・" + line[2:], size=9, indent=0.012)
            elif line.startswith("> "):
                text(line[2:], size=8.5, color="#555555", indent=0.015)
            elif line.strip() == "---":
                fig.lines.append(plt.Line2D([margin_x, 1 - margin_x], [y, y], transform=fig.transFigure, color="#cccccc", linewidth=0.5))
                y -= 0.01
            elif line.strip():
                bold = line.startswith("**") and line.endswith("**")
                text(line.strip("*"), size=9, weight="bold" if bold else "normal")
            else:
                y -= 0.008
            index += 1

        _footer(fig, page_number)
        pdf.savefig(fig)
        plt.close(fig)


# ---------- レポート生成Job（Job Managementから呼ばれる） ----------


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_report_job(params: dict[str, Any], ctx: Any) -> dict[str, Any]:
    """レポート生成Job本体。Markdown生成→（必要なら）PDF変換→SHA-256→メタデータ保存。"""
    from ..project_paths import ensure_project_directories
    from .atomic_io import atomic_write_text, file_lock

    project_id = str(params.get("project_id") or "default")
    report_type = str(params.get("report_type") or "single_model")
    if report_type not in REPORT_TYPES:
        raise ValueError(f"report_type は {REPORT_TYPES} のいずれかを指定してください")
    model_ids = [str(m) for m in (params.get("model_ids") or []) if str(m).strip()]
    if report_type == "single_model" and len(model_ids) != 1:
        raise ValueError("単一モデルレポートは対象モデルを1件指定してください")
    if report_type == "comparison" and len(model_ids) < 2:
        raise ValueError("モデル比較レポートは2件以上のモデルを指定してください")
    formats = [f for f in (params.get("formats") or ["markdown"]) if f in {"markdown", "pdf"}] or ["markdown"]
    options = {
        "formats": formats,
        "created_by": str(params.get("created_by") or ""),
        "include_images": bool(params.get("include_images")),
        "experiments_limit": params.get("experiments_limit"),
        "template_info": params.get("template_info"),
        "project_description": str(params.get("project_description") or ""),
        "purpose": str(params.get("purpose") or ""),
        "source_updated_at": datetime.now().isoformat(timespec="seconds"),
    }

    # 対象モデルの存在確認（不正モデルIDの拒否）
    paths = ensure_project_directories(project_id)
    for model in model_ids:
        safe = sanitize_filename(model)
        if safe != model or not (paths.models / model).is_file():
            raise ValueError(f"対象モデルが見つかりません: {model}")

    ctx.update(10, "レポートID採番")
    with _LOCK, file_lock(_index_path()):
        index = _load_index()
        index["counter"] = int(index["counter"]) + 1
        report_id = f"RPT-{index['counter']:04d}"
        _save_index(index)

    report_dir = _reports_root() / sanitize_filename(project_id)
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if report_type == "single_model":
        base = f"OCR_Crafter_Model_Report_{sanitize_filename(_model_management_no(project_id, model_ids[0]) or model_ids[0].replace('.tess.json', ''))}_{stamp}"
    elif report_type == "comparison":
        base = f"OCR_Crafter_Comparison_Report_{stamp}"
    else:
        base = f"OCR_Crafter_Project_Report_{sanitize_filename(project_id)}_{stamp}"

    ctx.update(30, "Markdown生成")
    ctx.check_cancelled()
    markdown = build_report_markdown(report_type, project_id, model_ids, options, report_id=report_id, job_id=str(getattr(ctx, "job_id", "") or ""), report_dir=report_dir)

    files: list[str] = []
    sha256: dict[str, str] = {}
    md_path = unique_path(report_dir, f"{base}.md")
    atomic_write_text(md_path, markdown)
    if "markdown" in formats:
        files.append(md_path.name)
        sha256[md_path.name] = _sha256_file(md_path)

    if "pdf" in formats:
        ctx.update(60, "PDF変換")
        ctx.check_cancelled()
        pdf_path = unique_path(report_dir, f"{base}.pdf")
        title = markdown.split("\n", 1)[0].lstrip("# ").strip()
        # 原子性: 一時ファイル→リネーム（途中失敗PDFを残さない）
        tmp_pdf = pdf_path.parent / f".{pdf_path.name}.tmp"
        markdown_to_pdf(markdown, tmp_pdf, title)
        tmp_pdf.replace(pdf_path)
        files.append(pdf_path.name)
        sha256[pdf_path.name] = _sha256_file(pdf_path)
        if "markdown" not in formats:
            md_path.unlink(missing_ok=True)  # PDFのみ指定時は基準MDを残さない

    ctx.update(90, "メタデータ保存")
    entry = {
        "reportId": report_id,
        "reportType": report_type,
        "projectId": project_id,
        "modelIds": model_ids,
        "formats": formats,
        "status": "completed",
        "createdAt": datetime.now().isoformat(timespec="seconds"),
        "createdBy": options["created_by"],
        "jobId": str(getattr(ctx, "job_id", "") or ""),
        "files": files,
        "sha256": sha256,
        "sourceUpdatedAt": options["source_updated_at"],
        "generatorVersion": REPORT_GENERATOR_VERSION,
        "options": {"include_images": options["include_images"], "experiments_limit": options["experiments_limit"]},
    }
    with _LOCK, file_lock(_index_path()):
        index = _load_index()
        index["items"].append(entry)
        _save_index(index)
    return {"report_id": report_id, "files": files, "sha256": sha256}


# ---------- 一覧・取得・削除・ダウンロード ----------


def list_reports(project_id: str = "") -> list[dict[str, Any]]:
    items = _load_index()["items"]
    if project_id:
        items = [i for i in items if i.get("projectId") == project_id]
    return list(reversed(items))


def get_report(report_id: str) -> dict[str, Any]:
    for item in _load_index()["items"]:
        if item.get("reportId") == report_id:
            return dict(item)
    raise FileNotFoundError(f"report not found: {report_id}")


def report_file_path(report_id: str, fmt: str) -> Path:
    """ダウンロード対象ファイルのパス（reports配下限定・トラバーサル防止）。"""
    entry = get_report(report_id)
    suffix = ".pdf" if fmt == "pdf" else ".md"
    filename = next((f for f in entry.get("files") or [] if str(f).endswith(suffix)), "")
    if not filename:
        raise FileNotFoundError(f"この形式のファイルはありません: {fmt}")
    root = _reports_root().resolve()
    path = (root / sanitize_filename(str(entry.get("projectId"))) / sanitize_filename(filename)).resolve()
    if not str(path).startswith(str(root)):
        raise ValueError("不正なファイルパスです")
    if not path.is_file():
        raise FileNotFoundError(f"レポートファイルが見つかりません: {filename}")
    return path


def delete_report(report_id: str) -> dict[str, Any]:
    """レポートの削除（メタデータ+出力ファイル+同梱画像）。"""
    from .atomic_io import file_lock

    with _LOCK, file_lock(_index_path()):
        index = _load_index()
        entry = next((i for i in index["items"] if i.get("reportId") == report_id), None)
        if entry is None:
            raise FileNotFoundError(f"report not found: {report_id}")
        report_dir = _reports_root() / sanitize_filename(str(entry.get("projectId")))
        for filename in entry.get("files") or []:
            (report_dir / sanitize_filename(str(filename))).unlink(missing_ok=True)
        images_dir = report_dir / f"{report_id}_images"
        if images_dir.is_dir():
            import shutil

            shutil.rmtree(images_dir, ignore_errors=True)
        index["items"] = [i for i in index["items"] if i.get("reportId") != report_id]
        _save_index(index)
        return dict(entry)
