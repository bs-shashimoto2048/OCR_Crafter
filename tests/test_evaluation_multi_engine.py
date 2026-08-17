"""Multi-engine Evaluation API Integration（Issue #79、
`src/app/services/evaluation_multi_engine.py`）のテスト。

実OCRエンジン（tesseract binary/paddleocr/easyocr/transformers）・実モデル・ネットワーク・
GPUへ一切依存しない。4つのEvaluation Predictorクラスは、本モジュールが実際にimportして
使う名前空間（`src.app.services.evaluation_multi_engine`）でfakeへ差し替える（既存
Predictorテストと同じ「消費側モジュールの名前空間でmockする」規約）。
"""

from pathlib import Path

import pytest
from PIL import Image

from src.app.services.evaluation_dispatcher import (
    UnknownEvaluationEngineError,
    UnsupportedEvaluationEngineError,
)
from src.app.services.evaluation_multi_engine import (
    build_predictor,
    run_multi_engine_evaluation,
    validate_engine_supported,
)
from src.app.services.evaluation_types import PredictionResult

MODULE = "src.app.services.evaluation_multi_engine"


class _FakePredictorBase:
    """全fake Predictor共通の挙動。`predictions`（image stem→text）を参照して返す。"""

    predictions: dict[str, str] = {}
    build_count = 0

    def __init__(self, *args, **kwargs):
        type(self).build_count += 1
        self.init_args = args
        self.init_kwargs = kwargs
        self.recognize_calls: list[str] = []

    def recognize(self, image, **kwargs):
        self.recognize_calls.append(image)
        stem = Path(image).stem
        text = type(self).predictions.get(stem, "")
        if text == "__RAISE__":
            raise RuntimeError("fake inference failure")
        return PredictionResult(text=text, confidence=0.9)


def _make_fake_predictor_class(engine_id: str):
    return type(
        f"Fake{engine_id.title()}Predictor",
        (_FakePredictorBase,),
        {"engine_id": engine_id, "predictions": {}, "build_count": 0},
    )


@pytest.fixture()
def fake_predictors(monkeypatch):
    """4エンジン分のfake Predictorクラスを用意し、本モジュールの名前空間で差し替える。"""
    classes = {
        "tesseract": _make_fake_predictor_class("tesseract"),
        "paddleocr": _make_fake_predictor_class("paddleocr"),
        "easyocr": _make_fake_predictor_class("easyocr"),
        "trocr": _make_fake_predictor_class("trocr"),
    }
    monkeypatch.setattr(f"{MODULE}.TesseractEvaluationPredictor", classes["tesseract"])
    monkeypatch.setattr(f"{MODULE}.PaddleOCREvaluationPredictor", classes["paddleocr"])
    monkeypatch.setattr(f"{MODULE}.EasyOCREvaluationPredictor", classes["easyocr"])
    monkeypatch.setattr(f"{MODULE}.TrOCREvaluationPredictor", classes["trocr"])
    return classes


def _make_dataset(tmp_path, rows: dict[str, str]):
    """image_dir・gt_csvを作成する。rows: {stem: expected_text}。画像は空白PNG。"""
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    gt_csv = tmp_path / "gt.csv"
    lines = ["image,expected"]
    for stem, expected in rows.items():
        path = image_dir / f"{stem}.png"
        Image.new("RGB", (20, 10), (255, 255, 255)).save(path)
        lines.append(f"{stem}.png,{expected}")
    gt_csv.write_text("\n".join(lines), encoding="utf-8")
    return str(image_dir), str(gt_csv)


# ---------------------------------------------------------------------------
# validate_engine_supported / build_predictor
# ---------------------------------------------------------------------------


def test_validate_engine_supported_known_engines_all_true():
    for engine in ("tesseract", "paddleocr", "easyocr", "trocr"):
        assert validate_engine_supported(engine) == engine


def test_validate_engine_supported_custom_raises_unknown():
    with pytest.raises(UnknownEvaluationEngineError):
        validate_engine_supported("custom")


