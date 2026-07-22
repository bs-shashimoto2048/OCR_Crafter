"""Tesseract(LSTM) fine-tune 学習パイプライン。

PaddleOCR/EasyOCR とは別系統の学習エンジンとして Tesseract を扱う。
学習対象は英大文字(A-Z)・数字(0-9)・小文字筆記体(k/l/t)で、公式
``eng.traineddata`` (tessdata_best 推奨)をベースに LSTM を fine-tune する。

whitelist は推論時の探索制約であり、学習処理には結び付けない
（学習側は学習対象文字セットによるサンプル除外判定とメタ記録のみ）。

外部ツール ``tesseract`` / ``lstmtraining`` / ``combine_tessdata`` が
必要（pip では入らない）。未導入時は導入手順つきの ``RuntimeError`` を送出する。
"""

import json
import os
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from PIL import Image

from ..config import get_settings
from ..project_paths import ensure_project_directories

# 学習対象文字セット: 学習データに含めてよい文字（unicharsetが覚えるべき集合）
TESSERACT_TARGET_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt"
# 推論時whitelist既定: tessedit_char_whitelist に渡す探索制約。
# 現在は学習対象文字セットと同値だが、概念が異なるため別定数として保持する。
TESSERACT_WHITELIST_DEFAULT = TESSERACT_TARGET_CHARSET
DEFAULT_BASE_LANG = "eng"
DEFAULT_MAX_ITERATIONS = 1000
DEFAULT_PSM = 7
TESSERACT_MODEL_SUFFIX = ".tess.json"

_TESSDATA_BEST_HINT = (
    "tessdata_best の eng.traineddata が必要です。"
    "https://github.com/tesseract-ocr/tessdata_best から eng.traineddata を取得し、"
    "config/settings.yaml の tesseract.tessdata_dir か環境変数 TESSDATA_PREFIX に配置してください。"
)
_TRAINING_TOOLS_HINT = (
    "Tesseract 学習ツール（tesseract / lstmtraining / combine_tessdata）が見つかりません。"
    "Windows では通常インストーラに学習ツールが含まれないため、学習ツール入りビルド"
    "（例: UB-Mannheim の training tools、または tesseract を --enable-training でビルド）"
    "を導入し、config/settings.yaml の tesseract.*_cmd で実行ファイルを指定するか PATH を通してください。\n"
    "※推論には tesseract 本体のみで動作しますが、学習には lstmtraining / combine_tessdata"
    "（合成データ生成には text2image）も必要です。手順は docs/11_TESSERACT_CHECKLIST.md を参照してください。"
)
_INFERENCE_TOOL_HINT = (
    "Tesseractを使用するには、別途Tesseract本体のインストールが必要です。\n"
    "インストール後、config/settings.yaml の tesseract.tesseract_cmd に tesseract.exe のパスを指定するか、"
    "PATHを通してください。\n"
    "※推論には tesseract 本体のみが必要です（学習には lstmtraining / combine_tessdata / text2image なども必要）。"
    "手順は docs/11_TESSERACT_CHECKLIST.md を参照してください。"
)


