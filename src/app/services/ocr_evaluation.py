"""OCRモデル評価（エンジン共通）。

学習前(`eng.traineddata`)と学習後モデルを同一データで推論し、認識率・改善率を比較する。
`build_recognizer` でエンジン別の認識器を生成する共通インターフェースにしており、
将来 PaddleOCR 等を評価対象へ追加する場合は engine 分岐を足すだけでよい。
"""

import csv
import logging
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any, Optional

from ..project_paths import ensure_project_directories  # noqa: F401  (プロジェクト整合のため)
from .tesseract_pipeline import TESSERACT_WHITELIST_DEFAULT

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
_BASE_MODEL_ALIASES = {"eng", "base", "eng.traineddata", "base:eng", "eng.tess"}
_GT_HEADER_KEYS = {"image", "image_name", "filename", "file", "name", "画像", "画像名", "ファイル名"}


def _is_base_model(model: Any) -> bool:
    return str(model or "").strip().lower() in _BASE_MODEL_ALIASES


logger = logging.getLogger(__name__)


def _normalize_compare(text: str) -> str:
    # 大文字(A-Z)と小文字筆記体(k/l/t)の読み分けを測るため、
    # 大小変換は行わず case-sensitive の完全一致（trim + Unicode NFC正規化のみ）で比較する。
    # NFC=合成済み形への統一（例: 結合文字のé→単一のé）であり、既存のASCII charsetでは無変化。
    # NFKCは半角/全角・記号を同一視して文字の意味を変えるため使用しない
    # （大小文字・半角/全角・0とO・1とI・異体字・記号の種類も同一視しない）。
    normalized = unicodedata.normalize("NFC", str(text or "")).strip()
    if "�" in normalized:
        # U+FFFD（Unicode置換文字）は上流のデコード時点で元の文字が失われており復元できない。
        # 集計・表示はそのままU+FFFDとして扱い、原因調査用にログへ残す
        logger.warning("評価文字列にU+FFFD（Unicode置換文字）が含まれています。元の文字は復元できません: %r", normalized)
    return normalized