def test_validate_engine_supported_unregistered_raises_unknown():
    with pytest.raises(UnknownEvaluationEngineError):
        validate_engine_supported("no-such-engine")


def test_build_predictor_paddleocr_forwards_model_and_options(fake_predictors):
    predictor = build_predictor(
        "paddleocr",
        project_id="p1",
        model="my_model",
        options={"language": "ja", "use_angle_cls": True},
        default_charset="ABC",
        default_psm=7,
    )
    assert predictor.init_kwargs["model"] == "my_model"
    assert predictor.init_kwargs["language"] == "ja"
    assert predictor.init_kwargs["use_angle_cls"] is True


def test_build_predictor_easyocr_forwards_languages(fake_predictors):
    predictor = build_predictor(
        "easyocr",
        project_id="p1",
        model="latest",
        options={"languages": ["en", "ja"]},
        default_charset="ABC",
        default_psm=7,
    )
    assert predictor.init_kwargs["languages"] == ["en", "ja"]


def test_build_predictor_trocr_forwards_device_and_local_files_only(fake_predictors):
    predictor = build_predictor(
        "trocr",
        project_id="p1",
        model="my/model",
        options={"device": "cpu", "local_files_only": True},
        default_charset="ABC",
        default_psm=7,
    )
    assert predictor.init_kwargs["model"] == "my/model"
    assert predictor.init_kwargs["device"] == "cpu"
    assert predictor.init_kwargs["local_files_only"] is True


def test_build_predictor_tesseract_forwards_charset_psm_override(fake_predictors):
    predictor = build_predictor(
        "tesseract",
        project_id="p1",
        model="latest",
        options={"psm": 8},
        default_charset="ABC",
        default_psm=7,
    )
    assert predictor.init_kwargs["psm"] == 8
    assert predictor.init_kwargs["charset"] == "ABC"  # options未指定分は既定値


# ---------------------------------------------------------------------------
# build_predictor: falsy option値の保持（マージ前レビューMajor #1の是正）
#
# `options.get(key) or default`はPythonのfalsy評価により`psm=0`・`charset=""`という
# 既存Schema上正当な明示的値（OcrEvaluateRequest.charsetのdocstring「空文字=whitelistなし」・
# psmのge=0制約）を「未指定」と誤認しdefaultへ書き換えていた。以下はその回帰防止テスト。
# ---------------------------------------------------------------------------


def test_build_predictor_tesseract_preserves_psm_zero(fake_predictors):
    """psm=0（有効なPSM値）が明示指定された場合、default_psmへフォールバックせず0を保持する。"""
    predictor = build_predictor(
        "tesseract",
        project_id="p1",
        model="latest",
        options={"psm": 0},
        default_charset="ABC",
        default_psm=7,
    )
    assert predictor.init_kwargs["psm"] == 0


def test_build_predictor_tesseract_preserves_empty_charset(fake_predictors):
    """charset=""（既存Schemaで「whitelistなし」を意味する正当な値）が明示指定された場合、
    default_charsetへフォールバックせず空文字を保持する。"""
    predictor = build_predictor(
        "tesseract",
        project_id="p1",
        model="latest",
        options={"charset": ""},
        default_charset="ABC",
        default_psm=7,
    )
    assert predictor.init_kwargs["charset"] == ""


def test_build_predictor_tesseract_preserves_psm_zero_and_empty_charset_together(fake_predictors):
    """psm=0とcharset=""を同時に明示指定した場合、両方とも保持される
    （マージ前レビューで確認された再現ケースそのもの）。"""
    predictor = build_predictor(
        "tesseract",
        project_id="p1",
        model="latest",
        options={"psm": 0, "charset": ""},
        default_charset="ABCDEF",
        default_psm=7,
    )
    assert predictor.init_kwargs["charset"] == ""
    assert predictor.init_kwargs["psm"] == 0


