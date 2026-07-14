import argparse
import math
import os
import re
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any, Optional

import torch
from PIL import Image, ImageEnhance, ImageFilter
from torchvision import transforms

from .config import get_settings
from .services.model_registry import resolve_model_path, resolve_ocr_model_meta, resolve_tesseract_model_meta
from .services.tesseract_pipeline import (
    TESSERACT_WHITELIST_DEFAULT,
    ensure_tesseract_inference_tool,
    recognize_line,
    resolve_base_traineddata,
)
from .services.latin_case import (
    build_latin_allowlist,
    is_latin_case_langs,
    normalize_latin_case,
)
from .services.ocr_pipeline import (
    CONF_THRESHOLD,
    OCR_CHARSET_DEFAULT,
    preprocess_ocr_image,
    validate_business_rules,
    validate_ocr_result,
)
from .services.preprocess import build_preprocess_config, preprocess_image_for_model
from .train import build_model, detect_device

_EASYOCR_READER_CACHE: dict[tuple[tuple[str, ...], bool], Any] = {}
_PADDLEOCR_READER_CACHE: dict[tuple[str, bool], Any] = {}
STRICT_OCR_EXPORT_REQUIRED = True
OFFICIAL_PADDLEOCR_REC_MODELS: tuple[str, ...] = (
    "en_PP-OCRv5_mobile_rec",
    "PP-OCRv5_server_rec",
    "en_PP-OCRv4_mobile_rec",
    "PP-OCRv4_mobile_rec",
    "PP-OCRv3_mobile_rec",
)


def _prepare_paddle_runtime_env() -> None:
    # paddlex のモデル配信元疎通チェックを無効化し、オフライン環境でも
    # ローカル推論モデルを使えるようにする。
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")


def list_paddleocr_official_rec_models() -> list[str]:
    return list(OFFICIAL_PADDLEOCR_REC_MODELS)


def normalize_confidence(score: float) -> float:
    value = float(score)
    return 1.0 / (1.0 + math.exp(-5.0 * (value - 0.8)))


def _load_checkpoint(
    model_type: Optional[str],
    project_id: Optional[str] = None,
    model: str = "latest",
) -> tuple[dict[str, Any], Path]:
    path = resolve_model_path(project_id=project_id, model=model, model_type=model_type)
    if path is None:
        if model and model != "latest":
            raise FileNotFoundError(f"model not found: {model}")
        raise FileNotFoundError(f"No model found for type: {model_type or 'any'}")

    checkpoint = torch.load(path, map_location="cpu")
    return checkpoint, path


def _normalize_ocr_languages(languages: Optional[list[str]]) -> list[str]:
    langs = [lang.strip() for lang in (languages or ["en"]) if lang.strip()]
    if not langs:
        langs = ["en"]
    return langs


def _normalize_ocr_shape(shape: Any) -> list[int]:
    raw = shape if isinstance(shape, (list, tuple)) else [3, 48, 320]
    nums = [int(x) for x in raw]
    if len(nums) != 3 or nums[0] != 3 or nums[1] <= 0 or nums[2] <= 0:
        return [3, 48, 320]
    return nums


def _prepare_ocr_input_path(
    image_source: Any,
    image_shape: list[int],
    apply_preprocess: bool,
    variant: str = "base",
) -> tuple[str, Optional[Path]]:
    if not apply_preprocess:
        if isinstance(image_source, (str, Path)):
            return str(image_source), None
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
        tmp_path = Path(tmp.name)
        tmp.close()
        if isinstance(image_source, Image.Image):
            image_source.save(tmp_path)
        else:
            Image.fromarray(image_source).save(tmp_path)  # type: ignore[arg-type]
        return str(tmp_path), tmp_path

    base = preprocess_ocr_image(image_source, image_shape=image_shape, strong=False)
    processed = base
    if variant == "contrast":
        processed = ImageEnhance.Contrast(base).enhance(1.15)
    elif variant == "blur":
        processed = base.filter(ImageFilter.GaussianBlur(radius=0.6))
    elif variant == "strong":
        processed = preprocess_ocr_image(image_source, image_shape=image_shape, strong=True)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
    tmp_path = Path(tmp.name)
    tmp.close()
    processed.save(tmp_path)
    return str(tmp_path), tmp_path


def _choose_ocr_candidate(primary: dict[str, Any], secondary: Optional[dict[str, Any]]) -> tuple[dict[str, Any], bool]:
    if secondary is None:
        return primary, False
    p_valid = bool(primary.get("validation", {}).get("valid"))
    s_valid = bool(secondary.get("validation", {}).get("valid"))
    p_conf = float(primary.get("confidence") or 0.0)
    s_conf = float(secondary.get("confidence") or 0.0)

    if s_valid and not p_valid:
        return secondary, True
    if s_valid and p_valid and s_conf >= p_conf:
        return secondary, True
    if not p_valid and not s_valid and s_conf > p_conf:
        return secondary, True
    return primary, False