def _tess_cfg(config: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    if isinstance(config, dict):
        return config
    settings = get_settings()
    cfg = settings.get("tesseract")
    return cfg if isinstance(cfg, dict) else {}


def _now_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _append_log(log_path: Optional[Path], message: str) -> None:
    if log_path is None:
        return
    stamp = datetime.now().strftime("[%Y/%m/%d %H:%M:%S]")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(f"{stamp} {message}\n")


def _resolve_tool(explicit: Any, default_name: str) -> str:
    raw = str(explicit or "").strip()
    if raw:
        candidate = Path(raw).expanduser()
        if candidate.exists() and candidate.is_file():
            return str(candidate)
        found = shutil.which(raw)
        return found or ""
    return shutil.which(default_name) or ""


def resolve_tesseract_tools(config: Optional[dict[str, Any]] = None) -> dict[str, str]:
    cfg = _tess_cfg(config)
    return {
        "tesseract": _resolve_tool(cfg.get("tesseract_cmd"), "tesseract"),
        "lstmtraining": _resolve_tool(cfg.get("lstmtraining_cmd"), "lstmtraining"),
        "combine_tessdata": _resolve_tool(cfg.get("combine_tessdata_cmd"), "combine_tessdata"),
    }


def ensure_tesseract_training_tools(config: Optional[dict[str, Any]] = None) -> dict[str, str]:
    tools = resolve_tesseract_tools(config)
    missing = [name for name in ("tesseract", "lstmtraining", "combine_tessdata") if not tools.get(name)]
    if missing:
        raise RuntimeError(f"{_TRAINING_TOOLS_HINT} 未検出: {', '.join(missing)}")
    return tools


def ensure_tesseract_inference_tool(config: Optional[dict[str, Any]] = None) -> str:
    tools = resolve_tesseract_tools(config)
    if not tools["tesseract"]:
        raise RuntimeError(f"tesseract 実行ファイルが見つかりません。\n{_INFERENCE_TOOL_HINT}")
    return tools["tesseract"]


def parse_tsv_words(stdout: str) -> list[tuple[str, float]]:
    """Tesseract TSV出力からword行（level=5相当のtext付き行）を (text, raw_conf) で抽出する。

    - ヘッダ行・列数不足行はスキップ
    - textが空の構造行（conf=-1のlevel 1〜4行など）は含めない
    - conf は raw のまま返す（0〜100想定。数値化できない場合は -1.0）
    """
    words: list[tuple[str, float]] = []
    for line in str(stdout or "").splitlines():
        parts = line.split("\t")
        if len(parts) < 12 or parts[0] == "level":
            continue
        text = parts[11].strip()
        if not text:
            continue
        try:
            conf = float(parts[10])
        except ValueError:
            conf = -1.0
        words.append((text, conf))
    return words


def aggregate_word_confidences(
    words: list[tuple[str, float]],
    whitelist_applied: bool = False,
) -> Optional[float]:
    """word一覧 (text, raw_conf 0〜100) を文字列全体の信頼度（0.0〜1.0）へ集約する。

    - conf < 0（構造行・数値化失敗）のwordは集約に含めない
    - 複数wordは文字数加重平均（短いノイズwordの影響を抑える）
    - 有効confが1件もない場合は None（取得不能）
    - whitelist指定時に全wordの conf が 0.0 の場合も None。
      Tesseract 5.x のLSTMは tessedit_char_whitelist 指定時に信頼度を計算せず
      0.000000 を返す既知挙動があり、これは「本当の0%」ではなく取得不能として扱う
      （whitelist未指定での conf=0 は実測値として 0.0 のまま返す）
    """
    valid = [(text, conf) for text, conf in words if text.strip() and conf >= 0]
    if not valid:
        return None
    if whitelist_applied and all(conf == 0.0 for _, conf in valid):
        return None
    total_chars = sum(len(text) for text, _ in valid)
    if total_chars <= 0:
        return None
    weighted = sum((conf / 100.0) * len(text) for text, conf in valid)
    return float(weighted / total_chars)


def recognize_line(
    tesseract_cmd: str,
    image_path: str,
    tessdata_dir: str,
    lang: str,
    charset: str = "",
    psm: int = 7,
) -> tuple[str, Optional[float]]:
    """単一行画像を tesseract で認識し (text, confidence) を返す。

    推論(`predict.py`)と同一条件（TSV出力・whitelist・単一行PSM）で、
    評価でも共通に利用できる再利用ヘルパ。charset が空文字の場合は
    whitelist なし（探索制約なし）で実行する。
    confidence は 0.0〜1.0。取得不能（有効word無し / whitelist指定時の
    Tesseract既知挙動で信頼度が全て0）の場合は None を返す。
    """
    cmd = [
        tesseract_cmd,
        str(image_path),
        "stdout",
        "--tessdata-dir",
        str(tessdata_dir),
        "-l",
        str(lang),
        "--psm",
        str(int(psm)),
    ]
    if charset:
        cmd += ["-c", f"tessedit_char_whitelist={charset}"]
    # "tsv" 設定ファイル指定だと <tessdata-dir>/configs/tsv が必要になり、
    # 学習済みモデルのディレクトリには存在しないため、パラメータ直接指定でTSV出力する
    cmd += ["-c", "tessedit_create_tsv=1"]
    result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if int(result.returncode or 0) != 0:
        raise RuntimeError(f"tesseract recognition failed (exit={result.returncode}): {result.stderr.strip()}")

    words = parse_tsv_words(result.stdout)
    predicted = "".join(text for text, _ in words)
    confidence = aggregate_word_confidences(words, whitelist_applied=bool(charset))
    return predicted, confidence


def _candidate_tessdata_dirs(config: dict[str, Any], tesseract_cmd: str) -> list[Path]:
    candidates: list[Path] = []
    cfg_dir = str(config.get("tessdata_dir") or "").strip()
    if cfg_dir:
        candidates.append(Path(cfg_dir).expanduser())
    prefix = os.environ.get("TESSDATA_PREFIX")
    if prefix:
        base = Path(prefix).expanduser()
        candidates.append(base)
        candidates.append(base / "tessdata")
    if tesseract_cmd:
        bin_dir = Path(tesseract_cmd).resolve().parent
        candidates.append(bin_dir / "tessdata")
        candidates.append(bin_dir.parent / "tessdata")
        candidates.append(bin_dir.parent / "share" / "tessdata")
    # 重複排除（順序維持）
    unique: list[Path] = []
    seen: set[str] = set()
    for item in candidates:
        key = str(item)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def resolve_base_traineddata(
    base_lang: Optional[str],
    config: Optional[dict[str, Any]] = None,
    tesseract_cmd: str = "",
) -> tuple[Path, Path]:
    """(tessdata_dir, <lang>.traineddata) を返す。見つからなければ RuntimeError。"""
    cfg = _tess_cfg(config)
    lang = str(base_lang or cfg.get("base_lang") or DEFAULT_BASE_LANG).strip() or DEFAULT_BASE_LANG
    for directory in _candidate_tessdata_dirs(cfg, tesseract_cmd):
        traineddata = directory / f"{lang}.traineddata"
        if traineddata.exists() and traineddata.is_file():
            return directory, traineddata
    raise RuntimeError(f"ベース traineddata ({lang}.traineddata) が見つかりません。{_TESSDATA_BEST_HINT}")


def _read_dataset_pairs(dataset_dir: str) -> dict[str, list[tuple[Path, str]]]:
    root = Path(dataset_dir).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"dataset_dir not found: {dataset_dir}")

    result: dict[str, list[tuple[Path, str]]] = {"train": [], "val": []}
    for split in ("train", "val"):
        label_file = root / f"{split}.txt"
        if not label_file.exists():
            continue
        for line in label_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rel, sep, text = line.partition("\t")
            if not sep:
                continue
            text = text.strip()
            if not text:
                continue
            image_path = (root / rel.strip()).resolve()
            if image_path.exists() and image_path.is_file():
                result[split].append((image_path, text))

    if not result["train"]:
        raise ValueError("train.txt に有効な学習サンプルがありません。OCRデータ作成をやり直してください。")
    if not result["val"]:
        result["val"] = []
    return result