def test_build_predictor_tesseract_no_options_uses_defaults(fake_predictors):
    """optionsが空dict（未指定）の場合は、従来どおりdefault_charset/default_psmが使われる。"""
    predictor = build_predictor(
        "tesseract",
        project_id="p1",
        model="latest",
        options={},
        default_charset="ABCDEF",
        default_psm=7,
    )
    assert predictor.init_kwargs["charset"] == "ABCDEF"
    assert predictor.init_kwargs["psm"] == 7


def test_build_predictor_tesseract_normal_truthy_values_still_forwarded(fake_predictors):
    """通常のtruthy値（psm=8・charset="XYZ"）は従来どおりforwardされる（回帰確認）。"""
    predictor = build_predictor(
        "tesseract",
        project_id="p1",
        model="latest",
        options={"psm": 8, "charset": "XYZ"},
        default_charset="ABCDEF",
        default_psm=7,
    )
    assert predictor.init_kwargs["charset"] == "XYZ"
    assert predictor.init_kwargs["psm"] == 8


def test_build_predictor_tesseract_explicit_none_falls_back_to_default(fake_predictors):
    """options内のキーが明示的にNoneの場合はdefaultへフォールバックする（他Predictorの
    Optionalオプション、例: TrOCRのdeviceと同じ「Noneは未指定扱い」という既存の意味論に揃える。
    Noneと未指定を区別する意味は既存Schema上存在しないため）。"""
    predictor = build_predictor(
        "tesseract",
        project_id="p1",
        model="latest",
        options={"psm": None, "charset": None},
        default_charset="ABCDEF",
        default_psm=7,
    )
    assert predictor.init_kwargs["charset"] == "ABCDEF"
    assert predictor.init_kwargs["psm"] == 7


# ---------------------------------------------------------------------------
# run_multi_engine_evaluation
# ---------------------------------------------------------------------------


def test_single_paddleocr_target_success(fake_predictors, tmp_path):
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "ABC123", "b": "XYZ999"})
    fake_predictors["paddleocr"].predictions = {"a": "ABC123", "b": "XYZ999"}

    result = run_multi_engine_evaluation(
        project_id="p1",
        image_dir=image_dir,
        gt_csv=gt_csv,
        targets=[{"engine": "paddleocr", "model": "official"}],
        charset="ABC",
        psm=7,
    )
    assert result["count"] == 2
    assert result["targets"][0]["engine"] == "paddleocr"
    assert result["targets"][0]["total"] == 2
    assert result["targets"][0]["correct"] == 2
    assert result["targets"][0]["cer"] == 0.0
    assert len(result["rows"]) == 2
    assert result["comparison"] is None


def test_multiple_engines_selected_in_one_request(fake_predictors, tmp_path):
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "HELLO"})
    fake_predictors["paddleocr"].predictions = {"a": "HELLO"}
    fake_predictors["easyocr"].predictions = {"a": "HELLO"}
    fake_predictors["trocr"].predictions = {"a": "HELLO"}

    result = run_multi_engine_evaluation(
        project_id="p1",
        image_dir=image_dir,
        gt_csv=gt_csv,
        targets=[
            {"engine": "paddleocr", "model": "official"},
            {"engine": "easyocr", "model": "latest"},
            {"engine": "trocr", "model": "my/model"},
        ],
        charset="ABC",
        psm=7,
    )
    assert [t["engine"] for t in result["targets"]] == ["paddleocr", "easyocr", "trocr"]
    for t in result["targets"]:
        assert t["correct"] == 1
    assert len(result["rows"][0]["results"]) == 3


def test_build_once_per_target_across_multiple_samples(fake_predictors, tmp_path):
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "A", "b": "B", "c": "C"})
    fake_predictors["easyocr"].predictions = {"a": "A", "b": "B", "c": "C"}

    run_multi_engine_evaluation(
        project_id="p1",
        image_dir=image_dir,
        gt_csv=gt_csv,
        targets=[{"engine": "easyocr", "model": "latest"}],
        charset="ABC",
        psm=7,
    )
    assert fake_predictors["easyocr"].build_count == 1