def _compute_char_scores(text: str, candidates: list[dict[str, Any]], confidence: float) -> list[float]:
    normalized = str(text or "")
    if not normalized:
        return []
    conf = max(0.0, min(1.0, float(confidence)))
    scores: list[float] = []
    for idx, ch in enumerate(normalized):
        agree = 0
        total = 0
        for row in candidates:
            candidate_text = str(row.get("prediction") or "")
            if len(candidate_text) <= idx:
                continue
            total += 1
            if candidate_text[idx] == ch:
                agree += 1
        ratio = (agree / total) if total else 0.0
        score = conf * (0.55 + 0.45 * ratio)
        scores.append(max(0.0, min(1.0, score)))
    return scores


def _build_char_scores(text: str, raw_scores: Optional[list[float]], confidence: float) -> list[float]:
    normalized_text = str(text or "")
    target_len = len(normalized_text)
    if target_len <= 0:
        return []
    if not isinstance(raw_scores, list) or len(raw_scores) == 0:
        fallback = max(0.0, min(1.0, float(confidence)))
        return [fallback for _ in range(target_len)]

    values = [max(0.0, min(1.0, float(x))) for x in raw_scores]
    if len(values) < target_len:
        pad_value = values[-1] if values else max(0.0, min(1.0, float(confidence)))
        values.extend([pad_value for _ in range(target_len - len(values))])
    if len(values) > target_len:
        values = values[:target_len]
    return values


def _normalize_char_confidence(scores: list[float]) -> list[float]:
    return [max(0.0, min(1.0, float(normalize_confidence(x)))) for x in scores]


def _merge_validation(validation: dict[str, Any], business: dict[str, Any]) -> dict[str, Any]:
    valid = bool(validation.get("valid")) and bool(business.get("valid"))
    if not valid:
        reason = validation.get("reason") or business.get("reason")
    else:
        reason = None
    return {
        **validation,
        "valid": valid,
        "reason": reason,
        "business_valid": bool(business.get("valid")),
        "business_reason": business.get("reason"),
    }


def _apply_char_confidence_gate(validation: dict[str, Any], char_scores: list[float], threshold: float = 0.7) -> dict[str, Any]:
    if not char_scores:
        return validation
    min_score = min(float(x) for x in char_scores)
    if min_score < float(threshold):
        if bool(validation.get("valid")):
            return {
                **validation,
                "valid": False,
                "reason": "low_char_confidence",
            }
    return validation