def _stream_command(
    cmd: list[str],
    log_path: Optional[Path],
    cwd: Optional[Path] = None,
    env: Optional[dict[str, str]] = None,
    phase: str = "",
) -> None:
    _append_log(log_path, f"$ {' '.join(str(c) for c in cmd)}")
    process = subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        _append_log(log_path, line.rstrip("\n"))
    process.wait()
    if int(process.returncode or 0) != 0:
        raise RuntimeError(f"{phase or 'command'} が失敗しました (exit={process.returncode})")


def _generate_lstmf(
    pairs: list[tuple[Path, str]],
    work_split_dir: Path,
    tesseract_cmd: str,
    base_lang: str,
    psm: int,
    charset: str,
    env: dict[str, str],
    log_path: Optional[Path],
) -> tuple[list[Path], int]:
    """(lstmfパス一覧, charset外でスキップした件数) を返す。

    学習対象文字セット外の文字を含むサンプルは、ラベルを改変（文字削除）せず
    サンプルごと除外する。画像と .gt.txt の不一致を作らないため。
    """
    work_split_dir.mkdir(parents=True, exist_ok=True)
    allowed = set(charset)
    lstmf_paths: list[Path] = []
    skipped_charset = 0
    for index, (image_path, text) in enumerate(pairs, start=1):
        if not text or any(ch not in allowed for ch in text):
            skipped_charset += 1
            _append_log(log_path, f"学習対象文字セット外のためスキップ: {image_path.name} (label={text!r})")
            continue
        base = work_split_dir / f"line_{index:06d}"
        shutil.copy2(image_path, base.with_suffix(".png"))
        # Windowsでも必ずLF改行で書く（CRLFだとtesseract系ツールが\rを内容として解釈する）
        base.with_suffix(".gt.txt").write_text(text, encoding="utf-8", newline="\n")
        # lstm.train での .lstmf 生成には WordStr 形式の .box が必要
        # （tesstrain の generate_line_box.py と同形式。行全体を1つのWordStrとして扱う）
        with Image.open(base.with_suffix(".png")) as opened:
            img_w, img_h = opened.size
        base.with_suffix(".box").write_text(
            f"WordStr 0 0 {img_w} {img_h} 0 #{text}\n\t 0 0 {img_w} {img_h} 0\n",
            encoding="utf-8",
            newline="\n",
        )
        _stream_command(
            [
                tesseract_cmd,
                str(base.with_suffix(".png")),
                str(base),
                "--psm",
                str(int(psm)),
                "-l",
                base_lang,
                "lstm.train",
            ],
            log_path=log_path,
            env=env,
            phase="lstmf生成",
        )
        lstmf = base.with_suffix(".lstmf")
        if lstmf.exists():
            lstmf_paths.append(lstmf)
    return lstmf_paths, skipped_charset