def levenshtein_ops(expected: str, predicted: str) -> tuple[int, list[tuple[str, str, str]]]:
    """Levenshtein編集距離とアラインメント操作を返す。

    戻り値: (編集距離, 操作リスト)。操作は
    ("sub", 正解文字, 予測文字) = 置換 / ("del", 正解文字, "") = 脱落 / ("ins", "", 予測文字) = 挿入。
    DP+バックトレースの純Python実装（評価文字列は短いため追加依存なしで十分高速）。
    """
    a = str(expected or "")
    b = str(predicted or "")
    n, m = len(a), len(b)
    # dp[i][j] = a[:i] と b[:j] の編集距離
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    ops: list[tuple[str, str, str]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + (0 if a[i - 1] == b[j - 1] else 1):
            if a[i - 1] != b[j - 1]:
                ops.append(("sub", a[i - 1], b[j - 1]))
            i -= 1
            j -= 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            ops.append(("del", a[i - 1], ""))
            i -= 1
        else:
            ops.append(("ins", "", b[j - 1]))
            j -= 1
    ops.reverse()
    return dp[n][m], ops


def _build_tesseract_recognizer(project_id: Optional[str], model: str, charset: str, psm: int) -> dict[str, Any]:
    from .model_registry import resolve_tesseract_model_meta
    from .tesseract_pipeline import (
        ensure_tesseract_inference_tool,
        recognize_line,
        resolve_base_traineddata,
    )

    tesseract_cmd = ensure_tesseract_inference_tool()

    training_preprocess: Optional[dict[str, Any]] = None
    training_preprocess_hash: Optional[str] = None
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
        # 学習時前処理の記録（未記録の旧モデルは None のまま。推測で補完しない）
        if isinstance(meta.get("training_preprocess"), dict):
            training_preprocess = meta["training_preprocess"]
        if meta.get("training_preprocess_hash"):
            training_preprocess_hash = str(meta["training_preprocess_hash"])

    def recognize(processed_image_path: str) -> tuple[str, float]:
        return recognize_line(tesseract_cmd, processed_image_path, tessdata_dir, lang, charset, psm)

    return {
        "label": label,
        "engine": "tesseract",
        "model": model_id,
        "is_base": _is_base_model(model),
        "recognize": recognize,
        "training_preprocess": training_preprocess,
        "training_preprocess_hash": training_preprocess_hash,
    }


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


EVAL_PREPROCESS_MODES = {"none", "manual", "training", "training_individual"}

TRAINING_PREPROCESS_MISSING_MESSAGE = (
    "このモデルには学習時前処理の記録がありません。手動設定または前処理なしを選択してください。"
)
TRAINING_PREPROCESS_MISMATCH_MESSAGE = (
    "比較対象モデル間で学習時前処理が異なります。各モデルの学習時前処理を個別適用（training_individual）するか、"
    "全モデルへ共通の手動前処理（manual）を選択してください（推奨: 共通の手動前処理）。"
)
INDIVIDUAL_PREPROCESS_WARNING = (
    "モデルごとに入力画像条件が異なるため、モデル本体だけの純粋比較ではありません。"
)
PREPROCESS_MISMATCH_WARNING = (
    "この評価では、学習時前処理と異なる前処理が使用されています。CERや完全一致率は参考値として確認してください。"
)
TRAINING_PREPROCESS_UNRECORDED_WARNING = (
    "学習時前処理が未記録のモデルが含まれます。前処理の一致は判定できません。"
)


def resolve_evaluation_preprocess_plan(
    mode: Optional[str],
    eval_preprocess: Optional[dict[str, Any]],
    recognizer_metas: list[dict[str, Any]],
    preprocess_source: str = "none",
) -> dict[str, Any]:
    """評価前処理モードから、認識器ごとの前処理適用計画を解決する（純ロジック・テスト対象）。

    recognizer_metas: [{is_base, model, training_preprocess, training_preprocess_hash}]
    戻り値: {mode, groups: {key: {kind, manual, training_preprocess, hash}},
             assignment: [key,...], evaluation_preprocess, warnings}
    学習時前処理が未記録のモデルがある場合はエラー（固定値等へ自動フォールバックしない）。
    """
    from .preprocess import parse_eval_preprocess

    normalized_mode = str(mode or "").strip().lower()
    if normalized_mode and normalized_mode not in EVAL_PREPROCESS_MODES:
        raise ValueError(f"unsupported preprocess_mode: {mode}")
    # 未指定（旧API・後方互換）: eval_preprocess があれば手動、なければ前処理なし
    if not normalized_mode:
        normalized_mode = "manual" if eval_preprocess is not None else "none"

    parsed_manual: Optional[dict[str, Any]] = None
    if normalized_mode == "manual" and eval_preprocess is not None:
        parsed = parse_eval_preprocess(eval_preprocess)
        if parsed["grayscale"] or parsed["binarize"]:
            parsed_manual = parsed

    warnings: list[str] = []
    groups: dict[str, dict[str, Any]] = {}
    assignment: list[str] = []
    evaluation_preprocess: dict[str, Any] = {"mode": normalized_mode}

    def _group(key: str, payload: dict[str, Any]) -> str:
        if key not in groups:
            groups[key] = payload
        return key

    trained = [m for m in recognizer_metas if not m.get("is_base")]
    if normalized_mode == "training":
        missing = [m for m in trained if not isinstance(m.get("training_preprocess"), dict)]
        if not trained or missing:
            raise ValueError(TRAINING_PREPROCESS_MISSING_MESSAGE)
        hashes = {str(m.get("training_preprocess_hash") or "") for m in trained}
        if len(hashes) > 1:
            raise ValueError(TRAINING_PREPROCESS_MISMATCH_MESSAGE)
        tp = trained[0]["training_preprocess"]
        tp_hash = str(trained[0].get("training_preprocess_hash") or "")
        key = _group("training", {"kind": "training", "manual": None, "training_preprocess": tp, "hash": tp_hash})
        assignment = [key for _ in recognizer_metas]
        evaluation_preprocess.update(
            {
                "source_model_id": str(trained[0].get("model") or ""),
                "preprocess_hash": tp_hash,
                "snapshot_id": str(tp.get("snapshot_id") or ""),
                "ocr_input_normalization": tp.get("ocr_input_normalization"),
            }
        )
    elif normalized_mode == "training_individual":
        missing = [m for m in trained if not isinstance(m.get("training_preprocess"), dict)]
        if not trained or missing:
            raise ValueError(TRAINING_PREPROCESS_MISSING_MESSAGE)
        for meta in recognizer_metas:
            if meta.get("is_base") or not isinstance(meta.get("training_preprocess"), dict):
                # ベースモデル（eng）は学習記録を持たないため前処理なしで評価する
                assignment.append(_group("none", {"kind": "none", "manual": None, "training_preprocess": None, "hash": None}))
                continue
            tp_hash = str(meta.get("training_preprocess_hash") or "")
            key = _group(
                f"training:{tp_hash}",
                {"kind": "training", "manual": None, "training_preprocess": meta["training_preprocess"], "hash": tp_hash},
            )
            assignment.append(key)
        warnings.append(INDIVIDUAL_PREPROCESS_WARNING)
        evaluation_preprocess.update(
            {
                "preprocess_hash": None,
                "per_model_hashes": {
                    str(m.get("model") or ""): str(m.get("training_preprocess_hash") or "") for m in trained
                },
            }
        )
    elif normalized_mode == "manual" and parsed_manual is not None:
        key = _group("manual", {"kind": "manual", "manual": parsed_manual, "training_preprocess": None, "hash": None})
        assignment = [key for _ in recognizer_metas]
        evaluation_preprocess.update({"settings": parsed_manual, "source": str(preprocess_source or "custom")})
    else:
        key = _group("none", {"kind": "none", "manual": None, "training_preprocess": None, "hash": None})
        assignment = [key for _ in recognizer_metas]

    # 学習時前処理と評価前処理の一致判定（true / false / None=未記録）
    matches: list[Optional[bool]] = []
    for index, meta in enumerate(recognizer_metas):
        train_hash = meta.get("training_preprocess_hash")
        if meta.get("is_base"):
            matches.append(None)
            continue
        if not train_hash:
            matches.append(None)
            continue
        group = groups[assignment[index]]
        if group["kind"] == "training":
            matches.append(str(group.get("hash") or "") == str(train_hash))
        else:
            matches.append(False)
    if any(m is False for m in matches):
        warnings.append(PREPROCESS_MISMATCH_WARNING)
    if any(m is None and not recognizer_metas[i].get("is_base") for i, m in enumerate(matches)):
        warnings.append(TRAINING_PREPROCESS_UNRECORDED_WARNING)

    return {
        "mode": normalized_mode,
        "groups": groups,
        "assignment": assignment,
        "matches": matches,
        "manual": parsed_manual,
        "evaluation_preprocess": evaluation_preprocess,
        "warnings": warnings,
    }


def evaluate_ocr(
    project_id: Optional[str],
    image_dir: str,
    gt_csv: str,
    targets: list[dict[str, Any]],
    charset: Optional[str] = None,
    psm: int = 7,
    eval_preprocess: Optional[dict[str, Any]] = None,
    preprocess_source: str = "none",
    preprocess_mode: Optional[str] = None,
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

    # 評価前処理の適用計画（none / manual / training / training_individual）。
    # 未指定（旧API）は eval_preprocess の有無で manual / none（従来動作・後方互換）。
    # 評価データセットの回転はデータセット作成時に画像ファイルへ焼き込み済み（構造A）のため、
    # ここでは回転を適用しない（二重回転防止）
    plan = resolve_evaluation_preprocess_plan(
        preprocess_mode,
        eval_preprocess,
        [
            {
                "is_base": bool(rec.get("is_base")),
                "model": str(rec.get("model") or ""),
                "training_preprocess": rec.get("training_preprocess"),
                "training_preprocess_hash": rec.get("training_preprocess_hash"),
            }
            for rec in recognizers
        ],
        preprocess_source=preprocess_source,
    )
    parsed_preprocess = plan["manual"]

    for rec in recognizers:
        rec["total"] = 0
        rec["correct"] = 0
        rec["mismatches"] = []
        # CER（マイクロ平均）用: 全画像の編集距離総和・正解文字数総和（画像ごとのCER平均は使わない）
        rec["dist_total"] = 0
        rec["ref_total"] = 0
        # 混同集計（Levenshteinアラインメント由来の置換/脱落/挿入）
        rec["confusions"] = Counter()
        # 文字別統計（必須文字ルール用: 正解文字ごとの出現数とエラー数=置換+脱落）
        rec["char_total"] = Counter()
        rec["char_errors"] = Counter()

    # 前処理はグループ単位で1回だけ行い、同一グループの全対象へ共通入力を与える
    # （通常モードは全モデル1グループ=公平比較。training_individualのみモデル別グループ）。
    # 処理順は共通仕様: 元画像（回転焼き込み済み）→ 選択した評価前処理 → OCR入力整形
    from .ocr_pipeline import preprocess_ocr_image

    def _prepare_eval_input(image_path: Path, group: dict[str, Any]):
        kind = str(group.get("kind") or "none")
        if kind == "manual":
            from PIL import Image

            from .preprocess import apply_eval_preprocess

            with Image.open(image_path) as opened:
                source_image = apply_eval_preprocess(opened.convert("RGB"), group["manual"])
            return preprocess_ocr_image(source_image, image_shape=[1, 48, 320], strong=False)
        if kind == "training":
            from PIL import Image, ImageOps

            from .preprocess_snapshot import apply_training_preprocess

            tp = group["training_preprocess"]
            normalization = tp.get("ocr_input_normalization") if isinstance(tp.get("ocr_input_normalization"), dict) else {}
            target_h = int(normalization.get("target_height") or 48)
            canvas_w = int(normalization.get("canvas_width") or 320)
            with Image.open(image_path) as opened:
                oriented = ImageOps.exif_transpose(opened)
                source_image = apply_training_preprocess(oriented, tp)
            return preprocess_ocr_image(source_image, image_shape=[1, target_h, canvas_w], strong=False)
        # 前処理なしはパスをそのまま渡す（従来動作・後方互換）
        return preprocess_ocr_image(str(image_path), image_shape=[1, 48, 320], strong=False)

    rows_out: list[dict[str, Any]] = []
    skipped_missing = 0
    for name, expected in gt.items():
        image_path = _resolve_image(image_root, name)
        if image_path is None:
            skipped_missing += 1
            continue
        input_by_group: dict[str, Path] = {}
        try:
            for group_key, group in plan["groups"].items():
                processed = _prepare_eval_input(image_path, group)
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
                tmp_path = Path(tmp.name)
                tmp.close()
                processed.save(tmp_path)
                input_by_group[group_key] = tmp_path
            expected_cmp = _normalize_compare(expected)
            results: list[dict[str, Any]] = []
            for rec_index, rec in enumerate(recognizers):
                prediction, confidence = rec["recognize"](str(input_by_group[plan["assignment"][rec_index]]))
                pred_cmp = _normalize_compare(prediction)
                match = bool(prediction.strip()) and pred_cmp == expected_cmp
                # 編集距離とアラインメント（CER・混同集計・改善/悪化判定・CSVで使用）
                distance, ops = levenshtein_ops(expected_cmp, pred_cmp)
                rec["dist_total"] += distance
                rec["ref_total"] += len(expected_cmp)
                for ch in expected_cmp:
                    rec["char_total"][ch] += 1
                for op in ops:
                    rec["confusions"][op] += 1
                    if op[0] in {"sub", "del"} and op[1]:
                        rec["char_errors"][op[1]] += 1
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
                        # None=取得不能（whitelist指定時のTesseract既知挙動）。0へ偽装しない
                        "confidence": round(float(confidence), 4) if confidence is not None else None,
                        "match": bool(match),
                        "edit_distance": int(distance),
                        "sub_count": sum(1 for op in ops if op[0] == "sub"),
                        "del_count": sum(1 for op in ops if op[0] == "del"),
                        "ins_count": sum(1 for op in ops if op[0] == "ins"),
                    }
                )
            rows_out.append({"image": name, "expected": expected, "results": results})
        finally:
            for tmp_file in input_by_group.values():
                tmp_file.unlink(missing_ok=True)

    if not rows_out:
        raise ValueError(
            "評価対象の画像が見つかりませんでした。正解CSVの filename と画像フォルダ内のファイル名が"
            "一致しているか（拡張子・フォルダ）を確認してください。"
        )

    targets_summary: list[dict[str, Any]] = []
    for rec_index, rec in enumerate(recognizers):
        total = int(rec["total"])
        correct = int(rec["correct"])
        accuracy = (correct / total) if total > 0 else 0.0
        # CER = 全画像の編集距離総和 ÷ 全画像の正解文字数総和（マイクロ平均。低いほど良い）
        ref_total = int(rec["ref_total"])
        dist_total = int(rec["dist_total"])
        cer = round(dist_total / ref_total, 4) if ref_total > 0 else None
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
                # CER主指標と補助指標（文字正解率=1-CER）
                "cer": cer,
                "cer_percent": round(cer * 100.0, 2) if cer is not None else None,
                "char_accuracy": round(1.0 - cer, 4) if cer is not None else None,
                "char_accuracy_percent": round((1.0 - cer) * 100.0, 2) if cer is not None else None,
                "edit_distance_total": dist_total,
                "ref_length_total": ref_total,
                # 混同ランキング（置換/脱落/挿入のTOP10。Levenshteinアラインメント由来）
                "confusions": [
                    {"kind": kind, "from": src, "to": dst, "count": int(count)}
                    for (kind, src, dst), count in rec["confusions"].most_common(10)
                ],
                # 混同の全件（Release GateのCritical Confusion判定用。TOP10と同形式）
                "confusions_full": [
                    {"kind": kind, "from": src, "to": dst, "count": int(count)}
                    for (kind, src, dst), count in rec["confusions"].most_common()
                ],
                # 文字別統計（必須文字ルール用。評価データに現れない文字はキーなし=未検証）
                "char_stats": {
                    ch: {"total": int(total), "errors": int(rec["char_errors"].get(ch, 0))}
                    for ch, total in sorted(rec["char_total"].items())
                },
                # 学習時前処理との一致判定（true / false / None=未記録・ベースモデル）
                "training_preprocess_hash": rec.get("training_preprocess_hash"),
                "preprocess_match": plan["matches"][rec_index],
                "mismatches": rec["mismatches"],
            }
        )

    comparison = None
    base = next((t for t in targets_summary if t["is_base"]), None)
    trained = next((t for t in targets_summary if not t["is_base"]), None)
    if base and trained and base is not trained:
        delta = round(trained["accuracy"] - base["accuracy"], 4)
        improvement = round((delta / base["accuracy"]), 4) if base["accuracy"] > 0 else None
        # 画像単位の編集距離を比較して 改善/同等/悪化・完全一致の増減 を集計
        improved = unchanged = regressed = 0
        perfect_fixed = perfect_regressed = 0
        for row in rows_out:
            base_res = next((r for r in row["results"] if r["model_label"] == base["label"]), None)
            trained_res = next((r for r in row["results"] if r["model_label"] == trained["label"]), None)
            if not base_res or not trained_res:
                continue
            base_dist = int(base_res.get("edit_distance") or 0)
            trained_dist = int(trained_res.get("edit_distance") or 0)
            if trained_dist < base_dist:
                improved += 1
            elif trained_dist > base_dist:
                regressed += 1
            else:
                unchanged += 1
            if not base_res["match"] and trained_res["match"]:
                perfect_fixed += 1
            elif base_res["match"] and not trained_res["match"]:
                perfect_regressed += 1
        # CER差（学習後-学習前。負=改善）と相対改善率（(学習前-学習後)/学習前）
        cer_base = base.get("cer")
        cer_trained = trained.get("cer")
        cer_delta = round(cer_trained - cer_base, 4) if cer_base is not None and cer_trained is not None else None
        cer_relative = (
            round((cer_base - cer_trained) / cer_base, 4)
            if cer_base is not None and cer_trained is not None and cer_base > 0
            else None
        )
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
            # CER主指標の比較
            "base_cer": cer_base,
            "trained_cer": cer_trained,
            "cer_delta": cer_delta,
            "cer_delta_pt": round(cer_delta * 100.0, 2) if cer_delta is not None else None,
            "cer_relative_improvement": cer_relative,
            # 画像単位の改善/同等/悪化と完全一致の増減
            "improved": improved,
            "unchanged": unchanged,
            "regressed": regressed,
            "perfect_fixed": perfect_fixed,
            "perfect_regressed": perfect_regressed,
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
        # 実際に適用した前処理（UI選択中の値ではなくサーバー適用値。履歴・結果表示用）。
        # 旧フィールド（preprocess_source / eval_preprocess）は後方互換のため維持する
        "preprocess_source": (
            plan["mode"]
            if plan["mode"] in {"training", "training_individual"}
            else (str(preprocess_source or "custom") if parsed_preprocess is not None else "none")
        ),
        "eval_preprocess": parsed_preprocess,
        # 新フィールド: 実際に適用した評価前処理（モード・ハッシュ・由来モデル等。履歴保存・再現用）
        "preprocess_mode": plan["mode"],
        "evaluation_preprocess": plan["evaluation_preprocess"],
        "preprocess_warnings": plan["warnings"],
        "targets": targets_summary,
        "rows": rows_out,
        "comparison": comparison,
    }