def _pick_majority_candidate(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    if not candidates:
        return {}
    text_counter = Counter(str(row.get("prediction") or "") for row in candidates)
    if not text_counter:
        return max(candidates, key=lambda row: float(row.get("confidence") or 0.0))
    top_count = max(text_counter.values())
    top_texts = {text for text, count in text_counter.items() if count == top_count}
    top_rows = [row for row in candidates if str(row.get("prediction") or "") in top_texts]
    return max(top_rows, key=lambda row: float(row.get("confidence") or 0.0))


def _get_easyocr_reader(languages: list[str]) -> tuple[Any, bool]:
    try:
        import easyocr  # type: ignore
    except ImportError as e:
        raise RuntimeError("easyocr is not installed. Please run: pip install easyocr") from e

    use_gpu = bool(torch.cuda.is_available())
    key = (tuple(languages), use_gpu)
    if key not in _EASYOCR_READER_CACHE:
        _EASYOCR_READER_CACHE[key] = easyocr.Reader(languages, gpu=use_gpu)
    return _EASYOCR_READER_CACHE[key], use_gpu


def _resolve_latin_case_control(languages: list[str], include_lowercase: bool) -> tuple[bool, Optional[str]]:
    """ラテン言語設定のときのみ小文字制御を適用する。

    戻り値: (適用するか, EasyOCR readtext へ渡す allowlist)。
    小文字ON時の allowlist は None（無制限）とし、既存動作を変えない。
    日本語等の非ラテン言語が含まれる場合は (False, None) を返し一切適用しない。
    """
    if not is_latin_case_langs(languages):
        return False, None
    return True, build_latin_allowlist(include_lowercase=include_lowercase)


def _apply_latin_case_to_results(
    prediction: str,
    parsed_results: list[dict[str, Any]],
    languages: list[str],
    include_lowercase: bool,
) -> tuple[str, list[dict[str, Any]]]:
    """出力後の大文字化（PaddleOCR等、推論時whitelistがないエンジン向け）。

    小文字を削除せず大文字へ変換し、文字列長・Confidenceは変更しない。
    非ラテン言語設定では何もしない。
    """
    if include_lowercase or not is_latin_case_langs(languages):
        return prediction, parsed_results
    normalized = normalize_latin_case(prediction, include_lowercase=False)
    normalized_results = [
        {**row, "text": normalize_latin_case(str(row.get("text") or ""), include_lowercase=False)}
        for row in parsed_results
    ]
    return normalized, normalized_results


def _run_easyocr(
    reader: Any, input_path: str, allowlist: Optional[str] = None
) -> tuple[str, float, list[dict[str, Any]]]:
    if allowlist:
        raw_results = reader.readtext(input_path, detail=1, paragraph=False, allowlist=allowlist)
    else:
        raw_results = reader.readtext(input_path, detail=1, paragraph=False)
    parsed_results: list[dict[str, Any]] = []
    for row in raw_results[:20]:
        if len(row) < 3:
            continue
        parsed_results.append({"text": str(row[1]), "confidence": float(row[2])})

    if parsed_results:
        best = max(parsed_results, key=lambda x: float(x.get("confidence", 0.0)))
        prediction = str(best.get("text", "")).strip()
        confidence = float(best.get("confidence", 0.0))
    else:
        prediction = ""
        confidence = 0.0

    return prediction, confidence, parsed_results


def _predict_with_easyocr(
    image_source: Any,
    project_id: Optional[str] = None,
    languages: Optional[list[str]] = None,
    charset: str = OCR_CHARSET_DEFAULT,
    max_text_length: int = 8,
    image_shape: Optional[list[int]] = None,
    apply_preprocess: bool = True,
    include_lowercase: bool = True,
) -> dict[str, Any]:
    shape = _normalize_ocr_shape(image_shape or [3, 48, 320])
    langs = _normalize_ocr_languages(languages)
    reader, use_gpu = _get_easyocr_reader(langs)
    case_control, allowlist = _resolve_latin_case_control(langs, include_lowercase)
    # 小文字ON時は検証でも大小文字を保持する（従来はvalidationで常に大文字化していた）
    if case_control and include_lowercase:
        validation_charset = build_latin_allowlist(include_lowercase=True, base_allowlist=charset)
        validation_text_case = "keep"
    else:
        validation_charset = charset
        validation_text_case = "upper"

    def _infer(variant: str) -> dict[str, Any]:
        input_path, temp_path = _prepare_ocr_input_path(image_source, shape, apply_preprocess, variant=variant)
        try:
            prediction, confidence, parsed_results = _run_easyocr(reader, input_path, allowlist=allowlist)
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
        if case_control:
            # allowlistで制限済みだが、旧EasyOCR等でallowlist未対応の場合の保険として正規化も行う
            prediction, parsed_results = _apply_latin_case_to_results(
                prediction, parsed_results, langs, include_lowercase
            )
        validation = validate_ocr_result(
            prediction,
            max_text_length=max_text_length,
            charset=validation_charset,
            confidence=confidence,
            conf_threshold=CONF_THRESHOLD,
            text_case=validation_text_case,
        )
        business = validate_business_rules(validation["text"])
        merged_validation = _merge_validation(validation, business)
        return {
            "prediction": merged_validation["text"],
            "raw_prediction": prediction,
            "confidence": confidence,
            "validation": merged_validation,
            "easyocr_results": parsed_results,
            "preprocess_variant": variant,
        }

    variants = ["base", "contrast", "blur"]
    variant_results = [_infer(variant) for variant in variants]
    primary = _pick_majority_candidate(variant_results)
    char_scores = _compute_char_scores(
        str(primary.get("prediction") or ""),
        variant_results,
        float(primary.get("confidence") or 0.0),
    )
    min_char_score = min(char_scores) if char_scores else 1.0

    retry_candidate: Optional[dict[str, Any]] = None
    if (not bool(primary.get("validation", {}).get("valid"))) or min_char_score < 0.7:
        retry_candidate = _infer("strong")
        retry_char_scores = _compute_char_scores(
            str(retry_candidate.get("prediction") or ""),
            variant_results + [retry_candidate],
            float(retry_candidate.get("confidence") or 0.0),
        )
        retry_candidate["char_scores"] = retry_char_scores
    chosen, used_retry = _choose_ocr_candidate(primary, retry_candidate)
    chosen_char_scores = chosen.get("char_scores")
    if not isinstance(chosen_char_scores, list) or len(chosen_char_scores) == 0:
        chosen_char_scores = _compute_char_scores(
            str(chosen.get("prediction") or ""),
            variant_results + ([retry_candidate] if retry_candidate else []),
            float(chosen.get("confidence") or 0.0),
        )
    chosen_text = str(chosen.get("prediction") or "")
    chosen_char_scores = _build_char_scores(chosen_text, chosen_char_scores, float(chosen.get("confidence") or 0.0))
    normalized_char_scores = _normalize_char_confidence(chosen_char_scores)
    final_validation = _apply_char_confidence_gate(dict(chosen["validation"]), chosen_char_scores)

    return {
        "text": chosen_text,
        "prediction": chosen_text,
        "confidence": float(chosen["confidence"]),
        "model_path": "",
        "project_id": project_id,
        "model_type": "easyocr",
        "model_name": "easyocr",
        "engine": "easyocr",
        "easyocr_gpu": use_gpu,
        "easyocr_languages": langs,
        "include_lowercase": bool(include_lowercase),
        "lowercase_control_applied": bool(case_control),
        "easyocr_results": chosen["easyocr_results"],
        "multi_ocr_candidates": variant_results,
        "multi_ocr": True,
        "validation": final_validation,
        "valid": bool(final_validation["valid"]),
        "char_scores": chosen_char_scores,
        "char_confidence_normalized": normalized_char_scores,
        "low_char_confidence": (min(chosen_char_scores) if chosen_char_scores else 1.0) < 0.7,
        "retry_performed": retry_candidate is not None,
        "retry_used": bool(used_retry),
        "retry_validation": retry_candidate["validation"] if retry_candidate else None,
        "raw_prediction": chosen["raw_prediction"],
    }


def _get_paddleocr_reader(language: str, use_angle_cls: bool) -> Any:
    _prepare_paddle_runtime_env()
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "paddleocr is not installed. Please run: pip install paddleocr paddlepaddle"
        ) from e

    lang = (language or "en").strip() or "en"
    key = (lang, bool(use_angle_cls))
    if key not in _PADDLEOCR_READER_CACHE:
        _PADDLEOCR_READER_CACHE[key] = _create_paddleocr_instance(
            PaddleOCR,
            lang=lang,
            use_angle_cls=bool(use_angle_cls),
        )
    return _PADDLEOCR_READER_CACHE[key]


