"""OCRモデル評価（エンジン共通）。

学習前(`eng.traineddata`)と学習後モデルを同一データで推論し、認識率・改善率を比較する。
`build_recognizer` でエンジン別の認識器を生成する共通インターフェースにしており、
将来 PaddleOCR 等を評価対象へ追加する場合は engine 分岐を足すだけでよい。
"""

import csv
import tempfile
from pathlib import Path
from typing import Any, Optional

from ..project_paths import ensure_project_directories  # noqa: F401  (プロジェクト整合のため)
from .tesseract_pipeline import TESSERACT_WHITELIST_DEFAULT

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
_BASE_MODEL_ALIASES = {"eng", "base", "eng.traineddata", "base:eng", "eng.tess"}
_GT_HEADER_KEYS = {"image", "image_name", "filename", "file", "name", "画像", "画像名", "ファイル名"}


def _is_base_model(model: Any) -> bool:
    return str(model or "").strip().lower() in _BASE_MODEL_ALIASES


def _normalize_compare(text: str) -> str:
    # 大文字(A-Z)と小文字筆記体(k/l/t)の読み分けを測るため、
    # 大小変換は行わず case-sensitive の完全一致（trimのみ）で比較する
    return str(text or "").strip()


def _build_tesseract_recognizer(project_id: Optional[str], model: str, charset: str, psm: int) -> dict[str, Any]:
    from .model_registry import resolve_tesseract_model_meta
    from .tesseract_pipeline import (
        ensure_tesseract_inference_tool,
        recognize_line,
        resolve_base_traineddata,
    )

    tesseract_cmd = ensure_tesseract_inference_tool()

    if _is_base_model(model):
        tessdata_dir, _ = resolve_base_traineddata("eng", tesseract_cmd=tesseract_cmd)
        lang = "eng"
        model_id = "eng"
        label = "eng.traineddata（学習前）"
    else:
        meta = resolve_tesseract_model_meta(project_id, model=model, ready_only=True)
        if not isinstance(meta, dict):
            raise FileNotFoundError(
                f"学習後モデルが見つかりません（未学習、または選択したモデルが存在しません）: {model}。"
                "先にTesseract学習を完了するか、学習後モデルを選択してください。"
            )
        tessdata_dir = str(meta.get("tessdata_dir") or meta.get("model_dir") or "")
        lang = str(meta.get("lang") or "")
        model_id = Path(str(meta.get("meta_file") or "")).name or f"{lang}.tess.json"
        label = f"{model_id}（学習後）"
        if not tessdata_dir or not lang:
            raise FileNotFoundError("Tesseractモデルのメタ情報が不完全です（tessdata_dir/lang）。")

    def recognize(processed_image_path: str) -> tuple[str, float]:
        return recognize_line(tesseract_cmd, processed_image_path, tessdata_dir, lang, charset, psm)

    return {"label": label, "engine": "tesseract", "model": model_id, "is_base": _is_base_model(model), "recognize": recognize}


def build_recognizer(project_id: Optional[str], target: dict[str, Any], charset: str, psm: int) -> dict[str, Any]:
    """評価対象(engine, model)から認識器を生成する共通ファクトリ。"""
    engine = str((target or {}).get("engine") or "tesseract").strip().lower()
    model = str((target or {}).get("model") or "latest").strip()
    if engine == "tesseract":
        return _build_tesseract_recognizer(project_id, model, charset, psm)
    # 将来: elif engine == "paddleocr": return _build_paddleocr_recognizer(...)
    raise ValueError(f"unsupported engine for evaluation: {engine}")


def _read_gt_csv(gt_csv: str) -> "dict[str, str]":
    path = Path(gt_csv).expanduser()
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"正解CSVが見つかりません: {gt_csv}")
    rows: dict[str, str] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        for index, raw in enumerate(reader):
            if not raw or len(raw) < 2:
                continue
            name = str(raw[0]).strip()
            expected = str(raw[1]).strip()
            if index == 0 and name.lower() in _GT_HEADER_KEYS:
                continue  # ヘッダ行はスキップ
            if not name:
                continue
            rows[name] = expected
    if not rows:
        raise ValueError("正解CSVに有効な行がありません（形式: 画像名,正解文字列）")
    return rows


def _resolve_image(image_dir: Path, name: str) -> Optional[Path]:
    candidate = image_dir / name
    if candidate.exists() and candidate.is_file():
        return candidate
    stem = Path(name).stem
    for ext in IMAGE_EXTENSIONS:
        alt = image_dir / f"{stem}{ext}"
        if alt.exists() and alt.is_file():
            return alt
    return None