def test_mismatch_is_recorded(fake_predictors, tmp_path):
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "ABC"})
    fake_predictors["paddleocr"].predictions = {"a": "WRONG"}

    result = run_multi_engine_evaluation(
        project_id="p1",
        image_dir=image_dir,
        gt_csv=gt_csv,
        targets=[{"engine": "paddleocr", "model": "official"}],
        charset="ABC",
        psm=7,
    )
    assert result["targets"][0]["correct"] == 0
    assert len(result["targets"][0]["mismatches"]) == 1
    assert result["rows"][0]["results"][0]["match"] is False


def test_sample_inference_failure_isolated(fake_predictors, tmp_path):
    """1件のSample推論失敗が、他Sampleの処理・Run全体を止めないことを確認する
    （EvaluationRunnerの既存Sample Failure Boundaryをそのまま利用）。"""
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "OK", "broken": "X"})
    fake_predictors["paddleocr"].predictions = {"a": "OK", "broken": "__RAISE__"}

    result = run_multi_engine_evaluation(
        project_id="p1",
        image_dir=image_dir,
        gt_csv=gt_csv,
        targets=[{"engine": "paddleocr", "model": "official"}],
        charset="ABC",
        psm=7,
    )
    assert result["count"] == 2
    errors = [r["results"][0]["error"] for r in result["rows"]]
    assert "RuntimeError" in errors
    assert None in errors


def test_unknown_engine_raises_before_building_other_predictors(fake_predictors, tmp_path):
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "A"})
    with pytest.raises(UnknownEvaluationEngineError):
        run_multi_engine_evaluation(
            project_id="p1",
            image_dir=image_dir,
            gt_csv=gt_csv,
            targets=[{"engine": "paddleocr", "model": "official"}, {"engine": "custom", "model": "x"}],
            charset="ABC",
            psm=7,
        )
    # Unknown targetの検証で停止するため、他target（paddleocr）のPredictorは構築されない
    assert fake_predictors["paddleocr"].build_count == 0


def test_unsupported_preprocess_mode_rejected(fake_predictors, tmp_path):
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "A"})
    with pytest.raises(ValueError, match="training"):
        run_multi_engine_evaluation(
            project_id="p1",
            image_dir=image_dir,
            gt_csv=gt_csv,
            targets=[{"engine": "paddleocr", "model": "official"}],
            charset="ABC",
            psm=7,
            preprocess_mode="training",
        )


def test_empty_dataset_raises_value_error(fake_predictors, tmp_path):
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "A"})
    # GTには存在するが画像フォルダには対応ファイルが無いケース（skipped_missing_image）
    (Path(image_dir) / "a.png").unlink()

    with pytest.raises(ValueError):
        run_multi_engine_evaluation(
            project_id="p1",
            image_dir=image_dir,
            gt_csv=gt_csv,
            targets=[{"engine": "paddleocr", "model": "official"}],
            charset="ABC",
            psm=7,
        )


def test_confidence_nullable_for_trocr(fake_predictors, tmp_path, monkeypatch):
    """TrOCR等confidence=Noneを返すEngineでも、Runner経由でそのままNoneが保持されることを確認する。"""
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "HELLO"})

    class _NoConfidencePredictor(_FakePredictorBase):
        engine_id = "trocr"
        predictions: dict[str, str] = {}

        def recognize(self, image, **kwargs):
            return PredictionResult(text="HELLO", confidence=None)

    monkeypatch.setattr(f"{MODULE}.TrOCREvaluationPredictor", _NoConfidencePredictor)
    result = run_multi_engine_evaluation(
        project_id="p1",
        image_dir=image_dir,
        gt_csv=gt_csv,
        targets=[{"engine": "trocr", "model": "my/model"}],
        charset="ABC",
        psm=7,
    )
    assert result["rows"][0]["results"][0]["confidence"] is None