def _get_paddle_text_recognition_reader(model_dir: Optional[Path] = None, model_name: Optional[str] = None) -> Optional[Any]:
    _prepare_paddle_runtime_env()
    try:
        from paddleocr import TextRecognition  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "paddleocr is not installed. Please run: pip install paddleocr paddlepaddle"
        ) from e
    except Exception:
        # PaddleOCR 2.x では TextRecognition が公開されていないことがある。
        return None

    if model_dir is None and not str(model_name or "").strip():
        return None
    key_source = str(model_dir.resolve()) if model_dir is not None else str(model_name or "").strip()
    key = (f"text_recognition:{key_source}", False)
    if key not in _PADDLEOCR_READER_CACHE:
        try:
            if model_dir is not None:
                _PADDLEOCR_READER_CACHE[key] = TextRecognition(model_dir=str(model_dir))
            else:
                _PADDLEOCR_READER_CACHE[key] = TextRecognition(model_name=str(model_name))
        except Exception:
            return None
    return _PADDLEOCR_READER_CACHE[key]


def _extract_unknown_kwarg(message: str) -> Optional[str]:
    patterns = [
        r"Unknown argument:\s*([A-Za-z0-9_]+)",
        r"unexpected keyword argument ['\"]([A-Za-z0-9_]+)['\"]",
        r"got an unexpected keyword argument ['\"]([A-Za-z0-9_]+)['\"]",
    ]
    for pattern in patterns:
        matched = re.search(pattern, message)
        if matched:
            return str(matched.group(1))
    return None


def _create_paddleocr_instance(paddleocr_cls: Any, **base_kwargs: Any) -> Any:
    """
    PaddleOCRのバージョン差異で受け付ける引数が異なるため、
    利用可能な引数組み合わせへフォールバックしつつ生成する。
    """
    attempts: list[dict[str, Any]] = []
    include_det_off = "rec_model_dir" in base_kwargs
    normalized_base_kwargs = dict(base_kwargs)
    # PaddleOCR 3.x 系では False を明示しただけでも排他引数エラーになることがある。
    # 既定値と同じ False は渡さず、互換性を優先する。
    for optional_false_flag in (
        "use_angle_cls",
        "use_textline_orientation",
        "use_doc_orientation_classify",
        "use_doc_unwarping",
    ):
        if normalized_base_kwargs.get(optional_false_flag) is False:
            normalized_base_kwargs.pop(optional_false_flag, None)

    kwargs = dict(normalized_base_kwargs)
    kwargs["show_log"] = False
    if include_det_off:
        kwargs["det"] = False
    attempts.append(kwargs)

    kwargs = dict(normalized_base_kwargs)
    if include_det_off:
        kwargs["det"] = False
    attempts.append(kwargs)

    kwargs = dict(normalized_base_kwargs)
    kwargs["show_log"] = False
    attempts.append(kwargs)

    attempts.append(dict(normalized_base_kwargs))

    last_error: Optional[Exception] = None
    for kwargs in attempts:
        candidate_kwargs = dict(kwargs)
        # バージョン差で未対応引数があっても、その引数だけを落として継続する。
        while True:
            try:
                return paddleocr_cls(**candidate_kwargs)
            except Exception as e:  # noqa: BLE001
                message = str(e)
                if (
                    "Unknown argument" in message
                    or "unexpected keyword argument" in message
                    or "got an unexpected keyword argument" in message
                ):
                    unknown_kwarg = _extract_unknown_kwarg(message)
                    if unknown_kwarg and unknown_kwarg in candidate_kwargs:
                        candidate_kwargs.pop(unknown_kwarg, None)
                        last_error = e
                        continue
                    last_error = e
                    break
                if "mutually exclusive" in message:
                    if "use_angle_cls" in candidate_kwargs:
                        candidate_kwargs.pop("use_angle_cls", None)
                        last_error = e
                        continue
                    if "use_textline_orientation" in candidate_kwargs:
                        candidate_kwargs.pop("use_textline_orientation", None)
                        last_error = e
                        continue
                raise

    if last_error is not None:
        raise RuntimeError(f"failed to initialize PaddleOCR with compatible args: {last_error}") from last_error
    raise RuntimeError("failed to initialize PaddleOCR")


def _is_paddle_rec_inference_dir(model_dir: Path) -> bool:
    if not model_dir.exists() or not model_dir.is_dir():
        return False
    weights = model_dir / "inference.pdiparams"
    graph_candidates = [model_dir / "inference.pdmodel", model_dir / "inference.json"]
    has_graph = any(item.exists() and item.is_file() for item in graph_candidates)
    return weights.exists() and weights.is_file() and has_graph