def register_tesseract_model(
    project_id: Optional[str],
    lang: str,
    traineddata_path: Path,
    tessdata_dir: Path,
    base_lang: str,
    charset: str,
    dataset_root: str,
    counts: dict[str, int],
    job_id: str,
    max_iterations: int,
    extra_meta: Optional[dict[str, Any]] = None,
    training_duration_seconds: Optional[int] = None,
) -> Path:
    paths = ensure_project_directories(project_id)
    extra = extra_meta if isinstance(extra_meta, dict) else {}
    # データセットのmeta.jsonから分割・オーグメンテーション情報を引き継ぐ（学習条件比較用。
    # 無い/読めない旧データセットは空=UIで「未記録」表示）
    dataset_meta: dict[str, Any] = {}
    try:
        meta_file = Path(dataset_root) / "meta.json"
        if meta_file.is_file():
            loaded = json.loads(meta_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                dataset_meta = loaded
    except (OSError, ValueError):
        dataset_meta = {}
    meta = {
        "engine": "tesseract",
        "training_family": "tesseract",
        "model_type": "ocr",
        "lang": lang,
        "traineddata_path": str(traineddata_path),
        "tessdata_dir": str(tessdata_dir),
        "model_dir": str(tessdata_dir),
        "base_lang": base_lang,
        "charset": charset,
        "dataset_root": dataset_root,
        "counts": counts,
        "job_id": job_id,
        "max_iterations": int(max_iterations),
        "created_at": datetime.now().isoformat(),
        # 実験情報（学習条件比較用）。未指定は空値で保存し、UI側で「未記録」表示（後方互換）
        "experiment_name": str(extra.get("experiment_name") or ""),
        "parent_model_id": str(extra.get("parent_model_id") or ""),
        "training_note": str(extra.get("training_note") or ""),
        "training_duration_seconds": int(training_duration_seconds) if training_duration_seconds is not None else None,
        # 分割・オーグメンテーション情報（学習条件比較用。旧データセットはNone/空=未記録）
        "dataset_split_ratio": (
            {
                "train": float(dataset_meta.get("train_ratio", 0.0) or 0.0),
                "val": float(dataset_meta.get("val_ratio", 0.0) or 0.0),
                "test": float(dataset_meta.get("test_ratio", 0.0) or 0.0),
            }
            if "train_ratio" in dataset_meta
            else None
        ),
        "split_seed": int(dataset_meta["seed"]) if isinstance(dataset_meta.get("seed"), (int, float)) else None,
        "split_method": str(dataset_meta.get("split_method") or ""),
        "augmentation_config": dataset_meta.get("augmentation") if isinstance(dataset_meta.get("augmentation"), dict) else None,
        "augmentation_generated": (
            int(dataset_meta["augmentation_generated"])
            if isinstance(dataset_meta.get("augmentation_generated"), (int, float))
            else None
        ),
        # 学習時前処理（データセットmeta.jsonの確定保存値をそのまま引き継ぐ。
        # 未記録=None・UIで「未記録」表示。推測で補完しない）
        "training_preprocess": (
            dataset_meta.get("training_preprocess") if isinstance(dataset_meta.get("training_preprocess"), dict) else None
        ),
        "training_preprocess_hash": (
            str(dataset_meta.get("training_preprocess_hash"))
            if dataset_meta.get("training_preprocess_hash")
            else None
        ),
        # 学習データの由来（processed=取込前処理適用済み画像から作成）
        "dataset_source_image_state": str(dataset_meta.get("source_image_state") or ""),
    }
    meta_path = paths.models / f"{lang}{TESSERACT_MODEL_SUFFIX}"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta_path


def run_tesseract_training(
    project_id: str,
    job_id: str,
    dataset_dir: str,
    charset: Optional[str] = None,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    base_lang: Optional[str] = None,
    psm: int = DEFAULT_PSM,
    log_path: Optional[Path] = None,
    config: Optional[dict[str, Any]] = None,
    extra_meta: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    training_started_at = time.monotonic()
    cfg = _tess_cfg(config)
    # 学習対象文字セット。大文字/小文字を区別するため大小変換は行わない（重複除去のみ）
    normalized_charset = "".join(dict.fromkeys(str(charset or cfg.get("default_charset") or TESSERACT_TARGET_CHARSET)))
    if not normalized_charset:
        normalized_charset = TESSERACT_TARGET_CHARSET
    resolved_base_lang = str(base_lang or cfg.get("base_lang") or DEFAULT_BASE_LANG).strip() or DEFAULT_BASE_LANG
    iterations = int(max_iterations or cfg.get("default_max_iterations") or DEFAULT_MAX_ITERATIONS)
    if iterations <= 0:
        iterations = DEFAULT_MAX_ITERATIONS
    resolved_psm = int(psm or cfg.get("default_psm") or DEFAULT_PSM)

    _append_log(log_path, "Tesseract 学習を開始します")
    tools = ensure_tesseract_training_tools(cfg)
    tessdata_dir, base_traineddata = resolve_base_traineddata(resolved_base_lang, cfg, tools["tesseract"])
    _append_log(log_path, f"ベース traineddata: {base_traineddata}")

    pairs = _read_dataset_pairs(dataset_dir)
    counts = {"train": len(pairs["train"]), "val": len(pairs["val"])}
    _append_log(log_path, f"学習サンプル train={counts['train']} / eval={counts['val']}")

    paths = ensure_project_directories(project_id)
    job_id_str = str(job_id or "").strip()
    if not job_id_str:
        # 空idだと Path結合で tesseract_runs ルート自体を指してしまうため中止する
        raise ValueError("job_id is required for tesseract training")
    work_dir = paths.models / "tesseract_runs" / job_id_str
    if work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    env["TESSDATA_PREFIX"] = str(tessdata_dir)

    # 1. 画像+gt.txt から .lstmf を生成
    train_lstmf, train_skipped = _generate_lstmf(
        pairs["train"], work_dir / "train", tools["tesseract"], resolved_base_lang, resolved_psm, normalized_charset, env, log_path
    )
    eval_lstmf, val_skipped = _generate_lstmf(
        pairs["val"], work_dir / "eval", tools["tesseract"], resolved_base_lang, resolved_psm, normalized_charset, env, log_path
    )
    counts["train_skipped_charset"] = train_skipped
    counts["val_skipped_charset"] = val_skipped
    if train_skipped or val_skipped:
        _append_log(
            log_path,
            f"学習対象文字セット外のサンプルを除外しました: train={train_skipped} / eval={val_skipped}",
        )
    if not train_lstmf:
        raise RuntimeError("学習用 .lstmf を生成できませんでした（画像/ラベル/文字セットを確認してください）")
    if not eval_lstmf:
        eval_lstmf = train_lstmf[: max(1, len(train_lstmf) // 10)]

    train_list = work_dir / "train.lstmf.list"
    eval_list = work_dir / "eval.lstmf.list"
    # LF改行必須: CRLFだと各行末の\rがファイル名に混入しlstmtrainingが読めない
    train_list.write_text("\n".join(str(p) for p in train_lstmf) + "\n", encoding="utf-8", newline="\n")
    eval_list.write_text("\n".join(str(p) for p in eval_lstmf) + "\n", encoding="utf-8", newline="\n")

    # 2. ベース traineddata から LSTM を抽出
    base_lstm = work_dir / f"{resolved_base_lang}.lstm"
    _stream_command(
        [tools["combine_tessdata"], "-e", str(base_traineddata), str(base_lstm)],
        log_path=log_path,
        env=env,
        phase="LSTM抽出",
    )

    # 3. fine-tune 実行
    checkpoints_dir = work_dir / "checkpoints"
    checkpoints_dir.mkdir(parents=True, exist_ok=True)
    model_prefix = checkpoints_dir / "finetune"
    _stream_command(
        [
            tools["lstmtraining"],
            "--model_output",
            str(model_prefix),
            "--continue_from",
            str(base_lstm),
            "--traineddata",
            str(base_traineddata),
            "--train_listfile",
            str(train_list),
            "--eval_listfile",
            str(eval_list),
            "--max_iterations",
            str(iterations),
        ],
        log_path=log_path,
        env=env,
        phase="lstmtraining",
    )

    checkpoint_file = checkpoints_dir / "finetune_checkpoint"
    if not checkpoint_file.exists():
        raise RuntimeError("lstmtraining のチェックポイントが生成されませんでした")

    # 4. 学習結果を traineddata として書き出し
    lang_name = f"tess_{_now_tag()}"
    model_dir = paths.models / "tesseract" / lang_name
    model_dir.mkdir(parents=True, exist_ok=True)
    traineddata_out = model_dir / f"{lang_name}.traineddata"
    _stream_command(
        [
            tools["lstmtraining"],
            "--stop_training",
            "--continue_from",
            str(checkpoint_file),
            "--traineddata",
            str(base_traineddata),
            "--model_output",
            str(traineddata_out),
        ],
        log_path=log_path,
        env=env,
        phase="traineddata書き出し",
    )
    if not traineddata_out.exists():
        raise RuntimeError("traineddata の書き出しに失敗しました")

    meta_path = register_tesseract_model(
        project_id=project_id,
        lang=lang_name,
        traineddata_path=traineddata_out,
        tessdata_dir=model_dir,
        base_lang=resolved_base_lang,
        charset=normalized_charset,
        dataset_root=str(Path(dataset_dir).expanduser().resolve()),
        counts=counts,
        job_id=job_id,
        max_iterations=iterations,
        extra_meta=extra_meta,
        training_duration_seconds=int(time.monotonic() - training_started_at),
    )
    _append_log(log_path, f"Tesseract 学習が完了しました: {traineddata_out}")
    return {
        "engine": "tesseract",
        "lang": lang_name,
        "model_dir": str(model_dir),
        "model_path": str(traineddata_out),
        "traineddata_path": str(traineddata_out),
        "tessdata_dir": str(model_dir),
        "meta_path": str(meta_path),
        "charset": normalized_charset,
        "base_lang": resolved_base_lang,
        "max_iterations": iterations,
        "counts": counts,
        "log_path": str(log_path) if log_path else "",
    }