def test_confidence_zero_is_preserved_not_treated_as_unavailable(fake_predictors, tmp_path, monkeypatch):
    """confidence=0.0（実測値）が「未取得」扱いのNoneへ化けず、そのままResponseへ保持される
    ことを確認する（レビューMinor 4。Predictor→PredictionResult→Runner→Response変換の
    経路全体でfalsy値=0.0が捏造・欠落しないことの回帰防止テスト）。"""
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "ABC"})

    class _ZeroConfidencePredictor(_FakePredictorBase):
        engine_id = "paddleocr"
        predictions: dict[str, str] = {}

        def recognize(self, image, **kwargs):
            return PredictionResult(text="ABC", confidence=0.0)

    monkeypatch.setattr(f"{MODULE}.PaddleOCREvaluationPredictor", _ZeroConfidencePredictor)
    result = run_multi_engine_evaluation(
        project_id="p1",
        image_dir=image_dir,
        gt_csv=gt_csv,
        targets=[{"engine": "paddleocr", "model": "official"}],
        charset="ABC",
        psm=7,
    )
    confidence = result["rows"][0]["results"][0]["confidence"]
    assert confidence == 0.0
    assert confidence is not None  # Noneとfloat 0.0を明確に区別する


def test_missing_image_dir_raises_file_not_found(fake_predictors, tmp_path):
    with pytest.raises(FileNotFoundError):
        run_multi_engine_evaluation(
            project_id="p1",
            image_dir=str(tmp_path / "does_not_exist"),
            gt_csv=str(tmp_path / "gt.csv"),
            targets=[{"engine": "paddleocr", "model": "official"}],
            charset="ABC",
            psm=7,
        )


def test_manual_preprocess_produces_temp_file_and_does_not_leak(fake_predictors, tmp_path):
    """manual前処理時、Predictorへ渡るimageパスは元画像とは異なる一時ファイルであり、
    処理後に削除される（リークしない）ことを確認する。"""
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "ABC"})
    fake_predictors["paddleocr"].predictions = {"a": "ABC"}
    original_path = str(Path(image_dir) / "a.png")

    captured_images: list[str] = []
    original_recognize = fake_predictors["paddleocr"].recognize

    def _recording_recognize(self, image, **kwargs):
        captured_images.append(image)
        return original_recognize(self, image, **kwargs)

    fake_predictors["paddleocr"].recognize = _recording_recognize

    run_multi_engine_evaluation(
        project_id="p1",
        image_dir=image_dir,
        gt_csv=gt_csv,
        targets=[{"engine": "paddleocr", "model": "official"}],
        charset="ABC",
        psm=7,
        eval_preprocess={"grayscale": True},
        preprocess_mode="manual",
    )
    assert len(captured_images) == 1
    assert captured_images[0] != original_path
    assert not Path(captured_images[0]).exists()  # 一時ファイルは処理後に削除される


def test_none_mode_passes_original_image_path_directly(fake_predictors, tmp_path):
    """preprocess_mode省略時（既定=none）は、元画像パスがそのままPredictorへ渡ることを確認する
    （Tesseract固有のOCR入力整形=`preprocess_ocr_image()`を新経路では行わない）。"""
    image_dir, gt_csv = _make_dataset(tmp_path, {"a": "ABC"})
    fake_predictors["paddleocr"].predictions = {"a": "ABC"}
    original_path = str(Path(image_dir) / "a.png")

    captured_images = []
    original_recognize = fake_predictors["paddleocr"].recognize

    def _recording_recognize(self, image, **kwargs):
        captured_images.append(image)
        return original_recognize(self, image, **kwargs)

    fake_predictors["paddleocr"].recognize = _recording_recognize

    run_multi_engine_evaluation(
        project_id="p1",
        image_dir=image_dir,
        gt_csv=gt_csv,
        targets=[{"engine": "paddleocr", "model": "official"}],
        charset="ABC",
        psm=7,
    )
    assert captured_images == [original_path]


# ---------------------------------------------------------------------------
# Capability regression
# ---------------------------------------------------------------------------


def test_capability_all_four_engines_supported():
    for engine in ("tesseract", "paddleocr", "easyocr", "trocr"):
        assert validate_engine_supported(engine) == engine


def test_capability_custom_still_unsupported():
    with pytest.raises(UnknownEvaluationEngineError):
        validate_engine_supported("custom")