def _run_paddleocr(reader: Any, input_path: str, use_angle_cls: bool) -> tuple[str, float, list[dict[str, Any]]]:
    raw_results: Any
    if hasattr(reader, "ocr"):
        try:
            raw_results = reader.ocr(input_path, cls=use_angle_cls)
        except Exception as e:  # noqa: BLE001
            message = str(e)
            if "unexpected keyword argument 'cls'" in message or "Unknown argument: cls" in message:
                raw_results = reader.ocr(input_path)
            else:
                raise
    elif hasattr(reader, "predict"):
        raw_results = reader.predict(input_path)
    else:
        raise RuntimeError("PaddleOCR reader has no callable ocr/predict method")

    parsed_results: list[dict[str, Any]] = []

    # 新しいPaddleOCR(3.x)形式:
    # - OCR pipeline: [{rec_texts:[...], rec_scores:[...], ...}]
    # - TextRecognition: [{rec_text: "...", rec_score: ... , ...}]
    if isinstance(raw_results, list) and raw_results and isinstance(raw_results[0], dict):
        for block in raw_results:
            if not isinstance(block, dict):
                continue
            rec_texts = block.get("rec_texts")
            rec_scores = block.get("rec_scores")
            if "rec_text" in block:
                text = str(block.get("rec_text") or "").strip()
                try:
                    score = float(block.get("rec_score", 0.0))
                except Exception:  # noqa: BLE001
                    score = 0.0
                parsed_results.append({"text": text, "confidence": score})
                continue
            if isinstance(rec_texts, list):
                for idx, text in enumerate(rec_texts):
                    score = 0.0
                    if isinstance(rec_scores, list) and idx < len(rec_scores):
                        try:
                            score = float(rec_scores[idx])
                        except Exception:  # noqa: BLE001
                            score = 0.0
                    parsed_results.append({"text": str(text or "").strip(), "confidence": score})

    # 旧PaddleOCR形式: [[box, [text, score]], ...]
    for block in raw_results or []:
        if not isinstance(block, list):
            continue
        for row in block:
            if not isinstance(row, (list, tuple)) or len(row) < 2:
                continue
            rec = row[1]
            if not isinstance(rec, (list, tuple)) or len(rec) < 2:
                continue
            text = str(rec[0]).strip()
            try:
                confidence = float(rec[1])
            except Exception:  # noqa: BLE001
                confidence = 0.0
            parsed_results.append({"text": text, "confidence": confidence})

    if parsed_results:
        best = max(parsed_results, key=lambda x: float(x.get("confidence", 0.0)))
        prediction = str(best.get("text", "")).strip()
        confidence = float(best.get("confidence", 0.0))
    else:
        prediction = ""
        confidence = 0.0
    return prediction, confidence, parsed_results