def evaluate_ocr(
    project_id: Optional[str],
    image_dir: str,
    gt_csv: str,
    targets: list[dict[str, Any]],
    charset: Optional[str] = None,
    psm: int = 7,
) -> dict[str, Any]:
    image_root = Path(image_dir or "").expanduser()
    if not image_root.exists() or not image_root.is_dir():
        raise FileNotFoundError(f"評価用画像フォルダが見つかりません: {image_dir}")

    gt = _read_gt_csv(gt_csv)
    # 評価時whitelist: None=既定(実運用whitelist) / 空文字=whitelistなし / 任意文字列=カスタム
    if charset is None:
        charset = TESSERACT_WHITELIST_DEFAULT
    normalized_charset = "".join(dict.fromkeys(str(charset)))
    if not targets:
        raise ValueError("評価対象モデルがありません")

    recognizers = [build_recognizer(project_id, t, normalized_charset, int(psm)) for t in targets]
    for rec in recognizers:
        rec["total"] = 0
        rec["correct"] = 0
        rec["mismatches"] = []

    # 前処理を1回だけ行い全対象へ共通入力を与える（学習前後の比較を公平にする）
    from .ocr_pipeline import preprocess_ocr_image

    rows_out: list[dict[str, Any]] = []
    skipped_missing = 0
    for name, expected in gt.items():
        image_path = _resolve_image(image_root, name)
        if image_path is None:
            skipped_missing += 1
            continue
        processed = preprocess_ocr_image(str(image_path), image_shape=[1, 48, 320], strong=False)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
        tmp_path = Path(tmp.name)
        tmp.close()
        processed.save(tmp_path)
        try:
            expected_cmp = _normalize_compare(expected)
            results: list[dict[str, Any]] = []
            for rec in recognizers:
                prediction, confidence = rec["recognize"](str(tmp_path))
                match = bool(prediction.strip()) and _normalize_compare(prediction) == expected_cmp
                rec["total"] += 1
                if match:
                    rec["correct"] += 1
                else:
                    rec["mismatches"].append({"image": name, "expected": expected, "prediction": prediction})
                results.append(
                    {
                        "model_label": rec["label"],
                        "engine": rec["engine"],
                        "model": rec["model"],
                        "prediction": prediction,
                        "confidence": round(float(confidence), 4),
                        "match": bool(match),
                    }
                )
            rows_out.append({"image": name, "expected": expected, "results": results})
        finally:
            tmp_path.unlink(missing_ok=True)

    if not rows_out:
        raise ValueError(
            "評価対象の画像が見つかりませんでした。正解CSVの filename と画像フォルダ内のファイル名が"
            "一致しているか（拡張子・フォルダ）を確認してください。"
        )

    targets_summary: list[dict[str, Any]] = []
    for rec in recognizers:
        total = int(rec["total"])
        correct = int(rec["correct"])
        accuracy = (correct / total) if total > 0 else 0.0
        targets_summary.append(
            {
                "label": rec["label"],
                "engine": rec["engine"],
                "model": rec["model"],
                "is_base": bool(rec.get("is_base")),
                "total": total,
                "correct": correct,
                "accuracy": round(accuracy, 4),
                "accuracy_percent": round(accuracy * 100.0, 2),
                "mismatch_count": total - correct,
                "mismatches": rec["mismatches"],
            }
        )

    comparison = None
    base = next((t for t in targets_summary if t["is_base"]), None)
    trained = next((t for t in targets_summary if not t["is_base"]), None)
    if base and trained and base is not trained:
        delta = round(trained["accuracy"] - base["accuracy"], 4)
        improvement = round((delta / base["accuracy"]), 4) if base["accuracy"] > 0 else None
        comparison = {
            "base_label": base["label"],
            "trained_label": trained["label"],
            "base_accuracy": base["accuracy"],
            "trained_accuracy": trained["accuracy"],
            "base_accuracy_percent": base["accuracy_percent"],
            "trained_accuracy_percent": trained["accuracy_percent"],
            "delta": delta,
            "delta_percent": round(delta * 100.0, 2),
            "improvement_rate": improvement,
            "correct_delta": trained["correct"] - base["correct"],
        }

    return {
        "project_id": project_id,
        "image_dir": str(image_root.resolve()),
        "gt_csv": str(Path(gt_csv).expanduser().resolve()),
        "charset": normalized_charset,
        "psm": int(psm),
        "count": len(rows_out),
        "gt_count": len(gt),
        "skipped_missing_image": skipped_missing,
        "targets": targets_summary,
        "rows": rows_out,
        "comparison": comparison,
    }