def _predict_with_paddleocr(
    image_source: Any,
    project_id: Optional[str] = None,
    languages: Optional[list[str]] = None,
    model: str = "latest",
    charset: str = OCR_CHARSET_DEFAULT,
    max_text_length: int = 8,
    image_shape: Optional[list[int]] = None,
    apply_preprocess: bool = True,
    include_lowercase: bool = True,
) -> dict[str, Any]:
    langs = _normalize_ocr_languages(languages)
    selected_lang = langs[0]
    # PaddleOCR 3.x の推論APIには実行時whitelistがないため、
    # 小文字OFF時は出力後に英字を大文字へ正規化する（Confidenceは変更しない）
    case_control = is_latin_case_langs(langs)
    # 学習済み認識モデルのみを使う運用では角度分類器を無効化し、
    # 追加の公式モデル取得を避ける。
    use_angle_cls = False
    requested_model = (model or "latest").strip()
    official_requested = requested_model in OFFICIAL_PADDLEOCR_REC_MODELS
    model_warning: Optional[str] = None
    model_meta = None if official_requested else resolve_ocr_model_meta(
        project_id=project_id,
        model=model,
        engine="paddleocr",
        inference_ready_only=True,
    )
    if model_meta is None and not official_requested:
        if requested_model not in {"", "latest"}:
            raise FileNotFoundError(f"paddleocr model not found: {model}")
        # 学習済み(エクスポート済み)モデルが無い環境でも latest 指定で
        # プレビューできるよう、公式認識モデルへフォールバックする。
        requested_model = OFFICIAL_PADDLEOCR_REC_MODELS[0]
        official_requested = True
        model_warning = (
            f"最新の学習済みモデルがないため、公式モデル {requested_model} で推論しました。"
        )
    if model_meta is None:
        shape = _normalize_ocr_shape(image_shape or [3, 48, 320])
        effective_charset = charset
        effective_max_text_length = int(max_text_length)
        requested_model_name = requested_model
        model_dir = None
    else:
        effective_charset = str(model_meta.get("charset") or charset)
        effective_max_text_length = int(model_meta.get("max_text_length") or max_text_length)
        shape = _normalize_ocr_shape(model_meta.get("image_shape") or image_shape or [3, 48, 320])
        requested_model_name = str(model_meta.get("name") or requested_model)
        exported_flag = model_meta.get("exported")
        export_ready_flag = model_meta.get("export_ready")
        if STRICT_OCR_EXPORT_REQUIRED and (exported_flag is False or export_ready_flag is False):
            raise RuntimeError(
                f"selected model '{requested_model_name}' is not inference-exported. "
                "Please run model export first."
            )
        model_dir_raw = str(model_meta.get("model_dir") or model_meta.get("inference_dir") or "").strip()
        if not model_dir_raw:
            raise RuntimeError(
                f"selected model '{requested_model_name}' has no inference directory. "
                "Please run model export first."
            )
        model_dir = Path(model_dir_raw)
        if not _is_paddle_rec_inference_dir(model_dir):
            raise RuntimeError(
                f"selected model '{requested_model_name}' is not inference-exported. "
                "Please run model export first."
            )

    reader = _get_paddle_text_recognition_reader(model_dir=model_dir, model_name=(requested_model if official_requested else None))
    if reader is None:
        _prepare_paddle_runtime_env()
        try:
            from paddleocr import PaddleOCR  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "paddleocr is not installed. Please run: pip install paddleocr paddlepaddle"
            ) from e
        if official_requested:
            reader = _create_paddleocr_instance(
                PaddleOCR,
                lang=selected_lang,
                use_angle_cls=use_angle_cls,
                text_recognition_model_name=requested_model,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
        else:
            reader = _create_paddleocr_instance(
                PaddleOCR,
                lang=selected_lang,
                use_angle_cls=use_angle_cls,
                rec_model_dir=str(model_dir),
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )

    # 小文字ON時は検証でも大小文字を保持する（従来はvalidationで常に大文字化していた）
    if case_control and include_lowercase:
        validation_charset = build_latin_allowlist(include_lowercase=True, base_allowlist=effective_charset)
        validation_text_case = "keep"
    else:
        validation_charset = effective_charset
        validation_text_case = "upper"

    def _infer(variant: str) -> dict[str, Any]:
        input_path, temp_path = _prepare_ocr_input_path(image_source, shape, apply_preprocess, variant=variant)
        try:
            prediction, confidence, parsed_results = _run_paddleocr(reader, input_path, use_angle_cls=use_angle_cls)
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
        if case_control:
            prediction, parsed_results = _apply_latin_case_to_results(
                prediction, parsed_results, langs, include_lowercase
            )
        validation = validate_ocr_result(
            prediction,
            max_text_length=effective_max_text_length,
            charset=validation_charset,
            confidence=confidence,
            conf_threshold=CONF_THRESHOLD,
            text_case=validation_text_case,
        )
        business = validate_business_rules(validation["text"])
        merged_validation = _merge_validation(validation, business)
        return {
            "prediction": merged_validation["text"],
            "raw_prediction": prediction,
            "confidence": confidence,
            "validation": merged_validation,
            "paddleocr_results": parsed_results,
            "preprocess_variant": variant,
        }

    variants = ["base", "contrast", "blur"]
    variant_results = [_infer(variant) for variant in variants]
    primary = _pick_majority_candidate(variant_results)
    char_scores = _compute_char_scores(
        str(primary.get("prediction") or ""),
        variant_results,
        float(primary.get("confidence") or 0.0),
    )
    min_char_score = min(char_scores) if char_scores else 1.0

    retry_candidate: Optional[dict[str, Any]] = None
    if (not bool(primary.get("validation", {}).get("valid"))) or min_char_score < 0.7:
        retry_candidate = _infer("strong")
        retry_char_scores = _compute_char_scores(
            str(retry_candidate.get("prediction") or ""),
            variant_results + [retry_candidate],
            float(retry_candidate.get("confidence") or 0.0),
        )
        retry_candidate["char_scores"] = retry_char_scores
    chosen, used_retry = _choose_ocr_candidate(primary, retry_candidate)
    chosen_char_scores = chosen.get("char_scores")
    if not isinstance(chosen_char_scores, list) or len(chosen_char_scores) == 0:
        chosen_char_scores = _compute_char_scores(
            str(chosen.get("prediction") or ""),
            variant_results + ([retry_candidate] if retry_candidate else []),
            float(chosen.get("confidence") or 0.0),
        )
    chosen_text = str(chosen.get("prediction") or "")
    chosen_char_scores = _build_char_scores(chosen_text, chosen_char_scores, float(chosen.get("confidence") or 0.0))
    normalized_char_scores = _normalize_char_confidence(chosen_char_scores)
    final_validation = _apply_char_confidence_gate(dict(chosen["validation"]), chosen_char_scores)

    return {
        "text": chosen_text,
        "prediction": chosen_text,
        "confidence": float(chosen["confidence"]),
        "model_path": "",
        "project_id": project_id,
        "model_type": "paddleocr",
        "model_name": requested_model_name,
        "engine": "paddleocr",
        "paddleocr_language": selected_lang,
        "paddleocr_languages": langs,
        "include_lowercase": bool(include_lowercase),
        "lowercase_control_applied": bool(case_control),
        "paddleocr_results": chosen["paddleocr_results"],
        "multi_ocr_candidates": variant_results,
        "multi_ocr": True,
        "validation": final_validation,
        "valid": bool(final_validation["valid"]),
        "char_scores": chosen_char_scores,
        "char_confidence_normalized": normalized_char_scores,
        "low_char_confidence": (min(chosen_char_scores) if chosen_char_scores else 1.0) < 0.7,
        "retry_performed": retry_candidate is not None,
        "retry_used": bool(used_retry),
        "retry_validation": retry_candidate["validation"] if retry_candidate else None,
        "raw_prediction": chosen["raw_prediction"],
        "charset": effective_charset,
        "max_text_length": effective_max_text_length,
        "model_warning": model_warning,
    }


def _auto_model_type_for_image(image_type: str) -> Optional[str]:
    settings = get_settings()
    mapping = settings.get("training", {}).get("image_type_to_model", {"single": "square", "wide": "wide"})
    fallback = settings.get("training", {}).get("default_model_type")
    return mapping.get(image_type) or fallback


def _image_type_for_model_type(model_type: Optional[str]) -> Optional[str]:
    if not model_type:
        return None
    settings = get_settings()
    mapping = settings.get("training", {}).get("image_type_to_model", {"single": "square", "wide": "wide"})
    for image_type, mapped_model_type in mapping.items():
        if str(mapped_model_type) == str(model_type):
            return str(image_type)
    return None


# 学習前の標準英語モデル(eng.traineddata)をベースラインとして指定するための別名
TESSERACT_BASE_MODEL_ALIASES = {"eng", "base", "eng.traineddata", "base:eng", "eng.tess"}


def _predict_with_tesseract(
    image_source: Any,
    project_id: Optional[str] = None,
    model: str = "latest",
    apply_preprocess: bool = True,
) -> dict[str, Any]:
    tesseract_cmd = ensure_tesseract_inference_tool()
    normalized_model = (model or "latest").strip()
    if normalized_model.lower() in TESSERACT_BASE_MODEL_ALIASES:
        tessdata_dir_path, _ = resolve_base_traineddata("eng", tesseract_cmd=tesseract_cmd)
        tessdata_dir = str(tessdata_dir_path)
        lang = "eng"
        charset = TESSERACT_WHITELIST_DEFAULT
        model_name = "eng.traineddata"
    else:
        meta = resolve_tesseract_model_meta(project_id=project_id, model=normalized_model, ready_only=True)
        if not isinstance(meta, dict):
            raise FileNotFoundError(
                "学習済みTesseractモデルが見つかりません。先にTesseractでOCR学習を実行するか、"
                "ベースモデル eng.traineddata を選択してください。"
            )
        tessdata_dir = str(meta.get("tessdata_dir") or meta.get("model_dir") or "")
        lang = str(meta.get("lang") or "")
        # 旧モデル互換: メタに記録された charset をそのまま whitelist 既定として継承する
        charset = str(meta.get("charset") or TESSERACT_WHITELIST_DEFAULT)
        model_name = Path(str(meta.get("meta_file") or "")).name or f"{lang}.tess.json"
        if not tessdata_dir or not lang:
            raise FileNotFoundError("Tesseractモデルのメタ情報が不完全です（tessdata_dir/lang）。")

    tmp_path: Optional[Path] = None
    try:
        if apply_preprocess:
            processed = preprocess_ocr_image(image_source, image_shape=[1, 48, 320], strong=False)
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
            tmp_path = Path(tmp.name)
            tmp.close()
            processed.save(tmp_path)
            input_path = str(tmp_path)
        elif isinstance(image_source, (str, Path)):
            input_path = str(image_source)
        else:
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
            tmp_path = Path(tmp.name)
            tmp.close()
            if isinstance(image_source, Image.Image):
                image_source.save(tmp_path)
            else:
                Image.fromarray(image_source).save(tmp_path)  # type: ignore[arg-type]
            input_path = str(tmp_path)

        predicted, confidence = recognize_line(
            tesseract_cmd, input_path, tessdata_dir, lang, charset, psm=7
        )
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

    allowed = set(charset)
    cleaned = "".join(ch for ch in predicted if ch in allowed)
    valid = bool(cleaned) and cleaned == predicted
    validation = {
        "valid": bool(valid),
        "reason": None if valid else ("empty_text" if not cleaned else "invalid_character_removed"),
        "charset": charset,
    }
    char_scores = _build_char_scores(predicted, None, confidence)
    normalized_char_scores = _normalize_char_confidence(char_scores)
    return {
        "text": predicted,
        "prediction": predicted,
        "confidence": float(confidence),
        "engine": "tesseract",
        "model_name": model_name,
        "model_type": "ocr",
        "lang": lang,
        "valid": bool(valid),
        "validation": validation,
        "char_scores": char_scores,
        "char_confidence_normalized": normalized_char_scores,
    }


def predict_from_image(
    image_path: str,
    model_type: Optional[str] = None,
    project_id: Optional[str] = None,
    model: str = "latest",
    engine: str = "custom",
    easyocr_languages: Optional[list[str]] = None,
    apply_preprocess: bool = True,
    preprocess_overrides: Optional[dict[str, Any]] = None,
    include_lowercase: bool = True,
) -> dict[str, Any]:
    engine_name = (engine or "custom").strip().lower()
    preprocess_meta: dict[str, Any] = {"applied": False, "image_type": "", "pipeline": []}
    ocr_input_source: Any = image_path

    if apply_preprocess and preprocess_overrides:
        forced_image_type = _image_type_for_model_type(model_type)
        preprocess_cfg = build_preprocess_config(preprocess_overrides)
        pre = preprocess_image_for_model(image_path, force_image_type=forced_image_type, config=preprocess_cfg)
        preprocess_meta = {
            "applied": True,
            "image_type": str(pre.get("type", "")),
            "pipeline": list(pre.get("pipeline", [])),
        }
        ocr_input_source = Image.fromarray(pre["processed"], mode="L")

    if engine_name == "easyocr":
        result = _predict_with_easyocr(
            ocr_input_source,
            project_id=project_id,
            languages=easyocr_languages,
            apply_preprocess=(apply_preprocess and not preprocess_overrides),
            include_lowercase=include_lowercase,
        )
        result["preprocess_applied"] = preprocess_meta["applied"]
        result["preprocess_image_type"] = preprocess_meta["image_type"]
        result["preprocess_pipeline"] = preprocess_meta["pipeline"]
        return result
    if engine_name == "paddleocr":
        result = _predict_with_paddleocr(
            ocr_input_source,
            project_id=project_id,
            languages=easyocr_languages,
            model=model,
            apply_preprocess=(apply_preprocess and not preprocess_overrides),
            include_lowercase=include_lowercase,
        )
        result["preprocess_applied"] = preprocess_meta["applied"]
        result["preprocess_image_type"] = preprocess_meta["image_type"]
        result["preprocess_pipeline"] = preprocess_meta["pipeline"]
        return result
    if engine_name == "tesseract":
        result = _predict_with_tesseract(
            ocr_input_source,
            project_id=project_id,
            model=model,
            apply_preprocess=(apply_preprocess and not preprocess_overrides),
        )
        result["preprocess_applied"] = preprocess_meta["applied"]
        result["preprocess_image_type"] = preprocess_meta["image_type"]
        result["preprocess_pipeline"] = preprocess_meta["pipeline"]
        return result

    inference_image: Image.Image
    selected_model_type = model_type

    if apply_preprocess:
        forced_image_type = _image_type_for_model_type(selected_model_type)
        preprocess_cfg = build_preprocess_config(preprocess_overrides) if preprocess_overrides else None
        pre = preprocess_image_for_model(image_path, force_image_type=forced_image_type, config=preprocess_cfg)
        preprocess_meta = {
            "applied": True,
            "image_type": str(pre.get("type", "")),
            "pipeline": list(pre.get("pipeline", [])),
        }
        inference_image = Image.fromarray(pre["processed"], mode="L")
        if not selected_model_type:
            selected_model_type = _auto_model_type_for_image(preprocess_meta["image_type"])
    else:
        with Image.open(image_path) as opened:
            inference_image = opened.convert("L").copy()

    checkpoint, resolved_model_path = _load_checkpoint(selected_model_type, project_id=project_id, model=model)

    classes = checkpoint.get("classes", [])
    image_size = checkpoint.get("image_size", [64, 64])

    if not classes:
        raise ValueError("Checkpoint classes are empty")

    model = build_model(num_classes=len(classes))
    model.load_state_dict(checkpoint["state_dict"])

    device = detect_device()
    model = model.to(device)
    model.eval()

    transform = transforms.Compose(
        [
            transforms.Grayscale(num_output_channels=3),
            transforms.Resize((int(image_size[0]), int(image_size[1]))),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]),
        ]
    )

    tensor = transform(inference_image).unsqueeze(0).to(device)

    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)
        conf, idx = torch.max(probs, dim=1)

    predicted_text = str(classes[idx.item()])
    conf_value = float(conf.item())
    char_scores = _build_char_scores(predicted_text, None, conf_value)
    normalized_char_scores = _normalize_char_confidence(char_scores)

    return {
        "text": predicted_text,
        "prediction": predicted_text,
        "confidence": conf_value,
        "model_path": str(resolved_model_path),
        "project_id": checkpoint.get("project_id", project_id),
        "model_type": checkpoint.get("model_type", selected_model_type or ""),
        "model_name": resolved_model_path.name,
        "engine": "custom",
        "preprocess_applied": preprocess_meta["applied"],
        "preprocess_image_type": preprocess_meta["image_type"],
        "preprocess_pipeline": preprocess_meta["pipeline"],
        "char_scores": char_scores,
        "char_confidence_normalized": normalized_char_scores,
        "valid": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict digit from image")
    parser.add_argument("image_path", type=str)
    parser.add_argument("--project-id", type=str, default="default")
    parser.add_argument("--model-type", type=str, default="")
    parser.add_argument("--model", type=str, default="latest")
    parser.add_argument("--engine", type=str, default="custom", choices=["custom", "easyocr", "paddleocr", "tesseract"])
    parser.add_argument("--easyocr-langs", type=str, default="en")
    args = parser.parse_args()

    langs = [x.strip() for x in args.easyocr_langs.split(",") if x.strip()]
    result = predict_from_image(
        args.image_path,
        model_type=(args.model_type or None),
        project_id=args.project_id,
        model=args.model,
        engine=args.engine,
        easyocr_languages=langs,
    )
    print(result)


if __name__ == "__main__":
    main()
